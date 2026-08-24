/**
 * M15 typed-error → user-readable text (brief D8). Centralizes the app
 * error-path guarantee: every typed error (M9 ChatError, M10 SearchError,
 * M13 WorkspaceError) already carries a user-readable .message, so this is a
 * thin passthrough with a safe fallback — apps route their inline error
 * text through it rather than re-implementing "Error ? message : String".
 * node-pure; the mapping-table test pins the guarantee by kind.
 */

/** User-readable text for any thrown value. Never returns ''. */
export function friendlyErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return 'Unexpected error';
}
