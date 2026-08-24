import { describe, expect, it } from 'vitest';
import { friendlyErrorText } from './errorMessages';
import { ChatError, CHAT_ERROR_KINDS } from './gemini';
import type { ChatErrorKind } from './gemini';
import { SearchError, SEARCH_ERROR_KINDS } from './search';
import type { SearchErrorKind } from './search';
import { WorkspaceError, WORKSPACE_ERROR_KINDS } from './workspace';
import type { WorkspaceErrorKind } from './workspace';

describe('errorMessages (M15 D8)', () => {
  it('passes through typed Error messages verbatim', () => {
    expect(friendlyErrorText(new Error('boom'))).toBe('boom');
    expect(
      friendlyErrorText(
        new ChatError(CHAT_ERROR_KINDS.network, 'Network error reaching Gemini: x'),
      ),
    ).toBe('Network error reaching Gemini: x');
  });

  it('falls back safely for non-error values — never empty, never crashes', () => {
    expect(friendlyErrorText('plain string')).toBe('plain string');
    expect(friendlyErrorText(undefined)).toBe('Unexpected error');
    expect(friendlyErrorText(null)).toBe('Unexpected error');
    expect(friendlyErrorText(0)).toBe('Unexpected error');
    expect(friendlyErrorText('')).toBe('Unexpected error');
  });

  it('every typed error kind maps to non-empty user-readable text', () => {
    for (const kind of Object.values(CHAT_ERROR_KINDS) as ChatErrorKind[]) {
      const text = friendlyErrorText(new ChatError(kind, `chat ${kind} message`));
      expect(text.length).toBeGreaterThan(0);
    }
    for (const kind of Object.values(SEARCH_ERROR_KINDS) as SearchErrorKind[]) {
      const text = friendlyErrorText(new SearchError(kind, `search ${kind} message`));
      expect(text.length).toBeGreaterThan(0);
    }
    for (const kind of Object.values(WORKSPACE_ERROR_KINDS) as WorkspaceErrorKind[]) {
      const text = friendlyErrorText(new WorkspaceError(kind, `ws ${kind} message`));
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('typed rate-limit errors surface actionable guidance through friendlyErrorText', () => {
    // The client-built rate_limit messages (M13) must reach the UI verbatim.
    const chat = new ChatError(
      CHAT_ERROR_KINDS.rateLimit,
      'Proxy rate limit reached (10 req/min) — try again shortly.',
    );
    const search = new SearchError(
      SEARCH_ERROR_KINDS.rateLimit,
      'Proxy rate limit reached (30 req/min) — try again shortly.',
    );
    expect(friendlyErrorText(chat)).toContain('try again');
    expect(friendlyErrorText(search)).toContain('try again');
  });

  it('backend-offline workspace errors surface a user-readable message', () => {
    const offline = new WorkspaceError(
      WORKSPACE_ERROR_KINDS.network,
      'Cannot reach the backend (http://localhost:4000) — is it running?',
    );
    expect(friendlyErrorText(offline)).toContain('Cannot reach the backend');
  });
});
