# Lane 4 Output Selection Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LightBurn-style Cut Selected Graphics and Use Selection Origin parity so Preview, Frame, Start, live estimate, and Save G-code all output the same scoped job.

**Architecture:** Add a small pure output-scope layer before `compileJob`. The UI stores operator output-scope switches separately from scene geometry, and every output consumer passes the same `OutputScope` into `prepareOutput` / `emitGcode` / `prepareStartJob`. No selected-only path may compile, frame, preview, save, or start through a separate pipeline.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest, existing LaserForge scene/job/G-code modules.

---

## Research Baseline

- LightBurn Cut Selected Graphics applies to Preview, Frame, Start, Send, and machine-file save. It warns when enabled with an empty selection.
- LightBurn Use Selection Origin is available only with Cut Selected Graphics and not in Absolute Coordinates. It changes job-origin calculation; it does not move source artwork.
- LightBurn Preview is an accurate representation of what will be sent to the laser, so selected-output scope must be shared by preview/save/frame/start.
- Position Laser and Move Laser to Selection physically move the head and require accurate homing/position reporting. They are deferred until selected-output parity is green.

Sources:

- <https://docs.lightburnsoftware.com/2.1/Reference/CutSelectedGraphics/>
- <https://docs.lightburnsoftware.com/2.1/Reference/LaserWindow/>
- <https://docs.lightburnsoftware.com/2.1/Reference/Preview/>
- <https://docs.lightburnsoftware.com/2.1/Reference/PositionLaser/>
- <https://docs.lightburnsoftware.com/2.1/Reference/MoveLaserToSelection/>

## Current Code Map

- `src/io/gcode/prepare-output.ts`: single prepared-output path for compile, job origin, optimization.
- `src/io/gcode/emit-gcode.ts`: Save/Start G-code generation entrypoint.
- `src/ui/workspace/draw-preview.ts`: workspace preview builds from `prepareOutput`.
- `src/ui/workspace/use-preview-toolpath.ts`: resolves placement and calls preview build.
- `src/ui/laser/start-job-readiness.ts`: Start preflight, placement, emit, and controller readiness.
- `src/ui/laser/JobControls.tsx`: Frame and Start controls.
- `src/ui/laser/JobPlacementControls.tsx`: existing Start From and 9-dot Job Origin UI.
- `src/ui/app/file-actions.ts`: Save G-code flow.
- `src/ui/state/store.ts`: project, selection, preview, and job placement state.

## Product Boundary

Implement now:

1. Cut Selected Graphics toggle.
2. Use Selection Origin toggle, enabled only when Cut Selected Graphics is enabled and Start From is not Absolute Coordinates.
3. Empty-selection blocking for Preview, Frame, Start, Save, and Estimate.
4. Shared selected-output path for vector and raster objects.

Defer:

1. Position Laser click-to-jog.
2. Move Laser to Selection.
3. Set Start Point / node-level cut ordering.
4. Persisting scope switches into `.lf2` unless explicitly approved after smoke testing.

## File Structure

- Create `src/core/scene/output-scope.ts`: pure selection filtering and scope validation.
- Modify `src/core/scene/index.ts`: export output-scope helpers.
- Modify `src/io/gcode/prepare-output.ts`: accept an optional `OutputScope`.
- Modify `src/io/gcode/emit-gcode.ts`: pass output scope into `prepareOutput`.
- Modify `src/ui/state/store.ts`: add `outputScope` and setter.
- Modify `src/ui/laser/JobPlacementControls.tsx`: render Cut Selected Graphics and Use Selection Origin controls.
- Modify `src/ui/laser/JobControls.tsx`: pass scope into Frame.
- Modify `src/ui/laser/start-job-readiness.ts`: pass scope into pre-emit, bounds, and emit.
- Modify `src/ui/app/file-actions.ts`: pass scope into Save G-code.
- Modify `src/ui/workspace/use-preview-toolpath.ts` and `src/ui/workspace/draw-preview.ts`: pass scope into preview.
- Modify `src/ui/laser/live-job-estimate.ts` and `src/ui/laser/use-job-estimate.ts`: estimate scoped output.
- Modify `src/ui/help/help-topics.ts`: add tooltip/help topics.
- Modify `WORKFLOW.md`: document the workflow.

## Task 1: Pure Output Scope

**Files:**

- Create: `src/core/scene/output-scope.ts`
- Modify: `src/core/scene/index.ts`
- Test: `src/core/scene/output-scope.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { filterSceneForOutputScope, validateOutputScope, type OutputScope } from './output-scope';
import { EMPTY_SCENE, type Scene } from './scene';

const scope = (ids: readonly string[]): OutputScope => ({
  cutSelectedGraphics: true,
  useSelectionOrigin: false,
  selectedObjectIds: ids,
});

describe('output scope', () => {
  it('returns the original scene when Cut Selected Graphics is off', () => {
    const scene = sceneWithObjects(['A', 'B']);
    expect(filterSceneForOutputScope(scene, { cutSelectedGraphics: false, useSelectionOrigin: false, selectedObjectIds: [] })).toBe(scene);
  });

  it('keeps only selected objects when Cut Selected Graphics is on', () => {
    const scene = sceneWithObjects(['A', 'B', 'C']);
    const filtered = filterSceneForOutputScope(scene, scope(['B']));
    expect(filtered.objects.map((object) => object.id)).toEqual(['B']);
  });

  it('reports empty selection when Cut Selected Graphics is enabled with no selected ids', () => {
    expect(validateOutputScope(EMPTY_SCENE, scope([]))).toEqual({
      ok: false,
      messages: ['Cut Selected Graphics is enabled, but no artwork is selected. Select artwork or turn off Cut Selected Graphics.'],
    });
  });

  it('reports stale selection ids when selected objects no longer exist', () => {
    expect(validateOutputScope(sceneWithObjects(['A']), scope(['missing']))).toEqual({
      ok: false,
      messages: ['Cut Selected Graphics is enabled, but none of the selected artwork exists anymore. Select artwork or turn off Cut Selected Graphics.'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run src/core/scene/output-scope.test.ts`

Expected: FAIL because `output-scope.ts` does not exist.

- [ ] **Step 3: Implement minimal pure helper**

```ts
import type { Scene } from './scene';

export type OutputScope = {
  readonly cutSelectedGraphics: boolean;
  readonly useSelectionOrigin: boolean;
  readonly selectedObjectIds: ReadonlyArray<string>;
};

export type OutputScopeValidation =
  | { readonly ok: true; readonly scene: Scene }
  | { readonly ok: false; readonly messages: ReadonlyArray<string> };

export const DEFAULT_OUTPUT_SCOPE: OutputScope = {
  cutSelectedGraphics: false,
  useSelectionOrigin: false,
  selectedObjectIds: [],
};

export function filterSceneForOutputScope(scene: Scene, scope: OutputScope): Scene {
  if (!scope.cutSelectedGraphics) return scene;
  const selected = new Set(scope.selectedObjectIds);
  return { ...scene, objects: scene.objects.filter((object) => selected.has(object.id)) };
}

export function validateOutputScope(scene: Scene, scope: OutputScope): OutputScopeValidation {
  if (!scope.cutSelectedGraphics) return { ok: true, scene };
  if (scope.selectedObjectIds.length === 0) {
    return {
      ok: false,
      messages: [
        'Cut Selected Graphics is enabled, but no artwork is selected. Select artwork or turn off Cut Selected Graphics.',
      ],
    };
  }
  const scoped = filterSceneForOutputScope(scene, scope);
  if (scoped.objects.length === 0) {
    return {
      ok: false,
      messages: [
        'Cut Selected Graphics is enabled, but none of the selected artwork exists anymore. Select artwork or turn off Cut Selected Graphics.',
      ],
    };
  }
  return { ok: true, scene: scoped };
}
```

- [ ] **Step 4: Export and re-run**

Run: `corepack pnpm vitest run src/core/scene/output-scope.test.ts`

Expected: PASS.

## Task 2: Shared Prepared Output Scope

**Files:**

- Modify: `src/io/gcode/prepare-output.ts`
- Modify: `src/io/gcode/emit-gcode.ts`
- Test: `src/io/gcode/prepare-output.test.ts`
- Test: `src/io/gcode/emit-gcode.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving `prepareOutput(project, { outputScope })` compiles only selected artwork and returns a scoped failure for empty selection.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `corepack pnpm vitest run src/io/gcode/prepare-output.test.ts src/io/gcode/emit-gcode.test.ts`

Expected: FAIL because options do not accept `outputScope`.

- [ ] **Step 3: Implement the option**

Use `validateOutputScope` before `runPreEmitPreflight`, and run preflight/compile on `{ ...project, scene: scoped.scene }`.

- [ ] **Step 4: Re-run focused tests**

Run: `corepack pnpm vitest run src/io/gcode/prepare-output.test.ts src/io/gcode/emit-gcode.test.ts`

Expected: PASS.

## Task 3: Store and UI Controls

**Files:**

- Modify: `src/ui/state/store.ts`
- Modify: `src/ui/laser/JobPlacementControls.tsx`
- Modify: `src/ui/help/help-topics.ts`
- Test: `src/ui/state/store.test.ts`
- Test: `src/ui/laser/JobControls.test.tsx`
- Test: `src/ui/help/help-topics.test.ts`

- [ ] **Step 1: Add failing tests**

Test that toggling Cut Selected Graphics updates state; Use Selection Origin is disabled until Cut Selected Graphics is on and Start From is not Absolute.

- [ ] **Step 2: Verify red**

Run: `corepack pnpm vitest run src/ui/state/store.test.ts src/ui/laser/JobControls.test.tsx src/ui/help/help-topics.test.ts`

Expected: FAIL until UI/store help topics exist.

- [ ] **Step 3: Implement UI/store**

Add `outputScopeSettings` to the store:

```ts
type OutputScopeSettings = {
  readonly cutSelectedGraphics: boolean;
  readonly useSelectionOrigin: boolean;
};
```

Compute selected ids at output time from `selectedObjectId` and `additionalSelectedIds` so selection never goes stale in persisted project data.

- [ ] **Step 4: Re-run focused tests**

Run: `corepack pnpm vitest run src/ui/state/store.test.ts src/ui/laser/JobControls.test.tsx src/ui/help/help-topics.test.ts`

Expected: PASS.

## Task 4: Wire Preview, Estimate, Frame, Start, and Save

**Files:**

- Modify: `src/ui/workspace/use-preview-toolpath.ts`
- Modify: `src/ui/workspace/draw-preview.ts`
- Modify: `src/ui/laser/live-job-estimate.ts`
- Modify: `src/ui/laser/use-job-estimate.ts`
- Modify: `src/ui/laser/JobControls.tsx`
- Modify: `src/ui/laser/start-job-readiness.ts`
- Modify: `src/ui/app/file-actions.ts`
- Test: relevant focused tests next to each file.

- [ ] **Step 1: Add failing integration tests**

Write one test per consumer showing selected-only scope changes output:

- Preview omits unselected object.
- Estimate treats selected-only empty selection as empty/blocked.
- Frame bounds match selected object only.
- Start G-code excludes unselected object.
- Save G-code excludes unselected object.

- [ ] **Step 2: Verify red**

Run focused tests for those files.

- [ ] **Step 3: Implement shared scope plumbing**

Add a helper in UI state:

```ts
export function currentOutputScope(state: AppState): OutputScope {
  return {
    cutSelectedGraphics: state.outputScopeSettings.cutSelectedGraphics,
    useSelectionOrigin: state.outputScopeSettings.useSelectionOrigin,
    selectedObjectIds: [
      ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
      ...state.additionalSelectedIds,
    ],
  };
}
```

Pass the helper result to all output consumers.

- [ ] **Step 4: Re-run focused tests**

Run the same focused tests.

Expected: PASS.

## Task 5: Use Selection Origin

**Files:**

- Modify: `src/ui/job-placement.ts`
- Modify: `src/io/gcode/prepare-output.ts`
- Modify: `src/ui/laser/start-job-readiness.ts`
- Test: `src/ui/laser/start-job-readiness.test.ts`
- Test: `src/io/gcode/prepare-output.test.ts`

- [ ] **Step 1: Add failing tests**

Test Current Position / User Origin with selected-only scope:

- `useSelectionOrigin: true` calculates the origin from selected artwork bounds.
- `useSelectionOrigin: false` keeps origin calculation based on the full output scene placement rules.
- Absolute Coordinates disables Use Selection Origin in UI and has no origin effect.

- [ ] **Step 2: Verify red**

Run focused tests.

- [ ] **Step 3: Implement with no geometry mutation**

Use the scoped scene only for `jobOriginOffset` when `useSelectionOrigin` is true. Keep source `project.scene.objects` unchanged.

- [ ] **Step 4: Re-run focused tests**

Expected: PASS.

## Task 6: Docs, Audit, Browser Smoke, Commit

**Files:**

- Modify: `WORKFLOW.md`
- Modify: `docs/LIGHTBURN-PARITY-IMPLEMENTATION-ROADMAP-2026-06-15.md`

- [ ] **Step 1: Update workflow docs**

Add `F-B15. Cut Selected Graphics / Use Selection Origin`.

- [ ] **Step 2: Run full gates**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build:web
corepack pnpm check:file-size
```

- [ ] **Step 3: Browser smoke**

Open local app and verify:

- Toggle appears near Start From.
- Use Selection Origin is disabled until Cut Selected Graphics is on.
- Empty selection gives a clear block.
- Preview only shows selected output.
- Save/Start/Frame use the same selected-output scope.

- [ ] **Step 4: Commit and push**

Commit after the green audited slice:

```powershell
git add src WORKFLOW.md docs
git commit -m "feat: add selected output scope"
git push origin main
```

## Self-Review

- Spec coverage: the plan covers Cut Selected Graphics, empty selection warnings, Use Selection Origin, and shared Preview/Frame/Start/Save output scope.
- Placeholder scan: no production behavior is left as an unspecified "later"; physically moving tools are explicitly deferred.
- Type consistency: the plan uses `OutputScope` for runtime selected ids and `OutputScopeSettings` for persisted UI toggles.
- Safety check: no new physical motion command is added; existing Frame/Start guards remain in place.
