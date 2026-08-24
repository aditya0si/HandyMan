import type { ReactNode } from 'react';
import type { IntegrationProvider } from '../utils/integrations/integrationProvider';

interface IntegrationStateBoundaryProps<T> {
  provider: IntegrationProvider<T>;
  onRetry: () => void;
  onConnect: () => void;
  children: (data: T) => ReactNode;
  fallbackData?: T;
}

export function IntegrationStateBoundary<T>({
  provider,
  onRetry,
  onConnect,
  children,
  fallbackData,
}: IntegrationStateBoundaryProps<T>) {
  const { state } = provider;
  
  if (state === 'disconnected') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center space-y-4 text-white/80 bg-black/40 rounded-lg">
        <div className="text-2xl opacity-50">🔗</div>
        <p>Connect to {provider.name}</p>
        <button
          onClick={onConnect}
          className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 rounded-md transition-colors"
        >
          Connect
        </button>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 space-y-3 text-white/60 bg-black/40 rounded-lg">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
        <p className="text-sm">Loading {provider.name}...</p>
      </div>
    );
  }

  if (state === 'error') {
    const errorMsg = provider.getLastError() || 'Unknown error occurred';
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center space-y-4 text-white/80 bg-red-950/40 border border-red-500/30 rounded-lg">
        <div className="text-red-400 text-xl">⚠️</div>
        <p className="text-sm text-red-200">{errorMsg}</p>
        <div className="flex space-x-2">
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-md transition-colors text-sm"
          >
            Retry
          </button>
          {fallbackData && (
            <button
              onClick={() => {
                // Simulate success with fallback data (for demo purposes)
                // In a real scenario, this would likely trigger a mock switch in the provider
              }}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-md transition-colors text-sm opacity-50"
            >
              Use Demo Data
            </button>
          )}
        </div>
      </div>
    );
  }

  const data = provider.getData();
  
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center text-white/50 bg-black/40 rounded-lg">
        <p>No data available</p>
      </div>
    );
  }

  return <>{children(data)}</>;
}
