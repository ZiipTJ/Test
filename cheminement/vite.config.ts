import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/** Le WASM d'OpenCascade et les mailleurs tournent dans des workers : on garde
 *  le format ES pour que Vite puisse les découper comme le reste du bundle. */
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
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['occt-import-js'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
