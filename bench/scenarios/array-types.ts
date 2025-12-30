// Array validation benchmarks

export interface ArrayItem {
  id: number;
  name: string;
  value: number;
}

export function validateArray(items: ArrayItem[]): ArrayItem[] {
  return items;
}

export function noValidateArray(items: any): any {
  return items;
}

// Generate test data
export function generateArrayData(count: number): ArrayItem[] {
  const items: ArrayItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: i,
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
