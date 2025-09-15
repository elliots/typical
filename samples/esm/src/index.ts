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
} catch (e) {
  console.error("Caught error as expected for invalid user data:");
}

console.log("✅ All tests passed!");

// interface User {
//   name: string;
//   age?: number;
// }

// const user = JSON.parse('{"name":"Elliot", "age": "41"}') as User;
