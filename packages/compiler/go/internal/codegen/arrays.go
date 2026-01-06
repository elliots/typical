package codegen

import (
	"fmt"
	"strings"

	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/checker"
)

// arrayCheck generates a JavaScript expression for array type checks.
func (g *Generator) arrayCheck(t *checker.Type, expr string) string {
	// Get the element type
	typeArgs := checker.Checker_getTypeArguments(g.checker, t)

	// If no type arguments, just check if it's an array
	if len(typeArgs) == 0 {
		return fmt.Sprintf("Array.isArray(%s)", expr)
	}

	// Generate element check
	elemType := typeArgs[0]
	elemCheck := g.generateCheck(elemType, "elem")

	// For simple primitive checks, inline the every() call
	// For complex checks, we might want to create a separate function

	// Use 'any' type for elem to satisfy strict mode
	return fmt.Sprintf("Array.isArray(%s) && %s.every((elem: any) => %s)",
		expr, expr, elemCheck)
}

// tupleValidation generates validation statements for tuple types.
func (g *Generator) tupleValidation(t *checker.Type, expr string, nameExpr string) string {
	var sb strings.Builder

	// Check it's an array - use optimised error message
	errorNameExpr := g.errorName(nameExpr)
	errorMsg := concatStrings(`"Expected "`, errorNameExpr)
	errorMsg = concatStrings(errorMsg, fmt.Sprintf(`" to be tuple, got " + typeof %s`, expr))
	sb.WriteString(fmt.Sprintf(`if (!Array.isArray(%s)) %s; `, expr, g.throwOrReturn(errorMsg)))

	// Get tuple element types
	typeArgs := checker.Checker_getTypeArguments(g.checker, t)

	// Get tuple type info for length checking
	tupleType := checker.Type_TargetTupleType(t)
	if tupleType != nil {
		combinedFlags := checker.TupleType_combinedFlags(tupleType)

		if combinedFlags&checker.ElementFlagsRest != 0 {
			// Has rest element - check minimum length
			if len(typeArgs) > 1 {
				lenErrorMsg := concatStrings(`"Expected "`, errorNameExpr)
				lenErrorMsg = concatStrings(lenErrorMsg, fmt.Sprintf(`" to have at least %d elements, got " + %s.length`, len(typeArgs)-1, expr))
				sb.WriteString(fmt.Sprintf(`if (%s.length < %d) %s; `, expr, len(typeArgs)-1, g.throwOrReturn(lenErrorMsg)))
			}
		} else if combinedFlags&checker.ElementFlagsOptional != 0 {
			// Has optional elements - check max length
			lenErrorMsg := concatStrings(`"Expected "`, errorNameExpr)
			lenErrorMsg = concatStrings(lenErrorMsg, fmt.Sprintf(`" to have at most %d elements, got " + %s.length`, len(typeArgs), expr))
			sb.WriteString(fmt.Sprintf(`if (%s.length > %d) %s; `, expr, len(typeArgs), g.throwOrReturn(lenErrorMsg)))
		} else {
			// Fixed length tuple
			lenErrorMsg := concatStrings(`"Expected "`, errorNameExpr)
			lenErrorMsg = concatStrings(lenErrorMsg, fmt.Sprintf(`" to have %d elements, got " + %s.length`, len(typeArgs), expr))
			sb.WriteString(fmt.Sprintf(`if (%s.length !== %d) %s; `, expr, len(typeArgs), g.throwOrReturn(lenErrorMsg)))
		}
	} else {
		// Fallback - assume fixed length
		lenErrorMsg := concatStrings(`"Expected "`, errorNameExpr)
		lenErrorMsg = concatStrings(lenErrorMsg, fmt.Sprintf(`" to have %d elements, got " + %s.length`, len(typeArgs), expr))
		sb.WriteString(fmt.Sprintf(`if (%s.length !== %d) %s; `, expr, len(typeArgs), g.throwOrReturn(lenErrorMsg)))
	}

	// Validate each element
	for i, elemType := range typeArgs {
		elemExpr := fmt.Sprintf("%s[%d]", expr, i)
		// Optimise: for static index, append directly if nameExpr is a literal
		elemNameExpr := g.appendToName(nameExpr, fmt.Sprintf("[%d]", i))
		elemValidation := g.generateValidation(elemType, elemExpr, elemNameExpr)
		if elemValidation != "" {
			sb.WriteString(elemValidation)
		}
	}

	return sb.String()
}

// tupleCheck generates a JavaScript expression for tuple type checks.
func (g *Generator) tupleCheck(t *checker.Type, expr string) string {
	// Get tuple element types
	typeArgs := checker.Checker_getTypeArguments(g.checker, t)

	if len(typeArgs) == 0 {
		// Empty tuple - just check it's an array with length 0
		return fmt.Sprintf("Array.isArray(%s) && %s.length === 0", expr, expr)
	}

	// Build checks for each element
	checks := []string{
		fmt.Sprintf("Array.isArray(%s)", expr),
	}

	// Get tuple type info to check for rest/optional elements
	// Use Type_TargetTupleType to safely get the tuple type from a reference
	tupleType := checker.Type_TargetTupleType(t)
	if tupleType != nil {
		// Check minimum length (accounting for optional and rest elements)
		combinedFlags := checker.TupleType_combinedFlags(tupleType)

		// If there are rest elements, we can't check exact length
		if combinedFlags&checker.ElementFlagsRest != 0 {
			// Just check minimum length
			minLen := 0
			for i := 0; i < len(typeArgs); i++ {
				// Count required elements
				minLen++
			}
			if minLen > 0 {
				checks = append(checks, fmt.Sprintf("%s.length >= %d", expr, minLen-1))
			}
		} else if combinedFlags&checker.ElementFlagsOptional != 0 {
			// Has optional elements - check minimum and maximum
			// For now, just check it's at least some length
			checks = append(checks, fmt.Sprintf("%s.length <= %d", expr, len(typeArgs)))
		} else {
			// Fixed length tuple
			checks = append(checks, fmt.Sprintf("%s.length === %d", expr, len(typeArgs)))
		}
	} else {
		// Fallback - assume fixed length
		checks = append(checks, fmt.Sprintf("%s.length === %d", expr, len(typeArgs)))
	}

	// Add check for each element
	for i, elemType := range typeArgs {
		accessor := fmt.Sprintf("%s[%d]", expr, i)
		elemCheck := g.generateCheck(elemType, accessor)
		checks = append(checks, elemCheck)
	}

	return "(" + joinWithAnd(checks) + ")"
}

// joinWithAnd joins strings with " && ".
func joinWithAnd(parts []string) string {
	if len(parts) == 0 {
		return "true"
	}
	if len(parts) == 1 {
		return parts[0]
	}

	result := parts[0]
	for i := 1; i < len(parts); i++ {
		result += " && " + parts[i]
	}
	return result
}

// arrayCheckFromNode generates array check using the AST node to get element type.
// This is used when the type node is KindArrayType (e.g., string[]).
func (g *Generator) arrayCheckFromNode(t *checker.Type, typeNode *ast.Node, expr string) string {
	// For ArrayTypeNode, the element type is the first child
	// Get element type from the ArrayTypeNode
	arrayTypeNode := typeNode.AsArrayTypeNode()
	if arrayTypeNode != nil && arrayTypeNode.ElementType != nil {
		// Get the element type from the type checker
		elemType := checker.Checker_getTypeFromTypeNode(g.checker, arrayTypeNode.ElementType)
		if elemType != nil {
			elemCheck := g.generateCheck(elemType, "elem")
			// Use 'any' type for elem to satisfy strict mode
			return fmt.Sprintf("Array.isArray(%s) && %s.every((elem: any) => %s)",
				expr, expr, elemCheck)
		}
	}

	// Fallback - just check if it's an array
	return fmt.Sprintf("Array.isArray(%s)", expr)
}
