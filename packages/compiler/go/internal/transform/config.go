package transform

import "regexp"

// ReusableValidatorsMode controls how validators are hoisted to module scope.
type ReusableValidatorsMode string

const (
	// ReusableValidatorsAuto hoists validators only when used more than once (default).
	ReusableValidatorsAuto ReusableValidatorsMode = "auto"
	// ReusableValidatorsNever never hoists, always generates inline validators.
	ReusableValidatorsNever ReusableValidatorsMode = "never"
	// ReusableValidatorsAlways always hoists validators, even if only used once.
	ReusableValidatorsAlways ReusableValidatorsMode = "always"
)

// Config specifies which validations to apply during transformation.
type Config struct {
	// ValidateParameters wraps function parameters with validators.
	ValidateParameters bool

	// ValidateReturns wraps return values with validators.
	// For async functions, the Promise's resolved type is validated.
	// For sync functions returning Promise<T>, validation is added via .then()
	ValidateReturns bool

	// ValidateCasts wraps type assertions with validators.
	ValidateCasts bool

	// TransformJSONParse transforms JSON.parse<T>() calls to validate and filter
	// the parsed result to only include properties defined in type T.
	TransformJSONParse bool

	// TransformJSONStringify transforms JSON.stringify<T>() calls to only stringify
	// properties defined in type T, preventing accidental data leaks.
	TransformJSONStringify bool

	// MaxGeneratedFunctions is the maximum number of helper functions (_io0, _io1, etc.)
	// that can be generated for a single type before erroring. Complex DOM types or
	// library types can generate hundreds of functions which indicates a type that
	// should be skipped. Set to 0 to disable the limit.
	// Default: 50
	MaxGeneratedFunctions int

	// IgnoreTypes is a list of compiled regex patterns for types to skip validation.
	// Types matching any pattern will not have validators generated.
	IgnoreTypes []*regexp.Regexp

	// PureFunctions is a list of function names (or patterns) that are considered "pure"
	// or "readonly" for their arguments. Passing a validated object to these functions
	// will NOT mark it as dirty (re-validation needed).
	// Examples: "console.log", "JSON.stringify"
	PureFunctions []*regexp.Regexp

	// TrustedFunctions is a list of function names (or patterns) whose return values
	// are trusted to be valid according to their type annotation.
	// Example: "db.loadUser" -> const user: User = db.loadUser(id) -> user is valid
	TrustedFunctions []*regexp.Regexp

	// ReusableValidators controls whether validator functions are hoisted to module scope.
	// - "auto": Hoist validators only when the same type is validated more than once (default)
	// - "never": Never hoist, always generate inline validators
	// - "always": Always hoist validators, even if only used once
	// The throw still occurs at the call site for proper source map support.
	ReusableValidators ReusableValidatorsMode
}

// DefaultMaxGeneratedFunctions is the default limit for generated helper functions.
const DefaultMaxGeneratedFunctions = 50

// DefaultConfig returns the default configuration with all validations enabled.
func DefaultConfig() Config {
	return Config{
		ValidateParameters:     true,
		ValidateReturns:        true,
		ValidateCasts:          true,
		TransformJSONParse:     true,
		TransformJSONStringify: true,
		MaxGeneratedFunctions:  DefaultMaxGeneratedFunctions,
		PureFunctions:          CompileIgnorePatterns([]string{"console.*", "JSON.stringify"}),
		ReusableValidators:     ReusableValidatorsAuto,
	}
}

// CompileIgnorePattern converts a glob-style pattern to a regexp.
// Supports wildcards: "React.*" -> /^React\..*$/
func CompileIgnorePattern(pattern string) (*regexp.Regexp, error) {
	// Escape special regex chars except *
	var escaped string
	for _, c := range pattern {
		switch c {
		case '.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\':
			escaped += "\\" + string(c)
		case '*':
			escaped += ".*"
		default:
			escaped += string(c)
		}
	}
	return regexp.Compile("^" + escaped + "$")
}

// CompileIgnorePatterns compiles a list of glob patterns to regexps.
// Invalid patterns are skipped (silently for now).
func CompileIgnorePatterns(patterns []string) []*regexp.Regexp {
	var result []*regexp.Regexp
	for _, p := range patterns {
		re, err := CompileIgnorePattern(p)
		if err != nil {
			// Skip invalid patterns
			continue
		}
		result = append(result, re)
	}
	return result
}

// ShouldIgnoreType checks if a type name matches any ignore pattern.
func (c *Config) ShouldIgnoreType(typeName string) bool {
	for _, re := range c.IgnoreTypes {
		if re.MatchString(typeName) {
			return true
		}
	}
	return false
}
