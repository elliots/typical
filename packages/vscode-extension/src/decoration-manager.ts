import * as vscode from "vscode";
import type { ValidationItem, TypicalConfig } from "./types";

/**
 * Manages decorations (underlines) for validation indicators.
 */
export class DecorationManager {
  private validatedDecorationType: vscode.TextEditorDecorationType;
  private skippedDecorationType: vscode.TextEditorDecorationType;
  private cachedItems: Map<string, ValidationItem[]> = new Map();

  constructor(private config: TypicalConfig) {
    this.validatedDecorationType = this.createValidatedDecorationType(config.validatedColor);
    this.skippedDecorationType = this.createSkippedDecorationType(config.skippedColor);
  }

  private createValidatedDecorationType(color: string): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      textDecoration: `underline dotted ${color}`,
      opacity: "0.8",
      before: {
        contentText: "🔒",
        margin: "0 2px 0 0",
      },
    });
  }

  private createSkippedDecorationType(color: string): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      textDecoration: `underline dotted ${color}`,
      opacity: "0.8",
    });
  }

  /**
   * Update decorations for the given editor with validation items.
   */
  updateDecorations(editor: vscode.TextEditor, items: ValidationItem[]): void {
    if (!this.config.enabled) {
      this.clearDecorations(editor);
      return;
    }

    const filePath = editor.document.uri.fsPath;
    this.cachedItems.set(filePath, items);

    const validatedRanges: vscode.DecorationOptions[] = [];
    const skippedRanges: vscode.DecorationOptions[] = [];

    for (const item of items) {
      const range = new vscode.Range(
        item.startLine - 1, // Convert to 0-based
        item.startColumn,
        item.endLine - 1,
        item.endColumn,
      );

      const decoration: vscode.DecorationOptions = {
        range,
      };

      if (item.status === "validated") {
        validatedRanges.push(decoration);
      } else {
        skippedRanges.push(decoration);
      }
    }

    editor.setDecorations(this.validatedDecorationType, validatedRanges);
    editor.setDecorations(this.skippedDecorationType, skippedRanges);
  }

  /**
   * Clear all decorations from the editor.
   */
  clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.validatedDecorationType, []);
    editor.setDecorations(this.skippedDecorationType, []);
  }

  /**
   * Get cached items for a file.
   */
  getCachedItems(filePath: string): ValidationItem[] | undefined {
    return this.cachedItems.get(filePath);
  }

  /**
   * Clear cache for a file.
   */
  clearCache(filePath: string): void {
    this.cachedItems.delete(filePath);
  }

  /**
   * Update configuration and recreate decoration types if colours changed.
   */
  updateConfig(config: TypicalConfig): void {
    const coloursChanged =
      config.validatedColor !== this.config.validatedColor ||
      config.skippedColor !== this.config.skippedColor;

    this.config = config;

    if (coloursChanged) {
      this.validatedDecorationType.dispose();
      this.skippedDecorationType.dispose();
      this.validatedDecorationType = this.createValidatedDecorationType(config.validatedColor);
      this.skippedDecorationType = this.createSkippedDecorationType(config.skippedColor);
    }
  }

  /**
   * Dispose of decoration types.
   */
  dispose(): void {
    this.validatedDecorationType.dispose();
    this.skippedDecorationType.dispose();
    this.cachedItems.clear();
  }
}
