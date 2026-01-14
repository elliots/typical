interface User {
  name: string;
}

export function process(user: User): User {
  user.name = "mutated"; // Direct mutation
  return user; // Should re-validate
}
