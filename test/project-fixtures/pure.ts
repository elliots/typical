export function process(input: string): string {
  console.log(input); // Pure - doesn't mutate
  return input; // Should skip validation
}
