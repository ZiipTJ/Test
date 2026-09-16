import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/** L'import de géométrie (STEP, 3MF, STL) tourne dans un worker : l'interface
 *  reste réactive même sur un assemblage de plusieurs millions de triangles. */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@io': fileURLToPath(new URL('./src/io', import.meta.url)),
      '@state': fileURLToPath(new URL('./src/state', import.meta.url)),
      '@viewer': fileURLToPath(new URL('./src/viewer', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
  // Worker classique : le moteur OpenCascade est un module Emscripten UMD, chargé
  // par `importScripts` depuis public/wasm plutôt que passé au bundler.
  worker: { format: 'iife' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
