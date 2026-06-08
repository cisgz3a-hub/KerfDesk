# Layer Row Double Click Settings Plan

## Research

- LightBurn opens Cut Settings by double-clicking a Cuts / Layers entry.
- LaserForge already has a `CutSettingsDialog` and an explicit `Edit...`
  button, but the row/card itself does not open the editor on double-click.

Source:
- https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/

## Current Code Audit

- `LayerRow` owns the `settingsOpen` state and renders `CutSettingsDialog`.
- `LayerRow` currently opens the dialog only through the `Edit...` button.
- The row also contains interactive controls: order buttons, mode select,
  select/assign/copy/paste/delete buttons, and visibility/output checkboxes.

## Implementation Scope

1. Add a double-click handler to the layer card.
2. Open the existing `CutSettingsDialog` when double-clicking non-interactive
   row/card space.
3. Ignore double-clicks whose target is inside an interactive element.

## Deliberate Deferrals

- Replacing the inline editor with a full tabbed LightBurn-style editor.
- Layer context menus.
- Material Library entry double-click behavior.

## TDD

1. UI: double-clicking a layer card opens Cut Settings.
2. UI: double-clicking an interactive control inside the card does not open Cut
   Settings.

## Verification

```powershell
pnpm test --run src/ui/layers/CutsLayersPanel.test.tsx
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- The explicit `Edit...` button must continue working.
- Double-click must not hijack buttons, inputs, selects, or checkboxes.
