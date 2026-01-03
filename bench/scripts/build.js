#!/usr/bin/env node
/**
 * Build script for benchmarks.
 * Transforms source files with typical CLI, then compiles with tsc.
 */
import { execSync } from 'child_process'
import { readdirSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const benchDir = join(__dirname, '..')
const srcDir = join(benchDir, 'src')
const transformedDir = join(benchDir, '.transformed')
const distDir = join(benchDir, 'dist')

// Clean up previous build
if (existsSync(transformedDir)) {
  rmSync(transformedDir, { recursive: true })
}
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true })
}
mkdirSync(transformedDir, { recursive: true })
mkdirSync(join(transformedDir, 'scenarios'), { recursive: true })

console.log('Transforming source files with typical...')

// Get all TypeScript files
function getFiles(dir, base = '') {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(base, entry.name)
    if (entry.isDirectory()) {
      files.push(...getFiles(join(dir, entry.name), path))
    } else if (entry.name.endsWith('.ts')) {
      files.push(path)
    }
  }
  return files
}

const files = getFiles(srcDir)

// Transform each file using the bench tsconfig.json
for (const file of files) {
  const outFile = join(transformedDir, file)

  // Ensure output directory exists
  mkdirSync(dirname(outFile), { recursive: true })

  console.log(`  Transforming: ${file}`)
  try {
    // Run from bench directory with its tsconfig.json
    const relativeSrc = `src/${file}`
    const relativeOut = `.transformed/${file}`
    execSync(`node ../dist/src/cli.js transform "${relativeSrc}" -p tsconfig.json -o "${relativeOut}"`, {
      cwd: benchDir,
      stdio: 'pipe',
    })
  } catch (error) {
    console.error(`  Failed to transform ${file}:`, error.message)
    process.exit(1)
  }
}

console.log('Compiling transformed files with tsc...')

// Create a temporary tsconfig that points to transformed sources
const tsconfigContent = `{
  "compilerOptions": {
    "target": "ES2024",
    "module": "esnext",
    "lib": ["ES2024"],
    "outDir": "./dist",
    "rootDir": "./.transformed",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true,
    "moduleResolution": "node",
    "resolveJsonModule": true
  },
  "include": [".transformed/**/*.ts"],
  "exclude": ["node_modules", "dist", "src"]
}`

import { writeFileSync } from 'fs'
const tsconfigPath = join(benchDir, 'tsconfig.build.json')
writeFileSync(tsconfigPath, tsconfigContent)

try {
  execSync('npx tsc -p tsconfig.build.json', {
    cwd: benchDir,
    stdio: 'inherit',
  })
} catch (error) {
  console.error('TypeScript compilation failed', error)
  process.exit(1)
}

console.log('Build complete!')
