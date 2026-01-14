interface User {
  name: string;
}

declare function externalProcess(u: User): void;

export function process(user: User): void {
  user.name = "mutated"; // Now dirty
  externalProcess(user); // Should validate here since user is dirty
}
