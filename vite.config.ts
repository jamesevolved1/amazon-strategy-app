import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// GitHub Pages base path is only applied at build time. Dev server uses '/'.
// CI sets VITE_BASE=/amazon-strategy-app/ so the deployed bundle resolves under
// https://<user>.github.io/amazon-strategy-app/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.VITE_BASE ?? '/amazon-strategy-app/') : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
}))
