import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

type StatusLogger = Pick<LanguageClient, 'info' | 'warn' | 'error'>;

const presentations = {
	ok: {
		text: 'textlint',
		severity: vscode.LanguageStatusSeverity.Information,
		log: 'info',
	},
	warn: {
		text: 'textlint: Warning',
		severity: vscode.LanguageStatusSeverity.Warning,
		log: 'warn',
	},
	error: {
		text: 'textlint: Error',
		severity: vscode.LanguageStatusSeverity.Error,
		log: 'error',
	},
} as const;

export type StatusLevel = keyof typeof presentations;

export class LanguageStatus {
	private readonly item: vscode.LanguageStatusItem;
	private readonly logger: StatusLogger;
	private currentLevel: StatusLevel = 'ok';

	constructor(supports: readonly string[], logger: StatusLogger) {
		this.logger = logger;
		this.item = vscode.languages.createLanguageStatusItem(
			'textlint.status',
			supports.map((language) => ({ language, scheme: 'file' })),
		);
		this.item.name = 'textlint';
		this.item.command = {
			command: 'textlint.showOutputChannel',
			title: 'Show Output',
		};
		this.report('ok');
	}

	dispose() {
		this.item.dispose();
	}

	get level(): StatusLevel {
		return this.currentLevel;
	}

	get busy(): boolean {
		return this.item.busy;
	}

	set busy(busy: boolean) {
		this.item.busy = busy;
	}

	report(level: StatusLevel, message?: string, data?: unknown) {
		const presentation = presentations[level];
		this.currentLevel = level;
		this.item.severity = presentation.severity;
		this.item.text = presentation.text;
		this.item.detail = message?.split('\n', 1)[0];
		if (message !== undefined) {
			this.logger[presentation.log](message, data);
		}
	}
}
