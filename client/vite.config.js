import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Monaco-editor must NOT be pre-bundled by Vite — it ships its own ESM workers
    exclude: ['monaco-editor'],
  },
  build: {
    // Increase chunk size warning limit for Monaco (it's large by nature)
    chunkSizeWarningLimit: 5000,
  },
})
