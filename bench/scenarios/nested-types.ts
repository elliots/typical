// Nested object validation benchmarks

export interface Address {
  street: string;
  city: string;
  country: string;
  zip: string;
}

export interface Company {
  name: string;
  address: Address;
}

export interface NestedUser {
  name: string;
  age: number;
  email: string;
  address: Address;
  company: Company;
}

export function validateNestedUser(user: NestedUser): NestedUser {
  return user;
}

export function noValidateNestedUser(user: any): any {
  return user;
}

// Test data
export const testNestedUser: NestedUser = {
  name: "Bob",
  age: 35,
  email: "bob@example.com",
  address: {
    street: "123 Main St",
    city: "New York",
    country: "USA",
    zip: "10001",
  },
  company: {
    name: "Acme Inc",
    address: {
      street: "456 Business Ave",
      city: "San Francisco",
      country: "USA",
      zip: "94102",
    },
  },
};
