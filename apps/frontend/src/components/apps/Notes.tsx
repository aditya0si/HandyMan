import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import { get as storageGet, set as storageSet } from '../../utils/storage';

/** Debounced-save window (ms) after the last keystroke (D10). */
const NOTE_SAVE_DEBOUNCE_MS = 500;

/**
 * Notes app (M8): a per-window textarea persisted under
 * 'jarvis:note:<windowId>' via utils/storage (the storage module owns the
 * prefix). Restore on mount; save debounced 500 ms after edits AND on
 * unmount (closing the window mid-debounce flushes — v8 check m proves it
 * live). StrictMode-safe (D10): restore never marks dirty, so the
 * simulated remount's cleanup flush cannot overwrite stored data; state
 * persists across the double effect run (same component instance).
 */
export function Notes({ windowId }: AppProps) {
  const storageKey = `note:${windowId}`;
  const [text, setText] = useState('');
  // M15 (D9): inline storage-refusal warning — only while a save was refused
  // (storage unavailable / quota), cleared on the next successful save.
  const [saveWarning, setSaveWarning] = useState('');
  // Refs mirror the latest text for the async save paths (the same
  // render-time ref-sync pattern FloatingWindow uses for its callbacks).
  const textRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  /** Reflects a storage.set() result: inline on refusal, cleared on success.
   *  Functional update — no stale-closure over saveWarning. */
  const markSaveResult = (ok: boolean): void => {
    setSaveWarning((current) =>
      ok ? (current === '' ? current : '') : 'Change not saved — local storage unavailable or full.',
    );
  };

  useEffect(() => {
    // Restore once per mount cycle. StrictMode re-runs this effect; the
    // second run reads the same stored value (setText is a no-op then).
    const stored = storageGet<string>(storageKey);
    if (stored !== null) {
      setText(stored);
      textRef.current = stored;
    }
    return () => {
      // Unmount flush: cancel any pending debounce, then save ONLY user
      // edits (dirty). Not dirty → no write (protects stored data across
      // StrictMode's simulated remount and plain re-mounts).
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        storageSet(storageKey, textRef.current);
      }
    };
  }, [storageKey]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setText(value);
    textRef.current = value;
    dirtyRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      dirtyRef.current = false;
      markSaveResult(storageSet(storageKey, textRef.current));
    }, NOTE_SAVE_DEBOUNCE_MS);
  };

  return (
    <div>
      <textarea
        data-testid="notes-textarea"
        value={text}
        onChange={handleChange}
        placeholder="Type notes here — saved locally per window…"
        spellCheck={false}
        style={{
          width: '100%',
          height: 44,
          boxSizing: 'border-box',
          resize: 'none',
          background: 'rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: 6,
          color: '#e8eaed',
          fontFamily: 'inherit',
          fontSize: 10,
          lineHeight: 1.4,
          padding: '3px 5px',
        }}
      />
      {saveWarning && (
        <div
          data-testid="notes-save-warning"
          style={{ color: '#ffd7d7', fontSize: 9, marginTop: 2 }}
        >
          {saveWarning}
        </div>
      )}
    </div>
  );
}
