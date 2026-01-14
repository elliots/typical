import { User } from "./types.js";
import { createUser } from "./validators.js";

export function run(name: string, email: string): User {
  const user = createUser(name, email);
  return user;
}
