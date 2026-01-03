import ts from 'typescript'

/**
 * Hoists RegExp constructor calls to top-level constants.
 * Transforms: RegExp(/pattern/).test(x) -> __regex_N.test(x)
 * where __regex_N is a hoisted constant: const __regex_N = /pattern/;
 *
 * Due to typia's quirky AST structure where identifiers contain full expressions
 * (e.g., identifier text is "RegExp(/pattern/).test"), we extract patterns from
 * the identifier text directly.
 */
export function hoistRegexConstructors(sourceFile: ts.SourceFile, tsInstance: typeof ts, factory: ts.NodeFactory): ts.SourceFile {
  const regexPatterns = new Map<string, string>() // full RegExp(...) -> variable name
  let regexCounter = 0

  // Extract regex pattern from identifier text like "RegExp(/pattern/).test"
  // The pattern can contain escaped characters and parentheses
  function extractRegexFromIdText(idText: string): string | null {
    // Match RegExp(/.../) where the regex can contain any characters except unescaped /
    // We look for RegExp( followed by / then find the matching closing / and )
    if (!idText.startsWith('RegExp(/')) return null

    let inCharClass = false
    let escaped = false

    // Start after "RegExp(/"
    const start = 7 // "RegExp(/" = 7 chars, but we want to include the /

    for (let i = 8; i < idText.length; i++) {
      const char = idText[i]

      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '[' && !inCharClass) {
        inCharClass = true
        continue
      }

      if (char === ']' && inCharClass) {
        inCharClass = false
        continue
      }

      // End of regex pattern (unescaped /)
      if (char === '/' && !inCharClass) {
        // Check for flags after the /
        let j = i + 1
        while (j < idText.length && /[gimsuy]/.test(idText[j])) {
          j++
        }
        // Should be followed by )
        if (idText[j] === ')') {
          return idText.substring(start, j) // Include /pattern/flags
        }
        return null
      }
    }
    return null
  }

  // First pass: collect all unique RegExp patterns from identifier texts
  // Only collect from inside __typical_* declarations (our generated code)
  function collectRegexPatterns(node: ts.Node, insideTypical: boolean): void {
    // Check if we're entering a __typical_* variable declaration
    let nowInsideTypical = insideTypical
    if (tsInstance.isVariableDeclaration(node)) {
      const name = node.name
      if (tsInstance.isIdentifier(name)) {
        const varName = name.escapedText as string
        if (process.env.DEBUG && sourceFile.fileName.includes('object-types')) {
          console.log(`REGEX HOISTER: found var decl: ${varName.substring(0, 50)}`)
        }
        if (varName.startsWith('__typical_') || varName.startsWith('___typical_')) {
          nowInsideTypical = true
          if (process.env.DEBUG) {
            console.log(`REGEX HOISTER: entering __typical_ declaration: ${varName}`)
          }
        }
      }
    }

    if (nowInsideTypical && tsInstance.isIdentifier(node)) {
      const idText = node.escapedText as string
      if (idText.startsWith('RegExp(')) {
        if (process.env.DEBUG) {
          console.log(`REGEX HOISTER: found RegExp identifier: ${idText.substring(0, 50)}...`)
        }
        const pattern = extractRegexFromIdText(idText)
        if (pattern) {
          const fullMatch = `RegExp(${pattern})`
          if (!regexPatterns.has(fullMatch)) {
            regexPatterns.set(fullMatch, `__regex_${regexCounter++}`)
          }
        }
      }
    }
    node.forEachChild(child => collectRegexPatterns(child, nowInsideTypical))
  }

  collectRegexPatterns(sourceFile, false)

  if (process.env.DEBUG) {
    console.log(`REGEX HOISTER: ${sourceFile.fileName} - found ${regexPatterns.size} unique RegExp patterns`)
  }

  // No patterns found, return original
  if (regexPatterns.size === 0) {
    return sourceFile
  }

  // Second pass: replace identifiers that start with RegExp(...)
  function replaceRegexIdentifiers(node: ts.Node): ts.Node {
    if (tsInstance.isIdentifier(node)) {
      const idText = node.escapedText as string
      if (idText.startsWith('RegExp(')) {
        const pattern = extractRegexFromIdText(idText)
        if (pattern) {
          const fullMatch = `RegExp(${pattern})`
          const varName = regexPatterns.get(fullMatch)
          if (varName) {
            // Replace "RegExp(/pattern/).test" with "__regex_N.test"
            const newIdText = idText.replace(fullMatch, varName)
            return factory.createIdentifier(newIdText)
          }
        }
      }
    }

    return tsInstance.visitEachChild(node, replaceRegexIdentifiers, undefined as unknown as ts.TransformationContext)
  }

  // Create hoisted const declarations for each unique regex
  const hoistedDeclarations: ts.Statement[] = []
  for (const [fullMatch, varName] of regexPatterns) {
    // Extract regex literal from "RegExp(/pattern/)"
    const regexLiteral = fullMatch.slice(7, -1) // Remove "RegExp(" and ")"
    const constDecl = factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList([factory.createVariableDeclaration(factory.createIdentifier(varName), undefined, undefined, factory.createRegularExpressionLiteral(regexLiteral))], tsInstance.NodeFlags.Const),
    )
    hoistedDeclarations.push(constDecl)
  }

  // Transform all statements (replacing RegExp identifiers)
  const transformedStatements: ts.Statement[] = []
  for (const stmt of sourceFile.statements) {
    const transformed = replaceRegexIdentifiers(stmt) as ts.Statement
    transformedStatements.push(transformed)
  }

  // Find insertion point: after imports but before other code
  let insertIndex = 0
  for (let i = 0; i < transformedStatements.length; i++) {
    if (tsInstance.isImportDeclaration(transformedStatements[i])) {
      insertIndex = i + 1
    } else {
      break
    }
  }

  // Insert hoisted declarations after imports
  const finalStatements = [...transformedStatements.slice(0, insertIndex), ...hoistedDeclarations, ...transformedStatements.slice(insertIndex)]

  return factory.updateSourceFile(sourceFile, finalStatements, sourceFile.isDeclarationFile, sourceFile.referencedFiles, sourceFile.typeReferenceDirectives, sourceFile.hasNoDefaultLib, sourceFile.libReferenceDirectives)
}
