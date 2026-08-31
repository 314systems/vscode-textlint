import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { CodeAction, CodeActionParams } from 'vscode-languageserver/node';

import { createCodeActions, requestedCodeActionKinds } from './code-actions.ts';
import type { LintResult } from './validation.ts';

export interface CodeActionHandlerDependencies {
	readonly document: (uri: string) => TextDocument | undefined;
	readonly current: (uri: string) => LintResult | undefined;
	readonly validate: (document: TextDocument) => Promise<LintResult | undefined>;
	readonly trace: (message: string, data?: unknown) => void;
	readonly sendError: (error: unknown) => void;
}

export function createCodeActionHandler(dependencies: CodeActionHandlerDependencies) {
	return {
		handle: async (params: CodeActionParams): Promise<CodeAction[]> => {
			dependencies.trace('onCodeAction', params);

			const kinds = requestedCodeActionKinds(params.context.only);
			if (kinds.size === 0) return [];

			const { uri } = params.textDocument;

			const document = dependencies.document(uri);
			if (!document) return [];
			const initial = dependencies.current(uri);

			if (initial?.version !== document.version) {
				try {
					await dependencies.validate(document);
				} catch (error) {
					dependencies.sendError(error);
					return [];
				}
			}

			const current = dependencies.current(uri);
			if (dependencies.document(uri) !== document || current?.version !== document.version) {
				return [];
			}
			if (current.fixes.length === 0) return [];

			return createCodeActions(document, current.fixes, params.range, kinds);
		},
	};
}
