# Typical VSCode Extension

Shows runtime validation indicators for TypeScript projects using [Typical](https://github.com/elliots/typical).

## Features

- **Subtle underlines** on validated parameters, return values, type casts, and JSON operations
  - Green dotted underline = validated at runtime
  - Grey dotted underline = skipped
- **Hover tooltips** explaining what's being validated and why
- **Optional inlay hints** showing validation status inline

## Requirements

- Your project must have `@elliots/typical` or `@elliots/typical-compiler` as a dependency
- The extension uses the compiler binary from your project's `node_modules`

## Settings

| Setting                  | Default   | Description                          |
| ------------------------ | --------- | ------------------------------------ |
| `typical.enabled`        | `true`    | Enable/disable validation indicators |
| `typical.showInlayHints` | `false`   | Show inlay hints for validated items |
| `typical.validatedColor` | `#4CAF50` | Colour for validated items (green)   |
| `typical.skippedColor`   | `#9E9E9E` | Colour for skipped items (grey)      |

## Commands

- **Typical: Toggle Validation Indicators** - Enable/disable indicators
- **Typical: Refresh Current File** - Re-analyse the current file

## How It Works

The extension communicates with the Typical Go compiler binary using a binary protocol over stdin/stdout. When you open or save a TypeScript file, it analyses the file and shows which items will be validated at runtime.

## Development

```bash
# Install dependencies
pnpm install

# Build extension
pnpm run build

# Watch mode
pnpm run watch
```

To test locally, open this folder in VS Code and press F5 to launch the Extension Development Host.
