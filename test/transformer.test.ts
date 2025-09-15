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
//     {
//       name: "JSON.parse transformation",
//       fileName: "test.ts",
//       input: `
// function parseData(jsonStr: string): { id: number, name: string } {
//   return JSON.parse(jsonStr) as { id: number, name: string };
// }`,
//       expectedPatterns: [
//         /import typia from "typia"/,
//         /typia\.json\.assertParse/
//       ],
//       notExpectedPatterns: [
//         /JSON\.parse/
//       ]
//     },
//     {
//       name: "return type validation",
//       fileName: "test.ts",
//       input: `
// function getData(): { id: number, name: string } {
//   const data = { id: 1, name: "test" };
//   return data;
// }`,
//       expectedPatterns: [
//         /import typia from "typia"/,
//         /return typia\.assert/
//       ],
//       notExpectedPatterns: []
//     },
//     {
//       name: "arrow functions",
//       fileName: "test.ts",
//       input: `
// const multiply = (a: number, b: number): number => {
//   return a * b;
// };`,
//       expectedPatterns: [
//         /import typia from "typia"/,
//         /typia\.assert.*a/,
//         /typia\.assert.*b/,
//         /return typia\.assert/
//       ],
//       notExpectedPatterns: []
//     },
//     {
//       name: "complex types",
//       fileName: "test.ts",
//       input: `
// interface User {
//   id: number;
//   name: string;
//   email?: string;
// }

// function processUser(user: User): User {
//   return { ...user, id: user.id + 1 };
// }`,
//       expectedPatterns: [
//         /import typia from "typia"/,
//         /typia\.assert.*user/,
//         /return typia\.assert/
//       ],
//       notExpectedPatterns: []
//     },
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

      console.log("Transformed Code:\n", transformedCode);

      if (expected) {
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
