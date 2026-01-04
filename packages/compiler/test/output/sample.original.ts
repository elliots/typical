type Email = `${string}@${string}.${string}`
interface User {
  id: number
  name: string
  email: Email
}

// Simple function with primitive parameter and return
function greet(name: string): string {
  console.log('Greeting user:', { name, id: 123, email: 'test@example.com' } as User)
  return 'Hello ' + name
}

// Function with multiple parameters and object return
function createUser(id: number, name: string, email: User['email']): User {
  return { id, name, email }
}

// Arrow function
const add = (a: number, b: number): number => {
  return a + b
}

// Async function returning Promise
async function fetchUser(id: number): Promise<User> {
  return { id, name: 'Test', email: 'test@test.com' }
}

// Sync function returning Promise
function fetchUserLater(id: number): Promise<User> {
  return Promise.resolve({ id, name: 'Test', email: 'test@test.com' })
}

// Array parameter
function sumNumbers(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0)
}

// Union type parameter
function processValue(value: string | null): string {
  return value ?? 'default'
}

class UserService {
  getUser(_id: number): User | null {
    return null
  }

  saveUser(_user: User): boolean {
    return true
  }
}

export { greet, createUser, add, fetchUser, fetchUserLater, sumNumbers, processValue, UserService }
