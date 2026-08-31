import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { CancellationToken, Diagnostic } from 'vscode-languageserver/node';
import { URI, Utils as URIUtils } from 'vscode-uri';

import type { ServerSettings } from '../shared/types.ts';
import { convertMessages } from './diagnostics.ts';
import type { AutoFix } from './fixes.ts';
import { isTarget, type WorkspaceLinter } from './workspace.ts';

export interface LintResult {
	readonly version: number;
	readonly diagnostics: readonly Diagnostic[];
	readonly fixes: readonly AutoFix[];
}

type ComputedLintResult = Omit<LintResult, 'version'>;

const emptyLintResult: ComputedLintResult = { diagnostics: [], fixes: [] };

export interface ValidationDependencies {
	readonly document: (uri: string) => TextDocument | undefined;
	readonly settings: () => ServerSettings;
	readonly lookupLinter: (document: TextDocument) => readonly [string, WorkspaceLinter | undefined];
	readonly trace: (message: string, data?: unknown) => void;
}

interface ValidationContext {
	readonly dependencies: ValidationDependencies;
	readonly results: Map<string, LintResult>;
	generation: number;
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
	text: string,
): Promise<ComputedLintResult> {
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

	const result = await engine.linter.lintText(text, uri.fsPath);
	dependencies.trace('result', { messages: result.messages.length });
	return convertMessages(result.messages);
}

async function validateDocument(
	context: ValidationContext,
	document: TextDocument,
	token?: CancellationToken,
): Promise<LintResult | undefined> {
	const { dependencies, results } = context;
	dependencies.trace(`validate ${document.uri}`);
	if (!document.uri.startsWith('file:')) {
		dependencies.trace('validation skipped...');
		return undefined;
	}
	if (token?.isCancellationRequested) return undefined;

	// Edits that land while linting leave the document ahead of the text this
	// result describes, so the stamp has to name the version the text is read at.
	const version = document.version;
	const text = document.getText();
	const generation = context.generation;
	let result = emptyLintResult;
	let failure: { readonly error: unknown } | undefined;
	try {
		result = await computeDiagnostics(dependencies, document, text);
	} catch (error) {
		failure = { error };
	}

	// TextDocuments hands out one instance per open document, so a different
	// object means this one was closed and reopened while the lint was running.
	// A generation change likewise means the workspace linter was reconfigured.
	if (
		token?.isCancellationRequested ||
		dependencies.document(document.uri) !== document ||
		context.generation !== generation
	) {
		dependencies.trace(`discard stale validation ${document.uri}`, version);
		return undefined;
	}
	const lintResult = { version, ...result };
	results.set(document.uri, lintResult);
	if (failure) {
		throw failure.error;
	}
	return lintResult;
}

function closeDocument(context: ValidationContext, document: TextDocument): void {
	context.dependencies.trace(`onDidClose ${document.uri}`);
	if (document.uri.startsWith('file:')) {
		context.results.delete(document.uri);
	}
}

export function createValidationService(dependencies: ValidationDependencies) {
	const context: ValidationContext = { dependencies, results: new Map(), generation: 0 };
	return {
		close: (document: TextDocument) => {
			closeDocument(context, document);
		},
		invalidate: () => {
			context.generation += 1;
			context.results.clear();
		},
		validate: (document: TextDocument, token?: CancellationToken) =>
			validateDocument(context, document, token),
		current: (uri: string) => context.results.get(uri),
	};
}
