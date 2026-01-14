interface User {
  name: string;
}

export function getName(user: User): string {
  return user.name; // Should skip - user is validated
}
