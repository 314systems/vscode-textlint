import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { CancellationTokenSource } from 'vscode-languageserver/node';

import { textlintMessage } from './test-fixtures.ts';
import { createValidationService } from './validation.ts';
import type { WorkspaceLinter } from './workspace.ts';

const uri = 'file:///workspace/test.txt';

function createHarness() {
	let document = TextDocument.create(uri, 'plaintext', 1, 'yuo');
	let lint: WorkspaceLinter['linter']['lintText'] = () =>
		Promise.resolve({ filePath: '/workspace/test.txt', messages: [] });
	const service = createValidationService({
		document: () => document,
		settings: () => ({
			configPath: null,
			ignorePath: null,
			nodePath: null,
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
	};
}

void test('validation stores the fixes next to the diagnostics', async () => {
	const harness = createHarness();
	harness.setLint(() =>
		Promise.resolve({
			filePath: '/workspace/test.txt',
			messages: [textlintMessage('spell', [0, 3], 'you')],
		}),
	);

	await harness.service.validate(harness.document());

	const current = harness.service.current(uri);
	assert.strictEqual(current?.version, 1);
	assert.strictEqual(current.diagnostics.length, 1);
	assert.strictEqual(current.fixes.length, 1);
	assert.strictEqual(current.fixes[0].diagnostic, current.diagnostics[0]);
});

void test('validation stamps a failed lint with the version the text was read at', async () => {
	const harness = createHarness();
	harness.setLint(() => {
		// The edit lands while the lint is in flight; the failure must not be
		// stamped with the newer version it never saw.
		TextDocument.update(harness.document(), [{ text: 'yuo!' }], 2);
		return Promise.reject(new Error('lint failed'));
	});

	await assert.rejects(harness.service.validate(harness.document()), /lint failed/);

	assert.strictEqual(harness.document().version, 2);
	assert.deepStrictEqual(harness.service.current(uri), {
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
	await harness.service.validate(harness.document());
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
	assert.strictEqual(harness.service.current(uri)?.diagnostics.length, 1);
});

void test('validation discards a lint invalidated by reconfiguration', async () => {
	const harness = createHarness();
	let release!: () => void;
	const gate = new Promise<{ filePath: string; messages: never[] }>((resolve) => {
		release = () => {
			resolve({ filePath: '/workspace/test.txt', messages: [] });
		};
	});
	harness.setLint(() => gate);

	const pending = harness.service.validate(harness.document());
	harness.service.invalidate();
	release();
	await pending;

	assert.strictEqual(harness.service.current(uri), undefined);
});

void test('validation skips a pull that the LSP client already cancelled', async () => {
	const harness = createHarness();
	let linted = false;
	harness.setLint(() => {
		linted = true;
		return Promise.resolve({ filePath: '/workspace/test.txt', messages: [] });
	});
	const cancellation = new CancellationTokenSource();
	cancellation.cancel();

	const result = await harness.service.validate(harness.document(), cancellation.token);

	assert.strictEqual(result, undefined);
	assert.strictEqual(linted, false);
});
