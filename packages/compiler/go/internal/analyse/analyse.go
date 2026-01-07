// Package analyse provides unified analysis of TypeScript source files for validation.
// It performs a single AST pass that returns both:
// - ValidationItems for VSCode extension visualisation
// - Type usage counts for transform's reusable validators
package analyse

import (
	"regexp"
	"strings"

	"github.com/elliots/typical/packages/compiler/internal/utils"
	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/checker"
	"github.com/microsoft/typescript-go/shim/compiler"
)

// ValidationItem represents a single validation point in the source code.
// This is used by the VSCode extension to show validation indicators.
type ValidationItem struct {
	StartLine   int    // 1-based line number
	StartColumn int    // 0-based column
	EndLine     int    // 1-based line number
	EndColumn   int    // 0-based column
	Kind        string // "parameter", "return", "cast", "json-parse", "json-stringify"
	Name        string // param name, "return value", or expression text
	Status      string // "validated" or "skipped"
	TypeString  string // e.g. "User", "string | null"
	SkipReason  string // reason for skipping (when status is "skipped")
}

// TypeInfo holds type information for code generation.
type TypeInfo struct {
	Type     *checker.Type
	TypeNode *ast.Node
	TypeName string
}

// Result contains the analysis results.
type Result struct {
	// Items contains all validation points found in the file
	Items []ValidationItem

	// CheckTypeUsage maps type keys to usage counts for check validators
	CheckTypeUsage map[string]int

	// FilterTypeUsage maps type keys to usage counts for filter validators
	FilterTypeUsage map[string]int

	// CheckTypeObjects maps type keys to type info for code generation
	CheckTypeObjects map[string]TypeInfo

	// FilterTypeObjects maps type keys to type info for code generation
	FilterTypeObjects map[string]TypeInfo
}

// Config specifies which validations to analyse.
type Config struct {
	ValidateParameters     bool
	ValidateReturns        bool
	ValidateCasts          bool
	TransformJSONParse     bool
	TransformJSONStringify bool
	IgnoreTypes            []*regexp.Regexp
}

// AnalyseFile performs a single AST pass over the source file.
// It collects validation items (for VSCode) and type usage counts (for transform).
func AnalyseFile(sourceFile *ast.SourceFile, c *checker.Checker, program *compiler.Program, config Config) *Result {
	text := sourceFile.Text()
	lineStarts := computeLineStarts(text)

	result := &Result{
		Items:             make([]ValidationItem, 0),
		CheckTypeUsage:    make(map[string]int),
		FilterTypeUsage:   make(map[string]int),
		CheckTypeObjects:  make(map[string]TypeInfo),
		FilterTypeObjects: make(map[string]TypeInfo),
	}

	// Track visited types to prevent infinite recursion
	visitedTypes := make(map[string]bool)

	// Track already processed nodes to avoid duplicates
	processedNodes := make(map[int]bool)

	// Helper functions for type classification
	isBuiltinClassType := func(t *checker.Type) bool {
		if program == nil {
			return false
		}
		sym := checker.Type_symbol(t)
		if sym == nil {
			return false
		}
		if !utils.IsSymbolFromDefaultLibrary(program, sym) {
			return false
		}
		staticType := checker.Checker_getTypeOfSymbol(c, sym)
		if staticType != nil {
			if len(utils.GetConstructSignatures(c, staticType)) > 0 {
				return true
			}
		}
		if sym.Flags&ast.SymbolFlagsClass != 0 {
			return true
		}
		return false
	}

	isPrimitiveType := func(t *checker.Type) bool {
		flags := checker.Type_flags(t)
		return flags&(checker.TypeFlagsString|checker.TypeFlagsNumber|checker.TypeFlagsBoolean|
			checker.TypeFlagsBigInt|checker.TypeFlagsESSymbol|checker.TypeFlagsNull|
			checker.TypeFlagsUndefined|checker.TypeFlagsVoid|
			checker.TypeFlagsStringLiteral|checker.TypeFlagsNumberLiteral|checker.TypeFlagsBooleanLiteral|
			checker.TypeFlagsBigIntLiteral) != 0
	}

	isFunctionType := func(t *checker.Type) bool {
		callSigs := checker.Checker_getSignaturesOfType(c, t, checker.SignatureKindCall)
		if len(callSigs) > 0 {
			return true
		}
		constructSigs := checker.Checker_getSignaturesOfType(c, t, checker.SignatureKindConstruct)
		if len(constructSigs) > 0 {
			return true
		}
		if sym := checker.Type_symbol(t); sym != nil {
			if sym.Name == "Function" {
				return true
			}
		}
		return false
	}

	// getTypeKey returns a stable key for a type
	getTypeKey := func(t *checker.Type, typeNode *ast.Node) string {
		typeStr := c.TypeToString(t)
		if typeStr != "" {
			return typeStr
		}
		return ""
	}

	// getSkipReason returns a human-readable reason for skipping a type
	getSkipReason := func(t *checker.Type) string {
		if t == nil {
			return "type is nil"
		}
		flags := checker.Type_flags(t)
		if flags&checker.TypeFlagsAny != 0 {
			return "type is 'any'"
		}
		if flags&checker.TypeFlagsUnknown != 0 {
			return "type is 'unknown'"
		}
		if flags&checker.TypeFlagsNever != 0 {
			return "type is 'never'"
		}
		if flags&checker.TypeFlagsVoid != 0 {
			return "type is 'void'"
		}
		if flags&checker.TypeFlagsTypeParameter != 0 {
			return "type contains generic parameter (cannot validate at runtime)"
		}
		if flags&checker.TypeFlagsConditional != 0 {
			return "type is conditional"
		}
		if flags&checker.TypeFlagsIndexedAccess != 0 {
			return "type uses indexed access"
		}
		// Check ignore patterns
		if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
			for _, pattern := range config.IgnoreTypes {
				if pattern.MatchString(sym.Name) {
					return "type matches ignore pattern"
				}
			}
		}
		return ""
	}

	// shouldSkipType checks if a type should be skipped
	shouldSkipType := func(t *checker.Type) bool {
		if t == nil {
			return true
		}
		flags := checker.Type_flags(t)
		return flags&checker.TypeFlagsAny != 0 ||
			flags&checker.TypeFlagsUnknown != 0 ||
			flags&checker.TypeFlagsNever != 0 ||
			flags&checker.TypeFlagsVoid != 0 ||
			flags&checker.TypeFlagsTypeParameter != 0 ||
			flags&checker.TypeFlagsConditional != 0 ||
			flags&checker.TypeFlagsIndexedAccess != 0 ||
			flags&checker.TypeFlagsSubstitution != 0 ||
			flags&checker.TypeFlagsIndex != 0
	}

	// countNestedTypes recursively counts named types within properties
	var countNestedTypes func(t *checker.Type, usage map[string]int, types map[string]TypeInfo)
	countNestedTypes = func(t *checker.Type, usage map[string]int, types map[string]TypeInfo) {
		if t == nil || shouldSkipType(t) {
			return
		}

		typeStr := c.TypeToString(t)
		if visitedTypes[typeStr] {
			return
		}
		visitedTypes[typeStr] = true
		defer delete(visitedTypes, typeStr)

		flags := checker.Type_flags(t)
		objectFlags := checker.Type_objectFlags(t)
		isArray := checker.Checker_isArrayType(c, t)

		if flags&checker.TypeFlagsObject != 0 && !isArray {
			if isBuiltinClassType(t) {
				return
			}
			if isFunctionType(t) {
				return
			}
			if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
				if !strings.HasPrefix(sym.Name, "__") {
					key := getTypeKey(t, nil)
					usage[key]++
					if _, exists := types[key]; !exists {
						types[key] = TypeInfo{Type: t, TypeNode: nil, TypeName: sym.Name}
					}
				}
			}

			if objectFlags&(checker.ObjectFlagsInterface|checker.ObjectFlagsAnonymous|checker.ObjectFlagsReference) != 0 {
				props := checker.Checker_getPropertiesOfType(c, t)
				for _, prop := range props {
					propType := checker.Checker_getTypeOfSymbol(c, prop)
					if propType != nil {
						countNestedTypes(propType, usage, types)
					}
				}
			}
		}

		if isArray {
			typeArgs := checker.Checker_getTypeArguments(c, t)
			if len(typeArgs) > 0 {
				countNestedTypes(typeArgs[0], usage, types)
			}
		}

		if flags&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
			for _, constituent := range t.Types() {
				countNestedTypes(constituent, usage, types)
			}
		}
	}

	// addValidationItem adds a validation item to the result
	addValidationItem := func(node *ast.Node, endNode *ast.Node, kind, name string, t *checker.Type, isSkipped bool, skipReason string) {
		// Skip leading trivia (whitespace) to get accurate start position
		startPos := skipLeadingTrivia(text, node.Pos())

		// Deduplicate by start position and kind
		key := startPos*100 + len(kind) // Simple hash combining position and kind
		if processedNodes[key] {
			return
		}
		processedNodes[key] = true

		startLine, startCol := posToLineCol(startPos, lineStarts)
		var endLine, endCol int
		if endNode != nil {
			endLine, endCol = posToLineCol(endNode.End(), lineStarts)
		} else {
			endLine, endCol = posToLineCol(node.End(), lineStarts)
		}

		status := "validated"
		if isSkipped {
			status = "skipped"
		}

		typeStr := ""
		if t != nil {
			typeStr = c.TypeToString(t)
		}

		result.Items = append(result.Items, ValidationItem{
			StartLine:   startLine + 1, // Convert to 1-based
			StartColumn: startCol,
			EndLine:     endLine + 1,
			EndColumn:   endCol,
			Kind:        kind,
			Name:        name,
			Status:      status,
			TypeString:  typeStr,
			SkipReason:  skipReason,
		})
	}

	// countCheck increments usage for a check function type
	countCheck := func(t *checker.Type, typeNode *ast.Node, node *ast.Node, kind, name string) {
		if t == nil {
			return
		}

		skipReason := getSkipReason(t)
		if skipReason != "" {
			addValidationItem(node, typeNode, kind, name, t, true, skipReason)
			return
		}

		// Record the validation item
		addValidationItem(node, typeNode, kind, name, t, false, "")

		// Skip counting for hoisting if it's a builtin/primitive/function type
		if isBuiltinClassType(t) || isPrimitiveType(t) || isFunctionType(t) {
			return
		}

		key := getTypeKey(t, typeNode)
		result.CheckTypeUsage[key]++

		if _, exists := result.CheckTypeObjects[key]; !exists {
			typeName := ""
			if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
				typeName = sym.Name
			}
			result.CheckTypeObjects[key] = TypeInfo{Type: t, TypeNode: typeNode, TypeName: typeName}
		}

		// Count nested types
		flags := checker.Type_flags(t)
		isArray := checker.Checker_isArrayType(c, t)

		if flags&checker.TypeFlagsObject != 0 && !isArray {
			objectFlags := checker.Type_objectFlags(t)
			if objectFlags&(checker.ObjectFlagsInterface|checker.ObjectFlagsAnonymous|checker.ObjectFlagsReference) != 0 {
				props := checker.Checker_getPropertiesOfType(c, t)
				for _, prop := range props {
					propType := checker.Checker_getTypeOfSymbol(c, prop)
					if propType != nil {
						countNestedTypes(propType, result.CheckTypeUsage, result.CheckTypeObjects)
					}
				}
			}
		}

		if isArray {
			typeArgs := checker.Checker_getTypeArguments(c, t)
			if len(typeArgs) > 0 {
				countNestedTypes(typeArgs[0], result.CheckTypeUsage, result.CheckTypeObjects)
			}
		}

		if flags&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
			for _, constituent := range t.Types() {
				countNestedTypes(constituent, result.CheckTypeUsage, result.CheckTypeObjects)
			}
		}
	}

	// countFilter increments usage for a filter function type
	countFilter := func(t *checker.Type, typeNode *ast.Node, node *ast.Node, kind, name string) {
		if t == nil {
			return
		}

		skipReason := getSkipReason(t)
		if skipReason != "" {
			addValidationItem(node, typeNode, kind, name, t, true, skipReason)
			return
		}

		addValidationItem(node, typeNode, kind, name, t, false, "")

		if isBuiltinClassType(t) || isPrimitiveType(t) || isFunctionType(t) {
			return
		}

		key := getTypeKey(t, typeNode)
		result.FilterTypeUsage[key]++

		if _, exists := result.FilterTypeObjects[key]; !exists {
			typeName := ""
			if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
				typeName = sym.Name
			}
			result.FilterTypeObjects[key] = TypeInfo{Type: t, TypeNode: typeNode, TypeName: typeName}
		}

		// Count nested types
		flags := checker.Type_flags(t)
		isArray := checker.Checker_isArrayType(c, t)

		if flags&checker.TypeFlagsObject != 0 && !isArray {
			objectFlags := checker.Type_objectFlags(t)
			if objectFlags&(checker.ObjectFlagsInterface|checker.ObjectFlagsAnonymous|checker.ObjectFlagsReference) != 0 {
				props := checker.Checker_getPropertiesOfType(c, t)
				for _, prop := range props {
					propType := checker.Checker_getTypeOfSymbol(c, prop)
					if propType != nil {
						countNestedTypes(propType, result.FilterTypeUsage, result.FilterTypeObjects)
					}
				}
			}
		}

		if isArray {
			typeArgs := checker.Checker_getTypeArguments(c, t)
			if len(typeArgs) > 0 {
				countNestedTypes(typeArgs[0], result.FilterTypeUsage, result.FilterTypeObjects)
			}
		}

		if flags&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
			for _, constituent := range t.Types() {
				countNestedTypes(constituent, result.FilterTypeUsage, result.FilterTypeObjects)
			}
		}
	}

	// getParamName extracts parameter name from AST
	getParamName := func(param *ast.ParameterDeclaration) string {
		nameNode := param.Name()
		if nameNode == nil {
			return ""
		}
		if nameNode.Kind == ast.KindIdentifier {
			return nameNode.AsIdentifier().Text
		}
		return ""
	}

	// getJSONMethodName checks if a call expression is JSON.parse or JSON.stringify
	getJSONMethodName := func(callExpr *ast.CallExpression) (methodName string, isJSON bool) {
		if callExpr.Expression.Kind != ast.KindPropertyAccessExpression {
			return "", false
		}
		propAccess := callExpr.Expression.AsPropertyAccessExpression()
		if propAccess == nil {
			return "", false
		}
		if propAccess.Expression.Kind != ast.KindIdentifier {
			return "", false
		}
		objName := propAccess.Expression.AsIdentifier().Text
		if objName != "JSON" {
			return "", false
		}
		nameNode := propAccess.Name()
		if nameNode == nil {
			return "", false
		}
		methodName = nameNode.Text()
		if methodName == "parse" || methodName == "stringify" {
			return methodName, true
		}
		return "", false
	}

	// functionLike provides a common interface for function-like nodes
	type functionLike struct {
		node *ast.Node
	}

	getFunctionLike := func(node *ast.Node) *functionLike {
		switch node.Kind {
		case ast.KindFunctionDeclaration,
			ast.KindFunctionExpression,
			ast.KindArrowFunction,
			ast.KindMethodDeclaration:
			return &functionLike{node: node}
		}
		return nil
	}

	getFunctionType := func(f *functionLike) *ast.Node {
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

	getFunctionParameters := func(f *functionLike) []*ast.ParameterDeclaration {
		var list *ast.NodeList
		switch f.node.Kind {
		case ast.KindFunctionDeclaration:
			list = f.node.AsFunctionDeclaration().Parameters
		case ast.KindFunctionExpression:
			list = f.node.AsFunctionExpression().Parameters
		case ast.KindArrowFunction:
			list = f.node.AsArrowFunction().Parameters
		case ast.KindMethodDeclaration:
			list = f.node.AsMethodDeclaration().Parameters
		}
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

	hasAsyncModifier := func(modifiers *ast.ModifierList) bool {
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

	isFunctionAsync := func(f *functionLike) bool {
		switch f.node.Kind {
		case ast.KindFunctionDeclaration:
			return hasAsyncModifier(f.node.AsFunctionDeclaration().Modifiers())
		case ast.KindFunctionExpression:
			return hasAsyncModifier(f.node.AsFunctionExpression().Modifiers())
		case ast.KindArrowFunction:
			return hasAsyncModifier(f.node.AsArrowFunction().Modifiers())
		case ast.KindMethodDeclaration:
			return hasAsyncModifier(f.node.AsMethodDeclaration().Modifiers())
		}
		return false
	}

	// Ensure functions are used (avoid compiler errors)
	_ = getFunctionType
	_ = getFunctionParameters
	_ = isFunctionAsync

	// hasIgnoreComment checks for @typical-ignore comment
	hasIgnoreComment := func(node *ast.Node, text string) bool {
		// Check preceding comment
		pos := node.Pos()
		// Look backwards for comment
		for i := pos - 1; i >= 0 && i > pos-200; i-- {
			if text[i] == '/' && i > 0 {
				if text[i-1] == '/' {
					// Line comment
					lineStart := i - 1
					lineEnd := pos
					for j := i + 1; j < len(text) && text[j] != '\n'; j++ {
						lineEnd = j + 1
					}
					if lineEnd > lineStart && strings.Contains(text[lineStart:lineEnd], "@typical-ignore") {
						return true
					}
					break
				}
				if i > 0 && text[i-1] == '*' && i > 1 {
					// Block comment end - search for start
					for j := i - 2; j >= 0; j-- {
						if j > 0 && text[j] == '*' && text[j-1] == '/' {
							if strings.Contains(text[j-1:i+1], "@typical-ignore") {
								return true
							}
							break
						}
					}
				}
			}
			if text[i] != ' ' && text[i] != '\t' && text[i] != '\n' && text[i] != '\r' {
				break
			}
		}
		return false
	}

	// Track function context for return type analysis
	type funcContext struct {
		returnType *ast.Node
		isAsync    bool
	}
	var funcStack []*funcContext

	// Main visitor
	var visit ast.Visitor
	visit = func(node *ast.Node) bool {
		if hasIgnoreComment(node, text) {
			return false
		}

		switch node.Kind {
		case ast.KindFunctionDeclaration,
			ast.KindFunctionExpression,
			ast.KindArrowFunction,
			ast.KindMethodDeclaration:

			fn := getFunctionLike(node)
			if fn == nil {
				break
			}

			// Push function context
			ctx := &funcContext{
				returnType: getFunctionType(fn),
				isAsync:    isFunctionAsync(fn),
			}
			funcStack = append(funcStack, ctx)
			defer func() { funcStack = funcStack[:len(funcStack)-1] }()

			// Analyse parameters
			if config.ValidateParameters {
				for _, param := range getFunctionParameters(fn) {
					if param.Type != nil {
						paramType := checker.Checker_getTypeFromTypeNode(c, param.Type)
						paramName := getParamName(param)
						if paramName == "" {
							paramName = "(destructured)"
						}
						// Only highlight the parameter name, not the type annotation
						countCheck(paramType, param.Name(), param.Name(), "parameter", paramName)
					}
				}
			}

			// Analyse return type annotation (if present)
			if config.ValidateReturns && ctx.returnType != nil {
				returnType := checker.Checker_getTypeFromTypeNode(c, ctx.returnType)
				if returnType != nil {
					actualType := unwrapPromiseType(returnType, ctx.isAsync, c)
					// Use the return type node for both start and end position
					countCheck(actualType, ctx.returnType, ctx.returnType, "return-type", "return type")
				}
			}

		case ast.KindReturnStatement:
			if len(funcStack) == 0 {
				break
			}
			ctx := funcStack[len(funcStack)-1]
			returnStmt := node.AsReturnStatement()
			if returnStmt == nil || returnStmt.Expression == nil || ctx.returnType == nil {
				break
			}

			returnType := checker.Checker_getTypeFromTypeNode(c, ctx.returnType)

			// Check for JSON.parse in return
			if config.TransformJSONParse && returnStmt.Expression.Kind == ast.KindCallExpression {
				callExpr := returnStmt.Expression.AsCallExpression()
				if callExpr != nil {
					methodName, isJSON := getJSONMethodName(callExpr)
					if isJSON && methodName == "parse" {
						actualType := unwrapPromiseType(returnType, ctx.isAsync, c)
						countFilter(actualType, ctx.returnType, returnStmt.Expression, "json-parse", "JSON.parse return")
						return false
					}
				}
			}

			// Regular return validation - highlight just the return expression
			if config.ValidateReturns && returnType != nil {
				actualType := unwrapPromiseType(returnType, ctx.isAsync, c)
				// Use the expression for both start and end position (not the type annotation)
				countCheck(actualType, returnStmt.Expression, returnStmt.Expression, "return", "return value")
			}

		case ast.KindAsExpression:
			asExpr := node.AsAsExpression()
			if asExpr == nil || asExpr.Type == nil {
				break
			}

			// Skip "as const"
			typeText := strings.TrimSpace(text[asExpr.Type.Pos():asExpr.Type.End()])
			if typeText == "const" {
				return true
			}

			// Skip "as unknown as T" or "as any as T" patterns
			if asExpr.Expression.Kind == ast.KindAsExpression {
				innerAs := asExpr.Expression.AsAsExpression()
				if innerAs != nil && innerAs.Type != nil {
					innerTypeText := strings.TrimSpace(text[innerAs.Type.Pos():innerAs.Type.End()])
					if innerTypeText == "unknown" || innerTypeText == "any" {
						return true
					}
				}
			}

			castType := checker.Checker_getTypeFromTypeNode(c, asExpr.Type)
			exprText := text[asExpr.Expression.Pos():asExpr.Expression.End()]
			if len(exprText) > 30 {
				exprText = exprText[:27] + "..."
			}

			// Check for JSON.parse/stringify in cast
			if asExpr.Expression.Kind == ast.KindCallExpression {
				innerCall := asExpr.Expression.AsCallExpression()
				if innerCall != nil {
					methodName, isJSON := getJSONMethodName(innerCall)
					if isJSON {
						if methodName == "parse" && config.TransformJSONParse {
							countFilter(castType, asExpr.Type, node, "json-parse", "JSON.parse as "+typeText)
							return false
						}
						if methodName == "stringify" && config.TransformJSONStringify {
							countFilter(castType, asExpr.Type, node, "json-stringify", "JSON.stringify as "+typeText)
							return false
						}
					}
				}
			}

			// Regular cast
			if config.ValidateCasts {
				// Check if this cast is the initializer of a variable declaration
				// If so, highlight the variable name instead of the whole cast
				highlightNode := node
				if node.Parent != nil && node.Parent.Kind == ast.KindVariableDeclaration {
					varDecl := node.Parent.AsVariableDeclaration()
					if varDecl != nil && varDecl.Name() != nil {
						highlightNode = varDecl.Name()
					}
				}
				countCheck(castType, highlightNode, highlightNode, "cast", exprText+" as "+typeText)
			}

		case ast.KindCallExpression:
			callExpr := node.AsCallExpression()
			if callExpr == nil {
				break
			}

			methodName, isJSON := getJSONMethodName(callExpr)
			if !isJSON {
				break
			}

			var targetType *checker.Type
			var targetTypeNode *ast.Node

			// Check for explicit type argument: JSON.parse<User>(...)
			if callExpr.TypeArguments != nil && len(callExpr.TypeArguments.Nodes) > 0 {
				typeArgNode := callExpr.TypeArguments.Nodes[0]
				targetType = checker.Checker_getTypeFromTypeNode(c, typeArgNode)
				targetTypeNode = typeArgNode
			}

			if targetType != nil {
				if methodName == "parse" && config.TransformJSONParse {
					countFilter(targetType, targetTypeNode, node, "json-parse", "JSON.parse<...>")
					return false
				}
				if methodName == "stringify" && config.TransformJSONStringify {
					countFilter(targetType, targetTypeNode, node, "json-stringify", "JSON.stringify<...>")
					return false
				}
			}

		case ast.KindVariableDeclaration:
			varDecl := node.AsVariableDeclaration()
			if varDecl == nil || varDecl.Type == nil || varDecl.Initializer == nil {
				break
			}

			if !config.TransformJSONParse {
				break
			}

			if varDecl.Initializer.Kind != ast.KindCallExpression {
				break
			}

			callExpr := varDecl.Initializer.AsCallExpression()
			if callExpr == nil {
				break
			}

			methodName, isJSON := getJSONMethodName(callExpr)
			if !isJSON || methodName != "parse" {
				break
			}

			targetType := checker.Checker_getTypeFromTypeNode(c, varDecl.Type)
			countFilter(targetType, varDecl.Type, node, "json-parse", "JSON.parse variable")
			return false
		}

		node.ForEachChild(visit)
		return false
	}

	sourceFile.AsNode().ForEachChild(visit)
	return result
}

// computeLineStarts returns byte positions where each line starts (0-indexed)
func computeLineStarts(text string) []int {
	starts := []int{0}
	for i := 0; i < len(text); i++ {
		if text[i] == '\n' {
			starts = append(starts, i+1)
		}
	}
	return starts
}

// skipLeadingTrivia returns the position after any leading whitespace
func skipLeadingTrivia(text string, pos int) int {
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

// posToLineCol converts a byte position to 0-based line and column
func posToLineCol(pos int, lineStarts []int) (line, col int) {
	// Binary search for the line
	lo, hi := 0, len(lineStarts)
	for lo < hi {
		mid := (lo + hi) / 2
		if lineStarts[mid] > pos {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	line = lo - 1
	if line < 0 {
		line = 0
	}
	col = pos - lineStarts[line]
	return
}

// unwrapPromiseType extracts the type T from Promise<T> for async functions
func unwrapPromiseType(t *checker.Type, isAsync bool, c *checker.Checker) *checker.Type {
	if !isAsync || t == nil {
		return t
	}

	// Check if it's a Promise type
	sym := checker.Type_symbol(t)
	if sym == nil || sym.Name != "Promise" {
		return t
	}

	// Get type arguments
	typeArgs := checker.Checker_getTypeArguments(c, t)
	if len(typeArgs) > 0 {
		return typeArgs[0]
	}

	return t
}
