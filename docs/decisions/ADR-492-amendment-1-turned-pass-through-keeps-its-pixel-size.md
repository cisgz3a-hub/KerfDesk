## ADR-492 Amendment 1 - A turned Pass-Through image keeps its own pixel size, and Job Review says it is resampled (2026-10-28)

**Status:** Accepted. Amends ADR-492 Decision 5 (sampling) and its Verification, and the
pass-through clause of ADR-313 Decision 4. Fixes quality audit Q2 findings Q2-P1-1 (P1) and
Q2-P2-1 (P2), and closes the test gap Q2-P3-3
(`docs/audits/2026-10-27-quality-q1/Q2-raster-geometry.md`). No new guard or refusal (ADR-228):
Frame, Start, output policy and licences are unchanged. | **Date:** 2026-10-28

### Context

ADR-492 Decision 5 lines Pass-Through up with an image turned with the scan, and swaps its grid at a
quarter turn. ADR-313 Decision 4 made the same quarter-turn swap. No decision covered any other angle.
There, compile kept the source's pixel count but spread it over the turned image's bounding box in
the scan frame. The rows landed 1.08 times (5°) to 1.41 times (45°) further apart than the image's
pixels, and 15–64 % of the pixels were never burned. A pre-dithered 50 % checker burned at about 36 %
at 37°, and at 18–71 % at exactly 45°, depending on placement. Nothing warned, while Cut Settings
promised that Pass-through "keeps original pixels and density" (Q2-P1-1).

Separately, the upsample advisory sized the burn grid from the turned image's machine bounding box.
That box also spans the image's empty corners. Every image turned off a quarter turn was therefore
told that "the engrave will be softer … Lower lines/mm", even a source denser than the grid.
Following the advice made the burn worse (Q2-P2-1). For the same reason, a non-square image turned
a quarter turn compared its width against its height.

**What LightBurn does** (researched 2026-10-28):

- **Current documentation.** LightBurn's 2.0 Image Mode page says Pass-Through engraves the image
  as-is instead of resampling it, and that the image's size fixes its line interval and DPI. The page
  does not mention rotation.
- **Earlier documentation.** The engraving-images page in its documentation repository (2019) says
  a Pass-Through image cannot be rotated, because rotation needs resampling.
- **Staff answers on the LightBurn forum.**
  - 2019: exact multiples of 90° are handled as a special case. For any other angle, staff advised
    rotating the image in the program that made it, or turning Pass-Through off and letting LightBurn
    dither it.
  - November 2020: Pass-Through means "no resampling allowed". An off-angle scan cannot be done
    without resampling, because LightBurn rotates the image, scans it horizontally and turns the path
    back. The question in that thread reports that only 0°, 90° and 180° are offered as scan angles
    with Pass-Through on.
- **Sources:**
  - https://docs.lightburnsoftware.com/2.0/Reference/CutSettingsEditor/ImageMode/
  - `LightBurnSoftware/Documentation@1741e66e9b` `EngravingImages.md`
  - https://forum.lightburnsoftware.com/t/image-cut-in-pass-through/4196
  - https://forum.lightburnsoftware.com/t/image-rotation-problem/3774
  - https://forum.lightburnsoftware.com/t/pass-through-and-engrave-angle-question/26103

LightBurn therefore never scans a Pass-Through image off its own axes. It keeps the image's DPI,
handles quarter turns, and points the operator at the source program or at turning Pass-Through off.

### Decision

1. **The grid keeps the image's own pixel size** (`core/job/raster-pass-through-grid.ts`).
   - A Pass-Through image lines up with its scan when it is not turned and scans along X, or when the
     sampler's quarter-turn test (`sourceQuarterTurn`, which counts the scan angle and the origin's
     mirror) finds a whole number of quarter turns between them. It then keeps its pixel grid as
     before, swapped at a quarter turn.
   - At any other angle the grid covers the same scan-frame box with cells of the image's own pixel
     size: `round(box ÷ pixel size)` along each scan axis. The pixel size is the finer of the image's
     two axes, so neither axis is read more coarsely than it is stored.
   - The sampler is unchanged. It reads the untouched source with one centre sample per cell (ADR-359
     Decision 3), and white beyond the image. So the rows sit one image pixel apart, which matches
     LightBurn's rule that the image's size fixes its DPI, and the tone of a pre-dithered pattern
     holds.
   - The grid may need up to about twice the source's pixel count at 45°. Streaming (ADR-243) covers
     a large grid as before.
2. **Job Review says the image is resampled** (`ui/laser/raster-pass-through-warnings.ts`). One
   warning per image and operation, whichever of its passes is turned. It names:
   - the turn and the scan angle;
   - the pixel size kept;
   - that each cell takes the nearest source pixel, so single pixels of a pre-dithered pattern can
     drop out or double up as a moiré the canvas does not show.

   It then gives LightBurn's remedies, plus KerfDesk's own:
   - set the scan angle to the image's angle (computed, e.g. 143° for a 37° turn on a front-left
     origin; left out on a rotary, which scans along X);
   - turn the image to a multiple of 90°;
   - rotate it in the program that made it and import it again;
   - or turn Use original pixels off.

   It is a warning only, never a gate. The Cut Settings and Adjust Image help text says that only an
   image square to its scan direction keeps its pixels one for one.
3. **The upsample advisory counts burn cells along the image's own width and height**
   (`describeRasterUpsample`): pixel extent of `bounds × |scale|` at the operation's lines/mm. This is
   the measure the rotated sampler and the Threshold advisory already use. A turn alone never
   triggers it. A real upsample still does, and reports the grid along the image (80 × 80 for 64 px at
   8 px/mm, turned or not, where it said 112 × 112 at 37°).
4. **One sizing for every consumer.** These all size a Pass-Through grid through
   `rasterPassThroughDimensions`:
   - compile;
   - the canvas preview's cache key and display advisory (`compiledGridDimensions`);
   - the photo engraving preview budget;
   - the raster preparation work-unit count.

   The bitmap preview draws the compiled group, so it shows the grid the G-code burns.

### Alternatives

- **Scan a turned Pass-Through image along its own axes** (a scan frame at the image's angle, which
  the scan-frame code supports and which burns every pixel exactly once). Rejected. It would override
  the scan angle the operator chose, often moving the slower axis on every row. LightBurn never scans
  Pass-Through off its axes. The warning offers this as the remedy instead, so the operator chooses
  it.
- **Refuse or disable Pass-Through at a non-quarter angle.** Rejected under ADR-228 and AGENTS.md:
  the program can be produced, so this is a policy finding for Job Review.
- **Warn and keep the stretched grid.** Rejected. It knowingly burns the wrong density and tone for
  anyone who misses the warning. The image-pitch grid costs nothing in placement (every run lands on
  the pixel it reads) and keeps LightBurn's DPI rule.
- **Resample at the operation's lines/mm with a tone kernel.** Rejected. Pass-Through's DPI is the
  image's, and averaging a pre-dithered pattern dissolves the dots it exists to keep. Turning Pass-
  Through off already gives this, and the warning says so.

### Consequences

- Output changes only for a Pass-Through image turned off its scan rows. `EMITTER_REVISION` moves to
  `raster-turned-pass-through-20261028-v35`. An upright, quarter-turned, half-turned or scan-aligned
  Pass-Through image compiles byte for byte as before. So does every resampled image.
- Measured from the emitted G-code on a 15 × 15 px, 0.1 mm image (`compile-job-raster-turned-burn.test.ts`):
  - Row pitch is 0.100 mm at 37°, 0.101 mm at 45° and 0.102 mm at 5° and 60°. Before, it was 0.108
    to 0.141 mm. The residue is the even spread of rows over the box (KNOWN 20-K-6).
  - The pixels read are 100 % at 37°, 98 % at 5° and 82 % at 45° and 60°. Before, they were 38–85 %.
  - A 50 % checker burns 0.503 at 37°, 0.513 at 45° and 0.503 on a 37° scan. Before: 0.36, and 0.18–0.71
    at 45°.
  - Every run lies on the pixel whose grey it burns, with a mean offset of at most 0.003 px.
- Nearest-pixel reading of a pre-dithered pattern at an angle still aliases. That is what the
  warning names, and why LightBurn does not rotate Pass-Through.
- Code and test evidence only. Nothing was burned on material, and no controller was operated.

### Verification

- `compile-job-raster-turned-burn.test.ts` (Q2-P3-3). An independent modal G-code reader, with its
  own restatement of the front-left origin and the object transform, gives every source pixel its own
  grey, so each run's S names the pixel it read. It pins position (each run on its pixel, no bias),
  row pitch and coverage:
  - for Pass-Through upright and turned with the scan (every pixel once, at its centre);
  - turned 5°, 37°, 45° and 60°, and scanned at 37°;
  - for a resampled image turned 37° at 10, 13.7 and 25 lines/mm;
  - and the tone of a checker. With the stretched grid restored, the 8 turned Pass-Through cases
    fail.
- `job-intent-warnings-turned-images.test.ts`:
  - **Upsample advisory.** It stays silent for turned 1:1 and denser sources and for a wide image
    turned a quarter, and still reports a real upsample with the grid along the image. On the old
    advisory, 7 of these fail.
  - **Pass-Through warning.** It covers the wording, one line per image, the silent cases (upright,
    quarter and half turns, turned with the scan, Pass-Through off) and the rotary wording.
