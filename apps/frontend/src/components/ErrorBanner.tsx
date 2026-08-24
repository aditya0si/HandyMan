interface ErrorBannerProps {
  title: string;
  message: string;
  /** When provided, renders a retry button that calls this handler. */
  onRetry?: () => void;
}

/**
 * Fixed, centered error panel used by the camera and hand-tracking pipelines
 * so failures are visible in the UI instead of only in the console.
 */
export function ErrorBanner({ title, message, onRetry }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 50,
        maxWidth: 460,
        background: 'rgba(16, 11, 11, 0.95)',
        backdropFilter: 'blur(18px)',
        border: '1px solid rgba(255, 90, 90, 0.55)',
        borderRadius: 12,
        padding: '18px 20px',
        color: '#ffd7d7',
        fontFamily:
          'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: 14,
        textAlign: 'center',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ marginBottom: onRetry ? 14 : 0 }}>{message}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 8,
            color: '#f4f5f7',
            cursor: 'pointer',
            font: 'inherit',
            fontWeight: 600,
            padding: '8px 20px',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
