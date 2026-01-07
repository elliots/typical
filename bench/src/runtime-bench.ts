import { Bench } from 'tinybench'

// Primitive types
import {
  validateString,
  validateNumber,
  validateBoolean,
  noValidateString,
  noValidateNumber,
  noValidateBoolean,
  zodValidateString,
  zodValidateNumber,
  zodValidateBoolean,
  testString,
  testNumber,
  testBoolean,
} from './scenarios/primitive-types.js'

// Object types
import { validateSimpleUser, noValidateSimpleUser, zodValidateSimpleUser, testSimpleUser } from './scenarios/object-types.js'

// Nested types
import { validateNestedUser, noValidateNestedUser, zodValidateNestedUser, testNestedUser } from './scenarios/nested-types.js'

// Array types
import { validateArray, noValidateArray, zodValidateArray, testArray10, testArray100 } from './scenarios/array-types.js'

// Complex types
import {
  validateTaskWithUnion,
  noValidateTaskWithUnion,
  zodValidateTaskWithUnion,
  validateUserWithTemplates,
  noValidateUserWithTemplates,
  zodValidateUserWithTemplates,
  validateComplexConfig,
  noValidateComplexConfig,
  zodValidateComplexConfig,
  testTaskWithUnion,
  testUserWithTemplates,
  testComplexConfig,
} from './scenarios/complex-types.js'

// JSON types - direct validators for inline benchmarks
import {
  // Zod schemas
  zodSmallPayload,
  zodMediumPayload,
  zodLargePayload,
  zodLargeArray,
  // Test data
  testSmallPayload,
  testMediumPayload,
  testLargePayload,
  testLargeArrayPayload,
  testSmallJson,
  testMediumJson,
  testLargeJson,
  testLargeArrayJson,
  testSmallWithExtrasJson,
  testSmallPayloadWithExtras,
} from './scenarios/json-types.js'
import type { LargePayload, MediumPayload, SmallPayload } from './scenarios/json-types.js'

interface BenchmarkResult {
  name: string
  noValidationOps: number
  typicalOps: number
  zodOps: number
  typicalVsNoValid: number // multiplier vs no validation (e.g. 0.97 = 97% as fast)
  typicalVsZod: number // multiplier vs zod (e.g. 50 = 50x faster)
}

async function runBenchmark(name: string, noValidationFn: () => void, typicalFn: () => void, zodFn: () => void): Promise<BenchmarkResult> {
  const bench = new Bench({ time: 100, warmupTime: 20, iterations: 100 })

  bench.add('no-validation', noValidationFn).add('typical', typicalFn).add('zod', zodFn)

  await bench.run()

  const noValidation = bench.tasks.find(t => t.name === 'no-validation')!
  const typical = bench.tasks.find(t => t.name === 'typical')!
  const zod = bench.tasks.find(t => t.name === 'zod')!

  // tinybench v6+ uses throughput.mean instead of hz
  const noValidationResult = noValidation.result as any
  const typicalResult = typical.result as any
  const zodResult = zod.result as any

  const noValidationOps = noValidationResult.throughput?.mean ?? noValidationResult.hz ?? 0
  const typicalOps = typicalResult.throughput?.mean ?? typicalResult.hz ?? 0
  const zodOps = zodResult.throughput?.mean ?? zodResult.hz ?? 0

  // How fast is Typical compared to no validation? (e.g. 0.97 = 97% as fast, 1.0 = same speed)
  const typicalVsNoValid = noValidationOps > 0 ? typicalOps / noValidationOps : 0
  // How fast is Typical compared to Zod? (e.g. 50 = 50x faster)
  const typicalVsZod = zodOps > 0 ? typicalOps / zodOps : 0

  return {
    name,
    noValidationOps,
    typicalOps,
    zodOps,
    typicalVsNoValid,
    typicalVsZod,
  }
}

function formatOps(ops: number): string {
  if (ops >= 1_000_000) {
    return `${(ops / 1_000_000).toFixed(2)}M`
  } else if (ops >= 1_000) {
    return `${(ops / 1_000).toFixed(2)}K`
  }
  return ops.toFixed(0)
}

// ANSI color codes
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
}

// Color a multiplier value - green if good, red if bad, yellow if neutral
function colorMultiplier(value: number, text: string, goodThreshold: number, badThreshold: number): string {
  if (value > goodThreshold) {
    return `${colors.green}${text}${colors.reset}`
  } else if (value < badThreshold) {
    return `${colors.red}${text}${colors.reset}`
  }
  return `${colors.yellow}${text}${colors.reset}`
}

function printResults(results: BenchmarkResult[]) {
  console.log('\n')
  console.log('Runtime Validation Benchmark Results')
  console.log('=====================================')
  console.log('')

  // Calculate column widths
  const nameWidth = Math.max(...results.map(r => r.name.length), 25)
  const opsWidth = 12

  // Header
  console.log(
    'Scenario'.padEnd(nameWidth) + ' | ' + 'Nothing'.padStart(opsWidth) + ' | ' + 'Typical'.padStart(opsWidth) + ' | ' + 'Zod'.padStart(opsWidth) + ' | ' + 'vs Nothing'.padStart(11) + ' | ' + 'vs Zod'.padStart(10),
  )
  console.log('-'.repeat(nameWidth + opsWidth * 3 + 36))

  // Results
  for (const result of results) {
    // Round to 1dp first, then format and colour based on rounded value
    const vsNoValidRounded = Math.round(result.typicalVsNoValid * 10) / 10
    const vsZodRounded = Math.round(result.typicalVsZod * 10) / 10

    // Format as multiplier (e.g. "0.9x" or "50.0x")
    const vsNoValidStr = `${vsNoValidRounded.toFixed(1)}x`
    const vsZodStr = `${vsZodRounded.toFixed(1)}x`

    // vs Nothing: closer to 1.0 is better (green if > 1.1, red if < 0.9, yellow if 0.9-1.1)
    const coloredVsNoValid = colorMultiplier(vsNoValidRounded, vsNoValidStr.padStart(11), 1.1, 0.9)
    // vs Zod: higher is better (green if > 1, yellow if exactly 1, red if < 1)
    const coloredVsZod = colorMultiplier(vsZodRounded, vsZodStr.padStart(10), 1, 1)

    console.log(
      result.name.padEnd(nameWidth) +
        ' | ' +
        `${formatOps(result.noValidationOps)}/s`.padStart(opsWidth) +
        ' | ' +
        `${formatOps(result.typicalOps)}/s`.padStart(opsWidth) +
        ' | ' +
        `${formatOps(result.zodOps)}/s`.padStart(opsWidth) +
        ' | ' +
        coloredVsNoValid +
        ' | ' +
        coloredVsZod,
    )
  }

  console.log('')
  console.log('vs Nothing = speed relative to no validation (1.0x = same speed)')
  console.log('vs Zod = speed relative to Zod (higher = faster than Zod)')
  console.log('')
}

async function main() {
  console.log('Starting runtime validation benchmarks...')
  console.log('Comparing: No validation vs Typical (typia) vs Zod\n')

  const results: BenchmarkResult[] = []

  // Primitive types
  console.log('Benchmarking primitive types...')

  results.push(
    await runBenchmark(
      'string',
      () => noValidateString(testString),
      () => validateString(testString),
      () => zodValidateString(testString),
    ),
  )

  results.push(
    await runBenchmark(
      'number',
      () => noValidateNumber(testNumber),
      () => validateNumber(testNumber),
      () => zodValidateNumber(testNumber),
    ),
  )

  results.push(
    await runBenchmark(
      'boolean',
      () => noValidateBoolean(testBoolean),
      () => validateBoolean(testBoolean),
      () => zodValidateBoolean(testBoolean),
    ),
  )

  // Object types
  console.log('Benchmarking object types...')

  results.push(
    await runBenchmark(
      'object w/ template literals',
      () => noValidateSimpleUser(testSimpleUser),
      () => validateSimpleUser(testSimpleUser),
      () => zodValidateSimpleUser(testSimpleUser),
    ),
  )

  results.push(
    await runBenchmark(
      'nested w/ template literals',
      () => noValidateNestedUser(testNestedUser),
      () => validateNestedUser(testNestedUser),
      () => zodValidateNestedUser(testNestedUser),
    ),
  )

  // Array types
  console.log('Benchmarking array types...')

  results.push(
    await runBenchmark(
      'array w/ templates (10)',
      () => noValidateArray(testArray10),
      () => validateArray(testArray10),
      () => zodValidateArray(testArray10),
    ),
  )

  results.push(
    await runBenchmark(
      'array w/ templates (100)',
      () => noValidateArray(testArray100),
      () => validateArray(testArray100),
      () => zodValidateArray(testArray100),
    ),
  )

  // Complex types
  console.log('Benchmarking complex types...')

  results.push(
    await runBenchmark(
      'union types',
      () => noValidateTaskWithUnion(testTaskWithUnion),
      () => validateTaskWithUnion(testTaskWithUnion),
      () => zodValidateTaskWithUnion(testTaskWithUnion),
    ),
  )

  results.push(
    await runBenchmark(
      'template literals',
      () => noValidateUserWithTemplates(testUserWithTemplates),
      () => validateUserWithTemplates(testUserWithTemplates),
      () => zodValidateUserWithTemplates(testUserWithTemplates),
    ),
  )

  results.push(
    await runBenchmark(
      'complex config',
      () => noValidateComplexConfig(testComplexConfig),
      () => validateComplexConfig(testComplexConfig),
      () => zodValidateComplexConfig(testComplexConfig),
    ),
  )

  // JSON.parse benchmarks - direct calls without function wrapper overhead
  console.log('Benchmarking JSON.parse...')

  results.push(
    await runBenchmark(
      'JSON.parse (small)',
      () => JSON.parse(testSmallJson),
      () => JSON.parse(testSmallJson) as SmallPayload,
      () => zodSmallPayload.parse(JSON.parse(testSmallJson)),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.parse (small+filtered extras)',
      () => JSON.parse(testSmallWithExtrasJson),
      () => JSON.parse(testSmallWithExtrasJson) as SmallPayload,
      () => zodSmallPayload.parse(JSON.parse(testSmallWithExtrasJson)),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.parse (medium)',
      () => JSON.parse(testMediumJson),
      () => JSON.parse(testMediumJson) as MediumPayload,
      () => zodMediumPayload.parse(JSON.parse(testMediumJson)),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.parse (large)',
      () => JSON.parse(testLargeJson),
      () => JSON.parse(testLargeJson) as LargePayload,
      () => zodLargePayload.parse(JSON.parse(testLargeJson)),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.parse (1000 large)',
      () => JSON.parse(testLargeArrayJson),
      () => JSON.parse(testLargeArrayJson) as LargePayload[],
      () => zodLargeArray.parse(JSON.parse(testLargeArrayJson)),
    ),
  )

  // JSON.stringify benchmarks - direct calls without function wrapper overhead
  console.log('Benchmarking JSON.stringify...')

  results.push(
    await runBenchmark(
      'JSON.stringify (small)',
      () => JSON.stringify(testSmallPayload as any),
      () => JSON.stringify(testSmallPayload),
      () => JSON.stringify(zodSmallPayload.parse(testSmallPayload) as any),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.stringify (small+extras)',
      () => JSON.stringify(testSmallPayloadWithExtras as any),
      () => JSON.stringify(testSmallPayloadWithExtras),
      () => JSON.stringify(zodSmallPayload.parse(testSmallPayloadWithExtras) as any),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.stringify (medium)',
      () => JSON.stringify(testMediumPayload as any),
      () => JSON.stringify(testMediumPayload),
      () => JSON.stringify(zodMediumPayload.parse(testMediumPayload) as any),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.stringify (large)',
      () => JSON.stringify(testLargePayload as any),
      () => JSON.stringify(testLargePayload),
      () => JSON.stringify(zodLargePayload.parse(testLargePayload) as any),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.stringify (1000 large)',
      () => JSON.stringify(testLargeArrayPayload as any),
      () => JSON.stringify(testLargeArrayPayload),
      () => JSON.stringify(zodLargeArray.parse(testLargeArrayPayload) as any),
    ),
  )

  printResults(results)
}

main().catch(console.error)
