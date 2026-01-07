import * as vscode from 'vscode'
import type { ValidationItem } from './types'
import { DecorationManager } from './decoration-manager'

/**
 * Provides inlay hints showing validation status inline.
 * This is optional and can be toggled via settings.
 */
export class InlayHintsProvider implements vscode.InlayHintsProvider {
  private enabled: boolean = false

  constructor(private decorationManager: DecorationManager) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.InlayHint[]> {
    if (!this.enabled) {
      return []
    }

    const items = this.decorationManager.getCachedItems(document.uri.fsPath)
    if (!items) {
      return []
    }

    const hints: vscode.InlayHint[] = []

    for (const item of items) {
      // Check if item is within the requested range
      const itemStart = new vscode.Position(item.startLine - 1, item.startColumn)
      const itemEnd = new vscode.Position(item.endLine - 1, item.endColumn)

      if (itemEnd.isBefore(range.start) || itemStart.isAfter(range.end)) {
        continue
      }

      const hint = this.createHint(item)
      if (hint) {
        hints.push(hint)
      }
    }

    return hints
  }

  private createHint(item: ValidationItem): vscode.InlayHint | null {
    // Position hint at the end of the item
    const position = new vscode.Position(item.endLine - 1, item.endColumn)

    const label = item.status === 'validated' ? ' ✓' : ' ○'

    const hint = new vscode.InlayHint(position, label, vscode.InlayHintKind.Type)

    // Set tooltip
    hint.tooltip = this.createTooltip(item)

    // Make it slightly transparent
    hint.paddingLeft = true

    return hint
  }

  private createTooltip(item: ValidationItem): string {
    const kindLabel = this.getKindLabel(item.kind)

    if (item.status === 'validated') {
      return `${kindLabel} "${item.name}" (${item.typeString}) will be validated at runtime`
    } else {
      return `${kindLabel} "${item.name}" (${item.typeString}) skipped: ${item.skipReason || 'unknown'}`
    }
  }

  private getKindLabel(kind: ValidationItem['kind']): string {
    switch (kind) {
      case 'parameter':
        return 'Parameter'
      case 'return-type':
        return 'Return type'
      case 'return':
        return 'Return value'
      case 'cast':
        return 'Type cast'
      case 'json-parse':
        return 'JSON.parse result'
      case 'json-stringify':
        return 'JSON.stringify input'
      default:
        return 'Value'
    }
  }
}
