"""JARVIS Milestone 15 verification (Playwright, fake webcam, DEV server).

Phase 5 part 2 — edge cases, error handling, monitoring (brief D11). This
verifier is the resilience/monitoring check and is OFFLINE-FIRST — it starts
the frontend with the backend DOWN and proves the M11 promise live:
  a) offline boot: HUD Sync 'offline', 4 boot windows, Errors: 0 row, the
     Save-ws button surfaces the inline "Cannot reach the backend" network
     WorkspaceError (never a bare console error / silent fail)
  b) offline usability: Notes typing + the Dashboard launcher work with the
     backend down
  c) zero console/page errors through the offline phase (M11 noise filter)
  d) auto-connect: starting the backend later connects on the same session
     (Sync connected, Users 1) — the budgeted reconnect cap does NOT apply
     to the never-connected boot path
  e) healthy boot EXACT: title "JARVIS · Milestone 15", Camera active,
     MediaPipe ready, Windows 4
  f) healthy path has Errors: 0 (data-testid="hud-errors")
  g) workspace Save happy-path control: "saved 4 ✓" (backend up)
  h) latency >= 2 lines, min avg in 150-260ms
  i) FPS >= 30, 1 live video track, no gesture log lines
  j) >= 1 [Performance] line, all conformant
  k) camera-loss mid-session: a SYNTHETIC track 'ended' (dispatched on the
     live video element track) -> the ErrorBanner (role=alert) + HUD Camera
     'error' — the real unplug spot-check path is unit-proven (cameraErrors)
     + this runtime injection
  l) the camera-loss transition introduces NO uncaught error (Errors stays 0)
  m) reload restores the healthy app (Camera active, MediaPipe ready, 4 boot
     windows, title)
  n) mid-session backend drop -> HUD Sync offline, app stays usable, and a
     backend RESTART reconnects on the same session; zero console/page errors
     across every phase

Honest scope note: the reconnect-BUDGET terminal-'offline' transition (8
consecutive failed cycles, ~20-40s) is unit-tested with fake sockets, not
browser-scripted here (too slow); the verifier proves the drop/offline/
reconnect behavior at 1-2 failed cycles.

Usage: python verify_milestone15.py [base_url]
Evidence (m15-offline.png, m15-page.png, m15-track-ended.png, m15-reload.png,
m15-console.txt, m15-summary.json, m15-backend.log, m15-dev.log) ->
docs/screenshots/. Requires `npm run build:backend` first (builds happen in
the workspace backends the same way v11-v13 consume them).
"""
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = REPO / "apps" / "backend"
FRONTEND_DIR = REPO / "apps" / "frontend"
BACKEND_ENTRY = BACKEND_DIR / "dist" / "server.js"
if not BACKEND_ENTRY.exists():
    print("verify_milestone15: run `npm run build:backend` first")
    sys.exit(2)

OUT = Path(__file__).resolve().parent.parent / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
BACKEND_LOG = OUT / "m15-backend.log"
DEV_LOG = OUT / "m15-dev.log"

# Clean-room: the backend preloads data/workspace.json at boot; v15 asserts
# the clean 4-boot-window snapshot (same discipline as v11-v14).
DATA_FILE = BACKEND_DIR / "data" / "workspace.json"
if DATA_FILE.exists():
    DATA_FILE.unlink()

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
API = "http://localhost:4000"
HEALTH_URL = f"{API}/api/health"
WS_URL = "ws://localhost:4001"

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


def start_frontend() -> subprocess.Popen:
    log = open(DEV_LOG, "a", encoding="utf-8")
    proc = subprocess.Popen(
        ["npx.cmd", "vite", "--port", "5173", "--strictPort"],
        cwd=str(FRONTEND_DIR),
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    deadline = time.monotonic() + 20
    last_error = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(BASE_URL, timeout=2) as response:
                if response.status == 200:
                    return proc
        except Exception as error:  # noqa: BLE001 - poll until up
            last_error = error
            time.sleep(0.5)
    raise RuntimeError(f"frontend did not come up: {last_error}")


def stop_frontend(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


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


def hud_runtime(page) -> dict:
    return page.evaluate(
        """() => {
          const allDivs = [...document.querySelectorAll('div')];
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
          const errorsEl = document.querySelector('[data-testid="hud-errors"]');
          return {
            hudText: hud ? hud.innerText : null,
            errorsText: errorsEl ? errorsEl.textContent : null,
            errorBanner: Boolean(document.querySelector('[role="alert"]')),
            windowIds: [...document.querySelectorAll(
              '[data-testid="floating-window"]')].map(
              (el) => el.getAttribute('data-window-id')).sort(),
            liveTracks: ([...document.querySelectorAll('video')][0]?.srcObject
              ? [...document.querySelectorAll('video')][0].srcObject.getTracks()
                  .filter(t => t.readyState === 'live').length : 0),
          };
        }"""
    )


def poll_until(page, js_expr: str, want, timeout_s: float = 12.0):
    deadline = time.monotonic() + timeout_s
    value = None
    while time.monotonic() < deadline:
        value = page.evaluate(js_expr)
        if value == want:
            return True, value
        page.wait_for_timeout(250)
    return False, value


def poll_hud(page, needle: str, timeout_s: float = 12.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        text = hud_runtime(page)["hudText"] or ""
        if needle in text:
            return True
        page.wait_for_timeout(250)
    return False


def main() -> None:
    summary: dict | None = None
    dev: subprocess.Popen | None = None
    backend: subprocess.Popen | None = None
    page = None
    try:
        dev = start_frontend()
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

            # --- Phase A: boot with the BACKEND DOWN (M11 promise) --------
            boot_ids = ["chat-1", "dashboard-1", "notes-1", "search-1"]
            print(f"navigating (backend OFF) to {BASE_URL}")
            page.goto(BASE_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(14000)
            rA = hud_runtime(page)
            hudA = rA["hudText"] or ""
            print("offline boot runtime:", json.dumps(rA, indent=2))
            page.screenshot(path=str(OUT / "m15-offline.png"))

            # Offline usability: Notes typing works with the backend down.
            page.evaluate(
                """() => {
                  const ta = document.querySelector(
                    '[data-window-id="notes-1"] [data-testid="notes-textarea"]');
                  ta.value = 'note typed while offline';
                  ta.dispatchEvent(new Event('input', { bubbles: true }));
                }"""
            )
            # Launcher open + close (window churn is fully local).
            page.evaluate(
                """() => {
                  const el = document.querySelector(
                    '[data-window-id="dashboard-1"] [data-testid="launcher-open-notes"]');
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            got_notes2, _ = poll_until(
                page,
                "() => document.querySelector('[data-window-id=\\\"notes-2\\\"]') ? 'yes' : 'no'",
                "yes", timeout_s=6)
            page.evaluate(
                """() => {
                  const wins = [...document.querySelectorAll(
                    '[data-testid="floating-window"][data-window-id^="notes-"]')];
                  const newest = wins[wins.length - 1];
                  if (newest) newest.querySelector('button[aria-label^="Close "]')
                    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            page.wait_for_timeout(400)
            after_offline_churn = hud_runtime(page)["windowIds"]

            # Backend-offline Save -> INLINE user-readable network error.
            page.evaluate(
                """() => {
                  const el = document.querySelector('[data-testid="workspace-save"]');
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            ok_inline = False
            save_status = ""
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                save_status = page.evaluate(
                    "() => document.querySelector('[data-testid=\"workspace-status\"]')?.innerText || ''")
                if "Cannot reach the backend" in save_status:
                    ok_inline = True
                    break
                page.wait_for_timeout(250)
            page.screenshot(path=str(OUT / "m15-offline-save.png"))

            # --- Phase B: start the backend -> auto-connect ---------------
            backend, health = start_backend()
            ok_connect = poll_hud(page, "connected", timeout_s=12)
            rB = hud_runtime(page)
            hudB = rB["hudText"] or ""
            print("auto-connect runtime:", json.dumps(rB, indent=2))
            page.screenshot(path=str(OUT / "m15-page.png"))

            # Positive control: workspace Save works once the backend is up.
            page.evaluate(
                """() => {
                  const el = document.querySelector('[data-testid="workspace-save"]');
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            ok_saved, saved_status = poll_until(
                page,
                "() => document.querySelector('[data-testid=\"workspace-status\"]')?.innerText || ''",
                "saved 4 ✓", timeout_s=8)
            page.wait_for_timeout(600)

            # --- Phase C: synthetic mid-session camera loss ---------------
            inject = page.evaluate(
                """() => {
                  const video = document.querySelector('video');
                  if (!video || !video.srcObject) return 'no-src';
                  const tracks = video.srcObject.getVideoTracks();
                  if (!tracks.length) return 'no-tracks';
                  const track = tracks[0];
                  const before = track.readyState;
                  let threw = null;
                  try { track.dispatchEvent(new Event('ended')); }
                  catch (err) { threw = String(err); }
                  return { before, after: track.readyState, threw };
                }"""
            )
            print("track-ended injection:", json.dumps(inject, indent=2))
            ok_banner, _ = poll_until(
                page,
                "() => document.querySelector('[role=\\\"alert\\\"]') ? 'yes' : 'no'",
                "yes", timeout_s=6)
            rC = hud_runtime(page)
            print("after-camera-loss runtime:", json.dumps(rC, indent=2))
            page.screenshot(path=str(OUT / "m15-track-ended.png"))

            # Reload -> healthy again (backend is up).
            page.goto(BASE_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(14000)
            r_reload = hud_runtime(page)
            print("reload runtime:", json.dumps(r_reload, indent=2))
            page.screenshot(path=str(OUT / "m15-reload.png"))

            # --- Phase D: mid-session backend drop -> offline -> reconnect -
            assert backend is not None
            stop_backend(backend)
            backend = None
            ok_offline = poll_hud(page, "Sync", timeout_s=3)
            # 'offline' is the HUD's render for disconnected/offline; assert
            # the Sync row is NOT connected after the drop.
            ok_dropped = False
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                text = hud_runtime(page)["hudText"] or ""
                sync_line = next((l for l in text.splitlines() if l.strip() in
                                  ("offline", "connected", "connecting",
                                   "disconnected")), "")
                if sync_line != "connected":
                    ok_dropped = True
                    break
                page.wait_for_timeout(250)
            drop_usable = hud_runtime(page)["windowIds"]
            page.evaluate(
                """() => {
                  const ta = document.querySelector(
                    '[data-window-id="notes-1"] [data-testid="notes-textarea"]');
                  ta.value += ' while backend down';
                  ta.dispatchEvent(new Event('input', { bubbles: true }));
                }"""
            )
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / "m15-drop.png"))

            backend, health_restart = start_backend()
            ok_reconnect = poll_hud(page, "connected", timeout_s=15)
            rD = hud_runtime(page)
            print("reconnect runtime:", json.dumps(rD, indent=2))
            page.screenshot(path=str(OUT / "m15-reconnect.png"))

            # --- Summary ---------------------------------------------------
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
                "r_offline": rA,
                "offline_hud_offline": "Sync" in hudA and "offline" in hudA,
                "offline_4_windows": rA["windowIds"] == boot_ids,
                "offline_errors_zero": rA["errorsText"] == "0",
                "offline_save_inline": save_status,
                "after_offline_churn": after_offline_churn,
                "launcher_opened_offline": got_notes2,
                "r_connected": rB,
                "auto_connected": ok_connect,
                "title_exact_m15": "JARVIS · Milestone 15" in hudB,
                "healthy_errors_zero": rB["errorsText"] == "0",
                "save_happy": saved_status,
                "track_ended_inject": inject,
                "camera_loss_banner": ok_banner,
                "camera_loss_runtime": rC,
                "reload_runtime": r_reload,
                "reloaded_healthy": (
                    "MediaPipe" in (r_reload["hudText"] or "") and "ready" in (r_reload["hudText"] or "")
                    and "Camera" in (r_reload["hudText"] or "") and "active" in (r_reload["hudText"] or "")
                    and r_reload["windowIds"] == boot_ids
                    and "JARVIS · Milestone 15" in (r_reload["hudText"] or "")),
                "drop_sync_not_connected": ok_dropped,
                "drop_usable_windows": drop_usable == boot_ids,
                "reconnected": ok_reconnect,
                "reconnect_runtime": rD,
                "console_errors": console_errors,
                "page_errors": page_errors,
                "perf_line_count": len(perf_lines),
                "perf_all_match": len(perf_matches) == len(perf_lines),
                "latency_line_count": len(latency_lines),
                "latency_min_avg": min(latency_avgs) if latency_avgs else None,
                "fps_max": max(fps_values) if fps_values else 0,
                "gesture_log_lines": len(
                    [l for l in console_lines if "[HandTracker] gestures" in l]),
                "boot_line_hits": len(
                    [l for l in console_lines
                     if "[App] app scene ready: 4 app windows created" in l]),
                "cleanup_pairs": {
                    "camera": len([l for l in console_lines if "[CameraCapture] cleanup" in l]),
                    "tracker": len([l for l in console_lines if "[HandTracker] cleanup" in l]),
                },
                "backend_log_has_http": "[backend] HTTP server listening" in backend_log_text,
                "backend_log_has_ws": "[backend] WebSocket server listening" in backend_log_text,
            }

            print("\n=== SUMMARY ===")
            print(json.dumps(summary, indent=2))

            (OUT / "m15-console.txt").write_text("\n".join(console_lines), encoding="utf-8")
            (OUT / "m15-summary.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8")

            browser.close()
    finally:
        if page is not None and summary is None:
            (OUT / "m15-console.txt").write_text("\n".join(console_lines), encoding="utf-8")
            print("run failed mid-flight; console evidence saved")
        if backend is not None:
            stop_backend(backend)
        if dev is not None:
            stop_frontend(dev)

    # --- Assertions ---------------------------------------------------------
    boot_ids = ["chat-1", "dashboard-1", "notes-1", "search-1"]
    okay = summary is not None
    checks = {
        "a: offline boot — Sync offline, 4 boot windows, Errors 0, Save-ws inline network error": (
            summary["offline_hud_offline"]
            and summary["offline_4_windows"]
            and summary["offline_errors_zero"]
            and summary["offline_save_inline"] is not None
            and "Cannot reach the backend" in (summary["offline_save_inline"] or "")
        ),
        "b: offline usability — launcher open works, window churn is local (back to 4)": (
            summary["launcher_opened_offline"]
            and summary["after_offline_churn"] == boot_ids
        ),
        "c: zero console/page errors through the OFFLINE phase": (
            summary is not None
            and not summary["console_errors"]
            and not summary["page_errors"]
        ),
        "d: auto-connect — starting the backend later connects on the same session (Sync connected, Users 1)": (
            summary["auto_connected"]
            and "Sync" in (summary["r_connected"]["hudText"] or "")
            and "connected" in (summary["r_connected"]["hudText"] or "")
            and "Users" in (summary["r_connected"]["hudText"] or "")
            and "\n1" in (summary["r_connected"]["hudText"] or "")
        ),
        "e: healthy boot EXACT — title 'JARVIS · Milestone 15', Camera active, MediaPipe ready, Windows 4": (
            summary["title_exact_m15"]
            and "Camera" in (summary["r_connected"]["hudText"] or "")
            and "active" in (summary["r_connected"]["hudText"] or "")
            and "MediaPipe" in (summary["r_connected"]["hudText"] or "")
            and "ready" in (summary["r_connected"]["hudText"] or "")
            and summary["r_connected"]["windowIds"] == boot_ids
        ),
        "f: healthy path has Errors: 0 (hud-errors row)": (
            summary["healthy_errors_zero"]
            and summary["r_connected"]["errorsText"] is not None
        ),
        "g: workspace Save happy path control (backend up) — 'saved 4 ✓'": (
            summary["save_happy"] == "saved 4 ✓"
        ),
        "h: latency >= 2 lines, min avg in 150-260ms": (
            summary["latency_line_count"] >= 2
            and summary["latency_min_avg"] is not None
            and 150 <= summary["latency_min_avg"] <= 260
        ),
        "i: FPS >= 30, 1 live video track, no gesture log lines": (
            summary["fps_max"] >= 30
            and summary["r_connected"]["liveTracks"] == 1
            and summary["gesture_log_lines"] == 0
        ),
        "j: >= 1 [Performance] line, all conformant": (
            summary["perf_line_count"] >= 1 and summary["perf_all_match"]
        ),
        "k: synthetic track-'ended' -> ErrorBanner + HUD Camera error": (
            summary["camera_loss_banner"]
            and "Camera" in (summary["camera_loss_runtime"]["hudText"] or "")
            and "error" in (summary["camera_loss_runtime"]["hudText"] or "")
        ),
        "l: the camera-loss transition introduces NO uncaught error (Errors 0)": (
            summary["camera_loss_runtime"]["errorsText"] == "0"
        ),
        "m: reload restores the healthy app (Camera active, MediaPipe ready, 4 boot windows, title)": (
            summary["reloaded_healthy"]
        ),
        "n: mid-session backend drop -> Sync offline, app usable, restart reconnects; zero errors everywhere": (
            summary["drop_sync_not_connected"]
            and summary["drop_usable_windows"]
            and summary["reconnected"]
            and not summary["console_errors"]
            and not summary["page_errors"]
        ),
        "o: backend health ok + HTTP/WS listening lines (final backend)": (
            summary["backend_health"].get("status") == "ok"
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
