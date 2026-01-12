import * as vscode from "vscode";

export const PREVIEW_SCHEME = "typical-preview";

/**
 * Provides virtual document content for the compiled TypeScript preview.
 * Uses VSCode's TextDocumentContentProvider for built-in syntax highlighting.
 */
export class PreviewProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  // Cache of transformed content per file path
  private cache = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    const filePath = uri.path;
    return this.cache.get(filePath) ?? "// Loading...";
  }

  /**
   * Update the cached content for a file and notify VSCode to refresh.
   */
  update(filePath: string, content: string): void {
    this.cache.set(filePath, content);
    const uri = vscode.Uri.parse(`${PREVIEW_SCHEME}:${filePath}`);
    this._onDidChange.fire(uri);
  }

  /**
   * Set an error message for a file.
   */
  setError(filePath: string, error: string): void {
    this.cache.set(filePath, `// Error transforming file:\n// ${error}`);
    const uri = vscode.Uri.parse(`${PREVIEW_SCHEME}:${filePath}`);
    this._onDidChange.fire(uri);
  }

  /**
   * Check if we have cached content for a file.
   */
  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  /**
   * Clear cached content for a file.
   */
  clear(filePath: string): void {
    this.cache.delete(filePath);
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.cache.clear();
  }
}
