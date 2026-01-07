package transform

import (
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/elliots/typical/packages/compiler/internal/analyse"
	"github.com/elliots/typical/packages/compiler/internal/codegen"
	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/checker"
	"github.com/microsoft/typescript-go/shim/compiler"
)

var debug = os.Getenv("DEBUG") == "1"

var ignoreCommentRegex = regexp.MustCompile(`(//.*@typical-ignore)|(/\*[\s\S]*?@typical-ignore)`)

func debugf(format string, args ...interface{}) {
	if debug {
		fmt.Fprintf(os.Stderr, format, args...)
	}
}

// insertion represents text to insert at a position in the source
type insertion struct {
	pos       int    // Position in the original source to insert at
	text      string // Text to insert
	sourcePos int    // Source position this inserted text should map back to (-1 for no mapping)
	skipTo    int    // If > 0, skip original text up to this position after inserting (for replacements)
}

// TransformFile transforms a TypeScript source file by adding runtime validators.
func TransformFile(sourceFile *ast.SourceFile, c *checker.Checker, program *compiler.Program) string {
	return TransformFileWithConfig(sourceFile, c, program, DefaultConfig())
}

// TransformFileWithConfig transforms a TypeScript source file with the given configuration.
func TransformFileWithConfig(sourceFile *ast.SourceFile, c *checker.Checker, program *compiler.Program, config Config) string {
	code, _ := TransformFileWithSourceMap(sourceFile, c, program, config)
	return code
}

// TransformFileWithSourceMap transforms a TypeScript source file and returns both the code and source map.
// Returns error if a type exceeds the complexity limit.
func TransformFileWithSourceMap(sourceFile *ast.SourceFile, c *checker.Checker, program *compiler.Program, config Config) (string, *RawSourceMap) {
	code, sourceMap, _ := TransformFileWithSourceMapAndError(sourceFile, c, program, config)
	return code, sourceMap
}

// TransformFileWithSourceMapAndError transforms a TypeScript source file and returns code, source map, and any error.
// Returns error if a type exceeds the complexity limit (e.g., complex DOM types).
func TransformFileWithSourceMapAndError(sourceFile *ast.SourceFile, c *checker.Checker, program *compiler.Program, config Config) (string, *RawSourceMap, error) {
	text := sourceFile.Text()
	fileName := sourceFile.FileName()
	debugf("[DEBUG] Starting transform for %s\n", fileName)

	// Compute line starts for position-to-line conversion
	lineStarts := computeLineStarts(text)

	// Helper to get 1-based line number from position
	getLineNumber := func(pos int) int {
		line, _ := posToLineCol(pos, lineStarts)
		return line + 1 // Convert to 1-based
	}

	// Create generator with config's max functions limit and ignore patterns
	maxFuncs := config.MaxGeneratedFunctions
	if maxFuncs == 0 {
		maxFuncs = DefaultMaxGeneratedFunctions
	}
	gen := codegen.NewGeneratorWithIgnoreTypes(c, program, maxFuncs, config.IgnoreTypes)

	// Collect all insertions (position -> text to insert)
	var insertions []insertion

	// Track reusable validators when config.ReusableValidators is enabled
	// Maps type key -> generated function code
	checkFunctions := make(map[string]string)      // _check_X functions for validation
	filterFunctions := make(map[string]string)     // _filter_X functions for JSON.parse/stringify
	checkFunctionNames := make(map[string]string)  // type key -> function name
	filterFunctionNames := make(map[string]string) // type key -> function name
	usedCheckNames := make(map[string]bool)        // track which function names are in use
	usedFilterNames := make(map[string]bool)       // track which function names are in use
	checkNameCounter := make(map[string]int)       // base name -> next suffix counter
	filterNameCounter := make(map[string]int)      // base name -> next suffix counter

	// Pre-computed type usage counts from first pass (only populated when ReusableValidators is true)
	checkTypeUsage := make(map[string]int)
	filterTypeUsage := make(map[string]int)
	// Type objects from first pass - used to pre-generate check functions for nested types
	checkTypeObjects := make(map[string]typeInfo)
	filterTypeObjects := make(map[string]typeInfo)

	// getTypeKey returns a stable key for a type, used to deduplicate reusable validators
	// We use the full type string to ensure different types get different keys
	getTypeKey := func(t *checker.Type, typeNode *ast.Node) string {
		// Use TypeToString for the full type representation
		// This ensures ArrayItem[] and (ArrayItem & {age: number})[] get different keys
		typeStr := c.TypeToString(t)
		if typeStr != "" {
			return typeStr
		}
		// Fallback to pointer-based key for types that can't be stringified
		return fmt.Sprintf("anon_%p", t)
	}

	// First pass: count type usages (only when ReusableValidators is "auto")
	// This allows us to only hoist functions that are used more than once
	// AND enables composable validators (nested types call reusable functions)
	if config.ReusableValidators == ReusableValidatorsAuto {
		// Use the analyse package for unified AST traversal
		analyseConfig := analyse.Config{
			ValidateParameters:     config.ValidateParameters,
			ValidateReturns:        config.ValidateReturns,
			ValidateCasts:          config.ValidateCasts,
			TransformJSONParse:     config.TransformJSONParse,
			TransformJSONStringify: config.TransformJSONStringify,
			IgnoreTypes:            config.IgnoreTypes,
		}
		analyseResult := analyse.AnalyseFile(sourceFile, c, program, analyseConfig)

		// Copy results to local maps
		for k, v := range analyseResult.CheckTypeUsage {
			checkTypeUsage[k] = v
		}
		for k, v := range analyseResult.FilterTypeUsage {
			filterTypeUsage[k] = v
		}
		for k, v := range analyseResult.CheckTypeObjects {
			checkTypeObjects[k] = typeInfo{t: v.Type, typeNode: v.TypeNode, typeName: v.TypeName}
		}
		for k, v := range analyseResult.FilterTypeObjects {
			filterTypeObjects[k] = typeInfo{t: v.Type, typeNode: v.TypeNode, typeName: v.TypeName}
		}
		debugf("[DEBUG] First pass complete: %d check types, %d filter types\n", len(checkTypeUsage), len(filterTypeUsage))

		// Pre-allocate function names for types that will be hoisted (usage > 1)
		// This enables composable validators - nested types can call parent's check function
		for typeKey, count := range checkTypeUsage {
			if count > 1 {
				// Generate a unique function name based on the type key
				// Uses smart naming: simple types get full name, complex types get shortened name with number
				finalName := generateFunctionName("_check_", typeKey, checkNameCounter, usedCheckNames)
				checkFunctionNames[typeKey] = finalName
			}
		}

		// Pass the pre-allocated names to the generator for composable validators
		gen.SetAvailableCheckFunctions(checkFunctionNames)

		// Pre-generate check function code for all types that will be reused
		// This must happen BEFORE the main visitor so that when we generate
		// a check function for NestedUser that calls _check_Address,
		// the _check_Address code already exists
		for typeKey, count := range checkTypeUsage {
			if count > 1 {
				if info, exists := checkTypeObjects[typeKey]; exists {
					typeName := info.typeName
					if typeName == "" {
						typeName = "value"
					}
					// Generate the check function code - this populates checkFunctions[typeKey]
					var result codegen.CheckFunctionResult
					if info.typeNode != nil {
						result = gen.GenerateCheckFunctionFromNode(info.t, info.typeNode, typeName)
					} else {
						result = gen.GenerateCheckFunction(info.t, typeName)
					}
					if !result.Ignored && result.Code != "" {
						finalName := checkFunctionNames[typeKey]
						if result.Name != finalName {
							result.Code = strings.Replace(result.Code, result.Name+" ", finalName+" ", 1)
						}
						checkFunctions[typeKey] = result.Code
					}
				}
			}
		}
		debugf("[DEBUG] Pre-generated %d check functions\n", len(checkFunctions))
	}

	// shouldUseReusable returns true if we should use a reusable function for this type
	// - ReusableValidatorsNever: Never hoist (always inline)
	// - ReusableValidatorsAuto: Hoist only if used more than once
	// - ReusableValidatorsAlways: Always hoist even if used once
	shouldUseReusableCheck := func(t *checker.Type, typeNode *ast.Node) bool {
		if config.ReusableValidators == ReusableValidatorsNever {
			return false
		}
		if config.ReusableValidators == ReusableValidatorsAlways {
			return true
		}
		// Default (ReusableValidatorsAuto): only hoist if used more than once
		key := getTypeKey(t, typeNode)
		return checkTypeUsage[key] > 1
	}

	shouldUseReusableFilter := func(t *checker.Type, typeNode *ast.Node) bool {
		if config.ReusableValidators == ReusableValidatorsNever {
			return false
		}
		if config.ReusableValidators == ReusableValidatorsAlways {
			return true
		}
		// Default (ReusableValidatorsAuto): only hoist if used more than once
		key := getTypeKey(t, typeNode)
		return filterTypeUsage[key] > 1
	}

	// getOrCreateCheckFunction returns the check function name for a type,
	// generating it if needed. Returns empty string if generation fails or is ignored.
	getOrCreateCheckFunction := func(t *checker.Type, typeNode *ast.Node, typeName string) string {
		key := getTypeKey(t, typeNode)

		// Check if we already have the code generated
		if _, codeExists := checkFunctions[key]; codeExists {
			// Code already generated, return the name
			return checkFunctionNames[key]
		}

		// Check if we have a pre-allocated name (from first pass in auto mode)
		preAllocatedName, hasPreAllocatedName := checkFunctionNames[key]

		// Generate the check function code
		var result codegen.CheckFunctionResult
		if typeNode != nil {
			result = gen.GenerateCheckFunctionFromNode(t, typeNode, typeName)
		} else {
			result = gen.GenerateCheckFunction(t, typeName)
		}
		if result.Ignored || result.Code == "" {
			return ""
		}

		var finalName string
		if hasPreAllocatedName {
			// Use the pre-allocated name, but replace the generated name in the code
			finalName = preAllocatedName
			if result.Name != finalName {
				result.Code = strings.Replace(result.Code, result.Name+" ", finalName+" ", 1)
			}
		} else {
			// Generate a smart function name based on the type key
			// This ensures short, unique names for complex types
			finalName = generateFunctionName("_check_", key, checkNameCounter, usedCheckNames)
			// Replace the function name in the generated code
			if result.Name != finalName {
				result.Code = strings.Replace(result.Code, result.Name+" ", finalName+" ", 1)
			}
			checkFunctionNames[key] = finalName
		}

		checkFunctions[key] = result.Code
		return finalName
	}

	// getOrCreateFilterFunction returns the filter function name for a type,
	// generating it if needed. Returns empty string if generation fails or is ignored.
	getOrCreateFilterFunction := func(t *checker.Type, typeNode *ast.Node, typeName string) string {
		key := getTypeKey(t, typeNode)

		// Check if we already have the code generated
		if _, codeExists := filterFunctions[key]; codeExists {
			// Code already generated, return the name
			return filterFunctionNames[key]
		}

		// Check if we have a pre-allocated name (from first pass in auto mode)
		preAllocatedName, hasPreAllocatedName := filterFunctionNames[key]

		// Generate the filter function code
		var result codegen.FilterFunctionResult
		if typeNode != nil {
			result = gen.GenerateFilterFunctionFromNode(t, typeNode, typeName)
		} else {
			result = gen.GenerateFilterFunction(t, typeName)
		}
		if result.Ignored || result.Code == "" {
			return ""
		}

		var finalName string
		if hasPreAllocatedName {
			// Use the pre-allocated name, but replace the generated name in the code
			finalName = preAllocatedName
			if result.Name != finalName {
				result.Code = strings.Replace(result.Code, result.Name+" ", finalName+" ", 1)
			}
		} else {
			// Generate a smart function name based on the type key
			// This ensures short, unique names for complex types
			finalName = generateFunctionName("_filter_", key, filterNameCounter, usedFilterNames)
			// Replace the function name in the generated code
			if result.Name != finalName {
				result.Code = strings.Replace(result.Code, result.Name+" ", finalName+" ", 1)
			}
			filterFunctionNames[key] = finalName
		}

		filterFunctions[key] = result.Code
		return finalName
	}

	// generateCheckAndThrow generates the compact check-and-throw pattern for reusable validators
	// Pattern: if ((_e = _check_Type(value)) !== null) throw new TypeError(_e.replace(/%n/g, "name"));
	generateCheckAndThrow := func(checkFuncName, valueExpr, nameStr string) string {
		return fmt.Sprintf(`if ((_e = %s(%s)) !== null) throw new TypeError(_e.replace(/%%n/g, "%s")); `,
			checkFuncName, valueExpr, nameStr)
	}

	// Track which function we're currently in for return statement handling
	type funcContext struct {
		returnType *ast.Node
		isAsync    bool
		bodyStart  int                        // Position after opening brace
		validated  map[string][]*checker.Type // varName -> list of validated types
		bodyNode   *ast.Node                  // Function body for dirty detection
	}
	var funcStack []*funcContext
	nodeCount := 0

	// Recursive visitor
	var visit ast.Visitor
	visit = func(node *ast.Node) bool {
		// Check for @typical-ignore comment
		if hasIgnoreComment(node, text) {
			return false
		}

		nodeCount++
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
					validated:  make(map[string][]*checker.Type),
				}

				// Get body start position for inserting parameter validations
				if body := fn.Body(); body != nil {
					ctx.bodyNode = body
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
					// Reset the function index counter for this function scope
					// This ensures _io0, _io1, etc. start fresh for each function
					gen.ResetFuncIdx()
					isFirstParam := true

					for _, param := range fn.Parameters() {
						if param.Type != nil {
							paramType := checker.Checker_getTypeFromTypeNode(c, param.Type)
							if paramType != nil && !shouldSkipType(paramType) && !shouldSkipComplexType(paramType, c) {
								paramName := getParamName(param)
								// Handle destructuring patterns - validate each binding element
								if paramName == "" {
									// Check for ObjectBindingPattern or ArrayBindingPattern
									nameNode := param.Name()
									if nameNode != nil && ast.IsBindingPattern(nameNode) {
										bindingPattern := nameNode.AsBindingPattern()
										if bindingPattern != nil && bindingPattern.Elements != nil {
											for _, element := range bindingPattern.Elements.Nodes {
												if element.Kind == ast.KindBindingElement {
													bindingElement := element.AsBindingElement()
													if bindingElement != nil {
														elemName := bindingElement.Name()
														if elemName != nil && elemName.Kind == ast.KindIdentifier {
															elemNameStr := elemName.AsIdentifier().Text
															// Get the type of this binding element from its symbol
															elemSym := element.Symbol()
															if elemSym != nil {
																elemType := checker.Checker_getTypeOfSymbol(c, elemSym)
																if elemType != nil && !shouldSkipType(elemType) && !shouldSkipComplexType(elemType, c) {
																	// Use continued validation after first param to avoid duplicate _io names
																	var validation string
																	if isFirstParam {
																		validation = gen.GenerateInlineValidation(elemType, elemNameStr)
																		isFirstParam = false
																	} else {
																		validation = gen.GenerateInlineValidationContinued(elemType, nil, elemNameStr)
																	}
																	if validation != "" {
																		insertions = append(insertions, insertion{
																			pos:       ctx.bodyStart,
																			text:      " " + validation,
																			sourcePos: elemName.Pos(),
																		})
																	}
																	ctx.validated[elemNameStr] = append(ctx.validated[elemNameStr], elemType)
																}
															}
														}
													}
												}
											}
										}
									}
									continue
								}
								// Set context for error messages (line number and parameter name)
								paramPos := param.Name().Pos()
								lineNum := getLineNumber(paramPos)
								gen.SetContext(fmt.Sprintf("param '%s' at line %d", paramName, lineNum))

								// Get type name for the check function
								typeName := getTypeNameWithChecker(paramType, c)
								if typeName == "" {
									// Fallback to parameter name for anonymous types
									typeName = paramName
								}

								var validation string
								if shouldUseReusableCheck(paramType, param.Type) {
									// Use reusable check function (type is used more than once)
									checkFuncName := getOrCreateCheckFunction(paramType, param.Type, typeName)
									if checkFuncName != "" {
										validation = generateCheckAndThrow(checkFuncName, paramName, paramName)
									}
								} else {
									// Generate inline validation without IIFE wrapper
									// Use continued validation after first param to avoid duplicate _io names
									if isFirstParam {
										validation = gen.GenerateInlineValidationFromNode(paramType, param.Type, paramName)
										isFirstParam = false
									} else {
										validation = gen.GenerateInlineValidationContinued(paramType, param.Type, paramName)
									}
								}
								if validation != "" {
									// Check if parameter is optional (has ? token or default value)
									isOptional := param.QuestionToken != nil || param.Initializer != nil

									var validationText string
									if isOptional {
										// Wrap in undefined check for optional params
										validationText = fmt.Sprintf(" if (%s !== undefined) { %s}", paramName, validation)
									} else {
										validationText = " " + validation
									}

									// Map to the parameter name (start of the param declaration)
									// This covers "name: Type" so errors point to the full param
									insertions = append(insertions, insertion{
										pos:       ctx.bodyStart,
										text:      validationText,
										sourcePos: paramPos,
									})
								}
								// Record this parameter as validated for this type
								ctx.validated[paramName] = append(ctx.validated[paramName], paramType)
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
								actualType, actualTypeNode := unwrapReturnType(returnType, ctx.returnType, ctx.isAsync, c)
								if actualType != nil && !shouldSkipType(actualType) && !shouldSkipComplexType(actualType, c) {
									if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
										arg := callExpr.Arguments.Nodes[0]
										argText := text[arg.Pos():arg.End()]

										if shouldUseReusableFilter(actualType, actualTypeNode) {
											// Use reusable filter function (type is used more than once)
											typeName := getTypeNameWithChecker(actualType, c)
											if typeName == "" {
												typeName = "value"
											}
											filterFuncName := getOrCreateFilterFunction(actualType, actualTypeNode, typeName)
											if filterFuncName != "" {
												// Generate: ((_f = _filter_X(JSON.parse(arg)))[0] !== null ? (() => { throw ... })() : _f[1])
												insertions = append(insertions, insertion{
													pos:       returnStmt.Expression.Pos(),
													text:      fmt.Sprintf(`((_f = %s(JSON.parse(%s)))[0] !== null ? (() => { throw new TypeError(_f[0].replace(/%%n/g, "JSON.parse")); })() : _f[1])`, filterFuncName, argText),
													sourcePos: ctx.returnType.Pos(),
													skipTo:    returnStmt.Expression.End(),
												})
												return false
											}
										}
										// Fallback to inline filter validator
										filteringValidator := gen.GenerateFilteringValidator(actualType, "")
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
					debugf("[DEBUG] Checking return type validation...\n")
					if config.ValidateReturns && returnType != nil && !shouldSkipType(returnType) && !shouldSkipComplexType(returnType, c) {
						debugf("[DEBUG] Return type not skipped, unwrapping...\n")
						// Get the actual return type (unwrap Promise for async functions)
						actualType, actualTypeNode := unwrapReturnType(returnType, ctx.returnType, ctx.isAsync, c)
						debugf("[DEBUG] Unwrapped return type, checking if skippable...\n")

						if !shouldSkipType(actualType) && !shouldSkipComplexType(actualType, c) {
							debugf("[DEBUG] Actual return type not skipped, validating...\n")
							// Check if the return expression is already validated
							vs := &validationState{validated: ctx.validated, checker: c}
							skipValidation := false

							// Check if the return expression itself is already validated
							if _, ok := vs.getValidatedType(returnStmt.Expression, actualType); ok {
								// Check if any variables in the expression have been dirtied
								rootVar := getRootIdentifier(returnStmt.Expression)
								if rootVar != "" {
									if !isDirty(c, ctx.validated, rootVar, ctx.bodyStart, node.Pos(), ctx.bodyNode, config.PureFunctions) {
										debugf("[DEBUG] Skipping validation for %s: already validated and not dirty\n", rootVar)
										skipValidation = true
									}
								}
							}

							// Note: We don't try to validate object literals { name, age } by checking
							// individual properties. That's too complex. We only skip validation when
							// returning a validated variable directly (or its properties).

							if skipValidation {
								// Emit /* already valid */ comment after "return "
								insertions = append(insertions, insertion{
									pos:       returnStmt.Expression.Pos(),
									text:      "/* already valid */",
									sourcePos: -1,
								})
							} else {
								// Set context for error messages
								returnPos := returnStmt.Pos()
								lineNum := getLineNumber(returnPos)
								gen.SetContext(fmt.Sprintf("return at line %d", lineNum))

								result := gen.GenerateValidatorFromNode(actualType, actualTypeNode, "")

								if result.Ignored {
									// Type was ignored - add a comment explaining why
									insertions = append(insertions, insertion{
										pos:       returnStmt.Expression.Pos(),
										text:      "/* validation skipped: " + result.IgnoredReason + " */",
										sourcePos: -1,
									})
								} else if result.Code != "" {
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
											text:      result.Code + "(",
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
											text:      ").then(_v => " + result.Code + `(_v, "return value"))`,
											sourcePos: returnTypePos,
										})
									} else {
										// Normal sync function
										// return expr; -> return validator(expr, "return value");
										insertions = append(insertions, insertion{
											pos:       exprStart,
											text:      result.Code + "(",
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
			}

		case ast.KindAsExpression:
			// Handle type cast validation: expr as Type
			// Also handle JSON.parse(x) as T and JSON.stringify(x) as T patterns
			asExpr := node.AsAsExpression()
			if asExpr != nil && asExpr.Type != nil {
				// Skip "as const" assertions - they're compile-time only
				// Check by looking at the source text since the AST node type varies
				if strings.TrimSpace(text[asExpr.Type.Pos():asExpr.Type.End()]) == "const" {
					return true // Continue visiting children but don't generate validation
				}

				// Skip "as unknown as T" or "as any as T" patterns - these are intentional type escapes
				// The inner expression is cast to any/unknown first, meaning the user is intentionally
				// bypassing type checking, so we shouldn't validate the final type either
				if asExpr.Expression.Kind == ast.KindAsExpression {
					innerAs := asExpr.Expression.AsAsExpression()
					if innerAs != nil && innerAs.Type != nil {
						innerTypeText := strings.TrimSpace(text[innerAs.Type.Pos():innerAs.Type.End()])
						if innerTypeText == "unknown" || innerTypeText == "any" {
							return true // Continue visiting but skip validation for this cast
						}
					}
				}
				castType := checker.Checker_getTypeFromTypeNode(c, asExpr.Type)
				skipType := castType == nil || shouldSkipType(castType)
				if !skipType {
					skipType = shouldSkipComplexType(castType, c)
				}
				if !skipType {
					castTypePos := asExpr.Type.Pos()

					// Check if inner expression is JSON.parse() or JSON.stringify()
					if asExpr.Expression.Kind == ast.KindCallExpression {
						innerCall := asExpr.Expression.AsCallExpression()
						if innerCall != nil {
							methodName, isJSON := getJSONMethodName(innerCall)
							if isJSON {
								// Handle JSON.parse(x) as T
								if methodName == "parse" && config.TransformJSONParse {
									if innerCall.Arguments != nil && len(innerCall.Arguments.Nodes) > 0 {
										arg := innerCall.Arguments.Nodes[0]
										argText := text[arg.Pos():arg.End()]

										if shouldUseReusableFilter(castType, asExpr.Type) {
											// Use reusable filter function (type is used more than once)
											typeName := getTypeNameWithChecker(castType, c)
											if typeName == "" {
												typeName = "value"
											}
											filterFuncName := getOrCreateFilterFunction(castType, asExpr.Type, typeName)
											if filterFuncName != "" {
												// Generate: ((_f = _filter_X(JSON.parse(arg)))[0] !== null ? (() => { throw ... })() : _f[1])
												insertions = append(insertions, insertion{
													pos:       node.Pos(),
													text:      fmt.Sprintf(`((_f = %s(JSON.parse(%s)))[0] !== null ? (() => { throw new TypeError(_f[0].replace(/%%n/g, "JSON.parse")); })() : _f[1])`, filterFuncName, argText),
													sourcePos: castTypePos,
													skipTo:    node.End(),
												})
												return false
											}
										}
										// Fallback to inline filter validator
										filteringValidator := gen.GenerateFilteringValidator(castType, "")
										insertions = append(insertions, insertion{
											pos:       node.Pos(),
											text:      filteringValidator + "(JSON.parse(" + argText + `), "JSON.parse")`,
											sourcePos: castTypePos,
											skipTo:    node.End(),
										})
										return false
									}
								}

								// Handle JSON.stringify(x) as T (less common but support it)
								if methodName == "stringify" && config.TransformJSONStringify {
									if innerCall.Arguments != nil && len(innerCall.Arguments.Nodes) > 0 {
										arg := innerCall.Arguments.Nodes[0]
										argText := text[arg.Pos():arg.End()]

										if shouldUseReusableFilter(castType, asExpr.Type) {
											// Use reusable filter function (type is used more than once)
											typeName := getTypeNameWithChecker(castType, c)
											if typeName == "" {
												typeName = "value"
											}
											filterFuncName := getOrCreateFilterFunction(castType, asExpr.Type, typeName)
											if filterFuncName != "" {
												// Generate: ((_f = _filter_X(arg))[0] !== null ? (() => { throw ... })() : JSON.stringify(_f[1]))
												insertions = append(insertions, insertion{
													pos:       node.Pos(),
													text:      fmt.Sprintf(`((_f = %s(%s))[0] !== null ? (() => { throw new TypeError(_f[0].replace(/%%n/g, "JSON.stringify")); })() : JSON.stringify(_f[1]))`, filterFuncName, argText),
													sourcePos: castTypePos,
													skipTo:    node.End(),
												})
												return false
											}
										}
										// Fallback to inline stringifier
										stringifier := gen.GenerateStringifier(castType, "")
										insertions = append(insertions, insertion{
											pos:       node.Pos(),
											text:      stringifier + "(" + argText + `, "JSON.stringify")`,
											sourcePos: castTypePos,
											skipTo:    node.End(),
										})
										return false
									}
								}
							}
						}
					}

					// Regular cast validation (not JSON)
					if config.ValidateCasts {
						// Set context for error messages
						castPos := node.Pos()
						lineNum := getLineNumber(castPos)
						gen.SetContext(fmt.Sprintf("cast at line %d", lineNum))

						// Get the expression text for error messages
						exprStart := asExpr.Expression.Pos()
						exprEnd := asExpr.Expression.End()
						exprText := text[exprStart:exprEnd]

						// Get type name for the check function
						typeName := getTypeNameWithChecker(castType, c)
						if typeName == "" {
							// Fallback for anonymous types
							typeName = "value"
						}

						if shouldUseReusableCheck(castType, asExpr.Type) {
							// Use reusable check function (type is used more than once)
							checkFuncName := getOrCreateCheckFunction(castType, asExpr.Type, typeName)
							if checkFuncName != "" {
								// Generate: if ((_e = _check_X(expr)) !== null) throw new TypeError(_e.replace(/%n/g, "expr"));
								checkAndThrow := generateCheckAndThrow(checkFuncName, text[exprStart:exprEnd], escapeString(exprText))
								insertions = append(insertions, insertion{
									pos:       node.Pos(),
									text:      "(" + checkAndThrow,
									sourcePos: castTypePos,
								})
								insertions = append(insertions, insertion{
									pos:       exprEnd,
									text:      ")/* as removed */",
									sourcePos: castTypePos,
								})
							}
						} else {
							// Inline validation
							debugf("[DEBUG] Generating validator for cast type...\n")
							result := gen.GenerateValidatorFromNode(castType, asExpr.Type, "")
							debugf("[DEBUG] Generated validator, length=%d, ignored=%v\n", len(result.Code), result.Ignored)

							if result.Ignored {
								// Type was ignored - add a comment explaining why
								insertions = append(insertions, insertion{
									pos:       node.Pos(),
									text:      "/* validation skipped: " + result.IgnoredReason + " */",
									sourcePos: -1,
								})
							} else if result.Code != "" {
								// Wrap the entire as expression
								// (expr as Type) -> validator(expr, "expr as Type")
								insertions = append(insertions, insertion{
									pos:       node.Pos(),
									text:      result.Code + "(",
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
			}

		case ast.KindCallExpression:
			// Handle JSON.parse and JSON.stringify transformations
			callExpr := node.AsCallExpression()
			if callExpr != nil {
				methodName, isJSON := getJSONMethodName(callExpr)
				if isJSON {
					// Try to get target type from various sources
					var targetType *checker.Type
					var targetTypeNode *ast.Node
					var sourcePos int = node.Pos()

					// 1. Check for explicit type argument: JSON.parse<T>()
					if callExpr.TypeArguments != nil && len(callExpr.TypeArguments.Nodes) > 0 {
						typeArgNode := callExpr.TypeArguments.Nodes[0]
						targetType = checker.Checker_getTypeFromTypeNode(c, typeArgNode)
						targetTypeNode = typeArgNode
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
									targetTypeNode = asExpr.Type
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
							if argType != nil && !shouldSkipType(argType) && !shouldSkipComplexType(argType, c) {
								// Only use inferred type if it's a concrete object type (not any/unknown)
								flags := checker.Type_flags(argType)
								if flags&checker.TypeFlagsObject != 0 || flags&checker.TypeFlagsUnion != 0 {
									targetType = argType
									targetTypeNode = nil // No explicit type node for inferred types
									sourcePos = arg.Pos()
								}
							}
						}
					}

					// Apply transformation if we have a target type
					if targetType != nil && !shouldSkipType(targetType) && !shouldSkipComplexType(targetType, c) {
						if methodName == "parse" && config.TransformJSONParse {
							if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
								arg := callExpr.Arguments.Nodes[0]
								argText := text[arg.Pos():arg.End()]

								if shouldUseReusableFilter(targetType, targetTypeNode) {
									// Use reusable filter function (type is used more than once)
									typeName := getTypeNameWithChecker(targetType, c)
									if typeName == "" {
										typeName = "value"
									}
									filterFuncName := getOrCreateFilterFunction(targetType, targetTypeNode, typeName)
									if filterFuncName != "" {
										// Generate: ((_f = _filter_X(JSON.parse(arg)))[0] !== null ? (() => { throw ... })() : _f[1])
										insertions = append(insertions, insertion{
											pos:       node.Pos(),
											text:      fmt.Sprintf(`((_f = %s(JSON.parse(%s)))[0] !== null ? (() => { throw new TypeError(_f[0].replace(/%%n/g, "JSON.parse")); })() : _f[1])`, filterFuncName, argText),
											sourcePos: sourcePos,
											skipTo:    node.End(),
										})
										return false
									}
								}
								// Fallback to inline filter validator
								filteringValidator := gen.GenerateFilteringValidator(targetType, "")
								insertions = append(insertions, insertion{
									pos:       node.Pos(),
									text:      filteringValidator + "(JSON.parse(" + argText + `), "JSON.parse")`,
									sourcePos: sourcePos,
									skipTo:    node.End(),
								})
								return false
							}
						} else if methodName == "stringify" && config.TransformJSONStringify {
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

								if shouldUseReusableFilter(targetType, targetTypeNode) {
									// Use reusable filter function (type is used more than once)
									typeName := getTypeNameWithChecker(targetType, c)
									if typeName == "" {
										typeName = "value"
									}
									filterFuncName := getOrCreateFilterFunction(targetType, targetTypeNode, typeName)
									if filterFuncName != "" {
										// Generate: ((_f = _filter_X(arg))[0] !== null ? (() => { throw ... })() : JSON.stringify(_f[1]))
										insertions = append(insertions, insertion{
											pos:       node.Pos(),
											text:      fmt.Sprintf(`((_f = %s(%s))[0] !== null ? (() => { throw new TypeError(_f[0].replace(/%%n/g, "JSON.stringify")); })() : JSON.stringify(_f[1]))`, filterFuncName, argText),
											sourcePos: sourcePos,
											skipTo:    node.End(),
										})
										return false
									}
								}
								// Fallback to inline stringifier
								stringifier := gen.GenerateStringifier(targetType, "")
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
			varDecl := node.AsVariableDeclaration()
			if varDecl != nil {
				// Get current function context
				var ctx *funcContext
				if len(funcStack) > 0 {
					ctx = funcStack[len(funcStack)-1]
				}

				// Handle: const x: T = JSON.parse(string)
				if config.TransformJSONParse && varDecl.Type != nil && varDecl.Initializer != nil {
					// Check if initializer is JSON.parse()
					if varDecl.Initializer.Kind == ast.KindCallExpression {
						callExpr := varDecl.Initializer.AsCallExpression()
						if callExpr != nil {
							methodName, isJSON := getJSONMethodName(callExpr)
							if isJSON && methodName == "parse" {
								targetType := checker.Checker_getTypeFromTypeNode(c, varDecl.Type)
								if targetType != nil && !shouldSkipType(targetType) && !shouldSkipComplexType(targetType, c) {
									if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
										arg := callExpr.Arguments.Nodes[0]
										argText := text[arg.Pos():arg.End()]

										if shouldUseReusableFilter(targetType, varDecl.Type) {
											// Use reusable filter function (type is used more than once)
											typeName := getTypeNameWithChecker(targetType, c)
											if typeName == "" {
												typeName = "value"
											}
											filterFuncName := getOrCreateFilterFunction(targetType, varDecl.Type, typeName)
											if filterFuncName != "" {
												// Generate: ((_f = _filter_X(JSON.parse(arg)))[0] !== null ? (() => { throw ... })() : _f[1])
												insertions = append(insertions, insertion{
													pos:       varDecl.Initializer.Pos(),
													text:      fmt.Sprintf(`((_f = %s(JSON.parse(%s)))[0] !== null ? (() => { throw new TypeError(_f[0].replace(/%%n/g, "JSON.parse")); })() : _f[1])`, filterFuncName, argText),
													sourcePos: varDecl.Type.Pos(),
													skipTo:    varDecl.Initializer.End(),
												})

												// Mark as validated
												if ctx != nil && varDecl.Name().Kind == ast.KindIdentifier {
													ctx.validated[varDecl.Name().AsIdentifier().Text] = append(ctx.validated[varDecl.Name().AsIdentifier().Text], targetType)
												}

												return false
											}
										}
										// Fallback to inline filter validator
										filteringValidator := gen.GenerateFilteringValidator(targetType, "")
										// Replace the JSON.parse call with filtered version
										insertions = append(insertions, insertion{
											pos:       varDecl.Initializer.Pos(),
											text:      filteringValidator + "(JSON.parse(" + argText + `), "JSON.parse")`,
											sourcePos: varDecl.Type.Pos(),
											skipTo:    varDecl.Initializer.End(),
										})

										// Mark as validated
										if ctx != nil && varDecl.Name().Kind == ast.KindIdentifier {
											ctx.validated[varDecl.Name().AsIdentifier().Text] = append(ctx.validated[varDecl.Name().AsIdentifier().Text], targetType)
										}

										return false
									}
								}
							}
						}
					}
				}

				// Handle aliasing, trusted functions, and cast expressions
				if ctx != nil && varDecl.Initializer != nil && varDecl.Name().Kind == ast.KindIdentifier {
					varName := varDecl.Name().AsIdentifier().Text

					// 1. Direct aliasing: const x = y
					if varDecl.Initializer.Kind == ast.KindIdentifier {
						initName := varDecl.Initializer.AsIdentifier().Text
						if types, ok := ctx.validated[initName]; ok {
							ctx.validated[varName] = append(ctx.validated[varName], types...)
						}
					} else if varDecl.Initializer.Kind == ast.KindCallExpression {
						// 2. Trusted function call: const x = trusted()
						call := varDecl.Initializer.AsCallExpression()
						if call != nil {
							funcName := getEntityName(call.Expression)
							isTrusted := false
							for _, re := range config.TrustedFunctions {
								if re.MatchString(funcName) {
									isTrusted = true
									break
								}
							}

							if isTrusted {
								// Get variable type (explicit or inferred)
								var targetType *checker.Type
								if varDecl.Type != nil {
									targetType = checker.Checker_getTypeFromTypeNode(c, varDecl.Type)
								} else {
									targetType = checker.Checker_GetTypeAtLocation(c, varDecl.Name())
								}

								if targetType != nil {
									ctx.validated[varName] = append(ctx.validated[varName], targetType)
								}
							}
						}
					} else if varDecl.Initializer.Kind == ast.KindAsExpression && config.ValidateCasts {
						// 3. Cast expression: const x = data as T
						asExpr := varDecl.Initializer.AsAsExpression()
						if asExpr != nil && asExpr.Type != nil {
							castType := checker.Checker_getTypeFromTypeNode(c, asExpr.Type)
							if castType != nil && !shouldSkipType(castType) && !shouldSkipComplexType(castType, c) {
								ctx.validated[varName] = append(ctx.validated[varName], castType)
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
	debugf("[DEBUG] Starting visitor for %s\n", fileName)
	sourceFile.AsNode().ForEachChild(visit)

	// Check for complexity errors from the generator
	if errMsg := gen.GetComplexityError(); errMsg != "" {
		return "", nil, fmt.Errorf("%s in file %s", errMsg, fileName)
	}

	debugf("[DEBUG] Visitor complete for %s, building source map with %d insertions...\n", fileName, len(insertions))

	// If reusable validators were generated, prepend them at the start of the file
	// Note: checkFunctions and filterFunctions only contain functions for types used more than once
	// (due to shouldUseReusableCheck/shouldUseReusableFilter checks)
	if len(checkFunctions) > 0 || len(filterFunctions) > 0 {
		var hoistedCode strings.Builder

		// Add the shared error variables
		if len(checkFunctions) > 0 {
			hoistedCode.WriteString("let _e: string | null;\n")
		}
		if len(filterFunctions) > 0 {
			hoistedCode.WriteString("let _f: [string | null, any];\n")
		}

		// Add check functions
		for _, code := range checkFunctions {
			hoistedCode.WriteString(code)
			hoistedCode.WriteString(";\n")
		}

		// Add filter functions
		for _, code := range filterFunctions {
			hoistedCode.WriteString(code)
			hoistedCode.WriteString(";\n")
		}

		// Insert at position 0 (start of file)
		insertions = append([]insertion{{
			pos:       0,
			text:      hoistedCode.String(),
			sourcePos: -1, // No source mapping for generated code
		}}, insertions...)

		debugf("[DEBUG] Hoisted %d check functions and %d filter functions\n",
			len(checkFunctions), len(filterFunctions))
	}

	// Build result with source map
	code, sourceMap := buildSourceMap(fileName, text, insertions)
	return code, sourceMap, nil
}

// MaxTypeComplexity is the maximum number of properties/constituents a type can have
// before we skip validation. This prevents hangs on complex generated types (e.g., from GraphQL codegen).
const MaxTypeComplexity = 50

// shouldSkipType returns true if the type should not be validated
func shouldSkipType(t *checker.Type) bool {
	flags := checker.Type_flags(t)
	// Skip any, unknown, never, void, type parameters (generics can't be validated at runtime),
	// conditional types, indexed access types, and substitution types (complex type-level operations)
	if flags&checker.TypeFlagsAny != 0 ||
		flags&checker.TypeFlagsUnknown != 0 ||
		flags&checker.TypeFlagsNever != 0 ||
		flags&checker.TypeFlagsVoid != 0 ||
		flags&checker.TypeFlagsTypeParameter != 0 ||
		flags&checker.TypeFlagsConditional != 0 ||
		flags&checker.TypeFlagsIndexedAccess != 0 ||
		flags&checker.TypeFlagsSubstitution != 0 ||
		flags&checker.TypeFlagsIndex != 0 {
		return true
	}

	return false
}

// shouldSkipComplexType checks if a type is too complex to validate efficiently.
// This is a more expensive check that requires the checker, so it's separate from shouldSkipType.
func shouldSkipComplexType(t *checker.Type, c *checker.Checker) bool {
	// Quick check for type parameters at top level only (no recursion into checker)
	flags := checker.Type_flags(t)
	if flags&checker.TypeFlagsTypeParameter != 0 {
		return true
	}

	// Skip checking union/intersection members and type arguments to avoid
	// expensive checker calls that can hang on complex types.
	// We'll let codegen handle these cases.
	return false
}

// containsTypeParameter recursively checks if a type contains any type parameters.
// Types with unresolved type parameters cannot be validated at runtime.
func containsTypeParameter(t *checker.Type, c *checker.Checker, depth int) bool {
	if depth > 10 {
		// Prevent infinite recursion
		return false
	}

	flags := checker.Type_flags(t)

	// Direct type parameter
	if flags&checker.TypeFlagsTypeParameter != 0 {
		return true
	}

	// Check union members
	if flags&checker.TypeFlagsUnion != 0 {
		for _, m := range t.Types() {
			if containsTypeParameter(m, c, depth+1) {
				return true
			}
		}
	}

	// Check intersection members
	if flags&checker.TypeFlagsIntersection != 0 {
		for _, m := range t.Types() {
			if containsTypeParameter(m, c, depth+1) {
				return true
			}
		}
	}

	// Check type arguments of generic instantiations (e.g., NullToUndefined<T>)
	// Only type references have type arguments, not all object types
	if flags&checker.TypeFlagsObject != 0 {
		objFlags := checker.Type_objectFlags(t)
		if objFlags&checker.ObjectFlagsReference != 0 {
			typeArgs := checker.Checker_getTypeArguments(c, t)
			for _, arg := range typeArgs {
				if containsTypeParameter(arg, c, depth+1) {
					return true
				}
			}
		}
	}

	return false
}

// isTypeComplex checks if a type has too many constituents to validate efficiently.
// It recursively counts properties and union members up to a limit.
func isTypeComplex(t *checker.Type, c *checker.Checker, depth int) bool {
	if depth > 5 {
		// Don't recurse too deep when checking complexity
		return false
	}

	flags := checker.Type_flags(t)

	// Check union types
	if flags&checker.TypeFlagsUnion != 0 {
		members := t.Types()
		if len(members) > MaxTypeComplexity {
			return true
		}
		// Check if any member is complex
		for _, m := range members {
			if isTypeComplex(m, c, depth+1) {
				return true
			}
		}
	}

	// Check intersection types
	if flags&checker.TypeFlagsIntersection != 0 {
		members := t.Types()
		if len(members) > MaxTypeComplexity {
			return true
		}
		for _, m := range members {
			if isTypeComplex(m, c, depth+1) {
				return true
			}
		}
	}

	// For object types, we don't call getPropertiesOfType as it can hang
	// on complex recursive types. Instead, we just accept object types
	// and let the codegen handle any complexity.

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

// isPrimitiveType checks if a type is a primitive (string, number, boolean, bigint, null, undefined, symbol)
func isPrimitiveType(t *checker.Type) bool {
	if t == nil {
		return false
	}
	flags := checker.Type_flags(t)
	// Check for primitive types
	return flags&(checker.TypeFlagsString|checker.TypeFlagsNumber|checker.TypeFlagsBoolean|
		checker.TypeFlagsBigInt|checker.TypeFlagsNull|checker.TypeFlagsUndefined|
		checker.TypeFlagsStringLiteral|checker.TypeFlagsNumberLiteral|checker.TypeFlagsBooleanLiteral|
		checker.TypeFlagsVoid|checker.TypeFlagsESSymbol|checker.TypeFlagsESSymbolLike) != 0
}

// sanitizeTypeName converts a type string to a valid JavaScript identifier.
// Replaces special characters with underscores.
func sanitizeTypeName(name string) string {
	var result strings.Builder
	for _, c := range name {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' {
			result.WriteRune(c)
		} else {
			result.WriteRune('_')
		}
	}
	return result.String()
}

// maxTypeNameLength is the maximum length for a sanitized type name before we truncate it
const maxTypeNameLength = 30

// generateFunctionName creates a function name for a type.
// For simple named types (like "User", "ArrayItem"), returns the clean name without suffix.
// For complex/anonymous types, always adds a numbered suffix for clarity (e.g., _check_object_0).
func generateFunctionName(prefix string, typeKey string, counter map[string]int, used map[string]bool) string {
	// Check if this is a simple named type (just an identifier, no special chars)
	if isSimpleIdentifier(typeKey) {
		// Simple named type - use clean name without suffix if available
		fullName := prefix + typeKey
		if !used[fullName] {
			used[fullName] = true
			return fullName
		}
		// Name collision with same simple type name, add a number
		counter[fullName]++
		numberedName := fmt.Sprintf("%s_%d", fullName, counter[fullName])
		used[numberedName] = true
		return numberedName
	}

	// Complex type - extract base name and always add a numbered suffix
	baseName := extractBaseTypeName(typeKey)
	sanitized := sanitizeTypeName(baseName)

	// Truncate if too long
	if len(sanitized) > maxTypeNameLength {
		sanitized = sanitized[:maxTypeNameLength]
	}

	baseWithPrefix := prefix + sanitized
	// Always add a number for complex types (starting from 0)
	idx := counter[baseWithPrefix]
	counter[baseWithPrefix]++
	numberedName := fmt.Sprintf("%s_%d", baseWithPrefix, idx)
	used[numberedName] = true
	return numberedName
}

// extractBaseTypeName extracts the primary type name from a type string.
// For example:
//   - "ArrayItem" -> "ArrayItem"
//   - "(ArrayItem & { age: number })[]" -> "ArrayItem_array"
//   - "{ foo: string }" -> "object"
//   - "string | number" -> "union"
func extractBaseTypeName(typeKey string) string {
	// Check for array types
	isArray := strings.HasSuffix(typeKey, "[]")
	if isArray {
		inner := strings.TrimSuffix(typeKey, "[]")
		baseName := extractBaseTypeName(inner)
		return baseName + "_array"
	}

	// Check for union types
	if strings.Contains(typeKey, " | ") {
		// Try to extract the first type name
		parts := strings.SplitN(typeKey, " | ", 2)
		firstType := extractBaseTypeName(strings.TrimSpace(parts[0]))
		if firstType != "object" && firstType != "union" && firstType != "intersection" {
			return firstType + "_union"
		}
		return "union"
	}

	// Check for intersection types (wrapped in parens)
	if strings.HasPrefix(typeKey, "(") && strings.Contains(typeKey, " & ") {
		// Try to extract the first type name from inside the parens
		inner := strings.TrimPrefix(typeKey, "(")
		if idx := strings.Index(inner, " & "); idx > 0 {
			firstType := extractBaseTypeName(strings.TrimSpace(inner[:idx]))
			if firstType != "object" && firstType != "union" && firstType != "intersection" {
				return firstType + "_intersection"
			}
		}
		return "intersection"
	}

	// Check for anonymous object types
	if strings.HasPrefix(typeKey, "{") {
		return "object"
	}

	// For simple named types, return as-is
	// Remove any brackets or special chars to get clean name
	clean := strings.TrimSpace(typeKey)
	// If it's a simple identifier, return it
	if isSimpleIdentifier(clean) {
		return clean
	}

	return "type"
}

// isSimpleIdentifier returns true if the string is a valid JavaScript identifier.
func isSimpleIdentifier(s string) bool {
	if len(s) == 0 {
		return false
	}
	for i, c := range s {
		if i == 0 {
			// First char must be letter or underscore
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_') {
				return false
			}
		} else {
			// Subsequent chars can be letter, digit, or underscore
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
				return false
			}
		}
	}
	return true
}

// getTypeName returns a stable name for a type, suitable for naming check functions.
// For primitives, returns the primitive name (e.g., "string", "number").
// For named types, returns the symbol name.
// For anonymous types, returns empty string.
func getTypeName(t *checker.Type) string {
	if t == nil {
		return ""
	}

	// Check symbol name first (for named types like interfaces)
	if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
		return sym.Name
	}

	// For primitives, return the type name
	flags := checker.Type_flags(t)
	switch {
	case flags&checker.TypeFlagsString != 0:
		return "string"
	case flags&checker.TypeFlagsNumber != 0:
		return "number"
	case flags&checker.TypeFlagsBoolean != 0:
		return "boolean"
	case flags&checker.TypeFlagsBigInt != 0:
		return "bigint"
	case flags&checker.TypeFlagsNull != 0:
		return "null"
	case flags&checker.TypeFlagsUndefined != 0:
		return "undefined"
	case flags&checker.TypeFlagsVoid != 0:
		return "void"
	case flags&checker.TypeFlagsESSymbol != 0, flags&checker.TypeFlagsESSymbolLike != 0:
		return "symbol"
	// Literal types - use base type name
	case flags&checker.TypeFlagsStringLiteral != 0:
		return "string"
	case flags&checker.TypeFlagsNumberLiteral != 0:
		return "number"
	case flags&checker.TypeFlagsBooleanLiteral != 0:
		return "boolean"
	}

	return ""
}

// getTypeNameWithChecker returns a descriptive name for a type, using the checker
// to extract element types for generic types. For ArrayItem[], returns "ArrayItem_Array".
// For Map<string, User>, returns "string_User_Map". For (Foo & Bar)[], returns "Foo_Bar_Array".
func getTypeNameWithChecker(t *checker.Type, c *checker.Checker) string {
	if t == nil {
		return ""
	}

	flags := checker.Type_flags(t)

	// Handle intersection types (Foo & Bar) - check BEFORE symbol name
	// because intersections may have a symbol but we want the component names
	if flags&checker.TypeFlagsIntersection != 0 {
		members := t.Types()
		if len(members) > 0 {
			var names []string
			for _, memberType := range members {
				name := getTypeNameWithChecker(memberType, c)
				if name != "" {
					names = append(names, name)
				}
			}
			if len(names) > 0 {
				return strings.Join(names, "_")
			}
		}
	}

	// Handle union types (Foo | Bar) - check BEFORE symbol name
	if flags&checker.TypeFlagsUnion != 0 {
		members := t.Types()
		if len(members) > 0 {
			var names []string
			for _, memberType := range members {
				name := getTypeNameWithChecker(memberType, c)
				if name != "" {
					names = append(names, name)
				}
			}
			if len(names) > 0 {
				return strings.Join(names, "_or_")
			}
		}
	}

	// Check symbol name for named types like interfaces
	if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
		symName := sym.Name

		// For generic types (Array, Map, Set, Promise, etc.), append type argument names
		if flags&checker.TypeFlagsObject != 0 {
			objFlags := checker.Type_objectFlags(t)
			if objFlags&checker.ObjectFlagsReference != 0 {
				typeArgs := checker.Checker_getTypeArguments(c, t)
				if len(typeArgs) > 0 {
					var argNames []string
					for _, arg := range typeArgs {
						argName := getTypeNameWithChecker(arg, c)
						if argName != "" {
							argNames = append(argNames, argName)
						}
					}
					if len(argNames) > 0 {
						// Format: ElementType_Array, Key_Value_Map, etc.
						return strings.Join(argNames, "_") + "_" + symName
					}
				}
			}
		}

		return symName
	}

	// Fall back to basic getTypeName for primitives
	return getTypeName(t)
}

// getRootIdentifier returns the root identifier from a property access chain.
// e.g., `user.address.city` → "user", `arr[0].name` → "arr", `x` → "x"
func getRootIdentifier(expr *ast.Node) string {
	if expr == nil {
		return ""
	}
	switch expr.Kind {
	case ast.KindIdentifier:
		return expr.AsIdentifier().Text
	case ast.KindPropertyAccessExpression:
		propAccess := expr.AsPropertyAccessExpression()
		if propAccess != nil {
			return getRootIdentifier(propAccess.Expression)
		}
	case ast.KindElementAccessExpression:
		elemAccess := expr.AsElementAccessExpression()
		if elemAccess != nil {
			return getRootIdentifier(elemAccess.Expression)
		}
	}
	return ""
}

// isIdentifier checks if an expression is an identifier with the given name
func isIdentifier(expr *ast.Node, name string) bool {
	if expr != nil && expr.Kind == ast.KindIdentifier {
		return expr.AsIdentifier().Text == name
	}
	return false
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

// validationState holds state for checking if an expression is already validated
type validationState struct {
	validated map[string][]*checker.Type
	checker   *checker.Checker
}

// getValidatedType checks if an expression is already validated and returns the type if so.
// It handles identifiers, property access (user.name), and element access (arr[0]).
// Returns (validatedType, true) if the expression has a validated type assignable to targetType,
// or (nil, false) if not validated or not assignable.
func (vs *validationState) getValidatedType(expr *ast.Node, targetType *checker.Type) (*checker.Type, bool) {
	if expr == nil || vs.validated == nil {
		return nil, false
	}

	switch expr.Kind {
	case ast.KindIdentifier:
		name := expr.AsIdentifier().Text
		if types, ok := vs.validated[name]; ok {
			for _, t := range types {
				// If targetType is nil, just check if anything is validated
				if targetType == nil {
					return t, true
				}
				// Check if validated type is assignable to target type
				if checker.Checker_isTypeAssignableTo(vs.checker, t, targetType) {
					return t, true
				}
			}
		}
		return nil, false

	case ast.KindPropertyAccessExpression:
		propAccess := expr.AsPropertyAccessExpression()
		if propAccess == nil {
			return nil, false
		}

		// Get type of the parent expression (recursively)
		parentType, ok := vs.getValidatedType(propAccess.Expression, nil)
		if !ok {
			return nil, false
		}

		// Get the property type from the parent type
		propName := ""
		nameNode := propAccess.Name()
		if nameNode != nil && nameNode.Kind == ast.KindIdentifier {
			propName = nameNode.AsIdentifier().Text
		}
		if propName == "" {
			return nil, false
		}

		propSymbol := checker.Checker_getPropertyOfType(vs.checker, parentType, propName)
		if propSymbol == nil {
			return nil, false
		}
		propType := checker.Checker_getTypeOfSymbol(vs.checker, propSymbol)

		// Check if property type is assignable to target
		if targetType == nil {
			return propType, true
		}
		if checker.Checker_isTypeAssignableTo(vs.checker, propType, targetType) {
			return propType, true
		}
		return nil, false

	case ast.KindElementAccessExpression:
		elemAccess := expr.AsElementAccessExpression()
		if elemAccess == nil {
			return nil, false
		}

		// Get type of the parent expression (recursively)
		parentType, ok := vs.getValidatedType(elemAccess.Expression, nil)
		if !ok {
			return nil, false
		}

		// Get element type for arrays
		if checker.Checker_isArrayType(vs.checker, parentType) {
			typeArgs := checker.Checker_getTypeArguments(vs.checker, parentType)
			if len(typeArgs) > 0 {
				elemType := typeArgs[0]
				if targetType == nil {
					return elemType, true
				}
				if checker.Checker_isTypeAssignableTo(vs.checker, elemType, targetType) {
					return elemType, true
				}
			}
		}
		return nil, false
	}
	return nil, false
}

// isDirty checks if a variable has been modified or potentially mutated between two positions.
// It considers type-aware rules: primitives are only dirty on reassignment,
// objects are dirty if passed to functions (unless the passed value is a primitive property).
func isDirty(c *checker.Checker, validated map[string][]*checker.Type, varName string, fromPos int, toPos int, bodyNode *ast.Node, pureFunctions []*regexp.Regexp) bool {
	if bodyNode == nil {
		return false
	}

	// Get the validated type to determine if it's a primitive
	var validatedType *checker.Type
	if types, ok := validated[varName]; ok && len(types) > 0 {
		validatedType = types[0]
	}
	varIsPrimitive := isPrimitiveType(validatedType)

	dirty := false
	leaked := false // Track if object reference has been "leaked" (passed to a function)

	var check func(n *ast.Node) bool
	check = func(n *ast.Node) bool {
		if dirty {
			return false // Already dirty, stop checking
		}

		pos := n.Pos()
		// Only check nodes between fromPos and toPos
		if pos < fromPos || pos >= toPos {
			// Still need to recurse into children that might overlap
			n.ForEachChild(check)
			return false
		}

		switch n.Kind {
		case ast.KindBinaryExpression:
			bin := n.AsBinaryExpression()
			if bin != nil {
				opKind := bin.OperatorToken.Kind
				// Check for assignment operators
				if opKind == ast.KindEqualsToken ||
					opKind == ast.KindPlusEqualsToken ||
					opKind == ast.KindMinusEqualsToken ||
					opKind == ast.KindAsteriskEqualsToken ||
					opKind == ast.KindSlashEqualsToken {
					// Direct assignment: varName = ...
					if isIdentifier(bin.Left, varName) {
						dirty = true
						return false
					}
					// Property/element assignment: varName.prop = ... or varName[i] = ...
					if !varIsPrimitive && getRootIdentifier(bin.Left) == varName {
						dirty = true
						return false
					}
				}
			}

		case ast.KindCallExpression:
			if varIsPrimitive {
				// Primitives are copied when passed, so calls don't dirty them
				break
			}
			// Check if varName (or any nested property containing an object) is passed as argument
			call := n.AsCallExpression()
			if call != nil && call.Arguments != nil {
				// Check if the called function is pure/readonly
				isPure := false
				if len(pureFunctions) > 0 {
					funcName := getEntityName(call.Expression)
					if funcName != "" {
						for _, re := range pureFunctions {
							if re.MatchString(funcName) {
								isPure = true
								break
							}
						}
					}
				}

				if !isPure {
					for _, arg := range call.Arguments.Nodes {
						root := getRootIdentifier(arg)
						if root == varName {
							// Check what's actually being passed
							// If it's the whole object or an object property, it's dirty
							// If it's a primitive property, it's not dirty
							argType := checker.Checker_GetTypeAtLocation(c, arg)
							if !isPrimitiveType(argType) {
								leaked = true
								dirty = true
								return false
							}
						}
					}
				}
			}

		case ast.KindAwaitExpression:
			// Await only dirties if the object was leaked before
			if !varIsPrimitive && leaked {
				dirty = true
				return false
			}

		case ast.KindPostfixUnaryExpression:
			// x++, x--
			postfix := n.AsPostfixUnaryExpression()
			if postfix != nil && isIdentifier(postfix.Operand, varName) {
				dirty = true
				return false
			}

		case ast.KindPrefixUnaryExpression:
			// ++x, --x
			prefix := n.AsPrefixUnaryExpression()
			if prefix != nil {
				if prefix.Operator == ast.KindPlusPlusToken || prefix.Operator == ast.KindMinusMinusToken {
					if isIdentifier(prefix.Operand, varName) {
						dirty = true
						return false
					}
				}
			}
		}

		// Continue checking children
		n.ForEachChild(check)
		return false
	}

	bodyNode.ForEachChild(check)
	return dirty
}

// getEntityName extracts the full name from an entity name (identifier or qualified name).
// For qualified names like `React.FormEvent`, it returns the full dotted path.
func getEntityName(node *ast.Node) string {
	if node == nil {
		return ""
	}

	switch node.Kind {
	case ast.KindIdentifier:
		return node.AsIdentifier().Text
	case ast.KindQualifiedName:
		qn := node.AsQualifiedName()
		if qn != nil {
			left := getEntityName(qn.Left)
			right := ""
			if qn.Right != nil {
				right = qn.Right.Text()
			}
			if left != "" && right != "" {
				return left + "." + right
			}
			if right != "" {
				return right
			}
			return left
		}
	case ast.KindPropertyAccessExpression:
		// Also handle PropertyAccessExpression (e.g. console.log)
		pa := node.AsPropertyAccessExpression()
		if pa != nil {
			left := getEntityName(pa.Expression)
			right := ""
			if pa.Name() != nil {
				right = pa.Name().AsIdentifier().Text
			}
			if left != "" && right != "" {
				return left + "." + right
			}
		}
	}

	return ""
}

func hasIgnoreComment(node *ast.Node, text string) bool {
	pos := node.Pos()
	limit := pos + 500
	if limit > len(text) {
		limit = len(text)
	}
	chunk := text[pos:limit]

	return ignoreCommentRegex.MatchString(chunk)
}

// typeInfo stores information about a type for the first pass
type typeInfo struct {
	t        *checker.Type
	typeNode *ast.Node
	typeName string
}

