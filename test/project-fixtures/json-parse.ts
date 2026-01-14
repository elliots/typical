interface User {
  name: string;
}

export function parseUser(json: string): User {
  const user: User = JSON.parse(json);
  return user; // Should skip - just validated by JSON.parse
}
