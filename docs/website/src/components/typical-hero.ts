import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type TabId = 'before' | 'after' | 'error';

@customElement('typical-hero')
export class TypicalHero extends LitElement {
  static styles = css`
    :host {
      display: block;
      background: var(--color-primary, #3178c6);
      color: white;
      padding: 4rem 2rem;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4rem;
      align-items: center;
    }

    .content h1 {
      font-size: 2.5rem;
      font-weight: 200;
      line-height: 1.2;
      margin-bottom: 1.5rem;
    }

    .content h1 strong {
      font-weight: 400;
    }

    .subtitle {
      font-size: 1.25rem;
      opacity: 0.95;
      margin-bottom: 2rem;
      line-height: 1.6;
    }

    .cta-buttons {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      padding: 0.75rem 1.5rem;
      border-radius: 4px;
      font-size: 1rem;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.2s;
    }

    .btn-primary {
      background: white;
      color: var(--color-primary, #3178c6);
    }

    .btn-primary:hover {
      background: #f0f0f0;
      text-decoration: none;
    }

    .btn-secondary {
      font-size: 0.85rem;
      opacity: 0.8;
    }

    .code-demo {
      background: #1e1e1e;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
    }

    .tabs {
      display: flex;
      background: #2d2d2d;
      padding: 0;
    }

    .tab {
      padding: 0.75rem 1.25rem;
      background: none;
      border: none;
      color: #888;
      font-family: inherit;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.2s;
      border-bottom: 2px solid transparent;
    }

    .tab:hover {
      color: #ccc;
    }

    .tab.active {
      color: white;
      background: #1e1e1e;
      border-bottom-color: var(--color-primary, #3178c6);
    }

    .code-content {
      padding: 1.5rem;
      font-family: Menlo, Monaco, Consolas, "Andale Mono", "Ubuntu Mono", "Courier New", monospace;
      font-size: 0.9rem;
      line-height: 1.6;
      min-height: 280px;
      overflow-x: auto;
    }

    .code-content pre {
      margin: 0;
      background: none;
      padding: 0;
    }

    /* Syntax highlighting */
    .keyword { color: #569cd6; }
    .function { color: #dcdcaa; }
    .type { color: #4ec9b0; }
    .string { color: #ce9178; }
    .number { color: #b5cea8; }
    .comment { color: #6a9955; }
    .property { color: #9cdcfe; }
    .punctuation { color: #d4d4d4; }
    .error { color: #f48771; background: rgba(244, 135, 113, 0.1); padding: 0.5rem; border-radius: 4px; display: block; margin-top: 0.5rem; }

    /* Version bar */
    .version-bar {
      background: var(--color-primary-dark, #235a97);
      text-align: center;
      padding: 0.75rem;
      margin-top: 3rem;
      margin-left: -2rem;
      margin-right: -2rem;
      margin-bottom: -4rem;
      font-size: 0.95rem;
    }

    .version-bar a {
      color: white;
      font-weight: 500;
    }

    .version-bar a:hover {
      text-decoration: underline;
    }

    @media (max-width: 900px) {
      .container {
        grid-template-columns: 1fr;
        gap: 2rem;
      }

      .content h1 {
        font-size: 2rem;
      }

      .code-demo {
        max-width: 100%;
      }
    }
  `;

  @state()
  private activeTab: TabId = 'before';

  private codeExamples: Record<TabId, TemplateResult<1>> = {
    before: html`<span class="comment">// Your TypeScript code - no changes needed</span>
<span class="keyword">type</span> <span class="type">Email</span> = <span class="string">\`\${string}@\${string}.\${string}\`</span>;

<span class="keyword">interface</span> <span class="type">User</span> {
  <span class="property">name</span>: <span class="type">string</span>;
  <span class="property">age</span>: <span class="type">number</span>;
  <span class="property">email</span>: <span class="type">Email</span>;
}

<span class="keyword">function</span> <span class="function">greetUser</span>(<span class="property">user</span>: <span class="type">User</span>): <span class="type">string</span> {
  <span class="keyword">return</span> <span class="string">\`Hello, \${<span class="property">user</span>.<span class="property">name</span>}!\`</span>;
}

<span class="keyword">const</span> <span class="property">data</span> = <span class="function">JSON</span>.<span class="function">parse</span>(<span class="property">response</span>);
<span class="function">greetUser</span>(<span class="property">data</span>);<br/>&nbsp;`,

    after: html`<span class="comment">// Typical transforms it to add runtime validation</span>
<span class="keyword">type</span> <span class="type">Email</span> = <span class="string">\`\${string}@\${string}.\${string}\`</span>;

<span class="keyword">interface</span> <span class="type">User</span> {
  <span class="property">name</span>: <span class="type">string</span>;
  <span class="property">age</span>: <span class="type">number</span>;
  <span class="property">email</span>: <span class="type">Email</span>;
}

<span class="keyword">function</span> <span class="function">greetUser</span>(<span class="property">user</span>: <span class="type">User</span>): <span class="type">string</span> {
  <span class="comment">/* validator injected */</span> <span class="function">__validateUser</span>(<span class="property">user</span>);
  <span class="keyword">return</span> <span class="string">\`Hello, \${<span class="property">user</span>.<span class="property">name</span>}!\`</span>;
}

<span class="keyword">const</span> <span class="property">data</span> = <span class="function">JSON</span>.<span class="function">parse</span>(<span class="property">response</span>) <span class="keyword">as</span> <span class="type">User</span>; <span class="comment">/* validated! */</span>
<span class="function">greetUser</span>(<span class="property">data</span>);`,

    error: html`<span class="comment">// When invalid data arrives at runtime...</span>
<span class="keyword">const</span> <span class="property">badData</span> = {
  <span class="property">name</span>: <span class="string">"Alice"</span>,
  <span class="property">age</span>: <span class="number">25</span>,
  <span class="property">email</span>: <span class="string">"not-an-email"</span>
};
<span class="function">greetUser</span>(<span class="property">badData</span>);

<span class="error">TypeError: Expected user.email to be
\`\${string}@\${string}.\${string}\`
got string (not-an-email)</span>


<span class="comment">// Typical validates template literal types at runtime!</span>`
  };

  private setActiveTab(tab: TabId) {
    this.activeTab = tab;
  }

  render() {
    return html`
      <div class="container">
        <div class="content">
          <h1>Typical is <strong>TypeScript<br>with validation at runtime.</strong></h1>
          <p class="subtitle">
            Typical is a transformer that makes Typescript type-safe at runtime.
            <br/> <br/>
            Built on Typescript 7. No runtime dependency. Pure Typescript. Works with all your existing tooling (Vite, Node.js, Bun, tsc, tsx etc)
          </p>
          <div class="cta-buttons">
            <a href="https://github.com/elliots/typical#readme" class="btn btn-primary" target="_blank">
              <span>Get Started</span>
              <span class="btn-secondary">View on GitHub</span>
            </a>
          </div>
        </div>
        <div class="code-demo">
          <div class="tabs">
            <button
              class="tab ${this.activeTab === 'before' ? 'active' : ''}"
              @click=${() => this.setActiveTab('before')}
            >Your Code</button>
            <button
              class="tab ${this.activeTab === 'after' ? 'active' : ''}"
              @click=${() => this.setActiveTab('after')}
            >Transformed</button>
            <button
              class="tab ${this.activeTab === 'error' ? 'active' : ''}"
              @click=${() => this.setActiveTab('error')}
            >Runtime Error</button>
          </div>
          <div class="code-content">
            <pre>${this.codeExamples[this.activeTab]}</pre>
          </div>
        </div>
      </div>
      <div class="version-bar">
        <a href="https://github.com/elliots/typical/releases" target="_blank">Typical 0.2.3</a> is now available
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'typical-hero': TypicalHero;
  }
}
