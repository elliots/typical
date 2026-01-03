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
export function validateTaskWithUnion(task: TaskWithUnion): TaskWithUnion { ((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("number" === typeof _v.id)) throw new TypeError("Expected " + _n + ".id" + " to be number, got " + typeof _v.id); if (!("string" === typeof _v.title)) throw new TypeError("Expected " + _n + ".title" + " to be string, got " + typeof _v.title); if (!(("active" === _v.status || "cancelled" === _v.status || "completed" === _v.status || "pending" === _v.status))) throw new TypeError("Expected " + _n + ".status" + " to be 'active' | 'cancelled' | 'completed' | 'pending', got " + typeof _v.status); if (!((1 === _v.priority || 2 === _v.priority || 3 === _v.priority || 4 === _v.priority || 5 === _v.priority))) throw new TypeError("Expected " + _n + ".priority" + " to be 1 | 2 | 3 | 4 | 5, got " + typeof _v.priority); return _v; })(task, "task");
  return((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("number" === typeof _v.id)) throw new TypeError("Expected " + _n + ".id" + " to be number, got " + typeof _v.id); if (!("string" === typeof _v.title)) throw new TypeError("Expected " + _n + ".title" + " to be string, got " + typeof _v.title); if (!(("active" === _v.status || "cancelled" === _v.status || "completed" === _v.status || "pending" === _v.status))) throw new TypeError("Expected " + _n + ".status" + " to be 'active' | 'cancelled' | 'completed' | 'pending', got " + typeof _v.status); if (!((1 === _v.priority || 2 === _v.priority || 3 === _v.priority || 4 === _v.priority || 5 === _v.priority))) throw new TypeError("Expected " + _n + ".priority" + " to be 1 | 2 | 3 | 4 | 5, got " + typeof _v.priority); return _v; })( task, "return value")
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
export function validateUserWithTemplates(user: UserWithTemplates): UserWithTemplates { ((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.id && /^.*?-.*?-.*?-.*?-.*?$/.test(_v.id))) throw new TypeError("Expected " + _n + ".id" + " to match `${string}\"-\"${string}\"-\"${string}\"-\"${string}\"-\"${string}`, got " + typeof _v.id); if (!("string" === typeof _v.email && /^.*?@.*?\..*?$/.test(_v.email))) throw new TypeError("Expected " + _n + ".email" + " to match `${string}\"@\"${string}\".\"${string}`, got " + typeof _v.email); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); return _v; })(user, "user");
  return((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.id && /^.*?-.*?-.*?-.*?-.*?$/.test(_v.id))) throw new TypeError("Expected " + _n + ".id" + " to match `${string}\"-\"${string}\"-\"${string}\"-\"${string}\"-\"${string}`, got " + typeof _v.id); if (!("string" === typeof _v.email && /^.*?@.*?\..*?$/.test(_v.email))) throw new TypeError("Expected " + _n + ".email" + " to match `${string}\"@\"${string}\".\"${string}`, got " + typeof _v.email); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); return _v; })( user, "return value")
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
export function validateComplexConfig(config: ComplexConfig): ComplexConfig { ((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("string" === typeof _v.version)) throw new TypeError("Expected " + _n + ".version" + " to be string, got " + typeof _v.version); if (typeof _v.settings !== "object" || _v.settings === null) throw new TypeError("Expected " + _n + ".settings" + " to be object, got " + (_v.settings === null ? "null" : typeof _v.settings)); if (!("boolean" === typeof _v.settings.enabled)) throw new TypeError("Expected " + _n + ".settings" + ".enabled" + " to be boolean, got " + typeof _v.settings.enabled); if (_v.settings.timeout !== undefined) { if (!((undefined === _v.settings.timeout || "number" === typeof _v.settings.timeout))) throw new TypeError("Expected " + _n + ".settings" + ".timeout" + " to be undefined | number, got " + typeof _v.settings.timeout); } if (_v.settings.retries !== undefined) { if (!((undefined === _v.settings.retries || "number" === typeof _v.settings.retries))) throw new TypeError("Expected " + _n + ".settings" + ".retries" + " to be undefined | number, got " + typeof _v.settings.retries); } if (_v.settings.options !== undefined) { if (!((undefined === _v.settings.options || ("object" === typeof _v.settings.options || "function" === typeof _v.settings.options || "undefined" === typeof _v.settings.options)))) throw new TypeError("Expected " + _n + ".settings" + ".options" + " to be undefined | �type, got " + typeof _v.settings.options); } if (_v.tags !== undefined) { if (!((undefined === _v.tags || Array.isArray(_v.tags) && _v.tags.every((elem: any) => "string" === typeof elem)))) throw new TypeError("Expected " + _n + ".tags" + " to be undefined | array, got " + typeof _v.tags); } return _v; })(config, "config");
  return((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("string" === typeof _v.version)) throw new TypeError("Expected " + _n + ".version" + " to be string, got " + typeof _v.version); if (typeof _v.settings !== "object" || _v.settings === null) throw new TypeError("Expected " + _n + ".settings" + " to be object, got " + (_v.settings === null ? "null" : typeof _v.settings)); if (!("boolean" === typeof _v.settings.enabled)) throw new TypeError("Expected " + _n + ".settings" + ".enabled" + " to be boolean, got " + typeof _v.settings.enabled); if (_v.settings.timeout !== undefined) { if (!((undefined === _v.settings.timeout || "number" === typeof _v.settings.timeout))) throw new TypeError("Expected " + _n + ".settings" + ".timeout" + " to be undefined | number, got " + typeof _v.settings.timeout); } if (_v.settings.retries !== undefined) { if (!((undefined === _v.settings.retries || "number" === typeof _v.settings.retries))) throw new TypeError("Expected " + _n + ".settings" + ".retries" + " to be undefined | number, got " + typeof _v.settings.retries); } if (_v.settings.options !== undefined) { if (!((undefined === _v.settings.options || ("object" === typeof _v.settings.options || "function" === typeof _v.settings.options || "undefined" === typeof _v.settings.options)))) throw new TypeError("Expected " + _n + ".settings" + ".options" + " to be undefined | �type, got " + typeof _v.settings.options); } if (_v.tags !== undefined) { if (!((undefined === _v.tags || Array.isArray(_v.tags) && _v.tags.every((elem: any) => "string" === typeof elem)))) throw new TypeError("Expected " + _n + ".tags" + " to be undefined | array, got " + typeof _v.tags); } return _v; })( config, "return value")
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
