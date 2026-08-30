import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { CodeAction, CodeActionParams } from 'vscode-languageserver/node';

import {
	createCodeActions,
	requestedCodeActionKinds,
	sourceFixAllTextlint,
} from './code-actions.ts';
import { hasFixes } from './fixes.ts';
import type { FixRepositorySlot } from './validation.ts';

export interface CodeActionHandlerDependencies {
	readonly document: (uri: string) => TextDocument | undefined;
	readonly repository: (uri: string) => FixRepositorySlot | undefined;
	readonly validate: (document: TextDocument) => Promise<void>;
	readonly trace: (message: string, data?: unknown) => void;
	readonly sendError: (error: unknown) => void;
}

export interface CodeActionHandler {
	readonly handle: (params: CodeActionParams) => Promise<CodeAction[]>;
}

export function createCodeActionHandler(
	dependencies: CodeActionHandlerDependencies,
): CodeActionHandler {
	return {
		handle: async (params: CodeActionParams): Promise<CodeAction[]> => {
			dependencies.trace('onCodeAction', params);

			const kinds = requestedCodeActionKinds(params.context.only);
			if (kinds.size === 0) return [];

			const { uri } = params.textDocument;

			const initialSlot = dependencies.repository(uri);
			if (!initialSlot) return [];

			const document = dependencies.document(uri);
			if (!document) return [];
			const { version } = document;

			if (kinds.has(sourceFixAllTextlint) || initialSlot.repository.version !== version) {
				try {
					await dependencies.validate(document);
				} catch (error) {
					dependencies.sendError(error);
					return [];
				}
			}

			const slot = dependencies.repository(uri);
			if (slot !== initialSlot) return [];
			const { repository } = slot;

			if (
				dependencies.document(uri)?.version !== version ||
				repository.version !== version ||
				!hasFixes(repository)
			) {
				return [];
			}

			return createCodeActions(document, slot.repository, params.context.diagnostics, kinds);
		},
	};
}
