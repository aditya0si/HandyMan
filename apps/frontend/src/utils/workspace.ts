/**
 * M13 workspace REST client (brief D13): save = PUT /api/workspace with
 * the current WindowManager-derived WindowState list; load = GET. Typed
 * WorkspaceError, injectable fetch — node vitest covers URL/method/body
 * shapes and every error mapping with zero network.
 *
 * Purity contract: NO import.meta, NO DOM — the base URL is a PARAMETER
 * (App.tsx reads env at the React boundary).
 */
import type { WindowState } from '@jarvis/shared';

export const WORKSPACE_ERROR_KINDS = {
  network: 'network',
  invalid: 'invalid',
  server: 'server',
} as const;

export type WorkspaceErrorKind =
  (typeof WORKSPACE_ERROR_KINDS)[keyof typeof WORKSPACE_ERROR_KINDS];

export class WorkspaceError extends Error {
  readonly kind: WorkspaceErrorKind;

  constructor(kind: WorkspaceErrorKind, message: string) {
    super(message);
    this.name = 'WorkspaceError';
    this.kind = kind;
  }
}

/** PUT the full window list; resolves the server's confirmed count. */
export async function saveWorkspace(
  baseUrl: string,
  windows: readonly WindowState[],
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<number> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/workspace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windows }),
    });
  } catch {
    throw new WorkspaceError(
      WORKSPACE_ERROR_KINDS.network,
      `Cannot reach the backend (${baseUrl}) — is it running?`,
    );
  }
  if (response.status === 400) {
    throw new WorkspaceError(
      WORKSPACE_ERROR_KINDS.invalid,
      'The backend rejected the workspace payload.',
    );
  }
  if (!response.ok) {
    throw new WorkspaceError(
      WORKSPACE_ERROR_KINDS.server,
      `Workspace save failed (HTTP ${response.status}).`,
    );
  }
  const body = (await response.json()) as { ok?: boolean; count?: number };
  return body.ok === true && typeof body.count === 'number' ? body.count : 0;
}

/** GET the persisted workspace; a non-array body is an invalid error. */
export async function loadWorkspace(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<WindowState[]> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/workspace`, { method: 'GET' });
  } catch {
    throw new WorkspaceError(
      WORKSPACE_ERROR_KINDS.network,
      `Cannot reach the backend (${baseUrl}) — is it running?`,
    );
  }
  if (!response.ok) {
    throw new WorkspaceError(
      WORKSPACE_ERROR_KINDS.server,
      `Workspace load failed (HTTP ${response.status}).`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WorkspaceError(
      WORKSPACE_ERROR_KINDS.invalid,
      'Workspace response was not valid JSON.',
    );
  }
  const windows = (body as { windows?: unknown }).windows;
  if (!Array.isArray(windows)) {
    throw new WorkspaceError(
      WORKSPACE_ERROR_KINDS.invalid,
      'Workspace response had no windows array.',
    );
  }
  return windows as WindowState[];
}
