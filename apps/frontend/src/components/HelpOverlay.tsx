import { useState, useEffect } from 'react';

const overlayStyle = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(10, 11, 13, 0.85)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 12,
  padding: '16px 24px',
  color: '#e8eaed',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 13,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  zIndex: 100,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
} as const;

export function HelpOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hasSeen = localStorage.getItem('jarvis-help-seen');
    if (!hasSeen) {
      setVisible(true);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && e.shiftKey) {
        setVisible(v => !v);
      }
    };
    const handleToggle = () => setVisible(v => !v);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('jarvis-toggle-help', handleToggle);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('jarvis-toggle-help', handleToggle);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem('jarvis-help-seen', 'true');
  };

  if (!visible) return null;

  return (
    <div style={overlayStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#00e5ff' }}>Gesture Controls</h3>
        <button 
          onClick={dismiss}
          style={{ background: 'transparent', border: 'none', color: '#8b8f98', cursor: 'pointer', fontSize: 16 }}
        >×</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
        <div>
          <strong style={{ color: '#fff' }}>Point / Hover</strong>
          <div style={{ color: '#a9aeb8', fontSize: 11, marginTop: 4 }}>Point index finger to hover targets</div>
        </div>
        <div>
          <strong style={{ color: '#fff' }}>Pinch Click</strong>
          <div style={{ color: '#a9aeb8', fontSize: 11, marginTop: 4 }}>Quick index-thumb tap to click</div>
        </div>
        <div>
          <strong style={{ color: '#fff' }}>Pinch Drag</strong>
          <div style={{ color: '#a9aeb8', fontSize: 11, marginTop: 4 }}>Hold pinch and move to drag cards</div>
        </div>
        <div>
          <strong style={{ color: '#fff' }}>Two-finger Scroll</strong>
          <div style={{ color: '#a9aeb8', fontSize: 11, marginTop: 4 }}>Index & middle finger together to scroll</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#8b8f98', marginTop: 8, textAlign: 'center' }}>
        Press <b>Shift + ?</b> to toggle this help anytime
      </div>
    </div>
  );
}
