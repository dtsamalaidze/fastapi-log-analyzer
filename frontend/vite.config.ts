import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function readBackendPort(): number {
  try {
    const env = readFileSync(resolve(__dirname, '../.env'), 'utf-8')
    const match = env.match(/^PORT=(\d+)/m)
    return match ? parseInt(match[1]) : 8000
  } catch {
    return 8000
  }
}

const backendPort = readBackendPort()

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../static/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${backendPort}`,
      '/health': `http://localhost:${backendPort}`,
    },
  },
})
