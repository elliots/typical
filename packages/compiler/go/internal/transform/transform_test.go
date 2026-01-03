package transform

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/typescript-go/shim/bundled"
	"github.com/microsoft/typescript-go/shim/project"
	"github.com/microsoft/typescript-go/shim/vfs/osvfs"
)

func TestTransformFile(t *testing.T) {
	tests := []struct {
		name            string
		input           string
		config          Config
		expectedParts   []string // Parts that should appear in output
		unexpectedParts []string // Parts that should NOT appear in output
	}{
		{
			name: "parameter validation - string",
			input: `function greet(name: string): void {
	console.log(name);
}`,
			config: Config{ValidateParameters: true, ValidateReturns: false, ValidateCasts: false},
			expectedParts: []string{
				`"string" === typeof _v`,
				`(name, "name")`,
				`throw new TypeError`,
			},
		},
		{
			name: "parameter validation - number",
			input: `function double(x: number): number {
	return x * 2;
}`,
			config: Config{ValidateParameters: true, ValidateReturns: false, ValidateCasts: false},
			expectedParts: []string{
				`"number" === typeof _v`,
				`(x, "x")`,
			},
		},
		{
			name: "return validation - string",
			input: `function getName(): string {
	return "hello";
}`,
			config: Config{ValidateParameters: false, ValidateReturns: true, ValidateCasts: false},
			expectedParts: []string{
				`"string" === typeof _v`,
				`"return value"`,
			},
		},
		{
			name: "return validation - number",
			input: `function getAge(): number {
	return 42;
}`,
			config: Config{ValidateParameters: false, ValidateReturns: true, ValidateCasts: false},
			expectedParts: []string{
				`"number" === typeof _v`,
				`"return value"`,
			},
		},
		{
			name: "both parameter and return validation",
			input: `function identity(x: string): string {
	return x;
}`,
			config: Config{ValidateParameters: true, ValidateReturns: true, ValidateCasts: false},
			expectedParts: []string{
				`"string" === typeof _v`,
				`(x, "x")`,
				`"return value"`,
			},
		},
		{
			name: "no validation when disabled",
			input: `function greet(name: string): string {
	return name;
}`,
			config:          Config{ValidateParameters: false, ValidateReturns: false, ValidateCasts: false},
			unexpectedParts: []string{`((_v, _n) =>`},
		},
		{
			name: "async function return validation",
			input: `async function fetchData(): Promise<string> {
	return "data";
}`,
			config: Config{ValidateParameters: false, ValidateReturns: true, ValidateCasts: false},
			expectedParts: []string{
				`"string" === typeof _v`, // Should unwrap Promise<string> to string
				`"return value"`,
			},
		},
		{
			name: "sync function returning Promise",
			input: `function fetchLater(): Promise<number> {
	return Promise.resolve(42);
}`,
			config: Config{ValidateParameters: false, ValidateReturns: true, ValidateCasts: false},
			expectedParts: []string{
				`.then(_v =>`, // Should add .then() for sync Promise return
				`"return value"`,
			},
		},
		{
			name: "skip void return type",
			input: `function log(msg: string): void {
	console.log(msg);
}`,
			config: Config{ValidateParameters: true, ValidateReturns: true, ValidateCasts: false},
			expectedParts: []string{
				`(msg, "msg")`, // Parameter should be validated
			},
		},
		{
			name: "skip any type",
			input: `function process(x: any): any {
	return x;
}`,
			config:          Config{ValidateParameters: true, ValidateReturns: true, ValidateCasts: false},
			unexpectedParts: []string{`((_v, _n) =>`}, // No validators should be generated for any
		},
		{
			name: "multiple parameters",
			input: `function add(a: number, b: number): number {
	return a + b;
}`,
			config: Config{ValidateParameters: true, ValidateReturns: false, ValidateCasts: false},
			expectedParts: []string{
				`(a, "a")`,
				`(b, "b")`,
			},
		},
		{
			name: "object parameter",
			input: `interface User { name: string; age: number; }
function greet(user: User): void {
	console.log(user.name);
}`,
			config: Config{ValidateParameters: true, ValidateReturns: false, ValidateCasts: false},
			expectedParts: []string{
				`typeof _v !== "object"`,
				`_v === null`,
				`(user, "user")`,
				`_n + ".name"`, // Property path in error message
			},
		},
		{
			name: "array parameter",
			input: `function sum(nums: number[]): number {
	return nums.reduce((a, b) => a + b, 0);
}`,
			config: Config{ValidateParameters: true, ValidateReturns: false, ValidateCasts: false},
			expectedParts: []string{
				`Array.isArray(_v)`,
				`(nums, "nums")`,
				`_n + "[" + _i + "]"`, // Array index in error message
			},
		},
		{
			name: "error message includes variable name",
			input: `function greet(name: string): void {
	console.log(name);
}`,
			config: Config{ValidateParameters: true, ValidateReturns: false, ValidateCasts: false},
			expectedParts: []string{
				`Expected " + _n + " to be string`,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := transformTestCode(t, tt.input, tt.config)

			// Check expected parts
			for _, part := range tt.expectedParts {
				if !strings.Contains(result, part) {
					t.Errorf("Expected output to contain %q\nGot:\n%s", part, result)
				}
			}

			// Check unexpected parts
			for _, part := range tt.unexpectedParts {
				if strings.Contains(result, part) {
					t.Errorf("Expected output NOT to contain %q\nGot:\n%s", part, result)
				}
			}
		})
	}
}

func TestDefaultConfig(t *testing.T) {
	config := DefaultConfig()

	if !config.ValidateParameters {
		t.Error("Default config should have ValidateParameters = true")
	}
	if !config.ValidateReturns {
		t.Error("Default config should have ValidateReturns = true")
	}
	if !config.ValidateCasts {
		t.Error("Default config should have ValidateCasts = true")
	}
}

// transformTestCode is a helper that sets up a TypeScript project and transforms the code
func transformTestCode(t *testing.T, input string, config Config) string {
	t.Helper()

	// Create a temporary directory for test files
	tmpDir, err := os.MkdirTemp("", "transform-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Write the test file
	testFile := filepath.Join(tmpDir, "test.ts")
	if err := os.WriteFile(testFile, []byte(input), 0644); err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	// Write tsconfig.json
	tsconfig := `{
		"compilerOptions": {
			"target": "ES2020",
			"module": "ESNext",
			"strict": true
		},
		"include": ["test.ts"]
	}`
	tsconfigFile := filepath.Join(tmpDir, "tsconfig.json")
	if err := os.WriteFile(tsconfigFile, []byte(tsconfig), 0644); err != nil {
		t.Fatalf("Failed to write tsconfig: %v", err)
	}

	// Setup project with bundled lib files for Promise support
	fs := bundled.WrapFS(osvfs.FS())
	session := project.NewSession(&project.SessionInit{
		FS: fs,
		Options: &project.SessionOptions{
			CurrentDirectory:   tmpDir,
			DefaultLibraryPath: bundled.LibPath(),
		},
	})

	ctx := context.Background()
	proj, err := session.OpenProject(ctx, tsconfigFile)
	if err != nil {
		t.Fatalf("Failed to open project: %v", err)
	}

	program := proj.GetProgram()
	sourceFile := program.GetSourceFile(testFile)
	if sourceFile == nil {
		t.Fatal("Could not find test.ts source file")
	}

	// Get type checker
	c, release := program.GetTypeChecker(ctx)
	defer release()

	// Transform the file
	return TransformFileWithConfig(sourceFile, c, config)
}
