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
const __typical_assert_0 = typia.createAssert<string>();
function greet(name: string): string { __typical_assert_0(name); return __typical_assert_0("Hello " + name); }`,
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
      notExpectedPatterns: [
        `JSON.stringify`
      ]
    },
    {
      name: "JSON.parse transformation",
      input: `
function parseData(jsonStr: string): { id: number, name: string } {
  return JSON.parse(jsonStr);
}`,
      expected: `import typia from "typia";
const __typical_assert_0 = typia.createAssert<string>();
const __typical_assert_1 = typia.createAssert<{
    id: number;
    name: string;
}>();
const __typical_parse_0 = typia.json.createAssertParse<{
    id: number;
    name: string;
}>();
function parseData(jsonStr: string): {
    id: number;
    name: string;
} {
    __typical_assert_0(jsonStr);
    return __typical_assert_1(__typical_parse_0(jsonStr));
}`
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
}`
    },
    {
      name: "arrow functions",
      input: `
const multiply = (a: number, b: number): number => {
  return a * b;
};`,
      expected: `import typia from "typia";
const __typical_assert_0 = typia.createAssert<number>();
const multiply = (a: number, b: number): number => {
    __typical_assert_0(a);
    __typical_assert_0(b);
    return __typical_assert_0(a * b);
};`
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
const __typical_assert_0 = typia.createAssert<User>();
const __typical_assert_1 = typia.createAssert<{ id: number; name: string; email?: string; }>();
const __typical_assert_2 = typia.createAssert<{ id: string; name: string; email?: string; }>();
interface User {
    id: number;
    name: string;
    email?: string;
}
function processUser(user: User): User {
    __typical_assert_0(user);
    return __typical_assert_0({ ...user, id: user.id + 1 });
}
function processUserLike(user: User) {
    __typical_assert_0(user);
    return __typical_assert_1({ ...user, id: user.id + 1 });
}
function processUserStringId(user: User) {
    __typical_assert_0(user);
    return __typical_assert_2({ ...user, id: user.id + '-1' });
}`
    },
//     {
//       name: "excluded files should not be transformed",
//       fileName: "node_modules/some-lib/index.ts",
//       input: `
// function simpleFunction(x: any) {
//   return x;
// }`,
//       expectedPatterns: [],
//       notExpectedPatterns: [
//         /import typia from "typia"/
//       ]
//     }
  ];

  testCases.forEach(({ name, input, expected, expectedPatterns, notExpectedPatterns }) => {
    test(name, () => {

      const fileName = 'test/test.temp.ts'
      writeFileSync(fileName, input);

      const transformer = new TypicalTransformer();

      // const sourceFile = transformer.createSourceFile(fileName, input);

      const transformedCode = transformer.transform(fileName, "basic");

      // console.log("Transformed Code:\n", transformedCode);

      if (expected !== undefined) {
        assert.equal(transformedCode.trim(), expected.trim());
      }

      // Check expected patterns
      if (expectedPatterns) {
        expectedPatterns.forEach(pattern => {
          if (typeof pattern === "string") {
            if (!transformedCode.includes(pattern)) {
              assert.fail(`Expected pattern ${pattern} not found in transformed code`);
            }
          } else {
            assert.match(transformedCode, pattern, `Expected pattern ${pattern} not found in transformed code`);
          }
        });
      }

      // Check patterns that should not be present
      if (notExpectedPatterns) {
        notExpectedPatterns.forEach(pattern => {
          if (typeof pattern === "string") {
            if (transformedCode.includes(pattern)) {
              assert.fail(`Unexpected pattern ${pattern} found in transformed code`);
            }
          } else {
            assert.doesNotMatch(transformedCode, pattern, `Unexpected pattern ${pattern} found in transformed code`);
          }
        });
      }
    });
  });
});
