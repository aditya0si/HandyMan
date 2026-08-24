/**
 * M15 MediaPipe script loader (brief D10). The @mediapipe Closure bundles
 * declare "sideEffects": [], so they are loaded as plain <script> ASSETS via
 * ?url imports + runtime injection (the M14 D10 production-build fix, moved
 * out of HandTracker so the CDN-fail path is unit-testable with a fake
 * loadScript). The loader is idempotent and StrictMode-safe (shared
 * module-level promise). Node tests inject loadScript and hit the reject(
 * "failed to load ...") path without touching a DOM.
 */
import handsScriptUrl from '@mediapipe/hands/hands.js?url';
import cameraScriptUrl from '@mediapipe/camera_utils/camera_utils.js?url';

export { handsScriptUrl, cameraScriptUrl };

/** Injectable <script> loader (node fakes satisfy it). */
export type ScriptLoader = (src: string) => Promise<void>;

function defaultLoadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export interface MediaPipeScriptLoader {
  /** Resolves once the global solutions exist (no-op when already loaded). */
  load(): Promise<void>;
}

/**
 * Creates a loader for the two solution scripts. `loadScript` is injectable
 * for tests; the default appends ?url assets to <head>.
 */
export function createMediaPipeScriptLoader(
  options: { loadScript?: ScriptLoader } = {},
): MediaPipeScriptLoader {
  const loadScript = options.loadScript ?? defaultLoadScript;
  let promise: Promise<void> | null = null;

  const load = (): Promise<void> => {
    const win =
      typeof window !== 'undefined'
        ? (window as Window & { Hands?: unknown; Camera?: unknown })
        : null;
    if (win?.Hands && win?.Camera) return Promise.resolve();
    if (!promise) {
      promise = Promise.all([
        loadScript(handsScriptUrl),
        loadScript(cameraScriptUrl),
      ]).then(() => undefined);
    }
    return promise;
  };

  return { load };
}
