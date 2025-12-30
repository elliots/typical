import ts from "typescript";
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

    // Check if this file should be transformed
    if (!this.shouldTransformFile(sourceFile.fileName)) {
      return sourceFile; // Return unchanged for excluded files
    }

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
              const typeFlags = argType.flags;
              // Skip if type is any (1) or unknown (2)
              if (typeFlags & ts.TypeFlags.Any || typeFlags & ts.TypeFlags.Unknown) {
                return node; // Don't transform JSON.stringify for any/unknown types
              }
            }

            if (this.config.reusableValidators) {
              // For JSON.stringify, try to infer the type from the argument
              let typeText = "unknown";
              let typeNodeForCache: ts.TypeNode | undefined;

              if (node.arguments.length > 0) {
                const arg = node.arguments[0];

                // Check if it's a type assertion
                if (ts.isAsExpression(arg)) {
                  // For type assertions, use the asserted type directly
                  const assertedType = arg.type;
                  const objectType =
                    typeChecker.getTypeFromTypeNode(assertedType);

                  const typeNode = assertedType;

                  if (typeNode) {
                    const typeString = typeChecker.typeToString(objectType);
                    typeText = `Asserted_${typeString.replace(
                      /[^a-zA-Z0-9_]/g,
                      "_"
                    )}`;
                    typeNodeForCache = typeNode;
                  } else {
                    typeText = "unknown";
                    typeNodeForCache = ctx.factory.createKeywordTypeNode(
                      ctx.ts.SyntaxKind.UnknownKeyword
                    );
                  }
                } else if (ts.isObjectLiteralExpression(arg)) {
                  // For object literals, use the type checker to get the actual type
                  const objectType = typeChecker.getTypeAtLocation(arg);

                  const typeNode = typeChecker.typeToTypeNode(
                    objectType,
                    arg,
                    ts.NodeBuilderFlags.InTypeAlias
                  );

                  if (typeNode) {
                    const propNames = arg.properties
                      .map((prop) => {
                        if (ts.isShorthandPropertyAssignment(prop)) {
                          return prop.name.text;
                        } else if (
                          ts.isPropertyAssignment(prop) &&
                          ts.isIdentifier(prop.name)
                        ) {
                          return prop.name.text;
                        }
                        return "unknown";
                      })
                      .sort()
                      .join("_");

                    typeText = `ObjectLiteral_${propNames}`;
                    typeNodeForCache = typeNode;
                  } else {
                    // typeText = "unknown";
                    // typeNodeForCache = ctx.factory.createKeywordTypeNode(
                    //   ctx.ts.SyntaxKind.UnknownKeyword
                    // );
                    throw new Error('unknown type node for object literal: ' + arg.getText());
                  }
                } else {
                  // For other expressions, try to get the type from the type checker
                  const argType = typeChecker.getTypeAtLocation(arg);

                  const typeNode = typeChecker.typeToTypeNode(
                    argType,
                    arg,
                    ts.NodeBuilderFlags.InTypeAlias
                  );
                  if (typeNode) {
                    const typeString = typeChecker.typeToString(argType);
                    typeText = `Expression_${typeString.replace(
                      /[^a-zA-Z0-9_]/g,
                      "_"
                    )}`;
                    typeNodeForCache = typeNode;
                  } else {
                    typeText = "unknown";
                    typeNodeForCache = ctx.factory.createKeywordTypeNode(
                      ctx.ts.SyntaxKind.UnknownKeyword
                    )
                  }
                }
              }

              const stringifierName = this.getOrCreateStringifier(
                typeText,
                typeNodeForCache!
              );

              const newCall = ctx.factory.createCallExpression(
                ctx.factory.createIdentifier(stringifierName),
                undefined,
                node.arguments
              );

              return newCall;
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

            // Skip transformation if target type is any or unknown
            const isAnyOrUnknown = targetType && (
              targetType.kind === ts.SyntaxKind.AnyKeyword ||
              targetType.kind === ts.SyntaxKind.UnknownKeyword
            );

            if (isAnyOrUnknown) {
              // Don't transform JSON.parse for any/unknown types
              return node;
            }

            // If we can't determine the target type and there's no explicit type argument,
            // don't transform - we can't validate against an unknown type
            if (!targetType && !node.typeArguments) {
              return node;
            }

            if (this.config.reusableValidators && targetType) {
              // Use reusable parser - use typeToString
              const targetTypeObj = typeChecker.getTypeFromTypeNode(targetType);
              const typeText = typeChecker.typeToString(targetTypeObj);
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

    // Helper functions for flow analysis
    const getRootIdentifier = (expr: ts.Expression): string | undefined => {
      if (ts.isIdentifier(expr)) {
        return expr.text;
      }
      if (ts.isPropertyAccessExpression(expr)) {
        return getRootIdentifier(expr.expression);
      }
      return undefined;
    };

    const containsReference = (expr: ts.Expression, name: string): boolean => {
      if (ts.isIdentifier(expr) && expr.text === name) {
        return true;
      }
      if (ts.isPropertyAccessExpression(expr)) {
        return containsReference(expr.expression, name);
      }
      if (ts.isElementAccessExpression(expr)) {
        return containsReference(expr.expression, name) ||
               containsReference(expr.argumentExpression as ts.Expression, name);
      }
      // Check all children
      let found = false;
      ts.forEachChild(expr, (child) => {
        if (ts.isExpression(child) && containsReference(child, name)) {
          found = true;
        }
      });
      return found;
    };

    // Check if a validated variable has been tainted in the function body
    const isTainted = (varName: string, body: ts.Block): boolean => {
      let tainted = false;

      // First pass: collect aliases (variables that reference properties of varName)
      // e.g., const addr = user.address; -> addr is an alias
      const aliases = new Set<string>([varName]);

      const collectAliases = (node: ts.Node): void => {
        // Look for: const/let x = varName.property or const/let x = varName
        if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.initializer) {
              // Check if initializer is rooted at our tracked variable or any existing alias
              const initRoot = getRootIdentifier(decl.initializer);
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
        const root = getRootIdentifier(expr);
        return root !== undefined && aliases.has(root);
      };

      const checkTainting = (node: ts.Node): void => {
        if (tainted) return; // Early exit if already tainted

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
            // Check if any tracked variable or alias appears in the argument
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
          if (param.type.kind === ts.SyntaxKind.AnyKeyword ||
              param.type.kind === ts.SyntaxKind.UnknownKeyword) {
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
            // Use reusable validators - use typeToString
            const typeText = typeChecker.typeToString(paramType);
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
                if (decl.type.kind !== ts.SyntaxKind.AnyKeyword &&
                    decl.type.kind !== ts.SyntaxKind.UnknownKeyword) {
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
      const isAnyOrUnknownReturn = returnType && (
        returnType.kind === ts.SyntaxKind.AnyKeyword ||
        returnType.kind === ts.SyntaxKind.UnknownKeyword
      );

      if (returnType && returnTypeForString && !isAnyOrUnknownReturn) {
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
            const rootVar = getRootIdentifier(node.expression);
            if (rootVar && validatedVariables.has(rootVar)) {
              // Check if the variable has been tainted (mutated, passed to function, etc.)
              if (!isTainted(rootVar, visitedBody)) {
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
              // Use reusable validators - always use typeToString
              const returnTypeText = typeChecker.typeToString(returnTypeForString!);
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

  private getOrCreateValidator(
    typeText: string,
    typeNode: ts.TypeNode
  ): string {
    if (this.typeValidators.has(typeText)) {
      return this.typeValidators.get(typeText)!.name;
    }

    const validatorName = `__typical_` + `assert_${this.typeValidators.size}`;
    this.typeValidators.set(typeText, { name: validatorName, typeNode });
    return validatorName;
  }

  private getOrCreateStringifier(
    typeText: string,
    typeNode: ts.TypeNode
  ): string {
    if (this.typeStringifiers.has(typeText)) {
      return this.typeStringifiers.get(typeText)!.name;
    }

    const stringifierName = `__typical_` + `stringify_${this.typeStringifiers.size}`;
    this.typeStringifiers.set(typeText, { name: stringifierName, typeNode });
    return stringifierName;
  }

  private getOrCreateParser(typeText: string, typeNode: ts.TypeNode): string {
    if (this.typeParsers.has(typeText)) {
      return this.typeParsers.get(typeText)!.name;
    }

    const parserName = `__typical_` + `parse_${this.typeParsers.size}`;
    this.typeParsers.set(typeText, { name: parserName, typeNode });
    return parserName;
  }

  private createValidatorStatements(ctx: TransformContext): ts.Statement[] {
    const { factory } = ctx;
    const statements: ts.Statement[] = [];

    // Create assert validators
    for (const [, { name: validatorName, typeNode }] of this.typeValidators) {
      const createAssertCall = factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier("typia"),
          "createAssert"
        ),
        [typeNode],
        []
      );

      const validatorDeclaration = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              validatorName,
              undefined,
              undefined,
              createAssertCall
            ),
          ],
          ctx.ts.NodeFlags.Const
        )
      );
      statements.push(validatorDeclaration);
    }

    // Create stringifiers
    for (const [, { name: stringifierName, typeNode }] of this
      .typeStringifiers) {
      const createStringifyCall = factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createPropertyAccessExpression(
            factory.createIdentifier("typia"),
            "json"
          ),
          "createStringify"
        ),
        [typeNode],
        []
      );

      const stringifierDeclaration = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              stringifierName,
              undefined,
              undefined,
              createStringifyCall
            ),
          ],
          ctx.ts.NodeFlags.Const
        )
      );
      statements.push(stringifierDeclaration);
    }

    // Create parsers
    for (const [, { name: parserName, typeNode }] of this.typeParsers) {
      const createParseCall = factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createPropertyAccessExpression(
            factory.createIdentifier("typia"),
            "json"
          ),
          "createAssertParse"
        ),
        [typeNode],
        []
      );

      const parserDeclaration = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              parserName,
              undefined,
              undefined,
              createParseCall
            ),
          ],
          ctx.ts.NodeFlags.Const
        )
      );
      statements.push(parserDeclaration);
    }

    return statements;
  }
}
