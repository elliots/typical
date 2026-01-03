import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import Typical from '@elliots/unplugin-typical/vite'

export default defineConfig({
  build: {
    sourcemap: true,
  },
  plugins: [
    Typical({
      typical: {
        // reusableValidators: true,
        validateCasts: true,
        // ignoreTypes: ['React.FormEvent'],
        debug: {
          writeIntermediateFiles: false,
        },
      },
    }),
    react(),
  ],
})
