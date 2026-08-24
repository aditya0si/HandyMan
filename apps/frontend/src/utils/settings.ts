import { useState, useEffect } from 'react';

export interface InputSettings {
  dominantHand: 'auto' | 'Left' | 'Right';
  sensitivity: 'Conservative' | 'Balanced' | 'Responsive';
  dwellDurationMs: number;
  reducedMotion: boolean;
  highContrast: boolean;
  gesturesEnabled: boolean;
  eyeAttentionEnabled: boolean;
  eyeAssistedTargeting: boolean;
}

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  dominantHand: 'auto',
  sensitivity: 'Balanced',
  dwellDurationMs: 700,
  reducedMotion: false,
  highContrast: false,
  gesturesEnabled: true,
  eyeAttentionEnabled: false,
  eyeAssistedTargeting: true,
};

export function getStoredInputSettings(): InputSettings {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('jarvis-input-settings');
      if (stored) {
        return { ...DEFAULT_INPUT_SETTINGS, ...JSON.parse(stored) };
      }
    }
  } catch (e) {
    // Ignore parse errors
  }
  return DEFAULT_INPUT_SETTINGS;
}

export function setStoredInputSettings(settings: InputSettings) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('jarvis-input-settings', JSON.stringify(settings));
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('jarvis-settings-changed'));
    }
  } catch (e) {
    // Ignore storage errors
  }
}

export function useInputSettings() {
  const [settings, setSettings] = useState<InputSettings>(getStoredInputSettings());

  useEffect(() => {
    const handleUpdate = () => {
      setSettings(getStoredInputSettings());
    };
    window.addEventListener('jarvis-settings-changed', handleUpdate);
    return () => window.removeEventListener('jarvis-settings-changed', handleUpdate);
  }, []);

  return settings;
}
