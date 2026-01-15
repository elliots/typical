/**
 * Cross-Project Validation Analysis Tests
 *
 * These tests verify that the project-wide analysis correctly identifies
 * opportunities to skip redundant validation across multiple files.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { TypicalTransformer } from "../src/transformer.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Test project directory
const PROJECT_DIR = resolve("test/project-fixtures");
const OUTPUT_DIR = resolve("test/output/project");
const TSCONFIG_PATH = resolve(PROJECT_DIR, "tsconfig.json");

// Clean up and create fresh directories
rmSync(PROJECT_DIR, { recursive: true, force: true });
rmSync(OUTPUT_DIR, { recursive: true, force: true });
mkdirSync(PROJECT_DIR, { recursive: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

// Write tsconfig for the test project
writeFileSync(
  TSCONFIG_PATH,
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "node",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        declaration: false,
        noEmit: true,
      },
      include: ["./**/*.ts"],
    },
    null,
    2,
  ),
);

// Counter for unique test output directories
let testCounter = 0;

/**
 * Sets up a multi-file project and transforms all files.
 * Returns transformed code for each file.
 * Also writes output to test/output/{testName}/ for inspection:
 *   - file.original.ts - the original source
 *   - file.ts - the transformed output
 *   - file.ts.map - the source map
 */
async function transformProject(
  files: Record<string, string>,
  testName?: string,
): Promise<Record<string, string>> {
  // Generate a unique directory name for this test
  testCounter++;
  const outputSubdir = testName ?? `test-${testCounter}`;
  const testOutputDir = resolve(OUTPUT_DIR, outputSubdir);
  mkdirSync(testOutputDir, { recursive: true });

  // Write all source files
  for (const [filename, content] of Object.entries(files)) {
    const fullPath = resolve(PROJECT_DIR, filename);
    writeFileSync(fullPath, content);

    // Write original source to output directory
    const baseName = filename.replace(/\.ts$/, "");
    const originalPath = resolve(testOutputDir, `${baseName}.original.ts`);
    mkdirSync(dirname(originalPath), { recursive: true });
    writeFileSync(originalPath, content);
  }

  // Create transformer
  const transformer = new TypicalTransformer(undefined, TSCONFIG_PATH);

  try {
    // Transform all files
    const results: Record<string, string> = {};
    for (const filename of Object.keys(files)) {
      const fullPath = resolve(PROJECT_DIR, filename);
      const result = await transformer.transform(fullPath, "ts");
      results[filename] = result.code;

      // Write transformed output with real name
      const outputPath = resolve(testOutputDir, filename);
      writeFileSync(outputPath, result.code);

      // Write source map if available
      if (result.map) {
        const mapPath = resolve(testOutputDir, `${filename}.map`);
        writeFileSync(mapPath, JSON.stringify(result.map, null, 2));
      }
    }
    return results;
  } finally {
    await transformer.close();
  }
}

/**
 * Helper to check if transformed code contains a pattern
 */
function assertContains(code: string, pattern: string | RegExp, message?: string) {
  if (typeof pattern === "string") {
    assert.ok(
      code.includes(pattern),
      message ?? `Expected code to contain: ${pattern}\n\nCode:\n${code}`,
    );
  } else {
    assert.ok(
      pattern.test(code),
      message ?? `Expected code to match: ${pattern}\n\nCode:\n${code}`,
    );
  }
}

/**
 * Helper to check if transformed code does NOT contain a pattern
 */
function assertNotContains(code: string, pattern: string | RegExp, message?: string) {
  if (typeof pattern === "string") {
    assert.ok(
      !code.includes(pattern),
      message ?? `Expected code NOT to contain: ${pattern}\n\nCode:\n${code}`,
    );
  } else {
    assert.ok(
      !pattern.test(code),
      message ?? `Expected code NOT to match: ${pattern}\n\nCode:\n${code}`,
    );
  }
}

/**
 * Helper to count occurrences of a pattern in code
 */
function countOccurrences(code: string, pattern: string | RegExp): number {
  if (typeof pattern === "string") {
    return code.split(pattern).length - 1;
  }
  return (code.match(new RegExp(pattern, "g")) || []).length;
}

// =============================================================================
// BASIC PROJECT ANALYSIS
// =============================================================================

void describe("Cross-Project Validation Analysis", () => {
  void describe("Basic Project Setup", () => {
    it("should transform multiple files in a project", async () => {
      const results = await transformProject(
        {
          "types.ts": `export interface User { name: string; age: number }`,
          "utils.ts": `
          import { User } from './types.js';
          export function processUser(user: User): string {
            return user.name;
          }
        `,
        },
        "basic-multi-file",
      );

      assert.ok(results["types.ts"], "types.ts should be transformed");
      assert.ok(results["utils.ts"], "utils.ts should be transformed");

      // utils.ts should validate the user parameter - check for object validation
      assertContains(
        results["utils.ts"],
        'typeof user === "object"',
        "should check user is object",
      );
      // Should validate name property is string
      assertContains(results["utils.ts"], "typeof user.name", "should check user.name type");
      // Should validate age property is number
      assertContains(results["utils.ts"], "typeof user.age", "should check user.age type");
    });
  });

  // =============================================================================
  // TRUSTED RETURN VALUES
  // =============================================================================

  void describe("Trusted Return Values", () => {
    it("should trust return values from functions that validate their return", async () => {
      const results = await transformProject(
        {
          "validator.ts": `
          export interface User { name: string; age: number }

          export function validateUser(data: unknown): User {
            // This function validates its return type
            return data as User;
          }
        `,
          "consumer.ts": `
          import { validateUser, User } from './validator.js';

          export function processData(data: unknown): User {
            const user = validateUser(data);
            // Since validateUser validates its return, we don't need to re-validate
            return user;
          }
        `,
        },
        "trusted-return-values",
      );

      // validator.ts should validate the cast (data as User) via _check_User
      assertContains(
        results["validator.ts"],
        "_check_User",
        "validator should use _check_User function",
      );
      assertContains(
        results["validator.ts"],
        'typeof _v === "object"',
        "validator should check object type",
      );

      // consumer.ts: user comes from validateUser which validates its return
      // Cross-project tracking recognises validateUser validates its return, so user is trusted
      assertContains(
        results["consumer.ts"],
        "/* already valid */",
        "consumer trusts validateUser return value",
      );
      assertNotContains(
        results["consumer.ts"],
        '"return value"',
        "consumer should NOT re-validate trusted return",
      );
    });

    it("should validate return when value comes from external function", async () => {
      const results = await transformProject(
        {
          "index.ts": `
          export interface User { name: string }

          // External function - we don't know if it validates
          declare function externalGetUser(): User;

          export function getUser(): User {
            const user = externalGetUser();
            return user; // user is validated at assignment, so return is already valid
          }
        `,
        },
        "external-return-validation",
      );

      // Should validate the externalGetUser() result at assignment time
      // Pattern: const user = externalGetUser(); if ((_e = _check_User(user, "user")) !== null) throw ...
      assertContains(
        results["index.ts"],
        /externalGetUser\(\).*_check_User\(user, "user"\)/,
        "should validate external call result at assignment",
      );
      // Since user is now validated, return should be /* already valid */
      assertContains(
        results["index.ts"],
        "/* already valid */",
        "return is already valid (validated at assignment)",
      );
    });
  });

  // =============================================================================
  // INTERNAL FUNCTION PARAMETER SKIPPING
  // =============================================================================

  void describe("Internal Function Parameter Skipping", () => {
    it("should validate parameters on exported functions", async () => {
      const results = await transformProject(
        {
          "public.ts": `
          export interface User { name: string }

          // Exported function - must always validate
          export function processUser(user: User): string {
            return user.name;
          }
        `,
        },
        "exported-function-validation",
      );

      // Exported function must validate its parameter
      assertContains(
        results["public.ts"],
        'typeof user === "object"',
        "should validate user param is object",
      );
      assertContains(results["public.ts"], "typeof user.name", "should validate user.name type");
      // Return should skip validation since user.name is from validated user
      assertContains(
        results["public.ts"],
        "/* already valid */",
        "should skip return validation for validated property",
      );
    });

    it("internal functions can skip param validation when all callers pre-validate", async () => {
      const results = await transformProject(
        {
          "internal.ts": `
          interface User { name: string }

          // Internal function - only called with validated values
          function processUserInternal(user: User): string {
            return user.name;
          }

          export function run(data: unknown): string {
            const user = data as User;
            return processUserInternal(user);
          }
        `,
        },
        "internal-function-validation",
      );

      // The cast should be validated (creates validated 'user' variable)
      assertContains(
        results["internal.ts"],
        '_check_User(data, "data")',
        "should validate cast from unknown",
      );

      // Internal function SKIPS param validation - all callers (just 'run') pass validated values
      // processUserInternal is called with 'user' which was validated by the cast
      assertNotContains(
        results["internal.ts"],
        /function processUserInternal\(user: User\): string \{\s*if/,
        "internal function should skip param validation",
      );
    });
  });

  // =============================================================================
  // MUTATION TRACKING
  // =============================================================================

  void describe("Mutation Tracking", () => {
    it("should re-validate after direct mutation", async () => {
      const results = await transformProject(
        {
          "mutation.ts": `
          interface User { name: string }

          export function process(user: User): User {
            user.name = "mutated"; // Direct mutation
            return user; // Should re-validate
          }
        `,
        },
        "mutation-revalidation",
      );

      // Should validate parameter (uses _check_User)
      assertContains(
        results["mutation.ts"],
        '_check_User(user, "user")',
        "should validate user param",
      );
      // Should NOT skip validation after mutation - must re-validate
      assertNotContains(
        results["mutation.ts"],
        "/* already valid */",
        "should not skip after mutation",
      );
      // Return should have explicit validation (IIFE or _check function)
      assertContains(results["mutation.ts"], '"return value"', "should validate return value");
    });

    it("should re-validate after reassignment", async () => {
      const results = await transformProject(
        {
          "reassign.ts": `
          export function process(input: string): string {
            input = "replaced" as any;
            return input; // Should re-validate
          }
        `,
        },
        "reassignment-revalidation",
      );

      // Should NOT skip validation after reassignment
      assertNotContains(
        results["reassign.ts"],
        "/* already valid */",
        "should not skip after reassignment",
      );
    });

    it("should validate dirty value when passed to external function", async () => {
      const results = await transformProject(
        {
          "dirty-external.ts": `
          interface User { name: string }

          declare function externalProcess(u: User): void;

          export function process(user: User): void {
            user.name = "mutated"; // Now dirty
            externalProcess(user); // Should validate here since user is dirty
          }
        `,
        },
        "dirty-value-to-external",
      );

      // Should validate parameter initially
      assertContains(
        results["dirty-external.ts"],
        '_check_User(user, "user")',
        "should validate user param initially",
      );
      // Should re-validate before passing to external function (dirty value)
      // The externalProcess call should wrap user with validation
      assertContains(
        results["dirty-external.ts"],
        'externalProcess(((_e = _check_User(user, "user"))',
        "should validate dirty user before external call",
      );
    });

    it("should NOT validate clean value when passed to external function", async () => {
      const results = await transformProject(
        {
          "clean-external.ts": `
          interface User { name: string }

          declare function externalProcess(u: User): void;

          export function process(user: User): void {
            // user is clean (not mutated since validation)
            externalProcess(user); // Should NOT wrap - user is still valid
          }
        `,
        },
        "clean-value-to-external",
      );

      // Should validate parameter initially
      assertContains(
        results["clean-external.ts"],
        '_check_User(user, "user")',
        "should validate user param initially",
      );
      // Should NOT wrap the argument - user is clean
      assertNotContains(
        results["clean-external.ts"],
        "externalProcess(((_e = _check_User",
        "should not validate clean user before external call",
      );
      // The call should just be externalProcess(user)
      assertContains(
        results["clean-external.ts"],
        "externalProcess(user)",
        "should pass user directly without wrapping",
      );
    });

    it("should skip validation when value is unchanged", async () => {
      const results = await transformProject(
        {
          "unchanged.ts": `
          export function process(input: string): string {
            return input; // Identity - should skip
          }
        `,
        },
        "unchanged-skip-validation",
      );

      // Should validate parameter
      assertContains(results["unchanged.ts"], "typeof input", "should validate input param");
      // Should skip validation for identity return
      assertContains(
        results["unchanged.ts"],
        "/* already valid */",
        "should skip return validation for unchanged value",
      );
    });
  });

  // =============================================================================
  // ASYNC ESCAPE TRACKING
  // =============================================================================

  void describe("Async Escape Tracking", () => {
    it("should validate after external call in sync function", async () => {
      const results = await transformProject(
        {
          "sync-external.ts": `
          interface User { name: string }

          declare function externalProcess(u: User): void;

          export function process(user: User): User {
            externalProcess(user); // Escapes to external
            return user; // Should still validate
          }
        `,
        },
        "sync-external-escape",
      );

      // Should validate parameter (uses _check_User)
      assertContains(
        results["sync-external.ts"],
        '_check_User(user, "user")',
        "should validate user param",
      );
      // After external call in sync function, should still validate return
      // (sync functions don't have the permanent escape problem)
      assertNotContains(
        results["sync-external.ts"],
        "/* already valid */",
        "should validate return after external call",
      );
    });

    it("should validate after await in async function with external escape", async () => {
      const results = await transformProject(
        {
          "async-escape.ts": `
          interface User { name: string }

          declare function externalSave(u: User): Promise<void>;

          export async function save(user: User): Promise<User> {
            await externalSave(user); // Escapes to external + await
            return user; // Must validate - escaped + awaited
          }
        `,
        },
        "async-external-escape",
      );

      // Should validate parameter (uses _check_User)
      assertContains(
        results["async-escape.ts"],
        '_check_User(user, "user")',
        "should validate user param",
      );
      // After external escape + await, must validate - NOT skip
      assertNotContains(
        results["async-escape.ts"],
        "/* already valid */",
        "must validate after escape+await",
      );
      // Should have return value validation
      assertContains(results["async-escape.ts"], '"return value"', "should validate return value");
    });

    it("should validate on every use after permanent escape in async", async () => {
      const results = await transformProject(
        {
          "permanent-escape.ts": `
          interface User { name: string }

          declare function externalLib(u: User): Promise<void>;

          export async function process(user: User): Promise<string> {
            await externalLib(user); // user escapes + await
            console.log(user.name);  // Must validate
            await Promise.resolve();
            return user.name;        // Must validate again
          }
        `,
        },
        "permanent-async-escape",
      );

      // Should validate parameter initially (uses _check_User)
      assertContains(
        results["permanent-escape.ts"],
        '_check_User(user, "user")',
        "should validate user param",
      );
      // After permanent escape, every use should validate - not skip
      assertNotContains(
        results["permanent-escape.ts"],
        "/* already valid */",
        "should not skip after permanent escape",
      );
    });
  });

  // =============================================================================
  // PURE FUNCTIONS
  // =============================================================================

  void describe("Pure Function Handling", () => {
    it("should not mark as dirty after pure function call", async () => {
      const results = await transformProject(
        {
          "pure.ts": `
          export function process(input: string): string {
            console.log(input); // Pure - doesn't mutate
            return input; // Should skip validation
          }
        `,
        },
        "pure-function-console-log",
      );

      // Should validate parameter
      assertContains(results["pure.ts"], "typeof input", "should validate input param");
      // console.log is pure, so input is still valid - should skip return validation
      assertContains(
        results["pure.ts"],
        "/* already valid */",
        "should skip after pure function call",
      );
    });

    it("should not mark as dirty after JSON.stringify", async () => {
      const results = await transformProject(
        {
          "stringify.ts": `
          interface User { name: string }

          export function serialize(user: User): User {
            const json = JSON.stringify(user); // Pure
            console.log(json);
            return user; // Should skip validation
          }
        `,
        },
        "pure-function-json-stringify",
      );

      // Should validate parameter (uses _check_User)
      assertContains(
        results["stringify.ts"],
        '_check_User(user, "user")',
        "should validate user param",
      );
      // JSON.stringify is pure - should skip return validation
      assertContains(
        results["stringify.ts"],
        "/* already valid */",
        "should skip after JSON.stringify",
      );
    });
  });

  // =============================================================================
  // PROPERTY ACCESS VALIDATION
  // =============================================================================

  void describe("Property Access Validation", () => {
    it("should validate property access on validated object", async () => {
      const results = await transformProject(
        {
          "property.ts": `
          interface User { name: string }

          export function getName(user: User): string {
            return user.name; // Should skip - user is validated
          }
        `,
        },
        "property-access-validation",
      );

      // Should validate parameter
      assertContains(
        results["property.ts"],
        'typeof user === "object"',
        "should validate user param",
      );
      // Property access on validated object should skip return validation
      assertContains(
        results["property.ts"],
        "/* already valid */",
        "should skip return for validated property",
      );
    });

    it("should validate nested property access", async () => {
      const results = await transformProject(
        {
          "nested.ts": `
          interface Address { city: string }
          interface User { address: Address }

          export function getCity(user: User): string {
            return user.address.city; // Should skip - nested valid
          }
        `,
        },
        "nested-property-access",
      );

      // Should validate nested structure
      assertContains(results["nested.ts"], "user.address", "should validate user.address");
      // Nested property on validated should skip return validation
      assertContains(
        results["nested.ts"],
        "/* already valid */",
        "should skip return for nested valid property",
      );
    });
  });

  // =============================================================================
  // VARIABLE ALIASING
  // =============================================================================

  void describe("Variable Aliasing", () => {
    it("should track validation through variable aliasing", async () => {
      const results = await transformProject(
        {
          "alias.ts": `
          export function process(input: string): string {
            const copy = input; // Alias
            return copy; // Should skip - copy inherits validation
          }
        `,
        },
        "variable-aliasing",
      );

      // Should validate parameter
      assertContains(results["alias.ts"], "typeof input", "should validate input param");
      // Alias should inherit validation status - skip return validation
      assertContains(
        results["alias.ts"],
        "/* already valid */",
        "should skip return for aliased variable",
      );
    });

    it("should track validation through property aliasing", async () => {
      const results = await transformProject(
        {
          "prop-alias.ts": `
          interface User { name: string }

          export function process(user: User): string {
            const name = user.name; // Property alias
            return name; // Should skip - name is valid string
          }
        `,
        },
        "property-aliasing",
      );

      // Should validate parameter
      assertContains(
        results["prop-alias.ts"],
        'typeof user === "object"',
        "should validate user param",
      );
      // Property alias should be valid - skip return validation
      assertContains(
        results["prop-alias.ts"],
        "/* already valid */",
        "should skip return for property alias",
      );
    });
  });

  // =============================================================================
  // JSON.PARSE VALIDATION
  // =============================================================================

  void describe("JSON.parse Validation", () => {
    it("should validate JSON.parse with type annotation", async () => {
      const results = await transformProject(
        {
          "json-parse.ts": `
          interface User { name: string }

          export function parseUser(json: string): User {
            const user: User = JSON.parse(json);
            return user; // Should skip - just validated by JSON.parse
          }
        `,
        },
        "json-parse-type-annotation",
      );

      // JSON.parse should be transformed to include validation/filtering
      assertContains(results["json-parse.ts"], "JSON.parse", "should have JSON.parse");
      // The parsed result should be validated/filtered
      assertContains(results["json-parse.ts"], "typeof", "should have type checking");
    });

    it("should validate JSON.parse with as cast", async () => {
      const results = await transformProject(
        {
          "json-cast.ts": `
          interface User { name: string }

          export function parseUser(json: string): User {
            return JSON.parse(json) as User;
          }
        `,
        },
        "json-parse-as-cast",
      );

      // JSON.parse with cast should be transformed to validate
      assertContains(results["json-cast.ts"], "JSON.parse", "should have JSON.parse");
      // Should validate the User type
      assertContains(results["json-cast.ts"], "typeof", "should have type checking for cast");
    });
  });

  // =============================================================================
  // CROSS-FILE IMPORTS
  // =============================================================================

  void describe("Cross-File Imports", () => {
    it("should handle imports from other project files", async () => {
      const results = await transformProject(
        {
          "types.ts": `
          export interface User {
            name: string;
            email: string;
          }
        `,
          "validators.ts": `
          import { User } from './types.js';

          export function createUser(name: string, email: string): User {
            return { name, email };
          }
        `,
          "app.ts": `
          import { User } from './types.js';
          import { createUser } from './validators.js';

          export function run(name: string, email: string): User {
            const user = createUser(name, email);
            return user;
          }
        `,
        },
        "cross-file-imports",
      );

      assert.ok(results["types.ts"], "types.ts should be transformed");
      assert.ok(results["validators.ts"], "validators.ts should be transformed");
      assert.ok(results["app.ts"], "app.ts should be transformed");
      // validators.ts should validate the string parameters
      assertContains(results["validators.ts"], "typeof name", "should validate name param");
      assertContains(results["validators.ts"], "typeof email", "should validate email param");
      // app.ts should validate string parameters too
      assertContains(results["app.ts"], "typeof name", "app should validate name param");
    });

    it("should validate types defined in other files", async () => {
      const results = await transformProject(
        {
          "shared.ts": `
          export interface Config {
            host: string;
            port: number;
          }
        `,
          "server.ts": `
          import { Config } from './shared.js';

          export function startServer(config: Config): string {
            return config.host + ':' + config.port;
          }
        `,
        },
        "cross-file-type-validation",
      );

      // Should validate Config from shared.ts - check for object and property validation
      assertContains(
        results["server.ts"],
        'typeof config === "object"',
        "should validate config is object",
      );
      assertContains(results["server.ts"], "config.host", "should reference config.host");
      assertContains(results["server.ts"], "config.port", "should reference config.port");
    });
  });

  // =============================================================================
  // COMPLEX SCENARIOS
  // =============================================================================

  void describe("Complex Scenarios", () => {
    it("should handle chained function calls", async () => {
      const results = await transformProject(
        {
          "chain.ts": `
          interface User { name: string }

          function step1(u: User): User { return u; }
          function step2(u: User): User { return u; }

          export function process(user: User): User {
            return step2(step1(user));
          }
        `,
        },
        "chained-function-calls",
      );

      // Should validate the user parameter in process (exported function)
      assertContains(
        results["chain.ts"],
        '_check_User(user, "user")',
        "should validate user param in exported function",
      );

      // Cross-project optimisation FULLY implemented:
      // ✅ step1 skips param validation - called with validated 'user' from process
      // ✅ step2 skips param validation - called with step1(user) which validates its return
      // ✅ process skips return validation - step2 validates its return

      // step1 should NOT have param validation (gets validated 'user')
      assertNotContains(
        results["chain.ts"],
        /function step1\(u: User\): User \{[^}]*_check_User/,
        "step1 should skip param validation",
      );
      // Should have skip comment
      assertContains(
        results["chain.ts"],
        "/* u: validated by callers */",
        "step1 should have skip comment",
      );

      // step2 should NOT have param validation (gets return from step1 which validates its return)
      assertNotContains(
        results["chain.ts"],
        /function step2\(u: User\): User \{[^}]*_check_User/,
        "step2 should skip param validation",
      );

      // process return should skip validation (step2 validates its return)
      assertNotContains(
        results["chain.ts"],
        '"return value"',
        "process should skip return validation",
      );
      // Should have skip comment on return
      assertContains(
        results["chain.ts"],
        /return\/\* already valid \*\/ step2/,
        "process return should have skip comment",
      );
    });

    it("should handle chained function calls with intermediate variable", async () => {
      const results = await transformProject(
        {
          "chain-var.ts": `
          interface User { name: string }

          function step1(u: User): User { return u; }
          function step2(u: User): User { return u; }

          export function process(user: User): User {
            const user2 = step2(step1(user));
            return user2;
          }
        `,
        },
        "chained-function-calls-var",
      );

      // Should validate the user parameter in process (exported function)
      assertContains(
        results["chain-var.ts"],
        '_check_User(user, "user")',
        "should validate user param in exported function",
      );

      // step1 and step2 should skip param validation (same as above)
      assertContains(
        results["chain-var.ts"],
        "/* u: validated by callers */",
        "internal functions should have skip comment",
      );

      // user2 is assigned from step2 which validates its return, so returning user2 should be already valid
      assertContains(
        results["chain-var.ts"],
        /return\/\* already valid \*\/ user2/,
        "return user2 should be already valid",
      );
    });

    it("should validate before passing to external function after escape", async () => {
      const results = await transformProject(
        {
          "external-chain.ts": `
          interface User { name: string }

          function step1(u: User): User { return u; }
          export function step2(u: User): User { return u; }
          declare function step3(u: User): User;

          export function process(user: User): User {
            const user2 = step2(step1(user));
            const user3 = step3(user2);  // user2 validated, passes to external
            let user4 = step3(user3);  // user3 is dirty (escaped to step3), needs validation
            console.log(user4.name);
            user4 = step3(user3);  // user3 still dirty
            console.log(user4.name)
            return user3;
          }
        `,
        },
        "external-chain",
      );

      // Should validate user parameter in process
      assertContains(
        results["external-chain.ts"],
        '_check_User(user, "user")',
        "should validate user param",
      );

      // Internal functions should skip param validation
      assertContains(
        results["external-chain.ts"],
        "/* u: validated by callers */",
        "internal functions skip validation",
      );

      // user3 = step3(user2) - step3 doesn't validate its return, validate after assignment
      // Pattern: const user3 = step3(user2); if ((_e = _check_User(user3, "user3")) !== null) throw ...
      assertContains(
        results["external-chain.ts"],
        /step3\(user2\).*_check_User\(user3, "user3"\)/,
        "should validate step3 result for user3",
      );

      // let user4 = step3(user3) - user4 is used (console.log(user4.name)), needs validation
      // Pattern: let user4 = step3(user3); if ((_e = _check_User(user4, "user4")) !== null) throw ...
      assertContains(
        results["external-chain.ts"],
        /let user4 = step3\(user3\).*_check_User\(user4, "user4"\)/,
        "should validate first user4 assignment",
      );

      // user4 = step3(user3) - reassignment, user4 is used again, needs validation
      // Pattern: user4 = step3(user3); if ((_e = _check_User(user4, "user4")) !== null) throw ...
      // Note: The reassignment also needs validation since user4 is read after it
      assertContains(
        results["external-chain.ts"],
        /user4 = step3\(user3\).*_check_User\(user4, "user4"\).*console\.log\(user4\.name\)/s,
        "should validate second user4 assignment",
      );

      // Return should use _check_User (hoisted) not inline validator
      assertContains(results["external-chain.ts"], "_check_User", "should use hoisted _check_User");
    });

    it("should handle conditional returns", async () => {
      const results = await transformProject(
        {
          "conditional.ts": `
          interface User { name: string }

          export function process(user: User, flag: boolean): User | null {
            if (flag) {
              return user; // Should skip - user is valid
            }
            return null;
          }
        `,
        },
        "conditional-returns",
      );

      // Should validate user parameter (uses _check_User)
      assertContains(
        results["conditional.ts"],
        '_check_User(user, "user")',
        "should validate user param",
      );
      // Should validate flag parameter
      assertContains(results["conditional.ts"], "typeof flag", "should validate flag param");
    });

    it("should handle array operations", async () => {
      const results = await transformProject(
        {
          "array-ops.ts": `
          interface User { name: string }

          export function getFirst(users: User[]): User | undefined {
            return users[0]; // Element access
          }
        `,
        },
        "array-operations",
      );

      // Should validate the array parameter
      assertContains(
        results["array-ops.ts"],
        "Array.isArray(users)",
        "should validate users is array",
      );
    });

    it("should handle spread operations", async () => {
      const results = await transformProject(
        {
          "spread.ts": `
          interface User { name: string; age: number }

          export function clone(user: User): User {
            return { ...user };
          }
        `,
        },
        "spread-operations",
      );

      // Should validate user parameter (uses _check_User)
      assertContains(
        results["spread.ts"],
        '_check_User(user, "user")',
        "should validate user param",
      );
      // Return should have validation (spread creates new object)
      assertContains(results["spread.ts"], '"return value"', "should validate return value");
    });
  });

  // =============================================================================
  // PARAMETER ESCAPE ANALYSIS
  // =============================================================================

  void describe("Parameter Escape Analysis", () => {
    it("should detect escape via field storage", async () => {
      const results = await transformProject(
        {
          "field-escape.ts": `
          interface User { name: string }
          interface Container { user: User | null }

          const container: Container = { user: null };

          export function storeUser(user: User): void {
            container.user = user; // Escapes via field storage
          }

          function internalProcess(user: User): string {
            return user.name;
          }

          export function process(user: User): string {
            storeUser(user);
            return internalProcess(user); // user escaped, must re-validate
          }
        `,
        },
        "field-escape",
      );

      // storeUser should validate its parameter (exported function)
      assertContains(
        results["field-escape.ts"],
        "function storeUser(user: User): void { if",
        "storeUser should validate user param",
      );

      // internalProcess is NOT called with pre-validated values in all cases
      // because in 'process', user has escaped via storeUser before being passed
      // So internalProcess should NOT have "validated by callers" comment
      // (The escape means we can't trust that all callers have pre-validated it)
    });

    it("should detect escape via global variable storage", async () => {
      const results = await transformProject(
        {
          "global-escape.ts": `
          interface User { name: string }

          let cachedUser: User | null = null;

          export function cacheUser(user: User): void {
            cachedUser = user; // Escapes via global storage
          }

          function processInternal(user: User): string {
            return user.name;
          }

          export function processAndCache(user: User): string {
            cacheUser(user);
            cachedUser!.name = 'modified'; // user has escaped via global, then modified
            return processInternal(user); // user is now dirty - must re-validate
          }
        `,
        },
        "global-escape",
      );

      // cacheUser should validate parameter (exported)
      assertContains(
        results["global-escape.ts"],
        "function cacheUser(user: User): void { if",
        "cacheUser should validate user param",
      );

      // processInternal should validate because user was escaped then modified
      // The call to processInternal(user) happens after cachedUser.name = 'modified'
      // Since user and cachedUser point to the same object, user is now dirty
      assertContains(
        results["global-escape.ts"],
        "function processInternal(user: User): string { if",
        "processInternal should validate user param because user is dirty after escape+modify",
      );
    });

    it("should detect escape via closure capture", async () => {
      const results = await transformProject(
        {
          "closure-escape.ts": `
          interface User { name: string }

          export function createGreeter(user: User): () => string {
            // user is captured by the returned closure - escapes
            return () => {
              return "Hello, " + user.name;
            };
          }

          function internalGreet(user: User): string {
            return user.name;
          }

          export function greetAndCapture(user: User): () => string {
            const greeter = createGreeter(user);
            internalGreet(user); // user has escaped via closure
            return greeter;
          }
        `,
        },
        "closure-escape",
      );

      // createGreeter should validate parameter (exported, and user escapes via closure)
      assertContains(
        results["closure-escape.ts"],
        "function createGreeter(user: User): () => string { if",
        "createGreeter should validate user param",
      );
    });

    it("should detect escape via arrow function capture", async () => {
      const results = await transformProject(
        {
          "arrow-escape.ts": `
          interface User { name: string }

          export function createCallback(user: User): () => string {
            // Arrow function captures user
            const callback = () => user.name;
            return callback;
          }
        `,
        },
        "arrow-escape",
      );

      // Should validate parameter since user escapes via arrow function
      // Uses inline validation (not hoisted) for small files
      assertContains(
        results["arrow-escape.ts"],
        'typeof user === "object"',
        "should validate user param that escapes via arrow",
      );
    });

    it("should NOT detect escape for primitives", async () => {
      const results = await transformProject(
        {
          "primitive-no-escape.ts": `
          let cached: string = "";

          export function cacheString(input: string): void {
            cached = input; // Primitive - doesn't escape
          }

          export function process(input: string): string {
            cacheString(input);
            return input; // Should still be valid - primitives don't escape
          }
        `,
        },
        "primitive-no-escape",
      );

      // cacheString should validate its string parameter
      assertContains(
        results["primitive-no-escape.ts"],
        "typeof input",
        "should validate input param",
      );
      // In process, returning input should be valid (primitives don't have escape issues)
      assertContains(
        results["primitive-no-escape.ts"],
        "/* already valid */",
        "should skip return validation for primitive",
      );
    });

    it("should detect escape via nested property assignment", async () => {
      const results = await transformProject(
        {
          "nested-field-escape.ts": `
          interface User { name: string }
          interface State { data: { user: User | null } }

          const state: State = { data: { user: null } };

          export function setUser(user: User): void {
            state.data.user = user; // Escapes via nested field
          }
        `,
        },
        "nested-field-escape",
      );

      // Should validate parameter since user escapes via nested field assignment
      // Uses inline validation (not hoisted) for small files
      assertContains(
        results["nested-field-escape.ts"],
        'typeof user === "object"',
        "should validate user that escapes via nested field",
      );
    });

    it("should detect escape via element access assignment", async () => {
      const results = await transformProject(
        {
          "element-escape.ts": `
          interface User { name: string }

          const users: User[] = [];

          export function addUser(user: User): void {
            users[users.length] = user; // Escapes via element access
          }
        `,
        },
        "element-escape",
      );

      // Should validate parameter since user escapes via array assignment
      // Uses inline validation (not hoisted) for small files
      assertContains(
        results["element-escape.ts"],
        'typeof user === "object"',
        "should validate user that escapes via element access",
      );
    });

    it("should handle shadowed parameters in closures", async () => {
      const results = await transformProject(
        {
          "shadowed-closure.ts": `
          interface User { name: string }

          export function process(user: User): (u: User) => string {
            // Inner function shadows 'user' - outer user does NOT escape
            return (user: User) => {
              return user.name;
            };
          }
        `,
        },
        "shadowed-closure",
      );

      // Outer user should be validated (on the process function)
      assertContains(
        results["shadowed-closure.ts"],
        "function process(user: User): (u: User) => string { if",
        "should validate outer user param",
      );
      // Return should be valid since outer user doesn't escape (it's shadowed)
      // The outer user is not captured by the closure
    });
  });

  // =============================================================================
  // EDGE CASES
  // =============================================================================

  void describe("Edge Cases", () => {
    it("should handle recursive types", async () => {
      const results = await transformProject(
        {
          "recursive.ts": `
          interface TreeNode {
            value: string;
            children?: TreeNode[];
          }

          export function process(node: TreeNode): string {
            return node.value;
          }
        `,
        },
        "recursive-types",
      );

      // Recursive types generate named check functions
      assertContains(
        results["recursive.ts"],
        "_check_TreeNode",
        "should generate recursive type checker",
      );
      // Should validate the node parameter
      assertContains(results["recursive.ts"], "node.value", "should reference node.value");
    });

    it("should handle generic functions", async () => {
      const results = await transformProject(
        {
          "generic.ts": `
          interface HasId { id: number }

          export function getId<T extends HasId>(item: T): number {
            return item.id;
          }
        `,
        },
        "generic-functions",
      );

      // Generic types can't be validated at runtime - only return is validated
      assertContains(results["generic.ts"], "item.id", "should reference item.id");
      // Return value should be validated as number
      assertContains(
        results["generic.ts"],
        '"number" === typeof',
        "should validate return is number",
      );
    });

    it("should handle union types", async () => {
      const results = await transformProject(
        {
          "union.ts": `
          interface Cat { type: 'cat'; meow(): void }
          interface Dog { type: 'dog'; bark(): void }
          type Pet = Cat | Dog;

          export function process(pet: Pet): string {
            return pet.type;
          }
        `,
        },
        "union-types",
      );

      // Union types should validate the pet parameter using discriminator functions
      assertContains(
        results["union.ts"],
        '"object" === typeof pet',
        "should validate pet is object",
      );
      assertContains(results["union.ts"], "_io0(pet)", "should use first discriminator");
      assertContains(results["union.ts"], "_io1(pet)", "should use second discriminator");
      assertContains(results["union.ts"], "pet.type", "should reference pet.type");
    });

    it("should handle optional parameters", async () => {
      const results = await transformProject(
        {
          "optional.ts": `
          export function greet(name: string, title?: string): string {
            return (title ? title + ' ' : '') + name;
          }
        `,
        },
        "optional-parameters",
      );

      // Should validate name (required string)
      assertContains(results["optional.ts"], "typeof name", "should validate name param");
      // Should check title is undefined OR valid string
      assertContains(results["optional.ts"], "title", "should reference title");
    });

    it("should handle default parameters", async () => {
      const results = await transformProject(
        {
          "default.ts": `
          export function greet(name: string = 'World'): string {
            return 'Hello ' + name;
          }
        `,
        },
        "default-parameters",
      );

      // Should validate name when provided (not undefined)
      assertContains(results["default.ts"], "name", "should reference name param");
    });
  });

  // =============================================================================
  // VSCODE EXTENSION COMPATIBILITY
  // =============================================================================

  void describe("VSCode Extension Compatibility", () => {
    it("should provide skip reasons for optimised validations", async () => {
      const results = await transformProject(
        {
          "skip-reason.ts": `
          export function identity(input: string): string {
            return input;
          }
        `,
        },
        "skip-reasons",
      );

      // Should validate input parameter
      assertContains(results["skip-reason.ts"], "typeof input", "should validate input param");
      // Should have skip reason comment for return (input already validated)
      assertContains(
        results["skip-reason.ts"],
        "/* already valid */",
        "should have skip reason comment",
      );
    });

    it("should generate validation comments for parameters", async () => {
      const results = await transformProject(
        {
          "param-validation.ts": `
          interface User { name: string; age: number }

          export function processUser(user: User): string {
            return user.name;
          }
        `,
        },
        "param-validation-comments",
      );

      // Should validate the User object with inline checks
      assertContains(
        results["param-validation.ts"],
        'typeof user === "object"',
        "should validate user is object",
      );
      assertContains(
        results["param-validation.ts"],
        "typeof user.name",
        "should validate user.name",
      );
      assertContains(results["param-validation.ts"], "typeof user.age", "should validate user.age");
    });

    it("should generate validation for return types", async () => {
      const results = await transformProject(
        {
          "return-validation.ts": `
          interface Result { status: string }

          export function createResult(): Result {
            return { status: 'ok' };
          }
        `,
        },
        "return-validation-comments",
      );

      // Should validate the return value (object literal)
      assertContains(results["return-validation.ts"], "return", "should have return statement");
      // The object literal return should be validated
      assertContains(results["return-validation.ts"], "status", "should reference status property");
    });
  });
});
