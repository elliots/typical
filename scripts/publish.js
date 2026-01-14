#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync, spawnSync } from "child_process";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const readmePath = resolve(rootDir, "README.md");

// Platform-specific compiler packages
const platformPackages = [
  "compiler-darwin-arm64",
  "compiler-darwin-x64",
  "compiler-linux-arm64",
  "compiler-linux-x64",
  "compiler-win32-arm64",
  "compiler-win32-x64",
];

// Main packages (published after platform packages)
const mainPackages = [
  { name: "@elliots/typical-compiler", path: resolve(rootDir, "packages/compiler") },
  { name: "@elliots/typical", path: rootDir },
  { name: "@elliots/unplugin-typical", path: resolve(rootDir, "packages/unplugin") },
  { name: "@elliots/bun-plugin-typical", path: resolve(rootDir, "packages/bun-plugin") },
  { name: "@elliots/typical-tsc-plugin", path: resolve(rootDir, "packages/tsc-plugin") },
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function exec(cmd, options = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...options });
}

/**
 * Get the npm tag for a version.
 * Prerelease versions (e.g., 0.2.0-beta.1) get a tag based on the prerelease identifier.
 * Regular versions get 'latest'.
 */
function getNpmTag(version) {
  const prereleaseMatch = version.match(/^\d+\.\d+\.\d+-([a-zA-Z]+)/);
  if (prereleaseMatch) {
    return prereleaseMatch[1]; // e.g., 'beta', 'alpha', 'rc'
  }
  return "latest";
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
  const [major, minor, patch] = version.split(".").map(Number);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * Open the user's editor to write release notes.
 * Returns the content written by the user.
 */
function openEditorForReleaseNotes(version) {
  const tempFile = resolve(tmpdir(), `typical-release-${version}.md`);
  const template = `# Release notes for v${version}

# Write your release notes above this line.
# Lines starting with # will be removed.
# Save and close the editor when done.
`;
  writeFileSync(tempFile, template);

  const editor = "nano";
  const result = spawnSync(editor, [tempFile], { stdio: "inherit" });

  if (result.status !== 0) {
    throw new Error(`Editor exited with status ${result.status}`);
  }

  const content = readFileSync(tempFile, "utf-8");
  // Remove comment lines and trim
  const notes = content
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();

  return notes;
}

/**
 * Add a changelog entry to the README.md file.
 */
function addChangelogEntry(version, notes) {
  const readme = readFileSync(readmePath, "utf-8");
  const date = new Date().toISOString().split("T")[0];

  const entry = `### v${version} (${date})

${notes}

`;

  const marker = "<!-- CHANGELOG_START -->";
  if (!readme.includes(marker)) {
    console.warn("Warning: CHANGELOG_START marker not found in README.md");
    return;
  }

  const updated = readme.replace(marker, `${marker}\n\n${entry}`);
  writeFileSync(readmePath, updated);
  console.log(`  Added changelog entry for v${version}`);
}

/**
 * Create a GitHub release using the gh CLI.
 */
function createGitHubRelease(version, notes, isPrerelease) {
  const tag = `v${version}`;
  const title = `v${version}`;

  // Write notes to temp file for gh cli
  const notesFile = resolve(tmpdir(), `typical-release-notes-${version}.md`);
  writeFileSync(notesFile, notes);

  const prereleaseFlag = isPrerelease ? " --prerelease" : "";
  exec(`gh release create ${tag} --title "${title}" --notes-file "${notesFile}"${prereleaseFlag}`);
}

async function main() {
  // Get current version from root package
  const rootPkg = readJson(resolve(rootDir, "package.json"));
  const currentVersion = rootPkg.version;

  console.log(`\nCurrent version: ${currentVersion}`);
  console.log("\nVersion bump options:");
  console.log("  1. patch (default) - bug fixes");
  console.log("  2. minor - new features");
  console.log("  3. major - breaking changes");
  console.log("  4. custom - enter version manually");
  console.log("  5. none - keep current version\n");

  const choice = await prompt("Select option [1-5] or press Enter for patch: ");

  let newVersion;
  switch (choice) {
    case "2":
      newVersion = incrementVersion(currentVersion, "minor");
      break;
    case "3":
      newVersion = incrementVersion(currentVersion, "major");
      break;
    case "4":
      newVersion = await prompt(`Enter new version (current: ${currentVersion}): `);
      // Support semver with prerelease tags: x.y.z or x.y.z-prerelease.n
      if (!newVersion.match(/^\d+\.\d+\.\d+(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$/)) {
        console.error(
          "Invalid version format. Expected: x.y.z or x.y.z-tag.n (e.g., 0.2.0-beta.1)",
        );
        process.exit(1);
      }
      break;
    case "5":
      newVersion = currentVersion;
      break;
    case "1":
    case "":
    default:
      newVersion = incrementVersion(currentVersion, "patch");
  }

  console.log(`\nNew version: ${newVersion}`);

  // Show what will be published
  console.log("\nPackages to publish:");
  console.log("  Platform binaries:");
  for (const pkg of platformPackages) {
    console.log(`    - @elliots/${pkg}@${newVersion}`);
  }
  console.log("  Main packages:");
  for (const pkg of mainPackages) {
    console.log(`    - ${pkg.name}@${newVersion}`);
  }

  const confirm = await prompt("\nProceed with publish? [y/N]: ");
  if (confirm.toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }

  // Get release notes before publishing so README is updated (only for new versions)
  let releaseNotes = "";
  if (newVersion !== currentVersion) {
    console.log("\n==> Release notes");
    const wantNotes = await prompt("Add release notes? [Y/n]: ");

    if (wantNotes.toLowerCase() !== "n") {
      console.log("\nOpening editor for release notes...");
      releaseNotes = openEditorForReleaseNotes(newVersion);

      if (releaseNotes) {
        console.log("\nRelease notes:");
        console.log("---");
        console.log(releaseNotes);
        console.log("---");

        // Add to README changelog before publishing
        addChangelogEntry(newVersion, releaseNotes);
      } else {
        console.log("No release notes provided.");
      }
    }
  }

  // Build everything (Go binaries for all platforms + TypeScript packages)
  console.log("\n==> Building all packages...");
  exec("pnpm run build", { cwd: rootDir });

  // Verify all binaries exist
  console.log("\n==> Verifying binaries...");
  for (const pkg of platformPackages) {
    const pkgDir = resolve(rootDir, "packages", pkg);
    const isWindows = pkg.includes("win32");
    const binaryPath = resolve(pkgDir, "bin", isWindows ? "typical.exe" : "typical");

    if (!existsSync(binaryPath)) {
      console.error(`Binary not found: ${binaryPath}`);
      process.exit(1);
    }
    console.log(`  ✓ ${pkg}`);
  }

  // Run tests before updating versions
  console.log("\n==> Running tests...");
  try {
    exec("pnpm run test", { cwd: rootDir });
  } catch (e) {
    console.error("\nTests failed. Aborting publish.", e.message);
    process.exit(1);
  }

  // Update versions in all package.json files
  console.log("\n==> Updating versions...");

  // Update platform packages
  for (const pkg of platformPackages) {
    const pkgJsonPath = resolve(rootDir, "packages", pkg, "package.json");
    const pkgJson = readJson(pkgJsonPath);
    pkgJson.version = newVersion;
    writeJson(pkgJsonPath, pkgJson);
    console.log(`  Updated @elliots/${pkg} to ${newVersion}`);
  }

  // Update main packages
  for (const pkg of mainPackages) {
    const pkgJsonPath = resolve(pkg.path, "package.json");
    const pkgJson = readJson(pkgJsonPath);
    pkgJson.version = newVersion;
    writeJson(pkgJsonPath, pkgJson);
    console.log(`  Updated ${pkg.name} to ${newVersion}`);
  }

  // Determine npm tag for this version
  const npmTag = getNpmTag(newVersion);
  console.log(`\n==> Using npm tag: ${npmTag}`);

  // Publish platform packages first
  // NOTE: Use npm publish (not pnpm) to preserve executable permissions on binaries
  console.log("\n==> Publishing platform packages...");
  for (const pkg of platformPackages) {
    const pkgDir = resolve(rootDir, "packages", pkg);
    exec(`npm publish --access public --tag ${npmTag}`, { cwd: pkgDir });
  }

  // Publish compiler package (needs special handling to restore workspace refs)
  console.log("\n==> Publishing compiler package...");
  const compilerPath = resolve(rootDir, "packages/compiler");
  const compilerPkgPath = resolve(compilerPath, "package.json");
  const compilerPkg = readJson(compilerPkgPath);
  const originalOptionalDeps = { ...compilerPkg.optionalDependencies };

  // Update optionalDependencies to use published versions
  for (const depName of Object.keys(compilerPkg.optionalDependencies || {})) {
    if (depName.startsWith("@elliots/typical-compiler-")) {
      compilerPkg.optionalDependencies[depName] = newVersion;
    }
  }
  writeJson(compilerPkgPath, compilerPkg);

  try {
    exec(`pnpm publish --no-git-checks --access public --tag ${npmTag}`, { cwd: compilerPath });
  } finally {
    // Restore workspace references
    compilerPkg.optionalDependencies = originalOptionalDeps;
    writeJson(compilerPkgPath, compilerPkg);
  }

  // Publish root package
  console.log("\n==> Publishing root package...");
  exec(`pnpm publish --no-git-checks --access public --tag ${npmTag}`, { cwd: rootDir });

  // Publish packages that depend on @elliots/typical
  // Update their workspace dependencies to use the published version
  const dependentPackages = [
    { name: "unplugin", path: resolve(rootDir, "packages/unplugin") },
    { name: "bun-plugin", path: resolve(rootDir, "packages/bun-plugin") },
    { name: "tsc-plugin", path: resolve(rootDir, "packages/tsc-plugin") },
  ];

  for (const pkg of dependentPackages) {
    const pkgJsonPath = resolve(pkg.path, "package.json");
    const pkgJson = readJson(pkgJsonPath);
    const originalDeps = {};

    // Save and update workspace dependencies
    for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
      if (pkgJson[depType]) {
        for (const [depName, depVersion] of Object.entries(pkgJson[depType])) {
          if (depVersion === "workspace:*" && depName.startsWith("@elliots/")) {
            originalDeps[`${depType}.${depName}`] = depVersion;
            pkgJson[depType][depName] = newVersion;
          }
        }
      }
    }

    writeJson(pkgJsonPath, pkgJson);

    try {
      console.log(`\n==> Publishing ${pkg.name}...`);
      exec(`pnpm publish --no-git-checks --access public --tag ${npmTag}`, { cwd: pkg.path });
    } finally {
      // Restore workspace references
      for (const [key, value] of Object.entries(originalDeps)) {
        const [depType, depName] = key.split(".");
        pkgJson[depType][depName] = value;
      }
      writeJson(pkgJsonPath, pkgJson);
    }
  }

  // Create git tag
  const createTag = await prompt(`\nCreate git tag v${newVersion}? [y/N]: `);
  if (createTag.toLowerCase() === "y") {
    exec(`git add -A`);
    exec(`git commit -m "v${newVersion}"`);
    exec(`git tag v${newVersion}`);

    const pushTag = await prompt("Push tag to origin? [y/N]: ");
    if (pushTag.toLowerCase() === "y") {
      exec("git push && git push --tags");

      // Create GitHub release if we have notes and pushed
      if (releaseNotes) {
        const createRelease = await prompt("\nCreate GitHub release? [Y/n]: ");
        if (createRelease.toLowerCase() !== "n") {
          const isPrerelease = npmTag !== "latest";
          console.log("\n==> Creating GitHub release...");
          createGitHubRelease(newVersion, releaseNotes, isPrerelease);
        }
      }
    }
  }

  console.log(`\n✓ Successfully published v${newVersion}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
