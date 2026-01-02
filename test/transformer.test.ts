import { test, describe } from "node:test";
import assert from "node:assert";
import ts from "typescript";
import { TypicalTransformer } from "../src/transformer.js";
import { compileIgnorePattern, compileIgnorePatterns, TypicalConfig } from "../src/config.js";
import { writeFileSync } from "node:fs";

interface TestCase {
  name: string;
  input: string;
  expected?: string;
  expectedPatterns?: (RegExp | string)[];
  notExpectedPatterns?: (RegExp | string)[];
}

/**
 * Create a transformer with a minimal program containing only the test file.
 * This prevents type collisions with other files in the project.
 */
function createTestTransformer(fileName: string, content: string, config?: ConstructorParameters<typeof TypicalTransformer>[0]): TypicalTransformer {
  writeFileSync(fileName, content);

  // Create a minimal program with only the test file
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    // Include lib files so typia can resolve built-in types
    lib: ["lib.es2020.d.ts"],
  };

  const program = ts.createProgram([fileName], compilerOptions);
  return new TypicalTransformer(config, program, ts);
}

/**
 * Create a transformer with full lib context for typia mode tests.
 * Uses the project's tsconfig.json so typia can properly resolve types.
 */
function createFullContextTransformer(fileName: string, content: string, config?: ConstructorParameters<typeof TypicalTransformer>[0]): TypicalTransformer {
  writeFileSync(fileName, content);

  // Load the project's tsconfig for full type resolution
  const configPath = ts.findConfigFile("./", ts.sys.fileExists, "tsconfig.json");
  let compilerOptions: ts.CompilerOptions;

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, "./");
    compilerOptions = parsed.options;
  } else {
    // Fallback if no tsconfig found
    compilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    };
  }

  const program = ts.createProgram([fileName], compilerOptions);
  return new TypicalTransformer(config, program, ts);
}

describe("TypicalTransformer", () => {
  test("should create TypicalTransformer instance", () => {
    const transformer = new TypicalTransformer();
    assert.ok(transformer instanceof TypicalTransformer);
  });

  const testCases: TestCase[] = [
    {
      name: "function with basic parameter and return type validation",
      input: `function greet(name: string): string {return "Hello " + name;}`,
      expected: `import typia from "typia";
const __typical_assert_string = typia.createAssert<string>();
function greet(name: string): string { __typical_assert_string(name); return __typical_assert_string("Hello " + name); }`,
    },
    {
      name: "JSON.stringify transformation",
      input: `
interface User {
  id: number;
  name: string;
}
function processData(data: User) {
  return JSON.stringify(data);
}`,
      expectedPatterns: [
        `import typia from "typia"`,
        `typia.json.createStringify<User>()`,
      ],
      notExpectedPatterns: [`JSON.stringify`],
    },
    {
      name: "JSON.parse transformation",
      input: `
function parseData(jsonStr: string): { id: number, name: string } {
  return JSON.parse(jsonStr);
}`,
      // Note: No return validation wrapper since assertParse already validates
      expected: `import typia from "typia";
const __typical_assert_string = typia.createAssert<string>();
const __typical_parse_0 = typia.json.createAssertParse<{
    id: number;
    name: string;
}>();
function parseData(jsonStr: string): {
    id: number;
    name: string;
} {
    __typical_assert_string(jsonStr);
    return __typical_parse_0(jsonStr);
}`,
    },
    {
      name: "return type validation",
      input: `
function getData(): { id: number, name: string } {
  const data = { id: 1, name: "test" };
  return data;
}`,
      expected: ` import typia from "typia";
const __typical_assert_0 = typia.createAssert<{
    id: number;
    name: string;
}>();
function getData(): {
    id: number;
    name: string;
} {
    const data = { id: 1, name: "test" };
    return __typical_assert_0(data);
}`,
    },
    {
      name: "arrow functions",
      input: `
const multiply = (a: number, b: number): number => {
  return a * b;
};`,
      expected: `import typia from "typia";
const __typical_assert_number = typia.createAssert<number>();
const multiply = (a: number, b: number): number => {
    __typical_assert_number(a);
    __typical_assert_number(b);
    return __typical_assert_number(a * b);
};`,
    },
    {
      name: "complex types",
      input: `
interface User {
  id: number;
  name: string;
  email?: string;
}

function processUser(user: User): User {
  return { ...user, id: user.id + 1 };
}
function processUserLike(user: User) {
  return { ...user, id: user.id + 1 };
}
function processUserStringId(user: User) {
  return { ...user, id: user.id + '-1' };
}`,
      expected: `import typia from "typia";
const __typical_assert_User = typia.createAssert<User>();
const __typical_assert_0 = typia.createAssert<{ id: number; name: string; email?: string; }>();
const __typical_assert_1 = typia.createAssert<{ id: string; name: string; email?: string; }>();
interface User {
    id: number;
    name: string;
    email?: string;
}
function processUser(user: User): User {
    __typical_assert_User(user);
    return __typical_assert_User({ ...user, id: user.id + 1 });
}
function processUserLike(user: User) {
    __typical_assert_User(user);
    return __typical_assert_0({ ...user, id: user.id + 1 });
}
function processUserStringId(user: User) {
    __typical_assert_User(user);
    return __typical_assert_1({ ...user, id: user.id + '-1' });
}`,
    },
    {
      name: "async functions unwrap Promise return type",
      input: `
interface User {
  id: number;
  name: string;
}
async function fetchUser(id: number): Promise<User> {
  return { id, name: "test" };
}`,
      expectedPatterns: [
        `import typia from "typia"`,
        `typia.createAssert<number>()`,
        `typia.createAssert<User>()`,
        `return __typical_assert_User(await { id, name: "test" })`, // Should await the expression
      ],
      notExpectedPatterns: [
        `createAssert<Promise<User>>`, // Should NOT validate Promise<User>, should validate User
      ],
    },
    {
      name: "async functions with await return correct type",
      input: `
interface User {
  id: number;
  name: string;
}
declare function fetchFromApi(url: string): Promise<User>;
async function getUser(url: string): Promise<User> {
  const user = await fetchFromApi(url);
  return user;
}`,
      expectedPatterns: [
        `import typia from "typia"`,
        `typia.createAssert<string>()`,
        `typia.createAssert<User>()`,
        `return __typical_assert_User(await user)`, // Should await the variable (even if already resolved)
      ],
      notExpectedPatterns: [`createAssert<Promise<User>>`],
    },
    {
      name: "async functions returning promise directly adds await",
      input: `
interface User {
  id: number;
  name: string;
}
declare function fetchFromApi(url: string): Promise<User>;
async function getUser(url: string): Promise<User> {
  return fetchFromApi(url);
}`,
      expectedPatterns: [
        `import typia from "typia"`,
        `typia.createAssert<User>()`,
        `return __typical_assert_User(await fetchFromApi(url))`, // Must await before validating
      ],
      notExpectedPatterns: [`createAssert<Promise<User>>`],
    },
    // Flow analysis tests - skipping redundant return validation
    {
      name: "flow analysis: skips return validation for direct parameter return",
      input: `
interface User {
  id: number;
  name: string;
}
function validate(user: User): User {
  return user;
}`,
      expectedPatterns: [
        `__typical_assert_User(user);`, // Parameter should be validated
        `return user;`, // Return should NOT be wrapped
      ],
      notExpectedPatterns: [
        `return __typical_assert`, // Should NOT wrap return
      ],
    },
    {
      name: "flow analysis: skips return validation for property of validated param",
      input: `
interface Address {
  street: string;
  city: string;
}
interface User {
  id: number;
  address: Address;
}
function getAddress(user: User): Address {
  return user.address;
}`,
      expectedPatterns: [
        `__typical_assert_User(user);`, // Parameter should be validated
        `return user.address;`, // Return should NOT be wrapped
      ],
      notExpectedPatterns: [
        `return __typical_assert`, // Should NOT wrap return
      ],
    },
    {
      name: "flow analysis: validates return when param passed to function",
      input: `
interface User {
  id: number;
  name: string;
}
declare function mutate(u: User): void;
function processUser(user: User): User {
  mutate(user);
  return user;
}`,
      expectedPatterns: [
        `__typical_assert_User(user);`, // Parameter validation
        `return __typical_assert_User(user);`, // Return MUST be validated (tainted)
      ],
    },
    {
      name: "flow analysis: validates return when param property assigned",
      input: `
interface User {
  id: number;
  name: string;
}
function updateUser(user: User): User {
  user.name = "modified";
  return user;
}`,
      expectedPatterns: [
        `__typical_assert_User(user);`, // Parameter validation
        `return __typical_assert_User(user);`, // Return MUST be validated (tainted)
      ],
    },
    {
      name: "flow analysis: validates return after await",
      input: `
interface User {
  id: number;
  name: string;
}
declare function delay(): Promise<void>;
async function asyncProcess(user: User): Promise<User> {
  await delay();
  return user;
}`,
      expectedPatterns: [
        `__typical_assert_User(user);`, // Parameter validation
        `return __typical_assert_User(await user);`, // Return MUST be validated (tainted by await) - same validator as param since same type
      ],
    },
    {
      name: "flow analysis: validates return for spread into new object",
      input: `
interface User {
  id: number;
  name: string;
}
function cloneUser(user: User): User {
  return { ...user };
}`,
      expectedPatterns: [
        `__typical_assert_User(user);`, // Parameter validation
        `return __typical_assert_User({ ...user });`, // Return MUST be validated (new object)
      ],
    },
    {
      name: "flow analysis: skips return for const declaration",
      input: `
interface User {
  id: number;
  name: string;
}
declare function getData(): User;
function getUser(): User {
  const user: User = getData();
  return user;
}`,
      expectedPatterns: [
        `return user;`, // Return should NOT be wrapped (const is validated)
      ],
      notExpectedPatterns: [
        `return __typical_assert`, // Should NOT wrap return
      ],
    },
    {
      name: "flow analysis: validates return when const property assigned",
      input: `
interface User {
  id: number;
  name: string;
}
declare function getData(): User;
function modifyUser(): User {
  const user: User = getData();
  user.name = "modified";
  return user;
}`,
      expectedPatterns: [
        `return __typical_assert`, // Return MUST be validated (const was mutated)
      ],
    },
    {
      name: "flow analysis: validates return when const property taken then assigned",
      input: `
interface User {
  id: number;
  name: string;
  subUser?: User;
}
declare function getData(): User;
function modifyUser(): User {
  const user: User = getData();
  user.name = "modified";
  return user;
}`,
      expectedPatterns: [
        `return __typical_assert`, // Return MUST be validated (const was mutated)
      ],
    },
    {
      name: "flow analysis: validates return for let declaration",
      input: `
interface User {
  id: number;
  name: string;
}
declare function getData(): User;
function getUserLet(): User {
  let user: User = getData();
  return user;
}`,
      expectedPatterns: [
        `return __typical_assert`, // Return MUST be validated (let can be reassigned)
      ],
    },
    {
      name: "flow analysis: method call on param taints it",
      input: `
interface User {
  id: number;
  name: string;
  update(): void;
}
function callMethod(user: User): User {
  user.update();
  return user;
}`,
      expectedPatterns: [
        `return __typical_assert`, // Return MUST be validated (method call could mutate)
      ],
    },
    // Arrow function expression body tests
    {
      name: "JSON.stringify in arrow function expression body",
      input: `
interface User {
  id: number;
  name: string;
}
const user: User = { id: 1, name: "test" };
const fn = () => (() => JSON.stringify(user))();`,
      expectedPatterns: [
        `typia.json.createStringify<User>()`,
        `const fn = () => (() => __typical_stringify_User(user))()`,
      ],
      notExpectedPatterns: [`JSON.stringify`],
    },
    {
      name: "JSON.parse in arrow function expression body",
      input: `
interface User {
  id: number;
  name: string;
}
const fn = (s: string): User => JSON.parse(s);`,
      expectedPatterns: [
        `typia.json.createAssertParse<User>()`,
        `=> __typical_parse_User`,
      ],
      notExpectedPatterns: [`JSON.parse`],
    },
    // Non-async function returning Promise tests
    {
      name: "non-async function returning Promise uses .then() for validation",
      input: `
interface User {
  id: number;
  name: string;
}
declare function fetchUser(id: number): Promise<User>;
function getUser(id: number): Promise<User> {
  return fetchUser(id);
}`,
      expectedPatterns: [
        `import typia from "typia"`,
        `typia.createAssert<User>()`,
        `return fetchUser(id).then(__typical_assert_User)`, // Should use .then() not await
      ],
      notExpectedPatterns: [
        `await fetchUser`, // Should NOT use await (not async function)
        `createAssert<Promise<User>>`, // Should NOT validate Promise<User>
      ],
    },
    {
      name: "non-async arrow function returning Promise in .map() uses .then()",
      input: `
interface Product {
  id: number;
  name: string;
}
declare function getProducts(id: string): Promise<{ items: Product[] }>;
function queryProducts(sourceIds: string[]): Promise<{ items: Product[] }>[] {
  return sourceIds.map(sourceId => {
    return getProducts(sourceId);
  });
}`,
      expectedPatterns: [
        `import typia from "typia"`,
        `typia.createAssert<{`,
        `.then(__typical_assert_`, // Should use .then() for validation
      ],
      notExpectedPatterns: [
        `await getProducts`, // Should NOT use await (not async)
        `__typical_assert_void`, // Should NOT be void type
      ],
    },
    {
      name: "non-async arrow function with inferred Promise return uses .then()",
      input: `
interface Data {
  value: number;
}
declare function fetchData(): Promise<Data>;
const getData = (): Promise<Data> => fetchData();`,
      expectedPatterns: [
        `typia.createAssert<Data>()`,
        `.then(__typical_assert_Data)`,
      ],
      notExpectedPatterns: [
        `await fetchData`,
      ],
    },
    // Complex type handling tests
    {
      name: "truncated types use hash-based keys",
      input: `
interface VeryLongTypeName {
  field1: string;
  field2: number;
  field3: boolean;
  field4: string[];
  field5: { nested: { deep: { value: string } } };
}
function process(data: VeryLongTypeName): VeryLongTypeName {
  return data;
}`,
      expectedPatterns: [
        `typia.createAssert<VeryLongTypeName>()`,
      ],
      notExpectedPatterns: [
        `...more`, // Should not have truncation in output
      ],
    },
    {
      name: "complex object literal types use numeric suffixes",
      input: `
function getInfo() {
  const data = { x: "a", y: 1 };
  return JSON.stringify(data);
}`,
      expectedPatterns: [
        // Should use numeric suffix for complex inline object types, not encode the whole type
        /__typical_stringify_\d+\(data\)/,
      ],
      notExpectedPatterns: [
        // Should NOT have ugly encoded type names
        `__typical_stringify___x__string`,
        `__typical_stringify____x`,
        `ObjectLiteral_`,
        `Expression_`,
      ],
    },
    // Nested function tests - outer function shouldn't transform inner function's returns
    {
      name: "nested arrow function in .map() has separate return type handling",
      input: `
interface Item { id: number; }
declare function fetchItems(): Item[];
function getIds(): number[] {
  return fetchItems().map(item => {
    return item.id;
  });
}`,
      expectedPatterns: [
        // The outer function returns number[] which should be validated
        `__typical_assert_`,
        `fetchItems().map`,
      ],
      notExpectedPatterns: [
        // Inner arrow function should NOT have its return wrapped by outer's validator
        `__typical_assert_void`,
      ],
    },
    // Generic type tests - type parameters cannot be validated at runtime
    {
      name: "generic: skips validation for type parameter T",
      input: `
function identity<T>(value: T): T {
  return value;
}`,
      notExpectedPatterns: [
        `typia.createAssert`, // Should NOT create any validators for generic T
        `__typical_assert_`,
      ],
    },
    {
      name: "generic: validates concrete types in generic function",
      input: `
interface User { name: string; }
function processUser<T>(value: T, user: User): User {
  return user;
}`,
      expectedPatterns: [
        `typia.createAssert<User>()`, // Should validate User parameter
        `__typical_assert_User(user)`, // Parameter validation
      ],
      notExpectedPatterns: [
        `createAssert<T>`, // Should NOT try to validate T
      ],
    },
    {
      name: "generic: utility types like Partial<T> are validated",
      input: `
interface User { name: string; age: number; }
function updateUser(partial: Partial<User>): Partial<User> {
  return partial;
}`,
      expectedPatterns: [
        `typia.createAssert<Partial<User>>()`,
        `__typical_assert_`,
      ],
    },
    {
      name: "generic: Pick utility type is validated",
      input: `
interface User { name: string; age: number; email: string; }
function getName(user: Pick<User, "name">): Pick<User, "name"> {
  return user;
}`,
      expectedPatterns: [
        `typia.createAssert<Pick<User, "name">>()`,
      ],
    },
    // Destructuring pattern tests
    // NOTE: Current behavior uses 'param' as fallback name for destructured params
    // This is a known limitation - the validation still works at runtime
    {
      name: "destructuring: validates destructured parameter with type annotation",
      input: `
interface User { name: string; age: number; }
function greet({ name, age }: User): string {
  return name + age;
}`,
      expectedPatterns: [
        `typia.createAssert<User>()`,
        `__typical_assert_User(param)`, // Uses 'param' fallback for destructured bindings
      ],
    },
    {
      name: "destructuring: validates rest parameters",
      input: `
interface Item { id: number; }
function processItems(...items: Item[]): number {
  return items.length;
}`,
      expectedPatterns: [
        `typia.createAssert<Item[]>()`,
        `__typical_assert_`,
        `(items)`, // Rest params use their actual name
      ],
    },
    {
      name: "destructuring: validates array destructuring",
      input: `
function processFirst([first, second]: [string, number]): string {
  return first;
}`,
      expectedPatterns: [
        /typia\.createAssert<\[\s*string,\s*number\s*\]>/, // Tuple type (may have whitespace)
        `__typical_assert_0(param)`, // Uses 'param' fallback for array destructuring
      ],
    },
    // Union and intersection type tests
    {
      name: "union: validates union type parameters",
      input: `
interface Cat { meow(): void; }
interface Dog { bark(): void; }
function pet(animal: Cat | Dog): Cat | Dog {
  return animal;
}`,
      expectedPatterns: [
        `typia.createAssert<Cat | Dog>()`,
        `__typical_assert_`,
      ],
    },
    {
      name: "intersection: validates intersection type parameters",
      input: `
interface Named { name: string; }
interface Aged { age: number; }
function process(person: Named & Aged): Named & Aged {
  return person;
}`,
      expectedPatterns: [
        `typia.createAssert<Named & Aged>()`,
        `__typical_assert_`,
      ],
    },
    {
      name: "discriminated union: validates discriminated union",
      input: `
interface Circle { kind: "circle"; radius: number; }
interface Square { kind: "square"; side: number; }
type Shape = Circle | Square;
function area(shape: Shape): number {
  return shape.kind === "circle" ? 3.14 * shape.radius ** 2 : shape.side ** 2;
}`,
      expectedPatterns: [
        `typia.createAssert<Shape>()`,
        `__typical_assert_Shape(shape)`,
      ],
    },
    // Class method tests
    {
      name: "class: validates instance method parameters and returns",
      input: `
interface User { name: string; }
class UserService {
  getUser(id: number): User {
    return { name: "test" };
  }
}`,
      expectedPatterns: [
        `typia.createAssert<number>()`,
        `typia.createAssert<User>()`,
        `__typical_assert_number(id)`,
      ],
    },
    {
      name: "class: validates static method parameters",
      input: `
interface Config { debug: boolean; }
class AppConfig {
  static parse(json: string): Config {
    return { debug: true };
  }
}`,
      expectedPatterns: [
        `typia.createAssert<string>()`,
        `typia.createAssert<Config>()`,
        `__typical_assert_string(json)`,
      ],
    },
    // NOTE: Constructors are currently NOT transformed (limitation)
    // This test documents current behavior - constructor validation could be added later
    {
      name: "class: constructors are not currently transformed",
      input: `
interface Options { timeout: number; }
class Client {
  constructor(options: Options) {
    console.log(options);
  }
}`,
      notExpectedPatterns: [
        `typia.createAssert`, // Constructors not transformed currently
      ],
    },
    // Higher-order function tests
    {
      name: "HOF: validates outer function but not returned function body",
      input: `
interface User { name: string; }
function createValidator(strict: boolean): (user: User) => boolean {
  return (user: User) => {
    return user.name.length > 0;
  };
}`,
      expectedPatterns: [
        `typia.createAssert<boolean>()`, // validates strict param
        `typia.createAssert<User>()`, // validates inner user param
      ],
    },
    // NOTE: Arrow function expression bodies (not blocks) don't get parameter validation
    // Only arrow functions with block bodies { } get transformed
    {
      name: "HOF: curried function - outer validated, inner expression body not validated",
      input: `
function add(a: number): (b: number) => number {
  return (b: number) => a + b;
}`,
      expectedPatterns: [
        `typia.createAssert<number>()`,
        `__typical_assert_number(a)`,
      ],
      notExpectedPatterns: [
        `__typical_assert_number(b)`, // Expression body arrows don't get param validation
      ],
    },
    {
      name: "HOF: curried function with block body validates both levels",
      input: `
function add(a: number): (b: number) => number {
  return (b: number) => {
    return a + b;
  };
}`,
      expectedPatterns: [
        `typia.createAssert<number>()`,
        `__typical_assert_number(a)`,
        `__typical_assert_number(b)`,
      ],
    },
  ];

  testCases.forEach(
    ({ name, input, expected, expectedPatterns, notExpectedPatterns }) => {
      test(name, () => {
        const fileName = "test/test.temp.ts";
        const transformer = createTestTransformer(fileName, input);

        const transformedCode = transformer.transform(fileName, "basic");

        // console.log("Transformed Code:\n", transformedCode);

        if (expected !== undefined) {
          assert.equal(transformedCode.trim(), expected.trim());
        }

        // Check expected patterns
        if (expectedPatterns) {
          expectedPatterns.forEach((pattern) => {
            if (typeof pattern === "string") {
              if (!transformedCode.includes(pattern)) {
                console.log("Transformed Code:\n", transformedCode);
                assert.fail(
                  `Expected pattern ${pattern} not found in transformed code`
                );
              }
            } else {
              assert.match(
                transformedCode,
                pattern,
                `Expected pattern ${pattern} not found in transformed code`
              );
            }
          });
        }

        // Check patterns that should not be present
        if (notExpectedPatterns) {
          notExpectedPatterns.forEach((pattern) => {
            if (typeof pattern === "string") {
              if (transformedCode.includes(pattern)) {
                assert.fail(
                  `Unexpected pattern ${pattern} found in transformed code`
                );
              }
            } else {
              assert.doesNotMatch(
                transformedCode,
                pattern,
                `Unexpected pattern ${pattern} found in transformed code`
              );
            }
          });
        }
      });
    }
  );

  // Cast validation tests (validateCasts option)
  describe("validateCasts option", () => {
    test("transforms 'as' casts when validateCasts is enabled", () => {
      const fileName = "test/test.temp.ts";
      const input = `
interface User {
  name: string;
  age: number;
  email: \`\${string}@\${string}\`;
}
const data = { name: "test", age: 30, email: "test@example.com" };
const user = data as User;
`;
      const transformer = createTestTransformer(fileName, input, { validateCasts: true, reusableValidators: true });
      const transformedCode = transformer.transform(fileName, "basic");

      // Should have validator
      assert.ok(
        transformedCode.includes("typia.createAssert<User>()"),
        "Should create validator for User type"
      );
      // Should wrap the cast
      assert.ok(
        transformedCode.includes("__typical_assert_"),
        "Should replace cast with validator call"
      );
      // Should NOT have 'as User'
      assert.ok(
        !transformedCode.includes("as User"),
        "Should not have 'as User' cast in output"
      );
    });

    test("does not transform casts when validateCasts is disabled (default)", () => {
      const fileName = "test/test.temp.ts";
      const input = `
interface User {
  name: string;
  age: number;
}
const data = { name: "test", age: 30 };
const user = data as User;
`;
      const transformer = createTestTransformer(fileName, input, { validateCasts: false, reusableValidators: true });
      const transformedCode = transformer.transform(fileName, "basic");

      // Should NOT have validator for the cast
      assert.ok(
        !transformedCode.includes("__typical_assert_"),
        "Should not add validator when validateCasts is false"
      );
    });

    test("skips 'as any' casts", () => {
      const fileName = "test/test.temp.ts";
      const input = `
const data = { name: "test" };
const escaped = data as any;
`;
      const transformer = createTestTransformer(fileName, input, { validateCasts: true, reusableValidators: true });
      const transformedCode = transformer.transform(fileName, "basic");

      // Should NOT validate 'as any'
      assert.ok(
        !transformedCode.includes("__typical_assert_"),
        "Should not validate 'as any' casts"
      );
    });

    test("skips 'as unknown' casts", () => {
      const fileName = "test/test.temp.ts";
      const input = `
const data = { name: "test" };
const escaped = data as unknown;
`;
      const transformer = createTestTransformer(fileName, input, { validateCasts: true, reusableValidators: true });
      const transformedCode = transformer.transform(fileName, "basic");

      // Should NOT validate 'as unknown'
      assert.ok(
        !transformedCode.includes("__typical_assert_"),
        "Should not validate 'as unknown' casts"
      );
    });
  });

  // Pre-compiled ignore pattern tests
  describe("ignoreTypes pattern compilation", () => {
    test("compiles valid glob patterns to RegExp", () => {
      const pattern = compileIgnorePattern("React.*");
      assert.ok(pattern instanceof RegExp, "Should return RegExp");
      assert.ok(pattern.test("React.FormEvent"), "Should match React.FormEvent");
      assert.ok(pattern.test("React.ChangeEvent"), "Should match React.ChangeEvent");
      assert.ok(!pattern.test("ReactDOM"), "Should not match ReactDOM");
    });

    test("compiles wildcard-only pattern", () => {
      const pattern = compileIgnorePattern("*Event");
      assert.ok(pattern instanceof RegExp, "Should return RegExp");
      assert.ok(pattern.test("MouseEvent"), "Should match MouseEvent");
      assert.ok(pattern.test("KeyboardEvent"), "Should match KeyboardEvent");
      assert.ok(!pattern.test("EventTarget"), "Should not match EventTarget");
    });

    test("compiles exact match pattern", () => {
      const pattern = compileIgnorePattern("Document");
      assert.ok(pattern instanceof RegExp, "Should return RegExp");
      assert.ok(pattern.test("Document"), "Should match Document");
      assert.ok(!pattern.test("DocumentFragment"), "Should not match DocumentFragment");
    });

    test("compileIgnorePatterns creates all pattern categories", () => {
      const config: TypicalConfig = {
        ignoreTypes: ["React.*", "Express.Request"],
        ignoreDOMTypes: true,
      };
      const compiled = compileIgnorePatterns(config);

      // User patterns
      assert.strictEqual(compiled.userPatterns.length, 2, "Should have 2 user patterns");

      // DOM patterns (should have many)
      assert.ok(compiled.domPatterns.length > 10, "Should have many DOM patterns");

      // All patterns combined
      assert.strictEqual(
        compiled.allPatterns.length,
        compiled.userPatterns.length + compiled.domPatterns.length,
        "allPatterns should be sum of user and DOM patterns"
      );
    });

    test("compileIgnorePatterns respects ignoreDOMTypes: false", () => {
      const config: TypicalConfig = {
        ignoreTypes: ["MyType"],
        ignoreDOMTypes: false,
      };
      const compiled = compileIgnorePatterns(config);

      assert.strictEqual(compiled.userPatterns.length, 1, "Should have 1 user pattern");
      assert.strictEqual(compiled.domPatterns.length, 0, "Should have 0 DOM patterns when disabled");
      assert.strictEqual(compiled.allPatterns.length, 1, "Should only have user patterns");
    });

    test("ignoreTypes patterns are used during transformation", () => {
      const fileName = "test/test.temp.ts";
      const input = `
interface MyIgnoredType { value: number; }
function process(x: MyIgnoredType): MyIgnoredType {
  return x;
}`;
      const transformer = createTestTransformer(fileName, input, {
        ignoreTypes: ["MyIgnoredType"],
        reusableValidators: true,
      });
      const transformedCode = transformer.transform(fileName, "basic");

      // Should NOT have validator for ignored type
      assert.ok(
        !transformedCode.includes("typia.createAssert<MyIgnoredType>"),
        "Should not create validator for ignored type"
      );
    });

    test("wildcard ignoreTypes pattern matches multiple types", () => {
      const fileName = "test/test.temp.ts";
      const input = `
interface MyEvent { type: string; }
interface OtherEvent { kind: string; }
function handleEvent(e: MyEvent): MyEvent { return e; }
function handleOther(e: OtherEvent): OtherEvent { return e; }
`;
      const transformer = createTestTransformer(fileName, input, {
        ignoreTypes: ["*Event"],
        reusableValidators: true,
      });
      const transformedCode = transformer.transform(fileName, "basic");

      // Should NOT have validators for *Event types
      assert.ok(
        !transformedCode.includes("typia.createAssert<MyEvent>"),
        "Should not create validator for MyEvent"
      );
      assert.ok(
        !transformedCode.includes("typia.createAssert<OtherEvent>"),
        "Should not create validator for OtherEvent"
      );
    });
  });

  // Full transpile tests (typia mode) - these test the complete pipeline including typia and regex hoisting
  // Uses createFullContextTransformer to provide proper type resolution for typia
  describe("full transpile (typia mode)", () => {
    test("transforms simple primitive validation with typia", () => {
      const fileName = "test/test.temp.ts";
      const input = `
function checkNumber(n: number): number {
  return n;
}`;
      const transformer = createFullContextTransformer(fileName, input, { reusableValidators: true });
      const transformedCode = transformer.transform(fileName, "typia");

      // typia.createAssert<T>() calls should be expanded to actual validation functions
      // Check that the typia call syntax is gone (but "typia.createAssert" in strings is ok)
      assert.ok(
        !transformedCode.includes("typia.createAssert<"),
        "typia.createAssert<T>() calls should be transformed away"
      );
      // Should have typia's internal validation imports
      assert.ok(
        transformedCode.includes("__typia_transform__"),
        "Should contain typia internal imports"
      );
    });

    test("hoistRegex: false does not add __regex_ variables", () => {
      const fileName = "test/test.temp.ts";
      const input = `
function checkNumber(n: number): number {
  return n;
}`;
      const transformer = createFullContextTransformer(fileName, input, {
        reusableValidators: true,
        hoistRegex: false
      });
      const transformedCode = transformer.transform(fileName, "typia");

      // Should complete without error
      assert.ok(transformedCode.length > 0, "Should produce output");
      // Should NOT have hoisted regex variables
      assert.ok(
        !transformedCode.includes("const __regex_"),
        "Should not hoist regex when hoistRegex is false"
      );
    });

    test("reusableValidators: false generates inline validation", () => {
      const fileName = "test/test.temp.ts";
      const input = `
function checkString(s: string): string {
  return s;
}`;
      const transformer = createFullContextTransformer(fileName, input, { reusableValidators: false });
      const transformedCode = transformer.transform(fileName, "typia");

      // Should not have __typical_assert_ variables (those are for reusable mode)
      assert.ok(
        !transformedCode.includes("const __typical_assert_"),
        "Should not have reusable validator variable declarations"
      );
      // Should still have typia's validation logic
      assert.ok(
        transformedCode.includes("__typia_transform__"),
        "Should contain typia validation"
      );
    });

    test("validateFunctions: false skips all function validation", () => {
      const fileName = "test/test.temp.ts";
      const input = `
function noValidation(n: number): number {
  return n;
}`;
      const transformer = createFullContextTransformer(fileName, input, {
        reusableValidators: true,
        validateFunctions: false
      });
      const transformedCode = transformer.transform(fileName, "typia");

      // With validateFunctions: false, no typia calls should be generated for functions
      // So the output should not contain __typical_assert_ or typia validation imports
      assert.ok(
        !transformedCode.includes("__typical_assert_"),
        "Should not have validators when validateFunctions is false"
      );
      assert.ok(
        !transformedCode.includes("__typia_transform__"),
        "Should not have typia imports when validateFunctions is false"
      );
    });

    test("multiple primitive parameters all get validated", () => {
      const fileName = "test/test.temp.ts";
      const input = `
function multiParam(a: string, b: number, c: boolean): string {
  return a;
}`;
      const transformer = createFullContextTransformer(fileName, input, { reusableValidators: true });
      const transformedCode = transformer.transform(fileName, "typia");

      // Should have typia validation for all three types
      assert.ok(
        transformedCode.includes("__typia_transform__"),
        "Should contain typia validation"
      );
      // Should have validators for string, number, boolean
      assert.ok(
        transformedCode.includes("__typical_assert_string") &&
        transformedCode.includes("__typical_assert_number") &&
        transformedCode.includes("__typical_assert_boolean"),
        "Should have validators for all primitive types"
      );
    });

    test("interface types are fully transformed by typia", () => {
      const fileName = "test/test.temp.ts";
      const input = `
interface User {
  name: string;
  age: number;
}
function validateUser(user: User): User {
  return user;
}`;
      const transformer = createFullContextTransformer(fileName, input, { reusableValidators: true });
      const transformedCode = transformer.transform(fileName, "typia");

      // typia.createAssert<T>() syntax should be expanded
      assert.ok(
        !transformedCode.includes("typia.createAssert<"),
        "typia.createAssert<T>() should be transformed"
      );
      // Should contain property validation for User
      assert.ok(
        transformedCode.includes('"string" === typeof input.name') ||
        transformedCode.includes("input.name"),
        "Should validate name property"
      );
      assert.ok(
        transformedCode.includes('"number" === typeof input.age') ||
        transformedCode.includes("input.age"),
        "Should validate age property"
      );
    });

    test("array types are transformed by typia", () => {
      const fileName = "test/test.temp.ts";
      const input = `
function processNumbers(nums: number[]): number[] {
  return nums;
}`;
      const transformer = createFullContextTransformer(fileName, input, { reusableValidators: true });
      const transformedCode = transformer.transform(fileName, "typia");

      // typia.createAssert<T>() should be expanded
      assert.ok(
        !transformedCode.includes("typia.createAssert<"),
        "typia.createAssert<T>() should be transformed"
      );
      // Should contain array check logic
      assert.ok(
        transformedCode.includes("Array.isArray"),
        "Should contain Array.isArray check"
      );
    });
  });
});
