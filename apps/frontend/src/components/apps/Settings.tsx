import type { AppProps } from '../../utils/appRegistry';
import { useInputSettings, setStoredInputSettings } from '../../utils/settings';
import type { InputSettings } from '../../utils/settings';

const labelStyle = { color: '#8b8f98', marginBottom: 4, display: 'block', fontSize: 12 } as const;
const inputStyle = {
  background: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: 6,
  color: '#e8eaed',
  padding: '6px 8px',
  width: '100%',
  fontFamily: 'inherit',
  fontSize: 12,
  marginBottom: 12,
} as const;

export function Settings(_props: AppProps) {
  const settings = useInputSettings();

  const updateSettings = (partial: Partial<InputSettings>) => {
    setStoredInputSettings({ ...settings, ...partial });
  };

  return (
    <div style={{ padding: 20, color: '#f4f5f7', fontFamily: 'Inter, sans-serif', overflowY: 'auto', maxHeight: '100%' }}>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: '0 0 16px 0', color: '#e8eaed' }}>Settings</h2>
      
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 13, color: '#00e5ff', marginBottom: 12 }}>Input & Gestures</h3>
        
        <label style={labelStyle}>Enable Gestures</label>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e8eaed', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={settings.gesturesEnabled} 
              onChange={e => updateSettings({ gesturesEnabled: e.target.checked })} 
            />
            {settings.gesturesEnabled ? 'Enabled' : 'Paused (Keyboard/Mouse only)'}
          </label>
        </div>

        <label style={labelStyle}>Dominant Hand</label>
        <select 
          style={inputStyle}
          value={settings.dominantHand}
          onChange={e => updateSettings({ dominantHand: e.target.value as any })}
        >
          <option value="auto">Auto-detect</option>
          <option value="Left">Left Hand</option>
          <option value="Right">Right Hand</option>
        </select>

        <label style={labelStyle}>Gesture Sensitivity</label>
        <select 
          style={inputStyle}
          value={settings.sensitivity}
          onChange={e => updateSettings({ sensitivity: e.target.value as any })}
        >
          <option value="Conservative">Conservative (Fewer false positives)</option>
          <option value="Balanced">Balanced (Default)</option>
          <option value="Responsive">Responsive (Faster, but jumpier)</option>
        </select>

        <label style={labelStyle}>Dwell Duration (ms): {settings.dwellDurationMs}</label>
        <input 
          type="range" 
          min="200" 
          max="2000" 
          step="100" 
          style={{ width: '100%', marginBottom: 12 }}
          value={settings.dwellDurationMs}
          onChange={e => updateSettings({ dwellDurationMs: Number(e.target.value) })}
        />

        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e8eaed', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={settings.reducedMotion} 
              onChange={e => updateSettings({ reducedMotion: e.target.checked })} 
            />
            Reduced Motion
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e8eaed', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={settings.highContrast} 
              onChange={e => updateSettings({ highContrast: e.target.checked })} 
            />
            High Contrast Feedback
          </label>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 13, color: '#00e5ff', marginBottom: 8 }}>Eye & Face Attention (Experimental)</h3>
        <p style={{ fontSize: 11, color: '#8b8f98', margin: '0 0 12px 0', lineHeight: 1.4 }}>
          Assists card focus and pauses background animations when looking away. 100% processed locally on device; no face or gaze data ever leaves the browser.
        </p>

        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e8eaed', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={settings.eyeAttentionEnabled} 
              onChange={e => updateSettings({ eyeAttentionEnabled: e.target.checked })} 
            />
            Enable Eye & Face Attention
          </label>
        </div>

        {settings.eyeAttentionEnabled && (
          <div style={{ marginBottom: 10, paddingLeft: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e8eaed', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={settings.eyeAssistedTargeting} 
                onChange={e => updateSettings({ eyeAssistedTargeting: e.target.checked })} 
              />
              Assist Gesture Targeting with Gaze
            </label>
          </div>
        )}
      </div>
      
      <div>
        <button 
          onClick={() => window.dispatchEvent(new CustomEvent('jarvis-start-calibration'))}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 6,
            color: '#e8eaed',
            padding: '8px 16px',
            fontSize: 12,
            cursor: 'pointer',
            width: '100%'
          }}
        >
          Start Hand Calibration
        </button>
        <div style={{ color: '#8b8f98', fontSize: 11, marginTop: 6, textAlign: 'center' }}>
          Recalibrate if gestures feel inaccurate.
        </div>
      </div>

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <h3 style={{ fontSize: 13, color: '#00e5ff', marginBottom: 12 }}>Account & Legal</h3>
        
        <button 
          onClick={() => window.dispatchEvent(new CustomEvent('jarvis-open-app', { detail: { appId: 'legal' } }))}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#e8eaed',
            padding: '8px 0',
            fontSize: 12,
            cursor: 'pointer',
            textAlign: 'left',
            display: 'block',
            width: '100%',
            textDecoration: 'underline'
          }}
        >
          View Legal & Policies
        </button>

        <button 
          onClick={() => alert('Export account data functionality will be available in the next beta phase.')}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#e8eaed',
            padding: '8px 0',
            fontSize: 12,
            cursor: 'pointer',
            textAlign: 'left',
            display: 'block',
            width: '100%'
          }}
        >
          Export Account Data
        </button>

        <button 
          onClick={() => {
            if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
              alert('Account deletion request received. Please contact support to finalize during the beta.');
            }
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#ff4d4f',
            padding: '8px 0',
            fontSize: 12,
            cursor: 'pointer',
            textAlign: 'left',
            display: 'block',
            width: '100%'
          }}
        >
          Delete Account
        </button>
      </div>
    </div>
  );
}
