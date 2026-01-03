interface User {
  name: string;
  age: number;
}

function processUser(user: User): string {
  return user.name;
}