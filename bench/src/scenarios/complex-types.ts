// Complex type validation benchmarks (unions, generics, template literals)
import { z } from 'zod'

// Union types
export type Status = 'pending' | 'active' | 'completed' | 'cancelled'

export interface TaskWithUnion {
  id: number
  title: string
  status: Status
  priority: 1 | 2 | 3 | 4 | 5
}

// Zod schemas
const zodTaskWithUnion = z.object({
  id: z.number(),
  title: z.string(),
  status: z.enum(['pending', 'active', 'completed', 'cancelled']),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
})

// Typical validation
export function validateTaskWithUnion(task: TaskWithUnion): TaskWithUnion {
  return task
}

// No-validation baseline
export function noValidateTaskWithUnion(task: any): any {
  return task
}

// Zod validation - use 'any' return type so typical won't add validation
export function zodValidateTaskWithUnion(task: any): any {
  return zodTaskWithUnion.parse(task)
}

// Template literal types
export type Email = `${string}@${string}.${string}`
export type UUID = `${string}-${string}-${string}-${string}-${string}`

export interface UserWithTemplates {
  id: UUID
  email: Email
  name: string
}

// Zod schema for templates (using regex approximation)
const zodUserWithTemplates = z.object({
  id: z.string().regex(/^.+-.+-.+-.+-.+$/),
  email: z.string().regex(/^.+@.+\..+$/),
  name: z.string(),
})

// Typical validation
export function validateUserWithTemplates(user: UserWithTemplates): UserWithTemplates {
  return user
}

// No-validation baseline
export function noValidateUserWithTemplates(user: any): any {
  return user
}

// Zod validation - use 'any' return type so typical won't add validation
export function zodValidateUserWithTemplates(user: any): any {
  return zodUserWithTemplates.parse(user)
}

// Complex nested with optionals
export interface ComplexConfig {
  name: string
  version: string
  settings: {
    enabled: boolean
    timeout?: number
    retries?: number
    options?: {
      debug?: boolean
      verbose?: boolean
      logLevel?: 'error' | 'warn' | 'info' | 'debug'
    }
  }
  tags?: string[]
}

// Zod schema for complex config
const zodComplexConfig = z.object({
  name: z.string(),
  version: z.string(),
  settings: z.object({
    enabled: z.boolean(),
    timeout: z.number().optional(),
    retries: z.number().optional(),
    options: z
      .object({
        debug: z.boolean().optional(),
        verbose: z.boolean().optional(),
        logLevel: z.enum(['error', 'warn', 'info', 'debug']).optional(),
      })
      .optional(),
  }),
  tags: z.array(z.string()).optional(),
})

// Typical validation
export function validateComplexConfig(config: ComplexConfig): ComplexConfig {
  return config
}

// No-validation baseline
export function noValidateComplexConfig(config: any): any {
  return config
}

// Zod validation - use 'any' return type so typical won't add validation
export function zodValidateComplexConfig(config: any): any {
  return zodComplexConfig.parse(config)
}

// Test data
export const testTaskWithUnion: TaskWithUnion = {
  id: 1,
  title: 'Complete project',
  status: 'active',
  priority: 2,
}

export const testUserWithTemplates: UserWithTemplates = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  name: 'Test User',
}

export const testComplexConfig: ComplexConfig = {
  name: 'my-app',
  version: '1.0.0',
  settings: {
    enabled: true,
    timeout: 5000,
    retries: 3,
    options: {
      debug: true,
      verbose: false,
      logLevel: 'info',
    },
  },
  tags: ['production', 'v1'],
}
