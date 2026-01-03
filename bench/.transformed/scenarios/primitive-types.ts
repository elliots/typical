// Primitive type validation benchmarks
import { z } from 'zod'

// Zod schemas
const zodString = z.string()
const zodNumber = z.number()
const zodBoolean = z.boolean()

// Typical validation - transformed by typical to add runtime validation
export function validateString(value: string): string { ((_v: any, _n: string) => { if (!("string" === typeof _v)) throw new TypeError("Expected " + _n + " to be string, got " + typeof _v); return _v; })(value, "value");
  return((_v: any, _n: string) => { if (!("string" === typeof _v)) throw new TypeError("Expected " + _n + " to be string, got " + typeof _v); return _v; })( value, "return value")
}

export function validateNumber(value: number): number { ((_v: any, _n: string) => { if (!("number" === typeof _v)) throw new TypeError("Expected " + _n + " to be number, got " + typeof _v); return _v; })(value, "value");
  return((_v: any, _n: string) => { if (!("number" === typeof _v)) throw new TypeError("Expected " + _n + " to be number, got " + typeof _v); return _v; })( value, "return value")
}

export function validateBoolean(value: boolean): boolean { ((_v: any, _n: string) => { if (!("boolean" === typeof _v)) throw new TypeError("Expected " + _n + " to be boolean, got " + typeof _v); return _v; })(value, "value");
  return((_v: any, _n: string) => { if (!("boolean" === typeof _v)) throw new TypeError("Expected " + _n + " to be boolean, got " + typeof _v); return _v; })( value, "return value")
}

// No-validation baseline versions - use 'any' type so typical won't add validation
export function noValidateString(value: any): any {
  return value
}

export function noValidateNumber(value: any): any {
  return value
}

export function noValidateBoolean(value: any): any {
  return value
}

// Zod validation - use 'any' return type so typical won't add validation
export function zodValidateString(value: any): any {
  return zodString.parse(value)
}

export function zodValidateNumber(value: any): any {
  return zodNumber.parse(value)
}

export function zodValidateBoolean(value: any): any {
  return zodBoolean.parse(value)
}

// Test data
export const testString = 'hello world'
export const testNumber = 42
export const testBoolean = true
