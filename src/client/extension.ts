import * as vscode from 'vscode';
import { DiagnosticPullMode, State, RevealOutputChannelOn } from 'vscode-languageclient';
import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';

import { type TextlintSettings, defaultServerSettings, statusNotification } from '../shared/types';
import { LanguageStatus } from './status';

const defaultConfig: TextlintSettings = {
	...defaultServerSettings,
	languages: [],
	run: 'onSave',
};

const configFileNames = ['', '.js', '.yaml', '.yml', '.json'].map((ext) => `.textlintrc${ext}`);

const initialConfigContent = new TextEncoder().encode(
	JSON.stringify({ filters: {}, rules: {} }, null, 2),
);

export interface ExtensionInternal {
	readonly client: LanguageClient;
	readonly status: LanguageStatus;
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionInternal> {
	const client = newClient(context);
	const status = new LanguageStatus(readConfig().languages, client);
	client.onDidChangeState(({ newState }) => {
		// Starting only raises the spinner; the text keeps the previous outcome
		// until the server either comes up or fails.
		status.busy = newState === State.Starting;
		switch (newState) {
			case State.Running:
				status.reportServer('ok');
				break;
			case State.Stopped:
				status.reportServer('error', 'textlint server stopped.');
				break;
			case State.StartFailed:
				status.reportServer('error', 'textlint server failed to start.');
				break;
		}
	});
	client.onNotification(statusNotification, (params) => {
		status.reportLint(params.status, params.message, params.cause);
	});
	context.subscriptions.push(
		vscode.commands.registerCommand('textlint.createConfig', createConfig),
		vscode.commands.registerCommand('textlint.showOutputChannel', () => {
			client.outputChannel.show();
		}),
		client,
		status,
	);
	await client.start();

	return { client, status };
}

function newClient(context: vscode.ExtensionContext): LanguageClient {
	const module = vscode.Uri.joinPath(context.extensionUri, 'dist', 'server.js').fsPath;
	const debugOptions = { execArgv: ['--nolazy', '--inspect=6011'] };
	const serverOptions: ServerOptions = {
		run: { module, transport: TransportKind.ipc },
		debug: { module, transport: TransportKind.ipc, options: debugOptions },
	};
	const clientOptions: LanguageClientOptions = {
		documentSelector: readConfig().languages.map((language) => ({ language, scheme: 'file' })),
		diagnosticPullOptions: {
			onChange: true,
			onSave: true,
			filter: (document, mode) => {
				const run = vscode.workspace
					.getConfiguration('textlint', document.uri)
					.get('run', defaultConfig.run);
				return mode === DiagnosticPullMode.onType ? run !== 'onType' : run !== 'onSave';
			},
		},
		revealOutputChannelOn: RevealOutputChannelOn.Error,
		synchronize: {
			fileEvents: [
				vscode.workspace.createFileSystemWatcher('**/package.json'),
				vscode.workspace.createFileSystemWatcher('**/.textlintrc'),
				vscode.workspace.createFileSystemWatcher('**/.textlintrc.{js,json,yml,yaml}'),
				vscode.workspace.createFileSystemWatcher('**/.textlintignore'),
			],
		},
		// Logs exactly what the built-in fallback logs, but without its modal error
		// dialog: a failed start is already visible in the language status item.
		// Returning false leaves the retry to the user rather than looping on it.
		initializationFailedHandler: (error) => {
			client.error('Server initialization failed.', error);
			return false;
		},
	};
	const client = new LanguageClient('textlint', serverOptions, clientOptions);
	return client;
}

/**
 * Handler for the `textlint.createConfig` command.
 *
 * Only folders that {@link filterNoConfigFolders} reports as config-less are
 * offered, so an existing configuration is never overwritten. A single candidate
 * is written straight away; several prompt for which one to use. Nothing to do,
 * in either direction, is reported through an error notification.
 */
async function createConfig(): Promise<void> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders?.length) {
		await vscode.window.showErrorMessage(
			'A textlint configuration can only be generated if VS Code is opened on a workspace folder.',
		);
		return;
	}

	const noConfigs = await filterNoConfigFolders(folders);

	if (noConfigs.length === 0) {
		await vscode.window.showErrorMessage(
			'textlint configuration file already exists in this workspace.',
		);
		return;
	}

	if (noConfigs.length === 1) {
		await emitConfig(noConfigs[0]);
		return;
	}

	const item = await vscode.window.showQuickPick(
		noConfigs.map((folder) => ({
			label: folder.name,
			description: folder.uri.path,
			folder,
		})),
	);
	if (item) {
		await emitConfig(item.folder);
	}
}

/**
 * Narrows workspace folders down to the ones that have no textlint configuration.
 *
 * Folders are probed in parallel and the survivors keep their original order,
 * which is the order the quick pick presents them in.
 *
 * @param folders Workspace folders to probe.
 * @returns The subset of `folders` that {@link hasConfig} rejected.
 */
async function filterNoConfigFolders(
	folders: readonly vscode.WorkspaceFolder[],
): Promise<vscode.WorkspaceFolder[]> {
	const configured = await Promise.all(folders.map(hasConfig));
	return folders.filter((_, index) => !configured[index]);
}

/**
 * Reports whether the folder root holds any of the {@link configFileNames} variants.
 *
 * `Promise.any` settles on the first stat that succeeds and rejects only once every
 * candidate has failed, so a file that cannot be stat'd counts as absent. Nested
 * directories are not searched: only the folder root is a candidate location.
 *
 * @param folder Workspace folder whose root is probed.
 */
async function hasConfig(folder: vscode.WorkspaceFolder): Promise<boolean> {
	const stats = configFileNames.map((name) =>
		vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, name)),
	);
	try {
		await Promise.any(stats);
		return true;
	} catch {
		return false;
	}
}

/**
 * Writes an empty starter `.textlintrc` at the root of the given folder.
 *
 * The write is unconditional and replaces any existing file, so callers must
 * pass a folder that {@link filterNoConfigFolders} reported as config-less.
 *
 * @param folder Workspace folder to create the configuration file in.
 */
async function emitConfig(folder: vscode.WorkspaceFolder): Promise<void> {
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(folder.uri, '.textlintrc'),
		initialConfigContent,
	);
}

function readConfig(): TextlintSettings {
	const config = vscode.workspace.getConfiguration('textlint');
	return {
		languages: config.get('languages', defaultConfig.languages),
		configPath: config.get('configPath', defaultConfig.configPath),
		ignorePath: config.get('ignorePath', defaultConfig.ignorePath),
		nodePath: config.get('nodePath', defaultConfig.nodePath),
		run: config.get('run', defaultConfig.run),
		targetPath: config.get('targetPath', defaultConfig.targetPath),
	};
}
