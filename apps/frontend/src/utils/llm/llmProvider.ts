import type { GeminiMessage, GeminiRequestOptions, GeminiFunctionCall } from '@jarvis/shared';

export interface LLMChunk {
  textDelta?: string;
  functionCall?: GeminiFunctionCall;
}

export interface LLMRequest {
  messages: readonly GeminiMessage[];
  options?: GeminiRequestOptions;
}

export interface LLMProvider {
  /**
   * Stream a response from the LLM, yielding text deltas or function calls.
   */
  generateContentStream(request: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMChunk>;
}
