import { writeFile as fsWriteFile } from 'fs';
import { isFileEqualBuffer } from 'is-file-equal-buffer';
import * as parserTS from 'prettier/parser-typescript';
import { format } from 'prettier/standalone';
import { compileString } from 'sass';
import DtsCreator from 'typed-css-modules';
import * as vscode from 'vscode';

let dtsCreator: DtsCreator = new DtsCreator();

// Compile sass code to css
function renderScss(code: string): string {
	const path = vscode.workspace.workspaceFolders?.at(0)?.uri.fsPath;

	return compileString(code, { loadPaths: [path ?? ''] }).css;
}

// Create .d.ts file and format it using prettier
function renderTypedFile(css: string): Promise<Buffer> {
	return dtsCreator.create('', css).then(({ formatted }) => {
		const formattedWithPrettier = format(formatted, {
			parser: 'typescript',
			useTabs: true,
			singleQuote: true,
			plugins: [parserTS],
		});
		return Buffer.from(formattedWithPrettier, 'utf-8');
	});
}

function writeFile(path: string, buffer: Buffer): Promise<void> {
	return isFileEqualBuffer(path, buffer).then((isEqual) => {
		return !isEqual
			? new Promise((resolve, reject) => {
					fsWriteFile(path, buffer, { flag: 'w' }, (err) => {
						err ? reject(err) : resolve();
					});
			  })
			: undefined;
	});
}

async function typedCss(
	cssCode: string,
	document: vscode.TextDocument,
	force: boolean,
): Promise<void> {
	const outputPath = document.uri.fsPath + '.d.ts';
	const typedCode = await renderTypedFile(cssCode);

	await writeFile(outputPath, typedCode);

	if (force) {
		vscode.window.showInformationMessage('Typed file created for: ' + document.uri.fsPath);
	}
}

function getExtFromPath(fileName: string): string {
	const pos = fileName.lastIndexOf('.');

	if (pos === -1) {
		return '';
	}

	return fileName.slice(pos + 1);
}

async function getCssContent(extname: string, source: string): Promise<string> {
	switch (extname) {
		case 'css':
			return source;

		case 'scss':
			return renderScss(source);

		default:
			return '';
	}
}

const supportCss = ['css', 'scss'];

const TYPE_REGEX = /[\s//*]*@type/;

async function processDocument(document: vscode.TextDocument, force = false): Promise<void> {
	try {
		const extname = getExtFromPath(document.fileName);

		if (extname === '') {
			return;
		}

		if (!supportCss.includes(extname)) {
			if (force) {
				vscode.window.showInformationMessage('Typed CSS Modules only support .css/.scss');
			}

			return;
		}

		const content = document.getText();

		const requireComment = vscode.workspace
			.getConfiguration('cssModuleTyped.setting')
			.get('requireComment');

		if (!TYPE_REGEX.test(content) && requireComment) {
			if (force) {
				vscode.window.showInformationMessage(
					'Typed CSS Modules require `// @type` or `/* @type */` ahead of file',
				);
			}

			return;
		}

		const cssCode = await getCssContent(extname, content);

		if (cssCode) {
			await typedCss(cssCode, document, force);
		}
	} catch (e) {
		vscode.window.showWarningMessage((e as any).toString());
	}
}

// This method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext): void {
	const didSave = vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
		processDocument(document);
	});

	const registerCommand = vscode.commands.registerCommand('extension.cssModuleTyped', () => {
		if (vscode.window.activeTextEditor !== undefined) {
			const document = vscode.window.activeTextEditor.document;
			processDocument(document, true);
		}
	});

	context.subscriptions.push(didSave, registerCommand);
}

// This method is called when your extension is deactivated
export function deactivate(): void {
	// @ts-ignore
	dtsCreator = null;
}
