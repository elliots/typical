export interface User {
  name: string;
  age: number;
}

export function validateUser(data: unknown): User {
  // This function validates its return type
  return data as User;
}
