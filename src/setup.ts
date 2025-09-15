import type ts from "typescript";

export function setupTsProgram(tsInstance: typeof ts): ts.Program {
  // Find tsconfig.json
  const tsConfigPath = tsInstance.findConfigFile(
    process.cwd(),
    tsInstance.sys.fileExists,
    "tsconfig.json"
  );
  if (!tsConfigPath) {
    throw new Error("Could not find tsconfig.json");
  }

  // Load and parse tsconfig.json
  const configFile = tsInstance.readConfigFile(tsConfigPath, tsInstance.sys.readFile);
  const parsedConfig = tsInstance.parseJsonConfigFileContent(
    configFile.config,
    tsInstance.sys,
    process.cwd()
  );

  // Create the TypeScript program with all project files
  const tsProgram = tsInstance.createProgram(
    parsedConfig.fileNames,
    parsedConfig.options
  );

  return tsProgram;
}
