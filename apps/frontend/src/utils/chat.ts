/**
 * M9 chat state (pure data module — NO React, NO import.meta, NO DOM; the
 * purity contract of appRegistry/storage). Chat.tsx owns all effects and
 * timers; this module owns the message shape, the immutable list ops, the
 * demo-mode flag, and the canned demo reply text + its delta split (D8) so
 * all of it is node-unit-testable.
 */

/** One chat message. Roles use the INTERNAL names ('assistant' maps to
 *  Gemini's 'model' only inside gemini.ts buildGeminiBody). */
import type { GeminiFunctionCall, GeminiFunctionResponse } from '@jarvis/shared';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
  timestamp: number;
}

/** Appends a message; returns a NEW array (input never mutated). Ids are
 *  per-conversation sequential ('user-3', 'assistant-4', …) — unique by
 *  construction because nothing ever removes from the middle. */
export function appendMessage(
  messages: readonly ChatMessage[],
  role: ChatMessage['role'],
  content: string,
  timestamp: number = Date.now(),
): ChatMessage[] {
  const message: ChatMessage = {
    id: `${role}-${messages.length + 1}`,
    role,
    content,
    timestamp,
  };
  return [...messages, message];
}

/** Replaces the LAST message's content (streaming growth: the caller
 *  passes the full accumulated text, not a delta). Preserves the last
 *  message's id/role/timestamp; empty input -> empty output (no-throw). */
export function updateLastMessage(
  messages: readonly ChatMessage[],
  content: string,
): ChatMessage[] {
  if (messages.length === 0) return [];
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, content }];
}

/** Empty history. API-completeness counterpart of the M8 app-bus plumbing
 *  (D5 there): shipped + unit-pinned now, UI surface later. */
export function clearChat(): ChatMessage[] {
  return [];
}

/** Demo mode = no usable key (undefined/null/empty/whitespace-only). */
export function isDemoMode(apiKey: string | undefined | null): boolean {
  return !apiKey || apiKey.trim() === '';
}

/** The canned demo reply (D7/D8). Contains the stable marker 'demo reply'
 *  that v9 asserts in the assistant bubble. */
export const DEMO_REPLY_TEXT =
  'JARVIS demo reply: no Gemini API key is configured, so this is a canned answer. ' +
  'Create apps/frontend/.env.local with VITE_GEMINI_API_KEY (README, Milestone 9) ' +
  'to chat with the real model.';

/** Splits the canned reply into 3 non-empty chunks for the timed-delta
 *  reveal (~0.9 s total, D8). Pure so the split itself is unit-pinned. */
export function buildDemoDeltas(): string[] {
  const third = Math.ceil(DEMO_REPLY_TEXT.length / 3);
  return [
    DEMO_REPLY_TEXT.slice(0, third),
    DEMO_REPLY_TEXT.slice(third, third * 2),
    DEMO_REPLY_TEXT.slice(third * 2),
  ].filter((chunk) => chunk.length > 0);
}