import { Bench } from "tinybench";
import { z } from "zod";

// Primitive types
import {
  validateString,
  validateNumber,
  validateBoolean,
  noValidateString,
  noValidateNumber,
  noValidateBoolean,
  testString,
  testNumber,
  testBoolean,
} from "./scenarios/primitive-types.js";

// Object types
import {
  validateSimpleUser,
  noValidateSimpleUser,
  testSimpleUser,
} from "./scenarios/object-types.js";

// Nested types
import {
  validateNestedUser,
  noValidateNestedUser,
  testNestedUser,
} from "./scenarios/nested-types.js";

// Array types
import {
  validateArray,
  noValidateArray,
  testArray10,
  testArray100,
} from "./scenarios/array-types.js";

// Complex types
import {
  validateTaskWithUnion,
  noValidateTaskWithUnion,
  validateUserWithTemplates,
  noValidateUserWithTemplates,
  validateComplexConfig,
  noValidateComplexConfig,
  testTaskWithUnion,
  testUserWithTemplates,
  testComplexConfig,
} from "./scenarios/complex-types.js";

// Zod schemas for comparison
const zodString = z.string();
const zodNumber = z.number();
const zodBoolean = z.boolean();

const zodSimpleUser = z.object({
  name: z.string(),
  age: z.number(),
  active: z.boolean(),
});

const zodAddress = z.object({
  street: z.string(),
  city: z.string(),
  country: z.string(),
  zip: z.string(),
});

const zodCompany = z.object({
  name: z.string(),
  address: zodAddress,
});

const zodNestedUser = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string(),
  address: zodAddress,
  company: zodCompany,
});

const zodArrayItem = z.object({
  id: z.number(),
  name: z.string(),
  value: z.number(),
});

const zodArray = z.array(zodArrayItem);

const zodTaskWithUnion = z.object({
  id: z.number(),
  title: z.string(),
  status: z.enum(["pending", "active", "completed", "cancelled"]),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
});

const zodUserWithTemplates = z.object({
  id: z.string().regex(/^.+-.+-.+-.+-.+$/),
  email: z.string().regex(/^.+@.+\..+$/),
  name: z.string(),
});

const zodComplexConfig = z.object({
  name: z.string(),
  version: z.string(),
  settings: z.object({
    enabled: z.boolean(),
    timeout: z.number().optional(),
    retries: z.number().optional(),
    options: z.object({
      debug: z.boolean().optional(),
      verbose: z.boolean().optional(),
      logLevel: z.enum(["error", "warn", "info", "debug"]).optional(),
    }).optional(),
  }),
  tags: z.array(z.string()).optional(),
});

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
  const bench = new Bench({ time: 500, warmupTime: 50, iterations: 1000 });

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
      () => zodString.parse(testString)
    )
  );

  results.push(
    await runBenchmark(
      "number",
      () => noValidateNumber(testNumber),
      () => validateNumber(testNumber),
      () => zodNumber.parse(testNumber)
    )
  );

  results.push(
    await runBenchmark(
      "boolean",
      () => noValidateBoolean(testBoolean),
      () => validateBoolean(testBoolean),
      () => zodBoolean.parse(testBoolean)
    )
  );

  // Object types
  console.log("Benchmarking object types...");

  results.push(
    await runBenchmark(
      "simple object (3 fields)",
      () => noValidateSimpleUser(testSimpleUser),
      () => validateSimpleUser(testSimpleUser),
      () => zodSimpleUser.parse(testSimpleUser)
    )
  );

  results.push(
    await runBenchmark(
      "nested object (3 levels)",
      () => noValidateNestedUser(testNestedUser),
      () => validateNestedUser(testNestedUser),
      () => zodNestedUser.parse(testNestedUser)
    )
  );

  // Array types
  console.log("Benchmarking array types...");

  results.push(
    await runBenchmark(
      "array (10 items)",
      () => noValidateArray(testArray10),
      () => validateArray(testArray10),
      () => zodArray.parse(testArray10)
    )
  );

  results.push(
    await runBenchmark(
      "array (100 items)",
      () => noValidateArray(testArray100),
      () => validateArray(testArray100),
      () => zodArray.parse(testArray100)
    )
  );

  // Complex types
  console.log("Benchmarking complex types...");

  results.push(
    await runBenchmark(
      "union types",
      () => noValidateTaskWithUnion(testTaskWithUnion),
      () => validateTaskWithUnion(testTaskWithUnion),
      () => zodTaskWithUnion.parse(testTaskWithUnion)
    )
  );

  results.push(
    await runBenchmark(
      "template literals",
      () => noValidateUserWithTemplates(testUserWithTemplates),
      () => validateUserWithTemplates(testUserWithTemplates),
      () => zodUserWithTemplates.parse(testUserWithTemplates)
    )
  );

  results.push(
    await runBenchmark(
      "complex config",
      () => noValidateComplexConfig(testComplexConfig),
      () => validateComplexConfig(testComplexConfig),
      () => zodComplexConfig.parse(testComplexConfig)
    )
  );

  printResults(results);
}

main().catch(console.error);
