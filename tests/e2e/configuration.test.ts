import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';

import * as vscode from 'vscode';

import { checkedTest, setupServerFixture, waitForDiagnostics } from './harness.ts';

async function updateTargetPath(
	configuration: vscode.WorkspaceConfiguration,
	fileUri: vscode.Uri,
	targetPath: string,
	shouldLint: boolean,
): Promise<void> {
	const diagnostics = waitForDiagnostics(fileUri, (current) => current.length > 0 === shouldLint);
	await configuration.update('targetPath', targetPath, vscode.ConfigurationTarget.Workspace);
	await diagnostics;
}

checkedTest('Extension tests > Server integration > Target path matching', async (context) => {
	const { testFile } = await setupServerFixture(context, 'README.md');
	const fileUri = vscode.Uri.file(testFile);
	const configuration = vscode.workspace.getConfiguration('textlint');
	const originalTargetPath = configuration.inspect<string>('targetPath')?.workspaceValue;
	context.after(async () => {
		await configuration.update(
			'targetPath',
			originalTargetPath,
			vscode.ConfigurationTarget.Workspace,
		);
	});
	const initialDiagnostics = waitForDiagnostics(fileUri);
	await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(testFile));
	await initialDiagnostics;
	for (const target of [
		{ targetPath: '*.txt', shouldLint: false },
		{ targetPath: 'README.md', shouldLint: true },
	]) {
		await updateTargetPath(configuration, fileUri, target.targetPath, target.shouldLint);
	}
});

checkedTest('Extension tests > Server integration > Lint on type before save', async (context) => {
	const { testFile } = await setupServerFixture(context, 'testtest-on-type.txt');
	const fileUri = vscode.Uri.file(testFile);
	const configuration = vscode.workspace.getConfiguration('textlint');
	const originalRun = configuration.inspect<string>('run')?.workspaceValue;
	context.after(async () => {
		await configuration.update('run', originalRun, vscode.ConfigurationTarget.Workspace);
	});
	await fs.writeFile(testFile, 'A clean sentence.\n', 'utf8');
	await configuration.update('run', 'onType', vscode.ConfigurationTarget.Workspace);
	const document = await vscode.workspace.openTextDocument(testFile);
	await vscode.window.showTextDocument(document);
	const linted = waitForDiagnostics(fileUri);
	const edit = new vscode.WorkspaceEdit();
	edit.insert(fileUri, new vscode.Position(0, 0), 'yuo ');
	await vscode.workspace.applyEdit(edit);
	assert.ok((await linted).length > 0, 'onType should diagnose an unsaved edit');
	assert.strictEqual(document.isDirty, true);
});
