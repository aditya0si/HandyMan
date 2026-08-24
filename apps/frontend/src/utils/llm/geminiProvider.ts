import { buildGeminiBody, buildGeminiUrl } from '@jarvis/shared';
import {
  ChatError,
  CHAT_ERROR_KINDS,
  extractSseData,
  extractTextDelta,
  extractFunctionCalls,
  GEMINI_MODEL,
} from '../gemini';
import type { LLMProvider, LLMRequest, LLMChunk } from './llmProvider';

export class GeminiProvider implements LLMProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async *generateContentStream(request: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMChunk> {
    const key = this.apiKey.trim();
    if (!key) {
      throw new ChatError(
        CHAT_ERROR_KINDS.noKey,
        'No Gemini API key configured.',
      );
    }

    let response: Response;
    try {
      response = await fetch(buildGeminiUrl(GEMINI_MODEL, key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGeminiBody(request.messages, request.options)),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) return;
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

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const { data, rest } = extractSseData(buffer);
        buffer = rest;
        
        for (const line of data) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          
          const textDelta = extractTextDelta(parsed);
          if (textDelta) {
            yield { textDelta };
          }
          
          const functionCalls = extractFunctionCalls(parsed);
          for (const functionCall of functionCalls) {
            yield { functionCall };
          }
        }
      }
      
      buffer += decoder.decode() + '\n';
      const { data } = extractSseData(buffer);
      for (const line of data) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        
        const textDelta = extractTextDelta(parsed);
        if (textDelta) {
          yield { textDelta };
        }
        
        const functionCalls = extractFunctionCalls(parsed);
        for (const functionCall of functionCalls) {
          yield { functionCall };
        }
      }
    } catch (error) {
      if (signal?.aborted) return;
      throw new ChatError(
        CHAT_ERROR_KINDS.network,
        `Gemini stream failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
