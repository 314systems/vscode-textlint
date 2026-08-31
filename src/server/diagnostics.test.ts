import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DiagnosticSeverity } from 'vscode-languageserver/node';

import { convertMessages, toDiagnostic, toDiagnosticSeverity } from './diagnostics.ts';
import { textlintMessage, unfixableMessage } from './test-fixtures.ts';

void describe('diagnostic core', () => {
	void test('maps every textlint severity', () => {
		assert.strictEqual(toDiagnosticSeverity(2), DiagnosticSeverity.Error);
		assert.strictEqual(toDiagnosticSeverity(1), DiagnosticSeverity.Warning);
		assert.strictEqual(toDiagnosticSeverity(0), DiagnosticSeverity.Information);
		assert.strictEqual(toDiagnosticSeverity(3), DiagnosticSeverity.Information);
	});

	void test('preserves the current message-based range behavior', () => {
		const plain = toDiagnostic(textlintMessage('plain', [2, 5]));
		const arrow = toDiagnostic(textlintMessage('arrow', [2, 5], 'arrow', 'before -> after'));
		const quoted = toDiagnostic(textlintMessage('quoted', [2, 5], 'quoted', 'replace "word"'));

		assert.deepStrictEqual(plain.range, {
			start: { line: 0, character: 2 },
			end: { line: 0, character: 2 },
		});
		assert.strictEqual(arrow.range.end.character, 8);
		assert.strictEqual(quoted.range.end.character, 6);
	});

	void test('pairs fixable messages with their own diagnostics', () => {
		const { diagnostics, fixes } = convertMessages([
			textlintMessage('rule', [1, 4], 'fixed'),
			unfixableMessage('plain', [5, 8]),
		]);

		assert.strictEqual(diagnostics.length, 2);
		assert.deepStrictEqual(
			fixes.map((fix) => fix.ruleId),
			['rule'],
		);
		assert.deepStrictEqual(fixes[0].fix, { range: [1, 4], text: 'fixed' });
		assert.strictEqual(fixes[0].diagnostic, diagnostics[0]);
	});

	void test('keeps diagnostics free of transport payload', () => {
		const { diagnostics } = convertMessages([textlintMessage('rule', [1, 4], 'fixed')]);

		assert.ok(!('data' in diagnostics[0]));
	});
});
