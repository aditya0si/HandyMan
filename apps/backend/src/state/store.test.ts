import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WindowState } from '@jarvis/shared';
import { WorkspaceStore } from './store';

/** A valid wire window for the tests. */
function win(id: string): WindowState {
  return {
    id,
    title: `T-${id}`,
    owner: 'user-a',
    position: [0.1, 0.2, 0.3],
    rotationY: 0,
    scale: 1.5,
    zIndex: 1,
    lastModified: 1,
  };
}

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-store-')), 'workspace.json');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('WorkspaceStore (M13 D1)', () => {
  it('round-trips: save -> flush -> a NEW store loads the same windows', () => {
    const file = tmpFile();
    const store = new WorkspaceStore(file);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(store.load().windows).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1); // missing file: ONE warn, no crash

    store.scheduleSave([win('a'), win('b')]);
    store.flush();
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({
      version: 1,
      windows: [win('a'), win('b')],
    });

    const second = new WorkspaceStore(file);
    expect(second.load().windows).toEqual([win('a'), win('b')]);
  });

  it('corrupt file -> empty workspace + exactly one warn, never a crash', () => {
    const file = tmpFile();
    fs.writeFileSync(file, '{not json', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new WorkspaceStore(file);
    expect(store.load().windows).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('debounce coalesces: N schedules inside the window -> ONE disk write', () => {
    vi.useFakeTimers();
    const file = tmpFile();
    const store = new WorkspaceStore(file, 1000);
    const write = vi.spyOn(fs, 'writeFileSync'); // passthrough spy
    store.scheduleSave([win('a')]);
    store.scheduleSave([win('a'), win('b')]);
    store.scheduleSave([win('a'), win('b'), win('c')]);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1100);
    expect(write).toHaveBeenCalledTimes(1);
    // The LATEST pending snapshot is what landed.
    expect(store.read().windows).toEqual([win('a'), win('b'), win('c')]);
  });

  it('atomic write: renameSync receives the .tmp path; no tmp leftovers', () => {
    const file = tmpFile();
    const store = new WorkspaceStore(file);
    store.load();
    const rename = vi.spyOn(fs, 'renameSync'); // passthrough spy
    store.scheduleSave([win('x')]);
    store.flush();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(String(rename.mock.calls[0][0]).endsWith('.tmp')).toBe(true);
    // The directory holds ONLY the final file — no .tmp remains.
    expect(fs.readdirSync(path.dirname(file))).toEqual(['workspace.json']);
  });

  it('read() flushes a pending save first (save -> GET round-trip)', () => {
    vi.useFakeTimers();
    const file = tmpFile();
    const store = new WorkspaceStore(file, 60_000); // never fires on its own
    store.load();
    store.scheduleSave([win('late')]);
    expect(fs.existsSync(file)).toBe(false);
    expect(store.read().windows).toEqual([win('late')]);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).windows).toEqual([win('late')]);
  });
});
