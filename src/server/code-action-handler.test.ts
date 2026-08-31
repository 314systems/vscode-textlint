import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Range } from 'vscode-languageserver/node';

import { createCodeActionHandler } from './code-action-handler.ts';
import { sourceFixAllTextlint } from './code-actions.ts';
import { convertMessages } from './diagnostics.ts';
import { textlintMessage } from './test-fixtures.ts';
import type { LintResult } from './validation.ts';

const uri = 'file:///test.txt';
const fixAllRequest = {
	textDocument: { uri },
	range: Range.create(0, 0, 0, 3),
	context: { diagnostics: [], only: [sourceFixAllTextlint] },
};

function resultFor(version: number): LintResult {
	return { version, ...convertMessages([textlintMessage('spell', [0, 3], 'you')]) };
}

void test('code action handler rejects validation from a replaced document lifecycle', async () => {
	let document = TextDocument.create(uri, 'plaintext', 1, 'yuo');
	let current: LintResult = { version: -1, diagnostics: [], fixes: [] };
	const handler = createCodeActionHandler({
		document: () => document,
		current: () => current,
		validate: () => {
			// A fresh instance is what TextDocuments hands out after a close and reopen.
			document = TextDocument.create(uri, 'plaintext', 1, 'yuo');
			current = resultFor(1);
			return Promise.resolve(current);
		},
		trace: () => {},
		sendError: () => {},
	});

	const actions = await handler.handle(fixAllRequest);

	assert.deepStrictEqual(actions, []);
});

void test('code action handler serves fixes for an unchanged document', async () => {
	const document = TextDocument.create(uri, 'plaintext', 1, 'yuo');
	const current = resultFor(1);
	let validations = 0;
	const handler = createCodeActionHandler({
		document: () => document,
		current: () => current,
		validate: () => {
			validations += 1;
			return Promise.resolve(current);
		},
		trace: () => {},
		sendError: () => {},
	});

	const actions = await handler.handle(fixAllRequest);

	assert.deepStrictEqual(
		actions.map((action) => action.title),
		['Fix all auto-fixable textlint problems'],
	);
	assert.strictEqual(validations, 0);
});
