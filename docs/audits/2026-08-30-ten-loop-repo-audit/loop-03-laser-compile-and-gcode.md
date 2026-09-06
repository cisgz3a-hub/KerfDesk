# Loop 3 — laser compilation, raster semantics, and G-code emission

Status: complete

Audited tree: `claude/vcarve-stamp-subcell` at `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`, including the inherited working-tree changes.

## Audit design

This loop used a semantic-output audit rather than another static policy or geometry pass. Each auditor followed representative Line, Fill, and Image artifacts from scene selection through compile, preflight, preview/Frame readiness, and emitted bytes. Metamorphic probes changed one property at a time — controller dialect, power scale, selection scope, raster rotation, and geometry-engine termination — and compared the exact compiled groups or G-code. The adversarial verifier independently retraced every retained candidate and rejected claims that depended on unqualified firmware or hardware behavior.

The primary and blind auditors worked independently. Their reconciled findings were then double-checked by the adversarial verifier; findings L3-02 through L3-04 also have independent executable counterexamples run by the coordinating auditor.

## Research and verification base

Repository authorities:

- `PROJECT.md:346-370`, especially the no-partial-output and one-power-scale contracts
- `DECISIONS.md` ADR-020, ADR-036, ADR-095, ADR-243, and ADR-257
- current compile, dither, selection-scope, raster-sampling, preflight, emitter, and focused test paths cited per finding

External primary sources:

- Official Grbl, [Laser Mode](https://github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md): `$32=1`, `M3` constant power, `M4` dynamic power, dark `G0`, and modal `S` behavior.
- Official Grbl, [v1.1 configuration](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration#30---max-spindle-speed-rpm) and [G-code parser source](https://github.com/gnea/grbl/blob/master/grbl/gcode.c): `$30` defines the spindle/laser maximum scale and `S` is parsed as a numeric word.
- LightBurn, [Configuring a GRBL-based laser](https://docs.lightburnsoftware.com/latest/Guides/GRBLConfiguration/): GRBL 1.1e and older lack variable-power `M4` support and use the GRBL-M3 device type.
- LightBurn, [Image Mode](https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/ImageMode/) and [Arrange Menu](https://docs.lightburnsoftware.com/2.1/Reference/UI/ArrangeMenu/): Pass-Through engraves the image without resampling, while ordinary artwork may be rotated in 90-degree steps.
- Marlin, [Laser/Spindle Configuration](https://marlinfw.org/docs/configuration/2.0.9/laser_spindle.html), [`M3`](https://marlinfw.org/docs/gcode/M003.html), and [`G0`/`G1`](https://marlinfw.org/docs/gcode/G000-G001.html): used only to bound the withheld Marlin qualification claim.

## Focused executable checks

The broad emitter/compiler sample passed 14 files and 122 tests (exit 0): Grbl, Marlin, Smoothie, raster emitter, fill/kerf diagnostics, preparation, and G-code emission.

The partial-output/dialect sample passed 7 files and 41 tests (exit 0):

```text
pnpm vitest run src/core/job/offset-fill.test.ts src/core/job/offset-fill-diagnostics.test.ts src/core/job/compile-job-offset-fill-diagnostic.test.ts src/core/job/compile-job-kerf-offset-diagnostic.test.ts src/core/job/compile-job-fill-cache.test.ts src/core/output/grbl-strategy.fill-power-mode.test.ts src/core/output/marlin-strategy.test.ts

Test Files  7 passed (7)
Tests       41 passed (41)
```

The selection/rotation sample passed 4 files and 13 tests (exit 0):

```text
pnpm vitest run src/core/job/compile-job-raster-mask.test.ts src/core/job/compile-job-raster-adjustments.test.ts src/ui/workspace/draw-preview.parity.test.ts src/core/scene/output-scope.test.ts

Test Files  4 passed (4)
Tests       13 passed (13)
```

These passing tests pin the current behavior. They do not disprove the deliberately uncovered relations below.

## Independent semantic probes

All three coordinating probes used Node's read-only TypeScript loader against the current files and exited 0.

Power-scale probe, identical 100% Line and black Image under `maxPowerS=100000`:

```json
{
  "linePreflight": { "ok": true, "issues": [] },
  "rasterPreflight": { "ok": true, "issues": [] },
  "lineBytes": ["M4 S0", "G0 X10.000 Y390.000 S0", "G1 X11.000 Y390.000 F1500 S100000", "M5"],
  "rasterBytes": ["M4 S0", "M5", "M4 S0", "G0 X5.000 Y389.500 S0", "G1 X10.000 F1500 S0", "G1 X11.000 S34464", "G1 X16.000 S0", "M5"]
}
```

Selected-only image-mask probe:

```json
{"fullS":[0,300,300,0],"selectedS":[300,300,300,300],"fullActive":1,"selectedActive":1}
```

Non-square Pass-Through rotation probe:

```json
[
  {"rotation":0,"pixels":[4,2],"bounds":[4,2],"s":[149,112,74,36,300,262,225,187]},
  {"rotation":90,"pixels":[4,2],"bounds":[2.0000000000000004,4],"s":[36,36,187,187,149,149,300,300]}
]
```

## Reconciled findings

### L3-01 — `grbl-compatible` emits `M4` despite promising compatibility with controllers that lack it

- State: **Confirmed — source/test/upstream contradiction; verifier-retained**
- Severity: **P1**
- Trigger: select `grbl-compatible` for GRBL 1.1e-or-earlier or another controller without `M4`, then emit a Fill or Image group.
- Mechanism: `src/core/devices/gcode-dialects.ts:94-104` explicitly describes the dialect as the escape hatch for firmware where `M4` does not exist, but only `cutPowerMode` is constant; Fill and Image remain dynamic. `src/core/output/grbl-strategy.fill-power-mode.test.ts:61-84` pins `M5` followed by `M4 S0` for a Fill, and `src/core/output/grbl-strategy.ts:357-387` feeds the raster power mode into Image emission.
- External check: LightBurn's official GRBL configuration guide states that 1.1e and older lack variable-power `M4` support and require the GRBL-M3 device type.
- Impact: the alleged compatibility program contains an unsupported command and can stop on a controller error instead of executing the promised constant-power form.

### L3-02 — raster power wraps modulo 65,536 above the storage width

- State: **Confirmed — independently reproduced and verifier-retained**
- Severity: **P1**
- Trigger: an accepted custom or saved profile has `maxPowerS > 65535` and an Image operation contains a nonzero burn pixel. Machine Setup itself permits values up to 100,000 (`src/ui/laser/DeviceProfilePowerFields.tsx:16,31-44`).
- Mechanism: `src/core/job/compile-job-raster.ts:92-95` calculates `sMax` from the declared device scale. Materialized and streamed dithering store it in `Uint16Array` (`src/core/raster/dither.ts:21-25,82-89`; `src/core/job/compile-job-raster.ts:109-139`), after which `src/core/raster/emit-raster.ts:47-52,240-242,264-279` emits the wrapped integer directly. `src/core/devices/profile-catalog.ts:304-321` and `src/io/project/project-shape-validator.ts:67-81` require a positive `maxPowerS` but impose no 65,535 limit.
- Reproduction: both preflights passed. The same 100% request emitted `S100000` for Line and `S34464` for a black Image.
- Corroborating test: `src/ui/image-editor/editor-kerf-output-parity.test.ts:150-161` already pins `maxPowerS: 65537` to a raster black value of `1`, unintentionally demonstrating the wrap.
- Impact: one project/profile power scale has operation-dependent physical semantics; the Image bytes do not represent the declared scale.
- Boundary: this finding does not claim every controller accepts 100,000. It proves the application accepts that profile and emits internally inconsistent bytes.

### L3-03 — Selected artwork only drops an image-mask dependency

- State: **Confirmed — independently reproduced and verifier-retained**
- Severity: **P1**
- Trigger: select only a raster whose `imageMaskId` references a non-output, unselected mask object.
- Mechanism: `src/core/scene/output-scope.ts:24-30` filters objects strictly by selected ID and `src/io/gcode/prepare-output.ts:67-81` compiles that filtered scene. `src/core/job/compile-job-raster.ts:53-65,235-240` searches only the scoped object list for the mask. Missing lookup becomes `null`; `src/core/raster/image-mask.ts:23-32,44-54` treats that as no mask and returns the original luma.
- Reproduction: full output compiled `[0,300,300,0]`; selected-only output for the same raster compiled `[300,300,300,300]`.
- Coverage gap: `src/core/job/compile-job-raster-mask.test.ts:25-50` covers full-scene masking; `src/core/scene/output-scope.test.ts` covers exact object pruning, not dependency closure.
- Impact: selected-only Preview, Save, Frame, and Start can engrave pixels outside the operator's mask even though the raster itself is the selected output artwork.

### L3-04 — 90-degree rotation corrupts non-square Pass-Through raster sampling

- State: **Confirmed — independently reproduced and verifier-retained**
- Severity: **P1**
- Trigger: enable Image Pass-Through on a non-square raster and rotate it 90 or 270 degrees.
- Mechanism: rotation correctly swaps the physical AABB through `src/core/job/raster-bounds.ts:16-33`, but `src/core/job/compile-job-raster.ts:96-103` unconditionally keeps the source `pixelWidth` and `pixelHeight`. `src/core/job/raster-rotated-sample.ts:73-83` then samples the swapped AABB through that unswapped grid.
- Reproduction: a 4×2 source rotated to approximately 2×4 physical bounds remained a 4×2 output grid. Its eight distinct grayscale-derived values became four duplicated pairs, omitting half of the source levels.
- Contract and coverage: `src/core/job/compile-job-raster-adjustments.test.ts:69-84` says Pass-Through uses the source image pixel grid, but its non-square fixture is unrotated. The 90-degree rotation fixture in `src/core/job/compile-job-raster-rotation.test.ts` is square and conceals the mismatch.
- External check: LightBurn describes Pass-Through as engraving the image as-is rather than resampling, and separately exposes 90-degree artwork rotation.
- Impact: compiled and emitted Image content is materially different from the source; preview/emitter agreement cannot reveal the shared corrupted preparation.

### L3-05 — compile failures can omit requested work while the surviving job remains runnable and exportable

- State: **Confirmed — independently traced and verifier-retained**
- Severity: **P1**
- Trigger: kerf compensation fails on closed Line contours while open paths survive, a raster's pixel buffer does not match its declared dimensions while a sibling group survives, or Follow Shape offsetting fails after producing some contours.
- Mechanism: `src/core/job/compile-job.ts:72-95,185-238,324-357` retains surviving groups and adds diagnostics. `src/core/job/job.ts:265-288` explicitly makes those diagnostics advisory. `src/ui/laser/compile-diagnostic-warnings.ts:1-5,25-58` turns them into Job Review strings, and none is in the compile-integrity set at `src/core/preflight/blocking-codes.ts:28-36`.
- Executable evidence: `src/core/job/compile-job-kerf-offset-diagnostic.test.ts:83-134` pins missing closed contours plus a surviving open cut. `src/core/job/compile-job-raster.test.ts:174-216` pins a missing malformed image plus a valid sibling. `src/core/job/compile-job-offset-fill-diagnostic.test.ts:55-69` pins an offset-failed layer disappearing from the executable groups.
- Contract conflict: `PROJECT.md:364-366` states that a pipeline failure writes no file and sends no stream. These are factual compile-integrity failures, one of the expressly permitted non-guard refusal categories; Frame-only does not require corrupted or incomplete compilation to remain executable.
- Impact: the reviewed and streamed bytes can be internally identical yet omit a requested part outline, fill, or image.

### L3-06 — Follow Shape's 2,000-level cap emits a known partial fill

- State: **Confirmed — exact real-geometry test and verifier-retained**
- Severity: **P1**
- Trigger: a valid closed region remains nonempty after 2,000 inward offsets, such as a 300 mm square at the effective 0.05 mm minimum interval.
- Mechanism: `src/core/job/offset-fill.ts:5-7,26-47,60-64` caps work at 2,000, returns every contour produced so far, and reports `pass-limit` when usable geometry remains. The retained subset becomes an executable Fill group, while `src/core/job/offset-fill-diagnostics.ts:7-18` keeps the condition non-blocking.
- Reproduction: `src/core/job/offset-fill.test.ts:60-78` produces 2,000 contours and leaves a 100.05 mm interior span. `src/core/job/offset-fill-diagnostics.test.ts:20-57` proves the result is previewable, Frame-ready, G-code-emitting, and has zero preflight issues.
- Contract classification: the incomplete result is caused by an imposed work cap and partial rewrite; it is not an inherent inability to compile merely because the code labeled its termination.
- Impact: an operator can Preview, Frame, Save, or Start a large Fill with substantial interior artwork knowingly absent.

## Narrowed and withheld candidates

- **Marlin inline mode:** `src/core/output/marlin-strategy.ts:15-21` reuses the Grbl body and the `marlin-inline` output does not contain Marlin's `I` inline-selection word. Current Marlin documentation distinguishes Standard Mode from `M3 I`/`M4 I`, but behavior also depends on firmware version and build flags. The shipped profile says Marlin builds vary and is simulator-only (`src/core/devices/profile-catalog.ts:139-164`). This is retained as a P2 device-qualification gap, not counted as a universal emitted-power defect.
- **Rotary raster Labs refusal:** confirmed governance concern, but it is owned by Loop 1 and withheld here to avoid double-counting.
- **Fill collapsed at output precision:** factual missing detail, but the sampled fixtures are microscopic and the impact is narrower than L3-05. It remains covered by that family rather than receiving a separate ID.

## Correctly rejected laser/G-code candidates

- Modal `S` and `F` omission is not by itself a defect: first vector/raster moves reassert required state and travel is explicit `S0`, consistent with official Grbl modal/laser-mode behavior.
- Blank raster rows do not need to consume bidirectional parity; the implementation alternates emitted active rows and tests pin reverse `S` ordering.
- Surface-space rotary preview versus machine-space Frame/estimate/emission is intentional and documented; no divergent emitted artifact was reproduced.
- Generic Marlin physical failure was not claimed without a particular firmware build and device qualification.

## Limitations

- The audited branch is 209 commits behind and 36 commits ahead of the then-local `origin/main`; findings describe the exact dirty working tree.
- No G-code was sent to a controller, no laser was fired, no workpiece was measured, and no perceptual renderer comparison was performed.
- Focused tests and deterministic probes are source/runtime evidence, not hardware qualification.
- No source fix was implemented.

## Loop decision

Loop 3 closes with six canonical findings: one dialect-compatibility failure, three independently reproduced raster semantic failures, and two independently verified partial-output failures. The conditional Marlin question remains explicitly unqualified. Loop 4 starts the CNC physical-motion audit.
