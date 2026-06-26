# Material Library redesign — handoff & status (ADR-093)

> Detailed handoff so this can be continued on another machine. Branch:
> **`claude/agitated-ride-e61356`** (pushed to `origin`). Not merged to `main`.
> Date: 2026-06-26.

## TL;DR

The Material Library was confusing (backwards "Create from Layer" flow, jargon
Load/Save/Unload, no way to browse libraries). It has been redesigned to be
**easy and step-by-step**:

- **Create/edit via a guided wizard** — type material + thickness, then power /
  speed / passes / mode details directly. No more "edit a layer then snapshot it".
- **Saved Libraries page** — browse, open, rename, duplicate, delete, export, import.
- **Auto-saved, in-app, multi-library** storage (no Load/Save/Unload). The old
  single-library slot is migrated automatically.
- **Reworded rail** — "Apply to layer" (was "Assign"); layer dropdown shows
  "Layer N (color)" + a swatch instead of raw hex.

All 5 implementation phases are **done**. `pnpm test` (2311 pass / 1 skip),
`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:file-size` all
pass. **Hardware verification is still pending** (standing project gap).

## Continue on another device

```bash
git fetch origin
git checkout claude/agitated-ride-e61356
pnpm install
pnpm test && pnpm typecheck && pnpm lint   # all green
pnpm dev:web                               # then exercise the Cuts/Layers → Material Library panel
```

Note: this branch was cut from `d6ff780` and `origin/main` has since moved ahead
(~5 commits of unrelated work). Rebase/merge `main` before opening the final PR.

## What was built, by phase

- **Phase 0 — docs/governance:** `DECISIONS.md` ADR-093; `PROJECT.md` scope
  update; `WORKFLOW.md` F-ML2 (wizard) + F-ML3 (Saved Libraries) and an F-ML1
  superseded note.
- **Phase 1 — persistence:** in-app multi-library collection + one-time
  migration of the legacy slot + management actions.
- **Phase 2 — wizard:** the guided create/edit dialog.
- **Phase 3 — Saved Libraries page:** browse/open/rename/duplicate/delete/
  export/import.
- **Phase 4 — rail rewording:** Apply to layer; layer name + swatch; removed
  Load/Save/Unload (auto-save + Saved Libraries replace them).
- **Phase 5 — cleanup:** removed the legacy "Create from Layer" form, the
  "Update from layer" button, and the calibration-from-test-swatch create path
  (maintainer decision — see "Removed on purpose" below).

## Architecture / key files

**Reused unchanged (source of truth for output):**

- `src/core/material-library/` — `MaterialRecipe`, capture/apply/normalize,
  device-match ranking.
- `src/io/material-library/` — `.lfml.json` document + deterministic serialize/
  deserialize + device hint.

**State (new / changed):**

- `src/ui/state/material-library-collection.ts` — **pure** collection model:
  `{ activeLibraryId, libraries: { [id]: { payload, updatedAt } } }`, transforms
  (`setLibraryPayload`/`setActiveLibrary`/`removeLibrary`/`reconcileActiveDocument`),
  `summarizeLibraries`, and the envelope codec. (+ test)
- `src/ui/state/saved-libraries-actions.ts` — store slice: `createLibrary`,
  `openSavedLibrary`, `renameLibrary`, `duplicateLibrary`, `deleteLibrary`,
  `listSavedLibraries`. (+ test)
- `src/ui/state/material-preset-actions.ts` — `upsertMaterialPreset` (add/replace
  a preset; used by the wizard). (+ test)
- `src/ui/state/material-library-actions.ts` — slimmed to `setMaterialLibrary`,
  `markMaterialLibrarySaved`, `assignMaterialPresetToLayer` (Apply), and
  `deleteMaterialPreset`.
- `src/ui/state/material-library-persistence.ts` — added `persistCollection`,
  `restoreCollection`, `migrateLegacyLibrary`. (+ tests)
- `src/ui/app/use-material-library-persistence.ts` — restore/migrate on mount,
  auto-save on change via the pure `reconcileActiveDocument`.
- `src/ui/state/store.ts`, `src/ui/state/test-helpers.ts` — wired the new slices
  + `savedLibraries` state (preserved across New/Open project).

**UI (new):** `src/ui/material-library/`

- `SavedLibrariesDialog.tsx`, `SavedLibraryRow.tsx`, `SavedLibrariesButton.tsx`.
- `wizard/` — `MaterialPresetWizard.tsx` (orchestrator, draft-commit), step
  views (`WizardIdentityStep`, `WizardCutSettingsStep`, `WizardDetailsStep`,
  `WizardReviewStep`), `MaterialPresetWizardLauncher.tsx`, the pure
  `wizard-state.ts` (tagged-union step reducer + `assertNever`), and
  `wizard-recipe.ts` (recipe<->layer bridge + preset builder).

**UI (reworded):** `src/ui/layers/MaterialLibraryPanel.tsx`,
`MaterialLibraryRecipeControls.tsx`, `material-library-panel-styles.ts`.

**Data-flow notes:**

- The active library is the live `materialLibrary` doc; the collection holds all
  libraries (active included) as serialized payloads. The persistence hook folds
  the live doc back into the collection (`reconcileActiveDocument`) on every
  change and auto-saves to `localStorage` key `laserforge.material-libraries.v1`.
  The legacy key `laserforge.material-library.v1` is migrated in once then removed.
- The wizard's settings/details steps are uncontrolled and read via the existing
  layer `readCutSettingsPatch` over a throwaway layer, so a preset is edited with
  the exact same controls (and clamping) as a layer.

## Verified vs NOT verified

**Verified:** full unit/component suite, typecheck, lint, Prettier, file-size.
Browser (via DOM `eval`, reliable): empty + loaded panel rewording; wizard step 1
renders; Saved Libraries empty state, New library persists, row + all actions
render; reconcile has no render loops; no console errors.

**NOT verified (do these next):**

- **Hardware** — no burn confirms the applied settings. Standing project gap.
- **The full in-browser wizard walk + Save** — the preview tool's `preview_fill`
  can't drive React-controlled inputs; the full create flow is covered by the
  component test (`MaterialPresetWizard.test.tsx`, `Simulate.change`) instead.
- **Layer dropdown "Layer N (color)" + swatch** with real layers in the scene
  (needs a design imported). Trivial render, but eyeball it.
- **Export/Import via the real native file picker** (covered by unit tests using a
  mock platform; the SavedLibrariesDialog wires the existing tested file actions).
- The preview's screenshots render at a tiny fixed scale — do a human visual /
  layout pass on the wizard dialog and Saved Libraries page.

## Removed on purpose (Phase 5, maintainer decision)

The legacy "Create from Layer" form, "Update from layer" button, and the
**calibration-from-test-swatch** create path were removed; the wizard is the sole
authoring path. The Material/Interval Test **generators** and the recipe/IO model
are untouched — turning a selected test swatch into a calibrated preset can be
reintroduced through the wizard later if wanted. (See ADR-093 consequences.)

## Follow-ups / TODO

1. **Hardware verification** — create a preset, Apply to a layer, Save G-code /
   Start, confirm feed/power/interval on the machine.
2. Eyeball the wizard dialog + Saved Libraries page visually with real layers and
   multiple libraries.
3. (Optional) rebuild the calibration-from-swatch path as a wizard entry.
4. (Optional, future polish) per-row Apply/Edit in the rail instead of the
   layer+preset dropdowns.
5. Rebase/merge `origin/main`, then open the PR to `main`.
6. **Do not commit** the eol-only churn on
   `src/io/**/__snapshots__/*.snap` (CRLF/LF autocrlf noise; `git diff` shows no
   content change).

## Tests to look at

`material-library-collection.test.ts`, `saved-libraries-actions.test.ts`,
`material-preset-actions.test.ts`, `wizard/wizard-state.test.ts`,
`wizard/MaterialPresetWizard.test.tsx`, `SavedLibrariesDialog.test.tsx`,
`material-library-persistence.test.ts` (extended), and the reworked
`MaterialLibraryPanel*.test.tsx` / `material-library-actions.test.ts`.

## Original plan

Local only (not in repo): `~/.claude/plans/i-am-not-sure-encapsulated-rainbow.md`.
This handoff supersedes it for status.
