interface User {
  name: string;
  age: number;
  email: `${string}@${string}`;
}

function createUser(
  name: string,
  age: number,
  email: `${string}@${string}`
): User {
  return {
    name,
    age,
    email,
  };
}

function processUser(user: User): string {
  return `Hello ${user.name}, age ${user.age}`;
}

class UserService {
  saveUser(user: User): void {
    const userData = JSON.stringify(user);
    console.log("Saving user:", userData);
  }

  loadUser(json: string): User {
    return JSON.parse(json);
  }
}

// Test the ESM loader
console.log("Testing Typical ESM loader...");

const user = createUser("Alice", 30, "alice@example.com");
console.log("Created user:", user);

const message = processUser(user);
console.log("Message:", message);

const service = new UserService();
service.saveUser(user);

const jsonData = '{"name":"Bob","age":25,"email":"bob@example.com"}';
const loadedUser = service.loadUser(jsonData);
console.log("Loaded user:", loadedUser);

try {
  service.loadUser('{"name":"Charlie","age":"22","email":"charlie at example.com"}');
  console.error("❌ Invalid user data was accepted!");
  process.exit(1);
} catch (e: unknown) {
  console.error("Caught error as expected for invalid user data:", (e as Error).message);
}

try {
  // @ts-expect-error i want to test runtime validation
  const invalidUser = {
    name: 'Elliot',
    age: 100,
    email: 'not.an.email'
  } as User;
  console.error("❌ Invalid user data was accepted!");
  process.exit(1);
} catch (e: unknown) {
  console.error("Caught error as expected for invalid user object:", (e as Error).message);
}

console.log("✅ All tests passed!");