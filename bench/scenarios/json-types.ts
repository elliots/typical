// JSON parse/stringify validation benchmarks
import { z } from "zod";

// Template literal types for realistic data
type Email = `${string}@${string}.${string}`;
type UUID = `${string}-${string}-${string}-${string}-${string}`;

// Small object for JSON operations
export interface SmallPayload {
  id: number;
  name: string;
  active: boolean;
}

// Medium object with template literals
export interface MediumPayload {
  id: UUID;
  email: Email;
  name: string;
  age: number;
  tags: string[];
}

// Large nested object
export interface LargePayload {
  id: UUID;
  users: Array<{
    id: UUID;
    email: Email;
    name: string;
    profile: {
      bio: string;
      website: `https://${string}`;
      social: {
        twitter?: string;
        github?: string;
      };
    };
  }>;
  metadata: {
    createdAt: string;
    updatedAt: string;
    version: number;
  };
}

// Zod schemas
const zodSmallPayload = z.object({
  id: z.number(),
  name: z.string(),
  active: z.boolean(),
});

const zodMediumPayload = z.object({
  id: z.string().regex(/^.+-.+-.+-.+-.+$/),
  email: z.string().regex(/^.+@.+\..+$/),
  name: z.string(),
  age: z.number(),
  tags: z.array(z.string()),
});

const zodLargePayload = z.object({
  id: z.string().regex(/^.+-.+-.+-.+-.+$/),
  users: z.array(z.object({
    id: z.string().regex(/^.+-.+-.+-.+-.+$/),
    email: z.string().regex(/^.+@.+\..+$/),
    name: z.string(),
    profile: z.object({
      bio: z.string(),
      website: z.string().regex(/^https:\/\/.+$/),
      social: z.object({
        twitter: z.string().optional(),
        github: z.string().optional(),
      }),
    }),
  })),
  metadata: z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
    version: z.number(),
  }),
});

// === JSON.parse functions ===

// Typical - will be transformed to use typia.json.assertParse
export function parseSmall(json: string): SmallPayload {
  return JSON.parse(json);
}

export function parseMedium(json: string): MediumPayload {
  return JSON.parse(json);
}

export function parseLarge(json: string): LargePayload {
  return JSON.parse(json);
}

// No validation baseline
export function noValidateParseSmall(json: any): any {
  return JSON.parse(json);
}

export function noValidateParseMedium(json: any): any {
  return JSON.parse(json);
}

export function noValidateParseLarge(json: any): any {
  return JSON.parse(json);
}

// Zod validation
export function zodParseSmall(json: any): any {
  return zodSmallPayload.parse(JSON.parse(json));
}

export function zodParseMedium(json: any): any {
  return zodMediumPayload.parse(JSON.parse(json));
}

export function zodParseLarge(json: any): any {
  return zodLargePayload.parse(JSON.parse(json));
}

// === JSON.stringify functions ===

// Typical - will be transformed to use typia.json.stringify
export function stringifySmall(data: SmallPayload): string {
  return JSON.stringify(data);
}

export function stringifyMedium(data: MediumPayload): string {
  return JSON.stringify(data);
}

export function stringifyLarge(data: LargePayload): string {
  return JSON.stringify(data);
}

// No validation baseline
export function noValidateStringifySmall(data: any): any {
  return JSON.stringify(data);
}

export function noValidateStringifyMedium(data: any): any {
  return JSON.stringify(data);
}

export function noValidateStringifyLarge(data: any): any {
  return JSON.stringify(data);
}

// Zod validation (validate then stringify)
export function zodStringifySmall(data: any): any {
  return JSON.stringify(zodSmallPayload.parse(data));
}

export function zodStringifyMedium(data: any): any {
  return JSON.stringify(zodMediumPayload.parse(data));
}

export function zodStringifyLarge(data: any): any {
  return JSON.stringify(zodLargePayload.parse(data));
}

// === Large array (1000 items) ===

const zodLargeArray = z.array(zodLargePayload);

// Typical
export function parseLargeArray(json: string): LargePayload[] {
  return JSON.parse(json);
}

export function stringifyLargeArray(data: LargePayload[]): string {
  return JSON.stringify(data);
}

// No validation baseline
export function noValidateParseLargeArray(json: any): any {
  return JSON.parse(json);
}

export function noValidateStringifyLargeArray(data: any): any {
  return JSON.stringify(data);
}

// Zod validation
export function zodParseLargeArray(json: any): any {
  return zodLargeArray.parse(JSON.parse(json));
}

export function zodStringifyLargeArray(data: any): any {
  return JSON.stringify(zodLargeArray.parse(data));
}

// Test data
export const testSmallPayload: SmallPayload = {
  id: 1,
  name: "Test Item",
  active: true,
};

export const testMediumPayload: MediumPayload = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  email: "user@example.com",
  name: "John Doe",
  age: 30,
  tags: ["developer", "typescript", "nodejs"],
};

export const testLargePayload: LargePayload = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  users: Array.from({ length: 10 }, (_, i) => ({
    id: `user-${i}-uuid-part-here`,
    email: `user${i}@example.com`,
    name: `User ${i}`,
    profile: {
      bio: `This is the bio for user ${i}. It contains some text to make it more realistic.`,
      website: `https://user${i}.example.com`,
      social: {
        twitter: `@user${i}`,
        github: `user${i}`,
      },
    },
  })),
  metadata: {
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-06-15T12:30:00Z",
    version: 42,
  },
};

// Large array of 1000 LargePayload items
export const testLargeArrayPayload: LargePayload[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `batch-${i}-uuid-part-here`,
  users: Array.from({ length: 10 }, (_, j) => ({
    id: `user-${i}-${j}-uuid-here`,
    email: `user${j}@batch${i}.com`,
    name: `User ${j} of Batch ${i}`,
    profile: {
      bio: `Bio for user ${j} in batch ${i}. Some additional text here.`,
      website: `https://user${j}-batch${i}.example.com`,
      social: {
        twitter: `@user${j}b${i}`,
        github: `user${j}b${i}`,
      },
    },
  })),
  metadata: {
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-06-15T12:30:00Z",
    version: i,
  },
}));

// Pre-stringified JSON for parse benchmarks
export const testSmallJson = JSON.stringify(testSmallPayload);
export const testMediumJson = JSON.stringify(testMediumPayload);
export const testLargeJson = JSON.stringify(testLargePayload);
export const testLargeArrayJson = JSON.stringify(testLargeArrayPayload);
