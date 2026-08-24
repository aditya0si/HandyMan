import { describe, expect, it } from 'vitest';
import {
  appendMessage,
  buildDemoDeltas,
  clearChat,
  DEMO_REPLY_TEXT,
  isDemoMode,
  updateLastMessage,
} from './chat';
import type { ChatMessage } from './chat';

/**
 * M9 chat state unit tests (node environment — pure data module, no DOM).
 * Covers the message list ops (immutability, sequential ids, metadata
 * preservation), the demo-mode key matrix, and the canned demo reply delta
 * split (D7/D8) so the Chat.tsx orchestration stays browser-only.
 */

const USER_TS = 1_700_000_000_000;

describe('chat state (M9)', () => {
  it('appendMessage appends a user message with id/role/content/timestamp', () => {
    const result = appendMessage([], 'user', 'Hello', USER_TS);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'user-1',
      role: 'user',
      content: 'Hello',
      timestamp: USER_TS,
    });
  });

  it('appendMessage appends an assistant message', () => {
    const one = appendMessage([], 'user', 'Hello', USER_TS);
    const result = appendMessage(one, 'assistant', 'Hi there', USER_TS + 1);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      id: 'assistant-2',
      role: 'assistant',
      content: 'Hi there',
      timestamp: USER_TS + 1,
    });
  });

  it('appendMessage ids are unique and sequential across mixed roles', () => {
    const step1 = appendMessage([], 'user', 'a', USER_TS);
    const step2 = appendMessage(step1, 'assistant', 'b', USER_TS + 1);
    const step3 = appendMessage(step2, 'user', 'c', USER_TS + 2);
    expect(step3.map((m) => m.id)).toEqual(['user-1', 'assistant-2', 'user-3']);
  });

  it('appendMessage does not mutate the input array', () => {
    const input: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: 'a', timestamp: USER_TS },
    ];
    const snapshot = Object.freeze([...input]);
    const result = appendMessage(input, 'assistant', 'b', USER_TS + 1);
    expect(input).toEqual(snapshot);
    expect(input).toHaveLength(1);
    expect(result).not.toBe(input);
    expect(result).toHaveLength(2);
  });

  it('updateLastMessage replaces ONLY the last message content', () => {
    const user: ChatMessage = { id: 'user-1', role: 'user', content: 'a', timestamp: USER_TS };
    const assistant: ChatMessage = {
      id: 'assistant-2',
      role: 'assistant',
      content: 'old',
      timestamp: USER_TS + 1,
    };
    const input = [user, assistant] as const;
    const result = updateLastMessage(input, 'new content');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(user); // first message untouched (same reference)
    expect(result[1]).not.toBe(assistant); // last is a new object
    expect(result[1].content).toBe('new content');
  });

  it('updateLastMessage preserves the last message id/role/timestamp', () => {
    const result = updateLastMessage(
      [
        { id: 'user-1', role: 'user', content: 'a', timestamp: USER_TS },
        { id: 'assistant-2', role: 'assistant', content: 'x', timestamp: USER_TS + 9 },
      ],
      'grown',
    );
    expect(result[1].id).toBe('assistant-2');
    expect(result[1].role).toBe('assistant');
    expect(result[1].timestamp).toBe(USER_TS + 9);
  });

  it('updateLastMessage on an empty array is a no-op returning empty', () => {
    expect(updateLastMessage([], 'anything')).toEqual([]);
  });

  it('clearChat returns an empty array', () => {
    const filled = appendMessage(
      appendMessage([], 'user', 'a', USER_TS),
      'assistant',
      'b',
      USER_TS + 1,
    );
    expect(clearChat()).toEqual([]);
    expect(clearChat()).not.toBe(filled);
  });

  it('isDemoMode is true for undefined, null, empty, and whitespace-only keys', () => {
    expect(isDemoMode(undefined)).toBe(true);
    expect(isDemoMode(null)).toBe(true);
    expect(isDemoMode('')).toBe(true);
    expect(isDemoMode('   ')).toBe(true);
    expect(isDemoMode('\t')).toBe(true);
  });

  it('isDemoMode is false for a real key', () => {
    expect(isDemoMode('AIzaSy-example-key')).toBe(false);
    expect(isDemoMode(' key-with-padding ')).toBe(false);
  });

  it('buildDemoDeltas concatenation equals DEMO_REPLY_TEXT', () => {
    const deltas = buildDemoDeltas();
    expect(deltas.join('')).toBe(DEMO_REPLY_TEXT);
  });

  it('buildDemoDeltas returns >= 2 non-empty chunks', () => {
    const deltas = buildDemoDeltas();
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    for (const chunk of deltas) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });
});