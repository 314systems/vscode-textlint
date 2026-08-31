import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { defineConfig } from '@vscode/test-cli';

const workspaceFolder = path.join(import.meta.dirname, 'tests/fixtures/single-root-workspace');

// The fixture workspace has its own textlint installation that the language server resolves.
// This config is also evaluated by the Extension Test Runner, so only install when it is missing.
if (!existsSync(path.join(workspaceFolder, 'node_modules'))) {
	execSync('npm ci', { cwd: workspaceFolder, stdio: 'inherit' });
}

export default defineConfig({
	files: 'tests/e2e/**/*.test.ts',
	workspaceFolder,
	launchArgs: ['--disable-extensions'],
	mocha: {
		ui: 'tdd',
		timeout: 90_000,
	},
});
