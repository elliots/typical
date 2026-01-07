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
  address1: Address
  address2: Address
  company: Company
}

// Typical validation
export function validateNestedUser(user: NestedUser): NestedUser {
  return user
}

export function validateCompany(company1: Company, company2: Company): Company {
  console.log('Company 1:', JSON.stringify(company1))
  console.log('Company 2:', JSON.stringify(company2))
  return company1
}

// Test data
export const testNestedUser: NestedUser = {
  name: 'Bob',
  age: 35,
  email: 'bob@example.com',
  address1: {
    street: '123 Main St',
    city: 'New York',
    country: 'US-NY',
    zip: '10001',
  },
  address2: {
    street: '789 Side St',
    city: 'Los Angeles',
    country: 'US-CA',
    zip: '90001',
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

// No-validation baseline
export function noValidateNestedUser(user: any): any {
  return user
}

// Zod validation
export function zodValidateNestedUser(user: any): any {
  return zodNestedUser.parse(user)
}

// Nested object validation benchmarks
import { z } from 'zod'

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
  address1: zodAddress,
  address2: zodAddress,
  company: zodCompany,
})
