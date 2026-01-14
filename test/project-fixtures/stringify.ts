interface User {
  name: string;
}

export function serialize(user: User): User {
  const json = JSON.stringify(user); // Pure
  console.log(json);
  return user; // Should skip validation
}
