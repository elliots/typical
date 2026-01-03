// Simple object validation benchmarks
import { z } from 'zod'

// Template literal types
type Email = `${string}@${string}.${string}`
type PhoneNumber = `+${number}`

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
export function validateSimpleUser(user: SimpleUser): SimpleUser { ((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("number" === typeof _v.age)) throw new TypeError("Expected " + _n + ".age" + " to be number, got " + typeof _v.age); if (!("boolean" === typeof _v.active)) throw new TypeError("Expected " + _n + ".active" + " to be boolean, got " + typeof _v.active); if (!("string" === typeof _v.email && /^.*?@.*?\..*?$/.test(_v.email))) throw new TypeError("Expected " + _n + ".email" + " to match `${string}\"@\"${string}\".\"${string}`, got " + typeof _v.email); if (!("string" === typeof _v.phone && /^\+-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(_v.phone))) throw new TypeError("Expected " + _n + ".phone" + " to match `\"+\"${number}`, got " + typeof _v.phone); return _v; })(user, "user");
  return((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("number" === typeof _v.age)) throw new TypeError("Expected " + _n + ".age" + " to be number, got " + typeof _v.age); if (!("boolean" === typeof _v.active)) throw new TypeError("Expected " + _n + ".active" + " to be boolean, got " + typeof _v.active); if (!("string" === typeof _v.email && /^.*?@.*?\..*?$/.test(_v.email))) throw new TypeError("Expected " + _n + ".email" + " to match `${string}\"@\"${string}\".\"${string}`, got " + typeof _v.email); if (!("string" === typeof _v.phone && /^\+-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(_v.phone))) throw new TypeError("Expected " + _n + ".phone" + " to match `\"+\"${number}`, got " + typeof _v.phone); return _v; })( user, "return value")
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
