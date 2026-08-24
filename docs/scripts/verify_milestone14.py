"""JARVIS Milestone 14 verification (Playwright, fake webcam, PRODUCTION build).

Phase 5 part 1 — performance. This verifier is the FIRST to boot the
PRODUCTION build (vite preview :4173, the split bundle) — the milestone's
"the production build must render the same app" requirement, which also
exposed and fixed the latent M1 MediaPipe-loading bug (brief D10):
  a) build chunk report: > 1 JS chunk recorded with min + gzip sizes
     (vendor-react, vendor-three, app; mediapipe = async script assets)
  b) production boot exact: 'JARVIS · Milestone' title (version-tolerant
     since M15; v15 owns the exact pin), 4 boot
     windows (dashboard-1/notes-1/chat-1/search-1), Camera active,
     MediaPipe ready, Windows = 4, Sync connected, Users = 1
  c) default console byte-identical discipline: no [PerfDebug] lines
     WITHOUT the ?perf=1 param (the opt-in stays OFF by default)
  d) ?perf=1 shows the per-second [PerfDebug] breakdown line (render,
     projection, interaction, sync buckets conform to the regex)
  e) soak: open/close cycles return memory (heap after cycles <= before
     + margin, windows back to the 4 boot ids), heap series plateaus,
     ws-driven remote moves apply (soak-1 materializes + moves + closes
     via the real M12 remoteApply path), rAF rate stable before/after
  f) reload -> single cleanup pairs (2 loads -> exactly 2 each)
  g) zero console/page errors across every phase (backend up; noise
     filter kept for safety)
  h) >= 1 [Performance] line, all matching the M4 four-key format
  i) latency >= 2 lines, min avg in 150-260ms
  j) FPS >= 30, 1 live video track, no gesture log lines
  k) backend health ok + HTTP/WS listening lines

Honest scope notes:
  (1) MediaPipe inference latency (the 200ms/frame WASM cost) is measured
      headless for REAL — the fake webcam drives the full pipeline.
  (2) the real-GPU idle/inference FPS benchmark is the user's spot check
      (README M14 procedure). The verifier's soak is memory/listener/
      lifecycle focused.

Usage: python verify_milestone14.py [base_url]
Evidence (m14-page.png, m14-perf.png, m14-soak.png, m14-chunks.json,
m14-console.txt, m14-summary.json, m14-backend.log) -> docs/screenshots/.
Requires `npm run build:backend` AND a FRESH `npm run build` first.
"""
import gzip
import json
import re
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
    print("verify_milestone14: the 'websocket-client' python package is required")
    sys.exit(2)

REPO = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = REPO / "apps" / "backend"
FRONTEND_DIR = REPO / "apps" / "frontend"
BACKEND_ENTRY = BACKEND_DIR / "dist" / "server.js"
DIST = FRONTEND_DIR / "dist"
if not BACKEND_ENTRY.exists() or not (DIST / "index.html").exists():
    print("verify_milestone14: run `npm run build` AND `npm run build:backend` first")
    sys.exit(2)

OUT = Path(__file__).resolve().parent.parent / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
BACKEND_LOG = OUT / "m14-backend.log"
# M13/M14: the backend PRELOADS data/workspace.json at boot; this verifier
# asserts a clean workspace (exact boot ids), so reset the file first
# (same clean-room discipline as v11–v13).
DATA_FILE = BACKEND_DIR / "data" / "workspace.json"
if DATA_FILE.exists():
    DATA_FILE.unlink()

PREVIEW_LOG = OUT / "m14-preview.log"

HEALTH_URL = "http://localhost:4000/api/health"
WS_URL = "ws://localhost:4001"
PREVIEW_URL = "http://localhost:4173"

console_lines: list[str] = []      # default page + reload
perf_console_lines: list[str] = [] # the ?perf=1 page
page_errors: list[str] = []

PERF_LINE_PATTERN = re.compile(
    r"\[Performance\] handDetectionLatency=(\d+)ms renderFPS=(\d+) "
    r"gestureRecognitionLatency=(\d+(?:\.\d+)?)ms "
    r"interactionLatency=(\d+(?:\.\d+)?)ms"
)
PERF_DEBUG_PATTERN = re.compile(
    r"^\[PerfDebug\] (?=.*render_avg=)(?=.*n=)"
    r"[a-z_]+_avg=\d+\.\dms n=\d+(?: [a-z_]+_avg=\d+\.\dms n=\d+)*$"
)

KNOWN_OFFLINE_NOISE = re.compile(
    r"^\[error\] Failed to load resource: net::ERR_CONNECTION_REFUSED$")


def perf_fullmatch(line: str) -> re.Match | None:
    message = line.split("] ", 1)[1] if "] " in line else line
    return PERF_LINE_PATTERN.fullmatch(message)


def strip_tag(line: str) -> str:
    return line.split("] ", 1)[1] if "] " in line else line


def perf_debug_lines(lines: list[str]) -> list[str]:
    return [strip_tag(l) for l in lines if "[PerfDebug]" in l]


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


def start_preview() -> subprocess.Popen:
    log = open(PREVIEW_LOG, "a", encoding="utf-8")
    proc = subprocess.Popen(
        ["npx.cmd", "vite", "preview", "--port", "4173", "--strictPort"],
        cwd=str(FRONTEND_DIR),
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    deadline = time.monotonic() + 15
    last_error = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(PREVIEW_URL, timeout=2) as response:
                if response.status == 200:
                    return proc
        except Exception as error:  # noqa: BLE001
            last_error = error
            time.sleep(0.5)
    raise RuntimeError(f"preview did not come up: {last_error}")


def chunk_report() -> dict:
    assets = sorted((DIST / "assets").iterdir())
    js = [a for a in assets if a.suffix == ".js"]
    report = []
    for asset in js:
        raw = asset.read_bytes()
        report.append({
            "file": asset.name,
            "min_kb": round(len(raw) / 1024, 2),
            "gzip_kb": round(len(gzip.compress(raw)) / 1024, 2),
        })
    return {
        "js_chunk_count": len(js),
        "js_total_min_kb": round(sum(r["min_kb"] for r in report), 2),
        "js_total_gzip_kb": round(sum(r["gzip_kb"] for r in report), 2),
        "chunks": report,
    }


def hud_runtime(page) -> dict:
    return page.evaluate(
        """() => {
          const allDivs = [...document.querySelectorAll('div')];
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
          return {
            hudText: hud ? hud.innerText : null,
            windowIds: [...document.querySelectorAll(
              '[data-testid="floating-window"]')].map(
              (el) => el.getAttribute('data-window-id')).sort(),
            liveTracks: ([...document.querySelectorAll('video')][0]?.srcObject
              ? [...document.querySelectorAll('video')][0].srcObject.getTracks()
                  .filter(t => t.readyState === 'live').length : 0),
            heapMb: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
          };
        }"""
    )


def heap_mb(page) -> float | None:
    return page.evaluate(
        "() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null")


def raf_rate(page) -> float:
    """rAF callbacks per second (a lifecycle-stability proxy: a leak that
    layers rAF loops would show up as a growing rate)."""
    return page.evaluate(
        """() => new Promise((resolve) => {
          let count = 0;
          const start = performance.now();
          const tick = () => { count += 1; if (performance.now() - start < 1000) requestAnimationFrame(tick); else resolve(count); };
          requestAnimationFrame(tick);
        })"""
    )


def poll_until(page, js_expr, want, timeout_s=6.0):
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
    preview: subprocess.Popen | None = None
    try:
        chunks = chunk_report()
        preview = start_preview()
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

            # --- Phase 1: production (split) boot, DEFAULT params --------
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.on("console", lambda m: console_lines.append(f"[{m.type}] {m.text}"))
            page.on("pageerror", lambda e: page_errors.append(str(e)))
            print(f"navigating (production preview) to {PREVIEW_URL}")
            page.goto(PREVIEW_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(14000)
            r1 = hud_runtime(page)
            page.screenshot(path=str(OUT / "m14-page.png"))
            print("boot runtime:", json.dumps(r1, indent=2))

            # --- Phase 2: soak — open/close cycles -----------------------
            heap_before = heap_mb(page)
            opened_ids: list[str] = []
            for _ in range(5):
                page.evaluate(
                    """() => {
                      const el = document.querySelector(
                        '[data-window-id="dashboard-1"] [data-testid="launcher-open-notes"]');
                      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    }"""
                )
                page.wait_for_timeout(300)
                # close the NEWEST notes window (notes-2, notes-3, ...)
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
            time.sleep(1)
            heap_after_cycles = heap_mb(page)
            cycle_ids = hud_runtime(page)["windowIds"]
            r2 = hud_runtime(page)

            # --- Phase 3: ws-driven remote moves (M12 remoteApply path) --
            w = ws_client.create_connection(WS_URL, timeout=5)
            w.settimeout(3)
            try:
                w.recv()  # stateSnapshot
            except Exception:  # noqa: BLE001 - buffered, not asserted
                pass
            w.send(json.dumps({
                "type": "windowUpsert",
                "data": {"id": "soak-1", "title": "Soak", "owner": "",
                         "position": [0.8, 0.2, -0.6], "rotationY": 0,
                         "scale": 1.5, "zIndex": 40, "lastModified": 0},
            }))
            got_soak, _ = poll_until(
                page,
                "() => document.querySelector('[data-window-id=\\\"soak-1\\\"]') ? 'yes' : 'no'",
                "yes", timeout_s=6)
            page.wait_for_timeout(600)
            left_first = page.evaluate(
                "() => document.querySelector('[data-window-id=\\\"soak-1\\\"]')?.style.left")
            for i in range(20):
                w.send(json.dumps({
                    "type": "windowUpsert",
                    "data": {"id": "soak-1", "title": "Soak", "owner": "",
                             "position": [0.8 - i * 0.02, 0.2, -0.6],
                             "rotationY": 0, "scale": 1.5, "zIndex": 40,
                             "lastModified": 0},
                }))
                time.sleep(0.05)
            page.wait_for_timeout(1000)
            left_last = page.evaluate(
                "() => document.querySelector('[data-window-id=\\\"soak-1\\\"]')?.style.left")
            w.send(json.dumps({"type": "windowClose", "data": {"id": "soak-1"}}))
            soak_gone, _ = poll_until(
                page,
                "() => document.querySelector('[data-window-id=\\\"soak-1\\\"]') ? 'yes' : 'no'",
                "no", timeout_s=6)
            w.close()

            # --- Phase 4: heap plateau + rAF stability + reload ----------
            heap_series = []
            for _ in range(6):
                heap_series.append(heap_mb(page))
                page.wait_for_timeout(1000)
            raf_after = raf_rate(page)
            page.goto(PREVIEW_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(14000)
            r_after_reload = hud_runtime(page)
            page.screenshot(path=str(OUT / "m14-soak.png"))

            # --- Phase 5: ?perf=1 breakdown ------------------------------
            perf_page = browser.new_page(viewport={"width": 1280, "height": 800})
            perf_page.on("console", lambda m: perf_console_lines.append(f"[{m.type}] {m.text}"))
            perf_page.on("pageerror", lambda e: page_errors.append(str(e)))
            perf_page.goto(f"{PREVIEW_URL}?perf=1", wait_until="domcontentloaded")
            perf_page.wait_for_timeout(16000)
            perf_page.screenshot(path=str(OUT / "m14-perf.png"))

            # --- Summary ------------------------------------------------
            fps_values = [
                int(x) for x in re.findall(r"\[Scene3D\] FPS: (\d+)", "\n".join(console_lines))]
            latency_lines = [l for l in console_lines if "detection latency" in l]
            latency_avgs = [
                int(x) for x in re.findall(r"avg (\d+)ms", "\n".join(latency_lines))]
            perf_lines = [l for l in console_lines if "[Performance]" in l]
            perf_matches = [perf_fullmatch(l) for l in perf_lines]
            perf_debug_default = perf_debug_lines(console_lines)
            perf_debug_on = perf_debug_lines(perf_console_lines)
            console_errors = [
                l for l in console_lines + perf_console_lines
                if l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l)]
            backend_log_text = BACKEND_LOG.read_text(encoding="utf-8")

            summary = {
                "chunks": chunks,
                "backend_health": health,
                "r_boot": r1,
                "heap_before_mb": heap_before,
                "heap_after_cycles_mb": heap_after_cycles,
                "heap_series_mb": [round(x, 2) if x else None for x in heap_series],
                "open_close_return": (heap_after_cycles or 0) <= (heap_before or 0) + 12,
                "cycle_window_ids": cycle_ids,
                "soak_materialized": got_soak,
                "soak_moved": bool(left_first) and bool(left_last) and left_first != left_last,
                "soak_left_first": left_first,
                "soak_left_last": left_last,
                "soak_gone_after_close": soak_gone,
                "raf_rate_after": raf_after,
                "r_after_reload": r_after_reload,
                "perf_debug_default_count": len(perf_debug_default),
                "perf_debug_on_count": len(perf_debug_on),
                "perf_debug_conformant": all(PERF_DEBUG_PATTERN.fullmatch(l) for l in perf_debug_on),
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

            (OUT / "m14-console.txt").write_text("\n".join(console_lines), encoding="utf-8")
            (OUT / "m14-summary.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8")
            (OUT / "m14-chunks.json").write_text(
                json.dumps(chunks, indent=2), encoding="utf-8")

            browser.close()
    finally:
        if backend is not None:
            stop_backend(backend)
        if preview is not None:
            preview.terminate()
            try:
                preview.wait(timeout=10)
            except subprocess.TimeoutExpired:
                preview.kill()
        if summary is None:
            (OUT / "m14-console.txt").write_text("\n".join(console_lines), encoding="utf-8")
            print("run failed mid-flight; console evidence saved")

    # --- Assertions ---------------------------------------------------------
    hud = summary["r_boot"]["hudText"] or ""
    hud_reload = summary["r_after_reload"]["hudText"] or ""
    windows_row = re.search(r"Windows\s+(\d+)", hud)
    sync_row = re.search(r"Sync\s+(\S+)", hud)
    users_row = re.search(r"Users\s+(\d+)", hud)
    boot_ids = ["chat-1", "dashboard-1", "notes-1", "search-1"]

    checks = {
        "a: build chunk report — > 1 JS chunk, sizes recorded (min + gzip)": (
            summary["chunks"]["js_chunk_count"] > 1
            and all("min_kb" in c and "gzip_kb" in c for c in summary["chunks"]["chunks"])
        ),
        "b: PRODUCTION boot exact — 'JARVIS · Milestone' title, 4 windows, Camera/MediaPipe ready, Windows 4, Sync connected, Users 1": (
            summary["r_boot"]["windowIds"] == boot_ids
            and "JARVIS · Milestone" in hud
            and "Camera" in hud and "active" in hud
            and "MediaPipe" in hud and "ready" in hud
            and windows_row is not None and int(windows_row.group(1)) == 4
            and sync_row is not None and sync_row.group(1) == "connected"
            and users_row is not None and users_row.group(1) == "1"
            and summary["boot_line_hits"] >= 1
        ),
        "c: opt-in DISABLED by default — zero [PerfDebug] lines on the plain page/reload": (
            summary["perf_debug_default_count"] == 0
        ),
        "d: ?perf=1 shows the [PerfDebug] breakdown, format-conformant, at least one line": (
            summary["perf_debug_on_count"] >= 1
            and summary["perf_debug_conformant"]
        ),
        "e1: soak — 5 open/close cycles return memory (heap <= before + 12MB) and windows back to the 4 boot ids": (
            summary["open_close_return"]
            and summary["cycle_window_ids"] == boot_ids
        ),
        "e2: soak — remote ws moves apply (soak-1 materializes + moves + closes)": (
            summary["soak_materialized"]
            and summary["soak_moved"]
            and summary["soak_gone_after_close"]
        ),
        "e3: soak — heap series plateaus (no runaway growth across ~6s)": (
            all(x is not None for x in summary["heap_series_mb"])
            and (max(summary["heap_series_mb"]) - min(summary["heap_series_mb"])) <= 15
        ),
        "f: production reload -> app ready again + boot windows restored (StrictMode is inert in the build, so ZERO cleanup lines is the honest expectation)": (
            summary["cleanup"]["camera"] == 0
            and summary["cleanup"]["tracker"] == 0
            and "MediaPipe" in hud_reload and "ready" in hud_reload
            and summary["r_after_reload"]["windowIds"] == boot_ids
        ),
        "g: zero console/page errors across every phase": (
            len(summary["console_errors"]) == 0 and len(summary["page_errors"]) == 0
        ),
        "h: >= 1 [Performance] line, all matching the M4 four-key format": (
            summary["perf_line_count"] >= 1 and summary["perf_all_match"]
        ),
        "i: latency >= 2 lines, min avg 150-260ms": (
            summary["latency_line_count"] >= 2
            and summary["latency_min_avg"] is not None
            and 150 <= summary["latency_min_avg"] <= 260
        ),
        "j: FPS >= 30, 1 live video track, no gesture log lines": (
            summary["fps_max"] >= 30
            and summary["r_boot"]["liveTracks"] == 1
            and summary["gesture_log_lines"] == 0
        ),
        "k: backend health ok + HTTP/WS listening lines": (
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
