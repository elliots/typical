import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createGzip } from "zlib";
import { createReadStream, createWriteStream, statSync, unlinkSync } from "fs";
import { pipeline } from "stream/promises";
import { glob } from "glob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite plugin to compress WASM files with gzip after build.
 * Creates .wasm.gz files and removes the original uncompressed files.
 */
function compressWasmPlugin() {
  return {
    name: "compress-wasm",
    apply: "build",
    closeBundle: async () => {
      const wasmFiles = await glob("dist/**/*.wasm", { cwd: __dirname });
      for (const wasmFile of wasmFiles) {
        const inputPath = path.join(__dirname, wasmFile);
        const outputPath = inputPath + ".gz";

        const inputSize = statSync(inputPath).size;

        await pipeline(
          createReadStream(inputPath),
          createGzip({ level: 9 }),
          createWriteStream(outputPath),
        );

        const outputSize = statSync(outputPath).size;
        const ratio = ((1 - outputSize / inputSize) * 100).toFixed(1);
        console.log(
          `Compressed ${wasmFile}: ${(inputSize / 1024 / 1024).toFixed(1)}MB → ${(outputSize / 1024 / 1024).toFixed(1)}MB (${ratio}% smaller)`,
        );

        // Remove the original uncompressed file to stay under Cloudflare Pages limits
        unlinkSync(inputPath);
        console.log(`Removed uncompressed ${wasmFile}`);
      }
    },
  };
}

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        playground: "playground.html",
      },
    },
  },
  plugins: [compressWasmPlugin()],
  resolve: {
    alias: {
      "@typical/compiler-wasm": path.resolve(
        __dirname,
        "../../packages/compiler-wasm/dist/index.js",
      ),
    },
  },
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    include: ["monaco-editor"],
    exclude: ["@typical/compiler-wasm"],
  },
  worker: {
    format: "es",
  },
  server: {
    fs: {
      // Allow serving files from the packages directory
      allow: ["..", "../.."],
    },
  },
});
