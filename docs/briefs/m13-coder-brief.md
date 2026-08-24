# M13 Coder Brief — Workspace persistence + API proxy router (Phase 4 close-out)

Self-authored (team retired 2026-08-17): the main session self-instructs,
implements, and self-reviews. Scope: the M13 milestone prompt verbatim
(persistence D1 JSON store; proxy; frontend selection; Dashboard
save/load; tests; verifier v13; README; title M13). Standing constraints:
NOT a git repo; no frontend deps; backend may add `cors` (D10 declines);
no auth beyond per-IP rate limiting; no Redis/PostgreSQL; no Phase 5;
all 286+20 tests keep passing; everything works with the backend offline;
verifiers 1–12 keep passing (title lockstep excepted).

## Decisions

- **D1 store**: JSON file `apps/backend/data/workspace.json`, shape
  `{ version: 1, windows: WindowState[] }`. Missing/corrupt file → empty
  workspace + ONE console.warn, never crash. `WorkspaceStore`:
  `load()`, `scheduleSave(windows)` (debounced ~1 s, injectable),
  `flush()` (immediate write, cancels the timer), `read()` (flush-if-pending
  then return the in-memory snapshot — so save→GET round-trips).
  Atomic write: `writeFileSync(tmp)` + `renameSync(tmp → dest)` (Node's
  rename replaces on Windows); no `*.tmp` leftovers. Users are EPHEMERAL
  by design (presence, not workspace). The module abstracts a later DB
  swap (Redis/PostgreSQL are the scale-up path, documented only).
- **D2 StateManager (additive only)**: optional `onChange` callback fired
  after every window mutation (`upsertWindow`, `closeWindow`, NEW
  `replaceAllWindows(windows)` for PUT). The WS server is UNTOUCHED —
  server.ts subscribes: onChange → `store.scheduleSave(live windows)`.
- **D3 HTTP assembly**: new `apps/backend/src/api/http.ts`
  `createHttpApp(deps)` returns the Express app (health VERBATIM shape +
  workspace routes + proxy routes + CORS + rate limiting); `server.ts`
  composes (WS binds first — v11/v12 pin the two listening lines and
  their order) and wires shutdown: ws.close → http.close → **store.flush()**
  → exit. Tests drive `createHttpApp` on an ephemeral port with real
  fetch (no supertest dep).
- **D4 workspace REST**: `GET /api/workspace` → flush-if-pending + the
  store's snapshot `{ windows }`. `PUT /api/workspace` body
  `{ windows: WindowState[] }` validated field-by-field (same predicate
  shape as the WS layer) → invalid → 400 `{ error: 'invalid_workspace' }`;
  valid → `state.replaceAllWindows` + immediate persist → `200 { ok: true,
  count }`. REST workspace ops are NOT broadcast over WS (the acting
  client already has the state; live sync continues via normal upserts) —
  documented.
- **D5 persistence semantics (honest)**: the file converges to LIVE state
  via the WS auto-persist; boot PRELOADS the file into the StateManager,
  so late joiners (and fresh pages) receive the persisted workspace in
  their snapshot. The boot scene still recreates its four app windows
  locally every launch (M8 behavior stands — same-id collisions are
  skipped-local per M12 D4), so a reloaded page shows boot windows + any
  EXTRA persisted windows materialized. Save/Load govern the SERVER-side
  workspace; a "restore exact layout on boot" refinement is future polish.
- **D6 proxy = passthrough**: `POST /api/proxy/llm` builds the Gemini
  SSE request server-side (key from env, NEVER exposed) and pipes the
  upstream SSE bytes through unchanged (`text/event-stream`); upstream
  non-OK → typed JSON error (`502 { error: 'upstream_error', status }`);
  mid-stream failure → one final SSE `data:` error event then end.
  `GET /api/proxy/search?q=` passes through the upstream JSON body+status.
  The frontend reuses its EXISTING parsers (`extractSseData`,
  `extractTextDelta`, `mapSearchItems`) — one mapping code path.
- **D7 shared builders (no duplication)**: the pure request builders move
  to `packages/shared` (`geminiApi.ts`: `GEMINI_MODEL`,
  `buildGeminiUrl`, `buildGeminiBody`; `searchApi.ts`: `buildSearchUrl`);
  `gemini.ts`/`search.ts` RE-EXPORT them (all existing tests stay green);
  the backend imports them from `@jarvis/shared`.
- **D8 missing keys**: `503 { error: 'not_configured' }` — never crash,
  never hang. Env read at REQUEST time via injectable
  `deps.env` (tests inject; default `process.env`).
  Keys: `GEMINI_API_KEY`, `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX`
  (backend env / `.env` via `node --env-file=.env`).
- **D9 status endpoint**: `GET /api/proxy/status` → `{ llm: boolean,
  search: boolean }` — the frontend's "proxy reports keys configured"
  probe + the verifier's introspection hook.
- **D10 rate limiter**: `api/rate-limiter.ts` per-IP token bucket;
  exported `LLM_RATE_LIMIT_PER_MINUTE = 10`,
  `SEARCH_RATE_LIMIT_PER_MINUTE = 30`; capacity = N, refill N/60 per
  second; excess → `429` + `Retry-After` (seconds to next token);
  injectable clock. In-memory (Redis = documented scale-up path). IP =
  `req.socket.remoteAddress` (no proxy-header trust — no auth milestone).
  **CORS = MANUAL headers** (deviation from the prompt's cors allowance):
  allowlist constant `['http://localhost:5173', 'http://127.0.0.1:5173']`,
  three headers + OPTIONS 204; non-allowlisted origins get NO CORS
  headers. Zero new dependencies.
- **D11 frontend selection** `utils/apiProxy.ts` (node-pure, injectable
  fetch/clock): `resolveApiMode('llm' | 'search', { proxyUrl,
  directConfigured })` → `'proxy' | 'direct' | 'demo'`: probe
  `GET <proxy>/api/proxy/status` (AbortController 1200 ms, `.catch` →
  unreachable) → configured? proxy : (directConfigured ? direct : demo);
  unreachable → direct-or-demo. ONE shared module with the two thin
  clients (`streamChatViaProxy` reusing gemini's exported SSE parsers;
  `runSearchViaProxy` reusing `mapSearchItems`); mid-session 503 → typed
  error with a clear message (no silent fallback loops). Default base
  `http://localhost:4000`, override `VITE_API_PROXY_URL` (read at the
  React boundary only). The probe is SILENT (backend-down noise is the
  already-filtered ERR_CONNECTION_REFUSED line — the v2+ gates stand).
- **D12 Chat/Search switch**: on mount resolve the mode (async, silent);
  banner shows the resolved reason (proxy-not-configured / no key /
  key rejected); send path = proxy | direct | demo. Unresolved-first-send
  falls back to direct-if-key-else-demo, later sends use the resolution.
  M9/M10 direct paths byte-identical.
- **D13 Dashboard save/load**: `AppProps` gains OPTIONAL
  `saveWorkspace?` / `loadWorkspace?` (`Promise<WorkspaceResult>` —
  `{ ok: true; count } | { ok: false; error }`); Dashboard adds
  `workspace-save` / `workspace-load` buttons with inline status.
  `utils/workspace.ts` client (typed `WorkspaceError`, injectable fetch).
  App: save = wm windows → `toWindowState` (sync.ts, reused) → PUT.
  load = GET → close ALL local windows (full M12 hygiene: animations,
  smoothers, trackers, grabbed/hovered, remote registry) → recreate each
  saved window LOCALLY-OWNED (reuse remoteApply's field-apply, exported
  as `applyWindowStateFields`) → bridge flush + React sync.
  **Ownership-on-load: saved windows become the CURRENT user's** (prompt
  decision). Ids colliding with live remote windows behave like boot-id
  collisions (local view wins; documented limitation).
- **D14 mid-grab safety**: a window removed by load clears its grab via
  the engine's EXISTING closed-window hygiene; pinned by a new engine
  test (grab → wm.closeWindow → continuation emits nothing, release
  emits nothing).
- **D15 data dir**: `apps/backend/data/` + `.gitkeep`;
  `apps/backend/.gitignore` (`data/*`, `!data/.gitkeep`) + README note
  (repo-ready despite being git-less today).
- **D16 title lockstep**: HUD → `JARVIS · Milestone 13`; v12's exact pin
  downgraded to tolerant (finder + assertion + check name); v1–v11
  already tolerant (untouched); v13 pins exact.
- **D17 verifier v13** (backend lifecycle + one page + python ws client
  + urllib): boot (exact M13 title, 4 windows, Sync connected, Users 1)
  → modify workspace (close chat-1, open notes-2) → Save click →
  python GET /api/workspace == exactly the 4 saved ids → BACKEND RESTART
  (file → boot preload) → python ws client snapshot == the same 4 ids
  (the cross-restart file round-trip) → reload page → notes-2
  materializes from the persisted state → Load click → DOM ids == fresh
  python GET ids → proxy checks via urllib (status JSON both false
  without keys; llm + search → 503 not_configured; CORS preflight
  ACAO header for localhost:5173) → chat demo banner present → zero
  console/page errors + PERF + latency band → `m13-*` evidence.
- **D18 README M13**: Phase 4 COMPLETE; the API-key matrix (VITE_ direct
  vs backend env); the multi-user demo guide (two browsers + backend);
  honest acceptance mapping + the user's live spot-checks.

## Tests (enumerated)

Backend (20 → ~41):
- `state/store.test.ts` (5): round-trip write→load; corrupt file → [] +
  one warn; missing file → [] + one warn; debounce coalescing (fake
  timers, one write for N schedules); atomic rename (spy on
  `fs.renameSync`, tmp path arg, no leftovers).
- `api/http.test.ts` (6): health shape; GET workspace (flush-if-pending);
  PUT valid (replaceAll + count) ; PUT invalid → 400 shape; unknown
  route → 404; CORS (preflight + allowlist header present, foreign
  origin gets none).
- `api/proxy.test.ts` (7): status no-keys shape; llm 503; search 503;
  llm SSE passthrough (mock upstream SSE body → client receives the same
  event bytes); llm upstream non-OK → 502 typed; search passthrough
  (body + status); rate limiting (burst passes to cap, excess 429 +
  Retry-After, refill after the window with injected clock).
- `api/rate-limiter.test.ts` (3): capacity/refill math, reset after
  window, per-IP isolation.

Frontend (286 → ~298):
- `utils/apiProxy.test.ts` (6): proxy configured → 'proxy'; proxy
  reachable + not configured + direct key → 'direct'; not configured +
  no key → 'demo'; unreachable → direct/demo split;
  `streamChatViaProxy` parses passthrough SSE (reuse fixtures);
  `runSearchViaProxy` maps passthrough JSON + 503 typed error.
- `utils/workspace.test.ts` (5): PUT URL/body; GET parse; network error
  shape; 400 shape; abort resolves cleanly.
- `utils/interactionEngine.test.ts` +1: mid-grab close (load) drops the
  grab silently.

## Out of scope (hard)

Auth/sessions beyond per-IP limits; Redis/PostgreSQL; deployment
(Phase 5); conflict-resolution changes (M12 stands); ownership transfer;
frontend npm deps.
