# JARVIS Milestone 9 — Coder Brief (Phase 3 part 2: LLM Chat app — Gemini SSE streaming client, demo mode, chat persistence)

You are the Coder for JARVIS Milestone 9 in `C:\Users\oliad\Desktop\visionpro` (Windows / Git Bash; npm workspaces root; NOT a git repo — never `git init`/commit). This brief is complete and self-contained. Implement EXACTLY this scope: a node-pure Gemini REST streaming client (`utils/gemini.ts`), a node-pure chat state module (`utils/chat.ts`), the Chat app (`components/apps/Chat.tsx` — message bubbles, input row, demo mode, inline error + retry, persistence), chat registration + launcher enablement, the chat boot window (spawn table + tests), `verify_milestone9.py`, the verifier lockstep (v8 downgrade ONLY; v1–v7 ZERO edits), the README M9 section, and the `.env.local` documentation. NO backend proxy (Phase 4), NO Web Search (M10 — the disabled `launcher-entry-search` button stays), NO tool/function calling, NO voice/speech input (PROJECT_VISION §3.4 "text input via keyboard or speech" — M9 ships keyboard only, documented), NO image input, NO new npm dependencies, NO changes to gestures/engine/windowManager/storage/appRegistry. When something is unspecified, follow the existing M1–M8 code conventions (they are deliberate) and document deviations the way M2–M8 did (docblock "DEVIATION"/decision notes).

## 0. Guardrails (read first)

- Run everything from the repo ROOT: `npm run test`, `npm run build`, `npm run dev:frontend`, `npm run lint --workspace @jarvis/frontend`. Python verifiers run as `python docs/scripts/verify_milestoneN.py [base_url]` against the dev server on http://localhost:5173 (start it in the background).
- TS constraints (tsconfig.app.json, verified): `erasableSyntaxOnly` (NO `enum` — const-object pattern), `verbatimModuleSyntax` (type-only imports MUST use `import type`), `noUnusedLocals` + `noUnusedParameters` (they compile tests too — `include: ["src"]`), `noFallthroughCasesInSwitch`, `jsx: react-jsx`. `types: ["vite/client"]` is already set — `import.meta.env` is typed; NO d.ts needed, NO new tsconfig edits.
- Quality skills are mandatory: `test-guard` on all test changes, `clean-code-guard` on all new/changed production code, `docs-guard` on the README changes, and follow the `frontend-design` intent by matching the existing HUD/window-chrome design language (dark glass `rgba(10, 14, 39, 0.85+)`, `#0084ff` accent, `#8f9bb3` labels, `#00ff88` values, `#ff5a5a`/`#ffd7d7` error colors per ErrorBanner, Consolas monospace, 9–11 px app fonts). Do NOT invent a second visual language. Your report must include the evidence lines those checks produced.
- Console discipline: ZERO new console output in normal operation (including demo replies, streaming, errors — errors render INLINE in the chat UI, never to the console). The boot console line `[App] app scene ready: ${BOOT_WINDOW_COUNT} app windows created` (App.tsx line ~362) is DERIVED — it prints "3 app windows created" automatically when chat joins `BOOT_APP_IDS`; do NOT edit it. Re-verify with `grep -rn "app windows created" docs/scripts/` → zero hits.
- Environment keys: the ONLY sanctioned env var is `VITE_GEMINI_API_KEY` read via `import.meta.env.VITE_GEMINI_API_KEY` in Chat.tsx (D2/D16). The root `.gitignore` already covers `.env`, `.env.*`, `!.env.example` (lines 26–28); `apps/frontend/.gitignore` ALSO exists (Vite template — its `*.local` line additionally matches `.env.local`). Create NO gitignore files. If you create `apps/frontend/.env.local` for the optional live call, NEVER commit facts about its value into docs beyond "it holds the key" (and this is not a git repo anyway — still treat the value as secret in your report).
- v9's default pass MUST succeed WITHOUT a key (demo mode). If a `.env.local` with a real key exists on this machine, REMOVE/rename it for the v9 run (the banner check requires key-absent demo mode). The optional ONE live call (if a key is available) is a separate manual step, evidence by screenshot — NOT part of v9.
- Baseline (do NOT regress, verified 2026-08-16 by running the suite): **192 vitest tests green**, per file: logger 13, windowManager 26, gestures 39, interactionEngine 49, animation 31, cameraRig 14, bootScene 3, appRegistry 10, storage 7. Build passes all three workspaces; fake-webcam latency min-avg ~200–216 ms (verifier band 150–260); single cleanup pairs; zero console/page errors; grab/drag/resize/rotate/release/hover/pan/zoom suites all green; all eight verifiers `OVERALL: PASS`.
- The ONLY existing files you may touch: `bootScene.ts` + `bootScene.test.ts` (sanctioned amendments, section 7), `components/apps/index.ts` (one registration), `components/apps/Dashboard.tsx` (remove the disabled chat button), `App.tsx` (HUD title + comment + docblock paragraph ONLY — sections 8), `verify_milestone8.py` (the enumerated downgrades in section 11 — NOTHING else), `README.md` (append the M9 section). Every other existing file stays byte-identical. If you find any other failing test, STOP and report it — do not amend unilaterally.

## 1. Codebase facts you will rely on (verified by reading, 2026-08-16)

- `apps/frontend/src/utils/appRegistry.ts` — the M8 React-FC registry. `AppProps = AppContext & { openApp }` where `AppContext = { windowId, sendMessage, maximize, minimize, close }`. `register(app: AppDefinition)` throws on duplicate ids; `getApp` NEVER returns undefined (fallback); `listApps()` is registration order (the launcher source); `appIdFromWindowId` splits at the LAST `-`. Node-pure (`import type { FC }` only). M9 needs ZERO changes to it.
- `apps/frontend/src/components/apps/index.ts` — registers `dashboard` + `notes`, injects the UnknownApp fallback. M9 adds the chat registration here (section 6).
- `apps/frontend/src/components/apps/Notes.tsx` — THE persistence pattern Chat.tsx copies (D10): `storageKey = \`note:${windowId}\``, restore-on-mount NEVER sets `dirtyRef` (StrictMode-safe), 500 ms debounced save, dirty-gated unmount flush, `textRef` mirrors state for async save paths.
- `apps/frontend/src/components/apps/Dashboard.tsx` — launcher renders `launcher-open-${app.id}` buttons from `listApps()` (lines 94–105) PLUS a hardcoded DISABLED `launcher-entry-chat` button (lines 106–108, "Chat — M9") and a disabled `launcher-entry-search` (lines 109–111). The chat button is REMOVED in M9; the search button STAYS. The `appctl-*` strip and the compact 9–11 px styling idiom (buttonStyle/disabledButtonStyle constants) are the design language to reuse.
- `apps/frontend/src/utils/storage.ts` — `get<T>/set/remove` with the `'jarvis:'` prefix OWNED by the module (callers pass logical keys like `chat:chat-1` → physical `jarvis:chat:chat-1`); injectable backend; edge-only `console.warn`. M9 needs ZERO changes to it.
- `apps/frontend/src/utils/bootScene.ts` — `BOOT_APP_IDS = ['dashboard', 'notes']`, `SPAWN_POSITIONS` (dashboard `(-1.6, 0.75, 0.4)`, notes `(1.6, -0.65, 0.2)`), `BOOT_WINDOW_COUNT = BOOT_APP_IDS.length` (DERIVED), `DEFAULT_SPAWN_POSITION (0, 0, 0.3)`, `SPAWN_CASCADE_STEP (0.25, -0.2, 0)`, `getSpawnPosition(appId, instance)` (fresh clone per call). The docblock carries the D2 NDC-margin table.
- `apps/frontend/src/utils/windowManager.ts` — windows are `WINDOW_BASE_WIDTH = 1.5` world units wide with `WINDOW_ASPECT = 16/9` → world height `1.5 / (16/9) = 0.84375`. `createWindow(id, title, position)` exists; frozen for M9.
- `apps/frontend/src/utils/bootScene.test.ts` — 3 tests (margin projections at BOTH aspects; exact boot composition + pairwise-distinct projections + distinct depths; clone/cascade/clamp/default semantics). Sanctioned amendments in section 7.
- `apps/frontend/src/App.tsx` — HUD title `JARVIS · Milestone 8` at line 90 with the lockstep comment at lines 85–89; boot console line at 362 (derived, see guardrails); `renderAppContent` + `openApp` + per-scene instance counters are generic (chat needs NO wiring — registering it is enough); the reset button is `data-testid="reset-view"` top-center; HUD top-left; GestureDebug top-right.
- `docs/briefs/m8-coder-brief.md` — the format/wording precedent; its D14 is the two-tier verifier policy this brief's lockstep continues.
- `TECHNICAL_SPEC.md` §2.3 (lines 640–700) — the sketch `LLMChatApp extends App` (class-based, `x-goog-api-key` header, NON-streaming `response.json()`, single-turn `contents`, `sendMessage({type:'update'})`). M8 already deviated to React-FC; M9 continues that deviation plus four new ones (section 2, D17).
- `PROJECT_VISION.md` §3.4 (lines 78–84) — LLM Chat: text input via keyboard or speech, responses rendered in window, Google API via key, streaming responses.
- `docs/scripts/verify_milestone8.py` — the interactive-verifier pattern v9 follows (fake-webcam Chromium flags, 1280×800 viewport, console/pageerror listeners, `PERF_LINE_PATTERN` four-key regex, `runtime_introspection`, `fully_on_screen`, checks a–s, `OVERALL: PASS/FAIL`, mid-flight console persistence). Its chat-related pins are downgraded in section 11.
- Node is v24.14.1 — vitest node-env tests have globals `fetch`, `Response` types via lib.dom (tsc) and `ReadableStream`, `TextEncoder`, `TextDecoder`, `AbortController`, `DOMException` at runtime. NO jsdom, NO new deps needed for the SSE tests.
- Verifier hash baselines (pre-M9, sha256, recorded 2026-08-16 — see section 11): v1 `450c8386…`, v2 `2f9bc072…`, v3 `86172728…`, v4 `388a355b…`, v5 `27b6ddc5…`, v6 `37030753…`, v7 `2fe3d2b8…`, v8 `a9e76742…`. v1–v7 title lookups are ALL the version-tolerant `includes('JARVIS · Milestone')` (v1 has no title lookup at all) — verified by grep; ZERO edits expected there (re-grep and paste as evidence).
- README is 1147 lines; the M8 section (`## Milestone 8 — …`, line 930) runs to end-of-file — the M9 section APPENDS after it. (Known stale line: the line-5 status blurb still says "Milestone 7" — M8 chose not to touch it; M9 does not either. Leave it.)

## 2. Design decisions (decided by the Orchestrator — implement as specified, document in code)

**D1 — Model constant: `gemini-2.5-flash`.** Exported as `export const GEMINI_MODEL = 'gemini-2.5-flash';` — a single constant, trivially swappable. Rationale: `gemini-2.5-flash` is the stable/GA Flash model on Google AI Studio (2.0-flash is the older generation and its family has been on deprecation timelines); the milestone prompt explicitly allows "the current stable flash model". The constant is exercised ONLY by the optional live call (all tests inject fetch; the default verifier path is demo mode), so a future model bump is a one-line change documented in the README. Document the choice in the gemini.ts docblock + README.

**D2 — Node-purity boundary: `import.meta.env` is read ONLY in Chat.tsx.** `utils/gemini.ts` and `utils/chat.ts` must stay node-testable like `appRegistry.ts` (purity contract): NO `import.meta`, NO React, NO window/DOM-only APIs. `streamChat` takes `apiKey` as a parameter; `isDemoMode(apiKey)` takes the key as a parameter. Chat.tsx reads `import.meta.env.VITE_GEMINI_API_KEY ?? ''` ONCE at module scope and passes it down. This mirrors the M8 registry purity contract exactly.

**D3 — SSE parsing: one PURE exported step function, malformed lines SKIPPED (never kill the stream).** `extractSseData(buffer: string): { data: string[]; rest: string }` — split the accumulated buffer on `'\n'`, pop the LAST element into `rest` (a trailing partial line stays buffered until its newline arrives), strip one trailing `'\r'` per line (CRLF tolerance), keep only lines starting with `data:` (empty lines, `event:` lines, comments are skipped), strip the `data:` prefix and ONE optional following space (SSE spec). Malformed `data:` payloads (failed `JSON.parse`) are skipped in `streamChat`'s loop with `continue` — a garbage line must never abort an otherwise healthy stream. Pinned by tests (split-across-reads JSON, multi-event chunks, malformed-line skip, trailing-partial retention).

**D4 — Delta extraction: join ALL parts, never throw.** Gemini chunks carry `candidates[0].content.parts` as an ARRAY; `extractTextDelta(payload)` joins the `.text` of EVERY part that has a string `text` (multi-part deltas concatenate), and returns `''` for absent `candidates`/`content`/`parts` (finish frames), absent `text`, or any missing field — defensive optional chaining end-to-end, no throwing.

**D5 — Abort is a CLEAN stop, not an error.** `streamChat` NEVER rejects due to abort: abort before response headers → resolves `''`; abort mid-stream (the pending `read()` rejects) → resolves the partial text accumulated so far (the UI keeps the partial bubble). `ChatError` is reserved for genuine failures (no key, 401/403, 429, other non-OK, network). The unmount cleanup and any future cancel button call `AbortController.abort()` and simply let the promise resolve. Pinned by tests 21–22.

**D6 — `ChatError`: class with a const-object `kind` (no enum).** `CHAT_ERROR_KINDS = { noKey: 'no_key', invalidKey: 'invalid_key', rateLimit: 'rate_limit', network: 'network', other: 'other' } as const`; `class ChatError extends Error { readonly kind: ChatErrorKind }` with `name = 'ChatError'` and a USER-READABLE message per kind. Mapping (pinned by tests): empty/whitespace key → `no_key`; HTTP 401/403 → `invalid_key`; HTTP 429 → `rate_limit`; any other non-OK → `other`; fetch/`TypeError` rejection → `network`; missing body on OK → `other`.

**D7 — Demo-mode state machine (the exact matrix).** `isDemoMode(apiKey)` = key undefined/null/empty/whitespace-only. The banner (`chat-demo-banner`, text contains `DEMO MODE`) and the reply engine follow this matrix — every cell is pinned by unit tests (flag/deltas) or v9 (browser):

| key state | event | behavior |
| --- | --- | --- |
| no key | mount | banner `DEMO MODE — no API key` visible from the start; NEVER an error |
| no key | send | canned demo reply via timed deltas (D8); no fetch attempt, no error UI |
| key present | mount | NO banner |
| key present | send | live `streamChat`; assistant bubble grows with each delta |
| key present | live returns 401/403 (`invalid_key`) | STICKY degrade (ref flag for this window's lifetime): banner switches to `DEMO MODE — API key rejected`, THIS message is answered with the canned demo reply, no error UI, no repeated 401 round-trips on later sends |
| key present | live returns 429 / network / other | inline error row (`chat-error` + `chat-retry`); the empty assistant bubble is REMOVED if nothing streamed (partial text stays if some did); Retry re-runs LIVE with the same history |
| any | streaming | Send disabled (busy); input stays editable |
| any | unmount mid-anything | timers cleared, live stream aborted cleanly (D5), dirty-gated flush (D10) |

**D8 — Demo reply engine: canned text, 3 timed deltas over ~0.9 s, StrictMode-safe.** `DEMO_REPLY_TEXT` + `buildDemoDeltas()` (3 non-empty chunks whose concatenation is the full text) live in `utils/chat.ts` (pure, unit-tested). The timer orchestration lives in Chat.tsx: cumulative delays 250/550/900 ms (`DEMO_DELTA_DELAYS_MS = [250, 300, 350]` — deltas at 250/550/900, done at ~950 ms) so the live-append animation is VISIBLE and the verifier stays fast. All timer ids go into a ref array; unmount clears every one. The engine is triggered ONLY by a user send (never by mount/effects) — StrictMode's double effect run cannot double-fire it; the first mount's cleanup clears nothing that was never scheduled.

**D9 — Chat UI pins (exact testids) + M8 styling.** `chat-input` (single-line `<input>`), `chat-send` (submit button, disabled while busy or input empty), per-message rows `chat-msg-user` / `chat-msg-assistant` (role-prefixed `YOU: ` / `JARVIS: `), `chat-demo-banner`, `chat-error`, `chat-retry`. Enter submits (native form submit — the spec's deprecated `onKeyPress` is a documented deviation). Auto scroll-to-bottom on message growth. Monospace, 9–11 px, dark-glass inputs per the M8 idiom; error row reuses ErrorBanner's `#ff5a5a`/`#ffd7d7` colors; banner uses the muted `#8f9bb3` label language with a dashed border. The window content area is only ~144×70 px at the 1280×800 verifier viewport — keep the list ~34 px tall with `overflowY: 'auto'`.

**D10 — Persistence: the Notes pattern verbatim, keyed `chat:<windowId>`.** Physical key `jarvis:chat:<windowId>` (the storage module owns the prefix). The persisted value is the `ChatMessage[]` JSON. Restore-on-mount does NOT set `dirtyRef` (StrictMode-safe); every message-list change (send, delta growth, revert) sets dirty and (re)starts the 500 ms debounce; unmount flush is dirty-gated. Two chat windows (`chat-1`, `chat-2`) can never clobber each other. `ChatMessage` restores are shape-guarded with a light `Array.isArray` check (mirrors the Notes trust level; deeper schema validation is YAGNI — documented).

**D11 — Boot scene: `chat-1` at `(0, 0, 0.25)`, margin-verified (the D2 discipline).** `BOOT_APP_IDS = ['dashboard', 'notes', 'chat']` (chat LAST → highest z-index, the milestone focus lands frontmost); `SPAWN_POSITIONS.chat = new THREE.Vector3(0, 0, 0.25)`; `BOOT_WINDOW_COUNT` stays DERIVED (now 3 — v9 pins it). Camera (0,0,5) fov 75; all windows are 1.5 × 0.84375 world units (M3-frozen scale):

| app | position | depth | ndc @16:9 (x, y) | ndc @16:10 (x, y) | max abs ndc |
| --- | --- | --- | --- | --- | --- |
| dashboard | `(-1.6, 0.75, 0.4)` | 4.6 | (-0.2550, 0.2125) | (-0.2833, 0.2125) | 0.2833 |
| notes | `(1.6, -0.65, 0.2)` | 4.8 | (0.2444, -0.1765) | (0.2715, -0.1765) | 0.2715 |
| chat | `(0, 0, 0.25)` | 4.75 | (0.0000, 0.0000) | (0.0000, 0.0000) | 0.0000 |

Projected rects at the 1280×800 verifier viewport: Dashboard (373.7, 267.2)–(543.7, 362.8), Notes (732.3, 424.8)–(895.2, 516.4), **Chat (557.7, 353.7)–(722.3, 446.3)** (164.6 × 92.6 px). Chat is dead-center: 14.0 px clear of Dashboard's right edge, 10.0 px clear of Notes' left edge, far below the HUD (top-left, ends ~x292/y230), far left of GestureDebug (top-right, starts ~x1004), and 300+ px below the reset button (top-center ~x580–700, ~y16–50). Distinct lefts (373.7 / 732.3 / 557.7), distinct tops (267.2 / 424.8 / 353.7), distinct depths (4.6 / 4.8 / 4.75). Worst |ndc| across ALL cascade instances 1–4 of ALL apps including chat stays **0.3988** (notes-4 @16:10; chat's worst cascade is 0.1646) — the docblock number survives unchanged. Accepted note: the launcher-cascade `chat-2` `(0.25, -0.2, 0.25)` → rect (585.1, 375.7)–(749.7, 468.2) slightly overlaps `notes-1` — pre-accepted M8 behavior (`notes-2` overlaps `notes-1` the same way; cascades are draggable and v9 only requires fully-on-screen).

**D12 — HUD + boot console line.** App.tsx line 90: `JARVIS · Milestone 8` → `JARVIS · Milestone 9`; the lines 85–89 comment is rewritten (section 8). The boot console line at 362 is DERIVED — zero edits; it prints `3 app windows created` automatically and v9 asserts that exact rendered text.

**D13 — Registration + launcher enablement.** `components/apps/index.ts` registers `{ id: 'chat', title: 'LLM Chat', Component: Chat }` AFTER notes (launcher order: Dashboard, Notes, LLM Chat). Dashboard.tsx DELETES the hardcoded disabled chat button (lines 106–108) — `launcher-open-chat` then appears automatically via `listApps()` (enabled, opens `chat-2` via the existing cascade). `launcher-entry-search` stays disabled (M10).

**D14 — Verifier lockstep: tier-1 duty moves v8 → v9.** v1–v7: ZERO edits (their title lookups are already tolerant and their count checks are already `>= 2` — re-grep, paste zero-hit evidence, touch nothing). v8 is downgraded in EXACTLY the enumerated spots (section 11) to the M8-D14 tier-2 invariants. v9 (new) owns the exact pins: HUD `JARVIS · Milestone 9`, boot set exactly `{dashboard-1, notes-1, chat-1}`, Windows = 3, boot console line, chat interactivity. This is the operational meaning of "update title pins in every verify_milestoneN.py in lockstep": grep all nine, edit where pins exist (v8 only), re-run all nine.

**D15 — Tests: 2 new files, 34 new tests → 226 total.** `chat.test.ts` (12) + `gemini.test.ts` (22); `bootScene.test.ts` amended in place (still 3). All gemini tests use an injected `fetchImpl` returning `{ ok, status, body }` Response-likes and synthetic `ReadableStream`s built from `TextEncoder` (node 24 globals — no new deps). Arithmetic: 192 + 12 + 22 = **226 expected**; reconcile any mismatch BEFORE proceeding.

**D16 — Env + security documentation (README only; create no ignore files).** README documents: create `apps/frontend/.env.local` containing `VITE_GEMINI_API_KEY=<key from https://aistudio.google.com/apikey>`, restart `npm run dev:frontend` (Vite reads env at startup). Root `.gitignore` lines 26–28 (`.env`, `.env.*`, `!.env.example`) plus `apps/frontend/.gitignore`'s `*.local` already cover `.env.local` — documented, NOT duplicated. SECURITY NOTE (README M9 section AND the Chat.tsx/gemini.ts docblocks): a frontend key is visible in devtools; acceptable for local Phase 3; Phase 4 brings the backend APIRouter proxy with rate limiting.

**D17 — Spec deviations, all documented (docblock + README digest).** (1) React-FC registry continues (M8 D1) — the spec §2.3 `LLMChatApp extends App` class sketch is not used. (2) API key via `?key=` query parameter per the M9 milestone prompt (the spec sketch used an `x-goog-api-key` header — both are valid Gemini REST auth; the prompt's form is pinned). (3) Typed `ChatMessage` `{id, role, content, timestamp}` (spec sent raw `{role, parts}`). (4) SSE streaming via `:streamGenerateContent?alt=sse` replaces the spec's non-streaming `generateContent` + `response.json()` (PROJECT_VISION §3.4 asks for streaming). (5) Full conversation history is sent each turn (the spec sketch was single-turn). (6) No system instruction (per the milestone prompt). (7) `DEMO_REPLY_TEXT`/model constant choices (D1/D8). (8) Speech input deferred (vision says "keyboard or speech"; M9 ships keyboard — Enter-to-send form, not the deprecated `onKeyPress`).

## 3. Work item A — CREATE `apps/frontend/src/utils/gemini.ts` (near-final; node-pure)

```ts
/**
 * M9 Gemini REST client (SSE streaming) for the LLM Chat app.
 *
 * DEVIATIONS from TECHNICAL_SPEC §2.3 (documented, D17): the spec sketch
 * was a class-based app calling non-streaming generateContent with an
 * x-goog-api-key header and response.json(); M9 ships a node-pure
 * streaming client — POST <model>:streamGenerateContent?alt=sse&key=<KEY>
 * (query-param auth per the M9 milestone prompt), SSE text deltas, typed
 * messages, full conversation history per turn, no system instruction.
 *
 * Purity contract (D2, mirrors appRegistry.ts): NO import.meta, NO React,
 * NO DOM-only APIs — the apiKey is a PARAMETER (Chat.tsx reads
 * import.meta.env at the React boundary), and fetch is injectable so node
 * vitest exercises everything with synthetic ReadableStreams (node 24
 * provides the needed globals at runtime; lib.dom provides their types).
 *
 * Abort semantics (D5): aborting is a CLEAN stop — streamChat resolves
 * with the text accumulated so far ('' before headers); ChatError is
 * reserved for genuine failures (D6). Malformed SSE data lines are
 * skipped, never fatal (D3).
 */

/** Single swappable model constant (D1). Current stable Flash model. */
export const GEMINI_MODEL = 'gemini-2.5-flash';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Error kinds as a const object (NO enum — erasableSyntaxOnly). */
export const CHAT_ERROR_KINDS = {
  noKey: 'no_key',
  invalidKey: 'invalid_key',
  rateLimit: 'rate_limit',
  network: 'network',
  other: 'other',
} as const;

export type ChatErrorKind = (typeof CHAT_ERROR_KINDS)[keyof typeof CHAT_ERROR_KINDS];

/** Typed failure with a distinguishable kind + user-readable message (D6). */
export class ChatError extends Error {
  readonly kind: ChatErrorKind;

  constructor(kind: ChatErrorKind, message: string) {
    super(message);
    this.name = 'ChatError';
    this.kind = kind;
  }
}

/** Wire messages for one request (internal roles; 'assistant' maps to
 *  Gemini's 'model' role in buildGeminiBody). */
export interface GeminiMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** URL builder (exported for tests): model + alt=sse + query-param key. */
export function buildGeminiUrl(model: string, apiKey: string): string {
  return `${GEMINI_API_BASE}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
}

/** Body builder (exported for tests): full history, 'assistant' -> 'model'. */
export function buildGeminiBody(
  messages: readonly GeminiMessage[],
): { contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> } {
  return {
    contents: messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
  };
}

/**
 * ONE pure SSE parsing step (D3): consumes the accumulated buffer, returns
 * every COMPLETE `data:` payload plus the unconsumed remainder (a trailing
 * partial line stays buffered until its newline arrives — JSON may split
 * across reads). Non-data lines (empty, `event:`, comments) are skipped;
 * CRLF is tolerated (one trailing \r stripped); one optional space after
 * `data:` is stripped per the SSE spec. Malformed payloads are skipped by
 * the CALLER (JSON.parse failure never kills the stream).
 */
export function extractSseData(buffer: string): { data: string[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? ''; // last element: partial line or '' after \n
  const data: string[] = [];
  for (const line of lines) {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!clean.startsWith('data:')) continue;
    data.push(clean.slice('data:'.length).replace(/^ /, ''));
  }
  return { data, rest };
}

/**
 * Text-delta extraction (D4): joins the `.text` of EVERY part (parts is an
 * ARRAY; multi-part deltas concatenate). Absent candidates/content/parts
 * (finish frames), missing `text`, any missing field -> '' — never throws.
 */
export function extractTextDelta(payload: unknown): string {
  const chunk = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = chunk?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

export interface StreamChatOptions {
  apiKey: string;
  messages: readonly GeminiMessage[];
  /** Called once per non-empty text delta (live append). */
  onDelta: (delta: string) => void;
  /** Abort = clean stop (D5): resolves with the partial text. */
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Streams one Gemini chat completion over SSE. Resolves with the FULL
 * accumulated text. Throws ChatError ONLY for genuine failures (D5/D6):
 * no key, 401/403 -> invalid_key, 429 -> rate_limit, other non-OK ->
 * other, network rejection -> network, OK-without-body -> other.
 */
export async function streamChat({
  apiKey,
  messages,
  onDelta,
  signal,
  fetchImpl = fetch,
}: StreamChatOptions): Promise<string> {
  const key = apiKey.trim();
  if (!key) {
    throw new ChatError(
      CHAT_ERROR_KINDS.noKey,
      'No Gemini API key configured — set VITE_GEMINI_API_KEY in apps/frontend/.env.local (README, Milestone 9).',
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(buildGeminiUrl(GEMINI_MODEL, key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGeminiBody(messages)),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return ''; // clean cancel before headers (D5)
    throw new ChatError(
      CHAT_ERROR_KINDS.network,
      `Network error reaching Gemini: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const kind =
      response.status === 401 || response.status === 403
        ? CHAT_ERROR_KINDS.invalidKey
        : response.status === 429
          ? CHAT_ERROR_KINDS.rateLimit
          : CHAT_ERROR_KINDS.other;
    throw new ChatError(kind, `Gemini request failed (HTTP ${response.status}).`);
  }

  const body = response.body;
  if (!body) {
    throw new ChatError(CHAT_ERROR_KINDS.other, 'Gemini response had no body.');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const consume = (chunkText: string): void => {
    buffer += chunkText;
    const { data, rest } = extractSseData(buffer);
    buffer = rest;
    for (const line of data) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // malformed line: skipped, never fatal (D3)
      }
      const delta = extractTextDelta(parsed);
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
    }
    // Flush the TextDecoder AND the last unterminated line (a final event
    // without a trailing \n is still a complete event once the stream ends).
    consume(decoder.decode() + '\n');
  } catch (error) {
    if (signal?.aborted) return full; // clean cancel mid-stream (D5)
    throw new ChatError(
      CHAT_ERROR_KINDS.network,
      `Gemini stream failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return full;
}
```

## 4. Work item B — CREATE `apps/frontend/src/utils/chat.ts` (near-final; node-pure)

```ts
/**
 * M9 chat state (pure data module — NO React, NO import.meta, NO DOM; the
 * purity contract of appRegistry/storage). Chat.tsx owns all effects and
 * timers; this module owns the message shape, the immutable list ops, the
 * demo-mode flag, and the canned demo reply text + its delta split (D8) so
 * all of it is node-unit-testable.
 */

/** One chat message. Roles use the INTERNAL names ('assistant' maps to
 *  Gemini's 'model' only inside gemini.ts buildGeminiBody). */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** Appends a message; returns a NEW array (input never mutated). Ids are
 *  per-conversation sequential ('user-3', 'assistant-4', …) — unique by
 *  construction because nothing ever removes from the middle. */
export function appendMessage(
  messages: readonly ChatMessage[],
  role: ChatMessage['role'],
  content: string,
  timestamp: number = Date.now(),
): ChatMessage[] {
  const message: ChatMessage = {
    id: `${role}-${messages.length + 1}`,
    role,
    content,
    timestamp,
  };
  return [...messages, message];
}

/** Replaces the LAST message's content (streaming growth: the caller
 *  passes the full accumulated text, not a delta). Preserves the last
 *  message's id/role/timestamp; empty input -> empty output (no-throw). */
export function updateLastMessage(
  messages: readonly ChatMessage[],
  content: string,
): ChatMessage[] {
  if (messages.length === 0) return [];
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, content }];
}

/** Empty history. API-completeness counterpart of the M8 app-bus plumbing
 *  (D5 there): shipped + unit-pinned now, UI surface later. */
export function clearChat(): ChatMessage[] {
  return [];
}

/** Demo mode = no usable key (undefined/null/empty/whitespace-only). */
export function isDemoMode(apiKey: string | undefined | null): boolean {
  return !apiKey || apiKey.trim() === '';
}

/** The canned demo reply (D7/D8). Contains the stable marker 'demo reply'
 *  that v9 asserts in the assistant bubble. */
export const DEMO_REPLY_TEXT =
  'JARVIS demo reply: no Gemini API key is configured, so this is a canned answer. ' +
  'Create apps/frontend/.env.local with VITE_GEMINI_API_KEY (README, Milestone 9) ' +
  'to chat with the real model.';

/** Splits the canned reply into 3 non-empty chunks for the timed-delta
 *  reveal (~0.9 s total, D8). Pure so the split itself is unit-pinned. */
export function buildDemoDeltas(): string[] {
  const third = Math.ceil(DEMO_REPLY_TEXT.length / 3);
  return [
    DEMO_REPLY_TEXT.slice(0, third),
    DEMO_REPLY_TEXT.slice(third, third * 2),
    DEMO_REPLY_TEXT.slice(third * 2),
  ].filter((chunk) => chunk.length > 0);
}
```

## 5. Work item C — CREATE `apps/frontend/src/components/apps/Chat.tsx` (near-final)

Style constants reuse the Dashboard idiom; the error row reuses ErrorBanner's colors; the banner uses the muted-label language (D9).

```tsx
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import { get as storageGet, set as storageSet } from '../../utils/storage';
import type { ChatMessage } from '../../utils/chat';
import {
  appendMessage,
  buildDemoDeltas,
  isDemoMode,
  updateLastMessage,
} from '../../utils/chat';
import { streamChat } from '../../utils/gemini';
import { ChatError } from '../../utils/gemini';

/** Debounced-save window (ms) after the last message change (D10). */
const CHAT_SAVE_DEBOUNCE_MS = 500;

/** Per-delta delays (ms): cumulative 250 / 550 / 900 — the reveal is
 *  visible in the browser yet fast for the verifier (D8). */
const DEMO_DELTA_DELAYS_MS: readonly number[] = [250, 300, 350];

/**
 * SECURITY (D16): VITE_GEMINI_API_KEY is a FRONTEND key — it is visible
 * in devtools. Acceptable for local Phase 3; Phase 4 adds the backend
 * APIRouter proxy with rate limiting. Read ONCE here at the React
 * boundary (D2) — utils/gemini.ts and utils/chat.ts stay node-pure.
 */
const API_KEY: string = import.meta.env.VITE_GEMINI_API_KEY ?? '';

type ChatStatus = 'idle' | 'streaming' | 'error';

const inputStyle = {
  flex: 1,
  minWidth: 0,
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(0, 132, 255, 0.4)',
  borderRadius: 4,
  color: '#e6e9f2',
  fontFamily: 'Consolas, "Courier New", monospace',
  fontSize: 9,
  padding: '2px 5px',
} as const;
const sendButtonStyle = {
  background: 'rgba(0, 132, 255, 0.12)',
  border: '1px solid rgba(0, 132, 255, 0.5)',
  borderRadius: 4,
  color: '#0084ff',
  fontFamily: 'Consolas, "Courier New", monospace',
  fontSize: 9,
  padding: '2px 6px',
  cursor: 'pointer',
} as const;
const disabledSendStyle = {
  ...sendButtonStyle,
  color: '#8f9bb3',
  borderColor: 'rgba(143, 155, 179, 0.4)',
  cursor: 'default',
} as const;

/**
 * LLM Chat app (M9): Gemini SSE streaming with a demo-mode state machine
 * (D7), inline retryable errors, and per-window persistence (D10 — the
 * Notes pattern: restore never dirties; 500 ms debounced save +
 * dirty-gated unmount flush, so StrictMode's double effect run can never
 * overwrite stored data). The demo engine's timers are user-triggered
 * only (StrictMode-safe, D8) and all cleared on unmount; a live stream is
 * aborted cleanly on unmount and the partial text stays (D5). Zero
 * console output in every state (errors render inline, never logged).
 */
export function Chat({ windowId }: AppProps) {
  const storageKey = `chat:${windowId}`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [demoMode, setDemoMode] = useState(() => isDemoMode(API_KEY));
  const [errorText, setErrorText] = useState('');

  // Refs mirror the latest values for the async save/stream paths (the
  // Notes render-time ref-sync pattern).
  const messagesRef = useRef<ChatMessage[]>([]);
  const timerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const demoTimersRef = useRef<number[]>([]);
  const demoTextRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  // Sticky 401/403 degrade (D7): once the key is rejected, every later
  // send in this window goes straight to demo — no repeated rejections.
  const demoFallbackRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  /** Marks the history dirty and publishes the next list (every mutation
   *  path funnels through here so the debounce effect stays uniform). */
  const commit = (next: ChatMessage[]): void => {
    dirtyRef.current = true;
    messagesRef.current = next;
    setMessages(next);
  };

  // Restore on mount + full cleanup on unmount (D10/D8/D5).
  useEffect(() => {
    const stored = storageGet<ChatMessage[]>(storageKey);
    if (stored !== null && Array.isArray(stored)) {
      // NOT dirty — the StrictMode-safety key (D10, verbatim Notes rule).
      messagesRef.current = stored;
      setMessages(stored);
    }
    return () => {
      demoTimersRef.current.forEach((id) => window.clearTimeout(id));
      demoTimersRef.current = [];
      abortRef.current?.abort(); // clean stop; partial text kept (D5)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        storageSet(storageKey, messagesRef.current);
      }
    };
  }, [storageKey]);

  // Debounced save (D10): scheduled only for post-restore changes.
  useEffect(() => {
    if (!dirtyRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      dirtyRef.current = false;
      storageSet(storageKey, messagesRef.current);
    }, CHAT_SAVE_DEBOUNCE_MS);
  }, [messages, storageKey]);

  // Auto scroll-to-bottom on growth (D9).
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /** Demo engine (D8): canned text revealed in timed deltas. */
  const runDemoReply = (): void => {
    setStatus('streaming');
    demoTextRef.current = '';
    const deltas = buildDemoDeltas();
    let elapsed = 0;
    deltas.forEach((delta, index) => {
      elapsed += DEMO_DELTA_DELAYS_MS[index] ?? 300;
      const id = window.setTimeout(() => {
        demoTextRef.current += delta;
        commit(updateLastMessage(messagesRef.current, demoTextRef.current));
      }, elapsed);
      demoTimersRef.current.push(id);
    });
    const doneId = window.setTimeout(() => setStatus('idle'), elapsed + 50);
    demoTimersRef.current.push(doneId);
  };

  /** Live generation into the (already appended) assistant bubble. The
   *  bubble exists BEFORE the call; history excludes it (slice(0, -1)). */
  const generateAssistantReply = async (): Promise<void> => {
    setStatus('streaming');
    const controller = new AbortController();
    abortRef.current = controller;
    const history = messagesRef.current
      .slice(0, -1)
      .map(({ role, content }) => ({ role, content }));
    let received = '';
    try {
      await streamChat({
        apiKey: API_KEY,
        messages: history,
        onDelta: (delta) => {
          received += delta;
          commit(updateLastMessage(messagesRef.current, received));
        },
        signal: controller.signal,
      });
      setStatus('idle');
    } catch (error) {
      if (error instanceof ChatError && error.kind === 'invalid_key') {
        // D7 sticky degrade: banner on + canned reply for THIS message.
        demoFallbackRef.current = true;
        setDemoMode(true);
        runDemoReply();
        return;
      }
      // 429/network/other: inline retryable error (D7). Remove the empty
      // bubble if nothing streamed; keep partial text if some did.
      if (!received) commit(messagesRef.current.slice(0, -1));
      setErrorText(error instanceof Error ? error.message : String(error));
      setStatus('error');
    } finally {
      abortRef.current = null;
    }
  };

  const handleSend = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = input.trim();
    if (!text || status === 'streaming') return;
    setInput('');
    setErrorText('');
    const withUser = appendMessage(messagesRef.current, 'user', text);
    commit(appendMessage(withUser, 'assistant', ''));
    if (demoMode || demoFallbackRef.current) {
      runDemoReply();
    } else {
      void generateAssistantReply();
    }
  };

  /** Retry = re-run generation for the same last user message (D7):
   *  retries LIVE (a 429 may have passed); an invalid key degrades. */
  const handleRetry = (): void => {
    if (status === 'streaming') return;
    setErrorText('');
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (!last || last.role !== 'assistant') {
      commit(appendMessage(messagesRef.current, 'assistant', ''));
    } else {
      commit(updateLastMessage(messagesRef.current, ''));
    }
    if (demoFallbackRef.current) runDemoReply();
    else void generateAssistantReply();
  };

  const busy = status === 'streaming';
  const sendDisabled = busy || input.trim() === '';
  const bannerReason = !isDemoMode(API_KEY) ? 'API key rejected' : 'no API key';

  return (
    <div style={{ fontSize: 10, lineHeight: 1.4 }}>
      {demoMode && (
        <div
          data-testid="chat-demo-banner"
          style={{
            color: '#8f9bb3',
            fontStyle: 'italic',
            fontSize: 9,
            border: '1px dashed rgba(0, 132, 255, 0.5)',
            borderRadius: 4,
            padding: '1px 4px',
            marginBottom: 3,
          }}
        >
          DEMO MODE — {bannerReason}
        </div>
      )}
      <div
        ref={listRef}
        data-testid="chat-messages"
        style={{
          height: 34,
          overflowY: 'auto',
          background: 'rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(0, 132, 255, 0.4)',
          borderRadius: 4,
          padding: '2px 4px',
          marginBottom: 3,
        }}
      >
        {messages.map((message) => (
          <div
            key={message.id}
            data-testid={
              message.role === 'user' ? 'chat-msg-user' : 'chat-msg-assistant'
            }
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: message.role === 'user' ? '#e6e9f2' : '#00ff88',
            }}
          >
            {message.role === 'user' ? 'YOU: ' : 'JARVIS: '}
            {message.content}
          </div>
        ))}
      </div>
      {status === 'error' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'center' }}>
          <span
            data-testid="chat-error"
            style={{ color: '#ffd7d7', fontSize: 9, flex: 1, minWidth: 0 }}
          >
            {errorText}
          </span>
          <button
            type="button"
            data-testid="chat-retry"
            onClick={handleRetry}
            style={{
              ...sendButtonStyle,
              borderColor: '#ff5a5a',
              color: '#ffd7d7',
            }}
          >
            Retry
          </button>
        </div>
      )}
      <form onSubmit={handleSend} style={{ display: 'flex', gap: 4 }}>
        <input
          data-testid="chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask JARVIS…"
          spellCheck={false}
          style={inputStyle}
        />
        <button
          type="submit"
          data-testid="chat-send"
          disabled={sendDisabled}
          style={sendDisabled ? disabledSendStyle : sendButtonStyle}
        >
          Send
        </button>
      </form>
    </div>
  );
}
```

Notes: Enter submits natively (single-line input inside a form — the deprecated `onKeyPress` from spec §2.3 is NOT used, D17). Every declared style constant is used (`noUnusedLocals` compiles this file).

## 6. Work item D — registration + Dashboard edit

**D1 edit — `apps/frontend/src/components/apps/index.ts`:** add to the imports

```ts
import { Chat } from './Chat';
```

and after the notes registration (registration order = launcher order, D13):

```ts
register({ id: 'chat', title: 'LLM Chat', Component: Chat });
```

Update the module docblock: chat registers here too (M9); the registry itself still has zero M9 changes.

**D2 edit — `apps/frontend/src/components/apps/Dashboard.tsx`:** DELETE the disabled chat button (lines 106–108):

```tsx
        <button type="button" disabled data-testid="launcher-entry-chat" style={disabledButtonStyle}>
          Chat — M9
        </button>
```

Keep `launcher-entry-search` byte-identical. `listApps()` now yields chat automatically → an ENABLED `launcher-open-chat` button appears (which v9 asserts; v8's chat clauses are downgraded in section 11 because this testid disappears). The Dashboard docblock line "Chat/Search render as DISABLED entries, not registered apps (D8)" becomes wrong — amend it to: "Search renders as a DISABLED entry (M10); Chat is a registered app since M9."

## 7. Work item E — bootScene amendments (sanctioned)

**E1 — `apps/frontend/src/utils/bootScene.ts`:**

- `SPAWN_POSITIONS` gains (after notes):

```ts
  chat: new THREE.Vector3(0, 0, 0.25),
```

- `BOOT_APP_IDS` → `['dashboard', 'notes', 'chat']` (`BOOT_WINDOW_COUNT` stays `BOOT_APP_IDS.length` — now 3, v9's pin).
- `BOOT_WINDOW_COUNT` comment: "…v9 pins exactly this (D14 tier 1)." (was "v8 pins").
- Docblock D2 table + rects paragraph: add the chat row and the D11 numbers:

```
 *   chat-1       ( 0.0,  0.0, 0.25) depth 4.75  max |ndc| 0.0000
```

and extend the rects sentence: Chat ~(557.7, 353.7)-(722.3, 446.3) — dead-center, 14.0 px clear of Dashboard, 10.0 px clear of Notes, clear of the HUD / GestureDebug / reset button; depths 4.6 / 4.75 / 4.8 pairwise distinct. Update the "every |ndc| <= 0.2833" phrase to note chat-1 is 0.0 at both aspects (the boot-pair bound is unchanged). ADD the accepted-cascade note: chat-2 (launcher cascade) may overlap notes-1's rect — pre-accepted M8 behavior (notes-2 overlaps notes-1 identically); boot windows are the no-overlap contract.

**E2 — `apps/frontend/src/utils/bootScene.test.ts` (3 tests, amended IN PLACE — no new its):**

1. Test 1 positions list: add `getSpawnPosition('chat', 1)` and `getSpawnPosition('chat', 2)` / `(3)` / `(4)` (comment: chat cascades worst |ndc| 0.1646; the all-apps worst stays 0.3988, notes-4 @16:10).
2. Test 2: `expect(BOOT_APP_IDS).toEqual(['dashboard', 'notes', 'chat']);` and `expect(BOOT_WINDOW_COUNT).toBe(3);` — restructure the pairwise-distinct block to loop over ALL THREE pairs (dash/notes, dash/chat, notes/chat: distinct tuples, xs, ys at BOTH aspects); depths: pin `chatDepth.toFixed(6)` to `'4.750000'` (with dash 4.6 / notes 4.8, the three are pairwise distinct).
3. Test 3: UNCHANGED (clone/cascade/clamp/default semantics are app-agnostic).

## 8. Work item F — `apps/frontend/src/App.tsx` edits (enumerated; NOTHING else changes)

**F1 — HUD title (line 90):** `JARVIS · Milestone 8` → `JARVIS · Milestone 9`.

**F2 — the comment block (lines 85–89)** → exactly:

```tsx
        {/* HUD title bumps per milestone (now "JARVIS · Milestone 9").
            verify_milestone9.py owns the exact pin (introspection finder +
            check e); every older verifier uses the version-tolerant
            'JARVIS · Milestone' lookup (v8's exact pin was made tolerant
            in the M9 lockstep — D14 two-tier policy). */}
```

**F3 — App component docblock:** append one short paragraph after the M8 one: "M9 (Phase 3 part 2): the LLM Chat app registers through the same registry ('chat', D13) and joins the boot scene at the margin-verified center position (D11); its Gemini client, demo-mode state, and persistence live entirely inside the app + the node-pure utils/gemini.ts + utils/chat.ts (D2)."

**F4 — NOTHING else.** The boot loop, `openApp`, counters, `renderAppContent`, and the console line at ~362 are generic/derived. `grep -n "Milestone 8" apps/frontend/src/App.tsx` after your edits → zero hits (the comment you replaced was the only other one).

## 9. Work item G — tests (test-guard ALL of these)

### 9.A CREATE `apps/frontend/src/utils/chat.test.ts` (12 its, node env)

1. `appendMessage appends a user message with id/role/content/timestamp` — explicit timestamp; id `'user-1'` on an empty list.
2. `appendMessage appends an assistant message` — id `'assistant-2'` after one message.
3. `appendMessage ids are unique and sequential across mixed roles` — user, assistant, user → ids `user-1`, `assistant-2`, `user-3` (per-conversation uniqueness by construction).
4. `appendMessage does not mutate the input array` — input frozen/length-unchanged, output is a new array.
5. `updateLastMessage replaces ONLY the last message's content` — two messages; first untouched (same reference), last is a new object.
6. `updateLastMessage preserves the last message's id/role/timestamp`.
7. `updateLastMessage on an empty array is a no-op returning empty` — `[]` in → `[]` out, no throw.
8. `clearChat returns an empty array`.
9. `isDemoMode is true for undefined, null, empty, and whitespace-only keys` (`''`, `'   '`, `'\t'`).
10. `isDemoMode is false for a real key`.
11. `buildDemoDeltas concatenation equals DEMO_REPLY_TEXT` — `deltas.join('') === DEMO_REPLY_TEXT`.
12. `buildDemoDeltas returns >= 2 non-empty chunks` — the timed reveal is a real multi-step animation.

### 9.B CREATE `apps/frontend/src/utils/gemini.test.ts` (22 its, node env)

Shared fixtures at the top:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildGeminiBody,
  buildGeminiUrl,
  ChatError,
  CHAT_ERROR_KINDS,
  extractSseData,
  extractTextDelta,
  GEMINI_MODEL,
  streamChat,
} from './gemini';

const encoder = new TextEncoder();

/** Synthetic SSE body from string chunks (JSON may split across reads). */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** Injected fetch returning a Response-like (duck-typed: ok/status/body). */
function fetchLike(response: { ok: boolean; status: number; body: unknown }): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function textPayload(text: string): object {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}
```

URL/body/parser cases:

1. `buildGeminiUrl is exact: base + model + :streamGenerateContent?alt=sse&key=` — assert the full string for `(GEMINI_MODEL, 'test-key')` and that `GEMINI_MODEL === 'gemini-2.5-flash'` (D1 pin).
2. `buildGeminiBody maps internal 'assistant' to Gemini 'model'` — mixed history; roles exactly `['user', 'model']`.
3. `buildGeminiBody wraps each message as parts:[{text}]` (no system instruction, D17).
4. `extractSseData returns one payload for one complete event` — `'data: x\n\n'` → `data ['x']`, `rest ''`.
5. `extractSseData returns multiple payloads from one buffer` — two events + interleaved blank line.
6. `extractSseData keeps a trailing partial line in rest` — buffer `'data: {"can'` (no newline yet) → `data []`, `rest 'data: {"can'`; then feeding `rest + 'didates": []}\n\n'` yields the payload `'{"candidates": []}'` (the split-across-reads contract at the parser level).
7. `extractSseData skips empty lines, 'event:' lines, and comments` — `': ping'`, `'event: x'`, `''` contribute nothing.
8. `extractSseData strips \r (CRLF) and one optional space after 'data:'` — `'data: {"k":1}\r\n'` parses to `'{"k":1}'`.

streamChat cases (all use `fetchImpl`; `messages: [{ role: 'user', content: 'hi' }]` unless stated):

9. `happy path: one chunk, one event -> onDelta with the delta, resolves the full text`.
10. `JSON split across two reads -> still exactly one delta` — chunks `['data: {"candidates":[{"content":{"parts":[{"te', 'xt":"Hel"}]}}]}\n\n']`.
11. `multi-part payload: ALL parts join into ONE delta` — `parts: [{text:'a'},{text:'b'}]` → delta `'ab'` (D4).
12. `finish frame (no candidates) yields no delta and no throw` — append `sseLine({ candidates: [] })` after a text event.
13. `malformed data line is skipped and the stream continues` — `'data: {not json}\n\n'` then a valid event → only the valid delta.
14. `final event without a trailing newline is still parsed` — chunks `['data: …\n\n', 'data: …']` (last without `\n`) → both deltas.
15. `empty or whitespace-only key -> ChatError kind 'no_key' and fetch is never called` (track calls with a spy wrapper; D7).
16. `HTTP 401 -> ChatError kind 'invalid_key'` (fetchLike `{ ok: false, status: 401, body: null }`).
17. `HTTP 403 -> kind 'invalid_key'`.
18. `HTTP 429 -> kind 'rate_limit'`.
19. `HTTP 500 -> kind 'other'`.
20. `fetch rejection (TypeError) -> kind 'network'` — `fetchImpl` = `(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch`.
21. `abort mid-stream resolves with the partial text (never rejects)` — a stream whose controller we hold:

```ts
let streamController!: ReadableStreamDefaultController<Uint8Array>;
const body = new ReadableStream<Uint8Array>({
  start(c) {
    streamController = c;
    streamController.enqueue(encoder.encode(sseLine(textPayload('Hel'))));
  },
});
const ac = new AbortController();
ac.signal.addEventListener('abort', () =>
  streamController.error(new DOMException('Aborted', 'AbortError')),
);
const deltas: string[] = [];
let releaseFirst!: () => void;
const firstDelta = new Promise<void>((resolve) => { releaseFirst = resolve; });
const promise = streamChat({
  apiKey: 'k',
  messages: [{ role: 'user', content: 'hi' }],
  onDelta: (d) => { deltas.push(d); releaseFirst(); },
  signal: ac.signal,
  fetchImpl: fetchLike({ ok: true, status: 200, body }),
});
await firstDelta;
ac.abort();
await expect(promise).resolves.toBe('Hel'); // D5 clean stop
```

22. `abort before response headers resolves with '' (never rejects)` — fetchImpl returns a promise that rejects on `signal` abort:

```ts
const fetchNever = ((_url: unknown, init?: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError')),
    );
  })) as unknown as typeof fetch;
```

### 9.C Expected total

192 + 12 (chat) + 22 (gemini) = **226**; bootScene stays 3 (amended). Per-file after M9: logger 13, windowManager 26, gestures 39, interactionEngine 49, animation 31, cameraRig 14, bootScene 3, appRegistry 10, storage 7, chat 12, gemini 22. Every OTHER existing test file stays byte-identical. Report the exact vitest summary; reconcile any mismatch BEFORE proceeding.

## 10. Work item H — CREATE `docs/scripts/verify_milestone9.py`

Copy `verify_milestone8.py` as the structural template VERBATIM where possible (fake-webcam Chromium flags, 1280×800 viewport, console/pageerror/request listeners, `PERF_LINE_PATTERN` verbatim, `runtime_introspection` shape, `fully_on_screen`, `error_snapshot`, summary JSON, `OVERALL: PASS/FAIL`, mid-flight console persistence, `main()` + `if __name__` guard). Evidence files: `m9-scene.png`, `m9-full.png`, `m9-chat.png`, `m9-persistence.png`, `m9-console.txt`, `m9-summary.json` in `docs/screenshots/`.

**RUNS WITHOUT A KEY** (guardrails): v9 asserts the demo path; ensure no `VITE_GEMINI_API_KEY` is set for the dev server it drives.

**Introspection (extend the v8 shape):**

- HUD finder: `includes('JARVIS · Milestone 9')` (v9 owns the exact pin — D14 tier 1; comment says so).
- Chat-1 scoped reads (same `dash()` helper pattern, scoped `[data-window-id="chat-1"]`): `chat1: { banner: {present, text}, input: {present, disabled}, send: {present, disabled}, userMsgs: count of [data-testid="chat-msg-user"], assistantMsgs: count of [data-testid="chat-msg-assistant"], lastAssistantText, inputEmpty: value === '' }`.
- Launcher probe: `launcher-open-dashboard` / `launcher-open-notes` / `launcher-open-chat` → `{present, disabled}` (`chat` MUST be present and NOT disabled — D13); `launcher-entry-search` → present + disabled; NO `launcher-entry-chat` anywhere (its disappearance is v9's assertion, v8's was downgraded).
- Keep v8's per-window reads (notes1Value, dashRows, reset button, viewport, videoMeta, floatingWindows).

**Procedure (in order):**

1. Navigate (`domcontentloaded`), `wait_for_timeout(14000)` (same budget). Screenshots `m9-scene.png` + `m9-full.png`; introspection #1.
2. **Launcher chat probe:** snapshot console/pageerror; click `[data-window-id="dashboard-1"] [data-testid="launcher-open-chat"]`; `wait_for_timeout(1000)`; introspect floating windows → expect 4 with `chat-2` fully on screen (its input present + empty + banner present — independent window state); zero NEW console/page errors. Then CLOSE chat-2 via its chrome button (`aria-label="Close LLM Chat"`) so the rest of the flow has exactly the 3 boot windows (v8's close pattern).
3. **Demo chat flow (in chat-1):** assert banner present (check g). `page.fill('[data-window-id="chat-1"] [data-testid="chat-input"]', 'Hello JARVIS')`; click `chat-send`; assert a `chat-msg-user` row containing `Hello JARVIS` (check h). Poll (≤ 5 s, 250 ms steps) until a `chat-msg-assistant` row's text contains `demo reply` (check i). Live-append proof (check j): sample the assistant text at ~400 ms after send (after the 250 ms delta, before the 550 ms one) and the final text at ~2.5 s — assert `len(final) > len(sample)` (deterministic timeouts, D8). Screenshot `m9-chat.png`.
4. **Persistence (part 1):** `wait_for_timeout(800)` (debounce 500 ms) → `page.evaluate("() => localStorage.getItem('jarvis:chat:chat-1')")` → JSON-parses to an array whose first message is `role 'user'` with `content 'Hello JARVIS'` and which contains an assistant message whose content includes `demo reply`.
5. **Reload:** `page.reload()`; `wait_for_timeout(14000)`; introspection #2: exactly 3 windows, ids exactly `{dashboard-1, notes-1, chat-1}`, all fully on screen; chat-1 `userMsgs >= 1` and a `chat-msg-user` row still contains `Hello JARVIS` (check k); 1 live video track. Screenshot `m9-persistence.png`.
6. **Unmount-flush parity (v8 check-m analog):** in chat-1 send `marker = f'm9 close flush {uuid4().hex[:8]}'`; IMMEDIATELY (before the 500 ms debounce fires) click `[data-window-id="chat-1"] button[aria-label="Close LLM Chat"]`; `wait_for_timeout(600)`; assert: no `[data-window-id="chat-1"]` node; `localStorage.getItem('jarvis:chat:chat-1')` parses with the first message `role 'user'`, `content == marker` (the unmount flush saved the mid-debounce history; demo timers were cleared — no errors after close); floating windows = 2 (`dashboard-1`, `notes-1`); zero NEW console/page errors (check m). (Boot windows now exclude chat-1 — v8's tolerant `>= 2` forms still hold on the re-run.)
7. Summary + `m9-console.txt` + `m9-summary.json`; print `=== CHECKS ===` + `OVERALL`.

**Checks (all must PASS; keys exactly as written):**

- `a: zero console errors and zero page errors (whole session, both page loads)` — zero `[error]` console lines AND zero page errors (the chat app logs NOTHING, even in demo/error paths).
- `b: boot scene exact: 3 app windows, ids exactly dashboard-1 + notes-1 + chat-1, all fully on screen, boot console line says 3` — `len(windows) == 3`, id set equality, all `fully_on_screen`, AND any console line contains `[App] app scene ready: 3 app windows created` (the DERIVED line, D12 — pin it here).
- `c: boot titles visible: Dashboard, Notes, and LLM Chat in window text`.
- `d: pairwise-distinct projected positions at boot (tuples, lefts, tops)` — v8 logic over the 3 boot windows (lefts 373.7/732.3/557.7, tops 267.2/424.8/353.7 all distinct).
- `e: HUD shows exact M9 title, Camera active, MediaPipe ready, Windows = 3 at boot` — `'JARVIS · Milestone 9' in hud` + Camera/active/MediaPipe/ready rows + `int(windows_row.group(1)) == 3` (v9 owns the exact title + count pins — D14 tier 1).
- `f: launcher: launcher-open-chat present and ENABLED; search still disabled; no launcher-entry-chat anywhere; open-chat adds chat-2 fully on screen with independent state (own input + banner, empty history); zero new errors`.
- `g: demo mode: chat-demo-banner present with text containing 'DEMO MODE' (no API key on the default path)`.
- `h: send flow: chat-input + chat-send work; a chat-msg-user row contains the sent text`.
- `i: assistant demo reply: a chat-msg-assistant row contains 'demo reply' within the 5 s budget`.
- `j: live-append: the assistant text grows between the ~400 ms sample and completion (timed demo deltas, D8)`.
- `k: chat persists: debounce writes jarvis:chat:chat-1; reload restores the conversation (same context, localStorage survived)`.
- `l: mid-debounce chrome close removes chat-1 AND the unmount flush saved the history (first stored message = the sent marker); zero new errors` (the v8 check-m parity).
- `m: >= 1 [Performance] line, every line matching the M4 four-key format` (v8 check n verbatim).
- `n: latency >= 2 lines, min avg in 150-260ms, < 300ms` (v8 check o verbatim).
- `o: cleanup counts balanced across the session (CameraCapture == HandTracker, 2-4 each with the reload)` (v8 check p verbatim).
- `p: exactly 1 live video track (post-reload introspection)` (v8 check q verbatim).
- `q: max logged FPS >= 30 (boot window)` (v8 check r verbatim).
- `r: no gesture log lines (no hands on fake webcam)` (v8 check s verbatim).

The FINAL checks list is contiguous a–r (18 checks): the chat-2 spawn lives inside f, l is the close-flush parity, and m–r are v8's n–s carried over verbatim. Make the docstring's lettered list match exactly.

- Docstring: M9 scope + honest notes — (1) the default path runs WITHOUT a key: demo mode is what v9 browser-proves; live Gemini streaming is unit-verified with injected fetch, and at most ONE manual live call (screenshot evidence, not part of this script) happens outside it; (2) the fake webcam produces no hands, so gesture interactions with the chat window remain unit-evidenced; (3) speech input is out of M9 scope (vision §3.4 — keyboard only).

## 11. Work item I — verifier lockstep (hash-disciplined, enumerated)

BEFORE any edit: `sha256sum docs/scripts/verify_milestone*.py`, paste the table. Orchestrator-recorded pre-M9 baseline (2026-08-16, verified):

```
450c8386b73c5735ced29997c9edefb7692bdecc5d0384a7b67d2274376a242b  verify_milestone1.py  (MUST stay identical)
2f9bc072f0c523b889ca15278641e784b744745f52b7628260fb50e43f662b44  verify_milestone2.py  (MUST stay identical)
861727280b33d458384e1c986a16e425054d13d6477e0d467cecc97178664cdc  verify_milestone3.py  (MUST stay identical)
388a355b99cf0cd93f5c5bea862d2704144dfab0a2219f2ed27b673310e680ef  verify_milestone4.py  (MUST stay identical)
27b6ddc5dcd74f525469d41d7682f858c42573c4be2e28ae007aa94113f2c3c0  verify_milestone5.py  (MUST stay identical)
370307538efa73a5f849c77192b000818a68a4eee4575a0547d7d4ecc23115d4  verify_milestone6.py  (MUST stay identical)
2fe3d2b8d559b9f7e41e4f431cc5f74e91ab8797b5a69ee1499804ec43c5e422  verify_milestone7.py  (MUST stay identical)
a9e76742a5e55e71bab88c2189a4f2a0d98d5507bf69fc4833597fc60f18d356  verify_milestone8.py  (edited ONLY below)
```

**v1–v7: ZERO edits.** Their HUD lookups are all the tolerant `includes('JARVIS · Milestone')` (v1 has no HUD lookup) and their boot checks are already the D14 `>= 2` invariants — verified by the Orchestrator's greps. You must re-verify and paste: `grep -n "JARVIS · Milestone" docs/scripts/verify_milestone*.py` (only tolerant lookups; no `Milestone 8`/`Milestone 9` pins outside v8/v9) and `grep -n "Milestone 8" docs/scripts/verify_milestone*.py` (hits ONLY in v6/v7 docstring history notes and v8's pins — the v6/v7 notes stay as-is: they describe M8 history, which is still true).

**v8 `verify_milestone8.py` — the enumerated D14 tier-2 downgrades (NOTHING else in the file changes):**

1. **Docstring item b (lines 8–9).** Before:

```python
  b) boot scene exact: 2 app windows, ids exactly dashboard-1 + notes-1,
     both fully on screen (the deterministic boot scene, D2/D3)
```

   After:

```python
  b) boot scene invariant (tier 2 since M9): >= 2 app windows, ids include
     dashboard-1 + notes-1, all boot windows fully on screen (the exact
     boot set/count is pinned only by the current-milestone verifier)
```

2. **Docstring item e (lines 12–13).** Before: `e) HUD shows exact M8 title, Camera active, MediaPipe ready, Windows = 2` / `at boot (v8 owns the exact title + count pins — D13/D14 tier 1)`. After:

```python
  e) HUD title present (version-tolerant since M9), Camera active,
     MediaPipe ready, Windows row >= 2 (exact pins live in v9 since M9)
```

3. **Docstring item i (lines 18–19).** Before: `i) launcher: chat/search entries disabled; open-notes click adds notes-2` / `fully on screen; zero new errors`. After:

```python
  i) launcher: search entry disabled; open-notes click adds notes-2
     fully on screen; zero new errors (chat enablement is v9's pin)
```

4. **Introspection finder (lines 109–112).** Before:

```python
          // M8 owns the CURRENT title, so this verifier pins the exact
          // string (D13/D14 tier 1); older verifiers are tolerant.
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone 8'));
```

   After:

```python
          // Version-tolerant since M9 (the title moved to Milestone 9);
          // the current-milestone verifier v9 owns the exact pin (D14).
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
```

5. **Launcher probe (line 144).** DELETE the line `chat: launcherEntry('launcher-entry-chat'),` (the testid disappears with the Dashboard edit; keep `openDashboard`, `openNotes`, `search`).

6. **Check b (lines 553–556).** Before:

```python
        "b: boot scene exact: 2 app windows, ids exactly dashboard-1 + notes-1, both fully on screen": (
            len(windows1) == 2
            and window_ids1 == {"dashboard-1", "notes-1"}
            and len(windows1_on_screen) == 2
        ),
```

   After:

```python
        "b: boot scene invariant: >= 2 app windows incl. dashboard-1 + notes-1, all fully on screen": (
            len(windows1) >= 2
            and {"dashboard-1", "notes-1"} <= window_ids1
            and len(windows1_on_screen) == len(windows1)
        ),
```

7. **Check e (lines 564–572).** Before (key + two assertion lines shown): `"e: HUD shows exact M8 title, Camera active, MediaPipe ready, Windows = 2 at boot"` / `"JARVIS · Milestone 8" in hud` / `and int(windows_row.group(1)) == 2`. After:

```python
        "e: HUD title present, Camera active, MediaPipe ready, Windows row >= 2": (
            "JARVIS · Milestone" in hud
            and "Camera" in hud
            and "active" in hud
            and "MediaPipe" in hud
            and "ready" in hud
            and windows_row is not None
            and int(windows_row.group(1)) >= 2
        ),
```

8. **Check i (lines 582–591).** Drop the two `chat` clauses; new key. Before:

```python
        "i: launcher: chat/search entries disabled; open-notes click adds notes-2 fully on screen; zero new errors": (
            launcher_probe["pre"]["openDashboard"]["present"]
            and launcher_probe["pre"]["openNotes"]["present"]
            and launcher_probe["pre"]["chat"]["present"]
            and launcher_probe["pre"]["chat"]["disabled"]
            and launcher_probe["pre"]["search"]["present"]
            and launcher_probe["pre"]["search"]["disabled"]
            and launcher_probe["notes2_on_screen"]
            and launcher_probe["errors_before"] == launcher_probe["errors_after"]
        ),
```

   After:

```python
        "i: launcher: search entry disabled; open-notes click adds notes-2 fully on screen; zero new errors": (
            launcher_probe["pre"]["openDashboard"]["present"]
            and launcher_probe["pre"]["openNotes"]["present"]
            and launcher_probe["pre"]["search"]["present"]
            and launcher_probe["pre"]["search"]["disabled"]
            and launcher_probe["notes2_on_screen"]
            and launcher_probe["errors_before"] == launcher_probe["errors_after"]
        ),
```

9. **Check m (line 609).** `and len(close_probe["windows_after_close"]) == 2` → `and len(close_probe["windows_after_close"]) >= 2` (3 boot windows remain after the notes-2 close; `notes2_gone` + `notes1_after_close` already carry the semantics).

AFTER the edits: re-run `sha256sum` (v1–v7 byte-identical — paste digests; v8 changed — record old→new; v9 new). Then run ALL NINE verifiers against the dev server in order 1→9 — every one must print `OVERALL: PASS`. Also paste: `grep -n "JARVIS · Milestone 8" docs/scripts/*.py` → ZERO hits; `grep -n "launcher-entry-chat" docs/scripts/*.py` → ZERO hits.

## 12. Work item J — README.md M9 section (docs-guard)

Append after the M8 section (end of file), mirroring the M6/M7/M8 structure:

```
## Milestone 9 — LLM Chat app: Gemini streaming client, demo mode, chat persistence (Phase 3 part 2)

**Phase 3 continues** — M1–M8 remain green (226 unit tests, nine
verifiers); M9 adds the first networked app window.
```

Then:

- **What was built** — one bullet per artifact: `utils/gemini.ts` (GEMINI_MODEL constant D1, buildGeminiUrl/buildGeminiBody, pure `extractSseData`/`extractTextDelta`, `streamChat` with injectable fetch + AbortSignal, ChatError kinds), `utils/chat.ts` (ChatMessage, appendMessage/updateLastMessage/clearChat, isDemoMode, DEMO_REPLY_TEXT + buildDemoDeltas), `components/apps/Chat.tsx` (bubbles, input row, demo banner, inline error + Retry, Notes-pattern persistence), the registration + Dashboard chat-button removal (launcher auto-enables), bootScene chat-1 + the D11 margin row, the App HUD bump, tests (+34 → 226; per-file counts), `verify_milestone9.py` (demo-mode interactive chat flow + reload persistence + close-flush parity), verifier lockstep (v8 tier-2 downgrade; v1–v7 zero edits; hash table).
- **Enabling the real API (env)** — create `apps/frontend/.env.local` containing `VITE_GEMINI_API_KEY=<your key>` (key from Google AI Studio: https://aistudio.google.com/apikey), restart `npm run dev:frontend` (Vite reads env at startup). Without a key the app runs in demo mode by design. Model constant: swap `GEMINI_MODEL` in `apps/frontend/src/utils/gemini.ts` (one line). Ignore-file status: the root `.gitignore` (`.env`, `.env.*`, `!.env.example`) and `apps/frontend/.gitignore` (`*.local`) already cover `.env.local` — nothing was added.
- **SECURITY NOTE** — a frontend API key is visible in browser devtools; acceptable for local Phase 3 use; Phase 4 moves calls behind the backend APIRouter proxy with rate limiting.
- **Demo mode** — the D7 matrix digested (no key → banner + canned timed replies; 401/403 → sticky degrade; 429/network → inline error + live retry).
- **How to run** — `npm run test`; `npm run dev:frontend`; `python docs/scripts/verify_milestone9.py` (no key needed); manual demo script (open chat from the launcher, ask something, watch the demo reply type out, reload to restore, close mid-reply to see the flush).
- **Deviations & decisions digest (D1–D17)** — MUST include: the five §2.3 deviations (React-FC continuation, `?key=` query param vs `x-goog-api-key` header, typed ChatMessage, SSE streaming vs response.json(), full-history turns + no system instruction), the model choice (D1), abort = clean stop (D5), the demo matrix (D7), persistence key scheme (D10), the chat boot position + accepted cascade overlap (D11), the tier-1 duty move v8→v9 (D14), keyboard-only input (speech deferred, D17).
- **Evidence** — `docs/screenshots/m9-scene.png`, `m9-full.png`, `m9-chat.png`, `m9-persistence.png`, `m9-console.txt`, `m9-summary.json`.
- **Milestone 9 acceptance (mapped honestly)** — automated items checked (gemini client + chat state unit-pinned incl. SSE split-JSON/abort/error mapping; demo flow, persistence, close-flush browser-pinned by v9; 226 tests + build + verifiers 1–9; zero console errors); manual/unchecked items listed explicitly: live Gemini streaming with a real key (at most one manual call — not in v9), real-webcam gesture interaction with the chat window, visual fit at the frozen window scale.

## 13. Do-not-touch list

`utils/appRegistry.ts` + test, `utils/storage.ts` + test, `utils/windowManager.ts` + test, `utils/interactionEngine.ts` + test, `utils/gestures.ts` + test, `utils/animation.ts` + test, `utils/logger.ts` + test, `utils/cameraRig.ts` + test, `components/FloatingWindow.tsx`, `components/Scene3D.tsx`, `components/GestureDebug.tsx`, `components/HandTracker.tsx`, `components/CameraCapture.tsx`, `components/ErrorBanner.tsx`, `components/apps/Notes.tsx`, `components/apps/UnknownApp.tsx`, `src/main.tsx`, `src/index.css`, `src/types/*`, `index.html`, `apps/backend/**`, `packages/shared/**`, `docs/scripts/verify_milestone1.py` … `verify_milestone7.py` (hash-identical), every existing verifier line NOT enumerated in section 11 (including v8's), all npm configs/dependencies, both `.gitignore` files, `docs/briefs/**`, README line 5 (the stale status blurb — M8 left it; M9 does too). App.tsx beyond sections F1–F3.

## 14. Implementation order (small batches, verify each)

1. `utils/chat.ts` + `chat.test.ts` → `npm run test` green (204; 192 + 12).
2. `utils/gemini.ts` + `gemini.test.ts` → green (226) + `npm run build` + lint clean.
3. `bootScene.ts` + `bootScene.test.ts` amendments → green (226 unchanged) + build.
4. `components/apps/Chat.tsx` + `index.ts` registration + Dashboard button removal → build + lint green.
5. App.tsx F1–F3 → build + lint; dev-server eyeball WITHOUT a key: 3 boot windows (Dashboard left-upper, Notes right-lower, Chat center-front), HUD `JARVIS · Milestone 9` / Windows 3, chat banner visible, demo reply types out on send, reload restores the conversation, launcher `+ LLM Chat` opens an independent `chat-2`, zero console output/errors.
6. `verify_milestone9.py` → `OVERALL: PASS` (iterate until every check passes).
7. Verifier lockstep (section 11; hashes before/after) → ALL NINE verifiers `OVERALL: PASS`.
8. README M9 (docs-guard) + final evidence pass (section 15). Optional last: the ONE live call (only if a key is available), screenshot evidence, then REMOVE the key again and re-confirm v9 passes without it.

## 15. Evidence to paste in your report

1. `npm run test` — the summary block (expected 226 passed; per-file counts: chat 12, gemini 22, bootScene 3 amended, all nine original suites unchanged).
2. `npm run build` — the three-workspace success tail; `npm run lint --workspace @jarvis/frontend` — clean.
3. `grep -rn "app windows created" docs/scripts/` — zero hits (the boot line is derived; run BEFORE the App edit as well and paste).
4. `sha256sum docs/scripts/verify_milestone*.py` — BEFORE and AFTER tables; v1–v7 identical (call it out), v8 old→new, v9 new.
5. All NINE verifier runs — each one's `=== CHECKS ===` block + `OVERALL: PASS` line (v9 in the NO-key configuration).
6. `grep -n "JARVIS · Milestone 8" docs/scripts/*.py` and `grep -n "launcher-entry-chat" docs/scripts/*.py` — zero hits after the lockstep.
7. `ls docs/screenshots | grep m9` — the six m9-* evidence files.
8. Skill evidence: test-guard / clean-code-guard / docs-guard check lines for the files they covered (frontend-design followed for the Chat UI; verifier follows the webapp-testing pattern).
9. Any deviation from this brief, with the reason (deviations are acceptable if documented; silent scope drift is not).

---

# Overseer review checklist (1:1 with the M9 acceptance criteria)

For each item: verify with the cited evidence, not the Coder's summary. FAIL = send back to the Coder with the finding.

**Gemini client (unit — 9.B)**
- [ ] `utils/gemini.ts` is node-pure: NO `import.meta`, NO React import (grep). `GEMINI_MODEL === 'gemini-2.5-flash'` single constant (D1); URL is `POST …/v1beta/models/<model>:streamGenerateContent?alt=sse&key=<KEY>` (test 1 exact string).
- [ ] SSE parser: pure `extractSseData`; split-across-reads JSON (tests 6+10), multi-event chunks (5), non-data lines skipped (7), CRLF + one optional space (8), trailing partial retained (6), malformed data line SKIPPED without killing the stream (13), final no-newline event parsed (14).
- [ ] Delta extraction joins ALL parts (11); finish frames yield no delta and no throw (12).
- [ ] Error mapping: no_key (15, fetch never called), 401/403 → invalid_key (16/17), 429 → rate_limit (18), 500 → other (19), TypeError → network (20); `ChatError` has `kind`, const-object kinds, NO enum (read the file).
- [ ] Abort: mid-stream resolves partial text (21), before-headers resolves '' (22); streamChat NEVER rejects on abort (D5).
- [ ] Injectable `fetchImpl` + `AbortSignal` are options; zero new npm deps (diff package.jsons).

**Chat state (unit — 9.A)**
- [ ] ChatMessage shape exact; appendMessage immutable + sequential ids (1–4); updateLastMessage replaces only-last, preserves metadata, empty-safe (5–7); clearChat (8); isDemoMode whitespace/undefined/null matrix (9–10); demo deltas concatenate to the canned text, ≥2 chunks (11–12).

**Chat app (browser — v9 checks f–l + code read)**
- [ ] Testids exact: `chat-input`, `chat-send`, `chat-msg-user`, `chat-msg-assistant`, `chat-demo-banner`, `chat-error`, `chat-retry`; Enter submits; Send disabled while busy/empty; auto-scroll on growth; M8 9–11 px styling (screenshot m9-chat.png).
- [ ] Demo matrix (D7): no key → banner from mount + canned reply, never an error (v9 g/i); 401/403 degrade is STICKY per window with banner switch and canned reply (code read — `demoFallbackRef`); 429/network/other → inline error + Retry that re-runs LIVE (code read — `handleRetry`).
- [ ] Demo engine: 250/550/900 ms timed deltas (D8), timers cleared on unmount, user-triggered only (StrictMode-safe — code read); growth proven live (v9 j).
- [ ] Persistence (D10): key passed as `chat:<windowId>` → physical `jarvis:chat:chat-1` (v9 k reads the physical key); restore never dirties; 500 ms debounce + dirty-gated unmount flush (v9 l mid-debounce close); two chat windows independent (v9 f chat-2).
- [ ] `import.meta.env` read ONLY in Chat.tsx (grep `import.meta` across src → one hit); security note present in Chat.tsx/gemini.ts docblocks AND the README.

**Boot scene + wiring (browser + unit)**
- [ ] `BOOT_APP_IDS = ['dashboard', 'notes', 'chat']`; chat at `(0, 0, 0.25)`; `BOOT_WINDOW_COUNT` DERIVED = 3; boot console line untouched and prints "3 app windows created" (v9 b); bootScene tests amended in place (3 tests: three-way pairwise distinct, depth 4.75 pinned).
- [ ] D11 docblock updated (chat row, Chat rect (557.7, 353.7)–(722.3, 446.3), gaps 10/14 px, cascade-overlap acceptance note); worst |ndc| still 0.3988.
- [ ] index.ts registers chat AFTER notes; Dashboard chat button removed, `launcher-entry-search` untouched; `launcher-open-chat` enabled (v9 f); HUD exactly `JARVIS · Milestone 9` with the rewritten comment (v9 e).

**Tests + build**
- [ ] 226 vitest green = 192 + 12 + 22; ONLY new test files + the amended bootScene.test.ts (diff the file list); build passes all three workspaces; lint clean; TS constraints honored (no enums, `import type`, no unused locals — note Chat destructure only `windowId`).
- [ ] test-guard / clean-code-guard / docs-guard evidence lines present.

**Verifier lockstep (exactness matters — re-grep yourself)**
- [ ] v1–v7 sha256 IDENTICAL before/after (all seven digests match section 11's table).
- [ ] v8 changed ONLY in the nine enumerated spots (re-read the diff regions); `grep -n "JARVIS · Milestone 8" docs/scripts/*.py` → zero; `grep -n "launcher-entry-chat" docs/scripts/*.py` → zero; v8's tolerant forms re-run to PASS against the 3-window boot.
- [ ] All NINE verifiers `OVERALL: PASS`; v9 checks a–r all PASS in the NO-key configuration; the six m9-* evidence files exist.
- [ ] Latency band 150–260 ms; FPS ≥ 30; cleanup balanced; 1 live track; zero console/page errors; perf lines all match the M4 regex; HUD exactly `JARVIS · Milestone 9` + Windows = 3 (v9 e).

**Constraints**
- [ ] NO backend proxy, NO Web Search (search entry still disabled), NO tool calling, NO voice, NO new npm dependencies, NO changes to appRegistry/storage/windowManager/interactionEngine/gestures/FloatingWindow (hash/spot-check), NO new console output (chat logs nothing — v9 a with the whole chat flow exercised), single cleanup pairs, README M9 section complete with the security note + env guide + honest acceptance mapping.
```
