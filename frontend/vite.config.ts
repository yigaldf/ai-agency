import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, API calls go to the FastAPI server on :8000. In production FastAPI serves the built files itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
