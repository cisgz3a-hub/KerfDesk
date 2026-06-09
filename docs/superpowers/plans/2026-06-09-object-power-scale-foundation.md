# Object Power Scale Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a LightBurn-style per-object `powerScale` field so selected objects can burn at a percentage of their layer power without changing the layer.

**Architecture:** Keep the field additive and optional on `SceneObject` variants so old `.lf2` files reopen unchanged. Apply the scale only in `compileJob`, producing effective group power and raster S-values through the existing output pipeline. Preserve current output shape when no object uses `powerScale`.

**Tech Stack:** TypeScript strict, Vitest, pure `core/` compile pipeline, `.lf2` shape validator.

---

## Research Anchor

- LightBurn Shape Properties exposes **Power Scale** for selected shapes and describes it as rescaling the power used for that shape; on devices without Min Power, it scales between 0 and Max Power: <https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/>
- LightBurn Material Test creates generated grids that vary settings such as Power and Speed, but LaserForge should keep that future generator on the existing Scene -> Job -> Output path instead of emitting separate ad hoc G-code: <https://docs.lightburnsoftware.com/latest/Reference/MaterialTest/>
- LaserForge project scope still treats full Material Test / Material Library as future workflow breadth, so this slice only adds the safer foundational output primitive.

## Files

- Modify: `src/core/scene/scene-object.ts`
- Modify: `src/core/job/compile-job.ts`
- Create: `src/core/job/object-power-scale.ts`
- Create: `src/core/job/object-power-scale.test.ts`
- Create: `src/core/job/compile-job-power-scale.test.ts`
- Modify: `src/io/project/project-shape-validator.ts`
- Create: `src/io/project/project-power-scale.test.ts`

## Tasks

### Task 1: Red Tests For Scene Validation

- [ ] Add tests proving `.lf2` accepts numeric `powerScale` on vector and raster objects and rejects non-number/out-of-range values.
- [ ] Run the focused project test and confirm it fails because `powerScale` is not accepted yet.

### Task 2: Red Tests For Job Output

- [ ] Add tests proving default objects remain grouped exactly as before.
- [ ] Add tests proving a vector object at `powerScale: 50` on a 30% layer emits effective power 15%.
- [ ] Add tests proving raster grayscale S-values scale both max and min power.
- [ ] Run the focused job tests and confirm they fail because compile output ignores `powerScale`.

### Task 3: Minimal Implementation

- [ ] Add optional `powerScale?: number` to every `SceneObject` variant.
- [ ] Add pure helpers in `object-power-scale.ts` for normalizing object scale and effective layer power.
- [ ] Thread object scale through `compileJob`:
  - Preserve existing single group when all matching vector objects are default scale.
  - Split only when at least one matching object uses non-default scale.
  - Apply scale to raster `power`, `sMax`, and `sMin`.
- [ ] Update `.lf2` validation with `optionalPercent` checks on each object kind.

### Task 4: Verify And Audit

- [ ] Run focused tests for job compile and project validation.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:file-size`, and `git diff --check`.
- [ ] Use the browser for a side-effect-free local app smoke after code changes.
- [ ] Commit and push only after the above evidence is clean.

## Non-Goals

- No Material Test UI or generated grid in this slice.
- No Shape Properties panel UI in this slice.
- No Material Library storage in this slice.
- No hardware-proof claim; this only proves emitted output values change correctly.
