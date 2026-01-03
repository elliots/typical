// Version 1 of User - simple structure
export interface User {
  id: number
  name: string
}

export function validateUserV1(user: User): User {
  return user
}

export function createUserV1(id: number, name: string): User {
  return { id, name }
}
