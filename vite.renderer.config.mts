import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// eslint-disable-next-line import/no-unresolved
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Use predictable defaults for the two renderer servers. Forge records the
  // actual port after listen, including its fallback when another instance is
  // still shutting down.
  server: {
    port: 5173,
  },
});
