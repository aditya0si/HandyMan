import type { GeminiToolDeclaration } from '@jarvis/shared';
import { calendarProvider, taskProvider, musicProvider } from '../integrations/mockProviders';

export const workspaceTools: GeminiToolDeclaration[] = [
  {
    name: 'summarize_news',
    description: 'Fetch and summarize the latest news from the workspace.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'summarize_agenda',
    description: 'Fetch today\'s agenda (calendar events and pending tasks).',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'search_notes',
    description: 'Search through workspace notes.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING' }
      },
      required: ['query']
    }
  },
  {
    name: 'create_task',
    description: 'Create a new task in the user\'s task manager.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' }
      },
      required: ['title']
    }
  },
  {
    name: 'control_music',
    description: 'Control music playback (play, pause, next, volume).',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING' }, // e.g. 'play', 'pause', 'toggle'
        volume: { type: 'NUMBER' } // optional 0-100
      },
      required: ['command']
    }
  }
];

export async function executeReadOnlyTool(name: string, _args: Record<string, unknown>): Promise<any> {
  switch (name) {
    case 'summarize_agenda': {
      await calendarProvider.connect();
      await taskProvider.connect();
      const events = await calendarProvider.refresh();
      const tasks = await taskProvider.refresh();
      return { events, tasks: tasks.filter(t => !t.isCompleted) };
    }
    case 'summarize_news':
      return { articles: [{ title: 'M4 chip announced', summary: 'Apple announces new M4.' }] };
    case 'search_notes':
      return { results: [{ title: 'Project Jarvis', content: 'Spatial workspace notes' }] };
    default:
      throw new Error(`Unknown read-only tool: ${name}`);
  }
}

export async function executeMutationTool(name: string, args: Record<string, unknown>): Promise<any> {
  switch (name) {
    case 'create_task': {
      await taskProvider.connect();
      // MockTaskProvider currently lacks create_task, but we simulate success.
      return { success: true, message: `Created task: ${args.title}` };
    }
    case 'control_music': {
      await musicProvider.connect();
      if (args.command === 'play' || args.command === 'pause' || args.command === 'toggle') {
        await musicProvider.togglePlayPause();
      }
      if (typeof args.volume === 'number') {
        await musicProvider.setVolume(args.volume as number);
      }
      return { success: true, state: musicProvider.getData() };
    }
    default:
      throw new Error(`Unknown mutation tool: ${name}`);
  }
}

export function isMutationTool(name: string): boolean {
  return ['create_task', 'control_music'].includes(name);
}
