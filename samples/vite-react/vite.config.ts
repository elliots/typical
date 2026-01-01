import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import Typical from '@elliots/unplugin-typical/vite'

export default defineConfig({
  plugins: [
    Typical({
      typical: {
        "reusableValidators": true,
        "validateCasts": true,
        "ignoreTypes": ["React.*"],
        debug: {
          writeIntermediateFiles: false
        }
      }
    }),
    react(),
  ],
})
