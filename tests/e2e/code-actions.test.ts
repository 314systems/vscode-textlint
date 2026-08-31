import assert from 'node:assert/strict';

import * as vscode from 'vscode';

import {
	registerCleanup,
	setupServerFixture,
	waitForCondition,
	waitForDiagnostics,
} from './harness.ts';

type ComparablePosition = { line: number; character: number };
type ComparableEdit = {
	range: { start: ComparablePosition; end: ComparablePosition };
	newText: string;
};
type CodeActionQuery = (kind?: string) => PromiseLike<vscode.CodeAction[]>;

const expectedEdits = [
	{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'you' },
	{ range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } }, newText: 'you' },
	{ range: { start: { line: 4, character: 1 }, end: { line: 4, character: 4 } }, newText: 'you' },
];

function editsOf(action: vscode.CodeAction, fileUri: vscode.Uri): ComparableEdit[] {
	return (action.edit?.get(fileUri) ?? []).map(({ range, newText }) => ({
		range: {
			start: { line: range.start.line, character: range.start.character },
			end: { line: range.end.line, character: range.end.character },
		},
		newText,
	}));
}

async function verifySourceFixAll(
	query: CodeActionQuery,
	fileUri: vscode.Uri,
): Promise<vscode.CodeAction> {
	const sourceFixAll = (await query('source.fixAll.textlint')).find(
		(action) => action.kind?.value === 'source.fixAll.textlint',
	);
	assert.ok(sourceFixAll?.edit);
	assert.strictEqual(sourceFixAll.command, undefined);
	assert.deepStrictEqual(editsOf(sourceFixAll, fileUri), expectedEdits);
	return sourceFixAll;
}

async function verifyQuickFixes(fileUri: vscode.Uri, query: CodeActionQuery): Promise<void> {
	const fixes = await query('quickfix');
	const single = fixes.find((action) => action.title === 'Fix this common-misspellings problem');
	assert.ok(single?.edit);
	assert.deepStrictEqual(editsOf(single, fileUri), expectedEdits.slice(0, 1));
	assert.strictEqual(single.command, undefined);
}

suite('Extension tests', () => {
	suite('Server integration', () => {
		test('Autofix', async () => {
			const { testFile } = await setupServerFixture('testtest-autofix.txt');
			const fileUri = vscode.Uri.file(testFile);
			const linted = waitForDiagnostics(fileUri);
			const document = await vscode.workspace.openTextDocument(testFile);
			await vscode.window.showTextDocument(document);
			const edit = new vscode.WorkspaceEdit();
			edit.insert(fileUri, document.positionAt(document.getText().length), ' ');
			await vscode.workspace.applyEdit(edit);
			await linted;
			const documentRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(document.getText().length),
			);
			const query: CodeActionQuery = (kind) =>
				vscode.commands.executeCommand(
					'vscode.executeCodeActionProvider',
					fileUri,
					documentRange,
					kind,
				);
			const sourceFixAll = await verifySourceFixAll(query, fileUri);
			await verifyQuickFixes(fileUri, query);
			assert.ok(await vscode.workspace.applyEdit(sourceFixAll.edit!));
			assert.ok(!document.getText().includes('yuo'));
		});

		test('Code Actions on Save', async () => {
			const { testFile } = await setupServerFixture('testtest-fix-on-save.txt');
			const fileUri = vscode.Uri.file(testFile);
			const linted = waitForDiagnostics(fileUri);
			const configuration = vscode.workspace.getConfiguration('editor');
			const original =
				configuration.inspect<Record<string, string | boolean>>(
					'codeActionsOnSave',
				)?.workspaceValue;
			registerCleanup(async () => {
				await configuration.update(
					'codeActionsOnSave',
					original,
					vscode.ConfigurationTarget.Workspace,
				);
			});
			await configuration.update(
				'codeActionsOnSave',
				{ ...original, 'source.fixAll.textlint': 'explicit' },
				vscode.ConfigurationTarget.Workspace,
			);
			const document = await vscode.workspace.openTextDocument(testFile);
			await vscode.window.showTextDocument(document);
			await linted;
			const edit = new vscode.WorkspaceEdit();
			edit.insert(fileUri, document.positionAt(document.getText().length), ' ');
			await vscode.workspace.applyEdit(edit);
			await document.save();
			assert.ok(await waitForCondition(() => !document.getText().includes('yuo')));
		});
	});
});
