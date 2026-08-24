"""JARVIS Milestone 2 browser verification (Playwright, fake webcam).

Launches headless Chromium with --use-fake-device-for-media-stream and
--use-fake-ui-for-media-stream (auto-allowed synthetic camera), loads the
frontend dev server, and verifies on top of the Milestone 1 pipeline:
  a) zero console errors AND zero page errors
  b) gesture debug panel ([data-testid="gesture-debug"]) present, showing
     "No hands detected" (the fake webcam shows no hands)
  c) HUD contains the "Gestures" row (Milestone 2 wiring)
  d) detection latency not regressed: >= 2 "avg Xms" lines, min avg inside
     the 150-260 ms band seen in M1 (195-201 ms), hard bound < 300 ms
  e) max logged render FPS >= 30
  f) exactly one [CameraCapture] cleanup and one [HandTracker] cleanup line
  g) no "[HandTracker] gestures:" lines (no hands on the fake webcam)
  h) exactly 1 live video track (StrictMode does not duplicate streams)

Usage: python verify_milestone2.py [base_url]
Evidence (m2-scene.png, m2-full.png, m2-console.txt, m2-summary.json) is
written to docs/screenshots/. m2-summary.json keeps the m1-summary.json
schema and adds the gesture_panel fields.
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


def runtime_introspection(page) -> dict:
    return page.evaluate(
        """() => {
          const videos = [...document.querySelectorAll('video')];
          const canvases = [...document.querySelectorAll('canvas')];
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
          const allDivs = [...document.querySelectorAll('div')];
          // Milestone verifiers assert milestone-owned features, never the
          // mutable HUD title: the title moved to "Milestone 3" in M3, so
          // this lookup was updated in lockstep per the M4 instruction;
          // future title bumps must update prior verifiers' title lookups
          // in the same change.
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
          return {
            canvases: canvases.length,
            canvasSizes: canvases.map((c) => [c.width, c.height]),
            videoMeta,
            gestureDebugPresent: !!gestureDebug,
            gestureDebugVisible: gestureDebugVisible,
            gestureDebugText: gestureDebug ? gestureDebug.innerText : null,
            hudText: hud ? hud.innerText : null,
          };
        }"""
    )


def main() -> None:
    runtime: dict | None = None
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
            # inference loop. The fake webcam produces no hands, which is the
            # no-hands state this verifier asserts on.
            page.wait_for_timeout(14000)

            page.screenshot(path=str(OUT / "m2-scene.png"))
            page.screenshot(path=str(OUT / "m2-full.png"), full_page=True)

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
            cleanup_logs = [l for l in console_lines if "cleanup" in l]
            gesture_log_lines = [
                l for l in console_lines if "[HandTracker] gestures" in l
            ]
            console_errors = [
                l for l in console_lines if l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l)
            ]

            # --- Pixel analysis of the scene screenshot -----------------------
            from PIL import Image

            img = Image.open(OUT / "m2-scene.png").convert("RGB")
            w, h = img.size
            colors = img.getcolors(maxcolors=1_000_000)
            colors = sorted(colors, reverse=True)
            bg = (10, 14, 39)  # 0x0a0e27
            non_bg = sum(cnt for cnt, rgb in colors if rgb != bg and rgb != (0, 0, 0))
            print(f"screenshot {w}x{h}, top colors: {colors[:5]}")
            print(f"non-background pixels: {non_bg}")

            # --- Summary (m1-summary.json schema + gesture_panel) -------------
            gesture_panel = {
                "present": runtime["gestureDebugPresent"],
                "visible": runtime["gestureDebugVisible"],
                "text": runtime["gestureDebugText"],
                "no_hands_state": bool(
                    runtime["gestureDebugText"]
                    and "No hands detected" in runtime["gestureDebugText"]
                ),
                "hud_has_gestures_row": bool(
                    runtime["hudText"] and "Gestures" in runtime["hudText"]
                ),
                "hud_text": runtime["hudText"],
                "gesture_log_lines": gesture_log_lines,
            }
            summary = {
                "scene_canvases": runtime["canvases"],
                "canvas_sizes": runtime["canvasSizes"],
                "video": runtime["videoMeta"],
                "fps_logged": fps_values,
                "fps_max": max(fps_values) if fps_values else 0,
                "latency_avgs_ms": latency_avgs,
                "latency_min_avg": min(latency_avgs) if latency_avgs else None,
                "latency_line_count": len(latency_lines),
                "cleanup_logs": cleanup_logs,
                "cdn_asset_count": len(cdn_assets),
                "cdn_assets": cdn_assets[:6],
                "page_errors": page_errors,
                "console_errors": console_errors,
                "non_bg_pixels": non_bg,
                "gesture_panel": gesture_panel,
            }
            print("\n=== SUMMARY ===")
            print(json.dumps(summary, indent=2))

            (OUT / "m2-console.txt").write_text(
                "\n".join(console_lines), encoding="utf-8"
            )
            (OUT / "m2-summary.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8"
            )

            browser.close()
    finally:
        if runtime is None:
            # Persist whatever console/pageerror evidence was captured even if
            # the run failed mid-flight (never leave a partial run unexplained).
            (OUT / "m2-console.txt").write_text(
                "\n".join(console_lines), encoding="utf-8"
            )

    # --- Assertions ----------------------------------------------------------
    min_latency = summary["latency_min_avg"]
    fps_max = summary["fps_max"]
    checks = {
        "a: zero console errors and zero page errors": (
            len(console_errors) == 0 and len(page_errors) == 0
        ),
        "b: gesture-debug panel shows 'No hands detected'": (
            gesture_panel["present"]
            and gesture_panel["visible"]
            and gesture_panel["no_hands_state"]
        ),
        "c: HUD contains 'Gestures' row": gesture_panel["hud_has_gestures_row"],
        "d: latency >= 2 lines, min avg in 150-260ms, < 300ms": (
            len(latency_lines) >= 2
            and min_latency is not None
            and 150 <= min_latency <= 260
            and min_latency < 300
        ),
        "e: max FPS >= 30": fps_max >= 30,
        "f: exactly one CameraCapture and one HandTracker cleanup": (
            sum(1 for l in cleanup_logs if "[CameraCapture] cleanup" in l) == 1
            and sum(1 for l in cleanup_logs if "[HandTracker] cleanup" in l) == 1
        ),
        "g: no gesture log lines (no hands on fake webcam)": (
            len(gesture_log_lines) == 0
        ),
        "h: exactly 1 live video track": (
            bool(runtime["videoMeta"]) and runtime["videoMeta"]["liveTracks"] == 1
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
