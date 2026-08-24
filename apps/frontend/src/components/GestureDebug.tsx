import type { Gesture } from '../utils/gestures';
import { GestureType } from '../utils/gestures';

interface GestureDebugProps {
  /** Latest gestures (per-hand entries plus bimanual PINCH_ZOOM); [] = no hands. */
  gestures: Gesture[];
}

/**
 * Gesture debugging panel (guide step 2.3): fixed top-right overlay showing
 * what the recognizer currently emits per hand. Presentational only — the
 * parent feeds it already-throttled state (~10 Hz, same pattern as the HUD)
 * so 30 Hz inference never re-renders at inference rate.
 *
 * M5: bimanual PINCH_ZOOM entries are filtered OUT of the per-hand lines
 * before mapping (the keys stay `gesture.handedness`, so a Right-primary
 * pinch_zoom next to a per-hand Right gesture would be a duplicate React
 * key) and rendered in their own section below the divider.
 *
 * Honest note: the panel is fed ~10 Hz throttled state, so a one-frame
 * SWIPE event may not be visible every time; the per-second HandTracker
 * log catches events reliably.
 *
 * Live gesture changes need a real webcam (Chromium's fake device shows no
 * hands); automated runs verify the no-hands state and panel rendering.
 */
export function GestureDebug({ gestures }: GestureDebugProps) {
  const perHand = gestures.filter((g) => g.type !== GestureType.PINCH_ZOOM);
  const bimanual = gestures.filter((g) => g.type === GestureType.PINCH_ZOOM);
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 20,
        minWidth: 240,
        background: 'rgba(10, 11, 13, 0.72)',
        backdropFilter: 'blur(18px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 12,
        padding: '11px 14px',
        color: '#f4f5f7',
        fontFamily:
          'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: 12,
        lineHeight: 1.7,
        userSelect: 'none',
      }}
      data-testid="gesture-debug"
    >
      <div
        style={{
          fontWeight: 600,
          marginBottom: 6,
          color: '#f4f5f7',
          letterSpacing: '0.12em',
        }}
      >
        GESTURES
      </div>
      {gestures.length === 0 ? (
        <div style={{ color: '#8b8f98' }}>No hands detected</div>
      ) : (
        <>
          {perHand.map((gesture) => (
            <div
              key={gesture.handedness}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}
            >
              <span style={{ color: '#8b8f98' }}>{gesture.handedness}</span>
              <span style={{ color: '#e8eaed', fontWeight: 500 }}>
                {gesture.type.toUpperCase()}
                {gesture.swipeDirection ? ` ${gesture.swipeDirection}` : ''}
              </span>
              <span style={{ color: '#8b8f98', fontVariantNumeric: 'tabular-nums' }}>
                c {gesture.confidence.toFixed(2)} · i {gesture.intensity.toFixed(2)}
              </span>
            </div>
          ))}
          {bimanual.length > 0 && (
            <>
              <div
                style={{
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  margin: '6px 0',
                }}
              />
              {bimanual.map((gesture) => (
                <div
                  key="pinch-zoom"
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}
                >
                  <span style={{ color: '#8b8f98' }}>PINCH_ZOOM</span>
                  <span style={{ color: '#e8eaed', fontWeight: 500 }}>
                    zoom-{gesture.zoomDirection}
                  </span>
                  <span style={{ color: '#8b8f98', fontVariantNumeric: 'tabular-nums' }}>
                    c {gesture.confidence.toFixed(2)} · i {gesture.intensity.toFixed(2)}
                  </span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
