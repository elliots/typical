// Version 2 of User - different structure, same name
export interface User {
  uuid: string
  fullName: string
  email: `${string}@${string}`
  createdAt: Date
}

export function validateUserV2(user: User): User {
  return user
}

export function createUserV2(uuid: string, fullName: string, email: `${string}@${string}`): User {
  return { uuid, fullName, email, createdAt: new Date() }
}
