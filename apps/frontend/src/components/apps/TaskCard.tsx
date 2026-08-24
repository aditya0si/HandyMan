import { useEffect, useState } from 'react';
import { IntegrationStateBoundary } from '../IntegrationStateBoundary';
import { taskProvider } from '../../utils/integrations/mockProviders';

export function TaskCard() {
  const [, forceUpdate] = useState({});
  const [completingId, setCompletingId] = useState<string | null>(null);

  useEffect(() => {
    if (taskProvider.state === 'connected') {
      taskProvider.refresh().catch(() => {}).finally(() => forceUpdate({}));
    }
  }, []);

  const handleConnect = async () => {
    await taskProvider.connect();
    forceUpdate({});
    await taskProvider.refresh();
    forceUpdate({});
  };

  const handleRetry = async () => {
    await taskProvider.refresh(true);
    forceUpdate({});
  };

  const handleComplete = async (taskId: string) => {
    setCompletingId(taskId);
    await taskProvider.completeTask(taskId);
    forceUpdate({});
    setCompletingId(null);
  };

  return (
    <div className="w-full h-full bg-slate-900 text-white rounded-xl overflow-hidden flex flex-col p-4 font-sans border border-slate-700/50 shadow-2xl">
      <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-red-400">✅</span> Todoist Tasks
        </h2>
        {taskProvider.state === 'connected' && (
          <button 
            onClick={handleRetry}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            ↻ Sync
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <IntegrationStateBoundary
          provider={taskProvider}
          onConnect={handleConnect}
          onRetry={handleRetry}
        >
          {(tasks) => {
            const pendingTasks = tasks.filter(t => !t.isCompleted);
            
            return (
              <div className="space-y-2 pr-2">
                {pendingTasks.length === 0 ? (
                  <div className="text-center mt-8 space-y-2">
                    <div className="text-3xl">🎉</div>
                    <p className="text-slate-400 text-sm">All caught up!</p>
                  </div>
                ) : (
                  pendingTasks.map((task) => (
                    <div 
                      key={task.id} 
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        task.isOverdue 
                          ? 'bg-red-950/20 border-red-900/50 hover:bg-red-950/40' 
                          : 'bg-slate-800/60 border-slate-700/50 hover:bg-slate-800'
                      }`}
                    >
                      <button
                        onClick={() => handleComplete(task.id)}
                        disabled={completingId === task.id}
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                          completingId === task.id 
                            ? 'border-slate-500 bg-slate-700/50 cursor-wait' 
                            : 'border-slate-500 hover:border-green-400 hover:bg-green-400/20'
                        }`}
                      >
                        {completingId === task.id && (
                          <div className="w-3 h-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm truncate ${task.isOverdue ? 'text-red-200' : 'text-slate-200'}`}>
                          {task.title}
                        </div>
                        {task.isOverdue && (
                          <div className="text-[10px] font-medium text-red-400 uppercase tracking-wide">
                            Overdue
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          }}
        </IntegrationStateBoundary>
      </div>
    </div>
  );
}
