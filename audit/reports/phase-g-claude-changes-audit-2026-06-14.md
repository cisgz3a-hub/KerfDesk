# Phase G Claude Changes Audit - 2026-06-14

## Scope

Read-only audit of Claude's latest Phase G on-canvas drawing changes in
`C:\Users\Asus\LaserForge-2.0`.

- Branch audited: `feat/drawing-tools-phase-g`
- Compared against: `main`
- Head at audit time:
  `bb93f47 feat(ui): draw shapes on the canvas by dragging (Phase G, B5)`
- Production code changed by this audit: none
- Audit stance: findings-first, no speculative bugs, concrete trigger paths only

## Executive Summary

Claude's Phase G work is directionally sound and mechanically healthy: the shape
variant reaches the core compile/preflight/live-estimate pipeline, the new
geometry tests pass, the full test suite passes, and the web build passes.

The remaining issues are not broken-build failures. They are workflow
integration gaps caused by older code paths still recognizing only imported
SVG/text/traced vectors, not the new `kind: 'shape'` scene object. Two should be
fixed before merging or deploying Phase G.

## Verification Performed

Fresh commands run in `C:\Users\Asus\LaserForge-2.0`:

```text
corepack pnpm test --run src/core/shapes/create-rectangle.test.ts src/core/shapes/rectangle.test.ts src/core/shapes/ellipse.test.ts src/core/shapes/polygon.test.ts src/core/shapes/shape-from-drag.test.ts src/ui/state/draw-shape-mutation.test.ts src/io/project/project.test.ts src/core/job/compile-job.test.ts src/core/preflight/preflight.test.ts src/ui/app/shortcuts.test.ts
```

Result: 10 test files passed, 80 tests passed.

```text
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build:web
```

Result:

- `typecheck`: passed
- `lint`: passed
- `format:check`: passed
- full `test`: passed, 203 files / 1436 tests
- `build:web`: passed

Observed test warning: the existing jsdom `act(...)` warning in
`use-canvas-bitmap-size.test.tsx`; it did not fail the suite and was not caused
by this audit.

## Findings

### P1 - Drawn shapes can lose their Cuts/Layers entry during cleanup

- File: `src/ui/state/scene-mutations.ts`
- Function: `pruneOrphanLayers`
- Evidence: `pruneOrphanLayers` scans `imported-svg`, `text`, `traced-image`,
  and `raster-image`, but it does not include `shape`.
- Trigger path: a scene contains a drawn shape whose color is the only use of a
  layer. Then another object is removed or converted through a path that calls
  `pruneOrphanLayers`.
- Failure mode: the layer used only by the shape can be pruned as "orphaned"
  even though the shape still exists.
- Consequence: the shape becomes disconnected from its expected Cuts/Layers
  settings. That can make preview/output/layer editing inconsistent after normal
  editing operations.
- Severity: P1
- Confidence: high
- Concrete fix: include `shape` in the path-color scan:

```ts
if (
  obj.kind === 'imported-svg' ||
  obj.kind === 'text' ||
  obj.kind === 'traced-image' ||
  obj.kind === 'shape'
) {
  for (const p of obj.paths) usedColors.add(p.color);
}
```

Add a regression test where a shape and another object use different layers,
then deleting the other object preserves the shape layer.

### P1 - Convert to Bitmap ignores drawn shapes

- File: `src/ui/raster/bitmap-assembly.ts`
- Types/functions: `ConvertibleVector`, `isConvertibleVector`,
  `assembleBitmap`, `assembleBitmapAsync`
- Evidence: `ConvertibleVector = ImportedSvg | TextObject | TracedImage`;
  `isConvertibleVector` returns true only for `imported-svg`, `text`, and
  `traced-image`.
- Trigger path: draw a rectangle, ellipse, or polygon; select it; use Convert to
  Bitmap.
- Failure mode: the command does not see the selected shape as convertible even
  though the shape is vector geometry with materialized `paths`.
- Consequence: drawn shapes behave unlike imported/text/traced vectors and
  unlike LightBurn-style vector objects. This contradicts ADR-051's stated goal
  that shapes are ordinary `SceneObject`s flowing through existing workflows.
- Severity: P1
- Confidence: high
- Concrete fix: add `ShapeObject` to `ConvertibleVector`, include it in
  `isConvertibleVector`, and update `sourceLabel` to produce a stable label for
  shapes. Add vector-to-bitmap tests proving a drawn shape is accepted and
  rasterizes.

### P2 - Preview ghost geometry excludes drawn shapes

- File: `src/ui/workspace/draw-preview.ts`
- Functions: `drawObjectsFaint`, `drawObjectPolylinesFaint`
- Evidence: both functions only draw `imported-svg` objects.
- Trigger path: enable preview mode on a scene containing a drawn shape.
- Failure mode: the faint "original design behind the toolpath" layer omits the
  drawn shape.
- Consequence: the burn path itself is probably still present because
  `buildPreviewToolpath` uses `prepareOutput`, but the preview overlay is not
  faithful for shape objects.
- Severity: P2
- Confidence: medium-high
- Concrete fix: share the normal vector-object drawing predicate used in
  `draw-scene.ts` or include `shape` alongside `imported-svg`, `text`, and
  `traced-image`. Add a preview rendering test with a shape object.

### P2 - Documentation claims "currently-selected layer" but code uses first layer

- Files:
  - `PROJECT.md`
  - `DECISIONS.md`
  - `src/ui/workspace/draw-tool.ts`
- Evidence:
  - `PROJECT.md` says Workspace mousedown draws on the "currently-selected
    layer".
  - `DECISIONS.md` ADR-051 says the same.
  - `draw-tool.ts` uses `project.scene.layers[0]?.color`.
  - Search found no general active/selected layer state outside Material Library
    local UI state.
- Trigger path: operator expects a new shape to land on the selected/active layer
  after editing a non-first layer.
- Failure mode: new shape uses the first layer color instead.
- Consequence: workflow is surprising and does not match the documented Phase G
  behavior.
- Severity: P2
- Confidence: high
- Concrete fix: implement explicit active layer state in the store and layer
  panel, then pass that color into draw creation. If active layer is not in
  scope, revise ADR/PROJECT wording to say first-layer/default color.

### P2 - Scratch circular-use test file is untracked in production source tree

- File: `src/io/svg/circular-test.ts`
- Evidence: file is untracked and contains manual `console.log` code that calls
  `parseSvg`.
- Trigger path: a broad `git add -A` on this branch.
- Failure mode: manual scratch code can be committed under `src/`.
- Consequence: production source tree gains a non-test script with console output
  and no test runner integration.
- Severity: P2
- Confidence: high
- Concrete fix: delete the file, move it to `audit/evidence/`, or convert it
  into a real `*.test.ts` fixture.

### P2 - Merge/deploy risk: current branch omits earlier LightBurn workflow guard work

- Branch/commit evidence:
  - Current branch: `feat/drawing-tools-phase-g`
  - Missing from current HEAD: `e7784c8 fix: improve LightBurn workflow guards`
  - Containing branch found locally: `fix/trace-transparency-opaque-fallback`
- Trigger path: deploy or merge only `feat/drawing-tools-phase-g`.
- Failure mode: the earlier guard fix is not included in the deployed/merged
  result.
- Consequence: production can appear to "lose" recent fixes even though Phase G
  itself builds and tests cleanly.
- Severity: P2 operational risk
- Confidence: high
- Concrete fix: intentionally merge/cherry-pick the guard commit before a
  production deploy that is meant to contain both workstreams.

## Non-Findings / Positive Signals

- Shape variant is wired into `compileJob`.
- Preflight knows about `shape`.
- Live job estimate knows about `shape`.
- Layer assignment code has `shape` arms.
- Project serialization/deserialization tests cover rect, ellipse, and polygon
  shapes.
- Normal canvas draw path in `draw-scene.ts` includes `shape`.
- Full tests and build pass.

## Recommended Fix Order

1. Fix `pruneOrphanLayers` to preserve shape-used layers, with a regression
   test.
2. Add `ShapeObject` to Convert to Bitmap eligibility, with rasterization tests.
3. Make preview ghost geometry include shape objects, with a preview test.
4. Decide active-layer behavior: implement active layer state or correct the
   docs.
5. Remove or convert `src/io/svg/circular-test.ts`.
6. Before deployment, intentionally reconcile `feat/drawing-tools-phase-g` with
   `e7784c8 fix: improve LightBurn workflow guards`.

## Release Recommendation

Do not deploy Phase G as-is if the goal is a clean LightBurn-style drawing
workflow. The code is mechanically green, but the two P1 findings are real
workflow defects. Fix P1 findings first, then rerun:

```text
corepack pnpm test --run src/ui/state/scene-mutations.test.ts src/ui/raster/vector-to-bitmap.test.ts
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build:web
```
