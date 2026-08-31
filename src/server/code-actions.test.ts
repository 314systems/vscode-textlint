import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { CodeActionKind, Range, TextDocumentEdit } from 'vscode-languageserver/node';
import type { CodeAction } from 'vscode-languageserver/node';

import {
	createCodeActions,
	requestedCodeActionKinds,
	sourceFixAllTextlint,
} from './code-actions.ts';
import { convertMessages } from './diagnostics.ts';
import { textlintMessage } from './test-fixtures.ts';

const kinds = (only?: readonly string[]) => [...requestedCodeActionKinds(only)];

function editCountOf(action: CodeAction): number | undefined {
	const change = action.edit?.documentChanges?.[0];
	return change && TextDocumentEdit.is(change) ? change.edits.length : undefined;
}

// Both problems produce a zero-width diagnostic, the first at character 0 and
// the second at character 4.
function fixture() {
	const document = TextDocument.create('file:///test.txt', 'plaintext', 3, 'yuo yuo');
	const { fixes } = convertMessages([
		textlintMessage('spell', [0, 3], 'you'),
		textlintMessage('spell', [4, 7], 'you'),
	]);
	return { document, documentFixes: fixes };
}

void test('code action core interprets LSP only filters', () => {
	assert.deepStrictEqual(kinds(), [CodeActionKind.QuickFix]);
	assert.deepStrictEqual(kinds([CodeActionKind.QuickFix]), [CodeActionKind.QuickFix]);
	assert.deepStrictEqual(kinds([CodeActionKind.Source]), [sourceFixAllTextlint]);
	assert.deepStrictEqual(kinds([CodeActionKind.SourceFixAll]), [sourceFixAllTextlint]);
	assert.deepStrictEqual(kinds([sourceFixAllTextlint]), [sourceFixAllTextlint]);
	assert.deepStrictEqual(kinds([CodeActionKind.Empty]), [
		CodeActionKind.QuickFix,
		sourceFixAllTextlint,
	]);
	assert.deepStrictEqual(kinds(['refactor']), []);
	assert.deepStrictEqual(kinds([]), []);
});

void test('code action core creates quick fixes and same-rule fixes', () => {
	const { document, documentFixes } = fixture();

	const quickFixes = createCodeActions(
		document,
		documentFixes,
		Range.create(0, 0, 0, 3),
		requestedCodeActionKinds([CodeActionKind.QuickFix]),
	);

	assert.deepStrictEqual(
		quickFixes.map((action) => action.title),
		['Fix this spell problem', 'Fix all spell problems'],
	);
	// The range covers one problem, the same-rule action covers the document.
	assert.strictEqual(editCountOf(quickFixes[0]), 1);
	assert.strictEqual(editCountOf(quickFixes[1]), 2);
});

void test('code action core offers no quick fix for a range without problems', () => {
	const { document, documentFixes } = fixture();

	const quickFixes = createCodeActions(
		document,
		documentFixes,
		Range.create(0, 1, 0, 3),
		requestedCodeActionKinds([CodeActionKind.QuickFix]),
	);

	assert.deepStrictEqual(quickFixes, []);
});

void test('code action core creates source fix all', () => {
	const { document, documentFixes } = fixture();

	const fixAll = createCodeActions(
		document,
		documentFixes,
		Range.create(0, 0, 0, 7),
		requestedCodeActionKinds([sourceFixAllTextlint]),
	);

	assert.strictEqual(fixAll.length, 1);
	assert.strictEqual(fixAll[0].kind, sourceFixAllTextlint);
	assert.strictEqual(fixAll[0].edit?.documentChanges?.length, 1);
});
