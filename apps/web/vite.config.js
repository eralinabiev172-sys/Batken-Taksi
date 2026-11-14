import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Dev only: same-origin access to the local API and WebSocket (used with VITE_USE_REAL_API=true).
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: true,
    exclude: ['e2e/**', 'e2e-real/**', 'node_modules/**', 'dist/**'],
  },
})
