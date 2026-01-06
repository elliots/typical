# CLAUDE.md - Typical Package Guide

Important: Use Australian english spelling and grammar conventions.
Important: Build the binaries with `npm run build:all`

## What is Typical?

Typical is a TypeScript transformer that adds runtime validation to TypeScript code automatically. It uses a Go-based compiler that leverages the TypeScript type checker to generate validation code at build time.

**No changes to your code required** - just use TypeScript types and Typical handles the rest.

## Architecture

```
typical/
├── src/                           # TypeScript wrapper/client
│   ├── transformer.ts             # Thin wrapper around Go compiler
│   ├── config.ts                  # Configuration handling
│   ├── cli.ts                     # CLI tool
│   ├── esm-loader.ts              # ESM loader for Node.js
│   └── timing.ts                  # Build timing
├── packages/
│   ├── compiler/          # Go compiler package
│   │   ├── go/                    # Go source code
│   │   │   ├── cmd/typical/       # Main binary
│   │   │   └── internal/
│   │   │       ├── server/        # Binary protocol server
│   │   │       ├── transform/     # AST transformation
│   │   │       └── codegen/       # Validator code generation
│   │   ├── src/                   # TypeScript client
│   │   │   ├── client.ts          # Communicates with Go binary
│   │   │   └── protocol.ts        # MessagePack-like binary protocol
│   │   └── bin/                   # Compiled Go binary
│   ├── unplugin/                  # Vite/Webpack/Rollup plugin
│   └── bun-plugin/                # Bun plugin
├── samples/                       # Example projects
│   ├── esm/                       # ESM loader example
│   ├── ttsx/                      # ttsx wrapper example
│   ├── bun/                       # Bun plugin example
│   └── vite-react/                # Vite + React example
└── bench/                         # Benchmarks
```

## Key Components

### Go Compiler (`packages/compiler/go/`)

The core transformation logic is in Go:

- **internal/server/** - Binary protocol server that receives requests from Node.js
- **internal/transform/** - AST visitor that finds functions, returns, casts to transform
- **internal/codegen/** - Generates validator functions for TypeScript types

### TypeScript Client (`packages/compiler/src/`)

- **client.ts** - Spawns Go binary, sends/receives binary protocol messages
- **protocol.ts** - MessagePack-like encoding/decoding

### Main Package (`src/`)

- **transformer.ts** - `TypicalTransformer` class wraps the Go compiler client
- **esm-loader.ts** - Node.js ESM loader hooks

## Build Commands

```bash
# Build everything
pnpm run build

# Build Go binary (from packages/compiler)
cd packages/compiler/go && go build -o ../bin/typical ./cmd/typical

# Run all samples
npm run samples

# Individual samples
npm run sample:esm
npm run sample:bun
npm run sample:vite-react
npm run sample:ttsx
```

## How Transformation Works

1. **Node.js** calls `TypicalTransformer.transform(fileName)`
2. **Go binary** receives request via binary protocol
3. **Go** loads TypeScript project using `typescript-go` shim
4. **Go** walks AST, finds functions/returns/casts to validate
5. **Go** generates inline validator functions for each type
6. **Go** returns transformed TypeScript code
7. **Node.js** (or bundler) transpiles the TypeScript to JavaScript

### What Gets Transformed

```typescript
// Input
function greet(user: User): string {
  return `Hello ${user.name}`;
}

// Output (conceptual)
function greet(user: User): string {
  ((v, n) => { /* validate User */ })(user, "user");
  return ((v, n) => { /* validate string */ })(`Hello ${user.name}`, "return value");
}
```

## Protocol

The Go binary communicates via stdin/stdout using a MessagePack-like binary protocol:

- Request: `[MessageType, RequestId, Payload]`
- Response: `[MessageType, RequestId, Payload]`

Request IDs use format `method:counter` (e.g., `transformFile:0`) to correlate concurrent requests.

## Code Style

- TypeScript: ES modules, semicolons, strict mode
- Go: Standard Go formatting (`go fmt`)
- Use pnpm for package management

## Adding a New Config Option

1. Add to `TypicalConfig` interface in `src/config.ts`
2. Add to `Config` struct in `packages/compiler/go/internal/transform/config.go`
3. Use the option in the Go transform/codegen code
4. Update README.md

## Debugging

```bash
# Verbose logging from both Go and TypeScript
DEBUG=1 npm run sample:esm

# See Go compiler output
DEBUG=1 node --import @elliots/typical/esm script.ts
```

## Known Limitations

- Generic type parameters (`T`) can't be validated at runtime
- DOM types (Window, Document, Element, etc.) are skipped
- Class types validate instanceof only, not properties
- Source maps not yet implemented in v2
