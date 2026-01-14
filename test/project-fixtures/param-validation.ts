interface User {
  name: string;
  age: number;
}

export function processUser(user: User): string {
  return user.name;
}
