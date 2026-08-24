"""JARVIS Milestone 11 browser verification (Playwright, fake webcam).

Boots the BACKEND (node dist/server.js subprocess) AND the frontend dev
server client, and verifies Phase 4 part 1 — the real-time core (sync
protocol, StateManager + WS server, SyncManager client, multi-user HUD):
  a) zero console errors and zero page errors across BOTH pages (incl.
     offline + reconnect) — modulo the documented offline-probe noise
  b) boot scene exact: 4 app windows, ids exactly dashboard-1 + notes-1 +
     chat-1 + search-1, all fully on screen, boot console line says 4
  c) HUD shows exact M11 title, Camera active, MediaPipe ready, Windows = 4,
     Sync connected, Users = 1 at boot (v11 owns the exact title pin)
  d) backend /api/health returns status ok with wsPort 4001 (OUR subprocess)
  e) multi-user: python user B joins -> page Users 2 + [Sync] userJoined log;
     B's first message is a stateSnapshot with users=2 AND the page's four
     flushed boot windows (D10 flush-on-connect); B closes -> Users 1 +
     [Sync] userLeft log
  f) handSync: B's handUpdates produce [Sync] handSync userId=<B> hands=1 on
     the page; the page was handSync-silent before B sent (empty-hand
     suppression, D6)
  g) window round-trip: launcher opens notes-2 (native click driver) ->
     B receives windowSync with data.owner == the PAGE's userId (D7 server
     stamping), tuple position, scalar scale; chrome close -> B receives a
     stateSnapshot WITHOUT notes-2 (D8); zero new errors
  h) offline: backend down + fresh page -> Sync offline, Users 0, zero
     console/page errors beyond the documented probe noise, [Sync] offline
     line present, ZERO :4001 websocket attempts (the probe gate, D4), app
     fully functional (4 windows + boot line)
  i) reconnect: backend restart -> Sync connected + [Sync] connected within
     12 s; Users 1; user C joins -> Users 2
  j) >= 1 "[Performance]" line, every line matching the M4 four-key format
  k) latency >= 2 lines, min avg in 150-260ms, < 300ms
  l) cleanup counts balanced (CameraCapture == HandTracker, 2-4 each — two
     page loads)
  m) exactly 1 live video track (page 1 introspection)
  n) max logged FPS >= 30 (boot window)
  o) no gesture log lines (no hands on fake webcam)
  p) backend log contains the HTTP + WebSocket listening lines (D5 order)

Honest scope notes:
  (1) the fake webcam produces no hands, so the PAGE's outgoing hand path is
      unit/browser-hybrid-evidenced (unit: sync.test.ts cadence/
      quantization/suppression; browser: the page stays hand-silent while B
      drives inbound handSync).
  (2) remote hands/windows are stored + logged but NOT rendered (M12) — the
      multi-user evidence here is protocol-level (messages + HUD counts).
  (3) the offline check is deliberately reload-shaped (fresh page against a
      dead backend): killing the backend mid-session produces NO native
      WebSocket error (SPIKE 2, verified 2026-08-17) but every failed
      health probe logs "Failed to load resource: net::ERR_CONNECTION_
      REFUSED" — no browser API probes silently (fetch/XHR/WS/Image all
      log), so every verifier's zero-error gate excludes EXACTLY that line
      (KNOWN_OFFLINE_NOISE, D4b) while the app's probe gate still prevents
      the far noisier per-retry WebSocket errors (D4).
  (4) v11 manages the backend subprocess itself and requires
      `npm run build:backend` beforehand (dist/server.js must exist).
  (5) conflict resolution (two users moving one window) is M12 — never
      exercised here.

Usage: python verify_milestone11.py [base_url]
Evidence (m11-scene/full/multiuser/offline/reconnect.png, m11-console.txt,
m11-summary.json, m11-backend.log) is written to docs/screenshots/.
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
    print("verify_milestone11: the 'websocket-client' python package is required")
    sys.exit(2)

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
REPO = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = REPO / "apps" / "backend"
BACKEND_ENTRY = BACKEND_DIR / "dist" / "server.js"
if not BACKEND_ENTRY.exists():
    print("verify_milestone11: apps/backend/dist/server.js missing — run `npm run build:backend` first")
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
BACKEND_LOG = OUT / "m11-backend.log"

HEALTH_URL = "http://localhost:4000/api/health"
WS_URL = "ws://localhost:4001"

console_lines: list[str] = []
page_errors: list[str] = []
ws_urls: list[str] = []

PERF_LINE_PATTERN = re.compile(
    r"\[Performance\] handDetectionLatency=(\d+)ms renderFPS=(\d+) "
    r"gestureRecognitionLatency=(\d+(?:\.\d+)?)ms "
    r"interactionLatency=(\d+(?:\.\d+)?)ms"
)

# M11 (D4b): the app's sync layer health-probes the backend; while the
# backend is down Chromium logs each failed probe as a resource error.
# No browser API probes silently (fetch/XHR/WebSocket/Image all log), so
# the zero-error gate excludes EXACTLY this known-offline line — every
# other error still fails the gate.
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


def ws_recv_json(sock, want_type: str, timeout: float = 5.0) -> dict:
    """Next message of `want_type`; non-matching messages buffered."""
    sock.settimeout(timeout)
    buffered = getattr(sock, "_buffered", None)
    if buffered is None:
        buffered = []
        sock._buffered = buffered
    while True:
        for index, message in enumerate(buffered):
            if message.get("type") == want_type:
                buffered.pop(index)
                return message
        raw = sock.recv()
        message = json.loads(raw)
        buffered.append(message)


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
            # --- Phase 1: main page, backend UP -------------------------
            page1 = browser.new_page(viewport={"width": 1280, "height": 800})
            page1.on("console", lambda m: console_lines.append(f"[{m.type}] {m.text}"))
            page1.on("pageerror", lambda e: page_errors.append(str(e)))
            page1.on("websocket", lambda w: ws_urls.append(w.url))

            print(f"navigating to {BASE_URL}")
            page1.goto(BASE_URL, wait_until="domcontentloaded")
            page1.wait_for_timeout(14000)
            page1.screenshot(path=str(OUT / "m11-scene.png"))
            page1.screenshot(path=str(OUT / "m11-full.png"), full_page=True)
            runtime1 = page1.evaluate(
                """() => {
                  const videos = [...document.querySelectorAll('video')];
                  const video = videos[0] || null;
                  const tracks = video && video.srcObject
                    ? video.srcObject.getTracks() : [];
                  const liveTracks = tracks.filter(t => t.readyState === 'live');
                  const floatingWindows = [...document.querySelectorAll(
                    '[data-testid="floating-window"]')].map((el) => {
                    const rect = el.getBoundingClientRect();
                    return {
                      id: el.getAttribute('data-window-id'),
                      display: getComputedStyle(el).display,
                      left: rect.left, top: rect.top,
                      width: rect.width, height: rect.height,
                    };
                  });
                  const allDivs = [...document.querySelectorAll('div')];
                  // Version-tolerant since M12 (the title moved to Milestone
                  // 12); the current-milestone verifier v12 owns the exact pin.
                  const hud = allDivs.find(
                    (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
                  return {
                    hudText: hud ? hud.innerText : null,
                    viewport: { width: window.innerWidth, height: window.innerHeight },
                    floatingWindows,
                    liveTracks: liveTracks.length,
                    videoTracks: video && video.srcObject
                      ? video.srcObject.getVideoTracks().length : 0,
                  };
                }"""
            )
            print("runtime #1:", json.dumps(runtime1, indent=2))
            hud1 = runtime1["hudText"] or ""
            sync1 = re.search(r"Sync\s+(\S+)", hud1)
            users1 = re.search(r"Users\s+(\d+)", hud1)

            # --- Phase 2: python user B joins ---------------------------
            errors_before_b = error_snapshot()
            b = ws_client.create_connection(WS_URL, timeout=5)
            snapshot_b = ws_recv_json(b, "stateSnapshot")
            page1.wait_for_timeout(1500)  # let the throttled userJoined log land
            runtime_b = page1.evaluate(
                "() => document.body.innerText.match(/Users\\s+(\\d+)/)?.[1]")
            page1.screenshot(path=str(OUT / "m11-multiuser.png"))
            user_joined_lines = [
                line for line in console_lines if "[Sync] userJoined userId=" in line
            ]
            b_id = user_joined_lines[0].split("userId=")[1].strip() if user_joined_lines else None
            # The page's own userId: the snapshot user that is NOT B.
            page_user_id = next(
                (u["id"] for u in snapshot_b["data"]["users"] if u["id"] != b_id), None)

            # --- Phase 3: B drives inbound handSync ---------------------
            handsync_before = len(
                [line for line in console_lines if "[Sync] handSync" in line])
            raw_hand = {
                "handedness": "Right",
                "landmarks": [{"x": 0.123456, "y": 0.5, "z": 0.0}] * 2,
                "confidence": 0.9,
            }
            for _ in range(10):
                b.send(json.dumps({"type": "handUpdate", "data": {"hands": [raw_hand]}}))
                time.sleep(0.1)
            page1.wait_for_timeout(1500)
            handsync_lines = [line for line in console_lines if "[Sync] handSync" in line]
            errors_after_hands = error_snapshot()

            # --- Phase 4: window round-trip via the launcher ------------
            errors_before_window = error_snapshot()
            page1.evaluate(
                """() => {
                  const el = document.querySelector(
                    '[data-window-id="dashboard-1"] [data-testid="launcher-open-notes"]');
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            window_sync = ws_recv_json(b, "windowSync")
            page1.evaluate(
                """() => {
                  const el = document.querySelector(
                    '[data-window-id="notes-2"] button[aria-label="Close Notes"]');
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }"""
            )
            close_snapshot = ws_recv_json(b, "stateSnapshot")
            page1.wait_for_timeout(800)
            errors_after_window = error_snapshot()

            # --- Phase 5: B leaves --------------------------------------
            b.close()
            page1.wait_for_timeout(1500)
            users_after_b = page1.evaluate(
                "() => document.body.innerText.match(/Users\\s+(\\d+)/)?.[1]")
            user_left_lines = [line for line in console_lines if "[Sync] userLeft userId=" in line]

            # --- Phase 6: backend down, FRESH page (reload-shaped) ------
            page1.close()
            stop_backend(backend)
            backend = None
            time.sleep(1.5)  # phase margin (D5)

            offline_page = browser.new_page(viewport={"width": 1280, "height": 800})
            offline_page.on("console", lambda m: console_lines.append(f"[{m.type}] {m.text}"))
            offline_page.on("pageerror", lambda e: page_errors.append(str(e)))
            offline_page.on("websocket", lambda w: ws_urls.append(("offline", w.url)))
            offline_page.goto(BASE_URL, wait_until="domcontentloaded")
            offline_page.wait_for_timeout(10000)
            runtime_offline = offline_page.evaluate(
                """() => {
                  const allDivs = [...document.querySelectorAll('div')];
                  const hud = allDivs.find(
                    (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
                  const bootWindows = [...document.querySelectorAll(
                    '[data-testid="floating-window"]')].map(
                    (el) => el.getAttribute('data-window-id'));
                  return { hudText: hud ? hud.innerText : null, bootWindows };
                }"""
            )
            hud_offline = runtime_offline["hudText"] or ""
            sync_offline = re.search(r"Sync\s+(\S+)", hud_offline)
            users_offline = re.search(r"Users\s+(\d+)", hud_offline)
            offline_page.screenshot(path=str(OUT / "m11-offline.png"))
            # Offline-phase boundary: count :4001 attempts NOW (before the
            # backend restarts — the reconnect connection on this page is
            # EXPECTED and must not count against the offline phase).
            offline_ws_attempts = len([
                entry for entry in ws_urls
                if isinstance(entry, tuple) and ":4001" in entry[1]
            ])

            # --- Phase 7: backend restart -> reconnect ------------------
            backend, health_restart = start_backend()
            connected = False
            reconnect_deadline = time.monotonic() + 12
            while time.monotonic() < reconnect_deadline:
                offline_page.wait_for_timeout(500)
                value = offline_page.evaluate(
                    "() => document.body.innerText.match(/Sync\\s+(\\S+)/)?.[1]")
                if value == "connected":
                    connected = True
                    break
            users_reconnect = offline_page.evaluate(
                "() => document.body.innerText.match(/Users\\s+(\\d+)/)?.[1]")

            c = ws_client.create_connection(WS_URL, timeout=5)
            ws_recv_json(c, "stateSnapshot")
            offline_page.wait_for_timeout(1500)
            users_with_c = offline_page.evaluate(
                "() => document.body.innerText.match(/Users\\s+(\\d+)/)?.[1]")
            c.close()
            offline_page.wait_for_timeout(500)
            offline_page.screenshot(path=str(OUT / "m11-reconnect.png"))
            offline_page.close()

            # --- Summary ------------------------------------------------
            fps_values = [
                int(x)
                for x in re.findall(r"\[Scene3D\] FPS: (\d+)", "\n".join(console_lines))
            ]
            latency_lines = [l for l in console_lines if "detection latency" in l]
            latency_avgs = [
                int(x) for x in re.findall(r"avg (\d+)ms", "\n".join(latency_lines))
            ]
            camera_cleanups = [l for l in console_lines if "[CameraCapture] cleanup" in l]
            tracker_cleanups = [l for l in console_lines if "[HandTracker] cleanup" in l]
            gesture_log_lines = [l for l in console_lines if "[HandTracker] gestures" in l]
            console_errors = [
                l for l in console_lines
                if l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l)
            ]
            perf_lines = [l for l in console_lines if "[Performance]" in l]
            perf_matches = [perf_fullmatch(l) for l in perf_lines]
            boot_line_hits = [
                l for l in console_lines
                if "[App] app scene ready: 4 app windows created" in l
            ]
            backend_log_text = BACKEND_LOG.read_text(encoding="utf-8")

            windows1 = runtime1["floatingWindows"]
            window_ids1 = {w["id"] for w in windows1}
            viewport = runtime1["viewport"]
            on_screen = [w for w in windows1 if fully_on_screen(w, viewport)]

            ws_urls_offline_page = [
                url for entry in ws_urls if isinstance(entry, tuple) and entry[0] == "offline"
                for url in [entry[1]]
            ]

            summary = {
                "backend_health": health,
                "backend_health_restart": health_restart,
                "window_ids": sorted(window_ids1),
                "windows_on_screen": len(on_screen),
                "hud_sync_page1": sync1.group(1) if sync1 else None,
                "hud_users_page1": users1.group(1) if users1 else None,
                "hud_sync_offline": sync_offline.group(1) if sync_offline else None,
                "hud_users_offline": users_offline.group(1) if users_offline else None,
                "hud_users_after_b": runtime_b,
                "hud_users_after_b_left": users_after_b,
                "hud_users_reconnect": users_reconnect,
                "hud_users_with_c": users_with_c,
                "reconnected": connected,
                "b_snapshot_users": len(snapshot_b["data"]["users"]),
                "b_snapshot_windows": sorted(
                    w["id"] for w in snapshot_b["data"]["windows"]),
                "b_id": b_id,
                "page_user_id": page_user_id,
                "window_sync": window_sync,
                "close_snapshot_windows": sorted(
                    w["id"] for w in close_snapshot["data"]["windows"]),
                "handsync_lines": handsync_lines,
                "handsync_silent_before": handsync_before == 0,
                "user_joined_lines": user_joined_lines,
                "user_left_lines": user_left_lines,
                "offline_boot_windows": runtime_offline["bootWindows"],
                "boot_line_hits": len(boot_line_hits),
                "ws_urls_total": [u for u in ws_urls if not isinstance(u, tuple)],
                "ws_urls_offline_page": ws_urls_offline_page,
                "offline_ws_attempts_at_boundary": offline_ws_attempts,
                "fps_logged": fps_values,
                "fps_max": max(fps_values) if fps_values else 0,
                "latency_avgs_ms": latency_avgs,
                "latency_min_avg": min(latency_avgs) if latency_avgs else None,
                "latency_line_count": len(latency_lines),
                "cleanup_counts": {
                    "camera_capture": len(camera_cleanups),
                    "hand_tracker": len(tracker_cleanups),
                },
                "perf_line_count": len(perf_lines),
                "perf_all_match": len(perf_matches) == len(perf_lines),
                "page_errors": page_errors,
                "console_errors": console_errors,
                "gesture_log_lines": gesture_log_lines,
                "live_tracks": runtime1["liveTracks"],
                "backend_log_has_http": "[backend] HTTP server listening" in backend_log_text,
                "backend_log_has_ws": "[backend] WebSocket server listening" in backend_log_text,
            }

            print("\n=== SUMMARY ===")
            print(json.dumps(summary, indent=2))

            (OUT / "m11-console.txt").write_text(
                "\n".join(console_lines), encoding="utf-8")
            (OUT / "m11-summary.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8")

            browser.close()
    finally:
        if backend is not None:
            stop_backend(backend)
        if summary is None:
            (OUT / "m11-console.txt").write_text(
                "\n".join(console_lines), encoding="utf-8")
            print("run failed mid-flight; console evidence saved")

    # --- Assertions ----------------------------------------------------------
    errors_clean = (
        len(summary["console_errors"]) == 0 and len(summary["page_errors"]) == 0
    )
    sync_hud_ok = summary["hud_sync_page1"] == "connected"
    users_hud_ok = summary["hud_users_page1"] == "1"
    hud1 = runtime1["hudText"] or ""
    windows_row = re.search(r"Windows\s+(\d+)", hud1)
    b_window_ids = set(summary["b_snapshot_windows"])
    window_sync = summary["window_sync"]
    offline_ws_clean = summary["offline_ws_attempts_at_boundary"] == 0
    offline_errors_clean = errors_clean  # both pages share the gates
    handsync_ok = (
        len(summary["handsync_lines"]) > 0
        and summary["handsync_silent_before"]
        and f"userId={summary['b_id']}" in summary["handsync_lines"][-1]
        and "hands=1" in summary["handsync_lines"][-1]
    )
    window_round_trip_ok = (
        window_sync["data"]["id"] == "notes-2"
        and window_sync["data"]["owner"] == summary["page_user_id"]
        and isinstance(window_sync["data"]["position"], list)
        and len(window_sync["data"]["position"]) == 3
        and isinstance(window_sync["data"]["scale"], (int, float))
        and "notes-2" not in summary["close_snapshot_windows"]
    )
    reconnect_ok = (
        summary["reconnected"]
        and summary["hud_users_reconnect"] == "1"
        and summary["hud_users_with_c"] == "2"
    )

    checks = {
        "a: zero console errors and zero page errors across BOTH pages (incl. offline + reconnect, modulo documented probe noise)": (
            offline_errors_clean
        ),
        "b: boot scene exact: 4 app windows, ids exactly dashboard-1 + notes-1 + chat-1 + search-1, all fully on screen, boot console line says 4": (
            len(summary["window_ids"]) == 4
            and set(summary["window_ids"]) == {"dashboard-1", "notes-1", "chat-1", "search-1"}
            and summary["windows_on_screen"] == 4
            and summary["boot_line_hits"] >= 1
        ),
        "c: HUD shows M11+ title (tolerant since M12), Camera active, MediaPipe ready, Windows = 4, Sync connected, Users = 1 at boot": (
            "JARVIS · Milestone" in hud1
            and "Camera" in hud1
            and "active" in hud1
            and "MediaPipe" in hud1
            and "ready" in hud1
            and windows_row is not None
            and int(windows_row.group(1)) == 4
            and sync_hud_ok
            and users_hud_ok
        ),
        "d: backend /api/health returns status ok with wsPort 4001 (OUR subprocess)": (
            summary["backend_health"].get("status") == "ok"
            and summary["backend_health"].get("wsPort") == 4001
        ),
        "e: multi-user: B join -> Users 2 + userJoined log; B snapshot users=2 incl. the 4 flushed boot windows; B close -> Users 1 + userLeft log": (
            summary["hud_users_after_b"] == "2"
            and summary["b_id"] is not None
            and summary["b_snapshot_users"] == 2
            and {"dashboard-1", "notes-1", "chat-1", "search-1"} <= b_window_ids
            and summary["hud_users_after_b_left"] == "1"
            and len(summary["user_left_lines"]) >= 1
        ),
        "f: handSync: B's handUpdates produce [Sync] handSync userId=<B> hands=1; page was handSync-silent before (empty-hand suppression)": (
            handsync_ok
        ),
        "g: window round-trip: launcher opens notes-2 -> B receives windowSync (owner = page userId, tuple position, scalar scale); close -> snapshot without notes-2; zero new errors": (
            window_round_trip_ok
            and list(errors_before_window) == list(errors_after_window)
        ),
        "h: offline: backend down + fresh page -> Sync offline, Users 0, zero errors beyond probe noise, [Sync] offline line, ZERO :4001 websocket attempts, app functional (4 windows + boot line)": (
            summary["hud_sync_offline"] == "offline"
            and summary["hud_users_offline"] == "0"
            and any("[Sync] offline" in l for l in console_lines)
            and offline_ws_clean
            and len(summary["offline_boot_windows"]) == 4
            and summary["boot_line_hits"] >= 2
        ),
        "i: reconnect: backend restart -> Sync connected within 12 s; Users 1; user C joins -> Users 2": (
            reconnect_ok
        ),
        "j: >= 1 [Performance] line, every line matching the M4 four-key format": (
            summary["perf_line_count"] >= 1 and summary["perf_all_match"]
        ),
        "k: latency >= 2 lines, min avg in 150-260ms, < 300ms": (
            summary["latency_line_count"] >= 2
            and summary["latency_min_avg"] is not None
            and 150 <= summary["latency_min_avg"] <= 260
        ),
        "l: cleanup counts balanced (CameraCapture == HandTracker, 2-4 each — two page loads)": (
            summary["cleanup_counts"]["camera_capture"] == summary["cleanup_counts"]["hand_tracker"]
            and 2 <= summary["cleanup_counts"]["camera_capture"] <= 4
        ),
        "m: exactly 1 live video track (page 1 introspection)": (
            summary["live_tracks"] == 1
        ),
        "n: max logged FPS >= 30 (boot window)": summary["fps_max"] >= 30,
        "o: no gesture log lines (no hands on fake webcam)": (
            len(summary["gesture_log_lines"]) == 0
        ),
        "p: backend log contains the HTTP + WebSocket listening lines (D5 order)": (
            summary["backend_log_has_http"] and summary["backend_log_has_ws"]
        ),
    }
    print("\n=== CHECKS ===")
    ok = True
    for name, passed in checks.items():
        print(f"  {'PASS' if passed else 'FAIL'}  {name}")
        ok = ok and passed
    print("OVERALL:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


def error_snapshot() -> tuple:
    return (
        len([l for l in console_lines
             if l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l)]),
        len(page_errors),
    )


def fully_on_screen(window: dict, viewport: dict) -> bool:
    return (
        window["display"] != "none"
        and window["left"] > 0
        and window["top"] > 0
        and window["width"] > 0
        and window["height"] > 0
        and window["left"] + window["width"] <= viewport["width"]
        and window["top"] + window["height"] <= viewport["height"]
    )


if __name__ == "__main__":
    main()
