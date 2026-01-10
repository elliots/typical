import { LitElement, html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

import './typical-header.js'
import './typical-hero.js'
import './typical-features.js'
import './typical-how-it-works.js'
import './typical-comparison.js'
import './typical-testimonial.js'
import './typical-production.js'
import './typical-footer.js'

@customElement('typical-app')
export class TypicalApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }
  `

  render() {
    return html`
      <typical-header></typical-header>
      <main>
        <typical-hero></typical-hero>
        <typical-features></typical-features>
        <!-- <typical-how-it-works></typical-how-it-works> -->
        <typical-comparison></typical-comparison>
        <!-- <typical-testimonial></typical-testimonial> -->
        <typical-production></typical-production>
      </main>
      <typical-footer></typical-footer>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'typical-app': TypicalApp
  }
}
