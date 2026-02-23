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
				`"string" === typeof name`,        // Uses param name directly (inline)
				`Expected name to be string, got`, // Error message built inline (without escaped quotes)
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
				`"number" === typeof x`,         // Uses param name directly (inline)
				`Expected x to be number, got`,  // Error message built inline
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
			name: "both parameter and return validation - skip redundant",
			input: `function identity(x: string): string {
	return x;
}`,
			config: Config{ValidateParameters: true, ValidateReturns: true, ValidateCasts: false},
			expectedParts: []string{
				`"string" === typeof x`, // Parameter validation (inline)
				`/* already valid */`,   // Return validation skipped - x already validated as string
			},
			unexpectedParts: []string{
				`"return value"`, // Should NOT have return validation
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
				`typeof user === "object"`,           // Uses param name directly
				`user !== null`,                      // Uses param name directly
				`user.name`,                          // Property access on param
				`Expected user.name to be string, got`, // Error message built inline with property path
			},
		},
		{
			name: "array parameter",
			input: `function sum(nums: number[]): number {
	return nums.reduce((a, b) => a + b, 0);
}`,
			config: Config{ValidateParameters: true, ValidateReturns: false, ValidateCasts: false},
			expectedParts: []string{
				`Array.isArray(nums)`,                  // Uses param name directly
				`nums.length`,                          // Loop over array using param name
				`Expected nums[" + _i0 + "] to be number`, // Error message with array index expression
			},
		},
		{
			name: "error message includes variable name",
			input: `function greet(name: string): void {
	console.log(name);
}`,
			config: Config{ValidateParameters: true, ValidateReturns: false, ValidateCasts: false},
			expectedParts: []string{
				`Expected name to be string, got`, // Error message built inline with variable name
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

func TestSkipRedundantValidation(t *testing.T) {
	config := Config{
		ValidateParameters: true,
		ValidateReturns:    true,
		ValidateCasts:      true,
		TransformJSONParse: true,
	}

	tests := []struct {
		name            string
		input           string
		expectedParts   []string
		unexpectedParts []string
	}{
		{
			name: "skip identity return - same type",
			input: `function identity(x: string): string {
	return x;
}`,
			expectedParts: []string{
				`"string" === typeof x`, // Parameter validation
				`/* already valid */`,   // Skip return validation
			},
			unexpectedParts: []string{
				`"return value"`, // No return validation
			},
		},
		{
			name: "skip return - subtype to supertype (string to nullable)",
			input: `function toNullable(x: string): string | null {
	return x;
}`,
			expectedParts: []string{
				`"string" === typeof x`, // Parameter validation
				`/* already valid */`,   // Skip - string is assignable to string | null
			},
			unexpectedParts: []string{
				`"return value"`,
			},
		},
		{
			name: "must validate - supertype to subtype",
			input: `function toSubtype(x: string | null): string {
	return x;
}`,
			expectedParts: []string{
				`"return value"`, // Must validate - string | null is NOT assignable to string
			},
			unexpectedParts: []string{
				`/* already valid */`,
			},
		},
		{
			name: "skip return - property of validated object",
			input: `interface User { name: string; age: number; }
function getName(user: User): string {
	return user.name;
}`,
			expectedParts: []string{
				`/* already valid */`, // Skip - user.name is string from validated User
			},
			unexpectedParts: []string{
				`"return value"`,
			},
		},
		{
			name: "skip return - property assigned to variable",
			input: `interface Company { address: Address; }
interface Address { street: string; }
function getAddress(company: Company): Address {
	const addr = company.address;
	return addr;
}`,
			expectedParts: []string{
				`/* already valid */`, // Skip - addr inherits validation from company.address
			},
			unexpectedParts: []string{
				`"return value"`,
			},
		},
		{
			name: "must validate - variable reassigned",
			input: `function reassigned(x: string): string {
	x = "new";
	return x;
}`,
			expectedParts: []string{
				`"string" === typeof x`, // Parameter validation
				`"return value"`,        // Must validate - x was reassigned
			},
			unexpectedParts: []string{
				`/* already valid */`,
			},
		},
		{
			name: "skip return - primitive passed to function (copied)",
			input: `function passedToFn(x: string): string {
	console.log(x);
	return x;
}`,
			expectedParts: []string{
				`"string" === typeof x`, // Parameter validation
				`/* already valid */`,   // Skip - primitives are copied when passed
			},
			unexpectedParts: []string{
				`"return value"`,
			},
		},
		{
			name: "must validate - object passed to function (could mutate)",
			input: `interface User { name: string; }
function logUser(u: User): void {}
function objPassed(user: User): User {
	logUser(user);
	return user;
}`,
			expectedParts: []string{
				`"return value"`, // Must validate - object could have been mutated
			},
			unexpectedParts: []string{
				`/* already valid */`,
			},
		},
		{
			name: "skip return - object property is primitive passed to function",
			input: `interface User { name: string; }
function objPropPrimitive(user: User): User {
	console.log(user.name);
	return user;
}`,
			expectedParts: []string{
				`/* already valid */`, // Skip - user.name is primitive, doesn't dirty user
			},
			unexpectedParts: []string{
				`"return value"`,
			},
		},
		{
			name: "skip return - aliased validated variable",
			input: `function aliased(x: string): string {
	const y = x;
	return y;
}`,
			expectedParts: []string{
				`"string" === typeof x`, // Parameter validation
				`/* already valid */`,   // Return validation skipped
			},
			unexpectedParts: []string{
				`"return value"`,
			},
		},
		{
			name: "skip return - variable from JSON.parse",
			input: `interface User { name: string; }
function parseUser(str: string): User {
	const user: User = JSON.parse(str);
	return user;
}`,
			expectedParts: []string{
				`const _r: any = {}`,  // Filtering happened
				`JSON.parse(`,         // Parse happened
				`/* already valid */`, // Return validation skipped!
			},
			unexpectedParts: []string{
				`"return value"`, // Should NOT validate return
			},
		},
		{
			name: "skip return - variable validated via cast",
			input: `interface User { name: string; }
function getUser(data: unknown): User {
	const user = data as User;
	return user;
}`,
			expectedParts: []string{
				`_check_User`,         // Cast uses check function
				`/* already valid */`, // Return validation skipped
			},
			unexpectedParts: []string{
				`"return value"`, // Should NOT validate return
			},
		},
		{
			name: "ignore comment - function",
			input: `// @typical-ignore
function ignored(x: string): string {
	return x;
}`,
			unexpectedParts: []string{
				`"string" === typeof x`,
				`"return value"`,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := transformTestCode(t, tt.input, config)

			for _, part := range tt.expectedParts {
				if !strings.Contains(result, part) {
					t.Errorf("Expected output to contain %q\nGot:\n%s", part, result)
				}
			}

			for _, part := range tt.unexpectedParts {
				if strings.Contains(result, part) {
					t.Errorf("Expected output NOT to contain %q\nGot:\n%s", part, result)
				}
			}
		})
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
				`const _r: any = {}`, // Creates filtered result object
				`_r.name = _v.name`,  // Copies name property
				`_r.age = _v.age`,    // Copies age property
				`return _r`,          // Returns filtered object
				`JSON.parse(`,        // Calls JSON.parse
				`"JSON.parse"`,       // Uses label for error messages
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
				`_r.name = _v.name`,  // Filter copies properties
				`_r.age = _v.age`,    // Filter copies properties
				`JSON.stringify(_r)`, // Calls JSON.stringify on filtered object
				`"JSON.stringify"`,   // Uses label for error messages
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
				`_r.name`,    // Top level property
				`_r.address`, // Nested object property
				`.city`,      // Nested property
			},
		},
		{
			name: "JSON.parse with array type",
			input: `interface User { name: string; }
const users = JSON.parse<User[]>(jsonStr);`,
			config: Config{TransformJSONParse: true},
			expectedParts: []string{
				`Array.isArray`,        // Checks for array
				`const _r: any[] = []`, // Creates array result
				`.push(`,               // Pushes filtered elements
			},
		},
		{
			name:   "JSON.parse without type argument - no transform",
			input:  `const data = JSON.parse(jsonStr);`,
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
				`const _r: any = {}`, // Creates filtered result object
				`_r.name = _v.name`,  // Copies name property
				`_r.age = _v.age`,    // Copies age property
				`return _r`,          // Returns filtered object
				`JSON.parse(`,        // Calls JSON.parse
				`"JSON.parse"`,       // Uses label for error messages
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
				`_r.name = _v.name`,  // Filter copies properties
				`_r.age = _v.age`,    // Filter copies properties
				`JSON.stringify(_r)`, // Calls JSON.stringify on filtered object
				`"JSON.stringify"`,   // Uses label for error messages
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
				`_r.name`,    // Top level property
				`_r.address`, // Nested object property
				`.city`,      // Nested property
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
				`_r.name = _v.name`,  // Filter copies properties
				`_r.age = _v.age`,    // Filter copies properties
				`JSON.stringify(_r)`, // Calls JSON.stringify on filtered object
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
				`const _r: any = {}`, // Creates filtered result object
				`_r.name = _v.name`,  // Copies name property
				`_r.age = _v.age`,    // Copies age property
				`JSON.parse(`,        // Calls JSON.parse
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
				`const _r: any = {}`, // Creates filtered result object
				`_r.name = _v.name`,  // Copies name property
				`_r.age = _v.age`,    // Copies age property
				`JSON.parse(`,        // Calls JSON.parse
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

func TestTrustedFunctions(t *testing.T) {
	config := Config{
		ValidateParameters: true,
		ValidateReturns:    true,
		TrustedFunctions:   CompileIgnorePatterns([]string{"db.load"}),
	}

	tests := []struct {
		name            string
		input           string
		expectedParts   []string
		unexpectedParts []string
	}{
		{
			name: "skip return - trusted function",
			input: `interface User { name: string; }
declare const db: { load(id: string): User };
function loadUser(id: string): User {
	const user = db.load(id);
	return user;
}`,
			expectedParts: []string{
				`/* already valid */`,
			},
			unexpectedParts: []string{
				`"return value"`,
			},
		},
		{
			name: "validate return - untrusted function",
			input: `interface User { name: string; }
declare const api: { fetch(id: string): any };
function fetchUser(id: string): User {
	const user: User = api.fetch(id);
	return user;
}`,
			expectedParts: []string{
				`"return value"`,
			},
			unexpectedParts: []string{
				`/* already valid */`,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := transformTestCode(t, tt.input, config)
			for _, part := range tt.expectedParts {
				if !strings.Contains(result, part) {
					t.Errorf("Expected output to contain %q\nGot:\n%s", part, result)
				}
			}
			for _, part := range tt.unexpectedParts {
				if strings.Contains(result, part) {
					t.Errorf("Expected output NOT to contain %q\nGot:\n%s", part, result)
				}
			}
		})
	}
}

func TestReusableValidators(t *testing.T) {
	tests := []struct {
		name            string
		input           string
		expectedParts   []string // Parts that should appear in output
		unexpectedParts []string // Parts that should NOT appear in output
	}{
		{
			name: "inlines when type used only once",
			input: `interface User {
	name: string;
	age: number;
}

function greet(user: User): void {
	console.log(user.name);
}`,
			expectedParts: []string{
				`typeof user === "object"`,      // Inline validation uses param name
				`"string" === typeof user.name`, // Inline property access on param
				`throw new TypeError`,           // Inline throw
			},
			unexpectedParts: []string{
				"let _e: string | null;", // Should NOT have shared error var
				"const _check_User",      // Should NOT hoist check function
			},
		},
		{
			name: "hoists when type used more than once",
			input: `interface User {
	name: string;
	age: number;
}

function greet(user: User): void {
	console.log(user.name);
}

function farewell(user: User): void {
	console.log("Goodbye " + user.name);
}`,
			expectedParts: []string{
				"let _e: string | null;",                                      // Shared error variable
				"const _check_User = (_v: any, _n: string): string | null =>", // Hoisted check function with name param
				`_check_User(user, "user")`,                                   // Both functions use same check with name arg
			},
			unexpectedParts: []string{
				`typeof user === "object"`, // Should NOT have inline validation on param name
			},
		},
		{
			name: "different types get different check functions",
			input: `interface User {
	name: string;
}

interface Company {
	title: string;
}

function greetUser1(user: User): void {}
function greetUser2(user: User): void {}
function logCompany1(company: Company): void {}
function logCompany2(company: Company): void {}`,
			expectedParts: []string{
				"const _check_User = (_v: any, _n: string): string | null",    // User check function with name param
				"const _check_Company = (_v: any, _n: string): string | null", // Company check function with name param
				`_check_User(user, "user")`,                                   // User validation with name arg
				`_check_Company(company, "company")`,                          // Company validation with name arg
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := Config{
				ValidateParameters: true,
				ValidateReturns:    false,
				ValidateCasts:      false,
			}

			output := transformTestCode(t, tt.input, config)
			t.Logf("Output:\n%s", output)

			for _, part := range tt.expectedParts {
				if !strings.Contains(output, part) {
					t.Errorf("Expected output to contain %q", part)
				}
			}

			for _, part := range tt.unexpectedParts {
				if strings.Contains(output, part) {
					t.Errorf("Expected output NOT to contain %q", part)
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
	ctx := context.Background()
	session := project.NewSession(&project.SessionInit{
		BackgroundCtx: ctx,
		FS:            fs,
		Options: &project.SessionOptions{
			CurrentDirectory:   tmpDir,
			DefaultLibraryPath: bundled.LibPath(),
		},
	})
	proj, _, releaseSnap, err := session.APIOpenProject(ctx, tsconfigFile, project.FileChangeSummary{})
	if err != nil {
		t.Fatalf("Failed to open project: %v", err)
	}
	releaseSnap()

	program := proj.GetProgram()
	sourceFile := program.GetSourceFile(testFile)
	if sourceFile == nil {
		t.Fatal("Could not find test.ts source file")
	}

	// Get type checker
	c, release := program.GetTypeChecker(ctx)
	defer release()

	// Transform the file
	return TransformFileWithConfig(sourceFile, c, program, config)
}
