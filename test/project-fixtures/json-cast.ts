interface User {
  name: string;
}

export function parseUser(json: string): User {
  return JSON.parse(json) as User;
}
