import { useState, useEffect } from 'react';
import { useInputSettings, setStoredInputSettings } from '../utils/settings';

const overlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100vh',
  background: 'rgba(10, 11, 13, 0.95)',
  backdropFilter: 'blur(20px)',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  color: '#e8eaed',
  fontFamily: 'Inter, system-ui, sans-serif',
} as const;

export function Calibration() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  
  const settings = useInputSettings();

  useEffect(() => {
    const handleStart = () => {
      setActive(true);
      setStep(1);
      setProgress(0);
    };
    window.addEventListener('jarvis-start-calibration', handleStart);
    return () => window.removeEventListener('jarvis-start-calibration', handleStart);
  }, []);

  useEffect(() => {
    if (!active) return;
    
    // Simulate a 30s flow (for now we compress to ~12s for UX testing)
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          setStep(s => s + 1);
          return 0;
        }
        return p + 2; // Roughly 5 seconds per step
      });
    }, 100);
    
    if (step > 4) {
      clearInterval(interval);
      setActive(false);
      // Ensure we don't accidentally pause gestures during calibration
      setStoredInputSettings({ ...settings, gesturesEnabled: true });
    }
    
    return () => clearInterval(interval);
  }, [active, step]);

  if (!active) return null;

  const steps = [
    { title: 'Calibration', desc: 'Starting...' },
    { title: 'Check Camera Framing', desc: 'Ensure your hands are visible in the camera view.' },
    { title: 'Pinch Baseline', desc: 'Pinch your index and thumb together firmly.' },
    { title: 'Cursor Range', desc: 'Move your hand slowly across the entire screen.' },
    { title: 'Lighting Check', desc: 'Checking contrast and exposure...' },
  ];

  const currentStep = steps[step] || steps[0];

  return (
    <div style={overlayStyle}>
      <h2 style={{ fontSize: 24, fontWeight: 500, color: '#00e5ff', marginBottom: 8 }}>
        {currentStep.title}
      </h2>
      <p style={{ fontSize: 14, color: '#8b8f98', marginBottom: 40, maxWidth: 400, textAlign: 'center' }}>
        {currentStep.desc}
      </p>
      
      <div style={{ width: 300, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden', marginBottom: 40 }}>
        <div style={{ width: `${progress}%`, height: '100%', background: '#00e5ff', transition: 'width 0.1s linear' }} />
      </div>

      <button 
        onClick={() => setActive(false)}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: 6,
          color: '#e8eaed',
          padding: '8px 16px',
          fontSize: 12,
          cursor: 'pointer'
        }}
      >
        Cancel Calibration
      </button>
    </div>
  );
}
