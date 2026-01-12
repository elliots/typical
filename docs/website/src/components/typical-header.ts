import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("typical-header")
export class TypicalHeader extends LitElement {
  @property({ type: String }) page = "";

  static styles = css`
    :host {
      display: block;
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--color-primary-dark, #235a97);
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 2rem;
      height: 60px;
      min-width: max-content;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
      color: white;
      text-decoration: none;
    }

    .logo:hover {
      text-decoration: none;
      opacity: 0.9;
    }

    .page-name {
      opacity: 0.8;
      font-weight: 400;
    }

    .logo-icon {
      width: 28px;
      height: 28px;
      background: white;
      color: var(--color-primary-dark, #235a97);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1rem;
    }

    nav {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    nav a {
      color: white;
      text-decoration: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      font-size: 0.95rem;
      transition: background-color 0.2s;
    }

    nav a:hover {
      background: rgba(255, 255, 255, 0.1);
      text-decoration: none;
    }

    .github-link {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .github-link svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }

    @media (max-width: 768px) {
      header {
        padding: 0 1rem;
      }

      nav {
        gap: 0;
      }

      nav a {
        padding: 0.5rem 0.75rem;
        font-size: 0.9rem;
      }
    }
  `;

  render() {
    return html`
      <header>
        <a href="/" class="logo">
          <span class="logo-icon">T</span>
          <span>Typical</span>
          ${this.page ? html`<span class="page-name">${this.page}</span>` : ""}
        </a>
        <nav>
          <a href="https://github.com/elliots/typical#readme" target="_blank">Docs</a>
          <a href="/playground.html">Playground</a>
          <a href="https://github.com/elliots/typical" target="_blank" class="github-link">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
          <a href="https://www.npmjs.com/package/@elliots/typical" target="_blank">npm</a>
        </nav>
      </header>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "typical-header": TypicalHeader;
  }
}
