![DebugHub Banner](https://raw.githubusercontent.com/JCassio1/DebugHub/main/media/debughub-banner.png)

Manage all your VS Code debug configurations in one place.

## The Problem

Working with monorepos and multi-service applications in VS Code is painful:

- VS Code's debugger is slow to initialize
- You have to start each debugger individually
- Managing multiple debug sessions is tedious
- No easy way to see which debuggers are running

## The Solution

DebugHub gives you a simple way to manage all your debug configurations:

- See all debuggers in one list
- Quick status indicators (green = running 🟢, red = stopped 🔴)
- Start or stop individual debuggers with button clicks
- Group debuggers (for example backend/frontend) and control each group independently
- Start or stop all debuggers at once
- Select multiple configurations to manage them together
- Works with single and multi-root workspaces

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for DebugHub
4. Click Install

### From Source

1. Clone the repository:

   ```bash
   git clone https://github.com/JCassio1/DebugHub.git
   cd debughub
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Package the extension:

   ```bash
   npm run package
   ```

4. Install the .vsix file in VS Code:
   - Go to Extensions > Views and More Actions (three dots) > Install from VSIX
   - Select the generated debughub-\*.vsix file

---

## Quick Start

### Open DebugHub

1. Click the DebugHub status indicator in the bottom right (shows the count of active debuggers)
2. Or press Cmd+Shift+P / Ctrl+Shift+P and run "DebugHub: Open Popover"

### Manage Debuggers

**View configurations:**

- All launch configurations from `.vscode/launch.json` are listed
- Green indicator means running, red means stopped

**Start a debugger:**

- Click the play button next to any configuration
- Or select multiple and click Start All

**Stop a debugger:**

- Click the stop button next to any running configuration
- Or click Stop All for everything

**Batch operations:**

- Use checkboxes to select multiple configurations
- Press OK to start or stop them all

---

## Features

**Status Bar Integration**

- Real-time count of active debug sessions
- Click to open DebugHub instantly
- Color-coded status indicator

**Quick Configuration Browser**

- All workspace launch configurations in one list
- Grouped by folder in multi-root setups
- Shows configuration type and request mode

**Inline Actions**

- Play button to start individual debuggers
- Stop button to stop running debuggers
- Group row actions to start/stop entire groups
- Checkboxes for multi-select

**Top-level Controls**

- Start All button for launching all configurations
- Stop All button to terminate all sessions

**Smart Selection**

- Remembers your configuration selections
- Removes invalid selections when configs change

---

## Commands

| Command                                     | Description                    |
| ------------------------------------------- | ------------------------------ |
| `debughub.openPopover`                      | Open DebugHub                  |
| `debughub.startAllDebugConfigurations`      | Start all configurations       |
| `debughub.startSelectedDebugConfigurations` | Start selected configurations  |
| `debughub.startDebugGroup`                  | Start a selected group         |
| `debughub.stopDebugGroup`                   | Stop a selected group          |
| `debughub.assignDebugGroup`                 | Create/assign/remove a group   |
| `debughub.stopAllDebugSessions`             | Stop all sessions              |
| `debughub.startDebugConfiguration`          | Start a specific configuration |
| `debughub.stopDebugSession`                 | Stop a specific session        |
| `debughub.refreshSidebar`                   | Refresh the status bar         |

---

## Configuration

DebugHub reads launch configurations from `.vscode/launch.json` in your workspace folders.

### Supported Debuggers

Works with any VS Code debugger:

- Node.js (node, pwa-node)
- Chrome (pwa-chrome)
- Python (debugpy)
- Go
- C/C++ (cppdbg)
- And more

### Grouping Debuggers

You can group debug configurations so each group can be started or stopped independently.

Create groups in either way:

1. Open DebugHub popover.
2. Select one or more configurations.
3. Click `$(new-folder) Manage Groups...` inside the list (or use the top `new-folder` action button).
4. Choose an existing group, create a new one, or remove group assignment.

Or run the command palette action: `DebugHub: Assign Debug Group`.

DebugHub reads group names in this order:

1. `debughubGroup`
2. `group`
3. `presentation.group`

If none is set, the configuration is shown in the `Ungrouped` group.

### Example launch.json

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Backend API",
      "group": "Backend Services",
      "type": "pwa-node",
      "request": "launch",
      "program": "${workspaceFolder}/server/app.js",
      "console": "integratedTerminal"
    },
    {
      "name": "Backend Worker",
      "debughubGroup": "Backend Services",
      "type": "pwa-node",
      "request": "launch",
      "program": "${workspaceFolder}/server/worker.js",
      "console": "integratedTerminal"
    },
    {
      "name": "Frontend Dev",
      "presentation": { "group": "Frontend Services" },
      "type": "pwa-chrome",
      "request": "launch",
      "url": "http://localhost:3000",
      "webRoot": "${workspaceFolder}/client"
    }
  ]
}
```

---

## Development

**Requirements**

- Node.js 18+
- npm 9+
- VS Code 1.85+

**Build**

```bash
npm install
npm run compile
```

**Watch Mode**

```bash
npm run watch
```

**Test**

```bash
npm test
```

**Package**

```bash
npm run package
```

---

## Contributing

Want to help? Here's how:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests: `npm test`
5. Commit: `git commit -am 'Add feature'`
6. Push: `git push origin feature/your-feature`
7. Open a pull request

See CHANGELOG.md for version history.

---

## License

This extension is licensed under the MIT License. See license.txt for details.

---

## Tips

- Use arrow keys to navigate configurations, Space to select, Enter to confirm
- Type to search configuration names
- In multi-root workspaces, selections apply to all folders
- If using debugpy, make sure your script calls `debugpy.listen()` first

---

## FAQ

**Q: Why doesn't my configuration show up?**
A: Make sure it's in `.vscode/launch.json` and has a `name` property.

**Q: Can I exclude certain configurations?**
A: Not yet. You can remove unused ones from `launch.json` or just ignore them in the UI.

**Q: Does DebugHub support remote debugging?**
A: Yes, any debugger VS Code supports will work, including remote attach configurations.
