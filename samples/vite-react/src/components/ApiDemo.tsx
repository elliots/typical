import { useState } from 'react'

interface ApiResponse {
  id: number
  name: string
  active: boolean
}

function parseApiResponse(json: string): ApiResponse {
  return JSON.parse(json)
}

function stringifyForApi(data: ApiResponse): string {
  return JSON.stringify(data)
}

export function ApiDemo() {
  const [jsonInput, setJsonInput] = useState('{"id": 1, "name": "Test", "active": true}')
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleParse = () => {
    setResult(null)
    try {
      const parsed = parseApiResponse(jsonInput)
      const stringified = stringifyForApi(parsed)
      setResult({
        type: 'success',
        message: `Parsed successfully!\nID: ${parsed.id}\nName: ${parsed.name}\nActive: ${parsed.active}\n\nStringified: ${stringified}`,
      })
    } catch (err) {
      console.log(err)
      setResult({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const setValidJson = () => {
    setJsonInput('{"id": 42, "name": "Valid User", "active": true}')
  }

  const setInvalidJson = () => {
    setJsonInput('{"id": "not-a-number", "name": 123, "active": "yes"}')
  }

  const setMalformedJson = () => {
    setJsonInput('{ invalid json }')
  }

  return (
    <div>
      <h2>JSON.parse / JSON.stringify Demo</h2>
      <p>Typical automatically validates JSON.parse results against the expected type and ensures JSON.stringify only includes declared properties.</p>

      <div style={{ marginBottom: 15 }}>
        <button onClick={setValidJson} style={{ marginRight: 10, padding: '5px 10px' }}>
          Set Valid JSON
        </button>
        <button onClick={setInvalidJson} data-testid="set-invalid" style={{ marginRight: 10, padding: '5px 10px' }}>
          Set Invalid Types
        </button>
        <button onClick={setMalformedJson} style={{ padding: '5px 10px' }}>
          Set Malformed JSON
        </button>
      </div>

      <div style={{ marginBottom: 15 }}>
        <label style={{ display: 'block', marginBottom: 5 }}>JSON Input:</label>
        <textarea
          value={jsonInput}
          onChange={e => setJsonInput(e.target.value)}
          data-testid="json-input"
          style={{
            width: '100%',
            height: 100,
            padding: 8,
            borderRadius: 4,
            border: '1px solid #ccc',
            fontFamily: 'monospace',
          }}
        />
      </div>

      <button
        onClick={handleParse}
        data-testid="parse-button"
        style={{
          padding: '10px 20px',
          background: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Parse & Stringify
      </button>

      {result && (
        <pre
          data-testid="api-result"
          data-result-type={result.type}
          style={{
            marginTop: 20,
            padding: 15,
            borderRadius: 4,
            background: result.type === 'success' ? '#d4edda' : '#f8d7da',
            color: result.type === 'success' ? '#155724' : '#721c24',
            border: `1px solid ${result.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
            whiteSpace: 'pre-wrap',
            overflow: 'auto',
          }}
        >
          {result.message}
        </pre>
      )}
    </div>
  )
}
