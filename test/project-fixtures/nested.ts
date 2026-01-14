interface Address {
  city: string;
}
interface User {
  address: Address;
}

export function getCity(user: User): string {
  return user.address.city; // Should skip - nested valid
}
