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
				`"string" === typeof name`,      // Uses param name directly (inline)
				`"name" + " to be string`,       // Error message uses param name
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
				`"number" === typeof x`, // Uses param name directly (inline)
				`"x" + " to be number`,  // Error message uses param name
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
				`"string" === typeof x`,  // Parameter validation (inline)
				`"string" === typeof _v`, // Return validation (IIFE)
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
				`"string" === typeof msg`, // Parameter should be validated (inline)
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
				`"number" === typeof a`, // Inline validation for a
				`"number" === typeof b`, // Inline validation for b
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
				`typeof user !== "object"`,  // Uses param name directly
				`user === null`,             // Uses param name directly
				`user.name`,                 // Property access on param
				`"user" + ".name"`,          // Error message with param name
			},
		},
		{
			name: "array parameter",
			input: `function sum(nums: number[]): number {
	return nums.reduce((a, b) => a + b, 0);
}`,
			config: Config{ValidateParameters: true, ValidateReturns: false, ValidateCasts: false},
			expectedParts: []string{
				`Array.isArray(nums)`,           // Uses param name directly
				`nums.length`,                   // Loop over array using param name
				`"nums" + "[" + _i0 + "]"`,      // Array index in error message
			},
		},
		{
			name: "error message includes variable name",
			input: `function greet(name: string): void {
	console.log(name);
}`,
			config: Config{ValidateParameters: true, ValidateReturns: false, ValidateCasts: false},
			expectedParts: []string{
				`Expected " + "name" + " to be string`, // Inline uses literal param name
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
	if !config.TransformJSONParse {
		t.Error("Default config should have TransformJSONParse = true")
	}
	if !config.TransformJSONStringify {
		t.Error("Default config should have TransformJSONStringify = true")
	}
}

func TestJSONTransformations(t *testing.T) {
	tests := []struct {
		name            string
		input           string
		config          Config
		expectedParts   []string
		unexpectedParts []string
	}{
		{
			name: "JSON.parse with type argument",
			input: `interface User { name: string; age: number; }
const user = JSON.parse<User>(jsonStr);`,
			config: Config{TransformJSONParse: true},
			expectedParts: []string{
				`const _r: any = {}`,      // Creates filtered result object
				`_r.name = _v.name`,       // Copies name property
				`_r.age = _v.age`,         // Copies age property
				`return _r`,               // Returns filtered object
				`JSON.parse(`,             // Calls JSON.parse
				`"JSON.parse"`,            // Uses label for error messages
			},
			unexpectedParts: []string{
				`JSON.parse<User>`, // Type argument should be consumed
			},
		},
		{
			name: "JSON.stringify with type argument",
			input: `interface User { name: string; age: number; }
const str = JSON.stringify<User>(userObj);`,
			config: Config{TransformJSONStringify: true},
			expectedParts: []string{
				`_r.name = _v.name`,   // Filter copies properties
				`_r.age = _v.age`,     // Filter copies properties
				`JSON.stringify(_r)`,  // Calls JSON.stringify on filtered object
				`"JSON.stringify"`,    // Uses label for error messages
			},
			unexpectedParts: []string{
				`JSON.stringify<User>`, // Type argument should be consumed
			},
		},
		{
			name: "JSON.parse disabled",
			input: `interface User { name: string; }
const user = JSON.parse<User>(jsonStr);`,
			config: Config{TransformJSONParse: false},
			expectedParts: []string{
				`JSON.parse<User>`, // Original call preserved
			},
			unexpectedParts: []string{
				`const _r`, // No filtering
			},
		},
		{
			name: "JSON.stringify disabled",
			input: `interface User { name: string; }
const str = JSON.stringify<User>(userObj);`,
			config: Config{TransformJSONStringify: false},
			expectedParts: []string{
				`JSON.stringify<User>`, // Original call preserved
			},
		},
		{
			name: "JSON.parse with nested object",
			input: `interface Address { city: string; }
interface Person { name: string; address: Address; }
const person = JSON.parse<Person>(jsonStr);`,
			config: Config{TransformJSONParse: true},
			expectedParts: []string{
				`_r.name`,           // Top level property
				`_r.address`,        // Nested object property
				`.city`,             // Nested property
			},
		},
		{
			name: "JSON.parse with array type",
			input: `interface User { name: string; }
const users = JSON.parse<User[]>(jsonStr);`,
			config: Config{TransformJSONParse: true},
			expectedParts: []string{
				`Array.isArray`,     // Checks for array
				`const _r: any[] = []`, // Creates array result
				`.push(`,            // Pushes filtered elements
			},
		},
		{
			name: "JSON.parse without type argument - no transform",
			input: `const data = JSON.parse(jsonStr);`,
			config: Config{TransformJSONParse: true},
			expectedParts: []string{
				`JSON.parse(jsonStr)`, // Original call unchanged
			},
			unexpectedParts: []string{
				`const _r`, // No filtering
			},
		},
		{
			name: "JSON.parse with as T pattern",
			input: `interface User { name: string; age: number; }
const user = JSON.parse(jsonStr) as User;`,
			config: Config{TransformJSONParse: true},
			expectedParts: []string{
				`const _r: any = {}`,      // Creates filtered result object
				`_r.name = _v.name`,       // Copies name property
				`_r.age = _v.age`,         // Copies age property
				`return _r`,               // Returns filtered object
				`JSON.parse(`,             // Calls JSON.parse
				`"JSON.parse"`,            // Uses label for error messages
			},
			unexpectedParts: []string{
				`as User`, // "as T" should be consumed
			},
		},
		{
			name: "JSON.stringify with as T pattern",
			input: `interface User { name: string; age: number; }
const str = JSON.stringify(userObj) as User;`,
			config: Config{TransformJSONStringify: true},
			expectedParts: []string{
				`_r.name = _v.name`,   // Filter copies properties
				`_r.age = _v.age`,     // Filter copies properties
				`JSON.stringify(_r)`,  // Calls JSON.stringify on filtered object
				`"JSON.stringify"`,    // Uses label for error messages
			},
			unexpectedParts: []string{
				`as User`, // "as T" should be consumed
			},
		},
		{
			name: "JSON.parse as T with nested object",
			input: `interface Address { city: string; }
interface Person { name: string; address: Address; }
const person = JSON.parse(jsonStr) as Person;`,
			config: Config{TransformJSONParse: true},
			expectedParts: []string{
				`_r.name`,           // Top level property
				`_r.address`,        // Nested object property
				`.city`,             // Nested property
			},
			unexpectedParts: []string{
				`as Person`, // "as T" should be consumed
			},
		},
		{
			name: "JSON.stringify with argument as T pattern",
			input: `interface User { name: string; age: number; }
const str = JSON.stringify(userObj as User);`,
			config: Config{TransformJSONStringify: true},
			expectedParts: []string{
				`_r.name = _v.name`,   // Filter copies properties
				`_r.age = _v.age`,     // Filter copies properties
				`JSON.stringify(_r)`,  // Calls JSON.stringify on filtered object
			},
			unexpectedParts: []string{
				`as User`, // "as T" should be consumed
			},
		},
		{
			name: "const x: T = JSON.parse(string) pattern",
			input: `interface User { name: string; age: number; }
const user: User = JSON.parse(jsonStr);`,
			config: Config{TransformJSONParse: true},
			expectedParts: []string{
				`const _r: any = {}`,      // Creates filtered result object
				`_r.name = _v.name`,       // Copies name property
				`_r.age = _v.age`,         // Copies age property
				`JSON.parse(`,             // Calls JSON.parse
			},
		},
		{
			name: "return JSON.parse(string) with return type",
			input: `interface User { name: string; age: number; }
function loadUser(json: string): User {
	return JSON.parse(json);
}`,
			config: Config{TransformJSONParse: true},
			expectedParts: []string{
				`const _r: any = {}`,      // Creates filtered result object
				`_r.name = _v.name`,       // Copies name property
				`_r.age = _v.age`,         // Copies age property
				`JSON.parse(`,             // Calls JSON.parse
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
