interface User {
  name: string;
  age: number;
}

export function clone(user: User): User {
  return { ...user };
}
