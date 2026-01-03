// Array validation benchmarks
import { z } from 'zod'

// Template literal types
type ItemCode = `ITEM-${number}`

export interface ArrayItem {
  id: number
  code: ItemCode
  name: string
  value: number
}

// Zod schema
const zodArrayItem = z.object({
  id: z.number(),
  code: z.string().regex(/^ITEM-\d+$/),
  name: z.string(),
  value: z.number(),
})

const zodArray = z.array(zodArrayItem)

// Typical validation
export function validateArray(items: ArrayItem[]): ArrayItem[] { ((_v: any, _n: string) => { if (!Array.isArray(_v)) throw new TypeError("Expected " + _n + " to be array, got " + typeof _v); for (let _i0 = 0; _i0 < _v.length; _i0++) { const _e0: any = _v[_i0]; if (typeof _e0 !== "object" || _e0 === null) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + " to be object, got " + (_e0 === null ? "null" : typeof _e0)); if (!("number" === typeof _e0.id)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".id" + " to be number, got " + typeof _e0.id); if (!("string" === typeof _e0.code && /^ITEM--?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(_e0.code))) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".code" + " to match `\"ITEM-\"${number}`, got " + typeof _e0.code); if (!("string" === typeof _e0.name)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".name" + " to be string, got " + typeof _e0.name); if (!("number" === typeof _e0.value)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".value" + " to be number, got " + typeof _e0.value); } return _v; })(items, "items");
  return((_v: any, _n: string) => { if (!Array.isArray(_v)) throw new TypeError("Expected " + _n + " to be array, got " + typeof _v); for (let _i0 = 0; _i0 < _v.length; _i0++) { const _e0: any = _v[_i0]; if (typeof _e0 !== "object" || _e0 === null) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + " to be object, got " + (_e0 === null ? "null" : typeof _e0)); if (!("number" === typeof _e0.id)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".id" + " to be number, got " + typeof _e0.id); if (!("string" === typeof _e0.code && /^ITEM--?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(_e0.code))) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".code" + " to match `\"ITEM-\"${number}`, got " + typeof _e0.code); if (!("string" === typeof _e0.name)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".name" + " to be string, got " + typeof _e0.name); if (!("number" === typeof _e0.value)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".value" + " to be number, got " + typeof _e0.value); } return _v; })( items, "return value")
}

// No-validation baseline
export function noValidateArray(items: any): any {
  return items
}

// Zod validation - use 'any' return type so typical won't add validation
export function zodValidateArray(items: any): any {
  return zodArray.parse(items)
}

// Generate test data
export function generateArrayData(count: number): ArrayItem[] { ((_v: any, _n: string) => { if (!("number" === typeof _v)) throw new TypeError("Expected " + _n + " to be number, got " + typeof _v); return _v; })(count, "count");
  const items: ArrayItem[] = []
  for (let i = 0; i < count; i++) {
    items.push({
      id: i,
      code: `ITEM-${i}`,
      name: `Item ${i}`,
      value: Math.random() * 100,
    })
  }
  return((_v: any, _n: string) => { if (!Array.isArray(_v)) throw new TypeError("Expected " + _n + " to be array, got " + typeof _v); for (let _i0 = 0; _i0 < _v.length; _i0++) { const _e0: any = _v[_i0]; if (typeof _e0 !== "object" || _e0 === null) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + " to be object, got " + (_e0 === null ? "null" : typeof _e0)); if (!("number" === typeof _e0.id)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".id" + " to be number, got " + typeof _e0.id); if (!("string" === typeof _e0.code && /^ITEM--?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(_e0.code))) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".code" + " to match `\"ITEM-\"${number}`, got " + typeof _e0.code); if (!("string" === typeof _e0.name)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".name" + " to be string, got " + typeof _e0.name); if (!("number" === typeof _e0.value)) throw new TypeError("Expected " + _n + "[" + _i0 + "]" + ".value" + " to be number, got " + typeof _e0.value); } return _v; })( items, "return value")
}

// Pre-generated test arrays of different sizes
export const testArray10 = generateArrayData(10)
export const testArray100 = generateArrayData(100)
export const testArray1000 = generateArrayData(1000)
