import { inspect } from 'node:util';

import { TextDocument } from 'vscode-languageserver-textdocument';
import {
	ConfigurationRequest,
	createConnection,
	DidChangeConfigurationNotification,
	DocumentDiagnosticReportKind,
	ProposedFeatures,
	TextDocuments,
	TextDocumentSyncKind,
} from 'vscode-languageserver/node';

import { defaultServerSettings, statusNotification, type ServerSettings } from '../shared/types.ts';
import { createCodeActionHandler } from './code-action-handler.ts';
import { textlintCodeActionKinds } from './code-actions.ts';
import { createValidationService } from './validation.ts';
import { createWorkspaceLinterService, requiresLinterRebuild } from './workspace-linters.ts';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let settings = defaultServerSettings;

documents.listen(connection);

function trace(message: string, data?: unknown): void {
	if (data === undefined) {
		connection.console.debug(message);
		return;
	}
	connection.console.debug(`${message} ${typeof data === 'string' ? data : inspect(data)}`);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sendError(error: unknown): void {
	void connection.sendNotification(statusNotification, {
		status: 'error',
		message: errorMessage(error),
		cause: error instanceof Error ? error.stack : undefined,
	});
}

function sendWarning(message: string): void {
	void connection.sendNotification(statusNotification, {
		status: 'warn',
		message,
	});
}

function sendOk(): void {
	void connection.sendNotification(statusNotification, {
		status: 'ok',
	});
}

const workspaceLinters = createWorkspaceLinterService({
	settings: () => settings,
	trace,
	notifyNoConfig: (workspaceFolder) => {
		sendWarning(
			`No textlint configuration (e.g .textlintrc) found in ${workspaceFolder} .
File will not be validated. Consider running the 'Create .textlintrc file' command.`,
		);
	},
	notifyNoLibrary: (workspaceFolder) => {
		sendWarning(
			`Failed to load the textlint library in ${workspaceFolder} .
To use textlint in this workspace please install textlint using 'npm install textlint' or globally using 'npm install -g textlint'.
You need to reopen the workspace after installing textlint.`,
		);
	},
});

const validation = createValidationService({
	document: (uri) => documents.get(uri),
	settings: () => settings,
	lookupLinter: workspaceLinters.lookup,
	trace,
});

let reconfiguration = Promise.resolve();

async function waitForReconfiguration(): Promise<void> {
	let pending: Promise<void>;
	do {
		pending = reconfiguration;
		await pending;
	} while (pending !== reconfiguration);
}

const codeActions = createCodeActionHandler({
	document: (uri) => documents.get(uri),
	current: validation.current,
	validate: async (document) => {
		await waitForReconfiguration();
		return validation.validate(document);
	},
	trace,
	sendError,
});

connection.onInitialize(() => ({
	capabilities: {
		textDocumentSync: TextDocumentSyncKind.Full,
		diagnosticProvider: {
			identifier: 'textlint',
			interFileDependencies: false,
			workspaceDiagnostics: false,
		},
		codeActionProvider: {
			codeActionKinds: [...textlintCodeActionKinds],
		},
		workspace: {
			workspaceFolders: {
				supported: true,
				changeNotifications: true,
			},
		},
	},
}));

async function updateSettings(): Promise<ServerSettings> {
	const previous = settings;
	const configurations = await connection.sendRequest<ServerSettings[]>(
		ConfigurationRequest.method,
		{ items: [{ section: 'textlint' }] },
	);
	settings = configurations[0] ?? defaultServerSettings;
	return previous;
}

function reConfigure(): Promise<void> {
	validation.invalidate();
	reconfiguration = reconfiguration
		.then(async () => {
			trace('reConfigure');
			await workspaceLinters.configure(await connection.workspace.getWorkspaceFolders());
			await connection.languages.diagnostics.refresh();
		})
		.catch(sendError);
	return reconfiguration;
}

connection.onInitialized(async () => {
	await connection.client.register(DidChangeConfigurationNotification.type);
	await updateSettings();
	await reConfigure();
	connection.workspace.onDidChangeWorkspaceFolders(async (event) => {
		for (const folder of event.removed) {
			workspaceLinters.remove(folder.uri);
		}
		await reConfigure();
	});
});

connection.onDidChangeConfiguration(async () => {
	const previous = await updateSettings();
	trace('onDidChangeConfiguration', settings);
	if (requiresLinterRebuild(previous, settings)) {
		await reConfigure();
	} else if (previous.targetPath !== settings.targetPath) {
		validation.invalidate();
		await connection.languages.diagnostics.refresh();
	}
});

connection.onDidChangeWatchedFiles(async () => {
	trace('onDidChangeWatchedFiles');
	await reConfigure();
});

connection.languages.diagnostics.on(async (params, token) => {
	await waitForReconfiguration();
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		return { kind: DocumentDiagnosticReportKind.Full, items: [] };
	}
	try {
		const result = await validation.validate(document, token);
		if (!result) {
			return { kind: DocumentDiagnosticReportKind.Full, items: [] };
		}
		sendOk();
		return { kind: DocumentDiagnosticReportKind.Full, items: [...result.diagnostics] };
	} catch (error) {
		sendError(error);
		return { kind: DocumentDiagnosticReportKind.Full, items: [] };
	}
});
documents.onDidClose((event) => {
	validation.close(event.document);
});
connection.onCodeAction(codeActions.handle);
connection.listen();
