import { describe, expect, it, vi, beforeAll } from 'vitest';
import { executeReadOnlyTool, executeMutationTool, isMutationTool, workspaceTools } from './tools';
import { MockLLMProvider } from './mockProvider';

// Stub browser globals missing in Node
beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn().mockReturnValue('test-token'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  }
  // Stub fetch for OAuth / integration API calls
  if (!vi.isMockFunction(globalThis.fetch)) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ events: [], tasks: [], url: 'https://example.com/auth' }),
    }));
  }
});

describe('LLM Tools & Providers (Phase 4)', () => {
  describe('Tool Definitions & Whitelisting', () => {
    it('defines expected workspace tool declarations', () => {
      const names = workspaceTools.map((t) => t.name);
      expect(names).toContain('summarize_news');
      expect(names).toContain('summarize_agenda');
      expect(names).toContain('search_notes');
      expect(names).toContain('create_task');
      expect(names).toContain('control_music');
    });

    it('accurately classifies mutation vs read-only tools', () => {
      expect(isMutationTool('create_task')).toBe(true);
      expect(isMutationTool('control_music')).toBe(true);
      expect(isMutationTool('summarize_agenda')).toBe(false);
      expect(isMutationTool('summarize_news')).toBe(false);
      expect(isMutationTool('search_notes')).toBe(false);
    });
  });

  describe('Tool Execution Handlers', () => {
    it('executes read-only agenda tool', async () => {
      const result = await executeReadOnlyTool('summarize_agenda', {});
      expect(result).toHaveProperty('events');
      expect(result).toHaveProperty('tasks');
    });

    it('executes read-only news tool', async () => {
      const result = await executeReadOnlyTool('summarize_news', {});
      expect(result).toHaveProperty('articles');
    });

    it('executes read-only search tool', async () => {
      const result = await executeReadOnlyTool('search_notes', { query: 'test' });
      expect(result).toHaveProperty('results');
    });

    it('throws for unknown read-only tool', async () => {
      await expect(executeReadOnlyTool('unknown_tool', {})).rejects.toThrow(/Unknown read-only tool/);
    });

    it('executes mutation tool for create_task', async () => {
      const result = await executeMutationTool('create_task', { title: 'Buy milk' });
      expect(result.success).toBe(true);
      expect(result.message).toContain('Buy milk');
    });

    it('executes mutation tool for control_music', async () => {
      const result = await executeMutationTool('control_music', { command: 'play', volume: 80 });
      expect(result.success).toBe(true);
    });

    it('throws for unknown mutation tool', async () => {
      await expect(executeMutationTool('unknown_tool', {})).rejects.toThrow(/Unknown mutation tool/);
    });
  });

  describe('MockLLMProvider', () => {
    it('generates function call for news query', async () => {
      const provider = new MockLLMProvider();
      const chunks = [];
      for await (const chunk of provider.generateContentStream({
        messages: [{ role: 'user', content: 'show me the news' }],
      })) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].functionCall?.name).toBe('summarize_news');
    });

    it('generates function call for music query', async () => {
      const provider = new MockLLMProvider();
      const chunks = [];
      for await (const chunk of provider.generateContentStream({
        messages: [{ role: 'user', content: 'play music please' }],
      })) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].functionCall?.name).toBe('control_music');
    });

    it('handles function response and answers user', async () => {
      const provider = new MockLLMProvider();
      const chunks = [];
      for await (const chunk of provider.generateContentStream({
        messages: [
          { role: 'user', content: 'check news' },
          { role: 'assistant', content: '', functionCalls: [{ name: 'summarize_news', args: {} }] },
          { role: 'user', content: '', functionResponse: { name: 'summarize_news', response: { articles: [] } } },
        ],
      })) {
        chunks.push(chunk);
      }
      const text = chunks.map((c) => c.textDelta || '').join('');
      expect(text).toContain('summarize_news');
    });

    it('aborts cleanly when signal triggered', async () => {
      const provider = new MockLLMProvider();
      const controller = new AbortController();
      controller.abort();
      const chunks = [];
      for await (const chunk of provider.generateContentStream(
        { messages: [{ role: 'user', content: 'hello' }] },
        controller.signal
      )) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([]);
    });
  });
});
