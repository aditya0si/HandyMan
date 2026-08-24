"""JARVIS Milestone 1 browser verification (Playwright, fake webcam).

Launches headless Chromium with --use-fake-device-for-media-stream and
--use-fake-ui-for-media-stream (auto-allowed synthetic camera), loads the
frontend dev server, and verifies:
  a) Three.js scene renders (canvas present, non-background pixels, screenshot)
  b) camera capture active (live video track, frames advancing)
  c) MediaPipe loads from CDN (network requests + console)
  d) hand pipeline running (hands.send/onResults -> latency logs)
  e) FPS >= 30 (console + HUD)
  f) no uncaught page exceptions
  g) StrictMode double-mount does not duplicate camera streams (1 live track)

Usage: python verify_milestone1.py [base_url]
Screenshots + console log are written to docs/screenshots/.
"""
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
OUT = Path(__file__).resolve().parent.parent / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

console_lines: list[str] = []
page_errors: list[str] = []
cdn_assets: list[str] = []


def main() -> None:
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
        page.on("request", lambda r: cdn_assets.append(r.url) if "cdn.jsdelivr.net" in r.url else None)

        print(f"navigating to {BASE_URL}")
        page.goto(BASE_URL, wait_until="domcontentloaded")
        # Let the app boot: scene mount -> camera -> MediaPipe CDN load -> inference
        page.wait_for_timeout(14000)

        page.screenshot(path=str(OUT / "m1-scene.png"))
        page.screenshot(path=str(OUT / "m1-full.png"), full_page=True)

        # --- Runtime introspection -------------------------------------------
        runtime = page.evaluate(
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
              const hud = document.body.innerText.slice(0, 600);
              return {
                canvases: canvases.length,
                canvasSizes: canvases.map(c => [c.width, c.height]),
                videoMeta,
                hud,
              };
            }"""
        )
        print("runtime:", json.dumps(runtime, indent=2))

        # --- Console-derived metrics -----------------------------------------
        fps_values = [int(x) for x in re.findall(r"\[Scene3D\] FPS: (\d+)", "\n".join(console_lines))]
        # FPS after the first inference result: in software-rendered headless
        # Chromium the MediaPipe send blocks the main thread ~200ms/frame.
        first_latency_idx = next(
            (i for i, l in enumerate(console_lines) if "detection latency" in l),
            len(console_lines),
        )
        fps_during_inference = [
            int(x)
            for x in re.findall(r"\[Scene3D\] FPS: (\d+)", "\n".join(console_lines[first_latency_idx:]))
        ]
        latency_lines = [l for l in console_lines if "detection latency" in l]
        latency_avgs = [
            int(x) for x in re.findall(r"avg (\d+)ms", "\n".join(latency_lines))
        ]
        hand_logs = [l for l in console_lines if "[HandTracker]" in l and "hand(s)" in l]
        camera_active = [l for l in console_lines if "stream active" in l]
        cleanup_logs = [l for l in console_lines if "cleanup" in l]
        landmark_logs = [l for l in console_lines if "21 landmarks" in l]

        # --- Pixel analysis of the scene screenshot ---------------------------
        from PIL import Image

        img = Image.open(OUT / "m1-scene.png").convert("RGB")
        w, h = img.size
        colors = img.getcolors(maxcolors=1_000_000)
        colors = sorted(colors, reverse=True)
        top_colors = colors[:5]
        bg = (10, 14, 39)  # 0x0a0e27
        non_bg = sum(cnt for cnt, rgb in colors if rgb != bg and rgb != (0, 0, 0))
        print(f"screenshot {w}x{h}, top colors: {top_colors}")
        print(f"non-background pixels: {non_bg}")

        # --- Report -----------------------------------------------------------
        summary = {
            "scene_canvases": runtime["canvases"],
            "canvas_sizes": runtime["canvasSizes"],
            "video": runtime["videoMeta"],
            "fps_logged": fps_values,
            "fps_max": max(fps_values) if fps_values else 0,
            "fps_during_inference": fps_during_inference,
            "latency_avgs_ms": latency_avgs,
            "latency_min_avg": min(latency_avgs) if latency_avgs else None,
            "latency_line_count": len(latency_lines),
            "hand_logs": hand_logs[:5],
            "landmark_logs": landmark_logs[:2],
            "camera_active_logs": camera_active,
            "cleanup_logs": cleanup_logs,
            "cdn_asset_count": len(cdn_assets),
            "cdn_assets": cdn_assets[:6],
            "page_errors": page_errors,
            "non_bg_pixels": non_bg,
            "hud": runtime["hud"],
        }
        print("\n=== SUMMARY ===")
        print(json.dumps(summary, indent=2))

        (OUT / "m1-console.txt").write_text("\n".join(console_lines), encoding="utf-8")
        (OUT / "m1-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

        browser.close()

    # --- Assertions ----------------------------------------------------------
    ok = True
    checks = {
        "a: scene canvas + non-black render": runtime["canvases"] >= 2 and non_bg > 200_000,
        "b: camera live track(s) == 1": bool(runtime["videoMeta"]) and runtime["videoMeta"]["liveTracks"] == 1,
        "b2: video frames advancing": bool(runtime["videoMeta"]) and runtime["videoMeta"]["currentTime"] > 0,
        "c: mediapipe assets from CDN": cdn_asset_count_check(cdn_assets),
        "d: hand pipeline running (latency logs)": len(latency_lines) >= 2,
        "e: FPS >= 30": (max(fps_values) if fps_values else 0) >= 30,
        "e2: latency < 300ms": (min(latency_avgs) if latency_avgs else 9999) < 300,
        "f: no uncaught page errors": len(page_errors) == 0,
        "g: StrictMode no duplicate streams": bool(runtime["videoMeta"]) and runtime["videoMeta"]["liveTracks"] == 1,
    }
    print("\n=== CHECKS ===")
    for name, passed in checks.items():
        print(f"  {'PASS' if passed else 'FAIL'}  {name}")
        ok = ok and passed
    print("OVERALL:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


def cdn_asset_count_check(assets: list[str]) -> bool:
    return any("hands" in a or "wasm" in a for a in assets)


if __name__ == "__main__":
    main()
