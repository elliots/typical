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
    // Symbol type doesn't get parameter validation (skipped)
    // but return value is still processed
    await transformAndCheck(
      `function getSymbolDesc(s: symbol): string | undefined {
        return s.description;
      }`,
      ['function getSymbolDesc'], // Function exists
    )
  })
})

// =============================================================================
// OBJECT TYPES
// =============================================================================

void describe('Object Types', () => {
  void test('interface parameter', async () => {
    // Inline validation uses the parameter name directly
    await transformAndCheck(
      `interface User {
        name: string;
        age: number;
      }
      function processUser(user: User): string {
        return user.name;
      }`,
      ['object', 'user.name', 'user.age', '"string" === typeof', '"number" === typeof'],
    )
  })

  void test('type alias for object', async () => {
    // Inline validation uses the parameter name directly
    await transformAndCheck(
      `type Point = {
        x: number;
        y: number;
      };
      function getDistance(p: Point): number {
        return Math.sqrt(p.x * p.x + p.y * p.y);
      }`,
      ['p.x', 'p.y'],
    )
  })

  void test('nested objects', async () => {
    // Inline validation uses the parameter name directly
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
      ['person.name', 'person.address', 'street', 'city'],
    )
  })

  void test('optional properties', async () => {
    // Inline validation uses the parameter name directly
    await transformAndCheck(
      `interface Config {
        host: string;
        port?: number;
      }
      function connect(config: Config): void {}`,
      ['config.host', 'undefined'],
    )
  })

  void test('readonly properties', async () => {
    // Inline validation uses the parameter name directly
    await transformAndCheck(
      `interface Point {
        readonly x: number;
        readonly y: number;
      }
      function processPoint(p: Point): number {
        return p.x + p.y;
      }`,
      ['p.x', 'p.y'],
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
  void test('primitive union - if-else chain', async () => {
    // Union validation uses if-else chain for early bail-out
    const code = await transformAndCheck(
      `function processValue(value: string | number): string {
        return String(value);
      }`,
      ['"string" === typeof', '"number" === typeof', 'if (', 'else if (', 'else throw'],
    )
    // Verify it's using if-else chain, not combined OR for the union check
    assert.ok(code.includes('if ("string" === typeof value)'), 'Should use if-else chain')
    assert.ok(code.includes('else if ("number" === typeof value)'), 'Should have else if')
  })

  void test('union with null', async () => {
    await transformAndCheck(
      `function maybeString(value: string | null): string {
        return value ?? "default";
      }`,
      ['null === value', '"string" === typeof', 'if (', 'else if ('],
    )
  })

  void test('union with undefined', async () => {
    await transformAndCheck(
      `function optional(value: string | undefined): string {
        return value ?? "default";
      }`,
      ['undefined === value', '"string" === typeof', 'if (', 'else if ('],
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
      ['if (', 'else if (', 'object'],
    )
  })

  void test('union of literal types', async () => {
    await transformAndCheck(`function direction(dir: "north" | "south" | "east" | "west"): void {}`, ['"north"', '"south"', '"east"', '"west"', 'if (', 'else if ('])
  })

  void test('union of literal types - error message shows actual value', async () => {
    // For unions of literals, the error message should show the actual value received,
    // not just "got string" which isn't helpful
    const code = await transformAndCheck(`function setLanguage(lang: "en-AU" | "en-US" | "fr-FR"): void {}`, ['"en-AU"', '"en-US"', '"fr-FR"'])
    // Should show the actual value in error message, not typeof
    assert.ok(code.includes('"\'" + lang + "\'"') || code.includes("' + lang + '"), `Error message should show actual string value, not typeof. Code:\n${code}`)
    assert.ok(!code.includes('got " + typeof lang'), `Should NOT use typeof for literal union error. Code:\n${code}`)
  })

  void test('mixed union - literal, primitive, and object', async () => {
    // Test union with string literal, number, and object type
    const code = await transformAndCheck(
      `interface Config { port: number; }
      function processConfig(value: "default" | number | Config): void {}`,
      ['"default" === value', '"number" === typeof value', '"object" === typeof value', 'if (', 'else if ('],
    )
    // Verify the if-else chain structure
    assert.ok(code.includes('if ('), 'Should have if')
    assert.ok(code.includes('else if ('), 'Should have else if')
    assert.ok(code.includes('else throw'), 'Should have else throw')
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
    // Generic type parameters can't be validated at runtime
    // The compiler skips validation entirely for generic types (doesn't emit anything)
    const result = await compiler.transformSource(
      'test.ts',
      `
      function identity<T>(value: T): T {
        return value;
      }
    `,
    )
    // Should not have any type checks since T is a type parameter
    assert.ok(!result.code.includes('throw new TypeError'), 'Should not generate validation for type parameter')
    assert.ok(!result.code.includes('"string" === typeof'), 'Should not check for specific types')
    assert.ok(!result.code.includes('"number" === typeof'), 'Should not check for specific types')
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
    // Inline validation uses the parameter name directly
    await transformAndCheck(
      `interface User {
        id: number;
        name: string;
        email: string;
      }
      function getName(user: Pick<User, "name">): string {
        return user.name;
      }`,
      ['name', 'user.name'], // Should validate picked property using param name
    )
  })

  void test('Omit<T, K>', async () => {
    // Inline validation uses the parameter name directly
    await transformAndCheck(
      `interface User {
        id: number;
        name: string;
        password: string;
      }
      function safeUser(user: Omit<User, "password">): void {}`,
      ['user.id', 'user.name'], // Should validate non-omitted properties using param name
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

  void test('as unknown as T - skips validation', async () => {
    // When user explicitly casts through unknown, they're intentionally bypassing type safety
    const code = await transformAndCheck(
      `interface User { name: string; }
      const data: any = { wrong: "type" };
      const user = data as unknown as User;`,
      ['as unknown as User'], // Original code preserved
      ['throw new TypeError'], // No validation generated
    )
    assert.ok(!code.includes('Expected'), 'Should not validate through as unknown')
  })

  void test('as any as T - skips validation', async () => {
    // When user explicitly casts through any, they're intentionally bypassing type safety
    const code = await transformAndCheck(
      `interface Config { host: string; }
      const data: unknown = {};
      const config = data as any as Config;`,
      ['as any as Config'], // Original code preserved
      ['throw new TypeError'], // No validation generated
    )
    assert.ok(!code.includes('Expected'), 'Should not validate through as any')
  })

  void test('regular cast still validates', async () => {
    // Normal casts should still be validated
    await transformAndCheck(
      `interface User { name: string; }
      const data: unknown = { name: "test" };
      const user = data as User;`,
      ['throw new TypeError', 'Expected'],
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

// =============================================================================
// SKIP REDUNDANT VALIDATION
// =============================================================================

void describe('Skip Redundant Validation', () => {
  void test('skip identity return - same type', async () => {
    // When returning a parameter directly, skip return validation
    await transformAndCheck(
      `function identity(x: string): string {
        return x;
      }`,
      ['"string" === typeof', '/* already valid */'],
      ['"return value"'], // No return validation
    )
  })

  void test('skip return - subtype to supertype (string to nullable)', async () => {
    // string is assignable to string | null, so skip validation
    await transformAndCheck(
      `function toNullable(x: string): string | null {
        return x;
      }`,
      ['"string" === typeof', '/* already valid */'],
      ['"return value"'],
    )
  })

  void test('must validate - supertype to subtype', async () => {
    // string | null is NOT assignable to string, must validate
    await transformAndCheck(
      `function toSubtype(x: string | null): string {
        return x;
      }`,
      ['"return value"'],
      ['/* already valid */'],
    )
  })

  void test('skip return - property of validated object', async () => {
    // user.name is string because user is validated as User
    await transformAndCheck(
      `interface User { name: string; age: number; }
      function getName(user: User): string {
        return user.name;
      }`,
      ['/* already valid */'],
      ['"return value"'],
    )
  })

  void test('must validate - variable reassigned', async () => {
    // x was reassigned, so it must be re-validated
    await transformAndCheck(
      `function reassigned(x: string): string {
        x = "new";
        return x;
      }`,
      ['"string" === typeof', '"return value"'],
      ['/* already valid */'],
    )
  })

  void test('skip return - primitive passed to function (copied)', async () => {
    // Primitives are copied when passed to functions, so they stay validated
    await transformAndCheck(
      `function passedToFn(x: string): string {
        console.log(x);
        return x;
      }`,
      ['"string" === typeof', '/* already valid */'],
      ['"return value"'],
    )
  })

  void test('must validate - object passed to function (could mutate)', async () => {
    // Objects can be mutated via reference when passed to functions
    await transformAndCheck(
      `interface User { name: string; }
      function logUser(u: User): void {}
      function objPassed(user: User): User {
        logUser(user);
        return user;
      }`,
      ['"return value"'],
      ['/* already valid */'],
    )
  })

  void test('skip return - object property is primitive passed to function', async () => {
    // Passing user.name (a primitive) doesn't dirty user
    await transformAndCheck(
      `interface User { name: string; }
      function objPropPrimitive(user: User): User {
        console.log(user.name);
        return user;
      }`,
      ['/* already valid */'],
      ['"return value"'],
    )
  })

  void test('skip return - array element property', async () => {
    // users[0].name is validated as part of users: User[]
    await transformAndCheck(
      `interface User { name: string; age: number; }
      function getFirstName(users: User[]): string {
        return users[0].name;
      }`,
      ['/* already valid */'],
      ['"return value"'],
    )
  })

  void test('must validate - compound assignment operator', async () => {
    // x += changes the variable, so it needs re-validation
    await transformAndCheck(
      `function compound(x: number): number {
        x += 1;
        return x;
      }`,
      ['"number" === typeof', '"return value"'],
      ['/* already valid */'],
    )
  })

  void test('must validate - prefix increment', async () => {
    // ++x changes the variable
    await transformAndCheck(
      `function preIncrement(x: number): number {
        ++x;
        return x;
      }`,
      ['"number" === typeof', '"return value"'],
      ['/* already valid */'],
    )
  })

  void test('must validate - postfix decrement', async () => {
    // x-- changes the variable
    await transformAndCheck(
      `function postDecrement(x: number): number {
        x--;
        return x;
      }`,
      ['"number" === typeof', '"return value"'],
      ['/* already valid */'],
    )
  })
})

// =============================================================================
// JSON TRANSFORMATIONS
// =============================================================================

/**
 * Helper to transform, transpile, and execute code returning a result.
 * The source should export a function called `run` that takes input and returns JSON string.
 */
async function transformAndRun<T>(source: string, input: T): Promise<string> {
  const result = await compiler.transformSource('test.ts', source)

  // Transpile TypeScript to JavaScript
  const ts = await import('typescript')
  const transpiled = ts.default.transpileModule(result.code, {
    compilerOptions: {
      module: ts.default.ModuleKind.CommonJS,
      target: ts.default.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  })

  // Wrap in a function and execute
  const fn = new Function(
    'input',
    `
    ${transpiled.outputText}
    return run(input);
  `,
  )

  return fn(input) as string
}

void describe('JSON.stringify Transformations', () => {
  void test('strips extra properties from object', async () => {
    const source = `
      interface User { name: string; age: number }
      function run(input: any): string {
        return JSON.stringify(input as User);
      }
    `
    const input = { name: 'Alice', age: 30, password: 'secret', extra: true }
    const result = await transformAndRun(source, input)

    // Compare parsed results
    const parsed: Record<string, unknown> = JSON.parse(result)
    assert.strictEqual(parsed.password, undefined)
    assert.strictEqual(parsed.extra, undefined)
    assert.deepStrictEqual(parsed, { name: 'Alice', age: 30 })
  })

  void test('handles string escaping correctly', async () => {
    const source = `
      interface User { name: string; age: number }
      function run(input: any): string {
        return JSON.stringify(input as User);
      }
    `
    const input = { name: 'Al"ice\nBob\\Charlie\ttab', age: 30 }
    const result = await transformAndRun(source, input)

    // Must parse back to original values
    const parsed = JSON.parse(result)
    assert.strictEqual(parsed.name, input.name)
    assert.strictEqual(parsed.age, input.age)
  })

  void test('handles unicode correctly', async () => {
    const source = `
      interface User { name: string; age: number }
      function run(input: any): string {
        return JSON.stringify(input as User);
      }
    `
    const input = { name: '\u0000\u001f\u2028\u2029emoji:🎉', age: 30 }
    const result = await transformAndRun(source, input)

    const parsed = JSON.parse(result)
    assert.strictEqual(parsed.name, input.name)
  })

  void test('handles null values', async () => {
    const source = `
      interface Nullable { name: string | null; age: number }
      function run(input: any): string {
        return JSON.stringify(input as Nullable);
      }
    `
    const input = { name: null, age: 30 }
    const result = await transformAndRun(source, input)

    const parsed = JSON.parse(result)
    assert.deepStrictEqual(parsed, { name: null, age: 30 })
  })

  void test('handles undefined properties (omitted)', async () => {
    const source = `
      interface Opt { name?: string; age: number }
      function run(input: any): string {
        return JSON.stringify(input as Opt);
      }
    `
    const input = { age: 30 }
    const result = await transformAndRun(source, input)

    const parsed = JSON.parse(result)
    assert.deepStrictEqual(parsed, { age: 30 })
    assert.ok(!('name' in parsed))
  })

  void test('handles NaN (becomes null)', async () => {
    const source = `
      interface Nums { value: number }
      function run(input: any): string {
        return JSON.stringify(input as Nums);
      }
    `
    const input = { value: NaN }
    const result = await transformAndRun(source, input)

    const parsed = JSON.parse(result)
    assert.strictEqual(parsed.value, null)
  })

  void test('handles Infinity (becomes null)', async () => {
    const source = `
      interface Nums { value: number }
      function run(input: any): string {
        return JSON.stringify(input as Nums);
      }
    `
    const input = { value: Infinity }
    const result = await transformAndRun(source, input)
    assert.strictEqual(JSON.parse(result).value, null)

    const input2 = { value: -Infinity }
    const result2 = await transformAndRun(source, input2)
    assert.strictEqual(JSON.parse(result2).value, null)
  })

  void test('handles nested objects', async () => {
    const source = `
      interface Address { city: string }
      interface Person { name: string; address: Address }
      function run(input: any): string {
        return JSON.stringify(input as Person);
      }
    `
    const input = { name: 'Bob', address: { city: 'NYC', zip: '10001' }, extra: true }
    const result = await transformAndRun(source, input)

    const parsed = JSON.parse(result)
    assert.deepStrictEqual(parsed, { name: 'Bob', address: { city: 'NYC' } })
  })

  void test('handles arrays of objects', async () => {
    const source = `
      interface User { name: string; age: number }
      function run(input: any): string {
        return JSON.stringify(input as User[]);
      }
    `
    const input = [
      { name: 'A', age: 1, extra: 'x' },
      { name: 'B', age: 2 },
    ]
    const result = await transformAndRun(source, input)

    const parsed = JSON.parse(result)
    assert.deepStrictEqual(parsed, [
      { name: 'A', age: 1 },
      { name: 'B', age: 2 },
    ])
  })

  void test('handles Date objects (via toJSON)', async () => {
    const source = `
      interface Dated { date: Date }
      function run(input: any): string {
        return JSON.stringify(input as Dated);
      }
    `
    const d = new Date('2024-01-01T00:00:00.000Z')
    const input = { date: d }
    const result = await transformAndRun(source, input)

    const parsed = JSON.parse(result)
    assert.strictEqual(parsed.date, '2024-01-01T00:00:00.000Z')
  })

  void test('matches native JSON.stringify for basic object', async () => {
    const source = `
      interface User { name: string; age: number }
      function run(input: any): string {
        return JSON.stringify(input as User);
      }
    `
    const input = { name: 'Alice', age: 30 }
    const result = await transformAndRun(source, input)
    const native = JSON.stringify(input)

    // Both should produce identical output for objects with only typed properties
    assert.strictEqual(result, native)
  })
})

// =============================================================================
// DESTRUCTURED PARAMETERS
// =============================================================================

void describe('Destructured Parameters', () => {
  void test('object destructuring - validates individual properties', async () => {
    await transformAndCheck(
      `function processUser({ name, age }: { name: string; age: number }): string {
        return name + age;
      }`,
      ['"string" === typeof name', '"number" === typeof age'],
    )
  })

  void test('object destructuring with optional properties', async () => {
    await transformAndCheck(
      `function greet({ name, title }: { name: string; title?: string }): string {
        return (title ?? "") + name;
      }`,
      ['"string" === typeof name', 'undefined === title', '"string" === typeof title'],
    )
  })

  void test('object destructuring with union types', async () => {
    await transformAndCheck(
      `function quotePath({ ref, id }: { ref?: string | null; id?: unknown }): string {
        return ref ?? "/";
      }`,
      ['ref'], // Should have validation for ref
    )
  })

  void test('object destructuring with renamed properties', async () => {
    // When destructuring { originalName: newName }, we validate the local variable newName
    await transformAndCheck(
      `function processPoint({ x: xCoord, y: yCoord }: { x: number; y: number }): number {
        return xCoord + yCoord;
      }`,
      ['"number" === typeof xCoord', '"number" === typeof yCoord'],
    )
  })

  void test('object destructuring with default values', async () => {
    // Default values should still have their type validated
    await transformAndCheck(
      `function greet({ name = "World" }: { name?: string }): string {
        return "Hello " + name;
      }`,
      ['name'], // Should reference the name parameter
    )
  })

  void test('nested object destructuring', async () => {
    // Nested destructuring doesn't validate the deeply nested bindings directly as parameters,
    // but the return value is validated since city is returned
    await transformAndCheck(
      `function getCity({ address: { city } }: { address: { city: string } }): string {
        return city;
      }`,
      ['"string" === typeof', '"return value"'], // Return validation happens, not parameter validation for nested
    )
  })

  void test('array destructuring', async () => {
    await transformAndCheck(
      `function getFirst([first, second]: [string, number]): string {
        return first + second;
      }`,
      ['"string" === typeof first', '"number" === typeof second'],
    )
  })

  void test('mixed regular and destructured parameters', async () => {
    await transformAndCheck(
      `function process(prefix: string, { name, value }: { name: string; value: number }): string {
        return prefix + name + value;
      }`,
      ['"string" === typeof prefix', '"string" === typeof name', '"number" === typeof value'],
    )
  })
})

// =============================================================================
// CONST ASSERTIONS
// =============================================================================

void describe('Const Assertions', () => {
  void test('as const should not add validation', async () => {
    const result = await compiler.transformSource(
      'test.ts',
      `
      export const ClosedProjectStages = {
        Completed: 'COMPLETED',
        Lost: 'LOST',
        Cancelled: 'CANCELLED',
      } as const
    `,
    )
    // Should NOT have validation wrapper - const assertions are compile-time only
    assert.ok(!result.code.includes('throw new TypeError'), 'const assertion should not generate validation')
    assert.ok(result.code.includes('as const') || result.code.includes("'COMPLETED'"), 'should preserve the const object')
  })

  void test('as const on array should not add validation', async () => {
    const result = await compiler.transformSource(
      'test.ts',
      `
      export const Stages = ['OPEN', 'CLOSED', 'PENDING'] as const
    `,
    )
    assert.ok(!result.code.includes('throw new TypeError'), 'const array should not generate validation')
  })

  void test('regular cast should still validate', async () => {
    await transformAndCheck(
      `
      interface User { name: string }
      const data = { name: 'test' } as User
      `,
      ['throw new TypeError'],
    )
  })
})

void describe('JSON.parse Transformations', () => {
  void test('validates and filters parsed JSON', async () => {
    const source = `
      interface User { name: string; age: number }
      function run(input: any): string {
        const parsed = JSON.parse(input) as User;
        return JSON.stringify(parsed as any);
      }
    `
    const json = JSON.stringify({ name: 'Alice', age: 30, extra: 'ignored' })
    const result = await transformAndRun(source, json)

    const parsed: Record<string, unknown> = JSON.parse(result)
    assert.strictEqual(parsed.extra, undefined)
    assert.deepStrictEqual(parsed, { name: 'Alice', age: 30 })
  })

  void test('throws on type mismatch - wrong type', async () => {
    const source = `
      interface User { name: string; age: number }
      function run(input: any): string {
        try {
          const parsed = JSON.parse(input) as User;
          return JSON.stringify(parsed as any);
        } catch (e) {
          return 'ERROR: ' + (e as Error).message;
        }
      }
    `
    const json = JSON.stringify({ name: 123, age: 'string' })
    const result = await transformAndRun(source, json)

    assert.ok(result.startsWith('ERROR:'), `Expected error but got: ${result}`)
  })

  void test('handles optional properties', async () => {
    const source = `
      interface Opt { name: string; nickname?: string }
      function run(input: any): string {
        const parsed = JSON.parse(input) as Opt;
        return JSON.stringify(parsed as any);
      }
    `
    const json = JSON.stringify({ name: 'Alice' })
    const result = await transformAndRun(source, json)

    const parsed = JSON.parse(result)
    assert.deepStrictEqual(parsed, { name: 'Alice' })
  })

  void test('handles nested objects', async () => {
    const source = `
      interface Address { city: string }
      interface Person { name: string; address: Address }
      function run(input: any): string {
        const parsed = JSON.parse(input) as Person;
        return JSON.stringify(parsed as any);
      }
    `
    const json = JSON.stringify({ name: 'Bob', address: { city: 'NYC', zip: '10001' }, extra: true })
    const result = await transformAndRun(source, json)

    const parsed = JSON.parse(result)
    assert.deepStrictEqual(parsed, { name: 'Bob', address: { city: 'NYC' } })
  })

  void test('handles arrays', async () => {
    const source = `
      interface User { name: string; age: number }
      function run(input: any): string {
        const parsed = JSON.parse(input) as User[];
        return JSON.stringify(parsed as any);
      }
    `
    const json = JSON.stringify([
      { name: 'A', age: 1, x: 1 },
      { name: 'B', age: 2 },
    ])
    const result = await transformAndRun(source, json)

    const parsed = JSON.parse(result)
    assert.deepStrictEqual(parsed, [
      { name: 'A', age: 1 },
      { name: 'B', age: 2 },
    ])
  })
})

// =============================================================================
// LIB TYPE DETECTION
// =============================================================================

void describe('Lib Type Detection', () => {
  void test('built-in Set uses instanceof', async () => {
    // Set from lib.es2015.d.ts should use instanceof check
    await transformAndCheck(
      `function processSet(s: Set<string>): number {
        return s.size;
      }`,
      ['instanceof Set', 'Set instance'],
    )
  })

  void test('built-in Map uses instanceof', async () => {
    // Map from lib.es2015.d.ts should use instanceof check
    await transformAndCheck(
      `function processMap(m: Map<string, number>): number {
        return m.size;
      }`,
      ['instanceof Map', 'Map instance'],
    )
  })

  void test('built-in WeakSet uses instanceof', async () => {
    await transformAndCheck(
      `function processWeakSet(ws: WeakSet<object>): boolean {
        return ws.has({});
      }`,
      ['instanceof WeakSet', 'WeakSet instance'],
    )
  })

  void test('built-in WeakMap uses instanceof', async () => {
    await transformAndCheck(
      `function processWeakMap(wm: WeakMap<object, string>): boolean {
        return wm.has({});
      }`,
      ['instanceof WeakMap', 'WeakMap instance'],
    )
  })

  void test('built-in Date uses instanceof', async () => {
    await transformAndCheck(
      `function processDate(d: Date): number {
        return d.getTime();
      }`,
      ['instanceof Date', 'Date instance'],
    )
  })

  void test('built-in RegExp uses instanceof', async () => {
    await transformAndCheck(
      `function processRegExp(r: RegExp): boolean {
        return r.test("hello");
      }`,
      ['instanceof RegExp', 'RegExp instance'],
    )
  })

  void test('built-in Error uses instanceof', async () => {
    await transformAndCheck(
      `function processError(e: Error): string {
        return e.message;
      }`,
      ['instanceof Error', 'Error instance'],
    )
  })

  void test('built-in Promise uses instanceof', async () => {
    await transformAndCheck(
      `function processPromise(p: Promise<string>): Promise<string> {
        return p;
      }`,
      ['instanceof Promise', 'Promise instance'],
    )
  })

  void test('built-in ArrayBuffer uses instanceof', async () => {
    await transformAndCheck(
      `function processBuffer(buf: ArrayBuffer): number {
        return buf.byteLength;
      }`,
      ['instanceof ArrayBuffer', 'ArrayBuffer instance'],
    )
  })

  void test('built-in Headers uses instanceof', async () => {
    // Headers from the Fetch API (lib.dom.d.ts) should use instanceof
    await transformAndCheck(
      `function processHeaders(h: Headers): string | null {
        return h.get("content-type");
      }`,
      ['instanceof Headers', 'Headers instance'],
    )
  })

  void test('user-defined Set class uses instanceof for that class', async () => {
    // A user-defined class named Set should NOT be detected as lib type
    // and should use the user's class for instanceof
    await transformAndCheck(
      `class MySet {
        private items: string[] = [];
        add(item: string): void { this.items.push(item); }
      }
      function processCustomSet(s: MySet): void {
        s.add("test");
      }`,
      ['instanceof MySet'], // Should use instanceof for user's class
    )
  })

  void test('user-defined interface does NOT use instanceof', async () => {
    // A user-defined interface should NOT use instanceof
    // because interfaces are not runtime values - should duck-type
    await transformAndCheck(
      `interface MyCollection {
        items: string[];
        size: number;
      }
      function processMyCollection(c: MyCollection): number {
        return c.size;
      }`,
      ['typeof', 'object', 'c.items', 'c.size'], // Should duck-type the interface
      ['instanceof MyCollection'], // Should NOT use instanceof for interface
    )
  })

  void test('user-defined FormData class does NOT match lib.dom FormData', async () => {
    // User class named FormData should use the user's class, not be treated as DOM FormData
    await transformAndCheck(
      `class FormData {
        private data: Record<string, string> = {};
        append(key: string, value: string): void { this.data[key] = value; }
      }
      function processCustomFormData(fd: FormData): void {
        fd.append("test", "value");
      }`,
      ['instanceof FormData'], // User's class
    )
  })

  void test('file named my-lib.utils.ts does NOT trigger lib detection', async () => {
    // This tests that our lib detection is specific to TypeScript lib files
    // A user file with "lib" in the name should NOT be treated as a lib file
    // The User interface here should be duck-typed, not treated as a lib class
    await transformAndCheck(
      `// Simulating a file that might have "lib" in its path
      interface User {
        name: string;
        age: number;
      }
      function processUser(u: User): string {
        return u.name;
      }`,
      ['typeof', 'object', 'u.name', 'u.age'], // Should duck-type
      ['instanceof User'], // Should NOT use instanceof for interface
    )
  })

  // DOM types - these are interfaces in TypeScript but classes at runtime
  void test('HTMLElement uses instanceof', async () => {
    await transformAndCheck(
      `function processElement(el: HTMLElement): string {
        return el.tagName;
      }`,
      ['instanceof HTMLElement', 'HTMLElement instance'],
    )
  })

  void test('HTMLDivElement uses instanceof', async () => {
    await transformAndCheck(
      `function processDiv(div: HTMLDivElement): string {
        return div.innerHTML;
      }`,
      ['instanceof HTMLDivElement', 'HTMLDivElement instance'],
    )
  })

  void test('HTMLInputElement uses instanceof', async () => {
    await transformAndCheck(
      `function processInput(input: HTMLInputElement): string {
        return input.value;
      }`,
      ['instanceof HTMLInputElement', 'HTMLInputElement instance'],
    )
  })

  void test('Event uses instanceof', async () => {
    await transformAndCheck(
      `function processEvent(e: Event): string {
        return e.type;
      }`,
      ['instanceof Event', 'Event instance'],
    )
  })

  void test('MouseEvent uses instanceof', async () => {
    await transformAndCheck(
      `function processMouse(e: MouseEvent): number {
        return e.clientX;
      }`,
      ['instanceof MouseEvent', 'MouseEvent instance'],
    )
  })

  void test('KeyboardEvent uses instanceof', async () => {
    await transformAndCheck(
      `function processKeyboard(e: KeyboardEvent): string {
        return e.key;
      }`,
      ['instanceof KeyboardEvent', 'KeyboardEvent instance'],
    )
  })

  // Web API types
  void test('Blob uses instanceof', async () => {
    await transformAndCheck(
      `function processBlob(b: Blob): number {
        return b.size;
      }`,
      ['instanceof Blob', 'Blob instance'],
    )
  })

  void test('File uses instanceof', async () => {
    await transformAndCheck(
      `function processFile(f: File): string {
        return f.name;
      }`,
      ['instanceof File', 'File instance'],
    )
  })

  void test('FormData uses instanceof', async () => {
    await transformAndCheck(
      `function processFormData(fd: FormData): void {
        fd.append("key", "value");
      }`,
      ['instanceof FormData', 'FormData instance'],
    )
  })

  void test('URL uses instanceof', async () => {
    await transformAndCheck(
      `function processURL(url: URL): string {
        return url.href;
      }`,
      ['instanceof URL', 'URL instance'],
    )
  })

  void test('URLSearchParams uses instanceof', async () => {
    await transformAndCheck(
      `function processParams(params: URLSearchParams): string | null {
        return params.get("key");
      }`,
      ['instanceof URLSearchParams', 'URLSearchParams instance'],
    )
  })

  void test('Request uses instanceof', async () => {
    await transformAndCheck(
      `function processRequest(req: Request): string {
        return req.url;
      }`,
      ['instanceof Request', 'Request instance'],
    )
  })

  void test('Response uses instanceof', async () => {
    await transformAndCheck(
      `function processResponse(res: Response): number {
        return res.status;
      }`,
      ['instanceof Response', 'Response instance'],
    )
  })

  void test('AbortController uses instanceof', async () => {
    await transformAndCheck(
      `function processAbortController(ac: AbortController): AbortSignal {
        return ac.signal;
      }`,
      ['instanceof AbortController', 'AbortController instance'],
    )
  })

  void test('ReadableStream uses instanceof', async () => {
    await transformAndCheck(
      `function processStream(stream: ReadableStream): boolean {
        return stream.locked;
      }`,
      ['instanceof ReadableStream', 'ReadableStream instance'],
    )
  })

  void test('TextEncoder uses instanceof', async () => {
    await transformAndCheck(
      `function processEncoder(enc: TextEncoder): string {
        return enc.encoding;
      }`,
      ['instanceof TextEncoder', 'TextEncoder instance'],
    )
  })

  void test('TextDecoder uses instanceof', async () => {
    await transformAndCheck(
      `function processDecoder(dec: TextDecoder): string {
        return dec.encoding;
      }`,
      ['instanceof TextDecoder', 'TextDecoder instance'],
    )
  })
})

// =============================================================================
// COMPLEXITY LIMIT
// =============================================================================

void describe('Complexity Limit', () => {
  void test('errors on overly complex types', async () => {
    // Generate a type with many object types in a union - each object type creates an _io function
    // With 60 distinct object types in a union, we should exceed the default limit of 50
    const objectTypes = Array.from({ length: 60 }, (_, i) => `{ kind: "${i}"; value${i}: string }`).join(' | ')
    const source = `
      type Complex = ${objectTypes};
      function process(data: Complex): void {}
    `

    try {
      await compiler.transformSource('test.ts', source)
      assert.fail('Expected an error for complex type')
    } catch (e) {
      const error = e as Error
      assert.ok(error.message.includes('complexity limit exceeded'), `Expected complexity limit error, got: ${error.message}`)
      assert.ok(error.message.includes('helper functions'), `Expected helper functions mention, got: ${error.message}`)
    }
  })

  void test('normal types do not trigger limit', async () => {
    // A reasonably complex type that should still be under the limit
    const source = `
      interface User {
        id: string;
        name: string;
        email: string;
        age: number;
        active: boolean;
        roles: string[];
        metadata: {
          createdAt: string;
          updatedAt: string;
        };
      }
      function processUser(user: User): void {}
    `

    // Should not throw
    const result = await compiler.transformSource('test.ts', source)
    assert.ok(result.code.includes('function processUser'), 'Should transform without error')
  })

  void test('complex mapped type with field configs - like FormKit', async () => {
    // This replicates the pattern from FormKit's OrderedObjectFields type
    // which creates a complex union from mapped types
    const source = `
      // Form data types
      type FormDataValue = string | number | boolean | null | FormDataValue[] | { [key: string]: FormDataValue }
      type FormDataObject = Record<string, FormDataValue> | object
      type Validator<T> = ((value: T) => boolean | string)

      // Base field interface with common properties
      interface BaseFieldConfig<T = unknown> {
        label: string
        placeholder?: string
        required?: boolean
        disabled?: boolean
        validator?: Validator<T>
        description?: string
      }

      // Various field config types
      interface TextFieldConfig extends BaseFieldConfig<string> {
        type: 'text'
        minLength?: number
        maxLength?: number
      }

      interface NumberFieldConfig extends BaseFieldConfig<number> {
        type: 'number'
        min?: number
        max?: number
      }

      interface SelectFieldConfig extends BaseFieldConfig<string> {
        type: 'select'
        options: { id: string; label: string }[]
      }

      interface CheckboxFieldConfig extends BaseFieldConfig<boolean> {
        type: 'checkbox'
      }

      interface TagsFieldConfig extends BaseFieldConfig<string[]> {
        type: 'tags'
        maxTags?: number
        allowDuplicates?: boolean
        separator?: string
      }

      // Union of all field configs
      type FieldConfig =
        | TextFieldConfig
        | NumberFieldConfig
        | SelectFieldConfig
        | CheckboxFieldConfig
        | TagsFieldConfig

      // Field entry type
      type FieldEntry<K extends string, V> = {
        key: K
        config: V
      }

      // Object field config (recursive)
      interface ObjectFieldConfig<T extends FormDataObject = FormDataObject> {
        label?: string
        fields: OrderedObjectFields<T>
      }

      // Array field config
      interface ArrayFieldConfig<T> {
        label?: string
        fields: T extends FormDataObject ? OrderedObjectFields<T> : FieldConfig
        min?: number
        max?: number
      }

      // The complex mapped type that causes issues
      type OrderedObjectFields<T> = (
        | {
            [K in keyof T]:
              | FieldEntry<string & K, T[K] extends (infer U)[] ? ArrayFieldConfig<U> : T[K] extends FormDataObject ? ObjectFieldConfig<T[K]> : FieldConfig>
          }[keyof T]
        | FieldEntry<string, { type: 'divider' }>
      )[]

      // When casting to one of the field configs, it explodes
      function convertField(input: unknown): TagsFieldConfig {
        return input as TagsFieldConfig;
      }
    `

    try {
      await compiler.transformSource('test.ts', source)
      // If it succeeds, that's also acceptable - the point is to test the behaviour
    } catch (e) {
      const error = e as Error
      // Should get a helpful error message with source file and properties
      assert.ok(error.message.includes('complexity limit exceeded'), `Expected complexity limit error, got: ${error.message}`)
      assert.ok(error.message.includes('TagsFieldConfig'), `Expected TagsFieldConfig in error, got: ${error.message}`)
      // The enhanced error should include properties
      assert.ok(error.message.includes('Properties:'), `Expected Properties in error, got: ${error.message}`)
    }
  })
})

// =============================================================================
// OPTIONAL PARAMETERS
// =============================================================================

void describe('Optional Parameters', () => {
  void test('optional parameter with ? token wraps validation in undefined check', async () => {
    const code = await transformAndCheck(
      `function greet(name: string, title?: string): string {
        return (title ?? "") + name;
      }`,
      [
        '"string" === typeof name', // Required param validated normally
        'if (title !== undefined)', // Optional param wrapped in check
        '"string" === typeof title', // Type check still happens when defined
      ],
    )
    // Verify the structure: the title validation is inside the if block
    assert.ok(code.includes('if (title !== undefined) {'), 'Optional param should be wrapped in undefined check')
  })

  void test('parameter with default value wraps validation in undefined check', async () => {
    const code = await transformAndCheck(
      `function greet(name: string, greeting: string = "Hello"): string {
        return greeting + " " + name;
      }`,
      [
        '"string" === typeof name', // Required param validated normally
        'if (greeting !== undefined)', // Default param wrapped in check
      ],
    )
    assert.ok(code.includes('if (greeting !== undefined) {'), 'Default param should be wrapped in undefined check')
  })

  void test('multiple optional parameters each get undefined check', async () => {
    await transformAndCheck(
      `function format(text: string, prefix?: string, suffix?: string): string {
        return (prefix ?? "") + text + (suffix ?? "");
      }`,
      ['"string" === typeof text', 'if (prefix !== undefined)', 'if (suffix !== undefined)'],
    )
  })

  void test('optional object parameter wraps validation in undefined check', async () => {
    await transformAndCheck(
      `interface Config { host: string; port: number; }
      function connect(config?: Config): void {}`,
      ['if (config !== undefined)', 'typeof config !== "object"'], // Object check is !== not ===
    )
  })

  void test('required parameter is NOT wrapped in undefined check', async () => {
    const code = await transformAndCheck(
      `function process(value: string): string {
        return value;
      }`,
      ['"string" === typeof value'],
    )
    // Should NOT have if (value !== undefined) check
    assert.ok(!code.includes('if (value !== undefined)'), 'Required param should not be wrapped in undefined check')
  })
})

// =============================================================================
// FUNCTION TYPES IN UNIONS
// =============================================================================

void describe('Function Types', () => {
  void test('function type in union uses typeof function check', async () => {
    const code = await transformAndCheck(
      `function processCallback(cb: string | (() => void)): void {
        if (typeof cb === "function") cb();
      }`,
      ['"string" === typeof cb', '"function" === typeof cb', 'if (', 'else if ('],
    )
    // Should NOT try to validate function signature
    assert.ok(!code.includes('instanceof'), 'Should not use instanceof for function type')
  })

  void test('optional function property uses typeof function check', async () => {
    // This is the console.time pattern - function | undefined
    const code = await transformAndCheck(
      `interface Console {
        log: (message: string) => void;
        time?: (label?: string) => void;
      }
      function useConsole(c: Console): void {
        c.log("test");
      }`,
      ['"function" === typeof c.log'], // Required function property validated
    )
    // Optional function property - check what format it uses
    // Could be `c.time !== undefined` or `if (c.time !== undefined)`
    const hasTimeCheck = code.includes('c.time') && (code.includes('undefined') || code.includes('function'))
    assert.ok(hasTimeCheck, `Optional function should have time check. Got:\n${code}`)
  })

  void test('function type as standalone parameter validates with typeof', async () => {
    // Function parameters are validated with typeof === "function"
    await transformAndCheck(
      `function execute(fn: (x: number) => string): string {
        return fn(42);
      }`,
      ['"function" === typeof fn'], // Function param validated with typeof
    )
  })

  void test('callback in object type uses typeof function', async () => {
    await transformAndCheck(
      `interface Handler {
        onSuccess: () => void;
        onError?: (err: Error) => void;
      }
      function registerHandler(h: Handler): void {}`,
      ['"function" === typeof'], // Should use typeof for function properties
    )
  })

  void test('union of function and undefined uses typeof', async () => {
    // Common pattern: optional callback
    const code = await transformAndCheck(
      `function maybeCall(fn: (() => void) | undefined): void {
        if (fn) fn();
      }`,
      ['undefined === fn', '"function" === typeof fn'],
    )
    assert.ok(!code.includes('instanceof'), 'Should not use instanceof for function | undefined')
  })

  void test('union of multiple function signatures uses typeof', async () => {
    // Multiple function types in union should all use typeof
    await transformAndCheck(
      `type Callback = ((x: string) => void) | ((x: number) => void) | null;
      function setCallback(cb: Callback): void {}`,
      ['"function" === typeof', 'null === cb'],
    )
  })

  void test('constructor interface uses typeof function', async () => {
    // Interfaces with `new()` signature are constructor functions at runtime
    await transformAndCheck(
      `interface PluginConstructor {
        new(): { name: string };
      }
      function getConstructor(): PluginConstructor | undefined {
        return undefined;
      }`,
      ['"function" === typeof'], // Should check for function, not object
      ['"object" === typeof'], // Should NOT check for object
    )
  })

  void test('constructor interface as parameter uses typeof function', async () => {
    // Constructor parameter should be validated as function
    await transformAndCheck(
      `interface FormPluginConstructor {
        new(): { init(): void };
      }
      function registerPlugin(ctor: FormPluginConstructor): void {}`,
      ['"function" === typeof ctor'], // Should validate as function
    )
  })
})

// =============================================================================
// HELPER FUNCTIONS (_io) IN INLINE VALIDATION
// =============================================================================

void describe('Helper Functions in Inline Validation', () => {
  void test('any _io function used must be defined', async () => {
    // Union of object types creates helper functions for each object type check
    // This is the bug fix test - when using inline validation (parameters),
    // the _io helper functions must be included in the output
    const code = await transformAndCheck(
      `interface Circle { kind: "circle"; radius: number; }
      interface Square { kind: "square"; size: number; }
      type Shape = Circle | Square;
      export function processShape(shape: Shape): void {
        console.log(shape);
      }`,
      ['if (', 'else if ('], // Union uses if-else chain
    )
    // Any _io function used MUST be defined
    const ioUsages = [...code.matchAll(/_io(\d+)\(/g)]
    for (const match of ioUsages) {
      const funcName = `_io${match[1]}`
      assert.ok(code.includes(`const ${funcName}`), `${funcName} is used but not defined. Code:\n${code}`)
    }
  })

  void test('multiple parameters with complex types have unique _io names', async () => {
    // When a function has multiple parameters that each need _io helper functions,
    // the helpers must have unique names to avoid "symbol already declared" errors
    const code = await transformAndCheck(
      `interface FileType { label: string; code: string; }
      interface UploadFile { id: string; name: string; fileType?: FileType; }
      export function isFileTypeCompatible(file: UploadFile, fileType: FileType): boolean {
        return file.fileType?.code === fileType.code;
      }`,
      ['file', 'fileType'], // Both params should be validated
    )

    // Check that all _io functions have unique names
    const ioDefs = [...code.matchAll(/const (_io\d+)/g)]
    const definedFuncs = ioDefs.map(m => m[1])
    const uniqueFuncs = [...new Set(definedFuncs)]
    assert.strictEqual(definedFuncs.length, uniqueFuncs.length, `Duplicate _io function names found. Defined: ${definedFuncs.join(', ')}. Code:\n${code}`)

    // Any _io function used MUST be defined
    const ioUsages = [...code.matchAll(/_io(\d+)\(/g)]
    for (const match of ioUsages) {
      const funcName = `_io${match[1]}`
      assert.ok(code.includes(`const ${funcName}`), `${funcName} is used but not defined. Code:\n${code}`)
    }
  })
})

// =============================================================================
// IGNORE TYPES
// =============================================================================

void describe('Ignore Types', () => {
  void test('ignoreTypes skips validation and adds comment for casts', async () => {
    // A complex type that would normally be validated
    const source = `
      interface FieldConfig {
        type: string;
        label: string;
        options?: string[];
      }
      function convertField(input: unknown): FieldConfig {
        return input as FieldConfig;
      }
    `

    // Transform with ignoreTypes pattern
    const result = await compiler.transformSource('test.ts', source, ['*FieldConfig'])

    // Should contain the skip comment instead of validation
    assert.ok(result.code.includes('validation skipped'), `Expected 'validation skipped' comment, got: ${result.code}`)
    assert.ok(result.code.includes('FieldConfig'), `Expected 'FieldConfig' in skip reason, got: ${result.code}`)
    assert.ok(result.code.includes('ignoreTypes pattern'), `Expected 'ignoreTypes pattern' in comment, got: ${result.code}`)
    // Should NOT contain validation code
    assert.ok(!result.code.includes('throw new TypeError'), `Should not contain validation code when ignored`)
  })

  void test('ignoreTypes skips validation and adds comment for returns', async () => {
    const source = `
      interface TagsFieldConfig {
        type: 'tags';
        maxTags?: number;
      }
      function getTags(): TagsFieldConfig {
        return { type: 'tags' };
      }
    `

    const result = await compiler.transformSource('test.ts', source, ['*FieldConfig'])

    // Should contain the skip comment
    assert.ok(result.code.includes('validation skipped'), `Expected 'validation skipped' comment, got: ${result.code}`)
    assert.ok(result.code.includes('TagsFieldConfig'), `Expected 'TagsFieldConfig' in skip reason, got: ${result.code}`)
  })

  void test('ignoreTypes with exact match', async () => {
    const source = `
      interface User { name: string; }
      interface Admin { role: string; }
      function getAdmin(input: unknown): Admin {
        return input as Admin;
      }
      function getUser(input: unknown): User {
        return input as User;
      }
    `

    // Only ignore Admin, not User
    const result = await compiler.transformSource('test.ts', source, ['Admin'])

    // Admin should be skipped
    assert.ok(result.code.includes("validation skipped: type 'Admin'"), `Expected Admin to be skipped, got: ${result.code}`)
    // User should still be validated
    assert.ok(result.code.includes('"string" === typeof'), `Expected User validation to still exist`)
  })
})

// =============================================================================
// OPTIMISATIONS
// =============================================================================

void describe('Optimisations', () => {
  void test('skip return - variable validated via cast then returned', async () => {
    // When a variable is validated via a cast, returning it should not re-validate
    await transformAndCheck(
      `interface User { name: string; }
      function getUser(data: unknown): User {
        const user = data as User;
        return user;
      }`,
      ['throw new TypeError', '/* already valid */'], // Should validate the cast, skip return
      ['"return value"'], // Should NOT have return validation
    )
  })

  void test('skip return - variable from JSON.parse as T then returned', async () => {
    // JSON.parse with as T should validate and filter the result,
    // then return should not re-validate
    await transformAndCheck(
      `interface User { name: string; }
      function parseUser(json: string): User {
        const user = JSON.parse(json) as User;
        return user;
      }`,
      ['JSON.parse', '/* already valid */'],
      ['"return value"'],
    )
  })

  void test('skip return - aliased validated variable', async () => {
    // When a variable is aliased from a validated param, return should skip
    await transformAndCheck(
      `function aliased(x: string): string {
        const y = x;
        return y;
      }`,
      ['"string" === typeof x', '/* already valid */'],
      ['"return value"'],
    )
  })

  void test('typical-ignore comment skips validation', async () => {
    // @typical-ignore should skip validation entirely
    const result = await compiler.transformSource(
      'test.ts',
      `// @typical-ignore
      function ignored(x: string): string {
        return x;
      }`,
    )
    assert.ok(!result.code.includes('throw new TypeError'), 'Should not validate with @typical-ignore')
    assert.ok(!result.code.includes('"return value"'), 'Should not validate return with @typical-ignore')
  })

  void test('pure functions do not dirty objects', async () => {
    // Passing an object to console.log should not dirty it
    // because console.log is a pure/readonly function
    await transformAndCheck(
      `interface User { name: string; }
      function logAndReturn(user: User): User {
        console.log(user);
        return user;
      }`,
      ['/* already valid */'], // Return validation skipped
      ['"return value"'], // No return validation
    )
  })
})
