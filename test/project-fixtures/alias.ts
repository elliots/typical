export function process(input: string): string {
  const copy = input; // Alias
  return copy; // Should skip - copy inherits validation
}
