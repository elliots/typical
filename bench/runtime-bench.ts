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

// JSON types
import {
  parseSmall,
  parseMedium,
  parseLarge,
  parseLargeArray,
  noValidateParseSmall,
  noValidateParseMedium,
  noValidateParseLarge,
  noValidateParseLargeArray,
  zodParseSmall,
  zodParseMedium,
  zodParseLarge,
  zodParseLargeArray,
  stringifySmall,
  stringifyMedium,
  stringifyLarge,
  stringifyLargeArray,
  noValidateStringifySmall,
  noValidateStringifyMedium,
  noValidateStringifyLarge,
  noValidateStringifyLargeArray,
  zodStringifySmall,
  zodStringifyMedium,
  zodStringifyLarge,
  zodStringifyLargeArray,
  testSmallPayload,
  testMediumPayload,
  testLargePayload,
  testLargeArrayPayload,
  testSmallJson,
  testMediumJson,
  testLargeJson,
  testLargeArrayJson,
} from "./scenarios/json-types.js";

interface BenchmarkResult {
  name: string;
  noValidationOps: number;
  typicalOps: number;
  zodOps: number;
  typicalOverhead: number;
  zodOverhead: number;
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

  const typicalOverhead = typicalOps > 0 ? ((noValidationOps - typicalOps) / typicalOps) * 100 : 0;
  const zodOverhead = zodOps > 0 ? ((noValidationOps - zodOps) / zodOps) * 100 : 0;

  return {
    name,
    noValidationOps,
    typicalOps,
    zodOps,
    typicalOverhead,
    zodOverhead,
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

function printResults(results: BenchmarkResult[]) {
  console.log("\n");
  console.log("Runtime Validation Benchmark Results (typical vs zod)");
  console.log("======================================================");
  console.log("");

  // Calculate column widths
  const nameWidth = Math.max(...results.map((r) => r.name.length), 25);
  const opsWidth = 12;

  // Header
  console.log(
    "Scenario".padEnd(nameWidth) +
      " | " +
      "No Valid".padStart(opsWidth) +
      " | " +
      "Typical".padStart(opsWidth) +
      " | " +
      "Zod".padStart(opsWidth) +
      " | " +
      "Typical %".padStart(10) +
      " | " +
      "Zod %".padStart(10)
  );
  console.log("-".repeat(nameWidth + opsWidth * 3 + 35));

  // Results
  for (const result of results) {
    const typicalStr =
      result.typicalOverhead >= 0
        ? `+${result.typicalOverhead.toFixed(0)}%`
        : `${result.typicalOverhead.toFixed(0)}%`;
    const zodStr =
      result.zodOverhead >= 0
        ? `+${result.zodOverhead.toFixed(0)}%`
        : `${result.zodOverhead.toFixed(0)}%`;

    console.log(
      result.name.padEnd(nameWidth) +
        " | " +
        `${formatOps(result.noValidationOps)}/s`.padStart(opsWidth) +
        " | " +
        `${formatOps(result.typicalOps)}/s`.padStart(opsWidth) +
        " | " +
        `${formatOps(result.zodOps)}/s`.padStart(opsWidth) +
        " | " +
        typicalStr.padStart(10) +
        " | " +
        zodStr.padStart(10)
    );
  }

  console.log("");
  console.log("% = overhead compared to no validation (lower is better)");
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

  // JSON.parse benchmarks
  console.log("Benchmarking JSON.parse...");

  results.push(
    await runBenchmark(
      "JSON.parse (small)",
      () => noValidateParseSmall(testSmallJson),
      () => parseSmall(testSmallJson),
      () => zodParseSmall(testSmallJson)
    )
  );

  results.push(
    await runBenchmark(
      "JSON.parse (medium)",
      () => noValidateParseMedium(testMediumJson),
      () => parseMedium(testMediumJson),
      () => zodParseMedium(testMediumJson)
    )
  );

  results.push(
    await runBenchmark(
      "JSON.parse (large)",
      () => noValidateParseLarge(testLargeJson),
      () => parseLarge(testLargeJson),
      () => zodParseLarge(testLargeJson)
    )
  );

  results.push(
    await runBenchmark(
      "JSON.parse (1000 large)",
      () => noValidateParseLargeArray(testLargeArrayJson),
      () => parseLargeArray(testLargeArrayJson),
      () => zodParseLargeArray(testLargeArrayJson)
    )
  );

  // JSON.stringify benchmarks
  console.log("Benchmarking JSON.stringify...");

  results.push(
    await runBenchmark(
      "JSON.stringify (small)",
      () => noValidateStringifySmall(testSmallPayload),
      () => stringifySmall(testSmallPayload),
      () => zodStringifySmall(testSmallPayload)
    )
  );

  results.push(
    await runBenchmark(
      "JSON.stringify (medium)",
      () => noValidateStringifyMedium(testMediumPayload),
      () => stringifyMedium(testMediumPayload),
      () => zodStringifyMedium(testMediumPayload)
    )
  );

  results.push(
    await runBenchmark(
      "JSON.stringify (large)",
      () => noValidateStringifyLarge(testLargePayload),
      () => stringifyLarge(testLargePayload),
      () => zodStringifyLarge(testLargePayload)
    )
  );

  results.push(
    await runBenchmark(
      "JSON.stringify (1000 large)",
      () => noValidateStringifyLargeArray(testLargeArrayPayload),
      () => stringifyLargeArray(testLargeArrayPayload),
      () => zodStringifyLargeArray(testLargeArrayPayload)
    )
  );

  printResults(results);
}

main().catch(console.error);
