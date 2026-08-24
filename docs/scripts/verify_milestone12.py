"""JARVIS Milestone 12 browser verification (Playwright, fake webcam).

Boots the BACKEND (node dist/server.js subprocess) + the frontend dev
server, and verifies Phase 4 part 2 — multi-user hand visibility +
ownership-based conflict resolution — with TWO REAL PAGES (two browser
contexts, each its own app instance + ws connection) plus a python ws
client ("C") as a third user:
  a) Page A boots exact: 4 app windows (dashboard-1, notes-1, chat-1,
     search-1) all on screen, boot console line says 4, EXACT title pin
     "JARVIS · Milestone" (tolerant since M13; v13 owns the exact pin)
  b) Page A HUD: Camera active, MediaPipe ready, Windows = 4, Sync
     connected, Users = 1, Remote hands = 0
  c) Page B boots (second context): Sync connected, Users = 2 on BOTH
     pages; B renders the shared space with its own 4 boot windows (the
     snapshot's same-id copies are skipped-local, brief D4)
  d) Cross-page collaboration: A opens notes-2 via the launcher ->
     B's DOM gains [data-window-id="notes-2"] with a REMOTE owner badge
  e) Remote hands: ws user C sends handUpdate (1 hand x 21 landmarks) ->
     A's HUD Remote row flips 0 -> 1 ([data-testid="remote-hands"]),
     [Sync] handSync userId=<C> hands=1 logged, and back 1 -> 0 when C
     leaves (userLeft removes the user's hands)
  f) Remote apply: C upserts window holo-1 twice (two positions) ->
     A's holo-1 DOM element appears with a REMOTE badge and its projected
     left CHANGES between the two upserts (owner-mutates apply, D4)
  g) ownership UI: A's own dashboard-1 badge says YOU; remote materialized
     windows (notes-2 on B, holo-1 on A) say REMOTE (D10)
  h) zero console errors and zero page errors across BOTH pages (backend
     UP the whole run — not even the offline probe noise is expected;
     filtered with the same KNOWN_OFFLINE_NOISE gate for safety)
  i) >= 1 "[Performance]" line on A, every line in the M4 four-key format
  j) latency on A: >= 2 lines, min avg in 150-260ms, < 300ms
  k) per-page cleanup counts balanced (2 each — one StrictMode page load
     per page); exactly 1 live video track per page
  l) max logged FPS >= 30 on A; no gesture log lines (no hands on cam)
  m) backend /api/health ok with wsPort 4001 (OUR subprocess); backend
     log has the HTTP + WebSocket listening lines (D5 order)

Honest scope notes:
  (1) GRAB REJECTION (isEditable) cannot be driven by the fake webcam —
      no hands — it is unit-pinned (interactionEngine.test.ts M12 gate
      describe: grab start + continuation + mid-grab flip). The browser
      evidence here is the ownership UI + remote apply.
  (2) C's synthetic hand has 21 landmarks so the indicator/manager math
      is the real one (1 hand), but visually the spheres are behind the
      frosted windows — the [data-testid="remote-hands"] count and the
      [Sync] log are the observable hooks (brief D8).
  (3) boot-window same-id snapshots: A and B each keep their OWN local
      windows (first-creator-wins keeps the old owner server-side; the
      local view wins locally, brief D4) — the cross-page proof is the
      UNIQUE-id window notes-2 plus C's holo-1.
  (4) v12 manages the backend subprocess itself and requires
      `npm run build:backend` beforehand (dist/server.js must exist).

Usage: python verify_milestone12.py [base_url]
Evidence (m12-page-a/b/collab.png, m12-console-a/b.txt, m12-summary.json,
m12-backend.log) is written to docs/screenshots/.
"""
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

try:
    import websocket as ws_client  # websocket-client 1.9.0 (sync)
except ImportError:
    print("verify_milestone12: the 'websocket-client' python package is required")
    sys.exit(2)

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
REPO = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = REPO / "apps" / "backend"
BACKEND_ENTRY = BACKEND_DIR / "dist" / "server.js"
if not BACKEND_ENTRY.exists():
    print("verify_milestone12: apps/backend/dist/server.js missing — run `npm run build:backend` first")
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
BACKEND_LOG = OUT / "m12-backend.log"

HEALTH_URL = "http://localhost:4000/api/health"
WS_URL = "ws://localhost:4001"

# Per-page console capture (latency/FPS/evidence must be attributable).
console_a: list[str] = []
console_b: list[str] = []
errors_a: list[str] = []
errors_b: list[str] = []

PERF_LINE_PATTERN = re.compile(
    r"\[Performance\] handDetectionLatency=(\d+)ms renderFPS=(\d+) "
    r"gestureRecognitionLatency=(\d+(?:\.\d+)?)ms "
    r"interactionLatency=(\d+(?:\.\d+)?)ms"
)

# Same documented filter as every other verifier (D4b) — with the backend
# UP nothing should match it; keeping the gate identical is the safety.
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


def hud_runtime(page) -> dict:
    return page.evaluate(
        """() => {
          const allDivs = [...document.querySelectorAll('div')];
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
          const remote = document.querySelector('[data-testid="remote-hands"]');
          const windows = [...document.querySelectorAll(
            '[data-testid="floating-window"]')].map((el) => ({
              id: el.getAttribute('data-window-id'),
              badge: el.querySelector('[data-testid="window-owner-badge"]')?.innerText ?? null,
              left: el.style.left || null,
            }));
          const videos = [...document.querySelectorAll('video')];
          const video = videos[0] || null;
          const tracks = video && video.srcObject ? video.srcObject.getTracks() : [];
          return {
            hudText: hud ? hud.innerText : null,
            remoteHands: remote ? remote.innerText : null,
            windows,
            liveTracks: tracks.filter(t => t.readyState === 'live').length,
          };
        }"""
    )


def window_entry(runtime: dict, window_id: str):
    return next(
        (w for w in runtime["windows"] if w["id"] == window_id), None)


def poll_until(page, js_expr: str, want, timeout_s: float = 6.0):
    """Polls a page.evaluate expression until it equals `want`."""
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

            # --- Phase 1: page A boots (backend UP) ----------------------
            context_a = browser.new_context(viewport={"width": 1280, "height": 800})
            page_a = context_a.new_page()
            page_a.on("console", lambda m: console_a.append(f"[{m.type}] {m.text}"))
            page_a.on("pageerror", lambda e: errors_a.append(str(e)))
            print(f"navigating A to {BASE_URL}")
            page_a.goto(BASE_URL, wait_until="domcontentloaded")
            page_a.wait_for_timeout(14000)
            runtime_a1 = hud_runtime(page_a)
            print("runtime A#1:", json.dumps(runtime_a1, indent=2))

            # --- Phase 2: page B boots (SECOND context) ------------------
            context_b = browser.new_context(viewport={"width": 1280, "height": 800})
            page_b = context_b.new_page()
            page_b.on("console", lambda m: console_b.append(f"[{m.type}] {m.text}"))
            page_b.on("pageerror", lambda e: errors_b.append(str(e)))
            page_b.goto(BASE_URL, wait_until="domcontentloaded")
            page_b.wait_for_timeout(14000)
            runtime_b1 = hud_runtime(page_b)
            print("runtime B#1:", json.dumps(runtime_b1, indent=2))
            # A's Users row should now read 2 (userJoined from B's connect).
            ok_users_a2, users_a2 = poll_until(
                page_a,
                "() => document.body.innerText.match(/Users\\s+(\\d+)/)?.[1]",
                "2", timeout_s=5)
            page_a.screenshot(path=str(OUT / "m12-page-a.png"))

            # --- Phase 3: A opens notes-2 -> B must materialize it ------
            page_a.evaluate(
                """() => {
                  const el = document.querySelector(
                    '[data-window-id="dashboard-1"] [data-testid="launcher-open-notes"]');
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            got_notes2, _ = poll_until(
                page_b,
                "() => document.querySelector('[data-window-id=\\\"notes-2\\\"]') ? 'yes' : 'no'",
                "yes", timeout_s=6)
            page_b.wait_for_timeout(800)  # let the projection loop settle
            runtime_b2 = hud_runtime(page_b)

            # --- Phase 4: ws user C — remote hands ----------------------
            remote_before = runtime_a1["remoteHands"]
            c = ws_client.create_connection(WS_URL, timeout=5)
            snapshot_c = None
            c.settimeout(3)
            try:
                snapshot_c = json.loads(c.recv())  # stateSnapshot
            except Exception:  # noqa: BLE001 - not asserted on
                snapshot_c = None
            # The [Sync] logger has a SHARED 1 s throttle (M11 D6): C's
            # connect just logged userJoined, which would swallow the first
            # handSync line. Wait the window out, then drive hands.
            time.sleep(1.3)
            landmarks = [
                {"x": round(0.1 + i * 0.03, 3), "y": round(0.8 - i * 0.02, 3),
                 "z": round(-0.05, 3)}
                for i in range(21)
            ]
            one_hand = {"handedness": "Right", "landmarks": landmarks,
                        "confidence": 0.9}
            for _ in range(8):
                c.send(json.dumps({"type": "handUpdate", "data": {"hands": [one_hand]}}))
                time.sleep(0.1)
            ok_remote_1, remote_a_with_c = poll_until(
                page_a,
                "() => document.querySelector('[data-testid=\"remote-hands\"]')?.innerText",
                "1", timeout_s=5)
            ok_remote_b1, _ = poll_until(
                page_b,
                "() => document.querySelector('[data-testid=\"remote-hands\"]')?.innerText",
                "1", timeout_s=5)
            handsync_lines = [l for l in console_a if "[Sync] handSync" in l]
            page_a.screenshot(path=str(OUT / "m12-collab.png"))

            # --- Phase 5: C's window holo-1, upserted twice (a move) ----
            def holo_upsert(x: float) -> None:
                c.send(json.dumps({
                    "type": "windowUpsert",
                    "data": {
                        "id": "holo-1", "title": "Holo", "owner": "",
                        "position": [x, 0.2, -0.8],
                        "rotationY": 0.2, "scale": 1.5, "zIndex": 30,
                        "lastModified": time.time() * 1000,
                    },
                }))

            holo_upsert(0.6)
            got_holo, _ = poll_until(
                page_a,
                "() => document.querySelector('[data-window-id=\\\"holo-1\\\"]') ? 'yes' : 'no'",
                "yes", timeout_s=6)
            page_a.wait_for_timeout(700)
            left_1 = page_a.evaluate(
                "() => document.querySelector('[data-window-id=\\\"holo-1\\\"]')?.style.left")
            holo_upsert(-0.9)
            page_a.wait_for_timeout(900)
            left_2 = page_a.evaluate(
                "() => document.querySelector('[data-window-id=\\\"holo-1\\\"]')?.style.left")
            runtime_a2 = hud_runtime(page_a)

            # --- Phase 6: C leaves --------------------------------------
            ok_users_a3, users_a_with_c = poll_until(
                page_a,
                "() => document.body.innerText.match(/Users\\s+(\\d+)/)?.[1]",
                "3", timeout_s=5)
            c.close()
            ok_users_a2b, users_a_after_c = poll_until(
                page_a,
                "() => document.body.innerText.match(/Users\\s+(\\d+)/)?.[1]",
                "2", timeout_s=6)
            ok_remote_0, remote_a_after_c = poll_until(
                page_a,
                "() => document.querySelector('[data-testid=\"remote-hands\"]')?.innerText",
                "0", timeout_s=6)
            user_left_lines = [l for l in console_a if "[Sync] userLeft" in l]
            page_b.screenshot(path=str(OUT / "m12-page-b.png"))
            final_b = hud_runtime(page_b)

            # --- Summary ------------------------------------------------
            fps_values = [
                int(x) for x in re.findall(r"\[Scene3D\] FPS: (\d+)", "\n".join(console_a))]
            latency_lines = [l for l in console_a if "detection latency" in l]
            latency_avgs = [
                int(x) for x in re.findall(r"avg (\d+)ms", "\n".join(latency_lines))]
            perf_lines = [l for l in console_a if "[Performance]" in l]
            perf_matches = [perf_fullmatch(l) for l in perf_lines]
            boot_line_hits = [
                l for l in console_a
                if "[App] app scene ready: 4 app windows created" in l]
            errors_clean = all(
                not (l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l))
                for l in console_a + console_b
            ) and not errors_a and not errors_b
            backend_log_text = BACKEND_LOG.read_text(encoding="utf-8")

            badge_you_a = (window_entry(runtime_a1, "dashboard-1") or {}).get("badge")
            badge_remote_b = (window_entry(runtime_b2, "notes-2") or {}).get("badge")
            badge_remote_holo = (window_entry(runtime_a2, "holo-1") or {}).get("badge")

            summary = {
                "backend_health": health,
                "hud_a_boot": runtime_a1["hudText"],
                "hud_b_boot": runtime_b1["hudText"],
                "a_window_ids_boot": sorted(w["id"] for w in runtime_a1["windows"]),
                "b_window_ids_boot": sorted(w["id"] for w in runtime_b1["windows"]),
                "users_a_after_b": users_a2,
                "users_a_poll_after_b_ok": ok_users_a2,
                "b_has_notes2": got_notes2,
                "b_notes2_badge": badge_remote_b,
                "remote_before": remote_before,
                "remote_a_with_c": remote_a_with_c,
                "remote_b_with_c": ok_remote_b1,
                "handsync_lines_a": handsync_lines,
                "users_a_with_c": users_a_with_c,
                "users_a_with_c_poll_ok": ok_users_a3,
                "users_a_after_c": users_a_after_c,
                "remote_a_after_c": remote_a_after_c,
                "user_left_lines_a": user_left_lines,
                "a_holo1_present": got_holo,
                "a_holo1_left_first": left_1,
                "a_holo1_left_second": left_2,
                "a_holo1_left_changed": bool(left_1) and bool(left_2) and left_1 != left_2,
                "a_holo1_badge": badge_remote_holo,
                "a_dashboard1_badge": badge_you_a,
                "errors_clean": errors_clean,
                "console_errors_a": [l for l in console_a if l.startswith("[error]")],
                "console_errors_b": [l for l in console_b if l.startswith("[error]")],
                "page_errors": errors_a + errors_b,
                "perf_line_count": len(perf_lines),
                "perf_all_match": len(perf_matches) == len(perf_lines),
                "latency_line_count": len(latency_lines),
                "latency_min_avg": min(latency_avgs) if latency_avgs else None,
                "fps_max": max(fps_values) if fps_values else 0,
                "gesture_log_lines": [l for l in console_a if "[HandTracker] gestures" in l],
                "live_tracks_a": runtime_a1["liveTracks"],
                "live_tracks_b": runtime_b1["liveTracks"],
                "cleanup_a": {
                    "camera": len([l for l in console_a if "[CameraCapture] cleanup" in l]),
                    "tracker": len([l for l in console_a if "[HandTracker] cleanup" in l]),
                },
                "cleanup_b": {
                    "camera": len([l for l in console_b if "[CameraCapture] cleanup" in l]),
                    "tracker": len([l for l in console_b if "[HandTracker] cleanup" in l]),
                },
                "boot_line_hits": len(boot_line_hits),
                "backend_log_has_http": "[backend] HTTP server listening" in backend_log_text,
                "backend_log_has_ws": "[backend] WebSocket server listening" in backend_log_text,
                "c_snapshot_users": len(snapshot_c["data"]["users"]) if snapshot_c else None,
                "final_b_window_ids": sorted(w["id"] for w in final_b["windows"]),
            }

            print("\n=== SUMMARY ===")
            print(json.dumps(summary, indent=2))

            (OUT / "m12-console-a.txt").write_text(
                "\n".join(console_a), encoding="utf-8")
            (OUT / "m12-console-b.txt").write_text(
                "\n".join(console_b), encoding="utf-8")
            (OUT / "m12-summary.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8")

            browser.close()
    finally:
        if backend is not None:
            stop_backend(backend)
        if summary is None:
            (OUT / "m12-console-a.txt").write_text(
                "\n".join(console_a), encoding="utf-8")
            (OUT / "m12-console-b.txt").write_text(
                "\n".join(console_b), encoding="utf-8")
            print("run failed mid-flight; console evidence saved")

    # --- Assertions ---------------------------------------------------------
    hud_a = summary["hud_a_boot"] or ""
    windows_row = re.search(r"Windows\s+(\d+)", hud_a)
    sync_row = re.search(r"Sync\s+(\S+)", hud_a)
    users_row = re.search(r"Users\s+(\d+)", hud_a)
    hud_b = summary["hud_b_boot"] or ""
    sync_row_b = re.search(r"Sync\s+(\S+)", hud_b)

    checks = {
        "a: page A boot exact — 4 windows, exact ids, boot line 4, title (tolerant since M13)": (
            summary["a_window_ids_boot"] == ["chat-1", "dashboard-1", "notes-1", "search-1"]
            and summary["boot_line_hits"] >= 1
            and "JARVIS · Milestone" in hud_a
        ),
        "b: page A HUD — Camera active, MediaPipe ready, Windows 4, Sync connected, Users 1, Remote 0": (
            "Camera" in hud_a and "active" in hud_a
            and "MediaPipe" in hud_a and "ready" in hud_a
            and windows_row is not None and int(windows_row.group(1)) == 4
            and sync_row is not None and sync_row.group(1) == "connected"
            and users_row is not None and users_row.group(1) == "1"
            and summary["remote_before"] == "0"
        ),
        "c: page B boots (second context) — Sync connected, own 4 boot windows, A Users -> 2": (
            sync_row_b is not None and sync_row_b.group(1) == "connected"
            and summary["b_window_ids_boot"] == ["chat-1", "dashboard-1", "notes-1", "search-1"]
            and summary["users_a_after_b"] == "2"
        ),
        "d: cross-page — A opens notes-2, B's DOM gains it with REMOTE badge": (
            summary["b_has_notes2"]
            and summary["b_notes2_badge"] == "◈ REMOTE"
        ),
        "e: remote hands — C's handUpdate flips A's Remote row 0->1 (+B 1), [Sync] handSync logged": (
            summary["remote_a_with_c"] == "1"
            and summary["remote_b_with_c"] is True
            and len(summary["handsync_lines_a"]) > 0
            and "hands=1" in summary["handsync_lines_a"][-1]
        ),
        "f: remote apply — C's holo-1 upserted twice: A's element present, left CHANGED, REMOTE badge": (
            summary["a_holo1_present"]
            and summary["a_holo1_left_changed"]
            and summary["a_holo1_badge"] == "◈ REMOTE"
        ),
        "g: ownership UI — A's own dashboard-1 badge is YOU": (
            summary["a_dashboard1_badge"] == "◈ YOU"
        ),
        "h: C leaves — A Users 3->2 (3 while C connected), Remote row back to 0, userLeft logged": (
            summary["users_a_with_c"] == "3"
            and summary["users_a_after_c"] == "2"
            and summary["remote_a_after_c"] == "0"
            and len(summary["user_left_lines_a"]) >= 1
        ),
        "i: zero console/page errors across BOTH pages (backend up)": (
            summary["errors_clean"]
        ),
        "j: >= 1 [Performance] line on A, all matching the M4 four-key format": (
            summary["perf_line_count"] >= 1 and summary["perf_all_match"]
        ),
        "k: latency on A — >= 2 lines, min avg 150-260ms": (
            summary["latency_line_count"] >= 2
            and summary["latency_min_avg"] is not None
            and 150 <= summary["latency_min_avg"] <= 260
        ),
        "l: per-page cleanups balanced (1/1 each — one StrictMode load per page), 1 live track per page": (
            summary["cleanup_a"]["camera"] == 1
            and summary["cleanup_a"]["tracker"] == 1
            and summary["cleanup_b"]["camera"] == 1
            and summary["cleanup_b"]["tracker"] == 1
            and summary["live_tracks_a"] == 1
            and summary["live_tracks_b"] == 1
        ),
        "m: max logged FPS >= 30 on A; no gesture log lines": (
            summary["fps_max"] >= 30
            and len(summary["gesture_log_lines"]) == 0
        ),
        "n: backend health ok + wsPort 4001; HTTP-before-WS log lines (D5)": (
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
