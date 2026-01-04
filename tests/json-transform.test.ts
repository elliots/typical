import { test, describe } from 'node:test'
import assert from 'node:assert'

// =============================================================================
// JSON.stringify tests - must match native JSON.stringify behavior
// =============================================================================

describe('JSON.stringify with type - custom stringifier', () => {
  interface User {
    name: string
    age: number
  }

  test('produces same output as JSON.stringify for typed props', () => {
    const input = { name: 'Alice', age: 30 }
    const result = JSON.stringify(input as User)
    assert.strictEqual(result, JSON.stringify(input))
  })

  test('strips extra properties', () => {
    const input = { name: 'Alice', age: 30, password: 'secret' }
    const result = JSON.stringify(input as User)
    assert.strictEqual(result, '{"name":"Alice","age":30}')
    const parsed = JSON.parse(result)
    assert.strictEqual(parsed.password, undefined)
  })

  test('handles string escaping correctly', () => {
    const input = { name: 'Al"ice\nBob\\Charlie', age: 30 }
    const result = JSON.stringify(input as User)
    // Must parse back to original values
    const parsed = JSON.parse(result)
    assert.strictEqual(parsed.name, input.name)
    assert.strictEqual(parsed.age, input.age)
    // Must match native stringify behavior
    assert.strictEqual(result, JSON.stringify({ name: input.name, age: input.age }))
  })

  test('handles unicode correctly', () => {
    const input = { name: '\u0000\u001f\u2028\u2029', age: 30 }
    const result = JSON.stringify(input as User)
    const parsed = JSON.parse(result)
    assert.strictEqual(parsed.name, input.name)
  })

  test('handles NaN (becomes null)', () => {
    interface Nums {
      value: number
    }
    const input = { value: NaN }
    const result = JSON.stringify(input as Nums)
    assert.strictEqual(result, '{"value":null}')
  })

  test('handles Infinity (becomes null)', () => {
    interface Nums {
      value: number
    }
    assert.strictEqual(JSON.stringify({ value: Infinity } as Nums), '{"value":null}')
    assert.strictEqual(JSON.stringify({ value: -Infinity } as Nums), '{"value":null}')
  })

  test('handles undefined properties (omitted)', () => {
    interface Opt {
      name?: string
      age: number
    }
    const input: Opt = { age: 30 }
    const result = JSON.stringify(input as Opt)
    assert.strictEqual(result, '{"age":30}')
  })

  test('handles null', () => {
    interface Nullable {
      name: string | null
    }
    const result = JSON.stringify({ name: null } as Nullable)
    assert.strictEqual(result, '{"name":null}')
  })

  test('handles nested objects', () => {
    interface Address {
      city: string
    }
    interface Person {
      name: string
      address: Address
    }
    const input = { name: 'Bob', address: { city: 'NYC', zip: '10001' } }
    const result = JSON.stringify(input as Person)
    assert.strictEqual(result, '{"name":"Bob","address":{"city":"NYC"}}')
  })

  test('handles arrays of objects', () => {
    const input = [
      { name: 'A', age: 1, extra: 'x' },
      { name: 'B', age: 2 },
    ]
    const result = JSON.stringify(input as User[])
    assert.strictEqual(result, '[{"name":"A","age":1},{"name":"B","age":2}]')
  })

  test('handles class instances', () => {
    class UserClass {
      name: string
      age: number
      private secret = 'hidden'
      constructor(name: string, age: number) {
        this.name = name
        this.age = age
      }
      getGreeting() {
        return 'hi'
      }
    }
    const instance = new UserClass('Test', 25)
    const result = JSON.stringify(instance as User)
    assert.strictEqual(result, '{"name":"Test","age":25}')
  })

  test('handles Date objects (via toJSON)', () => {
    interface Dated {
      date: Date
    }
    const d = new Date('2024-01-01T00:00:00.000Z')
    const input = { date: d }
    const result = JSON.stringify(input as Dated)
    assert.strictEqual(result, '{"date":"2024-01-01T00:00:00.000Z"}')
  })

  test('handles RegExp (becomes {})', () => {
    interface WithRegex {
      pattern: RegExp
    }
    const input = { pattern: /test/g }
    const result = JSON.stringify(input as WithRegex)
    assert.strictEqual(result, '{"pattern":{}}')
  })

  test('handles empty object', () => {
    interface Empty {}
    const result = JSON.stringify({} as Empty)
    assert.strictEqual(result, '{}')
  })

  test('handles empty array', () => {
    const result = JSON.stringify([] as User[])
    assert.strictEqual(result, '[]')
  })

  test('handles large objects (>= 15 props) - uses filter then stringify', () => {
    interface Large {
      p1: string
      p2: string
      p3: string
      p4: string
      p5: string
      p6: string
      p7: string
      p8: string
      p9: string
      p10: string
      p11: string
      p12: string
      p13: string
      p14: string
      p15: string
    }
    const input = {
      p1: 'a',
      p2: 'b',
      p3: 'c',
      p4: 'd',
      p5: 'e',
      p6: 'f',
      p7: 'g',
      p8: 'h',
      p9: 'i',
      p10: 'j',
      p11: 'k',
      p12: 'l',
      p13: 'm',
      p14: 'n',
      p15: 'o',
      extra: 'should be stripped',
    }
    const result = JSON.stringify(input as Large)
    const parsed = JSON.parse(result)
    assert.strictEqual(Object.keys(parsed).length, 15)
    assert.strictEqual(parsed.extra, undefined)
  })
})

// =============================================================================
// JSON.parse tests - filtering validator
// =============================================================================

describe('JSON.parse with type - filtering validator', () => {
  interface User {
    name: string
    age: number
  }

  test('validates and filters using as T pattern', () => {
    const json = '{"name":"Alice","age":30,"extra":"ignored"}'
    const user = JSON.parse(json) as User
    assert.deepStrictEqual(user, { name: 'Alice', age: 30 })
    assert.strictEqual((user as any).extra, undefined)
  })

  test('throws on type mismatch - wrong type for name', () => {
    const json = '{"name":123,"age":30}'
    assert.throws(() => JSON.parse(json) as User, TypeError)
  })

  test('throws on type mismatch - wrong type for age', () => {
    const json = '{"name":"Alice","age":"string"}'
    assert.throws(() => JSON.parse(json) as User, TypeError)
  })

  test('throws on missing required property', () => {
    const json = '{"name":"Alice"}'
    assert.throws(() => JSON.parse(json) as User, TypeError)
  })

  test('handles optional properties', () => {
    interface Opt {
      name: string
      nickname?: string
    }
    const json = '{"name":"Alice"}'
    const result = JSON.parse(json) as Opt
    assert.deepStrictEqual(result, { name: 'Alice' })
  })

  test('handles optional properties when present', () => {
    interface Opt {
      name: string
      nickname?: string
    }
    const json = '{"name":"Alice","nickname":"Ali","extra":"ignored"}'
    const result = JSON.parse(json) as Opt
    assert.deepStrictEqual(result, { name: 'Alice', nickname: 'Ali' })
  })

  test('handles nested objects', () => {
    interface Address {
      city: string
    }
    interface Person {
      name: string
      address: Address
    }
    const json = '{"name":"Bob","address":{"city":"NYC","zip":"10001"},"extra":true}'
    const result = JSON.parse(json) as Person
    assert.deepStrictEqual(result, { name: 'Bob', address: { city: 'NYC' } })
  })

  test('handles arrays', () => {
    const json = '[{"name":"A","age":1,"x":1},{"name":"B","age":2}]'
    const result = JSON.parse(json) as User[]
    assert.deepStrictEqual(result, [
      { name: 'A', age: 1 },
      { name: 'B', age: 2 },
    ])
  })

  test('handles null in union', () => {
    interface NullableName {
      name: string | null
    }
    const json = '{"name":null}'
    const result = JSON.parse(json) as NullableName
    assert.deepStrictEqual(result, { name: null })
  })

  test('handles boolean properties', () => {
    interface WithBool {
      active: boolean
    }
    const json = '{"active":true,"extra":"ignored"}'
    const result = JSON.parse(json) as WithBool
    assert.deepStrictEqual(result, { active: true })
  })

  test('throws on null when object expected', () => {
    const json = 'null'
    assert.throws(() => JSON.parse(json) as User, TypeError)
  })
})

// =============================================================================
// Variable declaration pattern: const x: T = JSON.parse(string)
// =============================================================================

describe('JSON.parse with variable type annotation', () => {
  interface User {
    name: string
    age: number
  }

  test('infers type from variable declaration', () => {
    const json = '{"name":"Alice","age":30,"extra":"ignored"}'
    const user: User = JSON.parse(json)
    assert.deepStrictEqual(user, { name: 'Alice', age: 30 })
    assert.strictEqual((user as any).extra, undefined)
  })

  test('validates type from variable declaration', () => {
    const json = '{"name":123,"age":30}'
    assert.throws(() => {
      const _user: User = JSON.parse(json)
    }, TypeError)
  })
})

// =============================================================================
// Return statement pattern: return JSON.parse(string)
// =============================================================================

describe('JSON.parse in return statement', () => {
  interface User {
    name: string
    age: number
  }

  function loadUser(json: string): User {
    return JSON.parse(json)
  }

  test('infers type from return type', () => {
    const json = '{"name":"Alice","age":30,"extra":"ignored"}'
    const user = loadUser(json)
    assert.deepStrictEqual(user, { name: 'Alice', age: 30 })
    assert.strictEqual((user as any).extra, undefined)
  })

  test('validates type from return type', () => {
    const json = '{"name":123,"age":30}'
    assert.throws(() => loadUser(json), TypeError)
  })
})

// =============================================================================
// Round-trip tests - stringify then parse should preserve data
// =============================================================================

describe('JSON round-trip tests', () => {
  interface User {
    name: string
    age: number
  }

  test('stringify then parse preserves data', () => {
    const original: User = { name: 'Alice', age: 30 }
    const json = JSON.stringify(original as User)
    const restored = JSON.parse(json) as User
    assert.deepStrictEqual(restored, original)
  })

  test('stringify strips extras, parse validates', () => {
    const input = { name: 'Alice', age: 30, password: 'secret' }
    const json = JSON.stringify(input as User)
    const restored = JSON.parse(json) as User
    assert.deepStrictEqual(restored, { name: 'Alice', age: 30 })
  })

  test('nested objects round-trip', () => {
    interface Address {
      city: string
      zip: string
    }
    interface Person {
      name: string
      address: Address
    }
    const original: Person = {
      name: 'Bob',
      address: { city: 'NYC', zip: '10001' },
    }
    const json = JSON.stringify(original as Person)
    const restored = JSON.parse(json) as Person
    assert.deepStrictEqual(restored, original)
  })

  test('arrays round-trip', () => {
    const original: User[] = [
      { name: 'A', age: 1 },
      { name: 'B', age: 2 },
    ]
    const json = JSON.stringify(original as User[])
    const restored = JSON.parse(json) as User[]
    assert.deepStrictEqual(restored, original)
  })
})

console.log('All tests defined. Running with node --test...')
