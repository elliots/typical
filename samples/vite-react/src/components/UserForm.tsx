import { useState } from 'react'

import React from 'react'

// Email type using template literal - requires @ and . symbols
type Email = `${string}@${string}.${string}`

interface User {
  name: string
  email: Email
  age: number
}

function createUser(data: { name: string; email: Email; age: number }): User {
  return data
}

function validateAndSaveUser(user: User): string {
  return `User saved: ${user.name} (${user.email}), age ${user.age}`
}

export function UserForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [age, setAge] = useState('')
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Use 'any' for event handlers - React already validates these
  const handleSubmit = (e: React.FormEvent<HTMLElement>) => {
    e.preventDefault()
    setResult(null)

    try {
      // Cast email to Email type - typical will validate at runtime
      const user = createUser({
        name,
        email: email as Email,
        age: parseInt(age, 10)
      })
      const message = validateAndSaveUser(user)
      setResult({ type: 'success', message })
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div>
      <h2>Form Validation Demo</h2>
      <p>
        This form validates user input at runtime using TypeScript types.
        Try entering an invalid email (without @ and .) to see validation in action.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 15, maxWidth: 400 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 5 }}>Name:</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="John Doe"
            data-testid="name-input"
            style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 5 }}>Email (must contain @ and .):</label>
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="john@example.com"
            data-testid="email-input"
            style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 5 }}>Age (positive number):</label>
          <input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="25"
            data-testid="age-input"
            style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>

        <button
          type="submit"
          data-testid="submit-button"
          style={{
            padding: '10px 20px',
            background: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer'
          }}
        >
          Submit
        </button>
      </form>

      {result && (
        <div
          data-testid="result"
          data-result-type={result.type}
          style={{
            marginTop: 20,
            padding: 15,
            borderRadius: 4,
            background: result.type === 'success' ? '#d4edda' : '#f8d7da',
            color: result.type === 'success' ? '#155724' : '#721c24',
            border: `1px solid ${result.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`
          }}
        >
          {result.message}
        </div>
      )}
    </div>
  )
}
