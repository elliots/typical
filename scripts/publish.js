#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { createInterface } from 'readline'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

// Platform-specific compiler packages
const platformPackages = ['compiler-darwin-arm64', 'compiler-darwin-x64', 'compiler-linux-arm64', 'compiler-linux-x64', 'compiler-win32-arm64', 'compiler-win32-x64']

// Main packages (published after platform packages)
const mainPackages = [
  { name: '@elliots/typical-compiler', path: resolve(rootDir, 'packages/compiler') },
  { name: '@elliots/typical', path: rootDir },
  { name: '@elliots/unplugin-typical', path: resolve(rootDir, 'packages/unplugin') },
]

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
}

function exec(cmd, options = {}) {
  console.log(`\n$ ${cmd}`)
  return execSync(cmd, { stdio: 'inherit', ...options })
}

function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function incrementVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number)
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`
  }
}

async function main() {
  // Get current version from root package
  const rootPkg = readJson(resolve(rootDir, 'package.json'))
  const currentVersion = rootPkg.version

  console.log(`\nCurrent version: ${currentVersion}`)
  console.log('\nVersion bump options:')
  console.log('  1. patch (default) - bug fixes')
  console.log('  2. minor - new features')
  console.log('  3. major - breaking changes')
  console.log('  4. custom - enter version manually')
  console.log('  5. none - keep current version\n')

  const choice = await prompt('Select option [1-5] or press Enter for patch: ')

  let newVersion
  switch (choice) {
    case '2':
      newVersion = incrementVersion(currentVersion, 'minor')
      break
    case '3':
      newVersion = incrementVersion(currentVersion, 'major')
      break
    case '4':
      newVersion = await prompt(`Enter new version (current: ${currentVersion}): `)
      if (!newVersion.match(/^\d+\.\d+\.\d+$/)) {
        console.error('Invalid version format. Expected: x.y.z')
        process.exit(1)
      }
      break
    case '5':
      newVersion = currentVersion
      break
    case '1':
    case '':
    default:
      newVersion = incrementVersion(currentVersion, 'patch')
  }

  console.log(`\nNew version: ${newVersion}`)

  // Show what will be published
  console.log('\nPackages to publish:')
  console.log('  Platform binaries:')
  for (const pkg of platformPackages) {
    console.log(`    - @elliots/${pkg}@${newVersion}`)
  }
  console.log('  Main packages:')
  for (const pkg of mainPackages) {
    console.log(`    - ${pkg.name}@${newVersion}`)
  }

  const confirm = await prompt('\nProceed with publish? [y/N]: ')
  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.')
    process.exit(0)
  }

  // Build Go binaries for all platforms
  console.log('\n==> Building Go binaries for all platforms...')
  exec('./scripts/build-binaries.sh', { cwd: rootDir })

  // Verify all binaries exist
  console.log('\n==> Verifying binaries...')
  for (const pkg of platformPackages) {
    const pkgDir = resolve(rootDir, 'packages', pkg)
    const isWindows = pkg.includes('win32')
    const binaryPath = resolve(pkgDir, 'bin', isWindows ? 'typical.exe' : 'typical')

    if (!existsSync(binaryPath)) {
      console.error(`Binary not found: ${binaryPath}`)
      process.exit(1)
    }
    console.log(`  ✓ ${pkg}`)
  }

  // Update versions in all package.json files
  console.log('\n==> Updating versions...')

  // Update platform packages
  for (const pkg of platformPackages) {
    const pkgJsonPath = resolve(rootDir, 'packages', pkg, 'package.json')
    const pkgJson = readJson(pkgJsonPath)
    pkgJson.version = newVersion
    writeJson(pkgJsonPath, pkgJson)
    console.log(`  Updated @elliots/${pkg} to ${newVersion}`)
  }

  // Update main packages
  for (const pkg of mainPackages) {
    const pkgJsonPath = resolve(pkg.path, 'package.json')
    const pkgJson = readJson(pkgJsonPath)
    pkgJson.version = newVersion

    // Update optionalDependencies for compiler package
    if (pkg.name === '@elliots/typical-compiler' && pkgJson.optionalDependencies) {
      for (const depName of Object.keys(pkgJson.optionalDependencies)) {
        if (depName.startsWith('@elliots/typical-compiler-')) {
          pkgJson.optionalDependencies[depName] = newVersion
        }
      }
    }

    writeJson(pkgJsonPath, pkgJson)
    console.log(`  Updated ${pkg.name} to ${newVersion}`)
  }

  // Build TypeScript packages
  console.log('\n==> Building TypeScript packages...')
  exec('pnpm run build', { cwd: resolve(rootDir, 'packages/compiler') })
  exec('pnpm run build', { cwd: rootDir })
  exec('pnpm run build', { cwd: resolve(rootDir, 'packages/unplugin') })

  // Run tests
  console.log('\n==> Running tests...')
  try {
    exec('pnpm run test', { cwd: rootDir })
  } catch (e) {
    console.error('\nTests failed. Aborting publish.', e.message)
    process.exit(1)
  }

  // Publish platform packages first
  console.log('\n==> Publishing platform packages...')
  for (const pkg of platformPackages) {
    const pkgDir = resolve(rootDir, 'packages', pkg)
    exec('pnpm publish --no-git-checks --access public', { cwd: pkgDir })
  }

  // Publish compiler package
  console.log('\n==> Publishing compiler package...')
  exec('pnpm publish --no-git-checks --access public', { cwd: resolve(rootDir, 'packages/compiler') })

  // Publish root package
  console.log('\n==> Publishing root package...')
  exec('pnpm publish --no-git-checks --access public', { cwd: rootDir })

  // Update unplugin's dependency to use the published version instead of workspace
  const unpluginPkgPath = resolve(rootDir, 'packages/unplugin/package.json')
  const unpluginPkg = readJson(unpluginPkgPath)
  const originalDep = unpluginPkg.dependencies['@elliots/typical']
  unpluginPkg.dependencies['@elliots/typical'] = newVersion
  writeJson(unpluginPkgPath, unpluginPkg)

  try {
    exec('pnpm publish --no-git-checks --access public', { cwd: resolve(rootDir, 'packages/unplugin') })
  } finally {
    // Restore workspace reference
    unpluginPkg.dependencies['@elliots/typical'] = originalDep
    writeJson(unpluginPkgPath, unpluginPkg)
  }

  // Create git tag
  const createTag = await prompt(`\nCreate git tag v${newVersion}? [y/N]: `)
  if (createTag.toLowerCase() === 'y') {
    exec(`git add -A`)
    exec(`git commit -m "v${newVersion}"`)
    exec(`git tag v${newVersion}`)

    const pushTag = await prompt('Push tag to origin? [y/N]: ')
    if (pushTag.toLowerCase() === 'y') {
      exec('git push && git push --tags')
    }
  }

  console.log(`\n✓ Successfully published v${newVersion}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
