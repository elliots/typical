package codegen

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/bundled"
	"github.com/microsoft/typescript-go/shim/checker"
	"github.com/microsoft/typescript-go/shim/compiler"
	"github.com/microsoft/typescript-go/shim/project"
	"github.com/microsoft/typescript-go/shim/vfs/osvfs"
)

// setupTestProject creates a TypeScript project with the given code and returns the checker, source file and program.
func setupTestProject(t *testing.T, code string) (*checker.Checker, *ast.SourceFile, *compiler.Program, func()) {
	t.Helper()

	tmpDir, err := os.MkdirTemp("", "codegen-advanced-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	cleanup := func() {
		os.RemoveAll(tmpDir)
	}

	tsconfigPath := filepath.Join(tmpDir, "tsconfig.json")
	tsconfigContent := `{
		"compilerOptions": {
			"target": "ES2020",
			"module": "ESNext",
			"strict": true
		},
		"include": ["*.ts"]
	}`
	if err := os.WriteFile(tsconfigPath, []byte(tsconfigContent), 0644); err != nil {
		cleanup()
		t.Fatalf("failed to write tsconfig: %v", err)
	}

	testTsPath := filepath.Join(tmpDir, "test.ts")
	if err := os.WriteFile(testTsPath, []byte(code), 0644); err != nil {
		cleanup()
		t.Fatalf("failed to write test.ts: %v", err)
	}

	fs := bundled.WrapFS(osvfs.FS())
	session := project.NewSession(&project.SessionInit{
		FS: fs,
		Options: &project.SessionOptions{
			CurrentDirectory:   tmpDir,
			DefaultLibraryPath: bundled.LibPath(),
		},
	})

	ctx := context.Background()
	proj, err := session.OpenProject(ctx, tsconfigPath)
	if err != nil {
		cleanup()
		t.Fatalf("failed to open project: %v", err)
	}

	program := proj.GetProgram()
	sourceFile := program.GetSourceFile(testTsPath)
	if sourceFile == nil {
		cleanup()
		t.Fatalf("failed to get source file")
	}

	c, release := program.GetTypeChecker(ctx)

	return c, sourceFile, program, func() {
		release()
		cleanup()
	}
}

// findFunctionParamType finds a function by name and returns the type of its first parameter.
func findFunctionParamType(c *checker.Checker, sourceFile *ast.SourceFile, funcName string) *checker.Type {
	var result *checker.Type
	var visit ast.Visitor
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindFunctionDeclaration {
			fn := node.AsFunctionDeclaration()
			if fn != nil && fn.Name() != nil && fn.Name().Text() == funcName {
				if fn.Parameters != nil && len(fn.Parameters.Nodes) > 0 {
					param := fn.Parameters.Nodes[0].AsParameterDeclaration()
					if param != nil && param.Type != nil {
						result = checker.Checker_getTypeFromTypeNode(c, param.Type)
					}
				}
			}
		}
		node.ForEachChild(visit)
		return false
	}
	sourceFile.AsNode().ForEachChild(visit)
	return result
}

// TestUtilityTypes tests that TypeScript utility types (Omit, Pick, Partial, etc.) work correctly.
func TestUtilityTypes(t *testing.T) {
	code := `
interface User {
	id: number;
	name: string;
	email: string;
	age: number;
}

// Omit removes specific properties
function testOmit(user: Omit<User, "email">): void {}

// Pick selects specific properties
function testPick(user: Pick<User, "id" | "name">): void {}

// Partial makes all properties optional
function testPartial(user: Partial<User>): void {}

// Required makes all properties required (opposite of Partial)
interface OptionalUser {
	id?: number;
	name?: string;
}
function testRequired(user: Required<OptionalUser>): void {}

// Record creates an object type with specified keys
function testRecord(data: Record<string, number>): void {}
`

	c, sourceFile, program, cleanup := setupTestProject(t, code)
	defer cleanup()

	gen := NewGenerator(c, program)

	tests := []struct {
		funcName        string
		expectedContain []string
		expectedNot     []string
	}{
		{
			funcName: "testOmit",
			expectedContain: []string{
				`_v.id`,   // id should be present
				`_v.name`, // name should be present
				`_v.age`,  // age should be present
				"object",
			},
			expectedNot: []string{
				`_v.email`, // email should NOT be present (omitted)
			},
		},
		{
			funcName: "testPick",
			expectedContain: []string{
				`_v.id`,   // id should be present
				`_v.name`, // name should be present
				"object",
			},
			expectedNot: []string{
				`_v.email`, // email should NOT be present (not picked)
				`_v.age`,   // age should NOT be present (not picked)
			},
		},
		{
			funcName: "testPartial",
			expectedContain: []string{
				"undefined", // Should check for undefined (optional props)
				"object",
			},
		},
		{
			funcName: "testRequired",
			expectedContain: []string{
				`_v.id`,
				`_v.name`,
				"object",
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.funcName, func(t *testing.T) {
			paramType := findFunctionParamType(c, sourceFile, tc.funcName)
			if paramType == nil {
				t.Fatalf("Could not find type for %s", tc.funcName)
			}

			result := gen.GenerateValidator(paramType, "param")
			validator := result.Code
			t.Logf("Generated validator for %s:\n%s", tc.funcName, validator)

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

// TestLiteralTypes tests string, number, and boolean literals.
func TestLiteralTypes(t *testing.T) {
	code := `
// String literal
function testStringLiteral(value: "hello"): void {}

// Number literal
function testNumberLiteral(value: 42): void {}

// Boolean literal
function testBooleanLiteral(value: true): void {}

// Union of literals
function testLiteralUnion(value: "a" | "b" | "c"): void {}

// Mixed union with literal
function testMixedUnion(value: "error" | number): void {}
`

	c, sourceFile, program, cleanup := setupTestProject(t, code)
	defer cleanup()

	gen := NewGenerator(c, program)

	tests := []struct {
		funcName        string
		expectedContain []string
	}{
		{
			funcName: "testStringLiteral",
			expectedContain: []string{
				`"hello"`, // Should check for exact value
			},
		},
		{
			funcName: "testNumberLiteral",
			expectedContain: []string{
				"42", // Should check for exact value
			},
		},
		{
			funcName: "testBooleanLiteral",
			expectedContain: []string{
				"true", // Should check for exact value
			},
		},
		{
			funcName: "testLiteralUnion",
			expectedContain: []string{
				`"a"`,
				`"b"`,
				`"c"`,
				"else if", // Union check
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.funcName, func(t *testing.T) {
			paramType := findFunctionParamType(c, sourceFile, tc.funcName)
			if paramType == nil {
				t.Fatalf("Could not find type for %s", tc.funcName)
			}

			result := gen.GenerateValidator(paramType, "param")
			validator := result.Code
			t.Logf("Generated validator for %s:\n%s", tc.funcName, validator)

			for _, expected := range tc.expectedContain {
				if !strings.Contains(validator, expected) {
					t.Errorf("Expected validator to contain %q", expected)
				}
			}
		})
	}
}

// TestTupleTypes tests tuple type validation.
func TestTupleTypes(t *testing.T) {
	code := `
// Simple tuple
function testSimpleTuple(value: [string, number]): void {}

// Tuple with optional element
function testOptionalTuple(value: [string, number?]): void {}

// Named tuple (labels are just for documentation)
function testNamedTuple(value: [name: string, age: number]): void {}

// Rest tuple
function testRestTuple(value: [string, ...number[]]): void {}
`

	c, sourceFile, program, cleanup := setupTestProject(t, code)
	defer cleanup()

	gen := NewGenerator(c, program)

	tests := []struct {
		funcName        string
		expectedContain []string
	}{
		{
			funcName: "testSimpleTuple",
			expectedContain: []string{
				"Array.isArray",
				"length",
				`[0]`, // First element
				`[1]`, // Second element
			},
		},
		{
			funcName: "testNamedTuple",
			expectedContain: []string{
				"Array.isArray",
				`[0]`,
				`[1]`,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.funcName, func(t *testing.T) {
			paramType := findFunctionParamType(c, sourceFile, tc.funcName)
			if paramType == nil {
				t.Fatalf("Could not find type for %s", tc.funcName)
			}

			result := gen.GenerateValidator(paramType, "param")
			validator := result.Code
			t.Logf("Generated validator for %s:\n%s", tc.funcName, validator)

			for _, expected := range tc.expectedContain {
				if !strings.Contains(validator, expected) {
					t.Errorf("Expected validator to contain %q", expected)
				}
			}
		})
	}
}

// TestEnumTypes tests enum validation.
func TestEnumTypes(t *testing.T) {
	code := `
// Numeric enum
enum Direction {
	Up,
	Down,
	Left,
	Right
}
function testNumericEnum(dir: Direction): void {}

// String enum
enum Color {
	Red = "red",
	Green = "green",
	Blue = "blue"
}
function testStringEnum(color: Color): void {}

// Const enum (inlined at compile time)
const enum Size {
	Small = 1,
	Medium = 2,
	Large = 3
}
function testConstEnum(size: Size): void {}
`

	c, sourceFile, program, cleanup := setupTestProject(t, code)
	defer cleanup()

	gen := NewGenerator(c, program)

	tests := []struct {
		funcName        string
		expectedContain []string
	}{
		{
			funcName: "testNumericEnum",
			expectedContain: []string{
				// Numeric enums are unions of their values
				"0", "1", "2", "3",
			},
		},
		{
			funcName: "testStringEnum",
			expectedContain: []string{
				`"red"`,
				`"green"`,
				`"blue"`,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.funcName, func(t *testing.T) {
			paramType := findFunctionParamType(c, sourceFile, tc.funcName)
			if paramType == nil {
				t.Fatalf("Could not find type for %s", tc.funcName)
			}

			result := gen.GenerateValidator(paramType, "param")
			validator := result.Code
			t.Logf("Generated validator for %s:\n%s", tc.funcName, validator)

			for _, expected := range tc.expectedContain {
				if !strings.Contains(validator, expected) {
					t.Errorf("Expected validator to contain %q", expected)
				}
			}
		})
	}
}

// TestClassTypes tests class instance validation.
func TestClassTypes(t *testing.T) {
	code := `
class User {
	constructor(public name: string, public age: number) {}
}

function testClassParam(user: User): void {}

// Class with private fields
class Account {
	private balance: number = 0;
	public id: string;
	constructor(id: string) {
		this.id = id;
	}
}

function testClassWithPrivate(account: Account): void {}
`

	c, sourceFile, program, cleanup := setupTestProject(t, code)
	defer cleanup()

	gen := NewGenerator(c, program)

	t.Run("testClassParam", func(t *testing.T) {
		paramType := findFunctionParamType(c, sourceFile, "testClassParam")
		if paramType == nil {
			t.Fatal("Could not find type for testClassParam")
		}

		result := gen.GenerateValidator(paramType, "param")
		validator := result.Code
		t.Logf("Generated validator for class:\n%s", validator)

		// Classes use instanceof check
		expectedContain := []string{
			"instanceof User",
			"User instance",
		}

		for _, expected := range expectedContain {
			if !strings.Contains(validator, expected) {
				t.Errorf("Expected validator to contain %q", expected)
			}
		}
	})
}

// TestDiscriminatedUnions tests discriminated (tagged) unions.
func TestDiscriminatedUnions(t *testing.T) {
	code := `
interface Circle {
	kind: "circle";
	radius: number;
}

interface Square {
	kind: "square";
	size: number;
}

interface Rectangle {
	kind: "rectangle";
	width: number;
	height: number;
}

type Shape = Circle | Square | Rectangle;

function testDiscriminatedUnion(shape: Shape): void {}
`

	c, sourceFile, program, cleanup := setupTestProject(t, code)
	defer cleanup()

	gen := NewGenerator(c, program)

	t.Run("testDiscriminatedUnion", func(t *testing.T) {
		paramType := findFunctionParamType(c, sourceFile, "testDiscriminatedUnion")
		if paramType == nil {
			t.Fatal("Could not find type for testDiscriminatedUnion")
		}

		result := gen.GenerateValidator(paramType, "param")
		validator := result.Code
		t.Logf("Generated validator for discriminated union:\n%s", validator)

		// Should contain checks for each variant
		expectedContain := []string{
			"else if", // Union check uses if-else chain
			"object",  // Object checks
		}

		for _, expected := range expectedContain {
			if !strings.Contains(validator, expected) {
				t.Errorf("Expected validator to contain %q", expected)
			}
		}
	})
}

// TestNestedTypes tests nested objects and arrays.
func TestNestedTypes(t *testing.T) {
	code := `
interface Address {
	street: string;
	city: string;
	zip: string;
}

interface User {
	name: string;
	addresses: Address[];
}

interface Company {
	name: string;
	employees: User[];
}

function testNestedObjects(company: Company): void {}

// Deeply nested arrays
function testNestedArrays(data: string[][]): void {}

// Array of unions
function testArrayOfUnions(values: (string | number)[]): void {}
`

	c, sourceFile, program, cleanup := setupTestProject(t, code)
	defer cleanup()

	gen := NewGenerator(c, program)

	tests := []struct {
		funcName        string
		expectedContain []string
	}{
		{
			funcName: "testNestedObjects",
			expectedContain: []string{
				"object",
				"name",
				"employees",
				"Array.isArray",
			},
		},
		{
			funcName: "testNestedArrays",
			expectedContain: []string{
				"Array.isArray",
			},
		},
		{
			funcName: "testArrayOfUnions",
			expectedContain: []string{
				"Array.isArray",
				"else if", // Union check uses if-else chain
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.funcName, func(t *testing.T) {
			paramType := findFunctionParamType(c, sourceFile, tc.funcName)
			if paramType == nil {
				t.Fatalf("Could not find type for %s", tc.funcName)
			}

			result := gen.GenerateValidator(paramType, "param")
			validator := result.Code
			t.Logf("Generated validator for %s:\n%s", tc.funcName, validator)

			for _, expected := range tc.expectedContain {
				if !strings.Contains(validator, expected) {
					t.Errorf("Expected validator to contain %q", expected)
				}
			}
		})
	}
}

// TestIntersectionTypes tests intersection type validation.
func TestIntersectionTypes(t *testing.T) {
	code := `
interface Named {
	name: string;
}

interface Aged {
	age: number;
}

// Simple intersection
function testIntersection(person: Named & Aged): void {}

// Intersection with type alias
type Employee = Named & Aged & { employeeId: string };
function testComplexIntersection(employee: Employee): void {}
`

	c, sourceFile, program, cleanup := setupTestProject(t, code)
	defer cleanup()

	gen := NewGenerator(c, program)

	tests := []struct {
		funcName        string
		expectedContain []string
	}{
		{
			funcName: "testIntersection",
			expectedContain: []string{
				"name",
				"age",
				"object",
			},
		},
		{
			funcName: "testComplexIntersection",
			expectedContain: []string{
				"name",
				"age",
				"employeeId",
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.funcName, func(t *testing.T) {
			paramType := findFunctionParamType(c, sourceFile, tc.funcName)
			if paramType == nil {
				t.Fatalf("Could not find type for %s", tc.funcName)
			}

			result := gen.GenerateValidator(paramType, "param")
			validator := result.Code
			t.Logf("Generated validator for %s:\n%s", tc.funcName, validator)

			for _, expected := range tc.expectedContain {
				if !strings.Contains(validator, expected) {
					t.Errorf("Expected validator to contain %q", expected)
				}
			}
		})
	}
}
