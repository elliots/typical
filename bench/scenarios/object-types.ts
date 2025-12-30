// Simple object validation benchmarks

export interface SimpleUser {
  name: string;
  age: number;
  active: boolean;
}

export function validateSimpleUser(user: SimpleUser): SimpleUser {
  return user;
}

export function noValidateSimpleUser(user: any): any {
  return user;
}

// Test data
export const testSimpleUser: SimpleUser = {
  name: "Alice",
  age: 30,
  active: true,
};
