"""JARVIS Milestone 8 browser verification (Playwright, fake webcam).

Launches headless Chromium with --use-fake-device-for-media-stream and
--use-fake-ui-for-media-stream (auto-allowed synthetic camera), loads the
frontend dev server, and verifies Phase 3 part 1 — the app-window
framework, Dashboard + Notes apps, and local persistence:
  a) zero console errors AND zero page errors (whole session, both page loads)
  b) boot scene invariant (tier 2 since M9): >= 2 app windows, ids include
     dashboard-1 + notes-1, all boot windows fully on screen (the exact
     boot set/count is pinned only by the current-milestone verifier)
  c) boot titles visible: Dashboard and Notes in window text
  d) pairwise-distinct projected positions at boot (tuples, lefts, tops)
  e) HUD title present (version-tolerant since M9), Camera active,
     MediaPipe ready, Windows row >= 2 (exact pins live in v9 since M9)
  f) Dashboard stats render with values (CPU integer >= 1, NET/MEM/HEAP
     non-empty; '—' fallback counts as rendered)
  g) Notes textarea present and empty at first boot (fresh profile)
  h) live ticker: dash-clock advances across a 1.2 s sample pair
  i) launcher: open-notes click adds notes-2 fully on screen; zero new
     errors (chat/search enablement is v9/v10's pin)
  j) notes persist: debounce writes jarvis:note:notes-1; reload restores
     the textarea value (localStorage survived)
  k) two notes windows are independent (distinct keys, no clobbering)
  l) AppContext controls: maximize error-free on a visible window;
     minimize hides it
  m) chrome close removes the window AND the unmount flush saved the
     mid-debounce text
  n) >= 1 "[Performance]" line, EVERY line matching the M4 four-key format
  o) latency >= 2 lines, min avg in 150-260ms, < 300ms
  p) cleanup counts balanced across the session (CameraCapture ==
     HandTracker, 2-4 each with the reload)
  q) exactly 1 live video track (post-reload introspection)
  r) max logged FPS >= 30 (boot window)
  s) no gesture log lines (no hands on fake webcam)

Honest scope notes:
  (1) the fake webcam produces no hands, so gesture interactions with app
      windows remain unit-evidenced (interactionEngine/windowManager
      suites); this script adds the first INTERACTIVE app-level
      verification (launcher clicks, typing, reload persistence, app and
      chrome window controls).
  (2) AppContext.maximize's restore-if-minimized branch cannot be
      exercised browser-side (a minimized window's controls are hidden by
      design, D12) — the visible-window half is proven here (check l), the
      restore branch is code-review verified.

Usage: python verify_milestone8.py [base_url]
Evidence (m8-scene.png, m8-full.png, m8-console.txt, m8-summary.json) is
written to docs/screenshots/.
"""
import json
import re
import sys
from pathlib import Path
from uuid import uuid4

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
          const allDivs = [...document.querySelectorAll('div')];
          // Version-tolerant since M9 (the title moved to Milestone 9);
          // the current-milestone verifier v9 owns the exact pin (D14).
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
          const dash = (testid) => {
            const el = document.querySelector(
              '[data-window-id="dashboard-1"] [data-testid="' + testid + '"]');
            return el ? { present: true, text: el.innerText } : { present: false, text: null };
          };
          const notes1 = document.querySelector(
            '[data-window-id="notes-1"] [data-testid="notes-textarea"]');
          const launcherEntry = (testid) => {
            const el = document.querySelector(
              '[data-window-id="dashboard-1"] [data-testid="' + testid + '"]');
            return el
              ? { present: true, disabled: el.disabled === true }
              : { present: false, disabled: null };
          };
          return {
            videoMeta,
            floatingWindows,
            hudText: hud ? hud.innerText : null,
            resetButton: { present: !!resetButton },
            viewport: { width: window.innerWidth, height: window.innerHeight },
            notes1Value: notes1 ? notes1.value : null,
            dashRows: {
              clock: dash('dash-clock'),
              cpu: dash('dash-cpu'),
              memory: dash('dash-memory'),
              heap: dash('dash-heap'),
              network: dash('dash-network'),
            },
            launcher: {
              openDashboard: launcherEntry('launcher-open-dashboard'),
              openNotes: launcherEntry('launcher-open-notes'),
            },
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


def error_snapshot() -> tuple:
    return (
        len([l for l in console_lines if l.startswith("[error]") and not KNOWN_OFFLINE_NOISE.match(l)]),
        len(page_errors),
    )


def main() -> None:
    runtime1: dict | None = None
    runtime2: dict | None = None
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
            # inference loop (same budget as v7).
            page.wait_for_timeout(14000)

            page.screenshot(path=str(OUT / "m8-scene.png"))
            page.screenshot(path=str(OUT / "m8-full.png"), full_page=True)

            runtime1 = runtime_introspection(page)
            print("runtime #1:", json.dumps(runtime1, indent=2))

            # --- Clock ticker probe (check h) --------------------------------
            clock_before = page.evaluate(
                """() => {
                  const el = document.querySelector(
                    '[data-window-id="dashboard-1"] [data-testid="dash-clock"]');
                  return el ? el.innerText : null;
                }"""
            )
            page.wait_for_timeout(1200)
            clock_after = page.evaluate(
                """() => {
                  const el = document.querySelector(
                    '[data-window-id="dashboard-1"] [data-testid="dash-clock"]');
                  return el ? el.innerText : null;
                }"""
            )

            # --- Launcher probe (check i) ------------------------------------
            launcher_pre = runtime1["launcher"]
            errors_before_launcher = error_snapshot()
            page.click(
                '[data-window-id="dashboard-1"] [data-testid="launcher-open-notes"]'
            )
            page.wait_for_timeout(1000)
            errors_after_launcher = error_snapshot()
            windows_after_launcher = page.evaluate(
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

            # --- Notes persistence (checks j/k) ------------------------------
            marker_a = f"m8 persistence {uuid4().hex[:8]}"
            marker_b = f"m8 second notes {uuid4().hex[:8]}"
            page.fill(
                '[data-window-id="notes-1"] [data-testid="notes-textarea"]',
                marker_a,
            )
            page.wait_for_timeout(800)  # debounce 500 ms
            stored_a = page.evaluate(
                "() => localStorage.getItem('jarvis:note:notes-1')"
            )
            page.fill(
                '[data-window-id="notes-2"] [data-testid="notes-textarea"]',
                marker_b,
            )
            page.wait_for_timeout(800)
            stored_b = page.evaluate(
                "() => localStorage.getItem('jarvis:note:notes-2')"
            )
            stored_a_after_b = page.evaluate(
                "() => localStorage.getItem('jarvis:note:notes-1')"
            )

            # --- Reload (check j part 2 / q) ---------------------------------
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(14000)
            runtime2 = runtime_introspection(page)
            print("runtime #2:", json.dumps(runtime2, indent=2))

            # --- AppContext controls, part 1: maximize (check l) -------------
            errors_before_max = error_snapshot()
            page.click(
                '[data-window-id="dashboard-1"] [data-testid="appctl-maximize"]'
            )
            page.wait_for_timeout(500)
            errors_after_max = error_snapshot()
            dash_after_max = page.evaluate(
                """() => {
                  const el = document.querySelector(
                    '[data-window-id="dashboard-1"]');
                  const rect = el ? el.getBoundingClientRect() : null;
                  return {
                    present: !!el,
                    display: el ? getComputedStyle(el).display : null,
                    left: rect ? rect.left : null,
                    top: rect ? rect.top : null,
                    width: rect ? rect.width : null,
                    height: rect ? rect.height : null,
                  };
                }"""
            )

            # --- Unmount flush + chrome close (check m) ----------------------
            # (the dashboard launcher is still reachable: the minimize probe
            # runs LAST — a minimized window's content is unreachable by
            # design, D12)
            page.click(
                '[data-window-id="dashboard-1"] [data-testid="launcher-open-notes"]'
            )
            page.wait_for_timeout(800)
            marker_c = f"m8 close flush {uuid4().hex[:8]}"
            page.fill(
                '[data-window-id="notes-2"] [data-testid="notes-textarea"]',
                marker_c,
            )
            # IMMEDIATELY close via the chrome button (before the 500 ms
            # debounce fires) — the unmount flush must save the text.
            errors_before_close = error_snapshot()
            page.click(
                '[data-window-id="notes-2"] button[aria-label="Close Notes"]'
            )
            page.wait_for_timeout(600)
            errors_after_close = error_snapshot()
            notes2_gone = page.evaluate(
                """() => !document.querySelector('[data-window-id="notes-2"]')"""
            )
            stored_c = page.evaluate(
                "() => localStorage.getItem('jarvis:note:notes-2')"
            )
            windows_after_close = page.evaluate(
                """() => [...document.querySelectorAll(
                    '[data-testid="floating-window"]')].map((el) => ({
                  id: el.getAttribute('data-window-id'),
                  display: getComputedStyle(el).display,
                }))"""
            )

            # --- AppContext controls, part 2: minimize (check l) -------------
            errors_before_min = error_snapshot()
            page.click(
                '[data-window-id="dashboard-1"] [data-testid="appctl-minimize"]'
            )
            page.wait_for_timeout(500)
            errors_after_min = error_snapshot()
            dash_display_after_min = page.evaluate(
                """() => getComputedStyle(document.querySelector(
                    '[data-window-id="dashboard-1"]')).display"""
            )

            # --- Summary ------------------------------------------------------
            # Console-derived metrics span the WHOLE session (both page
            # loads — the reload adds a second cleanup pair, so these are
            # computed only after every probe).
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

            windows1 = runtime1["floatingWindows"]
            window_ids1 = {w["id"] for w in windows1}
            viewport = runtime1["viewport"]
            windows1_on_screen = [
                w for w in windows1 if fully_on_screen(w, viewport)
            ]
            combined_window_text = " ".join(w["text"] for w in windows1)
            lefts = [w["left"] for w in windows1]
            tops = [w["top"] for w in windows1]
            positions_distinct = (
                len({(round(w["left"], 3), round(w["top"], 3)) for w in windows1})
                == len(windows1)
                and len({round(l, 3) for l in lefts}) == len(windows1)
                and len({round(t, 3) for t in tops}) == len(windows1)
            )
            windows2 = runtime2["floatingWindows"]
            window_ids2 = {w["id"] for w in windows2}
            windows2_on_screen = [
                w for w in windows2 if fully_on_screen(w, runtime2["viewport"])
            ]
            notes2_on_screen = any(
                w["id"] == "notes-2" and fully_on_screen(w, viewport)
                for w in windows_after_launcher
            )
            dashboard_text = next(
                (w["text"] for w in windows1 if w["id"] == "dashboard-1"), ""
            )
            notes_text = next(
                (w["text"] for w in windows1 if w["id"] == "notes-1"), ""
            )
            dash_rows = runtime1["dashRows"]
            cpu_match = re.search(r"(\d+)", dash_rows["cpu"]["text"] or "")
            launcher = runtime1["launcher"]

            summary = {
                "video": runtime1["videoMeta"],
                "floating_windows": windows1,
                "window_ids": sorted(window_ids1),
                "windows_on_screen": windows1_on_screen,
                "titles_visible": (
                    "Dashboard" in dashboard_text and "Notes" in notes_text
                ),
                "positions_distinct": positions_distinct,
                "hud_text": runtime1["hudText"],
                "reset_button": runtime1["resetButton"],
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
                "gesture_log_lines": gesture_log_lines,
                "notes1_value_first_boot": runtime1["notes1Value"],
                "notes1_value_after_reload": runtime2["notes1Value"],
                "notes1_marker": marker_a,
                "clock_ticker": {"before": clock_before, "after": clock_after},
                "launcher_probe": {
                    "pre": launcher,
                    "notes2_on_screen": notes2_on_screen,
                    "errors_before": list(errors_before_launcher),
                    "errors_after": list(errors_after_launcher),
                },
                "persistence": {
                    "stored_a": stored_a,
                    "stored_b": stored_b,
                    "stored_a_after_b": stored_a_after_b,
                },
                "post_reload": {
                    "window_ids": sorted(window_ids2),
                    "windows_on_screen": len(windows2_on_screen),
                    "live_tracks": runtime2["videoMeta"]["liveTracks"]
                    if runtime2["videoMeta"]
                    else 0,
                },
                "appctl_probe": {
                    "maximize_errors_before": list(errors_before_max),
                    "maximize_errors_after": list(errors_after_max),
                    "dashboard_after_max": dash_after_max,
                    "minimize_errors_before": list(errors_before_min),
                    "minimize_errors_after": list(errors_after_min),
                    "dashboard_display_after_min": dash_display_after_min,
                },
                "close_probe": {
                    "errors_before": list(errors_before_close),
                    "errors_after": list(errors_after_close),
                    "notes2_gone": notes2_gone,
                    "stored_c": stored_c,
                    "windows_after_close": windows_after_close,
                },
            }

            print("\n=== SUMMARY ===")
            print(json.dumps(summary, indent=2))

            (OUT / "m8-console.txt").write_text(
                "\n".join(console_lines), encoding="utf-8"
            )
            (OUT / "m8-summary.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8"
            )

            browser.close()
    finally:
        if summary is None:
            # Persist whatever console/pageerror evidence was captured even if
            # the run failed mid-flight (never leave a partial run unexplained).
            (OUT / "m8-console.txt").write_text(
                "\n".join(console_lines), encoding="utf-8"
            )
            print("run failed mid-flight; console evidence saved")

    # --- Assertions ----------------------------------------------------------
    min_latency = summary["latency_min_avg"]
    fps_max = summary["fps_max"]
    cleanup = summary["cleanup_counts"]
    hud = summary["hud_text"] or ""
    windows_row = re.search(r"Windows\s+(\d+)", hud)
    perf_ok = (
        summary["perf_line_count"] >= 1
        and summary["perf_all_match"]
    )
    dash_ok = bool(
        dash_rows["cpu"]["present"]
        and cpu_match
        and int(cpu_match.group(1)) >= 1
        and dash_rows["network"]["present"]
        and bool((dash_rows["network"]["text"] or "").strip())
        and dash_rows["memory"]["present"]
        and bool((dash_rows["memory"]["text"] or "").strip())
        and dash_rows["heap"]["present"]
        and bool((dash_rows["heap"]["text"] or "").strip())
    )
    post_reload = summary["post_reload"]
    launcher_probe = summary["launcher_probe"]
    appctl = summary["appctl_probe"]
    close_probe = summary["close_probe"]
    persistence = summary["persistence"]
    stored_a_decoded = json.loads(persistence["stored_a"]) if persistence["stored_a"] else None
    stored_b_decoded = json.loads(persistence["stored_b"]) if persistence["stored_b"] else None
    stored_c_decoded = json.loads(close_probe["stored_c"]) if close_probe["stored_c"] else None
    dash_after_max = appctl["dashboard_after_max"]
    dash_rect_ok = (
        dash_after_max["present"]
        and dash_after_max["display"] == "block"
        and dash_after_max["left"] > 0
        and dash_after_max["top"] > 0
        and dash_after_max["left"] + dash_after_max["width"] <= viewport["width"]
        and dash_after_max["top"] + dash_after_max["height"] <= viewport["height"]
    )
    notes2_after_close = [
        w for w in close_probe["windows_after_close"] if w["id"] == "notes-2"
    ]
    notes1_after_close = [
        w for w in close_probe["windows_after_close"] if w["id"] == "notes-1"
    ]
    checks = {
        "a: zero console errors and zero page errors (whole session, both page loads)": (
            len(summary["console_errors"]) == 0 and len(summary["page_errors"]) == 0
        ),
        "b: boot scene invariant: >= 2 app windows incl. dashboard-1 + notes-1, all fully on screen": (
            len(windows1) >= 2
            and {"dashboard-1", "notes-1"} <= window_ids1
            and len(windows1_on_screen) == len(windows1)
        ),
        "c: boot titles visible: Dashboard and Notes in window text": (
            summary["titles_visible"]
        ),
        "d: pairwise-distinct projected positions at boot (tuples, lefts, tops)": (
            summary["positions_distinct"]
        ),
        "e: HUD title present, Camera active, MediaPipe ready, Windows row >= 2": (
            "JARVIS · Milestone" in hud
            and "Camera" in hud
            and "active" in hud
            and "MediaPipe" in hud
            and "ready" in hud
            and windows_row is not None
            and int(windows_row.group(1)) >= 2
        ),
        "f: Dashboard stats render with values": dash_ok,
        "g: Notes textarea present and empty at first boot (fresh profile)": (
            runtime1["notes1Value"] == ""
        ),
        "h: live ticker: dash-clock advances across a 1.2 s sample pair": (
            summary["clock_ticker"]["before"] is not None
            and summary["clock_ticker"]["after"] is not None
            and summary["clock_ticker"]["before"] != summary["clock_ticker"]["after"]
        ),
        "i: launcher: open-notes click adds notes-2 fully on screen; zero new errors": (
            launcher_probe["pre"]["openDashboard"]["present"]
            and launcher_probe["pre"]["openNotes"]["present"]
            and launcher_probe["notes2_on_screen"]
            and launcher_probe["errors_before"] == launcher_probe["errors_after"]
        ),
        "j: notes persist: debounce writes jarvis:note:notes-1; reload restores the textarea value (localStorage survived)": (
            stored_a_decoded == summary["notes1_marker"]
            and summary["notes1_value_after_reload"] == summary["notes1_marker"]
        ),
        "k: two notes windows are independent (distinct keys, no clobbering)": (
            stored_b_decoded == marker_b
            and persistence["stored_a_after_b"] == persistence["stored_a"]
        ),
        "l: AppContext controls: maximize error-free on a visible window; minimize hides it": (
            appctl["maximize_errors_before"] == appctl["maximize_errors_after"]
            and dash_rect_ok
            and appctl["minimize_errors_before"] == appctl["minimize_errors_after"]
            and appctl["dashboard_display_after_min"] == "none"
        ),
        "m: chrome close removes the window AND the unmount flush saved the mid-debounce text": (
            close_probe["notes2_gone"]
            and stored_c_decoded == marker_c
            and len(close_probe["windows_after_close"]) >= 2
            and len(notes2_after_close) == 0
            and len(notes1_after_close) == 1
            and close_probe["errors_before"] == close_probe["errors_after"]
        ),
        "n: >= 1 [Performance] line, every line matching the M4 four-key format": (
            perf_ok
        ),
        "o: latency >= 2 lines, min avg in 150-260ms, < 300ms": (
            len(latency_lines) >= 2
            and min_latency is not None
            and 150 <= min_latency <= 260
            and min_latency < 300
        ),
        "p: cleanup counts balanced across the session (CameraCapture == HandTracker, 2-4 each with the reload)": (
            cleanup["camera_capture"] == cleanup["hand_tracker"]
            and 2 <= cleanup["camera_capture"] <= 4
        ),
        "q: exactly 1 live video track (post-reload introspection)": (
            post_reload["live_tracks"] == 1
        ),
        "r: max logged FPS >= 30 (boot window)": fps_max >= 30,
        "s: no gesture log lines (no hands on fake webcam)": (
            len(summary["gesture_log_lines"]) == 0
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
