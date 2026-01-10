import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('typical-footer')
export class TypicalFooter extends LitElement {
  static styles = css`
    :host {
      display: block;
      background: var(--color-primary, #3178c6);
      color: white;
      padding: 3rem 2rem;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 4rem;
      align-items: start;
    }

    .brand {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
    }

    .logo-icon {
      width: 28px;
      height: 28px;
      background: white;
      color: var(--color-primary, #3178c6);
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1rem;
    }

    .tagline {
      font-size: 0.9rem;
      opacity: 0.9;
    }

    .copyright {
      font-size: 0.85rem;
      opacity: 0.7;
      margin-top: 1rem;
    }

    .made-in {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }

    .made-in .flag {
      font-size: 1.2rem;
    }

    .links-section h3 {
      font-size: 0.9rem;
      font-weight: 600;
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.8;
    }

    .links-section ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .links-section li {
      margin-bottom: 0.5rem;
    }

    .links-section a {
      color: white;
      text-decoration: none;
      font-size: 0.95rem;
      opacity: 0.9;
      transition: opacity 0.2s;
    }

    .links-section a:hover {
      opacity: 1;
      text-decoration: underline;
    }

    @media (max-width: 768px) {
      .container {
        grid-template-columns: 1fr;
        gap: 2rem;
      }

      .links-section {
        display: flex;
        gap: 2rem;
      }

      .links-section h3 {
        display: none;
      }

      .links-section ul {
        display: flex;
        gap: 1.5rem;
        flex-wrap: wrap;
      }

      .links-section li {
        margin: 0;
      }
    }
  `;

  render() {
    const year = new Date().getFullYear();

    return html`
      <footer>
        <div class="container">
          <div class="brand">
            <div class="logo">
              <span class="logo-icon">T</span>
              <span>Typical</span>
            </div>
            <div class="tagline">TypeScript with validation at runtime.</div>
            <div class="copyright">
              MIT License &copy; ${year} Elliot Shepherd - e@elliots.dev
            </div>
            <div class="made-in">
              <span class="flag">🇦🇺</span> Made in Australia
            </div>
          </div>
          <div class="links-section">
            <h3>Resources</h3>
            <ul>
              <li><a href="https://github.com/elliots/typical#readme" target="_blank">Documentation</a></li>
              <li><a href="https://github.com/elliots/typical" target="_blank">GitHub</a></li>
              <li><a href="https://www.npmjs.com/package/@elliots/typical" target="_blank">npm</a></li>
              <li><a href="/playground/">Playground</a></li>
            </ul>
          </div>
          <div class="links-section">
            <h3>Community</h3>
            <ul>
              <li><a href="https://github.com/elliots/typical/issues" target="_blank">Issues</a></li>
              <!-- <li><a href="https://github.com/elliots/typical/discussions" target="_blank">Discussions</a></li> -->
              <!-- <li><a href="https://github.com/elliots/typical/releases" target="_blank">Releases</a></li> -->
            </ul>
          </div>
        </div>
      </footer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'typical-footer': TypicalFooter;
  }
}
