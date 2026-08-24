/**
 * M9 Gemini REST client (SSE streaming) for the LLM Chat app.
 *
 * DEVIATIONS from TECHNICAL_SPEC §2.3 (documented, D17): the spec sketch
 * was a class-based app calling non-streaming generateContent with an
 * x-goog-api-key header and response.json(); M9 ships a node-pure
 * streaming client — POST <model>:streamGenerateContent?alt=sse&key=<KEY>
 * (query-param auth per the M9 milestone prompt), SSE text deltas, typed
 * messages, full conversation history per turn, no system instruction.
 *
 * Purity contract (D2, mirrors appRegistry.ts): NO import.meta, NO React,
 * NO DOM-only APIs — the apiKey is a PARAMETER (Chat.tsx reads
 * import.meta.env at the React boundary), and fetch is injectable so node
 * vitest exercises everything with synthetic ReadableStreams (node 24
 * provides the needed globals at runtime; lib.dom provides their types).
 *
 * Abort semantics (D5): aborting is a CLEAN stop — streamChat resolves
 * with the text accumulated so far ('' before headers); ChatError is
 * reserved for genuine failures (D6). Malformed SSE data lines are
 * skipped, never fatal (D3).
 */
import { GEMINI_MODEL, buildGeminiBody, buildGeminiUrl } from '@jarvis/shared';
import type { GeminiMessage } from '@jarvis/shared';

// M13: the model constant + URL/body builders moved to @jarvis/shared
// (single source of truth shared with the backend proxy); re-exported so
// every existing import keeps working.
export { GEMINI_MODEL, buildGeminiBody, buildGeminiUrl } from '@jarvis/shared';
export type { GeminiMessage } from '@jarvis/shared';

/** Error kinds as a const object (NO enum — erasableSyntaxOnly). */
export const CHAT_ERROR_KINDS = {
  noKey: 'no_key',
  invalidKey: 'invalid_key',
  rateLimit: 'rate_limit',
  network: 'network',
  other: 'other',
} as const;

export type ChatErrorKind = (typeof CHAT_ERROR_KINDS)[keyof typeof CHAT_ERROR_KINDS];

/** Typed failure with a distinguishable kind + user-readable message (D6). */
export class ChatError extends Error {
  readonly kind: ChatErrorKind;

  constructor(kind: ChatErrorKind, message: string) {
    super(message);
    this.name = 'ChatError';
    this.kind = kind;
  }
}

/**
 * ONE pure SSE parsing step (D3): consumes the accumulated buffer, returns
 * every COMPLETE `data:` payload plus the unconsumed remainder (a trailing
 * partial line stays buffered until its newline arrives — JSON may split
 * across reads). Non-data lines (empty, `event:`, comments) are skipped;
 * CRLF is tolerated (one trailing \r stripped); one optional space after
 * `data:` is stripped per the SSE spec. Malformed payloads are skipped by
 * the CALLER (JSON.parse failure never kills the stream).
 */
export function extractSseData(buffer: string): { data: string[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? ''; // last element: partial line or '' after \n
  const data: string[] = [];
  for (const line of lines) {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!clean.startsWith('data:')) continue;
    data.push(clean.slice('data:'.length).replace(/^ /, ''));
  }
  return { data, rest };
}

/**
 * Text-delta extraction (D4): joins the `.text` of EVERY part (parts is an
 * ARRAY; multi-part deltas concatenate). Absent candidates/content/parts
 * (finish frames), missing `text`, any missing field -> '' — never throws.
 */
export function extractTextDelta(payload: unknown): string {
  const chunk = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = chunk?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

export function extractFunctionCalls(payload: unknown): Array<{ name: string; args: Record<string, unknown> }> {
  const chunk = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ functionCall?: { name: string; args: Record<string, unknown> } }> } }>;
  };
  const parts = chunk?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return [];
  return parts
    .filter((part) => !!part?.functionCall)
    .map((part) => part.functionCall!);
}

export interface StreamChatOptions {
  apiKey: string;
  messages: readonly GeminiMessage[];
  /** Called once per non-empty text delta (live append). */
  onDelta: (delta: string) => void;
  /** Abort = clean stop (D5): resolves with the partial text. */
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Streams one Gemini chat completion over SSE. Resolves with the FULL
 * accumulated text. Throws ChatError ONLY for genuine failures (D5/D6):
 * no key, 401/403 -> invalid_key, 429 -> rate_limit, other non-OK ->
 * other, network rejection -> network, OK-without-body -> other.
 */
export async function streamChat({
  apiKey,
  messages,
  onDelta,
  signal,
  fetchImpl = fetch.bind(globalThis),
}: StreamChatOptions): Promise<string> {
  const key = apiKey.trim();
  if (!key) {
    throw new ChatError(
      CHAT_ERROR_KINDS.noKey,
      'No Gemini API key configured — set VITE_GEMINI_API_KEY in apps/frontend/.env.local (README, Milestone 9).',
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(buildGeminiUrl(GEMINI_MODEL, key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGeminiBody(messages)),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return ''; // clean cancel before headers (D5)
    throw new ChatError(
      CHAT_ERROR_KINDS.network,
      `Network error reaching Gemini: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const kind =
      response.status === 401 || response.status === 403
        ? CHAT_ERROR_KINDS.invalidKey
        : response.status === 429
          ? CHAT_ERROR_KINDS.rateLimit
          : CHAT_ERROR_KINDS.other;
    throw new ChatError(kind, `Gemini request failed (HTTP ${response.status}).`);
  }

  const body = response.body;
  if (!body) {
    throw new ChatError(CHAT_ERROR_KINDS.other, 'Gemini response had no body.');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const consume = (chunkText: string): void => {
    buffer += chunkText;
    const { data, rest } = extractSseData(buffer);
    buffer = rest;
    for (const line of data) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // malformed line: skipped, never fatal (D3)
      }
      const delta = extractTextDelta(parsed);
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
    }
    // Flush the TextDecoder AND the last unterminated line (a final event
    // without a trailing \n is still a complete event once the stream ends).
    consume(decoder.decode() + '\n');
  } catch (error) {
    if (signal?.aborted) return full; // clean cancel mid-stream (D5)
    throw new ChatError(
      CHAT_ERROR_KINDS.network,
      `Gemini stream failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return full;
}