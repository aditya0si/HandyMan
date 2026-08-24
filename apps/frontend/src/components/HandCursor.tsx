import type { HandCursorData } from '../utils/cursorTracking';

export interface HandCursorProps {
  cursor: HandCursorData | null;
}

/**
 * HandCursor (Session 3):
 * VisionOS-inspired floating spatial reticle on screen. Follows the user's hand / pointing
 * finger with smooth interpolation, scaling and glowing dynamically on hover and pinch states.
 */
export function HandCursor({ cursor }: HandCursorProps) {
  if (!cursor || !cursor.visible) {
    return null;
  }

  const isHover = cursor.isHovering;
  const isPinch = cursor.isPinching;

  const ringSize = isHover ? 38 : isPinch ? 22 : 28;
  const dotSize = isPinch ? 10 : 7;
  // Idle reticle is neutral white; cyan arrives only when the hand engages
  // a target (hover/pinch) — color = the system responding to touch.
  const ringColor = isHover ? '#00e5ff' : isPinch ? '#00e5ff' : 'rgba(255, 255, 255, 0.6)';
  const glowColor = isHover ? 'rgba(0, 229, 255, 0.5)' : isPinch ? 'rgba(0, 229, 255, 0.4)' : 'rgba(255, 255, 255, 0.25)';

  return (
    <div
      data-testid="hand-cursor"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0) translate(-50%, -50%)`,
        width: ringSize,
        height: ringSize,
        pointerEvents: 'none',
        zIndex: 99,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'width 0.15s ease, height 0.15s ease, transform 0.02s linear',
      }}
    >
      {/* Outer Reticle Ring */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `1.5px solid ${ringColor}`,
          boxShadow: `0 0 14px ${glowColor}, inset 0 0 8px ${glowColor}`,
          background: isHover ? 'rgba(0, 229, 255, 0.08)' : 'transparent',
          transition: 'all 0.15s ease',
        }}
      />

      {/* Center Laser Pointer Dot */}
      <div
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          background: isPinch ? '#ffffff' : isHover ? '#00e5ff' : '#ffffff',
          boxShadow: `0 0 10px ${isPinch || isHover ? '#00e5ff' : 'rgba(255, 255, 255, 0.8)'}`,
          transition: 'all 0.12s ease',
        }}
      />
    </div>
  );
}
