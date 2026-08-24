import { useState } from 'react';
import type { AppProps } from '../../utils/appRegistry';

export function Legal(_props: AppProps) {
  const [tab, setTab] = useState<'privacy' | 'terms' | 'accessibility'>('privacy');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '24px', color: '#e8eaed', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 20px 0', letterSpacing: '-0.02em' }}>Legal & Policies</h2>
        
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '8px' }}>
          {(['privacy', 'terms', 'accessibility'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'transparent',
                border: 'none',
                color: tab === t ? '#00e5ff' : '#8b8f98',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: tab === t ? 600 : 400,
                padding: '4px 8px',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', fontSize: '14px', lineHeight: 1.6, paddingRight: '12px' }}>
          {tab === 'privacy' && (
            <div>
              <h3 style={{ marginTop: 0, color: '#f4f5f7' }}>Privacy Policy & Camera Data</h3>
              <p>JARVIS is a spatial command center designed with privacy first.</p>
              <ul style={{ paddingLeft: '20px' }}>
                <li style={{ marginBottom: '8px' }}><strong>Zero Camera Data Transmission:</strong> All video frames, hand tracking, and eye attention landmarks are processed 100% locally on your device within the browser via MediaPipe. We never send your camera feed to our servers.</li>
                <li style={{ marginBottom: '8px' }}><strong>Operational Telemetry:</strong> We collect anonymous crash reports and operational metrics (e.g., latency, error counts) to improve stability. Raw PII is never included.</li>
                <li style={{ marginBottom: '8px' }}><strong>Integrations:</strong> Third-party integrations (e.g., Calendar) connect directly using secure OAuth. Tokens are encrypted at rest.</li>
              </ul>
            </div>
          )}
          {tab === 'terms' && (
            <div>
              <h3 style={{ marginTop: 0, color: '#f4f5f7' }}>Terms of Service</h3>
              <p>By using the JARVIS closed beta, you agree to participate in an experimental spatial computing environment.</p>
              <p>The service is provided "as is". We reserve the right to reset accounts, clear data, or modify features during the beta period without prior notice.</p>
            </div>
          )}
          {tab === 'accessibility' && (
            <div>
              <h3 style={{ marginTop: 0, color: '#f4f5f7' }}>Accessibility Statement</h3>
              <p>JARVIS is built on the principle that gestures accelerate actions but must never trap the user. Mouse and keyboard remain complete fallbacks for all functionality.</p>
              <p>You can adjust gesture sensitivity, disable animations, and toggle eye-attention tracking in the Settings app to suit your needs.</p>
            </div>
          )}
      </div>
    </div>
  );
}
