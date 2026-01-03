# CLAUDE.md - Typical Package Guide

## What is Typical?

Typical is a TypeScript transformer that adds runtime validation to TypeScript code automatically. It wraps [typia](https://github.com/samchon/typia) to inject validation code at build time based on your existing TypeScript types.

**No changes to your code required** - just use TypeScript types and Typical handles the rest.

## Package Structure

```
typical/
├── src/                    # Core library source
│   ├── transformer.ts      # Main transformer - the heart of the package
│   ├── config.ts           # Configuration handling
│   ├── cli.ts              # CLI tool (typical transform)
│   ├── tsc-plugin.ts       # ts-patch/ttsc plugin
│   ├── esm-loader.ts       # ESM loader for Node.js
│   ├── file-filter.ts      # Include/exclude pattern matching
│   ├── regex-hoister.ts    # Regex hoisting optimization
│   └── setup.ts            # TypeScript program setup
├── packages/
│   └── unplugin/           # Vite/Webpack/Rollup plugin
│       └── src/
│           ├── index.ts    # Unplugin entry point
│           └── core/
│               ├── transform.ts       # Transform logic
│               ├── program-manager.ts # Shared TS program (perf optimization)
│               └── timing.ts          # Build timing instrumentation
├── test/
│   └── transformer.test.ts # Unit tests
├── samples/                # Example projects
│   ├── esm/                # ESM loader example
│   ├── tsc/                # TSC plugin example
│   ├── ttsx/               # ttsx wrapper example
│   └── vite-react/         # Vite + React example
└── bench/                  # Benchmarks
```

## Key Files

- **src/transformer.ts** - The main transformer class. Handles:
  - Function parameter/return validation
  - JSON.parse/stringify transformation
  - Type cast validation (`as Type`)
  - Flow analysis (skipping redundant validations)

- **src/config.ts** - Configuration interface and defaults
- **packages/unplugin/src/core/program-manager.ts** - Shared TypeScript program for build performance

## Build & Test Commands

```bash
# Build the package
npm run build

# Run tests (REQUIRED after any transformer changes)
npm test

# Run benchmarks
npm run bench

# Test all samples
npm run samples

# Individual samples
npm run sample:esm
npm run sample:vite-react
```

## Testing Requirements

**IMPORTANT**: Always run `npm test` after modifying:

- `src/transformer.ts`
- `src/config.ts`
- Any file in `packages/unplugin/src/`

Tests use Node's built-in test runner. Test cases are in `test/transformer.test.ts`.

The test file creates isolated TypeScript programs for each test case to avoid type collisions.

## Configuration Options

Located in `src/config.ts`.

## How Transformation Works

1. **Phase 1 (Typical)**: AST transformation
   - Wrap function parameters with `typia.assert<T>(param)`
   - Wrap return statements with `typia.assert<T>(value)`
   - Replace `JSON.parse` with `typia.json.assertParse<T>()`
   - Replace `JSON.stringify` with `typia.json.stringify<T>()`

2. **Phase 2 (Typia)**: Type resolution
   - Typia resolves the `<T>` type arguments
   - Generates actual runtime validation code

## Code Style

- TypeScript with strict mode
- ES modules (`"type": "module"`)
- Uses semicolons
- Use existing patterns from transformer.ts
- Use pnpm

## Common Tasks

### Adding a new config option:

1. Add to `TypicalConfig` interface in `src/config.ts`
2. Add default value to `defaultConfig`
3. Check the option in `src/transformer.ts` where needed
4. Add tests in `test/transformer.test.ts`
5. Document in README.md

### Skipping validation for a type:

The transformer skips validation for:

- `any` and `unknown` types
- Type parameters (generics like `T`)
- Types matching `ignoreTypes` patterns
- DOM types when `ignoreDOMTypes: true`

### Adding a test case:

Add to the `testCases` array in `test/transformer.test.ts`:

```typescript
{
  name: "description of what you're testing",
  input: `// TypeScript code to transform`,
  expectedPatterns: [
    `patterns that MUST appear in output`,
  ],
  notExpectedPatterns: [
    `patterns that must NOT appear`,
  ],
}
```

## Entry Points

The package has multiple entry points:

1. **ESM Loader**: `node --import @elliots/typical/esm`
2. **TSC Plugin**: Configure in tsconfig.json with ts-patch
3. **CLI**: `npx typical transform file.ts`
4. **ttsx**: `npx ttsx script.ts` (like tsx but with typical)
5. **Unplugin**: For Vite/Webpack/Rollup builds (`@elliots/unplugin-typical`)

## Performance Notes

- The unplugin uses a shared `ProgramManager` to avoid creating a new TypeScript program for each file
- `reusableValidators: true` creates shared validators at file top, reducing code size
- `hoistRegex: true` moves regex patterns to top-level constants
- Build timing available with `DEBUG=1` environment variable

## Debugging

Set `DEBUG=1` environment variable for verbose logging:

```bash
DEBUG=1 npm run build
```

For intermediate files (see code before typia transform):

```json
{
  "debug": {
    "writeIntermediateFiles": true
  }
}
```

## Flow Analysis

The transformer implements flow analysis to skip redundant return validations:

- If returning a validated parameter directly, skip return validation
- If returning a property of a validated parameter, skip return validation
- If the value was "tainted" (passed to function, mutated, awaited), DO validate

See test cases starting with "flow analysis:" in `transformer.test.ts`.

## Known Limitations

- DOM types (Window, Document, Element, etc.) can't be validated by typia
- Generic type parameters (`T`) can't be validated at runtime
- Some complex intersection types may fail typia transformation
