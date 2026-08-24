import type { ReactNode } from 'react';
import type { WidgetStatus } from '../../utils/widgets/widgetData';

export interface WidgetCardProps {
  title: string;
  status: WidgetStatus;
  onRefresh?: () => void;
  children: ReactNode;
  subtitle?: string;
}

function statusColor(status: WidgetStatus): string {
  switch (status) {
    case 'live':
      return '#34d399';
    case 'stale':
      return '#fbbf24';
    case 'error':
      return '#f87171';
    case 'loading':
      return '#00e5ff';
    default:
      return '#8b8f98';
  }
}

function statusLabel(status: WidgetStatus): string {
  switch (status) {
    case 'live':
      return 'live';
    case 'stale':
      return 'cached';
    case 'error':
      return 'error';
    case 'loading':
      return 'loading';
    default:
      return status;
  }
}

export function WidgetCard({ title, status, onRefresh, children, subtitle }: WidgetCardProps) {
  const dot = statusColor(status);
  return (
    <div
      data-testid={`widget-card-${title.toLowerCase().replace(/\s+/g, '-')}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        color: '#f4f5f7',
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255,255,255,0.02)',
          flexShrink: 0,
        }}
      >
        <span
          data-testid="widget-status-dot"
          data-status={status}
          aria-label={`status ${status}`}
          title={statusLabel(status)}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: dot,
            boxShadow: status === 'live' ? `0 0 6px ${dot}` : 'none',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#e8eaed',
            flex: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
        {subtitle && (
          <span style={{ fontSize: 10, color: '#8b8f98', flexShrink: 0 }}>{subtitle}</span>
        )}
        <button
          type="button"
          aria-label={`Refresh ${title}`}
          title="Refresh"
          data-testid={`widget-refresh-${title.toLowerCase().replace(/\s+/g, '-')}`}
          onClick={onRefresh}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 6,
            color: '#b7bcc4',
            fontSize: 12,
            lineHeight: 1,
            padding: '3px 7px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          ↻
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>{children}</div>
    </div>
  );
}
