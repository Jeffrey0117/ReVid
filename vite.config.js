import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    port: 3001,
    strictPort: true,
    watch: {
      // Never watch build output — electron-builder writes into release/ and
      // the watcher would crash with EBUSY (and reload on packaged files).
      ignored: ['**/release/**', '**/dist/**']
    }
  },
  build: {
    target: 'esnext'
  }
})
