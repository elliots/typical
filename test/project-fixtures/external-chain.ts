interface User {
  name: string;
}

function step1(u: User): User {
  return u;
}
export function step2(u: User): User {
  return u;
}
declare function step3(u: User): User;

export function process(user: User): User {
  const user2 = step2(step1(user));
  const user3 = step3(user2); // user2 validated, passes to external
  const user4 = step3(user3); // user3 is dirty (escaped to step3), needs validation
  return user3;
}
