import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

import type { StatusLevel } from '../shared/types';

type StatusLogger = Pick<LanguageClient, 'info' | 'warn' | 'error'>;

interface Presentation {
	readonly text: string;
	readonly severity: vscode.LanguageStatusSeverity;
	readonly log: keyof StatusLogger;
}

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
} as const satisfies Record<StatusLevel, Presentation>;

interface StatusEntry {
	readonly level: StatusLevel;
	readonly message?: string;
}

const okEntry: StatusEntry = { level: 'ok' };

export class LanguageStatus {
	private readonly item: vscode.LanguageStatusItem;
	private readonly logger: StatusLogger;
	private serverEntry: StatusEntry = okEntry;
	private lintEntry: StatusEntry = okEntry;

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
		this.refresh();
	}

	dispose() {
		this.item.dispose();
	}

	get level(): StatusLevel {
		return this.effective.level;
	}

	get busy(): boolean {
		return this.item.busy;
	}

	set busy(busy: boolean) {
		this.item.busy = busy;
	}

	// Lifecycle of the server process. A server that is down cannot report on
	// itself, so this outranks whatever the last lint run had to say; reaching
	// 'ok' means a fresh server is up and the stale lint result no longer holds.
	reportServer(level: StatusLevel, message?: string) {
		this.serverEntry = { level, message };
		if (level === 'ok') {
			this.lintEntry = okEntry;
		}
		this.log(level, message);
		this.refresh();
	}

	// Outcome of a lint run, surfaced only while the server itself is healthy.
	reportLint(level: StatusLevel, message?: string, data?: unknown) {
		this.lintEntry = { level, message };
		this.log(level, message, data);
		this.refresh();
	}

	private get effective(): StatusEntry {
		return this.serverEntry.level === 'ok' ? this.lintEntry : this.serverEntry;
	}

	private log(level: StatusLevel, message?: string, data?: unknown) {
		if (message !== undefined) {
			this.logger[presentations[level].log](message, data);
		}
	}

	// The single place the item is written, so the two report paths cannot
	// overwrite each other's presentation.
	private refresh() {
		const { level, message } = this.effective;
		const presentation = presentations[level];
		this.item.severity = presentation.severity;
		this.item.text = presentation.text;
		this.item.detail = message?.split('\n', 1)[0];
	}
}
