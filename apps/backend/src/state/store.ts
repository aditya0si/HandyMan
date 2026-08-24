/**
 * M13 workspace store (brief D1): a JSON-file persistence layer for the
 * shared workspace — a documented deviation from the spec's PostgreSQL
 * (Redis deferred entirely); the class abstracts a later DB swap.
 *
 * Contract:
 * - load(): missing OR corrupt file -> EMPTY workspace + ONE console.warn,
 *   never a crash (a first boot without a file is normal, not fatal).
 * - scheduleSave(windows): debounced (~1 s, injectable) coalescing write —
 *   N schedules inside the window produce ONE disk write.
 * - flush(): immediate write of any pending snapshot (shutdown + PUT).
 * - read(): flush-if-pending, then the in-memory snapshot — a save
 *   followed immediately by read() round-trips.
 * - Atomic write: writeFileSync(<file>.tmp) + renameSync(tmp -> file)
 *   (Node's rename replaces existing destinations on Windows); a crash
 *   mid-write can never leave a half-written workspace.json.
 *
 * Persisted: WINDOWS ONLY ({version, windows}) — users are ephemeral
 * presence by design (M11), documented in the README.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { WindowState } from '@jarvis/shared';

export const WORKSPACE_VERSION = 1;
export const WORKSPACE_SAVE_DEBOUNCE_MS = 1000;

export interface WorkspaceData {
  version: typeof WORKSPACE_VERSION;
  windows: WindowState[];
}

export class WorkspaceStore {
  private readonly filePath: string;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: WorkspaceData | null = null;
  private current: WorkspaceData = { version: WORKSPACE_VERSION, windows: [] };

  constructor(filePath: string, debounceMs: number = WORKSPACE_SAVE_DEBOUNCE_MS) {
    this.filePath = filePath;
    this.debounceMs = debounceMs;
  }

  /** Boots from disk (one warn + empty workspace on missing/corrupt). */
  load(): WorkspaceData {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const shape = parsed as Partial<WorkspaceData>;
      if (
        shape &&
        shape.version === WORKSPACE_VERSION &&
        Array.isArray(shape.windows)
      ) {
        this.current = { version: WORKSPACE_VERSION, windows: shape.windows };
        return this.current;
      }
      throw new Error('unexpected workspace shape');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const reason =
        code === 'ENOENT'
          ? 'no workspace file — starting empty'
          : `workspace file unreadable (${
              error instanceof Error ? error.message : String(error)
            }) — starting empty`;
      console.warn(`[store] ${reason}`);
      this.current = { version: WORKSPACE_VERSION, windows: [] };
      return this.current;
    }
  }

  /** Debounced coalescing save (the WS pipeline calls this per mutation). */
  scheduleSave(windows: WindowState[]): void {
    this.pending = { version: WORKSPACE_VERSION, windows };
    if (this.timer !== null) return; // the armed timer writes the LATEST pending
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }

  /** Writes any pending snapshot NOW (shutdown path + PUT + read()). */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending === null) return;
    const data = this.pending;
    this.pending = null;
    this.write(data);
  }

  /** Flush-if-pending, then the persisted snapshot (GET /api/workspace). */
  read(): WorkspaceData {
    this.flush();
    return this.current;
  }

  private write(data: WorkspaceData): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
    this.current = data;
  }
}
