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

	// Helper to skip leading trivia (whitespace) - must match analyse package
	skipTrivia := func(pos int) int {
		for pos < len(text) {
			ch := text[pos]
			if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
				pos++
			} else {
				break
			}
		}
		return pos
	}

	// Helper to get "line:col" key for skipped returns lookup (1-based line, 0-based col)
	getPosKey := func(pos int) string {
		pos = skipTrivia(pos) // Skip leading whitespace to match analyse package
		line, col := posToLineCol(pos, lineStarts)
		return fmt.Sprintf("%d:%d", line+1, col) // 1-based line, 0-based col
	}

	// Create generator with config's max functions limit and ignore patterns
	maxFuncs := config.MaxGeneratedFunctions
	if maxFuncs == 0 {
		maxFuncs = DefaultMaxGeneratedFunctions
	}
	gen := codegen.NewGeneratorWithIgnoreTypes(c, program, maxFuncs, config.IgnoreTypes)

	// Collect all insertions (position -> text to insert)
	var insertions []insertion

	// Track reusable validators - hoisted to module scope when used more than once
	// Maps type key -> generated function code
	checkFunctions := make(map[string]string)      // _check_X functions for validation
	filterFunctions := make(map[string]string)     // _filter_X functions for JSON.parse/stringify
	checkFunctionNames := make(map[string]string)  // type key -> function name
	filterFunctionNames := make(map[string]string) // type key -> function name
	usedCheckNames := make(map[string]bool)        // track which function names are in use
	usedFilterNames := make(map[string]bool)       // track which function names are in use
	checkNameCounter := make(map[string]int)       // base name -> next suffix counter
	filterNameCounter := make(map[string]int)      // base name -> next suffix counter

	// Pre-computed type usage counts from first pass
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

	// Run unified analysis pass - this gives us:
	// 1. Type usage counts for reusable validators
	// 2. Validation items with already-valid detection
	analyseConfig := analyse.Config{
		ValidateParameters:     config.ValidateParameters,
		ValidateReturns:        config.ValidateReturns,
		ValidateCasts:          config.ValidateCasts,
		TransformJSONParse:     config.TransformJSONParse,
		TransformJSONStringify: config.TransformJSONStringify,
		IgnoreTypes:            config.IgnoreTypes,
		PureFunctions:          config.PureFunctions,
		TrustedFunctions:       config.TrustedFunctions,
	}
	analyseResult := analyse.AnalyseFile(sourceFile, c, program, analyseConfig)

	// Build lookup for skipped returns (already validated)
	// Key is "line:column" of the return expression
	skippedReturns := make(map[string]bool)
	for _, item := range analyseResult.Items {
		if item.Kind == "return" && item.Status == "skipped" && item.SkipReason == "already validated" {
			key := fmt.Sprintf("%d:%d", item.StartLine, item.StartColumn)
			skippedReturns[key] = true
		}
	}

	// Build lookup for dirty external args (dirty values passed to external functions)
	// Key is "callPos:argIndex:argPos" - includes argPos to handle chained calls
	// where multiple calls share the same callPos but have different argument positions
	dirtyExternalArgs := make(map[string]*analyse.DirtyExternalArg)
	for i := range analyseResult.DirtyExternalArgs {
		arg := &analyseResult.DirtyExternalArgs[i]
		key := fmt.Sprintf("%d:%d:%d", arg.CallPos, arg.ArgIndex, arg.ArgPos)
		dirtyExternalArgs[key] = arg
	}

	// Copy type usage results from analysis pass
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

	// shouldUseReusable returns true if we should use a reusable function for this type
	// Hoist only if used more than once
	shouldUseReusableCheck := func(t *checker.Type, typeNode *ast.Node) bool {
		key := getTypeKey(t, typeNode)
		return checkTypeUsage[key] > 1
	}

	shouldUseReusableFilter := func(t *checker.Type, typeNode *ast.Node) bool {
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
	// Pattern: if ((_e = _check_Type(value, "name")) !== null) throw new TypeError(_e);
	generateCheckAndThrow := func(checkFuncName, valueExpr, nameStr string) string {
		return fmt.Sprintf(`if ((_e = %s(%s, "%s")) !== null) throw new TypeError(_e); `,
			checkFuncName, valueExpr, nameStr)
	}

	// Track which function we're currently in for return statement handling
	type funcContext struct {
		returnType *ast.Node
		isAsync    bool
		bodyStart  int                        // Position after opening brace
		validated  map[string][]*checker.Type // varName -> list of validated types
		bodyNode   *ast.Node                  // Function body for dirty detection
		funcKey    string                     // Unique key for cross-file analysis
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
					funcKey:    getFunctionKey(sourceFile, fn),
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

					params := fn.Parameters()
					for paramIdx, param := range params {
						// Check if cross-file analysis determined we can skip this parameter
						if canSkipParamValidation(config, ctx.funcKey, paramIdx) {
							// Add a comment explaining why validation is skipped
							paramName := getParamName(param)
							if paramName != "" {
								comment := fmt.Sprintf("/* %s: validated by callers */", paramName)
								insertions = append(insertions, insertion{
									pos:       ctx.bodyStart,
									text:      " " + comment,
									sourcePos: param.Pos(),
								})
							}
							continue
						}

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

					// Check if return expression is an "as" cast (but NOT "as const")
					// If it's a real type cast, skip return validation and let KindAsExpression handle it.
					// For "as const", we still want to validate the return type.
					if returnStmt.Expression.Kind == ast.KindAsExpression {
						asExpr := returnStmt.Expression.AsAsExpression()
						if asExpr != nil && asExpr.Type != nil {
							typeText := strings.TrimSpace(text[asExpr.Type.Pos():asExpr.Type.End()])
							if typeText != "const" {
								// Real type cast - let KindAsExpression handler deal with it
								break
							}
							// "as const" - fall through to do normal return validation
						}
					}

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
													text:      fmt.Sprintf(`((_f = %s(JSON.parse(%s), "JSON.parse"))[0] !== null ? (() => { throw new TypeError(_f[0]); })() : _f[1])`, filterFuncName, argText),
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
							// Check if the return expression is already validated (from analyse pass)
							exprPosKey := getPosKey(returnStmt.Expression.Pos())
							skipValidation := skippedReturns[exprPosKey]
							if skipValidation {
								debugf("[DEBUG] Skipping validation: already validated (from analyse)\n")
							}

							// Check project analysis: is return expression a validated variable?
							if !skipValidation && isValidatedVariable(config, ctx.funcKey, returnStmt.Expression, returnStmt.Expression.Pos()) {
								skipValidation = true
								debugf("[DEBUG] Skipping validation: validated variable (project analysis)\n")
							}

							// Also check cross-file analysis: is return from a validated function?
							if !skipValidation && isReturnFromValidatedFunction(config, c, returnStmt.Expression) {
								skipValidation = true
								debugf("[DEBUG] Skipping validation: return from validated function (cross-file)\n")
							}

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

								// Get expression positions
								exprStart := returnStmt.Expression.Pos()
								exprEnd := returnStmt.Expression.End()

								// Get the source position of the return type annotation
								returnTypePos := ctx.returnType.Pos()

								// Get type name for the check function
								typeName := getTypeNameWithChecker(actualType, c)
								if typeName == "" {
									typeName = "value"
								}

								if shouldUseReusableCheck(actualType, actualTypeNode) {
									// Use reusable check function (type is used more than once)
									checkFuncName := getOrCreateCheckFunction(actualType, actualTypeNode, typeName)
									if checkFuncName != "" {
										// Generate expression-compatible pattern using ternary:
										// return ((_e = _check_X(expr, "return value")) !== null ? (() => { throw new TypeError(_e); })() : expr);
										if ctx.isAsync {
											// Async function: Promise is automatically unwrapped
											insertions = append(insertions, insertion{
												pos:       exprStart,
												text:      fmt.Sprintf(`((_e = %s(`, checkFuncName),
												sourcePos: returnTypePos,
											})
											insertions = append(insertions, insertion{
												pos:       exprEnd,
												text:      `, "return value")) !== null ? (() => { throw new TypeError(_e); })() : ` + text[exprStart:exprEnd] + `)`,
												sourcePos: returnTypePos,
											})
										} else if isPromiseType(returnType, c) {
											// Sync function returning Promise: add .then()
											insertions = append(insertions, insertion{
												pos:       exprStart,
												text:      "(",
												sourcePos: returnTypePos,
											})
											insertions = append(insertions, insertion{
												pos:       exprEnd,
												text:      fmt.Sprintf(`).then(_v => ((_e = %s(_v, "return value")) !== null ? (() => { throw new TypeError(_e); })() : _v))`, checkFuncName),
												sourcePos: returnTypePos,
											})
										} else {
											// Normal sync function
											insertions = append(insertions, insertion{
												pos:       exprStart,
												text:      fmt.Sprintf(`((_e = %s(`, checkFuncName),
												sourcePos: returnTypePos,
											})
											insertions = append(insertions, insertion{
												pos:       exprEnd,
												text:      `, "return value")) !== null ? (() => { throw new TypeError(_e); })() : ` + text[exprStart:exprEnd] + `)`,
												sourcePos: returnTypePos,
											})
										}
									}
								} else {
									// Inline validation
									result := gen.GenerateValidatorFromNode(actualType, actualTypeNode, "")

									if result.Ignored {
										// Type was ignored - add a comment explaining why
										insertions = append(insertions, insertion{
											pos:       returnStmt.Expression.Pos(),
											text:      "/* validation skipped: " + result.IgnoredReason + " */",
											sourcePos: -1,
										})
									} else if result.Code != "" {
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
													text:      fmt.Sprintf(`((_f = %s(JSON.parse(%s), "JSON.parse"))[0] !== null ? (() => { throw new TypeError(_f[0]); })() : _f[1])`, filterFuncName, argText),
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
													text:      fmt.Sprintf(`((_f = %s(%s, "JSON.stringify"))[0] !== null ? (() => { throw new TypeError(_f[0]); })() : JSON.stringify(_f[1]))`, filterFuncName, argText),
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
						exprText := strings.TrimSpace(text[exprStart:exprEnd])

						// Get type name for the check function
						typeName := getTypeNameWithChecker(castType, c)
						if typeName == "" {
							// Fallback for anonymous types
							typeName = "value"
						}

						// Get the type text for the cast (e.g., "DBUser" from "u as DBUser")
						typeText := strings.TrimSpace(text[asExpr.Type.Pos():asExpr.Type.End()])

						if shouldUseReusableCheck(castType, asExpr.Type) {
							// Use reusable check function (type is used more than once)
							checkFuncName := getOrCreateCheckFunction(castType, asExpr.Type, typeName)
							if checkFuncName != "" {
								// Generate expression-compatible pattern:
								// ((_e = _check_X(expr, "name")) !== null ? (() => { throw new TypeError(_e); })() : expr as Type)
								// The final "as Type" preserves TypeScript's type narrowing
								escapedName := escapeString(exprText)
								insertions = append(insertions, insertion{
									pos:       node.Pos(),
									text:      fmt.Sprintf(`((_e = %s(%s, "%s")) !== null ? (() => { throw new TypeError(_e); })() : %s as %s)`, checkFuncName, exprText, escapedName, exprText, typeText),
									sourcePos: castTypePos,
									skipTo:    node.End(),
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
								// (expr as Type) -> validator(expr, "expr")
								// Use skipTo to skip the entire "as Type" part
								insertions = append(insertions, insertion{
									pos:       node.Pos(),
									text:      result.Code + "(" + exprText + `, "` + escapeString(exprText) + `")`,
									sourcePos: castTypePos,
									skipTo:    node.End(),
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
											text:      fmt.Sprintf(`((_f = %s(JSON.parse(%s), "JSON.parse"))[0] !== null ? (() => { throw new TypeError(_f[0]); })() : _f[1])`, filterFuncName, argText),
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
											text:      fmt.Sprintf(`((_f = %s(%s, "JSON.stringify"))[0] !== null ? (() => { throw new TypeError(_f[0]); })() : JSON.stringify(_f[1]))`, filterFuncName, argText),
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

			// Handle dirty values passed to external functions
			// The analyse pass identified arguments that need validation
			if callExpr.Arguments != nil {
				// Get current function context for project analysis checks
				var currentFuncKey string
				if len(funcStack) > 0 {
					currentFuncKey = funcStack[len(funcStack)-1].funcKey
				}

				// Use the position of the opening paren (node.End() is after the closing paren)
				// For chained calls like Object.keys(x).map(y), node.Pos() returns the same
				// position for both calls, but the argument positions are unique
				callPos := node.Pos()
				for argIdx, arg := range callExpr.Arguments.Nodes {
					// Use argument position as part of the key to ensure uniqueness
					// This handles chained calls where multiple calls share the same start position
					key := fmt.Sprintf("%d:%d:%d", callPos, argIdx, arg.Pos())
					dirtyArg, needsValidation := dirtyExternalArgs[key]
					if !needsValidation {
						continue
					}

					// Skip if project analysis knows this variable is validated
					// (e.g., assigned from a function that validates its return)
					if currentFuncKey != "" && isValidatedVariable(config, currentFuncKey, arg, arg.Pos()) {
						continue
					}

					// Get type info for the validator
					argType := dirtyArg.Type
					if argType == nil {
						continue
					}

					// Get type name for the check function
					typeName := getTypeNameWithChecker(argType, c)
					if typeName == "" {
						typeName = dirtyArg.VarName
					}

					argText := text[arg.Pos():arg.End()]

					// Check if we should use a reusable check function
					typeKey := c.TypeToString(argType)
					if checkTypeUsage[typeKey] > 1 {
						// Use reusable check function
						checkFuncName := getOrCreateCheckFunction(argType, nil, typeName)
						if checkFuncName != "" {
							// Wrap the argument: ((_e = _check_X(arg)) !== null ? (() => { throw ... })() : arg)
							escapedName := escapeString(argText)
							insertions = append(insertions, insertion{
								pos:       arg.Pos(),
								text:      fmt.Sprintf(`((_e = %s(%s, "%s")) !== null ? (() => { throw new TypeError(_e); })() : %s)`, checkFuncName, argText, escapedName, argText),
								sourcePos: arg.Pos(),
								skipTo:    arg.End(),
							})
							continue
						}
					}

					// Use inline validation
					result := gen.GenerateValidator(argType, "")
					if result.Code != "" && !result.Ignored {
						// Wrap: validator(arg, "argName")
						insertions = append(insertions, insertion{
							pos:       arg.Pos(),
							text:      result.Code + "(" + argText + `, "` + escapeString(argText) + `")`,
							sourcePos: arg.Pos(),
							skipTo:    arg.End(),
						})
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
													text:      fmt.Sprintf(`((_f = %s(JSON.parse(%s), "JSON.parse"))[0] !== null ? (() => { throw new TypeError(_f[0]); })() : _f[1])`, filterFuncName, argText),
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

				// Handle unvalidated call results: const x = externalFunc()
				// These are calls to functions that don't validate their returns
				// Adds validation after the assignment: const x = externalFunc(); if ((_e = _check_X(x)) !== null) throw ...
				if config.ProjectAnalysis != nil && varDecl.Initializer != nil && varDecl.Initializer.Kind == ast.KindCallExpression {
					callPos := varDecl.Initializer.Pos()
					if unvalidatedCall, exists := config.ProjectAnalysis.UnvalidatedCallResults[callPos]; exists {
						// Get type info
						targetType := unvalidatedCall.Type
						typeNode := unvalidatedCall.TypeNode

						if targetType != nil && !shouldSkipType(targetType) && !shouldSkipComplexType(targetType, c) {
							callStart := varDecl.Initializer.Pos()

							// Get type name for the check function
							typeName := getTypeNameWithChecker(targetType, c)
							if typeName == "" {
								typeName = "value"
							}

							varName := unvalidatedCall.VarName

							// Use hoisted check function for the validation
							// Insert after the declaration: ; if ((_e = _check_X(varName)) !== null) throw ...
							// Source map points to the call expression so errors show the external call
							checkFuncName := getOrCreateCheckFunction(targetType, typeNode, typeName)
							if checkFuncName != "" {
								// Insert right after the variable declaration ends
								// Need semicolon before the if statement
								insertPos := node.End()

								insertions = append(insertions, insertion{
									pos:       insertPos,
									text:      fmt.Sprintf(`; if ((_e = %s(%s, "%s")) !== null) throw new TypeError(_e)`, checkFuncName, varName, varName),
									sourcePos: callStart,
								})

								// Mark as validated in context
								if ctx != nil && varDecl.Name().Kind == ast.KindIdentifier {
									ctx.validated[varDecl.Name().AsIdentifier().Text] = append(ctx.validated[varDecl.Name().AsIdentifier().Text], targetType)
								}

								return true
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

		case ast.KindBinaryExpression:
			// Handle: x.prop = JSON.parse(string) or x = JSON.parse(string)
			bin := node.AsBinaryExpression()
			if bin == nil || bin.OperatorToken.Kind != ast.KindEqualsToken {
				break
			}

			// Check if RHS is JSON.parse call
			if config.TransformJSONParse && bin.Right.Kind == ast.KindCallExpression {
				callExpr := bin.Right.AsCallExpression()
				if callExpr != nil {
					methodName, isJSON := getJSONMethodName(callExpr)
					if isJSON && methodName == "parse" {
						// Get target type from the LHS
						targetType := checker.Checker_GetTypeAtLocation(c, bin.Left)
						if targetType != nil && !shouldSkipType(targetType) && !shouldSkipComplexType(targetType, c) {
							if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
								arg := callExpr.Arguments.Nodes[0]
								argText := text[arg.Pos():arg.End()]

								if shouldUseReusableFilter(targetType, nil) {
									// Use reusable filter function (type is used more than once)
									typeName := getTypeNameWithChecker(targetType, c)
									if typeName == "" {
										typeName = "value"
									}
									filterFuncName := getOrCreateFilterFunction(targetType, nil, typeName)
									if filterFuncName != "" {
										// Generate: ((_f = _filter_X(JSON.parse(arg)))[0] !== null ? (() => { throw ... })() : _f[1])
										insertions = append(insertions, insertion{
											pos:       bin.Right.Pos(),
											text:      fmt.Sprintf(`((_f = %s(JSON.parse(%s), "JSON.parse"))[0] !== null ? (() => { throw new TypeError(_f[0]); })() : _f[1])`, filterFuncName, argText),
											sourcePos: bin.Left.Pos(),
											skipTo:    bin.Right.End(),
										})
										return false
									}
								}
								// Fallback to inline filter validator
								filteringValidator := gen.GenerateFilteringValidator(targetType, "")
								// Replace the JSON.parse call with filtered version
								insertions = append(insertions, insertion{
									pos:       bin.Right.Pos(),
									text:      filteringValidator + "(JSON.parse(" + argText + `), "JSON.parse")`,
									sourcePos: bin.Left.Pos(),
									skipTo:    bin.Right.End(),
								})
								return false
							}
						}
					}
				}
			}

			// Handle unvalidated call results in reassignments: user4 = step3(user3)
			if config.ProjectAnalysis != nil && bin.Right.Kind == ast.KindCallExpression {
				callPos := bin.Right.Pos()
				if unvalidatedCall, exists := config.ProjectAnalysis.UnvalidatedCallResults[callPos]; exists {
					// Get type info
					targetType := unvalidatedCall.Type
					typeNode := unvalidatedCall.TypeNode

					if targetType != nil && !shouldSkipType(targetType) && !shouldSkipComplexType(targetType, c) {
						callStart := bin.Right.Pos()

						// Get type name for the check function
						typeName := getTypeNameWithChecker(targetType, c)
						if typeName == "" {
							typeName = "value"
						}

						varName := unvalidatedCall.VarName

						// Use hoisted check function for the validation
						// Insert after the expression statement: ; if ((_e = _check_X(varName)) !== null) throw ...
						checkFuncName := getOrCreateCheckFunction(targetType, typeNode, typeName)
						if checkFuncName != "" {
							// Insert right after the binary expression ends
							insertPos := node.End()

							insertions = append(insertions, insertion{
								pos:       insertPos,
								text:      fmt.Sprintf(`; if ((_e = %s(%s, "%s")) !== null) throw new TypeError(_e)`, checkFuncName, varName, varName),
								sourcePos: callStart,
							})

							// Mark as validated in context
							if len(funcStack) > 0 {
								if ctx := funcStack[len(funcStack)-1]; ctx != nil {
									ctx.validated[varName] = append(ctx.validated[varName], targetType)
								}
							}

							return true
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

		debugf("[DEBUG] Hoisted %d check functions, %d filter functions\n",
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

// getParamName delegates to the exported analyse.GetParamName.
func getParamName(param *ast.ParameterDeclaration) string {
	return analyse.GetParamName(param)
}

// functionLike wraps analyse.FunctionLike for local use.
type functionLike struct {
	inner *analyse.FunctionLike
}

func getFunctionLike(node *ast.Node) *functionLike {
	inner := analyse.GetFunctionLike(node)
	if inner == nil {
		return nil
	}
	return &functionLike{inner: inner}
}

func (f *functionLike) Parameters() []*ast.ParameterDeclaration {
	if f == nil || f.inner == nil {
		return nil
	}
	return f.inner.Parameters()
}

func (f *functionLike) Type() *ast.Node {
	if f == nil || f.inner == nil {
		return nil
	}
	return f.inner.Type()
}

func (f *functionLike) Body() *ast.Node {
	if f == nil || f.inner == nil {
		return nil
	}
	return f.inner.Body()
}

func (f *functionLike) IsAsync() bool {
	if f == nil || f.inner == nil {
		return false
	}
	return f.inner.IsAsync()
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

// getJSONMethodName delegates to the exported analyse.GetJSONMethodName.
func getJSONMethodName(callExpr *ast.CallExpression) (string, bool) {
	return analyse.GetJSONMethodName(callExpr)
}

// getEntityName delegates to the exported analyse.GetEntityName.
func getEntityName(node *ast.Node) string {
	return analyse.GetEntityName(node)
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

// getFunctionKey generates a key for looking up a function in the project analysis.
func getFunctionKey(sourceFile *ast.SourceFile, fn *functionLike) string {
	fileName := sourceFile.FileName()
	name := fn.Name()
	if name != "" {
		return fmt.Sprintf("%s:%s", fileName, name)
	}
	return fmt.Sprintf("%s:anonymous@%d", fileName, fn.inner.Node.Pos())
}

// Name returns the function name (delegates to inner FunctionLike).
func (f *functionLike) Name() string {
	if f == nil || f.inner == nil {
		return ""
	}
	return f.inner.Name()
}

// canSkipParamValidation checks if parameter validation can be skipped based on project analysis.
func canSkipParamValidation(config Config, funcKey string, paramIndex int) bool {
	if config.ProjectAnalysis == nil {
		return false
	}
	funcInfo := config.ProjectAnalysis.GetFunctionInfo(funcKey)
	if funcInfo == nil {
		return false
	}
	if paramIndex >= len(funcInfo.CanSkipParamValidation) {
		return false
	}
	return funcInfo.CanSkipParamValidation[paramIndex]
}

// isReturnFromValidatedFunction checks if an expression is a call to a function that validates its return.
func isReturnFromValidatedFunction(config Config, c *checker.Checker, node *ast.Node) bool {
	if config.ProjectAnalysis == nil || c == nil || node == nil {
		return false
	}
	if node.Kind != ast.KindCallExpression {
		return false
	}

	callExpr := node.AsCallExpression()
	if callExpr == nil {
		return false
	}

	// Resolve the callee type
	calleeType := checker.Checker_GetTypeAtLocation(c, callExpr.Expression)
	if calleeType == nil {
		return false
	}

	// Get the callee symbol
	calleeSym := checker.Type_symbol(calleeType)
	if calleeSym == nil {
		return false
	}

	// Try to find the function in our project analysis
	for _, decl := range calleeSym.Declarations {
		sf := ast.GetSourceFileOfNode(decl)
		if sf == nil {
			continue
		}
		declFileName := sf.FileName()

		// Skip external files
		if strings.Contains(declFileName, "node_modules") || strings.HasSuffix(declFileName, ".d.ts") {
			continue
		}

		// Try to find the function key
		funcName := ""
		if calleeSym.Name != "" {
			funcName = calleeSym.Name
		}

		// Try different key formats
		possibleKey := fmt.Sprintf("%s:%s", declFileName, funcName)
		if funcInfo := config.ProjectAnalysis.GetFunctionInfo(possibleKey); funcInfo != nil {
			if funcInfo.ValidatesReturn {
				return true
			}
		}

		// Also try with position
		posKey := fmt.Sprintf("%s:anonymous@%d", declFileName, decl.Pos())
		if funcInfo := config.ProjectAnalysis.GetFunctionInfo(posKey); funcInfo != nil {
			if funcInfo.ValidatesReturn {
				return true
			}
		}
	}

	return false
}

// isValidatedVariable checks if an expression is a variable that's been validated in the current function.
// This uses project analysis's ValidatedVariables and checks dirty tracking.
func isValidatedVariable(config Config, funcKey string, node *ast.Node, nodePos int) bool {
	if config.ProjectAnalysis == nil || node == nil {
		return false
	}

	// Get variable name from the expression
	varName := getRootIdentifierName(node)
	if varName == "" {
		return false
	}

	// Use project analysis's exported function which does dirty checking
	analyseConfig := analyse.Config{
		PureFunctions: config.PureFunctions,
	}
	result := analyse.IsVariableValidAtPosition(config.ProjectAnalysis, funcKey, varName, nodePos, analyseConfig)
	debugf("[DEBUG] isValidatedVariable: funcKey=%s varName=%s pos=%d result=%v\n", funcKey, varName, nodePos, result)
	return result
}

// getRootIdentifierName extracts the root identifier name from an expression.
func getRootIdentifierName(node *ast.Node) string {
	if node == nil {
		return ""
	}
	switch node.Kind {
	case ast.KindIdentifier:
		return node.AsIdentifier().Text
	case ast.KindPropertyAccessExpression:
		pae := node.AsPropertyAccessExpression()
		if pae != nil {
			return getRootIdentifierName(pae.Expression)
		}
	case ast.KindElementAccessExpression:
		eae := node.AsElementAccessExpression()
		if eae != nil {
			return getRootIdentifierName(eae.Expression)
		}
	}
	return ""
}

