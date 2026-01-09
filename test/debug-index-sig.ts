interface StringDict {
  [key: string]: number
}
export function check(d: StringDict): number {
  return d.foo
}
