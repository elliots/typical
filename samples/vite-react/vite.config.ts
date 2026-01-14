import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Typical from "@elliots/unplugin-typical/vite";

export default defineConfig({
  build: {
    sourcemap: true,
    minify: false,
    rollupOptions: {
      output: {
        manualChunks: undefined, // Don't split chunks
      },
    },
  },
  plugins: [
    Typical({
      enforce: "pre",
      typical: {
        validateCasts: true,
      },
    }),
    react(),
  ],
});
