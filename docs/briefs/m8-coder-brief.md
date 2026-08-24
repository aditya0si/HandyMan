# JARVIS Milestone 8 — Coder Brief (Phase 3 part 1: window app framework, Dashboard + Notes apps, local persistence)

You are the Coder for JARVIS Milestone 8 in `C:\Users\oliad\Desktop\visionpro` (Windows / Git Bash; npm workspaces root; NOT a git repo). This brief is complete and self-contained. Implement EXACTLY this scope: a React-function-component app registry (AppContext + AppBus + unknown-app fallback), a tiny typed JSON storage util, a boot-scene module replacing demoScene, the Dashboard and Notes apps (+ UnknownApp fallback), App wiring (registry lookups, `openApp`, `maximize`, HUD bump), unit tests (appRegistry + storage + bootScene; demoScene pair deleted), `verify_milestone8.py` (M7 pattern PLUS interactive Playwright steps), the verifier lockstep (v3/v4/v5/v6/v7), and the README M8 section. NO Chat/Search functionality (M9/M10 — disabled launcher entries only), NO backend/shared-package changes, NO new gestures, NO engine or window-physics changes (`interactionEngine.ts` and `windowManager.ts` are frozen — M8 needs ZERO changes in either), NO external APIs / fetch / API keys, NO new npm dependencies. When something is unspecified, follow the existing M1–M7 code conventions (they are deliberate) and document deviations the way M2–M7 did (docblock "DEVIATION"/decision notes).

## 0. Guardrails (read first)

- Run everything from the repo ROOT: `npm run test`, `npm run build`, `npm run dev:frontend`, `npm run lint --workspace @jarvis/frontend`. Python verifiers run as `python docs/scripts/verify_milestoneN.py [base_url]` against the dev server on http://localhost:5173 (start it in the background).
- TS constraints (tsconfig.app.json, verified): `erasableSyntaxOnly` (NO `enum`), `verbatimModuleSyntax` (type-only imports MUST use `import type`), `noUnusedLocals` + `noUnusedParameters` (they compile tests too), `noFallthroughCasesInSwitch`, `jsx: react-jsx`. There is NO vitest config file — vitest runs in its default node environment; keep it that way (no jsdom, no new deps).
- Quality skills are mandatory: `test-guard` on all test changes, `clean-code-guard` on all new/changed production code, `docs-guard` on the README changes, and follow the `frontend-design` intent for the app components by matching the existing HUD/window-chrome design language (dark glass panel, `#0084ff` accent, Consolas monospace) — do NOT invent a second visual language. Your report must include the evidence lines those checks produced.
- Console discipline: NO new console output in normal operation. The ONLY existing line you may amend is enumerated in section 7.E6 (`[App] interaction engine ready: 4 windows created` → the new boot line — grep-verified that NO verifier pins it; re-verify with `grep -rn "windows created" docs/scripts/` → zero hits). `utils/storage.ts` may emit `console.warn('[Storage] …')` ONLY in edge cases (corrupt JSON / quota / serialization failure) — never during normal boot or use; verifiers assert zero `[error]` lines, `[warning]` lines are safe but must stay edge-only.
- Baseline (do NOT regress, verified 2026-08-16): **174 vitest tests** (logger 13 + windowManager 26 + gestures 39 + interactionEngine 49 + animation 31 + cameraRig 14 + demoScene 2); build passes all three workspaces; fake-webcam latency min-avg ~200–216 ms (verifier band 150–260); single cleanup pairs; zero console/page errors; grab/drag/resize/rotate/release/hover/pan/zoom suites all green.
- The ONLY existing test files you may touch: DELETE `demoScene.test.ts` (replaced by `bootScene.test.ts`) and DELETE `demoScene.ts` (replaced by `bootScene.ts`). Every other existing test file stays byte-identical. If you find any other failing test, STOP and report it — do not amend unilaterally.

## 1. Codebase facts you will rely on (verified by reading, 2026-08-16)

- `apps/frontend/src/App.tsx` — `WINDOW_CONTENT: Record<string, ReactNode>` (lines ~113–121) hardcodes four demo contents; `handleSceneReady` loops `DEMO_WINDOWS` calling `wm.createWindow(spec.id, spec.title, spec.position)` then logs `'[App] interaction engine ready: 4 windows created'`; windows render `<FloatingWindowView … content={WINDOW_CONTENT[win.id]} … />`; `handleCloseWindow` / `handleMinimizeWindow` / `handleBringToFront` wire the chrome buttons to the manager (close also cancels animations and drops smoother/tracker/highlight state — reuse, do not duplicate); HUD title is `"JARVIS · Milestone 7"` with the lockstep comment; the reset-view button lives in App (`data-testid="reset-view"`); `getWindowProjection` culls at `|ndc| > 1`; the `'rotate'` event branch is an explicit no-op.
- `apps/frontend/src/utils/windowManager.ts` — EVERYTHING M8 needs already exists: `createWindow(id, title, position)` (throws on duplicate id, clones the position), `minimizeWindow` (mesh.visible=false), `restoreWindow`, `closeWindow` (disposes geometry+material), `bringToFront`, `getWindow`, `getAllWindows`, onChange+version. NO M8 CHANGES (do-not-touch).
- `apps/frontend/src/utils/interactionEngine.ts` — M6/M7 semantics; window creation is App-side, so the engine is UNAFFECTED by M8 (frozen; do-not-touch, incl. its 49-test file).
- `apps/frontend/src/components/FloatingWindow.tsx` — already takes `content?: ReactNode` and renders it inside `<div style={{ padding: '4px 10px 6px', fontSize: 12, lineHeight: 1.5 }}>{content}</div>`; chrome buttons use `stopPropagation`; root has `data-testid="floating-window"` + `data-window-id`; minimized = `display: 'none'` on the root (a minimized window's content is unreachable — see D12); close/minimize buttons have `aria-label={`Close ${window.title}`}` / `` `Minimize ${window.title}` ``. BYTE-IDENTICAL in M8 (do-not-touch).
- `apps/frontend/src/utils/demoScene.ts` + `demoScene.test.ts` — the M7 4-window seed + its 2 tests; REPLACED this milestone (sanctioned).
- Verifier pins (grep-verified; current sha256 in section 10): v1 has NO window/title/count pins; v2's HUD lookup is version-tolerant (`includes('JARVIS · Milestone')`) and pins only the 'Gestures' row; v3/v4/v5/v6 HUD lookups are version-tolerant, but each asserts `"4" in hud` (check f/e/e/e) AND `titles_visible` computed from `"Test Window" in … and "Second Window" in …` (check c); v3/v4/v5/v6 check b asserts `>= 2` floating windows (2 boot windows still pass); v4 check l asserts `post_reload_windows_on_screen >= 2` (2 passes, NO edit); v7 pins the EXACT `"JARVIS · Milestone 7"` in its introspection finder + check f, `len(windows) == 4` in checks b and m, and the four M7 titles in check c. NO verifier pins the `[App] interaction engine ready` console line or any window POSITION.
- v4 specifics that interact with M8: its soak samples window RECTS (drift < 1.5 px) and console spam (<= 5 lines/s). The Dashboard's 1 Hz ticker re-renders only Dashboard-internal React state — it moves no window rect and prints no console line (D11 documents why this is safe; v4 is re-run as proof).
- `localStorage` exists only in the browser — node tests need the injectable storage backend (D9). Playwright: a fresh `browser.new_page()` context starts with EMPTY localStorage, and `page.reload()` PRESERVES localStorage (same context) — v8's persistence procedure relies on exactly this (j/k checks; the run itself is the empirical confirmation).
- Registry purity requirement: `utils/appRegistry.ts` must import NO runtime React (Component is stored as a reference; `import type { FC } from 'react'` is erased by `verbatimModuleSyntax`), so node vitest can import it with dummy function components.
- Non-standard browser APIs need typed accessors under the TS DOM lib: `navigator.deviceMemory` and `performance.memory` are NOT in lib.dom — use intersection casts (section 6.D3 exact code).
- `components/apps/` does NOT exist yet; `utils/storage.ts` does NOT exist yet.

## 2. Design decisions (decided by the Orchestrator — implement as specified, document in code)

**D1 — App framework shape: React-function-component registry (DEVIATION from TECHNICAL_SPEC §2.3, documented).** The spec's `abstract class App { abstract render(context: AppContext): React.ReactNode }` becomes `{ id, title, Component }` registered in a module-level registry. Same contract, simpler and idiomatic: each app is a `FC<AppProps>`; the spec's five `AppContext` fields (`windowId, sendMessage, maximize, minimize, close`) are passed as explicit props; the registry (not class inheritance) provides lookup, listing, titles, and the safe fallback. Also typed: `sendMessage(type, payload?)` instead of the spec's `(msg: any)`. Document the deviation in the appRegistry docblock AND the README deviations digest.

**D2 — Boot scene: exactly Dashboard + Notes (2 windows), margin-verified positions.** `BOOT_APP_IDS = ['dashboard', 'notes']`, `BOOT_WINDOW_COUNT = 2` (the deterministic count v8 pins). Positions (camera (0,0,5), fov 75, the M7 NDC-margin discipline — verified at aspect 16:9 AND 16:10):

| app | position | depth | ndc @16:9 (x, y) | ndc @16:10 (x, y) | max abs ndc |
| --- | --- | --- | --- | --- | --- |
| dashboard | `(-1.6, 0.75, 0.4)` | 4.6 | (-0.2550, 0.2125) | (-0.2833, 0.2125) | 0.2833 |
| notes | `(1.6, -0.65, 0.2)` | 4.8 | (0.2444, -0.1765) | (0.2715, -0.1765) | 0.2715 |

At the 1280×800 verifier viewport the projected rects are approximately Dashboard (373.7, 267.2)–(543.7, 362.8) and Notes (732.3, 424.8)–(895.2, 516.4): fully on screen, disjoint from each other, clear of the HUD (top-left, ends ~x300/y200), GestureDebug (top-right, starts ~x1004), and the reset button (top-center ~x590–690). Distinct lefts (373.7 vs 732.3), distinct tops (267.2 vs 424.8), distinct depths (4.6 vs 4.8). Deliberately CLOSER to the camera than the M7 demo (depths 4.6/4.8 vs 5.8–8.0): real app content needs the larger projected area (~170×96 px and ~163×92 px at 1280×800; the M3 window scale constants are frozen). Unit-pinned by `bootScene.test.ts` (section 8.C); browser-pinned by v8 checks b/c/d.

**D3 — Window id scheme: `'<appId>-<n>'` with a per-app, per-scene monotonic counter.** Boot consumes `dashboard-1`, `notes-1`; a launcher-opened Notes is `notes-2`; a second Dashboard is `dashboard-2`. `appIdFromWindowId` splits at the LAST '-' (so future app ids may contain dashes, e.g. `web-search-2` → `web-search`; ids without a dash return unchanged; a leading dash returns the whole string). The counter lives in an App-side ref (`Map<string, number>`), reset per scene in `handleSceneReady` (StrictMode: each scene rebuilds it), and NEVER decreases — closing `notes-1` and reopening yields `notes-2`, so (a) `WindowManager.createWindow`'s duplicate-id throw is unreachable by construction and (b) note storage keys are never reused after a close (no ghost overwrites). No parallel windowId→appId map exists — the id IS the encoding.

**D4 — `openApp` plumbing: explicit props, no React context machinery.** `AppProps = AppContext & { openApp: (appId: string) => void }`; App renders `<Component windowId={…} sendMessage={…} maximize={…} minimize={…} close={…} openApp={openApp} />`. Props are one less moving part than a provider, match FloatingWindow's explicit-callback style, and keep the registry React-free.

**D5 — `sendMessage`: minimal per-scene event bus.** `createAppBus()` returns `{ subscribe(handler): () => void; emit(msg) }`; `AppMessage = { from: windowId; type: string; payload?: unknown }`. Per-window `sendMessage(type, payload?)` emits `{ from: windowId, type, payload }`. `emit` with zero subscribers is a no-op (M8 ships the plumbing only — nothing subscribes yet); documented as the future app-sync channel (spec §2.3's `sendMessage`). A fresh bus instance per scene (StrictMode-safe, dies with the scene). Unit-tested (zero-subscriber no-op, delivery, unsubscribe).

**D6 — Unknown-app fallback: lazy injection, React-free stub.** The registry ships a safe stub `{ id: 'unknown', title: 'Unknown App', Component: () => null }` (a null-returning FC needs no React import — the module stays node-pure). `components/apps/index.ts` calls `setFallbackApp({ id: 'unknown', title: 'Unknown App', Component: UnknownApp })` at module load, upgrading the stub to the message-content fallback (`Unknown app for window "…"`). `getApp` NEVER returns undefined; `getTitle` on an unknown id returns `'Unknown App'`.

**D7 — Registration at module load, `register` throws on duplicates.** `components/apps/index.ts` registers Dashboard + Notes and injects the fallback as an import side effect; App.tsx imports it for the side effect. ESM modules execute once per page load and the registry has no persistence, so duplicate registration cannot occur by construction (no idempotency guard needed; Vite HMR of that module triggers a full page reload in dev). NO reset/clear API (smaller surface) — tests use unique ids per test (section 8.A note).

**D8 — Chat/Search: disabled launcher entries, NOT registered.** The Dashboard launcher lists `listApps()` (registered = clickable) PLUS two hardcoded disabled buttons: `Chat — coming in M9` (`data-testid="launcher-entry-chat"`) and `Search — coming in M10` (`data-testid="launcher-entry-search"`). No placeholder windows, no registry entries — M9/M10 register real apps and the launcher rows appear automatically.

**D9 — `storage.ts`: prefix-owning, backend-injectable, null-safe, warn-only-on-edge.** The module owns the `'jarvis:'` prefix (callers pass logical keys like `'note:notes-1'` → physical key `'jarvis:note:notes-1'`). API: `get<T>(key): T | null`, `set(key, value): boolean`, `remove(key): void`, `setStorageBackend(backend | null)` (tests inject; `null` restores the default `window.localStorage` when available). With NO backend available (node, private browsing): `get` → `null`, `set` → `false`, silently. Edge cases log ONE `console.warn('[Storage] …')` each: corrupt JSON on parse (→ `null`), quota/throw on `setItem` (→ `false`), circular value on `stringify` (→ `false`). Never warns during normal boot/use. Exact code in section 4.

**D10 — Notes mechanics: restore-on-mount, debounced save (500 ms), flush-on-unmount, dirty-gated.** State `text` + refs `textRef` (latest text), `timerRef` (pending debounce id), `dirtyRef` (true only after a USER edit). Restore-on-mount does NOT set dirty — this is the StrictMode-safety key: React 19 StrictMode re-runs effects (mount → cleanup → mount) on the SAME component instance; the inter-effect cleanup flush writes ONLY when dirty, so the simulated remount can never overwrite stored data with the not-yet-restored empty string. Edits set dirty and (re)start the 500 ms timer; the timer save and the unmount flush both clear dirty. Closing the window mid-debounce flushes immediately (proved live by v8 check m). Per-window key `'note:<windowId>'` — two Notes windows can never clobber each other.

**D11 — Dashboard ticker: 1 s `setInterval` with cleanup.** This is a per-app UI timer — NOT a violation of the M4 no-timers discipline (that was specifically about the `[Performance]` summary riding the rAF gate in the perf logger; ordinary React UI effects with cleanup were never forbidden — the M4 brief's own wording). The interval updates a clock string and the JS-heap read once per second; cleanup clears it; zero console output; it re-renders only Dashboard-internal state so v4's rect-drift soak and spam checks are unaffected (re-run v4 as proof).

**D12 — `maximize` = restore-if-minimized + bringToFront (documented interim semantics).** True maximize (fullscreen sizing) is future work; M8's `AppContext.maximize()` = `if (win.isMinimized) restoreWindow(id); bringToFront(id)`. The M3 chrome buttons stay byte-identical. Two consequences, documented: (a) a minimized window is `display:none`, so no in-window control can restore it — a restore affordance (taskbar/dock) is future work; (b) the restore-if-minimized BRANCH cannot be exercised browser-side (the branch's own buttons are hidden while it applies) — v8 proves the visible-window half (error-free + stays visible) and the branch itself is overseer code-review-verified; README acceptance maps this honestly. To make the AppContext contract observable in the browser at all, the Dashboard renders a three-button window-controls strip (`appctl-maximize` / `appctl-minimize` / `appctl-close`) calling the context callbacks — the framework demo for future apps.

**D13 — HUD title → `JARVIS · Milestone 8`.** v8 owns the exact pin (introspection finder + check e). v3–v6 are already tolerant (NO title edits needed there); v7's exact pin is made tolerant in this lockstep (section 10).

**D14 — Verifier future-proof policy (two-tier pinning, introduced M8; document in README + each edited verifier docstring).** Tier 1: the CURRENT milestone's verifier (v8) pins the exact boot truth — exact HUD title, exact boot window id set, exact boot count, exact titles, interactive app behavior. Tier 2: older verifiers (v3–v7) assert only stable boot-scene invariants: (i) `>= 2` floating windows with distinct ids, on screen; (ii) every boot window renders a NON-EMPTY title (the chrome contract — no specific title strings); (iii) the HUD Windows row EXISTS and reports an integer `>= 2` (regex `Windows\s+(\d+)` — no count digit pin). Result: M9/M10 boot-composition changes touch ONLY the new milestone's verifier; v3–v8 stop churning. Honesty preserved: the invariants assert exactly what boots (the floor is a product contract — the system always boots Dashboard + Notes), and the exact count remains pinned — in exactly one place.

**D15 — Boot console line wording.** `'[App] interaction engine ready: 4 windows created'` → `console.log(\`[App] app scene ready: ${BOOT_WINDOW_COUNT} app windows created\`)` (renders as `[App] app scene ready: 2 app windows created`; the template keeps the line truthful if boot composition ever changes). Grep-verified no verifier pins the old text (section 7.E6 requires you to re-verify and paste the grep).

**D16 — Component behavior verified in the BROWSER (Playwright), not jsdom.** No new test deps, vitest stays node-env; typing, launcher clicks, persistence-across-reload, minimize/close are all v8 interactive steps (section 9). Unit tests cover only the pure modules (registry, bus, storage, boot math). Document this split in the README.

## 3. Work item A — CREATE `apps/frontend/src/utils/appRegistry.ts`

```ts
import type { FC } from 'react';

/**
 * M8 app registry (Phase 3 part 1) — DEVIATION from TECHNICAL_SPEC §2.3:
 * the spec's `abstract class App { abstract render(context: AppContext) }`
 * becomes a React-function-component registry ({ id, title, Component }).
 * Same contract, simpler and idiomatic: the five AppContext fields are
 * passed as explicit props, and the registry (not inheritance) provides
 * lookup, listing, titles, and a SAFE FALLBACK for unknown ids. Typed
 * messages replace the spec's `sendMessage(msg: any)`.
 *
 * Purity contract: this module imports NO runtime React (`import type` is
 * erased under verbatimModuleSyntax) — Components are stored BY REFERENCE,
 * so node vitest can exercise the registry with dummy function components.
 * React-side wiring (registrations + fallback upgrade) lives in
 * components/apps/index.ts (D7), which App.tsx imports for its side effect.
 */

/** Spec §2.3 AppContext — the five fields, as explicit props (D4). */
export interface AppContext {
  windowId: string;
  /**
   * Emits a message on the per-scene app bus (D5) — the future app-sync
   * channel. M8 ships the plumbing only: zero subscribers, emit is a no-op.
   */
  sendMessage: (type: string, payload?: unknown) => void;
  /** M8 interim semantics (D12): restore-if-minimized + bring-to-front. */
  maximize: () => void;
  minimize: () => void;
  close: () => void;
}

/** Props every app component receives: AppContext + the app-level
 *  openApp callback (explicit props, no React context machinery — D4). */
export interface AppProps extends AppContext {
  openApp: (appId: string) => void;
}

export type AppComponent = FC<AppProps>;

export interface AppDefinition {
  id: string;
  title: string;
  Component: AppComponent;
}

const apps = new Map<string, AppDefinition>();

/** React-free safe stub (D6): renders nothing; components/apps/index.ts
 *  upgrades it via setFallbackApp at module load. */
const STUB_FALLBACK: AppDefinition = {
  id: 'unknown',
  title: 'Unknown App',
  Component: () => null,
};

let fallbackApp: AppDefinition = STUB_FALLBACK;

/** Injects the unknown-id fallback (keeps this module React-free at
 *  runtime — the real UnknownApp component lives on the React side). */
export function setFallbackApp(app: AppDefinition): void {
  fallbackApp = app;
}

/** Registers an app. Throws on duplicate ids (registration bugs should be
 *  loud; ESM single execution makes re-registration unreachable — D7). */
export function register(app: AppDefinition): void {
  if (apps.has(app.id)) {
    throw new Error(`appRegistry: app "${app.id}" is already registered`);
  }
  apps.set(app.id, app);
}

/** NEVER undefined: unknown ids resolve to the fallback (safe window). */
export function getApp(id: string): AppDefinition {
  return apps.get(id) ?? fallbackApp;
}

/** All registered apps in registration order (Dashboard launcher source).
 *  The fallback is NOT listed — it is not a registered app. */
export function listApps(): readonly AppDefinition[] {
  return Array.from(apps.values());
}

/** Title for an app id; unknown ids get the fallback title. */
export function getTitle(id: string): string {
  return getApp(id).title;
}

/** '<appId>-<n>' → appId (D3): splits at the LAST '-' so app ids may
 *  contain dashes; ids without a dash (or with a leading dash) return
 *  unchanged — unknown apps then resolve via getApp's fallback. */
export function appIdFromWindowId(windowId: string): string {
  const idx = windowId.lastIndexOf('-');
  if (idx <= 0) return windowId;
  return windowId.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Minimal app→app message bus (D5). M8 ships the plumbing only; the future
// sync channel (spec §2.3 sendMessage) rides the same shape.
// ---------------------------------------------------------------------------

export interface AppMessage {
  /** Window id of the sender (auto-filled by the per-window sendMessage). */
  from: string;
  type: string;
  payload?: unknown;
}

export interface AppBus {
  /** Returns the unsubscribe function. */
  subscribe(handler: (msg: AppMessage) => void): () => void;
  /** Delivers to every live subscriber; zero subscribers → no-op. */
  emit(msg: AppMessage): void;
}

export function createAppBus(): AppBus {
  const handlers = new Set<(msg: AppMessage) => void>();
  return {
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    emit(msg) {
      for (const handler of handlers) handler(msg);
    },
  };
}
```

## 4. Work item B — CREATE `apps/frontend/src/utils/storage.ts`

```ts
/**
 * M8: tiny typed JSON storage on localStorage (Notes persistence; the
 * future sync channel will reuse the key scheme). The module OWNS the
 * 'jarvis:' key prefix — callers pass logical keys ('note:notes-1' →
 * physical key 'jarvis:note:notes-1').
 *
 * Backend injection (D9): tests call setStorageBackend(fake); null restores
 * the default (window.localStorage when available). With no backend
 * available, get → null / set → false / remove → no-op, silently — storage
 * is a convenience, never a crash.
 *
 * Edge cases log exactly ONE console.warn('[Storage] …') each (corrupt
 * JSON, quota/throw on setItem, unserializable value) and NEVER fire in
 * normal operation. Verifiers assert zero [error] lines; [warning] is
 * safe but must stay edge-only.
 */

export const STORAGE_KEY_PREFIX = 'jarvis:';

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let injectedBackend: StorageBackend | null = null;

function activeBackend(): StorageBackend | null {
  if (injectedBackend) return injectedBackend;
  return typeof window !== 'undefined' && window.localStorage
    ? window.localStorage
    : null;
}

/** Injects a backend for tests; null restores the default. */
export function setStorageBackend(backend: StorageBackend | null): void {
  injectedBackend = backend;
}

function fullKey(key: string): string {
  return STORAGE_KEY_PREFIX + key;
}

/** Parsed value, or null when the key is missing, storage is unavailable,
 *  or the stored JSON is corrupt (warn once, never throws). */
export function get<T>(key: string): T | null {
  const backend = activeBackend();
  if (!backend) return null;
  const raw = backend.getItem(fullKey(key));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[Storage] corrupt JSON at "${fullKey(key)}" — returning null`);
    return null;
  }
}

/** true on success; false when storage is unavailable, the value cannot be
 *  serialized, or the write is refused (quota) — warns once, never throws. */
export function set(key: string, value: unknown): boolean {
  const backend = activeBackend();
  if (!backend) return false;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    console.warn(`[Storage] serialization failed for "${fullKey(key)}":`, error);
    return false;
  }
  try {
    backend.setItem(fullKey(key), serialized);
    return true;
  } catch (error) {
    console.warn(`[Storage] save failed (quota?) for "${fullKey(key)}":`, error);
    return false;
  }
}

/** Removes a key; missing keys / no backend are silent no-ops. */
export function remove(key: string): void {
  activeBackend()?.removeItem(fullKey(key));
}
```

## 5. Work item C — CREATE `apps/frontend/src/utils/bootScene.ts` (replaces demoScene.ts)

```ts
import * as THREE from 'three';

/**
 * M8 app boot scene + spawn table (replaces the M7 demoScene — sanctioned
 * amendment): windows are now APP windows created through the registry,
 * with ids allocated per app ('<appId>-<n>', D3).
 *
 * D2 margin table (camera (0, 0, 5), fov 75 — the M7 NDC-margin
 * discipline; every |ndc| <= 0.2833 < 0.9 at BOTH aspect 16:9 and 16:10,
 * huge margin against App's |ndc| > 1 off-screen cull). Depths are
 * deliberately closer than the M7 demo so real app content gets a larger
 * projected area (the M3 window scale constants are frozen):
 *
 *   dashboard-1  (-1.6,  0.75, 0.4)  depth 4.6   max |ndc| 0.2833
 *   notes-1      ( 1.6, -0.65, 0.2)  depth 4.8   max |ndc| 0.2715
 *
 * Projected rects at the 1280x800 verifier viewport: Dashboard
 * ~(373.7, 267.2)-(543.7, 362.8), Notes ~(732.3, 424.8)-(895.2, 516.4) —
 * fully on screen, disjoint, clear of the HUD (top-left), GestureDebug
 * (top-right), and the reset button (top-center). Unit-pinned by
 * bootScene.test.ts (incl. cascade instances 2-4, worst |ndc| 0.3988);
 * v8 additionally asserts full viewport containment for the boot pair.
 *
 * Launcher-opened instances cascade by SPAWN_CASCADE_STEP (0.25, -0.2, 0)
 * per instance number so successive windows of one app do not spawn
 * perfectly stacked (margin-verified for instances 1-4; the |ndc| > 1
 * cull remains the backstop beyond that).
 */

/** One margin-verified home position per registered boot app. */
const SPAWN_POSITIONS: Record<string, THREE.Vector3> = {
  dashboard: new THREE.Vector3(-1.6, 0.75, 0.4),
  notes: new THREE.Vector3(1.6, -0.65, 0.2),
};

/** Apps opened at boot, in creation order (the deterministic boot scene). */
export const BOOT_APP_IDS: readonly string[] = ['dashboard', 'notes'];

/** Deterministic boot window count — v8 pins exactly this (D14 tier 1). */
export const BOOT_WINDOW_COUNT: number = BOOT_APP_IDS.length;

/** Per-instance spawn cascade (see module docblock). */
export const SPAWN_CASCADE_STEP: THREE.Vector3 = new THREE.Vector3(0.25, -0.2, 0);

/** Center spawn for apps without a table entry (future apps): |ndc| = 0
 *  at the boot pose, on screen by construction. */
export const DEFAULT_SPAWN_POSITION: THREE.Vector3 = new THREE.Vector3(0, 0, 0.3);

/**
 * Spawn position for instance `instance` (1-based; clamped to >= 1) of an
 * app: the table position (or the default for unknown apps) plus the
 * cascade offset for instances past the first. ALWAYS returns a fresh
 * clone — callers may mutate the result freely.
 */
export function getSpawnPosition(appId: string, instance = 1): THREE.Vector3 {
  const base = SPAWN_POSITIONS[appId] ?? DEFAULT_SPAWN_POSITION;
  const n = Math.max(1, instance);
  if (n === 1) return base.clone();
  return base
    .clone()
    .add(SPAWN_CASCADE_STEP.clone().multiplyScalar(n - 1));
}
```

DELETE `apps/frontend/src/utils/demoScene.ts` and `apps/frontend/src/utils/demoScene.test.ts` in the same batch as creating this module (section 8.D) so the suite never references a dangling import.

## 6. Work item D — CREATE `apps/frontend/src/components/apps/` (4 files)

Shared styling intent (frontend-design discipline): the existing overlay language — dark glass `rgba(10, 14, 39, 0.85+)`, `1px solid rgba(0, 132, 255, 0.5)` borders, `#0084ff` accent, `#8f9bb3` labels, `#00ff88` values, Consolas monospace, tiny fonts (9–11 px) because the projected window is only ~170×96 px at 1280×800. Keep every app compact; the window content area must not depend on hover-scrolling to be legible.

### 6.1 `UnknownApp.tsx`

```tsx
import type { AppProps } from '../../utils/appRegistry';

/** Safe fallback content for windows whose app id is not registered
 *  (D6) — injected via setFallbackApp by components/apps/index.ts. */
export function UnknownApp({ windowId }: AppProps) {
  return (
    <div
      data-testid="unknown-app"
      style={{ color: '#8f9bb3', fontSize: 10, fontStyle: 'italic' }}
    >
      Unknown app for window &quot;{windowId}&quot;.
    </div>
  );
}
```

### 6.2 `Notes.tsx`

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import { get as storageGet, set as storageSet } from '../../utils/storage';

/** Debounced-save window (ms) after the last keystroke (D10). */
const NOTE_SAVE_DEBOUNCE_MS = 500;

/**
 * Notes app (M8): a per-window textarea persisted under
 * 'jarvis:note:<windowId>' via utils/storage (the storage module owns the
 * prefix). Restore on mount; save debounced 500 ms after edits AND on
 * unmount (closing the window mid-debounce flushes — v8 check m proves it
 * live). StrictMode-safe (D10): restore never marks dirty, so the
 * simulated remount's cleanup flush cannot overwrite stored data; state
 * persists across the double effect run (same component instance).
 */
export function Notes({ windowId }: AppProps) {
  const storageKey = `note:${windowId}`;
  const [text, setText] = useState('');
  // Refs mirror the latest text for the async save paths (the same
  // render-time ref-sync pattern FloatingWindow uses for its callbacks).
  const textRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    // Restore once per mount cycle. StrictMode re-runs this effect; the
    // second run reads the same stored value (setText is a no-op then).
    const stored = storageGet<string>(storageKey);
    if (stored !== null) {
      setText(stored);
      textRef.current = stored;
    }
    return () => {
      // Unmount flush: cancel any pending debounce, then save ONLY user
      // edits (dirty). Not dirty → no write (protects stored data across
      // StrictMode's simulated remount and plain re-mounts).
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        storageSet(storageKey, textRef.current);
      }
    };
  }, [storageKey]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setText(value);
    textRef.current = value;
    dirtyRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      dirtyRef.current = false;
      storageSet(storageKey, textRef.current);
    }, NOTE_SAVE_DEBOUNCE_MS);
  };

  return (
    <textarea
      data-testid="notes-textarea"
      value={text}
      onChange={handleChange}
      placeholder="Type notes here — saved locally per window…"
      spellCheck={false}
      style={{
        width: '100%',
        height: 44,
        boxSizing: 'border-box',
        resize: 'none',
        background: 'rgba(0, 0, 0, 0.35)',
        border: '1px solid rgba(0, 132, 255, 0.4)',
        borderRadius: 4,
        color: '#e6e9f2',
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: 10,
        lineHeight: 1.4,
        padding: '3px 5px',
      }}
    />
  );
}
```

### 6.3 `Dashboard.tsx`

Typed accessors first (lib.dom lacks both APIs):

```tsx
/** Non-standard Chrome APIs absent from lib.dom — typed accessors. */
interface PerformanceMemory {
  usedJSHeapSize: number;
}

function readUsedHeapMb(): number | null {
  const perf = performance as Performance & { memory?: PerformanceMemory };
  return perf.memory ? perf.memory.usedJSHeapSize / (1024 * 1024) : null;
}

function readDeviceMemoryGb(): number | undefined {
  return (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
}
```

Component (compact — the projected window is ~170×96 px at 1280×800; two-stat rows keep it to ~6 lines):

```tsx
import { useEffect, useState } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import { listApps } from '../../utils/appRegistry';

function formatClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const labelStyle = { color: '#8f9bb3' } as const;
const valueStyle = { color: '#00ff88', fontWeight: 600 } as const;
const pairStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  whiteSpace: 'nowrap',
} as const;
const buttonStyle = {
  background: 'rgba(0, 132, 255, 0.12)',
  border: '1px solid rgba(0, 132, 255, 0.5)',
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

/**
 * Dashboard app (M8): LOCAL-ONLY system stats + a 1 s live ticker + the
 * app launcher. NO external APIs, no fetch, no keys — everything comes
 * from navigator/performance. The ticker is an ordinary per-app UI effect
 * with cleanup (D11) — NOT the M4 perf-logger no-timers discipline.
 * The window-controls strip demonstrates the AppContext contract live
 * (D12): maximize = restore-if-minimized + focus (interim semantics).
 * Chat/Search render as DISABLED entries, not registered apps (D8).
 */
export function Dashboard({ maximize, minimize, close, openApp }: AppProps) {
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [heapMb, setHeapMb] = useState<number | null>(() => readUsedHeapMb());

  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(formatClock(new Date()));
      setHeapMb(readUsedHeapMb());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const memoryGb = readDeviceMemoryGb();

  return (
    <div style={{ fontSize: 10, lineHeight: 1.5 }}>
      <div data-testid="dash-clock" style={{ ...pairStyle, color: '#0084ff', fontWeight: 700 }}>
        <span style={labelStyle}>TIME</span>
        <span>{clock}</span>
      </div>
      <div data-testid="dash-cpu" style={pairStyle}>
        <span style={labelStyle}>CPU</span>
        <span style={valueStyle}>{navigator.hardwareConcurrency ?? '—'} cores</span>
      </div>
      <div data-testid="dash-memory" style={pairStyle}>
        <span style={labelStyle}>MEM</span>
        <span style={valueStyle}>{memoryGb !== undefined ? `${memoryGb} GB` : '—'}</span>
      </div>
      <div data-testid="dash-heap" style={pairStyle}>
        <span style={labelStyle}>HEAP</span>
        <span style={valueStyle}>{heapMb !== null ? `${heapMb.toFixed(1)} MB` : '—'}</span>
      </div>
      <div data-testid="dash-network" style={pairStyle}>
        <span style={labelStyle}>NET</span>
        <span style={valueStyle}>{navigator.onLine ? 'online' : 'offline'}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
        {listApps().map((app) => (
          <button
            key={app.id}
            type="button"
            data-testid={`launcher-open-${app.id}`}
            onClick={() => openApp(app.id)}
            style={buttonStyle}
          >
            + {app.title}
          </button>
        ))}
        <button type="button" disabled data-testid="launcher-entry-chat" style={disabledButtonStyle}>
          Chat — M9
        </button>
        <button type="button" disabled data-testid="launcher-entry-search" style={disabledButtonStyle}>
          Search — M10
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button type="button" data-testid="appctl-maximize" onClick={maximize} style={buttonStyle}>
          Max
        </button>
        <button type="button" data-testid="appctl-minimize" onClick={minimize} style={buttonStyle}>
          Min
        </button>
        <button type="button" data-testid="appctl-close" onClick={close} style={buttonStyle}>
          Close
        </button>
      </div>
    </div>
  );
}
```

### 6.4 `index.ts` (registration side effect)

```ts
import { register, setFallbackApp } from '../../utils/appRegistry';
import { Dashboard } from './Dashboard';
import { Notes } from './Notes';
import { UnknownApp } from './UnknownApp';

/**
 * App registrations (D7): executed once per page load (ESM single
 * execution, no registry persistence) — register() throws on duplicate
 * ids, so partial re-registration is unreachable by construction.
 * App.tsx imports this module for its side effect; the registry itself
 * stays React-free (node-testable).
 */
register({ id: 'dashboard', title: 'Dashboard', Component: Dashboard });
register({ id: 'notes', title: 'Notes', Component: Notes });
setFallbackApp({ id: 'unknown', title: 'Unknown App', Component: UnknownApp });
```

## 7. Work item E — `apps/frontend/src/App.tsx` changes (enumerated)

**E1 — imports.** Remove `import { DEMO_WINDOWS } from './utils/demoScene';` (line ~12). Add:

```ts
import { BOOT_APP_IDS, BOOT_WINDOW_COUNT, getSpawnPosition } from './utils/bootScene';
import { appIdFromWindowId, createAppBus, getApp, getTitle } from './utils/appRegistry';
import type { AppBus } from './utils/appRegistry';
import './components/apps';
```

(`import type { ReactNode } from 'react';` stays — `renderAppContent` uses it.)

**E2 — delete `WINDOW_CONTENT`** (the const + its docblock, lines ~113–121) — replaced by registry lookups.

**E3 — new per-scene refs** (next to `cameraRigRef` etc.):

```ts
  // M8 app-framework state (fresh per scene — StrictMode pattern): the
  // app message bus (D5) and the per-app window instance counters (D3,
  // monotonic; ids are never reused within a scene, even after closes).
  const appBusRef = useRef<AppBus | null>(null);
  const windowCountersRef = useRef<Map<string, number>>(new Map());
```

**E4 — new callbacks.** Insert AFTER `syncWindowsThrottled` and BEFORE `applyHighlight`/`handleSceneReady` (source order matters — `handleSceneReady` closes over `nextInstance`):

```ts
  /** Allocates the next 1-based instance number for an app (D3). */
  const nextInstance = useCallback((appId: string): number => {
    const next = (windowCountersRef.current.get(appId) ?? 0) + 1;
    windowCountersRef.current.set(appId, next);
    return next;
  }, []);

  /**
   * M8: opens a new app window (any app can call this via AppProps —
   * the Dashboard launcher is the first consumer). Window id is
   * '<appId>-<n>' (D3); the title comes from the registry; the position
   * from the margin-verified spawn table with the per-instance cascade
   * (D2). Unknown app ids resolve to the safe fallback definition —
   * unreachable from the launcher (it lists registered apps only).
   */
  const openApp = useCallback(
    (appId: string) => {
      const wm = windowManagerRef.current;
      if (!wm) return;
      const instance = nextInstance(appId);
      wm.createWindow(
        `${appId}-${instance}`,
        getTitle(appId),
        getSpawnPosition(appId, instance),
      );
      syncWindows();
    },
    [nextInstance, syncWindows],
  );

  /**
   * M8 (D12): AppContext.maximize — interim semantics: restore the window
   * if minimized, then bring it to front. True maximize (fullscreen
   * sizing) is future work; the M3 chrome buttons are unchanged.
   */
  const handleMaximizeWindow = useCallback(
    (id: string) => {
      const wm = windowManagerRef.current;
      if (!wm) return;
      if (wm.getWindow(id)?.isMinimized) wm.restoreWindow(id);
      wm.bringToFront(id);
      syncWindows();
    },
    [syncWindows],
  );
```

**E5 — `handleSceneReady`:** reset the two new refs next to the other per-scene resets (`appBusRef.current = createAppBus(); windowCountersRef.current = new Map();`) and replace the DEMO_WINDOWS loop + console line (~lines 296–303) with:

```ts
      // M8: the app boot scene — Dashboard + Notes app windows. Ids are
      // allocated per app ('<appId>-<n>', D3); titles come from the
      // registry; positions from the margin-verified spawn table (D2).
      for (const appId of BOOT_APP_IDS) {
        const instance = nextInstance(appId);
        wm.createWindow(
          `${appId}-${instance}`,
          getTitle(appId),
          getSpawnPosition(appId, instance),
        );
      }
      console.log(`[App] app scene ready: ${BOOT_WINDOW_COUNT} app windows created`);
```

Add `nextInstance` to the `handleSceneReady` dependency array (it is stable, but the array should list it).

**E6 — console-line amendment proof (D15).** Before editing, run `grep -rn "windows created" docs/scripts/` and paste the output (expected: ZERO hits — only App.tsx contains the old line; the Orchestrator verified this on 2026-08-16). This is the ONLY sanctioned console-text amendment.

**E7 — `renderAppContent` helper** (define after `handleBringToFront`, before `getWindowProjection` or anywhere before the return):

```tsx
  /**
   * M8: renders a window's app content through the AppRegistry. The
   * window id encodes the app id ('<appId>-<n>', D3); unknown apps
   * resolve to the safe fallback. AppContext (spec §2.3 five fields)
   * plus openApp are EXPLICIT props (D4); sendMessage rides the
   * per-scene app bus (D5). Called per window during render — app
   * state lives inside each Component, so re-renders are safe.
   */
  const renderAppContent = (windowId: string): ReactNode => {
    const AppComponent = getApp(appIdFromWindowId(windowId)).Component;
    return (
      <AppComponent
        windowId={windowId}
        sendMessage={(type, payload) =>
          appBusRef.current?.emit({ from: windowId, type, payload })
        }
        maximize={() => handleMaximizeWindow(windowId)}
        minimize={() => handleMinimizeWindow(windowId)}
        close={() => handleCloseWindow(windowId)}
        openApp={openApp}
      />
    );
  };
```

**E8 — window render:** `content={WINDOW_CONTENT[win.id]}` → `content={renderAppContent(win.id)}` in the `windows.map`.

**E9 — HUD title:** `JARVIS · Milestone 7` → `JARVIS · Milestone 8`; update the adjacent comment block to: v8 owns the exact pin; v3–v6 were already tolerant; v7 was made tolerant in the M8 lockstep; older verifiers no longer pin the boot count (D14).

**E10 — App docblock:** add a short "M8 (Phase 3 part 1)" paragraph: app windows through the registry (D1–D5), boot scene Dashboard + Notes (D2), openApp/maximize wiring (D4/D12), window ids encode app ids (D3), demo windows 1–4 retired.

## 8. Work item F — tests (test-guard ALL of these)

### 8.A CREATE `apps/frontend/src/utils/appRegistry.test.ts` (10 its, node env)

Top-of-file note: the registry is module-global and append-only (no reset API, D7) — every `it` uses UNIQUE app ids; `beforeEach` re-injects a fresh dummy fallback. Dummy components are plain functions (`() => null` typed `AppComponent`) — NO React import.

1. `register + getApp return the exact definition (Component by reference)` — register `{ id: 'a-1', title: 'A', Component: dummyA }`; `getApp('a-1')` strict-equals the definition object and `getApp('a-1').Component === dummyA`.
2. `listApps preserves registration order` — register two more ids; `listApps().map((a) => a.id)` contains them in insertion order; length grows accordingly.
3. `getTitle returns the title for registered ids` — exact string.
4. `getApp on an unknown id returns the injected fallback` — after `setFallbackApp({ id: 'unknown', title: 'Unknown App', Component: dummyFallback })`, `getApp('nope')` returns THAT definition (Component by reference); `getTitle('nope') === 'Unknown App'`.
5. `register throws on duplicate id and does not overwrite` — registering an existing id throws (assert the message names the id); `getApp` still returns the FIRST definition.
6. `appIdFromWindowId truth table` — `'dashboard-1'` → `'dashboard'`; `'notes-12'` → `'notes'`; `'web-search-2'` → `'web-search'` (dash inside appId); `'notes-1-2'` → `'notes-1'` (LAST dash); `'dashboard'` → `'dashboard'`; `'-1'` → `'-1'`.
7. `bus: subscribe + emit delivers the exact message` — subscribe, `emit({ from: 'notes-1', type: 'hello', payload: 7 })`, handler received the same object/fields.
8. `bus: unsubscribe stops delivery for that handler only` — two subscribers; unsubscribe the first; emit → only the second received it.
9. `bus: emit with zero subscribers is a no-op` — `expect(() => bus.emit({ from: 'x', type: 't' })).not.toThrow()` on a fresh bus.
10. `bus: two subscribers both receive one emit` — both called exactly once.

### 8.B CREATE `apps/frontend/src/utils/storage.test.ts` (7 its, node env)

Fake backends (top of file):

```ts
class MemoryBackend implements StorageBackend {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class QuotaBackend extends MemoryBackend {
  setItem(): void {
    throw new Error('QuotaExceededError');
  }
}
```

`beforeEach`: `setStorageBackend(new MemoryBackend())`; `afterEach`: `setStorageBackend(null)`. Warn assertions use `vi.spyOn(console, 'warn').mockImplementation(() => {})` + `mockRestore` in `afterEach`.

1. `round-trip: set then get returns the value; physical key carries the prefix` — `set('note:notes-1', { text: 'hello' })` → `get<{ text: string }>('note:notes-1')` deep-equals `{ text: 'hello' }`; also a plain string round-trip; assert the backend map contains the key `'jarvis:note:notes-1'`.
2. `missing key → null, no warn` — `get('never-set')` is `null`; the warn spy was NOT called.
3. `corrupt JSON → null + exactly one warn` — plant `map.set('jarvis:note:bad', '{not json')`; `get('note:bad')` → `null`; spy called exactly once with a message containing `[Storage]`.
4. `quota error on setItem → false + exactly one warn; nothing written` — inject `QuotaBackend`; `set('note:q', 'x')` → `false`; spy called once.
5. `prefix isolation + two-window key independence` — `set('note:notes-1', 'A')` and `set('note:notes-2', 'B')` → `get('note:notes-1') === 'A'` AND `get('note:notes-2') === 'B'` (the unit-level two-Notes independence pin, exact production key shape); a foreign key planted directly (`map.set('other:x', '"raw"')`) is invisible to `get('x')` (→ `null`).
6. `remove: clears the value; missing key is a silent no-op` — set → `remove` → `get` → `null`; `remove('never-set')` does not throw and does not warn.
7. `no backend available (node default): get → null, set → false, silently` — `setStorageBackend(null)` (restores the default; node has no `window.localStorage`); `get('k')` → `null`; `set('k', 'v')` → `false`; the warn spy was NOT called (storage unavailability is silent, D9).

### 8.C CREATE `apps/frontend/src/utils/bootScene.test.ts` (3 its, node env — the sanctioned demoScene.test.ts replacement)

Real headless `PerspectiveCamera(75, aspect, 0.1, 1000)` at `(0, 0, 5)` `lookAt(0,0,0)` — the M7 rig pattern:

1. `boot + spawn positions project inside |ndc| < 0.9 at BOTH aspect 16:9 and 16:10` — for each aspect, assert for: the boot pair (`getSpawnPosition('dashboard', 1)`, `getSpawnPosition('notes', 1)`), cascade instances 2–4 of BOTH apps, and default-spawn instances 1–4 (`getSpawnPosition('future-app', n)`) — `|ndc.x| < 0.9` and `|ndc.y| < 0.9` (worst case across all: 0.3988; huge margin vs App's `|ndc| > 1` cull).
2. `boot composition is exact: 2 apps, ids/titles known, projections pairwise distinct` — `BOOT_APP_IDS` equals `['dashboard', 'notes']`; `BOOT_WINDOW_COUNT === 2`; the two instance-1 projected centers are pairwise distinct with distinct xs AND distinct ys at both aspects; depths (`5 - z`) distinct (4.6 vs 4.8).
3. `getSpawnPosition semantics: clones, cascades, defaults` — two calls return distinct objects (mutating one result does not affect the next call); instance 2 equals `base + SPAWN_CASCADE_STEP` and instance 3 equals `base + 2 * step` (compute expected via the exported constant); instance 0 clamps to the base; an unknown app id returns `DEFAULT_SPAWN_POSITION` for instance 1.

### 8.D DELETE the demoScene pair

Remove `apps/frontend/src/utils/demoScene.ts` and `apps/frontend/src/utils/demoScene.test.ts` (sanctioned replacement — 2 tests removed, 3 added by 8.C).

### 8.E Expected total

174 baseline − 2 (demoScene) + 3 (bootScene) + 10 (appRegistry) + 7 (storage) = **192 expected**. Report the exact vitest count in your evidence; if the number differs, reconcile BEFORE proceeding (a mismatch means an unintended test change).

## 9. Work item G — CREATE `docs/scripts/verify_milestone8.py`

Copy `verify_milestone7.py` as the structural template (fake-webcam Chromium flags, 1280×800 viewport, console/pageerror/request listeners, `PERF_LINE_PATTERN` four-key regex verbatim, `runtime_introspection`, `fully_on_screen`, summary JSON, `OVERALL: PASS/FAIL`, mid-flight console persistence). Keep the SAME evidence-file pattern: `m8-scene.png`, `m8-full.png`, `m8-console.txt`, `m8-summary.json` in `docs/screenshots/`. The reset-view probe from v7 check m is NOT duplicated here (v7 still runs and covers it) — record the button's presence in the introspection summary only.

**Introspection (extend the v7 shape):** floating windows (id/text/display/rect, v7 fields); HUD via `includes('JARVIS · Milestone 8')` (v8 owns the exact pin — D13/D14); plus per-boot-window scoped reads:
- `notes1_value`: `document.querySelector('[data-window-id="notes-1"] [data-testid="notes-textarea"]')?.value ?? null`
- `dash_rows`: for testids `dash-clock`, `dash-cpu`, `dash-memory`, `dash-heap`, `dash-network` → `{ present, text }` via `[data-window-id="dashboard-1"] [data-testid="…"]`.
- `launcher`: for `launcher-open-dashboard`, `launcher-open-notes` → present; for `launcher-entry-chat`, `launcher-entry-search` → `{ present, disabled }` (button's `disabled` property).
- `reset_button` presence (informational).
- `viewport` (v7).

**Procedure (in order — boot introspection MUST precede every interaction):**

1. Navigate (`domcontentloaded`), `wait_for_timeout(14000)` (boot sequence — same budget as v7).
2. Screenshots `m8-scene.png` + `m8-full.png`; runtime introspection #1.
3. **Clock ticker probe:** read `[data-testid="dash-clock"]` innerText; `wait_for_timeout(1200)`; read again — assert different (check h).
4. **Launcher probe:** snapshot console/pageerror counts; assert chat/search entries present + disabled (check i pre-condition); `page.click('[data-window-id="dashboard-1"] [data-testid="launcher-open-notes"]')`; `wait_for_timeout(1000)`; introspect floating windows → expect 3 with `notes-2` fully on screen (check i); zero NEW console/page errors.
5. **Persistence:** `page.fill('[data-window-id="notes-1"] [data-testid="notes-textarea"]', marker_a)` where `marker_a = f'm8 persistence {uuid4().hex[:8]}'`; `wait_for_timeout(800)` (debounce 500 ms); `page.evaluate("() => localStorage.getItem('jarvis:note:notes-1')")` → JSON-decodes to exactly `marker_a` (check j part 1).
6. **Two-notes independence:** `page.fill('[data-window-id="notes-2"] [data-testid="notes-textarea"]', marker_b)`; `wait_for_timeout(800)`; `localStorage.getItem('jarvis:note:notes-2')` == `marker_b` AND `jarvis:note:notes-1` still `marker_a` (check k).
7. **Reload:** `page.reload()` (same context — localStorage survives; this run is the empirical confirmation); `wait_for_timeout(14000)`; introspection #2: exactly 2 windows, ids exactly `{dashboard-1, notes-1}`, both fully on screen; `notes1_value == marker_a` (check j part 2); 1 live video track.
8. **AppContext controls:** click `[data-window-id="dashboard-1"] [data-testid="appctl-maximize"]`; `wait_for_timeout(500)`; dashboard-1 still visible + fully on screen; zero new errors (check l part 1). Click `appctl-minimize`; `wait_for_timeout(500)`; dashboard-1 root `display == 'none'`; zero new errors (check l part 2).
9. **Unmount-flush + chrome close:** click `launcher-open-notes` (notes-2 back — window state is NOT persisted, only note text); `wait_for_timeout(800)`; `page.fill('[data-window-id="notes-2"] [data-testid="notes-textarea"]', marker_c)`; IMMEDIATELY `page.click('[data-window-id="notes-2"] button[aria-label="Close Notes"]')` (before the 500 ms debounce fires); `wait_for_timeout(600)`; assert: no `[data-window-id="notes-2"]` node; `localStorage.getItem('jarvis:note:notes-2')` == `marker_c` (the unmount flush saved it); floating windows back to 2; notes-1 still present; zero new errors (check m).
10. Write `m8-console.txt` (the console listener spans BOTH page loads — same Page object) and `m8-summary.json`; print `=== CHECKS ===` + `OVERALL`.

**Checks (all must PASS; keys exactly as written):**

- `a: zero console errors and zero page errors (whole session, both page loads)` — `console_lines` contains zero `[error]` entries and `page_errors == []`. NOTE: `[warning]` lines are tolerated ONLY if edge-triggered — with a fresh profile none should occur; assert zero `[error]` strictly.
- `b: boot scene exact: 2 app windows, ids exactly dashboard-1 + notes-1, both fully on screen` (introspection #1: `len(windows) == 2`, id set equality, `fully_on_screen` both).
- `c: boot titles visible: Dashboard and Notes in window text`.
- `d: pairwise-distinct projected positions at boot (tuples, lefts, tops)` (v7 logic, over the 2 boot windows).
- `e: HUD shows exact M8 title, Camera active, MediaPipe ready, Windows = 2 at boot` — `'JARVIS · Milestone 8' in hud` + Camera/active/MediaPipe/ready rows + the Windows row reads EXACTLY 2 (this verifier owns the exact count pin — D14 tier 1).
- `f: Dashboard stats render with values` — `dash-cpu` present with a `>= 1` integer in its text; `dash-network` present with non-empty text; `dash-memory` + `dash-heap` present with non-empty text (`—` fallback counts as rendered).
- `g: Notes textarea present and empty at first boot (fresh profile)`.
- `h: live ticker: dash-clock advances across a 1.2 s sample pair`.
- `i: launcher: chat/search entries disabled; open-notes click adds notes-2 fully on screen; zero new errors`.
- `j: notes persist: debounce writes jarvis:note:notes-1; reload restores the textarea value (localStorage survived)`.
- `k: two notes windows are independent (distinct keys, no clobbering)`.
- `l: AppContext controls: maximize error-free on a visible window; minimize hides it`.
- `m: chrome close removes the window AND the unmount flush saved the mid-debounce text`.
- `n: >= 1 [Performance] line, every line matching the M4 four-key format`.
- `o: latency >= 2 lines, min avg in 150-260ms, < 300ms`.
- `p: cleanup counts balanced across the session (CameraCapture == HandTracker, 2-4 each with the reload)`.
- `q: exactly 1 live video track (post-reload introspection)`.
- `r: max logged FPS >= 30 (boot window)`.
- `s: no gesture log lines (no hands on fake webcam)`.

Docstring: M8 scope + honest notes — (1) the fake webcam produces no hands, so gesture interactions remain unit-evidenced; this script adds the first INTERACTIVE app-level verification (launcher, typing, reload persistence, app/window controls); (2) AppContext.maximize's restore-if-minimized branch cannot be exercised browser-side (a minimized window's controls are hidden by design) — the visible-window half is proven here, the branch is code-review verified (D12).

## 10. Work item H — verifier lockstep (hash-disciplined, enumerated)

BEFORE any edit: `sha256sum docs/scripts/verify_milestone*.py`, paste the table. Orchestrator-recorded baseline (2026-08-16):

```
450c8386b73c5735ced29997c9edefb7692bdecc5d0384a7b67d2274376a242b  verify_milestone1.py  (MUST stay identical)
2f9bc072f0c523b889ca15278641e784b744745f52b7628260fb50e43f662b44  verify_milestone2.py  (MUST stay identical)
5e0f7b471ba8c7c6ccd27f756eda284b9927d63bdf5f1f55b5a482c6004b2eb1  verify_milestone3.py  (title-check + count edits)
f3a0ad26e120aa08b6cb24fe28bb5bfd1ef7603e20972b6d027cfcadcc7fc789  verify_milestone4.py  (title-check + count edits)
216a12da1464f9904d7c7255f32ada7ec26af7fe65678171168d9846c23d79c0  verify_milestone5.py  (title-check + count edits)
49dbabc2a9a9476587f3a23c31f55358b937b697ea3d2da10796855627e6a3b4  verify_milestone6.py  (title-check + count edits)
806418fd2218722a11bbed32a55dabc89388b039b7a1427336d824946efdc4cc  verify_milestone7.py  (title-pin→tolerant + count edits)
```

**The D14 future-proof replacements, used identically in v3/v4/v5/v6 (each file gets the same three transformations):**

(T1) Docstring item c — replace `window titles visible ("Test Window", "Second Window")` with:
```
  c) window titles visible (every boot window renders a non-empty title —
     specific titles are pinned only by the current-milestone verifier
     since M8)
```

(T2) Docstring count phrase — replace `Windows count row = 4` (v3/v5/v6; v4 says `Windows = 4`; v6's is `Windows count row = 4 (M7 demo scene)`) with:
```
Windows row present with value >= 2 (future-proof since M8 — the exact
     boot count is pinned only by the current-milestone verifier)
```
wrapped to the file's existing line structure.

(T3a) Summary `titles_visible` computation — replace the two-string block:
```python
                "titles_visible": bool(
                    "Test Window" in combined_window_text
                    and "Second Window" in combined_window_text
                ),
```
with:
```python
                # M8 future-proof policy (D14): assert every boot window
                # renders a non-empty title (the chrome contract); specific
                # titles are pinned only by the current-milestone verifier.
                "titles_visible": bool(
                    windows and all((w["text"] or "").strip() for w in windows)
                ),
```
(The check line `"c: window titles visible": summary["titles_visible"]` stays byte-identical in every file.)

(T3b) The HUD check — add the local right after `hud = summary["hud_text"] or ""`:
```python
    # M8 future-proof policy (D14): older verifiers no longer pin the exact
    # boot count digit — the Windows row must exist and report >= 2 (the
    # boot floor). The exact count is pinned only by the current-milestone
    # verifier (v8 since M8).
    windows_row = re.search(r"Windows\s+(\d+)", hud)
```
then in the check (f in v3, e in v4/v5/v6) replace the key suffix `Windows = 4` with `Windows row >= 2` and replace the last two assertion lines:
```python
            and "Windows" in hud
            and "4" in hud  # M7 demo scene: exactly 4 windows at boot, none closed
```
with:
```python
            and windows_row is not None
            and int(windows_row.group(1)) >= 2
```
(`re` is already imported in every verifier. Check b (`>= 2`) and v4 check l (`post_reload_windows_on_screen >= 2`) already pass with a 2-window boot — NO edits.)

**Per-file edit map (exhaustive — nothing else in these files changes):**

- **v3 `verify_milestone3.py` (5 spots):** docstring item c (~line 9, T1); docstring item f count phrase (~line 16, T2); summary `titles_visible` (~lines 199–202, T3a); `windows_row` local (~line 243, T3b); check f key + assertions (~lines 260–267, T3b).
- **v4 `verify_milestone4.py` (5 spots):** docstring item c (~line 8, T1); docstring item e count phrase (~line 13, T2); summary `titles_visible` (~lines 397–400, T3a); `windows_row` local (~line 479, T3b); check e key + assertions (~lines 509–516, T3b). NO edits to check b, the drift/soak logic, or check l.
- **v5 `verify_milestone5.py` (5 spots):** docstring item c (~line 9, T1); docstring item e count phrase (~line 15, T2); summary `titles_visible` (~lines 218–221, T3a); `windows_row` local (~line 264, T3b); check e key + assertions (~lines 284–291, T3b).
- **v6 `verify_milestone6.py` (5 spots):** docstring item c (~line 9, T1); docstring item e — replace `Windows count row = 4 (M7 demo scene)` with the T2 phrase, and refresh the historical title note to `(version-tolerant lookup since M7 — the title moved to Milestone 8 in M8)` (~lines 12–15); summary `titles_visible` (~lines 220–223, T3a); `windows_row` local (~line 266, T3b); check e key + assertions (~lines 286–293, T3b). The v6 introspection finder is ALREADY tolerant — no title edit.
- **v7 `verify_milestone7.py` (9 spots):** becomes a historical verifier under D14:
  1. Docstring item b: `exactly 4 floating-window DOM nodes` → `>= 2 floating-window DOM nodes (future-proof since M8)` (~line 7).
  2. Docstring item c → the T1 phrase (replacing the four-title list) (~line 11).
  3. Docstring item d: `the 4 (left, top) tuples` → `the (left, top) tuples` and drop the `four distinct` wording (~lines 12–14).
  4. Docstring item f: the EXACT-title sentence → `HUD intact (version-tolerant title since M8 — the title moved to Milestone 8; the current-milestone verifier v8 owns the exact pin), Camera active, MediaPipe ready, ` + T2 phrase (~lines 17–19).
  5. Docstring item m: `with 4 windows still on screen` → `with >= 2 windows still on screen` (~line 33).
  6. Docstring honest-scope note: `proves the M7 demo scene boots clean: 4 windows on screen at distinct projected positions, HUD bumped, reset button harmless` → `proves the boot scene still boots clean: the app boot windows on screen at distinct projected positions, HUD intact, reset button harmless` (~lines 36–41).
  7. Introspection comment + finder: the `// M7 owns the CURRENT title…` comment → `// Version-tolerant since M8 (the title moved to Milestone 8); v8 pins the exact string.` and `includes('JARVIS · Milestone 7')` → `includes('JARVIS · Milestone')` (~lines 123–127).
  8. Summary `titles_visible` → T3a (the four-title block, ~lines 270–275); add the `windows_row` local after `hud = summary["hud_text"] or ""` (~line 355, T3b).
  9. Assertions: check b `len(windows) == 4 and len(window_ids) == 4 and len(windows_on_screen) == 4` → `len(windows) >= 2 and len(window_ids) == len(windows) and len(windows_on_screen) == len(windows)` (~lines 370–374); check f → T3b form with tolerant title (~lines 384–392); `windows_after_ok` `len(windows_after) == 4` → `len(windows_after) >= 2` (~line 363); check m key `…4 windows on screen` → `…>= 2 windows on screen` (~line 413).
- **v1, v2: ZERO edits** (hash-identical before/after).

AFTER the edits: re-run `sha256sum` (v1/v2 identical; v3–v7 changed — record old→new), then run ALL EIGHT verifiers against the dev server in order 1→8 — every one must print `OVERALL: PASS`. Also paste: `grep -rn '"4" in hud' docs/scripts/` (expected: zero hits) and `grep -rn 'Test Window\|Second Window' docs/scripts/` (expected: zero hits — the demo titles are fully retired from verifier pins).

## 11. Work item I — README.md M8 section (docs-guard)

Append after the M7 section, mirroring the M6/M7 structure:

```
## Milestone 8 — Window app framework: app registry, Dashboard + Notes apps, local persistence (Phase 3 part 1)

**Phase 3 status: OPENED** — M1–M7 remain green (192 unit tests, eight
verifiers); M8 replaces the demo windows with REAL app windows.
```

Then:

- **What was built** — one bullet per artifact: `utils/appRegistry.ts` (AppContext + AppProps + AppDefinition + register/getApp/listApps/getTitle + appIdFromWindowId + createAppBus + setFallbackApp/STUB_FALLBACK); `utils/storage.ts` (prefix-owning typed JSON storage, injectable backend, warn-only edge cases); `utils/bootScene.ts` (replaces demoScene.ts — BOOT_APP_IDS/BOOT_WINDOW_COUNT + margin-verified spawn table + cascade, D2 table referenced); `components/apps/` (UnknownApp/Notes/Dashboard/index with registration side effect); App.tsx wiring (registry lookups, openApp, maximize, boot scene, HUD bump, console line); tests (counts per suite + the demoScene→bootScene replacement arithmetic); `verify_milestone8.py` (first INTERACTIVE verifier — launcher, typing, reload persistence, app/window controls); verifier lockstep (v3–v7 future-proof edits + hash table).
- **App framework in one paragraph** — how windows map to apps (id scheme, registry lookup, fallback), what AppContext gives an app (five fields + openApp), and how to add an app in M9/M10 (write the component, register in `components/apps/index.ts`, optionally add a spawn-table entry; the launcher picks it up automatically).
- **How to run** — `npm run test`; `npm run dev:frontend`; `python docs/scripts/verify_milestone8.py`; manual demo script (open a second Notes window from the Dashboard launcher, type in both, reload the page — both notes restore; minimize/close via the app or chrome buttons).
- **Deviations & decisions (D1–D16 digested)** — MUST include: the abstract-class→function-component registry deviation from TECHNICAL_SPEC §2.3 (same five-field AppContext contract; typed `sendMessage(type, payload?)` vs `msg: any`); maximize = restore+focus interim semantics + the hidden-window restore caveat (D12); Chat/Search as disabled launcher entries, not registered (D8); component behavior verified via Playwright, not jsdom (D16); the D14 verifier future-proof policy (two-tier pinning — and that M9/M10 should only touch the NEW verifier); the boot console-line amendment (D15) and the demoScene→bootScene sanctioned replacement; per-app UI timers are not the M4 perf-logger discipline (D11); storage warns are edge-only (D9); window scale is M3-frozen so app windows are compact by design.
- **Evidence** — `docs/screenshots/m8-scene.png`, `m8-full.png`, `m8-console.txt`, `m8-summary.json`.
- **Milestone 8 acceptance (mapped honestly)** — automated items checked (registry + fallback unit-pinned; Dashboard stats/launcher + Notes persistence + two-window independence browser-pinned; AppContext minimize/close browser-pinned; all tests + build + verifiers 1–8; zero console errors); manual/code-review items UNCHECKED, explicitly listing: real-webcam grab/drag of app windows (fake webcam has no hands); AppContext.maximize's restore-if-minimized branch (hidden-window controls make it browser-unprovable — code-review verified, D12); visual fit of app content at the frozen M3 window scale.

## 12. Do-not-touch list

`utils/interactionEngine.ts` + `interactionEngine.test.ts` (frozen — window creation is App-side), `utils/windowManager.ts` + `windowManager.test.ts` (every op M8 needs already exists), `components/FloatingWindow.tsx` (byte-identical), `components/Scene3D.tsx`, `components/GestureDebug.tsx`, `components/HandTracker.tsx`, `components/CameraCapture.tsx`, `components/ErrorBanner.tsx`, `utils/gestures.ts` + test, `utils/animation.ts` + test, `utils/logger.ts` + test, `utils/cameraRig.ts` + test, `src/main.tsx`, `src/index.css`, `src/types/*`, `index.html`, `apps/backend/**`, `packages/shared/**`, `docs/scripts/verify_milestone1.py` + `verify_milestone2.py` (hash-identical), every existing verifier line NOT enumerated in section 10, every console format except the one sanctioned amendment (7.E6), all npm configs/dependencies.

## 13. Implementation order (small batches, verify each)

1. `utils/appRegistry.ts` + `appRegistry.test.ts` → `npm run test` green (192-count only after all batches; intermediate count 184).
2. `utils/storage.ts` + `storage.test.ts` → green (191).
3. `utils/bootScene.ts` + `bootScene.test.ts`, DELETE `demoScene.ts` + `demoScene.test.ts` → green (192 exact) + `npm run build` + lint clean.
4. `components/apps/` (UnknownApp, Notes, Dashboard, index) → build green (not yet rendered).
5. `App.tsx` wiring (E1–E10) → build + lint green; dev-server eyeball: exactly 2 app windows (Dashboard left-upper, Notes right-lower), HUD `JARVIS · Milestone 8` / Windows 2, zero console errors; type in Notes, wait 1 s, reload — text restored; launcher opens a second Notes (cascade-offset); appctl Min hides the Dashboard; chrome buttons still work.
6. `verify_milestone8.py` → `OVERALL: PASS` ( iterate until all a–s pass).
7. Verifier lockstep (section 10; hashes before/after) → ALL EIGHT verifiers `OVERALL: PASS`.
8. README M8 (docs-guard) + final evidence pass (section 14).

## 14. Evidence to paste in your report

1. `npm run test` — the summary block (expected 192 passed; exact count).
2. `npm run build` — the three-workspace success tail; `npm run lint --workspace @jarvis/frontend` — clean.
3. `grep -rn "windows created" docs/scripts/` — zero hits (the 7.E6 proof, run BEFORE the App edit).
4. `sha256sum docs/scripts/verify_milestone*.py` — BEFORE and AFTER tables with the v1/v2 identity called out.
5. All EIGHT verifier runs — each one's `=== CHECKS ===` block + `OVERALL: PASS` line.
6. `grep -rn '"4" in hud' docs/scripts/` and `grep -rn 'Test Window\|Second Window' docs/scripts/` — zero hits.
7. `ls docs/screenshots | grep m8` — the four m8-* evidence files.
8. Skill evidence: test-guard / clean-code-guard / docs-guard check lines for the files they covered.
9. Any deviation from this brief, with the reason (deviations are acceptable if documented; silent scope drift is not).

---

# Overseer review checklist (1:1 with the M8 acceptance criteria)

For each item: verify with the cited evidence, not the Coder's summary. FAIL = send back to the Coder with the finding.

**App framework — registry + fallback (unit)**
- [ ] `utils/appRegistry.ts` exports exactly: `AppContext` (the spec's five fields), `AppProps` (= AppContext + openApp), `AppDefinition`, `AppComponent`, `register`, `getApp`, `listApps`, `getTitle`, `appIdFromWindowId`, `setFallbackApp`, `AppMessage`, `AppBus`, `createAppBus` — and imports NO runtime React (grep: only `import type { FC }`).
- [ ] `getApp` NEVER returns undefined (registered → definition; unknown → fallback); `getTitle` unknown → `'Unknown App'`; `listApps` = registration order, fallback NOT listed (8.A2/3/4).
- [ ] `register` throws on duplicate id without overwriting (8.A5); `appIdFromWindowId` truth table incl. dash-in-appId + last-dash + no-dash + leading-dash edges (8.A6).
- [ ] Bus: emit delivers the exact message; unsubscribe stops only that handler; zero-subscriber emit is a no-op (8.A7–A10); per-scene bus instance in App (`appBusRef` reset in `handleSceneReady`).
- [ ] `components/apps/index.ts` registers `dashboard` + `notes` and injects the UnknownApp fallback at module load (D7); App.tsx imports it for the side effect.
- [ ] The abstract-class→function-component deviation from TECHNICAL_SPEC §2.3 is documented in the appRegistry docblock AND the README deviations digest.

**Dashboard app (browser — v8 checks f/h/i)**
- [ ] Local-only stats render with values: `dash-cpu` integer >= 1, `dash-network` non-empty, `dash-memory`/`dash-heap` present (`—` fallback allowed — deviceMemory/performance.memory are Chromium-dependent).
- [ ] Live ticker: `dash-clock` text differs across a 1.2 s sample pair (v8 check h); the interval is created in an effect and cleared in its cleanup (StrictMode-safe).
- [ ] Launcher lists REGISTERED apps as enabled buttons (`launcher-open-dashboard`, `launcher-open-notes`) wired to `openApp`; clicking open-notes produces a NEW window (`notes-2`) fully on screen with zero new errors (v8 check i).
- [ ] Chat/Search render as DISABLED entries (`launcher-entry-chat`, `launcher-entry-search`) and are NOT registered (no `getApp('chat')`/`listApps()` entry; no placeholder windows).
- [ ] NO external APIs: grep the new components for `fetch(`/`XMLHttpRequest`/`api` — zero hits; no API keys anywhere.
- [ ] D11 documented: the 1 s interval is a per-app UI effect, distinct from the M4 perf-logger rAF-gate discipline; v4's soak/drift/spam checks still pass (re-run evidence).

**Notes app (browser + unit — v8 checks g/j/k/m + 8.B5)**
- [ ] `data-testid="notes-textarea"` inside the notes window; restores from `jarvis:note:<windowId>` on mount (v8 check j: value empty at first boot, restored after reload).
- [ ] Persistence: fill → 500 ms debounce writes the key; `page.reload()` (same context) restores the exact text (v8 check j).
- [ ] Two windows independent: `notes-1`/`notes-2` keys hold their own texts with no clobbering (v8 check k; unit pin 8.B5 uses the exact production key shape).
- [ ] Unmount flush: closing the window immediately after typing (before the debounce) still saved the text (v8 check m).
- [ ] StrictMode safety by construction: restore never sets `dirtyRef`; the cleanup flush writes only when dirty (read the Notes effect — D10); no data loss across the double effect run.
- [ ] `utils/storage.ts`: prefix `'jarvis:'` owned by the module; injectable backend; no-backend default → null/false silently; corrupt-JSON → null + one warn; quota → false + one warn; remove silent (8.B1–B7). ZERO warns during normal boot/operation (v8 check a + console evidence).

**Window scheme + controls (browser)**
- [ ] Window ids are `'<appId>-<n>'`; boot = exactly `dashboard-1` + `notes-1` (v8 check b); appId derived by `appIdFromWindowId` — no parallel map exists (grep App.tsx).
- [ ] Boot positions match the D2 table and are unit-pinned (8.C1/C2) + browser-pinned (full viewport containment, distinct positions — v8 checks b/d); no HUD/GestureDebug/reset-button overlap (v8 introspection rects).
- [ ] `AppContext.maximize` = restore-if-minimized + bringToFront (read `handleMaximizeWindow`); visible-window half browser-proven (v8 check l); the restore branch is code-review verified and README-mapped honestly.
- [ ] `AppContext.minimize`/`close` browser-proven via the Dashboard appctl strip (v8 check l/m); the M3 chrome buttons byte-identical (FloatingWindow.tsx hash-unchanged) and still work (v8 check m uses the chrome close).
- [ ] `openApp` exposed as a prop (D4), spawns at the margin-verified table position with the per-instance cascade; instance counters are per-scene and monotonic (closed windows never reuse ids).

**Tests + build**
- [ ] 192 vitest tests green: 174 baseline − 2 (demoScene deleted) + 3 (bootScene) + 10 (appRegistry) + 7 (storage) — the ONLY existing test files touched are the two deleted ones (diff the file list).
- [ ] `npm run build` passes all three workspaces; lint clean; TS constraints honored (no enums; `import type` everywhere; no unused locals — note the apps destructure ONLY the props they use).
- [ ] test-guard / clean-code-guard / docs-guard evidence lines present.

**Verifier lockstep (exactness matters — re-grep yourself)**
- [ ] v1/v2 sha256 IDENTICAL before/after.
- [ ] v3/v4/v5/v6 changed ONLY in the five enumerated spots each; v7 only in the nine enumerated spots — verify by re-reading the diff regions; `grep -rn '"4" in hud' docs/scripts/` → zero hits; `grep -rn 'Test Window\|Second Window' docs/scripts/` → zero hits.
- [ ] The D14 future-proof policy is stated in each edited verifier (docstring/comment) and the README: older verifiers assert >= 2 windows + non-empty titles + Windows-row >= 2; the exact pins live ONLY in v8.
- [ ] All EIGHT verifiers re-run to `OVERALL: PASS` (paste each block); v8 checks a–s all PASS; the four m8-* evidence files exist.
- [ ] Latency band still 150–260 ms; FPS boot >= 30; cleanup balanced; 1 live track; zero console/page errors; perf lines all match the M4 regex; HUD exactly `JARVIS · Milestone 8` (v8 check e).

**Constraints**
- [ ] NO Chat/Search implementation (disabled entries only), NO backend/shared changes, NO gesture changes (gestures.ts untouched), NO engine changes (interactionEngine.ts untouched), NO windowManager changes (all M8 needs pre-existed), NO window-physics changes, NO new npm dependencies, NO new console output in normal operation (only the one sanctioned boot-line amendment + edge-only storage warns).
- [ ] Do-not-touch list intact (section 12) — spot-check FloatingWindow.tsx, interactionEngine.ts, windowManager.ts, HandTracker.tsx, Scene3D.tsx, gestures.ts are unmodified.
- [ ] README M8 section complete: app-framework guide, deviations digest (incl. the §2.3 deviation, D12/D8/D14/D15/D16), how-to-run + manual demo script, evidence pointers, honest acceptance mapping (manual items unchecked).
