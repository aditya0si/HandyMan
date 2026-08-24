import { useState } from 'react';
import type { AppProps } from '../../utils/appRegistry';

const buttonStyle = {
  background: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: 6,
  color: '#d3d6db',
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '4px 10px',
  cursor: 'pointer',
  width: '100%',
  marginTop: 8,
} as const;

const inputStyle = {
  background: 'rgba(0, 0, 0, 0.2)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: 6,
  color: '#ffffff',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '6px 10px',
  width: '100%',
  boxSizing: 'border-box' as const,
  outline: 'none',
} as const;

export function AuthCard({}: AppProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'' | 'loading' | 'sent' | 'error'>('');
  const [errorMsg, setErrorMsg] = useState('');
  
  // For now, token is just simulated since we don't have a robust client state manager yet
  const [token, setToken] = useState<string | null>(localStorage.getItem('jarvis_token'));

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus('loading');
    
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus('sent');
      } else {
        setStatus('error');
        setErrorMsg(data.error || 'Failed to send link');
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg('Network error');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('jarvis_token');
    setToken(null);
  };

  if (token) {
    return (
      <div style={{ fontSize: 11, lineHeight: 1.5, color: '#e8eaed' }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: '#f4f5f7' }}>Account</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: '#8b8f98' }}>Status</span>
          <span style={{ color: '#4ade80' }}>Authenticated</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#8b8f98' }}>Plan</span>
          <span style={{ background: '#3b82f6', color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: 9 }}>PRO</span>
        </div>
        <button onClick={handleLogout} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={{ fontSize: 11, lineHeight: 1.5, color: '#e8eaed' }}>
      <div style={{ fontWeight: 600, marginBottom: 8, color: '#f4f5f7' }}>Sign In to JARVIS</div>
      <p style={{ color: '#8b8f98', marginBottom: 12 }}>
        Sign in to sync your spatial workspace, connect integrations, and use the AI proxy.
      </p>
      
      {status === 'sent' ? (
        <div style={{ padding: '8px', background: 'rgba(74, 222, 128, 0.1)', border: '1px solid rgba(74, 222, 128, 0.2)', borderRadius: 6, color: '#4ade80' }}>
          Check your email for the magic link!
        </div>
      ) : (
        <form onSubmit={handleLogin}>
          <input 
            type="email" 
            placeholder="you@example.com" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
            disabled={status === 'loading'}
          />
          {status === 'error' && <div style={{ color: '#ef4444', marginTop: 4 }}>{errorMsg}</div>}
          <button type="submit" style={buttonStyle} disabled={status === 'loading'}>
            {status === 'loading' ? 'Sending...' : 'Send Magic Link'}
          </button>
        </form>
      )}
    </div>
  );
}
