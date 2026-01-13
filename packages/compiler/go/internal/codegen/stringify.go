package codegen

import (
	"strings"

	"github.com/microsoft/typescript-go/shim/checker"
)

// GenerateStringifier generates a function that validates and filters to typed properties, then calls JSON.stringify.
// Validation and filtering happen together (required for union types where we need to validate to know which branch to filter).
func (g *Generator) GenerateStringifier(t *checker.Type, typeName string) string {
	g.reset()

	// Generate validate + filter statements together (same logic as _filter_ functions, but throws instead of returning errors)
	statements := g.generateFilteringValidation(t, "_v", "_n", "_r")

	var sb strings.Builder
	sb.WriteString("((_v: any, _n: string) => { ")

	// Add helper functions
	for _, fn := range g.ioFuncs {
		sb.WriteString(fn)
		sb.WriteString("; ")
	}

	// Validate + filter
	sb.WriteString(statements)

	sb.WriteString("return JSON.stringify(_r); })")

	return sb.String()
}
