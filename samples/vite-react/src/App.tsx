import { useState } from 'react'

// Types for validation - Typical injects runtime validation at JSON.parse calls
interface User {
  id: number
  name: string
  email: `${string}@${string}.${string}`
  age?: number
}

interface ApiResponse {
  success: boolean
  data: User[]
  timestamp: number
}

// Sample API response test cases
const API_EXAMPLES = {
  'Valid Response': JSON.stringify({
    success: true,
    data: [
      { id: 1, name: 'Alice', email: 'alice@example.com', age: 30 },
      { id: 2, name: 'Bob', email: 'bob@test.com' }
    ],
    timestamp: Date.now()
  }, null, 2),
  'Invalid - Bad Email in User': JSON.stringify({
    success: true,
    data: [{ id: 1, name: 'Charlie', email: 'not-an-email', age: 25 }],
    timestamp: Date.now()
  }, null, 2),
  'Invalid - Wrong Types': JSON.stringify({
    success: 'yes',
    data: [{ id: 'not-a-number', name: 123, email: 'test@test.com' }],
    timestamp: 'now'
  }, null, 2),
  'Invalid - Missing Fields': JSON.stringify({
    success: true,
    data: [{ id: 1 }],
    timestamp: Date.now()
  }, null, 2),
  'Invalid - Empty Data': JSON.stringify({
    success: true,
    timestamp: Date.now()
  }, null, 2),
}

type ExampleKey = keyof typeof API_EXAMPLES

// Typical injects validation when JSON.parse returns a typed value
function parseUser(json: string): User {
  return JSON.parse(json)
}

function parseApiResponse(json: string): ApiResponse {
  return JSON.parse(json)
}

function App() {
  const [users, setUsers] = useState<User[]>([])
  const [formData, setFormData] = useState({ name: '', email: '', age: '' })
  const [formError, setFormError] = useState<string | null>(null)

  const [jsonInput, setJsonInput] = useState(API_EXAMPLES['Valid Response'])
  const [selectedExample, setSelectedExample] = useState<ExampleKey>('Valid Response')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [jsonSuccess, setJsonSuccess] = useState<string | null>(null)

  // Form validation - build JSON and parse to trigger validation
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    try {
      const userData = {
        id: Date.now(),
        name: formData.name,
        email: formData.email,
        ...(formData.age ? { age: parseInt(formData.age, 10) } : {}),
      }
      const user = parseUser(JSON.stringify(userData))
      setUsers([...users, user])
      setFormData({ name: '', email: '', age: '' })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Validation failed')
    }
  }

  // API Response validation
  const handleJsonValidate = () => {
    setJsonError(null)
    setJsonSuccess(null)

    try {
      const response = parseApiResponse(jsonInput)
      setJsonSuccess(`Valid API Response with ${response.data.length} user(s)!`)
      setUsers([...users, ...response.data])
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Validation failed')
    }
  }

  const handleExampleChange = (key: ExampleKey) => {
    setSelectedExample(key)
    setJsonInput(API_EXAMPLES[key])
    setJsonError(null)
    setJsonSuccess(null)
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '900px', margin: '0 auto' }}>
      <h1>Typical + React Demo</h1>
      <p>Runtime type validation using Typical. Test API responses and form validation.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '2rem' }}>
        {/* Form Validation Section */}
        <section>
          <h2>User Form Validation</h2>
          <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Name (required)"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              style={{ padding: '0.5rem' }}
              data-testid="form-name"
            />
            <input
              type="text"
              placeholder="Email (must contain @)"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              style={{ padding: '0.5rem' }}
              data-testid="form-email"
            />
            <input
              type="text"
              placeholder="Age (optional, must be number)"
              value={formData.age}
              onChange={(e) => setFormData({ ...formData, age: e.target.value })}
              style={{ padding: '0.5rem' }}
              data-testid="form-age"
            />
            <button type="submit" style={{ padding: '0.5rem 1rem' }} data-testid="form-submit">
              Add User
            </button>
          </form>
          {formError && (
            <div data-testid="form-error" style={{ padding: '0.75rem', background: '#fee', color: '#c00', borderRadius: '4px', marginTop: '0.5rem', fontSize: '0.9rem' }}>
              {formError}
            </div>
          )}
        </section>

        {/* API Response Validation Section */}
        <section>
          <h2>API Response Testing</h2>
          <select
            value={selectedExample}
            onChange={(e) => handleExampleChange(e.target.value as ExampleKey)}
            style={{ padding: '0.5rem', width: '100%', marginBottom: '0.5rem' }}
            data-testid="json-example-select"
          >
            {Object.keys(API_EXAMPLES).map((key) => (
              <option key={key} value={key}>{key}</option>
            ))}
          </select>
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            style={{ width: '100%', height: '180px', padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}
            data-testid="json-input"
          />
          <button
            onClick={handleJsonValidate}
            style={{ padding: '0.5rem 1rem', marginTop: '0.5rem', width: '100%' }}
            data-testid="json-validate"
          >
            Validate API Response
          </button>
          {jsonError && (
            <div data-testid="json-error" style={{ padding: '0.75rem', background: '#fee', color: '#c00', borderRadius: '4px', marginTop: '0.5rem', fontSize: '0.9rem' }}>
              {jsonError}
            </div>
          )}
          {jsonSuccess && (
            <div data-testid="json-success" style={{ padding: '0.75rem', background: '#efe', color: '#060', borderRadius: '4px', marginTop: '0.5rem', fontSize: '0.9rem' }}>
              {jsonSuccess}
            </div>
          )}
        </section>
      </div>

      {/* Users List */}
      <section style={{ marginTop: '2rem' }}>
        <h2>Users ({users.length})</h2>
        {users.length === 0 ? (
          <p data-testid="no-users">No users yet. Add one using the form or validate an API response above!</p>
        ) : (
          <ul data-testid="users-list">
            {users.map((user, idx) => (
              <li key={user.id + '-' + idx}>
                <strong>{user.name}</strong> - {user.email} {user.age !== undefined && `(age: ${user.age})`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default App
