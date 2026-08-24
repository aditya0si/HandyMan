import type { AppProps } from '../../utils/appRegistry';

/** Safe fallback content for windows whose app id is not registered
 *  (D6) — injected via setFallbackApp by components/apps/index.ts. */
export function UnknownApp({ windowId }: AppProps) {
  return (
    <div
      data-testid="unknown-app"
      style={{ color: '#8b8f98', fontSize: 10, fontStyle: 'italic' }}
    >
      Unknown app for window &quot;{windowId}&quot;.
    </div>
  );
}
