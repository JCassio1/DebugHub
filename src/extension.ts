import * as vscode from 'vscode';

export type LaunchConfig = {
  folder: vscode.WorkspaceFolder | undefined;
  configuration: Record<string, unknown>;
};

class DebugHubController {
  private readonly selectedLaunchKeys = new Set<string>();
  private readonly activeSessions = new Map<string, vscode.DebugSession>();
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem('debughub.status', vscode.StatusBarAlignment.Right, 1000);
    this.statusBarItem.command = 'debughub.openPopover';
    this.statusBarItem.name = 'DebugHub';
    this.statusBarItem.show();
    this.updateStatusBar();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }

  addSession(session: vscode.DebugSession): void {
    this.activeSessions.set(session.id, session);
    this.updateStatusBar();
  }

  removeSession(session: vscode.DebugSession): void {
    this.activeSessions.delete(session.id);
    this.updateStatusBar();
  }

  getActiveSessions(): vscode.DebugSession[] {
    return [...this.activeSessions.values()];
  }

  getLaunchConfigurations(): LaunchConfig[] {
    const folders = vscode.workspace.workspaceFolders;
    const folderScope = folders && folders.length > 0 ? folders : [undefined];
    const nodes: LaunchConfig[] = [];

    for (const folder of folderScope) {
      const launchConfig = vscode.workspace.getConfiguration('launch', folder?.uri);
      const configurations = launchConfig.get<Record<string, unknown>[]>('configurations', []);
      for (const configuration of configurations) {
        nodes.push({ folder, configuration });
      }
    }

    this.pruneSelections(nodes);
    return nodes;
  }

  setSelectedLaunchKeys(keys: Iterable<string>): void {
    this.selectedLaunchKeys.clear();
    for (const key of keys) {
      this.selectedLaunchKeys.add(key);
    }
  }

  getSelectedLaunchKeys(): Set<string> {
    return new Set(this.selectedLaunchKeys);
  }

  getLaunchKey(node: LaunchConfig): string {
    const folder = node.folder?.uri.toString() ?? '__workspace__';
    const name = String(node.configuration.name ?? '');
    const type = String(node.configuration.type ?? '');
    const request = String(node.configuration.request ?? '');
    return `${folder}::${name}::${type}::${request}`;
  }

  async startLaunchConfigurations(nodes: LaunchConfig[]): Promise<void> {
    for (const node of nodes) {
      const configurationName = node.configuration.name;
      if (typeof configurationName !== 'string' || configurationName.length === 0) {
        continue;
      }
      await vscode.debug.startDebugging(node.folder, configurationName);
    }
  }

  async stopAllSessions(): Promise<void> {
    await this.stopSessions(this.getActiveSessions());
  }

  async stopSessions(sessions: vscode.DebugSession[]): Promise<void> {
    for (const session of sessions) {
      await vscode.debug.stopDebugging(session);
      this.activeSessions.delete(session.id);
    }
    this.updateStatusBar();
  }

  updateStatusBar(): void {
    const count = this.getActiveSessions().length;
    const light = count > 0 ? '$(circle-filled)' : '$(circle-large-outline)';
    this.statusBarItem.text = `${light} ${count}`;
    this.statusBarItem.color = new vscode.ThemeColor(count > 0 ? 'testing.iconPassed' : 'descriptionForeground');
    this.statusBarItem.tooltip =
      count > 0 ? `DebugHub: ${count} active debugger(s). Click to manage.` : 'DebugHub: no active debuggers. Click to manage.';
  }

  private pruneSelections(nodes: LaunchConfig[]): void {
    const validKeys = new Set(nodes.map((node) => this.getLaunchKey(node)));
    for (const key of this.selectedLaunchKeys) {
      if (!validKeys.has(key)) {
        this.selectedLaunchKeys.delete(key);
      }
    }
  }
}

type DebugQuickPickItem = vscode.QuickPickItem & {
  itemType: 'session' | 'configuration';
  key?: string;
  launchConfig?: LaunchConfig;
};

type QuickPickControllerState = Pick<
  DebugHubController,
  'getLaunchConfigurations' | 'getSelectedLaunchKeys' | 'getLaunchKey' | 'getActiveSessions'
>;

function getConfigurationName(launchConfig: LaunchConfig): string {
  return String(launchConfig.configuration.name ?? '');
}

function isSessionForLaunchConfig(session: vscode.DebugSession, launchConfig: LaunchConfig): boolean {
  const targetName = getConfigurationName(launchConfig);
  if (targetName.length === 0) {
    return false;
  }

  const sessionConfigName = typeof session.configuration?.name === 'string' ? session.configuration.name : '';
  const isNameMatch = session.name === targetName || sessionConfigName === targetName;
  if (!isNameMatch) {
    return false;
  }

  const targetFolderUri = launchConfig.folder?.uri.toString();
  const sessionFolderUri = session.workspaceFolder?.uri.toString();
  return targetFolderUri === sessionFolderUri;
}

function getSessionsForLaunchConfig(controller: QuickPickControllerState, launchConfig: LaunchConfig): vscode.DebugSession[] {
  return controller.getActiveSessions().filter((session) => isSessionForLaunchConfig(session, launchConfig));
}

function buildQuickPickItems(controller: QuickPickControllerState): DebugQuickPickItem[] {
  const items: DebugQuickPickItem[] = [];
  const launchConfigs = controller.getLaunchConfigurations();
  const selected = controller.getSelectedLaunchKeys();
  const startConfigButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('play'),
    tooltip: 'Start this configuration'
  };
  const stopConfigButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('primitive-square'),
    tooltip: 'Stop this configuration'
  };

  items.push({
    label: `Debuggers (${launchConfigs.length})`,
    kind: vscode.QuickPickItemKind.Separator,
    itemType: 'configuration'
  });

  if (launchConfigs.length === 0) {
    items.push({
      label: 'No launch configurations found',
      description: 'Add configurations in launch.json.',
      alwaysShow: true,
      itemType: 'configuration'
    });
  } else {
    for (const launchConfig of launchConfigs) {
      const name = String(launchConfig.configuration.name ?? 'Unnamed Configuration');
      const type = String(launchConfig.configuration.type ?? 'unknown');
      const request = String(launchConfig.configuration.request ?? 'unknown');
      const key = controller.getLaunchKey(launchConfig);
      const isRunning = getSessionsForLaunchConfig(controller, launchConfig).length > 0;
      const stateDot = isRunning ? '🟢' : '🔴';
      const stateText = isRunning ? 'active' : 'inactive';

      items.push({
        label: `${stateDot} ${launchConfig.folder ? `${launchConfig.folder.name}: ` : ''}${name}`,
        description: `${stateText} | ${type}/${request}`,
        picked: selected.has(key),
        alwaysShow: true,
        buttons: [isRunning ? stopConfigButton : startConfigButton],
        itemType: 'configuration',
        key,
        launchConfig
      });
    }
  }

  return items;
}

async function openDebugHubPopover(controller: DebugHubController): Promise<void> {
  const startAllButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('run-all'),
    tooltip: 'Start all configurations'
  };

  const stopAllButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('watch-expressions-remove-all'),
    tooltip: 'Stop all active debuggers'
  };

  const quickPick = vscode.window.createQuickPick<DebugQuickPickItem>();
  quickPick.title = 'DebugHub';
  quickPick.placeholder = 'Select launch configurations, then press OK to start/stop selected.';
  quickPick.canSelectMany = true;
  quickPick.buttons = [startAllButton, stopAllButton];
  quickPick.matchOnDescription = true;

  const refreshItems = (): void => {
    quickPick.items = buildQuickPickItems(controller);
    quickPick.selectedItems = quickPick.items.filter((item) => item.itemType === 'configuration' && item.picked);
  };

  refreshItems();

  quickPick.onDidChangeSelection((selection) => {
    const keys = selection
      .filter((item) => item.itemType === 'configuration' && item.key)
      .map((item) => item.key as string);
    controller.setSelectedLaunchKeys(keys);
  });

  quickPick.onDidTriggerButton(async (button) => {
    if (button === startAllButton) {
      await controller.startLaunchConfigurations(controller.getLaunchConfigurations());
    }

    if (button === stopAllButton) {
      await controller.stopAllSessions();
    }

    refreshItems();
  });

  quickPick.onDidTriggerItemButton(async (event) => {
    const item = event.item;
    if (item.itemType !== 'configuration' || !item.launchConfig) {
      return;
    }

    const sessions = getSessionsForLaunchConfig(controller, item.launchConfig);
    if (sessions.length > 0) {
      await controller.stopSessions(sessions);
    } else {
      await controller.startLaunchConfigurations([item.launchConfig]);
    }

    refreshItems();
  });

  quickPick.onDidAccept(async () => {
    const selected = controller.getLaunchConfigurations().filter((cfg) => controller.getSelectedLaunchKeys().has(controller.getLaunchKey(cfg)));
    if (selected.length === 0) {
      vscode.window.showInformationMessage('DebugHub: Select at least one configuration first.');
      return;
    }

    const sessionsToStop = selected.flatMap((cfg) => getSessionsForLaunchConfig(controller, cfg));
    if (sessionsToStop.length > 0) {
      const uniqueSessions = [...new Map(sessionsToStop.map((session) => [session.id, session])).values()];
      await controller.stopSessions(uniqueSessions);
    } else {
      await controller.startLaunchConfigurations(selected);
    }

    refreshItems();
  });

  quickPick.onDidHide(() => {
    quickPick.dispose();
  });

  quickPick.show();
}

export function activate(context: vscode.ExtensionContext): void {
  const controller = new DebugHubController();

  if (vscode.debug.activeDebugSession) {
    controller.addSession(vscode.debug.activeDebugSession);
  }

  const openPopoverCommand = vscode.commands.registerCommand('debughub.openPopover', async () => {
    await openDebugHubPopover(controller);
  });

  const startAllCommand = vscode.commands.registerCommand('debughub.startAllDebugConfigurations', async () => {
    await controller.startLaunchConfigurations(controller.getLaunchConfigurations());
  });

  const startSelectedCommand = vscode.commands.registerCommand('debughub.startSelectedDebugConfigurations', async () => {
    const launchConfigs = controller.getLaunchConfigurations();
    const selected = launchConfigs.filter((cfg) => controller.getSelectedLaunchKeys().has(controller.getLaunchKey(cfg)));
    if (selected.length === 0) {
      vscode.window.showInformationMessage('DebugHub: Select at least one configuration first.');
      return;
    }
    await controller.startLaunchConfigurations(selected);
  });

  const stopAllCommand = vscode.commands.registerCommand('debughub.stopAllDebugSessions', async () => {
    await controller.stopAllSessions();
  });

  const startSingleCommand = vscode.commands.registerCommand('debughub.startDebugConfiguration', async (node: LaunchConfig) => {
    if (!node || !node.configuration) {
      return;
    }
    await controller.startLaunchConfigurations([node]);
  });

  const stopSingleCommand = vscode.commands.registerCommand('debughub.stopDebugSession', async (session: vscode.DebugSession) => {
    if (!session) {
      return;
    }
    await controller.stopSessions([session]);
  });

  const refreshCommand = vscode.commands.registerCommand('debughub.refreshSidebar', () => {
    controller.updateStatusBar();
  });

  context.subscriptions.push(
    controller,
    openPopoverCommand,
    startAllCommand,
    startSelectedCommand,
    stopAllCommand,
    startSingleCommand,
    stopSingleCommand,
    refreshCommand,
    vscode.debug.onDidStartDebugSession((session) => controller.addSession(session)),
    vscode.debug.onDidTerminateDebugSession((session) => controller.removeSession(session)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('launch')) {
        controller.updateStatusBar();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => controller.updateStatusBar())
  );
}

export function deactivate(): void {}

export const __testables = {
  buildQuickPickItems,
  isSessionForLaunchConfig
};
