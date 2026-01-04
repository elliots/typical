package codegen

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/checker"
	"github.com/microsoft/typescript-go/shim/compiler"
)

// isGoodTypeName checks if a type name is suitable for error messages.
// Filters out internal/anonymous type names like "__type" or "ƒtype".
func isGoodTypeName(name string) bool {
	if name == "" {
		return false
	}
	// Filter out internal TypeScript type names
	if name == "__type" || name == "__object" || name == "__function" {
		return false
	}
	// Filter out names starting with special characters (like ƒ used for function types)
	if len(name) > 0 {
		first := name[0]
		// Only allow names starting with letters, underscore (but not __), or $
		if first < 'A' || (first > 'Z' && first < 'a') || first > 'z' {
			if first != '_' && first != '$' {
				return false
			}
			// Double underscore prefix is internal
			if len(name) > 1 && name[1] == '_' {
				return false
			}
		}
	}
	return true
}

// Generator generates JavaScript validator code from TypeScript types.
type Generator struct {
	checker  *checker.Checker
	program  *compiler.Program // TypeScript program for lib file detection
	ioFuncs  []string          // _io0, _io1, etc. (is-check functions)
	funcIdx  int               // Counter for generating unique function names
	visiting map[string]bool   // Track types being visited for circular refs (by symbol name)
	depth    int               // Current recursion depth

	// Configuration
	maxGeneratedFunctions int            // Max _io functions before erroring (0 = unlimited)
	ignoreTypes           []*regexp.Regexp // Patterns for types to skip validation

	// Error tracking
	complexityError string   // Set when max functions exceeded; contains error message
	typeStack       []string // Stack of type names being processed (for error context)
}

// MaxTypeDepth limits how deep we recurse into type hierarchies.
// Complex types like React.FormEvent have very deep generic instantiations.
const MaxTypeDepth = 20

// getTypeKey returns a unique key for a type based on its symbol name.
// Returns empty string for anonymous types (which won't cause cycles).
func getTypeKey(t *checker.Type) string {
	if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
		return sym.Name
	}
	// For object types without symbols, use the type's flags + first few properties
	// This helps catch anonymous object types that might recurse
	flags := checker.Type_flags(t)
	if flags&checker.TypeFlagsObject != 0 {
		// Use pointer for anonymous objects as a last resort
		return fmt.Sprintf("anon_%p", t)
	}
	return ""
}

// DefaultMaxGeneratedFunctions is the default limit for generated helper functions.
const DefaultMaxGeneratedFunctions = 50

// NewGenerator creates a new validator code generator with default settings.
func NewGenerator(c *checker.Checker, program *compiler.Program) *Generator {
	return NewGeneratorWithConfig(c, program, DefaultMaxGeneratedFunctions)
}

// NewGeneratorWithConfig creates a new validator code generator with custom max functions limit.
// Set maxFuncs to 0 to disable the limit.
func NewGeneratorWithConfig(c *checker.Checker, program *compiler.Program, maxFuncs int) *Generator {
	return NewGeneratorWithIgnoreTypes(c, program, maxFuncs, nil)
}

// NewGeneratorWithIgnoreTypes creates a new validator code generator with ignore patterns.
// Set maxFuncs to 0 to disable the limit.
// ignoreTypes is a list of compiled regex patterns - types matching any pattern will be skipped.
func NewGeneratorWithIgnoreTypes(c *checker.Checker, program *compiler.Program, maxFuncs int, ignoreTypes []*regexp.Regexp) *Generator {
	return &Generator{
		checker:               c,
		program:               program,
		ioFuncs:               make([]string, 0),
		visiting:              make(map[string]bool),
		depth:                 0,
		maxGeneratedFunctions: maxFuncs,
		ignoreTypes:           ignoreTypes,
	}
}

// shouldIgnoreType checks if a type name matches any ignore pattern.
// Returns the matching pattern (for error messages) or empty string if not ignored.
func (g *Generator) shouldIgnoreType(typeName string) string {
	for _, re := range g.ignoreTypes {
		if re.MatchString(typeName) {
			return re.String() // Return the pattern that matched
		}
	}
	return ""
}

// ValidatorResult contains the result of validator generation.
type ValidatorResult struct {
	// Code is the generated validator code. Empty if the type was ignored or validation not needed.
	Code string
	// Ignored is true if the type was skipped due to ignoreTypes configuration.
	Ignored bool
	// IgnoredReason explains why the type was ignored (e.g., "type 'FieldConfig' matches pattern '*FieldConfig'").
	IgnoredReason string
}


// GenerateValidator generates a validator function for a type.
// The returned string is a JavaScript function: (value, name) => value
// - value: the value to validate (typed as any for strict mode compatibility)
// - name: the name/path to use in error messages (e.g. "user", "response.data")
// Throws TypeError if validation fails, returns value if valid.
// Returns ValidatorResult with Ignored=true if the type matches an ignore pattern.
func (g *Generator) GenerateValidator(t *checker.Type, typeName string) ValidatorResult {
	// Check if this type should be ignored
	if pattern := g.shouldIgnoreType(typeName); pattern != "" {
		return ValidatorResult{
			Ignored:       true,
			IgnoredReason: fmt.Sprintf("type '%s' matches ignoreTypes pattern '%s'", typeName, pattern),
		}
	}

	// Also check the type's symbol name
	if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
		if pattern := g.shouldIgnoreType(sym.Name); pattern != "" {
			return ValidatorResult{
				Ignored:       true,
				IgnoredReason: fmt.Sprintf("type '%s' matches ignoreTypes pattern '%s'", sym.Name, pattern),
			}
		}
	}

	// Reset state for each validator
	g.ioFuncs = make([]string, 0)
	g.funcIdx = 0
	g.visiting = make(map[string]bool)
	g.depth = 0

	// Generate validation statements
	statements := g.generateValidation(t, "_v", "_n")

	// Build the validator function
	// Use explicit 'any' types for strict mode compatibility
	var sb strings.Builder
	sb.WriteString("((_v: any, _n: string) => { ")

	// Add helper functions
	for _, fn := range g.ioFuncs {
		sb.WriteString(fn)
		sb.WriteString("; ")
	}

	// Add validation statements
	sb.WriteString(statements)

	sb.WriteString("return _v; })")

	return ValidatorResult{Code: sb.String()}
}

// GenerateValidatorFromNode generates a validator function using the type node.
// Same signature as GenerateValidator but uses AST node for better array detection.
// Returns ValidatorResult with Ignored=true if the type matches an ignore pattern.
func (g *Generator) GenerateValidatorFromNode(t *checker.Type, typeNode *ast.Node, typeName string) ValidatorResult {
	// Check if this type should be ignored
	if pattern := g.shouldIgnoreType(typeName); pattern != "" {
		return ValidatorResult{
			Ignored:       true,
			IgnoredReason: fmt.Sprintf("type '%s' matches ignoreTypes pattern '%s'", typeName, pattern),
		}
	}

	// Also check the type's symbol name
	if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
		if pattern := g.shouldIgnoreType(sym.Name); pattern != "" {
			return ValidatorResult{
				Ignored:       true,
				IgnoredReason: fmt.Sprintf("type '%s' matches ignoreTypes pattern '%s'", sym.Name, pattern),
			}
		}
	}

	// Check the type reference name from the AST node - this catches cases where
	// the resolved type's symbol name differs from the source type reference name
	if typeRefName := getTypeReferenceName(typeNode); typeRefName != "" {
		if pattern := g.shouldIgnoreType(typeRefName); pattern != "" {
			return ValidatorResult{
				Ignored:       true,
				IgnoredReason: fmt.Sprintf("type '%s' matches ignoreTypes pattern '%s'", typeRefName, pattern),
			}
		}
	}

	// Reset state for each validator
	g.ioFuncs = make([]string, 0)
	g.funcIdx = 0
	g.visiting = make(map[string]bool)
	g.depth = 0

	// Generate validation statements using node for better detection
	statements := g.generateValidationFromNode(t, typeNode, "_v", "_n")

	// Build the validator function
	// Use explicit 'any' types for strict mode compatibility
	var sb strings.Builder
	sb.WriteString("((_v: any, _n: string) => { ")

	// Add helper functions
	for _, fn := range g.ioFuncs {
		sb.WriteString(fn)
		sb.WriteString("; ")
	}

	// Add validation statements
	sb.WriteString(statements)

	sb.WriteString("return _v; })")

	return ValidatorResult{Code: sb.String()}
}

// GenerateIsCheck generates just the is-check expression without the validator wrapper.
// Useful for testing individual type checks.
func (g *Generator) GenerateIsCheck(t *checker.Type) string {
	g.ioFuncs = make([]string, 0)
	g.funcIdx = 0
	g.visiting = make(map[string]bool)
	g.depth = 0
	return g.generateCheck(t, "input")
}

// GenerateInlineValidation generates validation statements for a parameter without IIFE wrapper.
// The paramName is substituted directly into the validation code.
// Returns validation statements that can be inserted directly at function body start.
// Note: This includes any helper functions (_io0, _io1, etc.) at the start of the returned code.
func (g *Generator) GenerateInlineValidation(t *checker.Type, paramName string) string {
	g.reset()
	return g.generateInlineValidationInternal(t, nil, paramName)
}

// GenerateInlineValidationFromNode generates inline validation using the type node.
// Note: This includes any helper functions (_io0, _io1, etc.) at the start of the returned code.
func (g *Generator) GenerateInlineValidationFromNode(t *checker.Type, typeNode *ast.Node, paramName string) string {
	g.reset()
	return g.generateInlineValidationInternal(t, typeNode, paramName)
}

// GenerateInlineValidationContinued generates inline validation without resetting funcIdx.
// Use this when generating validation for multiple parameters in the same function scope
// to avoid duplicate _io function names.
func (g *Generator) GenerateInlineValidationContinued(t *checker.Type, typeNode *ast.Node, paramName string) string {
	// Don't reset - preserve funcIdx to avoid duplicate _io names
	// Only clear the ioFuncs and visiting state for this generation
	g.ioFuncs = make([]string, 0)
	g.visiting = make(map[string]bool)
	g.depth = 0
	g.complexityError = ""
	g.typeStack = nil

	return g.generateInlineValidationInternal(t, typeNode, paramName)
}

// ResetFuncIdx resets the function index counter. Call this at the start of a new function scope.
func (g *Generator) ResetFuncIdx() {
	g.funcIdx = 0
}

// generateInlineValidationInternal is the common implementation for inline validation.
func (g *Generator) generateInlineValidationInternal(t *checker.Type, typeNode *ast.Node, paramName string) string {
	var validation string
	if typeNode != nil {
		validation = g.generateValidationFromNode(t, typeNode, paramName, `"`+paramName+`"`)
	} else {
		validation = g.generateValidation(t, paramName, `"`+paramName+`"`)
	}

	// If there are helper functions, prepend them to the validation
	if len(g.ioFuncs) > 0 {
		var sb strings.Builder
		for _, fn := range g.ioFuncs {
			sb.WriteString(fn)
			sb.WriteString("; ")
		}
		sb.WriteString(validation)
		return sb.String()
	}

	return validation
}

// GenerateIsCheckFromNode generates an is-check using the type node to detect arrays.
func (g *Generator) GenerateIsCheckFromNode(t *checker.Type, typeNode *ast.Node) string {
	g.ioFuncs = make([]string, 0)
	g.funcIdx = 0
	g.visiting = make(map[string]bool)
	g.depth = 0
	return g.generateCheckFromNode(t, typeNode, "input")
}

// GetHelperFunctions returns the generated helper functions (_io0, _io1, etc.)
func (g *Generator) GetHelperFunctions() []string {
	return g.ioFuncs
}

// GetComplexityError returns any complexity error that occurred during generation.
// Returns empty string if no error occurred.
func (g *Generator) GetComplexityError() string {
	return g.complexityError
}

// checkComplexityLimit checks if we've exceeded the max generated functions limit.
// If exceeded, sets complexityError with details about the type and location.
// Returns true if limit exceeded (generation should stop).
func (g *Generator) checkComplexityLimit(typeName string) bool {
	if g.maxGeneratedFunctions > 0 && len(g.ioFuncs) >= g.maxGeneratedFunctions {
		if g.complexityError == "" {
			// Build type path from stack for context
			typePath := typeName
			if len(g.typeStack) > 0 {
				// Show the path that led to this type
				typePath = strings.Join(g.typeStack, " -> ") + " -> " + typeName
			}

			g.complexityError = fmt.Sprintf(
				"Type complexity limit exceeded: %d helper functions generated.\n"+
					"  Type path: %s\n"+
					"  This likely indicates a complex library/DOM type that should be excluded.\n"+
					"  Configure 'maxGeneratedFunctions' to adjust the limit or add the type to 'ignoreTypes'.",
				len(g.ioFuncs), typePath)
		}
		return true
	}
	return false
}

// checkComplexityLimitWithType is like checkComplexityLimit but accepts a Type for richer error info.
// It extracts source file location and property names from the type.
func (g *Generator) checkComplexityLimitWithType(t *checker.Type) bool {
	if g.maxGeneratedFunctions > 0 && len(g.ioFuncs) >= g.maxGeneratedFunctions {
		if g.complexityError == "" {
			typeName := "anonymous"
			sourceFile := ""
			var propNames []string

			// Get type name and source file from symbol
			if sym := checker.Type_symbol(t); sym != nil {
				if sym.Name != "" {
					typeName = sym.Name
				}
				// Try to get source file from declarations
				for _, decl := range sym.Declarations {
					if decl != nil {
						sf := ast.GetSourceFileOfNode(decl)
						if sf != nil {
							sourceFile = sf.FileName()
							break
						}
					}
				}
			}

			// Get property names (up to 10)
			props := checker.Checker_getPropertiesOfType(g.checker, t)
			for i, prop := range props {
				if i >= 10 {
					propNames = append(propNames, fmt.Sprintf("... and %d more", len(props)-10))
					break
				}
				propNames = append(propNames, prop.Name)
			}

			// Build type path from stack for context
			typePath := typeName
			if len(g.typeStack) > 0 {
				typePath = strings.Join(g.typeStack, " -> ") + " -> " + typeName
			}

			var sb strings.Builder
			sb.WriteString(fmt.Sprintf("Type complexity limit exceeded: %d helper functions generated.\n", len(g.ioFuncs)))
			sb.WriteString(fmt.Sprintf("  Type path: %s\n", typePath))
			if sourceFile != "" {
				sb.WriteString(fmt.Sprintf("  Type defined in: %s\n", sourceFile))
			}
			if len(propNames) > 0 {
				sb.WriteString(fmt.Sprintf("  Properties: %s\n", strings.Join(propNames, ", ")))
			}
			sb.WriteString("  This likely indicates a complex library/DOM type that should be excluded.\n")
			sb.WriteString("  Configure 'maxGeneratedFunctions' to adjust the limit or add the type to 'ignoreTypes'.")

			g.complexityError = sb.String()
		}
		return true
	}
	return false
}

// pushType adds a type to the stack for error context.
func (g *Generator) pushType(typeName string) {
	g.typeStack = append(g.typeStack, typeName)
}

// popType removes the last type from the stack.
func (g *Generator) popType() {
	if len(g.typeStack) > 0 {
		g.typeStack = g.typeStack[:len(g.typeStack)-1]
	}
}

// SetContext sets context information (like parameter name, line number) for error messages.
func (g *Generator) SetContext(context string) {
	// Clear the stack and set fresh context
	g.typeStack = []string{context}
}

// ClearContext clears the context stack.
func (g *Generator) ClearContext() {
	g.typeStack = nil
}

// generateValidation generates validation statements that throw on failure.
// expr: the expression to validate (e.g. "_v", "_v.name")
// nameExpr: JS expression for the name in error messages (e.g. "_n", "_n + '.name'")
func (g *Generator) generateValidation(t *checker.Type, expr string, nameExpr string) string {
	flags := checker.Type_flags(t)

	// Handle any/unknown - skip validation
	if flags&checker.TypeFlagsAny != 0 || flags&checker.TypeFlagsUnknown != 0 {
		return ""
	}

	// Depth limit - complex types like React.FormEvent have very deep hierarchies
	if g.depth > MaxTypeDepth {
		return fmt.Sprintf(`throw new TypeError("Type validation too deep at " + %s + " - likely a complex library type");`, nameExpr)
	}
	g.depth++
	defer func() { g.depth-- }()

	// Cycle detection for recursive types - use type key based on symbol
	typeKey := getTypeKey(t)
	if typeKey != "" {
		if g.visiting[typeKey] {
			// Already visiting this type - skip to avoid infinite recursion
			// For recursive types, we just validate object-ness
			return fmt.Sprintf(`if (typeof %s !== "object" && typeof %s !== "function" && typeof %s !== "undefined") throw new TypeError("Expected " + %s + " to be object, got " + typeof %s); `, expr, expr, expr, nameExpr, expr)
		}
		// Mark as visiting before any recursive calls
		g.visiting[typeKey] = true
		defer delete(g.visiting, typeKey)
	}

	// Handle never - always fails
	if flags&checker.TypeFlagsNever != 0 {
		return fmt.Sprintf(`throw new TypeError(%s + " should never have a value");`, nameExpr)
	}

	// Template literal types
	if flags&checker.TypeFlagsTemplateLiteral != 0 {
		return g.templateLiteralValidation(t, expr, nameExpr)
	}

	// Primitives
	if stmt := g.primitiveValidation(t, expr, nameExpr); stmt != "" {
		return stmt
	}

	// Unions (must be before object since union types can have ObjectFlags)
	if flags&checker.TypeFlagsUnion != 0 {
		return g.unionValidation(t, expr, nameExpr)
	}

	// Intersections
	if flags&checker.TypeFlagsIntersection != 0 {
		return g.intersectionValidation(t, expr, nameExpr)
	}

	// Objects (includes arrays, tuples, interfaces)
	if flags&checker.TypeFlagsObject != 0 {
		// Function types can only be validated with typeof === "function"
		if g.isFunctionType(t) {
			// Try to get a meaningful type name for the error message
			typeName := "function"
			if sym := checker.Type_symbol(t); sym != nil && isGoodTypeName(sym.Name) {
				typeName = sym.Name
			}
			return fmt.Sprintf(`if (!("function" === typeof %s)) throw new TypeError("Expected " + %s + " to be %s, got " + typeof %s); `, expr, nameExpr, typeName, expr)
		}
		return g.objectValidation(t, expr, nameExpr)
	}

	return ""
}

// isFunctionType checks if a type is a function type.
// Any type with call signatures OR construct signatures is considered a function type.
// Constructor interfaces like `new() => T` are functions at runtime.
func (g *Generator) isFunctionType(t *checker.Type) bool {
	// Check if it has call signatures - if so, it's a function type
	callSigs := checker.Checker_getSignaturesOfType(g.checker, t, checker.SignatureKindCall)
	if len(callSigs) > 0 {
		return true
	}

	// Check if it has construct signatures - if so, it's a constructor function
	// Interfaces like `interface Ctor { new(): T }` are functions at runtime
	constructSigs := checker.Checker_getSignaturesOfType(g.checker, t, checker.SignatureKindConstruct)
	if len(constructSigs) > 0 {
		return true
	}

	// Check symbol name for Function
	if sym := checker.Type_symbol(t); sym != nil {
		if sym.Name == "Function" {
			return true
		}
	}

	return false
}

// isBuiltInWithToJSON checks if a type is a built-in type that has toJSON method
// and should be passed through to JSON.stringify rather than filtered.
// Examples: Date, Map, Set, RegExp (though RegExp becomes {} in JSON).
func (g *Generator) isBuiltInWithToJSON(t *checker.Type) bool {
	if sym := checker.Type_symbol(t); sym != nil {
		switch sym.Name {
		case "Date", "Map", "Set", "RegExp", "Error", "URL", "URLSearchParams":
			return true
		}
	}
	return false
}

// isTypeOnlyImport checks if a symbol is imported via "import type" and thus
// not available as a value at runtime.
func (g *Generator) isTypeOnlyImport(sym *ast.Symbol) bool {
	if sym == nil {
		return false
	}

	// Check all declarations of the symbol
	for _, decl := range sym.Declarations {
		if decl == nil {
			continue
		}

		// Check if this is an import specifier
		if decl.Kind == ast.KindImportSpecifier {
			// Check if the import specifier itself is type-only
			importSpec := decl.AsImportSpecifier()
			if importSpec != nil && importSpec.IsTypeOnly {
				return true
			}

			// Check if the parent import clause is type-only
			parent := decl.Parent
			if parent != nil {
				// NamedImports -> ImportClause -> ImportDeclaration
				if parent.Kind == ast.KindNamedImports {
					parent = parent.Parent
				}
				if parent != nil && parent.Kind == ast.KindImportClause {
					importClause := parent.AsImportClause()
					if importClause != nil && importClause.IsTypeOnly() {
						return true
					}
				}
			}
		}
	}

	return false
}

// isClassType checks if a type is a class instance type.
// Class types have construct signatures or are declared with 'class' keyword.
func (g *Generator) isClassType(t *checker.Type) bool {
	// Check object flags for class
	objFlags := checker.Type_objectFlags(t)
	if objFlags&checker.ObjectFlagsClass != 0 {
		return true
	}

	// Check if the symbol has a class declaration or is a class-like type
	if sym := checker.Type_symbol(t); sym != nil {
		// Check if symbol has SymbolFlagsClass flag
		if sym.Flags&ast.SymbolFlagsClass != 0 {
			return true
		}

		// Check if symbol has ValueDeclaration that's a class
		if decl := sym.ValueDeclaration; decl != nil {
			if decl.Kind == ast.KindClassDeclaration || decl.Kind == ast.KindClassExpression {
				return true
			}
		}

		// For types like URL, Request, Response etc. from lib.dom.d.ts:
		// They're declared as interface + var with constructor.
		// Check if the symbol's type (static side) has construct signatures.
		staticType := checker.Checker_getTypeOfSymbol(g.checker, sym)
		if staticType != nil {
			constructSigs := checker.Checker_getSignaturesOfType(g.checker, staticType, checker.SignatureKindConstruct)
			if len(constructSigs) > 0 {
				return true
			}
		}
	}

	return false
}

// generateValidationFromNode generates validation using AST node for better detection.
func (g *Generator) generateValidationFromNode(t *checker.Type, typeNode *ast.Node, expr string, nameExpr string) string {
	// Check AST node kind first for array types
	if typeNode != nil && typeNode.Kind == ast.KindArrayType {
		return g.arrayValidationFromNode(t, typeNode, expr, nameExpr)
	}

	// Fall back to regular type-based validation
	return g.generateValidation(t, expr, nameExpr)
}

// primitiveValidation generates validation for primitive types.
func (g *Generator) primitiveValidation(t *checker.Type, expr string, nameExpr string) string {
	flags := checker.Type_flags(t)

	var expected string
	var check string

	switch {
	// Literal types must be checked BEFORE their base types
	case flags&checker.TypeFlagsStringLiteral != 0:
		lt := t.AsLiteralType()
		if lt != nil {
			if str, ok := lt.Value().(string); ok {
				expected = fmt.Sprintf("%q", str)
				check = fmt.Sprintf(`%q === %s`, str, expr)
			}
		}
		if check == "" {
			expected = "string"
			check = fmt.Sprintf(`"string" === typeof %s`, expr)
		}
	case flags&checker.TypeFlagsNumberLiteral != 0:
		lt := t.AsLiteralType()
		if lt != nil {
			expected = fmt.Sprintf("%v", lt.Value())
			check = fmt.Sprintf(`%v === %s`, lt.Value(), expr)
		}
		if check == "" {
			expected = "number"
			check = fmt.Sprintf(`"number" === typeof %s`, expr)
		}
	case flags&checker.TypeFlagsBooleanLiteral != 0:
		lt := t.AsLiteralType()
		if lt != nil {
			if b, ok := lt.Value().(bool); ok {
				expected = fmt.Sprintf("%t", b)
				check = fmt.Sprintf(`%t === %s`, b, expr)
			}
		}
		if check == "" {
			expected = "boolean"
			check = fmt.Sprintf(`"boolean" === typeof %s`, expr)
		}
	case flags&checker.TypeFlagsString != 0:
		expected = "string"
		check = fmt.Sprintf(`"string" === typeof %s`, expr)
	case flags&checker.TypeFlagsNumber != 0:
		expected = "number"
		check = fmt.Sprintf(`"number" === typeof %s`, expr)
	case flags&checker.TypeFlagsBoolean != 0:
		expected = "boolean"
		check = fmt.Sprintf(`"boolean" === typeof %s`, expr)
	case flags&checker.TypeFlagsBigInt != 0:
		expected = "bigint"
		check = fmt.Sprintf(`"bigint" === typeof %s`, expr)
	case flags&checker.TypeFlagsNull != 0:
		expected = "null"
		check = fmt.Sprintf(`null === %s`, expr)
	case flags&checker.TypeFlagsUndefined != 0:
		expected = "undefined"
		check = fmt.Sprintf(`undefined === %s`, expr)
	case flags&checker.TypeFlagsVoid != 0:
		expected = "void"
		check = fmt.Sprintf(`undefined === %s`, expr)
	default:
		return ""
	}

	return fmt.Sprintf(`if (!(%s)) throw new TypeError("Expected " + %s + " to be %s, got " + typeof %s); `,
		check, nameExpr, escapeJSString(expected), expr)
}

// unionValidation generates validation for union types using if-else chain.
// This provides early bail-out: once a matching type is found, validation succeeds immediately.
func (g *Generator) unionValidation(t *checker.Type, expr string, nameExpr string) string {
	members := t.Types()
	if len(members) == 0 {
		return ""
	}

	// Single member union - just validate that member directly
	if len(members) == 1 {
		return g.generateValidation(members[0], expr, nameExpr)
	}

	var sb strings.Builder

	// Generate if-else chain for each member
	for i, member := range members {
		check := g.generateCheck(member, expr)
		if i == 0 {
			sb.WriteString(fmt.Sprintf("if (%s) { } ", check))
		} else {
			sb.WriteString(fmt.Sprintf("else if (%s) { } ", check))
		}
	}

	// Final else: throw error
	expected := g.getUnionDescription(t)
	// For unions of literals (string/number/boolean), show the actual value in the error
	// instead of just "got string" which isn't helpful
	gotExpr := g.getGotExpression(t, expr)
	sb.WriteString(fmt.Sprintf(`else throw new TypeError("Expected " + %s + " to be %s, got " + %s); `,
		nameExpr, escapeJSString(expected), gotExpr))

	return sb.String()
}

// intersectionValidation generates validation for intersection types.
func (g *Generator) intersectionValidation(t *checker.Type, expr string, nameExpr string) string {
	// For intersections, validate each constituent
	members := t.Types()
	var statements []string
	for _, memberType := range members {
		stmt := g.generateValidation(memberType, expr, nameExpr)
		if stmt != "" {
			statements = append(statements, stmt)
		}
	}
	return strings.Join(statements, "")
}

// objectValidation generates validation for object types.
// Note: cycle detection is handled by generateValidation which calls this.
func (g *Generator) objectValidation(t *checker.Type, expr string, nameExpr string) string {
	// Check if it's an array type
	if checker.Checker_isArrayType(g.checker, t) {
		return g.arrayValidation(t, expr, nameExpr)
	}

	// Check if it's a tuple type
	if checker.IsTupleType(t) {
		return g.tupleValidation(t, expr, nameExpr)
	}

	// Check for Array type via symbol name
	if sym := checker.Type_symbol(t); sym != nil && sym.Name == "Array" {
		return g.arrayValidation(t, expr, nameExpr)
	}

	// Built-in classes use instanceof check - they're classes at runtime
	if className := g.isBuiltinClassType(t); className != "" {
		return fmt.Sprintf(`if (!(%s instanceof %s)) throw new TypeError("Expected " + %s + " to be %s instance, got " + (%s === null ? "null" : %s?.constructor?.name ?? typeof %s)); `,
			expr, className, nameExpr, className, expr, expr, expr)
	}

	// Check if this is a class type - use instanceof check
	// The class should be in scope since we're generating code in the same file
	// BUT: skip instanceof for type-only imports (import type { ... }) since they don't exist at runtime
	if g.isClassType(t) {
		sym := checker.Type_symbol(t)
		if sym != nil && !g.isTypeOnlyImport(sym) {
			// Use instanceof - the class is in scope since it's defined/imported in the same file
			return fmt.Sprintf(`if (!(%s instanceof %s)) throw new TypeError("Expected " + %s + " to be %s instance, got " + (%s === null ? "null" : %s?.constructor?.name ?? typeof %s)); `,
				expr, sym.Name, nameExpr, sym.Name, expr, expr, expr)
		}
	}

	// Regular object - validate object-ness then properties
	var sb strings.Builder

	// Get type name for error message
	typeName := "object"
	if sym := checker.Type_symbol(t); sym != nil && isGoodTypeName(sym.Name) {
		typeName = sym.Name
	}

	// Check it's an object and not null
	sb.WriteString(fmt.Sprintf(`if (typeof %s !== "object" || %s === null) throw new TypeError("Expected " + %s + " to be %s, got " + (%s === null ? "null" : typeof %s)); `,
		expr, expr, nameExpr, typeName, expr, expr))

	// Validate each property
	props := checker.Checker_getPropertiesOfType(g.checker, t)
	for _, prop := range props {
		propType := checker.Checker_getTypeOfSymbol(g.checker, prop)
		propName := prop.Name

		// Generate accessor
		accessor := fmt.Sprintf("%s.%s", expr, propName)
		if needsQuoting(propName) {
			accessor = fmt.Sprintf(`%s[%q]`, expr, propName)
		}

		// Generate name expression for error messages
		propNameExpr := fmt.Sprintf(`%s + ".%s"`, nameExpr, propName)

		// Generate validation for this property
		propValidation := g.generateValidation(propType, accessor, propNameExpr)

		if isOptionalProperty(prop) {
			// Optional: only validate if defined
			if propValidation != "" {
				sb.WriteString(fmt.Sprintf(`if (%s !== undefined) { %s} `, accessor, propValidation))
			}
		} else {
			sb.WriteString(propValidation)
		}
	}

	return sb.String()
}

// arrayValidation generates validation for array types.
func (g *Generator) arrayValidation(t *checker.Type, expr string, nameExpr string) string {
	var sb strings.Builder

	// Check it's an array
	sb.WriteString(fmt.Sprintf(`if (!Array.isArray(%s)) throw new TypeError("Expected " + %s + " to be array, got " + typeof %s); `,
		expr, nameExpr, expr))

	// Get element type and validate each element
	typeArgs := checker.Checker_getTypeArguments(g.checker, t)
	if len(typeArgs) > 0 {
		elemType := typeArgs[0]
		// Skip validation for any/unknown element types
		flags := checker.Type_flags(elemType)
		if flags&checker.TypeFlagsAny == 0 && flags&checker.TypeFlagsUnknown == 0 {
			// Use unique variable names for nested arrays
			idx := g.funcIdx
			g.funcIdx++
			iVar := fmt.Sprintf("_i%d", idx)
			eVar := fmt.Sprintf("_e%d", idx)
			elemValidation := g.generateValidation(elemType, eVar, fmt.Sprintf(`%s + "[" + %s + "]"`, nameExpr, iVar))
			if elemValidation != "" {
				// Use 'any' type for element to satisfy strict mode
				sb.WriteString(fmt.Sprintf(`for (let %s = 0; %s < %s.length; %s++) { const %s: any = %s[%s]; %s} `,
					iVar, iVar, expr, iVar, eVar, expr, iVar, elemValidation))
			}
		}
	}

	return sb.String()
}

// arrayValidationFromNode generates array validation using AST node.
func (g *Generator) arrayValidationFromNode(t *checker.Type, typeNode *ast.Node, expr string, nameExpr string) string {
	var sb strings.Builder

	// Check it's an array
	sb.WriteString(fmt.Sprintf(`if (!Array.isArray(%s)) throw new TypeError("Expected " + %s + " to be array, got " + typeof %s); `,
		expr, nameExpr, expr))

	// Get element type from AST node
	if typeNode.Kind == ast.KindArrayType {
		arrayType := typeNode.AsArrayTypeNode()
		if arrayType != nil && arrayType.ElementType != nil {
			elemType := checker.Checker_getTypeFromTypeNode(g.checker, arrayType.ElementType)
			if elemType != nil {
				flags := checker.Type_flags(elemType)
				if flags&checker.TypeFlagsAny == 0 && flags&checker.TypeFlagsUnknown == 0 {
					// Use unique variable names for nested arrays
					idx := g.funcIdx
					g.funcIdx++
					iVar := fmt.Sprintf("_i%d", idx)
					eVar := fmt.Sprintf("_e%d", idx)
					elemValidation := g.generateValidationFromNode(elemType, arrayType.ElementType, eVar, fmt.Sprintf(`%s + "[" + %s + "]"`, nameExpr, iVar))
					if elemValidation != "" {
						// Use 'any' type for element to satisfy strict mode
						sb.WriteString(fmt.Sprintf(`for (let %s = 0; %s < %s.length; %s++) { const %s: any = %s[%s]; %s} `,
							iVar, iVar, expr, iVar, eVar, expr, iVar, elemValidation))
					}
				}
			}
		}
	}

	return sb.String()
}

// getUnionDescription returns a human-readable description of union types.
func (g *Generator) getUnionDescription(t *checker.Type) string {
	members := t.Types()
	if len(members) == 0 {
		return "union"
	}

	var parts []string
	for _, memberType := range members {
		parts = append(parts, g.getExpectedType(memberType))
	}
	return strings.Join(parts, " | ")
}

// isLiteralUnion checks if a union type consists entirely of literal types (string, number, boolean literals).
func (g *Generator) isLiteralUnion(t *checker.Type) bool {
	flags := checker.Type_flags(t)
	if flags&checker.TypeFlagsUnion == 0 {
		return false
	}

	members := t.Types()
	for _, member := range members {
		memberFlags := checker.Type_flags(member)
		// Check if it's a literal type (string literal, number literal, boolean literal, null, undefined)
		isLiteral := memberFlags&(checker.TypeFlagsStringLiteral|checker.TypeFlagsNumberLiteral|checker.TypeFlagsBooleanLiteral|checker.TypeFlagsNull|checker.TypeFlagsUndefined) != 0
		if !isLiteral {
			return false
		}
	}
	return true
}

// getGotExpression returns a JavaScript expression for the "got" part of error messages.
// For literal unions, it shows the actual value (e.g., "got 'invalid'").
// For other types, it shows the type (e.g., "got object").
func (g *Generator) getGotExpression(t *checker.Type, expr string) string {
	// For unions of literals, show the actual value - it's much more helpful
	// E.g., "Expected 'en-AU' | 'en-US', got 'invalid'" instead of "got string"
	if g.isLiteralUnion(t) {
		// Use JSON.stringify for strings to show quotes, otherwise just the value
		return fmt.Sprintf(`(typeof %s === "string" ? "'" + %s + "'" : %s === null ? "null" : String(%s))`, expr, expr, expr, expr)
	}

	// Default: show null explicitly, otherwise show typeof
	return fmt.Sprintf(`(%s === null ? "null" : typeof %s)`, expr, expr)
}

// generateCheck generates a JavaScript expression that checks if `expr` matches type `t`.
// Returns a boolean expression.
func (g *Generator) generateCheck(t *checker.Type, expr string) string {
	flags := checker.Type_flags(t)

	// Handle any/unknown - skip validation
	if flags&checker.TypeFlagsAny != 0 || flags&checker.TypeFlagsUnknown != 0 {
		return "true"
	}

	// Depth limit - complex types like React.FormEvent have very deep hierarchies
	// For checks, we return true (allow) since we can't throw from an expression
	if g.depth > MaxTypeDepth {
		return "true"
	}
	g.depth++
	defer func() { g.depth-- }()

	// Cycle detection for recursive types - use type key based on symbol
	typeKey := getTypeKey(t)
	if typeKey != "" {
		if g.visiting[typeKey] {
			// Already visiting this type - skip to avoid infinite recursion
			// For recursive types in checks, just do basic object check
			return fmt.Sprintf(`("object" === typeof %s || "function" === typeof %s || "undefined" === typeof %s)`, expr, expr, expr)
		}
		// Mark as visiting before any recursive calls
		g.visiting[typeKey] = true
		defer delete(g.visiting, typeKey)
	}

	// Handle never - always fails
	if flags&checker.TypeFlagsNever != 0 {
		return "false"
	}

	// Template literal types
	if flags&checker.TypeFlagsTemplateLiteral != 0 {
		return g.templateLiteralCheck(t, expr)
	}

	// Try primitives first
	if check := g.primitiveCheck(t, expr); check != "" {
		return check
	}

	// Check for unions (must be before object since union types can have ObjectFlags)
	if flags&checker.TypeFlagsUnion != 0 {
		return g.unionCheck(t, expr)
	}

	// Check for intersections
	if flags&checker.TypeFlagsIntersection != 0 {
		return g.intersectionCheck(t, expr)
	}

	// Check for object types (includes arrays, tuples, interfaces)
	if flags&checker.TypeFlagsObject != 0 {
		return g.objectTypeCheck(t, expr)
	}

	// Fallback - unknown type, skip validation
	return "true"
}

// generateCheckFromNode uses both type and AST node for more accurate detection
func (g *Generator) generateCheckFromNode(t *checker.Type, typeNode *ast.Node, expr string) string {
	// Check AST node kind first for array types
	if typeNode != nil && typeNode.Kind == ast.KindArrayType {
		return g.arrayCheckFromNode(t, typeNode, expr)
	}

	// Fall back to regular type-based check
	return g.generateCheck(t, expr)
}

// getExpectedType returns a human-readable type name for error messages.
// Note: The returned string will be embedded in a JS string literal,
// so quotes are escaped for JavaScript.
func (g *Generator) getExpectedType(t *checker.Type) string {
	flags := checker.Type_flags(t)

	switch {
	// Literal types must be checked BEFORE their base types
	case flags&checker.TypeFlagsStringLiteral != 0:
		lt := t.AsLiteralType()
		if lt != nil {
			if str, ok := lt.Value().(string); ok {
				// Use single quotes for JS compatibility in error messages
				return "'" + escapeJSString(str) + "'"
			}
		}
		return "string"
	case flags&checker.TypeFlagsNumberLiteral != 0:
		lt := t.AsLiteralType()
		if lt != nil {
			return fmt.Sprintf("%v", lt.Value())
		}
		return "number"
	case flags&checker.TypeFlagsBooleanLiteral != 0:
		lt := t.AsLiteralType()
		if lt != nil {
			if b, ok := lt.Value().(bool); ok {
				return fmt.Sprintf("%t", b)
			}
		}
		return "boolean"
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
	case flags&checker.TypeFlagsObject != 0:
		if checker.Checker_isArrayType(g.checker, t) {
			return "array"
		}
		// Check if it's a function type
		if g.isFunctionType(t) {
			// Try to get a meaningful name from the symbol
			if sym := checker.Type_symbol(t); sym != nil && isGoodTypeName(sym.Name) {
				return sym.Name
			}
			return "function"
		}
		// Try to get type name from symbol
		if sym := checker.Type_symbol(t); sym != nil && isGoodTypeName(sym.Name) {
			return sym.Name
		}
		return "object"
	case flags&checker.TypeFlagsUnion != 0:
		return g.getUnionDescription(t)
	case flags&checker.TypeFlagsTemplateLiteral != 0:
		pattern := g.parseTemplateLiteral(t)
		if pattern != nil {
			return pattern.getExpectedDescription()
		}
		return "template literal"
	default:
		return "unknown"
	}
}

// templateLiteralCheck generates a JavaScript expression for template literal type checks.
func (g *Generator) templateLiteralCheck(t *checker.Type, expr string) string {
	pattern := g.parseTemplateLiteral(t)
	if pattern == nil {
		// Fallback to string check if we can't parse the template
		return fmt.Sprintf(`"string" === typeof %s`, expr)
	}
	return pattern.RenderAsCheck(expr)
}

// templateLiteralValidation generates validation statements for template literal types.
func (g *Generator) templateLiteralValidation(t *checker.Type, expr string, nameExpr string) string {
	pattern := g.parseTemplateLiteral(t)
	if pattern == nil {
		// Fallback to string validation
		return fmt.Sprintf(`if (!("string" === typeof %s)) throw new TypeError("Expected " + %s + " to be template literal, got " + typeof %s); `,
			expr, nameExpr, expr)
	}

	check := pattern.RenderAsCheck(expr)
	expected := escapeJSString(pattern.getExpectedDescription())

	return fmt.Sprintf(`if (!%s) throw new TypeError("Expected " + %s + " to match %s, got " + typeof %s); `,
		check, nameExpr, expected, expr)
}

// escapeJSString escapes a string for safe embedding in a JavaScript double-quoted string literal.
func escapeJSString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	s = strings.ReplaceAll(s, "\r", `\r`)
	s = strings.ReplaceAll(s, "\t", `\t`)
	return s
}

// reset resets the generator state for a new generation.
func (g *Generator) reset() {
	g.ioFuncs = make([]string, 0)
	g.funcIdx = 0
	g.visiting = make(map[string]bool)
	g.depth = 0
	g.complexityError = ""
}

// getTypeReferenceName extracts the type name from a type reference AST node.
// For example, for `TagsFieldConfig` or `Promise<User>`, it returns "TagsFieldConfig" or "Promise".
// Returns empty string if the node is not a type reference or has no identifiable name.
func getTypeReferenceName(typeNode *ast.Node) string {
	if typeNode == nil {
		return ""
	}

	switch typeNode.Kind {
	case ast.KindTypeReference:
		typeRef := typeNode.AsTypeReferenceNode()
		if typeRef != nil && typeRef.TypeName != nil {
			return getEntityName(typeRef.TypeName)
		}
	case ast.KindExpressionWithTypeArguments:
		// Handle extends clauses like `extends SomeType`
		exprWithArgs := typeNode.AsExpressionWithTypeArguments()
		if exprWithArgs != nil && exprWithArgs.Expression != nil {
			if exprWithArgs.Expression.Kind == ast.KindIdentifier {
				return exprWithArgs.Expression.AsIdentifier().Text
			}
		}
	}

	return ""
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
	}

	return ""
}
