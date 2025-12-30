// Primitive type validation benchmarks
// These functions will be transformed by typical to add runtime validation

export function validateString(value: string): string {
  return value;
}

export function validateNumber(value: number): number {
  return value;
}

export function validateBoolean(value: boolean): boolean {
  return value;
}

// No-validation baseline versions - use 'any' type so typical won't add validation
export function noValidateString(value: any): any {
  return value;
}

export function noValidateNumber(value: any): any {
  return value;
}

export function noValidateBoolean(value: any): any {
  return value;
}

// Test data
export const testString = "hello world";
export const testNumber = 42;
export const testBoolean = true;
