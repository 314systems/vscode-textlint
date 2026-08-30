import type { TextDocument } from 'vscode-languageserver-textdocument';
import { CodeActionKind, Range, TextDocumentEdit, TextEdit } from 'vscode-languageserver/node';
import type { CodeAction, Diagnostic } from 'vscode-languageserver/node';

import { findMatchingFixes, separatedFixes, type AutoFix, type FixRepository } from './fixes.ts';

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

function toTextEdit(textDocument: TextDocument, autoFix: AutoFix): TextEdit {
	return TextEdit.replace(
		Range.create(
			textDocument.positionAt(autoFix.fix.range[0]),
			textDocument.positionAt(autoFix.fix.range[1]),
		),
		autoFix.fix.text,
	);
}

function toWorkspaceEdit(textDocument: TextDocument, repository: FixRepository, fixes: AutoFix[]) {
	return {
		documentChanges: [
			TextDocumentEdit.create(
				{ uri: textDocument.uri, version: repository.version },
				fixes.map((fix) => toTextEdit(textDocument, fix)),
			),
		],
	};
}

function sameRuleFixAction(
	textDocument: TextDocument,
	repository: FixRepository,
	ruleId: string,
): CodeAction[] {
	const fixes = separatedFixes(repository, (fix) => fix.ruleId === ruleId);
	if (fixes.length <= 1) {
		return [];
	}
	return [
		{
			title: `Fix all ${ruleId} problems`,
			kind: CodeActionKind.QuickFix,
			diagnostics: fixes.map((fix) => fix.diagnostic),
			edit: toWorkspaceEdit(textDocument, repository, fixes),
		},
	];
}

export function createCodeActions(
	textDocument: TextDocument,
	repository: FixRepository,
	diagnostics: readonly Diagnostic[],
	kinds: ReadonlySet<string>,
): CodeAction[] {
	const requestedFixes = kinds.has(CodeActionKind.QuickFix)
		? findMatchingFixes(repository, diagnostics)
		: [];
	const quickFixes: CodeAction[] = requestedFixes.map((fix) => ({
		title: `Fix this ${fix.ruleId} problem`,
		kind: CodeActionKind.QuickFix,
		diagnostics: [fix.diagnostic],
		edit: toWorkspaceEdit(textDocument, repository, [fix]),
	}));
	const sameRuleFixes: CodeAction[] = [...new Set(requestedFixes.map((fix) => fix.ruleId))].flatMap(
		(ruleId) => sameRuleFixAction(textDocument, repository, ruleId),
	);
	const sourceFixes: CodeAction[] = kinds.has(sourceFixAllTextlint)
		? [
				{
					title: 'Fix all auto-fixable textlint problems',
					kind: sourceFixAllTextlint,
					edit: toWorkspaceEdit(textDocument, repository, separatedFixes(repository)),
				},
			]
		: [];
	return [...quickFixes, ...sameRuleFixes, ...sourceFixes];
}
