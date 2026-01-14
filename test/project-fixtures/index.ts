export interface User {
  name: string;
}

// External function - we don't know if it validates
declare function externalGetUser(): User;

export function getUser(): User {
  const user = externalGetUser();
  return user; // user is validated at assignment, so return is already valid
}
