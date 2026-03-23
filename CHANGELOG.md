# Change Log

All notable changes to the "debughub" extension will be documented in this file.

## Version 1.1.0

- Added reliable workspace support by reading launch configurations with correct scope resolution (`workspace` and `workspaceFolder` values only)
- Fixed grouped launch start behavior by launching with full debug configuration objects instead of name-only lookups
- Users can now group debuggers and control each group independently
- Added visible popover toolbar hint for `Start All | Stop All | Create Group`
- Improved create-group flow so users can select configurations when none are preselected
- Added status bar ownership guard to avoid duplicate DebugHub footer triggers in mixed extension-host scenarios
- Expanded unit test coverage for scoped configuration reads, group metadata updates/migration, and grouped quick-pick behavior

## Version 1.0.1

- Correct readme url links

## Version 1.0.0

- Added DebugHub status bar indicator with active debugger count and quick access command
- Added quick pick panel for debug configurations with individual start/stop buttons
- Added start all / stop all debugger buttons in the popover
- Added commands: `debughub.startAllDebugConfigurations`, `debughub.startSelectedDebugConfigurations`, `debughub.stopAllDebugSessions`, `debughub.startDebugConfiguration`, `debughub.stopDebugSession`, `debughub.refreshSidebar`
- Added workspace folder-aware launch configuration discovery and auto-pruning of stale selections
- Added active debug session tracking and seamless sync between running sessions and UI
