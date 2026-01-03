package codegen

import (
	"strings"

	"github.com/microsoft/typescript-go/shim/checker"
)

// unionCheck generates a JavaScript expression for union type checks.
func (g *Generator) unionCheck(t *checker.Type, expr string) string {
	// Get union member types
	members := t.Types()

	if len(members) == 0 {
		return "true"
	}

	// Special case: single member union
	if len(members) == 1 {
		return g.generateCheck(members[0], expr)
	}

	// Generate check for each member
	var checks []string
	for _, member := range members {
		check := g.generateCheck(member, expr)
		checks = append(checks, check)
	}

	// Join with OR
	return "(" + strings.Join(checks, " || ") + ")"
}

// intersectionCheck generates a JavaScript expression for intersection type checks.
func (g *Generator) intersectionCheck(t *checker.Type, expr string) string {
	// Get intersection member types
	members := t.Types()

	if len(members) == 0 {
		return "true"
	}

	// Special case: single member intersection
	if len(members) == 1 {
		return g.generateCheck(members[0], expr)
	}

	// Generate check for each member - all must pass
	var checks []string
	for _, member := range members {
		check := g.generateCheck(member, expr)
		checks = append(checks, check)
	}

	// Join with AND
	return "(" + strings.Join(checks, " && ") + ")"
}
