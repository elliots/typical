interface User {
  name: string;
}

declare function externalLib(u: User): Promise<void>;

export async function process(user: User): Promise<string> {
  await externalLib(user); // user escapes + await
  console.log(user.name); // Must validate
  await Promise.resolve();
  return user.name; // Must validate again
}
