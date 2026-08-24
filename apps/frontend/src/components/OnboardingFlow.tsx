import { useState } from 'react';

export function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: 'Welcome to JARVIS',
      content: 'A spatial command center built to make your digital life faster, more organized, and deeply enjoyable.',
      action: 'Next'
    },
    {
      title: 'The Core Promise',
      content: 'Gestures don\'t replace your keyboard all day. They make glanceable information and quick actions feel seamless. Mouse and keyboard remain complete fallbacks at all times.',
      action: 'Next'
    },
    {
      title: 'Privacy First',
      content: 'Your camera data is processed 100% locally in your browser. We never see your room, your face, or your hands. Only anonymous operational telemetry is collected to improve stability.',
      action: 'Enter the Void'
    }
  ];

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  return (
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(5, 6, 8, 0.95)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter, sans-serif',
        color: '#f4f5f7'
      }}>
        <div style={{
          maxWidth: '480px',
          width: '100%',
          padding: '40px',
          background: 'linear-gradient(180deg, rgba(20,25,35,0.8) 0%, rgba(10,12,16,0.8) 100%)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
          textAlign: 'center'
        }}>
          <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '16px', color: '#fff', letterSpacing: '-0.02em' }}>
            {steps[step].title}
          </h1>
          <p style={{ fontSize: '16px', lineHeight: 1.6, color: '#b0b5c0', marginBottom: '32px' }}>
            {steps[step].content}
          </p>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              {steps.map((_, i) => (
                <div key={i} style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: i === step ? '#00e5ff' : 'rgba(255,255,255,0.2)'
                }} />
              ))}
            </div>
            <button
              onClick={handleNext}
              style={{
                background: '#00e5ff',
                color: '#000',
                border: 'none',
                padding: '10px 24px',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
            >
              {steps[step].action}
            </button>
          </div>
        </div>
      </div>
  );
}
