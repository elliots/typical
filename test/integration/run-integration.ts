import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The compiled JS runs from dist/, but the integration projects are in the source dir
const sourceRoot = path.resolve(__dirname, "..", "..", "..");
const projectsDir = path.join(sourceRoot, "test", "integration", "projects");

interface ProjectConfig {
  name: string;
  path: string;
  buildCommand: string;
  testCommand: string;
}

const projects: ProjectConfig[] = [
  {
    name: "Express API",
    path: path.join(projectsDir, "express-api"),
    buildCommand: "npm run build",
    testCommand: "TEST_MODE=true npm run start",
  },
];

function runCommand(
  command: string,
  cwd: string,
  description: string
): boolean {
  console.log(`  ${description}...`);
  try {
    execSync(command, {
      cwd,
      stdio: "pipe",
      env: { ...process.env },
    });
    return true;
  } catch (error: any) {
    console.log(`    FAILED`);
    if (error.stdout) {
      console.log(`    stdout: ${error.stdout.toString()}`);
    }
    if (error.stderr) {
      console.log(`    stderr: ${error.stderr.toString()}`);
    }
    return false;
  }
}

async function runProject(project: ProjectConfig): Promise<boolean> {
  console.log(`\n[${ project.name }]`);
  console.log(`  Path: ${project.path}`);

  // Check project exists
  if (!existsSync(project.path)) {
    console.log(`  ERROR: Project path does not exist`);
    return false;
  }

  // Clean and reinstall to ensure fresh dependencies with local typical
  const nodeModulesPath = path.join(project.path, "node_modules");
  if (existsSync(nodeModulesPath)) {
    if (!runCommand("rm -rf node_modules package-lock.json", project.path, "Cleaning old dependencies")) {
      return false;
    }
  }

  // Install dependencies (includes local typical via file: reference in package.json)
  if (!runCommand("npm install", project.path, "Installing dependencies")) {
    return false;
  }

  // Build the project
  if (!runCommand(project.buildCommand, project.path, "Building")) {
    return false;
  }

  // Run tests
  console.log(`  Running tests...`);
  try {
    const output = execSync(project.testCommand, {
      cwd: project.path,
      stdio: "pipe",
      env: { ...process.env, TEST_MODE: "true" },
    });
    console.log(output.toString().split("\n").map((l) => `    ${l}`).join("\n"));
    return true;
  } catch (error: any) {
    console.log(`    FAILED`);
    if (error.stdout) {
      console.log(error.stdout.toString().split("\n").map((l: string) => `    ${l}`).join("\n"));
    }
    if (error.stderr) {
      console.log(error.stderr.toString().split("\n").map((l: string) => `    ${l}`).join("\n"));
    }
    return false;
  }
}

async function main() {
  console.log("Running integration tests...");
  console.log("============================");

  let passed = 0;
  let failed = 0;

  for (const project of projects) {
    const success = await runProject(project);
    if (success) {
      console.log(`  PASSED`);
      passed++;
    } else {
      console.log(`  FAILED`);
      failed++;
    }
  }

  console.log("\n============================");
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Integration test error:", error);
  process.exit(1);
});
