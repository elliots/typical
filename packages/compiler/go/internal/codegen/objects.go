package codegen

import (
	"fmt"
	"strings"

	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/checker"
)

// objectTypeCheck generates a JavaScript expression for object type checks.
// This handles both regular objects (interfaces) and arrays.
// Note: cycle detection is handled by generateCheck which calls this.
func (g *Generator) objectTypeCheck(t *checker.Type, expr string) string {
	// Get object flags to check the kind of object
	objFlags := checker.Type_objectFlags(t)

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

	// Create a new _io function for this object type
	funcName := fmt.Sprintf("_io%d", g.funcIdx)
	g.funcIdx++

	// Get all properties of the type
	props := checker.Checker_getPropertiesOfType(g.checker, t)

	var checks []string
	for _, prop := range props {
		propType := checker.Checker_getTypeOfSymbol(g.checker, prop)
		propName := prop.Name

		// Generate accessor - handle property names that need quoting
		accessor := fmt.Sprintf("input.%s", propName)
		if needsQuoting(propName) {
			accessor = fmt.Sprintf(`input[%q]`, propName)
		}

		// Generate check for this property
		check := g.generateCheck(propType, accessor)

		// Handle optional properties
		if isOptionalProperty(prop) {
			check = fmt.Sprintf("(undefined === %s || %s)", accessor, check)
		}

		checks = append(checks, check)
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
