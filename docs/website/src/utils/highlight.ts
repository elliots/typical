import Prism from "prismjs";
import "prismjs/components/prism-typescript";

/**
 * Highlights TypeScript code using Prism.js
 */
export function highlightTS(code: string): string {
  return Prism.highlight(code, Prism.languages.typescript, "typescript");
}

/**
 * CSS styles for Prism.js syntax highlighting (VS Code Dark+ theme)
 */
export const highlightStyles = `
  /* Prism.js VS Code Dark+ theme */
  code[class*="language-"],
  pre[class*="language-"] {
    color: #d4d4d4;
    background: none;
    font-family: Menlo, Monaco, Consolas, "Andale Mono", "Ubuntu Mono", "Courier New", monospace;
    text-align: left;
    white-space: pre;
    word-spacing: normal;
    word-break: normal;
    word-wrap: normal;
    line-height: 1.6;
    tab-size: 2;
    hyphens: none;
  }

  pre[class*="language-"] {
    margin: 0;
    overflow: auto;
  }

  :not(pre) > code[class*="language-"] {
    padding: .1em;
    border-radius: .3em;
    white-space: normal;
  }

  .token.comment,
  .token.prolog,
  .token.doctype,
  .token.cdata {
    color: #6a9955;
  }

  .token.punctuation {
    color: #d4d4d4;
  }

  .token.property,
  .token.tag,
  .token.boolean,
  .token.number,
  .token.constant,
  .token.symbol,
  .token.deleted {
    color: #b5cea8;
  }

  .token.selector,
  .token.attr-name,
  .token.string,
  .token.char,
  .token.builtin,
  .token.inserted {
    color: #ce9178;
  }

  .token.operator,
  .token.entity,
  .token.url,
  .language-css .token.string,
  .style .token.string {
    color: #d4d4d4;
  }

  .token.atrule,
  .token.attr-value,
  .token.keyword {
    color: #569cd6;
  }

  .token.function,
  .token.class-name {
    color: #dcdcaa;
  }

  .token.regex,
  .token.important,
  .token.variable {
    color: #d16969;
  }

  .token.important,
  .token.bold {
    font-weight: bold;
  }

  .token.italic {
    font-style: italic;
  }

  .token.entity {
    cursor: help;
  }

  /* Type highlighting (TypeScript specific) */
  .token.builtin,
  .token.class-name {
    color: #4ec9b0;
  }

  /* Property names */
  .token.property {
    color: #9cdcfe;
  }

  /* Additional styles for specific highlighting needs */
  .dim {
    opacity: 0.5;
  }

  .added {
    color: #4ec9b0;
    background: rgba(78, 201, 176, 0.1);
  }

  .error-output {
    color: #f48771;
    background: rgba(244, 135, 113, 0.1);
    padding: 0.5rem;
    border-radius: 4px;
    display: block;
    margin-top: 0.5rem;
  }
`;
