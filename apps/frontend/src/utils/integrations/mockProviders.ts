import { RateLimitedCache, type ConnectionState, type IntegrationProvider } from './integrationProvider';

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  joinUrl?: string;
}

export class GoogleCalendarProvider implements IntegrationProvider<CalendarEvent[]> {
  id = 'calendar';
  name = 'Google Calendar';
  state: ConnectionState = 'disconnected';
  private error: string | null = null;
  private cache = new RateLimitedCache<CalendarEvent[]>(async () => {
    const token = localStorage.getItem('jarvis_token');
    if (!token) throw new Error('Not logged in');

    const res = await fetch('/api/integrations/calendar', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401) {
      this.state = 'disconnected';
      throw new Error('Not connected to Google Calendar');
    }

    if (!res.ok) throw new Error('Failed to fetch calendar');

    const data = await res.json();
    return data.events.map((e: any) => ({
      id: e.id,
      title: e.title,
      start: new Date(e.start),
      end: new Date(e.end),
      joinUrl: e.joinUrl
    }));
  }, 10000);

  async connect(): Promise<void> {
    const { initiateOAuthFlow } = await import('./oauth');
    await initiateOAuthFlow('google');
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected';
    this.cache.clear();
  }

  async refresh(force?: boolean): Promise<CalendarEvent[]> {
    try {
      this.state = 'loading';
      const data = await this.cache.get(force);
      this.state = 'connected';
      return data;
    } catch (e: any) {
      if (e.message !== 'Not connected to Google Calendar') {
        this.state = 'error';
        this.error = e.message;
      }
      throw e;
    }
  }

  getData(): CalendarEvent[] | null {
    return this.cache.getSync();
  }

  getLastError(): string | null {
    return this.error;
  }
}

export interface TaskItem {
  id: string;
  title: string;
  isOverdue: boolean;
  isCompleted: boolean;
}

export class TodoistTaskProvider implements IntegrationProvider<TaskItem[]> {
  id = 'tasks';
  name = 'Todoist';
  state: ConnectionState = 'disconnected';
  private error: string | null = null;
  
  private cache = new RateLimitedCache<TaskItem[]>(async () => {
    const token = localStorage.getItem('jarvis_token');
    if (!token) throw new Error('Not logged in');

    const res = await fetch('/api/integrations/tasks', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401) {
      this.state = 'disconnected';
      throw new Error('Not connected to Todoist');
    }

    if (!res.ok) throw new Error('Failed to fetch tasks');

    const data = await res.json();
    return data.tasks;
  }, 10000);

  async connect(): Promise<void> {
    const { initiateOAuthFlow } = await import('./oauth');
    await initiateOAuthFlow('todoist');
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected';
    this.cache.clear();
  }

  async refresh(force?: boolean): Promise<TaskItem[]> {
    try {
      this.state = 'loading';
      const data = await this.cache.get(force);
      this.state = 'connected';
      return data;
    } catch (e: any) {
      if (e.message !== 'Not connected to Todoist') {
        this.state = 'error';
        this.error = e.message;
      }
      throw e;
    }
  }

  getData(): TaskItem[] | null {
    return this.cache.getSync();
  }

  getLastError(): string | null {
    return this.error;
  }

  async completeTask(_taskId: string): Promise<void> {
    // In a real app we'd send a POST to our backend to close the task
    // For now just force cache update
    await this.cache.get(true);
  }
}

export interface MusicState {
  trackName: string;
  artist: string;
  albumArt?: string;
  isPlaying: boolean;
  volume: number; // 0-100
}

export class MockMusicProvider implements IntegrationProvider<MusicState> {
  id = 'music';
  name = 'Spotify';
  state: ConnectionState = 'disconnected';
  private error: string | null = null;
  private musicState: MusicState = {
    trackName: 'Spatial Audio Demo',
    artist: 'JARVIS Beats',
    isPlaying: true,
    volume: 50,
  };
  
  private cache = new RateLimitedCache<MusicState>(async () => {
    await new Promise((r) => setTimeout(r, 300));
    return { ...this.musicState };
  }, 5000);

  async connect(): Promise<void> {
    this.state = 'connected';
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected';
    this.cache.clear();
  }

  async refresh(force?: boolean): Promise<MusicState> {
    if (this.state !== 'connected') throw new Error('Not connected');
    return this.cache.get(force);
  }

  getData(): MusicState | null {
    return this.cache.getSync();
  }

  getLastError(): string | null {
    return this.error;
  }

  async togglePlayPause(): Promise<void> {
    this.musicState.isPlaying = !this.musicState.isPlaying;
    await this.cache.get(true);
  }
  
  async setVolume(vol: number): Promise<void> {
    this.musicState.volume = Math.max(0, Math.min(100, vol));
    await this.cache.get(true);
  }
}

export interface SavedLink {
  id: string;
  title: string;
  url: string;
}

export class MockLinksProvider implements IntegrationProvider<SavedLink[]> {
  id = 'links';
  name = 'Saved Links';
  state: ConnectionState = 'disconnected';
  private error: string | null = null;
  private cache = new RateLimitedCache<SavedLink[]>(async () => {
    await new Promise((r) => setTimeout(r, 400));
    return [
      { id: 'l1', title: 'Vision Pro Guidelines', url: 'https://developer.apple.com/visionos/' },
      { id: 'l2', title: 'React Documentation', url: 'https://react.dev/' },
      { id: 'l3', title: 'Three.js Examples', url: 'https://threejs.org/examples/' },
    ];
  }, 30000);

  async connect(): Promise<void> {
    this.state = 'connected';
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected';
    this.cache.clear();
  }

  async refresh(force?: boolean): Promise<SavedLink[]> {
    if (this.state !== 'connected') throw new Error('Not connected');
    return this.cache.get(force);
  }

  getData(): SavedLink[] | null {
    return this.cache.getSync();
  }

  getLastError(): string | null {
    return this.error;
  }
}

export const calendarProvider = new GoogleCalendarProvider();
export const taskProvider = new TodoistTaskProvider();
export const musicProvider = new MockMusicProvider();
export const linksProvider = new MockLinksProvider();
