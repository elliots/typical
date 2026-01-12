import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("typical-testimonial")
export class TypicalTestimonial extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 5rem 2rem;
      background: #f7f7f7;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    h2 {
      text-align: center;
      font-size: 2rem;
      font-weight: 200;
      margin-bottom: 3rem;
      color: var(--color-text, #1a1a1a);
    }

    .testimonial-card {
      background: white;
      border-radius: 12px;
      padding: 3rem;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 3rem;
      align-items: center;
    }

    .quote {
      font-size: 1.1rem;
      line-height: 1.8;
      color: var(--color-text, #1a1a1a);
    }

    .quote p {
      margin-bottom: 1rem;
    }

    .quote p:last-child {
      margin-bottom: 0;
    }

    .highlight {
      color: var(--color-primary, #3178c6);
      font-weight: 500;
    }

    .attribution {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      min-width: 200px;
    }

    .avatar {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 2rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }

    .name {
      font-weight: 600;
      color: var(--color-text, #1a1a1a);
      margin-bottom: 0.25rem;
    }

    .role {
      font-size: 0.9rem;
      color: var(--color-text-light, #6b6b6b);
      margin-bottom: 1rem;
    }

    .company-logo {
      font-size: 1.5rem;
      font-weight: 700;
      color: #333;
      letter-spacing: -0.02em;
    }

    .quote-mark {
      font-size: 4rem;
      color: var(--color-primary, #3178c6);
      opacity: 0.2;
      line-height: 1;
      margin-bottom: -1rem;
    }

    @media (max-width: 768px) {
      .testimonial-card {
        grid-template-columns: 1fr;
        padding: 2rem;
      }

      .attribution {
        flex-direction: row;
        gap: 1rem;
        text-align: left;
        min-width: auto;
      }

      .avatar {
        width: 60px;
        height: 60px;
        font-size: 1.5rem;
        margin-bottom: 0;
      }

      h2 {
        font-size: 1.75rem;
      }
    }
  `;

  render() {
    return html`
      <div class="container">
        <h2>What Developers Say</h2>
        <div class="testimonial-card">
          <div class="quote">
            <div class="quote-mark">"</div>
            <p>
              <span class="highlight">First</span>, we were amazed that we didn't have to rewrite all our types as Zod schemas.
            </p>
            <p>
              <span class="highlight">Second</span>, we found three production bugs in the first hour &mdash;
              API responses that didn't match our TypeScript types.
            </p>
            <p>
              Typical was such a revelation that we immediately mass adopted it across our entire codebase
              and mass deleted all our Zod schemas.
            </p>
          </div>
          <div class="attribution">
            <div class="avatar">JD</div>
            <div class="name">Jane Developer</div>
            <div class="role">Senior Engineer</div>
            <div class="company-logo">Acme Corp</div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "typical-testimonial": TypicalTestimonial;
  }
}
