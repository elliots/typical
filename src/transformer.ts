import ts from "typescript";
import fs from "fs";
import path from "path";
import { loadConfig, TypicalConfig, getCompiledIgnorePatterns, CompiledIgnorePatterns } from "./config.js";
import { shouldTransformFile } from "./file-filter.js";
import { hoistRegexConstructors } from "./regex-hoister.js";

import { transform as typiaTransform } from "typia/lib/transform.js";
import { setupTsProgram } from "./setup.js";

// Flags for typeToTypeNode to prefer type aliases over import() syntax
const TYPE_NODE_FLAGS = ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope;

export interface TransformContext {
  ts: typeof ts;
  factory: ts.NodeFactory;
  context: ts.TransformationContext;
}

/**
 * Internal state for a single file transformation.
 * Passed between visitor functions to track mutable state.
 */
interface FileTransformState {
  needsTypiaImport: boolean;
}

export class TypicalTransformer {
  public config: TypicalConfig;
  private program: ts.Program;
  private ts: typeof ts;
  private compiledPatterns: CompiledIgnorePatterns | null = null;
  private typeValidators = new Map<
    string,
    { name: string; typeNode: ts.TypeNode }
  >(); // type -> { validator variable name, type node }
  private typeStringifiers = new Map<
    string,
    { name: string; typeNode: ts.TypeNode }
  >(); // type -> { stringifier variable name, type node }
  private typeParsers = new Map<
    string,
    { name: string; typeNode: ts.TypeNode }
  >(); // type -> { parser variable name, type node }

  constructor(
    config?: TypicalConfig,
    program?: ts.Program,
    tsInstance?: typeof ts
  ) {
    this.config = config ?? loadConfig();
    this.ts = tsInstance ?? ts;
    this.program = program ?? setupTsProgram(this.ts);
  }

  /**
   * Create a new TypeScript program with transformed source code.
   * This is needed so typia can resolve types from our generated typia.createAssert<T>() calls.
   */
  private createTypiaProgram(
    fileName: string,
    transformedCode: string,
    languageVersion: ts.ScriptTarget = this.ts.ScriptTarget.ES2020
  ): { newProgram: ts.Program; boundSourceFile: ts.SourceFile } {
    // Create a new source file from the transformed code
    const newSourceFile = this.ts.createSourceFile(
      fileName,
      transformedCode,
      languageVersion,
      true
    );

    // Build map of all source files, replacing the transformed one
    const compilerOptions = this.program.getCompilerOptions();
    const originalSourceFiles = new Map<string, ts.SourceFile>();
    for (const sf of this.program.getSourceFiles()) {
      originalSourceFiles.set(sf.fileName, sf);
    }
    originalSourceFiles.set(fileName, newSourceFile);

    // Create custom compiler host that serves our transformed file
    const customHost: ts.CompilerHost = {
      getSourceFile: (hostFileName, langVersion) => {
        if (originalSourceFiles.has(hostFileName)) {
          return originalSourceFiles.get(hostFileName);
        }
        return this.ts.createSourceFile(
          hostFileName,
          this.ts.sys.readFile(hostFileName) || "",
          langVersion,
          true
        );
      },
      getDefaultLibFileName: (opts) => this.ts.getDefaultLibFilePath(opts),
      writeFile: () => {},
      getCurrentDirectory: () => this.ts.sys.getCurrentDirectory(),
      getCanonicalFileName: (fn) =>
        this.ts.sys.useCaseSensitiveFileNames ? fn : fn.toLowerCase(),
      useCaseSensitiveFileNames: () => this.ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => this.ts.sys.newLine,
      fileExists: (fn) => originalSourceFiles.has(fn) || this.ts.sys.fileExists(fn),
      readFile: (fn) => this.ts.sys.readFile(fn),
    };

    // Create new program, passing oldProgram to reuse dependency context
    const newProgram = this.ts.createProgram(
      Array.from(originalSourceFiles.keys()),
      compilerOptions,
      customHost,
      this.program
    );

    // Get the bound source file from the new program (has proper symbol tables)
    const boundSourceFile = newProgram.getSourceFile(fileName);
    if (!boundSourceFile) {
      throw new Error(`Failed to get bound source file: ${fileName}`);
    }

    return { newProgram, boundSourceFile };
  }

  /**
   * Write intermediate file for debugging purposes.
   * Creates a .typical.ts file showing the code after typical's transformations
   * but before typia processes it.
   */
  private writeIntermediateFile(fileName: string, code: string): void {
    if (!this.config.debug?.writeIntermediateFiles) {
      return;
    }

    const compilerOptions = this.program.getCompilerOptions();
    const outDir = compilerOptions.outDir || ".";
    const rootDir = compilerOptions.rootDir || ".";

    const relativePath = path.relative(rootDir, fileName);
    const intermediateFileName = relativePath.replace(/\.(tsx?)$/, ".typical.$1");
    const intermediateFilePath = path.join(outDir, intermediateFileName);

    const dir = path.dirname(intermediateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(intermediateFilePath, code);
    console.log(`TYPICAL: Wrote intermediate file: ${intermediateFilePath}`);
  }

  /**
   * Format typia diagnostic errors into readable error messages.
   */
  private formatTypiaErrors(errors: ts.Diagnostic[]): string[] {
    return errors.map(d => {
      const fullMessage = typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText;

      if (d.file && d.start !== undefined && d.length !== undefined) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
        // Extract the actual source code that caused the error
        const sourceSnippet = d.file.text.substring(d.start, d.start + d.length);
        // Truncate long snippets
        const snippet = sourceSnippet.length > 100
          ? sourceSnippet.substring(0, 100) + '...'
          : sourceSnippet;

        // Format the error message - extract type issues from typia's verbose output
        const formattedIssues = this.formatTypiaError(fullMessage);

        return `${d.file.fileName}:${line + 1}:${character + 1}\n` +
          `  Code: ${snippet}\n` +
          formattedIssues;
      }
      return this.formatTypiaError(fullMessage);
    });
  }

  /**
   * Check for untransformed typia calls and throw an error if found.
   * This is a fallback in case typia silently fails without reporting a diagnostic.
   */
  private checkUntransformedTypiaCalls(code: string, fileName: string): void {
    const untransformedCalls = this.findUntransformedTypiaCalls(code);
    if (untransformedCalls.length > 0) {
      const failedTypes = untransformedCalls.map(c => c.type).filter((v, i, a) => a.indexOf(v) === i);
      throw new Error(
        `TYPICAL: Failed to transform the following types (typia cannot process them):\n` +
        failedTypes.map(t => `  - ${t}`).join('\n') +
        `\n\nTo skip validation for these types, add to ignoreTypes in typical.json:\n` +
        `  "ignoreTypes": [${failedTypes.map(t => `"${t}"`).join(', ')}]` +
        `\n\nFile: ${fileName}`
      );
    }
  }

  public createSourceFile(fileName: string, content: string): ts.SourceFile {
    return this.ts.createSourceFile(
      fileName,
      content,
      this.ts.ScriptTarget.ES2020,
      true
    );
  }

  public transform(
    sourceFile: ts.SourceFile | string,
    mode: "basic" | "typia" | "js",
    skippedTypes: Set<string> = new Set()
  ): string {
    if (typeof sourceFile === "string") {
      const file = this.program.getSourceFile(sourceFile);
      if (!file) {
        throw new Error(`Source file not found in program: ${sourceFile}`);
      }
      sourceFile = file;
    }

    const printer = this.ts.createPrinter();

    // Phase 1: typical's own transformations only (no typia)
    const typicalTransformer = this.getTypicalOnlyTransformer(skippedTypes);
    const phase1Result = this.ts.transform(sourceFile, [typicalTransformer]);
    let transformedCode = printer.printFile(phase1Result.transformed[0]);
    phase1Result.dispose();

    if (mode === "basic") {
      return transformedCode;
    }

    // Phase 2: if code has typia calls, run typia transformer in its own context
    if (transformedCode.includes("typia.")) {
      const result = this.applyTypiaTransform(sourceFile.fileName, transformedCode, printer);
      if (typeof result === 'object' && result.retry) {
        // Typia failed on a type - add to skipped and retry the whole transform
        skippedTypes.add(result.failedType);
        // Clear validator caches since we're retrying
        this.typeValidators.clear();
        this.typeStringifiers.clear();
        this.typeParsers.clear();
        return this.transform(sourceFile, mode, skippedTypes);
      }
      transformedCode = result as string;
    }

    if (mode === "typia") {
      return transformedCode;
    }

    // Mode "js" - transpile to JavaScript
    const compileResult = ts.transpileModule(transformedCode, {
      compilerOptions: this.program.getCompilerOptions(),
    });

    return compileResult.outputText;
  }

  /**
   * Apply typia transformation in a separate ts.transform() context.
   * This avoids mixing program contexts and eliminates the need for import recreation.
   * Returns either the transformed code string, or a retry signal with the failed type.
   */
  private applyTypiaTransform(fileName: string, code: string, printer: ts.Printer): string | { retry: true; failedType: string } {
    this.writeIntermediateFile(fileName, code);

    if (process.env.DEBUG) {
      console.log("TYPICAL: Before typia transform (first 500 chars):", code.substring(0, 500));
    }

    // Create a new program with the transformed source file so typia can resolve types
    const { newProgram, boundSourceFile } = this.createTypiaProgram(fileName, code);

    // Collect typia diagnostics to detect transformation failures
    const diagnostics: ts.Diagnostic[] = [];

    // Create typia transformer with the new program
    const typiaTransformerFactory = typiaTransform(
      newProgram,
      {},
      {
        addDiagnostic(diag: ts.Diagnostic) {
          diagnostics.push(diag);
          if (process.env.DEBUG) {
            console.warn("Typia diagnostic:", diag);
          }
          return diagnostics.length - 1;
        },
      }
    );

    // Run typia's transformer in its own ts.transform() call
    const typiaResult = this.ts.transform(boundSourceFile, [typiaTransformerFactory]);
    let typiaTransformed = typiaResult.transformed[0];
    typiaResult.dispose();

    if (process.env.DEBUG) {
      const afterTypia = printer.printFile(typiaTransformed);
      console.log("TYPICAL: After typia transform (first 500 chars):", afterTypia.substring(0, 500));
    }

    // Check for typia errors via diagnostics
    const errors = diagnostics.filter(d => d.category === this.ts.DiagnosticCategory.Error);
    if (errors.length > 0) {
      // Check if any error is due to Window/globalThis intersection (DOM types)
      for (const d of errors) {
        const fullMessage = typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText;
        if (fullMessage.includes('Window & typeof globalThis') || fullMessage.includes('typeof globalThis')) {
          // Find the validator that failed - look for the type in the error
          // Error format: "Code: typia.createAssert<{ value: number; table: Table; }>()"
          if (d.file && d.start !== undefined && d.length !== undefined) {
            const sourceSnippet = d.file.text.substring(d.start, d.start + d.length);
            // Extract the type from typia.createAssert<TYPE>()
            const typeMatch = sourceSnippet.match(/typia\.\w+<([^>]+(?:<[^>]*>)*)>\(\)/);
            if (typeMatch) {
              const failedType = typeMatch[1].trim();
              console.warn(`TYPICAL: Skipping validation for type due to Window/globalThis (typia cannot process DOM types): ${failedType.substring(0, 100)}...`);

              // Add to ignored types and signal retry needed
              return { retry: true, failedType };
            }
          }
        }
      }

      // No retryable errors, throw the original error
      const errorMessages = this.formatTypiaErrors(errors);
      throw new Error(
        `TYPICAL: Typia transformation failed:\n\n${errorMessages.join('\n\n')}`
      );
    }

    // Hoist RegExp constructors to top-level constants for performance
    if (this.config.hoistRegex !== false) {
      // Need to run hoisting in a transform context
      const hoistResult = this.ts.transform(typiaTransformed, [
        (context) => (sf) => hoistRegexConstructors(sf, this.ts, context.factory)
      ]);
      typiaTransformed = hoistResult.transformed[0];
      hoistResult.dispose();
    }

    const finalCode = printer.printFile(typiaTransformed);

    // Check for untransformed typia calls as a fallback
    this.checkUntransformedTypiaCalls(finalCode, fileName);

    return finalCode;
  }

  /**
   * Get a transformer that only applies typical's transformations (no typia).
   * @param skippedTypes Set of type strings to skip validation for (used for retry after typia errors)
   */
  private getTypicalOnlyTransformer(skippedTypes: Set<string> = new Set()): ts.TransformerFactory<ts.SourceFile> {
    return (context: ts.TransformationContext) => {
      const factory = context.factory;
      const typeChecker = this.program.getTypeChecker();
      const transformContext: TransformContext = {
        ts: this.ts,
        factory,
        context,
      };

      return (sourceFile: ts.SourceFile) => {
        // Check if this file should be transformed based on include/exclude patterns
        if (!this.shouldTransformFile(sourceFile.fileName)) {
          return sourceFile;
        }

        if (process.env.DEBUG) {
          console.log("TYPICAL: processing ", sourceFile.fileName);
        }

        return this.transformSourceFile(sourceFile, transformContext, typeChecker, skippedTypes);
      };
    };
  }

  /**
   * Get a combined transformer for use with ts-patch/ttsc.
   * This is used by the TSC plugin where we need a single transformer factory.
   *
   * Note: Even for ts-patch, we need to create a new program with the transformed
   * source so typia can resolve the types from our generated typia.createAssert<T>() calls.
   */
  public getTransformer(withTypia: boolean): ts.TransformerFactory<ts.SourceFile> {
    return (context: ts.TransformationContext) => {
      const factory = context.factory;
      const typeChecker = this.program.getTypeChecker();
      const transformContext: TransformContext = {
        ts: this.ts,
        factory,
        context,
      };

      return (sourceFile: ts.SourceFile) => {
        // Check if this file should be transformed based on include/exclude patterns
        if (!this.shouldTransformFile(sourceFile.fileName)) {
          return sourceFile;
        }

        if (process.env.DEBUG) {
          console.log("TYPICAL: processing ", sourceFile.fileName);
        }

        // Apply typical's transformations
        let transformedSourceFile = this.transformSourceFile(
          sourceFile,
          transformContext,
          typeChecker
        );

        if (!withTypia) {
          return transformedSourceFile;
        }

        // Print the transformed code to check for typia calls
        const printer = this.ts.createPrinter();
        const transformedCode = printer.printFile(transformedSourceFile);

        if (!transformedCode.includes("typia.")) {
          return transformedSourceFile;
        }

        this.writeIntermediateFile(sourceFile.fileName, transformedCode);

        if (process.env.DEBUG) {
          console.log("TYPICAL: Before typia transform (first 500 chars):", transformedCode.substring(0, 500));
        }

        // Create a new program with the transformed source file so typia can resolve types
        const { newProgram, boundSourceFile } = this.createTypiaProgram(
          sourceFile.fileName,
          transformedCode,
          sourceFile.languageVersion
        );

        // Collect typia diagnostics to detect transformation failures
        const diagnostics: ts.Diagnostic[] = [];

        // Create typia transformer with the new program
        const typiaTransformerFactory = typiaTransform(
          newProgram,
          {},
          {
            addDiagnostic(diag: ts.Diagnostic) {
              diagnostics.push(diag);
              if (process.env.DEBUG) {
                console.warn("Typia diagnostic:", diag);
              }
              return diagnostics.length - 1;
            },
          }
        );

        // Apply typia's transformer to the bound source file
        const typiaNodeTransformer = typiaTransformerFactory(context);
        transformedSourceFile = typiaNodeTransformer(boundSourceFile);

        if (process.env.DEBUG) {
          const afterTypia = printer.printFile(transformedSourceFile);
          console.log("TYPICAL: After typia transform (first 500 chars):", afterTypia.substring(0, 500));
        }

        // Check for typia errors via diagnostics
        const errors = diagnostics.filter(d => d.category === this.ts.DiagnosticCategory.Error);
        if (errors.length > 0) {
          const errorMessages = this.formatTypiaErrors(errors);
          throw new Error(
            `TYPICAL: Typia transformation failed:\n\n${errorMessages.join('\n\n')}`
          );
        }

        // Hoist RegExp constructors to top-level constants for performance
        if (this.config.hoistRegex !== false) {
          transformedSourceFile = hoistRegexConstructors(
            transformedSourceFile,
            this.ts,
            factory
          );
        }

        // Check for untransformed typia calls as a fallback
        const finalCode = printer.printFile(transformedSourceFile);
        this.checkUntransformedTypiaCalls(finalCode, sourceFile.fileName);

        return transformedSourceFile;
      };
    };
  }

  /**
   * Transform JSON.stringify or JSON.parse calls to use typia's validated versions.
   * Returns the transformed node if applicable, or undefined to indicate no transformation.
   */
  private transformJSONCall(
    node: ts.CallExpression,
    ctx: TransformContext,
    typeChecker: ts.TypeChecker,
    shouldSkipType: (typeText: string) => boolean
  ): ts.Node | undefined {
    const { ts, factory } = ctx;
    const propertyAccess = node.expression as ts.PropertyAccessExpression;

    if (propertyAccess.name.text === "stringify") {
      // For stringify, we need to infer the type from the argument
      // First check if the argument type is 'any' - if so, skip transformation
      if (node.arguments.length > 0) {
        const arg = node.arguments[0];
        const argType = typeChecker.getTypeAtLocation(arg);
        if (this.isAnyOrUnknownTypeFlags(argType)) {
          return undefined; // Don't transform JSON.stringify for any/unknown types
        }
      }

      if (this.config.reusableValidators) {
        // Infer type from argument
        const arg = node.arguments[0];
        const { typeText, typeNode } = this.inferStringifyType(arg, typeChecker, ctx);

        const stringifierName = this.getOrCreateStringifier(typeText, typeNode);
        return factory.createCallExpression(
          factory.createIdentifier(stringifierName),
          undefined,
          node.arguments
        );
      } else {
        // Use inline typia.json.stringify
        return factory.updateCallExpression(
          node,
          factory.createPropertyAccessExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("typia"),
              "json"
            ),
            "stringify"
          ),
          node.typeArguments,
          node.arguments
        );
      }
    } else if (propertyAccess.name.text === "parse") {
      // For JSON.parse, we need to infer the expected type from context
      // Check if this is part of a variable declaration or type assertion
      let targetType: ts.TypeNode | undefined;

      // Look for type annotations in parent nodes
      let parent = node.parent;
      while (parent) {
        if (ts.isVariableDeclaration(parent) && parent.type) {
          targetType = parent.type;
          break;
        } else if (ts.isAsExpression(parent)) {
          targetType = parent.type;
          break;
        } else if (ts.isReturnStatement(parent)) {
          // Look for function return type
          let funcParent = parent.parent;
          while (funcParent) {
            if (
              (ts.isFunctionDeclaration(funcParent) ||
                ts.isArrowFunction(funcParent) ||
                ts.isMethodDeclaration(funcParent)) &&
              funcParent.type
            ) {
              targetType = funcParent.type;
              break;
            }
            funcParent = funcParent.parent;
          }
          break;
        } else if (ts.isArrowFunction(parent) && parent.type) {
          // Arrow function with expression body (not block)
          // e.g., (s: string): User => JSON.parse(s)
          targetType = parent.type;
          break;
        }
        parent = parent.parent;
      }

      if (targetType && this.isAnyOrUnknownType(targetType)) {
        // Don't transform JSON.parse for any/unknown types
        return undefined;
      }

      // If we can't determine the target type and there's no explicit type argument,
      // don't transform - we can't validate against an unknown type
      if (!targetType && !node.typeArguments) {
        return undefined;
      }

      if (this.config.reusableValidators && targetType) {
        // Use reusable parser - use typeNode text to preserve local aliases
        const typeText = this.getTypeKey(targetType, typeChecker);

        // Skip types that failed in typia (retry mechanism)
        if (shouldSkipType(typeText)) {
          if (process.env.DEBUG) {
            console.log(`TYPICAL: Skipping previously failed type for JSON.parse: ${typeText}`);
          }
          return undefined;
        }

        const parserName = this.getOrCreateParser(typeText, targetType);

        return factory.createCallExpression(
          factory.createIdentifier(parserName),
          undefined,
          node.arguments
        );
      } else {
        // Use inline typia.json.assertParse
        const typeArguments = targetType
          ? [targetType]
          : node.typeArguments;

        return factory.updateCallExpression(
          node,
          factory.createPropertyAccessExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier("typia"),
              "json"
            ),
            "assertParse"
          ),
          typeArguments,
          node.arguments
        );
      }
    }

    return undefined;
  }

  /**
   * Check if a type should be skipped (failed in typia on previous attempt).
   */
  private shouldSkipType(typeText: string, skippedTypes: Set<string>): boolean {
    if (skippedTypes.size === 0) return false;
    // Normalize: remove all whitespace and semicolons for comparison
    const normalize = (s: string) => s.replace(/[\s;]+/g, '').toLowerCase();
    const normalized = normalize(typeText);
    for (const skipped of skippedTypes) {
      const skippedNormalized = normalize(skipped);
      if (normalized === skippedNormalized || normalized.includes(skippedNormalized) || skippedNormalized.includes(normalized)) {
        if (process.env.DEBUG) {
          console.log(`TYPICAL: Matched skipped type: "${typeText.substring(0, 50)}..." matches "${skipped.substring(0, 50)}..."`);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Create an AST visitor function for transforming a source file.
   * The visitor handles JSON calls, type casts, and function declarations.
   */
  private createVisitor(
    ctx: TransformContext,
    typeChecker: ts.TypeChecker,
    skippedTypes: Set<string>,
    state: FileTransformState
  ): (node: ts.Node) => ts.Node {
    const { ts } = ctx;
    const shouldSkipType = (typeText: string) => this.shouldSkipType(typeText, skippedTypes);

    // Forward declaration for mutual recursion
    let transformFunction: (func: ts.FunctionDeclaration | ts.ArrowFunction | ts.MethodDeclaration) => ts.Node;

    const visit = (node: ts.Node): ts.Node => {
      // Transform JSON calls first (before they get wrapped in functions)
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const propertyAccess = node.expression;
        if (
          ts.isIdentifier(propertyAccess.expression) &&
          propertyAccess.expression.text === "JSON"
        ) {
          const transformed = this.transformJSONCall(node, ctx, typeChecker, shouldSkipType);
          if (transformed) {
            state.needsTypiaImport = true;
            return transformed;
          }
          return node;
        }
      }

      // Transform type assertions (as expressions) when validateCasts is enabled
      // e.g., `obj as User` becomes `__typical_assert_N(obj)`
      if (this.config.validateCasts && ts.isAsExpression(node)) {
        const targetType = node.type;

        // Skip 'as any' and 'as unknown' casts - these are intentional escapes
        if (this.isAnyOrUnknownType(targetType)) {
          return ctx.ts.visitEachChild(node, visit, ctx.context);
        }

        // Skip primitive types - no runtime validation needed
        if (targetType.kind === ts.SyntaxKind.StringKeyword ||
            targetType.kind === ts.SyntaxKind.NumberKeyword ||
            targetType.kind === ts.SyntaxKind.BooleanKeyword) {
          return ctx.ts.visitEachChild(node, visit, ctx.context);
        }

        // Skip types matching ignoreTypes patterns (including classes extending DOM types)
        const typeText = this.getTypeKey(targetType, typeChecker);
        const targetTypeObj = typeChecker.getTypeFromTypeNode(targetType);
        if (this.isIgnoredType(typeText, typeChecker, targetTypeObj)) {
          if (process.env.DEBUG) {
            console.log(`TYPICAL: Skipping ignored type for cast: ${typeText}`);
          }
          return ctx.ts.visitEachChild(node, visit, ctx.context);
        }

        // Skip types that failed in typia (retry mechanism)
        if (shouldSkipType(typeText)) {
          if (process.env.DEBUG) {
            console.log(`TYPICAL: Skipping previously failed type for cast: ${typeText}`);
          }
          return ctx.ts.visitEachChild(node, visit, ctx.context);
        }

        state.needsTypiaImport = true;

        // Visit the expression first to transform any nested casts
        const visitedExpression = ctx.ts.visitNode(node.expression, visit) as ts.Expression;

        if (this.config.reusableValidators) {
          // Use typeNode text to preserve local aliases
          const typeText = this.getTypeKey(targetType, typeChecker);
          const validatorName = this.getOrCreateValidator(typeText, targetType);

          // Replace `expr as Type` with `__typical_assert_N(expr)`
          return ctx.factory.createCallExpression(
            ctx.factory.createIdentifier(validatorName),
            undefined,
            [visitedExpression]
          );
        } else {
          // Inline validator: typia.assert<Type>(expr)
          return ctx.factory.createCallExpression(
            ctx.factory.createPropertyAccessExpression(
              ctx.factory.createIdentifier("typia"),
              "assert"
            ),
            [targetType],
            [visitedExpression]
          );
        }
      }

      // Transform function declarations
      if (ts.isFunctionDeclaration(node)) {
        state.needsTypiaImport = true;
        return transformFunction(node);
      }

      // Transform arrow functions
      if (ts.isArrowFunction(node)) {
        state.needsTypiaImport = true;
        return transformFunction(node);
      }

      // Transform method declarations
      if (ts.isMethodDeclaration(node)) {
        state.needsTypiaImport = true;
        return transformFunction(node);
      }

      return ctx.ts.visitEachChild(node, visit, ctx.context);
    };

    transformFunction = (
      func: ts.FunctionDeclaration | ts.ArrowFunction | ts.MethodDeclaration
    ): ts.Node => {
      const body = func.body;

      // For arrow functions with expression bodies (not blocks),
      // still visit the expression to transform JSON calls etc.
      // Also handle Promise return types with .then() validation
      if (body && !ts.isBlock(body) && ts.isArrowFunction(func)) {
        let visitedBody = ctx.ts.visitNode(body, visit) as ts.Expression;

        // Check if this is a non-async function with Promise return type
        let returnType = func.type;
        let returnTypeForString: ts.Type | undefined;

        if (returnType) {
          returnTypeForString = typeChecker.getTypeFromTypeNode(returnType);
        } else {
          // Try to infer the return type from the signature
          try {
            const signature = typeChecker.getSignatureFromDeclaration(func);
            if (signature) {
              const inferredReturnType = typeChecker.getReturnTypeOfSignature(signature);
              returnType = typeChecker.typeToTypeNode(
                inferredReturnType,
                func,
                TYPE_NODE_FLAGS
              );
              returnTypeForString = inferredReturnType;
            }
          } catch {
            // Skip inference
          }
        }

        // Check for Promise<T> return type
        if (returnType && returnTypeForString) {
          const promiseSymbol = returnTypeForString.getSymbol();
          if (promiseSymbol && promiseSymbol.getName() === "Promise") {
            const typeArgs = (returnTypeForString as ts.TypeReference).typeArguments;
            if (typeArgs && typeArgs.length > 0) {
              const innerType = typeArgs[0];
              let innerTypeNode: ts.TypeNode | undefined;

              if (ts.isTypeReferenceNode(returnType) && returnType.typeArguments && returnType.typeArguments.length > 0) {
                innerTypeNode = returnType.typeArguments[0];
              } else {
                innerTypeNode = typeChecker.typeToTypeNode(
                  innerType,
                  func,
                  TYPE_NODE_FLAGS
                );
              }

              // Only add validation if validateFunctions is enabled
              if (this.config.validateFunctions !== false && innerTypeNode && !this.isAnyOrUnknownType(innerTypeNode)) {
                const innerTypeText = this.getTypeKey(innerTypeNode, typeChecker, innerType);
                if (!this.isIgnoredType(innerTypeText, typeChecker, innerType) && !shouldSkipType(innerTypeText)) {
                  // Wrap expression with .then(validator)
                  const validatorName = this.config.reusableValidators
                    ? this.getOrCreateValidator(innerTypeText, innerTypeNode)
                    : null;

                  if (validatorName) {
                    state.needsTypiaImport = true;
                    visitedBody = ctx.factory.createCallExpression(
                      ctx.factory.createPropertyAccessExpression(
                        visitedBody,
                        ctx.factory.createIdentifier("then")
                      ),
                      undefined,
                      [ctx.factory.createIdentifier(validatorName)]
                    );
                  }
                }
              }
            }
          }
        }

        if (visitedBody !== body) {
          return ctx.factory.updateArrowFunction(
            func,
            func.modifiers,
            func.typeParameters,
            func.parameters,
            func.type,
            func.equalsGreaterThanToken,
            visitedBody
          );
        }
        return func;
      }

      if (!body || !ts.isBlock(body)) return func;

      // Track validated variables (params and consts with type annotations)
      const validatedVariables = new Map<string, ts.Type>();

      // Add parameter validation (only if validateFunctions is enabled)
      const validationStatements: ts.Statement[] = [];

      // Skip parameter validation if validateFunctions is disabled
      const shouldValidateFunctions = this.config.validateFunctions !== false;

      func.parameters.forEach((param) => {
        if (shouldValidateFunctions && param.type) {
          // Skip 'any' and 'unknown' types - no point validating them
          if (this.isAnyOrUnknownType(param.type)) {
            return;
          }

          // Skip types matching ignoreTypes patterns (including classes extending DOM types)
          const typeText = this.getTypeKey(param.type, typeChecker);
          const paramType = typeChecker.getTypeFromTypeNode(param.type);

          // Skip type parameters (generics) - can't be validated at runtime
          if (this.isAnyOrUnknownTypeFlags(paramType)) {
            if (process.env.DEBUG) {
              console.log(`TYPICAL: Skipping type parameter/any for parameter: ${typeText}`);
            }
            return;
          }

          if (process.env.DEBUG) {
            console.log(`TYPICAL: Processing parameter type: ${typeText}`);
          }
          if (this.isIgnoredType(typeText, typeChecker, paramType)) {
            if (process.env.DEBUG) {
              console.log(`TYPICAL: Skipping ignored type for parameter: ${typeText}`);
            }
            return;
          }

          // Skip types that failed in typia (retry mechanism)
          if (shouldSkipType(typeText)) {
            if (process.env.DEBUG) {
              console.log(`TYPICAL: Skipping previously failed type for parameter: ${typeText}`);
            }
            return;
          }

          const paramName = ts.isIdentifier(param.name)
            ? param.name.text
            : "param";
          const paramIdentifier = ctx.factory.createIdentifier(paramName);

          // Track this parameter as validated for flow analysis
          validatedVariables.set(paramName, paramType);

          if (this.config.reusableValidators) {
            // Use reusable validators - use typeNode text to preserve local aliases
            const validatorName = this.getOrCreateValidator(
              typeText,
              param.type
            );

            const validatorCall = ctx.factory.createCallExpression(
              ctx.factory.createIdentifier(validatorName),
              undefined,
              [paramIdentifier]
            );
            const assertCall =
              ctx.factory.createExpressionStatement(validatorCall);

            validationStatements.push(assertCall);
          } else {
            // Use inline typia.assert calls
            const typiaIdentifier = ctx.factory.createIdentifier("typia");
            const assertIdentifier = ctx.factory.createIdentifier("assert");
            const propertyAccess = ctx.factory.createPropertyAccessExpression(
              typiaIdentifier,
              assertIdentifier
            );
            const callExpression = ctx.factory.createCallExpression(
              propertyAccess,
              [param.type],
              [paramIdentifier]
            );
            const assertCall =
              ctx.factory.createExpressionStatement(callExpression);

            validationStatements.push(assertCall);
          }
        }
      });

      // First visit all child nodes (including JSON calls) before adding validation
      const visitedBody = ctx.ts.visitNode(body, visit) as ts.Block;

      // Also track const declarations with type annotations as validated
      // (the assignment will be validated, and const can't be reassigned)
      const collectConstDeclarations = (node: ts.Node): void => {
        if (ts.isVariableStatement(node)) {
          const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
          if (isConst) {
            for (const decl of node.declarationList.declarations) {
              if (decl.type && ts.isIdentifier(decl.name)) {
                // Skip any/unknown types
                if (!this.isAnyOrUnknownType(decl.type)) {
                  const constType = typeChecker.getTypeFromTypeNode(decl.type);
                  validatedVariables.set(decl.name.text, constType);
                }
              }
            }
          }
        }
        ts.forEachChild(node, collectConstDeclarations);
      };
      collectConstDeclarations(visitedBody);

      // Transform return statements - use explicit type or infer from type checker
      let transformedStatements = visitedBody.statements;
      let returnType = func.type;

      // Check if this is an async function
      const isAsync = func.modifiers?.some(
        (mod) => mod.kind === ts.SyntaxKind.AsyncKeyword
      );

      // If no explicit return type, try to infer it from the type checker
      let returnTypeForString: ts.Type | undefined;
      if (!returnType) {
        try {
          const signature = typeChecker.getSignatureFromDeclaration(func);
          if (signature) {
            const inferredReturnType = typeChecker.getReturnTypeOfSignature(signature);
            returnType = typeChecker.typeToTypeNode(
              inferredReturnType,
              func,
              TYPE_NODE_FLAGS
            );
            returnTypeForString = inferredReturnType;
          }
        } catch {
          // Could not infer signature (e.g., untyped arrow function callback)
          // Skip return type validation for this function
        }
      } else {
        // For explicit return types, get the Type from the TypeNode
        returnTypeForString = typeChecker.getTypeFromTypeNode(returnType);
      }

      // Handle Promise return types
      // Track whether this is a non-async function returning Promise (needs .then() wrapper)
      let isNonAsyncPromiseReturn = false;

      if (returnType && returnTypeForString) {
        const promiseSymbol = returnTypeForString.getSymbol();
        if (promiseSymbol && promiseSymbol.getName() === "Promise") {
          // Unwrap Promise<T> to get T for validation
          const typeArgs = (returnTypeForString as ts.TypeReference).typeArguments;
          if (typeArgs && typeArgs.length > 0) {
            returnTypeForString = typeArgs[0];
            // Also update the TypeNode to match
            if (ts.isTypeReferenceNode(returnType) && returnType.typeArguments && returnType.typeArguments.length > 0) {
              returnType = returnType.typeArguments[0];
            } else {
              // Create a new type node from the unwrapped type
              returnType = typeChecker.typeToTypeNode(
                returnTypeForString,
                func,
                TYPE_NODE_FLAGS
              );
            }

            if (!isAsync) {
              // For non-async functions returning Promise, we'll use .then(validator)
              isNonAsyncPromiseReturn = true;
              if (process.env.DEBUG) {
                console.log(`TYPICAL: Non-async Promise return type - will use .then() for validation`);
              }
            }
          }
        }
      }

      // Skip 'any' and 'unknown' return types - no point validating them
      // Also skip types matching ignoreTypes patterns (including classes extending DOM types)
      // Also skip types containing type parameters or constructor types
      const returnTypeText = returnType && returnTypeForString
        ? this.getTypeKey(returnType, typeChecker, returnTypeForString)
        : null;
      if (process.env.DEBUG && returnTypeText) {
        console.log(`TYPICAL: Checking return type: "${returnTypeText}" (isAsync: ${isAsync})`);
      }

      // Skip if return type contains type parameters, constructor types, or is otherwise unvalidatable
      const shouldSkipReturnType = returnTypeForString && this.containsUnvalidatableType(returnTypeForString);
      if (shouldSkipReturnType && process.env.DEBUG) {
        console.log(`TYPICAL: Skipping unvalidatable return type: ${returnTypeText}`);
      }

      const isIgnoredReturnType = returnTypeText && this.isIgnoredType(returnTypeText, typeChecker, returnTypeForString);
      if (isIgnoredReturnType && process.env.DEBUG) {
        console.log(`TYPICAL: Skipping ignored type for return: ${returnTypeText}`);
      }
      const isSkippedReturnType = returnTypeText && shouldSkipType(returnTypeText);
      if (isSkippedReturnType && process.env.DEBUG) {
        console.log(`TYPICAL: Skipping previously failed type for return: ${returnTypeText}`);
      }
      if (shouldValidateFunctions && returnType && returnTypeForString && !this.isAnyOrUnknownType(returnType) && !isIgnoredReturnType && !shouldSkipReturnType && !isSkippedReturnType) {
        const returnTransformer = (node: ts.Node): ts.Node => {
          // Don't recurse into nested functions - they have their own return types
          if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) ||
              ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) {
            return node;
          }

          if (ts.isReturnStatement(node) && node.expression) {
            // Skip return validation if the expression already contains a __typical _parse_* call
            // since typia.assertParse already validates the parsed data
            const containsTypicalParse = (n: ts.Node): boolean => {
              if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
                const name = n.expression.text;
                if (name.startsWith("__typical" + "_parse_")) {
                  return true;
                }
              }
              return ts.forEachChild(n, containsTypicalParse) || false;
            };
            if (containsTypicalParse(node.expression)) {
              return node; // Already validated by parse, skip return validation
            }

            // Flow analysis: Skip return validation if returning a validated variable
            // (or property of one) that hasn't been tainted
            const rootVar = this.getRootIdentifier(node.expression);
            if (rootVar && validatedVariables.has(rootVar)) {
              // Check if the variable has been tainted (mutated, passed to function, etc.)
              if (!this.isTainted(rootVar, visitedBody)) {
                // Return expression is rooted at a validated, untainted variable
                // For direct returns (identifier) or property access, we can skip validation
                if (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression)) {
                  return node; // Skip validation - already validated and untainted
                }
              }
            }

            // For non-async functions returning Promise, use .then(validator)
            // For async functions, await the expression before validating
            if (isNonAsyncPromiseReturn) {
              // return expr.then(validator)
              const returnTypeText = this.getTypeKey(returnType, typeChecker, returnTypeForString);
              const validatorName = this.config.reusableValidators
                ? this.getOrCreateValidator(returnTypeText, returnType)
                : null;

              // Create the validator reference (either reusable or inline)
              let validatorExpr: ts.Expression;
              if (validatorName) {
                validatorExpr = ctx.factory.createIdentifier(validatorName);
              } else {
                // Inline: typia.assert<T>
                validatorExpr = ctx.factory.createPropertyAccessExpression(
                  ctx.factory.createIdentifier("typia"),
                  ctx.factory.createIdentifier("assert")
                );
                // Note: For inline mode, we'd need to create a wrapper arrow function
                // to pass the type argument. For simplicity, just use the property access
                // and let typia handle it (though this won't work without type args)
                // In practice, reusableValidators should be true for this to work well
              }

              // expr.then(validator)
              const thenCall = ctx.factory.createCallExpression(
                ctx.factory.createPropertyAccessExpression(
                  node.expression,
                  ctx.factory.createIdentifier("then")
                ),
                undefined,
                [validatorExpr]
              );

              return ctx.factory.updateReturnStatement(node, thenCall);
            }

            // For async functions, we need to await the expression before validating
            // because the return expression might be a Promise
            let expressionToValidate = node.expression;

            if (isAsync) {
              // Check if the expression is already an await expression
              const isAlreadyAwaited = ts.isAwaitExpression(node.expression);

              if (!isAlreadyAwaited) {
                // Wrap in await: return validate(await expr)
                expressionToValidate = ctx.factory.createAwaitExpression(node.expression);
              }
            }

            if (this.config.reusableValidators) {
              // Use reusable validators - use typeNode text to preserve local aliases
              // Pass returnTypeForString for synthesized nodes (inferred return types)
              const returnTypeText = this.getTypeKey(returnType, typeChecker, returnTypeForString);
              const validatorName = this.getOrCreateValidator(
                returnTypeText,
                returnType
              );

              const validatorCall = ctx.factory.createCallExpression(
                ctx.factory.createIdentifier(validatorName),
                undefined,
                [expressionToValidate]
              );

              return ctx.factory.updateReturnStatement(node, validatorCall);
            } else {
              // Use inline typia.assert calls
              const typiaIdentifier = ctx.factory.createIdentifier("typia");
              const assertIdentifier = ctx.factory.createIdentifier("assert");
              const propertyAccess = ctx.factory.createPropertyAccessExpression(
                typiaIdentifier,
                assertIdentifier
              );
              const callExpression = ctx.factory.createCallExpression(
                propertyAccess,
                [returnType],
                [expressionToValidate]
              );

              return ctx.factory.updateReturnStatement(node, callExpression);
            }
          }
          return ctx.ts.visitEachChild(node, returnTransformer, ctx.context);
        };

        transformedStatements = ctx.ts.visitNodes(
          visitedBody.statements,
          returnTransformer
        ) as ts.NodeArray<ts.Statement>;
      }

      // Insert validation statements at the beginning
      const newStatements = ctx.factory.createNodeArray([
        ...validationStatements,
        ...transformedStatements,
      ]);
      const newBody = ctx.factory.updateBlock(visitedBody, newStatements);

      if (ts.isFunctionDeclaration(func)) {
        return ctx.factory.updateFunctionDeclaration(
          func,
          func.modifiers,
          func.asteriskToken,
          func.name,
          func.typeParameters,
          func.parameters,
          func.type,
          newBody
        );
      } else if (ts.isArrowFunction(func)) {
        return ctx.factory.updateArrowFunction(
          func,
          func.modifiers,
          func.typeParameters,
          func.parameters,
          func.type,
          func.equalsGreaterThanToken,
          newBody
        );
      } else if (ts.isMethodDeclaration(func)) {
        return ctx.factory.updateMethodDeclaration(
          func,
          func.modifiers,
          func.asteriskToken,
          func.name,
          func.questionToken,
          func.typeParameters,
          func.parameters,
          func.type,
          newBody
        );
      }

      return func;
    };

    return visit;
  }

  /**
   * Transform a single source file with TypeScript AST
   */
  private transformSourceFile(
    sourceFile: ts.SourceFile,
    ctx: TransformContext,
    typeChecker: ts.TypeChecker,
    skippedTypes: Set<string> = new Set()
  ): ts.SourceFile {
    if (!sourceFile.fileName.includes('transformer.test.ts')) {
      // Check if this file has already been transformed by us
      const sourceText = sourceFile.getFullText();
      if (sourceText.includes('__typical_' + 'assert_') || sourceText.includes('__typical_' + 'stringify_') || sourceText.includes('__typical_' + 'parse_')) {
        throw new Error(`File ${sourceFile.fileName} has already been transformed by Typical! Double transformation detected.`);
      }
    }

    // Reset caches for each file
    this.typeValidators.clear();
    this.typeStringifiers.clear();
    this.typeParsers.clear();

    // Create state object to track mutable state across visitor calls
    const state: FileTransformState = { needsTypiaImport: false };

    // Create visitor and transform the source file
    const visit = this.createVisitor(ctx, typeChecker, skippedTypes, state);
    let transformedSourceFile = ctx.ts.visitNode(
      sourceFile,
      visit
    ) as ts.SourceFile;

    // Add typia import and validator statements if needed
    if (state.needsTypiaImport) {
      transformedSourceFile = this.addTypiaImport(transformedSourceFile, ctx);

      // Add validator statements after imports (only if using reusable validators)
      if (this.config.reusableValidators) {
        const validatorStmts = this.createValidatorStatements(ctx);

        if (validatorStmts.length > 0) {
          const importStatements = transformedSourceFile.statements.filter(
            ctx.ts.isImportDeclaration
          );
          const otherStatements = transformedSourceFile.statements.filter(
            (stmt) => !ctx.ts.isImportDeclaration(stmt)
          );

          const newStatements = ctx.factory.createNodeArray([
            ...importStatements,
            ...validatorStmts,
            ...otherStatements,
          ]);

          transformedSourceFile = ctx.factory.updateSourceFile(
            transformedSourceFile,
            newStatements
          );
        }
      }
    }

    return transformedSourceFile;
  }

  public shouldTransformFile(fileName: string): boolean {
    return shouldTransformFile(fileName, this.config);
  }

  /**
   * Get pre-compiled ignore patterns, caching them for performance.
   */
  private getCompiledPatterns(): CompiledIgnorePatterns {
    if (!this.compiledPatterns) {
      this.compiledPatterns = getCompiledIgnorePatterns(this.config);
    }
    return this.compiledPatterns;
  }

  /**
   * Check if a TypeNode represents a type that shouldn't be validated.
   * This includes:
   * - any/unknown (intentional escape hatches)
   * - Type parameters (generics like T)
   * - Constructor types (new (...args: any[]) => T)
   * - Function types ((...args) => T)
   */
  private isAnyOrUnknownType(typeNode: ts.TypeNode): boolean {
    // any/unknown are escape hatches
    if (typeNode.kind === this.ts.SyntaxKind.AnyKeyword ||
        typeNode.kind === this.ts.SyntaxKind.UnknownKeyword) {
      return true;
    }
    // Type parameters (generics) can't be validated at runtime
    if (typeNode.kind === this.ts.SyntaxKind.TypeReference) {
      const typeRef = typeNode as ts.TypeReferenceNode;
      // Single identifier that's a type parameter
      if (ts.isIdentifier(typeRef.typeName)) {
        // Check if it's a type parameter by looking for it in enclosing type parameter lists
        // For now, we'll check if it's a single uppercase letter or common generic names
        const name = typeRef.typeName.text;
        // Common type parameter names - single letters or common conventions
        if (/^[A-Z]$/.test(name) || /^T[A-Z]?[a-z]*$/.test(name)) {
          return true;
        }
      }
    }
    // Constructor types can't be validated by typia
    if (typeNode.kind === this.ts.SyntaxKind.ConstructorType) {
      return true;
    }
    // Function types generally shouldn't be validated
    if (typeNode.kind === this.ts.SyntaxKind.FunctionType) {
      return true;
    }
    return false;
  }

  /**
   * Check if a type contains any unvalidatable parts (type parameters, constructor types, etc.)
   * This recursively checks intersection and union types.
   */
  private containsUnvalidatableType(type: ts.Type): boolean {
    // Type parameters can't be validated at runtime
    if ((type.flags & this.ts.TypeFlags.TypeParameter) !== 0) {
      return true;
    }

    // Check intersection types - if any part is unvalidatable, the whole thing is
    if (type.isIntersection()) {
      return type.types.some(t => this.containsUnvalidatableType(t));
    }

    // Check union types
    if (type.isUnion()) {
      return type.types.some(t => this.containsUnvalidatableType(t));
    }

    // Check for constructor signatures (like `new (...args) => T`)
    const callSignatures = type.getConstructSignatures?.() ?? [];
    if (callSignatures.length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Check if a Type has any or unknown flags, or is a type parameter or function/constructor.
   */
  private isAnyOrUnknownTypeFlags(type: ts.Type): boolean {
    // any/unknown
    if ((type.flags & this.ts.TypeFlags.Any) !== 0 ||
        (type.flags & this.ts.TypeFlags.Unknown) !== 0) {
      return true;
    }
    // Type parameters (generics) - can't be validated at runtime
    if ((type.flags & this.ts.TypeFlags.TypeParameter) !== 0) {
      return true;
    }
    return false;
  }

  /**
   * Check if a type name matches any of the ignoreTypes patterns.
   * Supports wildcards: "React.*" matches "React.FormEvent", "React.ChangeEvent", etc.
   * Also handles union types: "Document | Element" is ignored if "Document" or "Element" is in ignoreTypes.
   */
  private isIgnoredType(typeName: string, typeChecker?: ts.TypeChecker, type?: ts.Type): boolean {
    const compiled = this.getCompiledPatterns();
    if (compiled.allPatterns.length === 0) return false;

    // For union types, check each constituent
    if (type && type.isUnion()) {
      const nonNullTypes = type.types.filter(t =>
        !(t.flags & this.ts.TypeFlags.Null) && !(t.flags & this.ts.TypeFlags.Undefined)
      );
      if (nonNullTypes.length === 0) return false;
      // All non-null types must be ignored
      return nonNullTypes.every(t => this.isIgnoredSingleType(t, compiled.allPatterns, typeChecker));
    }

    // For non-union types, check directly
    if (type && typeChecker) {
      return this.isIgnoredSingleType(type, compiled.allPatterns, typeChecker);
    }

    // Fallback: string-based matching for union types like "Document | Element | null"
    const typeParts = typeName.split(' | ').map(t => t.trim());
    const nonNullParts = typeParts.filter(t => t !== 'null' && t !== 'undefined');
    if (nonNullParts.length === 0) return false;

    return nonNullParts.every(part => this.matchesIgnorePatternCompiled(part, compiled.allPatterns));
  }

  /**
   * Check if a single type (not a union) should be ignored.
   * Checks both the type name and its base classes.
   * Uses Set-based cycle detection to handle recursive type hierarchies.
   * @param patterns Pre-compiled RegExp patterns
   * @param visited Set of type IDs already visited (for cycle detection)
   */
  private isIgnoredSingleType(
    type: ts.Type,
    patterns: RegExp[],
    typeChecker?: ts.TypeChecker,
    visited: Set<number> = new Set()
  ): boolean {
    // Use type ID for cycle detection (more precise than depth counter)
    const typeId = (type as { id?: number }).id;
    if (typeId !== undefined) {
      if (visited.has(typeId)) {
        if (process.env.DEBUG) {
          console.log(`TYPICAL: Cycle detected for type "${type.symbol?.name || '?'}" (id: ${typeId}), skipping`);
        }
        return false; // Already visited this type, not ignored
      }
      visited.add(typeId);
    }

    const typeName = type.symbol?.name || '';

    if (process.env.DEBUG) {
      console.log(`TYPICAL: isIgnoredSingleType checking type: "${typeName}" (visited: ${visited.size})`);
    }

    // Check direct name match
    if (this.matchesIgnorePatternCompiled(typeName, patterns)) {
      if (process.env.DEBUG) {
        console.log(`TYPICAL: Type "${typeName}" matched ignore pattern directly`);
      }
      return true;
    }

    // Check base classes (for classes extending DOM types like HTMLElement)
    // This works for class types that have getBaseTypes available
    const baseTypes = type.getBaseTypes?.() ?? [];
    if (process.env.DEBUG && baseTypes.length > 0) {
      console.log(`TYPICAL: Type "${typeName}" has ${baseTypes.length} base types: ${baseTypes.map(t => t.symbol?.name || '?').join(', ')}`);
    }
    for (const baseType of baseTypes) {
      if (this.isIgnoredSingleType(baseType, patterns, typeChecker, visited)) {
        if (process.env.DEBUG) {
          console.log(`TYPICAL: Type "${typeName}" ignored because base type "${baseType.symbol?.name}" is ignored`);
        }
        return true;
      }
    }

    // Also check the declared type's symbol for heritage clauses (alternative approach)
    // This handles cases where getBaseTypes doesn't return what we expect
    if (type.symbol?.declarations) {
      for (const decl of type.symbol.declarations) {
        if (this.ts.isClassDeclaration(decl) && decl.heritageClauses) {
          for (const heritage of decl.heritageClauses) {
            if (heritage.token === this.ts.SyntaxKind.ExtendsKeyword) {
              for (const heritageType of heritage.types) {
                const baseTypeName = heritageType.expression.getText();
                if (process.env.DEBUG) {
                  console.log(`TYPICAL: Type "${typeName}" extends "${baseTypeName}" (from heritage clause)`);
                }
                if (this.matchesIgnorePatternCompiled(baseTypeName, patterns)) {
                  if (process.env.DEBUG) {
                    console.log(`TYPICAL: Type "${typeName}" ignored because it extends "${baseTypeName}"`);
                  }
                  return true;
                }
                // Recursively check the heritage type
                if (typeChecker) {
                  const heritageTypeObj = typeChecker.getTypeAtLocation(heritageType);
                  if (this.isIgnoredSingleType(heritageTypeObj, patterns, typeChecker, visited)) {
                    return true;
                  }

                  // For mixin patterns like `extends VueWatcher(BaseElement)`, the expression is a CallExpression.
                  // We need to check the return type of the mixin function AND the arguments passed to it.
                  if (this.ts.isCallExpression(heritageType.expression)) {
                    // Check arguments to the mixin (e.g., BaseElement in VueWatcher(BaseElement))
                    for (const arg of heritageType.expression.arguments) {
                      const argType = typeChecker.getTypeAtLocation(arg);
                      if (process.env.DEBUG) {
                        console.log(`TYPICAL: Type "${typeName}" mixin arg: "${argType.symbol?.name}" (from call expression)`);
                      }
                      if (this.isIgnoredSingleType(argType, patterns, typeChecker, visited)) {
                        if (process.env.DEBUG) {
                          console.log(`TYPICAL: Type "${typeName}" ignored because mixin argument "${argType.symbol?.name}" is ignored`);
                        }
                        return true;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if a single type name matches any pre-compiled ignore pattern.
   * @param patterns Pre-compiled RegExp patterns
   */
  private matchesIgnorePatternCompiled(typeName: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(typeName));
  }

  /**
   * Find untransformed typia calls in the output code.
   * These indicate types that typia could not process.
   */
  private findUntransformedTypiaCalls(code: string): Array<{ method: string; type: string }> {
    const results: Array<{ method: string; type: string }> = [];

    // Match patterns like: typia.createAssert<Type>() or typia.json.createAssertParse<Type>()
    // The type argument can contain nested generics like React.FormEvent<HTMLElement>
    const patterns = [
      /typia\.createAssert<([^>]+(?:<[^>]*>)?)>\s*\(\)/g,
      /typia\.json\.createAssertParse<([^>]+(?:<[^>]*>)?)>\s*\(\)/g,
      /typia\.json\.createStringify<([^>]+(?:<[^>]*>)?)>\s*\(\)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        const methodMatch = match[0].match(/typia\.([\w.]+)</);
        results.push({
          method: methodMatch ? methodMatch[1] : 'unknown',
          type: match[1]
        });
      }
    }

    return results;
  }

  /**
   * Infer type information from a JSON.stringify argument for creating a reusable stringifier.
   */
  private inferStringifyType(
    arg: ts.Expression,
    typeChecker: ts.TypeChecker,
    ctx: TransformContext
  ): { typeText: string; typeNode: ts.TypeNode } {
    const ts = this.ts;

    // Type assertion: use the asserted type directly
    if (ts.isAsExpression(arg)) {
      const typeNode = arg.type;
      const typeKey = this.getTypeKey(typeNode, typeChecker);
      return { typeText: typeKey, typeNode };
    }

    // Object literal: infer type from type checker
    if (ts.isObjectLiteralExpression(arg)) {
      const objectType = typeChecker.getTypeAtLocation(arg);
      const typeNode = typeChecker.typeToTypeNode(objectType, arg, TYPE_NODE_FLAGS);
      if (!typeNode) {
        throw new Error('unknown type node for object literal: ' + arg.getText());
      }
      const typeKey = this.getTypeKey(typeNode, typeChecker, objectType);
      return { typeText: typeKey, typeNode };
    }

    // Other expressions: infer from type checker
    const argType = typeChecker.getTypeAtLocation(arg);
    const typeNode = typeChecker.typeToTypeNode(argType, arg, TYPE_NODE_FLAGS);
    if (typeNode) {
      const typeKey = this.getTypeKey(typeNode, typeChecker, argType);
      return { typeText: typeKey, typeNode };
    }

    // Fallback to unknown
    return {
      typeText: "unknown",
      typeNode: ctx.factory.createKeywordTypeNode(ctx.ts.SyntaxKind.UnknownKeyword),
    };
  }

  // ============================================
  // Flow Analysis Helpers
  // ============================================

  /**
   * Gets the root identifier from an expression.
   * e.g., `user.address.city` -> "user"
   */
  private getRootIdentifier(expr: ts.Expression): string | undefined {
    if (this.ts.isIdentifier(expr)) {
      return expr.text;
    }
    if (this.ts.isPropertyAccessExpression(expr)) {
      return this.getRootIdentifier(expr.expression);
    }
    return undefined;
  }

  /**
   * Check if a validated variable has been tainted (mutated) in the function body.
   * A variable is tainted if it's reassigned, has properties modified, is passed
   * to a function, has methods called on it, or if an await occurs.
   */
  private isTainted(varName: string, body: ts.Block): boolean {
    let tainted = false;
    const ts = this.ts;

    // Collect aliases (variables that reference properties of varName)
    // e.g., const addr = user.address; -> addr is an alias
    const aliases = new Set<string>([varName]);

    const collectAliases = (node: ts.Node): void => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer) {
            const initRoot = this.getRootIdentifier(decl.initializer);
            if (initRoot && aliases.has(initRoot)) {
              aliases.add(decl.name.text);
            }
          }
        }
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(body);

    // Helper to check if any alias is involved
    const involvesTrackedVar = (expr: ts.Expression): boolean => {
      const root = this.getRootIdentifier(expr);
      return root !== undefined && aliases.has(root);
    };

    const checkTainting = (node: ts.Node): void => {
      if (tainted) return;

      // Reassignment: trackedVar = ...
      if (ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left) &&
          aliases.has(node.left.text)) {
        tainted = true;
        return;
      }

      // Property assignment: trackedVar.x = ... or alias.x = ...
      if (ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) &&
          involvesTrackedVar(node.left)) {
        tainted = true;
        return;
      }

      // Element assignment: trackedVar[x] = ... or alias[x] = ...
      if (ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isElementAccessExpression(node.left) &&
          involvesTrackedVar(node.left.expression)) {
        tainted = true;
        return;
      }

      // Passed as argument to a function: fn(trackedVar) or fn(alias)
      if (ts.isCallExpression(node)) {
        for (const arg of node.arguments) {
          let hasTrackedRef = false;
          const checkRef = (n: ts.Node): void => {
            if (ts.isIdentifier(n) && aliases.has(n.text)) {
              hasTrackedRef = true;
            }
            ts.forEachChild(n, checkRef);
          };
          checkRef(arg);
          if (hasTrackedRef) {
            tainted = true;
            return;
          }
        }
      }

      // Method call on the variable: trackedVar.method() or alias.method()
      if (ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          involvesTrackedVar(node.expression.expression)) {
        tainted = true;
        return;
      }

      // Await expression (async boundary - external code could run)
      if (ts.isAwaitExpression(node)) {
        tainted = true;
        return;
      }

      ts.forEachChild(node, checkTainting);
    };

    checkTainting(body);
    return tainted;
  }

  private addTypiaImport(
    sourceFile: ts.SourceFile,
    ctx: TransformContext
  ): ts.SourceFile {
    const { factory } = ctx;

    const existingImports = sourceFile.statements.filter(
      ctx.ts.isImportDeclaration
    );
    const hasTypiaImport = existingImports.some(
      (imp) =>
        imp.moduleSpecifier &&
        ctx.ts.isStringLiteral(imp.moduleSpecifier) &&
        imp.moduleSpecifier.text === "typia"
    );

    if (!hasTypiaImport) {
      const typiaImport = factory.createImportDeclaration(
        undefined,
        factory.createImportClause(
          false,
          factory.createIdentifier("typia"),
          undefined
        ),
        factory.createStringLiteral("typia")
      );

      const newSourceFile = factory.updateSourceFile(
        sourceFile,
        factory.createNodeArray([typiaImport, ...sourceFile.statements])
      );

      return newSourceFile;
    }

    return sourceFile;
  }

  /**
   * Gets type text for use as a validator map key.
   * Uses getText() to preserve local aliases (e.g., "User1" vs "User2"),
   * but falls back to typeToString() for synthesized nodes without source positions.
   *
   * @param typeNode The TypeNode to get a key for
   * @param typeChecker The TypeChecker to use
   * @param typeObj Optional Type object - use this for synthesized nodes since
   *                getTypeFromTypeNode doesn't work correctly on them
   */
  private getTypeKey(typeNode: ts.TypeNode, typeChecker: ts.TypeChecker, typeObj?: ts.Type): string {
    // Check if node has a real position (not synthesized)
    if (typeNode.pos >= 0 && typeNode.end > typeNode.pos) {
      try {
        const text = typeNode.getText();
        // Check for truncation patterns in source text (shouldn't happen but be safe)
        if (!text.includes('...') || !text.match(/\.\.\.\d+\s+more/)) {
          return text;
        }
      } catch {
        // Fall through to typeToString
      }
    }
    // Fallback for synthesized nodes - use the provided Type object if available,
    // otherwise try to get it from the node (which may not work correctly)
    const type = typeObj ?? typeChecker.getTypeFromTypeNode(typeNode);
    const typeString = typeChecker.typeToString(type, undefined, this.ts.TypeFormatFlags.NoTruncation);

    // TypeScript may still truncate very large types even with NoTruncation flag.
    // Detect truncation patterns like "...19 more..." and use a hash-based key instead.
    if (typeString.match(/\.\.\.\d+\s+more/)) {
      const hash = this.hashString(typeString);
      return `__complex_type_${hash}`;
    }

    return typeString;
  }

  /**
   * Simple string hash for creating unique identifiers from type strings.
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Format typia's error message into a cleaner list format.
   * Typia outputs verbose messages like:
   *   "unsupported type detected\n\n- Window.ondevicemotion: unknown\n  - nonsensible intersection\n\n- Window.ondeviceorientation..."
   * We want to extract just the problematic types and their issues.
   */
  private formatTypiaError(message: string): string {
    const lines = message.split('\n');
    const firstLine = lines[0]; // e.g., "unsupported type detected"

    // Parse the error entries - each starts with "- " at the beginning of a line
    const issues: { type: string; reasons: string[] }[] = [];
    let currentIssue: { type: string; reasons: string[] } | null = null;

    for (const line of lines.slice(1)) {
      if (line.startsWith('- ')) {
        // New type entry
        if (currentIssue) {
          issues.push(currentIssue);
        }
        currentIssue = { type: line.slice(2), reasons: [] };
      } else if (line.startsWith('  - ') && currentIssue) {
        // Reason for current type
        currentIssue.reasons.push(line.slice(4));
      }
    }
    if (currentIssue) {
      issues.push(currentIssue);
    }

    if (issues.length === 0) {
      return `  ${firstLine}`;
    }

    // Limit to 5 issues, show count of remaining
    const maxIssues = 5;
    const displayIssues = issues.slice(0, maxIssues);
    const remainingCount = issues.length - maxIssues;

    const formatted = displayIssues.map(issue => {
      const reasons = issue.reasons.map(r => `      - ${r}`).join('\n');
      return `    - ${issue.type}\n${reasons}`;
    }).join('\n');

    const suffix = remainingCount > 0 ? `\n    (and ${remainingCount} more errors)` : '';

    return `  ${firstLine}\n${formatted}${suffix}`;
  }


  /**
   * Creates a readable name suffix from a type string.
   * For simple identifiers like "User" or "string", returns the name directly.
   * For complex types, returns a numeric index.
   */
  private getTypeNameSuffix(typeText: string, existingNames: Set<string>, fallbackIndex: number): string {
    // Complex types from getTypeKey() - use numeric index
    if (typeText.startsWith('__complex_type_')) {
      return String(fallbackIndex);
    }

    // Check if it's a simple identifier (letters, numbers, underscore, starting with letter/underscore)
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(typeText)) {
      // It's a simple type name like "User", "string", "MyType"
      let name = typeText;
      // Handle collisions by appending a number
      if (existingNames.has(name)) {
        let i = 2;
        while (existingNames.has(`${typeText}${i}`)) {
          i++;
        }
        name = `${typeText}${i}`;
      }
      return name;
    }
    // Complex type - use numeric index
    return String(fallbackIndex);
  }

  /**
   * Generic method to get or create a typed function (validator, stringifier, or parser).
   */
  private getOrCreateTypedFunction(
    kind: 'assert' | 'stringify' | 'parse',
    typeText: string,
    typeNode: ts.TypeNode
  ): string {
    const maps = {
      assert: this.typeValidators,
      stringify: this.typeStringifiers,
      parse: this.typeParsers,
    };
    const prefixes = {
      assert: '__typical_assert_',
      stringify: '__typical_stringify_',
      parse: '__typical_parse_',
    };

    const map = maps[kind];
    const prefix = prefixes[kind];

    if (map.has(typeText)) {
      return map.get(typeText)!.name;
    }

    const existingSuffixes = [...map.values()].map(v => v.name.slice(prefix.length));
    const existingNames = new Set(existingSuffixes);
    const numericCount = existingSuffixes.filter(s => /^\d+$/.test(s)).length;
    const suffix = this.getTypeNameSuffix(typeText, existingNames, numericCount);
    const name = `${prefix}${suffix}`;
    map.set(typeText, { name, typeNode });
    return name;
  }

  private getOrCreateValidator(typeText: string, typeNode: ts.TypeNode): string {
    return this.getOrCreateTypedFunction('assert', typeText, typeNode);
  }

  private getOrCreateStringifier(typeText: string, typeNode: ts.TypeNode): string {
    return this.getOrCreateTypedFunction('stringify', typeText, typeNode);
  }

  private getOrCreateParser(typeText: string, typeNode: ts.TypeNode): string {
    return this.getOrCreateTypedFunction('parse', typeText, typeNode);
  }

  /**
   * Creates a nested property access expression from an array of identifiers.
   * e.g., ['typia', 'json', 'createStringify'] -> typia.json.createStringify
   */
  private createPropertyAccessChain(factory: ts.NodeFactory, parts: string[]): ts.Expression {
    let expr: ts.Expression = factory.createIdentifier(parts[0]);
    for (let i = 1; i < parts.length; i++) {
      expr = factory.createPropertyAccessExpression(expr, parts[i]);
    }
    return expr;
  }

  private createValidatorStatements(ctx: TransformContext): ts.Statement[] {
    const { factory } = ctx;
    const statements: ts.Statement[] = [];

    const configs: Array<{
      map: Map<string, { name: string; typeNode: ts.TypeNode }>;
      methodPath: string[];
    }> = [
      { map: this.typeValidators, methodPath: ['typia', 'createAssert'] },
      { map: this.typeStringifiers, methodPath: ['typia', 'json', 'createStringify'] },
      { map: this.typeParsers, methodPath: ['typia', 'json', 'createAssertParse'] },
    ];

    for (const { map, methodPath } of configs) {
      for (const [, { name, typeNode }] of map) {
        const createCall = factory.createCallExpression(
          this.createPropertyAccessChain(factory, methodPath),
          [typeNode],
          []
        );

        const declaration = factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [factory.createVariableDeclaration(name, undefined, undefined, createCall)],
            ctx.ts.NodeFlags.Const
          )
        );
        statements.push(declaration);
      }
    }

    return statements;
  }
}
