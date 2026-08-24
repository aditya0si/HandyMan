# JARVIS Milestone 10 — Coder Brief (Phase 3 close-out: Web Search app — Google Custom Search client, demo mode, 4th boot window, Phase 3 close)

You are the Coder for JARVIS Milestone 10 in `C:\Users\oliad\Desktop\visionpro` (Windows / Git Bash; npm workspaces root; NOT a git repo — never `git init`/commit). This brief is complete and self-contained. Implement EXACTLY this scope: a node-pure Google Custom Search client (`utils/search.ts`), the Web Search app (`components/apps/Search.tsx` — query input, result cards with real `<a>` links, inline expansion, demo mode, inline error + retry, NO persistence), search registration + launcher enablement, the search boot window (spawn table + tests), `verify_milestone10.py`, the verifier lockstep (v8 AND v9 downgrades — BOTH break this milestone; v1–v7 ZERO edits), the README M10 section + Phase 3 close-out (including the sanctioned stale-status-line fix), and the HUD bump. NO backend proxy (Phase 4, spec §3.3 API Router is explicitly out of scope), NO voice/image search, NO pagination (fixed N = 5), NO popups beyond the `<a target="_blank">` link, NO new npm dependencies, NO changes to gestures/engine/windowManager/storage/appRegistry/gemini/chat. When something is unspecified, follow the existing M1–M9 code conventions (they are deliberate) and document deviations the way M2–M9 did (docblock "DEVIATION"/decision notes).

## 0. Guardrails (read first)

- Run everything from the repo ROOT: `npm run test`, `npm run build`, `npm run dev:frontend`, `npm run lint --workspace @jarvis/frontend`. Python verifiers run as `python docs/scripts/verify_milestoneN.py [base_url]` against the dev server on http://localhost:5173 (start it in the background).
- TS constraints (tsconfig.app.json, verified 2026-08-16): `erasableSyntaxOnly` (NO `enum` — const-object pattern), `verbatimModuleSyntax` (type-only imports MUST use `import type`), `noUnusedLocals` + `noUnusedParameters` (they compile tests too — `include: ["src"]`), `noFallthroughCasesInSwitch`, `jsx: react-jsx`. `types: ["vite/client"]` is already set — `import.meta.env` is typed; NO d.ts needed, NO tsconfig edits. NOTE the trap this milestone: deleting the Dashboard's disabled Search button makes `disabledButtonStyle` UNUSED — it must be deleted too or the build fails under `noUnusedLocals` (section 5).
- Quality skills are mandatory: `test-guard` on all test changes, `clean-code-guard` on all new/changed production code, `docs-guard` on the README changes, and follow the `frontend-design` intent by matching the existing HUD/window-chrome design language (dark glass `rgba(10, 14, 39, 0.85+)`, `#0084ff` accent, `#8f9bb3` labels, `#00ff88` values, `#ff5a5a`/`#ffd7d7` error colors, Consolas monospace, 9–11 px app fonts). Do NOT invent a second visual language. Your report must include the evidence lines those checks produced.
- Style discipline (React 19 dev-mode console error, verified in the live Chat.tsx): NEVER mix a `border` SHORTHAND style with a `borderColor` (or other border-longhand) OVERRIDE on the same element — React 19 dev mode logs a console error for that mix, which breaks the verifiers' zero-console-error gate. Chat.tsx's `sendButtonStyle` already uses LONGHAND (`borderWidth`/`borderStyle`/`borderColor`) precisely because its Retry variant overrides `borderColor`. Search.tsx copies this: any style object that gets spread-with-override uses longhand borders (section 4).
- Console discipline: ZERO new console output in normal operation (including demo results, errors — errors render INLINE in the search UI, never to the console). The boot console line `[App] app scene ready: ${BOOT_WINDOW_COUNT} app windows created` (App.tsx line 367) is DERIVED — it prints "4 app windows created" automatically when search joins `BOOT_APP_IDS`; do NOT edit it. Re-verify: `grep -rn "app windows created" docs/scripts/` → after the lockstep, hits ONLY in v9 (tolerant filter) and v10 (exact pin) — section 10 pins the expected grep state.
- Environment keys: the ONLY sanctioned env vars are `VITE_GOOGLE_SEARCH_API_KEY` and `VITE_GOOGLE_SEARCH_CX`, read via `import.meta.env` in Search.tsx ONLY (D2/D14). The root `.gitignore` (`.env`, `.env.*`, `!.env.example`) and `apps/frontend/.gitignore` (`*.local`) already cover `.env.local` — create NO gitignore files. NEVER commit facts about real values into docs beyond "it holds the credentials".
- v10's default pass MUST succeed WITHOUT search credentials (demo mode). If a `.env.local` with real search credentials exists on this machine, REMOVE/rename it for the v10 run (the banner check requires the credentials-absent demo path). The optional ONE live call (if credentials exist) is a separate manual step, evidence by screenshot — NOT part of v10.
- Baseline (do NOT regress): **226 vitest tests green** (per file: logger 13, windowManager 26, gestures 39, interactionEngine 49, animation 31, cameraRig 14, bootScene 3, appRegistry 10, storage 7, chat 12, gemini 22). Build passes all three workspaces; fake-webcam latency min-avg ~200–216 ms (verifier band 150–260); single cleanup pairs; zero console/page errors; grab/drag/resize/rotate/release/hover/pan/zoom suites all green; all nine existing verifiers `OVERALL: PASS` BEFORE your edits (re-run them once as a pre-flight if you doubt the baseline).
- The ONLY existing files you may touch: `bootScene.ts` + `bootScene.test.ts` (sanctioned amendments, section 6), `components/apps/index.ts` (one registration), `components/apps/Dashboard.tsx` (remove the disabled search button + its now-unused style constant + one docblock line), `App.tsx` (HUD title + comment + docblock paragraph ONLY — section 7), `verify_milestone8.py` (the enumerated downgrades in section 10 — NOTHING else), `verify_milestone9.py` (the enumerated downgrades in section 10 — NOTHING else), `README.md` (append the M10 section + the ONE sanctioned line-5 status fix, section 11). Every other existing file stays byte-identical. If you find any other failing test, STOP and report it — do not amend unilaterally.

## 1. Codebase facts you will rely on (verified by reading, 2026-08-16)

- `apps/frontend/src/utils/gemini.ts` — the M9 node-pure API client this milestone MIRRORS: injectable `fetchImpl`, const-object `CHAT_ERROR_KINDS` + parallel `ChatError` class, exported URL/body builders for tests, purity contract (NO `import.meta`), error mapping 401/403 → invalid_key, 429 → rate_limit, other non-OK → other, fetch rejection → network. Read it before writing search.ts.
- `apps/frontend/src/components/apps/Chat.tsx` — the M9 app pattern Search.tsx MIRRORS: module-scope `const API_KEY = import.meta.env.VITE_GEMINI_API_KEY ?? ''` (the React boundary, line 28), `ChatStatus = 'idle' | 'streaming' | 'error'`, the demo banner (`chat-demo-banner`, text `DEMO MODE — {bannerReason}`), the sticky 401/403 degrade (`demoFallbackRef` + `setDemoMode(true)` + banner reason switch), the inline error row + Retry that re-runs LIVE, the native-form submit handler (`FormEvent<HTMLFormElement>`, `event.preventDefault()`), and the LONGHAND `sendButtonStyle` borders (lines 43–54) whose Retry variant overrides `borderColor` — copy that idiom exactly.
- `apps/frontend/src/components/apps/Dashboard.tsx` — the launcher renders `launcher-open-${app.id}` buttons from `listApps()` (lines 94–105) PLUS the hardcoded DISABLED `launcher-entry-search` button at lines 106–108 ("Search — M10") which this milestone DELETES, and the now-unused `disabledButtonStyle` constant at lines 42–47 which must be deleted with it (`noUnusedLocals`). Docblock line 56 ("Search renders as a DISABLED entry (M10); Chat is a registered app since M9.") becomes wrong — amend (section 5).
- `apps/frontend/src/components/apps/index.ts` — registers dashboard, notes, chat (in that order) + the UnknownApp fallback. M10 adds the search registration AFTER chat (section 5).
- `apps/frontend/src/utils/bootScene.ts` — `BOOT_APP_IDS = ['dashboard', 'notes', 'chat']`, `SPAWN_POSITIONS` (dashboard `(-1.6, 0.75, 0.4)`, notes `(1.6, -0.65, 0.2)`, chat `(0, 0, 0.25)`), `BOOT_WINDOW_COUNT = BOOT_APP_IDS.length` (DERIVED; its comment says "v9 pins exactly this"), `DEFAULT_SPAWN_POSITION (0, 0, 0.3)`, `SPAWN_CASCADE_STEP (0.25, -0.2, 0)`, `getSpawnPosition(appId, instance)` (fresh clone per call). The docblock carries the D2 NDC-margin table + the 1280×800 rect paragraph (D11).
- `apps/frontend/src/utils/windowManager.ts` — windows are `WINDOW_BASE_WIDTH = 1.5` world units wide, `WINDOW_ASPECT = 16/9` → world height `0.84375`. Frozen for M10.
- `apps/frontend/src/utils/bootScene.test.ts` — 3 tests (margin projections at BOTH aspects 16:9 and 16:10 for boot + cascade + default spawns; exact boot composition + three-way pairwise-distinct projections + pinned depths `4.600000`/`4.800000`/`4.750000`; clone/cascade/clamp/default semantics). Sanctioned amendments in section 6.
- `apps/frontend/src/App.tsx` — HUD title `JARVIS · Milestone 9` at line 90 with the lockstep comment at lines 85–89; the App component docblock's M9 paragraph at lines 192–196; the boot console line at 367 (derived — see guardrails); `renderAppContent` + `openApp` + per-scene instance counters are generic (search needs NO wiring — registering it is enough); reset button `data-testid="reset-view"` top-center; HUD top-left; GestureDebug top-right.
- `apps/frontend/src/utils/appRegistry.ts` — `AppProps = AppContext & { openApp }` where `AppContext = { windowId, sendMessage, maximize, minimize, close }`. `listApps()` is registration order (launcher source). M10 needs ZERO changes to it.
- `apps/frontend/src/components/FloatingWindow.tsx` — the DOM panel: `data-testid="floating-window"` (line 78), `data-window-id={window.id}` (line 79), chrome buttons `aria-label={`Close ${window.title}`}` (line 140) → search-1's close button is `button[aria-label="Close Web Search"]` once registered with title 'Web Search'. Window CONTENT is ordinary DOM inside the 3D-positioned panel — real `<a href target="_blank">` links work.
- `docs/scripts/verify_milestone9.py` — the interactive-verifier pattern v10 follows VERBATIM where possible (fake-webcam Chromium flags, 1280×800 viewport, console/pageerror/request listeners, `PERF_LINE_PATTERN`, `runtime_introspection` shape incl. the `chat1Sel`/`launcherEntry` helpers, `fully_on_screen`, `error_snapshot`, summary JSON, `OVERALL: PASS/FAIL`, mid-flight console persistence, native-form-submit driver via `form.dispatchEvent(new Event('submit', …))` — mouse clicks block on the WebGL canvas hit-target in this headless build). Its chat pins survive M10 UNTOUCHED; its boot/window-count/search-launcher pins are downgraded in section 10.
- `docs/scripts/verify_milestone8.py` — already tier-2 for boot (check b: `>= 2` + subset + ALL-on-screen), HUD (check e: tolerant `>= 2`), close (check m: `>= 2`); its ONLY M10 breaks are the `search` launcher-probe line (145) and check i's search clauses (lines 585–586) — section 10.
- Node is v24.14.1 — vitest node-env tests have globals `fetch`, `Response` types via lib.dom (tsc) and `TextEncoder`, `AbortController`, `DOMException` at runtime. NO jsdom, NO new deps needed for the search tests.
- Verifier hash baselines (pre-M10, sha256, re-verified 2026-08-16 against the live files):

```
450c8386b73c5735ced29997c9edefb7692bdecc5d0384a7b67d2274376a242b  verify_milestone1.py  (MUST stay identical)
2f9bc072f0c523b889ca15278641e784b744745f52b7628260fb50e43f662b44  verify_milestone2.py  (MUST stay identical)
861727280b33d458384e1c986a16e425054d13d6477e0d467cecc97178664cdc  verify_milestone3.py  (MUST stay identical)
388a355b99cf0cd93f5c5bea862d2704144dfab0a2219f2ed27b673310e680ef  verify_milestone4.py  (MUST stay identical)
27b6ddc5dcd74f525469d41d7682f858c42573c4be2e28ae007aa94113f2c3c0  verify_milestone5.py  (MUST stay identical)
370307538efa73a5f849c77192b000818a68a4eee4575a0547d7d4ecc23115d4  verify_milestone6.py  (MUST stay identical)
2fe3d2b8d559b9f7e41e4f431cc5f74e91ab8797b5a69ee1499804ec43c5e422  verify_milestone7.py  (MUST stay identical)
d10b86223eefab357ab4a1b359adf7b76064e8352e475c0d3bb6ea4e17520147  verify_milestone8.py  (edited ONLY in section 10)
413b5c3350f973cbd7fb9d2cc60c71af2e7147e2587133b49752ebb53da2cade  verify_milestone9.py  (edited ONLY in section 10)
```

  v1–v7 title lookups are ALL the version-tolerant `includes('JARVIS · Milestone')` (v1 has no title lookup at all) and their boot checks are already `>= 2` — verified by grep 2026-08-16. ZERO edits expected there (re-grep and paste as evidence). The only exact `JARVIS · Milestone 9` pins in the tree are v9's two (finder line 129, check e line 703); the only `launcher-entry-search` references are v8 line 145, v9 lines 196 + 682.
- README is 1289 lines; the M9 section (`## Milestone 9 — …`, line 1149) runs to end-of-file — the M10 section APPENDS after it. The stale line-5 status blurb still says "Milestone 7 status: Phase 2 COMPLETE" — M8/M9 chose not to touch it; M10's close-out FINALLY fixes it (sanctioned, D15, section 11).
- `TECHNICAL_SPEC.md` §2.3 line 698 — `export class WebSearchApp extends App { // Similar structure }` — an EMPTY sketch, nothing binding. §3.3 (line ~911) is the Phase 4 backend `APIRouter` with rate limiting — explicitly OUT of M10 scope. `PROJECT_VISION.md` §3.4 lines 85–88 — Web Search: "Query via text/voice, Results displayed in 3D cards, Click cards to expand" (voice deferred, "3D cards" = cards inside the 3D floating window — D16).

## 2. Design decisions (decided by the Orchestrator — implement as specified, document in code)

**D1 — API + URL form: Google Custom Search JSON API v1, GET with ALL query params.** `GET https://www.googleapis.com/customsearch/v1?key=<KEY>&cx=<CX>&num=<N>&q=<QUERY>` with `N = SEARCH_RESULT_COUNT` (exported, default 5, no pagination). Every param is percent-encoded via `encodeURIComponent` (pinned by special-char tests: spaces → `%20`, `&` → `%26`, `=` → `%3D`, unicode → UTF-8 percent-encoding). The spec sketch family's `x-goog-api-key` HEADER form is superseded by query-param auth per the M10 milestone prompt — documented deviation (both are valid Google REST auth; the prompt's form is pinned, exactly like M9 D17 deviation 2).

**D2 — Node-purity boundary: `import.meta.env` is read ONLY in Search.tsx.** `utils/search.ts` stays node-testable like gemini.ts/appRegistry.ts: NO `import.meta`, NO React, NO DOM-only APIs. `runSearch` takes `apiKey` and `cx` as parameters; `isSearchDemoMode(apiKey, cx)` takes both as parameters. Search.tsx reads `import.meta.env.VITE_GOOGLE_SEARCH_API_KEY ?? ''` and `import.meta.env.VITE_GOOGLE_SEARCH_CX ?? ''` ONCE at module scope and passes them down. Post-M10 pin: `grep -rn "import.meta.env" apps/frontend/src` → exactly TWO hits (Chat.tsx line 28 + Search.tsx).

**D3 — `SearchError`: a PARALLEL class to M9's `ChatError` (the prompt's recommendation, taken).** `SEARCH_ERROR_KINDS = { noKey: 'no_key', invalidKey: 'invalid_key', rateLimit: 'rate_limit', network: 'network', other: 'other' } as const`; `class SearchError extends Error { readonly kind: SearchErrorKind }` with `name = 'SearchError'` and a user-readable message per kind. Same shape and same HTTP mapping as ChatError (401/403 → `invalid_key`, 429 → `rate_limit`, other non-OK → `other`, fetch/`TypeError` rejection → `network`). NOT a shared class: clean per-app separation (search has no streaming, chat has no cx; `no_key` means "key OR cx missing"), zero cross-app coupling, and the M9 file stays byte-identical (hash discipline). Semantic difference from chat, documented: `no_key` fires when EITHER credential is missing.

**D4 — Zero-results + tolerance semantics.** A 200 with `items` ABSENT is a VALID zero-result Custom Search response → `[]` (NEVER an error — the API genuinely omits the field when nothing matches). A 200 with `items` non-array → `[]` (defensive). Every item field is type-guarded: missing/non-string `title`/`link`/`snippet`/`displayLink` → `''` (`displayLink` is commonly missing — documented). OK-but-unparseable JSON body → `SearchError` kind `other` (empty results are returned for VALID zero-match responses, never thrown for them).

**D5 — Demo-mode decision + sticky degrade + demo timing.** `isSearchDemoMode(apiKey, cx)` = true when EITHER credential is undefined/null/empty/whitespace-only (BOTH must be present-and-non-whitespace for live). Matrix (every cell unit-pinned or v10-browser-pinned):

| credentials state | event | behavior |
| --- | --- | --- |
| key or cx missing | mount | banner `DEMO MODE — no API key or search engine ID` visible from the start; NEVER an error |
| key or cx missing | submit | canned demo results after a ~400 ms simulated latency; no fetch attempt, no error UI |
| both present | mount | NO banner |
| both present | submit | live `runSearch`; searching state disables submit |
| both present | live returns 401/403 (`invalid_key`) | STICKY degrade (ref flag for this window's lifetime): banner switches to `DEMO MODE — credentials rejected`, THIS query is answered with the canned results, no error UI, no repeated 401 round-trips on later submits |
| both present | live returns 429 / network / other | inline error row (`search-error` + `search-retry`); prior results cleared; Retry re-runs LIVE with the same query |
| any | searching | Search button disabled; input stays editable |
| any | unmount mid-anything | demo timer cleared, in-flight fetch aborted cleanly (abort resolves `[]`, never rejects) |

  Demo timing: ONE ~400 ms simulated latency (`DEMO_SEARCH_DELAY_MS = 400`) so the searching state is visible in the browser yet deterministic and verifier-friendly (< 2 s). NO multi-delta streaming theatrics — search is request/response, unlike chat's streaming reveal (documented contrast with M9 D8). Abort semantics differ from chat accordingly: abort resolves `[]` — a request/response call has no partial result to keep (chat kept its streamed partial text; D5-M9).

**D6 — Canned demo results: fixed, stable, https.** `DEMO_SEARCH_RESULTS` = exactly 5 entries (matching `SEARCH_RESULT_COUNT`), exported from utils/search.ts (pure). Every title and snippet contains the stable marker `demo result` (v10 pins it); every `link` is a real `https://` URL (so v10's `getAttribute('href')` assertions are meaningful); every `displayLink` set; every snippet longer than 80 chars so the collapsed/expanded difference (D8) is visible. Exact content pinned in section 3.

**D7 — NO persistence (the prompt's framing, agreed and documented).** Search results and the query are React state ONLY — nothing goes through utils/storage. Rationale (document it): Notes and Chat are durable artifacts (a document, a conversation); a web search is a transient QUERY whose results go stale — persisting them would fake durability. Consequences the design leans on: no restore-on-mount (StrictMode double-mount is trivially safe), no dirty/debounce/flush machinery, the ONLY effect is unmount cleanup (abort + clear timer).

**D8 — Search UI pins + the open-affordance shape (exact).** Testids: `search-input` (single-line `<input>`), `search-submit` (submit button, disabled while searching or input empty), `search-demo-banner`, `search-card` (one per result row — the clickable card body), `search-card-link` (the real `<a>`), `search-card-domain`, `search-card-snippet`, `search-card-detail` (the expanded region), `search-error`, `search-retry`, `search-empty` (zero-results state), `search-status` (the "Searching…" row). Open-affordance DECISION: the card TITLE IS the `<a href={result.link} target="_blank" rel="noopener noreferrer">` and it calls `event.stopPropagation()` so following the link does NOT toggle the card; the CARD BODY (`search-card` div onClick) toggles inline expansion; expanded shows the FULL snippet + the raw link as text. Collapsed snippet is truncated at 80 chars by the PURE exported `truncateSnippet` (unit-pinned) so expansion is visibly different. Enter submits (native form submit). Auto scroll-to-bottom on result growth. Border-LONGHAND discipline for every style object that gets a spread-with-override (guardrails). Verifier interaction contract: v10 asserts href/target/rel via `getAttribute` WITHOUT following the link, and toggles cards by dispatching a native bubbling `MouseEvent('click')` on the card div (mouse clicks block on the WebGL canvas — the M9 native-dispatch pattern extended to clicks; React 19's root-level delegation receives bubbled native clicks).

**D9 — Boot scene: `search-1` at `(-1.9, -0.85, 0.1)`, margin-verified (the D2 discipline, numbers computed and cross-validated against the M9 docblock).** `BOOT_APP_IDS = ['dashboard', 'notes', 'chat', 'search']` (search LAST → creation order puts the milestone focus frontmost, mirroring M9's chat rationale); `SPAWN_POSITIONS.search = new THREE.Vector3(-1.9, -0.85, 0.1)`; `BOOT_WINDOW_COUNT` stays DERIVED (now 4 — v10 pins it). Camera (0,0,5) fov 75; all windows 1.5 × 0.84375 world units:

| app | position | depth | ndc @16:9 (x, y) | ndc @16:10 (x, y) | max abs ndc |
| --- | --- | --- | --- | --- | --- |
| dashboard | `(-1.6, 0.75, 0.4)` | 4.6 | (-0.2550, 0.2125) | (-0.2833, 0.2125) | 0.2833 |
| notes | `(1.6, -0.65, 0.2)` | 4.8 | (0.2444, -0.1765) | (0.2715, -0.1765) | 0.2715 |
| chat | `(0, 0, 0.25)` | 4.75 | (0.0000, 0.0000) | (0.0000, 0.0000) | 0.0000 |
| search | `(-1.9, -0.85, 0.1)` | 4.9 | (-0.2842, -0.2261) | (-0.3158, -0.2261) | 0.3158 |

Projected rects at the 1280×800 verifier viewport: Dashboard (373.7, 267.2)–(543.7, 362.8), Notes (732.3, 424.8)–(895.2, 516.4), Chat (557.7, 353.7)–(722.3, 446.3), **Search (358.1, 445.5)–(517.7, 535.3)** (159.6 × 89.8 px). Bottom-left quadrant (Dashboard owns upper-left): fully on screen with 264.7 px of bottom margin; 40.0 px clear of Chat's left edge; 82.7 px below Dashboard's bottom edge; 214.7 px clear of Notes' left edge — NO rect overlap with any boot window (boot windows are the no-overlap contract per M9 D11); clear of the HUD (top-left, ends ~x292/y230), the reset button (top-center ~x580–700, ~y16–50), and GestureDebug (top-right, starts ~x1004). Distinct lefts 373.7 / 732.3 / 557.7 / 358.1 (minimum gap 15.6 px — comfortable at a deterministic projection, not a 5 px accident); distinct tops 267.2 / 424.8 / 353.7 / 445.5 (minimum gap 20.7 px); distinct depths 4.6 / 4.75 / 4.8 / 4.9. The BOOT-window |ndc| bound moves 0.2833 → 0.3158 (still comfortably < 0.9 — update the docblock phrase). Worst |ndc| across ALL cascade instances 1–4 of ALL apps stays **0.3988** (notes-4 @16:10) — search's worst cascade is 0.3856 (search-4, y @ both aspects) — the docblock's all-apps worst number SURVIVES unchanged. Launcher-cascade rects: search-2 (0.25-step) → (384.7, 466.8)–(544.3, 556.6) fully on screen and 13.4 px clear of Chat; search cascades stay clear of every boot window through instance 4 (the pre-accepted M8/M9 cascade-overlap policy is unchanged and simply never triggers for search).

**D10 — Registration + launcher enablement.** `components/apps/index.ts` registers `{ id: 'search', title: 'Web Search', Component: Search }` AFTER chat → launcher order: Dashboard, Notes, LLM Chat, Web Search (registration order = launcher order = the README's Phase 3 app list). Dashboard.tsx DELETES the hardcoded disabled search button (lines 106–108) AND the now-unused `disabledButtonStyle` (lines 42–47, `noUnusedLocals`) — `launcher-open-search` then appears automatically via `listApps()` (enabled, opens `search-2` via the existing cascade). After this edit ZERO disabled placeholder launcher entries remain anywhere — v10 pins that; v8/v9's probes of the testid are downgraded (section 10).

**D11 — HUD + boot console line.** App.tsx line 90: `JARVIS · Milestone 9` → `JARVIS · Milestone 10`; the lines 85–89 comment is rewritten (section 7). The boot console line at 367 is DERIVED — zero edits; it prints `4 app windows created` automatically and v10 asserts that exact rendered text.

**D12 — Verifier lockstep: v8 AND v9 both downgrade; v10 owns the exact pins.** Adding a 4th boot window breaks v9's exact boot-set/count/boot-line/Windows-row pins AND the reload trio pin; removing the disabled Search entry breaks v8's and v9's `launcher-entry-search` probes. v1–v7: ZERO edits (already tolerant + `>= 2`; re-grep, paste zero-hit evidence, touch nothing). v8 and v9 are downgraded in EXACTLY the enumerated spots (section 10) to the M8-D14 tier-2 invariants; v9's chat-flow checks (g–j), distinctness (d), and titles (c) survive a 4th window UNTOUCHED — verify by reading, do not edit them. v10 (new) owns the exact pins: HUD `JARVIS · Milestone 10`, boot set exactly `{dashboard-1, notes-1, chat-1, search-1}`, Windows = 4, boot console line "4 app windows created", search interactivity.

**D13 — Tests: 1 new file, 21 new tests → 247 total.** `search.test.ts` (21 its, enumerated in section 8); `bootScene.test.ts` amended in place (still 3). Arithmetic: 226 + 21 = **247 expected**; reconcile any mismatch BEFORE proceeding.

**D14 — Env + security documentation (README only; create no ignore files).** README documents BOTH user-supplied values: a Google Cloud API key with the Custom Search API enabled (Google Cloud Console → APIs & Services) and a Programmable Search Engine ID (`cx`, created at https://cse.google.com — enable "Search the entire web"). `apps/frontend/.env.local` gains `VITE_GOOGLE_SEARCH_API_KEY=<key>` and `VITE_GOOGLE_SEARCH_CX=<cx>`; restart `npm run dev:frontend`. Without either value the app runs in demo mode by design. SECURITY NOTE (README M10 section AND the Search.tsx/search.ts docblocks): frontend credentials are visible in devtools; acceptable for local Phase 3; Phase 4 brings the backend APIRouter proxy with rate limiting (spec §3.3). Existing gitignore rules already cover `.env.local` — nothing added.

**D15 — README Phase 3 close-out.** (1) Append the M10 section (what was built, env guide, security note, demo-mode digest, how to run, deviations digest, evidence, honest acceptance mapping — section 11). (2) Mark Phase 3 COMPLETE (app-window framework + all four apps: Dashboard, Notes, LLM Chat, Web Search). (3) FINALLY fix the stale line-5 status blurb ("Milestone 7 status…" → "Milestone 10 status: Phase 3 COMPLETE…") — sanctioned close-out docs fix, eight milestones stale, M8/M9 deliberately deferred it to a close-out moment and this is it. (4) The REWRITTEN full demo script lives in the M10 section ("Demo script — full Phase 3 experience": open apps from the Dashboard launcher, gesture-manipulate each window, chat with/without a key, search with/without credentials) and explicitly supersedes the M7-era gesture-only script at line 803, which STAYS untouched as milestone history (the append-only README convention M8/M9 followed; its gesture descriptions remain accurate). The line-5 blurb points readers at the current script.

**D16 — Spec/vision deviations, all documented (docblock + README digest).** (1) The spec §2.3 `WebSearchApp extends App` sketch is an empty "Similar structure" placeholder — the M8 React-FC registry deviation continues (nothing binding was dropped). (2) Query-param auth (`?key=…&cx=…`) supersedes the spec family's `x-goog-api-key` header (D1). (3) PROJECT_VISION §3.4 "Query via text/voice" — M10 ships TEXT only (voice out of scope, same deferral pattern as M9's speech input). (4) "Results displayed in 3D cards" = cards inside the 3D floating window (the window IS the 3D surface; no separate 3D card meshes — documented interpretation). (5) "Click cards to expand" = inline expansion + a real `<a target="_blank">` open affordance (D8). (6) No pagination — fixed `SEARCH_RESULT_COUNT = 5` (YAGNI, documented). (7) No persistence (D7). (8) `SearchError` parallel class rather than reuse (D3). (9) `truncateSnippet` 80-char collapse is a UX choice, pure + unit-pinned.

## 3. Work item A — CREATE `apps/frontend/src/utils/search.ts` (near-final; node-pure)

```ts
/**
 * M10 Google Custom Search JSON API client for the Web Search app.
 *
 * DEVIATIONS from TECHNICAL_SPEC §2.3 (documented, D16): the spec sketch
 * (`export class WebSearchApp extends App { // Similar structure }`) is an
 * EMPTY placeholder — the M8 React-FC registry continues, and this module
 * is the node-pure client behind the Search app component. API form: GET
 * https://www.googleapis.com/customsearch/v1?key=<KEY>&cx=<CX>&num=<N>&q=<QUERY>
 * — query-param auth per the M10 milestone prompt supersedes the spec
 * family's x-goog-api-key header form (both are valid Google REST auth).
 *
 * Purity contract (D2, mirrors gemini.ts): NO import.meta, NO React, NO
 * DOM-only APIs — apiKey and cx are PARAMETERS (Search.tsx reads
 * import.meta.env at the React boundary), fetch is injectable so node
 * vitest exercises everything with Response-likes (no network in tests).
 *
 * Semantics (D4/D5): a 200 with `items` ABSENT is a VALID zero-result
 * response -> [] (never an error); missing item fields map to '';
 * SearchError is reserved for genuine failures (no credentials, 401/403,
 * 429, other non-OK, network, unparseable body). Abort = clean stop:
 * resolves [] (request/response has no partial result to keep — unlike
 * M9's streaming partial text).
 */

/** Fixed result count (no pagination in M10 — D16). v10 pins 5 cards. */
export const SEARCH_RESULT_COUNT = 5;

const SEARCH_API_BASE = 'https://www.googleapis.com/customsearch/v1';

/** Error kinds as a const object (NO enum — erasableSyntaxOnly). */
export const SEARCH_ERROR_KINDS = {
  noKey: 'no_key',
  invalidKey: 'invalid_key',
  rateLimit: 'rate_limit',
  network: 'network',
  other: 'other',
} as const;

export type SearchErrorKind = (typeof SEARCH_ERROR_KINDS)[keyof typeof SEARCH_ERROR_KINDS];

/**
 * Typed failure with a distinguishable kind + user-readable message (D3).
 * PARALLEL to M9's ChatError (same shape, same HTTP mapping) — kept
 * separate for clean per-app coupling: 'no_key' here means the key OR the
 * cx is missing (search has TWO credentials; chat has one).
 */
export class SearchError extends Error {
  readonly kind: SearchErrorKind;

  constructor(kind: SearchErrorKind, message: string) {
    super(message);
    this.name = 'SearchError';
    this.kind = kind;
  }
}

/** One result card. Missing wire fields map to '' (D4). */
export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

/** URL builder (exported for tests): every param percent-encoded (D1). */
export function buildSearchUrl(
  apiKey: string,
  cx: string,
  query: string,
  num: number = SEARCH_RESULT_COUNT,
): string {
  return (
    `${SEARCH_API_BASE}?key=${encodeURIComponent(apiKey)}` +
    `&cx=${encodeURIComponent(cx)}` +
    `&num=${num}` +
    `&q=${encodeURIComponent(query)}`
  );
}

/**
 * items[] -> SearchResult[] (D4). `items` absent (the API omits it on
 * zero matches) or non-array -> []. Every field type-guarded: missing or
 * non-string -> ''. Never throws.
 */
export function mapSearchItems(payload: unknown): SearchResult[] {
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return {
      title: typeof record.title === 'string' ? record.title : '',
      link: typeof record.link === 'string' ? record.link : '',
      snippet: typeof record.snippet === 'string' ? record.snippet : '',
      displayLink:
        typeof record.displayLink === 'string' ? record.displayLink : '',
    };
  });
}

/** Demo mode = EITHER credential missing/whitespace (D5). */
export function isSearchDemoMode(
  apiKey: string | undefined | null,
  cx: string | undefined | null,
): boolean {
  return !apiKey || apiKey.trim() === '' || !cx || cx.trim() === '';
}

/** Collapsed-card snippet budget (D8); pure so tests pin the truncation. */
const SNIPPET_COLLAPSE_MAX = 80;

/** Collapsed cards show at most `max` chars + ellipsis; expanded shows all. */
export function truncateSnippet(
  snippet: string,
  max: number = SNIPPET_COLLAPSE_MAX,
): string {
  return snippet.length > max ? `${snippet.slice(0, max)}…` : snippet;
}

/**
 * Canned demo results (D6): fixed content with the stable 'demo result'
 * markers (v10 pins them), real https URLs so <a href> assertions are
 * meaningful, displayLinks set, and snippets > 80 chars so the collapsed
 * vs expanded difference is visible. Exactly SEARCH_RESULT_COUNT entries.
 */
export const DEMO_SEARCH_RESULTS: readonly SearchResult[] = [
  {
    title: 'Spatial computing — Wikipedia (demo result 1)',
    link: 'https://en.wikipedia.org/wiki/Spatial_computing',
    snippet:
      'Demo result 1: spatial computing is the use of digital technology to '
      + 'make physical space interactive, blending 3D interfaces with the real world.',
    displayLink: 'en.wikipedia.org',
  },
  {
    title: 'MediaPipe Hands — Google Developers (demo result 2)',
    link: 'https://developers.google.com/mediapipe',
    snippet:
      'Demo result 2: MediaPipe provides on-device hand-landmark detection '
      + 'that powers gesture interfaces from a plain webcam, no extra hardware.',
    displayLink: 'developers.google.com',
  },
  {
    title: 'three.js docs — JavaScript 3D library (demo result 3)',
    link: 'https://threejs.org/docs/index.html#manual/en/introduction/Creating-a-scene',
    snippet:
      'Demo result 3: three.js is a lightweight 3D library for rendering '
      + 'scenes, cameras, and geometry in the browser via WebGL.',
    displayLink: 'threejs.org',
  },
  {
    title: 'Custom Search JSON API overview (demo result 4)',
    link: 'https://developers.google.com/custom-search/v1/overview',
    snippet:
      'Demo result 4: the Custom Search JSON API returns web results for a '
      + 'query using a Programmable Search Engine id (cx) and an API key.',
    displayLink: 'developers.google.com',
  },
  {
    title: 'WebXR Device API — MDN (demo result 5)',
    link: 'https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API',
    snippet:
      'Demo result 5: WebXR exposes augmented- and virtual-reality devices '
      + 'to the web, the browser side of spatial computing standards.',
    displayLink: 'developer.mozilla.org',
  },
];

export interface RunSearchOptions {
  apiKey: string;
  cx: string;
  query: string;
  /** Abort = clean stop (D5): resolves []. */
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Runs one Custom Search query. Resolves the mapped results ([] is a
 * VALID zero-result answer). Throws SearchError ONLY for genuine failures
 * (D3/D4): missing key or cx -> no_key (fetch never called), 401/403 ->
 * invalid_key, 429 -> rate_limit, other non-OK -> other, network
 * rejection -> network, unparseable JSON on OK -> other.
 */
export async function runSearch({
  apiKey,
  cx,
  query,
  signal,
  fetchImpl = fetch,
}: RunSearchOptions): Promise<SearchResult[]> {
  const key = apiKey.trim();
  const engineId = cx.trim();
  if (!key || !engineId) {
    throw new SearchError(
      SEARCH_ERROR_KINDS.noKey,
      'No Google Custom Search credentials configured — set '
        + 'VITE_GOOGLE_SEARCH_API_KEY and VITE_GOOGLE_SEARCH_CX in '
        + 'apps/frontend/.env.local (README, Milestone 10).',
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(buildSearchUrl(key, engineId, query), {
      method: 'GET',
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return []; // clean cancel before headers (D5)
    throw new SearchError(
      SEARCH_ERROR_KINDS.network,
      `Network error reaching Google Custom Search: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    const kind =
      response.status === 401 || response.status === 403
        ? SEARCH_ERROR_KINDS.invalidKey
        : response.status === 429
          ? SEARCH_ERROR_KINDS.rateLimit
          : SEARCH_ERROR_KINDS.other;
    throw new SearchError(
      kind,
      `Google Custom Search request failed (HTTP ${response.status}).`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SearchError(
      SEARCH_ERROR_KINDS.other,
      'Google Custom Search response was not valid JSON.',
    );
  }
  return mapSearchItems(payload);
}
```

Notes: `num` is interpolated raw (a number — digits only, nothing to encode); tests pin `num=5` and the override. The canned array is `readonly` and NEVER mutated by the app (Search.tsx copies nothing — React state holds the same reference and only ever replaces it wholesale; document this in the Search.tsx docblock).

## 4. Work item B — CREATE `apps/frontend/src/components/apps/Search.tsx` (near-final)

Style constants reuse the Chat.tsx idiom verbatim (input border shorthand is safe — nothing overrides it; button styles use LONGHAND because the Retry variant overrides `borderColor`; the card uses a plain shorthand border — no override). The error row reuses ErrorBanner's colors; the banner uses the muted-label language (D8).

```tsx
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import type { SearchResult } from '../../utils/search';
import { DEMO_SEARCH_RESULTS, isSearchDemoMode, runSearch, truncateSnippet } from '../../utils/search';
import { SearchError } from '../../utils/search';

/** Demo-path simulated latency (ms) (D5): the searching state is visible
 *  in the browser yet deterministic and fast for the verifier. */
const DEMO_SEARCH_DELAY_MS = 400;

/**
 * SECURITY (D14): VITE_GOOGLE_SEARCH_API_KEY and VITE_GOOGLE_SEARCH_CX are
 * FRONTEND credentials — they are visible in devtools. Acceptable for
 * local Phase 3; Phase 4 adds the backend APIRouter proxy with rate
 * limiting. Read ONCE here at the React boundary (D2) — utils/search.ts
 * stays node-pure.
 */
const SEARCH_API_KEY: string = import.meta.env.VITE_GOOGLE_SEARCH_API_KEY ?? '';
const SEARCH_CX: string = import.meta.env.VITE_GOOGLE_SEARCH_CX ?? '';

type SearchStatus = 'idle' | 'searching' | 'error';

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
// LONGHAND borders (D8): the retry variant below overrides borderColor —
// a border-shorthand + borderColor-override mix logs a React 19 dev-mode
// console error, which would break the verifiers' zero-console-error gate.
const buttonStyle = {
  background: 'rgba(0, 132, 255, 0.12)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'rgba(0, 132, 255, 0.5)',
  borderRadius: 4,
  color: '#0084ff',
  fontFamily: 'Consolas, "Courier New", monospace',
  fontSize: 9,
  padding: '2px 6px',
  cursor: 'pointer',
} as const;
const disabledButtonStyle = {
  ...buttonStyle,
  color: '#8f9bb3',
  borderColor: 'rgba(143, 155, 179, 0.4)',
  cursor: 'default',
} as const;
const cardStyle = {
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(0, 132, 255, 0.4)',
  borderRadius: 4,
  padding: '2px 4px',
  marginBottom: 2,
  cursor: 'pointer',
} as const;
const linkStyle = {
  color: '#0084ff',
  textDecoration: 'underline',
  fontSize: 10,
  wordBreak: 'break-word',
} as const;
const domainStyle = { color: '#8f9bb3', fontSize: 9 } as const;
const snippetStyle = {
  color: '#e6e9f2',
  fontSize: 9,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;
const detailStyle = {
  color: '#8f9bb3',
  fontSize: 9,
  borderTop: '1px dashed rgba(0, 132, 255, 0.5)',
  marginTop: 2,
  paddingTop: 2,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

/**
 * Web Search app (M10): Google Custom Search with a demo-mode state
 * machine (D5), result cards whose titles are REAL <a target="_blank"
 * rel="noopener noreferrer"> links (D8 — the link stopPropagation's so
 * following it never toggles the card; the card BODY toggles inline
 * expansion: full snippet + raw link, D8), inline retryable errors, and
 * NO persistence (D7 — a search is a query, not a document: state only,
 * so StrictMode's double mount is trivially safe and the ONLY effect is
 * the unmount cleanup, which clears the demo timer and aborts any
 * in-flight fetch). Zero console output in every state (errors render
 * inline, never logged).
 */
export function Search({ windowId }: AppProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [demoMode, setDemoMode] = useState(() =>
    isSearchDemoMode(SEARCH_API_KEY, SEARCH_CX),
  );
  const [errorText, setErrorText] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const demoTimerRef = useRef<number | null>(null);
  // Sticky 401/403 degrade (D5): once credentials are rejected, every
  // later submit in this window goes straight to demo — no repeats.
  const demoFallbackRef = useRef(false);
  const lastQueryRef = useRef('');
  const listRef = useRef<HTMLDivElement | null>(null);

  // Unmount cleanup only (D7: no persistence -> no restore/debounce/flush).
  useEffect(() => {
    return () => {
      if (demoTimerRef.current !== null) window.clearTimeout(demoTimerRef.current);
      demoTimerRef.current = null;
      abortRef.current?.abort(); // clean stop; runSearch resolves [] (D5)
    };
  }, []);

  // Auto scroll-to-bottom on result growth (D8).
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [results]);

  /** Demo path (D5/D6): canned results after the simulated latency. */
  const runDemoSearch = (): void => {
    setStatus('searching');
    demoTimerRef.current = window.setTimeout(() => {
      demoTimerRef.current = null;
      setResults(DEMO_SEARCH_RESULTS);
      setHasSearched(true);
      setStatus('idle');
    }, DEMO_SEARCH_DELAY_MS);
  };

  /** Live query. */
  const runLiveSearch = async (q: string): Promise<void> => {
    setStatus('searching');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const found = await runSearch({
        apiKey: SEARCH_API_KEY,
        cx: SEARCH_CX,
        query: q,
        signal: controller.signal,
      });
      setResults(found);
      setHasSearched(true);
      setStatus('idle');
    } catch (error) {
      if (error instanceof SearchError && error.kind === 'invalid_key') {
        // D5 sticky degrade: banner on + canned results for THIS query.
        demoFallbackRef.current = true;
        setDemoMode(true);
        runDemoSearch();
        return;
      }
      // 429/network/other: inline retryable error (D5); stale results go.
      setResults([]);
      setErrorText(error instanceof Error ? error.message : String(error));
      setStatus('error');
    } finally {
      abortRef.current = null;
    }
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const q = query.trim();
    if (!q || status === 'searching') return;
    lastQueryRef.current = q;
    setQuery('');
    setErrorText('');
    setExpandedIndex(null);
    if (demoMode || demoFallbackRef.current) {
      runDemoSearch();
    } else {
      void runLiveSearch(q);
    }
  };

  /** Retry = re-run LIVE for the same last query (D5): a 429 may have
   *  passed; rejected credentials degrade on the next failure. */
  const handleRetry = (): void => {
    if (status === 'searching') return;
    setErrorText('');
    if (demoFallbackRef.current) runDemoSearch();
    else void runLiveSearch(lastQueryRef.current);
  };

  const busy = status === 'searching';
  const submitDisabled = busy || query.trim() === '';
  const bannerReason = !isSearchDemoMode(SEARCH_API_KEY, SEARCH_CX)
    ? 'credentials rejected'
    : 'no API key or search engine ID';

  return (
    <div style={{ fontSize: 10, lineHeight: 1.4 }} data-testid="search-app-root">
      {demoMode && (
        <div
          data-testid="search-demo-banner"
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
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
        <input
          data-testid="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the web…"
          spellCheck={false}
          style={inputStyle}
        />
        <button
          type="submit"
          data-testid="search-submit"
          disabled={submitDisabled}
          style={submitDisabled ? disabledButtonStyle : buttonStyle}
        >
          Search
        </button>
      </form>
      {status === 'error' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'center' }}>
          <span
            data-testid="search-error"
            style={{ color: '#ffd7d7', fontSize: 9, flex: 1, minWidth: 0 }}
          >
            {errorText}
          </span>
          <button
            type="button"
            data-testid="search-retry"
            onClick={handleRetry}
            style={{
              ...buttonStyle,
              borderColor: '#ff5a5a',
              color: '#ffd7d7',
            }}
          >
            Retry
          </button>
        </div>
      )}
      <div
        ref={listRef}
        data-testid="search-results"
        style={{
          height: 44,
          overflowY: 'auto',
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(0, 132, 255, 0.25)',
          borderRadius: 4,
          padding: '2px 4px',
        }}
      >
        {busy && (
          <div data-testid="search-status" style={{ color: '#8f9bb3', fontSize: 9 }}>
            Searching…
          </div>
        )}
        {results.map((result, index) => (
          <div
            key={`${result.link}-${index}`}
            data-testid="search-card"
            onClick={() =>
              setExpandedIndex((current) => (current === index ? null : index))
            }
            style={cardStyle}
          >
            <a
              data-testid="search-card-link"
              href={result.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              style={linkStyle}
            >
              {result.title}
            </a>
            <div data-testid="search-card-domain" style={domainStyle}>
              {result.displayLink}
            </div>
            <div data-testid="search-card-snippet" style={snippetStyle}>
              {truncateSnippet(result.snippet)}
            </div>
            {expandedIndex === index && (
              <div data-testid="search-card-detail" style={detailStyle}>
                {result.snippet}
                {'\n'}
                {result.link}
              </div>
            )}
          </div>
        ))}
        {hasSearched && results.length === 0 && !busy && status !== 'error' && (
          <div data-testid="search-empty" style={{ color: '#8f9bb3', fontSize: 9 }}>
            No results found.
          </div>
        )}
      </div>
    </div>
  );
}
```

Notes: the `windowId` destructure keeps the AppProps contract explicit (it is unused in the body — that is fine, it is a destructured prop, not a local; if `noUnusedParameters` complains, bind it as `function Search({ windowId }: AppProps)` — it does NOT complain for destructured object properties, verified by Chat.tsx compiling). Every declared style constant is used. Enter submits natively (single-line input inside a form). The `<a>` stopPropagation means v10's native click ON THE CARD toggles, and a user click on the TITLE follows the link without toggling.

## 5. Work item C — registration + Dashboard edit

**C1 — `apps/frontend/src/components/apps/index.ts`:** add to the imports

```ts
import { Search } from './Search';
```

and after the chat registration (registration order = launcher order, D10):

```ts
register({ id: 'search', title: 'Web Search', Component: Search });
```

Update the module docblock: search registers here too (M10); the registry itself still has zero M10 changes.

**C2 — `apps/frontend/src/components/apps/Dashboard.tsx`, THREE deletions + one docblock amend:**

1. DELETE the disabled search button (lines 106–108):

```tsx
        <button type="button" disabled data-testid="launcher-entry-search" style={disabledButtonStyle}>
          Search — M10
        </button>
```

2. DELETE the now-unused `disabledButtonStyle` constant (lines 42–47) — `noUnusedLocals` FAILS the build otherwise (the guardrails trap):

```tsx
const disabledButtonStyle = {
  ...buttonStyle,
  color: '#8f9bb3',
  borderColor: 'rgba(143, 155, 179, 0.4)',
  cursor: 'default',
} as const;
```

3. Docblock line 56: `Search renders as a DISABLED entry (M10); Chat is a registered app since M9.` → `Chat (M9) and Search (M10) are registered apps — no placeholder launcher entries remain.`

`listApps()` now yields search automatically → an ENABLED `launcher-open-search` button appears (opens `search-2` via the existing cascade; D9 notes its rect is fully on screen).

## 6. Work item D — bootScene amendments (sanctioned)

**D1 edit — `apps/frontend/src/utils/bootScene.ts`:**

- `SPAWN_POSITIONS` gains (after chat):

```ts
  search: new THREE.Vector3(-1.9, -0.85, 0.1),
```

- `BOOT_APP_IDS` → `['dashboard', 'notes', 'chat', 'search']` (`BOOT_WINDOW_COUNT` stays `BOOT_APP_IDS.length` — now 4, v10's pin).
- `BOOT_WINDOW_COUNT` comment: "…v9 pins exactly this (D14 tier 1)." → "…v10 pins exactly this (D14 tier 1)."
- Docblock D2 table + rects paragraph: add the search row `search-1 ( -1.9, -0.85, 0.1) depth 4.9 max |ndc| 0.3158` and the D9 numbers: update the "every |ndc| <= 0.2833" phrase to "<= 0.3158 (search-1 @16:10; still far below the 0.9 gate)"; extend the rects sentence with Search ~(358.1, 445.5)–(517.7, 535.3) — bottom-left quadrant, 40.0 px clear of Chat, 82.7 px below Dashboard, 214.7 px clear of Notes, fully on screen with 264.7 px bottom margin; distinct lefts (min gap 15.6 px) / tops (min gap 20.7 px) / depths 4.6 / 4.75 / 4.8 / 4.9 pairwise distinct; the all-apps cascade worst stays 0.3988 (notes-4 @16:10; search's worst cascade is 0.3856, search-4); keep the accepted-cascade note and add: search cascades stay clear of all boot windows through instance 4 (search-2 rect (384.7, 466.8)–(544.3, 556.6), 13.4 px clear of Chat); "v9 additionally asserts…" → "v10 additionally asserts full viewport containment for the boot quad".

**D2 edit — `apps/frontend/src/utils/bootScene.test.ts` (3 tests, amended IN PLACE — no new its):**

1. Test 1 positions list: add `getSpawnPosition('search', 1)` and `getSpawnPosition('search', 2)` / `(3)` / `(4)` (comment: search cascades worst |ndc| 0.3856 (search-4, y); the all-apps worst stays 0.3988, notes-4 @16:10).
2. Test 2: `expect(BOOT_APP_IDS).toEqual(['dashboard', 'notes', 'chat', 'search']);` and `expect(BOOT_WINDOW_COUNT).toBe(4);` — restructure the pairwise-distinct block to loop over ALL SIX boot pairs at BOTH aspects (dash/notes, dash/chat, dash/search, notes/chat, notes/search, chat/search: distinct tuples, xs, ys); depths: pin `searchDepth.toFixed(6)` to `'4.900000'` (with 4.6 / 4.75 / 4.8, the four are pairwise distinct; `new Set([...]).size === 4`).
3. Test 3: UNCHANGED (clone/cascade/clamp/default semantics are app-agnostic).

## 7. Work item E — `apps/frontend/src/App.tsx` edits (enumerated; NOTHING else changes)

**E1 — HUD title (line 90):** `JARVIS · Milestone 9` → `JARVIS · Milestone 10`.

**E2 — the comment block (lines 85–89)** → exactly:

```tsx
        {/* HUD title bumps per milestone (now "JARVIS · Milestone 10").
            verify_milestone10.py owns the exact pin (introspection finder +
            check e); every older verifier uses the version-tolerant
            'JARVIS · Milestone' lookup (v9's exact pin was made tolerant
            in the M10 lockstep — D14 two-tier policy). */}
```

**E3 — App component docblock:** append one short paragraph after the M9 one (lines 192–196): "M10 (Phase 3 close): the Web Search app registers through the same registry ('search', Google Custom Search client in the node-pure utils/search.ts, D2) and joins the boot scene in the margin-verified bottom-left (D9) — four apps, BOOT_WINDOW_COUNT derived = 4. Phase 3 is complete."

**E4 — NOTHING else.** The boot loop, `openApp`, counters, `renderAppContent`, and the console line at 367 are generic/derived. `grep -n "Milestone 9" apps/frontend/src/App.tsx` after your edits → zero hits.

## 8. Work item F — tests (test-guard ALL of these)

### 8.A CREATE `apps/frontend/src/utils/search.test.ts` (21 its, node env)

Shared fixtures at the top (mirror gemini.test.ts's `fetchLike` idiom — Response-likes are duck-typed: ok/status/json):

```ts
import { describe, expect, it } from 'vitest';
import {
  buildSearchUrl,
  DEMO_SEARCH_RESULTS,
  isSearchDemoMode,
  mapSearchItems,
  runSearch,
  SearchError,
  SEARCH_ERROR_KINDS,
  SEARCH_RESULT_COUNT,
  truncateSnippet,
} from './search';

/** Injected fetch returning a Response-like (ok/status/json). */
function fetchLike(response: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
}): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

const OK_ITEMS = {
  items: [
    {
      title: 'Result A',
      link: 'https://example.com/a',
      snippet: 'Snippet A',
      displayLink: 'example.com',
    },
    { title: 'Result B', link: 'https://example.com/b' },
  ],
};
```

Enumerated its (exact order and names):

1. `buildSearchUrl is exact: base + encoded key + cx + num=SEARCH_RESULT_COUNT + encoded q` — full string for `('test-key', 'test-cx', 'hello world')` → `https://www.googleapis.com/customsearch/v1?key=test-key&cx=test-cx&num=5&q=hello%20world`; also pin `SEARCH_RESULT_COUNT === 5`.
2. `buildSearchUrl percent-encodes query special chars (spaces, &, =, unicode)` — `'a&b=c ü'` → `q=a%26b%3Dc%20%C3%BC`.
3. `buildSearchUrl encodes key and cx, and num overrides` — key `'k&1'` → `key=k%261`; cx `'c=x'` → `cx=c%3Dx`; `num=10` renders `num=10`.
4. `mapSearchItems maps full items to SearchResult` — OK_ITEMS.items[0] maps field-for-field.
5. `mapSearchItems missing fields become empty strings` — OK_ITEMS.items[1] → `{ title: 'Result B', link: 'https://example.com/b', snippet: '', displayLink: '' }`; an item that is `null` maps to all-empty strings.
6. `mapSearchItems with items absent OR non-array returns []` — `{}` → `[]`; `{ items: 'nope' }` → `[]`; `{ items: [] }` → `[]`.
7. `isSearchDemoMode true when the key is missing (cx present)`.
8. `isSearchDemoMode true when cx is missing (key present)`.
9. `isSearchDemoMode true for undefined/null/whitespace-only credentials` (`''`, `'   '`, `'\t'`, `undefined`, `null` across both args).
10. `isSearchDemoMode false when both credentials are present`.
11. `runSearch with no key throws SearchError no_key and never fetches` (spy wrapper counts calls).
12. `runSearch with no cx throws SearchError no_key and never fetches`.
13. `runSearch HTTP 401 -> SearchError kind 'invalid_key'` (`fetchLike({ ok: false, status: 401 })`).
14. `runSearch HTTP 403 -> kind 'invalid_key'`.
15. `runSearch HTTP 429 -> kind 'rate_limit'`.
16. `runSearch HTTP 500 -> kind 'other'`.
17. `runSearch fetch rejection (TypeError) -> kind 'network'` — `fetchImpl` = `(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch`.
18. `runSearch OK with items resolves the mapped results` — `fetchLike({ ok: true, status: 200, json: async () => OK_ITEMS })` → length 2, fields mapped.
19. `runSearch OK without items resolves [] (valid zero results, no throw)` — `json: async () => ({ searchInformation: {} })`.
20. `runSearch OK with unparseable JSON -> kind 'other'` — `json: async () => { throw new SyntaxError('bad'); }`.
21. `DEMO_SEARCH_RESULTS: exactly 5 well-formed canned results` — length `SEARCH_RESULT_COUNT`; every field a non-empty string; every `link` starts with `'https://'`; every title + snippet contains `'demo result'`; every snippet length > 80 (the truncation toggle is visible). Same it also pins `truncateSnippet` both branches: `truncateSnippet('short') === 'short'` and `truncateSnippet('x'.repeat(100))` has length 81 ending with `'…'`.
22. `runSearch abort resolves [] and never rejects` — fetchImpl returns a promise that rejects on `signal` abort (the gemini.test.ts test-22 idiom):

```ts
const fetchNever = ((_url: unknown, init?: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError')),
    );
  })) as unknown as typeof fetch;
const ac = new AbortController();
const promise = runSearch({
  apiKey: 'k',
  cx: 'c',
  query: 'q',
  signal: ac.signal,
  fetchImpl: fetchNever,
});
ac.abort();
await expect(promise).resolves.toEqual([]);
```

Count check: that is 22 its as enumerated — MERGE its 13+14 into ONE it (`runSearch HTTP 401/403 -> kind 'invalid_key'`, loop `for (const status of [401, 403])`) to land on exactly **21**. Final order: 1–12 as listed, 13 = 401/403 combined, 14 = 429, 15 = 500, 16 = network, 17 = OK-with-items, 18 = OK-without-items, 19 = unparseable, 20 = canned shape + truncateSnippet, 21 = abort. **21 its.**

### 8.B Expected total

226 + 21 (search) = **247**; bootScene stays 3 (amended). Per-file after M10: logger 13, windowManager 26, gestures 39, interactionEngine 49, animation 31, cameraRig 14, bootScene 3, appRegistry 10, storage 7, chat 12, gemini 22, search 21. Every OTHER existing test file stays byte-identical. Report the exact vitest summary; reconcile any mismatch BEFORE proceeding.

## 9. Work item G — CREATE `docs/scripts/verify_milestone10.py`

Copy `verify_milestone9.py` as the structural template VERBATIM where possible (fake-webcam Chromium flags, 1280×800 viewport, console/pageerror/request listeners, `PERF_LINE_PATTERN` verbatim, `fully_on_screen`, `error_snapshot`, summary JSON, `OVERALL: PASS/FAIL`, mid-flight console persistence, `main()` + `if __name__` guard, the native-form-submit driver with its explanatory comment). Evidence files: `m10-scene.png`, `m10-full.png`, `m10-search.png`, `m10-reload.png`, `m10-console.txt`, `m10-summary.json` in `docs/screenshots/`. NOTE: v10 KEEPS v9's reload step even though search has NO persistence (D7) — the reload re-proves the deterministic 4-window boot, supplies the second cleanup pair for check n's `2–4` band, and the post-reload single live track for check o (keeping those checks verbatim-identical to v9); there is NO localStorage probe (nothing persists).

**RUNS WITHOUT SEARCH CREDENTIALS** (guardrails): v10 asserts the demo path; ensure NO `VITE_GOOGLE_SEARCH_*` values are set for the dev server it drives (a live key also present in `.env.local` is fine for the GEMINI vars only — but the SAFEST pre-flight is an empty `.env.local`; v10 only reads the search window).

**Introspection (extend the v9 shape):**

- HUD finder: `includes('JARVIS · Milestone 10')` (v10 owns the exact pin — D12 tier 1; comment says so).
- Search-1 scoped reads (mirror `chat1Sel`): `search1: { banner: {present, text}, input: {present, disabled, value}, submit: {present, disabled}, cards: count of [data-testid="search-card"], status: {present, text} (search-status row), empty: {present} (search-empty row), linkAttrs: [...document.querySelectorAll('[data-window-id="search-1"] [data-testid="search-card-link"]')].map((el) => ({ href: el.getAttribute('href'), target: el.getAttribute('target'), rel: el.getAttribute('rel'), text: el.innerText })) }`.
- Launcher probe: `openDashboard` / `openNotes` / `openChat` / `openSearch` (`launcher-open-search` MUST be present and NOT disabled — D10) + `entryButtons` enumeration of `[data-testid^="launcher-entry-"]` (MUST be empty — zero disabled placeholder entries remain; v10 pins what v8/v9 gave up).
- Keep v9's per-window reads (notes1Value, dashRows, chat1 block, reset button, viewport, videoMeta, floatingWindows). The chat1 block stays — chat remains a boot window and its banner/input presence is cheap honest evidence (do NOT re-assert chat flows; that stays v9's job).

**Procedure (in order):**

1. Navigate (`domcontentloaded`), `wait_for_timeout(14000)` (same budget). Screenshots `m10-scene.png` + `m10-full.png`; introspection #1 (expect: 4 windows, search-1 idle — banner present, input present + empty, submit present + disabled, 0 cards).
2. **Launcher search probe (check f):** snapshot errors; click `[data-window-id="dashboard-1"] [data-testid="launcher-open-search"]`; `wait_for_timeout(1000)`; read search-2 state (own input + banner, 0 cards, fully on screen — independent window state); zero NEW console/page errors. Then CLOSE search-2 via `[data-window-id="search-2"] button[aria-label="Close Web Search"]` (the unmount/abort parity — no persistence to flush, D7; zero errors after is the evidence); `wait_for_timeout(600)`.
3. **Empty-query guard (check h part 1):** `page.fill('[data-window-id="search-1"] [data-testid="search-input"]', '   ')` (spaces only); dispatch the native submit event on `[data-window-id="search-1"] form` (the v9 driver verbatim); `wait_for_timeout(600)`; assert 0 cards (the trimmed-empty guard) and the input still holds the spaces (no state change).
4. **Demo search flow (checks g/h/i/j):** `page.fill(... 'jarvis gesture interface')`; dispatch the native submit; `wait_for_timeout(150)` → introspect ONCE: `submit.disabled === true` OR `search-status` present (the 400 ms searching window, D5 — deterministic timeouts; record both readings in the summary as `searching_observed`); then poll (≤ 5 s, 250 ms steps) until `cards === 5`; `wait_for_timeout(300)` settle; screenshot `m10-search.png`; introspection #2 (cards 5, submit re-enabled, input empty).
5. **Card + link assertions (checks i/j):** every card's text contains `demo result`; every `linkAttrs` entry: `href` starts with `'https://'`, `target === '_blank'`, `rel` contains `'noopener'` (getAttribute — the link is NEVER followed; no navigation).
6. **Expansion toggle (check k):** dispatch a native bubbling click on the FIRST `[data-window-id="search-1"] [data-testid="search-card"]`:

```python
page.evaluate(
    """() => {
      const card = document.querySelector(
        '[data-window-id="search-1"] [data-testid="search-card"]');
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }"""
)
```

   → assert a `[data-testid="search-card-detail"]` exists INSIDE that card and its text is LONGER than the card's `search-card-snippet` text and contains the raw `https://` link; dispatch the same click again → assert the detail is GONE.
7. **Reload (checks n/o + boot re-proof):** `page.reload(wait_until="domcontentloaded")`; `wait_for_timeout(14000)`; introspection #3 → exactly 4 windows again with the same id set (recorded in the summary as `post_reload`), search-1 idle (0 cards — D7: nothing persisted), 1 live video track; screenshot `m10-reload.png`.
8. Summary + `m10-console.txt` + `m10-summary.json`; print `=== CHECKS ===` + `OVERALL`.

**Checks (all must PASS; keys exactly as written; contiguous a–q, 17 checks):**

- `a: zero console errors and zero page errors (whole session)` — the search app logs NOTHING in any state.
- `b: boot scene exact: 4 app windows, ids exactly dashboard-1 + notes-1 + chat-1 + search-1, all fully on screen, boot console line says 4` — `len(windows1) == 4`, id set equality, all `fully_on_screen`, AND any console line contains `[App] app scene ready: 4 app windows created` (the DERIVED line, D11 — the exact pin lives only here).
- `c: boot titles visible: Dashboard, Notes, LLM Chat, and Web Search in window text`.
- `d: pairwise-distinct projected positions at boot (tuples, lefts, tops)` — v9's logic over the FOUR boot windows (lefts 373.7/732.3/557.7/358.1, tops 267.2/424.8/353.7/445.5 all distinct — the projection is deterministic).
- `e: HUD shows exact M10 title, Camera active, MediaPipe ready, Windows = 4 at boot` — `'JARVIS · Milestone 10' in hud` + Camera/active/MediaPipe/ready rows + `int(windows_row.group(1)) == 4` (v10 owns the exact title + count pins — D12 tier 1).
- `f: launcher: launcher-open-search present and ENABLED; zero disabled placeholder entries; open-search adds search-2 fully on screen with independent state (own input + banner, no cards); closing it is error-free; zero new errors`.
- `g: demo mode: search-demo-banner present with text containing 'DEMO MODE' (no credentials on the default path)`.
- `h: query flow: search-input + native submit work; whitespace-only submit is a no-op (zero cards); submit disabled while searching or empty`.
- `i: canned results: 5 search-card rows render within the 5 s budget, each containing the 'demo result' marker`.
- `j: link affordance: every search-card-link has href starting https://, target=_blank, rel containing noopener (attributes only — never followed)`.
- `k: card expansion: native click toggles search-card-detail on (fuller snippet + raw link) and off`.
- `l: >= 1 [Performance] line, every line matching the M4 four-key format` (v9 check m verbatim).
- `m: latency >= 2 lines, min avg in 150-260ms, < 300ms` (v9 check n verbatim).
- `n: cleanup counts balanced across the session (CameraCapture == HandTracker, 2-4 each with the reload)` (v9 check o verbatim — v10 reloads, so the band holds as in v9).
- `o: exactly 1 live video track (post-reload introspection)` (v9 check p verbatim).
- `p: max logged FPS >= 30 (boot window)` (v9 check q verbatim).
- `q: no gesture log lines (no hands on fake webcam)` (v9 check r verbatim).

Make the docstring's lettered list match exactly. Docstring honest notes: (1) the default path runs WITHOUT search credentials — demo mode is what v10 browser-proves; live Custom Search is unit-verified with injected fetch, and at most ONE manual live call (screenshot evidence, NOT part of this script) happens outside it; (2) the fake webcam produces no hands, so gesture interactions with the search window remain unit-evidenced; only the mouse/keyboard-driven flow (launcher, typing, native submit, native card click, chrome close) is browser-proven; (3) links are asserted by attribute and NEVER followed (no navigation, no popups beyond the app's own target=_blank affordance which this script does not exercise); (4) voice search is out of M10 scope (vision §3.4 — keyboard only).

## 10. Work item H — verifier lockstep (hash-disciplined, enumerated)

BEFORE any edit: `sha256sum docs/scripts/verify_milestone*.py`, paste the table (section 1 has the pre-M10 digests — they MUST match your run exactly; a mismatch means the baseline drifted: STOP and report).

**v1–v7: ZERO edits.** Their HUD lookups are all the tolerant `includes('JARVIS · Milestone')` (v1 has none) and their boot checks are already `>= 2` tier-2. Re-verify and paste: `grep -n "JARVIS · Milestone" docs/scripts/verify_milestone*.py` (tolerant lookups everywhere except v9's two pins and, after you create it, v10's) and `grep -n "Milestone 9" docs/scripts/verify_milestone*.py` (hits ONLY in v9's docstring history wording, which stays true — v9's docstring items b/e/f are being rewritten anyway; any remaining "Milestone 9" mentions inside v9's DEVIATION/history notes stay as-is: they describe M9 history).

**v8 `verify_milestone8.py` — THREE edits, NOTHING else changes:**

1. **Launcher probe (line 145).** DELETE the line `search: launcherEntry('launcher-entry-search'),` (the testid disappears with the Dashboard edit; keep `openDashboard`, `openNotes`). The `launcherEntry` helper stays (used by the two probes).

2. **Check i (lines 582–589).** Drop the two `search` clauses (they would KeyError on the deleted probe key); new key. Before:

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

   After:

```python
        "i: launcher: open-notes click adds notes-2 fully on screen; zero new errors": (
            launcher_probe["pre"]["openDashboard"]["present"]
            and launcher_probe["pre"]["openNotes"]["present"]
            and launcher_probe["notes2_on_screen"]
            and launcher_probe["errors_before"] == launcher_probe["errors_after"]
        ),
```

3. **Docstring item i (lines 19–20).** Before: `i) launcher: search entry disabled; open-notes click adds notes-2` / `fully on screen; zero new errors (chat enablement is v9's pin)`. After:

```python
  i) launcher: open-notes click adds notes-2 fully on screen; zero new
     errors (chat/search enablement is v9/v10's pin)
```

Everything else in v8 already survives four boot windows UNCHANGED — verify by reading, do not touch: check b (`>= 2` + subset + ALL-on-screen — the 4th window MUST be fully on screen per D9), check d (distinctness recomputes over 4 windows — D9 guarantees it), check e (tolerant `>= 2`), check m (`>= 2`; notes-1/notes-2 clauses carry the semantics).

**v9 `verify_milestone9.py` — the enumerated tier-2 downgrades (NOTHING else changes).** All line numbers re-verified against the live file 2026-08-16.

1. **Docstring item b (lines 8–10).** Before: `b) boot scene exact: 3 app windows, ids exactly dashboard-1 + notes-1 +` / `chat-1, all fully on screen, boot console line says 3 (the DERIVED` / `line, D12 — pinned only here, tier 1)`. After:

```python
  b) boot scene invariant (tier 2 since M10): >= 3 app windows, ids
     include dashboard-1 + notes-1 + chat-1, all boot windows fully on
     screen, boot console line present (the exact set/count/rendered
     line is pinned only by the current-milestone verifier, v10)
```

2. **Docstring item e (lines 13–14).** Before: `e) HUD shows exact M9 title, Camera active, MediaPipe ready, Windows = 3` / `at boot (v9 owns the exact title + count pins — D14 tier 1)`. After:

```python
  e) HUD title present (version-tolerant since M10), Camera active,
     MediaPipe ready, Windows row >= 3 (exact pins live in v10 since M10)
```

3. **Docstring item f (lines 15–18).** Before: `f) launcher: launcher-open-chat present and ENABLED; search still` / `disabled; no disabled 'Chat' entry anywhere in the Dashboard` / `launcher; open-chat adds chat-2 fully on screen with independent` / `state (own input + banner, empty history); zero new errors`. After:

```python
  f) launcher: launcher-open-chat present and ENABLED; open-chat adds
     chat-2 fully on screen with independent state (own input + banner,
     empty history); zero new errors (the search entry's enablement is
     v10's pin since M10)
```

   Docstring items k (lines 27–28) and l (lines 29–31) SURVIVE UNCHANGED (they never name exact window ids/counts) — verified; do not touch them.

4. **Introspection HUD finder (lines 126–129).** Before:

```python
          // v9 owns the CURRENT title, so this verifier pins the exact
          // string (D14 tier 1); older verifiers are tolerant.
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone 9'));
```

   After:

```python
          // Version-tolerant since M10 (the title moved to Milestone 10);
          // the current-milestone verifier v10 owns the exact pin (D14).
          const hud = allDivs.find(
            (el) => el.innerText && el.innerText.includes('JARVIS · Milestone'));
```

5. **Launcher probe (line 196).** DELETE the line `search: launcherEntry('launcher-entry-search'),` (keep `openDashboard`, `openNotes`, `openChat`). The `entryButtons` JS enumeration (lines 199–204) STAYS — it is evidence-only introspection (it will yield `[]` and the summary JSON records that honestly); only its Python assertion goes (edit 7).

6. **Boot-line filter (line 466).** Before:

```python
            boot_line_hits = [
                l for l in console_lines
                if "[App] app scene ready: 3 app windows created" in l
            ]
```

   After (tolerant — the line now prints 4; v10 pins the exact rendered text):

```python
            # Tolerant since M10 (the count moved to 4): assert the boot
            # line EXISTS; the exact rendered text is pinned only by v10.
            boot_line_hits = [
                l for l in console_lines
                if "[App] app scene ready:" in l and "app windows created" in l
            ]
```

7. **`entry_buttons`/`entry_ok` block (lines 679–684).** DELETE the whole block (both the local and the flag — the local would be unused):

```python
    entry_buttons = launcher_probe["pre"]["entryButtons"]
    entry_ok = (
        len(entry_buttons) == 1
        and entry_buttons[0]["testid"] == "launcher-entry-search"
        and entry_buttons[0]["disabled"]
    )
```

8. **Check b (lines 690–695).** Before:

```python
        "b: boot scene exact: 3 app windows, ids exactly dashboard-1 + notes-1 + chat-1, all fully on screen, boot console line says 3": (
            len(windows1) == 3
            and window_ids1 == {"dashboard-1", "notes-1", "chat-1"}
            and len(windows1_on_screen) == 3
            and summary["boot_line_hits"] >= 1
        ),
```

   After:

```python
        "b: boot scene invariant: >= 3 app windows incl. dashboard-1 + notes-1 + chat-1, all fully on screen, boot line present": (
            len(windows1) >= 3
            and {"dashboard-1", "notes-1", "chat-1"} <= window_ids1
            and len(windows1_on_screen) == len(windows1)
            and summary["boot_line_hits"] >= 1
        ),
```

9. **Check e (lines 702–710).** New key + two assertion changes: `"JARVIS · Milestone 9" in hud` → `"JARVIS · Milestone" in hud`; `and int(windows_row.group(1)) == 3` → `and int(windows_row.group(1)) >= 3`:

```python
        "e: HUD title present, Camera active, MediaPipe ready, Windows row >= 3": (
            "JARVIS · Milestone" in hud
            and "Camera" in hud
            and "active" in hud
            and "MediaPipe" in hud
            and "ready" in hud
            and windows_row is not None
            and int(windows_row.group(1)) >= 3
        ),
```

10. **Check f (lines 711–727).** Drop the `search` clauses (lines 716–717) AND the `entry_ok` clause (line 718) — both would KeyError/NameError; keep every chat clause. After:

```python
        "f: launcher: launcher-open-chat present and ENABLED; open-chat adds chat-2 fully on screen with independent state; zero new errors": (
            launcher_probe["pre"]["openDashboard"]["present"]
            and launcher_probe["pre"]["openNotes"]["present"]
            and launcher_probe["pre"]["openChat"]["present"]
            and launcher_probe["pre"]["openChat"]["disabled"] is False
            and launcher_probe["chat2_on_screen"]
            and launcher_probe["chat2"]["inputPresent"]
            and launcher_probe["chat2"]["inputEmpty"]
            and launcher_probe["chat2"]["bannerPresent"]
            and "DEMO MODE" in (launcher_probe["chat2"]["bannerText"] or "")
            and launcher_probe["chat2"]["userMsgs"] == 0
            and launcher_probe["chat2"]["assistantMsgs"] == 0
            and launcher_probe["errors_before"] == launcher_probe["errors_after"]
        ),
```

11. **Check k reload trio (lines 646–651).** Before:

```python
    post_reload_ids = sorted(post_reload["window_ids"])
    chat_restored_after_reload = (
        post_reload_ids == ["chat-1", "dashboard-1", "notes-1"]
        and chat1_after_reload["userMsgs"] >= 1
        and "Hello JARVIS" in (chat1_after_reload["firstUserText"] or "")
    )
```

   After (subset invariant — four windows reload, the M9 trio must all be there with chat-1 restored):

```python
    post_reload_ids = sorted(post_reload["window_ids"])
    chat_restored_after_reload = (
        {"chat-1", "dashboard-1", "notes-1"} <= set(post_reload_ids)
        and chat1_after_reload["userMsgs"] >= 1
        and "Hello JARVIS" in (chat1_after_reload["firstUserText"] or "")
    )
```

12. **Check l (line 751 key + line 756 assertion).** Key: drop the "(2 windows remain)" clause → `l: mid-debounce chrome close removes chat-1 AND the unmount flush saved the history (stored chat-1's last user message is the marker); zero new errors`. Assertion: `and len(windows_after_close) == 2` → `and len(windows_after_close) >= 2` (4 boot windows minus closed chat-1 = 3; the `dashboard_after_close == 1` / `notes_after_close == 1` clauses at lines 754–755 stay).

13. **Checks that survive UNTOUCHED — verify by reading, do not edit:** c (titles), d (distinctness — recomputes over the 4 boot windows; D9 guarantees distinct lefts/tops), g–j (chat demo flows — chat-1 is still a boot window), m–r (perf/latency/cleanup/track/FPS/gestures).

AFTER the edits: re-run `sha256sum` (v1–v7 byte-identical — paste digests; v8 + v9 changed — record old→new; v10 new). Then run ALL TEN verifiers against the dev server in order 1→10 — every one must print `OVERALL: PASS`. Also paste the expected-grep-state evidence:

- `grep -n "JARVIS · Milestone 9" docs/scripts/*.py` → ZERO hits (v9's two pins made tolerant; no docstring carries the literal).
- `grep -n "launcher-entry-search" docs/scripts/*.py` → ZERO hits (v8 line 145, v9 lines 196 + 682 all deleted).
- `grep -rn "app windows created" docs/scripts/` → hits ONLY in v9 (the tolerant filter) and v10 (the exact "4 app windows created" pin).
- `grep -rn "import.meta.env" apps/frontend/src` → exactly TWO hits (Chat.tsx, Search.tsx).
- `grep -n "Milestone 9" apps/frontend/src/App.tsx` → ZERO hits.

## 11. Work item I — README.md M10 section + Phase 3 close-out (docs-guard)

**I1 — the sanctioned line-5 fix.** Replace the stale status paragraph (line 5, "**Milestone 7 status: Phase 2 COMPLETE.** … 174 unit tests green; real app content is Phase 3.") with a close-out blurb of the same shape: "**Milestone 10 status: Phase 3 COMPLETE.** The app-window framework runs four real apps — Dashboard, Notes, LLM Chat (Gemini), and Web Search (Google Custom Search) — as gesture-manipulable 3D windows on top of the full M1–M6 tracking/gesture stack. 247 unit tests + ten verifiers green; the backend API proxy is Phase 4. See the Milestone 10 section for the full demo script." (wording yours; the facts are pinned). Note in the M10 section that this fix was sanctioned (the blurb had been stale since M8; a close-out milestone is the right moment — D15).

**I2 — append the M10 section after the M9 section (end of file), mirroring the M9 structure:**

```
## Milestone 10 — Web Search app: Google Custom Search client, demo mode, 4th boot window (Phase 3 COMPLETE)
```

Then:

- **Phase 3 COMPLETE marker** — the window app framework + all four apps (Dashboard, Notes, LLM Chat, Web Search) are in; M1–M9 remain green (247 unit tests, ten verifiers).
- **What was built** — one bullet per artifact: `utils/search.ts` (SEARCH_RESULT_COUNT D1, buildSearchUrl with all-params encoded, mapSearchItems with the zero-results/''-tolerance semantics D4, isSearchDemoMode D5, truncateSnippet + DEMO_SEARCH_RESULTS D6/D8, runSearch with injectable fetch + AbortSignal resolving [] on abort, SearchError kinds D3), `components/apps/Search.tsx` (query form, searching state, result cards with real `<a target="_blank" rel="noopener noreferrer">` titles + card-body inline expansion D8, demo banner, inline error + Retry, sticky 401/403 degrade, NO persistence D7), the registration + Dashboard search-button removal (launcher auto-enables; zero placeholder entries remain), bootScene search-1 + the D9 margin row + amended tests, the App HUD bump, tests (+21 → 247; per-file counts), `verify_milestone10.py` (demo-mode interactive search flow: empty-query guard, canned cards, link attributes, expansion toggle, launcher search-2 spawn/close), verifier lockstep (v8 + v9 tier-2 downgrades; v1–v7 zero edits; hash table).
- **Enabling the real API (env)** — TWO user-supplied values, both documented: (1) a Google Cloud API key with the **Custom Search API enabled** (Google Cloud Console → APIs & Services → Credentials); (2) a **Programmable Search Engine ID** (`cx`) from https://cse.google.com (create an engine, enable "Search the entire web" — site-restricted engines return tiny result sets). Create/extend `apps/frontend/.env.local`:

```
VITE_GEMINI_API_KEY=<optional, M9>
VITE_GOOGLE_SEARCH_API_KEY=<key>
VITE_GOOGLE_SEARCH_CX=<cx>
```

  then restart `npm run dev:frontend` (Vite reads env at startup). Without either search value the app runs in demo mode by design. Result count: swap `SEARCH_RESULT_COUNT` in `apps/frontend/src/utils/search.ts` (one line). Ignore-file status: unchanged since M9 (root `.gitignore` + `apps/frontend/.gitignore` already cover `.env.local`).
- **SECURITY NOTE** — frontend credentials are visible in browser devtools; acceptable for local Phase 3 use; Phase 4 moves calls behind the backend APIRouter proxy with rate limiting (spec §3.3).
- **Demo mode** — the D5 matrix digested (either credential missing → banner + canned results after ~400 ms; 401/403 → sticky degrade with the banner switch; 429/network → inline error + live Retry; searching disables Search while the input stays editable; unmount clears the timer and aborts the fetch).
- **Demo script — full Phase 3 experience (REWRITTEN, supersedes the M7-era gesture-only script)** — a numbered hands-on script: (1) boot — four windows (Dashboard upper-left, Chat center, Notes lower-right, Web Search lower-left), HUD shows Milestone 10 / Windows 4; (2) open MORE apps from the Dashboard launcher (`+ Notes`, `+ LLM Chat`, `+ Web Search` — each cascades a new independent window); (3) gesture-manipulate EACH window — grab & move (pinch/fist), resize (squeeze/loosen while pinching), release with momentum, two-hand twist rotate, hover-highlight, swipe pan, two-hand pinch zoom, Reset view; (4) chat WITHOUT a key (demo banner, canned reply types out) and WITH a key (real Gemini streaming); (5) search WITHOUT credentials (demo banner, five canned cards, click a card to expand, click a title to open the real page in a new tab) and WITH credentials (live results); (6) persistence — Notes and Chat survive reload; Search does not (by design, D7). Note explicitly: the M7 section's gesture script remains as history; THIS is the current script.
- **How to run** — `npm run test`; `npm run dev:frontend`; `python docs/scripts/verify_milestone10.py` (no credentials needed); all ten verifiers in order.
- **Deviations & decisions digest (D1–D16)** — MUST include: the empty spec sketch + React-FC continuation, query-param auth vs the x-goog-api-key header (D1/D16), SearchError parallel class (D3), zero-results-is-valid (D4), the demo matrix + 400 ms timing (D5), canned results (D6), no-persistence rationale (D7), the open-affordance shape + truncation (D8), the search boot position + numbers + "all-apps cascade worst stays 0.3988" (D9), registration order (D10), tier-1 duty move v9 → v10 AND v8+v9 both downgrading (D12), keyboard-only query (voice deferred, D16), no pagination, and the sanctioned line-5 README fix (D15).
- **Evidence** — `docs/screenshots/m10-scene.png`, `m10-full.png`, `m10-search.png`, `m10-reload.png`, `m10-console.txt`, `m10-summary.json`; verifier hash table (v1–v7 identical, v8/v9 old→new, v10 new); the four zero/expected-hit greps of section 10.
- **Milestone 10 acceptance (mapped honestly)** — automated items checked (client unit-pinned incl. URL encoding/error mapping/zero-results/abort; boot scene unit-pinned incl. four-way distinctness + depth 4.9; demo flow browser-pinned by v10; 247 tests + build + ten verifiers; zero console errors); manual/unchecked items listed explicitly: live Custom Search with real credentials (at most one manual call — not in v10), real-webcam gesture interaction with the search window, visual fit at the frozen window scale.

## 12. Do-not-touch list

`utils/appRegistry.ts` + test, `utils/storage.ts` + test, `utils/windowManager.ts` + test, `utils/interactionEngine.ts` + test, `utils/gestures.ts` + test, `utils/animation.ts` + test, `utils/logger.ts` + test, `utils/cameraRig.ts` + test, `utils/gemini.ts` + `gemini.test.ts`, `utils/chat.ts` + `chat.test.ts`, `components/FloatingWindow.tsx`, `components/Scene3D.tsx`, `components/GestureDebug.tsx`, `components/HandTracker.tsx`, `components/CameraCapture.tsx`, `components/ErrorBanner.tsx`, `components/apps/Chat.tsx`, `components/apps/Notes.tsx`, `components/apps/UnknownApp.tsx`, `src/main.tsx`, `src/index.css`, `src/types/*`, `index.html`, `apps/backend/**`, `packages/shared/**`, `docs/scripts/verify_milestone1.py` … `verify_milestone7.py` (hash-identical), every existing verifier line NOT enumerated in section 10 (including v8's and v9's), all npm configs/dependencies, both `.gitignore` files, `docs/briefs/**`, every README line outside the appended M10 section and the sanctioned line-5 fix. App.tsx beyond sections E1–E3. Do NOT start Phase 4 (no backend proxy, no APIRouter, no rate limiting).

## 13. Implementation order (small batches, verify each)

1. `utils/search.ts` + `search.test.ts` → `npm run test` green (247 = 226 + 21) + `npm run build` + lint clean.
2. `bootScene.ts` + `bootScene.test.ts` amendments → green (247 unchanged) + build.
3. `components/apps/Search.tsx` + `index.ts` registration + Dashboard deletions + App.tsx E1–E3 → build + lint green.
4. Dev-server eyeball WITHOUT search credentials: 4 boot windows (Dashboard upper-left, Notes lower-right, Chat center, Search lower-left), HUD `JARVIS · Milestone 10` / Windows 4, search banner visible, whitespace submit is a no-op, a query yields five demo cards after ~400 ms, card click expands/collapses, title is a real link (hover shows the URL; do not need to follow), launcher `+ Web Search` opens an independent `search-2`, zero console output/errors, reload keeps 4 windows (chat history restores; search state does not — D7).
5. `verify_milestone10.py` → `OVERALL: PASS` (iterate until every check passes).
6. Verifier lockstep (section 10; hashes before/after) → ALL TEN verifiers `OVERALL: PASS` (v9 re-run in its NO-key configuration; if a Gemini key lives in `.env.local`, remove it for the v9/v10 runs and restore afterwards).
7. README M10 + Phase 3 close-out (docs-guard) + final evidence pass (section 14). Optional last: the ONE live search call (only if real credentials exist), screenshot evidence, then REMOVE the credentials again and re-confirm v10 passes without them.

## 14. Evidence to paste in your report

1. `npm run test` — the summary block (expected 247 passed; per-file counts: search 21, bootScene 3 amended, all ten original suites unchanged).
2. `npm run build` — the three-workspace success tail; `npm run lint --workspace @jarvis/frontend` — clean.
3. `grep -rn "app windows created" docs/scripts/` — BEFORE your lockstep edits (one hit, v9 line 466) and AFTER (hits only in v9's tolerant filter + v10's exact pin).
4. `sha256sum docs/scripts/verify_milestone*.py` — BEFORE and AFTER tables; v1–v7 identical (call it out), v8 + v9 old→new, v10 new.
5. All TEN verifier runs — each one's `=== CHECKS ===` block + `OVERALL: PASS` line (v9 AND v10 in the NO-credentials configuration).
6. The section-10 expected-grep-state block: `JARVIS · Milestone 9` → zero; `launcher-entry-search` → zero; `import.meta.env` → exactly Chat.tsx + Search.tsx; `Milestone 9` in App.tsx → zero.
7. `ls docs/screenshots | grep m10` — the six m10-* evidence files.
8. Skill evidence: test-guard / clean-code-guard / docs-guard check lines for the files they covered (frontend-design followed for the Search UI; the verifier follows the v9 webapp-testing pattern).
9. Any deviation from this brief, with the reason (deviations are acceptable if documented; silent scope drift is not).

---

# Overseer review checklist (1:1 with the M10 acceptance criteria)

For each item: verify with the cited evidence, not the Coder's summary. FAIL = send back to the Coder with the finding.

**Search client (unit — 8.A)**
- [ ] `utils/search.ts` is node-pure: NO `import.meta`, NO React import (grep). `SEARCH_RESULT_COUNT === 5`; URL is `GET https://www.googleapis.com/customsearch/v1?key=…&cx=…&num=…&q=…` with EVERY param percent-encoded (tests 1–3: spaces/`&`/`=`/unicode, key/cx encoded, num override).
- [ ] Mapping: full items (4); missing fields → `''` incl. null items (5); `items` absent/non-array → `[]` — zero-results is a VALID 200, never an error (6, 19).
- [ ] Error mapping: no key OR no cx → `no_key` with fetch never called (11–12), 401/403 → `invalid_key` (13), 429 → `rate_limit` (14), 500 → `other` (15), TypeError → `network` (16), OK-unparseable → `other` (20); `SearchError` has `kind`, const-object kinds, NO enum, parallel to (not shared with) ChatError (read the file).
- [ ] Abort resolves `[]`, never rejects (21). Injectable `fetchImpl` + `AbortSignal`; zero new npm deps (diff package.jsons).
- [ ] Canned results: exactly 5, all-fields-non-empty, https links, 'demo result' markers, snippets > 80 chars; `truncateSnippet` both branches (20).

**Search app (browser — v10 checks f–k + code read)**
- [ ] Testids exact: `search-input`, `search-submit`, `search-demo-banner`, `search-card`, `search-card-link`, `search-card-domain`, `search-card-snippet`, `search-card-detail`, `search-error`, `search-retry`, `search-empty`, `search-status`; Enter submits; Search disabled while busy/empty (v10 h); auto-scroll; M8/M9 9–11 px styling; longhand-border discipline on every spread-with-override style (code read — the React 19 console-error trap).
- [ ] Open affordance (D8): the TITLE is the `<a target="_blank" rel="noopener noreferrer">` with stopPropagation; the CARD BODY toggles expansion; expanded = full snippet + raw link; collapsed = 80-char truncation (v10 j/k).
- [ ] Demo matrix (D5): either credential missing → banner from mount + canned results, never an error (v10 g/i); 401/403 degrade is STICKY per window with banner switch (code read — `demoFallbackRef`); 429/network/other → inline error + Retry that re-runs LIVE (code read — `handleRetry`); demo delay 400 ms single-shot.
- [ ] No persistence (D7): grep the component for storage imports → zero; the only effect is unmount cleanup (abort + clear timer); reload leaves search state empty by design.
- [ ] `import.meta.env` read ONLY in Search.tsx for the two vars (grep, exactly two files total with Chat.tsx); security note in Search.tsx/search.ts docblocks AND the README.

**Boot scene + wiring (browser + unit)**
- [ ] `BOOT_APP_IDS = ['dashboard', 'notes', 'chat', 'search']`; search at `(-1.9, -0.85, 0.1)`; `BOOT_WINDOW_COUNT` DERIVED = 4; boot console line untouched and prints "4 app windows created" (v10 b); bootScene tests amended in place (3 tests: six-pair pairwise distinct, depth 4.900000 pinned).
- [ ] D9 docblock updated (search row, rect (358.1, 445.5)–(517.7, 535.3), gaps 40.0/82.7/214.7 px, boot |ndc| bound 0.3158, all-apps cascade worst still 0.3988, search-cascade-clear note, v10 containment mention).
- [ ] index.ts registers search AFTER chat; Dashboard search button AND `disabledButtonStyle` deleted (build proves it); `launcher-open-search` enabled (v10 f); zero disabled placeholder entries anywhere (v10 f); HUD exactly `JARVIS · Milestone 10` with the rewritten comment (v10 e).

**Tests + build**
- [ ] 247 vitest green = 226 + 21; ONLY the new search.test.ts + the amended bootScene.test.ts (diff the file list); build passes all three workspaces; lint clean; TS constraints honored (no enums, `import type`, no unused locals).
- [ ] test-guard / clean-code-guard / docs-guard evidence lines present.

**Verifier lockstep (exactness matters — re-grep yourself)**
- [ ] v1–v7 sha256 IDENTICAL before/after (all seven digests match section 1's table).
- [ ] v8 changed ONLY in the three enumerated spots; v9 changed ONLY in the twelve enumerated spots (re-read the diff regions; v9's checks c/d/g–j/m–r untouched).
- [ ] Expected grep state: `JARVIS · Milestone 9` → zero; `launcher-entry-search` → zero; `app windows created` → only v9 (tolerant) + v10 (exact); `Milestone 9` in App.tsx → zero.
- [ ] All TEN verifiers `OVERALL: PASS`; v10 checks a–q all PASS in the NO-credentials configuration; the six m10-* evidence files exist.
- [ ] Latency band 150–260 ms; FPS ≥ 30; cleanup balanced; 1 live track; zero console/page errors; perf lines all match the M4 regex; HUD exactly `JARVIS · Milestone 10` + Windows = 4 (v10 e).

**README close-out (docs-guard)**
- [ ] M10 section complete: Phase 3 COMPLETE marker, both-values env guide with the Custom Search API + cse.google.com cx instructions, security note, demo-mode digest, the REWRITTEN full demo script (all four apps, gesture-manipulation, chat/search with and without credentials, persistence expectations), how to run, D1–D16 digest incl. the sanctioned line-5 fix, evidence, honest acceptance mapping.
- [ ] Line 5 now reads Milestone 10 / Phase 3 COMPLETE; NO other pre-M10 README line changed (diff outside the appended section + line 5).

**Constraints**
- [ ] NO backend proxy / APIRouter / rate limiting (Phase 4 untouched), NO voice search, NO pagination, NO popups beyond the `<a target=_blank>` (never followed by any verifier), NO new npm dependencies, NO changes to appRegistry/storage/windowManager/interactionEngine/gestures/gemini/chat/FloatingWindow (hash/spot-check), NO new console output (search logs nothing — v10 a with the whole flow exercised), single cleanup pairs, Phase 4 not started.
