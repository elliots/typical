// JSON parse/stringify validation benchmarks
import { z } from 'zod'

// Template literal types for realistic data
type Email = `${string}@${string}.${string}`
type UUID = `${string}-${string}-${string}-${string}-${string}`

// Small object for JSON operations
export interface SmallPayload {
  id: number
  name: string
  active: boolean
}

// Medium object with template literals
export interface MediumPayload {
  id: UUID
  email: Email
  name: string
  age: number
  tags: string[]
}

// Large nested object
export interface LargePayload {
  id: UUID
  users: Array<{
    id: UUID
    email: Email
    name: string
    profile: {
      bio: string
      website: `https://${string}`
      social: {
        twitter?: string
        github?: string
      }
    }
  }>
  metadata: {
    createdAt: string
    updatedAt: string
    version: number
  }
}

// Zod schemas - exported for direct use in benchmarks
export const zodSmallPayload = z.object({
  id: z.number(),
  name: z.string(),
  active: z.boolean(),
})

export const zodMediumPayload = z.object({
  id: z.string().regex(/^.+-.+-.+-.+-.+$/),
  email: z.string().regex(/^.+@.+\..+$/),
  name: z.string(),
  age: z.number(),
  tags: z.array(z.string()),
})

export const zodLargePayload = z.object({
  id: z.string().regex(/^.+-.+-.+-.+-.+$/),
  users: z.array(
    z.object({
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
    }),
  ),
  metadata: z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
    version: z.number(),
  }),
})

export const zodLargeArray = z.array(zodLargePayload)

// Test data
export const testSmallPayload: SmallPayload = {
  id: 1,
  name: 'Test Item',
  active: true,
}

export const testMediumPayload: MediumPayload = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'user@example.com',
  name: 'John Doe',
  age: 30,
  tags: ['developer', 'typescript', 'nodejs'],
}

export const testLargePayload: LargePayload = {
  id: '550e8400-e29b-41d4-a716-446655440000',
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
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-15T12:30:00Z',
    version: 42,
  },
}

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
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-15T12:30:00Z',
    version: i,
  },
}))

// Small payload with 10 extra fields not in the type
export const testSmallPayloadWithExtras: SmallPayload =((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("number" === typeof _v.id)) throw new TypeError("Expected " + _n + ".id" + " to be number, got " + typeof _v.id); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("boolean" === typeof _v.active)) throw new TypeError("Expected " + _n + ".active" + " to be boolean, got " + typeof _v.active); return _v; })( {
  ...testSmallPayload,
  extra1: 'extra value 1',
  extra2: 12345,
  extra3: true,
  extra4: ['a', 'b', 'c'],
  extra5: { nested: 'object' },
  extra6: 'another string',
  extra7: 99999,
  extra8: false,
  extra9: null,
  extra10: 'final extra',
} as unknown, " {\n  ...testSmallPayload,\n  extra1: 'extra value 1',\n  extra2: 12345,\n  extra3: true,\n  extra4: ['a', 'b', 'c'],\n  extra5: { nested: 'object' },\n  extra6: 'another string',\n  extra7: 99999,\n  extra8: false,\n  extra9: null,\n  extra10: 'final extra',\n} as unknown")/* as removed */ as SmallPayload

// Pre-stringified JSON for parse benchmarks
export const testSmallJson = JSON.stringify(testSmallPayload)
export const testMediumJson = JSON.stringify(testMediumPayload)
export const testLargeJson = JSON.stringify(testLargePayload)
export const testLargeArrayJson = JSON.stringify(testLargeArrayPayload)
export const testSmallWithExtrasJson = JSON.stringify(testSmallPayloadWithExtras)
