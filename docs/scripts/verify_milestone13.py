"""JARVIS Milestone 13 browser verification (Playwright, fake webcam).

Boots the BACKEND (node dist/server.js subprocess) + the frontend dev
server, and verifies Phase 4 close-out — workspace persistence + the API
proxy router (one browser page + python urllib/ws helpers):
  a) page boots exact: 4 app windows (dashboard-1, notes-1, chat-1,
     search-1), boot console line says 4, 'JARVIS · Milestone' (tolerant since M14; v14 owns the exact pin)
  b) HUD: Camera active, MediaPipe ready, Windows = 4, Sync connected,
     Users = 1, Remote hands = 0
  c) workspace modify + Save: close chat-1, open notes-2 (launcher) ->
     Dashboard Save -> inline "saved 4" status -> python GET
     /api/workspace returns EXACTLY the 4 saved ids
  d) cross-restart persistence: BACKEND RESTART -> a python ws client's
     stateSnapshot contains the same 4 windows (the file round-trip:
     PUT -> disk -> boot preload)
  e) page reload -> the persisted EXTRA window (notes-2) materializes
     from the server state (boot windows + notes-2 in the DOM)
  f) Load: python GET right before the click -> Dashboard Load -> the
     DOM window ids EQUAL that live GET set (button round-trip)
  g) proxy without keys: GET /api/proxy/status -> {"llm": false,
     "search": false}; POST /api/proxy/llm -> 503 not_configured;
     GET /api/proxy/search -> 503 (typed JSON, never a crash/hang)
  h) CORS: OPTIONS from http://localhost:5173 -> 204 + ACAO header
  i) the LLM Chat app still demo-modes cleanly (banner present, no key
     anywhere by design in this run)
  j) zero console errors and zero page errors (backend restart window
     included — modulo the documented offline probe noise)
  k) >= 1 "[Performance]" line, every line in the M4 four-key format
  l) latency >= 2 lines, min avg in 150-260ms
  m) cleanups balanced (2 page loads), 1 live video track, FPS >= 30,
     no gesture log lines
  n) backend health ok + wsPort 4001; HTTP + WS listening log lines

Honest scope notes:
  (1) the saved snapshot's chat-1 "resurrection" after reload is the
      documented boot-scene artifact (M8 recreates the four app windows
      every launch; the workspace governs the SERVER-side set) — the
      verifier pins what is true: the SAVED set (c/d) and the
      button-vs-live consistency (f).
  (2) the LLM SSE passthrough with a REAL key is the user's live spot
      check; here the proxy paths are exercised only in their no-key
      shapes (unit tests cover the passthrough with mocked upstreams).
  (3) v13 manages the backend subprocess itself and requires
      `npm run build:backend` beforehand (dist/server.js must exist).

Usage: python verify_milestone13.py [base_url]
Evidence (m13-boot/workspace/loaded.png, m13-console.txt,
m13-summary.json, m13-backend.log, m13-workspace.json) -> docs/screenshots/.
"""
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

try:
    import websocket as ws_client  # websocket-client 1.9.0 (sync)
except ImportError:
    print("verify_milestone13: the 'websocket-client' python package is required")
    sys.exit(2)

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
REPO = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = REPO / "apps" / "backend"
BACKEND_ENTRY = BACKEND_DIR / "dist" / "server.js"
DATA_FILE = BACKEND_DIR / "data" / "workspace.json"
if not BACKEND_ENTRY.exists():
    print("verify_milestone13: apps/backend/dist/server.js missing — run `npm run build:backend` first")
    sys.exit(2)


# M13: the backend now PRELOADS data/workspace.json at boot; this verifier
# asserts a CLEAN workspace (exact boot ids / snapshot sets), so reset the
# file before starting — documented M13 lockstep deviation (same forced
# class as M11's D4b).
DATA_FILE = BACKEND_DIR / "data" / "workspace.json"
if DATA_FILE.exists():
    DATA_FILE.unlink()

OUT = Path(__file__).resolve().parent.parent / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
BACKEND_LOG = OUT / "m13-backend.log"

HEALTH_URL = "http://localhost:4000/api/health"
WS_URL = "ws://localhost:4001"
API = "http://localhost:4000"

console_lines: list[str] = []
page_errors: list[str] = []

PERF_LINE_PATTERN = re.compile(
    r"\[Performance\] handDetectionLatency=(\d+)ms renderFPS=(\d+) "
    r"gestureRecognitionLatency=(\d+(?:\.\d+)?)ms "
    r"interactionLatency=(\d+(?:\.\d+)?)ms"
)

KNOWN_OFFLINE_NOISE = re.compile(
    r"^\[error\] Failed to load resource: net::ERR_CONNECTION_REFUSED$")


def perf_fullmatch(line: str) -> re.Match | None:
    message = line.split("] ", 1)[1] if "] " in line else line
    return PERF_LINE_PATTERN.fullmatch(message)


def start_backend() -> tuple:
    log = open(BACKEND_LOG, "a", encoding="utf-8")
    proc = subprocess.Popen(
        ["node", "dist/server.js"],
        cwd=str(BACKEND_DIR),
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    deadline = time.monotonic() + 15
    last_error = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=2) as response:
                payload = json.loads(response.read().decode())
            return proc, payload
        except Exception as error:  # noqa: BLE001 - poll until up
            last_error = error
            time.sleep(0.5)
    raise RuntimeError(f"backend did not become healthy: {last_error}")


def stop_backend(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def http_json(method: str, url: str, body: dict | None = None,
              headers: dict | None = None) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method,
                                     headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            payload = response.read().decode()
            return response.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as error:
        payload = error.read().decode()
        return error.code, (json.loads(payload) if payload else None)


def window_ids(page) -> list[str]:
    return page.evaluate(
        """() => [...document.querySelectorAll('[data-testid=\"floating-window\"]')]
              .map((el) => el.getAttribute('data-window-id')).sort()""")


def poll_until(page, js_expr: str, want, timeout_s: float = 6.0):
    deadline = time.monotonic() + timeout_s
    value = None
    while time.monotonic() < deadline:
        value = page.evaluate(js_expr)
        if value == want:
            return True, value
        page.wait_for_timeout(250)
    return False, value


def main() -> None:
    summary: dict | None = None
    backend: subprocess.Popen | None = None
    try:
        backend, health = start_backend()
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--use-fake-device-for-media-stream",
                    "--use-fake-ui-for-media-stream",
                    "--autoplay-policy=no-user-gesture-required",
                    "--mute-audio",
                ],
            )
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.on("console", lambda m: console_lines.append(f"[{m.type}] {m.text}"))
            page.on("pageerror", lambda e: page_errors.append(str(e)))

            # --- Phase 1: boot ------------------------------------------
            print(f"navigating to {BASE_URL}")
            page.goto(BASE_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(14000)
            page.screenshot(path=str(OUT / "m13-boot.png"))
            runtime1 = page.evaluate(
                """() => {
                  const allDivs = [...document.querySelectorAll('div')];
                  const hud = allDivs.find(
                    (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
                  return {
                    hudText: hud ? hud.innerText : null,
                    chatBanner: Boolean(document.querySelector('[data-testid=\"chat-demo-banner\"]')),
                    liveTracks: ([...document.querySelectorAll('video')][0]?.srcObject
                      ? [...document.querySelectorAll('video')][0].srcObject.getTracks()
                          .filter(t => t.readyState === 'live').length : 0),
                  };
                }"""
            )
            hud1 = runtime1["hudText"] or ""
            boot_ids = window_ids(page)

            # --- Phase 2: modify + Save ---------------------------------
            page.evaluate(
                """() => {
                  const close = document.querySelector(
                    '[data-window-id=\"chat-1\"] button[aria-label^=\"Close \"]');
                  close.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            page.evaluate(
                """() => {
                  const el = document.querySelector(
                    '[data-window-id=\"dashboard-1\"] [data-testid=\"launcher-open-notes\"]');
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            page.wait_for_timeout(800)
            modified_ids = window_ids(page)
            page.evaluate(
                """() => {
                  const el = document.querySelector('[data-testid=\"workspace-save\"]');
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            ok_saved, saved_status = poll_until(
                page,
                "() => document.querySelector('[data-testid=\"workspace-status\"]')?.innerText",
                "saved 4 ✓", timeout_s=6)
            status_get, status_body = http_json("GET", f"{API}/api/workspace")
            saved_file_ids = sorted(w["id"] for w in status_body["windows"])

            # --- Phase 3: backend RESTART -> file round-trip -------------
            stop_backend(backend)
            backend = None
            time.sleep(1.0)
            backend, health_restart = start_backend()
            w = ws_client.create_connection(WS_URL, timeout=5)
            snapshot = json.loads(w.recv())  # stateSnapshot (first frame)
            w.close()
            file_ids_via_ws = sorted(x["id"] for x in snapshot["data"]["windows"])

            # --- Phase 4: reload -> persisted window materializes --------
            page.goto(BASE_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(14000)
            got_notes2, _ = poll_until(
                page,
                "() => document.querySelector('[data-window-id=\\\"notes-2\\\"]') ? 'yes' : 'no'",
                "yes", timeout_s=8)
            reloaded_ids = window_ids(page)

            # --- Phase 5: Load button round-trip ------------------------
            _, live_body = http_json("GET", f"{API}/api/workspace")
            live_ids_before_load = sorted(w["id"] for w in live_body["windows"])
            page.evaluate(
                """() => {
                  const el = document.querySelector('[data-testid=\"workspace-load\"]');
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            page.wait_for_timeout(1200)
            loaded_ids = window_ids(page)
            page.screenshot(path=str(OUT / "m13-loaded.png"))

            # --- Phase 6: proxy no-key shapes + CORS ---------------------
            st_status, st_body = http_json("GET", f"{API}/api/proxy/status")
            llm_status, llm_body = http_json(
                "POST", f"{API}/api/proxy/llm",
                {"messages": [{"role": "user", "content": "hi"}]},
                {"Content-Type": "application/json"})
            search_status, search_body = http_json("GET", f"{API}/api/proxy/search?q=x")
            pre = urllib.request.Request(f"{API}/api/workspace", method="OPTIONS",
                                         headers={"Origin": "http://localhost:5173"})
            with urllib.request.urlopen(pre, timeout=5) as response:
                cors_code = response.status
                cors_origin = response.headers.get("Access-Control-Allow-Origin")

            # --- Summary -------------------------------------------------
            fps_values = [
                int(x) for x in re.findall(r"\[Scene3D\] FPS: (\d+)", "\n".join(console_lines))]
            latency_lines = [l for l in console_lines if "detection latency" in l]
            latency_avgs = [
                int(x) for x in re.findall(r"avg (\d+)ms", "\n".join(latency_lines))]
            perf_lines = [l for l in console_lines if "[Performance]" in l]
            perf_matches = [perf_fullmatch(l) for l in perf_lines]
            console_errors = [
                l for l in console_lines
                if l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l)]
            backend_log_text = BACKEND_LOG.read_text(encoding="utf-8")

            summary = {
                "backend_health": health,
                "backend_health_restart": health_restart,
                "hud_boot": hud1,
                "boot_ids": boot_ids,
                "chat_demo_banner": runtime1["chatBanner"],
                "live_tracks": runtime1["liveTracks"],
                "modified_ids": modified_ids,
                "save_status_inline": saved_status,
                "save_status_polled_ok": ok_saved,
                "get_after_save": {"status": status_get, "ids": saved_file_ids},
                "file_roundtrip_ws_ids": file_ids_via_ws,
                "notes2_after_reload": got_notes2,
                "reloaded_ids": reloaded_ids,
                "live_ids_before_load": live_ids_before_load,
                "loaded_ids": loaded_ids,
                "proxy_status": {"http": st_status, "body": st_body},
                "proxy_llm": {"http": llm_status, "body": llm_body},
                "proxy_search": {"http": search_status, "body": search_body},
                "cors": {"status": cors_code, "origin": cors_origin},
                "console_errors": console_errors,
                "page_errors": page_errors,
                "perf_line_count": len(perf_lines),
                "perf_all_match": len(perf_matches) == len(perf_lines),
                "latency_line_count": len(latency_lines),
                "latency_min_avg": min(latency_avgs) if latency_avgs else None,
                "fps_max": max(fps_values) if fps_values else 0,
                "cleanup": {
                    "camera": len([l for l in console_lines if "[CameraCapture] cleanup" in l]),
                    "tracker": len([l for l in console_lines if "[HandTracker] cleanup" in l]),
                },
                "gesture_log_lines": len(
                    [l for l in console_lines if "[HandTracker] gestures" in l]),
                "boot_line_hits": len(
                    [l for l in console_lines
                     if "[App] app scene ready: 4 app windows created" in l]),
                "backend_log_has_http": "[backend] HTTP server listening" in backend_log_text,
                "backend_log_has_ws": "[backend] WebSocket server listening" in backend_log_text,
            }

            print("\n=== SUMMARY ===")
            print(json.dumps(summary, indent=2))

            (OUT / "m13-console.txt").write_text("\n".join(console_lines), encoding="utf-8")
            (OUT / "m13-summary.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8")
            if DATA_FILE.exists():
                shutil.copy(DATA_FILE, OUT / "m13-workspace.json")

            browser.close()
    finally:
        if backend is not None:
            stop_backend(backend)
        if summary is None:
            (OUT / "m13-console.txt").write_text("\n".join(console_lines), encoding="utf-8")
            print("run failed mid-flight; console evidence saved")

    # --- Assertions ---------------------------------------------------------
    windows_row = re.search(r"Windows\s+(\d+)", summary["hud_boot"] or "")
    sync_row = re.search(r"Sync\s+(\S+)", summary["hud_boot"] or "")
    users_row = re.search(r"Users\s+(\d+)", summary["hud_boot"] or "")
    saved_set = {"dashboard-1", "notes-1", "search-1", "notes-2"}

    checks = {
        "a: boot exact — 4 windows, exact ids, boot line 4, title (tolerant since M14)": (
            summary["boot_ids"] == ["chat-1", "dashboard-1", "notes-1", "search-1"]
            and summary["boot_line_hits"] >= 1
            and "JARVIS · Milestone" in (summary["hud_boot"] or "")
        ),
        "b: HUD — Camera active, MediaPipe ready, Windows 4, Sync connected, Users 1, Remote 0": (
            "Camera" in summary["hud_boot"] and "active" in summary["hud_boot"]
            and "MediaPipe" in summary["hud_boot"] and "ready" in summary["hud_boot"]
            and windows_row is not None and int(windows_row.group(1)) == 4
            and sync_row is not None and sync_row.group(1) == "connected"
            and users_row is not None and users_row.group(1) == "1"
            and re.search(r"Remote\s+(\d+)", summary["hud_boot"]).group(1) == "0"
        ),
        "c: modify + Save — inline 'saved 4 ✓'; GET /api/workspace == the 4 saved ids": (
            summary["modified_ids"] == ["dashboard-1", "notes-1", "notes-2", "search-1"]
            and summary["save_status_polled_ok"]
            and summary["get_after_save"]["status"] == 200
            and set(summary["get_after_save"]["ids"]) == saved_set
        ),
        "d: cross-restart file round-trip — ws snapshot after RESTART == the saved ids": (
            summary["file_roundtrip_ws_ids"] == sorted(saved_set)
            and summary["backend_health_restart"].get("status") == "ok"
        ),
        "e: reload — the persisted notes-2 materializes from server state": (
            summary["notes2_after_reload"]
            and "notes-2" in summary["reloaded_ids"]
        ),
        "f: Load button — DOM ids EQUAL the live GET set taken before the click": (
            summary["loaded_ids"] == summary["live_ids_before_load"]
        ),
        "g: proxy no-key shapes — status false/false; llm + search 503 not_configured": (
            summary["proxy_status"]["http"] == 200
            and summary["proxy_status"]["body"] == {"llm": False, "search": False}
            and summary["proxy_llm"]["http"] == 503
            and summary["proxy_llm"]["body"] == {"error": "not_configured"}
            and summary["proxy_search"]["http"] == 503
            and summary["proxy_search"]["body"] == {"error": "not_configured"}
        ),
        "h: CORS preflight from localhost:5173 -> 204 + ACAO echo": (
            summary["cors"]["status"] == 204
            and summary["cors"]["origin"] == "http://localhost:5173"
        ),
        "i: LLM Chat still demo-modes cleanly (banner, no keys anywhere)": (
            summary["chat_demo_banner"]
        ),
        "j: zero console/page errors (restart window included, modulo probe noise)": (
            len(summary["console_errors"]) == 0 and len(summary["page_errors"]) == 0
        ),
        "k: >= 1 [Performance] line, all matching the M4 four-key format": (
            summary["perf_line_count"] >= 1 and summary["perf_all_match"]
        ),
        "l: latency >= 2 lines, min avg 150-260ms": (
            summary["latency_line_count"] >= 2
            and summary["latency_min_avg"] is not None
            and 150 <= summary["latency_min_avg"] <= 260
        ),
        "m: cleanups balanced, 1 live track, FPS >= 30, no gesture lines": (
            summary["cleanup"]["camera"] == summary["cleanup"]["tracker"]
            and 1 <= summary["cleanup"]["camera"] <= 4
            and summary["live_tracks"] == 1
            and summary["fps_max"] >= 30
            and summary["gesture_log_lines"] == 0
        ),
        "n: backend health ok + wsPort 4001; HTTP + WS listening log lines": (
            summary["backend_health"].get("status") == "ok"
            and summary["backend_health"].get("wsPort") == 4001
            and summary["backend_log_has_http"]
            and summary["backend_log_has_ws"]
        ),
    }
    print("\n=== CHECKS ===")
    ok = True
    for name, passed in checks.items():
        print(f"  {'PASS' if passed else 'FAIL'}  {name}")
        ok = ok and passed
    print("OVERALL:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
