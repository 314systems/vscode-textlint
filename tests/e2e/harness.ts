import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

const DIAGNOSTICS_TIMEOUT = 10_000;

const pendingCleanups: (() => Promise<void>)[] = [];

// Registered on the root suite when this module is first imported, so that a single hook
// drains whatever the running test queued up. Mocha does not let a test add its own hooks.
teardown(async () => {
	for (const cleanup of pendingCleanups.splice(0)) {
		await cleanup();
	}
});

export function registerCleanup(cleanup: () => Promise<void>): void {
	pendingCleanups.push(cleanup);
}

export async function waitForEditorStabilization(timeMilliseconds = 1_000): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, timeMilliseconds);
	});
}

export async function waitForCondition(
	condition: () => boolean,
	maximumAttempts = 10,
	intervalMilliseconds = 1_000,
): Promise<boolean> {
	if (maximumAttempts <= 0) {
		return false;
	}
	if (condition()) {
		return true;
	}
	await waitForEditorStabilization(intervalMilliseconds);
	return waitForCondition(condition, maximumAttempts - 1, intervalMilliseconds);
}

export async function setupExtension(): Promise<vscode.Extension<unknown>> {
	const loadedExtension = vscode.extensions.getExtension('3w36zj6.textlint');
	if (!loadedExtension) {
		throw new Error('Extension not found');
	}
	if (!loadedExtension.isActive) {
		await loadedExtension.activate();
	}
	return loadedExtension;
}

export function getWorkspaceRoot(): string {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) {
		throw new Error('Workspace folder not found');
	}
	return folders[0].uri.fsPath;
}

export function waitForDiagnostics(
	uri: vscode.Uri,
	accept: (diagnostics: readonly vscode.Diagnostic[]) => boolean = (diagnostics) =>
		diagnostics.length > 0,
): Promise<vscode.Diagnostic[]> {
	return new Promise((resolve, reject) => {
		const finishIfAccepted = (): void => {
			const diagnostics = vscode.languages.getDiagnostics(uri);
			if (!accept(diagnostics)) return;
			clearTimeout(timeout);
			disposable.dispose();
			resolve(diagnostics);
		};
		const disposable = vscode.languages.onDidChangeDiagnostics((event) => {
			if (event.uris.some((changed) => changed.toString() === uri.toString())) {
				finishIfAccepted();
			}
		});
		const timeout = setTimeout(() => {
			disposable.dispose();
			reject(new Error(`Diagnostics did not change for ${uri.toString()}`));
		}, DIAGNOSTICS_TIMEOUT);
		finishIfAccepted();
	});
}

export async function setupServerFixture(
	testFileName = 'testtest2.txt',
): Promise<{ testFile: string }> {
	await setupExtension();
	const rootPath = getWorkspaceRoot();
	const sourceFile = path.join(rootPath, 'testtest.txt');
	const testFile = path.join(rootPath, testFileName);

	registerCleanup(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await fs.rm(testFile, { force: true });
	});
	await fs.cp(sourceFile, testFile);
	return { testFile };
}
