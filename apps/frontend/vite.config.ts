/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**'],
  },
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the shared package straight from TS source so no build step
      // is required before frontend dev/build.
      '@jarvis/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    // M14 (D2): vendor code-splitting via rolldown's advancedChunks (the
    // manualChunks successor). With a single entry and no dynamic imports
    // every chunk still loads at boot — the win is CACHE STABILITY (the
    // vendor chunks survive app deploys) + smaller parse units, honestly
    // documented in README M14.
    // NOTE: @mediapipe is NOT split here — its Closure bundles declare
    // sideEffects:[] and were being tree-shaken out of the module graph
    // entirely (a latent M1 production bug this milestone exposed and
    // fixed); they now load as ?url script assets, outside the graph.
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'vendor-three', test: /node_modules[\/]three[\/]/ },
            {
              name: 'vendor-react',
              test: /node_modules[\/](react|react-dom|scheduler)[\/]/,
            },
          ],
        },
      },
    },
  },
});
