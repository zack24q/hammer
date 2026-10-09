import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: 'chat-overlay',
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'chat-overlay/src') },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      output: { dir: '.vite/renderer/chat_overlay_window' },
    },
  },
});
