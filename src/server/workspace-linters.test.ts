import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TextDocument } from 'vscode-languageserver-textdocument';

import {
	createWorkspaceLinterService,
	requiresLinterRebuild,
	type WorkspaceLinterDependencies,
	type WorkspaceLinterDiscovery,
} from './workspace-linters.ts';

type TextlintModule = Pick<typeof import('textlint'), 'createLinter' | 'loadTextlintrc'>;

function createTextlintModule(extension: string, onCreate = () => {}): TextlintModule {
	const descriptor = {
		availableExtensions: [extension],
	} as Awaited<ReturnType<TextlintModule['loadTextlintrc']>>;
	const linter = {
		lintText: () => Promise.resolve({ filePath: '/workspace/test.txt', messages: [] }),
	} as unknown as ReturnType<TextlintModule['createLinter']>;
	return {
		createLinter: () => {
			onCreate();
			return linter;
		},
		loadTextlintrc: () => Promise.resolve(descriptor),
	};
}

void test('only linter settings require a rebuild', () => {
	const settings = {
		configPath: null,
		ignorePath: null,
		nodePath: null,
		targetPath: '',
	};

	assert.strictEqual(requiresLinterRebuild(settings, { ...settings, targetPath: '*.md' }), false);
	assert.strictEqual(requiresLinterRebuild(settings, { ...settings, configPath: '/config' }), true);
	assert.strictEqual(requiresLinterRebuild(settings, { ...settings, ignorePath: '/ignore' }), true);
	assert.strictEqual(requiresLinterRebuild(settings, { ...settings, nodePath: '/modules' }), true);
});

void test('workspace linter reports missing configuration before missing library', async () => {
	const events: string[] = [];
	const dependencies: WorkspaceLinterDependencies = {
		settings: () => ({
			configPath: null,
			ignorePath: null,
			nodePath: null,
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

void test('workspace linter replacement is atomic', async () => {
	const dependencies: WorkspaceLinterDependencies = {
		settings: () => ({
			configPath: null,
			ignorePath: null,
			nodePath: null,
			targetPath: '',
		}),
		trace: () => {},
		notifyNoConfig: () => {},
		notifyNoLibrary: () => {},
	};
	let module = Promise.resolve(createTextlintModule('.old'));
	const discovery: WorkspaceLinterDiscovery = {
		findConfig: () => undefined,
		findIgnore: () => undefined,
		resolveModule: () => module,
	};
	const service = createWorkspaceLinterService(dependencies, discovery);
	const folders = [{ name: 'workspace', uri: 'file:///workspace' }];
	const document = TextDocument.create('file:///workspace/test.txt', 'plaintext', 1, 'text');

	await service.configure(folders);
	assert.deepStrictEqual(service.lookup(document)[1]?.availableExtensions, ['.old']);

	let finish: (value: TextlintModule) => void = () => {};
	module = new Promise((resolve) => {
		finish = resolve;
	});
	const pending = service.configure(folders);
	assert.deepStrictEqual(service.lookup(document)[1]?.availableExtensions, ['.old']);

	finish(createTextlintModule('.new'));
	await pending;
	assert.deepStrictEqual(service.lookup(document)[1]?.availableExtensions, ['.new']);
});

void test('workspace linter order follows the workspace folder order', async () => {
	const dependencies: WorkspaceLinterDependencies = {
		settings: () => ({
			configPath: null,
			ignorePath: null,
			nodePath: null,
			targetPath: '',
		}),
		trace: () => {},
		notifyNoConfig: () => {},
		notifyNoLibrary: () => {},
	};
	let finishParent: (value: TextlintModule) => void = () => {};
	const parent = new Promise<TextlintModule>((resolve) => {
		finishParent = resolve;
	});
	let markNestedReady: () => void = () => {};
	const nestedReady = new Promise<void>((resolve) => {
		markNestedReady = resolve;
	});
	const discovery: WorkspaceLinterDiscovery = {
		findConfig: () => undefined,
		findIgnore: () => undefined,
		resolveModule: (root) =>
			root === '/workspace'
				? parent
				: Promise.resolve(createTextlintModule('.nested', markNestedReady)),
	};
	const service = createWorkspaceLinterService(dependencies, discovery);
	const pending = service.configure([
		{ name: 'parent', uri: 'file:///workspace' },
		{ name: 'nested', uri: 'file:///workspace/nested' },
	]);

	await nestedReady;
	finishParent(createTextlintModule('.parent'));
	await pending;

	const document = TextDocument.create('file:///workspace/nested/test.txt', 'plaintext', 1, 'text');
	assert.deepStrictEqual(service.lookup(document)[1]?.availableExtensions, ['.parent']);
});
