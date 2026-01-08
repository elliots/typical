import * as vscode from 'vscode'
import type { ValidationItem } from './types'
import { DecorationManager } from './decoration-manager'

/**
 * Provides hover information for validation items.
 * This supplements the decoration hover messages with a more detailed view.
 */
export class HoverProvider implements vscode.HoverProvider {
  constructor(private decorationManager: DecorationManager) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
    const items = this.decorationManager.getCachedItems(document.uri.fsPath)
    if (!items) {
      return null
    }

    // Find item at position
    const item = items.find(i => {
      const range = new vscode.Range(i.startLine - 1, i.startColumn, i.endLine - 1, i.endColumn)
      return range.contains(position)
    })

    if (!item) {
      return null
    }

    return new vscode.Hover(this.createDetailedHover(item))
  }

  private createDetailedHover(item: ValidationItem): vscode.MarkdownString {
    const md = new vscode.MarkdownString()
    md.isTrusted = true

    const kindLabel = this.getKindLabel(item.kind)
    const statusIcon = item.status === 'validated' ? '✅' : '⏭️'

    md.appendMarkdown(`### ${statusIcon} Typical: ${kindLabel}\n\n`)
    md.appendMarkdown(`| Property | Value |\n`)
    md.appendMarkdown(`|----------|-------|\n`)
    md.appendMarkdown(`| **Name** | \`${item.name}\` |\n`)
    md.appendMarkdown(`| **Type** | \`${item.typeString}\` |\n`)
    md.appendMarkdown(`| **Status** | ${item.status === 'validated' ? 'Validated at runtime' : 'Skipped'} |\n`)

    if (item.skipReason) {
      md.appendMarkdown(`| **Reason** | ${item.skipReason} |\n`)
    }

    // md.appendMarkdown(`\n---\n`)
    // md.appendMarkdown(
    //   `*[Typical](https://github.com/elliotgoodrich/typical) runtime validation*`
    // )

    return md
  }

  private getKindLabel(kind: ValidationItem['kind']): string {
    switch (kind) {
      case 'parameter':
        return 'Parameter Validation'
      case 'return-type':
        return 'Return Type Validation'
      case 'return':
        return 'Return Value Validation'
      case 'cast':
        return 'Type Cast Validation'
      case 'json-parse':
        return 'JSON.parse Validation'
      case 'json-stringify':
        return 'JSON.stringify Validation'
      default:
        return 'Validation'
    }
  }
}
