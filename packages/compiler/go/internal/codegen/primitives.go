package codegen

import (
	"fmt"

	"github.com/microsoft/typescript-go/shim/checker"
)

// primitiveCheck generates a JavaScript expression for primitive type checks.
// Returns empty string if the type is not a primitive.
func (g *Generator) primitiveCheck(t *checker.Type, expr string) string {
	flags := checker.Type_flags(t)

	// String type
	if flags&checker.TypeFlagsString != 0 {
		return fmt.Sprintf(`"string" === typeof %s`, expr)
	}

	// Number type
	if flags&checker.TypeFlagsNumber != 0 {
		return fmt.Sprintf(`"number" === typeof %s`, expr)
	}

	// Boolean type
	if flags&checker.TypeFlagsBoolean != 0 {
		return fmt.Sprintf(`"boolean" === typeof %s`, expr)
	}

	// BigInt type
	if flags&checker.TypeFlagsBigInt != 0 {
		return fmt.Sprintf(`"bigint" === typeof %s`, expr)
	}

	// Null type
	if flags&checker.TypeFlagsNull != 0 {
		return fmt.Sprintf(`null === %s`, expr)
	}

	// Undefined type
	if flags&checker.TypeFlagsUndefined != 0 {
		return fmt.Sprintf(`undefined === %s`, expr)
	}

	// Void type (treated same as undefined in runtime)
	if flags&checker.TypeFlagsVoid != 0 {
		return fmt.Sprintf(`undefined === %s`, expr)
	}

	// String literal type
	if flags&checker.TypeFlagsStringLiteral != 0 {
		// Get the literal value
		lt := t.AsLiteralType()
		if lt != nil {
			if str, ok := lt.Value().(string); ok {
				return fmt.Sprintf(`%q === %s`, str, expr)
			}
		}
		// Fallback to string check
		return fmt.Sprintf(`"string" === typeof %s`, expr)
	}

	// Number literal type
	if flags&checker.TypeFlagsNumberLiteral != 0 {
		lt := t.AsLiteralType()
		if lt != nil {
			// Value could be jsnum.Number or float64
			return fmt.Sprintf(`%v === %s`, lt.Value(), expr)
		}
		return fmt.Sprintf(`"number" === typeof %s`, expr)
	}

	// Boolean literal type (true/false)
	if flags&checker.TypeFlagsBooleanLiteral != 0 {
		lt := t.AsLiteralType()
		if lt != nil {
			if b, ok := lt.Value().(bool); ok {
				return fmt.Sprintf(`%t === %s`, b, expr)
			}
		}
		// Fallback to boolean check
		return fmt.Sprintf(`"boolean" === typeof %s`, expr)
	}

	// Not a primitive type
	return ""
}
