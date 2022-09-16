import { writeFile as fsWriteFile } from 'fs';
import { isFileEqualBuffer } from 'is-file-equal-buffer';
import path from 'path';
import { compileString } from 'sass';
import DtsCreator from 'typed-css-modules';
import * as vscode from 'vscode';

let dtsCreator: DtsCreator = new DtsCreator({ namedExports: true });

// Compile sass code to css
function renderScss(code: string): string {
	const workspacePath = vscode.workspace.workspaceFolders?.at(0)!.uri.fsPath as string;

	const includePaths = vscode.workspace
		.getConfiguration('cssModuleTyped.setting')
		.get('includePaths') as string[];

	const paths = ['.', ...includePaths].map((it) => path.join(workspacePath, it));

	return compileString(code, { loadPaths: paths }).css;
}

// Create .d.ts file
async function renderTypedFile(css: string): Promise<Buffer> {
	const { formatted } = await dtsCreator.create('', css);

	return Buffer.from(formatted, 'utf-8');
}

async function writeFile(path: string, buffer: Buffer): Promise<void> {
	const isEqual = await isFileEqualBuffer(path, buffer);

	return !isEqual
		? new Promise((resolve, reject) => {
				fsWriteFile(path, buffer, { flag: 'w' }, (err) => {
					err ? reject(err) : resolve();
				});
		  })
		: undefined;
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
