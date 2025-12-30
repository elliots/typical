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

        // Then apply typia if we added typia calls
        const printer = this.ts.createPrinter();
        const transformedCode = printer.printFile(transformedSourceFile);

        if (transformedCode.includes("typia.")) {
          try {
            // Apply typia transformation to files with typia calls

            // Create a new source file with the transformed code, preserving original filename
            const newSourceFile = this.ts.createSourceFile(
              sourceFile.fileName, // Use original filename to maintain source map references
              transformedCode,
              sourceFile.languageVersion,
              true
            );

            // Create a new program with the transformed source file so typia's type checker works
            const compilerOptions = this.program.getCompilerOptions();
            const originalSourceFiles = new Map<string, ts.SourceFile>();
            for (const sf of this.program.getSourceFiles()) {
              originalSourceFiles.set(sf.fileName, sf);
            }
            // Replace the original source file with the transformed one
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
              getDefaultLibFileName: () => this.ts.getDefaultLibFilePath(compilerOptions),
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

            // Create typia transformer with the NEW program that has the transformed source
            const typiaTransformer = typiaTransform(
              newProgram,
              {},
              {
                addDiagnostic(diag: ts.Diagnostic) {
                  console.warn("Typia diagnostic:", diag);
                  return 0;
                },
              }
            );

            // Apply the transformer with source map preservation
            const transformationResult = this.ts.transform(
              newSourceFile,
              [typiaTransformer],
              { ...compilerOptions, sourceMap: true }
            );

            if (transformationResult.transformed.length > 0) {
              const finalTransformed = transformationResult.transformed[0];
              transformedSourceFile = finalTransformed;

              // Typia transformation completed successfully
            }

            transformationResult.dispose();
          } catch (error) {
            console.warn("Failed to apply typia transformer:", sourceFile.fileName, error);
          }
        }

        return transformedSourceFile;
      };
    };
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

    // Check if this file has already been transformed by us
    const sourceText = sourceFile.getFullText();
    if (sourceText.includes('__typical_assert_') || sourceText.includes('__typical_stringify_') || sourceText.includes('__typical_parse_')) {
      throw new Error(`File ${sourceFile.fileName} has already been transformed by Typical! Double transformation detected.`);
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
              }
              parent = parent.parent;
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

    const transformFunction = (
      func: ts.FunctionDeclaration | ts.ArrowFunction | ts.MethodDeclaration
    ): ts.Node => {
      const body = func.body;
      if (!body || !ts.isBlock(body)) return func;

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

          if (this.config.reusableValidators) {
            // Use reusable validators - use typeToString
            const paramType = typeChecker.getTypeFromTypeNode(param.type);
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

    const validatorName = `__typical_assert_${this.typeValidators.size}`;
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

    const stringifierName = `__typical_stringify_${this.typeStringifiers.size}`;
    this.typeStringifiers.set(typeText, { name: stringifierName, typeNode });
    return stringifierName;
  }

  private getOrCreateParser(typeText: string, typeNode: ts.TypeNode): string {
    if (this.typeParsers.has(typeText)) {
      return this.typeParsers.get(typeText)!.name;
    }

    const parserName = `__typical_parse_${this.typeParsers.size}`;
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
