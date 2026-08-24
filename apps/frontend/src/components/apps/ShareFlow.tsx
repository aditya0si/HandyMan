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

export function ShareFlow({}: AppProps) {
  const [copied, setCopied] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);

  const handleCopyLink = () => {
    // In a real app, generate a unique link for the workspace
    const link = `${window.location.origin}/?workspaceId=default_workspace`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTogglePresent = () => {
    const nextState = !isPresenting;
    setIsPresenting(nextState);
    window.dispatchEvent(new CustomEvent('jarvis-present-toggle', { detail: nextState }));
  };

  return (
    <div style={{ fontSize: 11, lineHeight: 1.5, color: '#e8eaed' }}>
      <div style={{ fontWeight: 600, marginBottom: 8, color: '#f4f5f7' }}>Share Workspace</div>
      <p style={{ color: '#8b8f98', marginBottom: 12 }}>
        Invite others to collaborate in this spatial environment.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ color: '#8b8f98' }}>Current Role</span>
        <span style={{ background: '#3b82f6', color: '#fff', padding: '1px 6px', borderRadius: 4, fontSize: 9 }}>OWNER</span>
      </div>

      <button onClick={handleCopyLink} style={buttonStyle}>
        {copied ? 'Copied to Clipboard!' : 'Copy Invite Link'}
      </button>

      <button onClick={handleTogglePresent} style={{ ...buttonStyle, marginTop: 4, background: isPresenting ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)', border: isPresenting ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(59, 130, 246, 0.4)', color: isPresenting ? '#f87171' : '#60a5fa' }}>
        {isPresenting ? 'Stop Present Mode' : 'Start Present Mode'}
      </button>
    </div>
  );
}
