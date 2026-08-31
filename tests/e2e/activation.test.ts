import assert from 'node:assert/strict';

import * as vscode from 'vscode';

import { checkedTest, setupExtension } from './harness.ts';

checkedTest('Extension tests > Activate extension and register commands', async () => {
	const extension = await setupExtension();
	assert.ok(extension.isActive, 'Extension should be active');
	const textlintCommands = (await vscode.commands.getCommands(true)).filter((command) =>
		command.startsWith('textlint.'),
	);
	for (const command of ['textlint.createConfig', 'textlint.showOutputChannel']) {
		assert.ok(textlintCommands.includes(command), `${command} should be registered`);
	}
});
