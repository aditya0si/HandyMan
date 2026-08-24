/**
 * M13 shared Gemini request builders (single source of truth for BOTH the
 * frontend client (utils/gemini.ts) and the backend proxy
 * (apps/backend/src/api/proxy routes) — moved from gemini.ts, which
 * re-exports them so every existing import keeps working.
 *
 * Pure string/data builders only — no fetch, no env, no DOM.
 */

/** Single swappable model constant (M9 D1). Current stable Flash model. */
export const GEMINI_MODEL = 'gemini-2.5-flash';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Wire messages for one request ('assistant' maps to Gemini's 'model'
 *  role in buildGeminiBody). */
export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

export interface GeminiMessage {
  role: 'user' | 'assistant' | 'function';
  content?: string;
  functionCalls?: GeminiFunctionCall[];
  functionResponse?: GeminiFunctionResponse;
}

export interface GeminiToolSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
}

export interface GeminiToolDeclaration {
  name: string;
  description: string;
  parameters?: GeminiToolSchema;
}

export interface GeminiRequestOptions {
  tools?: { functionDeclarations: GeminiToolDeclaration[] }[];
  systemInstruction?: string;
}

/** URL builder: model + alt=sse + query-param key (M9 auth form). */
export function buildGeminiUrl(model: string, apiKey: string): string {
  return `${GEMINI_API_BASE}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
}

/** Body builder: full history, roles, tools, and system instruction. */
export function buildGeminiBody(
  messages: readonly GeminiMessage[],
  options?: GeminiRequestOptions,
): Record<string, any> {
  const contents = messages.map((message) => {
    const parts: any[] = [];
    if (message.content) {
      parts.push({ text: message.content });
    }
    if (message.functionCalls) {
      message.functionCalls.forEach(fc => parts.push({ functionCall: fc }));
    }
    if (message.functionResponse) {
      parts.push({ functionResponse: message.functionResponse });
    }

    let role = message.role as string;
    if (role === 'assistant') role = 'model';
    // role 'function' is sometimes required, or 'user' works for functionResponse. 
    // Gemini REST API supports role: 'user' or 'function' for functionResponse.

    return { role, parts };
  });

  const body: Record<string, any> = { contents };

  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }
  
  if (options?.systemInstruction) {
    body.systemInstruction = {
      role: 'user',
      parts: [{ text: options.systemInstruction }]
    };
  }

  return body;
}
