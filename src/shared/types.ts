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

export type ServerSettings = Omit<TextlintSettings, 'languages'>;

export const defaultServerSettings: ServerSettings = {
	configPath: null,
	ignorePath: null,
	nodePath: null,
	run: 'onSave',
	targetPath: '',
};

export namespace StatusNotification {
	export enum Status {
		OK = 1,
		WARN = 2,
		ERROR = 3,
	}
	export interface StatusParams {
		status: Status;
		message?: string;
		cause?: unknown;
	}
	export const type = new NotificationType<StatusParams>('textlint/status');
}
