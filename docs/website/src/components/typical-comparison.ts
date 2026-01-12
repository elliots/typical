import { LitElement, html, css, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { highlightTS, highlightStyles } from "../utils/highlight.js";

const zodCode = `import { z } from 'zod';

// Define the schema...
const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

// ...then derive the type
type User = z.infer<typeof UserSchema>;

// Use both everywhere
function saveUser(input: unknown) {
  const user = UserSchema.parse(input);
  // ...
}`;

const typicalCode = `// Just write the type
interface User {
  name: string;
  age: number;
  email: \`\${string}@\${string}.\${string}\`;
}

// Use it normally
function saveUser(user: User) {
  // Validation happens automatically!
  // ...
}

// That's it. No schema.
// No .parse() calls.
// Just TypeScript.`;

@customElement("typical-comparison")
export class TypicalComparison extends LitElement {
  static styles = css`
    ${unsafeCSS(highlightStyles)}

    :host {
      display: block;
      padding: 5rem 2rem;
      background: #f7f7f7;
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
          Can you define your validation needs with just types? If so, you can make things a lot simpler and faster.
        </p>
        <div class="comparison">
          <div class="side zod">
            <div class="side-header">With Zod</div>
            <div class="side-code">
              <pre><code class="language-typescript">${unsafeHTML(highlightTS(zodCode))}</code></pre>
            </div>
            <div class="side-footer">
              Schema + type + manual parse calls
            </div>
          </div>

          <div class="side typical">
            <div class="side-header">With Typical</div>
            <div class="side-code">
              <pre><code class="language-typescript">${unsafeHTML(highlightTS(typicalCode))}</code></pre>
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
    "typical-comparison": TypicalComparison;
  }
}
