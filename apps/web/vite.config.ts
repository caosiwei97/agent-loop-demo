import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['@excalidraw/excalidraw'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:38888', changeOrigin: true },
      '/vendor': { target: 'http://localhost:38888', changeOrigin: true },
    },
  },
});
