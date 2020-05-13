// eslint-disable-next-line node/no-unpublished-import
import eslint from 'eslint'
import * as fs from 'fs'
import { isFileEqualBuffer } from 'is-file-equal-buffer'
import less from 'less'
import * as sass from 'sass'
import * as path from 'path'
import DtsCreator from 'typed-css-modules'
import * as vscode from 'vscode'
import { getWorkspacePath } from './utils'

let eslintEngine: eslint.CLIEngine | null = null
let dtsCreator: DtsCreator = new DtsCreator()

async function renderLess(code: string): Promise<string> {
  const output = await less.render(code)

  return output.css
}

function renderScss(code: sass.Options): string {
  return sass.renderSync(code).css.toString()
}

// Search for eslint config once
let eslintSearch = false

function renderTypedFile(css: string, filePath: string): Promise<Buffer> {
  if (!eslintSearch && eslintEngine === null) {
    eslintSearch = true

    const workspace = getWorkspacePath(filePath)

    let configFile = vscode.workspace
      .getConfiguration('eslint.options')
      .get<string>('configFile')

    if (configFile !== undefined && !path.isAbsolute(configFile)) {
      configFile = path.resolve(workspace, configFile)
    }

    eslintEngine = new eslint.CLIEngine({
      cwd: workspace,
      extensions: ['.ts'],
      configFile,
      fix: true,
    })
  }

  return dtsCreator.create('', css).then(function ({ formatted }) {
    if (eslintEngine !== null) {
      const report = eslintEngine.executeOnText(formatted, filePath)

      return Buffer.from(report.results[0].output || formatted, 'utf-8')
    }

    return Buffer.from(formatted, 'utf-8')
  })
}

function writeFile(path: string, buffer: Buffer): Promise<void> {
  return isFileEqualBuffer(path, buffer).then(function isEqual(isEqual) {
    return !isEqual
      ? new Promise(function executor(resolve, reject) {
          fs.writeFile(path, buffer, { flag: 'w' }, function result(err) {
            err ? reject(err) : resolve()
          })
        })
      : undefined
  })
}

async function typedCss(
  cssCode: string,
  document: vscode.TextDocument,
  force: boolean
): Promise<void> {
  const outputPath = document.uri.fsPath + '.d.ts'

  const typedCode = await renderTypedFile(cssCode, outputPath)

  await writeFile(outputPath, typedCode)

  if (force) {
    vscode.window.showInformationMessage('Write typed to: ' + outputPath)
  }
}

function getExtFromPath(fileName: string): string {
  const pos = fileName.lastIndexOf('.')

  if (pos === -1) {
    return ''
  }

  return fileName.slice(pos + 1)
}

async function getCssContent(extname: string, source: string): Promise<string> {
  switch (extname) {
    case 'css':
      return source

    case 'less':
      return renderLess(source)

    case 'scss':
      return renderScss({ data: source })

    default:
      return ''
  }
}

const supportCss = ['css', 'less', 'scss']

const TYPE_REGEX = /[\s//*]*@type/

async function processDocument(
  document: vscode.TextDocument,
  force = false
): Promise<void> {
  try {
    const extname = getExtFromPath(document.fileName)

    if (extname === '') {
      return
    }

    if (!supportCss.includes(extname)) {
      if (force) {
        vscode.window.showInformationMessage(
          'Typed CSS Modules only support .less/.css/.scss'
        )
      }

      return
    }

    const content = document.getText()

    if (!TYPE_REGEX.test(content)) {
      if (force) {
        vscode.window.showInformationMessage(
          'Typed CSS Modules require `// @type` or `/* @type */` ahead of file'
        )
      }

      return
    }

    const cssCode = await getCssContent(extname, content)

    if (cssCode) {
      await typedCss(cssCode, document, force)
    }
  } catch (e) {
    vscode.window.showWarningMessage(e.toString())
  }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): void {
  const didSave = vscode.workspace.onDidSaveTextDocument(
    function onDidSaveTextDocument(document: vscode.TextDocument) {
      processDocument(document)
    }
  )

  const registerCommand = vscode.commands.registerCommand(
    'extension.cssModuleTyped',
    function command() {
      if (vscode.window.activeTextEditor !== undefined) {
        const document = vscode.window.activeTextEditor.document
        processDocument(document, true)
      }
    }
  )

  context.subscriptions.push(didSave, registerCommand)
}

// this method is called when your extension is deactivated
export function deactivate(): void {
  eslintSearch = false
  eslintEngine = null
  // @ts-ignore
  dtsCreator = null
}
