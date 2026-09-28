## ADR-492 - Image scan angle, image cross-hatch and an angle change per pass (2026-09-28)

**Status:** Accepted. | **Date:** 2026-09-28

Builds item 1 of the Rayforge comparison's build list and LBG-C06 from
`docs/audits/2026-09-26-lightburn-gap-audit.md`, under the owner's direction of 2026-09-27 to build
everything Rayforge does better and make it better than theirs. All three settings are off by
default: an existing project emits the same G-code, byte for byte. No new guard or refusal
(ADR-228).

### Context

Rayforge's raster step scans an image at any angle, can cross-hatch it, and can turn the angle
between passes. LightBurn's Image mode offers scan angles and an Angle Increment per pass. KerfDesk
scanned every image along machine X (`raster-sweep-plan.ts`). Only vector Fill had a hatch angle
and cross-hatch, and no operation could turn between passes.

Rayforge applies its bidirectional scan offset along X whatever the scan angle, so an angled
bidirectional engrave comes out misaligned. KerfDesk's scan offset is a per-speed table applied
along the direction of travel. This build keeps it along travel at every angle.

### Decision

1. **Three optional operation settings.** `imageScanAngleDeg` (degrees, counter-clockwise from
   machine X, like a Fill's hatch angle), `imageCrossHatch` (every image pass scans again at +90°)
   and `passAngleStepDeg` (added to an Image's scan angle or a Fill's hatch angle on every pass).
   They join `LayerOperationSettings`, artwork overrides and sub-operations. The validator checks
   their type, and like the ADR-415 settings they are captured only when set, so saved process
   recipes keep their key set. Copy and Paste settings carries them. Absent, 0 and 180 all mean
   along X, which compiles byte-identically to the output before them. There is no schema bump: an
   older build ignores them and scans the same picture along X.
2. **Pass runs** (`core/job/scan-pass-angles.ts`). Pass k runs at base + k × step, folded into
   [0°, 180°), and cross-hatch adds base + 90° after each pass. Consecutive passes at the same angle
   merge into one run. An operation with no step and no cross-hatch keeps one run with all its
   passes, so it compiles to the one group it always did. A step applies only with more than one
   pass, and a step of 0° or 180° does nothing.
3. **One raster group per run.** `compileRasterGroupsForLayer` compiles one group per run, in pass
   order, and each group carries its `passes`. Runs at the same angle share one compiled grid. A
   group scanned off X records `scanAngleDeg` in (0, 180); along X the field is absent.
4. **The scan frame** (`core/raster/raster-scan-frame.ts`). A group's bounds, pixel grid, rows,
   overscan runways, dot-width correction and bidirectional scan offset all live in its scan frame,
   whose +X is the scan direction. A scan-frame point reaches the bed through a rotation about the
   machine origin by the scan angle, snapped so 90° is exact. Because every per-row quantity is
   measured along the scan, the scan offset and the overscan stay on the line of travel at every
   angle. At 0° the frame is the machine frame and nothing is rotated.
5. **Sampling.** An angled scan samples each scan-frame pixel centre back through the scan rotation
   and the object transform into the source bitmap. It uses the inverse-transform sampler rotated
   images already use, streamed or materialized with the same bytes, masked at source resolution.
   The sampler's quarter-turn test counts the scan angle and the origin's mirror, so an image turned
   with the scan lines up with its own cells again (pass-through, area reduction). With a quarter
   turn between them, the pass-through grid swaps its axes.
6. **Emission** (`emit-raster-row-line.ts`). The sweep planner still plans along the row in one
   coordinate. Along X a burn move writes only its X word, exactly as before. At an angle each
   scan-frame position becomes a machine point rounded to the controller's three-decimal grid on
   each axis, and a move writes X and Y. The modal writer still drops a word that did not change.
   The M3 opening, the held power and the entry excursion follow the same rules along the rotated
   row. The header adds `; scan angle N deg` only when angled.
7. **Every consumer places rows the same way.** The preview toolpath (`toolpath-raster-steps.ts`),
   the first-burn marker, Frame and job bounds (the rotated corners of the burn, overscan and
   reverse-shift rectangles), job placement (a machine offset turned into the scan frame),
   coordinate encodability, the recovery archive's raster recipe match (which also compares the
   angle) and the canvas raster preview (drawn through an affine transform) all read `scanAngleDeg`.
   The estimator parses the emitted G-code, so time estimates follow. Ruida export still refuses
   raster output.
8. **Fills.** With an angle change per pass, a scanline or island Fill compiles one group per run
   of passes at one hatch angle. Its cross-hatch stays inside each group's hatch pattern as before.
   Offset rings have no angle, so an Offset fill keeps its one group.
9. **Rotary.** A rotary maps Y through a scale that only keeps rows along X straight. On a rotary
   device an image scans every pass along X, and Job Review says the angle settings were set aside
   (`image-scan-angle-rotary`). No refusal.
10. **Controls.** In Cut Settings, Image detail gains a direction preview, **Scan angle** (0 to 180),
    **Cross-hatch** and **Angle per pass**. Fill detail gains **Angle per pass** for scanline and
    island fills. A form without these fields leaves the stored values alone. Angles stored from
    elsewhere are folded into the field's range, so they never block Apply. Job Review's detail line
    reads e.g. "scan at 45° · cross-hatch · angle -30° per pass", only when set.
11. **Image editor Thicken** (ADR-246's repair) paints along editor rows, which are output rows only
    along X. It stays warning-only when any pass scans at an angle.

### Alternatives

- **Rotate the image and scan along X.** Rejected: rotating the bitmap resamples it twice, and the
  scan offset and overscan would still be applied along machine X, which is the defect in Rayforge's
  version.
- **Scan angle in scene coordinates.** Rejected: Fill's hatch angle is in machine coordinates, and
  the same number should scan an image and hatch a shape the same way on the bed.
- **One raster group with per-pass angles inside it.** Rejected: every emitter, the preview, both
  estimates, Frame and the recovery archive would need to know about passes inside a group. A group
  per run needs none of that.
- **Refuse scan angles on a rotary.** Rejected under ADR-228. Scanning along X with a notice is the
  output the operator got before, and it is honest.

### Consequences

- Output changes only for operations that set a scan angle, image cross-hatch or an angle change
  per pass.
- An angled raster writes both axis words on every move, so its G-code is larger than the same
  image along X. The compiled-work estimate's per-run allowance (48 bytes) already covers it.
- An angled image's bounding box in the scan frame is larger than the image, so it has more white
  pixels. Blank rows are skipped as before, and white ends of rows are not scanned.
- The canvas preview draws the first pass's grid only; the toolpath preview shows every pass.
- LightBurn import does not map LightBurn's Angle Increment yet.

### Verification

- `raster-scan-frame.test.ts`, `scan-pass-angles.test.ts`: angle folding, exact 90°, round trips,
  pass runs, cross-hatch and merging.
- `compile-job-raster-scan-angle.test.ts`, on all four origins:
  - G-code identical at 0° and 180° to the absent setting.
  - A 90° scan burns the same column along Y that a 0° scan burns along X, with the same length.
  - 45° burns stay inside the image and fill it (M3 and M4).
  - Frame motion bounds cover every emitted move.
  - The preview toolpath and first-burn marker land on the G-code's burns.
  - Placement moves an angled scan by its offset.
  - Pass-through lines up with an image turned with the scan, and swaps its grid at a quarter turn.
  - Cross-hatch and per-pass groups come out in pass order.
  - A rotary scans along X with the notice.
- `compile-job-raster-stream.test.ts`: streamed rows match the materialized pipeline at 45° and at
  120° on a rotated, masked image.
- `compile-job-fill-pass-angle.test.ts`: per-pass hatch directions, unchanged output without a
  step, Offset fills untouched.
- `output-preparation.test.ts`: a cross-hatched, streamed image survives the recovery archive and
  rehydrates to the sealed bytes.
- `cut-settings-draft.test.ts`, `CutSettingsDialog.scan-pattern.test.tsx`,
  `project-cut-extras.test.ts`, `job-review-scan-pattern-facts.test.ts`,
  `editor-kerf-thicken-target.test.ts`: form reading and clamping, stored values that open without
  blocking Apply, file round trip and rejection, capture only when set, Job Review wording, Thicken
  refusal.
- Not tried on a machine. A scrap test should burn a 45° scan bidirectionally at speed, to confirm
  the scan offset still closes the rows, and a cross-hatched image, to judge the finish.
