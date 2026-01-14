interface User {
  name: string;
}

export function process(user: User, flag: boolean): User | null {
  if (flag) {
    return user; // Should skip - user is valid
  }
  return null;
}
