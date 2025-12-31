import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import Typical from '@elliots/unplugin-typical/vite'

export default defineConfig({
  plugins: [
    Typical({
      typical: {
        debug: {
          writeIntermediateFiles: true
        }
      }
    }),
    react(),
  ],
})
