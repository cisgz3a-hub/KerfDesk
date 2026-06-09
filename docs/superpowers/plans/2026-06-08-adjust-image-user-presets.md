# Adjust Image User Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LightBurn-style user-saved Adjust Image presets without changing burn output until the operator clicks OK.

**Architecture:** Keep preset application inside the existing `AdjustImageDialog` draft path. Store small preset records in `localStorage` under a versioned key. Applying a user preset writes the same draft fields that manual controls and built-in presets already write, so preview and OK behavior continue through existing paths.

**Tech Stack:** React 18, TypeScript, Vitest, browser `localStorage`.

---

## Research Basis

- Official LightBurn Adjust Image docs say presets live above Image Settings.
- Selecting a preset automatically applies saved settings and overwrites the current dialog settings.
- LightBurn provides built-in presets and lets operators save their own User Presets.
- LightBurn Save Image Preset asks for a name and can include Layer and Image Settings. Delete is based on the selected preset.
- LightBurn also supports Import/Export Image Presets; LaserForge will defer import/export to a later slice because this step needs the local save/delete workflow first.

Source: <https://docs.lightburnsoftware.com/latest/Reference/AdjustImage/>

## Scope

Ship now:

- Save the current Adjust Image draft as a named user preset.
- Persist user presets locally across dialog reopen.
- Apply a user preset from the Preset dropdown.
- Delete the selected user preset.
- Preserve the safety invariant: no scene/project/output mutation until OK.

Defer:

- Selective include/exclude switches for each setting.
- Import/export preset files.
- User bundles.
- Material-library presets, which are layer recipe presets, not image presets.

## Files

- Modify: `src/ui/raster/AdjustImageDialog.tsx`
- Modify: `src/ui/raster/AdjustImageDialog.presets.tsx`
- Modify: `src/ui/raster/AdjustImageDialog.test.tsx`
- Create: `src/ui/raster/AdjustImageDialog.fields.tsx`
- Create: `src/ui/raster/AdjustImageDialog.form-utils.ts`
- Create: `src/ui/raster/AdjustImageDialog.types.ts`
- Create: `src/ui/raster/AdjustImageDialog.user-presets.ts`
- Create: `src/ui/raster/AdjustImageDialog.user-presets.test.ts`

## Task 1: User Preset Save / Apply / Delete

- [x] **Step 1: Write failing tests**

Add tests to `src/ui/raster/AdjustImageDialog.test.tsx` proving:

- Save stores a named user preset in localStorage and adds it to the dropdown.
- Selecting the user preset restores saved draft settings.
- Delete removes the selected user preset from localStorage and the dropdown.
- `onApply` is not called by save, select, or delete.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx
```

Expected: FAIL because user-preset controls/storage do not exist.

- [x] **Step 3: Add pure preset model/storage**

Add a small preset module with:

- `UserImagePreset`
- `ImagePresetSettings`
- `readUserImagePresets()`
- `writeUserImagePresets()`
- `saveUserImagePreset()`
- `deleteUserImagePreset()`
- `applyUserImagePreset()`

Rules:

- Versioned localStorage key: `lf2:image-presets:v1`.
- Ignore corrupt records instead of throwing.
- Reject empty names.
- Reject names that collide with built-ins: `Custom`, `Basic`, `Black Paint on White`.
- Store only settings, never image data, object IDs, source paths, or G-code.

- [x] **Step 4: Add dialog controls**

Extend the existing Preset row:

- Dropdown includes built-ins plus user presets.
- `Save` button prompts for a preset name and stores the current draft.
- `Delete` button is enabled only for selected user presets.
- Selecting a user preset applies its settings into local draft state.

- [x] **Step 5: Run GREEN**

Run:

```bash
pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx
```

Expected: all `AdjustImageDialog` tests pass.

- [x] **Step 6: Focused verification**

Run:

```bash
pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx src/ui/commands/command-registry.test.ts src/ui/state/store.test.ts src/core/raster/luma-adjust.test.ts src/ui/workspace/draw-raster-preview.test.ts src/core/job/compile-job-raster-adjustments.test.ts src/io/project/project.test.ts
pnpm typecheck
pnpm format:check
pnpm lint
pnpm check:file-size
pnpm test
pnpm build:web
```

Expected: all commands exit 0; lint may keep the existing boundaries warning.

- [x] **Step 7: Audit and commit**

Audit checklist:

- Save/select/delete do not call `onApply`.
- Preset records contain settings only, no image data.
- Built-in names cannot be overwritten.
- Corrupt localStorage records do not crash the dialog.
- User preset application uses the same draft normalization as manual controls.

Commit:

```bash
git add src/ui/raster/AdjustImageDialog.tsx src/ui/raster/AdjustImageDialog.fields.tsx src/ui/raster/AdjustImageDialog.form-utils.ts src/ui/raster/AdjustImageDialog.presets.tsx src/ui/raster/AdjustImageDialog.styles.ts src/ui/raster/AdjustImageDialog.test.tsx src/ui/raster/AdjustImageDialog.types.ts src/ui/raster/AdjustImageDialog.user-presets.ts src/ui/raster/AdjustImageDialog.user-presets.test.ts docs/superpowers/plans/2026-06-08-adjust-image-user-presets.md
git commit -m "feat(raster): persist adjust image user presets"
git push origin wip/checkpoint-2026-06-03
```

Verification completed:

- RED: `pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx` failed before implementation because `button[name="saveImagePreset"]` was missing.
- GREEN: `pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx` passed.
- Storage model: `pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx src/ui/raster/AdjustImageDialog.user-presets.test.ts` passed.
- Focused workflow suite: `pnpm test --run src/ui/raster/AdjustImageDialog.test.tsx src/ui/raster/AdjustImageDialog.user-presets.test.ts src/ui/commands/command-registry.test.ts src/ui/state/store.test.ts src/core/raster/luma-adjust.test.ts src/ui/workspace/draw-raster-preview.test.ts src/core/job/compile-job-raster-adjustments.test.ts src/io/project/project.test.ts` passed.
- Full gates: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:file-size`, `pnpm build:web`, and `pnpm test` passed.
- Full test count after this slice: 149 files, 1089 tests.
- Audit: `git diff --check` passed. Presets store settings only; it does not store image data, source luma, project JSON, or G-code.
