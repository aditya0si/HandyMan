import { describe, expect, it, vi } from 'vitest';
import {
  cameraScriptUrl,
  createMediaPipeScriptLoader,
  handsScriptUrl,
} from './mediaPipeLoader';
import type { ScriptLoader } from './mediaPipeLoader';

describe('mediaPipeLoader (M15 D10 / M14 D10 CDN path)', () => {
  it('exposes the ?url asset URLs for the two solution scripts', () => {
    expect(handsScriptUrl).toContain('hands.js');
    expect(cameraScriptUrl).toContain('camera_utils.js');
  });

  it('loads both scripts and resolves; a second load() reuses the shared promise', async () => {
    const loadScript = vi.fn<ScriptLoader>(
      (_src: string) => Promise.resolve(),
    );
    const loader = createMediaPipeScriptLoader({ loadScript });
    await expect(loader.load()).resolves.toBeUndefined();
    await expect(loader.load()).resolves.toBeUndefined();
    expect(loadScript).toHaveBeenCalledTimes(2);
  });

  it('rejects when a script fails — the CDN-fail hand to HandTracker init', async () => {
    const loadScript = vi.fn<ScriptLoader>((src: string) =>
      Promise.reject(new Error(`failed to load ${src}`)),
    );
    const loader = createMediaPipeScriptLoader({ loadScript });
    await expect(loader.load()).rejects.toThrow('failed to load');
  });
});
