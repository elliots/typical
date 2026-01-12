// Array validation benchmarks
import { z } from "zod";

// Template literal types
type ItemCode = `ITEM-${number}`;

export interface ArrayItem {
  id: number;
  code: ItemCode;
  name: string;
  value: number;
}

// Zod schema
const zodArrayItem = z.object({
  id: z.number(),
  code: z.string().regex(/^ITEM-\d+$/),
  name: z.string(),
  value: z.number(),
});

const zodArray = z.array(zodArrayItem);

// Typical validation
export function validateArray(items: ArrayItem[]): ArrayItem[] {
  return items;
}

// Typical validation
export function validateDifferentArray(
  items: (ArrayItem & { age: number })[],
): (ArrayItem & { age: number })[] {
  return items;
}

// Typical validation
export function validateDifferentArrayAgain(
  items: (ArrayItem & { age: number })[],
): (ArrayItem & { age: number })[] {
  return items;
}

// Typical validation
export function validateSecondDifferentArray(
  items: (ArrayItem & { height: number })[],
): (ArrayItem & { height: number })[] {
  return items;
}

// No-validation baseline
export function noValidateArray(items: any): any {
  return items;
}

// Zod validation - use 'any' return type so typical won't add validation
export function zodValidateArray(items: any): any {
  return zodArray.parse(items);
}

// Generate test data
export function generateArrayData(count: number): ArrayItem[] {
  const items: ArrayItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: i,
      code: `ITEM-${i}`,
      name: `Item ${i}`,
      value: Math.random() * 100,
    });
  }
  return items;
}

// Pre-generated test arrays of different sizes
export const testArray10 = generateArrayData(10);
export const testArray100 = generateArrayData(100);
export const testArray1000 = generateArrayData(1000);
