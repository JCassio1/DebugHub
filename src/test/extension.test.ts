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

  test('Collects workspace and folder launch configurations', () => {
    const folderA = {
      name: 'api',
      uri: vscode.Uri.parse('file:///workspace/api'),
      index: 0
    } as unknown as vscode.WorkspaceFolder;
    const folderB = {
      name: 'web',
      uri: vscode.Uri.parse('file:///workspace/web'),
      index: 1
    } as unknown as vscode.WorkspaceFolder;
    const scopeCalls: string[] = [];

    const launchConfigs = __testables.collectLaunchConfigurations([folderA, folderB], (folder) => {
      scopeCalls.push(folder?.name ?? '__workspace__');

      if (!folder) {
        return [{ name: 'Workspace Root', type: 'node', request: 'launch' }];
      }

      if (folder.name === 'api') {
        return [{ name: 'API', type: 'node', request: 'launch' }];
      }

      return [{ name: 'Web', type: 'node', request: 'launch' }];
    });

    assert.deepStrictEqual(scopeCalls, ['__workspace__', 'api', 'web']);
    assert.strictEqual(launchConfigs.length, 3);
    assert.strictEqual(String(launchConfigs[0].configuration.name), 'Workspace Root');
    assert.strictEqual(launchConfigs[0].folder, undefined);
    assert.strictEqual(launchConfigs[1].folder?.name, 'api');
    assert.strictEqual(String(launchConfigs[2].configuration.name), 'Web');
  });

  test('Collects workspace launch configurations when no folders are open', () => {
    const launchConfigs = __testables.collectLaunchConfigurations(undefined, () => [
      { name: 'Workspace Only', type: 'node', request: 'launch' }
    ]);

    assert.strictEqual(launchConfigs.length, 1);
    assert.strictEqual(launchConfigs[0].folder, undefined);
    assert.strictEqual(String(launchConfigs[0].configuration.name), 'Workspace Only');
  });

  test('Selects correct scoped configurations from inspection', () => {
    const inspection = {
      workspaceValue: [{ name: 'Workspace Config' }],
      workspaceFolderValue: [{ name: 'Folder Config' }]
    };
    const folder = {
      name: 'api',
      uri: vscode.Uri.parse('file:///workspace/api'),
      index: 0
    } as unknown as vscode.WorkspaceFolder;

    const workspaceScope = __testables.getScopedLaunchConfigurationsFromInspection(inspection, undefined);
    const folderScope = __testables.getScopedLaunchConfigurationsFromInspection(inspection, folder);

    assert.strictEqual(String(workspaceScope[0].name), 'Workspace Config');
    assert.strictEqual(String(folderScope[0].name), 'Folder Config');
  });

  test('Sets group on presentation and removes legacy debughubGroup', () => {
    const updated = __testables.setConfigurationGroup(
      {
        name: 'API',
        debughubGroup: 'Legacy',
        presentation: { order: 2 }
      },
      'Backend Services'
    );

    assert.strictEqual(updated.debughubGroup, undefined);
    assert.deepStrictEqual(updated.presentation, { order: 2, group: 'Backend Services' });
  });

  test('Removes group from presentation while preserving other presentation fields', () => {
    const updated = __testables.setConfigurationGroup(
      {
        name: 'API',
        presentation: { group: 'Backend Services', order: 10, hidden: false }
      },
      undefined
    );

    assert.deepStrictEqual(updated.presentation, { order: 10, hidden: false });
  });

  test('Migrates legacy debughubGroup to presentation.group', () => {
    const migrated = __testables.migrateLegacyGroupConfiguration({
      name: 'API',
      debughubGroup: 'Backend Services'
    });

    assert.strictEqual(migrated.debughubGroup, undefined);
    assert.deepStrictEqual(migrated.presentation, { group: 'Backend Services' });
  });

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

    assert.strictEqual(separators.length, 2);
    assert.strictEqual(separators[0].label, 'Debuggers (2)');
    assert.strictEqual(separators[1].label, 'Toolbar: Start All | Stop All | Create Group');

    const runningItem = findConfigurationItem(items, 'API');
    const stoppedItem = findConfigurationItem(items, 'Worker');
    assert.ok(runningItem.label.trimStart().startsWith('🟢'));
    assert.ok(stoppedItem.label.trimStart().startsWith('🔴'));
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

  test('Groups launch configurations and resolves group name from supported fields', () => {
    const launchConfigs: LaunchConfig[] = [
      {
        folder: undefined,
        configuration: { name: 'API', type: 'node', request: 'launch', group: 'Legacy Group', debughubGroup: 'Backend Services' }
      },
      {
        folder: undefined,
        configuration: { name: 'Worker', type: 'node', request: 'launch', presentation: { group: 'Backend Services' } }
      },
      {
        folder: undefined,
        configuration: { name: 'Web', type: 'pwa-node', request: 'launch', group: 'Frontend Services' }
      }
    ];

    assert.strictEqual(__testables.getLaunchGroupName(launchConfigs[0]), 'Backend Services');
    assert.strictEqual(__testables.getLaunchGroupName(launchConfigs[1]), 'Backend Services');
    assert.strictEqual(__testables.getLaunchGroupName(launchConfigs[2]), 'Frontend Services');

    const grouped = __testables.groupLaunchConfigurations(launchConfigs);
    assert.strictEqual(grouped.length, 2);
    assert.strictEqual(grouped[0].name, 'Backend Services');
    assert.strictEqual(grouped[0].nodes.length, 2);
    assert.strictEqual(grouped[1].name, 'Frontend Services');
    assert.strictEqual(grouped[1].nodes.length, 1);
  });

  test('Shows group rows with stop icon when any config in group is running', () => {
    const launchConfigs: LaunchConfig[] = [
      {
        folder: undefined,
        configuration: { name: 'API', type: 'node', request: 'launch', group: 'Backend Services' }
      },
      {
        folder: undefined,
        configuration: { name: 'Worker', type: 'node', request: 'launch', group: 'Backend Services' }
      },
      {
        folder: undefined,
        configuration: { name: 'Web', type: 'pwa-node', request: 'launch', group: 'Frontend Services' }
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
    const backendGroupItem = items.find(
      (item) => (item as { itemType?: string; groupName?: string }).itemType === 'group'
        && (item as { groupName?: string }).groupName === 'Backend Services'
    );
    const frontendGroupItem = items.find(
      (item) => (item as { itemType?: string; groupName?: string }).itemType === 'group'
        && (item as { groupName?: string }).groupName === 'Frontend Services'
    );

    assert.ok(backendGroupItem, 'Expected backend group quick pick item');
    assert.ok(frontendGroupItem, 'Expected frontend group quick pick item');

    const backendIcon = backendGroupItem!.buttons?.[0].iconPath as vscode.ThemeIcon;
    const frontendIcon = frontendGroupItem!.buttons?.[0].iconPath as vscode.ThemeIcon;

    assert.strictEqual(backendIcon.id, 'primitive-square');
    assert.strictEqual(frontendIcon.id, 'play');
  });
});
