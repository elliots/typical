export function greet(name: string, title?: string): string {
  return (title ? title + " " : "") + name;
}
