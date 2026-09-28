# ZCode attribution

Source: https://github.com/zai-org/ZCode
Revision: 29628c9acdb81b703bbd4080c207a0e7ce5e276e
License: Apache License 2.0 (included in LICENSE).
Upstream notice is preserved in UPSTREAM-NOTICE.md.

WinAgent reuses `packages/ui/src/app-shell/sidePaneLayout.ts` as
`src/renderer/src/components/workbench/sidePaneLayout.ts` without functional changes.
`useResizablePane.ts` adapts the sidebar width persistence, pointer capture,
CSS-variable resize and keyboard resizing logic from `WorkspaceShellLayout.tsx`.
The extracted hook uses WinAgent props, styles and bounds and adds cancellation reset.

The navigation, plugin page and Wiki integration are WinAgent implementations inspired
by ZCode's workspace arrangement. ZCode's branding, accounts, hosted marketplace,
remote services and agent runtime are not included.
