package codegen

import (
	"fmt"
	"strings"

	"github.com/microsoft/typescript-go/shim/checker"
)

// GenerateFilteringValidator generates a validator that validates AND filters.
// Returns a new object containing only the properties defined in the type.
// Used for JSON.parse<T>() transformation.
func (g *Generator) GenerateFilteringValidator(t *checker.Type, typeName string) string {
	g.reset()

	statements := g.generateFilteringValidation(t, "_v", "_n", "_r")

	var sb strings.Builder
	sb.WriteString("((_v: any, _n: string) => { ")

	// Add helper functions
	for _, fn := range g.ioFuncs {
		sb.WriteString(fn)
		sb.WriteString("; ")
	}

	sb.WriteString(statements)
	sb.WriteString("return _r; })")

	return sb.String()
}

// generateFilteringValidation generates statements that validate AND reconstruct the object.
// resultExpr is the variable to assign the filtered result to (e.g., "_r")
func (g *Generator) generateFilteringValidation(t *checker.Type, expr string, nameExpr string, resultExpr string) string {
	flags := checker.Type_flags(t)

	// Handle any/unknown - just return the value as-is
	if flags&checker.TypeFlagsAny != 0 || flags&checker.TypeFlagsUnknown != 0 {
		return fmt.Sprintf("const %s = %s; ", resultExpr, expr)
	}

	// Depth limit
	if g.depth > MaxTypeDepth {
		return fmt.Sprintf(`throw new TypeError("Type validation too deep at " + %s); `, nameExpr)
	}
	g.depth++
	defer func() { g.depth-- }()

	// Cycle detection
	typeKey := getTypeKey(t)
	if typeKey != "" {
		if g.visiting[typeKey] {
			return fmt.Sprintf("const %s = %s; ", resultExpr, expr)
		}
		g.visiting[typeKey] = true
		defer delete(g.visiting, typeKey)
	}

	// Handle null - just validate and assign
	if flags&checker.TypeFlagsNull != 0 {
		return fmt.Sprintf(`if (%s !== null) throw new TypeError("Expected " + %s + " to be null, got " + typeof %s); const %s = null; `,
			expr, nameExpr, expr, resultExpr)
	}

	// Handle undefined
	if flags&checker.TypeFlagsUndefined != 0 || flags&checker.TypeFlagsVoid != 0 {
		return fmt.Sprintf(`if (%s !== undefined) throw new TypeError("Expected " + %s + " to be undefined, got " + typeof %s); const %s = undefined; `,
			expr, nameExpr, expr, resultExpr)
	}

	// Primitives - just validate and assign
	if stmt := g.primitiveFilteringValidation(t, expr, nameExpr, resultExpr); stmt != "" {
		return stmt
	}

	// Unions
	if flags&checker.TypeFlagsUnion != 0 {
		return g.unionFilteringValidation(t, expr, nameExpr, resultExpr)
	}

	// Objects (includes arrays)
	if flags&checker.TypeFlagsObject != 0 {
		if g.isFunctionType(t) {
			// Functions can't be filtered
			return fmt.Sprintf("const %s = %s; ", resultExpr, expr)
		}
		if checker.Checker_isArrayType(g.checker, t) {
			return g.arrayFilteringValidation(t, expr, nameExpr, resultExpr)
		}
		if checker.IsTupleType(t) {
			return g.tupleFilteringValidation(t, expr, nameExpr, resultExpr)
		}
		return g.objectFilteringValidation(t, expr, nameExpr, resultExpr)
	}

	// Fallback - just assign
	return fmt.Sprintf("const %s = %s; ", resultExpr, expr)
}

// primitiveFilteringValidation - for primitives, just validate and assign
func (g *Generator) primitiveFilteringValidation(t *checker.Type, expr string, nameExpr string, resultExpr string) string {
	flags := checker.Type_flags(t)

	var expected string
	var check string

	switch {
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
	default:
		return ""
	}

	return fmt.Sprintf(`if (!(%s)) throw new TypeError("Expected " + %s + " to be %s, got " + typeof %s); const %s = %s; `,
		check, nameExpr, expected, expr, resultExpr, expr)
}

// objectFilteringValidation - validates AND reconstructs the object
func (g *Generator) objectFilteringValidation(t *checker.Type, expr string, nameExpr string, resultExpr string) string {
	var sb strings.Builder

	// Check for class types - use instanceof and return as-is
	// BUT: skip instanceof for type-only imports (import type { ... }) since they don't exist at runtime
	if g.isClassType(t) {
		sym := checker.Type_symbol(t)
		if sym != nil && !g.isTypeOnlyImport(sym) {
			sb.WriteString(fmt.Sprintf(`if (!(%s instanceof %s)) throw new TypeError("Expected " + %s + " to be %s instance, got " + (%s === null ? "null" : %s?.constructor?.name ?? typeof %s)); `,
				expr, sym.Name, nameExpr, sym.Name, expr, expr, expr))
			sb.WriteString(fmt.Sprintf("const %s = %s; ", resultExpr, expr))
			return sb.String()
		}
	}

	// Get type name for error message
	typeName := "object"
	if sym := checker.Type_symbol(t); sym != nil && isGoodTypeName(sym.Name) {
		typeName = sym.Name
	}

	// Check it's an object and not null
	sb.WriteString(fmt.Sprintf(`if (typeof %s !== "object" || %s === null) throw new TypeError("Expected " + %s + " to be %s, got " + (%s === null ? "null" : typeof %s)); `,
		expr, expr, nameExpr, typeName, expr, expr))

	// Create result object
	sb.WriteString(fmt.Sprintf("const %s: any = {}; ", resultExpr))

	// Validate and copy each property
	props := checker.Checker_getPropertiesOfType(g.checker, t)
	for _, prop := range props {
		propType := checker.Checker_getTypeOfSymbol(g.checker, prop)
		propName := prop.Name

		accessor := fmt.Sprintf("%s.%s", expr, propName)
		if needsQuoting(propName) {
			accessor = fmt.Sprintf(`%s[%q]`, expr, propName)
		}

		resultAccessor := fmt.Sprintf("%s.%s", resultExpr, propName)
		if needsQuoting(propName) {
			resultAccessor = fmt.Sprintf(`%s[%q]`, resultExpr, propName)
		}

		propNameExpr := fmt.Sprintf(`%s + ".%s"`, nameExpr, propName)

		propFlags := checker.Type_flags(propType)
		needsRecursiveFilter := propFlags&checker.TypeFlagsObject != 0 && !g.isFunctionType(propType)

		if isOptionalProperty(prop) {
			// Optional: only validate and copy if present
			if needsRecursiveFilter {
				// Nested object - need to recursively filter
				tempVar := fmt.Sprintf("_t%d", g.funcIdx)
				g.funcIdx++
				nestedValidation := g.generateFilteringValidation(propType, accessor, propNameExpr, tempVar)
				sb.WriteString(fmt.Sprintf("if (%s !== undefined) { %s%s = %s; } ",
					accessor, nestedValidation, resultAccessor, tempVar))
			} else {
				// Primitive - validate and assign
				propValidation := g.generateValidation(propType, accessor, propNameExpr)
				sb.WriteString(fmt.Sprintf("if (%s !== undefined) { %s%s = %s; } ",
					accessor, propValidation, resultAccessor, accessor))
			}
		} else {
			// Required property
			if needsRecursiveFilter {
				// Nested object - recursively filter
				tempVar := fmt.Sprintf("_t%d", g.funcIdx)
				g.funcIdx++
				nestedValidation := g.generateFilteringValidation(propType, accessor, propNameExpr, tempVar)
				sb.WriteString(nestedValidation)
				sb.WriteString(fmt.Sprintf("%s = %s; ", resultAccessor, tempVar))
			} else {
				// Primitive or function - validate and assign directly
				propValidation := g.generateValidation(propType, accessor, propNameExpr)
				sb.WriteString(propValidation)
				sb.WriteString(fmt.Sprintf("%s = %s; ", resultAccessor, accessor))
			}
		}
	}

	return sb.String()
}

// arrayFilteringValidation - validates and filters each element
func (g *Generator) arrayFilteringValidation(t *checker.Type, expr string, nameExpr string, resultExpr string) string {
	var sb strings.Builder

	// Check it's an array
	sb.WriteString(fmt.Sprintf(`if (!Array.isArray(%s)) throw new TypeError("Expected " + %s + " to be array, got " + typeof %s); `,
		expr, nameExpr, expr))

	// Get element type
	typeArgs := checker.Checker_getTypeArguments(g.checker, t)
	if len(typeArgs) > 0 {
		elemType := typeArgs[0]
		flags := checker.Type_flags(elemType)

		if flags&checker.TypeFlagsAny == 0 && flags&checker.TypeFlagsUnknown == 0 {
			idx := g.funcIdx
			g.funcIdx++
			iVar := fmt.Sprintf("_i%d", idx)
			eVar := fmt.Sprintf("_e%d", idx)
			filteredVar := fmt.Sprintf("_f%d", idx)

			// Check if element needs filtering (objects) or just validation (primitives)
			needsFiltering := flags&checker.TypeFlagsObject != 0 && !g.isFunctionType(elemType)

			sb.WriteString(fmt.Sprintf("const %s: any[] = []; ", resultExpr))

			if needsFiltering {
				elemFiltering := g.generateFilteringValidation(elemType, eVar,
					fmt.Sprintf(`%s + "[" + %s + "]"`, nameExpr, iVar), filteredVar)
				sb.WriteString(fmt.Sprintf(`for (let %s = 0; %s < %s.length; %s++) { const %s: any = %s[%s]; %s%s.push(%s); } `,
					iVar, iVar, expr, iVar, eVar, expr, iVar, elemFiltering, resultExpr, filteredVar))
			} else {
				// Just validate and push
				elemValidation := g.generateValidation(elemType, eVar,
					fmt.Sprintf(`%s + "[" + %s + "]"`, nameExpr, iVar))
				sb.WriteString(fmt.Sprintf(`for (let %s = 0; %s < %s.length; %s++) { const %s: any = %s[%s]; %s%s.push(%s); } `,
					iVar, iVar, expr, iVar, eVar, expr, iVar, elemValidation, resultExpr, eVar))
			}
			return sb.String()
		}
	}

	// No type args or any - just copy
	sb.WriteString(fmt.Sprintf("const %s = [...%s]; ", resultExpr, expr))
	return sb.String()
}

// tupleFilteringValidation - validates and filters tuple elements
func (g *Generator) tupleFilteringValidation(t *checker.Type, expr string, nameExpr string, resultExpr string) string {
	var sb strings.Builder

	// Check it's an array
	sb.WriteString(fmt.Sprintf(`if (!Array.isArray(%s)) throw new TypeError("Expected " + %s + " to be tuple, got " + typeof %s); `,
		expr, nameExpr, expr))

	// Get tuple elements
	typeArgs := checker.Checker_getTypeArguments(g.checker, t)

	// Check length
	sb.WriteString(fmt.Sprintf(`if (%s.length < %d) throw new TypeError("Expected " + %s + " to have at least %d elements, got " + %s.length); `,
		expr, len(typeArgs), nameExpr, len(typeArgs), expr))

	sb.WriteString(fmt.Sprintf("const %s: any[] = []; ", resultExpr))

	for i, elemType := range typeArgs {
		flags := checker.Type_flags(elemType)
		iVar := fmt.Sprintf("%d", i)
		eVar := fmt.Sprintf("%s[%d]", expr, i)
		elemNameExpr := fmt.Sprintf(`%s + "[%d]"`, nameExpr, i)

		needsFiltering := flags&checker.TypeFlagsObject != 0 && !g.isFunctionType(elemType)

		if needsFiltering {
			filteredVar := fmt.Sprintf("_tf%d", g.funcIdx)
			g.funcIdx++
			elemFiltering := g.generateFilteringValidation(elemType, eVar, elemNameExpr, filteredVar)
			sb.WriteString(elemFiltering)
			sb.WriteString(fmt.Sprintf("%s[%s] = %s; ", resultExpr, iVar, filteredVar))
		} else {
			elemValidation := g.generateValidation(elemType, eVar, elemNameExpr)
			sb.WriteString(elemValidation)
			sb.WriteString(fmt.Sprintf("%s[%s] = %s; ", resultExpr, iVar, eVar))
		}
	}

	return sb.String()
}

// unionFilteringValidation - for unions, determine which branch matches and filter accordingly
func (g *Generator) unionFilteringValidation(t *checker.Type, expr string, nameExpr string, resultExpr string) string {
	members := t.Types()

	// Check if any member is an object type that needs filtering
	hasObjectMember := false
	for _, member := range members {
		flags := checker.Type_flags(member)
		if flags&checker.TypeFlagsObject != 0 && !g.isFunctionType(member) {
			hasObjectMember = true
			break
		}
	}

	if !hasObjectMember {
		// Simple union of primitives/null/undefined - just validate and assign
		validation := g.unionValidation(t, expr, nameExpr)
		return validation + fmt.Sprintf("const %s = %s; ", resultExpr, expr)
	}

	// Complex union with objects - generate if-else chain
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("let %s: any; ", resultExpr))

	for i, member := range members {
		memberFlags := checker.Type_flags(member)
		check := g.generateCheck(member, expr)

		if i == 0 {
			sb.WriteString(fmt.Sprintf("if (%s) { ", check))
		} else {
			sb.WriteString(fmt.Sprintf("} else if (%s) { ", check))
		}

		needsFiltering := memberFlags&checker.TypeFlagsObject != 0 && !g.isFunctionType(member)

		if needsFiltering {
			tempVar := fmt.Sprintf("_u%d", g.funcIdx)
			g.funcIdx++
			filtering := g.generateFilteringValidation(member, expr, nameExpr, tempVar)
			sb.WriteString(filtering)
			sb.WriteString(fmt.Sprintf("%s = %s; ", resultExpr, tempVar))
		} else {
			sb.WriteString(fmt.Sprintf("%s = %s; ", resultExpr, expr))
		}
	}

	// Final else - throw error
	expected := g.getUnionDescription(t)
	sb.WriteString(fmt.Sprintf(`} else { throw new TypeError("Expected " + %s + " to be %s, got " + typeof %s); } `,
		nameExpr, expected, expr))

	return sb.String()
}
