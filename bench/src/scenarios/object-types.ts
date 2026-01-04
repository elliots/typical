// Simple object validation benchmarks
import { z } from 'zod'

// Template literal types
type Email = `${string}@${string}.${string}`
type PhoneNumber = `+${bigint}`

export interface SimpleUser {
  name: string
  age: number
  active: boolean
  email: Email
  phone: PhoneNumber
}

// Zod schema
const zodSimpleUser = z.object({
  name: z.string(),
  age: z.number(),
  active: z.boolean(),
  email: z.string().regex(/^.+@.+\..+$/),
  phone: z.string().regex(/^\+\d+$/),
})

// Typical validation
export function validateSimpleUser(user: SimpleUser): SimpleUser {
  return user
}

// No-validation baseline
export function noValidateSimpleUser(user: any): any {
  return user
}

// Zod validation - use 'any' return type so typical won't add validation
export function zodValidateSimpleUser(user: any): any {
  return zodSimpleUser.parse(user)
}

// Test data
export const testSimpleUser: SimpleUser = {
  name: 'Alice',
  age: 30,
  active: true,
  email: 'alice@example.com',
  phone: '+1234567890',
}
