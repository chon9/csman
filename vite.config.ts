import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Relative base so the built index.html loads assets via file:// inside Electron.
  base: './',
});
