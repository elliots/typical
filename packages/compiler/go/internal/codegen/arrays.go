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
	errorMsg = concatStrings(errorMsg, fmt.Sprintf(`" to be tuple, got " + %s`, g.gotType(expr)))
	sb.WriteString(fmt.Sprintf(`if (!Array.isArray(%s)) %s; `, expr, g.throwOrReturn(errorMsg)))

	// Get tuple element types
	typeArgs := checker.Checker_getTypeArguments(g.checker, t)

	// Get tuple type info for length checking and per-element flags
	tupleType := checker.Type_TargetTupleType(t)
	var elementInfos []checker.TupleElementInfo
	if tupleType != nil {
		elementInfos = checker.TupleType_elementInfos(tupleType)
		combinedFlags := checker.TupleType_combinedFlags(tupleType)

		if combinedFlags&checker.ElementFlagsRest != 0 {
			// Has rest element - check minimum length
			// Count non-rest elements to determine minimum length
			minLen := 0
			for _, info := range elementInfos {
				if info.TupleElementFlags()&checker.ElementFlagsRest == 0 {
					minLen++
				}
			}
			if minLen > 0 {
				lenErrorMsg := concatStrings(`"Expected "`, errorNameExpr)
				lenErrorMsg = concatStrings(lenErrorMsg, fmt.Sprintf(`" to have at least %d elements, got " + %s.length`, minLen, expr))
				sb.WriteString(fmt.Sprintf(`if (%s.length < %d) %s; `, expr, minLen, g.throwOrReturn(lenErrorMsg)))
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

	// Check if we have variadic tuple (with rest element)
	hasRest := false
	restIndex := -1
	if elementInfos != nil {
		for i, info := range elementInfos {
			if info.TupleElementFlags()&checker.ElementFlagsRest != 0 {
				hasRest = true
				restIndex = i
				break
			}
		}
	}

	if hasRest && restIndex >= 0 {
		// Variadic tuple: [leading..., ...rest[], ...trailing]
		// Count trailing fixed elements (elements after the rest)
		trailingCount := len(typeArgs) - restIndex - 1

		// Validate leading fixed elements (before rest)
		for i := 0; i < restIndex; i++ {
			elemExpr := fmt.Sprintf("%s[%d]", expr, i)
			elemNameExpr := g.appendToName(nameExpr, fmt.Sprintf("[%d]", i))
			elemValidation := g.generateValidation(typeArgs[i], elemExpr, elemNameExpr)
			if elemValidation != "" {
				sb.WriteString(elemValidation)
			}
		}

		// Validate rest elements with a loop
		restType := typeArgs[restIndex]
		idx := g.funcIdx
		g.funcIdx++
		iVar := fmt.Sprintf("_i%d", idx)
		eVar := fmt.Sprintf("_e%d", idx)
		// Loop from restIndex to length - trailingCount
		loopEnd := fmt.Sprintf("%s.length - %d", expr, trailingCount)
		if trailingCount == 0 {
			loopEnd = fmt.Sprintf("%s.length", expr)
		}
		elemNameExpr := g.appendArrayIndex(nameExpr, iVar)
		elemValidation := g.generateValidation(restType, eVar, elemNameExpr)
		if elemValidation != "" {
			sb.WriteString(fmt.Sprintf(`for (let %s = %d; %s < %s; %s++) { const %s: any = %s[%s]; %s} `,
				iVar, restIndex, iVar, loopEnd, iVar, eVar, expr, iVar, elemValidation))
		}

		// Validate trailing fixed elements (relative to end)
		for i := 0; i < trailingCount; i++ {
			typeIdx := restIndex + 1 + i
			// Access from end: arr[arr.length - trailingCount + i]
			elemExpr := fmt.Sprintf("%s[%s.length - %d]", expr, expr, trailingCount-i)
			elemNameExpr := g.appendToName(nameExpr, fmt.Sprintf("[%s.length - %d]", expr, trailingCount-i))
			elemValidation := g.generateValidation(typeArgs[typeIdx], elemExpr, elemNameExpr)
			if elemValidation != "" {
				sb.WriteString(elemValidation)
			}
		}
	} else {
		// Simple tuple without rest - validate each element at fixed index
		for i, elemType := range typeArgs {
			elemExpr := fmt.Sprintf("%s[%d]", expr, i)
			elemNameExpr := g.appendToName(nameExpr, fmt.Sprintf("[%d]", i))
			elemValidation := g.generateValidation(elemType, elemExpr, elemNameExpr)
			if elemValidation != "" {
				sb.WriteString(elemValidation)
			}
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
