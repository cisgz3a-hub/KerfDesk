# T24 Re-trace Original — refuter report
Tree: origin/main @ 1988481a5 (read-only export `C:\Users\stolk\kd-t1\t22-main`). Command id: `tools.retrace-original`.
Method: my own mutation-level harness, not the auditor's dialog harness. `C:\Users\stolk\kd-t1\zz-t24r\r24.test.ts` builds the photo, trace, copies and operations by hand, then calls the real `applyTraceToExisting` / `applyRasterizedTraceToExisting` with what the dialog hands the store (same id, `IDENTITY_TRANSFORM`, no name or operations). It then runs the real `compileJob` for burn boxes, power, speed and passes, and the real `detectJobIntentWarnings` (the list Job Review shows) to answer "is it silent?". Log: `C:\Users\stolk\kd-t1\zz-t24r\r24.log`. Run: Vitest 4.1.12, `--maxWorkers=1`, `NODE_OPTIONS=--no-experimental-webstorage`, 7/7 cases passed, free memory 2.5 GB.

## Verdicts
| Claim | Verdict | Severity |
|---|---|---|
| T24-P1-1 Re-trace snaps a moved, scaled or rotated trace back over the source | **CONFIRMED** | P1 |
| T24-P1-2 Re-trace swaps the trace's operation for a new default one and drops name, power scale and overrides | **CONFIRMED** (with a correction: one generic Job Review advisory does fire when no material recipe seeds the new operation) | P1 |

### T24-P1-1 — CONFIRMED P1
- **Is snapping back documented as intended? No.** ADR-408 says Re-trace "replaces the selected trace in place". The ADR on raster trace output (DECISIONS.md ~11168) says "re-trace replaces the prior result in place so stacking, artwork order, and group references remain stable". Neither one mentions placement. WORKFLOW F-L3 step 1 says re-traced geometry "lands at the same mm placement". A moved trace does not, so F-L3 is evidence for the defect, not against it. ADR-673 (copies section) says a copy "keeps its Re-trace link to the original picture", so re-tracing a copy placed elsewhere (by Duplicate, Array or nesting) is a supported workflow. No test asserts placement either way: the retrace tests (`trace-retrace-order`, `rasterized-trace-mutation`, `ImportImageDialog.retrace-settings`, `kept-trace-photo-output`) all start from a trace that has not been moved.
- **Does the dialog warn?** No. The Trace dialog previews in the source picture's own frame, with no canvas position. It has no retrace-specific copy: in `ImportImageDialog.tsx`, `replaceTraceId` only threads into the commit (`:60,142,292,380`). The success toast is the fresh-trace one (`trace-output-commit.ts:209`).
- **Does Job Review catch it?** No. Cases A, B and C show no placement-related advisory before or after. The only new line is the uncalibrated-defaults advisory, which comes from P1-2, not from placement. The canvas does redraw at the new place (and `traceExistingImage` calls `fitAllObjects`). But small offsets are easy to miss, and AREAS.md puts wrong size or place under P1 whatever the canvas shows.
- **Measured (compileJob burn boxes, bed coordinates):**
  - A, nudged +3/−2 mm: X 33–53 → 30–50, Y 362–371.9 → 360–369.9. A silent 3 mm shift with no warning.
  - B, scaled to 95% in place to fit a blank: X 29.5–48.5 → 30–50. The art grows back to 100%.
  - C, moved to (200, 150) and rotated 90°: X 180–190, Y 220–239.9 → X 30–50, Y 360–369.9.
  - D, re-tracing a copy moved 100 mm to the right: the copy lands exactly on the original. Burn X 30–150 → 30–50, so the second blank is left unburned.

### T24-P1-2 — CONFIRMED P1
- **Is a fresh default operation intended because the mode may change?** Only partly. The mode comes from `freshArtworkMode(positionedTrace)` (`scene-mutations.ts:295-299`). A Line Art → Centerline switch could justify a new operation. With the mode unchanged nothing justifies it, and the code's own sibling contradicts it. `rasterized-trace-mutation.ts:142-159` (`withResultSettings`) says "Re-trace in place changes the bitmap, not the result's operations or the settings the operator gave this result". It keeps `operationIds`, `operationOverride` and `powerScale`. Case G confirms this: a raster result keeps `op-result` P70/F900 and powerScale 40, compiled power 28. The vector path does the opposite. `applyReimport` (`scene-mutations.ts:344-368`) also keeps name, override and operation bindings by colour.
- **Measured:**
  - A: "art" fill P80/F600/x2 with powerScale 40 (compiled S 32%, 2 passes) → "art 2" (`operation-trace`) P30/F1500/x1, compiled 30%, 1 pass. Name "Coaster logo" and powerScale are dropped.
  - B, C: the same swap, 80%/600/2 → 30%/1500/1.
  - D: the copy leaves the original's shared operation "art" and moves to a new "art 2" at defaults, stacked over the original.
- **Correction to "silently": is anything shown?** The canvas operation colour changes and the Cuts panel shows "art 2". Job Review adds one advisory: "Operation "art 2" is still using the uncalibrated defaults (30% power, 1500 mm/min, 1 pass). Run a material test on scrap before burning final material." (cases A to D). This does not refute the claim, for three reasons:
  1. The advisory never says the tuned operation was deleted or replaced. It reads as generic material-test advice, and in case A it sits among three other advisories.
  2. With the job material's auto-apply recipes on (ADR-496, `import-actions.ts:132-149` → `projectWithFreshLaserRecipes`), the new operation is seeded from the library's best recipe instead of the defaults. Then nothing fires, while the burn still changes from the user's tuned values. READ ONLY: I did not run a library fixture.
  3. In case F (the trace was already on defaults), the same advisory was already there before the re-trace, so it signals nothing new.

  A wrong power, speed and pass count reaches the bed, so it stays P1 under AREAS.md ("wrong burn"). The advisory is a partial mitigation the fix PR should not rely on.
- **Not raised:** the operation-order effect of the new operation being appended last (case E). Layers go [photo, art, cut] → [photo, cut, art 2], but `compileJob` still emits the fill before the cut, and no cut-before-engraving warning appears. No harm found.

## Evidence
- Script: `C:\Users\stolk\kd-t1\zz-t24r\r24.test.ts`, config `C:\Users\stolk\kd-t1\zz-t24r\vitest.config.mts`, log `C:\Users\stolk\kd-t1\zz-t24r\r24.log`.
- Command: from `C:\Users\stolk\kd-t1\zz-t24r`, `node C:\Users\stolk\kd-t1\t22-main\node_modules\vitest\vitest.mjs run --config vitest.config.mts --maxWorkers=1 r24.test.ts`.
- Fixture: photo 40 × 30 mm (400 × 300 px) at (20, 20) with its Image operation Output off. Trace: a 200 × 100 px ring registered with `positionTraceOverRasterSource` (scale 0.1), then the user tweak, bound to "art" (fill P80/F600/x2).
- Docs and code read: ADR-408; ADR-406 §6; ADR-673 copies and §7; DECISIONS.md raster-trace ADR item 4; WORKFLOW F-L3 (`WORKFLOW.md:9592-9617`); `scene-mutations.ts:274-370`; `rasterized-trace-mutation.ts:43-265`; `trace-raster-output.ts:88-127`; `artwork-operation.ts:45-209`; `uncalibrated-job-warnings.ts`; `stacked-copy-warnings.ts`; `job-intent-warnings.ts:50-70`.
- **Correction to the auditor's check table:** the auditor wrote that the unmoved original plus the re-traced copy stacking exactly gives "no stacked-copy advisory: preflight codes []". Job Review does warn here: case D after re-trace shows "2 copies of "art.png" overlap on output operations…". The stacked-copy advisory comes from `detectJobIntentWarnings`, not from preflight codes. The double burn is therefore warned. Losing the second blank's burn is not warned.

## Extra findings
### T24R-P1-1: A Raster scan re-trace also snaps a moved raster trace result back over the photo
- **Severity:** P1 — burn in the wrong place, the same harm as T24-P1-1 on the other output path. The auditor listed this path as "Not checked". It is counted separately because the code and the fix site differ: the coordinator may merge it into T24-P1-1's fix, but that fix must cover both paths.
- **Where:**
  - `src/ui/trace/trace-raster-output.ts:96`: `buildRasterTraceOutput` places the bitmap with `positionTraceOverRasterSource` and bakes it into scene-space pixels with an identity transform.
  - `src/ui/state/rasterized-trace-mutation.ts:142-159` (`withResultSettings`): carries `color`, `operationIds`, `operationOverride` and `powerScale` from the replaced result, but not its `transform`.
  - `:227-264` (`prepareRasterizedTrace`): takes the incoming placement.
- **Repro:** `r24.test.ts` case G. The raster result (bounds 20–60 × 20–50 mm, identity transform) is moved by the user to transform x 180, y 130. Before re-trace, the compiled raster group's bounds are X 200–240, Y 220–250. After Re-trace Original with Raster scan output, the bounds are X 20–60, Y 350–380 (bed Y), back over the photo, with transform x 0, y 0. Operations and powerScale are kept (power 28 = 70 × 0.4), so only placement is lost. No advisory.
- **Oracle:** the same in-place contract as T24-P1-1: F-L3 "lands at the same mm placement", and ADR-673 copies keeping their Re-trace link. The function's own comment says re-trace in place changes "the bitmap, not … the settings the operator gave this result", and the user's move is one of those settings.
- **Suggested fix:** in `withResultSettings`, compose the replaced result's offset from its original over-source placement onto the new bitmap, the same composition proposed for T24-P1-1, and test both outputs with a moved result.

## Totals
- Verdicts: T24-P1-1 CONFIRMED P1; T24-P1-2 CONFIRMED P1. P1-2's "silently" is softened: one generic "uncalibrated defaults" advisory fires, but not when ADR-496 recipe seeding applies.
- Auditor correction: the stacked-copy double burn in the copy case is warned by Job Review.
- Extra raised: 1 (T24R-P1-1, P1, same class as T24-P1-1 on the raster path). P2 0, P3 0.
