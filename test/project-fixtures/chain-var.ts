interface User {
  name: string;
}

function step1(u: User): User {
  return u;
}
function step2(u: User): User {
  return u;
}

export function process(user: User): User {
  const user2 = step2(step1(user));
  return user2;
}
