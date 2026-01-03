// Nested object validation benchmarks
import { z } from 'zod'

// Template literal types
type Email = `${string}@${string}.${string}`
type ZipCode = `${number}`
type CountryCode = `${string}-${string}`

export interface Address {
  street: string
  city: string
  country: CountryCode
  zip: ZipCode
}

export interface Company {
  name: string
  address: Address
  website: `https://${string}`
}

export interface NestedUser {
  name: string
  age: number
  email: Email
  address: Address
  company: Company
}

// Zod schemas
const zodAddress = z.object({
  street: z.string(),
  city: z.string(),
  country: z.string().regex(/^.+-.+$/),
  zip: z.string().regex(/^\d+$/),
})

const zodCompany = z.object({
  name: z.string(),
  address: zodAddress,
  website: z.string().regex(/^https:\/\/.+$/),
})

const zodNestedUser = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().regex(/^.+@.+\..+$/),
  address: zodAddress,
  company: zodCompany,
})

// Typical validation
export function validateNestedUser(user: NestedUser): NestedUser { ((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("number" === typeof _v.age)) throw new TypeError("Expected " + _n + ".age" + " to be number, got " + typeof _v.age); if (!("string" === typeof _v.email && /^.*?@.*?\..*?$/.test(_v.email))) throw new TypeError("Expected " + _n + ".email" + " to match `${string}\"@\"${string}\".\"${string}`, got " + typeof _v.email); if (typeof _v.address !== "object" || _v.address === null) throw new TypeError("Expected " + _n + ".address" + " to be object, got " + (_v.address === null ? "null" : typeof _v.address)); if (!("string" === typeof _v.address.street)) throw new TypeError("Expected " + _n + ".address" + ".street" + " to be string, got " + typeof _v.address.street); if (!("string" === typeof _v.address.city)) throw new TypeError("Expected " + _n + ".address" + ".city" + " to be string, got " + typeof _v.address.city); if (!("string" === typeof _v.address.country && /^.*?-.*?$/.test(_v.address.country))) throw new TypeError("Expected " + _n + ".address" + ".country" + " to match `${string}\"-\"${string}`, got " + typeof _v.address.country); if (!("string" === typeof _v.address.zip && /^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(_v.address.zip))) throw new TypeError("Expected " + _n + ".address" + ".zip" + " to match `${number}`, got " + typeof _v.address.zip); if (typeof _v.company !== "object" || _v.company === null) throw new TypeError("Expected " + _n + ".company" + " to be object, got " + (_v.company === null ? "null" : typeof _v.company)); if (!("string" === typeof _v.company.name)) throw new TypeError("Expected " + _n + ".company" + ".name" + " to be string, got " + typeof _v.company.name); if (typeof _v.company.address !== "object" || _v.company.address === null) throw new TypeError("Expected " + _n + ".company" + ".address" + " to be object, got " + (_v.company.address === null ? "null" : typeof _v.company.address)); if (!("string" === typeof _v.company.address.street)) throw new TypeError("Expected " + _n + ".company" + ".address" + ".street" + " to be string, got " + typeof _v.company.address.street); if (!("string" === typeof _v.company.address.city)) throw new TypeError("Expected " + _n + ".company" + ".address" + ".city" + " to be string, got " + typeof _v.company.address.city); if (!("string" === typeof _v.company.address.country && /^.*?-.*?$/.test(_v.company.address.country))) throw new TypeError("Expected " + _n + ".company" + ".address" + ".country" + " to match `${string}\"-\"${string}`, got " + typeof _v.company.address.country); if (!("string" === typeof _v.company.address.zip && /^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(_v.company.address.zip))) throw new TypeError("Expected " + _n + ".company" + ".address" + ".zip" + " to match `${number}`, got " + typeof _v.company.address.zip); if (!("string" === typeof _v.company.website && _v.company.website.startsWith("https://"))) throw new TypeError("Expected " + _n + ".company" + ".website" + " to match `\"https://\"${string}`, got " + typeof _v.company.website); return _v; })(user, "user");
  return((_v: any, _n: string) => { if (typeof _v !== "object" || _v === null) throw new TypeError("Expected " + _n + " to be object, got " + (_v === null ? "null" : typeof _v)); if (!("string" === typeof _v.name)) throw new TypeError("Expected " + _n + ".name" + " to be string, got " + typeof _v.name); if (!("number" === typeof _v.age)) throw new TypeError("Expected " + _n + ".age" + " to be number, got " + typeof _v.age); if (!("string" === typeof _v.email && /^.*?@.*?\..*?$/.test(_v.email))) throw new TypeError("Expected " + _n + ".email" + " to match `${string}\"@\"${string}\".\"${string}`, got " + typeof _v.email); if (typeof _v.address !== "object" || _v.address === null) throw new TypeError("Expected " + _n + ".address" + " to be object, got " + (_v.address === null ? "null" : typeof _v.address)); if (!("string" === typeof _v.address.street)) throw new TypeError("Expected " + _n + ".address" + ".street" + " to be string, got " + typeof _v.address.street); if (!("string" === typeof _v.address.city)) throw new TypeError("Expected " + _n + ".address" + ".city" + " to be string, got " + typeof _v.address.city); if (!("string" === typeof _v.address.country && /^.*?-.*?$/.test(_v.address.country))) throw new TypeError("Expected " + _n + ".address" + ".country" + " to match `${string}\"-\"${string}`, got " + typeof _v.address.country); if (!("string" === typeof _v.address.zip && /^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(_v.address.zip))) throw new TypeError("Expected " + _n + ".address" + ".zip" + " to match `${number}`, got " + typeof _v.address.zip); if (typeof _v.company !== "object" || _v.company === null) throw new TypeError("Expected " + _n + ".company" + " to be object, got " + (_v.company === null ? "null" : typeof _v.company)); if (!("string" === typeof _v.company.name)) throw new TypeError("Expected " + _n + ".company" + ".name" + " to be string, got " + typeof _v.company.name); if (typeof _v.company.address !== "object" || _v.company.address === null) throw new TypeError("Expected " + _n + ".company" + ".address" + " to be object, got " + (_v.company.address === null ? "null" : typeof _v.company.address)); if (!("string" === typeof _v.company.address.street)) throw new TypeError("Expected " + _n + ".company" + ".address" + ".street" + " to be string, got " + typeof _v.company.address.street); if (!("string" === typeof _v.company.address.city)) throw new TypeError("Expected " + _n + ".company" + ".address" + ".city" + " to be string, got " + typeof _v.company.address.city); if (!("string" === typeof _v.company.address.country && /^.*?-.*?$/.test(_v.company.address.country))) throw new TypeError("Expected " + _n + ".company" + ".address" + ".country" + " to match `${string}\"-\"${string}`, got " + typeof _v.company.address.country); if (!("string" === typeof _v.company.address.zip && /^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(_v.company.address.zip))) throw new TypeError("Expected " + _n + ".company" + ".address" + ".zip" + " to match `${number}`, got " + typeof _v.company.address.zip); if (!("string" === typeof _v.company.website && _v.company.website.startsWith("https://"))) throw new TypeError("Expected " + _n + ".company" + ".website" + " to match `\"https://\"${string}`, got " + typeof _v.company.website); return _v; })( user, "return value")
}

// No-validation baseline
export function noValidateNestedUser(user: any): any {
  return user
}

// Zod validation
export function zodValidateNestedUser(user: any): any {
  return zodNestedUser.parse(user)
}

// Test data
export const testNestedUser: NestedUser = {
  name: 'Bob',
  age: 35,
  email: 'bob@example.com',
  address: {
    street: '123 Main St',
    city: 'New York',
    country: 'US-NY',
    zip: '10001',
  },
  company: {
    name: 'Acme Inc',
    website: 'https://acme.com',
    address: {
      street: '456 Business Ave',
      city: 'San Francisco',
      country: 'US-CA',
      zip: '94102',
    },
  },
}
