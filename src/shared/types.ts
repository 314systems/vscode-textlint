import { NotificationType } from 'vscode-languageserver';

export type RunMode = 'onSave' | 'onType';

export interface TextlintSettings {
	readonly languages: readonly string[];
	readonly configPath: string | null;
	readonly ignorePath: string | null;
	readonly nodePath: string | null;
	readonly run: RunMode;
	readonly targetPath: string;
}

export type ServerSettings = Omit<TextlintSettings, 'languages' | 'run'>;

export const defaultServerSettings: ServerSettings = {
	configPath: null,
	ignorePath: null,
	nodePath: null,
	targetPath: '',
};

export type StatusLevel = 'ok' | 'warn' | 'error';

export interface StatusParams {
	status: StatusLevel;
	message?: string;
	cause?: unknown;
}

export const statusNotification = new NotificationType<StatusParams>('textlint/status');
