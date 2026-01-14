interface User {
  name: string;
}

// Internal function - only called with validated values
function processUserInternal(user: User): string {
  return user.name;
}

export function run(data: unknown): string {
  const user = data as User;
  return processUserInternal(user);
}
