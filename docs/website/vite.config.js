import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        playground: 'playground.html',
      },
    },
  },
  resolve: {
    alias: {
      '@typical/compiler-wasm': path.resolve(__dirname, '../../packages/compiler-wasm/dist/index.js'),
    },
  },
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    include: ['monaco-editor'],
    exclude: ['@typical/compiler-wasm'],
  },
  worker: {
    format: 'es',
  },
  server: {
    fs: {
      // Allow serving files from the packages directory
      allow: ['..', '../..'],
    },
  },
});
