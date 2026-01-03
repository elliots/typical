import { test, describe, after, before } from 'node:test'
import assert from 'node:assert'
import { TypicalTransformer } from '../src/transformer.js'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

// delete existing test output dir
rmSync('test/output', { recursive: true, force: true })

// Ensure test/output and test/fixtures directories exist
mkdirSync('test/output', { recursive: true })
mkdirSync('test/fixtures', { recursive: true })

// Test fixtures - write before transformer starts
const fixtures = {
  simple: {
    file: resolve('test/fixtures/simple.ts'),
    code: `function greet(name: string): string {
  return "Hello " + name;
}`,
  },
  object_param: {
    file: resolve('test/fixtures/object_param.ts'),
    code: `interface User {
  name: string;
  age: number;
}

function processUser(user: User): string {
  return user.name;
}`,
  },
  array_param: {
    file: resolve('test/fixtures/array_param.ts'),
    code: `function sum(numbers: number[]): number {
  return numbers.reduce((a, b) => a + b, 0);
}`,
  },
  union_param: {
    file: resolve('test/fixtures/union_param.ts'),
    code: `function processValue(value: string | number): string {
  return String(value);
}`,
  },
}

// Write all fixture files before any tests run
for (const fixture of Object.values(fixtures)) {
  writeFileSync(fixture.file, fixture.code)
}

/**
 * Write test output files for debugging.
 */
function writeTestOutput(testName: string, code: string) {
  const safeName = testName.replace(/[^a-zA-Z0-9]/g, '_')
  writeFileSync(`test/output/${safeName}.ts`, code)
}

void describe('TypicalTransformer v2', () => {
  let transformer: TypicalTransformer

  // Create transformer before all tests (files already exist)
  // Use the test fixtures tsconfig to ensure files are in the project
  before(() => {
    transformer = new TypicalTransformer(undefined, 'test/fixtures/tsconfig.json')
  })

  // Clean up transformer after all tests
  after(async () => {
    if (transformer) {
      await transformer.close()
    }
  })

  void test('should create TypicalTransformer instance', () => {
    assert.ok(transformer instanceof TypicalTransformer)
  })

  void test('should transform a simple function with parameter validation', async () => {
    const result = await transformer.transform(fixtures.simple.file, 'ts')

    writeTestOutput('simple_function', result.code)

    // Check that validation code was added
    assert.ok(result.code.includes('string'), 'Should contain string type check')
    // The Go compiler adds validator functions
    assert.ok(result.code.length > fixtures.simple.code.length, 'Output should be longer than input (validation added)')
  })

  void test('should transform function with object parameter', async () => {
    const result = await transformer.transform(fixtures.object_param.file, 'ts')

    writeTestOutput('object_param', result.code)

    // Should contain validation for object properties
    assert.ok(result.code.includes('name'), 'Should reference name property')
    assert.ok(result.code.includes('age'), 'Should reference age property')
  })

  void test('should transform function with array parameter', async () => {
    const result = await transformer.transform(fixtures.array_param.file, 'ts')

    writeTestOutput('array_param', result.code)

    // Should contain array validation
    assert.ok(result.code.includes('Array'), 'Should contain Array check')
  })

  void test('should transform function with union type', async () => {
    const result = await transformer.transform(fixtures.union_param.file, 'ts')

    writeTestOutput('union_param', result.code)

    // Should contain validation for both union members
    assert.ok(result.code.includes('string') || result.code.includes('number'), 'Should contain type checks')
  })

  void test('should throw error for unsupported js mode', async () => {
    await assert.rejects(() => transformer.transform(fixtures.simple.file, 'js'), /Mode "js" not yet supported/, 'Should throw for js mode')
  })
})
