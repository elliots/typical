import { Bench } from "tinybench";

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
} from "./scenarios/primitive-types.js";

// Object types
import {
  validateSimpleUser,
  noValidateSimpleUser,
  zodValidateSimpleUser,
  testSimpleUser,
} from "./scenarios/object-types.js";

// Nested types
import {
  validateNestedUser,
  noValidateNestedUser,
  zodValidateNestedUser,
  testNestedUser,
} from "./scenarios/nested-types.js";

// Array types
import {
  validateArray,
  noValidateArray,
  zodValidateArray,
  testArray10,
  testArray100,
} from "./scenarios/array-types.js";

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
} from "./scenarios/complex-types.js";

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
} from "./scenarios/json-types.js";
import type {
  LargePayload,
  MediumPayload,
  SmallPayload,
} from "./scenarios/json-types.js";

interface BenchmarkResult {
  name: string;
  noValidationOps: number;
  typicalOps: number;
  zodOps: number;
  typicalVsNoValid: number; // % overhead vs no validation
  typicalVsZod: number; // % faster/slower vs zod
}

async function runBenchmark(
  name: string,
  noValidationFn: () => void,
  typicalFn: () => void,
  zodFn: () => void
): Promise<BenchmarkResult> {
  const bench = new Bench({ time: 100, warmupTime: 20, iterations: 100 });

  bench
    .add("no-validation", noValidationFn)
    .add("typical", typicalFn)
    .add("zod", zodFn);

  await bench.run();

  const noValidation = bench.tasks.find((t) => t.name === "no-validation")!;
  const typical = bench.tasks.find((t) => t.name === "typical")!;
  const zod = bench.tasks.find((t) => t.name === "zod")!;

  // tinybench v6+ uses throughput.mean instead of hz
  const noValidationResult = noValidation.result as any;
  const typicalResult = typical.result as any;
  const zodResult = zod.result as any;

  const noValidationOps = noValidationResult.throughput?.mean ?? noValidationResult.hz ?? 0;
  const typicalOps = typicalResult.throughput?.mean ?? typicalResult.hz ?? 0;
  const zodOps = zodResult.throughput?.mean ?? zodResult.hz ?? 0;

  const typicalVsNoValid = typicalOps > 0 ? ((noValidationOps - typicalOps) / typicalOps) * 100 : 0;
  const typicalVsZod = zodOps > 0 ? ((zodOps - typicalOps) / zodOps) * 100 : 0;

  return {
    name,
    noValidationOps,
    typicalOps,
    zodOps,
    typicalVsNoValid,
    typicalVsZod,
  };
}

function formatOps(ops: number): string {
  if (ops >= 1_000_000) {
    return `${(ops / 1_000_000).toFixed(2)}M`;
  } else if (ops >= 1_000) {
    return `${(ops / 1_000).toFixed(2)}K`;
  }
  return ops.toFixed(0);
}

// ANSI color codes
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

// Color a value based on whether lower is better or higher is better
function colorValue(value: number, text: string, lowerIsBetter: boolean, threshold = 5): string {
  const isNeutral = Math.abs(value) <= threshold;
  if (isNeutral) {
    return `${colors.yellow}${text}${colors.reset}`;
  }
  const isGood = lowerIsBetter ? value < 0 : value > 0;
  const color = isGood ? colors.green : colors.red;
  return `${color}${text}${colors.reset}`;
}

function printResults(results: BenchmarkResult[]) {
  console.log("\n");
  console.log("Runtime Validation Benchmark Results");
  console.log("=====================================");
  console.log("");

  // Calculate column widths
  const nameWidth = Math.max(...results.map((r) => r.name.length), 25);
  const opsWidth = 12;

  // Header
  console.log(
    "Scenario".padEnd(nameWidth) +
      " | " +
      "Nothing".padStart(opsWidth) +
      " | " +
      "Typical".padStart(opsWidth) +
      " | " +
      "Zod".padStart(opsWidth) +
      " | " +
      "vs Nothing".padStart(11) +
      " | " +
      "vs Zod".padStart(10)
  );
  console.log("-".repeat(nameWidth + opsWidth * 3 + 36));

  // Results
  for (const result of results) {
    const vsNoValidStr =
      result.typicalVsNoValid >= 0
        ? `+${result.typicalVsNoValid.toFixed(0)}%`
        : `${result.typicalVsNoValid.toFixed(0)}%`;
    const vsZodStr =
      result.typicalVsZod >= 0
        ? `+${result.typicalVsZod.toFixed(0)}%`
        : `${result.typicalVsZod.toFixed(0)}%`;

    // vs Nothing: lower is better (less overhead = green)
    const coloredVsNoValid = colorValue(result.typicalVsNoValid, vsNoValidStr.padStart(11), true);
    // vs Zod: lower is better (negative = faster than zod = green)
    const coloredVsZod = colorValue(result.typicalVsZod, vsZodStr.padStart(10), true);

    console.log(
      result.name.padEnd(nameWidth) +
        " | " +
        `${formatOps(result.noValidationOps)}/s`.padStart(opsWidth) +
        " | " +
        `${formatOps(result.typicalOps)}/s`.padStart(opsWidth) +
        " | " +
        `${formatOps(result.zodOps)}/s`.padStart(opsWidth) +
        " | " +
        coloredVsNoValid +
        " | " +
        coloredVsZod
    );
  }

  console.log("");
  console.log("vs Nothing = overhead vs no validation (lower is better)");
  console.log("vs Zod = negative means faster than zod (better)");
  console.log("");
}

async function main() {
  console.log("Starting runtime validation benchmarks...");
  console.log("Comparing: No validation vs Typical (typia) vs Zod\n");

  const results: BenchmarkResult[] = [];

  // Primitive types
  console.log("Benchmarking primitive types...");

  results.push(
    await runBenchmark(
      "string",
      () => noValidateString(testString),
      () => validateString(testString),
      () => zodValidateString(testString)
    )
  );

  results.push(
    await runBenchmark(
      "number",
      () => noValidateNumber(testNumber),
      () => validateNumber(testNumber),
      () => zodValidateNumber(testNumber)
    )
  );

  results.push(
    await runBenchmark(
      "boolean",
      () => noValidateBoolean(testBoolean),
      () => validateBoolean(testBoolean),
      () => zodValidateBoolean(testBoolean)
    )
  );

  // Object types
  console.log("Benchmarking object types...");

  results.push(
    await runBenchmark(
      "object w/ template literals",
      () => noValidateSimpleUser(testSimpleUser),
      () => validateSimpleUser(testSimpleUser),
      () => zodValidateSimpleUser(testSimpleUser)
    )
  );

  results.push(
    await runBenchmark(
      "nested w/ template literals",
      () => noValidateNestedUser(testNestedUser),
      () => validateNestedUser(testNestedUser),
      () => zodValidateNestedUser(testNestedUser)
    )
  );

  // Array types
  console.log("Benchmarking array types...");

  results.push(
    await runBenchmark(
      "array w/ templates (10)",
      () => noValidateArray(testArray10),
      () => validateArray(testArray10),
      () => zodValidateArray(testArray10)
    )
  );

  results.push(
    await runBenchmark(
      "array w/ templates (100)",
      () => noValidateArray(testArray100),
      () => validateArray(testArray100),
      () => zodValidateArray(testArray100)
    )
  );

  // Complex types
  console.log("Benchmarking complex types...");

  results.push(
    await runBenchmark(
      "union types",
      () => noValidateTaskWithUnion(testTaskWithUnion),
      () => validateTaskWithUnion(testTaskWithUnion),
      () => zodValidateTaskWithUnion(testTaskWithUnion)
    )
  );

  results.push(
    await runBenchmark(
      "template literals",
      () => noValidateUserWithTemplates(testUserWithTemplates),
      () => validateUserWithTemplates(testUserWithTemplates),
      () => zodValidateUserWithTemplates(testUserWithTemplates)
    )
  );

  results.push(
    await runBenchmark(
      "complex config",
      () => noValidateComplexConfig(testComplexConfig),
      () => validateComplexConfig(testComplexConfig),
      () => zodValidateComplexConfig(testComplexConfig)
    )
  );

  // JSON.parse benchmarks - direct calls without function wrapper overhead
  console.log("Benchmarking JSON.parse...");

  results.push(
    await runBenchmark(
      "JSON.parse (small)",
      () => JSON.parse(testSmallJson),
      () => JSON.parse(testSmallJson) as SmallPayload,
      () => zodSmallPayload.parse(JSON.parse(testSmallJson))
    )
  );

  results.push(
    await runBenchmark(
      "JSON.parse (small+extras)",
      () => JSON.parse(testSmallWithExtrasJson),
      () => JSON.parse(testSmallWithExtrasJson) as SmallPayload,
      () => zodSmallPayload.parse(JSON.parse(testSmallWithExtrasJson))
    )
  );

  results.push(
    await runBenchmark(
      "JSON.parse (medium)",
      () => JSON.parse(testMediumJson),
      () => JSON.parse(testMediumJson) as MediumPayload,
      () => zodMediumPayload.parse(JSON.parse(testMediumJson))
    )
  );

  results.push(
    await runBenchmark(
      "JSON.parse (large)",
      () => JSON.parse(testLargeJson),
      () => JSON.parse(testLargeJson) as LargePayload,
      () => zodLargePayload.parse(JSON.parse(testLargeJson))
    )
  );

  results.push(
    await runBenchmark(
      "JSON.parse (1000 large)",
      () => JSON.parse(testLargeArrayJson),
      () => JSON.parse(testLargeArrayJson) as LargePayload[],
      () => zodLargeArray.parse(JSON.parse(testLargeArrayJson))
    )
  );

  // JSON.stringify benchmarks - direct calls without function wrapper overhead
  console.log("Benchmarking JSON.stringify...");

  results.push(
    await runBenchmark(
      "JSON.stringify (small)",
      () => JSON.stringify(testSmallPayload as any),
      () => JSON.stringify(testSmallPayload),
      () => JSON.stringify(zodSmallPayload.parse(testSmallPayload) as any)
    )
  );

  results.push(
    await runBenchmark(
      "JSON.stringify (small+extras)",
      () => JSON.stringify(testSmallPayloadWithExtras as any),
      () => JSON.stringify(testSmallPayloadWithExtras),
      () => JSON.stringify(zodSmallPayload.parse(testSmallPayloadWithExtras) as any)
    )
  );

  results.push(
    await runBenchmark(
      "JSON.stringify (medium)",
      () => JSON.stringify(testMediumPayload as any),
      () => JSON.stringify(testMediumPayload),
      () => JSON.stringify(zodMediumPayload.parse(testMediumPayload) as any)
    )
  );

  results.push(
    await runBenchmark(
      "JSON.stringify (large)",
      () => JSON.stringify(testLargePayload as any),
      () => JSON.stringify(testLargePayload),
      () => JSON.stringify(zodLargePayload.parse(testLargePayload) as any)
    )
  );

  results.push(
    await runBenchmark(
      "JSON.stringify (1000 large)",
      () => JSON.stringify(testLargeArrayPayload as any),
      () => JSON.stringify(testLargeArrayPayload),
      () => JSON.stringify(zodLargeArray.parse(testLargeArrayPayload) as any)
    )
  );

  printResults(results);
}

main().catch(console.error);
