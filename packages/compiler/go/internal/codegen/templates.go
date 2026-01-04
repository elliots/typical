package codegen

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/microsoft/typescript-go/shim/checker"
)

// PartKind represents the kind of a dynamic part in a template literal.
type PartKind int

const (
	PartKindStatic  PartKind = iota // Static text literal
	PartKindString                  // ${string} - any string
	PartKindNumber                  // ${number} - numeric pattern
	PartKindBoolean                 // ${boolean} - "true" or "false"
	PartKindBigInt                  // ${bigint} - integer with optional n suffix
	PartKindLiteral                 // ${"foo"} or ${42} - exact match
	PartKindUnion                   // ${"a" | "b"} - alternatives
	PartKindAny                     // unconstrained - any string
)

// TemplatePart represents one segment of a template literal pattern.
type TemplatePart struct {
	Kind PartKind
	Text string // For Static and Literal parts

	// For union types: each alternative as a pattern
	Alternatives []*TemplatePattern
}

// TemplatePattern is the intermediate representation for a template literal type.
type TemplatePattern struct {
	Parts []TemplatePart
}

// Regex patterns for validating different type parts
const (
	numberPattern  = `-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?`
	booleanPattern = `(?:true|false)`
	bigintPattern  = `-?(?:0|[1-9][0-9]*)n?`
)

// parseTemplateLiteral converts a TypeScript template literal type to TemplatePattern.
func (g *Generator) parseTemplateLiteral(t *checker.Type) *TemplatePattern {
	// Get the template literal type data
	tlt := t.AsTemplateLiteralType()
	if tlt == nil {
		return nil
	}

	texts := checker.TemplateLiteralType_Texts(tlt)
	types := checker.TemplateLiteralType_Types(tlt)

	pattern := &TemplatePattern{
		Parts: make([]TemplatePart, 0, len(texts)+len(types)),
	}

	// Interleave texts and types: text[0], type[0], text[1], type[1], ..., text[n]
	for i := 0; i < len(texts); i++ {
		// Add static text if non-empty
		if texts[i] != "" {
			pattern.Parts = append(pattern.Parts, TemplatePart{
				Kind: PartKindStatic,
				Text: texts[i],
			})
		}

		// Add type part if we have one
		if i < len(types) {
			part := g.typeToTemplatePart(types[i])
			pattern.Parts = append(pattern.Parts, part)
		}
	}

	return pattern
}

// typeToTemplatePart converts a TypeScript type to a TemplatePart.
func (g *Generator) typeToTemplatePart(t *checker.Type) TemplatePart {
	flags := checker.Type_flags(t)

	// String type
	if flags&checker.TypeFlagsString != 0 {
		return TemplatePart{Kind: PartKindString}
	}

	// Number type
	if flags&checker.TypeFlagsNumber != 0 {
		return TemplatePart{Kind: PartKindNumber}
	}

	// Boolean type
	if flags&checker.TypeFlagsBoolean != 0 {
		return TemplatePart{Kind: PartKindBoolean}
	}

	// BigInt type
	if flags&checker.TypeFlagsBigInt != 0 {
		return TemplatePart{Kind: PartKindBigInt}
	}

	// String literal type
	if flags&checker.TypeFlagsStringLiteral != 0 {
		lt := t.AsLiteralType()
		if lt != nil {
			if str, ok := lt.Value().(string); ok {
				return TemplatePart{Kind: PartKindLiteral, Text: str}
			}
		}
		return TemplatePart{Kind: PartKindString}
	}

	// Number literal type
	if flags&checker.TypeFlagsNumberLiteral != 0 {
		lt := t.AsLiteralType()
		if lt != nil {
			return TemplatePart{Kind: PartKindLiteral, Text: fmt.Sprintf("%v", lt.Value())}
		}
		return TemplatePart{Kind: PartKindNumber}
	}

	// Boolean literal type
	if flags&checker.TypeFlagsBooleanLiteral != 0 {
		lt := t.AsLiteralType()
		if lt != nil {
			if b, ok := lt.Value().(bool); ok {
				return TemplatePart{Kind: PartKindLiteral, Text: fmt.Sprintf("%t", b)}
			}
		}
		return TemplatePart{Kind: PartKindBoolean}
	}

	// Union type - convert each member
	if flags&checker.TypeFlagsUnion != 0 {
		members := t.Types()
		alternatives := make([]*TemplatePattern, 0, len(members))
		for _, member := range members {
			part := g.typeToTemplatePart(member)
			// Wrap each part in a TemplatePattern
			alternatives = append(alternatives, &TemplatePattern{
				Parts: []TemplatePart{part},
			})
		}
		return TemplatePart{
			Kind:         PartKindUnion,
			Alternatives: alternatives,
		}
	}

	// Nested template literal type
	if flags&checker.TypeFlagsTemplateLiteral != 0 {
		nested := g.parseTemplateLiteral(t)
		if nested != nil && len(nested.Parts) > 0 {
			// Return the nested pattern's parts as a union of one
			return TemplatePart{
				Kind:         PartKindUnion,
				Alternatives: []*TemplatePattern{nested},
			}
		}
	}

	// Fallback: any string
	return TemplatePart{Kind: PartKindAny}
}

// RenderAsCheck generates a JavaScript boolean expression for validation using regex.
func (tp *TemplatePattern) RenderAsCheck(expr string) string {
	pattern := tp.toRegexPattern()
	return fmt.Sprintf(`("string" === typeof %s && /^%s$/.test(%s))`, expr, pattern, expr)
}

// toRegexPattern converts the pattern to a regex string (without anchors).
func (tp *TemplatePattern) toRegexPattern() string {
	var sb strings.Builder

	for _, part := range tp.Parts {
		sb.WriteString(part.toRegexPart())
	}

	return sb.String()
}

// toRegexPart converts a single part to its regex representation.
func (part *TemplatePart) toRegexPart() string {
	switch part.Kind {
	case PartKindStatic:
		return escapeRegex(part.Text)
	case PartKindString:
		return `.*?` // Non-greedy to allow subsequent parts to match
	case PartKindNumber:
		return numberPattern
	case PartKindBoolean:
		return booleanPattern
	case PartKindBigInt:
		return bigintPattern
	case PartKindLiteral:
		return escapeRegex(part.Text)
	case PartKindUnion:
		// Build alternation: (alt1|alt2|alt3)
		alts := make([]string, 0, len(part.Alternatives))
		for _, alt := range part.Alternatives {
			alts = append(alts, alt.toRegexPattern())
		}
		return "(?:" + strings.Join(alts, "|") + ")"
	case PartKindAny:
		return `.*?`
	default:
		return `.*?`
	}
}

// escapeRegex escapes special regex characters in a string for JavaScript regex literals.
func escapeRegex(s string) string {
	// First escape regex special chars
	escaped := regexp.QuoteMeta(s)
	// Then escape forward slash for JavaScript regex literal syntax /pattern/
	return strings.ReplaceAll(escaped, "/", "\\/")
}

// getExpectedDescription returns a human-readable description of the template pattern.
func (tp *TemplatePattern) getExpectedDescription() string {
	var parts []string
	for _, part := range tp.Parts {
		switch part.Kind {
		case PartKindStatic:
			parts = append(parts, fmt.Sprintf("%q", part.Text))
		case PartKindString:
			parts = append(parts, "${string}")
		case PartKindNumber:
			parts = append(parts, "${number}")
		case PartKindBoolean:
			parts = append(parts, "${boolean}")
		case PartKindBigInt:
			parts = append(parts, "${bigint}")
		case PartKindLiteral:
			parts = append(parts, fmt.Sprintf("${%q}", part.Text))
		case PartKindUnion:
			parts = append(parts, "${...}")
		case PartKindAny:
			parts = append(parts, "${*}")
		}
	}
	return "`" + strings.Join(parts, "") + "`"
}
