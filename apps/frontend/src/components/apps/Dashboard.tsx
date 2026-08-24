import { useEffect, useState, useMemo } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import { listApps } from '../../utils/appRegistry';
import { LocalAnalytics } from '@jarvis/shared';

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

function formatClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const labelStyle = { color: '#8b8f98' } as const;
const valueStyle = {
  color: '#e8eaed',
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
} as const;
const pairStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  whiteSpace: 'nowrap',
} as const;
const buttonStyle = {
  background: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: 6,
  color: '#d3d6db',
  fontFamily: 'inherit',
  fontSize: 9.5,
  padding: '2px 7px',
  cursor: 'pointer',
} as const;
const feedbackBtnStyle = {
  ...buttonStyle,
  fontSize: 12,
  padding: '3px 10px',
} as const;

/** Singleton analytics instance shared across the app. */
const analytics = new LocalAnalytics();

/**
 * Dashboard app (M8): LOCAL-ONLY system stats + a 1 s live ticker + the
 * app launcher. NO external APIs, no fetch, no keys — everything comes
 * from navigator/performance. The ticker is an ordinary per-app UI effect
 * with cleanup (D11) — NOT the M4 perf-logger no-timers discipline.
 * The window-controls strip demonstrates the AppContext contract live
 * (D12): maximize = restore-if-minimized + focus (interim semantics).
 * Chat (M9) and Search (M10) are registered apps — no placeholder launcher entries remain.
 */
export function Dashboard({
  maximize,
  minimize,
  close,
  openApp,
  saveWorkspace,
  loadWorkspace,
}: AppProps) {
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [heapMb, setHeapMb] = useState<number | null>(() => readUsedHeapMb());
  // M13 (D13): inline Save/Load status (never a console error path).
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [showDiag, setShowDiag] = useState(false);

  // Check for ?diag=1 query parameter
  const isDiagMode = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('diag') === '1';
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    analytics.track('dashboard_opened');
    const id = window.setInterval(() => {
      setClock(formatClock(new Date()));
      setHeapMb(readUsedHeapMb());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const memoryGb = readDeviceMemoryGb();

  /** M13 (D13): Save/Load ride the AppContext hooks (backend REST);
   *  results render inline — offline/backend-down surfaces here too. */
  const handleSave = async (): Promise<void> => {
    if (!saveWorkspace) return;
    setWorkspaceStatus('saving…');
    const result = await saveWorkspace();
    setWorkspaceStatus(result.ok ? `saved ${result.count} ✓` : result.error);
  };
  const handleLoad = async (): Promise<void> => {
    if (!loadWorkspace) return;
    setWorkspaceStatus('loading…');
    const result = await loadWorkspace();
    setWorkspaceStatus(result.ok ? `loaded ${result.count} ✓` : result.error);
  };

  const handleFeedback = (rating: 'positive' | 'negative'): void => {
    analytics.recordFeedback('workspace_experience', rating);
    setFeedbackSent(true);
    setTimeout(() => setFeedbackSent(false), 3000);
  };

  return (
    <div style={{ fontSize: 10, lineHeight: 1.5 }}>
      <div
        data-testid="dash-clock"
        style={{ ...pairStyle, color: '#f4f5f7', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
      >
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
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          type="button"
          data-testid="workspace-save"
          onClick={() => void handleSave()}
          disabled={!saveWorkspace}
          style={saveWorkspace ? buttonStyle : { ...buttonStyle, cursor: 'default', opacity: 0.5 }}
        >
          Save ws
        </button>
        <button
          type="button"
          data-testid="workspace-load"
          onClick={() => void handleLoad()}
          disabled={!loadWorkspace}
          style={loadWorkspace ? buttonStyle : { ...buttonStyle, cursor: 'default', opacity: 0.5 }}
        >
          Load ws
        </button>
      </div>
      {workspaceStatus && (
        <div data-testid="workspace-status" style={{ color: '#8b8f98', marginTop: 2 }}>
          {workspaceStatus}
        </div>
      )}
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

      {/* --- Feedback Widget --- */}
      <div
        data-testid="feedback-widget"
        style={{
          marginTop: 8,
          padding: '6px 0',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div style={{ color: '#8b8f98', marginBottom: 4, fontSize: 9.5 }}>
          Was this workspace useful today?
        </div>
        {feedbackSent ? (
          <div
            data-testid="feedback-thanks"
            style={{ color: '#4ade80', fontSize: 9.5 }}
          >
            Thanks for your feedback! ✓
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              data-testid="feedback-positive"
              onClick={() => handleFeedback('positive')}
              style={feedbackBtnStyle}
            >
              👍
            </button>
            <button
              type="button"
              data-testid="feedback-negative"
              onClick={() => handleFeedback('negative')}
              style={feedbackBtnStyle}
            >
              👎
            </button>
          </div>
        )}
      </div>

      {/* --- Developer Diagnostics (toggled by ?diag=1 or button) --- */}
      {isDiagMode && (
        <button
          type="button"
          data-testid="diag-toggle"
          onClick={() => setShowDiag((prev) => !prev)}
          style={{ ...buttonStyle, marginTop: 4, width: '100%' }}
        >
          {showDiag ? 'Hide' : 'Show'} Diagnostics
        </button>
      )}
      {isDiagMode && showDiag && <DiagnosticsPanel analytics={analytics} />}
    </div>
  );
}

/** Developer-only diagnostics panel shown via ?diag=1 query param. */
function DiagnosticsPanel({ analytics: a }: { analytics: LocalAnalytics }) {
  const snap = a.snapshot();
  const counters = Object.entries(snap.counters).sort(([, a], [, b]) => b - a);
  const feedback = snap.feedback;

  return (
    <div
      data-testid="diag-panel"
      style={{
        marginTop: 6,
        padding: 6,
        background: 'rgba(0,0,0,0.3)',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: 9,
        maxHeight: 180,
        overflowY: 'auto',
      }}
    >
      <div style={{ color: '#facc15', fontWeight: 600, marginBottom: 4 }}>
        🔧 DIAGNOSTICS
      </div>
      <div style={{ color: '#8b8f98', marginBottom: 2 }}>
        Session: {snap.sessionId.slice(0, 8)}… | Events: {snap.events.length}
      </div>

      {counters.length > 0 && (
        <>
          <div style={{ color: '#a5b4fc', fontWeight: 600, marginTop: 4 }}>Counters</div>
          {counters.map(([key, val]) => (
            <div key={key} style={pairStyle}>
              <span style={labelStyle}>{key}</span>
              <span style={valueStyle}>{val}</span>
            </div>
          ))}
        </>
      )}

      {feedback.length > 0 && (
        <>
          <div style={{ color: '#a5b4fc', fontWeight: 600, marginTop: 4 }}>
            Feedback ({feedback.length})
          </div>
          {feedback.slice(-5).map((f, i) => (
            <div key={i} style={{ ...pairStyle, color: f.rating === 'positive' ? '#4ade80' : '#f87171' }}>
              <span>{f.featureId}</span>
              <span>{f.rating === 'positive' ? '👍' : '👎'} {new Date(f.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </>
      )}

      <button
        type="button"
        data-testid="diag-reset"
        onClick={() => { a.reset(); window.location.reload(); }}
        style={{ ...buttonStyle, marginTop: 6, color: '#f87171' }}
      >
        Reset Analytics
      </button>
    </div>
  );
}
