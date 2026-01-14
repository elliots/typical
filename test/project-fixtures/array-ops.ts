interface User {
  name: string;
}

export function getFirst(users: User[]): User | undefined {
  return users[0]; // Element access
}
