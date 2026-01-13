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
  parentCompany?: Company;
}

export interface NestedUser {
  name: string;
  age: number;
  email: Email;
  address1: Address;
  address2: Address;
  company: Company;
}

// Typical validation
export function validateNestedUser(user: NestedUser): NestedUser {
  return user;
}

export function mergeCompanies(company1: Company, company2: Company): Company {
  console.log("Company 1:", JSON.stringify(company1));
  console.log("Company 2:", JSON.stringify(company2));

  const merged: Company = {
    name: company1.name + " & " + company2.name,
    address: company1.address,
    website: company1.website,
  };
  return merged;
}

// Test data
export const testNestedUser: NestedUser = {
  name: "Bob",
  age: 35,
  email: "bob@example.com",
  address1: {
    street: "123 Main St",
    city: "New York",
    country: "US-NY",
    zip: "10001",
  },
  address2: {
    street: "789 Side St",
    city: "Los Angeles",
    country: "US-CA",
    zip: "90001",
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
    parentCompany: {
      name: "Global Corp",
      website: "https://globalcorp.com",
      address: {
        street: "1 Corporate Way",
        city: "Chicago",
        country: "US-IL",
        zip: "60601",
      },
    }
  },
};

// No-validation baseline
export function noValidateNestedUser(user: any): any {
  return user;
}

// Zod validation
export function zodValidateNestedUser(user: any): any {
  return zodNestedUser.parse(user);
}

// JSON.parse/stringify examples that Typical should mark
export function parseUser(json: string): NestedUser {
  return JSON.parse(json); // Should be marked - return with type annotation
}

export function parseUserCast(json: string): unknown {
  return JSON.parse(json) as NestedUser; // Should be marked - cast
}

export function stringifyCompany(company: Company): string {
  return JSON.stringify(company); // Should be marked - stringify cast
}

export function parseWithCast2(json: string): Company {
  return JSON.parse(json) as Company; // Should be marked - cast with return type
}

export function assignedParse(json: string): void {
  const user: NestedUser = JSON.parse(json); // Should be marked - typed variable
  console.log(user);
}

// Nested object validation benchmarks
import { z } from "zod";

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
  address1: zodAddress,
  address2: zodAddress,
  company: zodCompany,
});
