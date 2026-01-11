import { LitElement, html, css, unsafeCSS } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { highlightTS, highlightStyles } from '../utils/highlight.js'

type TabId = 'typesafe' | 'vscode' | 'tools'

const beforeCode = `interface User {
  name: string
  email: \`\${string}@\${string}.\${string}\`
}

const u: User = JSON.parse(\`{"name":"Alice","email":"not-an-email"}\`);`

const afterCode = `// Typical transforms it to add runtime validation
type Email = \`\${string}@\${string}.\${string}\`; /* literal templates supported */

interface User {
  name: string;
  age: number;
  email: Email;
}

function greetUser(user: User): string { /* parameters validated! */
  return \`Hello, \${user.name}!\`; /* return value validated! */
}

const data = JSON.parse(response) as User; /* parse filtered and validated! */
greetUser(data);`

const errorCode = `// When invalid data arrives at runtime...
const badData = {
  name: "Alice",
  age: 25,
  email: "not-an-email"
};
greetUser(badData);`

const errorOutput = `Expected u.email to be \`\${string}@\${string}.\${string}\` got string (not-an-email)`

@customElement('typical-hero')
export class TypicalHero extends LitElement {
  static styles = css`
    ${unsafeCSS(highlightStyles)}

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
      line-height: 1.6;
    }

    .cta-buttons {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-top: 2rem;
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
      font-family:
        Menlo, Monaco, Consolas, "Andale Mono", "Ubuntu Mono", "Courier New",
        monospace;
      font-size: 0.8rem;
      line-height: 1.6;
      min-height: 320px;
      overflow-x: auto;
    }

    .code-content pre {
      margin: 0;
      background: none;
      padding: 0;
    }

    .tab-footer {
      padding: 1rem 1.5rem;
      background: #f7f7f7;
      font-size: 0.9rem;
      color: var(--color-text-light, #6b6b6b);
      border-top: 1px solid #e5e5e5;
    }

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

    .version-date {
      opacity: 0.7;
      font-size: 0.85rem;
    }

    /* Tools list */
    .tools-list {
      list-style: none;
      margin: 0;
      padding: 0;
      color: #d4d4d4;
    }

    .tools-list li {
      display: flex;
      align-items: center;
      padding: 0.4rem 0;
      border-bottom: 1px solid #333;
    }

    .tools-list li:last-child {
      border-bottom: none;
    }

    .tool-name {
      font-weight: 600;
      color: #fff;
      min-width: 100px;
    }

    .tool-method {
      color: #9cdcfe;
      font-family: Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
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
  `

  @state()
  private activeTab: TabId = 'typesafe'

  private getCodeContent(tab: TabId) {
    switch (tab) {
      case 'typesafe':
        return html`<code class="language-typescript"><pre>${unsafeHTML(highlightTS(beforeCode))}
        </pre></code>

<div class="error-output">${errorOutput.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        `
      case 'tools':
        return html`
          <ul class="tools-list">
            <li><span class="tool-name">Node.js</span><span class="tool-method">@elliots/typical/esm</span></li>
            <li><span class="tool-name">Bun</span><span class="tool-method">@elliots/bun-plugin-typical</span></li>
            <li><span class="tool-name">Vite</span><span class="tool-method">@elliots/unplugin-typical</span></li>
            <li><span class="tool-name">Webpack</span><span class="tool-method">@elliots/unplugin-typical</span></li>
            <li><span class="tool-name">Rollup</span><span class="tool-method">@elliots/unplugin-typical</span></li>
            <li><span class="tool-name">esbuild</span><span class="tool-method">@elliots/unplugin-typical</span></li>
            <li><span class="tool-name">tsc</span><span class="tool-method">@elliots/typical-tsc-plugin</span></li>
            <li><span class="tool-name">tsx</span><span class="tool-method">@elliots/typical/esm</span></li>
          </ul>
        `
      case 'vscode':
        return html`<img src="/vscode.png" alt="VSCode extension" style="width: 100%; margin: 0 1rem; vertical-align: middle;" />`
    }
  }

  private getTabFooter(tab: TabId): string {
    switch (tab) {
      case 'typesafe':
        return 'Invalid data is caught immediately with clear error messages.'
      case 'vscode':
        return 'See where validation is added, and hover to see details.'
      case 'tools':
        return 'Integrates with your existing TypeScript tools. Open an issue to request more.'
    }
  }

  private setActiveTab(tab: TabId) {
    this.activeTab = tab
  }

  render() {
    return html`
      <div class="container">
        <div class="content">
          <h1>Typical is <strong>TypeScript<br>with type-safety at <i>runtime.</i></strong></h1>
          <p class="subtitle">
            Transforms your TypeScript to add runtime validation automatically.
            <ul>
              <li>Built on Typescript 7.</li>
              <li>No runtime dependency. No changes to code.</li>
              <li>Works with all your existing tools.</li>
              <!-- <li>Pretty speedy (TBC, need more benchmarks)</li> -->
            </ul>
          </p>
          <div class="cta-buttons">
            <a href="https://github.com/elliots/typical#readme" class="btn btn-primary" target="_blank">
              <span>Get Started</span>
              <span class="btn-secondary">View on GitHub</span>
            </a>
            <a href="/playground.html" class="btn btn-primary">
              <span>Have a Play</span>
              <span class="btn-secondary">Open Playground</span>
            </a>
          </div>
        </div>
        <div class="code-demo">
          <div class="tabs">
            <button
              class="tab ${this.activeTab === 'typesafe' ? 'active' : ''}"
              @click=${() => this.setActiveTab('typesafe')}
            >Runtime type safety</button>
            <button
              class="tab ${this.activeTab === 'tools' ? 'active' : ''}"
              @click=${() => this.setActiveTab('tools')}
            >Tool Integration</button>
            <button
              class="tab ${this.activeTab === 'vscode' ? 'active' : ''}"
              @click=${() => this.setActiveTab('vscode')}
            >VSCode Addon</button>
           
          </div>
          <div class="code-content">
            ${this.getCodeContent(this.activeTab)}
          </div>
          <div class="tab-footer">
            ${this.getTabFooter(this.activeTab)}
          </div>
        </div>
      </div>
      <div class="version-bar">
        <span class="version-date">2026-01-11</span> <a href="https://www.npmjs.com/package/@elliots/typical" target="_blank">Typical 0.2.4</a> is now available
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'typical-hero': TypicalHero
  }
}
