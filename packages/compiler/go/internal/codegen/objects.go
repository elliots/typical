package codegen

import (
	"fmt"
	"strings"

	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/checker"
	"github.com/elliots/typical/packages/compiler/internal/utils"
)

// isBuiltinClassType checks if a type is a built-in class from the default library.
// If a type is from lib.*.d.ts and has a constructor, it's a class at runtime
// and should use instanceof checks (e.g., Set, Map, Date, HTMLElement, Request, etc.)
// This also checks base types recursively - if MyElement extends HTMLElement,
// it will still be detected as a builtin class.
func (g *Generator) isBuiltinClassType(t *checker.Type) string {
	if g.program == nil {
		return ""
	}

	// Get the symbol name to use for instanceof (use the original type's name, not base)
	sym := checker.Type_symbol(t)
	if sym == nil {
		return ""
	}
	typeName := sym.Name

	// Check this type and its base types recursively
	if g.isBuiltinClassTypeRecursive(t, make(map[*checker.Type]bool)) {
		return typeName
	}

	return ""
}

// isBuiltinClassTypeRecursive checks if a type or any of its base types is a builtin class.
func (g *Generator) isBuiltinClassTypeRecursive(t *checker.Type, visited map[*checker.Type]bool) bool {
	if visited[t] {
		return false
	}
	visited[t] = true

	// Handle union types - all parts must be builtin classes
	if utils.IsUnionType(t) {
		for _, part := range utils.UnionTypeParts(t) {
			if !g.isBuiltinClassTypeRecursive(part, visited) {
				return false
			}
		}
		return true
	}

	// Handle intersection types - any part can be a builtin class
	if utils.IsIntersectionType(t) {
		for _, part := range utils.IntersectionTypeParts(t) {
			if g.isBuiltinClassTypeRecursive(part, visited) {
				return true
			}
		}
		return false
	}

	// Handle type parameters - check the constraint
	if utils.IsTypeParameter(t) {
		constraint := checker.Checker_getBaseConstraintOfType(g.checker, t)
		if constraint != nil {
			return g.isBuiltinClassTypeRecursive(constraint, visited)
		}
		return false
	}

	// Check if this specific type is a builtin class
	sym := checker.Type_symbol(t)
	if sym == nil {
		return false
	}

	// If from default library and has constructor, it's a builtin class
	if utils.IsSymbolFromDefaultLibrary(g.program, sym) {
		// Check for construct signatures
		staticType := checker.Checker_getTypeOfSymbol(g.checker, sym)
		if staticType != nil {
			if len(utils.GetConstructSignatures(g.checker, staticType)) > 0 {
				return true
			}
		}
		// Also check if the symbol itself is a class
		if sym.Flags&ast.SymbolFlagsClass != 0 {
			return true
		}
	}

	// Check base types recursively
	if sym.Flags&(ast.SymbolFlagsClass|ast.SymbolFlagsInterface) != 0 {
		declaredType := checker.Checker_getDeclaredTypeOfSymbol(g.checker, sym)
		for _, baseType := range checker.Checker_getBaseTypes(g.checker, declaredType) {
			if g.isBuiltinClassTypeRecursive(baseType, visited) {
				return true
			}
		}
	}

	return false
}

// objectTypeCheck generates a JavaScript expression for object type checks.
// This handles both regular objects (interfaces) and arrays.
// Note: cycle detection is handled by generateCheck which calls this.
func (g *Generator) objectTypeCheck(t *checker.Type, expr string) string {
	// Function types can only be checked with typeof - we can't validate signatures at runtime
	if g.isFunctionType(t) {
		return fmt.Sprintf(`("function" === typeof %s)`, expr)
	}

	// Get object flags to check the kind of object
	objFlags := checker.Type_objectFlags(t)

	// IMPORTANT: Check for array/tuple types BEFORE checking for builtin class types.
	// Array is a builtin class, but we want to validate element types, not just instanceof.

	// Check if it's a reference type (Array<T>, etc.)
	if objFlags&checker.ObjectFlagsReference != 0 {
		// Check if it's an array type
		if checker.Checker_isArrayType(g.checker, t) {
			return g.arrayCheck(t, expr)
		}
		// Check if it's a tuple type
		if checker.Checker_isArrayOrTupleType(g.checker, t) && checker.IsTupleType(t) {
			return g.tupleCheck(t, expr)
		}
	}

	// Check for Array type via the symbol name
	if sym := checker.Type_symbol(t); sym != nil {
		if sym.Name == "Array" {
			return g.arrayCheck(t, expr)
		}
	}

	// Check if this looks like an array type by checking for array-specific properties
	// Anonymous types with "length", "push", "pop" are likely arrays
	if objFlags&checker.ObjectFlagsAnonymous != 0 {
		if g.looksLikeArrayType(t) {
			return g.arrayCheckFromAnonymous(t, expr)
		}
	}

	// Built-in classes use instanceof check - they're classes at runtime
	// (but not Array, which needs element validation - handled above)
	if className := g.isBuiltinClassType(t); className != "" {
		return fmt.Sprintf(`(%s instanceof %s)`, expr, className)
	}

	// Regular object type - create _io function
	return g.objectCheck(t, expr)
}

// looksLikeArrayType checks if an anonymous type appears to be an array
func (g *Generator) looksLikeArrayType(t *checker.Type) bool {
	props := checker.Checker_getPropertiesOfType(g.checker, t)

	// Look for array-specific method/property names
	hasLength := false
	hasPush := false
	hasPop := false

	for _, p := range props {
		switch p.Name {
		case "length":
			hasLength = true
		case "push":
			hasPush = true
		case "pop":
			hasPop = true
		}
	}

	// If it has length + push + pop, it's definitely array-like
	return hasLength && hasPush && hasPop
}

// arrayCheckFromAnonymous generates array check for anonymous array types (string[], etc.)
func (g *Generator) arrayCheckFromAnonymous(t *checker.Type, expr string) string {
	// Try to get the element type from the type arguments
	typeArgs := checker.Checker_getTypeArguments(g.checker, t)
	if len(typeArgs) > 0 {
		elemCheck := g.generateCheck(typeArgs[0], "elem")
		// Use 'any' type for elem to satisfy strict mode
		return fmt.Sprintf("Array.isArray(%s) && %s.every((elem: any) => %s)",
			expr, expr, elemCheck)
	}

	// Fallback - just check if it's an array
	return fmt.Sprintf("Array.isArray(%s)", expr)
}

// objectCheck generates a check for a plain object type (interface/type literal).
func (g *Generator) objectCheck(t *checker.Type, expr string) string {
	// Note: cycle detection is handled by objectTypeCheck which calls this

	// Get type name for error messages
	typeName := "anonymous"
	if sym := checker.Type_symbol(t); sym != nil && sym.Name != "" {
		typeName = sym.Name
	}

	// Check complexity limit before creating another _io function
	// Use the richer error reporting version that includes source file and properties
	if g.checkComplexityLimitWithType(t) {
		// Return a simple check that will pass - the error will be propagated up
		return "true"
	}

	// Push type onto stack for error context
	g.pushType(typeName)
	defer g.popType()

	// Create a new _io function for this object type
	funcName := fmt.Sprintf("_io%d", g.funcIdx)
	g.funcIdx++

	// Get all properties of the type
	props := checker.Checker_getPropertiesOfType(g.checker, t)

	var checks []string
	for _, prop := range props {
		propType := checker.Checker_getTypeOfSymbol(g.checker, prop)
		propName := prop.Name

		// Handle 'never' type properties - they must NOT be defined
		propFlags := checker.Type_flags(propType)
		if propFlags&checker.TypeFlagsNever != 0 {
			// Check that property is not in the object
			propKey := escapeJSStringQuoted(propName)
			checks = append(checks, fmt.Sprintf(`!(%s in input)`, propKey))
			continue
		}

		// Generate accessor - handle property names that need quoting
		accessor := fmt.Sprintf("input.%s", propName)
		if needsQuoting(propName) {
			accessor = fmt.Sprintf(`input[%q]`, propName)
		}

		// Push property name for context
		g.pushType(propName)

		// Generate check for this property
		check := g.generateCheck(propType, accessor)

		g.popType()

		// Handle optional properties
		if isOptionalProperty(prop) {
			check = fmt.Sprintf("(undefined === %s || %s)", accessor, check)
		}

		checks = append(checks, check)
	}

	// Check for string index signature and validate all values
	stringType := checker.Checker_stringType(g.checker)
	if stringType != nil {
		indexValueType := checker.Checker_getIndexTypeOfType(g.checker, t, stringType)
		if indexValueType != nil {
			// Generate a check for index signature values
			// Use Object.values().every() to validate all values
			valueCheck := g.generateCheck(indexValueType, "v")
			checks = append(checks, fmt.Sprintf("Object.values(input).every((v: any) => %s)", valueCheck))
		}
	}

	// Build function body
	funcBody := "true"
	if len(checks) > 0 {
		funcBody = strings.Join(checks, " && ")
	}

	// Add the function to our list (use 'any' type for strict mode)
	g.ioFuncs = append(g.ioFuncs, fmt.Sprintf("const %s = (input: any) => %s", funcName, funcBody))

	// Return the object check expression
	return fmt.Sprintf(`"object" === typeof %s && null !== %s && %s(%s)`,
		expr, expr, funcName, expr)
}

// objectAssertCheck generates an assertion check for objects with path tracking.
func (g *Generator) objectAssertCheck(t *checker.Type, expr string, path string) string {
	// Check if it's an array first
	if checker.Checker_isArrayType(g.checker, t) {
		// For arrays, just do basic is-check for now
		isCheck := g.arrayCheck(t, expr)
		return fmt.Sprintf("(%s || _errorFactory && _errorFactory({ path: %s, expected: \"Array\", value: %s }))",
			isCheck, path, expr)
	}

	// For objects, check object-ness first
	objectCheck := fmt.Sprintf(`"object" === typeof %s && null !== %s`, expr, expr)

	// Get properties and generate individual checks
	props := checker.Checker_getPropertiesOfType(g.checker, t)

	var propChecks []string
	propChecks = append(propChecks, fmt.Sprintf("(%s || _errorFactory && _errorFactory({ path: %s, expected: \"object\", value: %s }))",
		objectCheck, path, expr))

	for _, prop := range props {
		propType := checker.Checker_getTypeOfSymbol(g.checker, prop)
		propName := prop.Name

		accessor := fmt.Sprintf("%s.%s", expr, propName)
		if needsQuoting(propName) {
			accessor = fmt.Sprintf(`%s[%q]`, expr, propName)
		}

		propPath := fmt.Sprintf(`%s + ".%s"`, path, propName)

		// Generate check for this property
		check := g.generateCheck(propType, accessor)
		expected := g.getExpectedType(propType)

		if isOptionalProperty(prop) {
			check = fmt.Sprintf("(undefined === %s || %s)", accessor, check)
		}

		propChecks = append(propChecks, fmt.Sprintf("(%s || _errorFactory && _errorFactory({ path: %s, expected: %q, value: %s }))",
			check, propPath, expected, accessor))
	}

	return strings.Join(propChecks, " && ")
}

// isOptionalProperty checks if a property symbol is optional.
func isOptionalProperty(prop *ast.Symbol) bool {
	// Check if the symbol has the Optional flag
	flags := prop.Flags
	// SymbolFlagsOptional = 1 << 14 = 16384
	return flags&ast.SymbolFlagsOptional != 0
}

// needsQuoting checks if a property name needs to be quoted in JavaScript.
func needsQuoting(name string) bool {
	if len(name) == 0 {
		return true
	}

	// Check first character
	first := name[0]
	if !((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') || first == '_' || first == '$') {
		return true
	}

	// Check remaining characters
	for i := 1; i < len(name); i++ {
		c := name[i]
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$') {
			return true
		}
	}

	// Check for reserved words
	reserved := map[string]bool{
		"break": true, "case": true, "catch": true, "continue": true,
		"debugger": true, "default": true, "delete": true, "do": true,
		"else": true, "finally": true, "for": true, "function": true,
		"if": true, "in": true, "instanceof": true, "new": true,
		"return": true, "switch": true, "this": true, "throw": true,
		"try": true, "typeof": true, "var": true, "void": true,
		"while": true, "with": true, "class": true, "const": true,
		"enum": true, "export": true, "extends": true, "import": true,
		"super": true, "implements": true, "interface": true, "let": true,
		"package": true, "private": true, "protected": true, "public": true,
		"static": true, "yield": true,
	}

	return reserved[name]
}
