import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

@customElement('typical-features')
export class TypicalFeatures extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 5rem 2rem;
      background: white;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    h2 {
      text-align: center;
      font-size: 2rem;
      font-weight: 200;
      margin-bottom: 3rem;
      color: var(--color-text, #1a1a1a);
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 3rem;
    }

    .feature {
      text-align: center;
    }

    .feature h3 {
      font-size: 1.25rem;
      font-weight: 400;
      margin-bottom: 1rem;
      color: var(--color-text, #1a1a1a);
    }

    .feature p {
      color: var(--color-text-light, #6b6b6b);
      line-height: 1.7;
      margin: 0;
    }

    .feature strong {
      color: var(--color-text, #1a1a1a);
    }

    /* Get Started cards */
    .get-started {
      margin-top: 5rem;
      padding-top: 3rem;
      border-top: 1px solid #e5e5e5;
    }

    .get-started h2 {
      margin-bottom: 2rem;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2rem;
    }

    .card {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem;
      background: #f7f7f7;
      border-radius: 8px;
      text-decoration: none;
      color: inherit;
      transition: all 0.2s;
    }

    .card:hover {
      background: #efefef;
      transform: translateY(-2px);
      text-decoration: none;
    }

    .card-icon {
      width: 48px;
      height: 48px;
      margin-bottom: 1rem;
      fill: var(--color-primary, #3178c6);
    }

    .card h3 {
      font-size: 1.1rem;
      font-weight: 400;
      margin-bottom: 0.5rem;
      color: var(--color-primary, #3178c6);
    }

    .card p {
      color: var(--color-text-light, #6b6b6b);
      font-size: 0.95rem;
      margin: 0;
    }

    @media (max-width: 768px) {
      .features-grid,
      .cards {
        grid-template-columns: 1fr;
        gap: 2rem;
      }

      h2 {
        font-size: 1.75rem;
      }
    }
  `

  render() {
    return html`
      <div class="container">
        <h2>What is Typical?</h2>
        <div class="features-grid">
          <div class="feature">
            <h3>Zero Code Changes</h3>
            <p>
              Just use TypeScript types normally. Typical automatically adds runtime validators &mdash;
              <strong>no decorators, no schemas, no extra code</strong>.
            </p>
          </div>
          <div class="feature">
            <h3>Runtime Safety</h3>
            <p>
              Catch invalid data from APIs, JSON.parse, and user input at runtime &mdash;
              <strong>where TypeScript's compile-time checks can't help</strong>.
            </p>
          </div>
          <div class="feature">
            <h3>Data Leak Prevention</h3>
            <p>
              Safe JSON.stringify only includes properties you've defined in your types,
              <strong>preventing accidental exposure of sensitive data</strong>.
            </p>
          </div>
        </div>

        <div class="get-started">
          <h2>Get Started</h2>
          <div class="cards">
            <a href="https://github.com/elliots/typical#readme" target="_blank" class="card">
              <svg class="card-icon" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z"/>
                <path d="M8 12h8v2H8zm0 4h8v2H8z"/>
              </svg>
              <h3>README</h3>
              <p>Learn how it works</p>
            </a>
            <a href="https://www.npmjs.com/package/@elliots/typical" target="_blank" class="card">
              <svg class="card-icon" viewBox="0 0 24 24">
                <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331zM10.665 10H12v2.667h-1.335V10z"/>
              </svg>
              <h3>npm</h3>
              <p>Install the package</p>
            </a>
            <a href="https://github.com/elliots/typical" target="_blank" class="card">
              <svg class="card-icon" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              <h3>GitHub</h3>
              <p>View the source</p>
            </a>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'typical-features': TypicalFeatures
  }
}
