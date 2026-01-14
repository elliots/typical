interface Result {
  status: string;
}

export function createResult(): Result {
  return { status: "ok" };
}
