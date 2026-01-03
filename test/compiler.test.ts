/**
 * Comprehensive tests for the Typical compiler.
 *
 * Uses transformSource to test standalone TypeScript snippets without
 * needing to create files on disk.
 */

import { test, describe, after, before } from 'node:test'
import assert from 'node:assert'
import { TypicalCompiler } from '@elliots/typical-compiler'

let compiler: TypicalCompiler

before(async () => {
  compiler = new TypicalCompiler()
  await compiler.start()
})

after(async () => {
  await compiler.close()
})

/**
 * Helper to transform source and check for expected patterns.
 */
async function transformAndCheck(source: string, expectedPatterns: (string | RegExp)[], notExpectedPatterns: (string | RegExp)[] = []): Promise<string> {
  const result = await compiler.transformSource('test.ts', source)

  for (const pattern of expectedPatterns) {
    if (typeof pattern === 'string') {
      assert.ok(result.code.includes(pattern), `Expected output to contain: ${pattern}\n\nOutput:\n${result.code}`)
    } else {
      assert.ok(pattern.test(result.code), `Expected output to match: ${pattern}\n\nOutput:\n${result.code}`)
    }
  }

  for (const pattern of notExpectedPatterns) {
    if (typeof pattern === 'string') {
      assert.ok(!result.code.includes(pattern), `Expected output NOT to contain: ${pattern}\n\nOutput:\n${result.code}`)
    } else {
      assert.ok(!pattern.test(result.code), `Expected output NOT to match: ${pattern}\n\nOutput:\n${result.code}`)
    }
  }

  return result.code
}

// =============================================================================
// PRIMITIVE TYPES
// =============================================================================

void describe('Primitive Types', () => {
  void test('string parameter', async () => {
    await transformAndCheck(
      `function greet(name: string): string {
        return "Hello " + name;
      }`,
      ['"string" === typeof', 'name'],
    )
  })

  void test('number parameter', async () => {
    await transformAndCheck(
      `function double(n: number): number {
        return n * 2;
      }`,
      ['"number" === typeof'],
    )
  })

  void test('boolean parameter', async () => {
    await transformAndCheck(
      `function negate(value: boolean): boolean {
        return !value;
      }`,
      ['"boolean" === typeof'],
    )
  })

  void test('bigint parameter', async () => {
    await transformAndCheck(
      `function addBigInt(a: bigint, b: bigint): bigint {
        return a + b;
      }`,
      ['"bigint" === typeof'],
    )
  })

  void test('symbol parameter', async () => {
    // Note: symbol type is not validated at runtime (returns _v directly)
    // This is a known limitation - symbols can't be easily validated
    await transformAndCheck(
      `function getSymbolDesc(s: symbol): string | undefined {
        return s.description;
      }`,
      ['return _v'], // Symbol params just pass through
    )
  })
})

// =============================================================================
// OBJECT TYPES
// =============================================================================

void describe('Object Types', () => {
  void test('interface parameter', async () => {
    await transformAndCheck(
      `interface User {
        name: string;
        age: number;
      }
      function processUser(user: User): string {
        return user.name;
      }`,
      ['object', '_v.name', '_v.age', '"string" === typeof', '"number" === typeof'],
    )
  })

  void test('type alias for object', async () => {
    await transformAndCheck(
      `type Point = {
        x: number;
        y: number;
      };
      function getDistance(p: Point): number {
        return Math.sqrt(p.x * p.x + p.y * p.y);
      }`,
      ['_v.x', '_v.y'],
    )
  })

  void test('nested objects', async () => {
    await transformAndCheck(
      `interface Address {
        street: string;
        city: string;
      }
      interface Person {
        name: string;
        address: Address;
      }
      function getCity(person: Person): string {
        return person.address.city;
      }`,
      ['_v.name', '_v.address', 'street', 'city'],
    )
  })

  void test('optional properties', async () => {
    await transformAndCheck(
      `interface Config {
        host: string;
        port?: number;
      }
      function connect(config: Config): void {}`,
      ['_v.host', 'undefined'],
    )
  })

  void test('readonly properties', async () => {
    await transformAndCheck(
      `interface Point {
        readonly x: number;
        readonly y: number;
      }
      function processPoint(p: Point): number {
        return p.x + p.y;
      }`,
      ['_v.x', '_v.y'],
    )
  })
})

// =============================================================================
// ARRAY AND TUPLE TYPES
// =============================================================================

void describe('Array and Tuple Types', () => {
  void test('array of primitives', async () => {
    await transformAndCheck(
      `function sum(numbers: number[]): number {
        return numbers.reduce((a, b) => a + b, 0);
      }`,
      ['Array.isArray', '"number" === typeof'],
    )
  })

  void test('array of objects', async () => {
    await transformAndCheck(
      `interface Item { id: number; }
      function getIds(items: Item[]): number[] {
        return items.map(i => i.id);
      }`,
      ['Array.isArray', '.id'], // Uses _e0.id for element validation
    )
  })

  void test('tuple type', async () => {
    await transformAndCheck(
      `function getCoords(point: [number, number]): number {
        return point[0] + point[1];
      }`,
      ['Array.isArray', '[0]', '[1]', 'length'],
    )
  })

  void test('tuple with different types', async () => {
    await transformAndCheck(
      `function processPair(pair: [string, number]): string {
        return pair[0] + pair[1];
      }`,
      ['Array.isArray', '"string" === typeof', '"number" === typeof'],
    )
  })

  void test('readonly array', async () => {
    await transformAndCheck(
      `function first(items: readonly string[]): string {
        return items[0];
      }`,
      ['Array.isArray'],
    )
  })
})

// =============================================================================
// UNION TYPES
// =============================================================================

void describe('Union Types', () => {
  void test('primitive union', async () => {
    await transformAndCheck(
      `function processValue(value: string | number): string {
        return String(value);
      }`,
      ['||', '"string" === typeof', '"number" === typeof'],
    )
  })

  void test('union with null', async () => {
    await transformAndCheck(
      `function maybeString(value: string | null): string {
        return value ?? "default";
      }`,
      ['null', '"string" === typeof'],
    )
  })

  void test('union with undefined', async () => {
    await transformAndCheck(
      `function optional(value: string | undefined): string {
        return value ?? "default";
      }`,
      ['undefined', '"string" === typeof'],
    )
  })

  void test('discriminated union', async () => {
    await transformAndCheck(
      `interface Circle { kind: "circle"; radius: number; }
      interface Square { kind: "square"; size: number; }
      type Shape = Circle | Square;
      function area(shape: Shape): number {
        return shape.kind === "circle" ? Math.PI * shape.radius ** 2 : shape.size ** 2;
      }`,
      ['||', 'object'],
    )
  })

  void test('union of literal types', async () => {
    await transformAndCheck(`function direction(dir: "north" | "south" | "east" | "west"): void {}`, ['"north"', '"south"', '"east"', '"west"', '||'])
  })
})

// =============================================================================
// LITERAL TYPES
// =============================================================================

void describe('Literal Types', () => {
  void test('string literal', async () => {
    await transformAndCheck(`function sayHello(greeting: "hello"): void {}`, ['"hello"'])
  })

  void test('number literal', async () => {
    await transformAndCheck(`function checkAnswer(answer: 42): void {}`, ['42'])
  })

  void test('boolean literal', async () => {
    await transformAndCheck(`function mustBeTrue(value: true): void {}`, ['true'])
  })

  void test('template literal type', async () => {
    await transformAndCheck(
      `type Email = \`\${string}@\${string}.\${string}\`;
      function sendEmail(email: Email): void {}`,
      ['@', '.', '.test('], // Should have regex test for email pattern
    )
  })
})

// =============================================================================
// ENUM TYPES
// =============================================================================

void describe('Enum Types', () => {
  void test('numeric enum', async () => {
    await transformAndCheck(
      `enum Direction {
        Up,
        Down,
        Left,
        Right
      }
      function move(dir: Direction): void {}`,
      ['0', '1', '2', '3'], // Numeric enum values
    )
  })

  void test('string enum', async () => {
    await transformAndCheck(
      `enum Color {
        Red = "red",
        Green = "green",
        Blue = "blue"
      }
      function paint(color: Color): void {}`,
      ['"red"', '"green"', '"blue"'],
    )
  })

  void test('const enum', async () => {
    await transformAndCheck(
      `const enum Size {
        Small = 1,
        Medium = 2,
        Large = 3
      }
      function setSize(size: Size): void {}`,
      ['1', '2', '3'],
    )
  })
})

// =============================================================================
// CLASS TYPES
// =============================================================================

void describe('Class Types', () => {
  void test('class as parameter type', async () => {
    await transformAndCheck(
      `class User {
        constructor(public name: string, public age: number) {}
      }
      function processUser(user: User): string {
        return user.name;
      }`,
      ['instanceof User', 'User instance'], // Should use instanceof check
    )
  })

  void test('class with private fields', async () => {
    await transformAndCheck(
      `class Account {
        private balance: number = 0;
        public id: string;
        constructor(id: string) {
          this.id = id;
        }
      }
      function checkAccount(account: Account): string {
        return account.id;
      }`,
      ['instanceof Account', 'Account instance'], // Should use instanceof check
    )
  })

  void test('abstract class', async () => {
    await transformAndCheck(
      `abstract class Animal {
        abstract name: string;
      }
      function getName(animal: Animal): string {
        return animal.name;
      }`,
      ['instanceof Animal', 'Animal instance'], // Should use instanceof check
    )
  })

  void test('global class - URL', async () => {
    // URL is a global class available in Node.js
    await transformAndCheck(
      `function getHost(url: URL): string {
        return url.host;
      }`,
      ['instanceof URL', 'URL instance'], // Should use instanceof for global class
    )
  })

  void test('global class - Request', async () => {
    // Request is a global class available in Node.js (fetch API)
    await transformAndCheck(
      `function getMethod(req: Request): string {
        return req.method;
      }`,
      ['instanceof Request', 'Request instance'], // Should use instanceof for global class
    )
  })

  void test('global class - Response', async () => {
    // Response is a global class available in Node.js (fetch API)
    await transformAndCheck(
      `async function getBody(res: Response): Promise<string> {
        return res.text();
      }`,
      ['instanceof Response', 'Response instance'], // Should use instanceof for global class
    )
  })

  void test('interface with construct signature - no instanceof', async () => {
    // An interface with a construct signature is NOT a class - there's no runtime value
    // to use with instanceof. Should fall back to duck typing.
    await transformAndCheck(
      `interface Constructable {
        new(name: string): { name: string };
      }
      function create(Ctor: Constructable): { name: string } {
        return new Ctor("test");
      }`,
      ['typeof _v', 'object'], // Should use duck typing, not instanceof
      ['instanceof Constructable'], // Should NOT use instanceof
    )
  })

  void test('type-only import class - skips validation', async () => {
    // With 'import type', the type checker can't determine it's a class
    // (no SymbolFlagsClass, no ValueDeclaration, no accessible construct signatures).
    // This only affects CLASS imports - regular interface/type imports still get duck-typed.
    // Use a value import if you need instanceof validation for classes.
    await transformAndCheck(
      `import type { Readable } from "stream";
      function processStream(stream: Readable): void {
        stream.read();
      }`,
      ['function processStream'], // Function exists but no param validation
      ['instanceof Readable'], // No instanceof because type-only import
    )
  })
})

// =============================================================================
// GENERIC TYPES
// =============================================================================

void describe('Generic Types', () => {
  void test('generic function - type parameter not validated', async () => {
    // Generic type parameters can't be fully validated at runtime
    // The compiler may still wrap them but without type-specific checks
    const code = await transformAndCheck(
      `function identity<T>(value: T): T {
        return value;
      }`,
      ['return _v'], // Just returns the value without type-specific validation
    )
    // Should not have specific type checks like "string" or "number"
    assert.ok(!code.includes('"string" === typeof'), 'Should not check for specific types')
    assert.ok(!code.includes('"number" === typeof'), 'Should not check for specific types')
  })

  void test('generic with constraint', async () => {
    await transformAndCheck(
      `function getLength<T extends { length: number }>(value: T): number {
        return value.length;
      }`,
      ['length'],
    )
  })

  void test('generic array', async () => {
    await transformAndCheck(
      `function first<T>(items: T[]): T | undefined {
        return items[0];
      }`,
      ['Array.isArray'],
    )
  })
})

// =============================================================================
// UTILITY TYPES
// =============================================================================

void describe('Utility Types', () => {
  void test('Partial<T>', async () => {
    await transformAndCheck(
      `interface User {
        name: string;
        age: number;
      }
      function updateUser(updates: Partial<User>): void {}`,
      ['undefined', 'object'],
    )
  })

  void test('Required<T>', async () => {
    await transformAndCheck(
      `interface Config {
        host?: string;
        port?: number;
      }
      function requireConfig(config: Required<Config>): void {}`,
      ['host', 'port'],
    )
  })

  void test('Pick<T, K>', async () => {
    await transformAndCheck(
      `interface User {
        id: number;
        name: string;
        email: string;
      }
      function getName(user: Pick<User, "name">): string {
        return user.name;
      }`,
      ['name', '_v.name'], // Should validate picked property
    )
  })

  void test('Omit<T, K>', async () => {
    await transformAndCheck(
      `interface User {
        id: number;
        name: string;
        password: string;
      }
      function safeUser(user: Omit<User, "password">): void {}`,
      ['_v.id', '_v.name'], // Should validate non-omitted properties
      // Note: "password" appears in the interface declaration, not in validation
    )
  })

  void test('Record<K, V>', async () => {
    await transformAndCheck(`function processScores(scores: Record<string, number>): void {}`, ['object'])
  })
})

// =============================================================================
// INTERSECTION TYPES
// =============================================================================

void describe('Intersection Types', () => {
  void test('simple intersection', async () => {
    await transformAndCheck(
      `interface Named { name: string; }
      interface Aged { age: number; }
      function processPerson(person: Named & Aged): void {}`,
      ['name', 'age'],
    )
  })

  void test('intersection with type alias', async () => {
    await transformAndCheck(
      `type Named = { name: string };
      type Timestamped = { createdAt: Date };
      function processRecord(record: Named & Timestamped): void {}`,
      ['name', 'createdAt'],
    )
  })
})

// =============================================================================
// SPECIAL TYPES
// =============================================================================

void describe('Special Types', () => {
  void test('any type - no validation', async () => {
    const code = await transformAndCheck(
      `function processAny(value: any): any {
        return value;
      }`,
      [],
    )
    // Should not validate 'any' type
    assert.ok(!code.includes('_v'), 'Should not validate any type')
  })

  void test('unknown type - no validation', async () => {
    const code = await transformAndCheck(
      `function processUnknown(value: unknown): unknown {
        return value;
      }`,
      [],
    )
    // Should not validate 'unknown' type
    assert.ok(!code.includes('_v'), 'Should not validate unknown type')
  })

  void test('never type in union (filtered out)', async () => {
    await transformAndCheck(
      `function processValue(value: string | never): string {
        return value;
      }`,
      ['"string" === typeof'],
    )
  })

  void test('void return type - no return validation', async () => {
    await transformAndCheck(
      `function logMessage(msg: string): void {
        console.log(msg);
      }`,
      ['"string" === typeof'], // Parameter validated, return not
    )
  })
})

// =============================================================================
// FUNCTION TYPES
// =============================================================================

void describe('Function Types', () => {
  void test('function returning Promise', async () => {
    // For async functions, the return value is validated directly
    // (not wrapped in .then since the function already awaits)
    await transformAndCheck(
      `interface User { name: string; }
      async function fetchUser(id: number): Promise<User> {
        return { name: "test" };
      }`,
      ['"number" === typeof', '_v.name', 'return value'],
    )
  })

  void test('sync function returning Promise', async () => {
    await transformAndCheck(
      `interface User { name: string; }
      function fetchUserLater(id: number): Promise<User> {
        return Promise.resolve({ name: "test" });
      }`,
      ['.then'],
    )
  })

  void test('arrow function', async () => {
    await transformAndCheck(
      `const add = (a: number, b: number): number => {
        return a + b;
      };`,
      ['"number" === typeof'],
    )
  })

  void test('method in object literal', async () => {
    await transformAndCheck(
      `const obj = {
        greet(name: string): string {
          return "Hello " + name;
        }
      };`,
      ['"string" === typeof'],
    )
  })
})

// =============================================================================
// CAST EXPRESSIONS
// =============================================================================

void describe('Cast Expressions (as Type)', () => {
  void test('cast to interface', async () => {
    await transformAndCheck(
      `interface User { name: string; }
      const data: unknown = { name: "test" };
      const user = data as User;`,
      ['object', 'name'],
    )
  })

  void test('cast in function', async () => {
    await transformAndCheck(
      `interface Config { host: string; }
      function parseConfig(json: string): Config {
        return JSON.parse(json) as Config;
      }`,
      ['object', 'host'],
    )
  })
})

// =============================================================================
// EDGE CASES
// =============================================================================

void describe('Edge Cases', () => {
  void test('empty interface', async () => {
    await transformAndCheck(
      `interface Empty {}
      function processEmpty(obj: Empty): void {}`,
      ['object'],
    )
  })

  void test('index signature', async () => {
    await transformAndCheck(
      `interface StringMap {
        [key: string]: string;
      }
      function processMap(map: StringMap): void {}`,
      ['object'],
    )
  })

  void test('function with rest parameters', async () => {
    await transformAndCheck(
      `function sum(...numbers: number[]): number {
        return numbers.reduce((a, b) => a + b, 0);
      }`,
      ['Array.isArray', '"number" === typeof'],
    )
  })

  void test('function with default parameter', async () => {
    await transformAndCheck(
      `function greet(name: string = "World"): string {
        return "Hello " + name;
      }`,
      ['"string" === typeof'],
    )
  })

  void test('recursive type', async () => {
    await transformAndCheck(
      `interface TreeNode {
        value: number;
        children: TreeNode[];
      }
      function traverseTree(node: TreeNode): void {}`,
      ['value', 'children', 'Array.isArray'],
    )
  })
})
