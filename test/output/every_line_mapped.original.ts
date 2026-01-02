
      interface User {
  id: number;
  name: string;
}

function processData(data: User) {
  return JSON.stringify(data);
}

const u = JSON.parse('{"id":1,"name":"Alice"}') as User;
processData(u);
