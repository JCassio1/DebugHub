import * as assert from 'assert';
import * as vscode from 'vscode';
import { __testables, type LaunchConfig } from '../extension';

type ControllerStub = {
	getLaunchConfigurations: () => LaunchConfig[];
	getSelectedLaunchKeys: () => Set<string>;
	getLaunchKey: (node: LaunchConfig) => string;
	getActiveSessions: () => vscode.DebugSession[];
};

function createControllerStub(configs: LaunchConfig[], sessions: vscode.DebugSession[]): ControllerStub {
	return {
		getLaunchConfigurations: () => configs,
		getSelectedLaunchKeys: () => new Set<string>(),
		getLaunchKey: (node: LaunchConfig) => `${String(node.configuration.name ?? '')}::${String(node.configuration.type ?? '')}`,
		getActiveSessions: () => sessions
	};
}

function findConfigurationItem(items: vscode.QuickPickItem[], configName: string): vscode.QuickPickItem {
	const item = items.find((candidate) => candidate.label.includes(configName));
	assert.ok(item, `Expected quick pick item for "${configName}"`);
	return item!;
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Builds one debugger section with running and stopped status', () => {
		const launchConfigs: LaunchConfig[] = [
			{
				folder: undefined,
				configuration: { name: 'API', type: 'node', request: 'launch' }
			},
			{
				folder: undefined,
				configuration: { name: 'Worker', type: 'node', request: 'launch' }
			}
		];
		const activeSessions = [
			{
				id: 's1',
				name: 'API',
				type: 'node',
				configuration: { name: 'API' },
				workspaceFolder: undefined
			} as unknown as vscode.DebugSession
		];
		const controller = createControllerStub(launchConfigs, activeSessions);

		const items = __testables.buildQuickPickItems(controller as never);
		const separators = items.filter((item) => item.kind === vscode.QuickPickItemKind.Separator);

		assert.strictEqual(separators.length, 1);
		assert.strictEqual(separators[0].label, 'Debuggers (2)');
		assert.ok(!items.some((item) => item.label.includes('Active Debuggers')));

		const runningItem = findConfigurationItem(items, 'API');
		const stoppedItem = findConfigurationItem(items, 'Worker');
		assert.ok(runningItem.label.startsWith('🟢'));
		assert.ok(stoppedItem.label.startsWith('🔴'));
	});

	test('Shows square stop button for running and play button for inactive', () => {
		const launchConfigs: LaunchConfig[] = [
			{
				folder: undefined,
				configuration: { name: 'Frontend', type: 'pwa-node', request: 'launch' }
			},
			{
				folder: undefined,
				configuration: { name: 'Backend', type: 'node', request: 'launch' }
			}
		];
		const activeSessions = [
			{
				id: 's1',
				name: 'Frontend',
				type: 'pwa-node',
				configuration: { name: 'Frontend' },
				workspaceFolder: undefined
			} as unknown as vscode.DebugSession
		];
		const controller = createControllerStub(launchConfigs, activeSessions);

		const items = __testables.buildQuickPickItems(controller as never);
		const runningItem = findConfigurationItem(items, 'Frontend');
		const stoppedItem = findConfigurationItem(items, 'Backend');
		const runningIcon = runningItem.buttons?.[0].iconPath as vscode.ThemeIcon;
		const stoppedIcon = stoppedItem.buttons?.[0].iconPath as vscode.ThemeIcon;

		assert.strictEqual(runningIcon.id, 'primitive-square');
		assert.strictEqual(stoppedIcon.id, 'play');
	});
});
