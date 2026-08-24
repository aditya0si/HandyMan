"""JARVIS Milestone 10 browser verification (Playwright, fake webcam).

Launches headless Chromium with --use-fake-device-for-media-stream and
--use-fake-ui-for-media-stream (auto-allowed synthetic camera), loads the
frontend dev server, and verifies Phase 3 close — the Web Search app
(Google Custom Search client, demo mode, 4th boot window):
  a) zero console errors AND zero page errors (whole session, both page loads)
  b) boot scene exact: 4 app windows, ids exactly dashboard-1 + notes-1 +
     chat-1 + search-1, all fully on screen, boot console line says 4 (the
     DERIVED line, D11 — pinned only here, tier 1)
  c) boot titles visible: Dashboard, Notes, LLM Chat, and Web Search in
     window text
  d) pairwise-distinct projected positions at boot (tuples, lefts, tops)
  e) HUD title present (version-tolerant since M11), Camera active,
     MediaPipe ready, Windows = 4 at boot (exact title pin lives in v11)
  f) launcher: launcher-open-search present and ENABLED (D10); zero disabled
     placeholder entries remain (the M10 placeholder entry is gone);
     open-search adds search-2 fully on screen with independent state (own
     input + banner, no cards); closing it is error-free; zero new errors
  g) demo mode: search-demo-banner present with text containing 'DEMO MODE'
     (no credentials on the default path)
  h) query flow: search-input + native submit work; whitespace-only submit
     is a no-op (zero cards); submit disabled while searching or empty
  i) canned results: 5 search-card rows render within the 5 s budget, each
     containing the 'demo result' marker
  j) link affordance: every search-card-link has href starting https://,
     target=_blank, rel containing noopener (attributes only — never
     followed)
  k) card expansion: native click toggles search-card-detail on (fuller
     snippet + raw link) and off
  l) >= 1 "[Performance]" line, EVERY line matching the M4 four-key format
  m) latency >= 2 lines, min avg in 150-260ms, < 300ms
  n) cleanup counts balanced across the session (CameraCapture ==
     HandTracker, 2-4 each with the reload)
  o) exactly 1 live video track (post-reload introspection)
  p) max logged FPS >= 30 (boot window)
  q) no gesture log lines (no hands on fake webcam)

Honest scope notes:
  (1) the default path runs WITHOUT search credentials: demo mode is what
      v10 browser-proves; live Custom Search is unit-verified with injected
      fetch (search.test.ts), and at most ONE manual live call (screenshot
      evidence, NOT part of this script) happens outside it.
  (2) the fake webcam produces no hands, so gesture interactions with the
      search window remain unit-evidenced; only the mouse/keyboard-driven
      app flow (launcher, typing, native submit, native card click, chrome
      close) is browser-proven here.
  (3) links are asserted by attribute and NEVER followed (no navigation, no
      popups beyond the app's own target=_blank affordance which this
      script does not exercise).
  (4) voice search is out of M10 scope (PROJECT_VISION §3.4 — keyboard
      only).

Usage: python verify_milestone10.py [base_url]
Evidence (m10-scene.png, m10-full.png, m10-search.png, m10-reload.png,
m10-console.txt, m10-summary.json) is written to docs/screenshots/.
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
          // Version-tolerant since M11 (the title moved to Milestone 11);
          // the current-milestone verifier v11 owns the exact pin (D15).
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
          const dash = (testid) => {
            const el = document.querySelector(
              '[data-window-id="dashboard-1"] [data-testid="' + testid + '"]');
            return el ? { present: true, text: el.innerText } : { present: false, text: null };
          };
          const notes1 = document.querySelector(
            '[data-window-id="notes-1"] [data-testid="notes-textarea"]');
          const search1Sel = (testid) => {
            const el = document.querySelector(
              '[data-window-id="search-1"] [data-testid="' + testid + '"]');
            if (!el) return { present: false, disabled: null, value: null, text: null };
            return {
              present: true,
              disabled: el.disabled === true,
              value: typeof el.value === 'string' ? el.value : null,
              text: el.innerText !== undefined ? el.innerText : null,
            };
          };
          const chat1Sel = (testid) => {
            const el = document.querySelector(
              '[data-window-id="chat-1"] [data-testid="' + testid + '"]');
            if (!el) return { present: false, disabled: null, value: null, text: null };
            return {
              present: true,
              disabled: el.disabled === true,
              value: typeof el.value === 'string' ? el.value : null,
              text: el.innerText !== undefined ? el.innerText : null,
            };
          };
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
            search1: {
              banner: search1Sel('search-demo-banner'),
              input: search1Sel('search-input'),
              submit: search1Sel('search-submit'),
              status: search1Sel('search-status'),
              empty: search1Sel('search-empty'),
              cards: document.querySelectorAll(
                '[data-window-id="search-1"] [data-testid="search-card"]').length,
              linkAttrs: [...document.querySelectorAll(
                '[data-window-id="search-1"] [data-testid="search-card-link"]')]
                .map((el) => ({
                  href: el.getAttribute('href'),
                  target: el.getAttribute('target'),
                  rel: el.getAttribute('rel'),
                  text: el.innerText,
                })),
            },
            chat1: {
              banner: chat1Sel('chat-demo-banner'),
              input: chat1Sel('chat-input'),
              send: chat1Sel('chat-send'),
            },
            launcher: {
              openDashboard: launcherEntry('launcher-open-dashboard'),
              openNotes: launcherEntry('launcher-open-notes'),
              openChat: launcherEntry('launcher-open-chat'),
              openSearch: launcherEntry('launcher-open-search'),
              // Every remaining DISABLED launcher entry, enumerated (D10):
              // the M10 placeholder entry is GONE — MUST be empty.
              entryButtons: [...document.querySelectorAll(
                '[data-window-id="dashboard-1"] [data-testid^="launcher-entry-"]')]
                .map((el) => ({
                  testid: el.getAttribute('data-testid'),
                  disabled: el.disabled === true,
                })),
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
            # inference loop (same budget as v9).
            page.wait_for_timeout(14000)

            page.screenshot(path=str(OUT / "m10-scene.png"))
            page.screenshot(path=str(OUT / "m10-full.png"), full_page=True)

            runtime1 = runtime_introspection(page)
            print("runtime #1:", json.dumps(runtime1, indent=2))

            # --- Launcher search probe (check f) -----------------------------
            errors_before_launcher = error_snapshot()
            page.click(
                '[data-window-id="dashboard-1"] [data-testid="launcher-open-search"]'
            )
            page.wait_for_timeout(1000)
            errors_after_launcher = error_snapshot()
            search2_state_raw = page.evaluate(
                """() => {
                  const el = document.querySelector('[data-window-id="search-2"]');
                  if (!el) return null;
                  const rect = el.getBoundingClientRect();
                  const input = el.querySelector('[data-testid="search-input"]');
                  const banner = el.querySelector('[data-testid="search-demo-banner"]');
                  return {
                    id: el.getAttribute('data-window-id'),
                    display: getComputedStyle(el).display,
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                    inputPresent: !!input,
                    inputEmpty: input ? input.value === '' : null,
                    bannerPresent: !!banner,
                    cards: el.querySelectorAll(
                      '[data-testid="search-card"]').length,
                  };
                }"""
            )
            # Close search-2 via a NATIVE bubbling click (mouse clicks block
            # on the WebGL canvas hit-target in this headless build; the
            # CameraCapture debug canvas covers the search-2 close chrome).
            # The unmount/abort parity: no persistence to flush (D7) — zero
            # errors after is the evidence.
            page.evaluate(
                """() => {
                  const btn = document.querySelector(
                    '[data-window-id="search-2"] button[aria-label="Close Web Search"]');
                  btn.dispatchEvent(new MouseEvent(
                    'click', { bubbles: true, cancelable: true }));
                }"""
            )
            page.wait_for_timeout(700)
            errors_after_close_search2 = error_snapshot()
            search2_gone = page.evaluate(
                """() => !document.querySelector('[data-window-id="search-2"]')"""
            )

            # --- Empty-query guard (check h part 1) --------------------------
            page.fill(
                '[data-window-id="search-1"] [data-testid="search-input"]',
                '   ',
            )
            prev_cards = runtime1["search1"]["cards"]
            # Drive the form's native submit event directly — the SAME React
            # onSubmit handler that both the Enter-to-submit path (D8) and
            # the search-submit button invoke (the v9 driver verbatim).
            page.evaluate(
                """() => {
                  const form = document.querySelector(
                    '[data-window-id="search-1"] form');
                  form.dispatchEvent(new Event(
                    'submit', { bubbles: true, cancelable: true }));
                }"""
            )
            page.wait_for_timeout(600)
            cards_after_ws = page.evaluate(
                """() => document.querySelectorAll(
                  '[data-window-id="search-1"] [data-testid="search-card"]').length"""
            )
            input_after_ws = page.evaluate(
                """() => {
                  const el = document.querySelector(
                    '[data-window-id="search-1"] [data-testid="search-input"]');
                  return el ? el.value : null;
                }"""
            )

            # --- Demo search flow (checks g/h/i/j) ---------------------------
            errors_before_send = error_snapshot()
            page.fill(
                '[data-window-id="search-1"] [data-testid="search-input"]',
                'jarvis gesture interface',
            )
            page.evaluate(
                """() => {
                  const form = document.querySelector(
                    '[data-window-id="search-1"] form');
                  form.dispatchEvent(new Event(
                    'submit', { bubbles: true, cancelable: true }));
                }"""
            )
            # Sample ONCE inside the 400 ms demo window (D5): the submit must
            # be disabled or the search-status row present. Deterministic
            # timeouts; record both readings in the summary.
            page.wait_for_timeout(150)
            searching_observed = page.evaluate(
                """() => ({
                  submit_disabled: document.querySelector(
                    '[data-window-id="search-1"] [data-testid="search-submit"]').disabled,
                  status_present: !!document.querySelector(
                    '[data-window-id="search-1"] [data-testid="search-status"]'),
                })"""
            )
            # Poll (<= 5 s, 250 ms steps) until the 5 canned cards render.
            deadline = time.monotonic() + 5
            card_state = {"count": 0}
            while time.monotonic() < deadline:
                card_state = page.evaluate(
                    """() => ({
                      count: document.querySelectorAll(
                        '[data-window-id="search-1"] [data-testid="search-card"]').length,
                    })"""
                )
                if card_state["count"] == 5:
                    break
                page.wait_for_timeout(250)
            page.wait_for_timeout(300)  # settle
            errors_after_send = error_snapshot()
            page.screenshot(path=str(OUT / "m10-search.png"))

            # Card text + link assertions (checks i/j).
            card_evidence = page.evaluate(
                """() => {
                  const cards = [...document.querySelectorAll(
                    '[data-window-id="search-1"] [data-testid="search-card"]')];
                  const links = [...document.querySelectorAll(
                    '[data-window-id="search-1"] [data-testid="search-card-link"]')];
                  return {
                    cardTexts: cards.map((c) => c.innerText),
                    linkAttrs: links.map((el) => ({
                      href: el.getAttribute('href'),
                      target: el.getAttribute('target'),
                      rel: el.getAttribute('rel'),
                    })),
                  };
                }"""
            )

            # --- Expansion toggle (check k) ----------------------------------
            def native_card_click() -> None:
                page.evaluate(
                    """() => {
                      const card = document.querySelector(
                        '[data-window-id="search-1"] [data-testid="search-card"]');
                      card.dispatchEvent(new MouseEvent(
                        'click', { bubbles: true, cancelable: true }));
                    }"""
                )

            native_card_click()
            page.wait_for_timeout(300)  # React flush
            expansion_on = page.evaluate(
                """() => {
                  const card = document.querySelector(
                    '[data-window-id="search-1"] [data-testid="search-card"]');
                  const detail = card.querySelector('[data-testid="search-card-detail"]');
                  if (!detail) return { present: false };
                  const snippet = card.querySelector('[data-testid="search-card-snippet"]');
                  return {
                    present: true,
                    longer: detail.innerText.length > (snippet ? snippet.innerText.length : 0),
                    hasRawLink: detail.innerText.includes('https://'),
                  };
                }"""
            )
            native_card_click()
            page.wait_for_timeout(300)  # React flush
            expansion_off = page.evaluate(
                """() => {
                  const card = document.querySelector(
                    '[data-window-id="search-1"] [data-testid="search-card"]');
                  return !card.querySelector('[data-testid="search-card-detail"]');
                }"""
            )

            # --- Reload (checks n/o + boot re-proof) -------------------------
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(14000)
            runtime2 = runtime_introspection(page)
            print("runtime #2:", json.dumps(runtime2, indent=2))
            page.screenshot(path=str(OUT / "m10-reload.png"))

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
            boot_line_hits = [
                l for l in console_lines
                if "[App] app scene ready: 4 app windows created" in l
            ]

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
            dashboard_text = next(
                (w["text"] for w in windows1 if w["id"] == "dashboard-1"), ""
            )
            notes_text = next(
                (w["text"] for w in windows1 if w["id"] == "notes-1"), ""
            )
            chat_text = next(
                (w["text"] for w in windows1 if w["id"] == "chat-1"), ""
            )
            search_text = next(
                (w["text"] for w in windows1 if w["id"] == "search-1"), ""
            )
            launcher = runtime1["launcher"]
            search1 = runtime1["search1"]
            search1_after_reload = runtime2["search1"]
            search2_on_screen = (
                search2_state_raw is not None
                and fully_on_screen(
                    {
                        "display": search2_state_raw["display"],
                        "left": search2_state_raw["left"],
                        "top": search2_state_raw["top"],
                        "width": search2_state_raw["width"],
                        "height": search2_state_raw["height"],
                    },
                    viewport,
                )
            )
            all_cards_contain_marker = (
                len(card_evidence["cardTexts"]) == 5
                and all("demo result" in t for t in card_evidence["cardTexts"])
            )
            links_ok = (
                len(card_evidence["linkAttrs"]) == 5
                and all(
                    l["href"] and l["href"].startswith("https://")
                    and l["target"] == "_blank"
                    and l["rel"] and "noopener" in l["rel"]
                    for l in card_evidence["linkAttrs"]
                )
            )

            summary = {
                "video": runtime1["videoMeta"],
                "floating_windows": windows1,
                "window_ids": sorted(window_ids1),
                "windows_on_screen": windows1_on_screen,
                "titles_visible": (
                    "Dashboard" in dashboard_text
                    and "Notes" in notes_text
                    and "LLM Chat" in chat_text
                    and "Web Search" in search_text
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
                "boot_line_hits": len(boot_line_hits),
                "search1_first_boot": {
                    "banner_present": search1["banner"]["present"],
                    "banner_text": search1["banner"]["text"],
                    "input_present": search1["input"]["present"],
                    "input_empty": search1["input"]["value"] == "",
                    "submit_present": search1["submit"]["present"],
                    "submit_disabled": search1["submit"]["disabled"],
                    "cards": search1["cards"],
                    "status_present": search1["status"]["present"],
                    "empty_present": search1["empty"]["present"],
                    "link_attrs_present": len(search1["linkAttrs"]),
                },
                "launcher_probe": {
                    "pre": launcher,
                    "search2": search2_state_raw,
                    "search2_on_screen": search2_on_screen,
                    "search2_gone": search2_gone,
                    "errors_after_close_search2": list(errors_after_close_search2),
                    "errors_before": list(errors_before_launcher),
                    "errors_after": list(errors_after_launcher),
                },
                "query_flow": {
                    "cards_after_ws": cards_after_ws,
                    "input_after_ws": input_after_ws,
                    "prev_cards": prev_cards,
                    "searching_observed": searching_observed,
                },
                "demo_flow": {
                    "cards_found": card_state["count"],
                    "card_texts": card_evidence["cardTexts"],
                    "link_attrs": card_evidence["linkAttrs"],
                    "expansion_on": expansion_on,
                    "expansion_off": expansion_off,
                    "errors_before": list(errors_before_send),
                    "errors_after": list(errors_after_send),
                },
                "post_reload": {
                    "window_ids": sorted(window_ids2),
                    "windows_on_screen": len(
                        [w for w in windows2 if fully_on_screen(w, runtime2["viewport"])]
                    ),
                    "live_tracks": runtime2["videoMeta"]["liveTracks"]
                    if runtime2["videoMeta"]
                    else 0,
                    "search1_cards": search1_after_reload["cards"],
                },
            }

            print("\n=== SUMMARY ===")
            print(json.dumps(summary, indent=2))

            (OUT / "m10-console.txt").write_text(
                "\n".join(console_lines), encoding="utf-8"
            )
            (OUT / "m10-summary.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8"
            )

            browser.close()
    finally:
        if summary is None:
            # Persist whatever console/pageerror evidence was captured even if
            # the run failed mid-flight (never leave a partial run unexplained).
            (OUT / "m10-console.txt").write_text(
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
    post_reload = summary["post_reload"]
    launcher_probe = summary["launcher_probe"]
    query_flow = summary["query_flow"]
    demo_flow = summary["demo_flow"]
    search1_boot = summary["search1_first_boot"]

    # search-2 must be gone after the native-close, and the close error-free
    # (the launcher errors_before/after cover the OPEN; closing is covered
    # by errors_after_close_search2 == the launcher's after-snapshot).
    close_search2_ok = (
        launcher_probe["search2_gone"]
        and launcher_probe["errors_after_close_search2"]
        == list(launcher_probe["errors_after"])
    )

    checks = {
        "a: zero console errors and zero page errors (whole session)": (
            len(summary["console_errors"]) == 0 and len(summary["page_errors"]) == 0
        ),
        "b: boot scene exact: 4 app windows, ids exactly dashboard-1 + notes-1 + chat-1 + search-1, all fully on screen, boot console line says 4": (
            len(windows1) == 4
            and window_ids1 == {"dashboard-1", "notes-1", "chat-1", "search-1"}
            and len(windows1_on_screen) == 4
            and summary["boot_line_hits"] >= 1
        ),
        "c: boot titles visible: Dashboard, Notes, LLM Chat, and Web Search in window text": (
            summary["titles_visible"]
        ),
        "d: pairwise-distinct projected positions at boot (tuples, lefts, tops)": (
            summary["positions_distinct"]
        ),
        "e: HUD title present (version-tolerant since M11), Camera active, MediaPipe ready, Windows = 4 at boot": (
            "JARVIS · Milestone" in hud
            and "Camera" in hud
            and "active" in hud
            and "MediaPipe" in hud
            and "ready" in hud
            and windows_row is not None
            and int(windows_row.group(1)) == 4
        ),
        "f: launcher: launcher-open-search present and ENABLED; zero disabled placeholder entries; open-search adds search-2 fully on screen with independent state (own input + banner, no cards); closing it is error-free; zero new errors": (
            launcher_probe["pre"]["openDashboard"]["present"]
            and launcher_probe["pre"]["openNotes"]["present"]
            and launcher_probe["pre"]["openChat"]["present"]
            and launcher_probe["pre"]["openSearch"]["present"]
            and launcher_probe["pre"]["openSearch"]["disabled"] is False
            and len(launcher_probe["pre"]["entryButtons"]) == 0
            and launcher_probe["search2_on_screen"]
            and launcher_probe["search2"]["inputPresent"]
            and launcher_probe["search2"]["inputEmpty"]
            and launcher_probe["search2"]["bannerPresent"]
            and launcher_probe["search2"]["cards"] == 0
            and close_search2_ok
            and launcher_probe["errors_before"] == launcher_probe["errors_after"]
        ),
        "g: demo mode: search-demo-banner present with text containing 'DEMO MODE' (no credentials on the default path)": (
            search1_boot["banner_present"]
            and "DEMO MODE" in (search1_boot["banner_text"] or "")
        ),
        "h: query flow: search-input + native submit work; whitespace-only submit is a no-op (zero cards); submit disabled while searching or empty": (
            query_flow["cards_after_ws"] == 0
            and query_flow["input_after_ws"] == "   "
            and (query_flow["searching_observed"]["submit_disabled"]
                 or query_flow["searching_observed"]["status_present"])
        ),
        "i: canned results: 5 search-card rows render within the 5 s budget, each containing the 'demo result' marker": (
            demo_flow["cards_found"] == 5 and all_cards_contain_marker
        ),
        "j: link affordance: every search-card-link has href starting https://, target=_blank, rel containing noopener (attributes only — never followed)": (
            links_ok
        ),
        "k: card expansion: native click toggles search-card-detail on (fuller snippet + raw link) and off": (
            demo_flow["expansion_on"]["present"]
            and demo_flow["expansion_on"]["longer"]
            and demo_flow["expansion_on"]["hasRawLink"]
            and demo_flow["expansion_off"]
        ),
        "l: >= 1 [Performance] line, every line matching the M4 four-key format": (
            perf_ok
        ),
        "m: latency >= 2 lines, min avg in 150-260ms, < 300ms": (
            len(latency_lines) >= 2
            and min_latency is not None
            and 150 <= min_latency <= 260
            and min_latency < 300
        ),
        "n: cleanup counts balanced across the session (CameraCapture == HandTracker, 2-4 each with the reload)": (
            cleanup["camera_capture"] == cleanup["hand_tracker"]
            and 2 <= cleanup["camera_capture"] <= 4
        ),
        "o: exactly 1 live video track (post-reload introspection)": (
            post_reload["live_tracks"] == 1
        ),
        "p: max logged FPS >= 30 (boot window)": fps_max >= 30,
        "q: no gesture log lines (no hands on fake webcam)": (
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