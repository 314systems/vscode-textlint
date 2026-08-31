import assert from 'node:assert/strict';

import * as vscode from 'vscode';

import { setupServerFixture, waitForDiagnostics } from './harness.ts';

const expectedDiagnostics = [
	{ line: 0, character: 1 },
	{ line: 2, character: 0 },
	{ line: 4, character: 1 },
];

function assertLintDiagnostics(diagnostics: readonly vscode.Diagnostic[]): void {
	assert.strictEqual(diagnostics.length, expectedDiagnostics.length);
	for (const [index, diagnostic] of diagnostics.entries()) {
		assert.strictEqual(diagnostic.code, 'common-misspellings');
		assert.strictEqual(diagnostic.message, 'This is a commonly misspelled word. Correct it to you');
		assert.strictEqual(diagnostic.source, 'textlint');
		assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Error);
		assert.deepStrictEqual(
			{
				line: diagnostic.range.start.line,
				character: diagnostic.range.start.character,
			},
			expectedDiagnostics[index],
		);
		assert.deepStrictEqual(
			{
				line: diagnostic.range.end.line,
				character: diagnostic.range.end.character,
			},
			expectedDiagnostics[index],
		);
	}
}

suite('Extension tests', () => {
	suite('Server integration', () => {
		test('Linting', async () => {
			const { testFile } = await setupServerFixture();
			const fileUri = vscode.Uri.file(testFile);
			const initialDiagnostics = waitForDiagnostics(fileUri);
			const document = await vscode.workspace.openTextDocument(testFile);
			await vscode.window.showTextDocument(document);
			await initialDiagnostics;
			const updatedDiagnostics = waitForDiagnostics(fileUri, (diagnostics) =>
				diagnostics.some(
					(diagnostic) =>
						diagnostic.range.start.line === 0 && diagnostic.range.start.character === 1,
				),
			);
			const edit = new vscode.WorkspaceEdit();
			edit.insert(fileUri, new vscode.Position(0, 0), ' ');
			await vscode.workspace.applyEdit(edit);
			await document.save();
			assertLintDiagnostics(await updatedDiagnostics);
		});

		test('Clear diagnostics on close', async () => {
			const { testFile } = await setupServerFixture('testtest-close.txt');
			const fileUri = vscode.Uri.file(testFile);
			const linted = waitForDiagnostics(fileUri);
			await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(testFile));
			await linted;
			const cleared = waitForDiagnostics(fileUri, (diagnostics) => diagnostics.length === 0);
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			await cleared;
		});
	});
});
