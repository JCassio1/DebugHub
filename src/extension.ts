import * as vscode from 'vscode';

export type LaunchConfig = {
  folder: vscode.WorkspaceFolder | undefined;
  configuration: Record<string, unknown>;
};

type GetLaunchConfigurationsForScope = (folder: vscode.WorkspaceFolder | undefined) => Record<string, unknown>[];
type LaunchConfigGroup = {
  name: string;
  nodes: LaunchConfig[];
};
type LaunchConfigurationInspection = {
  workspaceValue?: Record<string, unknown>[];
  workspaceFolderValue?: Record<string, unknown>[];
};
const STATUS_BAR_OWNER_KEY = '__debughubStatusBarOwner__';

function collectLaunchConfigurations(
  folders: readonly vscode.WorkspaceFolder[] | undefined,
  getLaunchConfigurationsForScope: GetLaunchConfigurationsForScope
): LaunchConfig[] {
  const folderScope: Array<vscode.WorkspaceFolder | undefined> = [undefined, ...(folders ?? [])];
  const nodes: LaunchConfig[] = [];

  for (const folder of folderScope) {
    const configurations = getLaunchConfigurationsForScope(folder);
    for (const configuration of configurations) {
      nodes.push({ folder, configuration });
    }
  }

  return nodes;
}

function getScopedLaunchConfigurationsFromInspection(
  inspected: LaunchConfigurationInspection | undefined,
  folder: vscode.WorkspaceFolder | undefined
): Record<string, unknown>[] {
  if (!inspected) {
    return [];
  }

  if (folder) {
    return inspected.workspaceFolderValue ?? [];
  }

  return inspected.workspaceValue ?? [];
}

function setConfigurationGroup(configuration: Record<string, unknown>, groupName: string | undefined): Record<string, unknown> {
  const updated = { ...configuration };

  if (groupName && groupName.trim().length > 0) {
    const presentation = isRecord(updated.presentation) ? { ...updated.presentation } : {};
    presentation.group = groupName.trim();
    updated.presentation = presentation;
    delete updated.debughubGroup;
    return updated;
  }

  delete updated.debughubGroup;
  if (isRecord(updated.presentation)) {
    const presentation = { ...updated.presentation };
    delete presentation.group;
    if (Object.keys(presentation).length === 0) {
      delete updated.presentation;
    } else {
      updated.presentation = presentation;
    }
  }

  return updated;
}

function migrateLegacyGroupConfiguration(configuration: Record<string, unknown>): Record<string, unknown> {
  const legacyGroup = configuration.debughubGroup;
  if (typeof legacyGroup !== 'string' || legacyGroup.trim().length === 0) {
    return configuration;
  }

  const updated = { ...configuration };
  const presentation = isRecord(updated.presentation) ? { ...updated.presentation } : {};
  if (typeof presentation.group !== 'string' || presentation.group.trim().length === 0) {
    presentation.group = legacyGroup.trim();
  }
  updated.presentation = presentation;
  delete updated.debughubGroup;
  return updated;
}

function getScopedLaunchConfigurations(folder: vscode.WorkspaceFolder | undefined): Record<string, unknown>[] {
  const launchConfig = vscode.workspace.getConfiguration('launch', folder?.uri);
  const inspected = launchConfig.inspect<Record<string, unknown>[]>('configurations');
  return getScopedLaunchConfigurationsFromInspection(inspected, folder);
}

class DebugHubController {
  private readonly selectedLaunchKeys = new Set<string>();
  private readonly activeSessions = new Map<string, vscode.DebugSession>();
  private readonly statusBarItem: vscode.StatusBarItem | undefined;

  constructor(enableStatusBar: boolean) {
    if (enableStatusBar) {
      this.statusBarItem = vscode.window.createStatusBarItem('debughub.status', vscode.StatusBarAlignment.Right, 1000);
      this.statusBarItem.command = 'debughub.openPopover';
      this.statusBarItem.name = 'DebugHub';
      this.statusBarItem.show();
      this.updateStatusBar();
    }
  }

  dispose(): void {
    this.statusBarItem?.dispose();
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
    const nodes = collectLaunchConfigurations(vscode.workspace.workspaceFolders, (folder) => getScopedLaunchConfigurations(folder));

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
    const failures: string[] = [];

    for (const node of nodes) {
      const configurationName = node.configuration.name;
      if (typeof configurationName !== 'string' || configurationName.trim().length === 0) {
        continue;
      }

      try {
        const started = await vscode.debug.startDebugging(node.folder, node.configuration as vscode.DebugConfiguration);
        if (!started) {
          failures.push(`${configurationName} (startDebugging returned false)`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        failures.push(`${configurationName} (${errorMessage})`);
      }
    }

    if (failures.length > 0) {
      const firstFew = failures.slice(0, 5).join(', ');
      const suffix = failures.length > 5 ? ` (+${failures.length - 5} more)` : '';
      vscode.window.showErrorMessage(`DebugHub: Failed to start ${failures.length} configuration(s): ${firstFew}${suffix}`);
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

  async assignGroupToLaunchConfigurations(nodes: LaunchConfig[], groupName: string | undefined): Promise<void> {
    if (nodes.length === 0) {
      return;
    }

    const selectedByScope = new Map<
      string,
      { folder: vscode.WorkspaceFolder | undefined; selectedKeyCount: Map<string, number> }
    >();

    for (const node of nodes) {
      const scopeKey = node.folder?.uri.toString() ?? '__workspace__';
      const scope = selectedByScope.get(scopeKey) ?? { folder: node.folder, selectedKeyCount: new Map<string, number>() };
      const key = this.getLaunchKey(node);
      scope.selectedKeyCount.set(key, (scope.selectedKeyCount.get(key) ?? 0) + 1);
      selectedByScope.set(scopeKey, scope);
    }

    for (const scope of selectedByScope.values()) {
      const launchConfig = vscode.workspace.getConfiguration('launch', scope.folder?.uri);
      const configurations = getScopedLaunchConfigurations(scope.folder);
      const remaining = new Map(scope.selectedKeyCount);
      const updatedConfigurations = configurations.map((configuration) => {
        const key = this.getLaunchKey({ folder: scope.folder, configuration });
        const count = remaining.get(key) ?? 0;
        if (count <= 0) {
          return configuration;
        }

        remaining.set(key, count - 1);
        return setConfigurationGroup(configuration, groupName);
      });

      await launchConfig.update(
        'configurations',
        updatedConfigurations,
        scope.folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace
      );
    }
  }

  async migrateLegacyGroupMetadata(): Promise<void> {
    const scopes: Array<vscode.WorkspaceFolder | undefined> = [undefined, ...(vscode.workspace.workspaceFolders ?? [])];

    for (const folder of scopes) {
      const launchConfig = vscode.workspace.getConfiguration('launch', folder?.uri);
      const configurations = getScopedLaunchConfigurations(folder);
      let changed = false;

      const migrated = configurations.map((configuration) => {
        const migratedConfiguration = migrateLegacyGroupConfiguration(configuration);
        if (migratedConfiguration === configuration) {
          return configuration;
        }

        changed = true;
        return migratedConfiguration;
      });

      if (!changed) {
        continue;
      }

      await launchConfig.update(
        'configurations',
        migrated,
        folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace
      );
    }
  }

  updateStatusBar(): void {
    if (!this.statusBarItem) {
      return;
    }

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
  itemType: 'session' | 'configuration' | 'group';
  key?: string;
  launchConfig?: LaunchConfig;
  groupName?: string;
};

type QuickPickControllerState = Pick<
  DebugHubController,
  'getLaunchConfigurations' | 'getSelectedLaunchKeys' | 'getLaunchKey' | 'getActiveSessions'
>;

function getConfigurationName(launchConfig: LaunchConfig): string {
  return String(launchConfig.configuration.name ?? '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getLaunchGroupName(launchConfig: LaunchConfig): string {
  const debugHubGroup = launchConfig.configuration.debughubGroup;
  if (typeof debugHubGroup === 'string' && debugHubGroup.trim().length > 0) {
    return debugHubGroup.trim();
  }

  const directGroup = launchConfig.configuration.group;
  if (typeof directGroup === 'string' && directGroup.trim().length > 0) {
    return directGroup.trim();
  }

  const presentation = isRecord(launchConfig.configuration.presentation) ? launchConfig.configuration.presentation : undefined;
  const presentationGroup = presentation?.group;
  if (typeof presentationGroup === 'string' && presentationGroup.trim().length > 0) {
    return presentationGroup.trim();
  }

  return 'Ungrouped';
}

function groupLaunchConfigurations(launchConfigs: LaunchConfig[]): LaunchConfigGroup[] {
  const grouped = new Map<string, LaunchConfig[]>();
  for (const launchConfig of launchConfigs) {
    const groupName = getLaunchGroupName(launchConfig);
    const nodes = grouped.get(groupName) ?? [];
    nodes.push(launchConfig);
    grouped.set(groupName, nodes);
  }

  return [...grouped.entries()].map(([name, nodes]) => ({ name, nodes }));
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

function getSessionsForLaunchConfigs(controller: QuickPickControllerState, launchConfigs: LaunchConfig[]): vscode.DebugSession[] {
  const sessions = launchConfigs.flatMap((launchConfig) => getSessionsForLaunchConfig(controller, launchConfig));
  return [...new Map(sessions.map((session) => [session.id, session])).values()];
}

function buildQuickPickItems(controller: QuickPickControllerState): DebugQuickPickItem[] {
  const items: DebugQuickPickItem[] = [];
  const launchConfigs = controller.getLaunchConfigurations();
  const groups = groupLaunchConfigurations(launchConfigs);
  const selected = controller.getSelectedLaunchKeys();
  const startConfigButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('play'),
    tooltip: 'Start this configuration'
  };
  const stopConfigButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('primitive-square'),
    tooltip: 'Stop this configuration'
  };
  const startGroupButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('play'),
    tooltip: 'Start this group'
  };
  const stopGroupButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('primitive-square'),
    tooltip: 'Stop this group'
  };

  items.push({
    label: `Debuggers (${launchConfigs.length})`,
    kind: vscode.QuickPickItemKind.Separator,
    itemType: 'configuration'
  });
  items.push({
    label: 'Toolbar: Start All | Stop All | Create Group',
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
    for (const group of groups) {
      const groupSessions = getSessionsForLaunchConfigs(controller, group.nodes);
      const runningCount = groupSessions.length;
      const isGroupRunning = runningCount > 0;

      items.push({
        label: `${isGroupRunning ? '🟢' : '🔴'} Group: ${group.name}`,
        description: `${runningCount}/${group.nodes.length} active`,
        alwaysShow: true,
        buttons: [isGroupRunning ? stopGroupButton : startGroupButton],
        itemType: 'group',
        groupName: group.name
      });

      for (const launchConfig of group.nodes) {
        const name = String(launchConfig.configuration.name ?? 'Unnamed Configuration');
        const type = String(launchConfig.configuration.type ?? 'unknown');
        const request = String(launchConfig.configuration.request ?? 'unknown');
        const key = controller.getLaunchKey(launchConfig);
        const isRunning = getSessionsForLaunchConfig(controller, launchConfig).length > 0;
        const stateDot = isRunning ? '🟢' : '🔴';
        const stateText = isRunning ? 'active' : 'inactive';

        items.push({
          label: `  ${stateDot} ${launchConfig.folder ? `${launchConfig.folder.name}: ` : ''}${name}`,
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
  }

  return items;
}

type GroupChoiceItem = vscode.QuickPickItem & {
  choiceType: 'existing' | 'new' | 'remove';
  groupName?: string;
};

async function promptForGroupName(launchConfigs: LaunchConfig[]): Promise<string | null | undefined> {
  const existingGroups = [...new Set(launchConfigs.map((config) => getLaunchGroupName(config)))]
    .filter((groupName) => groupName !== 'Ungrouped')
    .sort((a, b) => a.localeCompare(b));

  const items: GroupChoiceItem[] = [
    {
      label: '$(add) Create New Group',
      description: 'Enter a new group name',
      choiceType: 'new'
    },
    ...existingGroups.map((groupName) => ({
      label: groupName,
      description: 'Use existing group',
      choiceType: 'existing' as const,
      groupName
    })),
    {
      label: '$(trash) Remove Group',
      description: 'Move selected configurations to Ungrouped',
      choiceType: 'remove'
    }
  ];

  const choice = await vscode.window.showQuickPick(items, {
    title: 'DebugHub: Assign Group',
    placeHolder: 'Choose a target group',
    ignoreFocusOut: true
  });
  if (!choice) {
    return undefined;
  }

  if (choice.choiceType === 'remove') {
    return null;
  }

  if (choice.choiceType === 'existing') {
    return choice.groupName ?? null;
  }

  const groupName = await vscode.window.showInputBox({
    title: 'DebugHub: Create Group',
    prompt: 'Group name',
    placeHolder: 'Backend Services',
    validateInput: (value) => {
      if (value.trim().length === 0) {
        return 'Group name cannot be empty.';
      }
      return undefined;
    },
    ignoreFocusOut: true
  });

  if (groupName === undefined) {
    return undefined;
  }

  return groupName.trim();
}

async function assignGroupToConfigurations(controller: DebugHubController, nodes: LaunchConfig[]): Promise<boolean> {
  if (nodes.length === 0) {
    vscode.window.showInformationMessage('DebugHub: Select at least one configuration first.');
    return false;
  }

  const groupName = await promptForGroupName(controller.getLaunchConfigurations());
  if (groupName === undefined) {
    return false;
  }

  await controller.assignGroupToLaunchConfigurations(nodes, groupName ?? undefined);
  const actionText = groupName === null ? 'removed group from' : `assigned "${groupName}" to`;
  vscode.window.showInformationMessage(`DebugHub: ${actionText} ${nodes.length} configuration(s).`);
  return true;
}

async function pickLaunchConfigurations(controller: DebugHubController): Promise<LaunchConfig[] | undefined> {
  const launchConfigs = controller.getLaunchConfigurations();
  if (launchConfigs.length === 0) {
    vscode.window.showInformationMessage('DebugHub: No launch configurations available.');
    return undefined;
  }

  const items = launchConfigs.map((launchConfig) => {
    const name = String(launchConfig.configuration.name ?? 'Unnamed Configuration');
    const type = String(launchConfig.configuration.type ?? 'unknown');
    const request = String(launchConfig.configuration.request ?? 'unknown');
    return {
      label: `${launchConfig.folder ? `${launchConfig.folder.name}: ` : ''}${name}`,
      description: `${type}/${request}`,
      detail: `Group: ${getLaunchGroupName(launchConfig)}`,
      launchConfig
    };
  });

  const selectedItems = await vscode.window.showQuickPick(items, {
    title: 'DebugHub: Choose Configurations',
    placeHolder: 'Select one or more configurations',
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true
  });

  if (!selectedItems || selectedItems.length === 0) {
    return undefined;
  }

  return selectedItems.map((item) => item.launchConfig);
}

async function selectLaunchGroup(
  controller: QuickPickControllerState,
  mode: 'start' | 'stop'
): Promise<LaunchConfigGroup | undefined> {
  const groups = groupLaunchConfigurations(controller.getLaunchConfigurations());
  if (groups.length === 0) {
    vscode.window.showInformationMessage('DebugHub: No launch configurations available.');
    return undefined;
  }

  const items = groups.map((group) => {
    const runningCount = getSessionsForLaunchConfigs(controller, group.nodes).length;
    const status = `${runningCount}/${group.nodes.length} active`;
    return {
      label: group.name,
      description: status,
      detail: group.nodes.map((node) => getConfigurationName(node)).join(', '),
      group
    };
  });

  const target = await vscode.window.showQuickPick(items, {
    title: mode === 'start' ? 'DebugHub: Start Group' : 'DebugHub: Stop Group',
    placeHolder: mode === 'start' ? 'Choose a group to start' : 'Choose a group to stop',
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true
  });

  return target?.group;
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
  const manageGroupsButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('new-folder'),
    tooltip: 'Create or assign group for selected configurations'
  };

  const quickPick = vscode.window.createQuickPick<DebugQuickPickItem>();
  quickPick.title = 'DebugHub';
  quickPick.placeholder = 'Select configurations. Use toolbar buttons for Start All, Stop All, or Create Group.';
  quickPick.canSelectMany = true;
  quickPick.buttons = [startAllButton, stopAllButton, manageGroupsButton];
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

    if (button === manageGroupsButton) {
      const selected = controller.getLaunchConfigurations().filter((cfg) => controller.getSelectedLaunchKeys().has(controller.getLaunchKey(cfg)));
      if (selected.length > 0) {
        await assignGroupToConfigurations(controller, selected);
      } else {
        const picked = await pickLaunchConfigurations(controller);
        if (picked) {
          await assignGroupToConfigurations(controller, picked);
        }
      }
    }

    refreshItems();
  });

  quickPick.onDidTriggerItemButton(async (event) => {
    const item = event.item;
    if (item.itemType === 'group' && item.groupName) {
      const groupConfigs = controller.getLaunchConfigurations().filter((launchConfig) => getLaunchGroupName(launchConfig) === item.groupName);
      const groupSessions = getSessionsForLaunchConfigs(controller, groupConfigs);
      if (groupSessions.length > 0) {
        await controller.stopSessions(groupSessions);
      } else {
        await controller.startLaunchConfigurations(groupConfigs);
      }

      refreshItems();
      return;
    }

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

let activeController: DebugHubController | undefined;
let activeControllerOwnsStatusBar = false;
let activeStatusBarOwnerId: string | undefined;

function claimStatusBarOwnership(ownerId: string): boolean {
  const globalStore = globalThis as unknown as Record<string, unknown>;
  const existingOwner = globalStore[STATUS_BAR_OWNER_KEY];
  if (typeof existingOwner === 'string' && existingOwner !== ownerId) {
    return false;
  }

  globalStore[STATUS_BAR_OWNER_KEY] = ownerId;
  return true;
}

function releaseStatusBarOwnership(ownerId: string | undefined): void {
  if (!ownerId) {
    return;
  }

  const globalStore = globalThis as unknown as Record<string, unknown>;
  if (globalStore[STATUS_BAR_OWNER_KEY] === ownerId) {
    delete globalStore[STATUS_BAR_OWNER_KEY];
  }
}

function registerCommandSafely(
  context: vscode.ExtensionContext,
  commandId: string,
  callback: (...args: never[]) => unknown
): void {
  try {
    context.subscriptions.push(vscode.commands.registerCommand(commandId, callback));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(`command '${commandId}' already exists`) || message.includes('already exists')) {
      console.warn(`[DebugHub] Command "${commandId}" already exists. Skipping duplicate registration.`);
      return;
    }
    throw error;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // Defensive guard against duplicate status bar items if activation happens more than once.
  activeController?.dispose();
  if (activeControllerOwnsStatusBar) {
    releaseStatusBarOwnership(activeStatusBarOwnerId);
    activeControllerOwnsStatusBar = false;
    activeStatusBarOwnerId = undefined;
  }

  const ownerId = context.extension.id || 'debughub';
  const ownsStatusBar = claimStatusBarOwnership(ownerId);
  const controller = new DebugHubController(ownsStatusBar);
  if (!ownsStatusBar) {
    console.warn('[DebugHub] Another DebugHub instance already owns the status bar trigger. Skipping duplicate status bar item.');
  }

  activeController = controller;
  activeControllerOwnsStatusBar = ownsStatusBar;
  activeStatusBarOwnerId = ownsStatusBar ? ownerId : undefined;
  void controller.migrateLegacyGroupMetadata().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[DebugHub] Failed to migrate legacy group metadata: ${message}`);
  });

  if (vscode.debug.activeDebugSession) {
    controller.addSession(vscode.debug.activeDebugSession);
  }

  registerCommandSafely(context, 'debughub.openPopover', async () => {
    await openDebugHubPopover(controller);
  });

  registerCommandSafely(context, 'debughub.startAllDebugConfigurations', async () => {
    await controller.startLaunchConfigurations(controller.getLaunchConfigurations());
  });

  registerCommandSafely(context, 'debughub.startSelectedDebugConfigurations', async () => {
    const launchConfigs = controller.getLaunchConfigurations();
    const selected = launchConfigs.filter((cfg) => controller.getSelectedLaunchKeys().has(controller.getLaunchKey(cfg)));
    if (selected.length === 0) {
      vscode.window.showInformationMessage('DebugHub: Select at least one configuration first.');
      return;
    }
    await controller.startLaunchConfigurations(selected);
  });

  registerCommandSafely(context, 'debughub.stopAllDebugSessions', async () => {
    await controller.stopAllSessions();
  });

  registerCommandSafely(context, 'debughub.startDebugGroup', async () => {
    const group = await selectLaunchGroup(controller, 'start');
    if (!group) {
      return;
    }

    const nodesToStart = group.nodes.filter((node) => getSessionsForLaunchConfig(controller, node).length === 0);
    if (nodesToStart.length === 0) {
      vscode.window.showInformationMessage(`DebugHub: All configurations in "${group.name}" are already running.`);
      return;
    }

    await controller.startLaunchConfigurations(nodesToStart);
  });

  registerCommandSafely(context, 'debughub.stopDebugGroup', async () => {
    const group = await selectLaunchGroup(controller, 'stop');
    if (!group) {
      return;
    }

    const sessionsToStop = getSessionsForLaunchConfigs(controller, group.nodes);
    if (sessionsToStop.length === 0) {
      vscode.window.showInformationMessage(`DebugHub: No active sessions in "${group.name}".`);
      return;
    }

    await controller.stopSessions(sessionsToStop);
  });

  registerCommandSafely(context, 'debughub.assignDebugGroup', async () => {
    const selected = await pickLaunchConfigurations(controller);
    if (!selected) {
      return;
    }

    await assignGroupToConfigurations(controller, selected);
  });

  registerCommandSafely(context, 'debughub.startDebugConfiguration', async (node: LaunchConfig) => {
    if (!node || !node.configuration) {
      return;
    }
    await controller.startLaunchConfigurations([node]);
  });

  registerCommandSafely(context, 'debughub.stopDebugSession', async (session: vscode.DebugSession) => {
    if (!session) {
      return;
    }
    await controller.stopSessions([session]);
  });

  registerCommandSafely(context, 'debughub.refreshSidebar', () => {
    controller.updateStatusBar();
  });

  context.subscriptions.push(
    controller,
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

export function deactivate(): void {
  activeController?.dispose();
  activeController = undefined;
  if (activeControllerOwnsStatusBar) {
    releaseStatusBarOwnership(activeStatusBarOwnerId);
    activeControllerOwnsStatusBar = false;
    activeStatusBarOwnerId = undefined;
  }
}

export const __testables = {
  collectLaunchConfigurations,
  getScopedLaunchConfigurationsFromInspection,
  setConfigurationGroup,
  migrateLegacyGroupConfiguration,
  buildQuickPickItems,
  isSessionForLaunchConfig,
  getLaunchGroupName,
  groupLaunchConfigurations
};
