import { useEffect, useState } from 'react';
import { IntegrationStateBoundary } from '../IntegrationStateBoundary';
import { calendarProvider } from '../../utils/integrations/mockProviders';

export function CalendarCard() {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    // Initial fetch if connected
    if (calendarProvider.state === 'connected') {
      calendarProvider.refresh().catch(() => {}).finally(() => forceUpdate({}));
    }
  }, []);

  const handleConnect = async () => {
    await calendarProvider.connect();
    forceUpdate({});
    await calendarProvider.refresh();
    forceUpdate({});
  };

  const handleRetry = async () => {
    await calendarProvider.refresh(true);
    forceUpdate({});
  };

  return (
    <div className="w-full h-full bg-slate-900 text-white rounded-xl overflow-hidden flex flex-col p-4 font-sans border border-slate-700/50 shadow-2xl">
      <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-blue-400">📅</span> Google Calendar
        </h2>
        {calendarProvider.state === 'connected' && (
          <button 
            onClick={handleRetry}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            ↻ Refresh
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <IntegrationStateBoundary
          provider={calendarProvider}
          onConnect={handleConnect}
          onRetry={handleRetry}
        >
          {(events) => (
            <div className="space-y-3 pr-2">
              {events.length === 0 ? (
                <p className="text-slate-400 text-sm text-center mt-8">No upcoming events</p>
              ) : (
                events.map((event) => (
                  <div key={event.id} className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/50 hover:bg-slate-800 transition-colors">
                    <div className="text-sm font-medium mb-1">{event.title}</div>
                    <div className="text-xs text-slate-400 flex justify-between items-center">
                      <span>
                        {event.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - 
                        {event.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {event.joinUrl && (
                        <a 
                          href={event.joinUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/40 transition-colors"
                        >
                          Join
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </IntegrationStateBoundary>
      </div>
    </div>
  );
}
