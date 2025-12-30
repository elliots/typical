// Nested object validation benchmarks
import { z } from "zod";

// Template literal types
type Email = `${string}@${string}.${string}`;
type ZipCode = `${number}`;
type CountryCode = `${string}-${string}`;

export interface Address {
  street: string;
  city: string;
  country: CountryCode;
  zip: ZipCode;
}

export interface Company {
  name: string;
  address: Address;
  website: `https://${string}`;
}

export interface NestedUser {
  name: string;
  age: number;
  email: Email;
  address: Address;
  company: Company;
}

// Zod schemas
const zodAddress = z.object({
  street: z.string(),
  city: z.string(),
  country: z.string().regex(/^.+-.+$/),
  zip: z.string().regex(/^\d+$/),
});

const zodCompany = z.object({
  name: z.string(),
  address: zodAddress,
  website: z.string().regex(/^https:\/\/.+$/),
});

const zodNestedUser = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().regex(/^.+@.+\..+$/),
  address: zodAddress,
  company: zodCompany,
});

// Typical validation
export function validateNestedUser(user: NestedUser): NestedUser {
  return user;
}

// No-validation baseline
export function noValidateNestedUser(user: any): any {
  return user;
}

// Zod validation
export function zodValidateNestedUser(user: any): any {
  return zodNestedUser.parse(user);
}

// Test data
export const testNestedUser: NestedUser = {
  name: "Bob",
  age: 35,
  email: "bob@example.com",
  address: {
    street: "123 Main St",
    city: "New York",
    country: "US-NY",
    zip: "10001",
  },
  company: {
    name: "Acme Inc",
    website: "https://acme.com",
    address: {
      street: "456 Business Ave",
      city: "San Francisco",
      country: "US-CA",
      zip: "94102",
    },
  },
};
