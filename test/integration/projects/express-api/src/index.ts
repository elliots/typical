import express from "express";

// Types for the API
interface User {
  name: string;
  age: number;
  email: `${string}@${string}`;
}

interface CreateUserRequest {
  name: string;
  age: number;
  email: `${string}@${string}`;
}

interface GetUserParams {
  id: string;
}

// In-memory store
const users: Map<string, User> = new Map();
let nextId = 1;

// Create Express app
const app = express();
app.use(express.json());

// Handler functions with typed parameters (typical will add validation)
function handleCreateUser(body: CreateUserRequest): { id: string; user: User } {
  const id = String(nextId++);
  const user: User = {
    name: body.name,
    age: body.age,
    email: body.email,
  };
  users.set(id, user);
  return { id, user };
}

function handleGetUser(params: GetUserParams): User | null {
  return users.get(params.id) || null;
}

// Routes
app.post("/users", (req, res) => {
  try {
    const result = handleCreateUser(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

app.get("/users/:id", (req, res) => {
  try {
    const user = handleGetUser({ id: req.params.id });
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Start server or run tests
const PORT = process.env.PORT || 3456;

if (process.env.TEST_MODE === "true") {
  // Test mode - run validation tests and exit
  console.log("Running Express API validation tests...\n");

  let passed = 0;
  let failed = 0;

  // Test 1: Valid user creation
  try {
    const result = handleCreateUser({
      name: "Alice",
      age: 30,
      email: "alice@example.com",
    });
    console.log("Test 1: Valid user creation - PASSED");
    console.log("  Created:", result);
    passed++;
  } catch (e) {
    console.log("Test 1: Valid user creation - FAILED");
    console.log("  Error:", e);
    failed++;
  }

  // Test 2: Invalid email format should fail
  try {
    handleCreateUser({
      name: "Bob",
      age: 25,
      email: "not-an-email" as any,
    });
    console.log("Test 2: Invalid email should fail - FAILED (no error thrown)");
    failed++;
  } catch (e) {
    console.log("Test 2: Invalid email should fail - PASSED");
    console.log("  Caught error as expected");
    passed++;
  }

  // Test 3: Invalid age type should fail
  try {
    handleCreateUser({
      name: "Charlie",
      age: "thirty" as any,
      email: "charlie@example.com",
    });
    console.log("Test 3: Invalid age type should fail - FAILED (no error thrown)");
    failed++;
  } catch (e) {
    console.log("Test 3: Invalid age type should fail - PASSED");
    console.log("  Caught error as expected");
    passed++;
  }

  // Test 4: Get existing user
  try {
    const user = handleGetUser({ id: "1" });
    if (user && user.name === "Alice") {
      console.log("Test 4: Get existing user - PASSED");
      passed++;
    } else {
      console.log("Test 4: Get existing user - FAILED (wrong user returned)");
      failed++;
    }
  } catch (e) {
    console.log("Test 4: Get existing user - FAILED");
    console.log("  Error:", e);
    failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("\nAll Express API tests passed!");
    process.exit(0);
  }
} else {
  // Normal mode - start server
  app.listen(PORT, () => {
    console.log(`Express API server running on port ${PORT}`);
    console.log(`POST /users - Create a new user`);
    console.log(`GET /users/:id - Get a user by ID`);
  });
}
