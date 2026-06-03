# Karpathy Stage 3C Evidence - File Action Error Surfaces

Date: 2026-06-03

## Finding

- `KF-029`: File picker/read/save failures could reject out of toolbar and
  shortcut callers, producing generic unhandled-rejection copy instead of
  contextual open/import/save recovery messages.

## Red Proof

Command:

```powershell
corepack pnpm test src/ui/app/file-actions.test.ts
```

Result before the fix:

- Import SVG picker failure rejected with `Error: permission lost`.
- Open project picker failure rejected with `Error: picker failed`.
- Open project file read failure rejected with `Error: read revoked`.
- Save project picker failure rejected with `Error: save picker failed`.
- Save G-code picker failure rejected with `Error: export picker failed`.
- Cancelled open/save pickers stayed silent.

## Fix

- `handleImportSvg()` now catches SVG picker failures and reports
  `Could not import SVG: ...`.
- `handleOpenProject()` now catches picker failures as
  `Could not open project: ...` and file-read failures as
  `Could not open <filename>: ...`.
- `handleSaveProject()` now catches save-picker failures before the write
  phase.
- `handleSaveGcode()` now catches save-picker failures before the write phase.
- Existing user-cancel behavior remains silent.

## Green Verification

Commands:

```powershell
corepack pnpm test src/ui/app/file-actions.test.ts
corepack pnpm test src/ui/app/file-actions.test.ts src/ui/app/import-toasts.test.ts src/ui/app/shortcuts.test.ts
corepack pnpm run typecheck
corepack pnpm run lint
```

Results:

- Stage 3C file-action tests: 1 file passed, 6 tests passed.
- Related app/shortcut tests: 3 files passed, 22 tests passed.
- `typecheck`: passed after fixing the test helper optional-property shape.
- Root `lint`: passed with the existing `boundaries/dependencies` v6 migration
  warning.
