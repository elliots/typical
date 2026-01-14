// Package analyse provides unified analysis of TypeScript source files for validation.
// It performs a single AST pass that returns both:
// - ValidationItems for VSCode extension visualisation
// - Type usage counts for transform's reusable validators
package analyse

import (
	"regexp"
	"strconv"
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

	// DirtyExternalArgs contains info about dirty values passed to external functions
	DirtyExternalArgs []DirtyExternalArg
}

// DirtyExternalArg describes a dirty value being passed to an external function call.
type DirtyExternalArg struct {
	// CallPos is the position of the call expression
	CallPos int

	// ArgIndex is the 0-based index of the argument in the call
	ArgIndex int

	// ArgPos is the start position of the argument expression
	ArgPos int

	// ArgEnd is the end position of the argument expression
	ArgEnd int

	// Type is the type of the argument that needs validation
	Type *checker.Type

	// VarName is the root variable name being passed
	VarName string
}

// Config specifies which validations to analyse.
type Config struct {
	ValidateParameters     bool
	ValidateReturns        bool
	ValidateCasts          bool
	TransformJSONParse     bool
	TransformJSONStringify bool
	IgnoreTypes            []*regexp.Regexp
	PureFunctions          []*regexp.Regexp // Functions that don't mutate their arguments
	TrustedFunctions       []*regexp.Regexp // Functions whose return values are trusted as valid
}

// AnalyseFile performs a single AST pass over the source file.
// It collects validation items (for VSCode) and type usage counts (for transform).
// An optional ProjectAnalysis can be provided for cross-file optimisation information.
func AnalyseFile(sourceFile *ast.SourceFile, c *checker.Checker, program *compiler.Program, config Config) *Result {
	return AnalyseFileWithProjectAnalysis(sourceFile, c, program, config, nil)
}

// AnalyseFileWithProjectAnalysis performs analysis with optional cross-file project analysis.
// When projectAnalysis is provided, it can use cross-file information to determine skip reasons.
func AnalyseFileWithProjectAnalysis(sourceFile *ast.SourceFile, c *checker.Checker, program *compiler.Program, config Config, projectAnalysis *ProjectAnalysis) *Result {
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
			// Recursive type detected - increment usage count so a reusable function is created
			// This allows the validator to call itself recursively
			if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
				if !strings.HasPrefix(sym.Name, "__") {
					key := getTypeKey(t, nil)
					usage[key]++
				}
			}
			return
		}
		visitedTypes[typeStr] = true
		defer delete(visitedTypes, typeStr)

		flags := checker.Type_flags(t)
		objectFlags := checker.Type_objectFlags(t)
		isArray := checker.Checker_isArrayType(c, t)
		isTuple := checker.IsTupleType(t)

		if flags&checker.TypeFlagsObject != 0 && !isArray && !isTuple {
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

		if isTuple {
			// For tuples, count each element type
			typeArgs := checker.Checker_getTypeArguments(c, t)
			for _, elemType := range typeArgs {
				countNestedTypes(elemType, usage, types)
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
		isTuple := checker.IsTupleType(t)

		if flags&checker.TypeFlagsObject != 0 && !isArray && !isTuple {
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

		if isTuple {
			// For tuples, count each element type
			typeArgs := checker.Checker_getTypeArguments(c, t)
			for _, elemType := range typeArgs {
				countNestedTypes(elemType, result.CheckTypeUsage, result.CheckTypeObjects)
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
		isTuple := checker.IsTupleType(t)

		if flags&checker.TypeFlagsObject != 0 && !isArray && !isTuple {
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

		if isTuple {
			// For tuples, count each element type
			typeArgs := checker.Checker_getTypeArguments(c, t)
			for _, elemType := range typeArgs {
				countNestedTypes(elemType, result.FilterTypeUsage, result.FilterTypeObjects)
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

	// getFunctionName extracts the function name from a functionLike
	getFunctionName := func(fn *functionLike) string {
		switch fn.node.Kind {
		case ast.KindFunctionDeclaration:
			fd := fn.node.AsFunctionDeclaration()
			if fd != nil && fd.Name() != nil {
				return fd.Name().Text()
			}
		case ast.KindMethodDeclaration:
			md := fn.node.AsMethodDeclaration()
			if md != nil && md.Name() != nil {
				if md.Name().Kind == ast.KindIdentifier {
					return md.Name().AsIdentifier().Text
				}
			}
		}
		return ""
	}

	// getFunctionKey generates a unique key for a function (fileName:position)
	getFunctionKey := func(fn *functionLike) string {
		fileName := sourceFile.FileName()
		pos := fn.node.Pos()
		name := getFunctionName(fn)
		if name != "" {
			return fileName + ":" + name + ":" + strconv.Itoa(pos)
		}
		return fileName + ":" + strconv.Itoa(pos)
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

	// Track function context for return type analysis and validated variables
	type funcContext struct {
		returnType         *ast.Node
		isAsync            bool
		validated          map[string][]*checker.Type // variables validated in this function
		bodyStart          int                        // position where function body starts
		bodyNode           *ast.Node                  // function body for dirty checking
		funcKey            string                     // unique key for cross-file analysis
		escapedToExternal  map[string]bool            // variables that have escaped to external code
	}
	var funcStack []*funcContext

	// Declare recursive functions first
	var getRootIdentifier func(expr *ast.Node) string
	var getEntityName func(expr *ast.Node) string
	var getValidatedType func(expr *ast.Node, validated map[string][]*checker.Type, targetType *checker.Type) (*checker.Type, bool)

	// getRootIdentifier extracts the root variable name from an expression
	getRootIdentifier = func(expr *ast.Node) string {
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

	// isIdentifierNamed checks if a node is an identifier with the given name
	isIdentifierNamed := func(node *ast.Node, name string) bool {
		if node == nil || node.Kind != ast.KindIdentifier {
			return false
		}
		return node.AsIdentifier().Text == name
	}

	// getEntityName extracts full entity name for pure function matching (e.g. "console.log")
	getEntityName = func(expr *ast.Node) string {
		if expr == nil {
			return ""
		}
		switch expr.Kind {
		case ast.KindIdentifier:
			return expr.AsIdentifier().Text
		case ast.KindPropertyAccessExpression:
			propAccess := expr.AsPropertyAccessExpression()
			if propAccess == nil {
				return ""
			}
			obj := getEntityName(propAccess.Expression)
			nameNode := propAccess.Name()
			if nameNode == nil {
				return obj
			}
			prop := ""
			if nameNode.Kind == ast.KindIdentifier {
				prop = nameNode.AsIdentifier().Text
			}
			if obj != "" && prop != "" {
				return obj + "." + prop
			}
			if prop != "" {
				return prop
			}
			return obj
		}
		return ""
	}

	// getValidatedType checks if an expression is already validated
	getValidatedType = func(expr *ast.Node, validated map[string][]*checker.Type, targetType *checker.Type) (*checker.Type, bool) {
		if expr == nil || validated == nil {
			return nil, false
		}

		switch expr.Kind {
		case ast.KindIdentifier:
			name := expr.AsIdentifier().Text
			if types, ok := validated[name]; ok {
				for _, t := range types {
					if targetType == nil {
						return t, true
					}
					if checker.Checker_isTypeAssignableTo(c, t, targetType) {
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
			parentType, ok := getValidatedType(propAccess.Expression, validated, nil)
			if !ok {
				return nil, false
			}
			propName := ""
			nameNode := propAccess.Name()
			if nameNode != nil && nameNode.Kind == ast.KindIdentifier {
				propName = nameNode.AsIdentifier().Text
			}
			if propName == "" {
				return nil, false
			}
			propSymbol := checker.Checker_getPropertyOfType(c, parentType, propName)
			if propSymbol == nil {
				return nil, false
			}
			propType := checker.Checker_getTypeOfSymbol(c, propSymbol)
			if targetType == nil {
				return propType, true
			}
			if checker.Checker_isTypeAssignableTo(c, propType, targetType) {
				return propType, true
			}
			return nil, false

		case ast.KindElementAccessExpression:
			elemAccess := expr.AsElementAccessExpression()
			if elemAccess == nil {
				return nil, false
			}
			parentType, ok := getValidatedType(elemAccess.Expression, validated, nil)
			if !ok {
				return nil, false
			}
			if checker.Checker_isArrayType(c, parentType) {
				typeArgs := checker.Checker_getTypeArguments(c, parentType)
				if len(typeArgs) > 0 {
					elemType := typeArgs[0]
					if targetType == nil {
						return elemType, true
					}
					if checker.Checker_isTypeAssignableTo(c, elemType, targetType) {
						return elemType, true
					}
				}
			}
			return nil, false
		}
		return nil, false
	}

	// Helper to check if path is in node_modules
	isNodeModulesPath := func(path string) bool {
		return strings.Contains(path, "/node_modules/") || strings.Contains(path, "\\node_modules\\")
	}

	// Helper to check if path is a declaration file
	isDeclarationFilePath := func(path string) bool {
		return len(path) > 5 && path[len(path)-5:] == ".d.ts"
	}

	// Helper to get argument index in a call
	getArgIndex := func(call *ast.CallExpression, arg *ast.Node) int {
		if call.Arguments == nil {
			return -1
		}
		for i, a := range call.Arguments.Nodes {
			if a == arg {
				return i
			}
		}
		return -1
	}

	// isDirty checks if a variable has been modified between two positions
	// It uses funcCtx to track permanent escapes in async functions
	isDirty := func(funcCtx *funcContext, varName string, fromPos int, toPos int) bool {
		if funcCtx == nil || funcCtx.bodyNode == nil {
			return false
		}

		// If variable has already escaped to external code in an async function,
		// it's permanently dirty for all subsequent uses
		if funcCtx.isAsync && funcCtx.escapedToExternal[varName] {
			return true
		}

		// Get the validated type to determine if it's a primitive
		var validatedType *checker.Type
		if types, ok := funcCtx.validated[varName]; ok && len(types) > 0 {
			validatedType = types[0]
		}
		varIsPrimitive := isPrimitiveType(validatedType)

		dirty := false
		leaked := false
		hasAwait := false

		var checkDirty func(n *ast.Node) bool
		checkDirty = func(n *ast.Node) bool {
			if dirty {
				return false
			}

			pos := n.Pos()
			if pos < fromPos || pos >= toPos {
				n.ForEachChild(checkDirty)
				return false
			}

			switch n.Kind {
			case ast.KindBinaryExpression:
				bin := n.AsBinaryExpression()
				if bin != nil {
					opKind := bin.OperatorToken.Kind
					if opKind == ast.KindEqualsToken ||
						opKind == ast.KindPlusEqualsToken ||
						opKind == ast.KindMinusEqualsToken ||
						opKind == ast.KindAsteriskEqualsToken ||
						opKind == ast.KindSlashEqualsToken {

						// Direct variable reassignment always dirties
						if isIdentifierNamed(bin.Left, varName) {
							dirty = true
							return false
						}

						// For property assignment (x.prop = ...), check if RHS is JSON.parse
						// JSON.parse is safe because it filters/validates the result against the target type
						// NOTE: We don't treat literals or validated properties as safe because they might
						// not satisfy literal type constraints in discriminated unions
						// e.g. type User = { name: 'elliot' } | { name: 'darlene' }
						if !varIsPrimitive && getRootIdentifier(bin.Left) == varName {
							rhsIsValidated := false
							if opKind == ast.KindEqualsToken {
								// Check if RHS is JSON.parse (which gets filtered/validated against target type)
								if bin.Right.Kind == ast.KindCallExpression {
									callExpr := bin.Right.AsCallExpression()
									if callExpr != nil {
										methodName, isJSON := getJSONMethodName(callExpr)
										if isJSON && methodName == "parse" && config.TransformJSONParse {
											rhsIsValidated = true
										}
									}
								}
							}

							if !rhsIsValidated {
								dirty = true
								return false
							}
						}
					}
				}

			case ast.KindCallExpression:
				if varIsPrimitive {
					break
				}
				call := n.AsCallExpression()
				if call != nil && call.Arguments != nil {
					isPure := false
					funcName := getEntityName(call.Expression)
					if funcName != "" && len(config.PureFunctions) > 0 {
						for _, re := range config.PureFunctions {
							if re.MatchString(funcName) {
								isPure = true
								break
							}
						}
					}

					if !isPure {
						for _, arg := range call.Arguments.Nodes {
							root := getRootIdentifier(arg)
							if root == varName {
								argType := checker.Checker_GetTypeAtLocation(c, arg)
								if !isPrimitiveType(argType) {
									// Check if this is an internal call that we can analyse
									isExternal := true
									calleeMutates := true

									if projectAnalysis != nil {
										// Try to find the callee in our project analysis
										calleeType := checker.Checker_GetTypeAtLocation(c, call.Expression)
										if calleeType != nil {
											calleeSym := checker.Type_symbol(calleeType)
											if calleeSym != nil && len(calleeSym.Declarations) > 0 {
												for _, decl := range calleeSym.Declarations {
													sf := ast.GetSourceFileOfNode(decl)
													if sf != nil {
														declFileName := sf.FileName()
														// Check if it's internal
														if !isNodeModulesPath(declFileName) && !isDeclarationFilePath(declFileName) {
															isExternal = false
															// Try to find the function info
															calleeKey := declFileName + ":" + calleeSym.Name
															if calleeInfo, ok := projectAnalysis.CallGraph[calleeKey]; ok {
																// Find which param index this arg corresponds to
																argIdx := getArgIndex(call, arg)
																if argIdx >= 0 && argIdx < len(calleeInfo.MutatesParams) {
																	calleeMutates = calleeInfo.MutatesParams[argIdx]
																	// Also check if callee escapes the param
																	if calleeInfo.EscapesParams[argIdx] {
																		// Propagate escape
																		funcCtx.escapedToExternal[varName] = true
																	}
																}
															}
															break
														}
													}
												}
											}
										}
									}

									if isExternal {
										// External call - mark as escaped for async functions
										funcCtx.escapedToExternal[varName] = true
										leaked = true
									}

									if calleeMutates {
										dirty = true
										return false
									}
								}
							}
						}
					}
				}

			case ast.KindAwaitExpression:
				hasAwait = true
				// In async function, if variable has escaped and there's an await, it's dirty
				if !varIsPrimitive && (leaked || funcCtx.escapedToExternal[varName]) {
					dirty = true
					return false
				}

			case ast.KindPrefixUnaryExpression:
				prefix := n.AsPrefixUnaryExpression()
				if prefix != nil {
					if prefix.Operator == ast.KindPlusPlusToken || prefix.Operator == ast.KindMinusMinusToken {
						if isIdentifierNamed(prefix.Operand, varName) {
							dirty = true
							return false
						}
					}
				}

			case ast.KindPostfixUnaryExpression:
				postfix := n.AsPostfixUnaryExpression()
				if postfix != nil {
					if postfix.Operator == ast.KindPlusPlusToken || postfix.Operator == ast.KindMinusMinusToken {
						if isIdentifierNamed(postfix.Operand, varName) {
							dirty = true
							return false
						}
					}
				}
			}

			n.ForEachChild(checkDirty)
			return false
		}

		funcCtx.bodyNode.ForEachChild(checkDirty)

		// If async function and escaped + has await, mark permanent escape for future
		if funcCtx.isAsync && hasAwait && leaked {
			funcCtx.escapedToExternal[varName] = true
		}

		return dirty
	}

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

			// Get function body for dirty checking
			var bodyNode *ast.Node
			var bodyStart int
			switch node.Kind {
			case ast.KindFunctionDeclaration:
				if fd := node.AsFunctionDeclaration(); fd != nil && fd.Body != nil {
					bodyNode = fd.Body
					bodyStart = fd.Body.Pos()
				}
			case ast.KindFunctionExpression:
				if fe := node.AsFunctionExpression(); fe != nil && fe.Body != nil {
					bodyNode = fe.Body
					bodyStart = fe.Body.Pos()
				}
			case ast.KindArrowFunction:
				if af := node.AsArrowFunction(); af != nil && af.Body != nil {
					bodyNode = af.Body
					bodyStart = af.Body.Pos()
				}
			case ast.KindMethodDeclaration:
				if md := node.AsMethodDeclaration(); md != nil && md.Body != nil {
					bodyNode = md.Body
					bodyStart = md.Body.Pos()
				}
			}

			// Push function context
			ctx := &funcContext{
				returnType:        getFunctionType(fn),
				isAsync:           isFunctionAsync(fn),
				validated:         make(map[string][]*checker.Type),
				bodyStart:         bodyStart,
				bodyNode:          bodyNode,
				funcKey:           getFunctionKey(fn),
				escapedToExternal: make(map[string]bool),
			}
			funcStack = append(funcStack, ctx)
			defer func() { funcStack = funcStack[:len(funcStack)-1] }()

			// Analyse parameters and mark them as validated
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

						// Mark parameter as validated (if it's not skipped)
						skipReason := getSkipReason(paramType)
						if skipReason == "" && paramName != "(destructured)" {
							ctx.validated[paramName] = append(ctx.validated[paramName], paramType)
						}
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

			// Check for JSON.parse/stringify in return - these are handled specially
			if returnStmt.Expression.Kind == ast.KindCallExpression {
				callExpr := returnStmt.Expression.AsCallExpression()
				if callExpr != nil {
					methodName, isJSON := getJSONMethodName(callExpr)
					if isJSON {
						if methodName == "parse" && config.TransformJSONParse {
							actualType := unwrapPromiseType(returnType, ctx.isAsync, c)
							// Highlight just "JSON.parse", pass nil for endNode so underline only covers "JSON.parse"
							countFilter(actualType, nil, callExpr.Expression, "json-parse", "JSON.parse")
							return false
						}
						if methodName == "stringify" && config.TransformJSONStringify {
							// Get the argument type for stringify
							if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
								argType := checker.Checker_GetTypeAtLocation(c, callExpr.Arguments.Nodes[0])
								if argType != nil && !shouldSkipType(argType) {
									countFilter(argType, nil, callExpr.Expression, "json-stringify", "JSON.stringify")
									return false
								}
							}
						}
					}
				}
			}

			// Check for cast expressions (JSON.parse(...) as T or expr as T) - will be handled by AsExpression handler
			if returnStmt.Expression.Kind == ast.KindAsExpression && config.ValidateCasts {
				// Let the AsExpression handler deal with this to avoid duplicate markers
				break
			}

			// Regular return validation - highlight just the return expression
			if config.ValidateReturns && returnType != nil {
				actualType := unwrapPromiseType(returnType, ctx.isAsync, c)

				// Check if the return expression is already validated and not dirty
				skipValidation := false
				if _, ok := getValidatedType(returnStmt.Expression, ctx.validated, actualType); ok {
					rootVar := getRootIdentifier(returnStmt.Expression)
					if rootVar != "" {
						if !isDirty(ctx, rootVar, ctx.bodyStart, node.Pos()) {
							skipValidation = true
						}
					}
				}

				if skipValidation {
					// Add as skipped with "already valid" reason
					addValidationItem(returnStmt.Expression, returnStmt.Expression, "return", "return value", actualType, true, "already validated")
				} else {
					// Use the expression for both start and end position (not the type annotation)
					countCheck(actualType, returnStmt.Expression, returnStmt.Expression, "return", "return value")
				}
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
							// Highlight just "JSON.parse", pass nil for endNode so underline only covers "JSON.parse"
							countFilter(castType, nil, innerCall.Expression, "json-parse", "JSON.parse")

							// Mark variable as validated if this is in a variable declaration
							if node.Parent != nil && node.Parent.Kind == ast.KindVariableDeclaration {
								varDecl := node.Parent.AsVariableDeclaration()
								if varDecl != nil && varDecl.Name() != nil && varDecl.Name().Kind == ast.KindIdentifier && len(funcStack) > 0 {
									varName := varDecl.Name().AsIdentifier().Text
									ctx := funcStack[len(funcStack)-1]
									skipReason := getSkipReason(castType)
									if skipReason == "" {
										ctx.validated[varName] = append(ctx.validated[varName], castType)
									}
								}
							}
							return false
						}
						if methodName == "stringify" && config.TransformJSONStringify {
							// Highlight just "JSON.stringify", pass nil for endNode so underline only covers "JSON.stringify"
							countFilter(castType, nil, innerCall.Expression, "json-stringify", "JSON.stringify")
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
				var varName string
				if node.Parent != nil && node.Parent.Kind == ast.KindVariableDeclaration {
					varDecl := node.Parent.AsVariableDeclaration()
					if varDecl != nil && varDecl.Name() != nil {
						highlightNode = varDecl.Name()
						if varDecl.Name().Kind == ast.KindIdentifier {
							varName = varDecl.Name().AsIdentifier().Text
						}
					}
				}
				countCheck(castType, highlightNode, highlightNode, "cast", exprText+" as "+typeText)

				// Mark variable as validated (if it's a variable declaration with a cast)
				if varName != "" && len(funcStack) > 0 {
					ctx := funcStack[len(funcStack)-1]
					skipReason := getSkipReason(castType)
					if skipReason == "" {
						ctx.validated[varName] = append(ctx.validated[varName], castType)
					}
				}
			}

		case ast.KindCallExpression:
			callExpr := node.AsCallExpression()
			if callExpr == nil {
				break
			}

			methodName, isJSON := getJSONMethodName(callExpr)

			// Check for dirty values passed to external functions (non-JSON calls)
			if !isJSON && config.ValidateParameters && len(funcStack) > 0 {
				ctx := funcStack[len(funcStack)-1]

				// Check if this is an external function call
				isExternal := false
				calleeType := checker.Checker_GetTypeAtLocation(c, callExpr.Expression)
				if calleeType != nil {
					calleeSym := checker.Type_symbol(calleeType)
					if calleeSym != nil && len(calleeSym.Declarations) > 0 {
						for _, decl := range calleeSym.Declarations {
							sf := ast.GetSourceFileOfNode(decl)
							if sf != nil {
								declFileName := sf.FileName()
								// External if in node_modules or is a .d.ts file
								if isNodeModulesPath(declFileName) || isDeclarationFilePath(declFileName) {
									isExternal = true
									break
								}
							}
							// Also check if it's an ambient declaration (declare function ...)
							// These are external functions declared in the current file
							if decl.Kind == ast.KindFunctionDeclaration {
								fd := decl.AsFunctionDeclaration()
								if fd != nil && fd.Body == nil {
									// No body means it's an ambient/external declaration
									isExternal = true
									break
								}
							}
						}
					}
				}

				// For external calls, check each argument for unvalidated or dirty values
				if isExternal && callExpr.Arguments != nil {
					for argIdx, arg := range callExpr.Arguments.Nodes {
						rootVar := getRootIdentifier(arg)
						if rootVar == "" {
							continue
						}

						// Get the argument's type
						argType := checker.Checker_GetTypeAtLocation(c, arg)
						if argType == nil || shouldSkipType(argType) || isPrimitiveType(argType) {
							continue
						}

						// Check if this variable was validated
						_, wasValidated := ctx.validated[rootVar]

						// Needs validation if:
						// 1. Never validated, OR
						// 2. Was validated but became dirty since
						needsValidation := !wasValidated || isDirty(ctx, rootVar, ctx.bodyStart, node.Pos())
						if !needsValidation {
							continue
						}

						// This value needs validation before passing to external function
						argName := text[arg.Pos():arg.End()]
						if len(argName) > 30 {
							argName = argName[:27] + "..."
						}

						// Add validation item for this argument
						countCheck(argType, arg, arg, "external-call-argument", argName)

						// Store info for transform to use
						result.DirtyExternalArgs = append(result.DirtyExternalArgs, DirtyExternalArg{
							CallPos:   node.Pos(),
							ArgIndex:  argIdx,
							ArgPos:    arg.Pos(),
							ArgEnd:    arg.End(),
							Type:      argType,
							VarName:   rootVar,
						})
					}
				}
			}

			if !isJSON {
				break
			}

			var targetType *checker.Type

			// Check for explicit type argument: JSON.parse<User>(...)
			if callExpr.TypeArguments != nil && len(callExpr.TypeArguments.Nodes) > 0 {
				typeArgNode := callExpr.TypeArguments.Nodes[0]
				targetType = checker.Checker_getTypeFromTypeNode(c, typeArgNode)
			}

			// For stringify, also check if argument has "as T" cast: JSON.stringify(x as T)
			if methodName == "stringify" && targetType == nil && config.TransformJSONStringify {
				if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
					arg := callExpr.Arguments.Nodes[0]
					if arg.Kind == ast.KindAsExpression {
						asExpr := arg.AsAsExpression()
						if asExpr != nil && asExpr.Type != nil {
							targetType = checker.Checker_getTypeFromTypeNode(c, asExpr.Type)
						}
					}
				}
			}

			// For stringify, infer type from argument's declared type: JSON.stringify(typedVar)
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
						}
					}
				}
			}

			if targetType != nil {
				if methodName == "parse" && config.TransformJSONParse {
					// Highlight just "JSON.parse", pass nil for endNode so underline only covers "JSON.parse"
					countFilter(targetType, nil, callExpr.Expression, "json-parse", "JSON.parse")
					return false
				}
				if methodName == "stringify" && config.TransformJSONStringify {
					// Highlight just "JSON.stringify", pass nil for endNode so underline only covers "JSON.stringify"
					countFilter(targetType, nil, callExpr.Expression, "json-stringify", "JSON.stringify")
					return false
				}
			}

		case ast.KindVariableDeclaration:
			varDecl := node.AsVariableDeclaration()
			if varDecl == nil || varDecl.Initializer == nil {
				break
			}

			// Get variable name
			var varName string
			if varDecl.Name() != nil && varDecl.Name().Kind == ast.KindIdentifier {
				varName = varDecl.Name().AsIdentifier().Text
			}

			// Handle aliasing: const y = x where x is validated
			// Also handle property access: const y = x.prop where x is validated
			if varName != "" && len(funcStack) > 0 {
				ctx := funcStack[len(funcStack)-1]

				// Check if initializer is a validated expression (identifier or property access)
				if validatedType, ok := getValidatedType(varDecl.Initializer, ctx.validated, nil); ok {
					// Check if the root variable has been dirtied
					rootVar := getRootIdentifier(varDecl.Initializer)
					if rootVar != "" && !isDirty(ctx, rootVar, ctx.bodyStart, node.Pos()) {
						// The variable inherits the validated type
						ctx.validated[varName] = append(ctx.validated[varName], validatedType)
					}
				}
			}

			// Handle trusted function calls: const x = trustedFunc()
			// If the initializer is a call to a trusted function, mark the variable as validated
			if varName != "" && len(funcStack) > 0 && len(config.TrustedFunctions) > 0 &&
				varDecl.Initializer.Kind == ast.KindCallExpression {
				callExpr := varDecl.Initializer.AsCallExpression()
				if callExpr != nil {
					funcName := getEntityName(callExpr.Expression)
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
							ctx := funcStack[len(funcStack)-1]
							skipReason := getSkipReason(targetType)
							if skipReason == "" {
								ctx.validated[varName] = append(ctx.validated[varName], targetType)
							}
						}
					}
				}
			}

			// Handle: const x: T = JSON.parse(string)
			if varDecl.Type != nil && config.TransformJSONParse && varDecl.Initializer.Kind == ast.KindCallExpression {
				callExpr := varDecl.Initializer.AsCallExpression()
				if callExpr != nil {
					methodName, isJSON := getJSONMethodName(callExpr)
					if isJSON && methodName == "parse" {
						targetType := checker.Checker_getTypeFromTypeNode(c, varDecl.Type)
						// Highlight just "JSON.parse" (the property access expression), not the whole variable declaration
						// Pass nil for typeNode so the underline only covers "JSON.parse"
						countFilter(targetType, nil, callExpr.Expression, "json-parse", "JSON.parse")

						// Mark variable as validated
						if varName != "" && len(funcStack) > 0 {
							ctx := funcStack[len(funcStack)-1]
							skipReason := getSkipReason(targetType)
							if skipReason == "" {
								ctx.validated[varName] = append(ctx.validated[varName], targetType)
							}
						}
						return false
					}
				}
			}

		case ast.KindBinaryExpression:
			// Handle: x.prop = JSON.parse(string) or x = JSON.parse(string)
			// The target type is inferred from the left-hand side
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
						if targetType != nil && !shouldSkipType(targetType) {
							countFilter(targetType, nil, callExpr.Expression, "json-parse", "JSON.parse")
							return false
						}
					}
				}
			}

			// Check if RHS is JSON.stringify call
			if config.TransformJSONStringify && bin.Right.Kind == ast.KindCallExpression {
				callExpr := bin.Right.AsCallExpression()
				if callExpr != nil {
					methodName, isJSON := getJSONMethodName(callExpr)
					if isJSON && methodName == "stringify" {
						// Get the argument type for stringify
						if callExpr.Arguments != nil && len(callExpr.Arguments.Nodes) > 0 {
							argType := checker.Checker_GetTypeAtLocation(c, callExpr.Arguments.Nodes[0])
							if argType != nil && !shouldSkipType(argType) {
								countFilter(argType, nil, callExpr.Expression, "json-stringify", "JSON.stringify")
								return false
							}
						}
					}
				}
			}
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
