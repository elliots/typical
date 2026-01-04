package transform

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
}

// DefaultConfig returns the default configuration with all validations enabled.
func DefaultConfig() Config {
	return Config{
		ValidateParameters:     true,
		ValidateReturns:        true,
		ValidateCasts:          true,
		TransformJSONParse:     true,
		TransformJSONStringify: true,
	}
}
