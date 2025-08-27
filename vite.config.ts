// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } }, // optional
  server: {
    proxy: {
      '/functions/v1': { target: 'http://localhost:54321', changeOrigin: true },
    },
  },
});
