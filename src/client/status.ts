import * as vscode from 'vscode';

type StatusLogger = Readonly<{
	info: (message: string, data?: unknown) => void;
	warn: (message: string, data?: unknown) => void;
	error: (message: string, data?: unknown) => void;
}>;

export type StatusLevel = 'ok' | 'warn' | 'error';

interface StatusPresentation {
	readonly text: string;
	readonly severity: vscode.LanguageStatusSeverity;
	readonly log: (logger: StatusLogger, message: string, data?: unknown) => void;
}

const presentations = {
	ok: {
		text: 'textlint',
		severity: vscode.LanguageStatusSeverity.Information,
		log(logger, message, data) {
			logger.info(message, data);
		},
	},
	warn: {
		text: 'textlint: Warning',
		severity: vscode.LanguageStatusSeverity.Warning,
		log(logger, message, data) {
			logger.warn(message, data);
		},
	},
	error: {
		text: 'textlint: Error',
		severity: vscode.LanguageStatusSeverity.Error,
		log(logger, message, data) {
			logger.error(message, data);
		},
	},
} as const satisfies Record<StatusLevel, StatusPresentation>;

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
			presentation.log(this.logger, message, data);
		}
	}
}
