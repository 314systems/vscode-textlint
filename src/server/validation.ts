import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Diagnostic } from 'vscode-languageserver/node';
import { URI, Utils as URIUtils } from 'vscode-uri';

import type { ServerSettings } from '../shared/types.ts';
import { convertMessages } from './diagnostics.ts';
import type { AutoFix } from './fixes.ts';
import { isTarget, type WorkspaceLinter } from './workspace.ts';

export interface PublishedDiagnostics {
	readonly version: number;
	readonly diagnostics: readonly Diagnostic[];
	readonly fixes: readonly AutoFix[];
}

type LintResult = Omit<PublishedDiagnostics, 'version'>;

const emptyLintResult: LintResult = { diagnostics: [], fixes: [] };

export interface ValidationDependencies {
	readonly document: (uri: string) => TextDocument | undefined;
	readonly settings: () => ServerSettings;
	readonly lookupLinter: (document: TextDocument) => readonly [string, WorkspaceLinter | undefined];
	readonly trace: (message: string, data?: unknown) => void;
	readonly sendDiagnostics: (uri: string, diagnostics: readonly Diagnostic[]) => void;
	readonly withProgress: <T>(task: () => Promise<T>) => Promise<T>;
	readonly sendOk: () => void;
	readonly sendError: (error: unknown) => void;
}

interface ValidationContext {
	readonly dependencies: ValidationDependencies;
	readonly published: Map<string, PublishedDiagnostics>;
}

async function scanIgnored(
	engine: WorkspaceLinter,
	filePath: string,
	trace: ValidationDependencies['trace'],
): Promise<boolean> {
	const scanResult = await engine.linter.scanFilePath?.(filePath);
	if (scanResult?.status === 'ignored') {
		trace(`ignore ${URI.file(filePath).toString()}`);
		return true;
	}
	if (
		scanResult?.status === 'error' &&
		scanResult.errors.some((error) => error.type !== 'ScanFilePathNoExistFilePathError')
	) {
		throw new Error(scanResult.errors.map((error) => error.type).join(', '));
	}
	return false;
}

// Computes what the document's diagnostics should be, touching no state: every
// skip case is the empty result, and lint failures are left to the thrown error.
async function computeDiagnostics(
	dependencies: ValidationDependencies,
	document: TextDocument,
): Promise<LintResult> {
	const uri = URI.parse(document.uri);
	const [folder, engine] = dependencies.lookupLinter(document);
	if (!engine) {
		return emptyLintResult;
	}

	const supported =
		engine.availableExtensions.includes(URIUtils.extname(uri)) &&
		isTarget(folder, uri, dependencies.settings().targetPath);
	if (!supported || (await scanIgnored(engine, uri.fsPath, dependencies.trace))) {
		return emptyLintResult;
	}

	const result = await engine.linter.lintText(document.getText(), uri.fsPath);
	dependencies.trace('result', result);
	return convertMessages(result.messages);
}

async function validateDocument(context: ValidationContext, document: TextDocument): Promise<void> {
	const { dependencies, published } = context;
	dependencies.trace(`validate ${document.uri}`);
	if (!document.uri.startsWith('file:')) {
		dependencies.trace('validation skipped...');
		return;
	}
	if (!published.has(document.uri)) return;

	// Edits that land while linting leave the document ahead of the text this
	// result describes, so the stamp has to name the version the text is read at.
	const version = document.version;
	let result = emptyLintResult;
	let failure: { readonly error: unknown } | undefined;
	try {
		result = await computeDiagnostics(dependencies, document);
	} catch (error) {
		failure = { error };
	}

	// TextDocuments hands out one instance per open document, so a different
	// object means this one was closed and reopened while the lint was running.
	if (dependencies.document(document.uri) !== document) {
		dependencies.trace(`discard stale validation ${document.uri}`, version);
		return;
	}
	published.set(document.uri, { version, ...result });
	dependencies.trace(`sendDiagnostics ${document.uri}`);
	dependencies.sendDiagnostics(document.uri, result.diagnostics);
	if (failure) {
		throw failure.error;
	}
}

function validateAll(
	context: ValidationContext,
	documents: readonly TextDocument[],
): Promise<void> {
	return context.dependencies.withProgress(async () => {
		const failures = new Map<string, unknown>();
		await Promise.all(
			documents.map(async (document) => {
				try {
					await validateDocument(context, document);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (!failures.has(message)) {
						failures.set(message, error);
					}
				}
			}),
		);
		if (failures.size === 0) {
			context.dependencies.sendOk();
			return;
		}
		for (const error of failures.values()) {
			context.dependencies.sendError(error);
		}
	});
}

function openDocument(context: ValidationContext, document: TextDocument): void {
	context.dependencies.trace(`onDidOpen ${document.uri}`);
	if (document.uri.startsWith('file:') && !context.published.has(document.uri)) {
		context.published.set(document.uri, { version: -1, ...emptyLintResult });
		void validateAll(context, [document]);
	}
}

function closeDocument(context: ValidationContext, document: TextDocument): void {
	context.dependencies.trace(`onDidClose ${document.uri}`);
	if (document.uri.startsWith('file:')) {
		context.published.delete(document.uri);
		context.dependencies.sendDiagnostics(document.uri, []);
	}
}

function prepareRevalidation(context: ValidationContext): TextDocument[] {
	const documents: TextDocument[] = [];
	for (const uri of context.published.keys()) {
		context.dependencies.trace(`reConfigure:push ${uri}`);
		context.dependencies.sendDiagnostics(uri, []);
		const document = context.dependencies.document(uri);
		if (document) {
			documents.push(document);
		}
	}
	return documents;
}

export function createValidationService(dependencies: ValidationDependencies) {
	const context: ValidationContext = { dependencies, published: new Map() };
	return {
		open: (document: TextDocument) => {
			openDocument(context, document);
		},
		close: (document: TextDocument) => {
			closeDocument(context, document);
		},
		validate: (document: TextDocument) => validateDocument(context, document),
		validateSingle: (document: TextDocument) => validateAll(context, [document]),
		validateMany: (documents: readonly TextDocument[]) => validateAll(context, documents),
		prepareRevalidation: () => prepareRevalidation(context),
		published: (uri: string) => context.published.get(uri),
	};
}
