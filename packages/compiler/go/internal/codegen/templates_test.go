package codegen

import (
	"strings"
	"testing"
)

// TestTemplateLiteralTypes tests template literal type validation.
func TestTemplateLiteralTypes(t *testing.T) {
	code := "// Simple prefix\n" +
		"function testPrefix(x: `hello-${string}`): void {}\n" +
		"\n" +
		"// Simple suffix\n" +
		"function testSuffix(x: `${string}-world`): void {}\n" +
		"\n" +
		"// Prefix and suffix\n" +
		"function testPrefixSuffix(x: `hello-${string}-world`): void {}\n" +
		"\n" +
		"// Number in template\n" +
		"function testNumber(x: `user_${number}`): void {}\n" +
		"\n" +
		"// Boolean in template\n" +
		"function testBoolean(x: `flag_${boolean}`): void {}\n" +
		"\n" +
		"// Multiple parts - should use regex\n" +
		"function testMultiple(x: `${number}-${string}`): void {}\n" +
		"\n" +
		"// String literal in template\n" +
		"function testLiteral(x: `status_${\"active\" | \"inactive\"}`): void {}\n" +
		"\n" +
		"// IP-like pattern\n" +
		"function testIP(x: `${number}.${number}.${number}.${number}`): void {}\n" +
		"\n" +
		"// Complex mixed pattern\n" +
		"function testComplex(x: `${number}-${string}.${number}/${string}`): void {}\n" +
		"\n" +
		"// Only dynamic part\n" +
		"function testOnlyDynamic(x: `${string}`): void {}\n" +
		"\n" +
		"// Nested type reference\n" +
		"type Status = \"active\" | \"inactive\";\n" +
		"function testTypeRef(x: `status_${Status}`): void {}\n"

	c, sourceFile, cleanup := setupTestProject(t, code)
	defer cleanup()

	gen := NewGenerator(c)

	tests := []struct {
		funcName        string
		expectedContain []string
		expectedNot     []string
		description     string
	}{
		{
			funcName:    "testPrefix",
			description: "Simple prefix with ${string}",
			expectedContain: []string{
				`"string" === typeof`,
				`/^hello-.*?$/.test`,
			},
		},
		{
			funcName:    "testSuffix",
			description: "Simple suffix with ${string}",
			expectedContain: []string{
				`"string" === typeof`,
				`/^.*?-world$/.test`,
			},
		},
		{
			funcName:    "testPrefixSuffix",
			description: "Prefix and suffix with ${string}",
			expectedContain: []string{
				`"string" === typeof`,
				`/^hello-.*?-world$/.test`,
			},
		},
		{
			funcName:    "testNumber",
			description: "Template with ${number}",
			expectedContain: []string{
				`"string" === typeof`,
				`/^`,
				`$/.test`,
			},
		},
		{
			funcName:    "testBoolean",
			description: "Template with ${boolean} - TypeScript expands to union",
			expectedContain: []string{
				// TypeScript expands `flag_${boolean}` to "flag_true" | "flag_false"
				`"flag_false"`,
				`"flag_true"`,
			},
		},
		{
			funcName:    "testMultiple",
			description: "Multiple dynamic parts",
			expectedContain: []string{
				`"string" === typeof`,
				`/^`,
				`$/.test`,
			},
		},
		{
			funcName:    "testLiteral",
			description: "String literal union in template - TypeScript expands to union",
			expectedContain: []string{
				// TypeScript expands `status_${"active" | "inactive"}` to union
				`"status_active"`,
				`"status_inactive"`,
			},
		},
		{
			funcName:    "testIP",
			description: "IP-like pattern with 4 numbers",
			expectedContain: []string{
				`"string" === typeof`,
				`/^`,
				`$/.test`,
			},
		},
		{
			funcName:    "testComplex",
			description: "Complex mixed pattern",
			expectedContain: []string{
				`"string" === typeof`,
				`/^`,
				`$/.test`,
			},
		},
		{
			funcName:    "testOnlyDynamic",
			description: "Only ${string} - simple case",
			expectedContain: []string{
				`"string" === typeof`,
			},
		},
		{
			funcName:    "testTypeRef",
			description: "Type reference in template - TypeScript expands to union",
			expectedContain: []string{
				// TypeScript expands `status_${Status}` where Status = "active" | "inactive"
				`"status_active"`,
				`"status_inactive"`,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.funcName, func(t *testing.T) {
			paramType := findFunctionParamType(c, sourceFile, tc.funcName)
			if paramType == nil {
				t.Fatalf("Could not find type for %s", tc.funcName)
			}

			validator := gen.GenerateValidator(paramType, "param")
			t.Logf("%s - Generated validator:\n%s", tc.description, validator)

			for _, expected := range tc.expectedContain {
				if !strings.Contains(validator, expected) {
					t.Errorf("Expected validator to contain %q", expected)
				}
			}

			for _, notExpected := range tc.expectedNot {
				if strings.Contains(validator, notExpected) {
					t.Errorf("Expected validator NOT to contain %q", notExpected)
				}
			}
		})
	}
}

// TestTemplateLiteralIsCheck tests the is-check generation for template literals.
func TestTemplateLiteralIsCheck(t *testing.T) {
	code := "function testSimple(x: `hello-${string}`): void {}\n" +
		"function testComplex(x: `${number}-${string}`): void {}\n"

	c, sourceFile, cleanup := setupTestProject(t, code)
	defer cleanup()

	gen := NewGenerator(c)

	t.Run("simple is-check", func(t *testing.T) {
		paramType := findFunctionParamType(c, sourceFile, "testSimple")
		if paramType == nil {
			t.Fatal("Could not find type")
		}

		check := gen.GenerateIsCheck(paramType)
		t.Logf("Is-check: %s", check)

		if !strings.Contains(check, `/^hello-.*?$/.test`) {
			t.Error("Expected regex check")
		}
	})

	t.Run("complex is-check uses regex", func(t *testing.T) {
		paramType := findFunctionParamType(c, sourceFile, "testComplex")
		if paramType == nil {
			t.Fatal("Could not find type")
		}

		check := gen.GenerateIsCheck(paramType)
		t.Logf("Is-check: %s", check)

		if !strings.Contains(check, `/^`) || !strings.Contains(check, `$/.test`) {
			t.Error("Expected regex check for complex case")
		}
	})
}

// TestTemplatePatternParsing tests the intermediate representation parsing.
func TestTemplatePatternParsing(t *testing.T) {
	// Test the TemplatePattern rendering directly - all patterns use regex now
	tests := []struct {
		name     string
		pattern  *TemplatePattern
		expected string
	}{
		{
			name: "prefix only",
			pattern: &TemplatePattern{
				Parts: []TemplatePart{
					{Kind: PartKindStatic, Text: "hello-"},
					{Kind: PartKindString},
				},
			},
			expected: `/^hello-.*?$/.test`,
		},
		{
			name: "suffix only",
			pattern: &TemplatePattern{
				Parts: []TemplatePart{
					{Kind: PartKindString},
					{Kind: PartKindStatic, Text: "-world"},
				},
			},
			expected: `/^.*?-world$/.test`,
		},
		{
			name: "number pattern uses regex",
			pattern: &TemplatePattern{
				Parts: []TemplatePart{
					{Kind: PartKindStatic, Text: "count_"},
					{Kind: PartKindNumber},
				},
			},
			expected: `/^count_`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			check := tc.pattern.RenderAsCheck("input")
			t.Logf("Rendered check: %s", check)

			if !strings.Contains(check, tc.expected) {
				t.Errorf("Expected check to contain %q, got %q", tc.expected, check)
			}
		})
	}
}

// TestRegexPatternGeneration tests that regex patterns are correctly generated.
func TestRegexPatternGeneration(t *testing.T) {
	tests := []struct {
		name    string
		pattern *TemplatePattern
		want    string
	}{
		{
			name: "simple number",
			pattern: &TemplatePattern{
				Parts: []TemplatePart{
					{Kind: PartKindStatic, Text: "id_"},
					{Kind: PartKindNumber},
				},
			},
			// Note: backslashes are escaped in the pattern string
			want: `id_-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?`,
		},
		{
			name: "boolean",
			pattern: &TemplatePattern{
				Parts: []TemplatePart{
					{Kind: PartKindStatic, Text: "flag_"},
					{Kind: PartKindBoolean},
				},
			},
			want: `flag_(?:true|false)`,
		},
		{
			name: "literal string",
			pattern: &TemplatePattern{
				Parts: []TemplatePart{
					{Kind: PartKindStatic, Text: "status_"},
					{Kind: PartKindLiteral, Text: "active"},
				},
			},
			want: `status_active`,
		},
		{
			name: "escapes special chars",
			pattern: &TemplatePattern{
				Parts: []TemplatePart{
					{Kind: PartKindStatic, Text: "path/to/"},
					{Kind: PartKindString},
					{Kind: PartKindStatic, Text: ".txt"},
				},
			},
			want: `path/to/.*?\.txt`,
		},
		{
			name: "union alternatives",
			pattern: &TemplatePattern{
				Parts: []TemplatePart{
					{Kind: PartKindStatic, Text: "type_"},
					{
						Kind: PartKindUnion,
						Alternatives: []*TemplatePattern{
							{Parts: []TemplatePart{{Kind: PartKindLiteral, Text: "a"}}},
							{Parts: []TemplatePart{{Kind: PartKindLiteral, Text: "b"}}},
						},
					},
				},
			},
			want: `type_(?:a|b)`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.pattern.toRegexPattern()
			if got != tc.want {
				t.Errorf("toRegexPattern() = %q, want %q", got, tc.want)
			}
		})
	}
}

