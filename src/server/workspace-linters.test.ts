import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	createWorkspaceLinterService,
	type WorkspaceLinterDependencies,
	type WorkspaceLinterDiscovery,
} from './workspace-linters.ts';

void test('workspace linter reports missing configuration before missing library', async () => {
	const events: string[] = [];
	const dependencies: WorkspaceLinterDependencies = {
		settings: () => ({
			configPath: null,
			ignorePath: null,
			nodePath: null,
			run: 'onSave',
			targetPath: '',
		}),
		trace: () => {},
		notifyNoConfig: () => {
			events.push('no-config');
		},
		notifyNoLibrary: () => {
			events.push('no-library');
		},
	};
	const discovery: WorkspaceLinterDiscovery = {
		findConfig: () => {
			events.push('find-config');
		},
		findIgnore: () => {
			events.push('find-ignore');
		},
		resolveModule: () => {
			events.push('resolve-library');
			return Promise.reject(new Error('missing library'));
		},
	};

	await createWorkspaceLinterService(dependencies, discovery).configure([
		{ name: 'workspace', uri: 'file:///workspace' },
	]);

	assert.deepStrictEqual(events, ['find-config', 'no-config', 'resolve-library', 'no-library']);
});
