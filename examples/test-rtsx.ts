// Test file for rtsx - demonstrates typical transformations

interface User {
  id: number;
  name: string;
  email?: `${string}@${string}`; // Email must match this template literal format
}

function validateUser(user: User): User {
  // This parameter will get runtime validation
  console.log('Processing user:', user);

  // This return will get runtime validation
  return {
    ...user,
    name: user.name.toUpperCase()
  };
}

function processData(data: User[]): string {
  // JSON.stringify will be transformed to typia.json.stringify
  return JSON.stringify(data.map(validateUser));
}

function parseUserData(jsonStr: string): User[] {
  // JSON.parse will be transformed to typia.json.assertParse
  return JSON.parse(jsonStr) as User[];
}

// Test the functions
const testUser: User = { id: 1, name: "John Doe", email: "johnexample.com"}  as any;
const processed = validateUser(testUser);
console.log('Processed:', processed);

const jsonData = processData([testUser]);
console.log('JSON data:', jsonData);

const parsed = parseUserData(jsonData);
console.log('Parsed back:', parsed);