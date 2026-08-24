import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GoogleCalendarProvider, TodoistTaskProvider, MockMusicProvider, MockLinksProvider } from './mockProviders';

// Stub localStorage for Node test environment
const localStorageMock = {
  getItem: vi.fn().mockReturnValue('test-token'),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

describe('Integration Providers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GoogleCalendarProvider', () => {
    it('starts disconnected and exposes correct interface', () => {
      const provider = new GoogleCalendarProvider();
      expect(provider.state).toBe('disconnected');
      expect(provider.id).toBe('calendar');
      expect(provider.name).toBe('Google Calendar');
      expect(provider.getData()).toBeNull();
      expect(provider.getLastError()).toBeNull();
    });

    it('disconnects and clears cached data', async () => {
      const provider = new GoogleCalendarProvider();
      await provider.disconnect();
      expect(provider.state).toBe('disconnected');
      expect(provider.getData()).toBeNull();
    });
  });

  describe('TodoistTaskProvider', () => {
    it('starts disconnected and exposes correct interface', () => {
      const provider = new TodoistTaskProvider();
      expect(provider.state).toBe('disconnected');
      expect(provider.id).toBe('tasks');
      expect(provider.name).toBe('Todoist');
      expect(provider.getData()).toBeNull();
    });

    it('disconnects and clears cached data', async () => {
      const provider = new TodoistTaskProvider();
      await provider.disconnect();
      expect(provider.state).toBe('disconnected');
      expect(provider.getData()).toBeNull();
    });
  });
  
  describe('MockMusicProvider', () => {
    it('can toggle play/pause', async () => {
      const provider = new MockMusicProvider();
      await provider.connect();
      
      const refreshPromise = provider.refresh();
      vi.advanceTimersByTime(300);
      await refreshPromise;
      
      expect(provider.getData()?.isPlaying).toBe(true);
      
      const togglePromise = provider.togglePlayPause();
      vi.advanceTimersByTime(300);
      await togglePromise;
      
      expect(provider.getData()?.isPlaying).toBe(false);
    });

    it('can adjust volume', async () => {
      const provider = new MockMusicProvider();
      await provider.connect();
      
      const p1 = provider.setVolume(80);
      vi.advanceTimersByTime(300);
      await p1;
      expect(provider.getData()?.volume).toBe(80);
      
      // Clamp bounds
      const p2 = provider.setVolume(150);
      vi.advanceTimersByTime(300);
      await p2;
      expect(provider.getData()?.volume).toBe(100);

      const p3 = provider.setVolume(-20);
      vi.advanceTimersByTime(300);
      await p3;
      expect(provider.getData()?.volume).toBe(0);
    });
  });

  describe('MockLinksProvider & Connection Lifecycle', () => {
    it('handles disconnect and reconnect', async () => {
      const provider = new MockMusicProvider();
      await provider.connect();
      expect(provider.state).toBe('connected');

      await provider.disconnect();
      expect(provider.state).toBe('disconnected');
      expect(provider.getData()).toBeNull();

      // Refresh when disconnected throws
      await expect(provider.refresh()).rejects.toThrow('Not connected');

      // Reconnect
      await provider.connect();
      expect(provider.state).toBe('connected');
    });

    it('fetches saved links and caches them', async () => {
      const provider = new MockLinksProvider();
      await provider.connect();
      const refreshPromise = provider.refresh();
      vi.advanceTimersByTime(400);
      const links = await refreshPromise;
      expect(links.length).toBeGreaterThan(0);
      expect(links[0].url).toContain('http');
    });
  });
});
