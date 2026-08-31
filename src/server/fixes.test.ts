import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { convertMessages } from './diagnostics.ts';
import { separatedFixes } from './fixes.ts';
import { textlintMessage } from './test-fixtures.ts';

void describe('fix core', () => {
	void test('keeps non-overlapping and same-position boundary insertions', () => {
		const { fixes } = convertMessages([
			textlintMessage('short', [0, 5]),
			textlintMessage('long', [0, 10]),
			textlintMessage('start', [0, 0]),
			textlintMessage('duplicate-start', [0, 0]),
			textlintMessage('first-end', [10, 10]),
			textlintMessage('second-end', [10, 10]),
		]);

		assert.deepStrictEqual(
			separatedFixes(fixes).map((fix) => fix.ruleId),
			['duplicate-start', 'start', 'long', 'second-end', 'first-end'],
		);
	});
});
