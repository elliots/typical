import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('typical-comparison')
export class TypicalComparison extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 5rem 2rem;
      background: white;
    }

    .container {
      max-width: 1000px;
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

    .comparison {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
    }

    .side {
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    .side-header {
      padding: 1rem 1.25rem;
      font-weight: 600;
      font-size: 1rem;
    }

    .side.zod .side-header {
      background: #3e3e3e;
      color: white;
    }

    .side.typical .side-header {
      background: var(--color-primary, #3178c6);
      color: white;
    }

    .side-code {
      background: #1e1e1e;
      padding: 1.5rem;
      font-family: Menlo, Monaco, Consolas, "Andale Mono", "Ubuntu Mono", "Courier New", monospace;
      font-size: 0.85rem;
      line-height: 1.6;
      min-height: 280px;
    }

    .side-code pre {
      margin: 0;
      background: none;
      padding: 0;
      color: #d4d4d4;
    }

    .side-footer {
      background: #f7f7f7;
      padding: 1rem 1.25rem;
      font-size: 0.9rem;
      color: var(--color-text-light, #6b6b6b);
    }

    .side.typical .side-footer {
      color: var(--color-primary, #3178c6);
      font-weight: 500;
    }

    /* Syntax highlighting */
    .keyword { color: #569cd6; }
    .function { color: #dcdcaa; }
    .type { color: #4ec9b0; }
    .string { color: #ce9178; }
    .number { color: #b5cea8; }
    .comment { color: #6a9955; }
    .property { color: #9cdcfe; }
    .dim { opacity: 0.5; }

    @media (max-width: 768px) {
      .comparison {
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
        <h2>Typical vs Zod</h2>
        <p class="subtitle">
          Why write your types twice? With Typical, you don't have to.
        </p>
        <div class="comparison">
          <div class="side zod">
            <div class="side-header">With Zod</div>
            <div class="side-code">
              <pre><span class="keyword">import</span> { z } <span class="keyword">from</span> <span class="string">'zod'</span>;

<span class="comment">// Define the schema...</span>
<span class="keyword">const</span> <span class="property">UserSchema</span> = <span class="property">z</span>.<span class="function">object</span>({
  <span class="property">name</span>: <span class="property">z</span>.<span class="function">string</span>(),
  <span class="property">age</span>: <span class="property">z</span>.<span class="function">number</span>().<span class="function">min</span>(<span class="number">0</span>),
  <span class="property">email</span>: <span class="property">z</span>.<span class="function">string</span>().<span class="function">email</span>(),
});

<span class="comment">// ...then derive the type</span>
<span class="keyword">type</span> <span class="type">User</span> = <span class="property">z</span>.<span class="function">infer</span>&lt;<span class="keyword">typeof</span> <span class="property">UserSchema</span>&gt;;

<span class="comment">// Use both everywhere</span>
<span class="keyword">function</span> <span class="function">saveUser</span>(<span class="property">input</span>: <span class="type">unknown</span>) {
  <span class="keyword">const</span> <span class="property">user</span> = <span class="property">UserSchema</span>.<span class="function">parse</span>(<span class="property">input</span>);
  <span class="comment">// ...</span>
}</pre>
            </div>
            <div class="side-footer">
              Schema + type + manual parse calls
            </div>
          </div>

          <div class="side typical">
            <div class="side-header">With Typical</div>
            <div class="side-code">
              <pre><span class="comment">// Just write the type</span>
<span class="keyword">interface</span> <span class="type">User</span> {
  <span class="property">name</span>: <span class="type">string</span>;
  <span class="property">age</span>: <span class="type">number</span>;
  <span class="property">email</span>: <span class="type">string</span>;
}

<span class="comment">// Use it normally</span>
<span class="keyword">function</span> <span class="function">saveUser</span>(<span class="property">user</span>: <span class="type">User</span>) {
  <span class="comment">// Validation happens automatically!</span>
  <span class="comment">// ...</span>
}

<span class="dim">
<span class="comment">// That's it. No schema.</span>
<span class="comment">// No .parse() calls.</span>
<span class="comment">// Just TypeScript.</span></span></pre>
            </div>
            <div class="side-footer">
              Just types. Validation is automatic.
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'typical-comparison': TypicalComparison;
  }
}
