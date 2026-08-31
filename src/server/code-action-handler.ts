import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { CodeAction, CodeActionParams } from 'vscode-languageserver/node';

import {
	createCodeActions,
	requestedCodeActionKinds,
	sourceFixAllTextlint,
} from './code-actions.ts';
import type { PublishedDiagnostics } from './validation.ts';

export interface CodeActionHandlerDependencies {
	readonly document: (uri: string) => TextDocument | undefined;
	readonly published: (uri: string) => PublishedDiagnostics | undefined;
	readonly validate: (document: TextDocument) => Promise<void>;
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
			const initial = dependencies.published(uri);
			if (!document || !initial) return [];

			if (kinds.has(sourceFixAllTextlint) || initial.version !== document.version) {
				try {
					await dependencies.validate(document);
				} catch (error) {
					dependencies.sendError(error);
					return [];
				}
			}

			const published = dependencies.published(uri);
			if (dependencies.document(uri) !== document || published?.version !== document.version) {
				return [];
			}
			if (published.fixes.length === 0) return [];

			return createCodeActions(document, published.fixes, params.range, kinds);
		},
	};
}
