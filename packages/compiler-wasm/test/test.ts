/**
 * Simple test for the WASM compiler.
 * Run with: npx tsx test/test.ts
 */

import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

// Inject Node.js modules for Go WASM
// Note: The WasmTypicalCompiler automatically installs the syncFS wrapper
(globalThis as any).path = path;
(globalThis as any).require = nodeRequire;

// Ensure process has TMPDIR set
if (!process.env.TMPDIR) {
  process.env.TMPDIR = os.tmpdir();
}

import { WasmTypicalCompiler } from "../dist/index.js";

async function main() {
  console.log("Starting WASM compiler test...");

  const compiler = new WasmTypicalCompiler();

  try {
    console.log("Starting compiler...");
    await compiler.start();
    console.log("Compiler started successfully!");

    console.log("Transforming TypeScript...");
    const result = await compiler.transformSource(
      "test.ts",
      `
      function greet(name: string): string {
        return 'Hello, ' + name
      }

      export { greet }
    `,
    );

    console.log("Transform result:");
    console.log(result.code);

    if (result.sourceMap) {
      console.log("\nSource map generated:", Object.keys(result.sourceMap));
    }

    console.log("\nTest passed!");
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  } finally {
    await compiler.close();
  }
}

main();
