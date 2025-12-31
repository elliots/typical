import { useState } from 'react'
import { UserForm } from './components/UserForm'
import { ApiDemo } from './components/ApiDemo'

export default function App() {
  const [activeTab, setActiveTab] = useState<'form' | 'api'>('form')

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <h1>Typical + Vite + React Demo</h1>
      <p>This demo shows runtime type validation powered by <code>@elliots/typical</code></p>

      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => setActiveTab('form')}
          style={{
            padding: '10px 20px',
            marginRight: 10,
            background: activeTab === 'form' ? '#007bff' : '#eee',
            color: activeTab === 'form' ? 'white' : 'black',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer'
          }}
        >
          Form Validation
        </button>
        <button
          onClick={() => setActiveTab('api')}
          style={{
            padding: '10px 20px',
            background: activeTab === 'api' ? '#007bff' : '#eee',
            color: activeTab === 'api' ? 'white' : 'black',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer'
          }}
        >
          API/JSON Demo
        </button>
      </div>

      {activeTab === 'form' ? <UserForm /> : <ApiDemo />}
    </div>
  )
}
