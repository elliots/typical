import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { highlightTS, highlightStyles } from '../utils/highlight.js';

const step1Code = `interface User {
  name: string;
  age: number;
}

function saveUser(
  user: User
) {
  db.save(user);
}`;

const step2Code = `interface User {
  name: string;
  age: number;
}

function saveUser(
  user: User
) {
  __validate(user, "User");
  db.save(user);
}`;

const step3Code = `// API returns bad data:
const user = {
  name: "Alice",
  age: "unknown"
};

saveUser(user);
// TypeError: property 'age'
//   expected number,
//   got string "unknown"`;

@customElement('typical-how-it-works')
export class TypicalHowItWorks extends LitElement {
  static styles = css`
    ${unsafeCSS(highlightStyles)}

    :host {
      display: block;
      padding: 5rem 2rem;
      background: #f7f7f7;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    h2 {
      text-align: center;
      font-size: 2rem;
      font-weight: 200;
      margin-bottom: 1rem;
      color: var(--color-text, #1a1a1a);
    }

    .subtitle {
      text-align: center;
      color: var(--color-text-light, #6b6b6b);
      margin-bottom: 3rem;
      font-size: 1.1rem;
    }

    .steps {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2rem;
    }

    .step {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    .step-header {
      background: #2d2d2d;
      color: #888;
      padding: 0.75rem 1rem;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .step-number {
      background: var(--color-primary, #3178c6);
      color: white;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .step-code {
      background: #1e1e1e;
      padding: 1.25rem;
      font-family: Menlo, Monaco, Consolas, "Andale Mono", "Ubuntu Mono", "Courier New", monospace;
      font-size: 0.8rem;
      line-height: 1.6;
      min-height: 200px;
      overflow-x: auto;
    }

    .step-code pre {
      margin: 0;
      background: none;
      padding: 0;
      color: #d4d4d4;
    }

    .step-description {
      padding: 1rem;
      background: white;
      font-size: 0.9rem;
      color: var(--color-text-light, #6b6b6b);
      border-top: 1px solid #e5e5e5;
    }

    @media (max-width: 900px) {
      .steps {
        grid-template-columns: 1fr;
      }

      h2 {
        font-size: 1.75rem;
      }
    }
  `;

  render() {
    return html`
      <div class="container">
        <h2>How It Works</h2>
        <p class="subtitle">
          Typical transforms your TypeScript at build time, adding validators that run at runtime.
        </p>
        <div class="steps">
          <div class="step">
            <div class="step-header">
              <span class="step-number">1</span>
              <span>Write TypeScript</span>
            </div>
            <div class="step-code">
              <pre><code class="language-typescript">${unsafeHTML(highlightTS(step1Code))}</code></pre>
            </div>
            <div class="step-description">
              Write normal TypeScript. No decorators, no schema definitions.
            </div>
          </div>

          <div class="step">
            <div class="step-header">
              <span class="step-number">2</span>
              <span>Typical transforms</span>
            </div>
            <div class="step-code">
              <pre><code class="language-typescript">${unsafeHTML(highlightTS(step2Code))}</code></pre>
            </div>
            <div class="step-description">
              Typical injects validators based on your types.
            </div>
          </div>

          <div class="step">
            <div class="step-header">
              <span class="step-number">3</span>
              <span>Errors at runtime</span>
            </div>
            <div class="step-code">
              <pre><code class="language-typescript">${unsafeHTML(highlightTS(step3Code))}</code></pre>
            </div>
            <div class="step-description">
              Invalid data is caught before it causes problems.
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'typical-how-it-works': TypicalHowItWorks;
  }
}
