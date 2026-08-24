import { useEffect, useState, useRef } from 'react';
import { IntegrationStateBoundary } from '../IntegrationStateBoundary';
import { musicProvider } from '../../utils/integrations/mockProviders';

export function MusicCard() {
  const [, forceUpdate] = useState({});
  const lastActionTime = useRef<number>(0);

  useEffect(() => {
    if (musicProvider.state === 'connected') {
      musicProvider.refresh().catch(() => {}).finally(() => forceUpdate({}));
    }
  }, []);

  const handleConnect = async () => {
    await musicProvider.connect();
    forceUpdate({});
    await musicProvider.refresh();
    forceUpdate({});
  };

  const handleRetry = async () => {
    await musicProvider.refresh(true);
    forceUpdate({});
  };

  // 400ms repeat guard for spatial gestures to prevent double triggers
  const withRepeatGuard = (action: () => Promise<void>) => async () => {
    const now = performance.now();
    if (now - lastActionTime.current < 400) {
      return; // Ignore if too soon (debounce/repeat guard)
    }
    lastActionTime.current = now;
    await action();
    forceUpdate({});
  };

  const togglePlay = withRepeatGuard(async () => {
    await musicProvider.togglePlayPause();
  });

  const nextTrack = withRepeatGuard(async () => {
    // Mock functionality for demo
    console.log("Next track triggered");
  });

  const prevTrack = withRepeatGuard(async () => {
    // Mock functionality for demo
    console.log("Previous track triggered");
  });

  const changeVolume = withRepeatGuard(async () => {
    const data = musicProvider.getData();
    if (data) {
      // Toggle volume between 0, 50, 100 for simple mock interaction
      const newVol = data.volume >= 100 ? 0 : data.volume + 50;
      await musicProvider.setVolume(newVol);
    }
  });

  return (
    <div className="w-full h-full bg-slate-900 text-white rounded-xl overflow-hidden flex flex-col p-4 font-sans border border-slate-700/50 shadow-2xl relative">
      <div className="absolute inset-0 bg-gradient-to-br from-green-900/20 to-slate-900 pointer-events-none" />
      
      <div className="flex items-center justify-between mb-2 relative z-10">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-green-400">
          Spotify
        </h2>
      </div>

      <div className="flex-1 flex flex-col justify-center relative z-10">
        <IntegrationStateBoundary
          provider={musicProvider}
          onConnect={handleConnect}
          onRetry={handleRetry}
        >
          {(state) => (
            <div className="flex flex-col items-center space-y-6">
              {/* Album Art Mock */}
              <div className="w-32 h-32 bg-slate-800 rounded-lg shadow-xl border border-slate-700 flex items-center justify-center overflow-hidden relative group">
                <div className="absolute inset-0 bg-gradient-to-tr from-green-500/20 to-blue-500/20" />
                <span className="text-4xl filter drop-shadow-md">🎵</span>
              </div>

              {/* Track Info */}
              <div className="text-center w-full px-2">
                <h3 className="text-lg font-bold truncate text-slate-100">{state.trackName}</h3>
                <p className="text-sm text-slate-400 truncate">{state.artist}</p>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center space-x-6 w-full">
                <button 
                  onClick={prevTrack}
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-800/50 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  ⏮
                </button>
                <button 
                  onClick={togglePlay}
                  className="w-14 h-14 flex items-center justify-center rounded-full bg-green-500 hover:bg-green-400 text-slate-900 text-xl shadow-lg transition-transform hover:scale-105 active:scale-95"
                >
                  {state.isPlaying ? '⏸' : '▶'}
                </button>
                <button 
                  onClick={nextTrack}
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-800/50 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  ⏭
                </button>
              </div>

              {/* Volume */}
              <div className="w-full flex items-center gap-3 px-4">
                <button onClick={changeVolume} className="text-slate-400 text-sm hover:text-white transition-colors">
                  {state.volume === 0 ? '🔇' : state.volume < 50 ? '🔉' : '🔊'}
                </button>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-slate-400 rounded-full transition-all duration-300" 
                    style={{ width: `${state.volume}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </IntegrationStateBoundary>
      </div>
    </div>
  );
}
