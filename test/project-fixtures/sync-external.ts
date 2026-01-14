interface User {
  name: string;
}

declare function externalProcess(u: User): void;

export function process(user: User): User {
  externalProcess(user); // Escapes to external
  return user; // Should still validate
}
