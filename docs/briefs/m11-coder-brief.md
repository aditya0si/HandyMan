# JARVIS Milestone 11 — Coder Brief (Phase 4 part 1: backend real-time core — shared sync protocol, StateManager + JARVIS WS server, frontend SyncManager + HUD, v11 verifier)

You are the Coder for JARVIS Milestone 11 in `C:\Users\oliad\Desktop\visionpro` (Windows / Git Bash; npm workspaces root; NOT a git repo — never `git init`/commit). This brief is complete and self-contained. Implement EXACTLY this scope: the M11 wire protocol as ADDITIVE `packages/shared` types/constants/pure helpers (plus ONE sanctioned two-line fix that makes the shared dist loadable by Node), a pure backend `StateManager` (spec §3.2, no Redis/DB), the §3.1 `JARVISServer` WebSocket restructure of the echo server (ports unchanged :4000/:4001), a node-pure frontend `utils/sync.ts` SyncManager (silent health-probe gate + backoff + throttle + quantize + injectable socket factory), the App.tsx wiring (per-scene SyncManager lifecycle, sendHands hook, window-sync bridge on the existing `wm.setOnChange` path, two ADDITIVE HUD rows, title bump), backend vitest infra (the ONLY new npm dependency allowed), the v10 lockstep (EXACTLY two tolerant edits), `verify_milestone11.py` (backend+frontend orchestration, python second client, reload-shaped offline check), the README M11 section + line-5 status update, and the root test script extension to both workspaces. NO remote-hand rendering (M12), NO conflict resolution (M12), NO persistence (M13), NO API proxy/APIRouter (M13), NO Redis/PostgreSQL (M13 JSON-store decision), NO new boot window (Windows stays 4), NO new apps, NO changes to gestures/engine/windowManager internals/app components. When something is unspecified, follow the existing M1–M10 conventions and document deviations the way M2–M10 did (docblock "DEVIATION"/decision notes).

## 0. Guardrails (read first — one of these is a hard browser-behavior rule)

- Run everything from the repo ROOT: `npm run test` (after work item F this runs BOTH workspaces), `npm run build`, `npm run dev:frontend` (verifiers), `npm run dev:backend`. Python verifiers run as `python docs/scripts/verify_milestoneN.py [base_url]` against the frontend dev server on http://localhost:5173 (started separately, in the background). v11 additionally manages the backend itself (work item H).
- **THE #1 LANDMINE (empirically verified by the overseer, 2026-08-17, headless Chromium + Playwright): a failed `new WebSocket(...)` connection logs a NATIVE browser console `[error]`** (`WebSocket connection to 'ws://…' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED`). It is browser-generated — `ws.onerror`/`ws.onclose` handlers do NOT suppress it, and Playwright's console listener captures it as type `error`. ALL existing verifiers v1–v10 (and v11) run zero-console-error gates, and v1–v10 run with the backend DOWN. **Therefore the frontend sync layer MUST NEVER attempt a WebSocket connection unless the backend is provably up**: the silent health-probe gate of D4 is mandatory, not a suggestion. A verified companion fact: a failed `fetch(...)` with a `.catch` logs NOTHING natively — the probe gate exploits exactly that.
- **Strict TS constraints, both sides.** Frontend (tsconfig.app.json, verified 2026-08-17): `erasableSyntaxOnly` (NO `enum` — const-object pattern), `verbatimModuleSyntax` (type-only imports MUST use `import type`), `noUnusedLocals` + `noUnusedParameters`, `noFallthroughCasesInSwitch`. Backend (tsconfig.json): strict + `noUnusedLocals`/`noUnusedParameters` + `module: NodeNext` + CJS emit (no `"type":"module"` in apps/backend). `skipLibCheck: true` on both sides. NO tsconfig edits are needed by this milestone.
- Quality skills are mandatory: `test-guard` on all test changes, `clean-code-guard` on all new/changed production code, `docs-guard` on the README changes. Your report must include the evidence lines those checks produced.
- Console discipline: the ONLY new console output allowed is the pinned `[Sync] …` vocabulary of D6 (lifecycle transitions, 1 s-throttled inbound-message logs) plus the backend's own `[backend]` stdout (never seen by page verifiers). ZERO per-frame spam (v4's 2.5-minute soak runs with the backend down; the sync layer must be byte-silent there except ONE `[Sync] offline` line, add/remove NO window listeners, and leave no accumulating timers — see D12).
- The ONLY sanctioned env vars are `VITE_SYNC_URL` (default `ws://localhost:4001`) and optionally `VITE_HEALTH_URL`, read via `import.meta.env` in `App.tsx` ONLY (D11). No `.env.local` is required for any verifier; defaults are correct. The ONLY new npm dependency allowed anywhere is `vitest` in `apps/backend` (devDep, version-pinned to match the frontend, D13); the backend additionally declares the INTERNAL workspace link `"@jarvis/shared": "0.1.0"` (same form the frontend already uses — not an external dependency, D3).
- Baseline (do NOT regress, verified 2026-08-17): **247 frontend vitest tests green** (per file: logger 13, windowManager 26, gestures 39, interactionEngine 49, animation 31, cameraRig 14, bootScene 3, appRegistry 10, storage 7, chat 12, gemini 22, search 21); build passes all three workspaces; all TEN verifiers `OVERALL: PASS` (re-run as a pre-flight if you doubt the baseline — they need only the frontend dev server).
- The ONLY pre-existing files you may touch: `packages/shared/src/types.ts` + `constants.ts` + `index.ts` (additive + the sanctioned specifier fix of D2), `apps/backend/package.json` (workspace dep + vitest + test script), `apps/backend/src/server.ts` (the §3.1 restructure), `apps/frontend/src/App.tsx` (the enumerated E1–E10 edits), `package.json` (root, test script only), `docs/scripts/verify_milestone10.py` (the enumerated two-spot lockstep of work item I — NOTHING else), `README.md` (append M11 + line-5 status). NEW files: `packages/shared/src/sync.ts`, `apps/backend/src/state/manager.ts` + test, `apps/backend/src/websocket/server.ts` + test, `apps/frontend/src/utils/sync.ts` + `sync.test.ts`, `docs/scripts/verify_milestone11.py`. Every other existing file stays byte-identical. If you find any other failing test, STOP and report it — do not amend unilaterally.

## 1. Codebase facts you will rely on (verified by reading + spikes, 2026-08-17)

- `TECHNICAL_SPEC.md` §3.1 (lines 715–824) is the JARVISServer sketch: `clients: Map<string, WebSocket>`, connection → generateUserId → broadcast `userJoined` → message routing (`handUpdate` → broadcast `handSync` EXCLUDING sender + `stateManager.updateUserHands`) → close → `removeUser` + `userLeft`; `broadcast(msg, excludeUserId?)`. Its sketch has three things M11 supersedes (documented in D17): `JSON.parse` without a guard (must never crash), `userJoined` broadcast to ALL (M11 excludes the sender), and an `apiRouter` (M13). §3.2 (lines 826–909) is the StateManager sketch (`users`/`windows` Maps, `updateUserHands`, `applyInteraction`, `getFullState`, `removeUser`) with `private db: Database` + Redis caching — BOTH dropped in M11 (pure in-memory; M13 decision). `PROJECT_VISION.md` §3.5 (lines 100–105) multi-user; §8 Challenge 4 (lines 363–371): "Only sync changed state; throttle hand updates; quantize positions to 1 cm precision". Spec §5: WebSocket RTT < 200 ms.
- `packages/shared` — `src/types.ts` (48 lines: Handedness, Landmark `{x,y,z}`, Hand `{handedness, landmarks, confidence}`, HandDetectionResult, CameraState, MediaPipeState, HealthResponse `{status:'ok', uptimeSec, wsPort}`), `src/constants.ts` (67 lines: camera/hand constants + `HTTP_PORT = 4000`, `WS_PORT = 4001` at lines 66–67), `src/index.ts` is TWO lines: `export * from './types'; export * from './constants';`. `package.json`: `"type": "module"`, `exports` → `dist/index.js` (types `dist/index.d.ts`). Frontend consumes it via a Vite source alias (`vite.config.ts` maps `@jarvis/shared` → `packages/shared/src/index.ts`; `tsconfig.app.json` `paths` mirrors it) — the root build builds shared FIRST.
- **THE SHARED DIST IS CURRENTLY BROKEN AS NODE ESM (Orchestrator spike, 2026-08-17):** `dist/index.js` emits `export * from './types';` — extensionless — and Node's ESM loader rejects it: `Error [ERR_MODULE_NOT_FOUND] ... dist/types imported from dist/index.js`. The frontend never notices because Vite consumes the SOURCE alias. Any backend runtime import of the dist as-is dies. **The fix (spiked end-to-end in a sandbox, work item A): write the specifiers as `./types.js` / `./constants.js` / `./sync.js`** — the shared tsconfig's `moduleResolution: "Bundler"` accepts `.js` → `.ts` substitution and tsc emits them verbatim, producing valid Node ESM.
- **Interop spike (Orchestrator, sandbox mirroring the repo): with the `.js`-specifier fix, EVERYTHING works on this exact toolchain:** `tsc` emits valid ESM; Node v24.14.1 `require()` of the ESM dist returns the namespace (named exports readable — `require(ESM)` support); and **TypeScript 6.0.2 under `module: NodeNext` + CJS emit does NOT raise TS1479** for `import { VALUE } from '@jarvis/shared'` — it typechecks and emits `const shared = require('@jarvis/shared')` + property access, which runs correctly. Type-only imports are fully erased. Remaining unverified leg (YOUR spike 0): Vite source-alias consumption of the `.js` specifiers (frontend dev/build/vitest) + the in-repo backend legs under tsx and vitest (D2/D3).
- `apps/backend` — single `src/server.ts` (82 lines): Express 5 `app.get('/api/health')` returning `{status:'ok', uptimeSec, wsPort}` on `:4000` (`PORT` env), standalone `WebSocketServer({ port: 4001 })` (`WS_PORT` env) that echoes `{type:'echo', data}` (M1 skeleton — the echo behavior is REPLACED this milestone), graceful SIGINT/SIGTERM shutdown. `package.json`: CJS (`main: dist/server.js`), scripts `dev` (tsx watch), `build` (tsc), `start`, `typecheck`; deps express ^5.1.0, ws ^8.18.3 (resolved 8.21.3 at root) + @types; NO tests, NO vitest. `tsconfig.json`: `rootDir: "src"`, `include: ["src"]`, `outDir: "dist"`.
- `apps/frontend/package.json`: `vitest ^4.1.10` devDep (the version the backend must match); no vitest config file (defaults: node environment, `include src/**/*.test.ts`). `apps/frontend/src/main.tsx` mounts under `<StrictMode>` — the M3–M10 per-scene discipline (fresh managers per `onSceneReady`, refs replaced wholesale) exists because of it.
- `apps/frontend/src/App.tsx` (722 lines; verified line numbers as of 2026-08-17):
  - HUD title `JARVIS · Milestone 10` at **line 90**, lockstep comment at **lines 85–89**; `HudProps` interface lines 30–38 (seven fields); `Hud` renders seven `StatusRow`s at lines 92–98 (labels: Camera, MediaPipe, Hands, Windows, Gestures, FPS, Latency).
  - `handleSceneReady` lines 329–376: fresh WindowManager + `wm.setOnChange(syncWindowsThrottled)` at **line 335**, fresh engine/rig/appBus/windowCounters, boot-window loop lines 364–371, boot console line at **line 372** (`[App] app scene ready: ${BOOT_WINDOW_COUNT} app windows created` — derived, M11 does NOT touch it).
  - `handleHandsDetected` at **line 378** (hands: Hand[] at inference rate; 1 s-throttled log + 250 ms-throttled HUD count).
  - `handleCloseWindow` lines 550–565, `openApp` lines 283–296 — every window mutation goes THROUGH WindowManager methods, and **every WindowManager mutation (create/move/resize/rotate/close/bringToFront/minimize/restore/highlight-change) fires the registered onChange callback** (`windowManager.ts` lines 103–106, 275–277; callback signature `() => void`, no args). `FloatingWindow` = `{id, title, position: THREE.Vector3, scale: THREE.Vector3, rotation: THREE.Euler, isMinimized, zIndex, aspect, highlight}`.
  - `syncWindowsThrottled` (lines 261–266) throttles the React snapshot at 100 ms and is called BOTH from onChange AND unconditionally at the end of `handleGesturesDetected` (line 540) — i.e. at inference rate during activity.
  - `import.meta.env` is currently read in exactly two files: `components/apps/Chat.tsx` line 28, `components/apps/Search.tsx` lines 19–20. After M11: exactly three (add App.tsx).
- `docs/scripts/verify_milestone*.py`: all ten attach `page.on("console", lambda m: console_lines.append(f"[{m.type}] {m.text}"))` and gate on zero `[error]`-typed lines; v4 (soak) patches `EventTarget.prototype.addEventListener/removeEventListener` to count listener add/remove net-stability across a 2.5-minute soak, and counts rAF granted/revoked/fired — the sync layer must be invisible to both counters when offline (D12). v1–v9 HUD lookups are ALL the tolerant `includes('JARVIS · Milestone')` (v1 has no title lookup at all; v9's tolerant comment at line 127 stays as history). **The only exact `JARVIS · Milestone 10` pins in the tree are v10 line 120 (introspection finder) and v10 line 693 (check e); check e ALSO pins `Windows == 4` at line 699, which SURVIVES M11 (no new boot window).**
- Verifier hash baselines (pre-M11, sha256, re-verified 2026-08-17 — they match the live files):

```
450c8386b73c5735ced29997c9edefb7692bdecc5d0384a7b67d2274376a242b  verify_milestone1.py   (MUST stay identical)
2f9bc072f0c523b889ca15278641e784b744745f52b7628260fb50e43f662b44  verify_milestone2.py   (MUST stay identical)
861727280b33d458384e1c986a16e425054d13d6477e0d467cecc97178664cdc  verify_milestone3.py   (MUST stay identical)
388a355b99cf0cd93f5c5bea862d2704144dfab0a2219f2ed27b673310e680ef  verify_milestone4.py   (MUST stay identical)
27b6ddc5dcd74f525469d41d7682f858c42573c4be2e28ae007aa94113f2c3c0  verify_milestone5.py   (MUST stay identical)
370307538efa73a5f849c77192b000818a68a4eee4575a0547d7d4ecc23115d4  verify_milestone6.py   (MUST stay identical)
2fe3d2b8d559b9f7e41e4f431cc5f74e91ab8797b5a69ee1499804ec43c5e422  verify_milestone7.py   (MUST stay identical)
eca51b4189ceb69fb56a9803d1d5cef7e2c6a4fbdf0b934930e2a891e4377e5d  verify_milestone8.py   (MUST stay identical)
7ca56821d49955cc18545fbdf2619d7576180805216597a9cd3e6f2544694db7  verify_milestone9.py   (MUST stay identical)
efc2ba2bcc32da2642ab3503c45b8319da71236c4c19b972f22ca4359f0057c3  verify_milestone10.py  (edited ONLY in work item I)
```

- Toolchain (verified): Node v24.14.1, Python 3.14.3 with `playwright`, `websocket-client 1.9.0` (sync client — v11's second user, D16), and `websockets 16.0` installed; `ws` 8.21.3 hoisted at the root. README is 1449 lines; line 5 is the "**Milestone 10 status: Phase 3 COMPLETE.** …" blurb; the M10 section starts at line 1291 and runs to end-of-file — the M11 section APPENDS after it.

## 2. Design decisions (decided by the Orchestrator — implement as specified, document in code)

**D1 — Protocol shapes (ADDITIVE to `packages/shared`; tuples/scalars on the wire).** `ClientMessage` = `{type:'handUpdate', data:{hands: Hand[]}} | {type:'windowUpsert', data: WindowState} | {type:'windowClose', data:{id: string}}`; `ServerMessage` = `{type:'userJoined', data:{userId}} | {type:'userLeft', data:{userId}} | {type:'handSync', data:{userId, hands: Hand[]}} | {type:'windowSync', data: WindowState} | {type:'stateSnapshot', data:{users: UserInfo[], windows: WindowState[]}} | {type:'error', data:{message}}`. `WindowState` (spec §3.2, wire shape): `{id, title, owner, position:[number,number,number], rotationY: number, scale: number, zIndex: number, lastModified: number}` — TUPLES + the scalar scale (the window's `scale.x`, the width; `scale.y` is derived by the fixed 16:9 aspect) + the scalar `rotationY` because `Vector3`/`Euler` are not JSON-stable; the CLIENT converts (work item E `toWindowState`). `UserInfo` = `{id, lastUpdate}` (presence only — hands travel via handSync, never in the snapshot). No existing shared shape changes; everything below is appended.

**D2 — The shared package must emit loadable Node ESM (the sanctioned index.ts fix).** Change `packages/shared/src/index.ts` specifiers to `./types.js` / `./constants.js` / `./sync.js`. Why: the built `dist/index.js` currently uses extensionless specifiers, which Node's ESM loader rejects (verified: `ERR_MODULE_NOT_FOUND`), so ANY backend import of the dist dies; with `.js` specifiers, tsc (Bundler resolution accepts `.ts` substitution) emits valid ESM and Node 24 loads it (spiked: require(ESM) + dynamic import both verified). Risk this shifts onto the FRONTEND (Vite source alias consuming `.js` specifiers that map to `.ts` files) is exactly what SPIKE 0 must prove (Vite documents TS-style `.js`→`.ts` resolution; re-run all 247 frontend tests + build + dev eyeball). **Fallback if (and only if) Vite chokes:** keep `index.ts` extensionless and instead give shared `tsconfig.json` `"rewriteRelativeImportExtensions": true` (TS ≥5.7; this repo has 6.0.2) with `./types.ts`-style source specifiers, which rewrites them to `.js` at emit; document whichever path was needed. Do NOT bundle, do NOT add build tooling.

**D3 — Backend consumes the BUILT shared dist via require(ESM); internal workspace link.** `apps/backend/package.json` gains `"@jarvis/shared": "0.1.0"` in `dependencies` (the exact form `apps/frontend` already uses; npm resolves it to `packages/shared` via the existing hoisted root symlink — no registry download, not a "new npm dependency" in the guardrail sense; the package-lock gains only the link). Backend imports use NAMED imports (`import { WS_PORT, quantizeHands } from '@jarvis/shared'` + `import type { Hand, … }`); verified on this exact toolchain: TS 6.0.2 NodeNext/CJS typechecks value imports of an ESM package (no TS1479) and emits plain `require()` + namespace access, which runs on Node 24. SPIKE 0 must re-prove all three legs IN REPO: `npx tsx` dev run, `vitest` run, and compiled `node dist/server.js` — plus `npm run build` order (shared first) already guarantees a fresh dist. Document the interop (one docblock paragraph in `websocket/server.ts` + README digest).

**D4 — The SILENT health-probe gate (the landmine antidote; mandatory design).** Before ANY `new WebSocket(...)`, `SyncManager` polls `fetch(healthUrl, {mode:'no-cors', signal})`; a failed fetch with `.catch` logs NOTHING natively (overseer-verified), while a failed WS handshake logs an unsuppressible native `[error]` — so WS attempts happen ONLY after a probe succeeds (the server is up, the handshake succeeds, no native error). Probe loop: first probe immediately, retries at 500 ms → ×2 exponential → 5 s cap (no jitter — deterministic tests), each probe wrapped in an AbortController timeout of 2500 ms so a hung server cannot stall the loop; an `opaque` no-cors response RESOLVES (probe success = resolve, rejection = failure). Backend down ⇒ probe fails silently forever, status stays `'disconnected'`, HUD shows `offline`, exactly ONE `[Sync] offline` console line, zero WS attempts (v11 asserts zero `:4001` websockets — note Vite's HMR websocket to :5173 is unrelated and expected). URL derivation: `deriveHealthUrl(syncUrl, override?)` (pure, exported, unit-pinned): `ws:`→`http:`, `wss:`→`https:`, port → `HTTP_PORT` (4000 from shared), path `/api/health`; an explicit `VITE_HEALTH_URL` override wins. Default `VITE_SYNC_URL` = `ws://localhost:4001` (a pure constant; env read happens ONLY in App.tsx, D11).

**D5 — WS-death edges: the v11 offline check is RELOAD-shaped, and the backend binds WS before HTTP.** (a) If an ESTABLISHED WS dies because the backend process is killed, Chromium MAY log a native error (abnormal close 1006) — SPIKE 2 measures it, but v11's procedure NEVER creates that window deterministically: the backend is terminated only BETWEEN page sessions, and the offline check navigates a FRESH page against the dead backend (fresh probe-gated boot: offline, zero errors). (b) Probe-success → handshake race (server dies between probe and WS): acceptable rare native error in the wild, eliminated in v11 by phase margins. (c) The restructured `server.ts` binds the WS server BEFORE the HTTP server enters `listen` — so "health responds" ⇒ "WS is listening", making the probe gate race-free by construction (document this ordering rationale in server.ts).

**D6 — Console contract, pinned day one (v11 pins exactly this vocabulary).** `[Sync] connected` (on WS open), `[Sync] offline` (ONCE per offline transition — first failed probe after boot or after an unexpected drop; NOT per retry), `[Sync] handSync userId=<uuid> hands=N`, `[Sync] windowSync id=<id>`, `[Sync] userJoined userId=<uuid>`, `[Sync] userLeft userId=<uuid>`, `[Sync] server error: <message>` (bounded — the server only sends `error` on malformed input). The three inbound-message logs are throttled to ≥1 s apart (a shared timestamp, App-side). Lifecycle logs live inside SyncManager; inbound logs live in App's message handler. NOTHING ELSE logs. **Empty-hand suppression:** `sendHands([])` sends NOTHING unless the previous send was non-empty (one final "hands gone" notification, then silence) — the idle page (fake webcam, no hands) is wire-silent at 0 msgs/s, not 20/s.

**D7 — Ownership rules (server-authoritative; first creator wins).** The server STAMPS `owner = senderUserId` on window CREATE and IGNORES any client-supplied owner (the client cannot know its own server-assigned id — the pinned protocol has no "welcome" message, so clients send `owner: ''` and the server overwrites). On UPDATE, owner is NEVER changed (anyone may move anyone's window in M11 — conflict resolution is M12 — but ownership stays with the creator). After a `windowClose` removes a window, a LATER create with the same id re-stamps the (possibly different) creator. `removeUser` deletes ONLY the user: windows of disconnected users PERSIST in server state until server restart (spec §3.2 semantics; GC is M12) — documented, honest limitation. Consequence for reloads: a fresh page userId joins and the snapshot may contain windows owned by its own dead predecessor — M11 stores-and-logs only, no rendering, no reconciliation (M12).

**D8 — `windowClose` propagation rides `stateSnapshot` (protocol-complete, no new type).** The pinned ServerMessage set has no `windowClosed`; on a client `windowClose` the server removes the window and broadcasts a `stateSnapshot` (full users+windows arrays) to the OTHERS. Upserts stay single-window deltas (`windowSync`) — low-frequency, unthrottled. M12 may introduce a proper removal delta; document the decision.

**D9 — Server handSync throttle: per-user, trailing-flush, injectable.** Per §8 challenge 4 + the `SERVER_HANDS_BROADCAST_INTERVAL_MS` constant (~50 ms): per sending user, the server tracks `lastBroadcast`; a handUpdate inside the window does not broadcast immediately but schedules ONE trailing timer that flushes the LATEST stored hands at the deadline (the final state always lands; no dropped tails). The interval is a factory option (tests inject small/zero values; the integration suite asserts NOT-one-per-send + last-state-delivered rather than exact counts, so timing wobble can't flake). Quantization authority: `StateManager.upsertUserHands` quantizes via the SHARED `quantizeHands` before storing and returns the quantized array — the same array the server broadcasts (the client quantizes too, for bandwidth; double rounding is idempotent).

**D10 — Window sync bridge: diff-based, quantize-gated, flush-on-connect, riding the existing onChange.** `createWindowSyncBridge(getWindows, sender, now?)` (in `utils/sync.ts`, node-pure) keeps a snapshot `Map<id, wireKey>` where wireKey = JSON of the quantized `{position, rotationY, scale, zIndex, title}` tuple; `sync()` (called from the SAME `wm.setOnChange` callback as `syncWindowsThrottled` — the natural hook verified at App.tsx:335; windowManager.ts itself is NOT touched) computes: new id → `sendWindowUpsert`, vanished id → `sendWindowClose`, changed wireKey → `sendWindowUpsert`; sub-quantization changes (e.g. highlight churn, which also notifies) emit NOTHING (self-filtering). Sends no-op inside SyncManager while disconnected, but the snapshot RECORDS regardless (boot windows created before connect are known, not "new"). `flushAll()` (called on the `'connected'` transition) clears the snapshot and re-syncs, pushing the full local window set once per connection so late joiners see them in their snapshot (windows closed during an outage may remain stale server-side until M12 — documented edge). `isMinimized` is NOT synced (local-only; the wire shape has no such field — M12). Window sends are diff+quantize gated with NO extra timer (windows only change when manipulated — same order of magnitude as hand traffic).

**D11 — SyncManager surface: node-pure, injectable everything, env at the React boundary.** `utils/sync.ts` mirrors the gemini/search purity contract: NO `import.meta`, NO React, NO DOM-only APIs (the global `URL` and `fetch`/`AbortController` exist in Node tests; `WebSocket` is never referenced concretely — the manager takes a `socketFactory`). Options: `socketUrl?` (default the pure `DEFAULT_SYNC_URL = 'ws://localhost:4001'`), `healthUrl?` (default `deriveHealthUrl(socketUrl)`), `socketFactory?` (default `(url) => new WebSocket(url)` — supplied by App/tests), `fetchImpl?`, `now?` (default `performance.now`-compatible `() => Date.now()`? NO — pin `() => performance.now()` is browser-flavored; use an injectable clock defaulting to `Date.now()`; the throttle compares deltas, so either clock works), `handsIntervalMs?` (default `SYNC_HANDS_INTERVAL_MS`), `probeTimeoutMs?` (2500), `onStatus?`. Public: `connect()` (idempotent), `close()` (terminal, idempotent, clears every timer, no notifications after), `sendHands`, `sendWindowUpsert`, `sendWindowClose`, `subscribe(handler) → unsubscribe`, `get status`. Status tri-state `'disconnected' | 'connecting' | 'connected'`: probing = `'disconnected'`, WS attempt = `'connecting'`, open = `'connected'`. App.tsx reads `import.meta.env.VITE_SYNC_URL ?? DEFAULT_SYNC_URL` (and `VITE_HEALTH_URL`) ONCE at module scope — the ONLY `import.meta.env` addition.

**D12 — Per-scene lifecycle + soak invisibility.** One SyncManager per scene, created in `handleSceneReady` AFTER explicitly `close()`-ing the previous one (the M3–M10 ref-replacement pattern; StrictMode's double mount is thereby covered — no unmount effect needed, matching how wm/engine/rig are treated; page unload tears everything down). The socket wiring uses the `onopen/onclose/onmessage/onerror` PROPERTY pattern (never `addEventListener`) — v4's soak patch wraps `EventTarget.prototype.addEventListener`, so property handlers are invisible to its counters by construction; every timer lives in tracked slots cleared by `close()`; pending backoff `setTimeout`s are stored resolvers that `close()` settles so the async probe loop exits promptly (no dangling awaits across vitest teardown). Backend down (the v1–v10 world): zero WS instances ever created, probe fetches are short-lived and listener-free, ONE `[Sync] offline` line, net-zero listener churn.

**D13 — Backend test infra.** `apps/backend` devDeps gain `vitest ^4.1.10` (identical to the frontend) and the script `"test": "vitest run"`; tests live in `src/` beside their modules (the frontend convention) and are typechecked by the existing `include: ["src"]` tsconfig — they will also be EMITTED into `dist/` by `npm run build` (harmless dead files; `node dist/server.js` never imports them; accepted, documented — do NOT add exclude machinery). Integration tests use the factory's `port: 0` (ephemeral port; read back from the handle after `listening`) and REAL `ws` clients (already a dependency); `afterEach` closes clients and `await`s server close (terminate sockets + clear timers + `wss.close()`) so vitest never hangs on open handles; per-test timeouts raised to 10 s; a `waitForMessage(ws, type)` promise helper drains messages. If `import … from '@jarvis/shared'` hiccups under vitest's transform (it should not — vite-node resolves the package `exports` and loads the ESM dist natively), the sanctioned fallback is a vitest `alias` in a NEW `apps/backend/vitest.config.ts` pointing at `packages/shared/src/index.ts` (source transform; NO bundler hacks) — decide in SPIKE 0, document.

**D14 — Root test script runs BOTH workspaces.** `package.json` (root): `"test": "npm run test --workspace @jarvis/frontend && npm run test --workspace @jarvis/backend"` (order: frontend first — the bigger suite fails fastest). This is the only root edit.

**D15 — v10 lockstep: EXACTLY the two title pins go tolerant; everything else in v10 survives.** The HUD title moves to `JARVIS · Milestone 11`, breaking exactly v10 line 120 (finder) and line 693 (check e substring). Both become the tolerant `includes('JARVIS · Milestone')` / `in hud` forms with comment updates (work item I). v10's `Windows == 4` pin (line 699), boot-set/boot-line pins, launcher pins, and all flow checks SURVIVE untouched — M11 adds no boot window and no app; verify by reading, do not edit. v1–v9: ZERO edits (all already tolerant; re-grep and paste the evidence).

**D16 — v11 verifier design.** Copies the v10/v9 Playwright skeleton verbatim where possible (fake-webcam flags, 1280×800, console/pageerror listeners, `PERF_LINE_PATTERN`, introspection shape, summary JSON, `OVERALL: PASS/FAIL`) PLUS backend orchestration: v11 STARTS the backend itself as `subprocess.Popen(["node", "dist/server.js"], cwd=apps/backend)` (precondition: `npm run build:backend` already run — the script checks `dist/server.js` exists and fails with a clear message; NEVER spawn `tsx watch`, whose child tree survives `terminate()` on Windows), polls `/api/health` via urllib, and terminates it only BETWEEN page phases. The second user is a PYTHON `websocket-client` 1.9.0 sync socket (installed — verified; NO node helper script, NO new pip installs; if the import fails at startup the script exits with a clear message). Phases: main page (connected, Users 1) → python user B joins (page Users 2, B's snapshot carries the flushed boot windows) → B sends handUpdates (page console `[Sync] handSync …`) → verifier opens notes-2 via the launcher native-click driver (B receives `windowSync`, owner stamped) → verifier closes notes-2 (B receives snapshot without it) → B disconnects (page Users 1, userLeft) → page 1 closed, backend terminated, FRESH page with backend down (offline HUD, zero errors, ZERO `:4001` websockets — filtered from Vite's HMR socket) → backend restarted while that page sits (reconnect ≤ ~10 s, then a new python user C joins → Users 2). Screenshots/evidence: `m11-scene.png`, `m11-full.png`, `m11-multiuser.png`, `m11-offline.png`, `m11-reconnect.png`, `m11-console.txt`, `m11-summary.json`, `m11-backend.log`.

**D17 — Spec deviations digest (docblocks + README; the spec sketch is NOT binding where M11's prompt supersedes it).** (1) `JSON.parse` is guarded — parse failures and non-object/unknown-type messages produce an `error` message to the SENDER, never a crash (the sketch would throw). (2) `userJoined` is broadcast EXCLUDING the sender (the sketch broadcasts to all; the M11 prompt pins exclusion). (3) `generateUserId` → `crypto.randomUUID()` (sketch: timestamp+random string). (4) On connect the server sends the new client a `stateSnapshot` INCLUDING itself (the sketch sends nothing; M11's HUD count depends on it). (5) `StateManager` is PURE in-memory: no `Database`, no Redis cache, no `applyInteraction` (interaction messages are M-later; windows mutate via explicit upsert/close) — the M13 JSON-store decision. (6) `getFullState()` returns SERIALIZABLE arrays (`{users: UserInfo[]; windows: WindowState[]}`), not the sketch's Map-bearing `SceneState` (Maps do not JSON). (7) `WindowState` wire: scalar `scale` + `rotationY` + `zIndex` vs the sketch's `scale: [x,y,z]` with no rotation/z (M7 rotation + M3 z-order are real state). (8) No `apiRouter`/`apiCall`/`apiResponse` (M13). (9) Vision §8 challenge 4 says "send every 16 ms"; M11 throttles to 50 ms (~20 Hz) — MORE conservative, quantized to 3 decimals (~0.1% of the normalized frame ≈ the vision's 1 cm precision); documented. (10) The health-probe gate is not in the spec at all — it exists to keep the browser's native WS-failure error out of zero-console-error verifiers (D4); documented as an M11 engineering decision.

**D18 — HUD additions (additive; no new high-frequency React state).** Two `StatusRow`s appended after Latency: `Sync` → value `offline` (from `'disconnected'`) | `connecting` | `connected` (the display vocabulary avoids the `disconnected`/`connected` substring trap — `"connected" in hud` stays a safe assertion), and `Users` → `String(n)` (0 until a snapshot arrives). State transitions are DISCRETE RARE events (connect/drop/join/leave) — plain `useState` writes on transition only; inbound handSync/windowSync NEVER setState (refs + throttled logs). The title bumps to `JARVIS · Milestone 11` with the rewritten lockstep comment. v2's substring HUD checks and every other verifier's HUD assertions survive (additive rows); v11 owns the new exact pins.

## 3. Work item A — `packages/shared` (types + constants + NEW sync.ts + the index fix)

**A1 — `packages/shared/src/types.ts` (APPEND; do not touch existing declarations):**

```ts
// ---------------------------------------------------------------------------
// M11 real-time sync protocol (wire shapes — additive).
// ---------------------------------------------------------------------------

/** Presence record in stateSnapshot (spec §3.2, wire shape). Hands travel
 *  via handSync messages, never in the snapshot. */
export interface UserInfo {
  id: string;
  lastUpdate: number;
}

/**
 * Window state as it travels the wire (spec §3.2, wire shape, D1/M11):
 * tuples and scalars only — Vector3/Euler are not JSON-stable and the
 * client converts. `scale` is the scalar window WIDTH (scale.x; the 16:9
 * aspect derives the height). `owner` is STAMPED BY THE SERVER on create
 * (first creator wins, D7) — clients send '' and never learn their own id.
 */
export interface WindowState {
  id: string;
  title: string;
  owner: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  zIndex: number;
  lastModified: number;
}

/** Client -> server messages (M11 protocol). */
export type ClientMessage =
  | { type: 'handUpdate'; data: { hands: Hand[] } }
  | { type: 'windowUpsert'; data: WindowState }
  | { type: 'windowClose'; data: { id: string } };

/** Server -> client messages (M11 protocol). windowClose propagates via
 *  stateSnapshot (the protocol has no removal delta — D8, M12 may add one). */
export type ServerMessage =
  | { type: 'userJoined'; data: { userId: string } }
  | { type: 'userLeft'; data: { userId: string } }
  | { type: 'handSync'; data: { userId: string; hands: Hand[] } }
  | { type: 'windowSync'; data: WindowState }
  | { type: 'stateSnapshot'; data: { users: UserInfo[]; windows: WindowState[] } }
  | { type: 'error'; data: { message: string } };
```

**A2 — `packages/shared/src/constants.ts` (APPEND):**

```ts
/** --- M11 real-time sync (PROJECT_VISION §8 challenge 4: throttle + quantize) --- */

/** Client hand-send throttle: ~20 Hz out of the ~30 Hz inference rate. */
export const SYNC_HANDS_INTERVAL_MS = 50;

/** Landmark/confidence decimals kept on the wire: 3 decimals of the
 *  normalized 0..1 frame ≈ the vision's "1 cm precision" quantization. */
export const SYNC_QUANTIZE_DECIMALS = 3;

/** Server per-user handSync broadcast throttle (trailing flush, D9). */
export const SERVER_HANDS_BROADCAST_INTERVAL_MS = 50;
```

**A3 — CREATE `packages/shared/src/sync.ts` (pure transforms, single source of truth for BOTH sides):**

```ts
/**
 * M11 pure sync transforms shared by frontend and backend. Both sides
 * quantize with THESE helpers (client: wire bandwidth; server: storage
 * authority via StateManager — double rounding is idempotent).
 */
import type { Hand } from './types.js';
import { SYNC_QUANTIZE_DECIMALS } from './constants.js';

/** Round to `decimals` places (half-up). */
export function quantizeNumber(
  value: number,
  decimals: number = SYNC_QUANTIZE_DECIMALS,
): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Quantize one hand's landmarks + confidence (new objects; input untouched). */
export function quantizeHand(hand: Hand, decimals = SYNC_QUANTIZE_DECIMALS): Hand {
  return {
    handedness: hand.handedness,
    confidence: quantizeNumber(hand.confidence, decimals),
    landmarks: hand.landmarks.map((lm) => ({
      x: quantizeNumber(lm.x, decimals),
      y: quantizeNumber(lm.y, decimals),
      z: quantizeNumber(lm.z, decimals),
    })),
  };
}

/** Quantize a hands array (new array; input untouched). */
export function quantizeHands(hands: readonly Hand[], decimals = SYNC_QUANTIZE_DECIMALS): Hand[] {
  return hands.map((hand) => quantizeHand(hand, decimals));
}
```

**A4 — `packages/shared/src/index.ts` (the D2 fix — full new content):**

```ts
// NOTE (M11 D2): specifiers carry explicit .js extensions. The built
// dist/index.js is loaded by Node (backend require(ESM) on Node 24) and
// Node's ESM loader rejects extensionless relative specifiers. TypeScript
// (moduleResolution Bundler) maps .js -> .ts at compile time; Vite's source
// alias resolves them the same way (verified by SPIKE 0 + the frontend
// suites re-run).
export * from './types.js';
export * from './constants.js';
export * from './sync.js';
```

**A5 — `packages/shared/package.json`: NO CHANGES** (exports/types already point at dist; `npm run build --workspace @jarvis/shared` regenerates it; the root build order shared→frontend→backend already exists).

## 4. Work item B — CREATE `apps/backend/src/state/manager.ts` (near-final)

```ts
/**
 * M11 StateManager (TECHNICAL_SPEC §3.2 reimagined per the M11 prompt).
 *
 * DEVIATIONS from the spec sketch (documented, D17): no Database/Redis
 * (in-memory only — the M13 JSON-store decision), no applyInteraction
 * (windows mutate via explicit upsert/close), getFullState returns
 * SERIALIZABLE arrays (Maps do not JSON), and upsertUserHands QUANTIZES
 * via the shared quantizeHands (single authority, D9).
 *
 * Pure + injectable clock => unit-testable with no network, no timers.
 * Ownership (D7): create stamps owner = sender; update NEVER changes it;
 * a close followed by a re-create re-stamps the (possibly new) creator.
 * removeUser keeps the user's windows (spec §3.2; GC is M12).
 */
import type { Hand, UserInfo, WindowState } from '@jarvis/shared';
import { quantizeHands } from '@jarvis/shared';

export interface StateManagerOptions {
  /** Injectable for deterministic tests (default Date.now). */
  now?: () => number;
}

interface StoredUser {
  id: string;
  hands: Hand[];
  lastUpdate: number;
}

export class StateManager {
  private readonly users = new Map<string, StoredUser>();
  private readonly windows = new Map<string, WindowState>();
  private readonly now: () => number;

  constructor(options: StateManagerOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /** Stores QUANTIZED hands (D9 authority) and returns them (the caller
   *  broadcasts exactly what was stored). Creates the user on first call. */
  upsertUserHands(userId: string, hands: readonly Hand[]): Hand[] {
    const quantized = quantizeHands(hands);
    const existing = this.users.get(userId);
    if (existing) {
      existing.hands = quantized;
      existing.lastUpdate = this.now();
    } else {
      this.users.set(userId, { id: userId, hands: quantized, lastUpdate: this.now() });
    }
    return quantized;
  }

  /** Create-or-update. CREATE stamps owner = senderId (D7); UPDATE keeps
   *  the existing owner and ignores the incoming owner field entirely.
   *  Returns the authoritative stored state (for broadcast). */
  upsertWindow(senderId: string, incoming: WindowState): WindowState {
    const existing = this.windows.get(incoming.id);
    if (!existing) {
      const created: WindowState = { ...incoming, owner: senderId, lastModified: this.now() };
      this.windows.set(created.id, created);
      return created;
    }
    const updated: WindowState = {
      ...incoming,
      owner: existing.owner,
      lastModified: this.now(),
    };
    this.windows.set(updated.id, updated);
    return updated;
  }

  /** Removes the window; false for unknown ids (silent no-op, D7). */
  closeWindow(id: string): boolean {
    return this.windows.delete(id);
  }

  /** Serializable full state (D17.6): users are PRESENCE records only. */
  getFullState(): { users: UserInfo[]; windows: WindowState[] } {
    return {
      users: [...this.users.values()].map(({ id, lastUpdate }) => ({ id, lastUpdate })),
      windows: [...this.windows.values()],
    };
  }

  /** Drops the user; their WINDOWS stay (D7 — GC is M12). */
  removeUser(userId: string): void {
    this.users.delete(userId);
  }

  userCount(): number {
    return this.users.size;
  }
}
```

## 5. Work item C — CREATE `apps/backend/src/websocket/server.ts` + restructure `src/server.ts`

**C1 — `websocket/server.ts` (near-final):**

```ts
/**
 * M11 JARVIS WebSocket server (TECHNICAL_SPEC §3.1).
 *
 * DEVIATIONS from the spec sketch (documented, D17): JSON parse is guarded
 * (failures -> error message to the SENDER, never a crash); userJoined is
 * broadcast EXCLUDING the new client; the new client first receives a
 * stateSnapshot INCLUDING itself; userId = crypto.randomUUID(); no apiRouter
 * (M13). handSync is throttled per-user with a trailing flush (D9); window
 * upserts broadcast single-window deltas, windowClose broadcasts a snapshot
 * (D8 — the protocol has no removal delta).
 *
 * INTEROP (D2/D3, spiked): this CJS/NodeNext build imports the BUILT ESM
 * dist of @jarvis/shared via require(ESM) — supported on Node 24; TS 6.0.2
 * typechecks named value imports of ESM from CJS without TS1479.
 */
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { ClientMessage, Hand, ServerMessage, WindowState } from '@jarvis/shared';
import { SERVER_HANDS_BROADCAST_INTERVAL_MS, WS_PORT } from '@jarvis/shared';
import { StateManager } from '../state/manager';

export interface JARVISWSServerOptions {
  /** Default WS_PORT (4001); 0 = ephemeral port (tests). */
  port?: number;
  stateManager?: StateManager;
  /** handSync throttle per user (tests inject small values; D9). */
  broadcastIntervalMs?: number;
}

export interface JARVISWSServer {
  wss: WebSocketServer;
  /** Bound port (read after 'listening'; tests await it). */
  port(): number;
  userCount(): number;
  /** Terminates clients, clears timers, closes the server (tests: no leaked handles). */
  close(): Promise<void>;
}

function isWindowState(value: unknown): value is WindowState {
  if (typeof value !== 'object' || value === null) return false;
  const w = value as Partial<WindowState>;
  return (
    typeof w.id === 'string' &&
    typeof w.title === 'string' &&
    typeof w.owner === 'string' &&
    Array.isArray(w.position) &&
    w.position.length === 3 &&
    w.position.every((n) => typeof n === 'number') &&
    typeof w.rotationY === 'number' &&
    typeof w.scale === 'number' &&
    typeof w.zIndex === 'number' &&
    typeof w.lastModified === 'number'
  );
}

export function startJARVISWebSocketServer(options: JARVISWSServerOptions = {}): JARVISWSServer {
  const state = options.stateManager ?? new StateManager();
  const intervalMs = options.broadcastIntervalMs ?? SERVER_HANDS_BROADCAST_INTERVAL_MS;
  const wss = new WebSocketServer({ port: options.port ?? WS_PORT });
  const clients = new Map<string, WebSocket>();

  // D9 throttle state: latest pending hands + one trailing timer per user.
  const latestHands = new Map<string, Hand[]>();
  const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastBroadcast = new Map<string, number>();

  const send = (ws: WebSocket, message: ServerMessage): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  const broadcast = (message: ServerMessage, excludeUserId?: string): void => {
    const payload = JSON.stringify(message);
    for (const [uid, ws] of clients) {
      if (uid === excludeUserId) continue;
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  };

  const flushHands = (userId: string): void => {
    const timer = flushTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      flushTimers.delete(userId);
    }
    const hands = latestHands.get(userId);
    if (!hands) return;
    latestHands.delete(userId);
    lastBroadcast.set(userId, Date.now());
    broadcast({ type: 'handSync', data: { userId, hands } }, userId);
  };
  const broadcastHands = (userId: string, hands: Hand[]): void => {
    latestHands.set(userId, hands);
    const wait = intervalMs - (Date.now() - (lastBroadcast.get(userId) ?? 0));
    if (wait <= 0) {
      flushHands(userId);
    } else if (!flushTimers.has(userId)) {
      flushTimers.set(userId, setTimeout(() => flushHands(userId), wait));
    }
  };

  wss.on('connection', (ws: WebSocket) => {
    const userId = crypto.randomUUID();
    clients.set(userId, ws);
    state.upsertUserHands(userId, []); // presence record (empty hands)
    send(ws, { type: 'stateSnapshot', data: state.getFullState() }); // incl. SELF (D17.4)
    broadcast({ type: 'userJoined', data: { userId } }, userId); // EXCLUDING sender (D17.2)

    ws.on('message', (data: RawData) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        send(ws, { type: 'error', data: { message: 'Malformed JSON.' } });
        return;
      }
      if (typeof message !== 'object' || message === null || typeof message.type !== 'string') {
        send(ws, { type: 'error', data: { message: 'Invalid message envelope.' } });
        return;
      }
      switch (message.type) {
        case 'handUpdate': {
          if (!message.data || !Array.isArray(message.data.hands)) {
            send(ws, { type: 'error', data: { message: 'handUpdate requires data.hands[]' } });
            return;
          }
          const quantized = state.upsertUserHands(userId, message.data.hands);
          broadcastHands(userId, quantized);
          return;
        }
        case 'windowUpsert': {
          if (!isWindowState(message.data)) {
            send(ws, { type: 'error', data: { message: 'windowUpsert requires a WindowState' } });
            return;
          }
          const stored = state.upsertWindow(userId, message.data);
          broadcast({ type: 'windowSync', data: stored }, userId);
          return;
        }
        case 'windowClose': {
          const id = (message.data as { id?: unknown } | undefined)?.id;
          if (typeof id !== 'string') {
            send(ws, { type: 'error', data: { message: 'windowClose requires data.id' } });
            return;
          }
          if (state.closeWindow(id)) {
            broadcast({ type: 'stateSnapshot', data: state.getFullState() }, userId); // D8
          }
          return;
        }
        default:
          send(ws, { type: 'error', data: { message: 'Unknown message type.' } });
      }
    });

    ws.on('close', () => {
      clients.delete(userId);
      latestHands.delete(userId);
      const timer = flushTimers.get(userId);
      if (timer) {
        clearTimeout(timer);
        flushTimers.delete(userId);
      }
      state.removeUser(userId); // windows persist (D7)
      broadcast({ type: 'userLeft', data: { userId } });
    });

    ws.on('error', () => {
      // The close handler owns cleanup; never crash on socket errors.
    });
  });

  wss.once('listening', () => {
    console.log(`[backend] WebSocket server listening on ws://localhost:${wss.address() !== null ? (wss.address() as { port: number }).port : WS_PORT}`);
  });

  return {
    wss,
    port: () => {
      const address = wss.address();
      return typeof address === 'object' && address !== null ? address.port : WS_PORT;
    },
    userCount: () => clients.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of flushTimers.values()) clearTimeout(timer);
        flushTimers.clear();
        for (const ws of clients.values()) ws.terminate();
        clients.clear();
        wss.close(() => resolve());
      }),
  };
}
```

Note: `noFallthroughCasesInSwitch` is satisfied (every case returns); the `default` arm covers unknown types.

**C2 — `apps/backend/src/server.ts` restructure (full new shape; Express + health VERBATIM semantics, echo server REPLACED):**

```ts
/**
 * JARVIS backend (M11: Phase 4 real-time core).
 *
 * - Express HTTP on :4000 with GET /api/health (unchanged shape).
 * - JARVIS WebSocket server on :4001 (spec §3.1; M1 echo retired).
 *
 * ORDERING (D5): the WS server binds BEFORE the HTTP server listens, so
 * "health responds" implies "WS is listening" — the frontend's probe gate
 * can never race a half-started backend.
 *
 * Persistence (Redis/PostgreSQL), the API router, and conflict resolution
 * are M13/M12 per TECHNICAL_SPEC.md §3.2/§3.3.
 */
import express from 'express';
import http from 'http';
import { WS_PORT } from '@jarvis/shared';
import { startJARVISWebSocketServer } from './websocket/server';

const DEFAULT_HTTP_PORT = 4000;

const httpPort = Number(process.env.PORT ?? DEFAULT_HTTP_PORT);
const wsPort = Number(process.env.WS_PORT ?? WS_PORT);

// WebSocket first (D5 ordering), then HTTP.
const ws = startJARVISWebSocketServer({ port: wsPort });

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSec: Math.round(process.uptime()),
    wsPort,
  });
});

const httpServer = http.createServer(app);
httpServer.listen(httpPort, () => {
  console.log(`[backend] HTTP server listening on http://localhost:${httpPort}`);
});

function shutdown(): void {
  console.log('[backend] shutting down...');
  void ws.close().then(() => {
    httpServer.close(() => process.exit(0));
  });
  // Force-exit if close callbacks stall (e.g. lingering connections).
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

**C3 — `apps/backend/package.json` edits (only these):** `dependencies` += `"@jarvis/shared": "0.1.0"` (keep express/ws entries and order stable); `devDependencies` += `"vitest": "^4.1.10"`; `scripts` += `"test": "vitest run"` (after `typecheck`). Run `npm install` at the root once (creates the workspace link; NO other dependency changes — verify with `git`-less diff discipline: the lockfile change must reference only the internal link + vitest).

## 6. Work item D — backend tests (test-guard ALL of these)

**D1 — CREATE `apps/backend/src/state/manager.test.ts` (12 its, node env):**

```ts
import { describe, expect, it } from 'vitest';
import type { Hand, WindowState } from '@jarvis/shared';
import { SYNC_QUANTIZE_DECIMALS } from '@jarvis/shared';
import { StateManager } from './manager';

const hand = (x = 0.1234567): Hand => ({
  handedness: 'Right',
  landmarks: [
    { x, y: 0.9876543, z: -0.0456789 },
    { x: 0.5, y: 0.5, z: 0 },
  ],
  confidence: 0.8765432,
});

const wireWindow = (id = 'notes-1', owner = ''): WindowState => ({
  id,
  title: 'Notes',
  owner,
  position: [1.6, -0.65, 0.2],
  rotationY: 0.25,
  scale: 1.5,
  zIndex: 3,
  lastModified: 0,
});
```

Enumerated its (exact names):

1. `upsertUserHands creates a user and returns quantized hands` — first call returns landmarks rounded to `SYNC_QUANTIZE_DECIMALS` (0.123 / 0.988 / -0.046; confidence 0.877).
2. `upsertUserHands quantizes on EVERY store (server authority)` — input `0.9999999` → stored/broadcast `1` (via a second getFullState-after-update read or the return value).
3. `upsertUserHands updates hands and bumps lastUpdate monotonically` — injectable `now` returning 100 then 200; `getFullState().users[0].lastUpdate === 200`.
4. `upsertUserHands does not mutate the caller's array` — deep-equal the input object against a pre-copy.
5. `getFullState users carry id + lastUpdate only (no hands on the wire)`.
6. `upsertWindow create stamps owner = sender and ignores the client owner` — `upsertWindow('user-A', wireWindow('notes-1', 'spoofed'))` → returned/stored `owner === 'user-A'`.
7. `upsertWindow create stamps lastModified from the clock`.
8. `upsertWindow update NEVER changes the owner` — create by A, update sent "by B" → owner stays 'user-A'; position/scale/zIndex/rotationY/title take the new values.
9. `closeWindow removes and returns true; unknown id returns false`.
10. `re-create after close re-stamps the new creator` — A creates, close, B re-creates same id → owner 'user-B'.
11. `removeUser drops the user but KEEPS their windows` — userCount reflects the drop; `getFullState().windows` still contains the window.
12. `getFullState windows round-trip the wire shape` — position tuple, scalar scale, rotationY, zIndex, lastModified all present and typed.

**D2 — CREATE `apps/backend/src/websocket/server.integration.test.ts` (8 its, real ws clients, ephemeral port):**

Skeleton:

```ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage, WindowState } from '@jarvis/shared';
import { startJARVISWebSocketServer } from './server';
import type { JARVISWSServer } from './server';

let server: JARVISWSServer;

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Resolves the next message of `type` (buffering others via a queue). */
function nextMessage(ws: WebSocket, type: ServerMessage['type']): Promise<ServerMessage> {
  // per-ws queue Map + promise; reject on ws 'error'; 5 s internal timeout.
}

function send(ws: WebSocket, payload: unknown): void {
  ws.send(JSON.stringify(payload));
}

function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.once('close', resolve);
    ws.close();
  });
}

afterEach(async () => {
  await server?.close(); // terminate sockets + clear timers (no leaked handles)
});

afterAll(async () => {
  await server?.close();
});
```

(Also a `awaitListening(server)` helper: resolve when `server.port()` is nonzero — `new Promise(r => server.wss.address() ? r() : server.wss.once('listening', r))` — await it after `startJARVISWebSocketServer({ port: 0, broadcastIntervalMs: <small> })` before connecting.) The suite passes `broadcastIntervalMs: 40` unless a test says otherwise. Every `it` gets a 10 000 ms timeout (third vitest arg).

Enumerated its:

1. `join: the first client receives a stateSnapshot that includes itself` — users length 1, windows empty; `server.userCount() === 1`.
2. `second join: first client gets userJoined; second client's snapshot has both users` — A connects; B connects; A receives `userJoined` with B's userId; B's FIRST message is `stateSnapshot` with `users.length === 2`.
3. `handUpdate: others receive quantized handSync; the sender receives NOTHING` — A sends `{type:'handUpdate', data:{hands:[rawHand]}}` → B receives `handSync` with `data.userId === A-id` (A-id read from B's userJoined evidence) and quantized landmarks; A receives no message for 300 ms (quiet-window assert).
4. `handSync throttle: bursts coalesce and the LAST state always lands` — A sends 5 handUpdates 10 ms apart with a marker landmark per send (x = 0.1 … 0.5); within 500 ms B's received handSync count is < 5 and the final one carries x === 0.5 (trailing flush; D9 — assert `< 5 && last === 0.5`, never exact counts).
5. `windowUpsert: others receive windowSync with the SERVER-stamped owner` — A upserts `wireWindow('notes-2')` (owner '') → B receives `windowSync` with `data.owner === A-id` and the tuple/scalar wire shape.
6. `windowClose: others receive a stateSnapshot WITHOUT the window (D8)` — A closes notes-2 → B receives `stateSnapshot` whose windows lack `notes-2`.
7. `malformed JSON: sender gets error, server survives, flows still work` — A sends `not-json{{`; A's next message is `error`; then A sends a valid handUpdate and B still receives handSync.
8. `disconnect: remaining client gets userLeft; the departed user's windows persist` — A creates a window, then A disconnects → B receives `userLeft` (A-id); a NEW client C's snapshot still contains A's window (D7) — close C at test end.

Cleanup discipline: every opened client is closed in-test or tracked and closed in `afterEach` alongside `server.close()` (build the helper as a `clients: WebSocket[]` array + `closeAll()`); the suite MUST exit cleanly (`vitest run` returns) — paste the exit evidence.

## 7. Work item E — CREATE `apps/frontend/src/utils/sync.ts` (near-final; node-pure)

```ts
/**
 * M11 SyncManager + window-sync bridge (frontend side of the §3.1 protocol).
 *
 * THE PROBE GATE (D4, mandatory): a failed new WebSocket(...) logs a NATIVE
 * browser console error that no handler can suppress, and every verifier
 * runs a zero-console-error gate with the backend down. So this manager
 * NEVER constructs a WebSocket until a silent health probe
 * (fetch healthUrl {mode:'no-cors'} + AbortController timeout, .catch =
 * false) has SUCCEEDED — backend down means probe-fails-quietly forever,
 * zero WS attempts, status 'disconnected' (HUD 'offline'), one
 * '[Sync] offline' line total.
 *
 * Purity contract (mirrors gemini.ts/search.ts): NO import.meta, NO React,
 * NO DOM-only APIs — env is read ONLY in App.tsx; socket factory, fetch,
 * and clock are injectable so node vitest covers the retry/backoff/throttle
 * machinery with fakes and zero network.
 *
 * Console contract (D6): '[Sync] connected' / '[Sync] offline' on lifecycle
 * transitions ONLY (never per retry). Inbound-message logs live in App.
 */
import type { Hand, ServerMessage, WindowState } from '@jarvis/shared';
import { HTTP_PORT, SYNC_HANDS_INTERVAL_MS, SYNC_QUANTIZE_DECIMALS, quantizeHands } from '@jarvis/shared';

export type SyncStatus = 'disconnected' | 'connecting' | 'connected';

/** Default dev endpoint (README M11; override via VITE_SYNC_URL in App.tsx). */
export const DEFAULT_SYNC_URL = 'ws://localhost:4001';

/** Probe/backoff schedule (D4): immediate first probe, then 500ms * 2^n, capped. */
export const SYNC_INITIAL_BACKOFF_MS = 500;
export const SYNC_MAX_BACKOFF_MS = 5000;
export const SYNC_PROBE_TIMEOUT_MS = 2500;

/** Derive the health-probe URL from the sync URL (D4): ws->http, wss->https,
 *  port -> HTTP_PORT, path /api/health; an explicit override wins. */
export function deriveHealthUrl(syncUrl: string, override?: string): string {
  if (override) return override;
  const url = new URL(syncUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.port = String(HTTP_PORT);
  url.pathname = '/api/health';
  url.search = '';
  return url.toString();
}

/** Structural socket interface (on* PROPERTY pattern, D12 — never
 *  addEventListener, so v4's soak listener counters never see the socket).
 *  The browser WebSocket satisfies this structurally; tests pass a fake. */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

export interface SyncManagerOptions {
  socketUrl?: string;
  healthUrl?: string;
  socketFactory?: WebSocketFactory;
  fetchImpl?: typeof fetch;
  now?: () => number;
  handsIntervalMs?: number;
  probeTimeoutMs?: number;
  onStatus?: (status: SyncStatus) => void;
}

interface WaitHandle {
  settle: () => void;
}

export class SyncManager {
  private readonly socketUrl: string;
  private readonly healthUrl: string;
  private readonly socketFactory: WebSocketFactory;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly handsIntervalMs: number;
  private readonly probeTimeoutMs: number;
  private readonly onStatus?: (status: SyncStatus) => void;

  private statusValue: SyncStatus = 'disconnected';
  private socket: WebSocketLike | null = null;
  private closed = false;          // close() is terminal (fresh per scene, D12)
  private started = false;
  private backoffMs = SYNC_INITIAL_BACKOFF_MS;
  private loggedOffline = false;   // ONE '[Sync] offline' per offline stretch (D6)
  private readonly waits = new Set<WaitHandle>();
  private readonly handlers = new Set<(message: ServerMessage) => void>();
  private lastHandsSend = -Infinity;
  private lastHandsWereNonEmpty = false;

  constructor(options: SyncManagerOptions = {}) {
    this.socketUrl = options.socketUrl ?? DEFAULT_SYNC_URL;
    this.healthUrl = options.healthUrl ?? deriveHealthUrl(this.socketUrl);
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.handsIntervalMs = options.handsIntervalMs ?? SYNC_HANDS_INTERVAL_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? SYNC_PROBE_TIMEOUT_MS;
    this.onStatus = options.onStatus;
  }

  get status(): SyncStatus {
    return this.statusValue;
  }

  /** Starts the probe loop (idempotent). */
  connect(): void {
    if (this.started || this.closed) return;
    this.started = true;
    void this.runProbeLoop();
  }

  /** Terminal teardown: clears every timer/wait, closes the socket,
   *  emits nothing afterwards. Idempotent (D12). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const wait of this.waits) wait.settle();
    this.waits.clear();
    this.detachSocket();
  }

  sendHands(hands: readonly Hand[]): void {
    if (this.statusValue !== 'connected' || !this.socket) return;
    if (hands.length === 0) {
      // Empty-hand suppression (D6): silent unless announcing hands-gone.
      if (!this.lastHandsWereNonEmpty) return;
      this.lastHandsWereNonEmpty = false;
    } else {
      this.lastHandsWereNonEmpty = true;
    }
    const now = this.now();
    if (now - this.lastHandsSend < this.handsIntervalMs) return;
    this.lastHandsSend = now;
    this.rawSend({ type: 'handUpdate', data: { hands: quantizeHands(hands) } });
  }

  sendWindowUpsert(window: WindowState): void {
    if (this.statusValue !== 'connected') return;
    this.rawSend({ type: 'windowUpsert', data: window });
  }

  sendWindowClose(id: string): void {
    if (this.statusValue !== 'connected') return;
    this.rawSend({ type: 'windowClose', data: { id } });
  }

  subscribe(handler: (message: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  // --- internals -----------------------------------------------------------

  private setStatus(status: SyncStatus): void {
    if (this.closed || this.statusValue === status) return;
    this.statusValue = status;
    if (status === 'connected') console.log('[Sync] connected');
    if (status === 'disconnected') console.log('[Sync] offline');
    this.onStatus?.(status);
  }

  private rawSend(message: unknown): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // A just-died socket throws; the close path owns reconnection.
    }
  }

  /** setTimeout whose promise ALSO settles on close() — the loop exits. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const handle: WaitHandle = {
        settle: () => resolve(),
      };
      const timer = setTimeout(() => {
        this.waits.delete(handle);
        resolve();
      }, ms);
      // close() settles the wait; the stale timer is harmless no-op resolve.
      this.waits.add(handle);
      void timer;
    });
  }

  private async probeOnce(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    try {
      // no-cors: an opaque response RESOLVES (server up); only network
      // failure rejects — and a rejected fetch logs NOTHING natively (D4).
      await this.fetchImpl(this.healthUrl, { mode: 'no-cors', signal: controller.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async runProbeLoop(): Promise<void> {
    while (!this.closed) {
      const healthy = await this.probeOnce();
      if (this.closed) return;
      if (healthy) {
        this.openSocket();
        return; // socket events own the lifecycle from here
      }
      if (!this.loggedOffline) {
        this.loggedOffline = true;
        this.setStatus('disconnected'); // logs '[Sync] offline' once (D6)
      }
      await this.wait(this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, SYNC_MAX_BACKOFF_MS);
    }
  }

  private openSocket(): void {
    this.setStatus('connecting');
    const socket = this.socketFactory(this.socketUrl);
    this.socket = socket;
    socket.onopen = () => {
      if (this.closed) return;
      this.backoffMs = SYNC_INITIAL_BACKOFF_MS;
      this.loggedOffline = false;
      this.lastHandsSend = -Infinity;
      this.setStatus('connected');
    };
    socket.onmessage = (event) => {
      if (this.closed) return;
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (typeof message !== 'object' || message === null || typeof message.type !== 'string') return;
        for (const handler of this.handlers) handler(message);
      } catch {
        // Malformed server frames are ignored silently (D6).
      }
    };
    socket.onclose = () => {
      if (this.closed) return;
      this.detachSocket();
      this.setStatus('disconnected'); // logs '[Sync] offline' (unexpected drop)
      this.backoffMs = SYNC_INITIAL_BACKOFF_MS;
      void this.runProbeLoop(); // re-probe (server may be restarting)
    };
    socket.onerror = () => {
      // Native console behavior is out of our hands; onclose follows.
    };
  }

  private detachSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.onerror = null;
    try {
      socket.close(1000);
    } catch {
      // already dead — fine
    }
  }
}

// ---------------------------------------------------------------------------
// Window-sync bridge (D10)
// ---------------------------------------------------------------------------

/** Structural slice of WindowManager's FloatingWindow (Vector3/Euler satisfy
 *  this structurally — windowManager.ts stays untouched and un-imported). */
export interface SyncWindowLike {
  id: string;
  title: string;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  rotation: { y: number };
  zIndex: number;
}

/** Manager window -> wire state (D1 tuple/scalar conversion; owner is ''
 *  — the server stamps the real owner, D7). */
export function toWindowState(win: SyncWindowLike, lastModified: number): WindowState {
  const q = (n: number): number => Math.round(n * 10 ** SYNC_QUANTIZE_DECIMALS) / 10 ** SYNC_QUANTIZE_DECIMALS;
  return {
    id: win.id,
    title: win.title,
    owner: '',
    position: [q(win.position.x), q(win.position.y), q(win.position.z)],
    rotationY: q(win.rotation.y),
    scale: q(win.scale.x),
    zIndex: win.zIndex,
    lastModified,
  };
}

export interface WindowSyncSender {
  sendWindowUpsert(window: WindowState): void;
  sendWindowClose(id: string): void;
}

export interface WindowSyncBridge {
  /** Diff the current window list against the snapshot and emit (call from
   *  the WindowManager onChange callback — create/move/resize/rotate/
   *  bring-to-front/close all notify; highlight churn emits nothing). */
  sync(): void;
  /** Force-send every current window (call on the 'connected' transition —
   *  D10 flush-on-connect; stale server windows closed during an outage are
   *  a documented M12 edge). */
  flushAll(): void;
}

export function createWindowSyncBridge(
  getWindows: () => readonly SyncWindowLike[],
  sender: WindowSyncSender,
  now: () => number = Date.now,
): WindowSyncBridge {
  let snapshot = new Map<string, string>(); // id -> quantized wire key
  const keyOf = (w: WindowState): string =>
    JSON.stringify([w.title, w.position, w.rotationY, w.scale, w.zIndex]);
  const sync = (): void => {
    const current = new Map<string, WindowState>();
    for (const win of getWindows()) current.set(win.id, toWindowState(win, now()));
    for (const [id, wire] of current) {
      const key = keyOf(wire);
      if (snapshot.get(id) !== key) {
        snapshot.set(id, key);
        sender.sendWindowUpsert(wire);
      }
    }
    for (const id of [...snapshot.keys()]) {
      if (!current.has(id)) {
        snapshot.delete(id);
        sender.sendWindowClose(id);
      }
    }
  };
  return {
    sync,
    flushAll: () => {
      snapshot = new Map();
      sync();
    },
  };
}
```

Notes: `SYNC_QUANTIZE_DECIMALS` is imported for the local `q` (keeps `toWindowState` self-contained; `quantizeNumber` could be imported instead — either is fine, use ONE and keep the file consistent). `new URL` is available in Node ≥10 and browsers. `void timer` in `wait()` avoids a floating promise lint hit; the `close()` path settles waits without clearing the native timer (a resolved-again no-op) — that is deliberate and harmless; document it.

## 8. Work item F — `apps/frontend/src/App.tsx` edits (enumerated; NOTHING else changes)

**F1 — imports.** Extend line 4's type import: `import type { CameraState, Hand, Handedness, MediaPipeState, ServerMessage, WindowState } from '@jarvis/shared';` and add after the bootScene import block:

```tsx
import {
  DEFAULT_SYNC_URL,
  SyncManager,
  createWindowSyncBridge,
  deriveHealthUrl,
} from './utils/sync';
import type { SyncStatus, WindowSyncBridge } from './utils/sync';
```

(`SyncManager` is a class — the value import carries its type too; `useRef<SyncManager | null>` needs no alias. `import type` for the two pure types per `verbatimModuleSyntax`; no unused imports — `noUnusedLocals`.)

**F2 — module-scope env read (the React boundary, D11):**

```tsx
/** M11 sync endpoints (D11): env is read HERE only — utils/sync.ts is
 *  node-pure. VITE_HEALTH_URL is optional (derived from VITE_SYNC_URL by
 *  default: ws->http, port -> 4000, /api/health). */
const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? DEFAULT_SYNC_URL;
const SYNC_HEALTH_URL: string = deriveHealthUrl(
  SYNC_URL,
  import.meta.env.VITE_HEALTH_URL,
);
```

**F3 — HudProps + Hud rows (D18).** `HudProps` gains `syncStatus: SyncStatus; syncUsers: number;`. The `Hud` signature destructures them. Append two rows after the Latency row (line 98):

```tsx
      <StatusRow label="Sync" value={syncStatus === 'disconnected' ? 'offline' : syncStatus} />
      <StatusRow label="Users" value={String(syncUsers)} />
```

**F4 — HUD title (line 90):** `JARVIS · Milestone 10` → `JARVIS · Milestone 11`, and the comment block (lines 85–89) becomes exactly:

```tsx
        {/* HUD title bumps per milestone (now "JARVIS · Milestone 11").
            verify_milestone11.py owns the exact pin (introspection finder +
            HUD check); every older verifier uses the version-tolerant
            'JARVIS · Milestone' lookup (v10's exact pin was made tolerant
            in the M11 lockstep — D15 two-tier policy). */}
```

**F5 — state + refs (inside the App component, after the M8 refs block ~line 232):**

```tsx
  // M11 sync state (D18): DISCRETE transitions only — connect/drop/join/
  // leave; inbound handSync/windowSync NEVER setState (refs + logs).
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
  const [syncUsers, setSyncUsers] = useState(0);
  const syncManagerRef = useRef<SyncManager | null>(null);
  const windowSyncBridgeRef = useRef<WindowSyncBridge | null>(null);
  // Remote state (M12 will render these; M11 stores + logs only).
  const remoteHandsRef = useRef<Map<string, Hand[]>>(new Map());
  const remoteWindowsRef = useRef<Map<string, WindowState>>(new Map());
  // 1 s-throttle timestamp shared by the inbound [Sync] logs (D6).
  const lastSyncLogRef = useRef(0);
```

**F6 — the stable sync callbacks (before `handleSceneReady`):**

```tsx
  /** M11 (D18): status transitions are rare; 'connected' also flushes the
   *  local window set so late joiners see it (D10). */
  const handleSyncStatus = useCallback((status: SyncStatus) => {
    setSyncStatus(status);
    if (status === 'connected') windowSyncBridgeRef.current?.flushAll();
  }, []);

  /** M11 inbound messages: store in refs + 1 s-throttled logs (D6).
   *  RENDERING remote hands/windows is M12 — deliberately absent. */
  const handleServerMessage = useCallback((message: ServerMessage) => {
    const now = performance.now();
    const logThrottled = (line: string): void => {
      if (now - lastSyncLogRef.current < 1000) return;
      lastSyncLogRef.current = now;
      console.log(line);
    };
    switch (message.type) {
      case 'stateSnapshot':
        remoteWindowsRef.current = new Map(
          message.data.windows.map((w) => [w.id, w]),
        );
        setSyncUsers(message.data.users.length);
        return;
      case 'userJoined':
        setSyncUsers((count) => count + 1);
        logThrottled(`[Sync] userJoined userId=${message.data.userId}`);
        return;
      case 'userLeft':
        setSyncUsers((count) => Math.max(0, count - 1));
        logThrottled(`[Sync] userLeft userId=${message.data.userId}`);
        return;
      case 'handSync':
        remoteHandsRef.current.set(message.data.userId, message.data.hands);
        logThrottled(
          `[Sync] handSync userId=${message.data.userId} hands=${message.data.hands.length}`,
        );
        return;
      case 'windowSync':
        remoteWindowsRef.current.set(message.data.id, message.data);
        logThrottled(`[Sync] windowSync id=${message.data.id}`);
        return;
      case 'error':
        logThrottled(`[Sync] server error: ${message.data.message}`);
        return;
    }
  }, []);
```

**F7 — `handleSceneReady` edits (lines 329–376).** Three changes, everything else identical:

(a) At the very top of the callback body, before `cameraRef.current = camera;`:

```tsx
      // M11 (D12): replace the previous scene's SyncManager explicitly —
      // its probe/timer loops never tick again. No unmount effect needed
      // (the wm/engine/rig pattern: refs replaced wholesale per scene).
      syncManagerRef.current?.close();
      syncManagerRef.current = null;
      windowSyncBridgeRef.current = null;
```

(b) Replace line 335's `wm.setOnChange(syncWindowsThrottled);` with the bridge-riding wrapper (D10) — the manager is created FIRST, then the bridge, then the wrapper, then subscribe + connect (order matters: `onStatus` must see `windowSyncBridgeRef` set before `connect()` fires the first probe):

```tsx
      const wm = new WindowManager(scene);
      // M11: per-scene SyncManager (fresh, D12) + the window-sync bridge
      // (D10) riding the SAME onChange notification as the React snapshot.
      const sync = new SyncManager({
        socketUrl: SYNC_URL,
        healthUrl: SYNC_HEALTH_URL,
        onStatus: handleSyncStatus,
      });
      syncManagerRef.current = sync;
      windowSyncBridgeRef.current = createWindowSyncBridge(
        () => wm.getAllWindows(),
        sync,
      );
      wm.setOnChange(() => {
        syncWindowsThrottled();
        windowSyncBridgeRef.current?.sync();
      });
      sync.subscribe(handleServerMessage);
```

(c) At the END of the callback, after `syncWindows();` (the boot windows must be created first so the bridge's onChange diffs RECORD them while sends no-op): `sync.connect();` — plus update the `useCallback` deps array to include `handleSyncStatus` and `handleServerMessage` (both stable).

**F8 — `handleHandsDetected` (line 378):** add as the first statement of the body:

```tsx
    syncManagerRef.current?.sendHands(hands);
```

**F9 — App docblock:** append one paragraph after the M10 one (after line 201): "M11 (Phase 4 part 1): the real-time core. A per-scene SyncManager (node-pure utils/sync.ts) silently health-probes the backend and only then opens the ws://…:4001 connection (the failed-handshake native console error is unsuppressible — the probe gate keeps every zero-error verifier honest, D4); hands ride the 50 ms quantized throttle, window mutations ride the onChange bridge diff (D10), the HUD gains Sync/Users rows (D18), and remote state is stored + logged but NOT rendered (M12)."

**F10 — the Hud JSX usage (line 711–719):** pass the two new props `syncStatus={syncStatus}` and `syncUsers={syncUsers}`. NOTHING else in the JSX changes.

After your edits: `grep -n "Milestone 10" apps/frontend/src/App.tsx` → zero hits; `grep -rn "import.meta.env" apps/frontend/src` → exactly THREE files (Chat.tsx, Search.tsx, App.tsx).

## 9. Work item G — CREATE `apps/frontend/src/utils/sync.test.ts` (16 its, node env, fake timers + injectables; test-guard)

Fixtures: a `FakeSocket implements WebSocketLike` (records `send` calls + a `sentMessages()` JSON parser; helpers `simulateOpen()`, `simulateMessage(obj)`, `simulateClose()`); a `failingFetch(n)` factory (rejects the first n calls with `TypeError`, then resolves an opaque-like `{}`); a `hangingFetch` that never settles but ABORTS on the signal (rejects with `AbortError` on `signal.addEventListener('abort', …)` — the search.test.ts test-22 idiom); fake timers via `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(...)` for the probe loop; a controllable `now` fn for throttle cadence; a console spy (`vi.spyOn(console, 'log')`) where a `[Sync]` line is asserted. Enumerated its (exact names; 16 total):

1. `deriveHealthUrl maps ws->http and wss->https with HTTP_PORT and /api/health` — `ws://localhost:4001` → `http://localhost:4000/api/health`; `wss://example.com:8443` → `https://example.com:4000/api/health`.
2. `deriveHealthUrl handles portless hosts and yields to an explicit override` — `ws://example.com` → `http://example.com:4000/api/health`; override string returned verbatim.
3. `DEFAULT_SYNC_URL is ws://localhost:4001`.
4. `quantizeHands (shared) rounds landmarks + confidence and does not mutate input` — via the shared export (guards the shared-module resolution too).
5. `toWindowState converts the manager shape to the wire shape` — Vector3-like/Euler-like in; tuple position / scalar scale.x / rotationY / zIndex / lastModified out.
6. `bridge emits upsert on create and on quantized change, silent below the threshold` — fake windows list; create emits; a 0.0004 move emits NOTHING; a 0.002 move emits; title/zIndex changes emit.
7. `bridge emits close when a window vanishes`.
8. `bridge.flushAll re-sends every current window` (snapshot cleared).
9. `SyncManager is silent while the health probe fails: no socket attempts, status stays 'disconnected', ONE '[Sync] offline'` — failingFetch(∞); connect(); advance through 3 backoff cycles; socketFactory throws if ever called; exactly one `[Sync] offline` log.
10. `SyncManager opens the socket only after a successful probe and connects` — failingFetch(2) then success; advance 500+1000; factory called ONCE; simulateOpen → status 'connected', `[Sync] connected` logged, backoff reset observable via a later drop test or a status-sequence array.
11. `probe retries back off 500 -> 1000 -> 2000 -> 4000 -> capped at 5000` — record fetch-call timestamps against the fake clock; assert gaps.
12. `probe fetch gets an AbortController timeout` — hangingFetch; advance past SYNC_PROBE_TIMEOUT_MS; the call rejects via abort and the loop retries (fetch called again).
13. `sendHands cadence: >= 50 ms between sends, empty hands suppressed, silent while disconnected` — connected fake; calls at t=0,10,50,60,100 send exactly 3 (t=0,50,100); `sendHands([])` before any non-empty send sends NOTHING; a non-empty→empty sequence sends exactly ONE empty update; nothing sends while disconnected.
14. `sendHands quantizes the wire payload` — sent JSON landmarks are 3-decimal.
15. `subscribe delivers parsed ServerMessages, unsubscribes, and malformed frames are ignored silently` — simulateMessage(stateSnapshot…) reaches the handler; after unsubscribe nothing; simulateMessage with invalid JSON string does not throw and does not log errors.
16. `unexpected close re-probes; explicit close() is terminal, clears timers, and is idempotent` — connected; simulateClose → status 'disconnected', `[Sync] offline`, fetch called again (backend "restarted": make fetch succeed, factory returns a new fake) → reconnects; then `close()` → advancing timers forever yields NO further fetch/socket; second `close()` no-ops.

Expected totals: frontend **247 + 16 = 263**; backend **12 + 8 = 20**. Reconcile any mismatch BEFORE proceeding. Every OTHER existing test file stays byte-identical.

## 10. Work item H — CREATE `docs/scripts/verify_milestone11.py` (v11)

Copy `verify_milestone10.py` as the structural skeleton VERBATIM where possible (fake-webcam flags, 1280×800, console/pageerror/request listeners, `PERF_LINE_PATTERN`, `fully_on_screen`, `error_snapshot`, summary JSON, `OVERALL: PASS/FAIL`, mid-flight console persistence, the native-click launcher driver — mouse clicks block on the WebGL canvas). Docstring describes the lettered checks + honest notes (below). NEW machinery:

- **Backend lifecycle (D16):** at start, assert `apps/backend/dist/server.js` exists (else print `run npm run build:backend first` and exit 2); `backend = subprocess.Popen(["node", "dist/server.js"], cwd=<repo>/apps/backend, stdout=log, stderr=STDOUT)` with the log file redirected to `docs/screenshots/m11-backend.log`; poll `http://localhost:4000/api/health` via `urllib.request` (timeout 2 s per try, ≤ 15 s total) and RECORD the JSON (`wsPort` must be 4001). Kill = `backend.terminate(); backend.wait(timeout=10)` — ONLY between phases. Restart = same Popen + poll. `finally:` kill if alive.
- **Second user (D16):** `import websocket` (websocket-client 1.9.0 — installed; on ImportError exit 2 with a clear message). Helper `ws_recv_json(ws, want_type, timeout)` looping `ws.settimeout(...)` + `json.loads(ws.recv())`, buffering non-matching messages.
- **Websocket-attempt counter:** `page.on("websocket", lambda w: ws_urls.append(w.url))` — assert NO url contains `:4001` on the OFFLINE page (Vite HMR talks to `:5173` and is expected — filter by port, D4).

Procedure (in order; page 1 = the main page):

1. Start backend (phase UP-1), wait health.
2. Navigate page 1 (`domcontentloaded`), `wait_for_timeout(14000)`. Screenshots `m11-scene.png` + `m11-full.png`; introspection #1: HUD (`JARVIS · Milestone 11` exact, Camera/MediaPipe/Windows=4, `Sync` + `connected`, `Users` + `1` — parsed via `re.search(r"Sync\s+(\S+)", hud)` and `re.search(r"Users\s+(\d+)", hud)`), 4 boot windows, boot line "4 app windows created", video/tracks.
3. Python user B connects to `ws://localhost:4001`: B's FIRST message must be `stateSnapshot` with `users.length == 2` and `windows` ids ⊇ {dashboard-1, notes-1, chat-1, search-1} (flush-on-connect evidence, D10); `wait_for_timeout(1500)` (lets the page's throttled userJoined log clear the 1 s window); introspection #2: HUD `Users: 2`; console has `[Sync] userJoined userId=`; screenshot `m11-multiuser.png`.
4. B sends `{type:'handUpdate', data:{hands:[<one raw hand with x=0.123456>]}}` 10× at 100 ms; `wait_for_timeout(1500)`; console must contain `[Sync] handSync userId=` + `hands=1`; ALSO assert the handSync log's userId equals B's uuid (parse from the line) and that page 1 sent NO hands while idle (the empty-suppression world: assert the console had no handSync line BEFORE step 4's sends).
5. Window round-trip: native-click `[data-window-id="dashboard-1"] [data-testid="launcher-open-notes"]` (the M9/M10 dispatch idiom); `wait_for_timeout(1000)`; B must receive `windowSync` with `data.id == 'notes-2'`, `data.owner == <B's earlier userJoined userId — i.e. the PAGE's uuid>` (D7 server-stamped owner evidence), `len(data.position) == 3`, `isinstance(data.scale, float)`; page console has no NEW errors. Then native-click `[data-window-id="notes-2"] button[aria-label="Close Notes"]`; `wait_for_timeout(800)`; B must receive a `stateSnapshot` WITHOUT `notes-2` (D8).
6. B closes cleanly (`ws.close()`); `wait_for_timeout(1500)`; introspection #3: HUD `Users: 1`; console has `[Sync] userLeft userId=`.
7. End page 1 (`browser` stays, context 1 closed or simply navigate a NEW page object), TERMINATE the backend, `wait 1.5 s` (margins, D5).
8. **Offline phase:** new page (same browser), navigate, `wait_for_timeout(9000)`; introspection #4: HUD `Sync` + `offline`, `Users` + `0`, 4 boot windows + boot line (app fully functional), console page-errors ZERO, console `[error]` lines ZERO, console contains `[Sync] offline`, websocket-attempt list for THIS page contains NO `:4001` url; screenshot `m11-offline.png`.
9. **Reconnect phase:** restart the backend (poll health); poll the HUD (≤ 12 s, 500 ms steps) until `Sync` + `connected`; console gains `[Sync] connected`; introspection: `Users: 1` (self-snapshot, D17.4). Then python user C joins → `wait_for_timeout(1500)` → HUD `Users: 2`; C closes; screenshot `m11-reconnect.png`.
10. Summary + `m11-console.txt` + `m11-summary.json` (include `backend_health`, `ws_urls_page1/offline`, `B_messages` digest, `sync_hud` readings per phase); print `=== CHECKS ===` + `OVERALL`.

Checks (all must PASS; contiguous a–p, 16):

- `a: zero console errors and zero page errors across BOTH pages (incl. offline + reconnect)` — the probe gate's whole point.
- `b: boot scene exact: 4 app windows, ids exactly dashboard-1 + notes-1 + chat-1 + search-1, all fully on screen, boot console line says 4` (page 1).
- `c: HUD shows exact M11 title, Camera active, MediaPipe ready, Windows = 4, Sync connected, Users = 1 at boot` — v11 owns the exact `JARVIS · Milestone 11` pin (finder + this check, D15/D18).
- `d: backend /api/health returns status ok with wsPort 4001 (subprocess is OUR M11 server)`.
- `e: multi-user: B join -> page Users 2 + [Sync] userJoined log; B snapshot users = 2 and includes the page's 4 flushed boot windows; B close -> Users 1 + [Sync] userLeft`.
- `f: handSync: B's handUpdates produce page console [Sync] handSync userId=<B> hands=1; page was handSync-silent before B sent (empty-hand suppression)`.
- `g: window round-trip: launcher opens notes-2 -> B receives windowSync (owner = page userId, tuple position, scalar scale); chrome close -> B receives stateSnapshot without notes-2; zero new errors`.
- `h: offline: backend down + fresh page -> Sync offline, Users 0, zero console/page errors, [Sync] offline line present, ZERO :4001 websocket attempts, app functional (4 windows + boot line)`.
- `i: reconnect: backend restart -> Sync connected + [Sync] connected within 12 s; Users 1; new user C joins -> Users 2`.
- `j: >= 1 [Performance] line, every line matching the M4 four-key format` (v10 check l verbatim).
- `k: latency >= 2 lines, min avg in 150-260ms, < 300ms` (v10 check m verbatim).
- `l: cleanup counts balanced (CameraCapture == HandTracker, 2-4 each — two page loads)`.
- `m: exactly 1 live video track (page 1 introspection)`.
- `n: max logged FPS >= 30 (boot window)`.
- `o: no gesture log lines (no hands on fake webcam)`.
- `p: backend log contains the HTTP + WebSocket listening lines`.

Docstring honest notes: (1) the fake webcam produces no hands, so the PAGE's outgoing hand path is unit/browser-hybrid-evidenced (unit: sync.test.ts cadence/quantization/suppression; browser: the page stays hand-silent while B drives inbound handSync); (2) remote hands/windows are stored + logged but NOT rendered (M12) — the multi-user evidence is protocol-level (messages + HUD counts), not visual overlays; (3) the offline check is deliberately reload-shaped (fresh page against a dead backend): killing the backend mid-session can produce a browser-native abnormal-close console error that no page code can suppress (SPIKE 2 documents the observed behavior), so v11 never creates that window deterministically (D5); (4) v11 manages the backend subprocess itself and requires `npm run build:backend` beforehand; (5) conflict resolution (two users moving one window) is M12 — v11 never exercises it.

## 11. Work item I — the v10 lockstep (hash-disciplined; EXACTLY these edits)

BEFORE any edit: `sha256sum docs/scripts/verify_milestone*.py` — must match section 1's table exactly (a mismatch = baseline drift: STOP and report). v1–v9: ZERO edits (already tolerant — re-grep and paste).

**v10 `verify_milestone10.py` — exactly three edit regions:**

1. **Finder comment + string (lines 117–120).** Before:

```python
          // v10 owns the CURRENT title, so this verifier pins the exact
          // string (D14 tier 1); older verifiers are tolerant.
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone 10'));
```

   After:

```python
          // Version-tolerant since M11 (the title moved to Milestone 11);
          // the current-milestone verifier v11 owns the exact pin (D15).
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
```

2. **Check e (lines 692–693).** Key: `"e: HUD shows exact M10 title, Camera active, MediaPipe ready, Windows = 4 at boot": (` → `"e: HUD title present (version-tolerant since M11), Camera active, MediaPipe ready, Windows = 4 at boot": (`; assertion: `"JARVIS · Milestone 10" in hud` → `"JARVIS · Milestone" in hud`. **Line 699's `int(windows_row.group(1)) == 4` is UNTOUCHED** (M11 adds no boot window — verify by reading, do not edit).
3. **Docstring item e (lines 14–15).** Before: `e) HUD shows exact M10 title, Camera active, MediaPipe ready, Windows = 4` / `at boot (v10 owns the exact title + count pins — D14 tier 1)`. After:

```python
  e) HUD title present (version-tolerant since M11), Camera active,
     MediaPipe ready, Windows = 4 at boot (exact title pin lives in v11)
```

Everything else in v10 SURVIVES UNTOUCHED — the docstring header (line 1), check b/c/f–q, the boot-line pin (`4 app windows created` — still true), the launcher pins. AFTER the edits: re-run `sha256sum` (v1–v9 byte-identical; v10 old→new; v11 new), then run ALL ELEVEN verifiers in order 1→11 — every one must print `OVERALL: PASS`. Paste the expected-grep-state evidence:

- `grep -n "JARVIS · Milestone 10" docs/scripts/*.py` → ZERO hits (v10's two pins made tolerant).
- `grep -n "JARVIS · Milestone" docs/scripts/*.py` → tolerant lookups in v2–v10 + the exact `JARVIS · Milestone 11` pins ONLY in v11 (finder + check c).
- `grep -rn "app windows created" docs/scripts/` → hits ONLY in v9 (tolerant filter), v10 (exact "4"), v11 (exact "4").
- `grep -rn "import.meta.env" apps/frontend/src` → exactly THREE hits (Chat.tsx, Search.tsx, App.tsx).
- `grep -n "Milestone 10" apps/frontend/src/App.tsx` → ZERO hits.

## 12. Work item J — README.md (docs-guard)

**J1 — line 5 status blurb (sanctioned, same close-out convention as M10):** replace the Milestone-10/Phase-3 blurb with the same shape: "**Milestone 11 status: Phase 4 UNDERWAY.** The real-time core is live: an Express + WebSocket backend (ports 4000/4001) tracks users, quantized hand updates, and window state, and the HUD shows Sync/Users; multiple clients see each other join and receive each other's hand/window traffic. 263 frontend + 20 backend tests + eleven verifiers green; remote-hand rendering and conflict resolution are M12; the API proxy and persistence are M13. See the Milestone 11 section." (facts pinned, wording yours).

**J2 — append the M11 section after the M10 section (end of file), mirroring the M9/M10 structure:** heading `## Milestone 11 — Real-time core: sync protocol, StateManager + WS server, SyncManager, multi-user HUD (Phase 4 part 1)`, then:

- **What was built** — one bullet per artifact: shared protocol additions (D1 shapes, constants, `quantizeHands`, the `.js`-specifier dist fix D2), backend `state/manager.ts` (D7 ownership, D9 quantize authority) + `websocket/server.ts` (§3.1 routing, userJoined-excludes-sender, snapshot-includes-self, throttled handSync with trailing flush, error-to-sender, D5 WS-before-HTTP bind order) + `server.ts` restructure (echo retired), frontend `utils/sync.ts` (probe gate D4, backoff, throttle + empty-suppression D6, bridge D10, injectables D11), App wiring (per-scene lifecycle D12, sendHands hook, onChange bridge, HUD rows D18, title), tests (+16 frontend → 263; +20 backend), the root test script (D14), `verify_milestone11.py` (D16), v10 lockstep (D15).
- **How to run the backend** — `npm run dev:backend` (tsx watch, :4000/:4001; requires nothing else), or `npm run build:backend && npm start --workspace @jarvis/backend` (dist; what v11 spawns); `npm test` now runs BOTH workspaces; the app is fully functional with the backend DOWN (probe gate → HUD `Sync: offline`).
- **Configuration** — optional `apps/frontend/.env.local`: `VITE_SYNC_URL=ws://localhost:4001` (default shown) and optional `VITE_HEALTH_URL` (default derived: ws→http, port→4000, `/api/health`); restart `npm run dev:frontend` after edits.
- **Architecture in words** — camera → MediaPipe → gestures/interactions (unchanged) → WindowManager mutations → onChange → bridge diff → SyncManager (probe gate → WS :4001) → JARVIS server (StateManager + per-user throttled broadcasts) → other clients' SyncManager → refs + throttled logs (M12 renders). Bandwidth measures (vision §8 challenge 4): ~20 Hz quantized hand sends, ~8 KB/s worst case two hands, window deltas only on real mutations.
- **The probe gate (why)** — the failed-handshake native console error explanation (D4) + the reload-shaped offline verification (D5) + SPIKE 2's observed kill-mid-session behavior (whatever the spike shows — document it honestly).
- **Interop note (D2/D3)** — the broken-extensionless-dist discovery, the `.js`-specifier fix, require(ESM) on Node 24, TS 6.0.2 NodeNext behavior, and the vitest resolution decision from SPIKE 0.
- **Deviations & decisions digest (D1–D18)** — MUST include every D17 item (guarded parse, userJoined exclusion, randomUUID, snapshot-includes-self, pure StateManager/no Redis/DB, serializable getFullState, wire WindowState differences, no apiRouter, 50 ms vs the vision's 16 ms, the probe gate as an M11 engineering decision, windowClose→snapshot D8, ownership D7, empty-hand suppression D6).
- **Evidence** — the eight m11-* files; verifier hash table (v1–v9 identical, v10 old→new, v11 new); the five expected-grep states of section 11.
- **Milestone 11 acceptance (mapped honestly)** — automated: protocol unit+integration proven (backend 20), SyncManager unit-proven (frontend 16), browser-proven by v11 (connected/users/handSync/windowSync/offline/reconnect, zero errors); explicitly NOT done: remote-hand/window rendering, conflict resolution, mid-session server-kill console cleanliness (documented, never verifier-created), real multi-browser gesture choreography.

## 13. Do-not-touch list

`apps/frontend/src/utils/` — gestures.ts, interactionEngine.ts, windowManager.ts, animation.ts, cameraRig.ts, logger.ts, gemini.ts + gemini.test.ts, chat.ts + chat.test.ts, search.ts + search.test.ts, storage.ts, appRegistry.ts, bootScene.ts (+ their tests); `components/FloatingWindow.tsx`, `Scene3D.tsx`, `GestureDebug.tsx`, `HandTracker.tsx`, `CameraCapture.tsx`, `ErrorBanner.tsx`, `components/apps/*` (Dashboard, Notes, Chat, Search, UnknownApp, index.ts); `src/main.tsx`, `src/index.css`, `src/types/*`, `index.html`, `vite.config.ts`, both frontend tsconfigs; `packages/shared/package.json` + `tsconfig.json` (source files only per work item A); `apps/backend/tsconfig.json`; `docs/scripts/verify_milestone1.py` … `verify_milestone9.py` (hash-identical), every v10 line NOT enumerated in section 11; all npm dependency versions except work item C3; both `.gitignore` files; `docs/briefs/**`; every README line outside the appended M11 section + line 5; App.tsx beyond sections F1–F10. Do NOT start M12/M13 scope (no remote rendering, no conflict resolution, no proxy, no persistence).

## 14. Implementation order (SPIKES FIRST; small batches, verify each)

1. **SPIKE 0 — interop (go/no-go feeds D2/D3):** apply ONLY the `index.ts` `.js`-specifier change (+ a temporary `sync.js`-less variant is fine: spike with the two existing specifiers), `npm run build --workspace @jarvis/shared`, then (a) `npm run test --workspace @jarvis/frontend` (247 green — the Vite leg), (b) `npm run build` (all three), (c) a TEMPORARY `apps/backend/src/spike-interop.ts` printing `WS_PORT` + a quantize call → `npx tsx src/spike-interop.ts` AND `node dist/spike-interop.js` (after build) → DELETE the spike file. Also spike `import '@jarvis/shared'` under vitest with a throwaway `spike.test.ts` → DELETE. Record: which legs passed, whether the D2 fallback was needed, the vitest-resolution decision (D13). Any leg failing = STOP and report before proceeding.
2. **SPIKE 1 — the WS-native-error re-confirmation (30 min):** with the backend DOWN and the frontend dev server up, a scratch Playwright run (about:blank or the app URL) asserting (a) `page.evaluate(() => new WebSocket('ws://localhost:4001'))` produces a console `[error]` line, (b) `page.evaluate(() => fetch('http://localhost:4000/api/health', {mode:'no-cors'}).catch(() => {}))` produces NONE. Scratch script deleted after; paste both observations (they justify D4 in the README).
3. Work item A (shared) → `npm run build --workspace @jarvis/shared` + frontend 247 green + full build (SPIKE 0 conclusions applied).
4. Work item B (StateManager) + `manager.test.ts` → `npm run test --workspace @jarvis/backend` green (12) — requires C3's package.json edits first or together with step 3's `npm install`.
5. Work item C (WS server + server.ts) + integration suite → backend green (20 total) + `npm run build` + `npm run typecheck --workspace @jarvis/backend` clean.
6. Work item E (`utils/sync.ts`) + `sync.test.ts` → frontend green (263) + build + `npm run lint --workspace @jarvis/frontend` clean.
7. Work item F (App.tsx wiring) → build + lint + dev-server eyeball BOTH ways: backend UP (HUD `Sync: connected`, `Users: 1`; open notes-2; reload), backend DOWN (HUD `Sync: offline`, `Users: 0`, exactly one `[Sync] offline` line, zero console errors, app fully usable).
8. **SPIKE 2 — kill-mid-session (feeds the README's honest note; v11's shape is already reload-based):** backend up, page connected, kill the backend process, capture the page console for 5 s — record EXACTLY what Chromium logs on the abnormal close (error or not), then reload with the backend still down (fresh boot must be zero-error). Document; delete scratch.
9. Work item D14 (root test script) → `npm run test` runs BOTH workspaces (263 + 20).
10. Work item I (v10 lockstep; hashes before/after) → v1–v10 verifiers `OVERALL: PASS` (frontend dev server only; backend DOWN for these — that is the point).
11. Work item H (`verify_milestone11.py`) → iterate to `OVERALL: PASS`.
12. ALL ELEVEN verifiers in order 1→11 (v1–v10 with the backend down as usual; v11 manages its own). Then README (work item J, docs-guard) + final evidence pass (section 15).

## 15. Evidence to paste in your report

1. SPIKE 0 results (each leg pass/fail + the fallback/vitest-resolution decision), SPIKE 1's two console observations, SPIKE 2's kill-mid-session capture.
2. `npm run test` — BOTH summary blocks (frontend 263 = 247 + 16; backend 20 = 12 + 8; per-file counts; the integration suite's clean exit).
3. `npm run build` (three workspaces) + `npm run typecheck --workspace @jarvis/backend` + `npm run lint --workspace @jarvis/frontend` — clean tails.
4. `sha256sum docs/scripts/verify_milestone*.py` — BEFORE and AFTER tables; v1–v9 identical (call it out), v10 old→new, v11 new.
5. All ELEVEN verifier runs — each `=== CHECKS ===` block + `OVERALL: PASS` (v1–v10 backend-down; v11 with its own backend orchestration).
6. The section-11 expected-grep-state block (all five greps).
7. `ls docs/screenshots | grep m11` — the eight m11-* evidence files (+ m11-backend.log tail showing the listening lines).
8. Skill evidence: test-guard / clean-code-guard / docs-guard check lines for the files they covered.
9. Any deviation from this brief, with the reason (deviations are acceptable if documented; silent scope drift is not).

---

# Overseer review checklist (1:1 with the M11 acceptance criteria)

For each item: verify with the cited evidence, not the Coder's summary. FAIL = send back to the Coder with the finding.

**Shared protocol + interop**
- [ ] `packages/shared` additions are ADDITIVE (diff shows appends only) + the `index.ts` `.js`-specifier fix; `types.ts`/`constants.ts`/`sync.ts` shapes match D1 exactly (tuple position, scalar scale, rotationY, zIndex, lastModified; UserInfo = {id, lastUpdate}); constants = 50/3/50.
- [ ] `npm run build --workspace @jarvis/shared` emits `dist/index.js` WITH `.js` specifiers (grep the dist); a `node -e "require('…/packages/shared/dist/index.js')"`-style spot check passes (re-run it yourself); SPIKE 0 evidence covers tsx + vitest + dist legs; frontend 247 stayed green across the change.
- [ ] `apps/backend/package.json`: ONLY the workspace link + vitest + test script (diff); lockfile shows no registry additions beyond vitest.

**Backend (unit + integration + structure)**
- [ ] `state/manager.ts`: quantize-on-store authority; create-stamps-owner / update-preserves-owner / re-create-restamps (tests 6/8/10); removeUser keeps windows (test 11); getFullState serializable, users carry no hands (tests 4/5); no Date.now hardwiring (injectable clock).
- [ ] `websocket/server.ts`: connection sends snapshot-INCLUDING-self then userJoined-EXCLUDING-sender (integration 1/2); handUpdate → others-only handSync, quantized (3); throttle coalesces + last-state-lands (4); windowUpsert → windowSync with stamped owner (5); windowClose → snapshot-to-others (6); malformed JSON → error-to-sender + survival (7); disconnect → userLeft + window persistence (8); factory takes `port: 0` + injectable interval; `close()` terminates sockets/timers (vitest exits cleanly).
- [ ] `server.ts`: health shape unchanged; WS binds before HTTP (code read); ports 4000/4001 unchanged; echo retired; graceful shutdown preserved; `npm run typecheck` + build clean; tests land in dist (accepted, documented).

**Frontend (unit + wiring + browser)**
- [ ] `utils/sync.ts` is node-pure (grep: no `import.meta`, no React); probe gate: `socketFactory` unreachable while probes fail (test 9), single factory call after success (test 10); backoff 500→cap 5000 (11); AbortController timeout (12); throttle/quantize/empty-suppression (13/14); subscribe/unsubscribe/malformed-silence (15); unexpected-close re-probe + terminal idempotent `close()` (16); `deriveHealthUrl` mapping (1/2).
- [ ] Bridge: quantize-gated diff, vanish→close, flushAll (6/7/8); `windowManager.ts` byte-identical (hash).
- [ ] App.tsx: ONLY F1–F10 (diff the file); per-scene close-old-then-new SyncManager; `wm.setOnChange` wrapper calls BOTH throttled sync AND bridge.sync; `sync.connect()` AFTER boot-window creation; `sendHands` first in `handleHandsDetected`; HUD rows additive with the offline/connecting/connected vocabulary; title `JARVIS · Milestone 11` + rewritten comment; `import.meta.env` greps to exactly three files.
- [ ] v11 browser evidence: Sync connected/Users 1 at boot; Users 2 + userJoined log on B; handSync log with B's userId; windowSync owner-stamping; snapshot-without-window on close; offline page zero-errors + zero `:4001` websockets + `[Sync] offline`; reconnect ≤ 12 s + Users 1 + C-join → 2.

**Verifier lockstep + tests + docs**
- [ ] v1–v9 sha256 IDENTICAL before/after; v10 changed ONLY in the three enumerated regions (re-read the diff; `Windows == 4` line untouched); expected grep state exact (five greps).
- [ ] Frontend 263 = 247 + 16 with only sync.test.ts added; backend 20 = 12 + 8; `npm run test` (root) runs both.
- [ ] All ELEVEN verifiers `OVERALL: PASS`; latency band 150–260 ms; FPS ≥ 30; cleanup 2–4 balanced; zero console/page errors everywhere; eight m11-* evidence files exist.
- [ ] README: M11 section complete (run guide, env vars, architecture-in-words, probe-gate rationale incl. spikes, interop note, D1–D18 digest incl. every D17 deviation, evidence, honest acceptance); line 5 updated; nothing else changed.
- [ ] Constraints: NO M12/M13 scope (no rendering, no conflict resolution, no proxy, no persistence, no Redis/PostgreSQL), no new boot window/app, no new npm deps beyond backend vitest (+ the internal workspace link), single cleanup pairs, backend-down app functionality with ONE `[Sync] offline` line and zero listener/timer drift (v4 re-pass is the evidence).
