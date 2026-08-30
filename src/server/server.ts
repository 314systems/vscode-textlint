import { inspect } from 'node:util';

import { TextDocument } from 'vscode-languageserver-textdocument';
import {
	ConfigurationRequest,
	createConnection,
	DidChangeConfigurationNotification,
	ProposedFeatures,
	TextDocuments,
	TextDocumentSyncKind,
} from 'vscode-languageserver/node';

import {
	NoConfigNotification,
	NoLibraryNotification,
	StatusNotification,
	defaultServerInitializationOptions,
	type ServerInitializationOptions,
} from '../shared/types.ts';
import { createCodeActionHandler } from './code-action-handler.ts';
import { textlintCodeActionKinds } from './code-actions.ts';
import { createValidationService } from './validation.ts';
import { createWorkspaceLinterService } from './workspace-linters.ts';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let settings = defaultServerInitializationOptions;

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
	void connection.sendNotification(StatusNotification.type, {
		status: StatusNotification.Status.ERROR,
		message: errorMessage(error),
		cause: error instanceof Error ? error.stack : undefined,
	});
}

async function withValidationProgress<T>(task: () => Promise<T>): Promise<T> {
	const progress = await connection.window.createWorkDoneProgress();
	progress.begin('textlint', undefined, 'Linting');
	try {
		return await task();
	} finally {
		progress.done();
	}
}

const workspaceLinters = createWorkspaceLinterService({
	settings: () => settings,
	trace,
	notifyNoConfig: (workspaceFolder) => {
		void connection.sendNotification(NoConfigNotification.type, { workspaceFolder });
	},
	notifyNoLibrary: (workspaceFolder) => {
		void connection.sendNotification(NoLibraryNotification.type, { workspaceFolder });
	},
});

const validation = createValidationService({
	document: (uri) => documents.get(uri),
	settings: () => settings,
	lookupLinter: workspaceLinters.lookup,
	trace,
	sendDiagnostics: (uri, diagnostics) => {
		void connection.sendDiagnostics({ uri, diagnostics: [...diagnostics] });
	},
	withProgress: withValidationProgress,
	sendOk: () => {
		void connection.sendNotification(StatusNotification.type, {
			status: StatusNotification.Status.OK,
		});
	},
	sendError,
});

const codeActions = createCodeActionHandler({
	document: (uri) => documents.get(uri),
	repository: validation.repository,
	validate: validation.validate,
	trace,
	sendError,
});

connection.onInitialize(() => ({
	capabilities: {
		textDocumentSync: TextDocumentSyncKind.Full,
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

async function updateSettings(): Promise<void> {
	const configurations = await connection.sendRequest<ServerInitializationOptions[]>(
		ConfigurationRequest.method,
		{ items: [{ section: 'textlint' }] },
	);
	settings = configurations[0] ?? defaultServerInitializationOptions;
}

async function reConfigure(): Promise<void> {
	trace('reConfigure');
	await workspaceLinters.configure(await connection.workspace.getWorkspaceFolders());
	await validation.validateMany(validation.prepareRevalidation());
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
	await updateSettings();
	trace('onDidChangeConfiguration', settings);
	await reConfigure();
});

connection.onDidChangeWatchedFiles(async () => {
	trace('onDidChangeWatchedFiles');
	await reConfigure();
});

documents.onDidChangeContent((event) => {
	trace(`onDidChangeContent ${event.document.uri}`, settings.run);
	if (settings.run === 'onType') {
		void validation.validateSingle(event.document);
	}
});

documents.onDidSave((event) => {
	trace(`onDidSave ${event.document.uri}`, settings.run);
	if (settings.run === 'onSave') {
		void validation.validateSingle(event.document);
	}
});

documents.onDidOpen((event) => {
	validation.open(event.document);
});
documents.onDidClose((event) => {
	validation.close(event.document);
});
connection.onCodeAction(codeActions.handle);
connection.listen();
