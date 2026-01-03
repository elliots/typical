// Main file that uses both User types via imports
import { validateUserV1, createUserV1, User as User1 } from './user-v1.js'
import { validateUserV2, createUserV2, User as User2 } from './user-v2.js'

// Test V1 User
const userV1 = createUserV1(1, 'Alice')
console.log('V1 User created:', userV1)

const validatedV1 = validateUserV1(userV1)
console.log('V1 User validated:', validatedV1)

// Test V2 User
const userV2 = createUserV2('abc-123', 'Bob Smith', 'bob@example.com')
console.log('V2 User created:', userV2)

const validatedV2 = validateUserV2(userV2)
console.log('V2 User validated:', validatedV2)

function checkV1(user: User1): void {
  console.log(`V1 User - ID: ${user.id}, Name: ${user.name}`)
}

function checkV2(user: User2): void {
  console.log(`V2 User - UUID: ${user.uuid}, Full Name: ${user.fullName}, Email: ${user.email}`)
}

checkV1(validatedV1)
checkV2(validatedV2)

// Test invalid data - should fail at runtime
try {
  validateUserV1({ id: 'not-a-number', name: 123 } as any)
  console.error('ERROR: V1 validation should have failed!')
  process.exit(1)
  // oxlint-disable-next-line no-unused-vars
} catch (e) {
  console.log('V1 correctly rejected invalid data', (e as Error).message)
}

try {
  validateUserV2({ uuid: 123, fullName: null, email: 'invalid', createdAt: 'not-a-date' } as any)
  console.error('ERROR: V2 validation should have failed!')
  process.exit(1)
  // oxlint-disable-next-line no-unused-vars
} catch (e) {
  console.log('V2 correctly rejected invalid data', (e as Error).message)
}

console.log('\n✅ Same type name in different files works correctly!')
