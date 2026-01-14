import { User } from "./types.js";

export function createUser(name: string, email: string): User {
  return { name, email };
}
