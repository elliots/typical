import { test, describe } from "node:test";
import assert from "node:assert";
import ts from "typescript";
import { TypicalTransformer } from "../src/transformer.js";
import { assertEquals } from "typia";
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
  };

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
});
