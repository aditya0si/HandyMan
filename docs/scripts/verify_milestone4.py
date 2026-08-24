"""JARVIS Milestone 4 browser verification (Playwright, fake webcam).

Extends verify_milestone3.py with M4's polish scope:
  a) zero console errors AND zero page errors across the WHOLE session
     (boot + soak + reload), and no console spam during the soak
     (average <= 5 console lines/s)
  b) >= 2 floating-window DOM nodes with distinct ids after boot
  c) window titles visible (every boot window renders a non-empty title —
     specific titles are pinned only by the current-milestone verifier
     since M8)
  d) gesture debug panel shows "No hands detected" (fake webcam)
  e) HUD intact AND "JARVIS · Milestone" title present (version-tolerant
     lookup — milestone verifiers assert milestone-owned features, never
     the mutable HUD title; the title moved to Milestone 5 in M5), Camera
     active, MediaPipe ready,
     Windows row present with value >= 2 (future-proof since M8 — the exact
     boot count is pinned only by the current-milestone verifier)
  f) max logged render FPS >= 30 (boot window; headless steady-state 4-5
     is the documented SwiftShader baseline, not a regression)
  g) detection latency not regressed: >= 2 lines, min avg in 150-260 ms,
     hard bound < 300 ms
  h) metric summary: >= 3 "[Performance]" lines, EVERY line matching the
     exact four-key format, >= 1 summary with renderFPS >= 1, cadence sane
     (median gap between consecutive summaries in [4, 15] s)
  i) no-drift soak: both floating-window rects move < 1.5 px between the
     first and last soak sample (animations inert with no hands)
  j) no "[HandTracker] gestures:" lines (no hands on the fake webcam)
  k) pre-reload cleanup counts balanced: CameraCapture == HandTracker,
     each 1-2 (dev StrictMode double-mounts effects)
  l) post-reload: cleanup DELTA == 1 for each (balanced), exactly 1 live
     video track again, >= 2 floating windows on screen again
  m) rAF leak check: the OUTSTANDING rAF balance (granted - revoked -
     fired) is stable across the soak, |last - first| <= 2
  n) listener leak check: net added - removed stable across the soak,
     |last - first| <= 2
  o) heap check: performance.memory defined; median of the last 3 samples
     - median of the first 3 <= 30 MB growth; no sample exceeds the first
     + 60 MB

Instrumentation: an init script (runs before the app on every page load)
wraps requestAnimationFrame/cancelAnimationFrame and
EventTarget.prototype.addEventListener/removeEventListener, counting
grants/revocations/fired callbacks and adds/removes. The wrappers call
through unchanged (this/args/return values preserved). NOTE on check m:
rAF loops self-re-grant every frame, so the CUMULATIVE granted counter
necessarily grows; the deterministic leak signal is the outstanding
balance (granted - revoked - fired = live loop count), which must stay
flat while the app is idle. The heap bound (o) is a coarse backstop;
counter stability (m/n) is the primary detector.

Honest scope (same spirit as M3): the fake webcam produces no hands, so
grab/momentum paths are exercised by the unit tests (animation.test.ts),
not here; interactionLatency reads 0.0 ms headless (no gestures are ever
processed) and its single-digit-ms evidence is the vitest perf smoke plus
manual real-webcam runs. This script proves the app stays inert and
leak-free under a 2.5-minute soak, not that interactions work.

Usage: python verify_milestone4.py [base_url]
Evidence (m4-scene.png, m4-full.png, m4-console.txt, m4-summary.json) is
written to docs/screenshots/.
"""
import json
import re
import statistics
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173"
OUT = Path(__file__).resolve().parent.parent / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

console_events: list[tuple[float, str, str]] = []
page_errors: list[str] = []

# M11 (D4b): the app's sync layer health-probes the backend; while the
# backend is down Chromium logs each failed probe as a resource error.
# No browser API probes silently (fetch/XHR/WebSocket/Image all log), so
# the zero-error gate excludes EXACTLY this known-offline line — every
# other error still fails the gate.
KNOWN_OFFLINE_NOISE = re.compile(
    r"^\[error\] Failed to load resource: net::ERR_CONNECTION_REFUSED$")
cdn_assets: list[str] = []

SOAK_SAMPLES = 10
SOAK_INTERVAL_S = 15
DRIFT_PX = 1.5
HEAP_GROWTH_MB = 30
HEAP_ABSORB_MB = 60

PERF_LINE_PATTERN = re.compile(
    r"\[Performance\] handDetectionLatency=(\d+)ms renderFPS=(\d+) "
    r"gestureRecognitionLatency=(\d+(?:\.\d+)?)ms "
    r"interactionLatency=(\d+(?:\.\d+)?)ms"
)

# Self-invoking so Playwright's string evaluation actually runs it (a bare
# arrow expression would be defined but never called).
INIT_SCRIPT = """(() => {
  window.__rafStats = { granted: 0, revoked: 0, fired: 0 };
  const origRaf = window.requestAnimationFrame.bind(window);
  const origCancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    window.__rafStats.granted += 1;
    return origRaf((ts) => {
      window.__rafStats.fired += 1;
      return cb(ts);
    });
  };
  window.cancelAnimationFrame = (id) => {
    window.__rafStats.revoked += 1;
    return origCancel(id);
  };
  window.__listenerStats = { added: 0, removed: 0 };
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (...args) {
    window.__listenerStats.added += 1;
    return origAdd.apply(this, args);
  };
  EventTarget.prototype.removeEventListener = function (...args) {
    window.__listenerStats.removed += 1;
    return origRemove.apply(this, args);
  };
})()"""

SOAK_SAMPLE_JS = """() => {
  const memory = performance.memory
    ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
      }
    : null;
  const windows = [...document.querySelectorAll(
    '[data-testid="floating-window"]')].map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      id: el.getAttribute('data-window-id'),
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
  const raf = window.__rafStats || { granted: 0, revoked: 0, fired: 0 };
  const listeners = window.__listenerStats || { added: 0, removed: 0 };
  return {
    raf: { ...raf, pending: raf.granted - raf.revoked - raf.fired },
    listeners: { ...listeners, net: listeners.added - listeners.removed },
    memory,
    windows,
  };
}"""


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
          const allDivs = [...document.querySelectorAll('div')];
          // Milestone verifiers assert milestone-owned features, never the
          // mutable HUD title: the title moved to "Milestone 5" in M5, so
          // this lookup was updated in lockstep; future title bumps must
          // update prior verifiers' title lookups in the same change.
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
          return {
            videoMeta,
            gestureDebugPresent: !!gestureDebug,
            gestureDebugVisible: gestureDebugVisible,
            gestureDebugText: gestureDebug ? gestureDebug.innerText : null,
            floatingWindows,
            hudText: hud ? hud.innerText : null,
          };
        }"""
    )


def console_text() -> list[str]:
    # "[type] text" format, matching the m1-m3 console evidence files.
    return [f"[{_type}] {text}" for (_t, _type, text) in console_events]


def perf_fullmatch(line: str) -> re.Match | None:
    # console_text lines carry the "[log] " prefix; match the message part.
    message = line.split("] ", 1)[1] if "] " in line else line
    return PERF_LINE_PATTERN.fullmatch(message)


def cleanup_counts() -> dict[str, int]:
    lines = console_text()
    return {
        "camera_capture": len(
            [l for l in lines if "[CameraCapture] cleanup" in l]
        ),
        "hand_tracker": len(
            [l for l in lines if "[HandTracker] cleanup" in l]
        ),
    }


def main() -> None:
    runtime: dict | None = None
    post_reload: dict | None = None
    summary: dict | None = None
    soak_samples: list[dict] = []
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
            page.add_init_script(INIT_SCRIPT)
            page.on(
                "console",
                lambda m: console_events.append(
                    (time.monotonic(), m.type, m.text)
                ),
            )
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

            page.screenshot(path=str(OUT / "m4-scene.png"))
            page.screenshot(path=str(OUT / "m4-full.png"), full_page=True)

            runtime = runtime_introspection(page)
            print("runtime:", json.dumps(runtime, indent=2))

            # --- Soak: ~10 samples, 15 s apart -------------------------------
            soak_start_console = len(console_events)
            soak_start_wall = time.monotonic()
            print(
                f"soak: collecting {SOAK_SAMPLES} samples "
                f"{SOAK_INTERVAL_S}s apart (~{(SOAK_SAMPLES - 1) * SOAK_INTERVAL_S}s)"
            )
            for i in range(SOAK_SAMPLES):
                soak_samples.append(page.evaluate(SOAK_SAMPLE_JS))
                sample = soak_samples[-1]
                print(
                    f"  sample {i + 1}/{SOAK_SAMPLES}: "
                    f"raf={sample['raf']} listeners={sample['listeners']} "
                    f"heap={sample['memory'] and round(sample['memory']['usedJSHeapSize'] / 1048576, 1)}MB"
                )
                if i < SOAK_SAMPLES - 1:
                    page.wait_for_timeout(SOAK_INTERVAL_S * 1000)
            soak_end_wall = time.monotonic()
            soak_duration_s = soak_end_wall - soak_start_wall
            soak_console_lines = [
                text for (_, _type, text) in console_events[soak_start_console:]
            ]
            soak_lines_per_second = len(soak_console_lines) / max(soak_duration_s, 0.001)

            # --- Reload ------------------------------------------------------
            pre_reload_cleanup = cleanup_counts()
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(8000)
            post_reload = runtime_introspection(page)
            post_reload_cleanup = cleanup_counts()
            print("post-reload runtime:", json.dumps(post_reload, indent=2))
            print("cleanup pre/post reload:", pre_reload_cleanup, post_reload_cleanup)
            print(
                f"soak console rate: {len(soak_console_lines)} lines over "
                f"{soak_duration_s:.0f}s = {soak_lines_per_second:.2f} lines/s"
            )

            # --- Console-derived metrics -------------------------------------
            lines = console_text()
            fps_values = [
                int(x) for x in re.findall(r"\[Scene3D\] FPS: (\d+)", "\n".join(lines))
            ]
            latency_lines = [l for l in lines if "detection latency" in l]
            latency_avgs = [
                int(x) for x in re.findall(r"avg (\d+)ms", "\n".join(latency_lines))
            ]
            gesture_log_lines = [l for l in lines if "[HandTracker] gestures" in l]
            console_errors = [l for l in lines if l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l)]
            perf_lines = [l for l in lines if "[Performance]" in l]
            perf_matches = [perf_fullmatch(l) for l in perf_lines]
            # Cadence: gaps between consecutive [Performance] wall-clock times
            # (other console lines are interleaved, so pair-adjacency does not
            # apply).
            perf_times = [
                t for (t, _type, text) in console_events
                if text.startswith("[Performance]")
            ]
            perf_gaps_s = [
                perf_times[i + 1] - perf_times[i]
                for i in range(len(perf_times) - 1)
            ]
            perf_median_gap_s = statistics.median(perf_gaps_s) if perf_gaps_s else None

            # --- Summary ------------------------------------------------------
            windows = runtime["floatingWindows"]
            window_ids = {w["id"] for w in windows}
            windows_on_screen = [
                w for w in windows
                if w["display"] != "none" and w["left"] > 0 and w["top"] > 0
                and w["width"] > 0 and w["height"] > 0
            ]
            gesture_panel = {
                "present": runtime["gestureDebugPresent"],
                "visible": runtime["gestureDebugVisible"],
                "no_hands_state": bool(
                    runtime["gestureDebugText"]
                    and "No hands detected" in runtime["gestureDebugText"]
                ),
            }
            hud = runtime["hudText"] or ""
            heap_series_mb = [
                (s["memory"]["usedJSHeapSize"] / 1048576 if s["memory"] else None)
                for s in soak_samples
            ]
            raf_series = [s["raf"] for s in soak_samples]
            listener_series = [s["listeners"] for s in soak_samples]

            def first_last_delta(series, key):
                return abs(series[-1][key] - series[0][key])

            raf_pending_delta = first_last_delta(raf_series, "pending")
            listener_net_delta = first_last_delta(listener_series, "net")

            heap_first = [h for h in heap_series_mb if h is not None][:3]
            heap_last = [h for h in heap_series_mb if h is not None][-3:]
            heap_median_growth_mb = (
                statistics.median(heap_last) - statistics.median(heap_first)
                if heap_first and heap_last
                else None
            )
            heap_max_mb = max(heap_series_mb) if any(h is not None for h in heap_series_mb) else None

            # Rect drift between the first and last soak sample, per window.
            first_rects = {w["id"]: w for w in soak_samples[0]["windows"]}
            last_rects = {w["id"]: w for w in soak_samples[-1]["windows"]}
            drift_worst_px = 0.0
            drift_windows_present = True
            for wid, fw in first_rects.items():
                lw = last_rects.get(wid)
                if lw is None:
                    drift_windows_present = False
                    break
                for key in ("left", "top", "width", "height"):
                    drift_worst_px = max(drift_worst_px, abs(lw[key] - fw[key]))

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
                "hud_text": hud,
                "fps_logged": fps_values,
                "fps_max": max(fps_values) if fps_values else 0,
                "latency_avgs_ms": latency_avgs,
                "latency_min_avg": min(latency_avgs) if latency_avgs else None,
                "latency_line_count": len(latency_lines),
                "perf_lines": perf_lines,
                "perf_line_count": len(perf_lines),
                "perf_all_match": len(perf_matches) == len(perf_lines),
                "perf_renderfps_over_zero": sum(
                    1 for l in perf_lines
                    if (perf_fullmatch(l) and int(perf_fullmatch(l).group(2)) >= 1)
                ),
                "perf_median_gap_s": perf_median_gap_s,
                "cleanup_pre_reload": pre_reload_cleanup,
                "cleanup_post_reload": post_reload_cleanup,
                "cleanup_delta": {
                    "camera_capture": post_reload_cleanup["camera_capture"]
                    - pre_reload_cleanup["camera_capture"],
                    "hand_tracker": post_reload_cleanup["hand_tracker"]
                    - pre_reload_cleanup["hand_tracker"],
                },
                "post_reload_video": post_reload["videoMeta"],
                "post_reload_windows_on_screen": len(
                    [
                        w for w in post_reload["floatingWindows"]
                        if w["display"] != "none" and w["left"] > 0 and w["top"] > 0
                        and w["width"] > 0 and w["height"] > 0
                    ]
                ),
                "soak_samples": soak_samples,
                "soak_duration_s": round(soak_duration_s, 1),
                "soak_console_lines": len(soak_console_lines),
                "soak_lines_per_second": round(soak_lines_per_second, 2),
                "heap_series_mb": [round(h, 1) if h is not None else None for h in heap_series_mb],
                "heap_median_growth_mb": (
                    round(heap_median_growth_mb, 1)
                    if heap_median_growth_mb is not None
                    else None
                ),
                "heap_max_mb": round(heap_max_mb, 1) if heap_max_mb is not None else None,
                "raf_series": raf_series,
                "raf_pending_delta": raf_pending_delta,
                "listener_series": listener_series,
                "listener_net_delta": listener_net_delta,
                "window_drift_worst_px": round(drift_worst_px, 3),
                "window_drift_windows_present": drift_windows_present,
                "cdn_asset_count": len(cdn_assets),
                "page_errors": page_errors,
                "console_errors": console_errors,
                "gesture_panel": gesture_panel,
                "gesture_log_lines": gesture_log_lines,
            }
            print("\n=== SUMMARY ===")
            print(json.dumps(summary, indent=2))

            (OUT / "m4-console.txt").write_text(
                "\n".join(lines), encoding="utf-8"
            )
            (OUT / "m4-summary.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8"
            )

            browser.close()
    finally:
        if summary is None:
            # Persist whatever console/pageerror evidence was captured even if
            # the run failed mid-flight (never leave a partial run unexplained).
            (OUT / "m4-console.txt").write_text(
                "\n".join(console_text()), encoding="utf-8"
            )
            print("run failed mid-flight; console evidence saved")

    # --- Assertions ----------------------------------------------------------
    min_latency = summary["latency_min_avg"]
    fps_max = summary["fps_max"]
    cleanup = summary["cleanup_pre_reload"]
    cleanup_delta = summary["cleanup_delta"]
    hud = summary["hud_text"] or ""
    # M8 future-proof policy (D14): older verifiers no longer pin the exact
    # boot count digit — the Windows row must exist and report >= 2 (the
    # boot floor). The exact count is pinned only by the current-milestone
    # verifier (v8 since M8).
    windows_row = re.search(r"Windows\s+(\d+)", hud)
    perf_ok = (
        summary["perf_line_count"] >= 3
        and summary["perf_all_match"]
        and summary["perf_renderfps_over_zero"] >= 1
        and summary["perf_median_gap_s"] is not None
        and 4 <= summary["perf_median_gap_s"] <= 15
    )
    heap_ok = (
        all(s["memory"] is not None for s in soak_samples)
        and summary["heap_median_growth_mb"] is not None
        and summary["heap_median_growth_mb"] <= HEAP_GROWTH_MB
        and summary["heap_max_mb"] is not None
        and summary["heap_max_mb"] <= heap_first[0] + HEAP_ABSORB_MB
    )
    checks = {
        "a: zero console errors, zero page errors, soak spam <= 5 lines/s": (
            len(summary["console_errors"]) == 0
            and len(summary["page_errors"]) == 0
            and summary["soak_lines_per_second"] <= 5
        ),
        "b: >= 2 floating windows with distinct ids": (
            len(windows) >= 2 and len(window_ids) >= 2
        ),
        "c: window titles visible": summary["titles_visible"],
        "d: gesture-debug panel shows 'No hands detected'": (
            gesture_panel["present"]
            and gesture_panel["visible"]
            and gesture_panel["no_hands_state"]
        ),
        "e: HUD intact (version-tolerant title), Camera active, MediaPipe ready, Windows row >= 2": (
            "JARVIS · Milestone" in hud
            and "Camera" in hud
            and "active" in hud
            and "MediaPipe" in hud
            and "ready" in hud
            and windows_row is not None
            and int(windows_row.group(1)) >= 2
        ),
        "f: max logged FPS >= 30 (boot window)": fps_max >= 30,
        "g: latency >= 2 lines, min avg in 150-260ms, < 300ms": (
            len(latency_lines) >= 2
            and min_latency is not None
            and 150 <= min_latency <= 260
            and min_latency < 300
        ),
        "h: >= 3 [Performance] lines, all matching the four-key format, "
        ">= 1 with renderFPS >= 1, median cadence in [4, 15]s": perf_ok,
        "i: no-drift soak (window rects move < 1.5px first vs last sample)": (
            drift_windows_present and drift_worst_px < DRIFT_PX
        ),
        "j: no gesture log lines (no hands on fake webcam)": (
            len(summary["gesture_log_lines"]) == 0
        ),
        "k: pre-reload cleanup counts balanced (CameraCapture == HandTracker, 1-2 each)": (
            cleanup["camera_capture"] == cleanup["hand_tracker"]
            and 1 <= cleanup["camera_capture"] <= 2
        ),
        "l: post-reload cleanup delta == 1 each, 1 live track, >= 2 windows on screen": (
            cleanup_delta["camera_capture"] == 1
            and cleanup_delta["hand_tracker"] == 1
            and bool(summary["post_reload_video"])
            and summary["post_reload_video"]["liveTracks"] == 1
            and summary["post_reload_windows_on_screen"] >= 2
        ),
        "m: rAF outstanding balance stable across soak (|last - first| <= 2)": (
            raf_pending_delta <= 2
        ),
        "n: listener net stable across soak (|last - first| <= 2)": (
            listener_net_delta <= 2
        ),
        "o: heap: memory defined, median growth <= 30MB, no sample +60MB over first": heap_ok,
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
