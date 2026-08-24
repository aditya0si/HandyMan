import { useState, useEffect } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import { Weather } from './Weather';
import { News } from './News';
import { Markets } from './Markets';

const labelStyle = { color: '#8b8f98', marginBottom: 4, display: 'block' } as const;
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
const buttonStyle = {
  background: '#00e5ff',
  border: 'none',
  borderRadius: 6,
  color: '#0a0c10',
  fontFamily: 'inherit',
  fontWeight: 600,
  fontSize: 12,
  padding: '8px 16px',
  cursor: 'pointer',
  marginTop: 8,
} as const;

interface BriefingPreferences {
  name: string;
  city: string;
  topics: string;
  time: 'Morning' | 'Evening';
  cards: {
    news: boolean;
    weather: boolean;
    markets: boolean;
    agenda: boolean;
  };
  setupComplete: boolean;
}

const DEFAULT_PREFS: BriefingPreferences = {
  name: '',
  city: 'London',
  topics: 'Technology, AI',
  time: 'Morning',
  cards: {
    news: true,
    weather: true,
    markets: true,
    agenda: true,
  },
  setupComplete: false,
};

export function Briefing(props: AppProps) {
  const [prefs, setPrefs] = useState<BriefingPreferences | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('jarvis-briefing-prefs');
    if (stored) {
      try {
        setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(stored) });
      } catch {
        setPrefs(DEFAULT_PREFS);
      }
    } else {
      setPrefs(DEFAULT_PREFS);
    }
  }, []);

  if (!prefs) return null;

  if (!prefs.setupComplete) {
    return (
      <div style={{ padding: 20, color: '#f4f5f7', fontFamily: 'Inter, sans-serif', overflowY: 'auto', maxHeight: '100%' }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: '0 0 12px 0', color: '#e8eaed' }}>Welcome to JARVIS</h2>
        <p style={{ fontSize: 12, color: '#8b8f98', marginBottom: 16 }}>Configure your personal daily briefing.</p>

        <label style={labelStyle}>Display Name</label>
        <input
          style={inputStyle}
          value={prefs.name}
          onChange={(e) => setPrefs({ ...prefs, name: e.target.value })}
          placeholder="e.g. Tony"
        />

        <label style={labelStyle}>Home City</label>
        <input
          style={inputStyle}
          value={prefs.city}
          onChange={(e) => setPrefs({ ...prefs, city: e.target.value })}
        />

        <label style={labelStyle}>Preferred News Topics</label>
        <input
          style={inputStyle}
          value={prefs.topics}
          onChange={(e) => setPrefs({ ...prefs, topics: e.target.value })}
        />

        <label style={labelStyle}>Briefing Time</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['Morning', 'Evening'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setPrefs({ ...prefs, time: t })}
              style={{
                background: prefs.time === t ? '#00e5ff' : 'rgba(255, 255, 255, 0.08)',
                color: prefs.time === t ? '#0a0c10' : '#e8eaed',
                border: 'none',
                borderRadius: 6,
                padding: '5px 12px',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: prefs.time === t ? 600 : 400,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <label style={labelStyle}>Desired Cards</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
          {(['news', 'weather', 'markets', 'agenda'] as const).map((key) => (
            <label
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#e8eaed',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              <input
                type="checkbox"
                checked={prefs.cards[key]}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    cards: { ...prefs.cards, [key]: e.target.checked },
                  })
                }
              />
              {key}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            style={buttonStyle}
            onClick={() => {
              const updated = { ...prefs, setupComplete: true };
              setPrefs(updated);
              localStorage.setItem('jarvis-briefing-prefs', JSON.stringify(updated));
            }}
          >
            Start Briefing
          </button>
          <button
            style={{ ...buttonStyle, background: 'rgba(255, 255, 255, 0.1)', color: '#e8eaed' }}
            onClick={() => {
              const updated = { ...DEFAULT_PREFS, setupComplete: true };
              setPrefs(updated);
              localStorage.setItem('jarvis-briefing-prefs', JSON.stringify(updated));
            }}
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  // Composed Briefing View
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2 style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#e8eaed', fontFamily: 'Inter, sans-serif' }}>
          Good {prefs.time.toLowerCase()}, {prefs.name || 'Commander'}
        </h2>
        <button
          onClick={() => {
            const reset = { ...prefs, setupComplete: false };
            setPrefs(reset);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#8b8f98',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          ⚙ Customize
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Column: News (if enabled) */}
        {prefs.cards.news && (
          <div style={{ flex: 2, borderRight: '1px solid rgba(255, 255, 255, 0.08)', position: 'relative' }}>
            <News {...props} />
          </div>
        )}
        {/* Right Column: Weather, Markets & Agenda */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflowY: 'auto' }}>
          {prefs.cards.weather && (
            <div style={{ flex: 1, borderBottom: '1px solid rgba(255, 255, 255, 0.08)', position: 'relative', overflow: 'hidden' }}>
              <Weather {...props} />
            </div>
          )}
          {prefs.cards.markets && (
            <div style={{ flex: 1, borderBottom: '1px solid rgba(255, 255, 255, 0.08)', position: 'relative', overflow: 'hidden' }}>
              <Markets />
            </div>
          )}
          {prefs.cards.agenda && (
            <div style={{ flex: 1, padding: 12, color: '#8b8f98', fontSize: 11, fontFamily: 'Inter, sans-serif' }}>
              <div style={{ marginBottom: 6, color: '#e8eaed', fontWeight: 600 }}>Agenda (Mock)</div>
              <div>• 10:00 AM - Design Review</div>
              <div>• 01:30 PM - Team Sync</div>
              <div style={{ marginTop: 12, marginBottom: 6, color: '#e8eaed', fontWeight: 600 }}>Tasks (Mock)</div>
              <div>[ ] Review spatial gestures</div>
              <div>[ ] Calibrate webcam lighting</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
