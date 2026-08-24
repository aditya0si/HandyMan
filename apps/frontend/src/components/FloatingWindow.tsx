import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { recordPerf } from '../utils/perfDebug';
import type { FloatingWindow } from '../utils/windowManager';

/** Screen-space rect for the DOM window, projected from its live 3D mesh. */
export interface WindowProjection {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FloatingWindowProps {
  /** Window identity/flags from React state (id, title, zIndex, isMinimized). */
  window: FloatingWindow;
  /** App-provided content (content is a React concern; the manager stays DOM-free). */
  content?: ReactNode;
  /** M12 (D10): true when the window was created by ANOTHER user — the
   *  chrome badge shows REMOTE (orange) instead of YOU (cyan). */
  isRemote?: boolean;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onBringToFront: (id: string) => void;
  /** Projects the live mesh into screen pixels; called by the rAF loop. */
  getProjection: (windowId: string) => WindowProjection | null;
}

/**
 * DOM representation of a 3D floating window (guide step 3.1):
 * Tracks its 3D mesh every render frame via a ~30 Hz rAF loop.
 * Also supports 2-second hover dwell holographic charging border and locked grab aura.
 */
export function FloatingWindow({
  window,
  content,
  isRemote = false,
  onClose,
  onMinimize,
  onBringToFront,
  getProjection,
}: FloatingWindowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dwellState, setDwellState] = useState<{ progress: number; isLocked: boolean }>({
    progress: 0,
    isLocked: false,
  });

  // Listen for dwell-to-grab progress updates
  useEffect(() => {
    const handleDwell = (
      e: CustomEvent<{ windowId: string; progress: number; isLocked: boolean }>,
    ) => {
      if (e.detail && e.detail.windowId === window.id) {
        setDwellState({
          progress: e.detail.progress,
          isLocked: e.detail.isLocked,
        });
      }
    };
    globalThis.addEventListener('jarvis-dwell-update' as never, handleDwell as EventListener);
    return () => {
      globalThis.removeEventListener('jarvis-dwell-update' as never, handleDwell as EventListener);
    };
  }, [window.id]);

  // Latest callback via ref so the loop effect never restarts on re-render.
  const projectionRef = useRef(getProjection);
  projectionRef.current = getProjection;

  useEffect(() => {
    let rafId = 0;
    let lastTick = 0;
    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      if (now - lastTick < 1000 / 30) return; // ~30 Hz style writes
      lastTick = now;
      const tickStart = performance.now(); // M14 (D5): projection cost
      const el = rootRef.current;
      const projection = projectionRef.current(window.id);
      if (el && projection) {
        el.style.left = `${projection.left}px`;
        el.style.top = `${projection.top}px`;
        el.style.width = `${projection.width}px`;
        el.style.height = `${projection.height}px`;
      }
      recordPerf('projection', performance.now() - tickStart);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [window.id]);

  const stopPropagation = (e: MouseEvent<HTMLButtonElement>) => {
    // Buttons must not also trigger bring-to-front on the root.
    e.stopPropagation();
  };

  return (
    <div
      ref={rootRef}
      data-testid="floating-window"
      data-window-id={window.id}
      onClick={() => onBringToFront(window.id)}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        zIndex: window.zIndex,
        display: window.isMinimized ? 'none' : 'block',
        background: 'rgba(10, 11, 13, 0.82)',
        backdropFilter: 'blur(18px) saturate(130%)',
        border: dwellState.isLocked
          ? '1px solid rgba(0, 229, 255, 0.9)'
          : '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: 14,
        boxShadow: dwellState.isLocked
          ? '0 24px 60px rgba(0, 0, 0, 0.65), 0 0 24px rgba(0, 229, 255, 0.3)'
          : '0 24px 60px rgba(0, 0, 0, 0.6)',
        color: '#f4f5f7',
        fontFamily:
          'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden',
        userSelect: 'none',
        cursor: 'default',
        transform: dwellState.isLocked ? 'scale(1.015)' : 'scale(1)',
        transition: 'border 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
      }}
    >
      {/* Dwell charge ring — the one place color appears before you touch:
          white-to-cyan trace fills as the dwell locks, then hands off to the
          locked border state. */}
      {dwellState.progress > 0 && !dwellState.isLocked && (
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 99,
          }}
        >
          <defs>
            <linearGradient id={`dwell-grad-${window.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#00e5ff" />
            </linearGradient>
            <filter id={`dwell-glow-${window.id}`}>
              <feGaussianBlur stdDeviation="2" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect
            x="2"
            y="2"
            width="calc(100% - 4px)"
            height="calc(100% - 4px)"
            rx="12"
            ry="12"
            fill="none"
            stroke={`url(#dwell-grad-${window.id})`}
            strokeWidth="2.5"
            strokeDasharray="2400"
            strokeDashoffset={2400 * (1 - dwellState.progress)}
            filter={`url(#dwell-glow-${window.id})`}
            style={{
              transition: 'stroke-dashoffset 0.05s linear',
            }}
          />
        </svg>
      )}

      {/* Window Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px 7px 12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: dwellState.isLocked ? 'rgba(0, 229, 255, 0.06)' : 'transparent',
        }}
      >
        <span
          style={{
            color: '#e8eaed',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              backgroundColor: dwellState.isLocked ? '#00e5ff' : 'rgba(0, 229, 255, 0.55)',
              boxShadow: dwellState.isLocked ? '0 0 8px #00e5ff' : 'none',
              flexShrink: 0,
            }}
          />
          {window.title}
          <span
            data-testid="window-owner-badge"
            style={{
              marginLeft: 2,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: isRemote ? '#ff9f43' : '#9aa0a8',
              border: `1px solid ${isRemote ? 'rgba(255, 159, 67, 0.45)' : 'rgba(255, 255, 255, 0.18)'}`,
              borderRadius: 4,
              padding: '1px 5px',
              flexShrink: 0,
            }}
          >
            {isRemote ? 'REMOTE' : 'YOU'}
          </span>

          {dwellState.isLocked && (
            <span
              data-testid="window-locked-badge"
              style={{
                marginLeft: 2,
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: '#00e5ff',
                border: '1px solid rgba(0, 229, 255, 0.6)',
                borderRadius: 4,
                padding: '1px 5px',
                flexShrink: 0,
              }}
            >
              ATTACHED
            </span>
          )}
        </span>

        <div style={{ display: 'flex' }}>
          <button
            type="button"
            aria-label={`Minimize ${window.title}`}
            title="Minimize"
            onClick={(e) => {
              stopPropagation(e);
              onMinimize(window.id);
            }}
            style={windowButtonStyle}
          >
            −
          </button>
          <button
            type="button"
            aria-label={`Close ${window.title}`}
            title="Close"
            onClick={(e) => {
              stopPropagation(e);
              onClose(window.id);
            }}
            style={windowButtonStyle}
          >
            ✕
          </button>
        </div>
      </div>

      <div style={{ padding: '0', fontSize: 12, lineHeight: 1.5, height: 'calc(100% - 32px)' }}>
        {content}
      </div>
    </div>
  );
}

const windowButtonStyle = {
  background: 'none',
  border: 'none',
  color: '#9aa0a8',
  fontSize: 13,
  lineHeight: 1,
  padding: '3px 6px',
  cursor: 'pointer',
  borderRadius: 6,
} as const;
