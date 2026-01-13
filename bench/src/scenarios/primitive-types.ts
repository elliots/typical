// Primitive type validation benchmarks
import { z } from "zod";

// Zod schemas
const zodString = z.string();
const zodNumber = z.number();
const zodBoolean = z.boolean();

// Typical validation
export function validateString(value: string): string {
  return value;
}

export function validateNumber(value: number): number {
  return value;
}

export function validateBoolean(value: boolean): boolean {
  return value;
}

// No-validation baseline
export function noValidateString(value: any): any {
  return value;
}

export function noValidateNumber(value: any): any {
  return value;
}

export function noValidateBoolean(value: any): any {
  return value;
}

// Zod validation
export function zodValidateString(value: any): any {
  return zodString.parse(value);
}

export function zodValidateNumber(value: any): any {
  return zodNumber.parse(value);
}

export function zodValidateBoolean(value: any): any {
  return zodBoolean.parse(value);
}

// Test data
export const testString = "hello world";
export const testNumber = 42;
export const testBoolean = true;
