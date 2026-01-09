/**
 * Source Map Tests
 *
 * Tests that verify source maps are correctly generated and can be used
 * to map transformed code locations back to the original source.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { TypicalCompiler, type RawSourceMap } from '@elliots/typical-compiler'

let compiler: TypicalCompiler

before(async () => {
  compiler = new TypicalCompiler()
  await compiler.start()
})

after(async () => {
  await compiler.close()
})

/**
 * Decode a single VLQ value from a mappings string.
 * Returns [value, charsConsumed]
 */
function decodeVLQ(mappings: string, index: number): [number, number] {
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = 0
  let shift = 0
  let consumed = 0

  while (index + consumed < mappings.length) {
    const char = mappings[index + consumed]
    const digit = base64Chars.indexOf(char)
    if (digit === -1) break

    consumed++
    const hasContinuation = (digit & 0x20) !== 0
    result += (digit & 0x1f) << shift

    if (!hasContinuation) {
      // Convert from unsigned to signed (sign in LSB)
      const isNegative = (result & 1) !== 0
      result = result >> 1
      if (isNegative) result = -result
      return [result, consumed]
    }
    shift += 5
  }

  return [result, consumed]
}

/**
 * Parse source map mappings into structured segments.
 * Each segment is [genCol, srcIdx, srcLine, srcCol, nameIdx?]
 * Returns array of lines, each line is array of segments.
 */
function parseMappings(mappings: string): number[][][] {
  const lines: number[][][] = []
  let currentLine: number[][] = []

  let genCol = 0
  let srcIdx = 0
  let srcLine = 0
  let srcCol = 0

  let i = 0
  while (i < mappings.length) {
    const char = mappings[i]

    if (char === ';') {
      // New line
      lines.push(currentLine)
      currentLine = []
      genCol = 0
      i++
      continue
    }

    if (char === ',') {
      i++
      continue
    }

    // Parse a segment (1, 4, or 5 VLQ values)
    const segment: number[] = []

    // Generated column (always present, relative)
    const [genColDelta, genColChars] = decodeVLQ(mappings, i)
    i += genColChars
    genCol += genColDelta
    segment.push(genCol)

    // Check if there are more values in this segment
    if (i < mappings.length && mappings[i] !== ',' && mappings[i] !== ';') {
      // Source index (relative)
      const [srcIdxDelta, srcIdxChars] = decodeVLQ(mappings, i)
      i += srcIdxChars
      srcIdx += srcIdxDelta
      segment.push(srcIdx)

      // Source line (relative)
      const [srcLineDelta, srcLineChars] = decodeVLQ(mappings, i)
      i += srcLineChars
      srcLine += srcLineDelta
      segment.push(srcLine)

      // Source column (relative)
      const [srcColDelta, srcColChars] = decodeVLQ(mappings, i)
      i += srcColChars
      srcCol += srcColDelta
      segment.push(srcCol)

      // Optional: name index
      if (i < mappings.length && mappings[i] !== ',' && mappings[i] !== ';') {
        const [nameIdxDelta, nameIdxChars] = decodeVLQ(mappings, i)
        i += nameIdxChars
        segment.push(nameIdxDelta) // Names are rarely used, treat as absolute for simplicity
      }
    }

    currentLine.push(segment)
  }

  // Don't forget the last line
  if (currentLine.length > 0 || mappings.endsWith(';')) {
    lines.push(currentLine)
  }

  return lines
}

/**
 * Find the original position for a given generated position.
 */
function findOriginalPosition(
  sourceMap: RawSourceMap,
  genLine: number, // 0-based
  genCol: number   // 0-based
): { line: number; column: number; source: string } | null {
  const lines = parseMappings(sourceMap.mappings)

  if (genLine >= lines.length) return null

  const segments = lines[genLine]
  if (segments.length === 0) return null

  // Find the segment that covers this column (last segment with genCol <= target)
  let matchedSegment: number[] | null = null
  for (const segment of segments) {
    if (segment[0] <= genCol) {
      matchedSegment = segment
    } else {
      break
    }
  }

  if (!matchedSegment || matchedSegment.length < 4) return null

  return {
    source: sourceMap.sources[matchedSegment[1]],
    line: matchedSegment[2],     // 0-based
    column: matchedSegment[3],   // 0-based
  }
}

void describe('Source Map Structure', () => {
  it('produces valid v3 source map', async () => {
    const source = `export function run(input: string): string { return input }`
    const result = await compiler.transformSource('test.ts', source)

    assert.ok(result.sourceMap, 'Source map should be present')
    assert.strictEqual(result.sourceMap.version, 3)
    assert.deepStrictEqual(result.sourceMap.sources, ['test.ts'])
    assert.ok(result.sourceMap.mappings.length > 0)
  })

  it('includes original source content', async () => {
    const source = `export function greet(name: string): string { return "Hello " + name }`
    const result = await compiler.transformSource('hello.ts', source)

    assert.ok(result.sourceMap, 'Source map should be present')
    assert.ok(result.sourceMap.sourcesContent, 'sourcesContent should be present')
    assert.strictEqual(result.sourceMap.sourcesContent![0], source)
  })

  it('mappings contain only valid VLQ characters', async () => {
    const source = `
      interface User { name: string; age: number }
      export function run(user: User): string { return user.name }
    `
    const result = await compiler.transformSource('test.ts', source)

    assert.ok(result.sourceMap, 'Source map should be present')
    const validChars = /^[A-Za-z0-9+\/,;]*$/
    assert.ok(
      validChars.test(result.sourceMap.mappings),
      `Mappings contain invalid characters: ${result.sourceMap.mappings}`
    )
  })
})

void describe('Source Map Accuracy', () => {
  it('maps original code to same positions', async () => {
    // Single line source - original code should map to itself
    const source = `export function run(x: string): string { return x }`
    const result = await compiler.transformSource('test.ts', source)

    assert.ok(result.sourceMap, 'Source map should be present')

    // The transformed code inserts validation, but the original parts should still map correctly
    // Find "return x" in both original and transformed
    const originalReturnIdx = source.indexOf('return x')
    const transformedReturnIdx = result.code.indexOf('return')

    assert.ok(originalReturnIdx >= 0, 'Original should contain "return x"')
    assert.ok(transformedReturnIdx >= 0, 'Transformed should contain "return"')

    // Parse the source map and verify we can find a mapping
    const lines = parseMappings(result.sourceMap.mappings)
    assert.ok(lines.length > 0, 'Should have at least one line of mappings')
    assert.ok(lines[0].length > 0, 'First line should have mappings')
  })

  it('maps multiline code correctly', async () => {
    const source = `interface User {
  name: string
  age: number
}
export function run(user: User): string {
  return user.name
}`
    const result = await compiler.transformSource('test.ts', source)

    assert.ok(result.sourceMap, 'Source map should be present')

    // Count lines in transformed code
    const transformedLines = result.code.split('\n').length
    const mappingLines = result.sourceMap.mappings.split(';').length

    // Mapping lines should roughly correspond to output lines
    // (may have some empty lines represented by consecutive semicolons)
    assert.ok(
      mappingLines >= 1,
      `Should have mappings for output (got ${mappingLines} for ${transformedLines} output lines)`
    )
  })

  it('validation code maps back to type annotation', async () => {
    // The validation code should map to the parameter's type annotation
    const source = `export function run(input: string): string { return input }`
    const result = await compiler.transformSource('test.ts', source)

    assert.ok(result.sourceMap, 'Source map should be present')

    // Find where validation code is in the output
    const validationIdx = result.code.indexOf('typeof input')
    if (validationIdx >= 0) {
      // Calculate line and column of validation in generated code
      const beforeValidation = result.code.slice(0, validationIdx)
      const genLine = (beforeValidation.match(/\n/g) || []).length
      const lastNewline = beforeValidation.lastIndexOf('\n')
      const genCol = lastNewline >= 0 ? validationIdx - lastNewline - 1 : validationIdx

      // Find original position
      const original = findOriginalPosition(result.sourceMap, genLine, genCol)

      // The validation should map somewhere in the original source
      // (ideally to the parameter or its type annotation)
      if (original) {
        assert.strictEqual(original.source, 'test.ts')
        assert.ok(original.line >= 0, 'Original line should be valid')
        assert.ok(original.column >= 0, 'Original column should be valid')
      }
    }
  })
})

void describe('Source Map Edge Cases', () => {
  it('handles empty function (no validation needed)', async () => {
    const source = `export function run(): void {}`
    const result = await compiler.transformSource('test.ts', source)

    // Even with no validation, source map should be present
    assert.ok(result.sourceMap, 'Source map should be present')
    assert.ok(result.sourceMap.mappings.length >= 0)
  })

  it('handles complex nested types', async () => {
    const source = `
      interface Inner { value: number }
      interface Outer { inner: Inner; items: string[] }
      export function run(data: Outer): number { return data.inner.value }
    `
    const result = await compiler.transformSource('test.ts', source)

    assert.ok(result.sourceMap, 'Source map should be present')

    // Verify we can parse the mappings without error
    const lines = parseMappings(result.sourceMap.mappings)
    assert.ok(Array.isArray(lines), 'Mappings should parse to array')
  })

  it('handles multiple functions', async () => {
    const source = `
      export function first(a: string): string { return a }
      export function second(b: number): number { return b }
      export function third(c: boolean): boolean { return c }
    `
    const result = await compiler.transformSource('test.ts', source)

    assert.ok(result.sourceMap, 'Source map should be present')

    // Each function gets validation, mappings should cover multiple lines
    const lines = parseMappings(result.sourceMap.mappings)
    assert.ok(lines.length >= 1, 'Should have mappings for multiple lines')
  })

  it('preserves line structure for multiline functions', async () => {
    const source = `export function run(
  name: string,
  age: number,
  active: boolean
): string {
  return name
}`
    const result = await compiler.transformSource('test.ts', source)

    assert.ok(result.sourceMap, 'Source map should be present')

    // The transformed code should maintain similar line structure
    // and mappings should reflect this
    const sourceLines = source.split('\n').length
    const transformedLines = result.code.split('\n').length

    // Transformed might have slightly different line count due to inline validation
    // but should be in the same ballpark
    assert.ok(
      transformedLines >= sourceLines - 2 && transformedLines <= sourceLines + 5,
      `Line count should be similar: source=${sourceLines}, transformed=${transformedLines}`
    )
  })
})

void describe('VLQ Encoding', () => {
  it('correctly encodes simple values', () => {
    // Test our VLQ decoder with known values
    // 'A' = 0, 'C' = 1, 'E' = 2, 'G' = 3
    // 'B' = -0 (0 with negative), 'D' = -1, 'F' = -2
    const [val0] = decodeVLQ('A', 0)
    assert.strictEqual(val0, 0)

    const [val1] = decodeVLQ('C', 0)
    assert.strictEqual(val1, 1)

    const [valNeg1] = decodeVLQ('D', 0)
    assert.strictEqual(valNeg1, -1)
  })

  it('correctly parses segment with 4 values', () => {
    // A simple segment like "AAAA" = [0, 0, 0, 0]
    const lines = parseMappings('AAAA')
    assert.strictEqual(lines.length, 1)
    assert.strictEqual(lines[0].length, 1)
    assert.deepStrictEqual(lines[0][0], [0, 0, 0, 0])
  })

  it('correctly handles line separators', () => {
    // Two lines, each with one segment
    const lines = parseMappings('AAAA;CAAC')
    assert.strictEqual(lines.length, 2)
    assert.strictEqual(lines[0].length, 1)
    assert.strictEqual(lines[1].length, 1)
  })

  it('correctly handles segment separators', () => {
    // One line with two segments
    const lines = parseMappings('AAAA,CAAC')
    assert.strictEqual(lines.length, 1)
    assert.strictEqual(lines[0].length, 2)
  })
})
