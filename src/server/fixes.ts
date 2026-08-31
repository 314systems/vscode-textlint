import type { TextlintMessageFixCommand } from '@textlint/types';
import type { Diagnostic } from 'vscode-languageserver';

export interface AutoFix {
	readonly ruleId: string;
	readonly fix: TextlintMessageFixCommand;
	readonly diagnostic: Diagnostic;
}

export function separatedFixes(
	fixes: readonly AutoFix[],
	filter: (fix: AutoFix) => boolean = () => true,
): AutoFix[] {
	const candidates = fixes
		.filter(filter)
		.toSorted(
			(left, right) =>
				right.fix.range[1] - left.fix.range[1] || right.fix.range[0] - left.fix.range[0],
		);
	const result: AutoFix[] = [];
	for (const fix of candidates) {
		const last = result.at(-1);
		if (last && fix.fix.range[1] > last.fix.range[0]) {
			continue;
		}
		result.push(fix);
	}
	return result.toReversed();
}
