import { LitElement, html, css } from "lit";
import { customElement, state, query } from "lit/decorators.js";
import * as monaco from "monaco-editor";
import { ModuleDetectionKind } from "typescript";
import * as prettier from "prettier/standalone";
import prettierPluginTypescript from "prettier/plugins/typescript";
import prettierPluginEstree from "prettier/plugins/estree";

// URL hash utilities for sharing with compression
// Uses DeflateRaw for smaller output than gzip (no header/footer)

async function compressSource(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const compressed = await new Response(cs.readable).arrayBuffer();
  const binary = Array.from(new Uint8Array(compressed), (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function decompressSource(encoded: string): Promise<string | null> {
  try {
    // Restore standard base64 characters
    let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const decompressed = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(decompressed);
  } catch {
    return null;
  }
}

// Memoized promise for loading source from URL hash
let hashSourcePromise: Promise<string | null> | null = null;

function initSourceFromHash(): Promise<string | null> {
  if (hashSourcePromise) return hashSourcePromise;

  const hash = window.location.hash.slice(1);
  if (!hash) {
    hashSourcePromise = Promise.resolve(null);
    return hashSourcePromise;
  }

  const params = new URLSearchParams(hash);
  const encoded = params.get("code");
  if (!encoded) {
    hashSourcePromise = Promise.resolve(null);
    return hashSourcePromise;
  }

  hashSourcePromise = decompressSource(encoded);
  return hashSourcePromise;
}

let pendingHashUpdate: ReturnType<typeof setTimeout> | null = null;

function setSourceInHash(source: string): void {
  // Debounce hash updates to avoid blocking the main thread
  if (pendingHashUpdate) {
    clearTimeout(pendingHashUpdate);
  }
  pendingHashUpdate = setTimeout(async () => {
    const encoded = await compressSource(source);
    const params = new URLSearchParams();
    params.set("code", encoded);
    window.history.replaceState(null, "", "#" + params.toString());
    pendingHashUpdate = null;
  }, 100);
}

// Compiler types
interface TransformResult {
  code: string;
  sourceMap?: object;
}

interface WasmCompiler {
  start(): Promise<void>;
  close(): Promise<void>;
  transformSource(fileName: string, source: string): Promise<TransformResult>;
}

interface Example {
  name: string;
  description: string;
  code: string;
}

const EXAMPLES: Example[] = [
  {
    name: "JSON.parse validation",
    description: "Validates data parsed from JSON",
    code: `interface User {
  name: string;
  email: \`\${string}@\${string}.\${string}\`;
}

const user = JSON.parse('{"name": "Alice", "email": "not@quite"}') as User
console.log('User name:', user.name); // Won't reach here
`,
  },
  {
    name: "API Response",
    description: "Validating external API data",
    code: `// Typical validates data from external sources
interface ApiResponse {
  status: 'success' | 'error';
  data: {
    items: Array<{
      id: number;
      title: string;
      completed: boolean;
    }>;
    total: number;
  };
}

async function callBackend(): Promise<ApiResponse> {
  const response = await fetch('/fake-api-response.json');
  return await response.json(); // Validated as ApiResponse
}

console.log('Data from backend:', await callBackend());
`,
  },
  {
    name: "Nested Objects",
    description:
      "Deep validation of nested structures, and hoisting of reusable validation functions",
    code: `// Deep validation of nested objects
interface Address {
  street: string;
  city: string;
  country: string;
  postalCode: string;
}

interface Company {
  name: string;
  address: Address;
  employees: number;
}

interface Person {
  name: string;
  email: string;
  company: Company;
  address: Address;
}

function invitePerson(person: Person, invitedBy: Person): void {
  console.log(\`inviting \${person.name} from \${person.company.name} (invited by \${invitedBy.name})\`);
}

// Note how the validation function for Person (_check_Person) has been hoisted to the top level so it can be reused for both params.
`,
  },
  {
    name: "Arrays & Tuples",
    description: "Array and tuple validation",
    code: `// Array and tuple validation
type Point = [number, number];
type RGB = [number, number, number];

interface Shape {
  type: 'circle' | 'rectangle' | 'polygon';
  points: Point[];
  color: RGB;
}

function drawShape(shape: Shape): void {
  console.log(\`Drawing \${shape.type} with \${shape.points.length} points\`);
}

function calculateDistance(p1: Point, p2: Point): number {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function isPointInShape(shape: Shape, p: Point): boolean {
  // <some complicated code>
  return true
}

console.log(calculateDistance([1,2], [2,'3'] as any))
`,
  },
  {
    name: "Data leak prevention",
    description: "Only stringify the data in the types",
    code: `interface DBUser {
  username: string
  password: string
}

type APIUser = Omit<DBUser, 'password'>

function getDBUser(): DBUser {
  return {
    username: "alice",
    password: "supersecret"
  };
}

// No problem compile-time. But the password is still there!
const u: APIUser = getDBUser(); 

// Object is filtered before stringify
console.log("User:", JSON.stringify(u)); 

// Or, if you really need it, cast back to full type
console.log("Full user:", JSON.stringify(u as DBUser));
`,
  },
  {
    name: "Call analysis",
    description: "Skip validation if data is known to be valid",
    code: `// A call graph is built for the entire project, so we can keep track of what has been 
// already validated. We can then skip unnecessary duplicate validation. This is all compile-time.

interface User {
  name: string;
}

// An internal function. 
// Params: Only validated if called with unvalidated data
// Returns: Validated
function internalFunction(u: User): User {
  return u; // Skipped, because already valid
}

// An exported function. All params must be validated, but its returns can be trusted.
export function exportedFunction(u: User): User {
  return u; // Skipped, because already valid
}

// An external, unvalidated function. It's returns can't be trusted.
declare function externalFunction(u: User): User;

export function process(user: User): User {
  const user2 = exportedFunction(internalFunction(user));
  const user3 = externalFunction(user2); // user2 is already validated, but its result needs to be checked
  const user4 = externalFunction(user3); // user3 is dirty (escaped in step3), needs validation
  // user4 remains unvalidated, as it is never looked at again
  return user3;
}`,
  },
];

@customElement("typical-playground")
export class TypicalPlayground extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: calc(100vh - 60px); /* Account for header height */
      background: var(--color-bg, #ffffff);
    }

    .playground-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    /* Examples dropdown */
    .examples-dropdown {
      position: relative;
    }

    .examples-btn {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.5rem;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: #999;
      font-family: inherit;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .examples-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: white;
      border-color: rgba(255, 255, 255, 0.3);
    }

    .examples-btn svg {
      width: 12px;
      height: 12px;
    }

    .examples-menu {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      background: white;
      border-radius: 6px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      min-width: 280px;
      max-height: 400px;
      overflow-y: auto;
      z-index: 100;
      display: none;
    }

    .examples-menu.open {
      display: block;
    }

    .example-item {
      display: block;
      width: 100%;
      padding: 0.75rem 1rem;
      border: none;
      background: none;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s;
      font-family: inherit;
    }

    .example-item:hover {
      background: var(--color-bg-alt, #f7f7f7);
    }

    .example-item.active {
      background: var(--color-primary, #3178c6);
      color: white;
    }

    .example-item .example-name {
      font-weight: 500;
      font-size: 0.95rem;
      color: var(--color-text, #1a1a1a);
    }

    .example-item.active .example-name {
      color: white;
    }

    .example-item .example-desc {
      font-size: 0.8rem;
      color: var(--color-text-light, #6b6b6b);
      margin-top: 2px;
    }

    .example-item.active .example-desc {
      color: rgba(255, 255, 255, 0.8);
    }

    /* Main content */
    .playground-main {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* Editor panels */
    .editor-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 1rem;
      background: #2d2d2d;
      border-bottom: 1px solid #3d3d3d;
    }

    .panel-tabs {
      display: flex;
      gap: 0;
    }

    .panel-tab {
      padding: 0.5rem 1rem;
      background: none;
      border: none;
      color: #888;
      font-family: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
      border-bottom: 2px solid transparent;
    }

    .panel-tab:hover {
      color: #ccc;
    }

    .panel-tab.active {
      color: white;
      border-bottom-color: var(--color-primary, #3178c6);
    }

    .panel-label {
      font-size: 0.8rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .format-checkbox {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      color: #888;
      cursor: pointer;
      user-select: none;
    }

    .format-checkbox:hover {
      color: #ccc;
    }

    .format-checkbox input {
      cursor: pointer;
    }

    .editor-container {
      flex: 1;
      overflow: hidden;
    }

    /* Resize handle */
    .resize-handle {
      width: 6px;
      background: #2d2d2d;
      cursor: col-resize;
      transition: background 0.2s;
    }

    .resize-handle:hover {
      background: var(--color-primary, #3178c6);
    }

    /* Output panel */
    .output-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #1e1e1e;
      overflow: hidden;
      font-family: var(--font-mono, Menlo, Monaco, Consolas, monospace);
      font-size: 0.9rem;
      line-height: 1.6;
      position: relative;
    }

    .output-code {
      padding: 1rem;
      margin: 0;
      white-space: pre-wrap;
      color: #d4d4d4;
    }

    /* Status bar */
    .status-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.4rem 1rem;
      background: var(--color-primary, #3178c6);
      color: white;
      font-size: 0.8rem;
    }

    .status-left {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .status-item {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4caf50;
    }

    .status-dot.loading {
      background: #ff9800;
      animation: pulse 1s infinite;
    }

    .status-dot.error {
      background: #f44336;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* Error display */
    .error-message {
      color: #f48771;
      background: rgba(244, 135, 113, 0.1);
      padding: 1rem;
      border-left: 3px solid #f48771;
      margin: 0;
      white-space: pre-wrap;
    }

    /* Syntax highlighting for output */
    .keyword { color: #569cd6; }
    .function { color: #dcdcaa; }
    .type { color: #4ec9b0; }
    .string { color: #ce9178; }
    .number { color: #b5cea8; }
    .comment { color: #6a9955; }
    .property { color: #9cdcfe; }
    .punctuation { color: #d4d4d4; }

    /* Loading overlay */
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(30, 30, 30, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 1rem;
      color: white;
      z-index: 50;
    }

    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255, 255, 255, 0.2);
      border-top-color: var(--color-primary, #3178c6);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Console panel */
    .console-panel {
      height: 150px;
      background: #1e1e1e;
      border-top: 1px solid #3d3d3d;
      display: flex;
      flex-direction: column;
    }

    .console-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.4rem 1rem;
      background: #2d2d2d;
      border-bottom: 1px solid #3d3d3d;
    }

    .console-title {
      font-size: 0.8rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .run-btn {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.75rem;
      background: #4caf50;
      border: none;
      border-radius: 4px;
      color: white;
      font-family: inherit;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .run-btn:hover {
      background: #43a047;
    }

    .run-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .run-btn svg {
      width: 14px;
      height: 14px;
    }

    .clear-btn {
      padding: 0.35rem 0.75rem;
      background: transparent;
      border: 1px solid #555;
      border-radius: 4px;
      color: #888;
      font-family: inherit;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .clear-btn:hover {
      background: #333;
      color: #ccc;
    }

    .share-btn {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.75rem;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 4px;
      color: white;
      font-family: inherit;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
    }

    .share-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.5);
    }

    .share-btn svg {
      width: 14px;
      height: 14px;
    }

    .share-tooltip {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      padding: 0.4rem 0.75rem;
      background: #333;
      border-radius: 4px;
      font-size: 0.75rem;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .share-tooltip.visible {
      opacity: 1;
    }

    .share-tooltip::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: #333;
    }

    .console-output {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem 1rem;
      font-family: var(--font-mono, Menlo, Monaco, Consolas, monospace);
      font-size: 0.85rem;
      line-height: 1.5;
    }

    .console-line {
      padding: 2px 0;
      border-bottom: 1px solid #2a2a2a;
    }

    .console-line.log {
      color: #d4d4d4;
    }

    .console-line.error {
      color: #f48771;
      background: rgba(244, 135, 113, 0.1);
    }

    .console-line.warn {
      color: #dcdcaa;
      background: rgba(220, 220, 170, 0.1);
    }

    .console-empty {
      color: #666;
      font-style: italic;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .playground-main {
        flex-direction: column;
      }

      .resize-handle {
        width: 100%;
        height: 6px;
        cursor: row-resize;
      }

      .editor-panel {
        min-height: 200px;
      }
    }
  `;

  @state() private inputCode = EXAMPLES[0].code;
  @state() private shareTooltip = "";
  @state() private outputCode = "";
  @state() private outputTab: "transformed" | "sourcemap" = "transformed";
  @state() private selectedExample = 0;
  @state() private examplesOpen = false;
  @state() private compilerStatus: "loading" | "ready" | "error" = "loading";
  @state() private editorStatus: "loading" | "ready" | "error" = "loading";
  @state() private compilerError = "";
  @state() private transformError = "";
  @state() private transformTime = 0;
  @state() private sourceMap: object | null = null;
  @state() private consoleOutput: Array<{ type: "log" | "error" | "warn"; message: string }> = [];
  @state() private isRunning = false;
  @state() private formatOutput = false;

  @query("#input-editor") private inputEditorContainer!: HTMLDivElement;
  @query("#output-editor") private outputEditorContainer!: HTMLDivElement;

  private inputEditor: monaco.editor.IStandaloneCodeEditor | null = null;
  private outputEditor: monaco.editor.IStandaloneCodeEditor | null = null;
  private compiler: WasmCompiler | null = null;

  async connectedCallback() {
    super.connectedCallback();

    // Load code from URL hash if present (async decompression)
    const hashSource = await initSourceFromHash();
    if (hashSource) {
      this.inputCode = hashSource;
    }

    this.initMonaco();
    await this.initCompiler();
  }

  async firstUpdated() {
    await this.updateComplete;

    // Close dropdown when clicking outside (use capture to get the event before it's retargeted)
    document.addEventListener("click", (e) => {
      if (this.examplesOpen) {
        // Check if click is inside the dropdown using composedPath for shadow DOM
        const path = e.composedPath();
        const dropdown = this.shadowRoot?.querySelector(".examples-dropdown");
        if (dropdown && !path.includes(dropdown)) {
          this.examplesOpen = false;
        }
      }
    });

    // Initialise editor after DOM is ready
    if (monaco && this.editorStatus === "ready") {
      this.initEditor();
    }
  }

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);
    // Create output editor when it becomes available (after loading completes)
    if (monaco && !this.outputEditor && this.outputEditorContainer) {
      this.initOutputEditor();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.inputEditor?.dispose();
    this.outputEditor?.dispose();
    this.compiler?.close();
    this.styleObserver?.disconnect();
  }

  private initMonaco() {
    // Configure Monaco workers
    (self as unknown as Record<string, unknown>).MonacoEnvironment = {
      getWorker(_workerId: string, label: string) {
        if (label === "typescript" || label === "javascript") {
          return new Worker(
            new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
            { type: "module" },
          );
        }
        return new Worker(
          new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
          { type: "module" },
        );
      },
    };

    // Copy Monaco styles into shadow DOM
    this.adoptMonacoStyles();

    // Configure TypeScript compiler options for the playground
    // Don't spread existing options - Monaco includes lib.d.ts by default
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.Classic,
      strict: true,
      allowNonTsExtensions: true,
      // Treat all files as modules to enable top-level await
      moduleDetection: ModuleDetectionKind.Force,
    });

    this.editorStatus = "ready";

    // If DOM is ready, init editor
    if (this.inputEditorContainer) {
      this.initEditor();
    }
  }

  private adoptedStyleSheets = new Set<CSSStyleSheet>();
  private styleObserver: MutationObserver | null = null;

  private adoptMonacoStyles() {
    // Find all Monaco-related stylesheets in the document and copy them to shadow DOM
    const shadowRoot = this.shadowRoot;
    if (!shadowRoot) return;

    this.copyMonacoStyles();

    // Watch for new style elements being added (Monaco adds styles dynamically)
    if (!this.styleObserver) {
      this.styleObserver = new MutationObserver(() => {
        this.copyMonacoStyles();
      });
      this.styleObserver.observe(document.head, { childList: true, subtree: true });
    }
  }

  private copyMonacoStyles() {
    const shadowRoot = this.shadowRoot;
    if (!shadowRoot) return;

    // Get all stylesheets from the document
    const styleSheets = Array.from(document.styleSheets);
    for (const sheet of styleSheets) {
      // Skip if already adopted
      if (this.adoptedStyleSheets.has(sheet)) continue;

      try {
        // Check if this stylesheet contains Monaco rules
        const href = sheet.href || "";
        let hasMonacoRules = false;

        // Check href for obvious Monaco files
        if (href.includes("monaco") || href.includes("editor.main")) {
          hasMonacoRules = true;
        } else if (sheet.cssRules) {
          // Check actual CSS rules for Monaco selectors
          const rules = Array.from(sheet.cssRules);
          hasMonacoRules = rules.some(
            (rule) => rule.cssText?.includes(".monaco-") || rule.cssText?.includes(".vs-dark"),
          );
        }

        if (hasMonacoRules) {
          if (sheet.href) {
            // External stylesheet - link to it
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = sheet.href;
            shadowRoot.appendChild(link);
          } else if (sheet.cssRules) {
            // Inline stylesheet - copy rules
            const rules = Array.from(sheet.cssRules);
            const style = document.createElement("style");
            style.textContent = rules.map((r) => r.cssText).join("\n");
            shadowRoot.appendChild(style);
          }
          this.adoptedStyleSheets.add(sheet);
        }
      } catch {
        // CORS may prevent accessing cssRules, ignore
      }
    }
  }

  private async initCompiler() {
    try {
      // Import ZenFS for browser filesystem
      const { fs } = await import("@zenfs/core");

      // Create /tmp directory for the compiler
      try {
        fs.mkdirSync("/tmp", { recursive: true });
      } catch {
        // Directory may already exist
      }

      // Dynamically import the WASM compiler using Vite alias
      // @ts-ignore - resolved by Vite alias
      const module = await import("@typical/compiler-wasm");

      const { WasmTypicalCompiler, wasmPath, wrapSyncFSForGo } = module as {
        WasmTypicalCompiler: new (options: {
          wasmPath: URL;
          fs?: object;
          fetchWasm?: (url: string | URL) => Promise<ArrayBuffer>;
        }) => WasmCompiler;
        wasmPath: URL;
        wrapSyncFSForGo: (syncFs: typeof fs) => object;
      };

      // Wrap ZenFS for Go WASM compatibility
      const wrappedFs = wrapSyncFSForGo(fs);

      // Custom fetch function that tries gzipped WASM first (production), then falls back to uncompressed (dev)
      const fetchWasm = async (url: string | URL): Promise<ArrayBuffer> => {
        const urlStr = url.toString();

        // Try gzipped version first (exists in production builds)
        const gzUrl = urlStr + ".gz";
        try {
          const gzResponse = await fetch(gzUrl);
          // Check content-type to ensure it's actually a gzip file, not an error page
          const contentType = gzResponse.headers.get("content-type") || "";
          if (gzResponse.ok && !contentType.includes("text/html")) {
            console.log("Loading compressed WASM from", gzUrl);
            const data = await gzResponse.arrayBuffer();

            // Check if browser already decompressed it (Content-Encoding: gzip header was present)
            // If the server sends Content-Encoding: gzip, browser auto-decompresses
            // We can detect this by checking if the data looks like valid WASM (starts with \0asm)
            const header = new Uint8Array(data.slice(0, 4));
            const isWasm =
              header[0] === 0x00 && header[1] === 0x61 && header[2] === 0x73 && header[3] === 0x6d;

            if (isWasm) {
              // Browser already decompressed it
              console.log(
                "WASM already decompressed by browser:",
                (data.byteLength / 1024 / 1024).toFixed(1),
                "MB",
              );
              return data;
            }

            // Manually decompress using DecompressionStream (native browser API)
            const ds = new DecompressionStream("gzip");
            const decompressedData = await new Response(
              new Blob([data]).stream().pipeThrough(ds),
            ).arrayBuffer();
            console.log(
              "Decompressed WASM:",
              (decompressedData.byteLength / 1024 / 1024).toFixed(1),
              "MB",
            );
            return decompressedData;
          }
        } catch (e) {
          // Gzipped version not available (dev mode), fall through to uncompressed
          console.log("Gzipped WASM not available, falling back to uncompressed:", e);
        }

        // Fall back to uncompressed WASM (dev mode)
        console.log("Loading uncompressed WASM from", urlStr);
        const response = await fetch(urlStr);
        if (!response.ok) {
          throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
        }
        return response.arrayBuffer();
      };

      // Create compiler with ZenFS and custom fetch
      this.compiler = new WasmTypicalCompiler({ wasmPath, fs: wrappedFs, fetchWasm });

      await this.compiler.start();
      this.compilerStatus = "ready";

      // Run initial transform
      await this.transform();
    } catch (err) {
      console.error("Failed to initialise compiler:", err);
      this.compilerStatus = "error";
      this.compilerError = err instanceof Error ? err.message : String(err);
    }
  }

  private initEditor() {
    if (!this.inputEditorContainer || !monaco) return;

    // Guard against double-creation
    if (this.inputEditor) return;

    this.inputEditor = monaco.editor.create(this.inputEditorContainer, {
      value: this.inputCode,
      language: "typescript",
      theme: "vs-dark",
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: "on",
      padding: { top: 16, bottom: 16 },
      fixedOverflowWidgets: true,
    });

    // Auto-transform on change with debounce
    let debounceTimer: number;
    this.inputEditor.onDidChangeModelContent(() => {
      this.inputCode = this.inputEditor?.getValue() || "";
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        this.transform();
        // Update URL hash for sharing
        setSourceInHash(this.inputCode);
      }, 500);
    });

    // Create output editor if container is available
    this.initOutputEditor();
  }

  private initOutputEditor() {
    if (!this.outputEditorContainer || !monaco || this.outputEditor) return;

    this.outputEditor = monaco.editor.create(this.outputEditorContainer, {
      value: this.outputCode,
      language: "typescript",
      theme: "vs-dark",
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: "on",
      padding: { top: 16, bottom: 16 },
      fixedOverflowWidgets: true,
    });
  }

  private async transform() {
    if (this.compilerStatus !== "ready" || !this.compiler) return;

    this.transformError = "";
    const startTime = performance.now();

    try {
      const result = await this.compiler.transformSource("playground.ts", this.inputCode);
      let code = result.code;

      this.outputCode = code;
      this.sourceMap = result.sourceMap || null;
      this.transformTime = Math.round(performance.now() - startTime);
      this.outputEditor?.setValue(this.outputCode);

      // Format output if checkbox is enabled
      if (this.formatOutput && this.outputEditor) {
        const formatted = await prettier.format(code, {
          parser: "typescript",
          plugins: [prettierPluginTypescript, prettierPluginEstree],
          printWidth: 80,
          tabWidth: 2,
          singleQuote: true,
        });
        this.outputEditor.setValue(formatted);
      }
    } catch (err) {
      this.transformError = err instanceof Error ? err.message : String(err);
      this.outputCode = "";
      this.transformTime = 0;
      this.outputEditor?.setValue("");
    }
  }

  private toggleFormatOutput() {
    this.formatOutput = !this.formatOutput;
    this.transform();
  }

  private selectExample(index: number) {
    this.selectedExample = index;
    this.inputCode = EXAMPLES[index].code;
    if (this.inputEditor) {
      this.inputEditor.setValue(this.inputCode);
    }
    this.examplesOpen = false;
    this.transform();
    setSourceInHash(this.inputCode);
  }

  private toggleExamples() {
    this.examplesOpen = !this.examplesOpen;
  }

  private async runCode() {
    if (!monaco || !this.outputEditor || this.isRunning) return;

    this.isRunning = true;
    this.consoleOutput = [];

    try {
      // Use Monaco's TypeScript worker to transpile to JavaScript
      const model = this.outputEditor.getModel();
      if (!model) {
        throw new Error("No model found");
      }

      const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
      const worker = await getWorker(model.uri);
      const output = await worker.getEmitOutput(String(model.uri));

      if (output.outputFiles.length === 0) {
        throw new Error("No output generated");
      }

      const jsCode = output.outputFiles[0].text;

      // Create a custom console to capture output
      const capturedLogs: Array<{ type: "log" | "error" | "warn"; message: string }> = [];
      const customConsole = {
        log: (...args: unknown[]) => {
          capturedLogs.push({
            type: "log",
            message: args.map((a) => this.formatValue(a)).join(" "),
          });
        },
        error: (...args: unknown[]) => {
          capturedLogs.push({
            type: "error",
            message: args.map((a) => this.formatValue(a)).join(" "),
          });
        },
        warn: (...args: unknown[]) => {
          capturedLogs.push({
            type: "warn",
            message: args.map((a) => this.formatValue(a)).join(" "),
          });
        },
      };

      // Create a custom fetch that serves fake API responses
      const customFetch = async (url: string) => {
        // Serve fake API response for demo
        if (url === "/fake-api-response.json") {
          return {
            json: async () => ({
              status: "success",
              data: {
                items: [
                  { id: 1, title: "Learn TypeScript", completed: true },
                  { id: 2, title: "Try Typical", completed: false },
                  { id: 3, title: "Build something awesome", completed: "nothing" },
                ],
                total: 3,
              },
            }),
          };
        }
        throw new Error(`Fetch not supported in playground: ${url}`);
      };

      // Store globals for the module to access
      (window as any).__playground_console__ = customConsole;
      (window as any).__playground_fetch__ = customFetch;

      // Wrap code to use our custom console and fetch
      const moduleCode = `
const console = window.__playground_console__;
const fetch = window.__playground_fetch__;
${jsCode}
`;

      // Create a Blob URL and dynamically import it as an ES module
      const blob = new Blob([moduleCode], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        await import(/* @vite-ignore */ url);
      } finally {
        URL.revokeObjectURL(url);
        delete (window as Record<string, unknown>).__playground_console__;
        delete (window as Record<string, unknown>).__playground_fetch__;
      }

      this.consoleOutput = capturedLogs;

      if (capturedLogs.length === 0) {
        this.consoleOutput = [{ type: "log", message: "(no output)" }];
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.consoleOutput = [{ type: "error", message }];
    } finally {
      this.isRunning = false;
    }
  }

  private formatValue(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  private clearConsole() {
    this.consoleOutput = [];
  }

  private async shareCode() {
    try {
      // Compress and update URL
      const encoded = await compressSource(this.inputCode);
      const params = new URLSearchParams();
      params.set("code", encoded);
      window.history.replaceState(null, "", "#" + params.toString());

      // Copy the updated URL
      await navigator.clipboard.writeText(window.location.href);
      this.shareTooltip = "Copied!";
    } catch {
      this.shareTooltip = "Failed to copy";
    }

    // Hide tooltip after 2 seconds
    setTimeout(() => {
      this.shareTooltip = "";
    }, 2000);
  }

  render() {
    const isLoading = this.compilerStatus === "loading" || this.editorStatus === "loading";

    return html`
      <div class="playground-container">
        <!-- Main editor area -->
        <main class="playground-main">
          <!-- Input panel -->
          <div class="editor-panel">
            <div class="panel-header">
              <span class="panel-label">Input (TypeScript)</span>
              <!-- Examples dropdown -->
              <div class="examples-dropdown">
                <button class="examples-btn" @click=${this.toggleExamples}>
                  Examples
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
                <div class="examples-menu ${this.examplesOpen ? "open" : ""}">
                  ${EXAMPLES.map(
                    (example, i) => html`
                    <button
                      class="example-item ${this.selectedExample === i ? "active" : ""}"
                      @click=${() => this.selectExample(i)}
                    >
                      <div class="example-name">${example.name}</div>
                      <div class="example-desc">${example.description}</div>
                    </button>
                  `,
                  )}
                </div>
              </div>
            </div>
            <div class="editor-container" id="input-editor"></div>
          </div>

          <!-- Resize handle -->
          <div class="resize-handle"></div>

          <!-- Output panel -->
          <div class="editor-panel">
            <div class="panel-header">
              <div class="panel-tabs">
                <button
                  class="panel-tab ${this.outputTab === "transformed" ? "active" : ""}"
                  @click=${() => (this.outputTab = "transformed")}
                >
                  Transformed
                </button>
                <button
                  class="panel-tab ${this.outputTab === "sourcemap" ? "active" : ""}"
                  @click=${() => (this.outputTab = "sourcemap")}
                >
                  Source Map
                </button>
              </div>
              <label class="format-checkbox">
                <input
                  type="checkbox"
                  .checked=${this.formatOutput}
                  @change=${() => this.toggleFormatOutput()}
                />
                Prettier
              </label>
            </div>
            <div class="output-container">
              ${
                isLoading
                  ? html`
                <div class="loading-overlay">
                  <div class="loading-spinner"></div>
                  <div>Loading ${this.compilerStatus === "loading" ? "compiler" : "editor"}...</div>
                </div>
              `
                  : this.compilerStatus === "error"
                    ? html`
                <pre class="error-message">Failed to load compiler:\n${this.compilerError}</pre>
              `
                    : this.transformError
                      ? html`
                <pre class="error-message">${this.transformError}</pre>
              `
                      : html`
                <div class="editor-container" id="output-editor" style="${this.outputTab === "transformed" ? "" : "display: none"}"></div>
                <pre class="output-code" style="${this.outputTab === "sourcemap" ? "" : "display: none"}">${this.sourceMap ? JSON.stringify(this.sourceMap, null, 2) : "No source map generated"}</pre>
              `
              }
            </div>
          </div>
        </main>

        <!-- Console panel -->
        <div class="console-panel">
          <div class="console-header">
            <div style="display: flex; align-items: center; gap: 1rem;">
              <button
                class="run-btn"
                @click=${() => this.runCode()}
                ?disabled=${this.compilerStatus !== "ready" || this.isRunning}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                ${this.isRunning ? "Running..." : "Run"}
              </button>
              <span class="console-title">Console</span>
            </div>
            <button class="clear-btn" @click=${() => this.clearConsole()}>Clear</button>
          </div>
          <div class="console-output">
            ${
              this.consoleOutput.length === 0
                ? html`
              <div class="console-empty">Click "Run" to execute the code</div>
            `
                : this.consoleOutput.map(
                    (entry) => html`
              <div class="console-line ${entry.type}">${entry.message}</div>
            `,
                  )
            }
          </div>
        </div>

        <!-- Status bar -->
        <footer class="status-bar">
          <div class="status-left">
            <div class="status-item">
              <span class="status-dot ${isLoading ? "loading" : this.compilerStatus === "error" ? "error" : ""}"></span>
              <span>
                ${isLoading ? "Loading..." : this.compilerStatus === "error" ? "Error" : "Compiler Ready"}
              </span>
            </div>
            ${
              this.transformTime > 0
                ? html`
              <div class="status-item">
                Transform: ${this.transformTime}ms
              </div>
            `
                : ""
            }
          </div>
          <div style="display: flex; align-items: center; gap: 1rem;">
            <button class="share-btn" @click=${() => this.shareCode()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              Share
              <span class="share-tooltip ${this.shareTooltip ? "visible" : ""}">${this.shareTooltip}</span>
            </button>
          </div>
        </footer>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "typical-playground": TypicalPlayground;
  }
}
