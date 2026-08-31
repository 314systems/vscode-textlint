import type { TextDocument } from 'vscode-languageserver-textdocument';
import { CodeActionKind, Range, TextDocumentEdit, TextEdit } from 'vscode-languageserver/node';
import type { CodeAction, Position } from 'vscode-languageserver/node';

import { separatedFixes, type AutoFix } from './fixes.ts';

export const sourceFixAllTextlint = `${CodeActionKind.SourceFixAll}.textlint`;

export const textlintCodeActionKinds = [CodeActionKind.QuickFix, sourceFixAllTextlint] as const;

function matchesRequestedKind(kind: string, requested: string): boolean {
	return (
		requested === CodeActionKind.Empty || kind === requested || kind.startsWith(`${requested}.`)
	);
}

export function requestedCodeActionKinds(only?: readonly string[]): ReadonlySet<string> {
	// Without an explicit filter the client only wants the lightbulb, not source actions.
	const requested = only ?? [CodeActionKind.QuickFix];
	return new Set(
		textlintCodeActionKinds.filter((kind) =>
			requested.some((entry) => matchesRequestedKind(kind, entry)),
		),
	);
}

function comparePosition(left: Position, right: Position): number {
	return left.line - right.line || left.character - right.character;
}

function overlaps(range: Range, other: Range): boolean {
	// Touching counts as overlapping, so a caret resting on the edge of a
	// zero-width diagnostic still offers its fix.
	return (
		comparePosition(range.start, other.end) <= 0 && comparePosition(other.start, range.end) <= 0
	);
}

function toTextEdit(textDocument: TextDocument, autoFix: AutoFix): TextEdit {
	return TextEdit.replace(
		Range.create(
			textDocument.positionAt(autoFix.fix.range[0]),
			textDocument.positionAt(autoFix.fix.range[1]),
		),
		autoFix.fix.text,
	);
}

function toWorkspaceEdit(textDocument: TextDocument, fixes: AutoFix[]) {
	return {
		documentChanges: [
			TextDocumentEdit.create(
				{ uri: textDocument.uri, version: textDocument.version },
				fixes.map((fix) => toTextEdit(textDocument, fix)),
			),
		],
	};
}

function sameRuleFixAction(
	textDocument: TextDocument,
	documentFixes: readonly AutoFix[],
	ruleId: string,
): CodeAction[] {
	const fixes = separatedFixes(documentFixes, (fix) => fix.ruleId === ruleId);
	if (fixes.length <= 1) {
		return [];
	}
	return [
		{
			title: `Fix all ${ruleId} problems`,
			kind: CodeActionKind.QuickFix,
			diagnostics: fixes.map((fix) => fix.diagnostic),
			edit: toWorkspaceEdit(textDocument, fixes),
		},
	];
}

export function createCodeActions(
	textDocument: TextDocument,
	documentFixes: readonly AutoFix[],
	range: Range,
	kinds: ReadonlySet<string>,
): CodeAction[] {
	// Selecting by range rather than by the diagnostics the client sent keeps every
	// edit anchored to the text the server just linted; a client may hand back a
	// copy it computed against older text, whose fix offsets no longer apply.
	const requestedFixes = kinds.has(CodeActionKind.QuickFix)
		? documentFixes.filter((fix) => overlaps(fix.diagnostic.range, range))
		: [];
	const quickFixes: CodeAction[] = requestedFixes.map((fix) => ({
		title: `Fix this ${fix.ruleId} problem`,
		kind: CodeActionKind.QuickFix,
		diagnostics: [fix.diagnostic],
		edit: toWorkspaceEdit(textDocument, [fix]),
	}));
	const sameRuleFixes: CodeAction[] = [...new Set(requestedFixes.map((fix) => fix.ruleId))].flatMap(
		(ruleId) => sameRuleFixAction(textDocument, documentFixes, ruleId),
	);
	const sourceFixes: CodeAction[] = kinds.has(sourceFixAllTextlint)
		? [
				{
					title: 'Fix all auto-fixable textlint problems',
					kind: sourceFixAllTextlint,
					edit: toWorkspaceEdit(textDocument, separatedFixes(documentFixes)),
				},
			]
		: [];
	return [...quickFixes, ...sameRuleFixes, ...sourceFixes];
}
