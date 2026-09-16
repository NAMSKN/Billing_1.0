import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'node:path';

// Vite config wires the React renderer plus the Electron main/preload builds.
// The main process and preload are compiled to CommonJS in dist-electron so the
// hardened BrowserWindow can load them. Native modules (better-sqlite3) stay
// external and run only in the main process.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  plugins: [
    react(),
    electron([
      {
        // Main process entry.
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              // Only the native module stays external. pdfkit/qrcode are pure JS
              // and are bundled into the main chunk so there are no runtime
              // require() resolutions inside the asar (avoids hoisting issues).
              external: ['better-sqlite3', 'electron'],
            },
          },
          resolve: {
            alias: { '@shared': resolve(__dirname, 'src/shared') },
          },
        },
      },
      {
        // Preload script: exposes a minimal, typed contextBridge API only.
        entry: 'src/preload/index.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
          resolve: {
            alias: { '@shared': resolve(__dirname, 'src/shared') },
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: 'dist',
  },
});
