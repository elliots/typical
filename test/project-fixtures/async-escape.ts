interface User {
  name: string;
}

declare function externalSave(u: User): Promise<void>;

export async function save(user: User): Promise<User> {
  await externalSave(user); // Escapes to external + await
  return user; // Must validate - escaped + awaited
}
