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

        <h2>TL;DR tech</h2>
        <p>Uses <a href="https://github.com/oxc-project/tsgolint">tsgolint</a>'s shims for <a href="https://github.com/microsoft/typescript-go">typescript-go</a>'s internal packages to walk the AST and add validation functions. Deals with function params, function returns, JSON.parse, JSON.stringify, and casts.</p>
        
        <h2>How do I integrate this into my build?</h2>
        <p>Either use it as a transformer in your TypeScript build step, or use the integrations for node and bun.</p>

        <h2>Slow?</h2>
        <p>Slower than not validating, faster than runtime validation libraries*.</p> 
        <p><br/>Many optimisations still to come. It does try to validation where it can, but much more to do.</p>
        <p><br/>There are some benchmark results in the readme (and you can run them yourself) but... lies, damn lies, and benchmarks. If you have any input on the benchmarks I'd like to hear them. <br/>This is made to be fast, if its not, thats a bug. </p>

        <h2>Does this replace TypeScript?</h2>
        <p>No. It is a companion to TypeScript that makes types enforceable at runtime. <br/>You write TypeScript. It outputs TypeScript.</p>
      
        <br/><br/>
        <small>* Individual validation checks are quicker, but typical might run them a <strong>lot</strong> more often. But they are quick. So, don't know.</small>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'typical-production': TypicalProduction
  }
}
