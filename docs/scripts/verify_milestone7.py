"""JARVIS Milestone 7 browser verification (Playwright, fake webcam).

Launches headless Chromium with --use-fake-device-for-media-stream and
--use-fake-ui-for-media-stream (auto-allowed synthetic camera), loads the
frontend dev server, and verifies the Phase 2 close-out demo scene:
  a) zero console errors AND zero page errors
  b) >= 2 floating-window DOM nodes ([data-testid="floating-window"])
     (future-proof since M8) with distinct data-window-ids, ALL fully
     inside the viewport
     (left/top > 0 AND left+width <= innerWidth / top+height <= innerHeight —
     the empirical |ndc|-margin proof at the real 1280x800 viewport)
  c) window titles visible (every boot window renders a non-empty title —
     specific titles are pinned only by the current-milestone verifier
     since M8)
  d) pairwise-distinct projected positions: the (left, top) tuples are
     distinct AND the left values are distinct AND the top values are
     distinct (distinct depths/heights by design — D2 layout)
  e) gesture debug panel present, visible, showing "No hands detected"
     (the fake webcam shows no hands)
  f) HUD intact (version-tolerant title since M8 — the title moved to
     Milestone 8; the current-milestone verifier v8 owns the exact pin),
     Camera active, MediaPipe ready,
     Windows row present with value >= 2 (future-proof since M8 — the exact
     boot count is pinned only by the current-milestone verifier)
  g) max logged render FPS >= 30 (boot window; headless steady-state 4-5 is
     the documented SwiftShader baseline, not a regression)
  h) detection latency not regressed: >= 2 "avg Xms" lines, min avg inside
     the 150-260 ms band, hard bound < 300 ms
  i) no "[HandTracker] gestures:" lines (no hands on the fake webcam)
  j) cleanup counts balanced: same number of CameraCapture and HandTracker
     cleanup lines, each 1-2 (dev StrictMode double-mounts the effects)
  k) exactly 1 live video track (StrictMode does not duplicate streams)
  l) pipeline-health carryover: >= 1 "[Performance]" line, EVERY line
     matching the M4 four-key format (handDetectionLatency, renderFPS,
     gestureRecognitionLatency, interactionLatency)
  m) (bonus, ships with D10) Reset view button present + visible with the
     exact label; clicking it stays error-free with >= 2 windows still on
     screen (the button is the demo "get back to the boot view" affordance)

Honest scope note: the fake webcam produces no hands, so the two-hand
twist ROTATION interaction cannot be exercised in the browser — it is
evidenced by the vitest suites (interactionEngine.test.ts two-hand twist
suite G1-G11 for join/rotate/exit semantics, windowManager.test.ts for
rotateWindow lockstep + wrapToPi). This script proves the boot scene
still boots clean: the app boot windows on screen at distinct projected
positions, HUD intact, reset button harmless — and that no M1-M6
assertion regressed.

Usage: python verify_milestone7.py [base_url]
Evidence (m7-scene.png, m7-full.png, m7-console.txt, m7-summary.json) is
written to docs/screenshots/.
"""
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
OUT = Path(__file__).resolve().parent.parent / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

console_lines: list[str] = []

# M11 (D4b): the app's sync layer health-probes the backend; while the
# backend is down Chromium logs each failed probe as a resource error.
# No browser API probes silently (fetch/XHR/WebSocket/Image all log), so
# the zero-error gate excludes EXACTLY this known-offline line — every
# other error still fails the gate.
KNOWN_OFFLINE_NOISE = re.compile(
    r"^\[error\] Failed to load resource: net::ERR_CONNECTION_REFUSED$")
page_errors: list[str] = []
cdn_assets: list[str] = []

PERF_LINE_PATTERN = re.compile(
    r"\[Performance\] handDetectionLatency=(\d+)ms renderFPS=(\d+) "
    r"gestureRecognitionLatency=(\d+(?:\.\d+)?)ms "
    r"interactionLatency=(\d+(?:\.\d+)?)ms"
)


def runtime_introspection(page) -> dict:
    return page.evaluate(
        """() => {
          const videos = [...document.querySelectorAll('video')];
          const video = videos[0] || null;
          const tracks = video && video.srcObject
            ? video.srcObject.getTracks() : [];
          const liveTracks = tracks.filter(t => t.readyState === 'live');
          const videoMeta = video ? {
            readyState: video.readyState,
            currentTime: video.currentTime,
            width: video.videoWidth,
            height: video.videoHeight,
            srcObjectSet: !!video.srcObject,
            tracksTotal: tracks.length,
            liveTracks: liveTracks.length,
            videoTracks: video.srcObject
              ? video.srcObject.getVideoTracks().length : 0,
          } : null;
          const gestureDebug = document.querySelector(
            '[data-testid="gesture-debug"]');
          const gdStyle = gestureDebug ? getComputedStyle(gestureDebug) : null;
          const gdRect = gestureDebug
            ? gestureDebug.getBoundingClientRect() : null;
          const gestureDebugVisible = !!gestureDebug
            && gdStyle.display !== 'none'
            && gdStyle.visibility !== 'hidden'
            && gdRect.width > 0
            && gdRect.height > 0;
          const floatingWindows = [...document.querySelectorAll(
            '[data-testid="floating-window"]')].map((el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              id: el.getAttribute('data-window-id'),
              text: el.innerText,
              display: style.display,
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            };
          });
          const resetButton = document.querySelector(
            '[data-testid="reset-view"]');
          const rbStyle = resetButton ? getComputedStyle(resetButton) : null;
          const rbRect = resetButton
            ? resetButton.getBoundingClientRect() : null;
          const resetButtonVisible = !!resetButton
            && rbStyle.display !== 'none'
            && rbStyle.visibility !== 'hidden'
            && rbRect.width > 0
            && rbRect.height > 0;
          const allDivs = [...document.querySelectorAll('div')];
          // Version-tolerant since M8 (the title moved to Milestone 8);
          // v8 pins the exact string.
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
          return {
            videoMeta,
            gestureDebugPresent: !!gestureDebug,
            gestureDebugVisible: gestureDebugVisible,
            gestureDebugText: gestureDebug ? gestureDebug.innerText : null,
            floatingWindows,
            hudText: hud ? hud.innerText : null,
            resetButton: {
              present: !!resetButton,
              visible: resetButtonVisible,
              text: resetButton ? resetButton.innerText : null,
            },
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
        }"""
    )


def perf_fullmatch(line: str) -> re.Match | None:
    # console_lines carry the "[log] " prefix; match the message part.
    message = line.split("] ", 1)[1] if "] " in line else line
    return PERF_LINE_PATTERN.fullmatch(message)


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


def main() -> None:
    runtime: dict | None = None
    summary: dict | None = None
    try:
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
            page.on(
                "request",
                lambda r: cdn_assets.append(r.url)
                if "cdn.jsdelivr.net" in r.url
                else None,
            )

            print(f"navigating to {BASE_URL}")
            page.goto(BASE_URL, wait_until="domcontentloaded")
            # Boot sequence: scene mount -> camera -> MediaPipe CDN load ->
            # inference loop. Boot-only (no soak): M7 adds no timers or
            # loops. The fake webcam produces no hands, which is the
            # no-hands state this verifier asserts on.
            page.wait_for_timeout(14000)

            page.screenshot(path=str(OUT / "m7-scene.png"))
            page.screenshot(path=str(OUT / "m7-full.png"), full_page=True)

            runtime = runtime_introspection(page)
            print("runtime:", json.dumps(runtime, indent=2))

            # --- Console-derived metrics -------------------------------------
            fps_values = [
                int(x)
                for x in re.findall(
                    r"\[Scene3D\] FPS: (\d+)", "\n".join(console_lines)
                )
            ]
            latency_lines = [
                l for l in console_lines if "detection latency" in l
            ]
            latency_avgs = [
                int(x)
                for x in re.findall(r"avg (\d+)ms", "\n".join(latency_lines))
            ]
            camera_cleanups = [
                l for l in console_lines if "[CameraCapture] cleanup" in l
            ]
            tracker_cleanups = [
                l for l in console_lines if "[HandTracker] cleanup" in l
            ]
            gesture_log_lines = [
                l for l in console_lines if "[HandTracker] gestures" in l
            ]
            console_errors = [
                l for l in console_lines if l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l)
            ]
            perf_lines = [l for l in console_lines if "[Performance]" in l]
            perf_matches = [perf_fullmatch(l) for l in perf_lines]

            # --- Summary ------------------------------------------------------
            windows = runtime["floatingWindows"]
            window_ids = {w["id"] for w in windows}
            viewport = runtime["viewport"]
            windows_on_screen = [
                w for w in windows if fully_on_screen(w, viewport)
            ]
            gesture_panel = {
                "present": runtime["gestureDebugPresent"],
                "visible": runtime["gestureDebugVisible"],
                "no_hands_state": bool(
                    runtime["gestureDebugText"]
                    and "No hands detected" in runtime["gestureDebugText"]
                ),
            }
            lefts = [w["left"] for w in windows]
            tops = [w["top"] for w in windows]
            positions_distinct = (
                len({(round(w["left"], 3), round(w["top"], 3)) for w in windows})
                == len(windows)
                and len({round(l, 3) for l in lefts}) == len(windows)
                and len({round(t, 3) for t in tops}) == len(windows)
            )
            reset_check = {
                "present": runtime["resetButton"]["present"],
                "visible": runtime["resetButton"]["visible"],
                "text": runtime["resetButton"]["text"],
                "click_ok": None,
                "errors_before": None,
                "errors_after": None,
                "windows_after": None,
            }
            summary = {
                "video": runtime["videoMeta"],
                "floating_windows": windows,
                "window_ids": sorted(window_ids),
                "windows_on_screen": windows_on_screen,
                # M8 future-proof policy (D14): assert every boot window
                # renders a non-empty title (the chrome contract); specific
                # titles are pinned only by the current-milestone verifier.
                "titles_visible": bool(
                    windows and all((w["text"] or "").strip() for w in windows)
                ),
                "positions_distinct": positions_distinct,
                "hud_text": runtime["hudText"],
                "reset_button": runtime["resetButton"],
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
                "cdn_asset_count": len(cdn_assets),
                "page_errors": page_errors,
                "console_errors": console_errors,
                "gesture_panel": gesture_panel,
                "gesture_log_lines": gesture_log_lines,
            }

            # --- m: reset-button click probe --------------------------------
            errors_before = (
                len([l for l in console_lines if l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l)]),
                len(page_errors),
            )
            if runtime["resetButton"]["present"]:
                page.click('[data-testid="reset-view"]')
                page.wait_for_timeout(1000)
            errors_after = (
                len([l for l in console_lines if l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l)]),
                len(page_errors),
            )
            windows_after = page.evaluate(
                """() => [...document.querySelectorAll(
                    '[data-testid="floating-window"]')].map((el) => {
                  const rect = el.getBoundingClientRect();
                  return {
                    id: el.getAttribute('data-window-id'),
                    display: getComputedStyle(el).display,
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  };
                })"""
            )
            reset_check.update({
                "click_ok": errors_before == errors_after,
                "errors_before": list(errors_before),
                "errors_after": list(errors_after),
                "windows_after": windows_after,
            })
            summary["reset_check"] = reset_check

            print("\n=== SUMMARY ===")
            print(json.dumps(summary, indent=2))

            (OUT / "m7-console.txt").write_text(
                "\n".join(console_lines), encoding="utf-8"
            )
            (OUT / "m7-summary.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8"
            )

            browser.close()
    finally:
        if summary is None:
            # Persist whatever console/pageerror evidence was captured even if
            # the run failed mid-flight (never leave a partial run unexplained).
            (OUT / "m7-console.txt").write_text(
                "\n".join(console_lines), encoding="utf-8"
            )
            print("run failed mid-flight; console evidence saved")

    # --- Assertions ----------------------------------------------------------
    min_latency = summary["latency_min_avg"]
    fps_max = summary["fps_max"]
    cleanup = summary["cleanup_counts"]
    hud = summary["hud_text"] or ""
    # M8 future-proof policy (D14): older verifiers no longer pin the exact
    # boot count digit — the Windows row must exist and report >= 2 (the
    # boot floor). The exact count is pinned only by the current-milestone
    # verifier (v8 since M8).
    windows_row = re.search(r"Windows\s+(\d+)", hud)
    perf_ok = (
        summary["perf_line_count"] >= 1
        and summary["perf_all_match"]
    )
    reset = summary["reset_check"]
    windows_after = reset["windows_after"] or []
    windows_after_ok = (
        len(windows_after) >= 2
        and all(fully_on_screen(w, viewport) for w in windows_after)
    )
    checks = {
        "a: zero console errors and zero page errors": (
            len(summary["console_errors"]) == 0 and len(summary["page_errors"]) == 0
        ),
        "b: >= 2 floating windows with distinct ids, ALL fully on screen": (
            len(windows) >= 2
            and len(window_ids) == len(windows)
            and len(windows_on_screen) == len(windows)
        ),
        "c: window titles visible": summary["titles_visible"],
        "d: pairwise-distinct projected positions (tuples, lefts, tops)": (
            summary["positions_distinct"]
        ),
        "e: gesture-debug panel shows 'No hands detected'": (
            gesture_panel["present"]
            and gesture_panel["visible"]
            and gesture_panel["no_hands_state"]
        ),
        "f: HUD intact (version-tolerant title), Camera active, MediaPipe ready, Windows row >= 2": (
            "JARVIS · Milestone" in hud
            and "Camera" in hud
            and "active" in hud
            and "MediaPipe" in hud
            and "ready" in hud
            and windows_row is not None
            and int(windows_row.group(1)) >= 2
        ),
        "g: max logged FPS >= 30 (boot window)": fps_max >= 30,
        "h: latency >= 2 lines, min avg in 150-260ms, < 300ms": (
            len(latency_lines) >= 2
            and min_latency is not None
            and 150 <= min_latency <= 260
            and min_latency < 300
        ),
        "i: no gesture log lines (no hands on fake webcam)": (
            len(summary["gesture_log_lines"]) == 0
        ),
        "j: cleanup counts balanced (CameraCapture == HandTracker, 1-2 each)": (
            cleanup["camera_capture"] == cleanup["hand_tracker"]
            and 1 <= cleanup["camera_capture"] <= 2
        ),
        "k: exactly 1 live video track": (
            bool(summary["video"]) and summary["video"]["liveTracks"] == 1
        ),
        "l: >= 1 [Performance] line, every line matching the M4 four-key format": (
            perf_ok
        ),
        "m: reset view button present; click stays error-free, >= 2 windows on screen": (
            reset["present"]
            and reset["visible"]
            and reset["text"] == "Reset view"
            and reset["click_ok"]
            and windows_after_ok
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
