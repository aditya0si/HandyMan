import { useEffect, useState } from 'react';
import { IntegrationStateBoundary } from '../IntegrationStateBoundary';
import { linksProvider } from '../../utils/integrations/mockProviders';

export function LinksCard() {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    if (linksProvider.state === 'connected') {
      linksProvider.refresh().catch(() => {}).finally(() => forceUpdate({}));
    }
  }, []);

  const handleConnect = async () => {
    await linksProvider.connect();
    forceUpdate({});
    await linksProvider.refresh();
    forceUpdate({});
  };

  const handleRetry = async () => {
    await linksProvider.refresh(true);
    forceUpdate({});
  };

  return (
    <div className="w-full h-full bg-slate-900 text-white rounded-xl overflow-hidden flex flex-col p-4 font-sans border border-slate-700/50 shadow-2xl">
      <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-blue-400">🔖</span> Saved Links
        </h2>
        {linksProvider.state === 'connected' && (
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
          provider={linksProvider}
          onConnect={handleConnect}
          onRetry={handleRetry}
        >
          {(links) => (
            <div className="space-y-2 pr-2">
              {links.length === 0 ? (
                <p className="text-slate-400 text-sm text-center mt-8">No saved links</p>
              ) : (
                links.map((link) => (
                  <a 
                    key={link.id} 
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-lg border border-slate-700/50 hover:bg-slate-800 transition-colors group cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded bg-slate-700/50 flex items-center justify-center text-slate-400 group-hover:text-blue-400 group-hover:bg-blue-500/10 transition-colors">
                      🌐
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-200 truncate group-hover:text-blue-300 transition-colors">
                        {link.title}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {new URL(link.url).hostname}
                      </div>
                    </div>
                    <div className="text-slate-600 group-hover:text-slate-400 transition-colors">
                      ↗
                    </div>
                  </a>
                ))
              )}
            </div>
          )}
        </IntegrationStateBoundary>
      </div>
    </div>
  );
}
