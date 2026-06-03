# Karpathy Stage 3D Evidence - Unknown Font Edit Safety

Date: 2026-06-03

## Finding

- `KF-030`: Editing a text object with an unknown `fontKey` regenerated
  fallback-font geometry while preserving the unknown key in saved project
  data.

## Red Proof

Command:

```powershell
corepack pnpm test src/ui/text/AddTextDialog.test.tsx
```

Result before the fix:

- The font picker rendered `Roboto` for `fontKey: future-font` instead of an
  explicit missing-font state.
- Submitting the edit saved `fontKey: future-font` even though the rendered
  geometry used `DEFAULT_FONT_KEY` (`roboto-regular`).

## Fix

- `FontPicker` now shows `Missing font: <key>` with replacement guidance when
  the current value is not in `FONT_REGISTRY`.
- `AddTextDialog` now normalizes saved `TextObject.fontKey` to the known
  fallback key whenever it regenerates fallback geometry for an unknown key.
- The dialog emits a warning toast naming the missing key and the substituted
  bundled font.

## Green Verification

Commands:

```powershell
corepack pnpm test src/ui/text/AddTextDialog.test.tsx
corepack pnpm test src/ui/text/AddTextDialog.test.tsx src/core/text/text-to-polylines.test.ts src/ui/state/store.test.ts src/ui/state/scene-mutations.test.ts
corepack pnpm run typecheck
corepack pnpm run lint
```

Results:

- Stage 3D unknown-font regression: 1 file passed, 1 test passed.
- Related text/store tests: 4 files passed, 62 tests passed.
- `typecheck`: passed.
- Root `lint`: passed with the existing `boundaries/dependencies` v6 migration
  warning.
