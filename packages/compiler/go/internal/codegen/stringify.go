package codegen

import (
	"fmt"
	"strings"

	"github.com/microsoft/typescript-go/shim/checker"
)

// GenerateStringifier generates a function that filters to typed properties then calls JSON.stringify.
func (g *Generator) GenerateStringifier(t *checker.Type, typeName string) string {
	g.reset()

	statements := g.generateFilter(t, "_v", "_n", "_r")

	var sb strings.Builder
	sb.WriteString("((_v: any, _n: string) => { ")

	// Add helper functions
	for _, fn := range g.ioFuncs {
		sb.WriteString(fn)
		sb.WriteString("; ")
	}

	sb.WriteString(statements)
	sb.WriteString("return JSON.stringify(_r); })")

	return sb.String()
}

// generateFilter generates filtering code that copies only typed properties.
func (g *Generator) generateFilter(t *checker.Type, expr string, nameExpr string, resultExpr string) string {
	flags := checker.Type_flags(t)

	// Handle any/unknown
	if flags&checker.TypeFlagsAny != 0 || flags&checker.TypeFlagsUnknown != 0 {
		return fmt.Sprintf("let %s = %s; ", resultExpr, expr)
	}

	// Handle null
	if flags&checker.TypeFlagsNull != 0 {
		return fmt.Sprintf("let %s = null; ", resultExpr)
	}

	// Primitives - no filtering needed
	if flags&(checker.TypeFlagsString|checker.TypeFlagsNumber|checker.TypeFlagsBoolean|
		checker.TypeFlagsBigInt|checker.TypeFlagsUndefined|checker.TypeFlagsVoid|
		checker.TypeFlagsStringLiteral|checker.TypeFlagsNumberLiteral|
		checker.TypeFlagsBooleanLiteral) != 0 {
		return fmt.Sprintf("let %s = %s; ", resultExpr, expr)
	}

	// Unions
	if flags&checker.TypeFlagsUnion != 0 {
		return g.unionFilter(t, expr, nameExpr, resultExpr)
	}

	// Objects
	if flags&checker.TypeFlagsObject != 0 {
		// Check for built-in types like Date that have toJSON and should pass through
		if g.isBuiltInWithToJSON(t) {
			return fmt.Sprintf("let %s = %s; ", resultExpr, expr)
		}
		if checker.Checker_isArrayType(g.checker, t) {
			return g.arrayFilter(t, expr, nameExpr, resultExpr)
		}
		return g.objectFilter(t, expr, nameExpr, resultExpr)
	}

	return fmt.Sprintf("let %s = %s; ", resultExpr, expr)
}

// objectFilter generates filter code for objects.
func (g *Generator) objectFilter(t *checker.Type, expr string, nameExpr string, resultExpr string) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("let %s: any; ", resultExpr))
	sb.WriteString(fmt.Sprintf(`if (%s === null || typeof %s !== "object") { %s = %s; `, expr, expr, resultExpr, expr))
	sb.WriteString("} else { ")

	sb.WriteString(fmt.Sprintf("%s = {}; ", resultExpr))

	props := checker.Checker_getPropertiesOfType(g.checker, t)
	for _, prop := range props {
		propName := prop.Name
		propType := checker.Checker_getTypeOfSymbol(g.checker, prop)

		accessor := fmt.Sprintf("%s.%s", expr, propName)
		if needsQuoting(propName) {
			accessor = fmt.Sprintf(`%s[%q]`, expr, propName)
		}

		resultAccessor := fmt.Sprintf("%s.%s", resultExpr, propName)
		if needsQuoting(propName) {
			resultAccessor = fmt.Sprintf(`%s[%q]`, resultExpr, propName)
		}

		propFlags := checker.Type_flags(propType)
		needsRecursion := propFlags&checker.TypeFlagsObject != 0 && !g.isFunctionType(propType)

		sb.WriteString(fmt.Sprintf("if (%s !== undefined) { ", accessor))

		if needsRecursion {
			tempVar := fmt.Sprintf("_pf%d", g.funcIdx)
			g.funcIdx++
			nestedFilter := g.generateFilter(propType, accessor, "", tempVar)
			sb.WriteString(nestedFilter)
			sb.WriteString(fmt.Sprintf("%s = %s; ", resultAccessor, tempVar))
		} else {
			sb.WriteString(fmt.Sprintf("%s = %s; ", resultAccessor, accessor))
		}

		sb.WriteString("} ")
	}

	sb.WriteString("} ")

	return sb.String()
}

// arrayFilter generates filter code for arrays.
func (g *Generator) arrayFilter(t *checker.Type, expr string, nameExpr string, resultExpr string) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("let %s: any; ", resultExpr))
	sb.WriteString(fmt.Sprintf(`if (!Array.isArray(%s)) { %s = %s; `, expr, resultExpr, expr))
	sb.WriteString("} else { ")

	typeArgs := checker.Checker_getTypeArguments(g.checker, t)
	if len(typeArgs) > 0 {
		elemType := typeArgs[0]
		flags := checker.Type_flags(elemType)

		needsRecursion := flags&checker.TypeFlagsObject != 0 && !g.isFunctionType(elemType)

		if needsRecursion {
			idx := g.funcIdx
			g.funcIdx++
			sb.WriteString(fmt.Sprintf("%s = []; ", resultExpr))
			iVar := fmt.Sprintf("_afi%d", idx)
			sb.WriteString(fmt.Sprintf(`for (let %s = 0; %s < %s.length; %s++) { `, iVar, iVar, expr, iVar))

			tempVar := fmt.Sprintf("_afe%d", idx)
			elemExpr := fmt.Sprintf("%s[%s]", expr, iVar)
			nestedFilter := g.generateFilter(elemType, elemExpr, "", tempVar)
			sb.WriteString(nestedFilter)
			sb.WriteString(fmt.Sprintf("%s.push(%s); ", resultExpr, tempVar))

			sb.WriteString("} ")
		} else {
			// Primitives - just copy
			sb.WriteString(fmt.Sprintf("%s = [...%s]; ", resultExpr, expr))
		}
	} else {
		sb.WriteString(fmt.Sprintf("%s = [...%s]; ", resultExpr, expr))
	}

	sb.WriteString("} ")

	return sb.String()
}

// unionFilter generates filter code for unions.
func (g *Generator) unionFilter(t *checker.Type, expr string, nameExpr string, resultExpr string) string {
	members := t.Types()

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("let %s: any; ", resultExpr))

	for i, member := range members {
		flags := checker.Type_flags(member)
		check := g.generateCheck(member, expr)

		if i == 0 {
			sb.WriteString(fmt.Sprintf("if (%s) { ", check))
		} else {
			sb.WriteString(fmt.Sprintf("} else if (%s) { ", check))
		}

		needsRecursion := flags&checker.TypeFlagsObject != 0 && !g.isFunctionType(member)

		if needsRecursion {
			tempVar := fmt.Sprintf("_uf%d", g.funcIdx)
			g.funcIdx++
			filter := g.generateFilter(member, expr, nameExpr, tempVar)
			sb.WriteString(filter)
			sb.WriteString(fmt.Sprintf("%s = %s; ", resultExpr, tempVar))
		} else {
			sb.WriteString(fmt.Sprintf("%s = %s; ", resultExpr, expr))
		}
	}

	sb.WriteString(fmt.Sprintf("} else { %s = %s; } ", resultExpr, expr))

	return sb.String()
}
