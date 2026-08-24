# M15 Coder Brief — Edge cases, error handling, monitoring (Phase 5 part 2)

Self-authored (solo mode). Scope: the M15 milestone prompt verbatim — a
STABILITY milestone ("a user should not be able to tell the app apart
visually except for the new error counter"). Standing constraints: NOT a git
repo; no new npm deps; no backend protocol changes; no deployment (M16); no
MediaPipe API swap; 305+43 tests keep passing; verifiers 1–14 keep passing
(title lockstep excepted); latency band holds (~200–215ms); zero console
errors on the healthy path. Skills consulted: clean-code-guard + test-guard +
docs-guard (README M15) + webapp-testing (verifier).

## Decisions

- **D1 camera failure classification — `utils/cameraErrors.ts` (node-pure)**.
  One `classifyCameraAccessError(err)` maps a caught `getUserMedia` rejection
  to `{ state: 'unsupported' | 'error', message }` by `DOMException.name`:
  `NotAllowedError`/`PermissionDeniedError` → denied;
  `NotFoundError`/`DevicesNotFoundError` → no-device; `NotReadableError`/
  `TrackStartError`/`OverconstrainedError`/anything-else → busy. The two
  existing message strings (permission, unavailable/busy) are preserved
  VERBATIM; NO_DEVICE and DISCONNECTED are added. Node has a real
  `DOMException`, so vitest covers every row with genuine DOMExceptions.
  CameraCapture imports the classifier (constants migrate here).
- **D2 track-ended monitor — same module**. `monitorTrackEnded(tracks,
  onEnded)` subscribes ONE 'ended' listener per live video track (structural
  track-like: addEventListener/removeEventListener/readyState/stop — node
  fakes satisfy it) and returns an unsubscribe. It is what makes the
  mid-session camera-loss transition unit-testable without a DOM.
- **D3 CameraCapture wiring**. After `notifyState('active')`, the effect
  calls `monitorTrackEnded(video.getVideoTracks(), onEnded)`. On 'ended':
  ONE `console.log('[CameraCapture] video track ended; transitioning to
  error')`, stop every track of OUR stream, cancel the rAF loop, set
  `cancelled = true` (so the loop and any in-flight async can't re-run),
  `notifyState('error')` + the DISCONNECTED banner — the EXISTING ErrorBanner
  + Retry path (Retry re-runs startCamera). `monitorTrackEnded`'s unsubscribe
  joins the effect cleanup so StrictMode re-mounts never double-subscribe.
  Guard: the monitor fires at most once (its own unsubscribe-on-fire).
  The existing replaced-by-tracker-camera path is untouched.
- **D4 degraded tracking — `utils/degradedTracking.ts` (node-pure)**.
  `DegradedTrackingDetector.feed(now, confidences)` accumulates hands-present
  frames; a zero-hand frame or a completed window resets. When a full
  `DEGRADED_TRACKING_WINDOW_MS` (5000) window of hands-present samples has
  mean confidence < `DEGRADED_TRACKING_CONFIDENCE_THRESHOLD` (0.5), it returns
  true (emits) and resets — so the warning is ONE throttled console.warn per
  sustained-low-confidence window, no new UI surface. Constants exported from
  the util AND re-exported from HandTracker (brief: "export the constants").
  HandTracker feeds `detectedHands.map(h => h.confidence)` on every
  `onResults` tick and warns with lighting/occlusion guidance on emit.
- **D5 error collector — `utils/errors.ts` (node-pure singleton)**.
  `errorCollector` installs window 'error' + 'unhandledrejection' listeners
  (idempotent, window injectable → node fakes exercise it). `record(message)`
  is the core: dedupes by message (distinct-message set), caps storage at
  `MAX_STORED_ERRORS` (50) with occurrence counts + lastAt, notifies
  subscribers, and logs ONE throttled `console.warn('[Errors] N distinct
  error(s) captured')` per `ERROR_LOG_THROTTLE_MS` (30s) — never on the
  healthy path, and a WARN not an error so the zero-error console gates stay
  honest. `getCount()` = distinct messages, `getSnapshot()`, `clear()`,
  `subscribe()`. Resource-load failure events (message-less `ErrorEvent`)
  get a synthesized 'unhandled resource load error' label.
- **D6 HUD Errors row**. HUD gains an `Errors` row (`data-testid="hud-errors"`,
  value = count; renders dim '0' by default; only a non-zero count stands out —
  red). App subscribes via a `useEffect` → `errorCollector.subscribe(() =>
  setErrorCount(errorCollector.getCount()))` (unmount unsubscribes; lazy
  initial state). `main.tsx` calls `errorCollector.install()` once (module
  scope; StrictMode-inert; idempotent across the rare HMR re-load).
- **D7 WS reconnect cap + terminal 'offline' — `utils/sync.ts`**.
  `SyncStatus` gains `'offline'`. `SYNC_MAX_RECONNECT_ATTEMPTS = 8`. The
  budget applies ONLY after a connection was once established
  (`wasConnectedOnce`, set in `onopen`): each failed restoration cycle
  (probe-fail in the reconnect loop) increments; on exhaustion the manager
  `setStatus('offline')` + the existing single '[Sync] offline' line and the
  probe loop RETURNS (terminal, zero retained timers — this is the "final
  offline state" the prompt asks to decide/add). The NEVER-connected boot
  path is UNCHANGED — it keeps probing forever at the capped 5s backoff, so a
  backend that starts later auto-connects on the same session (the M11
  promise, re-asserted live by v15). `onopen` resets the counter.
  `setStatus` 'offline' → HUD renders 'offline'. Recovery after the cap is a
  page reload (documented) — the cap exists to stop WS-flap churn, not to
  police the boot-down case.
- **D8 App API audit + `utils/errorMessages.ts` (node-pure)**.
  `friendlyErrorText(err)` centralizes "typed error → user-readable text":
  ChatError/SearchError/WorkspaceError already carry user-readable
  `.message` (their kinds are distinguished from the class), anything else →
  'Unexpected error'. Chat/Search/Dashboard route their inline error text
  through it (the Dashboard Save/Load + Chat/Search error paths already
  render inline — this makes the guarantee structural). A table test asserts
  every typed-error kind maps to non-empty user-readable text and rate_limit
  kinds mention 'try again'.
- **D9 Notes save-refusal warning**. Notes' debounced + unmount-flush saves
  check `storageSet`'s boolean return and render a minimal inline
  `[data-testid="notes-save-warning"]` line only when a save was refused
  (storage unavailable / quota) — the "storage quota" failure-matrix row gets
  a user-readable surface (this mirrors the storage module's existing
  edge-only console.warn, which stays as-is).
- **D10 MediaPipe loader extraction — `utils/mediaPipeLoader.ts`**.
  `createMediaPipeScriptLoader({ loadScript })` returns an idempotent,
  StrictMode-safe cached `load()` that rejects if any script fails. This is
  the CDN-fail failure-matrix row: `HandTracker`'s init catch →
  `updateState('error')` + the existing ErrorBanner — now the loader's reject
  is unit-testable with a fake `loadScript`. The ?url asset imports move here
  (HandTracker imports the loader result).
- **D11 v15 verifier — `docs/scripts/verify_milestone15.py`** (dev server,
  fake webcam, M11 probe-gate assumptions): webcam-offline phases FIRST —
  boot the frontend with the backend DOWN → HUD Sync 'offline', 4 boot
  windows, notes typing + launcher open work, Save-ws shows the inline
  "Cannot reach the backend" network WorkspaceError, Errors 0, zero console/
  page errors (noise filter kept). Then start the backend → auto-connect
  (Sync connected, Users 1). Healthy phase: EXACT title 'JARVIS · Milestone
  15', Windows 4, Camera/MediaPipe ready, FPS>=30, latency band 150–260,
  Errors 0, zero errors. Then inject a SYNTHETIC track 'ended' via the
  runtime (`video.srcObject.getVideoTracks()[0].dispatchEvent(new
  Event('ended'))`) → ErrorBanner (role=alert) + HUD Camera 'error', reload
  to restore healthy. Then mid-session backend drop → HUD Sync not
  'connected' + local usability intact → backend restart → reconnects. The
  reconnect-CAP transition itself is unit-tested (8 failed cycles via fake
  sockets), not browser-scripted (~20-40s, too slow). Evidence m15-*.
- **D12 title lockstep**. HUD → 'JARVIS · Milestone 15'; v14's exact pins
  (docstring + the check string + the `"JARVIS · Milestone 14" in hud`
  assertion) downgraded to tolerant; v15 owns the exact pin. v1–v13 are
  already tolerant (two-tier policy).
- **D13 tests**. New suites: errors.test.ts, cameraErrors.test.ts,
  degradedTracking.test.ts, errorMessages.test.ts, mediaPipeLoader.test.ts +
  sync cap tests appended to sync.test.ts. Audit-covered rows already
  tested elsewhere (gemini 403→invalid_key, apiProxy 429→rate_limit,
  workspace corrupt-JSON→invalid, storage quota→false) are re-asserted in
  the failure-matrix table with their existing suite names.
- **D14 README M15**. §8 challenge-1 lighting/occlusion mitigation story
  (what MediaPipe is robust to, what degrades it, practical guidance,
  referencing the M14 escalation ladder) + the monitoring section: the
  [Performance] line, the M14 ?perf=1 breakdown, and the Errors counter are
  the monitoring surface; "healthy" = latency 150–260ms, FPS >= 30 on a real
  GPU, Errors 0; reconnect-cap semantics documented.

## Failure-mode matrix (each row: path → behavior → how asserted)

| Path | Behavior | Asserted |
|---|---|---|
| camera denied | ErrorBanner + Retry, denied text | UNIT classify(NotAllowedError) |
| camera busy | ErrorBanner + Retry, busy text | UNIT classify(NotReadableError) |
| camera no-device | ErrorBanner + Retry, no-device text | UNIT classify(NotFoundError) |
| camera unsupported | ErrorBanner (no Retry) | UNIT classify(no getUserMedia) |
| track-ended mid-session | ErrorBanner + Retry, disconnected text | UNIT monitorTrackEnded + BROWSER synthetic Event('ended') |
| MediaPipe CDN fail | error state + ErrorBanner | UNIT loader rejects (+ existing init catch) |
| backend offline (boot) | HUD 'offline', app fully usable, auto-connects when backend starts | BROWSER v15 Phase A/B |
| WS outage mid-session | HUD -> offline, reconnect on restart | BROWSER v15 Phase E |
| WS sustained outage | reconnect budget → terminal 'offline', zero timers | UNIT sync cap |
| storage quota/unavailable | save refused, inline Notes warning | UNIT storage.set=false + Notes wiring |
| corrupt workspace JSON | WorkspaceError invalid, inline "not valid JSON" | UNIT workspace.test.ts (existing) |
| bad API key | ChatError invalid_key → sticky demo | UNIT gemini.test.ts (existing) |
| rate-limited | ChatError/SearchError rate_limit, inline "try again" | UNIT apiProxy.test.ts (existing) |
| network error in apps | ChatError/SearchError network, inline message | UNIT gemini/apiProxy tests (existing) |
| workspace save/load offline | inline "Cannot reach the backend" (Dashboard) | BROWSER v15 Phase A (click Save) |

## Out of scope (hard)

Visual redesign beyond the Errors counter; backend protocol changes; new
dependencies; deployment (M16); new gesture logic; MediaPipe API swap.

## D15 — mid-milestone discovery (adds to the record): the camera-loss monitor must survive the tracker handoff

v15's runtime track-'ended' injection (check k) FAILED on the first run: the
synthetic `Event('ended')` dispatched on the live MediaStreamTrack didn't
reach the banner. Probes proved `MediaStreamTrack.dispatchEvent(new
Event('ended'))` DOES deliver `addEventListener('ended')` listeners
headless — so the monitor WAS attached (the tracker replacement line was in
the console) but the handler's `if (cancelled) return;` bailed: the
tracker-takeover path sets `cancelled` to retire the capture loop, and that
same flag wrongly suppressed the legitimate POST-takeover camera loss (the
real unplug case fires on the TRACKER's track). Fix: removed the `cancelled`
guard from the monitor handler; the `video.srcObject !== target`
supersession check alone distinguishes the expected handoff (the monitor is
re-attached to the tracker's stream in the same tick BEFORE our own tracks
are stopped, so our stop's 'ended' has no listener on the old stream) from a
genuine loss. v15 re-ran: check k PASS.

## Deviations from the prompt (documented)

- The synthetic track-'ended' injection (prompt: "if feasible") WAS feasible
  via `track.dispatchEvent(new Event('ended'))` — used as check k, not just
  an optional.
- The reconnect-budget transition is unit-tested (fake sockets), not
  browser-scripted (~20-40s per 8-cycle outage is too slow for a verifier);
  v15 proves drop→offline→reconnect at 1-2 failed cycles.
- v15 runs the DEV server (:5173) not the production build — its focus is
  resilience/monitoring under the M11 probe-gate assumptions; the production
  boot itself remains v14's check (re-run in the same regression).
- README lighting/occlusion adds the MediaPipe documentation attribution.
- The new `docs/scripts/regress_all.py` driver is a regression harness (new
  file, in-scope "run verifiers 1-15" evidence): per-verifier fresh warmed
  dev server + full port cleanup — gathered empirically (npx.cmd shim,
  cold-compile race, stale WS users).
