interface User {
  name: string;
}

declare function externalProcess(u: User): void;

export function process(user: User): void {
  // user is clean (not mutated since validation)
  externalProcess(user); // Should NOT wrap - user is still valid
}
