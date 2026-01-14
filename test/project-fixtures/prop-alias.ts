interface User {
  name: string;
}

export function process(user: User): string {
  const name = user.name; // Property alias
  return name; // Should skip - name is valid string
}
