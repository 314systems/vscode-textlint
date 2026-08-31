import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { textlintMessage } from './test-fixtures.ts';
import { createValidationService } from './validation.ts';
import type { WorkspaceLinter } from './workspace.ts';

const uri = 'file:///workspace/test.txt';

function createHarness() {
	let document = TextDocument.create(uri, 'plaintext', 1, 'yuo');
	let lint: WorkspaceLinter['linter']['lintText'] = () =>
		Promise.resolve({ filePath: '/workspace/test.txt', messages: [] });
	let lastRun: Promise<unknown> = Promise.resolve();
	const service = createValidationService({
		document: () => document,
		settings: () => ({
			configPath: null,
			ignorePath: null,
			nodePath: null,
			run: 'onSave',
			targetPath: '',
		}),
		lookupLinter: () => [
			'file:///workspace',
			{
				linter: { lintText: (text, filePath) => lint(text, filePath) },
				availableExtensions: ['.txt'],
			},
		],
		trace: () => {},
		sendDiagnostics: () => {},
		withProgress: (task) => {
			const run = task();
			lastRun = run;
			return run;
		},
		sendOk: () => {},
		sendError: () => {},
	});
	return {
		service,
		document: () => document,
		setLint: (next: WorkspaceLinter['linter']['lintText']) => {
			lint = next;
		},
		replaceDocument: (next: TextDocument) => {
			document = next;
		},
		openSettled: async () => {
			service.open(document);
			await lastRun;
		},
	};
}

void test('validation stores the fixes next to the published diagnostics', async () => {
	const harness = createHarness();
	harness.setLint(() =>
		Promise.resolve({
			filePath: '/workspace/test.txt',
			messages: [textlintMessage('spell', [0, 3], 'you')],
		}),
	);

	await harness.openSettled();

	const published = harness.service.published(uri);
	assert.strictEqual(published?.version, 1);
	assert.strictEqual(published.diagnostics.length, 1);
	assert.strictEqual(published.fixes.length, 1);
	assert.strictEqual(published.fixes[0].diagnostic, published.diagnostics[0]);
});

void test('validation stamps a failed lint with the version the text was read at', async () => {
	const harness = createHarness();
	await harness.openSettled();
	harness.setLint(() => {
		// The edit lands while the lint is in flight; the failure must not be
		// stamped with the newer version it never saw.
		TextDocument.update(harness.document(), [{ text: 'yuo!' }], 2);
		return Promise.reject(new Error('lint failed'));
	});

	await assert.rejects(harness.service.validate(harness.document()), /lint failed/);

	assert.strictEqual(harness.document().version, 2);
	assert.deepStrictEqual(harness.service.published(uri), {
		version: 1,
		diagnostics: [],
		fixes: [],
	});
});

void test('validation discards a lint that finishes after the document was reopened', async () => {
	const harness = createHarness();
	harness.setLint(() =>
		Promise.resolve({
			filePath: '/workspace/test.txt',
			messages: [textlintMessage('spell', [0, 3], 'you')],
		}),
	);
	await harness.openSettled();
	const opened = harness.document();
	// The gate exists before the lint starts, so releasing it cannot race the
	// point at which the pending validation actually reaches lintText.
	let release!: () => void;
	const gate = new Promise<{ filePath: string; messages: never[] }>((resolve) => {
		release = () => {
			resolve({ filePath: '/workspace/test.txt', messages: [] });
		};
	});
	harness.setLint(() => gate);

	const pending = harness.service.validate(opened);
	harness.replaceDocument(TextDocument.create(uri, 'plaintext', 1, 'yuo'));
	release();
	await pending;

	// The reopened document keeps the result of its own lifecycle, not the
	// empty result of the lint that outlived the previous one.
	assert.strictEqual(harness.service.published(uri)?.diagnostics.length, 1);
});
