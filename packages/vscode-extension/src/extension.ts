import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { CompilerClient, findBinary, hasTypicalDependency } from './compiler-client'
import { DecorationManager } from './decoration-manager'
import { HoverProvider } from './hover-provider'
import { InlayHintsProvider } from './inlay-hints'
import { PreviewProvider, PREVIEW_SCHEME } from './preview-provider'
import type { TypicalConfig, ProjectHandle } from './types'

let client: CompilerClient | null = null
let decorationManager: DecorationManager | null = null
let inlayHintsProvider: InlayHintsProvider | null = null
let previewProvider: PreviewProvider | null = null
let debounceTimer: NodeJS.Timeout | null = null
let previewDebounceTimer: NodeJS.Timeout | null = null
let outputChannel: vscode.OutputChannel
let workspaceRoot: string = ''

// Track which files have an open preview
const activePreviewFiles = new Set<string>()

// Cache of tsconfig path -> project handle
const projectCache: Map<string, ProjectHandle> = new Map()

const DEBOUNCE_MS = 500

function getConfig(): TypicalConfig {
  const config = vscode.workspace.getConfiguration('typical')
  return {
    enabled: config.get('enabled', true),
    showInlayHints: config.get('showInlayHints', false),
    validatedColor: config.get('validatedColor', '#4CAF50'),
    skippedColor: config.get('skippedColor', '#9E9E9E'),
  }
} 

function log(message: string): void {
  outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`)
}

/**
 * Find the nearest tsconfig.json for a file by walking up the directory tree.
 */
function findTsConfig(filePath: string): string | null {
  let dir = path.dirname(filePath)
  const root = path.parse(dir).root

  while (dir !== root) {
    const tsconfig = path.join(dir, 'tsconfig.json')
    if (fs.existsSync(tsconfig)) {
      return tsconfig
    }
    dir = path.dirname(dir)
  }

  return null
}

/**
 * Get or load the project for a file.
 */
async function getProjectForFile(filePath: string): Promise<ProjectHandle | null> {
  if (!client) return null

  const tsconfigPath = findTsConfig(filePath)
  if (!tsconfigPath) {
    log(`No tsconfig.json found for ${filePath}`)
    return null
  }

  // Check cache
  const cached = projectCache.get(tsconfigPath)
  if (cached) {
    return cached
  }

  // Load project
  try {
    log(`Loading project from ${tsconfigPath}...`)
    const handle = await client.loadProject(tsconfigPath)
    log(`Project loaded: ${handle.id} with ${handle.rootFiles.length} files`)
    projectCache.set(tsconfigPath, handle)
    return handle
  } catch (err) {
    log(`Failed to load project ${tsconfigPath}: ${err}`)
    return null
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('Typical')
  context.subscriptions.push(outputChannel)

  log('Typical extension activating...')

  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) {
    log('No workspace folder found')
    return
  }

  workspaceRoot = workspaceFolders[0].uri.fsPath

  // Check if this project uses Typical
  if (!hasTypicalDependency(workspaceRoot)) {
    log('Project does not have Typical as a dependency, skipping activation')
    return
  }

  log('Project uses Typical, looking for compiler binary...')

  // Find the Go binary
  const binaryPath = findBinary(workspaceRoot)
  if (!binaryPath) {
    log('Typical compiler binary not found in node_modules')
    vscode.window.showWarningMessage(
      'Typical: Compiler binary not found. Run `npm install` to install dependencies.'
    )
    return
  }

  log(`Found compiler binary at: ${binaryPath}`)

  // Create compiler client
  client = new CompilerClient(binaryPath, workspaceRoot)

  // Create decoration manager
  const config = getConfig()
  decorationManager = new DecorationManager(config)
  context.subscriptions.push({ dispose: () => decorationManager?.dispose() })

  // Create hover provider
  const hoverProvider = new HoverProvider(decorationManager)
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ scheme: 'file', language: 'typescript' }, { scheme: 'file', language: 'typescriptreact' }],
      hoverProvider
    )
  )

  // Create inlay hints provider
  inlayHintsProvider = new InlayHintsProvider(decorationManager)
  inlayHintsProvider.setEnabled(config.showInlayHints)
  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider(
      [{ scheme: 'file', language: 'typescript' }, { scheme: 'file', language: 'typescriptreact' }],
      inlayHintsProvider
    )
  )

  // Create preview provider for compiled output
  previewProvider = new PreviewProvider()
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, previewProvider)
  )
  context.subscriptions.push({ dispose: () => previewProvider?.dispose() })

  // Start the compiler
  try {
    await client.start()
    log('Compiler started successfully')
  } catch (err) {
    log(`Failed to start compiler: ${err}`)
    vscode.window.showErrorMessage(`Typical: Failed to start compiler: ${err}`)
    return
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('typical.toggleIndicators', () => {
      const config = vscode.workspace.getConfiguration('typical')
      const current = config.get('enabled', true)
      config.update('enabled', !current, vscode.ConfigurationTarget.Workspace)
      vscode.window.showInformationMessage(
        `Typical indicators ${!current ? 'enabled' : 'disabled'}`
      )
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('typical.refreshFile', async () => {
      const editor = vscode.window.activeTextEditor
      if (editor && isTypescriptFile(editor.document)) {
        await analyseAndDecorate(editor)
        vscode.window.showInformationMessage('Typical: File refreshed')
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('typical.openPreview', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor || !isTypescriptFile(editor.document)) {
        vscode.window.showWarningMessage('Typical: Open a TypeScript file first')
        return
      }

      const filePath = editor.document.uri.fsPath
      await openPreview(filePath, editor.document.getText())
    })
  )

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('typical')) {
        const newConfig = getConfig()
        decorationManager?.updateConfig(newConfig)
        inlayHintsProvider?.setEnabled(newConfig.showInlayHints)

        // Re-analyse current editor
        const editor = vscode.window.activeTextEditor
        if (editor && isTypescriptFile(editor.document)) {
          analyseAndDecorate(editor)
        }
      }
    })
  )

  // Listen for active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isTypescriptFile(editor.document)) {
        analyseAndDecorate(editor)
      }
    })
  )

  // Listen for document saves
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isTypescriptFile(document)) {
        const editor = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.fsPath === document.uri.fsPath
        )
        if (editor) {
          analyseAndDecorateDebounced(editor)
        }
      }
    })
  )

  // Listen for document changes (debounced)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isTypescriptFile(e.document)) {
        const filePath = e.document.uri.fsPath
        const editor = vscode.window.visibleTextEditors.find(
          (e2) => e2.document.uri.fsPath === filePath
        )
        if (editor) {
          analyseAndDecorateDebounced(editor)
        }
        // Update preview if open for this file
        if (activePreviewFiles.has(filePath)) {
          updatePreviewDebounced(filePath, e.document.getText())
        }
      }
    })
  )

  // Clean up preview tracking when preview documents are closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === PREVIEW_SCHEME) {
        const filePath = doc.uri.path
        activePreviewFiles.delete(filePath)
        previewProvider?.clear(filePath)
        log(`Preview closed for ${filePath}`)
      }
    })
  )

  // Analyse the current editor
  const activeEditor = vscode.window.activeTextEditor
  if (activeEditor && isTypescriptFile(activeEditor.document)) {
    await analyseAndDecorate(activeEditor)
  }

  // Clean up on deactivation
  context.subscriptions.push({
    dispose: async () => {
      // Release all loaded projects
      for (const [, handle] of projectCache) {
        try {
          await client?.release(handle)
        } catch {
          // Ignore errors during cleanup
        }
      }
      projectCache.clear()
      await client?.stop()
    },
  })

  log('Typical extension activated')
}

function isTypescriptFile(document: vscode.TextDocument): boolean {
  // Exclude preview documents to avoid infinite loops
  if (document.uri.scheme === PREVIEW_SCHEME) {
    return false
  }
  return (
    document.languageId === 'typescript' ||
    document.languageId === 'typescriptreact'
  )
}

function analyseAndDecorateDebounced(editor: vscode.TextEditor): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    analyseAndDecorate(editor)
  }, DEBOUNCE_MS)
}

function updatePreviewDebounced(filePath: string, content: string): void {
  if (previewDebounceTimer) {
    clearTimeout(previewDebounceTimer)
  }
  previewDebounceTimer = setTimeout(() => {
    updatePreview(filePath, content)
  }, DEBOUNCE_MS)
}

async function openPreview(filePath: string, content: string): Promise<void> {
  if (!client || !client.isRunning() || !previewProvider) {
    return
  }

  // Track this file as having an open preview
  activePreviewFiles.add(filePath)

  // Transform and update preview
  await updatePreview(filePath, content)

  // Open the virtual document
  const previewUri = vscode.Uri.parse(`${PREVIEW_SCHEME}:${filePath}`)
  const doc = await vscode.workspace.openTextDocument(previewUri)
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: true,
    preview: false,
  })
}

async function updatePreview(filePath: string, content: string): Promise<void> {
  if (!client || !client.isRunning() || !previewProvider) {
    return
  }

  // Only update if this file has an active preview
  if (!activePreviewFiles.has(filePath)) {
    return
  }

  const projectHandle = await getProjectForFile(filePath)
  if (!projectHandle) {
    previewProvider.setError(filePath, 'No TypeScript project found')
    return
  }

  try {
    log(`Transforming ${filePath} for preview...`)
    const result = await client.transformFile(projectHandle, filePath, content)
    previewProvider.update(filePath, result.code)
    log(`Preview updated for ${filePath}`)
  } catch (err) {
    log(`Transform failed for ${filePath}: ${err}`)
    previewProvider.setError(filePath, String(err))
  }
}

async function analyseAndDecorate(editor: vscode.TextEditor): Promise<void> {
  if (!client || !client.isRunning() || !decorationManager) {
    return
  }

  const config = getConfig()
  if (!config.enabled) {
    decorationManager.clearDecorations(editor)
    return
  }

  const filePath = editor.document.uri.fsPath

  // Get the project for this file
  const projectHandle = await getProjectForFile(filePath)
  if (!projectHandle) {
    log(`No project available for ${filePath}`)
    return
  }

  try {
    log(`Analysing ${filePath}...`)
    // Pass document content for live updates while typing
    const content = editor.document.getText()
    const result = await client.analyseFile(projectHandle, filePath, content)
    log(`Analysis complete: ${result.items.length} items`)

    decorationManager.updateDecorations(editor, result.items)
  } catch (err) {
    log(`Analysis failed for ${filePath}: ${err}`)
    // Don't show error to user for every file, just log it
  }
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
