// eslint-disable-next-line node/no-unpublished-import
import * as fs from 'fs'
import { isFileEqualBuffer } from 'is-file-equal-buffer'
import less from 'less'
import * as sass from 'sass'
import DtsCreator from 'typed-css-modules'
import * as vscode from 'vscode'
import prettier from 'prettier'

let dtsCreator: DtsCreator = new DtsCreator()

async function renderLess(code: string): Promise<string> {
  const output = await less.render(code)

  return output.css
}

function renderScss(code: sass.Options): string {
  return sass.renderSync(code).css.toString()
}

function renderTypedFile(css: string): Promise<Buffer> {
  return dtsCreator.create('', css).then(function ({ formatted }) {
    const formattedWithPrettier = prettier.format(formatted, {
      parser: 'typescript',
      useTabs: true,
      singleQuote: true,
    })
    return Buffer.from(formattedWithPrettier, 'utf-8')
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

  const typedCode = await renderTypedFile(cssCode)

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
  // @ts-ignore
  dtsCreator = null
}
