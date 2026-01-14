export interface User {
  name: string;
}

// Exported function - must always validate
export function processUser(user: User): string {
  return user.name;
}
