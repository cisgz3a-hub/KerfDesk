# Karpathy Laser Bug-Hunt Audit

Date: 2026-06-15
Repo: `C:\Users\Asus\LaserForge-2.0`
Branch: `main`
Mode: read-only audit
Prompt: `audit/prompts/karpathy-laser-bug-hunt-audit-2026-06-15.md`
Findings JSON: `audit/findings/karpathy-laser-bug-hunt-findings-2026-06-15.json`

## Scope

This pass focused on bugs, not feature gaps. I used the repo docs as the local product contract and LightBurn official docs as the benchmark for laser-CAM workflow behavior.

Important current-tree note: the repo already had uncommitted Align/Distribute selection work before this audit. I did not edit production files. The only new files from this audit are under `audit/`.

## Baseline

- `git rev-parse --show-toplevel`: `C:/Users/Asus/LaserForge-2.0`
- `corepack pnpm typecheck`: passed
- `corepack pnpm lint`: passed, with the existing `boundaries` legacy selector warning only
- `corepack pnpm format:check`: passed
- `corepack pnpm test`: passed, 220 test files and 1551 tests

Green tests do not disprove the findings below. The bugs are mostly workflow-path mismatches where single-object handlers are still wired under multi-selection UI promises.

## External References

- LightBurn Flip/Mirror docs: <https://docs.lightburnsoftware.com/2.1/Reference/FlipMirror/>
- LightBurn Align docs: <https://docs.lightburnsoftware.com/2.1/Reference/Align/>
- LightBurn Distribute docs: <https://docs.lightburnsoftware.com/2.1/Reference/Distribute/>
- LightBurn Preview docs: <https://docs.lightburnsoftware.com/2.1/Reference/Preview/>
- LightBurn Cuts/Layers docs: <https://docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/>
- LightBurn Hotkeys docs: <https://docs.lightburnsoftware.com/Hotkeys.html>

## Findings

## Fix Status

Updated after implementation:

- LF-BH-001: fixed by batch `nudgeSelection` / `flipSelection` actions, with shortcut and menu wiring through the same path.
- LF-BH-002: fixed by `removeSceneObjects(ids)`, deleting a multi-selection as one undoable action.
- LF-BH-003: fixed by a shared `hasPreviewableContent(project)` predicate that counts only real output geometry.
- LF-BH-004: fixed in `WORKFLOW.md` and guarded by a docs consistency test.

Verification:

- `corepack pnpm typecheck`: passed
- `corepack pnpm lint`: passed, with the existing boundaries legacy selector warning only
- `corepack pnpm format:check`: passed
- `corepack pnpm test`: passed, 222 test files and 1559 tests

### LF-BH-001 - Multi-selection flip and keyboard nudge transform only the primary object

Severity: P1
Confidence: High
Area: selection, transform, LightBurn workflow parity

Trigger:

1. Select two or more objects with shift-click or select-all.
2. Press `H`, `V`, an arrow key, or choose Arrange -> Flip Horizontal/Vertical.

Expected:

LaserForge's `WORKFLOW.md` defines multi-selection as a combined selection box (`WORKFLOW.md:148-151`) and transform actions as selection transforms (`WORKFLOW.md:173-202`, `WORKFLOW.md:453`, `WORKFLOW.md:495-498`). LightBurn's Flip/Mirror behavior applies to all selected objects across the selection area, not only the active object.

Actual:

The current command and shortcut paths only transform `selectedObjectId`; `additionalSelectedIds` are ignored for flip and keyboard nudge.

Evidence:

- `src/ui/commands/use-app-commands.ts:89` enables transform commands when `selected !== null`, not when a batch transform path exists.
- `src/ui/commands/use-app-commands.ts:94-95` wires Arrange flip commands to `flipSelected`.
- `src/ui/commands/use-app-commands.ts:166-170` loads only the primary selected object and calls `applyObjectTransform(selected.id, ...)`.
- `src/ui/app/shortcuts.ts:301-313` nudges only `ctx.selectedObjectId`.
- `src/ui/app/shortcuts.ts:316-324` flips only `ctx.selectedObjectId`.
- `src/ui/app/use-shortcuts.ts:118` passes only `selectedObjectId` and `applyObjectTransform` into the transform shortcut handler.
- The new `src/ui/state/selection-transform-actions.ts` batch helper covers align/distribute and generic batch transforms, but current flip/nudge commands still bypass it.

Consequence:

An operator can believe a group was moved or mirrored while only one object changed. That can create visibly wrong physical output, especially on signage layouts or repeated objects.

Concrete fix:

- Add explicit batch actions for `nudgeSelection(dx, dy)` and `flipSelection(axis)`.
- Flip around the combined selection bounding-box center, matching LightBurn's selection-area behavior.
- Use one undo entry for the whole batch.
- Wire menu commands and keyboard shortcuts through the same action.

Verification:

- Unit test: two selected objects, `H` mirrors both around combined bbox center.
- Unit test: two selected objects, ArrowRight moves both by 1 mm with one undo entry.
- Browser smoke: select two shapes, flip/nudge, confirm the group moves as one.

False-positive checks:

- Align and distribute already use a batch helper in current WIP, so this finding is scoped only to flip and keyboard nudge.

### LF-BH-002 - Multi-delete creates one undo entry per object

Severity: P1
Confidence: High
Area: selection, undo, lost-work recovery

Trigger:

1. Select two or more objects.
2. Press Delete/Backspace or use Edit -> Delete.
3. Press Undo once.

Expected:

Delete is one user action. `WORKFLOW.md:450-453` says Delete selected objects is an undo-covered action, and object transforms are undo-covered as actions. A single Undo should restore the full multi-object delete.

Actual:

Both delete paths loop through selected ids and call `removeSceneObject(id)` repeatedly. `removeSceneObject` pushes an undo snapshot on every call, so one Delete action becomes N undo actions.

Evidence:

- `src/ui/commands/use-app-commands.ts:157-163` captures all selected ids, then calls `state.removeSceneObject(id)` in a loop.
- `src/ui/app/shortcuts.ts:205-214` does the same in the keyboard shortcut path.
- `src/ui/state/store.ts:218-235` implements `removeSceneObject` as a single-object mutation and pushes undo each call.

Consequence:

Undo after a multi-delete restores only the last removed object first. That leaves a partial scene and can also interact badly with auto-removed color layers.

Concrete fix:

- Add a store action such as `removeSceneObjects(ids)`.
- Remove all selected objects in one scene mutation.
- Prune empty auto-layers once.
- Push exactly one undo snapshot.
- Wire both menu and keyboard delete paths to the batch action.

Verification:

- Unit test: delete three selected objects, undo stack increments by one.
- Unit test: one Undo restores all deleted objects and any auto-removed layer rows.

False-positive checks:

- The current loop intentionally captures ids first to avoid selection mutation while iterating, but that does not address the undo batching defect.

### LF-BH-003 - Preview can be enabled even when no object will output

Severity: P2
Confidence: Medium-high
Area: output gating, preview fidelity

Trigger:

1. Put an object on a layer with Output off, or create an empty Output-on layer while scene objects exist elsewhere.
2. Open the Window/Preview command.

Expected:

LightBurn Preview represents what will be sent to the laser. LightBurn Cuts/Layers Output controls whether layers participate in Preview, Start, Send, and saved machine files. LaserForge's own UI copy says preview requires "at least one layer with objects to preview" (`src/ui/commands/command-families.ts:361`) and `WORKFLOW.md` ties Preview and Save G-code to output-enabled layers.

Actual:

`hasPreviewableContent` returns true when any layer has `output === true` and the scene has any object, even if no object belongs to an output-enabled layer.

Evidence:

- `src/ui/commands/use-app-commands.ts:101` passes `hasPreviewableContent(app.project)` into command state.
- `src/ui/commands/use-app-commands.ts:110-111` uses `project.scene.layers.some((layer) => layer.output) && project.scene.objects.length > 0`.
- `src/ui/commands/command-families.ts:345-361` enables Preview from that boolean and the disabled tooltip says "Enable Output on at least one layer with objects to preview".
- `WORKFLOW.md:277-280`, `WORKFLOW.md:288-325`, and `WORKFLOW.md:353-363` frame output-enabled layers as the real output gate.

Consequence:

The app can offer a Preview command for a job that will emit no output geometry. That is a misleading pre-burn verification surface and diverges from LightBurn's "preview what burns" workflow.

Concrete fix:

- Replace the loose boolean with a shared `hasOutputGeometry(project)` or `previewableObjectCount(project)` helper.
- The helper should count objects whose color/layer resolves to an output-enabled layer and compatible mode.
- Reuse it for Preview command enablement, Save G-code enablement where appropriate, and UI tooltips.
- Keep preflight as defense-in-depth.

Verification:

- Unit test: output-on empty layer plus object on output-off layer keeps Preview disabled.
- Unit test: one vector object on output-on line/fill layer enables Preview.
- Unit test: one raster object on output-on image layer enables Preview.

False-positive checks:

- This is not claiming Start/Save will necessarily burn empty output; preflight may still block later. The bug is the earlier Preview affordance and misleading workflow state.

### LF-BH-004 - `WORKFLOW.md` still documents the old Ctrl/Cmd+E export shortcut

Severity: P2
Confidence: High
Area: docs-as-spec drift, shortcut workflow

Trigger:

1. A user or future agent follows `WORKFLOW.md`.
2. They press `Ctrl/Cmd+E` expecting Save G-code.

Expected:

Shortcut docs, toolbar hints, code, and ADRs should agree. LightBurn hotkeys use `Ctrl/Cmd+E` for Ellipse, and LaserForge ADR-051 moved export G-code to `Ctrl+Shift+E`.

Actual:

`WORKFLOW.md` still says `Cmd/Ctrl+E` saves G-code.

Evidence:

- `WORKFLOW.md:334` says File -> Save G-code uses `Cmd/Ctrl+E`.
- `WORKFLOW.md:481` says `Cmd/Ctrl+E - Save G-code (Export)`.
- `src/ui/app/shortcuts.ts:104-105` says `Ctrl+E` moved to Ellipse and export is `Ctrl+Shift+E`.
- `src/ui/app/shortcuts.ts:154` handles `Ctrl+Shift+E` as export.
- `src/ui/common/Toolbar.tsx:99-100` says export is `Ctrl+Shift+E`, ellipse is `Ctrl+E`.
- `DECISIONS.md:2750-2755` records ADR-051 moving export G-code to `Ctrl+Shift+E`.
- LightBurn Hotkeys docs list Ellipse as `Ctrl/Cmd+E`.

Consequence:

This is not a runtime crash, but it is dangerous project drift because `WORKFLOW.md` is used as a source of truth. It can cause future agents to "fix" the correct code back to the old shortcut.

Concrete fix:

- Update `WORKFLOW.md` F-A9 and F-A15 to `Ctrl/Cmd+Shift+E` for Save G-code.
- Add/keep `Ctrl/Cmd+E` under Tools as Ellipse.

Verification:

- Docs-only review plus existing shortcut tests.
- Optional doc consistency test if the project wants shortcut docs enforced mechanically.

False-positive checks:

- Runtime code and UI hints are already internally consistent; only `WORKFLOW.md` is stale.

## Rejected Or Deferred Observations

- Shape draw layer creation looked covered: `draw-shape-mutation.test.ts` verifies creating layers for drawn shapes.
- Align and distribute are not included in LF-BH-001 because current WIP uses batch selection actions for those commands.
- Start/Save output behavior was not promoted as a bug from LF-BH-003 because later preflight may block empty output. The promoted issue is only the Preview enablement mismatch.

## Fix Order

1. Fix LF-BH-001 first. It is the highest physical-output correctness risk and can reuse the existing batch transform helper.
2. Fix LF-BH-002 next. It is small, mechanical, and protects undo integrity.
3. Fix LF-BH-003 after that, ideally by introducing one shared output-geometry predicate.
4. Fix LF-BH-004 as a docs-only patch after shortcut behavior is confirmed.

## Post-Fix Audit Checklist

- Rerun `corepack pnpm typecheck`.
- Rerun `corepack pnpm lint`.
- Rerun `corepack pnpm format:check`.
- Rerun `corepack pnpm test`.
- Browser smoke: multi-select two objects, nudge, flip horizontal, flip vertical, delete, undo once, preview gating with output-off layer.
