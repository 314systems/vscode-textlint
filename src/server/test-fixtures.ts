// Shared builders for colocated server unit tests.
import type { TextlintMessage } from '@textlint/types';

export function textlintMessage(
	ruleId: string,
	range: readonly [number, number],
	text = ruleId,
	message = ruleId,
): TextlintMessage {
	const legacyPosition = {
		line: 1,
		column: range[0] + 1,
		index: range[0],
	};
	return {
		...legacyPosition,
		type: 'lint',
		ruleId,
		message,
		range,
		loc: {
			start: { line: 1, column: range[0] + 1 },
			end: { line: 1, column: range[1] + 1 },
		},
		severity: 2,
		fix: { range, text },
	};
}

export function unfixableMessage(
	ruleId: string,
	range: readonly [number, number],
): TextlintMessage {
	return { ...textlintMessage(ruleId, range), fix: undefined };
}
