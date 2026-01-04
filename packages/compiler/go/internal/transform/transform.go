package transform

import (
	"strings"

	"github.com/elliots/typical/packages/compiler/internal/codegen"
	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/checker"
)

// insertion represents text to insert at a position in the source
type insertion struct {
	pos       int    // Position in the original source to insert at
	text      string // Text to insert
	sourcePos int    // Source position this inserted text should map back to (-1 for no mapping)
	skipTo    int    // If > 0, skip original text up to this position after inserting (for replacements)
}

// TransformFile transforms a TypeScript source file by adding runtime validators.
func TransformFile(sourceFile *ast.SourceFile, c *checker.Checker) string {
	return TransformFileWithConfig(sourceFile, c, DefaultConfig())
}

// TransformFileWithConfig transforms a TypeScript source file with the given configuration.
func TransformFileWithConfig(sourceFile *ast.SourceFile, c *checker.Checker, config Config) string {
	code, _ := TransformFileWithSourceMap(sourceFile, c, config)
	return code
}

// TransformFileWithSourceMap transforms a TypeScript source file and returns both the code and source map.
func TransformFileWithSourceMap(sourceFile *ast.SourceFile, c *checker.Checker, config Config) (string, *RawSourceMap) {
	text := sourceFile.Text()
	fileName := sourceFile.FileName()
	gen := codegen.NewGenerator(c)

	// Collect all insertions (position -> text to insert)
	var insertions []insertion

	// Track which function we're currently in for return statement handling
	type funcContext struct {
		returnType *ast.Node
		isAsync    bool
		bodyStart  int // Position after opening brace
	}
	var funcStack []*funcContext

	// Recursive visitor
	var visit ast.Visitor
	visit = func(node *ast.Node) bool {
		switch node.Kind {
		case ast.KindFunctionDeclaration,
			ast.KindFunctionExpression,
			ast.KindArrowFunction,
			ast.KindMethodDeclaration:

			// Get function-like node
			if fn := getFunctionLike(node); fn != nil {
				// Push function context
				ctx := &funcContext{
					returnType: fn.Type(),
					isAsync:    fn.IsAsync(),
				}

				// Get body start position for inserting parameter validations
				if body := fn.Body(); body != nil {
					// For block bodies, find the opening brace and insert after it
					if body.Kind == ast.KindBlock {
						block := body.AsBlock()
						if block != nil {
							// Use the position of the first statement, or end of block if empty
							if block.Statements != nil && len(block.Statements.Nodes) > 0 {
								// Insert before first statement
								ctx.bodyStart = block.Statements.Nodes[0].Pos()
							} else {
								// Empty block - insert at end - 1 (before closing brace)
								ctx.bodyStart = body.End() - 1
							}
						}
					}
				}

				funcStack = append(funcStack, ctx)
				defer func() {
					funcStack = funcStack[:len(funcStack)-1]
				}()

				// Add validators for parameters at the start of function body
				if config.ValidateParameters && ctx.bodyStart > 0 {
					for _, param := range fn.Parameters() {
						if param.Type != nil {
							paramType := checker.Checker_getTypeFromTypeNode(c, param.Type)
							if paramType != nil && !shouldSkipType(paramType) {
								paramName := getParamName(param)
								validator := gen.GenerateValidatorFromNode(paramType, param.Type, "")
								// Map to the parameter name (start of the param declaration)
								// This covers "name: Type" so errors point to the full param
								paramPos := param.Name().Pos()
								insertions = append(insertions, insertion{
									pos:       ctx.bodyStart,
									text:      " " + validator + "(" + paramName + ", \"" + paramName + "\");",
									sourcePos: paramPos,
								})
							}
						}
					}
				}
			}

		case ast.KindReturnStatement:
			// Handle return statement - check for JSON.parse first, then regular validation
			if len(funcStack) > 0 {
				ctx := funcStack[len(funcStack)-1]
				returnStmt := node.AsReturnStatement()
				if returnStmt != nil && returnStmt.Expression != nil && ctx.returnType != nil {
					returnType := checker.Checker_getTypeFromTypeNode(c, ctx.returnType)

					// Check if return expression is JSON.parse() - transform it with return type
					if config.TransformJSONParse && returnStmt.Expression.Kind == ast.KindCallExpression {
						callExpr := returnStmt.Expression.AsCallExpression()
						if callExpr != nil {
							methodName, isJSON := getJSONMethodName(callExpr)
							if isJSON && methodName == "parse" {
								// Get the actual return type (unwrap Promise for async)
								actualType, _ := unwrapReturnType(returnType, ctx.returnType, ctx.isAsync, c)
								if actualType != nil && !shouldSkipType(actualType) {
									filteringValidator := gen.GenerateFilteringValidator(actualType, "")

									if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
										arg := callExpr.Arguments.Nodes[0]
										argText := text[arg.Pos():arg.End()]

										// Replace JSON.parse(arg) with filteringValidator(JSON.parse(arg), "JSON.parse")
										insertions = append(insertions, insertion{
											pos:       returnStmt.Expression.Pos(),
											text:      filteringValidator + "(JSON.parse(" + argText + `), "JSON.parse")`,
											sourcePos: ctx.returnType.Pos(),
											skipTo:    returnStmt.Expression.End(),
										})
										return false // Don't visit children or do regular return validation
									}
								}
							}
						}
					}

					// Regular return statement validation
					if config.ValidateReturns && returnType != nil && !shouldSkipType(returnType) {
						// Get the actual return type (unwrap Promise for async functions)
						actualType, actualTypeNode := unwrapReturnType(returnType, ctx.returnType, ctx.isAsync, c)

						if !shouldSkipType(actualType) {
							validator := gen.GenerateValidatorFromNode(actualType, actualTypeNode, "")

							// Get expression positions
							exprStart := returnStmt.Expression.Pos()
							exprEnd := returnStmt.Expression.End()

							// Get the source position of the return type annotation
							returnTypePos := ctx.returnType.Pos()

							if ctx.isAsync {
								// Async function: Promise is automatically unwrapped
								// return expr; -> return validator(expr, "return value");
								insertions = append(insertions, insertion{
									pos:       exprStart,
									text:      validator + "(",
									sourcePos: returnTypePos,
								})
								insertions = append(insertions, insertion{
									pos:       exprEnd,
									text:      `, "return value")`,
									sourcePos: returnTypePos,
								})
							} else if isPromiseType(returnType, c) {
								// Sync function returning Promise: add .then()
								// return expr; -> return (expr).then(_v => validator(_v, "return value"));
								insertions = append(insertions, insertion{
									pos:       exprStart,
									text:      "(",
									sourcePos: returnTypePos,
								})
								insertions = append(insertions, insertion{
									pos:       exprEnd,
									text:      ").then(_v => " + validator + `(_v, "return value"))`,
									sourcePos: returnTypePos,
								})
							} else {
								// Normal sync function
								// return expr; -> return validator(expr, "return value");
								insertions = append(insertions, insertion{
									pos:       exprStart,
									text:      validator + "(",
									sourcePos: returnTypePos,
								})
								insertions = append(insertions, insertion{
									pos:       exprEnd,
									text:      `, "return value")`,
									sourcePos: returnTypePos,
								})
							}
						}
					}
				}
			}

		case ast.KindAsExpression:
			// Handle type cast validation: expr as Type
			// Also handle JSON.parse(x) as T and JSON.stringify(x) as T patterns
			asExpr := node.AsAsExpression()
			if asExpr != nil && asExpr.Type != nil {
				castType := checker.Checker_getTypeFromTypeNode(c, asExpr.Type)
				if castType != nil && !shouldSkipType(castType) {
					castTypePos := asExpr.Type.Pos()

					// Check if inner expression is JSON.parse() or JSON.stringify()
					if asExpr.Expression.Kind == ast.KindCallExpression {
						innerCall := asExpr.Expression.AsCallExpression()
						if innerCall != nil {
							methodName, isJSON := getJSONMethodName(innerCall)
							if isJSON {
								// Handle JSON.parse(x) as T
								if methodName == "parse" && config.TransformJSONParse {
									filteringValidator := gen.GenerateFilteringValidator(castType, "")

									if innerCall.Arguments != nil && len(innerCall.Arguments.Nodes) > 0 {
										arg := innerCall.Arguments.Nodes[0]
										argStart := arg.Pos()
										argEnd := arg.End()
										argText := text[argStart:argEnd]

										// Replace entire "JSON.parse(x) as T" with filteringValidator(JSON.parse(x), "JSON.parse")
										insertions = append(insertions, insertion{
											pos:       node.Pos(),
											text:      filteringValidator + "(JSON.parse(" + argText + `), "JSON.parse")`,
											sourcePos: castTypePos,
											skipTo:    node.End(), // Skip entire original expression including "as T"
										})
										return false // Don't visit children
									}
								}

								// Handle JSON.stringify(x) as T (less common but support it)
								if methodName == "stringify" && config.TransformJSONStringify {
									stringifier := gen.GenerateStringifier(castType, "")

									if innerCall.Arguments != nil && len(innerCall.Arguments.Nodes) > 0 {
										arg := innerCall.Arguments.Nodes[0]
										argStart := arg.Pos()
										argEnd := arg.End()
										argText := text[argStart:argEnd]

										// Replace entire "JSON.stringify(x) as T" with stringifier(x, "JSON.stringify")
										insertions = append(insertions, insertion{
											pos:       node.Pos(),
											text:      stringifier + "(" + argText + `, "JSON.stringify")`,
											sourcePos: castTypePos,
											skipTo:    node.End(), // Skip entire original expression including "as T"
										})
										return false // Don't visit children
									}
								}
							}
						}
					}

					// Regular cast validation (not JSON)
					if config.ValidateCasts {
						validator := gen.GenerateValidatorFromNode(castType, asExpr.Type, "")

						// Get the expression text for error messages
						exprStart := asExpr.Expression.Pos()
						exprEnd := asExpr.Expression.End()
						exprText := text[exprStart:exprEnd]

						// Wrap the entire as expression
						// (expr as Type) -> validator(expr, "expr as Type")
						insertions = append(insertions, insertion{
							pos:       node.Pos(),
							text:      validator + "(",
							sourcePos: castTypePos,
						})
						insertions = append(insertions, insertion{
							pos:       exprEnd,
							text:      `, "` + escapeString(exprText) + `")`,
							sourcePos: castTypePos,
						})
						// We need to remove " as Type" part
						// Insert empty to mark for removal
						insertions = append(insertions, insertion{
							pos:       exprEnd,
							text:      "/* as removed */",
							sourcePos: castTypePos,
						})
					}
				}
			}

		case ast.KindCallExpression:
			// Handle JSON.parse and JSON.stringify transformations
			callExpr := node.AsCallExpression()
			if callExpr != nil {
				methodName, isJSON := getJSONMethodName(callExpr)
				if isJSON {
					// Try to get target type from various sources
					var targetType *checker.Type
					var sourcePos int = node.Pos()

					// 1. Check for explicit type argument: JSON.parse<T>()
					if callExpr.TypeArguments != nil && len(callExpr.TypeArguments.Nodes) > 0 {
						typeArgNode := callExpr.TypeArguments.Nodes[0]
						targetType = checker.Checker_getTypeFromTypeNode(c, typeArgNode)
						sourcePos = typeArgNode.Pos()
					}

					// 2. For stringify, check if argument has "as T" cast: JSON.stringify(x as T)
					if methodName == "stringify" && targetType == nil && config.TransformJSONStringify {
						if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
							arg := callExpr.Arguments.Nodes[0]
							if arg.Kind == ast.KindAsExpression {
								asExpr := arg.AsAsExpression()
								if asExpr != nil && asExpr.Type != nil {
									targetType = checker.Checker_getTypeFromTypeNode(c, asExpr.Type)
									sourcePos = asExpr.Type.Pos()
								}
							}
						}
					}

					// 3. For stringify, infer type from argument's declared type: JSON.stringify(typedVar)
					if methodName == "stringify" && targetType == nil && config.TransformJSONStringify {
						if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
							arg := callExpr.Arguments.Nodes[0]
							// Get the type of the argument from the checker
							argType := checker.Checker_GetTypeAtLocation(c, arg)
							if argType != nil && !shouldSkipType(argType) {
								// Only use inferred type if it's a concrete object type (not any/unknown)
								flags := checker.Type_flags(argType)
								if flags&checker.TypeFlagsObject != 0 || flags&checker.TypeFlagsUnion != 0 {
									targetType = argType
									sourcePos = arg.Pos()
								}
							}
						}
					}

					// Apply transformation if we have a target type
					if targetType != nil && !shouldSkipType(targetType) {
						if methodName == "parse" && config.TransformJSONParse {
							filteringValidator := gen.GenerateFilteringValidator(targetType, "")

							if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
								arg := callExpr.Arguments.Nodes[0]
								argText := text[arg.Pos():arg.End()]

								insertions = append(insertions, insertion{
									pos:       node.Pos(),
									text:      filteringValidator + "(JSON.parse(" + argText + `), "JSON.parse")`,
									sourcePos: sourcePos,
									skipTo:    node.End(),
								})
								return false
							}
						} else if methodName == "stringify" && config.TransformJSONStringify {
							stringifier := gen.GenerateStringifier(targetType, "")

							if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
								arg := callExpr.Arguments.Nodes[0]
								// For "x as T" pattern, use just the expression part
								argText := text[arg.Pos():arg.End()]
								if arg.Kind == ast.KindAsExpression {
									asExpr := arg.AsAsExpression()
									if asExpr != nil {
										argText = text[asExpr.Expression.Pos():asExpr.Expression.End()]
									}
								}

								insertions = append(insertions, insertion{
									pos:       node.Pos(),
									text:      stringifier + "(" + argText + `, "JSON.stringify")`,
									sourcePos: sourcePos,
									skipTo:    node.End(),
								})
								return false
							}
						}
					}
				}
			}

		case ast.KindVariableDeclaration:
			// Handle: const x: T = JSON.parse(string)
			if config.TransformJSONParse {
				varDecl := node.AsVariableDeclaration()
				if varDecl != nil && varDecl.Type != nil && varDecl.Initializer != nil {
					// Check if initializer is JSON.parse()
					if varDecl.Initializer.Kind == ast.KindCallExpression {
						callExpr := varDecl.Initializer.AsCallExpression()
						if callExpr != nil {
							methodName, isJSON := getJSONMethodName(callExpr)
							if isJSON && methodName == "parse" {
								targetType := checker.Checker_getTypeFromTypeNode(c, varDecl.Type)
								if targetType != nil && !shouldSkipType(targetType) {
									filteringValidator := gen.GenerateFilteringValidator(targetType, "")

									if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
										arg := callExpr.Arguments.Nodes[0]
										argText := text[arg.Pos():arg.End()]

										// Replace the JSON.parse call with filtered version
										insertions = append(insertions, insertion{
											pos:       varDecl.Initializer.Pos(),
											text:      filteringValidator + "(JSON.parse(" + argText + `), "JSON.parse")`,
											sourcePos: varDecl.Type.Pos(),
											skipTo:    varDecl.Initializer.End(),
										})
										return false
									}
								}
							}
						}
					}
				}
			}
		}
		// Continue visiting children
		node.ForEachChild(visit)
		return false
	}

	// Start visiting from the source file
	sourceFile.AsNode().ForEachChild(visit)

	// Build result with source map
	return buildSourceMap(fileName, text, insertions)
}

// shouldSkipType returns true if the type should not be validated
func shouldSkipType(t *checker.Type) bool {
	flags := checker.Type_flags(t)
	// Skip any, unknown, never, void
	if flags&checker.TypeFlagsAny != 0 ||
		flags&checker.TypeFlagsUnknown != 0 ||
		flags&checker.TypeFlagsNever != 0 ||
		flags&checker.TypeFlagsVoid != 0 {
		return true
	}

	return false
}

// unwrapReturnType extracts the inner type from Promise<T> for async functions
func unwrapReturnType(t *checker.Type, typeNode *ast.Node, isAsync bool, c *checker.Checker) (*checker.Type, *ast.Node) {
	if !isAsync {
		// For sync functions returning Promise, we also want to unwrap
		if isPromiseType(t, c) {
			return unwrapPromiseType(t, typeNode, c)
		}
		return t, typeNode
	}

	// For async functions, unwrap Promise<T> to get T
	return unwrapPromiseType(t, typeNode, c)
}

// isPromiseType checks if a type is Promise<T>
func isPromiseType(t *checker.Type, c *checker.Checker) bool {
	if sym := checker.Type_symbol(t); sym != nil {
		return sym.Name == "Promise"
	}
	return false
}

// unwrapPromiseType extracts T from Promise<T>
func unwrapPromiseType(t *checker.Type, typeNode *ast.Node, c *checker.Checker) (*checker.Type, *ast.Node) {
	// Try to get type arguments (Promise<T> -> T)
	typeArgs := checker.Checker_getTypeArguments(c, t)
	if len(typeArgs) > 0 {
		// Try to get the type node for the argument
		if typeNode != nil && typeNode.Kind == ast.KindTypeReference {
			typeRef := typeNode.AsTypeReferenceNode()
			if typeRef != nil && typeRef.TypeArguments != nil && len(typeRef.TypeArguments.Nodes) > 0 {
				return typeArgs[0], typeRef.TypeArguments.Nodes[0]
			}
		}
		return typeArgs[0], nil
	}
	return t, typeNode
}

// getParamName extracts the parameter name as a string
func getParamName(param *ast.ParameterDeclaration) string {
	if param.Name() != nil {
		nameNode := param.Name()
		if nameNode.Kind == ast.KindIdentifier {
			return nameNode.AsIdentifier().Text
		}
	}
	return ""
}

// functionLike provides a common interface for function-like nodes
type functionLike struct {
	node *ast.Node
}

func getFunctionLike(node *ast.Node) *functionLike {
	switch node.Kind {
	case ast.KindFunctionDeclaration,
		ast.KindFunctionExpression,
		ast.KindArrowFunction,
		ast.KindMethodDeclaration:
		return &functionLike{node: node}
	}
	return nil
}

func (f *functionLike) Parameters() []*ast.ParameterDeclaration {
	switch f.node.Kind {
	case ast.KindFunctionDeclaration:
		decl := f.node.AsFunctionDeclaration()
		return nodeListToParams(decl.Parameters)
	case ast.KindFunctionExpression:
		expr := f.node.AsFunctionExpression()
		return nodeListToParams(expr.Parameters)
	case ast.KindArrowFunction:
		arrow := f.node.AsArrowFunction()
		return nodeListToParams(arrow.Parameters)
	case ast.KindMethodDeclaration:
		method := f.node.AsMethodDeclaration()
		return nodeListToParams(method.Parameters)
	}
	return nil
}

func (f *functionLike) Type() *ast.Node {
	switch f.node.Kind {
	case ast.KindFunctionDeclaration:
		return f.node.AsFunctionDeclaration().Type
	case ast.KindFunctionExpression:
		return f.node.AsFunctionExpression().Type
	case ast.KindArrowFunction:
		return f.node.AsArrowFunction().Type
	case ast.KindMethodDeclaration:
		return f.node.AsMethodDeclaration().Type
	}
	return nil
}

func (f *functionLike) Body() *ast.Node {
	switch f.node.Kind {
	case ast.KindFunctionDeclaration:
		return f.node.AsFunctionDeclaration().Body
	case ast.KindFunctionExpression:
		return f.node.AsFunctionExpression().Body
	case ast.KindArrowFunction:
		return f.node.AsArrowFunction().Body
	case ast.KindMethodDeclaration:
		return f.node.AsMethodDeclaration().Body
	}
	return nil
}

func (f *functionLike) IsAsync() bool {
	switch f.node.Kind {
	case ast.KindFunctionDeclaration:
		decl := f.node.AsFunctionDeclaration()
		return hasAsyncModifier(decl.Modifiers())
	case ast.KindFunctionExpression:
		expr := f.node.AsFunctionExpression()
		return hasAsyncModifier(expr.Modifiers())
	case ast.KindArrowFunction:
		arrow := f.node.AsArrowFunction()
		return hasAsyncModifier(arrow.Modifiers())
	case ast.KindMethodDeclaration:
		method := f.node.AsMethodDeclaration()
		return hasAsyncModifier(method.Modifiers())
	}
	return false
}

func hasAsyncModifier(modifiers *ast.ModifierList) bool {
	if modifiers == nil {
		return false
	}
	for _, mod := range modifiers.Nodes {
		if mod.Kind == ast.KindAsyncKeyword {
			return true
		}
	}
	return false
}

func nodeListToParams(list *ast.NodeList) []*ast.ParameterDeclaration {
	if list == nil {
		return nil
	}
	var params []*ast.ParameterDeclaration
	for _, node := range list.Nodes {
		if param := node.AsParameterDeclaration(); param != nil {
			params = append(params, param)
		}
	}
	return params
}

// escapeString escapes a string for use in a JavaScript string literal.
func escapeString(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	s = strings.ReplaceAll(s, "\n", "\\n")
	s = strings.ReplaceAll(s, "\r", "\\r")
	s = strings.ReplaceAll(s, "\t", "\\t")
	return s
}

// getJSONMethodName checks if a call expression is JSON.parse or JSON.stringify.
// Returns the method name ("parse" or "stringify") and true if it's a JSON method,
// or empty string and false otherwise.
func getJSONMethodName(callExpr *ast.CallExpression) (string, bool) {
	if callExpr.Expression == nil {
		return "", false
	}

	// Check for JSON.parse or JSON.stringify pattern
	expr := callExpr.Expression
	if expr.Kind == ast.KindPropertyAccessExpression {
		propAccess := expr.AsPropertyAccessExpression()
		if propAccess != nil && propAccess.Expression != nil {
			// Check if it's JSON.xxx
			if propAccess.Expression.Kind == ast.KindIdentifier {
				objName := propAccess.Expression.AsIdentifier().Text
				if objName == "JSON" {
					// Get the method name
					nameNode := propAccess.Name()
					if nameNode != nil && nameNode.Kind == ast.KindIdentifier {
						methodName := nameNode.AsIdentifier().Text
						if methodName == "parse" || methodName == "stringify" {
							return methodName, true
						}
					}
				}
			}
		}
	}
	return "", false
}
