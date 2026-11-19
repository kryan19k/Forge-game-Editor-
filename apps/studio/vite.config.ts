import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const daemon = process.env.FORGE_URL ?? 'http://127.0.0.1:4317';
const ws = daemon.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4318,
    strictPort: true,
    proxy: {
      '/api': { target: daemon, changeOrigin: true },
      '/ws': { target: ws, ws: true, changeOrigin: true },
      // Multiplayer sessions (authoritative rooms on the daemon).
      '/net': { target: ws, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        studio: resolve(import.meta.dirname, 'index.html'),
        play: resolve(import.meta.dirname, 'play.html'),
      },
    },
  },
});
