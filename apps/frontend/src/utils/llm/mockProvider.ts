import type { LLMProvider, LLMRequest, LLMChunk } from './llmProvider';

export class MockLLMProvider implements LLMProvider {
  async *generateContentStream(request: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMChunk> {
    // Get the last user message
    const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user');
    const content = lastUserMessage?.content?.toLowerCase() || '';

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (signal?.aborted) return;

    if (content.includes('news')) {
      yield { functionCall: { name: 'summarize_news', args: {} } };
      return;
    }

    if (content.includes('agenda') || content.includes('tasks')) {
      if (content.includes('create')) {
        yield { functionCall: { name: 'create_task', args: { title: 'New Task' } } };
      } else {
        yield { functionCall: { name: 'summarize_agenda', args: {} } };
      }
      return;
    }

    if (content.includes('notes') || content.includes('search')) {
      yield { functionCall: { name: 'search_notes', args: { query: content } } };
      return;
    }

    if (content.includes('play') || content.includes('pause') || content.includes('music')) {
      yield { functionCall: { name: 'control_music', args: { command: content.includes('play') ? 'play' : 'pause' } } };
      return;
    }

    // Default response if no tool matched, or if we are receiving a functionResponse
    const lastFunctionResponse = [...request.messages].reverse().find((m) => m.functionResponse);
    if (lastFunctionResponse) {
      const functionName = lastFunctionResponse.functionResponse?.name;
      const text = `I've successfully executed ${functionName} and got the results.`;
      
      const chunks = text.split(' ');
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (signal?.aborted) return;
        yield { textDelta: chunk + ' ' };
      }
      return;
    }

    const text = "I am a local mock assistant. I can summarize news, check your agenda, search notes, or control music. What would you like to do?";
    const chunks = text.split(' ');
    for (const chunk of chunks) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (signal?.aborted) return;
      yield { textDelta: chunk + ' ' };
    }
  }
}
