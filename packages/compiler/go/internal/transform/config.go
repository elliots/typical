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
}

// DefaultConfig returns the default configuration with all validations enabled.
func DefaultConfig() Config {
	return Config{
		ValidateParameters: true,
		ValidateReturns:    true,
		ValidateCasts:      true,
	}
}
