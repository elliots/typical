#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const packages = [
  { name: '@elliots/typical', path: rootDir },
  { name: '@elliots/unplugin-typical', path: resolve(rootDir, 'packages/unplugin') },
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function exec(cmd, options = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...options });
}

function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function incrementVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

async function main() {
  // Get current version from root package
  const rootPkg = readJson(resolve(rootDir, 'package.json'));
  const currentVersion = rootPkg.version;

  console.log(`\nCurrent version: ${currentVersion}`);
  console.log('\nVersion bump options:');
  console.log('  1. patch (default) - bug fixes');
  console.log('  2. minor - new features');
  console.log('  3. major - breaking changes');
  console.log('  4. custom - enter version manually');
  console.log('  5. none - keep current version\n');

  const choice = await prompt('Select option [1-5] or press Enter for patch: ');

  let newVersion;
  switch (choice) {
    case '2':
      newVersion = incrementVersion(currentVersion, 'minor');
      break;
    case '3':
      newVersion = incrementVersion(currentVersion, 'major');
      break;
    case '4':
      newVersion = await prompt(`Enter new version (current: ${currentVersion}): `);
      if (!newVersion.match(/^\d+\.\d+\.\d+$/)) {
        console.error('Invalid version format. Expected: x.y.z');
        process.exit(1);
      }
      break;
    case '5':
      newVersion = currentVersion;
      break;
    case '1':
    case '':
    default:
      newVersion = incrementVersion(currentVersion, 'patch');
  }

  console.log(`\nNew version: ${newVersion}`);

  // Show what will be published
  console.log('\nPackages to publish:');
  for (const pkg of packages) {
    console.log(`  - ${pkg.name}@${newVersion}`);
  }

  const confirm = await prompt('\nProceed with publish? [y/N]: ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  // Update versions in all package.json files
  console.log('\nUpdating versions...');
  for (const pkg of packages) {
    const pkgJsonPath = resolve(pkg.path, 'package.json');
    const pkgJson = readJson(pkgJsonPath);
    pkgJson.version = newVersion;
    writeJson(pkgJsonPath, pkgJson);
    console.log(`  Updated ${pkg.name} to ${newVersion}`);
  }

  // Build all packages
  console.log('\nBuilding packages...');
  exec('pnpm run build', { cwd: rootDir });
  exec('pnpm run build', { cwd: resolve(rootDir, 'packages/unplugin') });

  // Run tests
  console.log('\nRunning tests...');
  try {
    exec('pnpm run test', { cwd: rootDir });
  } catch (error) {
    console.error('\nTests failed. Aborting publish.');
    process.exit(1);
  }

  // Publish packages
  console.log('\nPublishing packages...');

  // Publish root package first
  exec('pnpm publish --no-git-checks', { cwd: rootDir });

  // Update unplugin's dependency to use the published version instead of workspace
  const unpluginPkgPath = resolve(rootDir, 'packages/unplugin/package.json');
  const unpluginPkg = readJson(unpluginPkgPath);
  const originalDep = unpluginPkg.dependencies['@elliots/typical'];
  unpluginPkg.dependencies['@elliots/typical'] = newVersion;
  writeJson(unpluginPkgPath, unpluginPkg);

  try {
    exec('pnpm publish --no-git-checks', { cwd: resolve(rootDir, 'packages/unplugin') });
  } finally {
    // Restore workspace reference
    unpluginPkg.dependencies['@elliots/typical'] = originalDep;
    writeJson(unpluginPkgPath, unpluginPkg);
  }

  // Create git tag
  const createTag = await prompt(`\nCreate git tag v${newVersion}? [y/N]: `);
  if (createTag.toLowerCase() === 'y') {
    exec(`git add -A`);
    exec(`git commit -m "v${newVersion}"`);
    exec(`git tag v${newVersion}`);

    const pushTag = await prompt('Push tag to origin? [y/N]: ');
    if (pushTag.toLowerCase() === 'y') {
      exec('git push && git push --tags');
    }
  }

  console.log(`\n✓ Successfully published v${newVersion}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
