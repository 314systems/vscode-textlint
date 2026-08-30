import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { CodeActionKind } from 'vscode-languageserver/node';

import {
	createCodeActions,
	requestedCodeActionKinds,
	sourceFixAllTextlint,
} from './code-actions.ts';
import { replaceFixRepository } from './fixes.ts';
import { diagnostic, textlintMessage } from './test-fixtures.ts';

const kinds = (only?: readonly string[]) => [...requestedCodeActionKinds(only)];

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
	const document = TextDocument.create('file:///test.txt', 'plaintext', 3, 'yuo yuo');
	const messages = [
		textlintMessage('spell', [0, 3], 'you'),
		textlintMessage('spell', [4, 7], 'you'),
	];
	const entries = messages.map((message) => [message, diagnostic(message)] as const);
	const repository = replaceFixRepository(3, entries);

	const quickFixes = createCodeActions(
		document,
		repository,
		[entries[0][1]],
		requestedCodeActionKinds([CodeActionKind.QuickFix]),
	);
	assert.deepStrictEqual(
		quickFixes.map((action) => action.title),
		['Fix this spell problem', 'Fix all spell problems'],
	);
});

void test('code action core creates source fix all', () => {
	const document = TextDocument.create('file:///test.txt', 'plaintext', 3, 'yuo yuo');
	const messages = [
		textlintMessage('spell', [0, 3], 'you'),
		textlintMessage('spell', [4, 7], 'you'),
	];
	const entries = messages.map((message) => [message, diagnostic(message)] as const);
	const repository = replaceFixRepository(3, entries);
	const fixAll = createCodeActions(
		document,
		repository,
		[],
		requestedCodeActionKinds([sourceFixAllTextlint]),
	);
	assert.strictEqual(fixAll.length, 1);
	assert.strictEqual(fixAll[0].kind, sourceFixAllTextlint);
	assert.strictEqual(fixAll[0].edit?.documentChanges?.length, 1);
});
