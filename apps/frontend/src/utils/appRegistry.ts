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

/** M13 (D13): Dashboard Save/Load result — count on success, a
 *  user-readable error string on failure. */
export type WorkspaceResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

/** Props every app component receives: AppContext + the app-level
 *  openApp callback (explicit props, no React context machinery — D4).
 *  M13: the OPTIONAL workspace hooks (Dashboard Save/Load, D13). */
export interface AppProps extends AppContext {
  openApp: (appId: string) => void;
  saveWorkspace?: () => Promise<WorkspaceResult>;
  loadWorkspace?: () => Promise<WorkspaceResult>;
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
