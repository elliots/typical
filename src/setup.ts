import type ts from 'typescript'

export function setupTsProgram(tsInstance: typeof ts): ts.Program {
  // Find tsconfig.json
  const tsConfigPath = tsInstance.findConfigFile(process.cwd(), f => tsInstance.sys.fileExists(f), 'tsconfig.json')
  if (!tsConfigPath) {
    throw new Error('Could not find tsconfig.json')
  }

  if (process.env.DEBUG) {
    console.log(`SETUP: Using tsconfig at ${tsConfigPath}`)
  }

  // Load and parse tsconfig.json
  const configFile = tsInstance.readConfigFile(tsConfigPath, f => tsInstance.sys.readFile(f))
  const parsedConfig = tsInstance.parseJsonConfigFileContent(configFile.config, tsInstance.sys, process.cwd())

  if (process.env.DEBUG) {
    console.log(`SETUP: Parsed tsconfig with ${parsedConfig.fileNames.length} files`)
  }

  // Create the TypeScript program with all project files
  const tsProgram = tsInstance.createProgram(parsedConfig.fileNames, parsedConfig.options)

  return tsProgram
}
