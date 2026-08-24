import { ChatError, CHAT_ERROR_KINDS, extractSseData, extractTextDelta, extractFunctionCalls } from '../gemini';
import type { LLMProvider, LLMRequest, LLMChunk } from './llmProvider';

export class ProxyGeminiProvider implements LLMProvider {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async *generateContentStream(request: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMChunk> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/proxy/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: request.messages, options: request.options }),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) return;
      throw new ChatError(
        CHAT_ERROR_KINDS.network,
        `Network error reaching the proxy: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new ChatError(CHAT_ERROR_KINDS.rateLimit, 'Proxy rate limit reached (10 req/min) — try again shortly.');
      }
      throw new ChatError(CHAT_ERROR_KINDS.other, `Proxy request failed (HTTP ${response.status}).`);
    }

    const body = response.body;
    if (!body) {
      throw new ChatError(CHAT_ERROR_KINDS.other, 'Proxy response had no body.');
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
        `Proxy stream failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
