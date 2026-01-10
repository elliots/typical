import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

@customElement('typical-production')
export class TypicalProduction extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 4rem 2rem;
      background: white;
    }

    .container {
      max-width: 800px;
      margin: 0 auto;
      text-align: center;
    }

    h2 {
      font-size: 1.75rem;
      font-weight: 200;
      margin-bottom: 1.5rem;
      color: var(--color-text, #1a1a1a);
    }

    p {
      font-size: 1.1rem;
      line-height: 1.6;
      color: var(--color-text-light, #6b6b6b);
      margin: 0;
    }

    @media (max-width: 768px) {
      h2 {
        font-size: 1.5rem;
      }

      p {
        font-size: 1rem;
      }
    }
  `

  render() {
    return html`
      <div class="container">
        <h2>Is this ready to use in production?</h2>
        <p>Probably not. But it will get there. Give it a try, and we'll work out the kinks together.</p>
        <p><br/>Being based on typescript-go, the core compiler is in Go, which means I have to distribute binaries.<br/>Need to work out how you can trust them.</p>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'typical-production': TypicalProduction
  }
}
