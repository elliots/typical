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
  typicalVsNoValid: number // % overhead vs no validation
  typicalVsZod: number // % faster/slower vs zod
}

async function runBenchmark(name: string, noValidationFn: () => void, typicalFn: () => void, zodFn: () => void): Promise<BenchmarkResult> { ((_v: any, _n: string) => { if (!("string" === typeof _v)) throw new TypeError("Expected " + _n + " to be string, got " + typeof _v); return _v; })(name, "name"); ((_v: any, _n: string) => { return _v; })(noValidationFn, "noValidationFn"); ((_v: any, _n: string) => { return _v; })(typicalFn, "typicalFn"); ((_v: any, _n: string) => { return _v; })(zodFn, "zodFn");
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

  const typicalVsNoValid = typicalOps > 0 ? ((noValidationOps - typicalOps) / typicalOps) * 100 : 0
  const typicalVsZod = zodOps > 0 ? ((zodOps - typicalOps) / zodOps) * 100 : 0

  return((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("number" === typeof _v.noValidationOps)) throw new TypeError("Expected " + _n + ".noValidationOps" + " to be number, got " + typeof _v.noValidationOps); if (!("number" === typeof _v.typicalOps)) throw new TypeError("Expected " + _n + ".typicalOps" + " to be number, got " + typeof _v.typicalOps); if (!("number" === typeof _v.zodOps)) throw new TypeError("Expected " + _n + ".zodOps" + " to be number, got " + typeof _v.zodOps); if (!("number" === typeof _v.typicalVsNoValid)) throw new TypeError("Expected " + _n + ".typicalVsNoValid" + " to be number, got " + typeof _v.typicalVsNoValid); if (!("number" === typeof _v.typicalVsZod)) throw new TypeError("Expected " + _n + ".typicalVsZod" + " to be number, got " + typeof _v.typicalVsZod); return _v; })( {
    name,
    noValidationOps,
    typicalOps,
    zodOps,
    typicalVsNoValid,
    typicalVsZod,
  }, "return value")
}

function formatOps(ops: number): string { ((_v: any, _n: string) => { if (!("number" === typeof _v)) throw new TypeError("Expected " + _n + " to be number, got " + typeof _v); return _v; })(ops, "ops");
  if (ops >= 1_000_000) {
    return((_v: any, _n: string) => { if (!("string" === typeof _v)) throw new TypeError("Expected " + _n + " to be string, got " + typeof _v); return _v; })( `${(ops / 1_000_000).toFixed(2)}M`, "return value")
  } else if (ops >= 1_000) {
    return((_v: any, _n: string) => { if (!("string" === typeof _v)) throw new TypeError("Expected " + _n + " to be string, got " + typeof _v); return _v; })( `${(ops / 1_000).toFixed(2)}K`, "return value")
  }
  return((_v: any, _n: string) => { if (!("string" === typeof _v)) throw new TypeError("Expected " + _n + " to be string, got " + typeof _v); return _v; })( ops.toFixed(0), "return value")
}

// ANSI color codes
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
}

// Color a value based on whether lower is better or higher is better
function colorValue(value: number, text: string, lowerIsBetter: boolean, threshold = 5): string { ((_v: any, _n: string) => { if (!("number" === typeof _v)) throw new TypeError("Expected " + _n + " to be number, got " + typeof _v); return _v; })(value, "value"); ((_v: any, _n: string) => { if (!("string" === typeof _v)) throw new TypeError("Expected " + _n + " to be string, got " + typeof _v); return _v; })(text, "text"); ((_v: any, _n: string) => { if (!("boolean" === typeof _v)) throw new TypeError("Expected " + _n + " to be boolean, got " + typeof _v); return _v; })(lowerIsBetter, "lowerIsBetter");
  const isNeutral = Math.abs(value) <= threshold
  if (isNeutral) {
    return((_v: any, _n: string) => { if (!("string" === typeof _v)) throw new TypeError("Expected " + _n + " to be string, got " + typeof _v); return _v; })( `${colors.yellow}${text}${colors.reset}`, "return value")
  }
  const isGood = lowerIsBetter ? value < 0 : value > 0
  const color = isGood ? colors.green : colors.red
  return((_v: any, _n: string) => { if (!("string" === typeof _v)) throw new TypeError("Expected " + _n + " to be string, got " + typeof _v); return _v; })( `${color}${text}${colors.reset}`, "return value")
}

function printResults(results: BenchmarkResult[]) { ((_v: any, _n: string) => { if (!Array.isArray(_v)) throw new TypeError("Expected " + _n + " to be array, got " + typeof _v); for (let _i0 = 0; _i0 < _v.length; _i0++) { const _e0: any = _v[_i0]; if (typeof _e0 !== "object" || _e0 === null) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + " to be object, got " + (_e0 === null ? "null" : typeof _e0)); if (!("string" === typeof _e0.name)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".name" + " to be string, got " + typeof _e0.name); if (!("number" === typeof _e0.noValidationOps)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".noValidationOps" + " to be number, got " + typeof _e0.noValidationOps); if (!("number" === typeof _e0.typicalOps)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".typicalOps" + " to be number, got " + typeof _e0.typicalOps); if (!("number" === typeof _e0.zodOps)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".zodOps" + " to be number, got " + typeof _e0.zodOps); if (!("number" === typeof _e0.typicalVsNoValid)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".typicalVsNoValid" + " to be number, got " + typeof _e0.typicalVsNoValid); if (!("number" === typeof _e0.typicalVsZod)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".typicalVsZod" + " to be number, got " + typeof _e0.typicalVsZod); } return _v; })(results, "results");
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
    const vsNoValidStr = result.typicalVsNoValid >= 0 ? `+${result.typicalVsNoValid.toFixed(0)}%` : `${result.typicalVsNoValid.toFixed(0)}%`
    const vsZodStr = result.typicalVsZod >= 0 ? `+${result.typicalVsZod.toFixed(0)}%` : `${result.typicalVsZod.toFixed(0)}%`

    // vs Nothing: lower is better (less overhead = green)
    const coloredVsNoValid = colorValue(result.typicalVsNoValid, vsNoValidStr.padStart(11), true)
    // vs Zod: lower is better (negative = faster than zod = green)
    const coloredVsZod = colorValue(result.typicalVsZod, vsZodStr.padStart(10), true)

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
  console.log('vs Nothing = overhead vs no validation (lower is better)')
  console.log('vs Zod = negative means faster than zod (better)')
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
      () =>((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("number" === typeof _v.id)) throw new TypeError("Expected " + _n + ".id" + " to be number, got " + typeof _v.id); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("boolean" === typeof _v.active)) throw new TypeError("Expected " + _n + ".active" + " to be boolean, got " + typeof _v.active); return _v; })( JSON.parse(testSmallJson), " JSON.parse(testSmallJson)")/* as removed */ as SmallPayload,
      () => zodSmallPayload.parse(JSON.parse(testSmallJson)),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.parse (small+extras)',
      () => JSON.parse(testSmallWithExtrasJson),
      () =>((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("number" === typeof _v.id)) throw new TypeError("Expected " + _n + ".id" + " to be number, got " + typeof _v.id); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("boolean" === typeof _v.active)) throw new TypeError("Expected " + _n + ".active" + " to be boolean, got " + typeof _v.active); return _v; })( JSON.parse(testSmallWithExtrasJson), " JSON.parse(testSmallWithExtrasJson)")/* as removed */ as SmallPayload,
      () => zodSmallPayload.parse(JSON.parse(testSmallWithExtrasJson)),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.parse (medium)',
      () => JSON.parse(testMediumJson),
      () =>((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.id && /^.*?-.*?-.*?-.*?-.*?$/.test(_v.id))) throw new TypeError("Expected " + _n + ".id" + " to match `${string}\"-\"${string}\"-\"${string}\"-\"${string}\"-\"${string}`, got " + typeof _v.id); if (!("string" === typeof _v.email && /^.*?@.*?\..*?$/.test(_v.email))) throw new TypeError("Expected " + _n + ".email" + " to match `${string}\"@\"${string}\".\"${string}`, got " + typeof _v.email); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("number" === typeof _v.age)) throw new TypeError("Expected " + _n + ".age" + " to be number, got " + typeof _v.age); if (!Array.isArray(_v.tags)) throw new TypeError("Expected " + _n + ".tags" + " to be array, got " + typeof _v.tags); for (let _i0 = 0; _i0 < _v.tags.length; _i0++) { const _e0: any = _v.tags[_i0]; if (!("string" === typeof _e0)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + " to be string, got " + typeof _e0); } return _v; })( JSON.parse(testMediumJson), " JSON.parse(testMediumJson)")/* as removed */ as MediumPayload,
      () => zodMediumPayload.parse(JSON.parse(testMediumJson)),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.parse (large)',
      () => JSON.parse(testLargeJson),
      () =>((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.id && /^.*?-.*?-.*?-.*?-.*?$/.test(_v.id))) throw new TypeError("Expected " + _n + ".id" + " to match `${string}\"-\"${string}\"-\"${string}\"-\"${string}\"-\"${string}`, got " + typeof _v.id); if (!Array.isArray(_v.users)) throw new TypeError("Expected " + _n + ".users" + " to be array, got " + typeof _v.users); for (let _i0 = 0; _i0 < _v.users.length; _i0++) { const _e0: any = _v.users[_i0]; if (typeof _e0 !== "object" || _e0 === null) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + " to be object, got " + (_e0 === null ? "null" : typeof _e0)); if (!("string" === typeof _e0.id && /^.*?-.*?-.*?-.*?-.*?$/.test(_e0.id))) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".id" + " to match `${string}\"-\"${string}\"-\"${string}\"-\"${string}\"-\"${string}`, got " + typeof _e0.id); if (!("string" === typeof _e0.email && /^.*?@.*?\..*?$/.test(_e0.email))) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".email" + " to match `${string}\"@\"${string}\".\"${string}`, got " + typeof _e0.email); if (!("string" === typeof _e0.name)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".name" + " to be string, got " + typeof _e0.name); if (typeof _e0.profile !== "object" && typeof _e0.profile !== "function" && typeof _e0.profile !== "undefined") throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".profile" + " to be object, got " + typeof _e0.profile); } if (typeof _v.metadata !== "object" || _v.metadata === null) throw new TypeError("Expected " + _n + ".metadata" + " to be object, got " + (_v.metadata === null ? "null" : typeof _v.metadata)); if (!("string" === typeof _v.metadata.createdAt)) throw new TypeError("Expected " + _n + ".metadata" + ".createdAt" + " to be string, got " + typeof _v.metadata.createdAt); if (!("string" === typeof _v.metadata.updatedAt)) throw new TypeError("Expected " + _n + ".metadata" + ".updatedAt" + " to be string, got " + typeof _v.metadata.updatedAt); if (!("number" === typeof _v.metadata.version)) throw new TypeError("Expected " + _n + ".metadata" + ".version" + " to be number, got " + typeof _v.metadata.version); return _v; })( JSON.parse(testLargeJson), " JSON.parse(testLargeJson)")/* as removed */ as LargePayload,
      () => zodLargePayload.parse(JSON.parse(testLargeJson)),
    ),
  )

  results.push(
    await runBenchmark(
      'JSON.parse (1000 large)',
      () => JSON.parse(testLargeArrayJson),
      () =>((_v: any, _n: string) => { if (!Array.isArray(_v)) throw new TypeError("Expected " + _n + " to be array, got " + typeof _v); for (let _i0 = 0; _i0 < _v.length; _i0++) { const _e0: any = _v[_i0]; if (typeof _e0 !== "object" || _e0 === null) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + " to be object, got " + (_e0 === null ? "null" : typeof _e0)); if (!("string" === typeof _e0.id && /^.*?-.*?-.*?-.*?-.*?$/.test(_e0.id))) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".id" + " to match `${string}\"-\"${string}\"-\"${string}\"-\"${string}\"-\"${string}`, got " + typeof _e0.id); if (!Array.isArray(_e0.users)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".users" + " to be array, got " + typeof _e0.users); for (let _i1 = 0; _i1 < _e0.users.length; _i1++) { const _e1: any = _e0.users[_i1]; if (typeof _e1 !== "object" || _e1 === null) throw new TypeError("Expected " + _n + "[" + _i1 + "]" + " to be object, got " + (_e1 === null ? "null" : typeof _e1)); if (!("string" === typeof _e1.id && /^.*?-.*?-.*?-.*?-.*?$/.test(_e1.id))) throw new TypeError("Expected " + _n + "[" + _i1 + "]" + ".id" + " to match `${string}\"-\"${string}\"-\"${string}\"-\"${string}\"-\"${string}`, got " + typeof _e1.id); if (!("string" === typeof _e1.email && /^.*?@.*?\..*?$/.test(_e1.email))) throw new TypeError("Expected " + _n + "[" + _i1 + "]" + ".email" + " to match `${string}\"@\"${string}\".\"${string}`, got " + typeof _e1.email); if (!("string" === typeof _e1.name)) throw new TypeError("Expected " + _n + "[" + _i1 + "]" + ".name" + " to be string, got " + typeof _e1.name); if (typeof _e1.profile !== "object" && typeof _e1.profile !== "function" && typeof _e1.profile !== "undefined") throw new TypeError("Expected " + _n + "[" + _i1 + "]" + ".profile" + " to be object, got " + typeof _e1.profile); } if (typeof _e0.metadata !== "object" || _e0.metadata === null) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".metadata" + " to be object, got " + (_e0.metadata === null ? "null" : typeof _e0.metadata)); if (!("string" === typeof _e0.metadata.createdAt)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".metadata" + ".createdAt" + " to be string, got " + typeof _e0.metadata.createdAt); if (!("string" === typeof _e0.metadata.updatedAt)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".metadata" + ".updatedAt" + " to be string, got " + typeof _e0.metadata.updatedAt); if (!("number" === typeof _e0.metadata.version)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".metadata" + ".version" + " to be number, got " + typeof _e0.metadata.version); } return _v; })( JSON.parse(testLargeArrayJson), " JSON.parse(testLargeArrayJson)")/* as removed */ as LargePayload[],
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
