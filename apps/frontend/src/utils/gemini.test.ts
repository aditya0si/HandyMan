import { describe, expect, it } from 'vitest';
import {
  buildGeminiBody,
  buildGeminiUrl,
  ChatError,
  CHAT_ERROR_KINDS,
  extractSseData,
  extractTextDelta,
  GEMINI_MODEL,
  streamChat,
} from './gemini';

const encoder = new TextEncoder();

/** Synthetic SSE body from string chunks (JSON may split across reads). */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** Injected fetch returning a Response-like (duck-typed: ok/status/body). */
function fetchLike(response: { ok: boolean; status: number; body: unknown }): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function textPayload(text: string): object {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const BASE_MESSAGES = [{ role: 'user', content: 'hi' }] as const;

describe('gemini client (M9)', () => {
  describe('URL + body builders', () => {
    it('buildGeminiUrl is exact: base + model + :streamGenerateContent?alt=sse&key=', () => {
      expect(buildGeminiUrl(GEMINI_MODEL, 'test-key')).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=test-key',
      );
      expect(GEMINI_MODEL).toBe('gemini-2.5-flash'); // D1 pin
    });

    it("buildGeminiBody maps internal 'assistant' to Gemini 'model'", () => {
      const body = buildGeminiBody([
        { role: 'user', content: 'ask' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'follow-up' },
      ]);
      expect(body.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
    });

    it('buildGeminiBody wraps each message content into text parts (no system instruction)', () => {
      const body = buildGeminiBody([{ role: 'user', content: 'plain text' }]);
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'plain text' }] },
      ]);
      // Every part is a text-only part; nothing else is added.
      for (const content of body.contents as any[]) {
        expect(content).toEqual({
          role: content.role,
          parts: [{ text: expect.any(String) }],
        });
      }
    });

    it('buildGeminiBody serializes tools and system instruction if provided', () => {
      const body = buildGeminiBody(
        [{ role: 'user', content: 'plain text' }],
        {
          systemInstruction: 'Be helpful',
          tools: [{ functionDeclarations: [{ name: 'test', description: 'test' }] }]
        }
      );
      expect(body.systemInstruction).toEqual({
        role: 'user',
        parts: [{ text: 'Be helpful' }]
      });
      expect(body.tools).toEqual([{ functionDeclarations: [{ name: 'test', description: 'test' }] }]);
    });
  });

  describe('extractSseData (pure parser)', () => {
    it('returns one payload for one complete event', () => {
      expect(extractSseData('data: x\n\n')).toEqual({ data: ['x'], rest: '' });
    });

    it('returns multiple payloads from one buffer', () => {
      const buffer = 'data: {"a":1}\n\ndata: {"b":2}\n\n';
      expect(extractSseData(buffer)).toEqual({
        data: ['{"a":1}', '{"b":2}'],
        rest: '',
      });
    });

    it('keeps a trailing partial line in rest', () => {
      const buffer = 'data: {"can';
      expect(extractSseData(buffer).data).toEqual([]);
      const { rest } = extractSseData(buffer);
      expect(rest).toBe('data: {"can');
      // Feeding the remainder + newline yields the full payload — the
      // split-across-reads contract at the parser level.
      expect(extractSseData(rest + 'didates": []}\n\n')).toEqual({
        data: ['{"candidates": []}'],
        rest: '',
      });
    });

    it("skips empty lines, 'event:' lines, and comments", () => {
      const buffer = ': ping\nevent: x\n\ndata: y\n\n';
      expect(extractSseData(buffer)).toEqual({ data: ['y'], rest: '' });
    });

    it("strips \\r (CRLF) and one optional space after 'data:'", () => {
      expect(extractSseData('data: {"k":1}\r\n')).toEqual({
        data: ['{"k":1}'],
        rest: '',
      });
      expect(extractSseData('data:{"k":2}\n')).toEqual({
        data: ['{"k":2}'],
        rest: '',
      });
    });
  });

  describe('streamChat (injected fetch)', () => {
    it('happy path: one chunk, one event -> onDelta with the delta, resolves the full text', async () => {
      const deltas: string[] = [];
      const text = await streamChat({
        apiKey: 'k',
        messages: [...BASE_MESSAGES],
        onDelta: (d) => deltas.push(d),
        fetchImpl: fetchLike({
          ok: true,
          status: 200,
          body: streamOf([sseLine(textPayload('Hello'))]),
        }),
      });
      expect(text).toBe('Hello');
      expect(deltas).toEqual(['Hello']);
    });

    it('JSON split across two reads -> still exactly one delta', async () => {
      const deltas: string[] = [];
      const text = await streamChat({
        apiKey: 'k',
        messages: [...BASE_MESSAGES],
        onDelta: (d) => deltas.push(d),
        fetchImpl: fetchLike({
          ok: true,
          status: 200,
          body: streamOf([
            'data: {"candidates":[{"content":{"parts":[{"te',
            'xt":"Hel"}]}}]}\n\n',
          ]),
        }),
      });
      expect(text).toBe('Hel');
      expect(deltas).toEqual(['Hel']);
    });

    it('multi-part payload: ALL parts join into ONE delta (D4)', async () => {
      const deltas: string[] = [];
      const text = await streamChat({
        apiKey: 'k',
        messages: [...BASE_MESSAGES],
        onDelta: (d) => deltas.push(d),
        fetchImpl: fetchLike({
          ok: true,
          status: 200,
          body: streamOf([
            sseLine({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }),
          ]),
        }),
      });
      expect(text).toBe('ab');
      expect(deltas).toEqual(['ab']);
      // D4 at the unit level too: extractTextDelta joins EVERY part's text.
      expect(
        extractTextDelta({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }),
      ).toBe('ab');
      expect(extractTextDelta({ candidates: [] })).toBe(''); // finish frames -> ''
    });

    it('finish frame (no candidates) yields no delta and no throw', async () => {
      const deltas: string[] = [];
      const text = await streamChat({
        apiKey: 'k',
        messages: [...BASE_MESSAGES],
        onDelta: (d) => deltas.push(d),
        fetchImpl: fetchLike({
          ok: true,
          status: 200,
          body: streamOf([
            sseLine(textPayload('Hi')),
            sseLine({ candidates: [] }),
          ]),
        }),
      });
      expect(text).toBe('Hi');
      expect(deltas).toEqual(['Hi']);
    });

    it('malformed data line is skipped and the stream continues (D3)', async () => {
      const deltas: string[] = [];
      const text = await streamChat({
        apiKey: 'k',
        messages: [...BASE_MESSAGES],
        onDelta: (d) => deltas.push(d),
        fetchImpl: fetchLike({
          ok: true,
          status: 200,
          body: streamOf([
            'data: {not json}\n\n',
            sseLine(textPayload('still works')),
          ]),
        }),
      });
      expect(text).toBe('still works');
      expect(deltas).toEqual(['still works']);
    });

    it('final event without a trailing newline is still parsed', async () => {
      const deltas: string[] = [];
      const text = await streamChat({
        apiKey: 'k',
        messages: [...BASE_MESSAGES],
        onDelta: (d) => deltas.push(d),
        fetchImpl: fetchLike({
          ok: true,
          status: 200,
          body: streamOf([
            sseLine(textPayload('Hello ')),
            `data: ${JSON.stringify(textPayload('world'))}`,
          ]),
        }),
      });
      expect(text).toBe('Hello world');
      expect(deltas).toEqual(['Hello ', 'world']);
    });

    it("empty or whitespace-only key -> ChatError kind 'no_key' and fetch is never called", async () => {
      let fetchCalls = 0;
      const spyFetch = (async () => {
        fetchCalls += 1;
        throw new Error('should never be called');
      }) as unknown as typeof fetch;
      await expect(
        streamChat({
          apiKey: '   \t ',
          messages: [...BASE_MESSAGES],
          onDelta: () => {},
          fetchImpl: spyFetch,
        }),
      ).rejects.toMatchObject({ name: ChatError.name, kind: CHAT_ERROR_KINDS.noKey });
      expect(fetchCalls).toBe(0);
    });

    it("HTTP 401 -> ChatError kind 'invalid_key'", async () => {
      await expect(
        streamChat({
          apiKey: 'k',
          messages: [...BASE_MESSAGES],
          onDelta: () => {},
          fetchImpl: fetchLike({ ok: false, status: 401, body: null }),
        }),
      ).rejects.toMatchObject({ name: ChatError.name, kind: CHAT_ERROR_KINDS.invalidKey });
    });

    it("HTTP 403 -> ChatError kind 'invalid_key'", async () => {
      await expect(
        streamChat({
          apiKey: 'k',
          messages: [...BASE_MESSAGES],
          onDelta: () => {},
          fetchImpl: fetchLike({ ok: false, status: 403, body: null }),
        }),
      ).rejects.toMatchObject({ name: ChatError.name, kind: CHAT_ERROR_KINDS.invalidKey });
    });

    it("HTTP 429 -> ChatError kind 'rate_limit'", async () => {
      await expect(
        streamChat({
          apiKey: 'k',
          messages: [...BASE_MESSAGES],
          onDelta: () => {},
          fetchImpl: fetchLike({ ok: false, status: 429, body: null }),
        }),
      ).rejects.toMatchObject({ name: ChatError.name, kind: CHAT_ERROR_KINDS.rateLimit });
    });

    it("HTTP 500 -> ChatError kind 'other'", async () => {
      await expect(
        streamChat({
          apiKey: 'k',
          messages: [...BASE_MESSAGES],
          onDelta: () => {},
          fetchImpl: fetchLike({ ok: false, status: 500, body: null }),
        }),
      ).rejects.toMatchObject({ name: ChatError.name, kind: CHAT_ERROR_KINDS.other });
    });

    it("fetch rejection (TypeError) -> ChatError kind 'network'", async () => {
      const buggyFetch = ((_url: unknown) =>
        Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
      const promise = streamChat({
        apiKey: 'k',
        messages: [...BASE_MESSAGES],
        onDelta: () => {},
        fetchImpl: buggyFetch,
      });
      await expect(promise).rejects.toMatchObject({
        name: ChatError.name,
        kind: CHAT_ERROR_KINDS.network,
      });
      await expect(promise).rejects.toThrow(/Network error reaching Gemini/);
    });

    it('abort mid-stream resolves with the partial text (never rejects) — D5 clean stop', async () => {
      let streamController!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          streamController = c;
          streamController.enqueue(encoder.encode(sseLine(textPayload('Hel'))));
        },
      });
      const ac = new AbortController();
      ac.signal.addEventListener('abort', () =>
        streamController.error(new DOMException('Aborted', 'AbortError')),
      );
      const deltas: string[] = [];
      let releaseFirst!: () => void;
      const firstDelta = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const promise = streamChat({
        apiKey: 'k',
        messages: [...BASE_MESSAGES],
        onDelta: (d) => {
          deltas.push(d);
          releaseFirst();
        },
        signal: ac.signal,
        fetchImpl: fetchLike({ ok: true, status: 200, body }),
      });
      await firstDelta;
      ac.abort();
      await expect(promise).resolves.toBe('Hel'); // D5 clean stop
    });

    it("abort before response headers resolves with '' (never rejects)", async () => {
      const fetchNever = ((_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        })) as unknown as typeof fetch;
      const ac = new AbortController();
      const promise = streamChat({
        apiKey: 'k',
        messages: [...BASE_MESSAGES],
        onDelta: () => {},
        signal: ac.signal,
        fetchImpl: fetchNever,
      });
      ac.abort();
      await expect(promise).resolves.toBe('');
    });
  });
});