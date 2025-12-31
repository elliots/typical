import ts from "typescript";
import fs from "fs";
import path from "path";
import { loadConfig, TypicalConfig } from "./config.js";
import { shouldTransformFile } from "./file-filter.js";

import { transform as typiaTransform } from "typia/lib/transform.js";
import { setupTsProgram } from "./setup.js";

export interface TransformContext {
  ts: typeof ts;
  factory: ts.NodeFactory;
  context: ts.TransformationContext;
}

export class TypicalTransformer {
  public config: TypicalConfig;
  private program: ts.Program;
  private ts: typeof ts;
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
    mode: "basic" | "typia" | "js"
  ): string {
    if (typeof sourceFile === "string") {
      const file = this.program.getSourceFile(sourceFile);
      if (!file) {
        throw new Error(`Source file not found in program: ${sourceFile}`);
      }
      sourceFile = file;
    }

    const transformer = this.getTransformer(mode !== "basic");
    const result = this.ts.transform(sourceFile, [transformer]);
    const printer = this.ts.createPrinter();
    const transformedCode = printer.printFile(result.transformed[0]);
    result.dispose();

    if (mode === "typia" || mode === 'basic') {
      return transformedCode;
    }

    const compileResult = ts.transpileModule(transformedCode, {
      compilerOptions: this.program.getCompilerOptions(),
    });

    return compileResult.outputText;
  }

  public getTransformer(
    withTypia: boolean
  ): ts.TransformerFactory<ts.SourceFile> {
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
          return sourceFile; // Return unchanged for excluded files
        }

        if (process.env.DEBUG) {
          console.log("TYPICAL: processing ", sourceFile.fileName);
        }
        // First apply our transformation
        let transformedSourceFile = this.transformSourceFile(
          sourceFile,
          transformContext,
          typeChecker
        );

        if (!withTypia) {
          return transformedSourceFile;
        }

        // Apply typia transformation
        const printer = this.ts.createPrinter();
        const transformedCode = printer.printFile(transformedSourceFile);

        if (process.env.DEBUG) {
          console.log("TYPICAL: Before typia transform (first 500 chars):", transformedCode.substring(0, 500));
        }

        // Write intermediate file if debug option is enabled
        if (this.config.debug?.writeIntermediateFiles) {
          const compilerOptions = this.program.getCompilerOptions();
          const outDir = compilerOptions.outDir || ".";
          const rootDir = compilerOptions.rootDir || ".";

          // Calculate the relative path from rootDir
          const relativePath = path.relative(rootDir, sourceFile.fileName);
          // Change extension to .typical.ts to indicate intermediate state
          const intermediateFileName = relativePath.replace(/\.tsx?$/, ".typical.ts");
          const intermediateFilePath = path.join(outDir, intermediateFileName);

          // Ensure directory exists
          const dir = path.dirname(intermediateFilePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          fs.writeFileSync(intermediateFilePath, transformedCode);
          console.log(`TYPICAL: Wrote intermediate file: ${intermediateFilePath}`);
        }

        if (transformedCode.includes("typia.")) {
          try {
            // Create a new source file from our transformed code
            const newSourceFile = this.ts.createSourceFile(
              sourceFile.fileName,
              transformedCode,
              sourceFile.languageVersion,
              true
            );

            // Create a new program with the transformed source file so typia can resolve types
            const compilerOptions = this.program.getCompilerOptions();
            const originalSourceFiles = new Map<string, ts.SourceFile>();
            for (const sf of this.program.getSourceFiles()) {
              originalSourceFiles.set(sf.fileName, sf);
            }
            // Replace the original source file with our transformed one
            originalSourceFiles.set(sourceFile.fileName, newSourceFile);

            const customHost: ts.CompilerHost = {
              getSourceFile: (fileName, languageVersion) => {
                if (originalSourceFiles.has(fileName)) {
                  return originalSourceFiles.get(fileName);
                }
                return this.ts.createSourceFile(
                  fileName,
                  this.ts.sys.readFile(fileName) || "",
                  languageVersion,
                  true
                );
              },
              getDefaultLibFileName: (opts) => this.ts.getDefaultLibFilePath(opts),
              writeFile: () => {},
              getCurrentDirectory: () => this.ts.sys.getCurrentDirectory(),
              getCanonicalFileName: (fileName) =>
                this.ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
              useCaseSensitiveFileNames: () => this.ts.sys.useCaseSensitiveFileNames,
              getNewLine: () => this.ts.sys.newLine,
              fileExists: (fileName) => originalSourceFiles.has(fileName) || this.ts.sys.fileExists(fileName),
              readFile: (fileName) => this.ts.sys.readFile(fileName),
            };

            const newProgram = this.ts.createProgram(
              Array.from(originalSourceFiles.keys()),
              compilerOptions,
              customHost
            );

            // Get the bound source file from the new program (has proper symbol tables)
            const boundSourceFile = newProgram.getSourceFile(sourceFile.fileName);
            if (!boundSourceFile) {
              throw new Error(`Failed to get bound source file: ${sourceFile.fileName}`);
            }

            // Create typia transformer with the NEW program that has our transformed source
            const typiaTransformerFactory = typiaTransform(
              newProgram,
              {},
              {
                addDiagnostic(diag: ts.Diagnostic) {
                  if (process.env.DEBUG) {
                    console.warn("Typia diagnostic:", diag);
                  }
                  return 0;
                },
              }
            );

            // Apply typia's transformer to the bound source file
            const typiaNodeTransformer = typiaTransformerFactory(context);
            const typiaTransformed = typiaNodeTransformer(boundSourceFile);

            if (process.env.DEBUG) {
              const afterTypia = printer.printFile(typiaTransformed);
              console.log("TYPICAL: After typia transform (first 500 chars):", afterTypia.substring(0, 500));
            }

            // Return the typia-transformed source file.
            // We need to recreate imports as synthetic nodes to prevent import elision,
            // since the imports come from a different program context.
            // Skip type-only imports as they shouldn't appear in JS output.
            const syntheticStatements: ts.Statement[] = [];
            for (const stmt of typiaTransformed.statements) {
              if (this.ts.isImportDeclaration(stmt)) {
                // Skip type-only imports (import type X from "y")
                if (stmt.importClause?.isTypeOnly) {
                  continue;
                }
                syntheticStatements.push(this.recreateImportDeclaration(stmt, factory));
              } else {
                syntheticStatements.push(stmt);
              }
            }

            // Update the source file with synthetic imports
            transformedSourceFile = factory.updateSourceFile(
              typiaTransformed,
              syntheticStatements,
              typiaTransformed.isDeclarationFile,
              typiaTransformed.referencedFiles,
              typiaTransformed.typeReferenceDirectives,
              typiaTransformed.hasNoDefaultLib,
              typiaTransformed.libReferenceDirectives
            );
          } catch (error) {
            console.warn("Failed to apply typia transformer:", sourceFile.fileName, error);
          }
        }

        return transformedSourceFile;
      };
    };
  }

  /**
   * Re-create an import declaration as a fully synthetic node.
   * This prevents TypeScript from trying to look up symbol bindings
   * and eliding the import as "unused".
   */
  private recreateImportDeclaration(
    importDecl: ts.ImportDeclaration,
    factory: ts.NodeFactory
  ): ts.ImportDeclaration {
    let importClause: ts.ImportClause | undefined;

    if (importDecl.importClause) {
      const clause = importDecl.importClause;
      let namedBindings: ts.NamedImportBindings | undefined;

      if (clause.namedBindings) {
        if (this.ts.isNamespaceImport(clause.namedBindings)) {
          // import * as foo from "bar"
          namedBindings = factory.createNamespaceImport(
            factory.createIdentifier(clause.namedBindings.name.text)
          );
        } else if (this.ts.isNamedImports(clause.namedBindings)) {
          // import { foo, bar } from "baz"
          const elements = clause.namedBindings.elements.map((el) =>
            factory.createImportSpecifier(
              el.isTypeOnly,
              el.propertyName ? factory.createIdentifier(el.propertyName.text) : undefined,
              factory.createIdentifier(el.name.text)
            )
          );
          namedBindings = factory.createNamedImports(elements);
        }
      }

      importClause = factory.createImportClause(
        clause.isTypeOnly,
        clause.name ? factory.createIdentifier(clause.name.text) : undefined,
        namedBindings
      );
    }

    const moduleSpecifier = this.ts.isStringLiteral(importDecl.moduleSpecifier)
      ? factory.createStringLiteral(importDecl.moduleSpecifier.text)
      : importDecl.moduleSpecifier;

    return factory.createImportDeclaration(
      importDecl.modifiers,
      importClause,
      moduleSpecifier,
      importDecl.attributes
    );
  }

  /**
   * Transform a single source file with TypeScript AST
   */
  private transformSourceFile(
    sourceFile: ts.SourceFile,
    ctx: TransformContext,
    typeChecker: ts.TypeChecker
  ): ts.SourceFile {
    const { ts } = ctx;

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

    let needsTypiaImport = false;

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
          needsTypiaImport = true;

          if (propertyAccess.name.text === "stringify") {
            // For stringify, we need to infer the type from the argument
            // First check if the argument type is 'any' - if so, skip transformation
            if (node.arguments.length > 0) {
              const arg = node.arguments[0];
              const argType = typeChecker.getTypeAtLocation(arg);
              if (this.isAnyOrUnknownTypeFlags(argType)) {
                return node; // Don't transform JSON.stringify for any/unknown types
              }
            }

            if (this.config.reusableValidators) {
              // Infer type from argument
              const arg = node.arguments[0];
              const { typeText, typeNode } = this.inferStringifyType(arg, typeChecker, ctx);

              const stringifierName = this.getOrCreateStringifier(typeText, typeNode);
              return ctx.factory.createCallExpression(
                ctx.factory.createIdentifier(stringifierName),
                undefined,
                node.arguments
              );
            } else {
              // Use inline typia.json.stringify
              return ctx.factory.updateCallExpression(
                node,
                ctx.factory.createPropertyAccessExpression(
                  ctx.factory.createPropertyAccessExpression(
                    ctx.factory.createIdentifier("typia"),
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
              return node;
            }

            // If we can't determine the target type and there's no explicit type argument,
            // don't transform - we can't validate against an unknown type
            if (!targetType && !node.typeArguments) {
              return node;
            }

            if (this.config.reusableValidators && targetType) {
              // Use reusable parser - use typeNode text to preserve local aliases
              const typeText = this.getTypeKey(targetType, typeChecker);
              const parserName = this.getOrCreateParser(typeText, targetType);

              const newCall = ctx.factory.createCallExpression(
                ctx.factory.createIdentifier(parserName),
                undefined,
                node.arguments
              );

              return newCall;
            } else {
              // Use inline typia.json.assertParse
              const typeArguments = targetType
                ? [targetType]
                : node.typeArguments;

              return ctx.factory.updateCallExpression(
                node,
                ctx.factory.createPropertyAccessExpression(
                  ctx.factory.createPropertyAccessExpression(
                    ctx.factory.createIdentifier("typia"),
                    "json"
                  ),
                  "assertParse"
                ),
                typeArguments,
                node.arguments
              );
            }
          }
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

        needsTypiaImport = true;

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
        needsTypiaImport = true;
        return transformFunction(node);
      }

      // Transform arrow functions
      if (ts.isArrowFunction(node)) {
        needsTypiaImport = true;
        return transformFunction(node);
      }

      // Transform method declarations
      if (ts.isMethodDeclaration(node)) {
        needsTypiaImport = true;
        return transformFunction(node);
      }

      return ctx.ts.visitEachChild(node, visit, ctx.context);
    };

    const transformFunction = (
      func: ts.FunctionDeclaration | ts.ArrowFunction | ts.MethodDeclaration
    ): ts.Node => {
      const body = func.body;

      // For arrow functions with expression bodies (not blocks),
      // still visit the expression to transform JSON calls etc.
      if (body && !ts.isBlock(body) && ts.isArrowFunction(func)) {
        const visitedBody = ctx.ts.visitNode(body, visit) as ts.Expression;
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

      // Add parameter validation
      const validationStatements: ts.Statement[] = [];

      func.parameters.forEach((param) => {
        if (param.type) {
          // Skip 'any' and 'unknown' types - no point validating them
          if (this.isAnyOrUnknownType(param.type)) {
            return;
          }

          const paramName = ts.isIdentifier(param.name)
            ? param.name.text
            : "param";
          const paramIdentifier = ctx.factory.createIdentifier(paramName);

          // Track this parameter as validated for flow analysis
          const paramType = typeChecker.getTypeFromTypeNode(param.type);
          validatedVariables.set(paramName, paramType);

          if (this.config.reusableValidators) {
            // Use reusable validators - use typeNode text to preserve local aliases
            const typeText = this.getTypeKey(param.type, typeChecker);
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
              ts.NodeBuilderFlags.InTypeAlias
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

      // For async functions, unwrap Promise<T> to get T
      // The return statement in an async function returns T, not Promise<T>
      if (isAsync && returnType && returnTypeForString) {
        const promiseSymbol = returnTypeForString.getSymbol();
        if (promiseSymbol && promiseSymbol.getName() === "Promise") {
          // Get the type argument of Promise<T>
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
                ts.NodeBuilderFlags.InTypeAlias
              );
            }
          }
        }
      }

      // Skip 'any' and 'unknown' return types - no point validating them
      if (returnType && returnTypeForString && !this.isAnyOrUnknownType(returnType)) {
        const returnTransformer = (node: ts.Node): ts.Node => {
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

    let transformedSourceFile = ctx.ts.visitNode(
      sourceFile,
      visit
    ) as ts.SourceFile;

    // Add typia import and validator statements if needed
    if (needsTypiaImport) {
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
   * Check if a TypeNode represents any or unknown type.
   * These types are intentional escape hatches and shouldn't be validated.
   */
  private isAnyOrUnknownType(typeNode: ts.TypeNode): boolean {
    return typeNode.kind === this.ts.SyntaxKind.AnyKeyword ||
           typeNode.kind === this.ts.SyntaxKind.UnknownKeyword;
  }

  /**
   * Check if a Type has any or unknown flags.
   */
  private isAnyOrUnknownTypeFlags(type: ts.Type): boolean {
    return (type.flags & this.ts.TypeFlags.Any) !== 0 ||
           (type.flags & this.ts.TypeFlags.Unknown) !== 0;
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
      const typeString = typeChecker.typeToString(typeChecker.getTypeFromTypeNode(typeNode));
      return {
        typeText: `Asserted_${typeString.replace(/[^a-zA-Z0-9_]/g, "_")}`,
        typeNode,
      };
    }

    // Object literal: use property names for the key
    if (ts.isObjectLiteralExpression(arg)) {
      const objectType = typeChecker.getTypeAtLocation(arg);
      const typeNode = typeChecker.typeToTypeNode(objectType, arg, ts.NodeBuilderFlags.InTypeAlias);
      if (!typeNode) {
        throw new Error('unknown type node for object literal: ' + arg.getText());
      }
      const propNames = arg.properties
        .map((prop) => {
          if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text;
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) return prop.name.text;
          return "unknown";
        })
        .sort()
        .join("_");
      return { typeText: `ObjectLiteral_${propNames}`, typeNode };
    }

    // Other expressions: infer from type checker
    const argType = typeChecker.getTypeAtLocation(arg);
    const typeNode = typeChecker.typeToTypeNode(argType, arg, ts.NodeBuilderFlags.InTypeAlias);
    if (typeNode) {
      const typeString = typeChecker.typeToString(argType);
      return {
        typeText: `Expression_${typeString.replace(/[^a-zA-Z0-9_]/g, "_")}`,
        typeNode,
      };
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
        return typeNode.getText();
      } catch {
        // Fall through to typeToString
      }
    }
    // Fallback for synthesized nodes - use the provided Type object if available,
    // otherwise try to get it from the node (which may not work correctly)
    const type = typeObj ?? typeChecker.getTypeFromTypeNode(typeNode);
    return typeChecker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  }

  /**
   * Creates a readable name suffix from a type string.
   * For simple identifiers like "User" or "string", returns the name directly.
   * For complex types, returns a numeric index.
   */
  private getTypeNameSuffix(typeText: string, existingNames: Set<string>, fallbackIndex: number): string {
    // Strip known prefixes that wrap the actual type name
    let normalizedTypeText = typeText;
    if (typeText.startsWith('Expression_')) {
      normalizedTypeText = typeText.slice('Expression_'.length);
    } else if (typeText.startsWith('ObjectLiteral_')) {
      // Object literals use property names, fall back to numeric
      return String(fallbackIndex);
    }

    // Check if it's a simple identifier (letters, numbers, underscore, starting with letter/underscore)
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(normalizedTypeText)) {
      // It's a simple type name like "User", "string", "MyType"
      let name = normalizedTypeText;
      // Handle collisions by appending a number
      if (existingNames.has(name)) {
        let i = 2;
        while (existingNames.has(`${normalizedTypeText}${i}`)) {
          i++;
        }
        name = `${normalizedTypeText}${i}`;
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
