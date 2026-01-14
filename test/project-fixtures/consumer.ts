import { validateUser, User } from "./validator.js";

export function processData(data: unknown): User {
  const user = validateUser(data);
  // Since validateUser validates its return, we don't need to re-validate
  return user;
}
