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
			// Handle return statement validation
			if config.ValidateReturns && len(funcStack) > 0 {
				ctx := funcStack[len(funcStack)-1]
				if ctx.returnType != nil {
					returnStmt := node.AsReturnStatement()
					if returnStmt != nil && returnStmt.Expression != nil {
						returnType := checker.Checker_getTypeFromTypeNode(c, ctx.returnType)
						if returnType != nil && !shouldSkipType(returnType) {
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
			}

		case ast.KindAsExpression:
			// Handle type cast validation: expr as Type
			if config.ValidateCasts {
				asExpr := node.AsAsExpression()
				if asExpr != nil && asExpr.Type != nil {
					castType := checker.Checker_getTypeFromTypeNode(c, asExpr.Type)
					if castType != nil && !shouldSkipType(castType) {
						validator := gen.GenerateValidatorFromNode(castType, asExpr.Type, "")

						// Get the expression text for error messages
						exprStart := asExpr.Expression.Pos()
						exprEnd := asExpr.Expression.End()
						exprText := text[exprStart:exprEnd]

						// Map back to the "as Type" part (the type in the cast)
						castTypePos := asExpr.Type.Pos()

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
