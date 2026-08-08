import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve('src/renderer'),
  define: {
    __SAVEPOINT_DEMO__: true
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  }
})
