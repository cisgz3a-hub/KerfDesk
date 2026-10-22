# Controller audit v4 — E5 Material and interval tests (`ctl-material-tests`)

- **When:** 2026-10-23 00:10–01:05   **Tree:** origin/main @ `71ff820ce` (worktree `src/`); re-checked
  against origin/main @ `6649d6590`. Between the two, the only changes on the emission path are in
  the dialog preview (`MaterialTestPreview.tsx`, `material-test-preview.ts`) and a refactor that
  moves the cell-size clamp into `materialTestCellDimensions` (`material-test-grid.ts:151-159`).
  Every finding site below is byte-identical on `6649d6590`. Line numbers for
  `material-test-grid.ts` and `material-test-preview.ts` are main's; all others are the same on
  both trees.
- **Scope:**
  - Generators: `src/core/job/{material-test-grid,material-test-axes,material-test-layout,interval-test-grid,calibration-labels}.ts`.
  - Dialogs: `src/ui/calibration/{material-test-draft,material-test-preview,calibration-draft-validation,calibration-draft-storage}.ts`,
    `MaterialTestDialog.tsx`, `IntervalTestDialog.tsx`, `MaterialTestPreview.tsx`,
    `src/ui/commands/CalibrationGridDialogs.tsx`.
  - Read for twins and the emission path: `src/core/job/{compile-job,vector-group-fields,fill-hatching,automatic-overscan,optimize-paths,topology-cut-packets}.ts`,
    `src/core/effective-output/effective-output.ts`, `src/io/gcode/{prepare-output,emit-gcode}.ts`,
    `src/core/preflight/preflight.ts`, `src/ui/material-library/capture-material-experiment.ts`,
    `src/core/material-library/capture-process-recipe.ts`,
    `src/ui/laser/job-review/{job-review-effective-operations,job-review-detail-facts}.ts`,
    `src/ui/layers/CutSettingsFillDensityFields.tsx`, `src/core/devices/origin-transform.ts`,
    `src/ui/commands/machine-command-gate.ts`.
- **Governing:** ADR-044 (calibration grids are ordinary scenes through the one pipeline; hardware
  check of label readability and ordering), ADR-497 (any two settings, D3 gentlest cell first, D4
  one operation per row, D6 runway for the fastest cell, D7 labels), ADR-495 (automatic overscan),
  PROJECT.md non-negotiables 2 (origin honesty), 5 (determinism), 7 (power scale honest).
- **Primary sources fetched:**
  - LightBurn Material Test 2.1 (`docs.lightburnsoftware.com/2.1/Reference/MaterialTest/`): the
    test order is "an ascending list" in which "boxes with the highest Speed, lowest Power, lowest
    Interval, and fewest Passes will run first". Speed labels run down the left and power labels
    along the bottom. "At the top, the sample shows additional universal settings" (Interval,
    Passes, Frequency). Edit Material Setting holds the base settings, and "all other settings
    applied here will apply to every test box". Separate Edit Text Setting and Enable Text control
    the labels. Placement follows the Start From mode.
  - LightBurn Material Test 1.7: same order sentence. No "use current layer settings" option exists
    in either version; base settings come from Edit Material Setting ("Base settings for the test").
  - LightBurn Interval Test (legacy): Min/Max Interval are "the lowest and highest interval
    settings", Steps is the swatch count, and speed and power are shared by every swatch. Nothing on
    order, labels or overscan.
  - gnea/grbl master `stepper.c`: in laser mode, `if (st_prep_block->is_pwm_rate_adjusted) { rpm *=
    (prep.current_speed * prep.inv_rate); }` (M4 scales power by the current speed).
- **Lenses run:** L1, L2, L3, L4, L7 as separate passes. L5 (only `.lftest` preset files enter;
  they merge string fields and pass the same validation) and L6 (an Experiment capture failure is a
  warning toast; the grid is still generated) were checked briefly and gave nothing.
- **Counts:** 9 raised → 0 refuted (refuter: 9 CONFIRMED, 0 PLAUSIBLE; severity change: P2-4 →
  P3) → P1 0 / P2 3 / P3 6 (+ 6 KNOWN). The finding keeps its ID `E5-P2-4`.

## Headline

On every dialect, for speed, power and passes, each cell's burned value matches the label and
Job Review. S, F and pass counts match per cell on GRBL `$30` 1000/255/1, GRBL M3, Marlin inline,
Marlin fan and Smoothieware, and a saved project re-emits byte-identical G-code. The defects are at
the edges the dialog allows.

- **P2-1:** a hatch spacing below 0.05 mm is labelled, previewed and recorded in the Experiment, but
  burned at 0.05 mm.
- **P2-2:** the default 10 × 10 grid burns column labels that overlap ("23.33" runs into "26.67").
- **P2-3:** Cut grids on right-side or centre-origin machines cut each row's hottest cell first.
- **P2-4 (refuter: P3):** rows faster than about 9,000 mm/min (at 500 mm/s²) never reach the
  labelled speed, while the dialog says the runway reaches it. The 25 mm cap is an accepted limit
  (ADR-238 Amd 3, ADR-495), and on M4 the burn still follows the label.

## Cell label → emitted values

The repro generated each grid with the real generator. It emitted through `emitGcode` (prepare →
compile → place → optimise → strategy) and parsed every lit G1 back into cells by position:
`zz-e5-cells.test.ts`, 6 grids × 7 dialects, 1,316 cells. Percentages are emitted S ÷ S max.
Mismatches: speed 0, power 0, passes 0, interval 42 (3 cells × 7 dialects in each of two grids; all
P2-1).

| Grid / dialect | Cell | Row label | Column label | Emitted | Source |
|---|---|---|---|---|---|
| default 10×10 / GRBL `$30=1000` M4 | r0c0 | 3000 | 10 | F3000, S100 (10%), 1 pass, 0.1 mm × 50 lines | `material-test-axes.ts:115-121`, `effective-output.ts:54-57` |
| same | r0c1 | 3000 | 13.33 | F3000, S133 (13.3%) | same, ±0.5 S rounding (E1) |
| same | r9c9 | 1000 | 40 | F1000, S400 | same |
| default / GRBL `$30=255` | r0c1 | 3000 | 13.33 | F3000, S34 (13.33%) | same |
| default / GRBL `$30=1` (virtual range) | r0c1 | 3000 | 13.33 | S0.133 | ADR-567 Amd 1 |
| default / GRBL Constant (M3) | r9c9 | 1000 | 40 | F1000, S400 | same |
| default / Marlin inline 255 | r0c0 | 3000 | 10 | F3000, S26 (10.2%) | same |
| default / Marlin fan | r9c9 | 1000 | 40 | `M106 S102` (40%) | same |
| default / Smoothieware S max 1 | r0c1 | 3000 | 13.33 | S0.133 | same |
| power rows × speed columns, 500–9000, max feed 6000 / GRBL | r1c0, r1c1 | 16.67 | 6000, 6000 | F6000 both (9000 and 6875 requested), S167 | `material-test-axes.ts:62-70` (labels show the effective feed); Job Review `speed-out-of-range` advisory per row |
| same | r6c4 | 100 | 500 | F500, S1000 | — |
| hatch rows 0.01–0.2 × power / GRBL 255 | r3c0 | 0.057 | 20 | spacing 0.0575, 70 lines | `fill-hatching.ts:131-142` |
| same | r4c0 | **0.01** | 20 | **spacing 0.05**, 80 lines | **P2-1** (`fill-hatching.ts:45,88-90`) |
| speed rows × hatch columns 0.03–0.3 / Marlin fan | r0c3 | 4000 | **0.03** | F4000, `M106 S64`, **spacing 0.05** | **P2-1** |
| Cut, power rows × passes columns / Marlin inline | r2c3 | 90 | 4 | F300, S230, 4 outline passes | `material-test-grid.ts:332-344` |
| Cut / Smoothieware | r1c2 | 50 | 3 | F300, S0.5, 3 passes | same |
| power columns 0–100 / GRBL | r0c0 | 2000 | 0 | no lit move (S0 runs only) | correct for 0% |

Interval Test (`zz-e5-twin.test.ts`, with a scan-offset table and bidirectional fill): every swatch's
emitted spacing equals its label for 0.05–0.2 × 10, 0.08–0.2 × 10, 0.05–1 × 5 and 0.3–3 × 4. For
example "0.183333" → 0.1833, "0.7625" → 0.7624 (3-decimal coordinates), "3.00" → 3.0000.

## Findings

### P2-1 — Material Test accepts hatch spacing down to 0.01 mm and burns those labels on the card, but every cell below 0.05 mm is filled at 0.05 mm

- **Where:**
  - `src/core/job/material-test-axes.ts:21` (`MIN_TEST_INTERVAL_MM = 0.01`) and `:164-169`.
  - `src/ui/calibration/material-test-draft.ts:106-114`: the dialog field's minimum is 0.01, in
    steps of 0.001.
  - `src/core/job/fill-hatching.ts:45` (`MIN_HATCH_SPACING_MM = 0.05`) and `:79-90`: the laser fill
    plans at `max(0.05, requested)`.
  - Twins that keep the requested value: the preview's dose (`material-test-preview.ts:69,77`), the
    Experiment record (`capture-material-experiment.ts:19-43` via
    `capture-process-recipe.ts:66-80`), and Job Review's override text
    (`job-review-detail-facts.ts:76`).
- **Anchor:**
  - **Contract:** ADR-497 D7, "Burned labels show each row's and column's value"; ADR-044, grids
    use the same pipeline, so a label must be what that pipeline burns.
  - **Twin:** the Interval Test enforces the engine's floor (`IntervalTestDialog.tsx:47-48` min
    0.05; `interval-test-grid.ts:27` `MIN_INTERVAL_MM = 0.05`). So does Cut Settings' Line Interval
    (`CutSettingsFillDensityFields.tsx:75`, 0.05–10).
- **Scenario:** A diode user tests fine engraving with Rows vary = Hatch spacing, 0.01 to 0.05, five
  rows. The dialog shows no issue. The card burns row labels 0.05, 0.04, 0.03, 0.02 and 0.01, but
  all five rows are filled at 0.05 mm. The dialog preview shades the 0.01 row 5× deeper than the
  0.05 row. The Experiment records 0.01–0.04 as the "exact cell settings". Job Review's override
  line says "0.03 mm hatch". The only true trace is the G-code comment `; effective hatch plan:
  interval 0.05 mm`. The operator reads identical cells as "spacing below 0.05 makes no
  difference". If they pick 0.03 from the Experiment, Cut Settings will not accept it for a new
  entry, because its minimum is 0.05.
- **Evidence:** REPRO.
  - `zz-e5-cells.test.ts`, 7 dialects: `g3 r4c0: interval label 0.01 emitted 0.05` (80 lines in
    4 mm), and `g5 r0c3: interval label 0.03 emitted 0.05`.
  - `zz-e5-experiment.test.ts`: `dialog issues: []`;
    `row labels burned: 0.05, 0.04, 0.03, 0.02, 0.01`;
    `preview energies col0: 0.05:0.05 … 0.010000000000000002:0.25`;
    `experiment hatch per row: 0.05, 0.04, 0.030000000000000002, 0.020000000000000004, 0.010000000000000002`.
- **Known/related:** the root clamp is KNOWN as rolling-v2 21-P3-4, where a LightBurn import with an
  interval below 0.05 burns at 0.05. That finding covers the import path. This one is a different
  entry point: KerfDesk's own dialog invites the value and burns a false label onto the calibration
  card.
- **Refuter:** **CONFIRMED** (REPRO + READ). P2 kept, at the low end. What would refute it: a
  hatch path for Material Test cells that skips `effectiveHatchSpacingMm`, a dialog check that
  refuses values below 0.05, or a documented reason for the 0.01 floor. None holds.
  - **Repro, run independently** (`zz-e5r-refute.test.ts`, deleted): rows 0.05 → 0.01 × power,
    4 mm cells, `emitGcode` on the default profile. Every row emits 80 lit rows with a mean spacing
    of 0.0500 mm (`r4c0 label interval 0.010000000000000002 -> 80 lit rows, mean spacing 0.0500`).
    The burned row labels are `0.05, 0.04, 0.03, 0.02, 0.01`.
  - **The floor is not documented.** No ADR names 0.05 mm. Its only record is the code comment
    at `fill-hatching.ts:41-44` (F.1, commit `445e9e0f5`) and the twin field ranges.
    `MIN_TEST_INTERVAL_MM = 0.01` came in with ADR-497 (`48060d0c5`), and the ADR gives no reason.
    The only unclamped planner, `fillHatchingExactWithBudget`, serves CNC pockets
    (`pocket-paths.ts:276`). The laser fill always clamps.
  - **LightBurn:** the 2.1 Material Test page gives Min/Max with no lower limit, and the Fill
    page gives no minimum Line Interval. LightBurn's legacy Interval Test suggests starting Min at
    "0.08 mm". So below 0.05 is not the common CO2/diode case. It is the case for the catalogue's
    Falcon A1 Pro 2 W infrared module (0.03 mm spot).
  - **Severity arguments:**
    - *Down:* the dialog default (0.05–0.2) stays at or above the floor, so the operator must type
      a lower value. Every later KerfDesk job clamps the same way. Cut Settings will not take 0.03,
      and a 0.03 recipe also burns at 0.05, so no later KerfDesk job burns differently from the
      chosen cell. The G-code comment does tell the truth.
    - *Up:* the dialog field invites the value (min 0.01, step 0.001) with no warning, while both
      twins refuse it. The physical card, the preview shading (5× darker) and the Experiment record
      all state a spacing that was never burned. The operator draws a false conclusion ("below
      0.05 changes nothing") from a calibration tool.
    - *Verdict:* that is a misleading result on a path the dialog offers, so P2 is kept. It is not
      raised to P1, because no later job burns differently from the card.
- **Fix direction:** Set the Material Test interval floor to the fill engine's 0.05 mm in
  `MIN_TEST_INTERVAL_MM` and the dialog field, matching the Interval Test. Add a test that compiles
  a hatch axis down to the floor and compares emitted spacing with the labels.

### P2-2 — The default 10 × 10 grid burns overlapping column labels; any 4-digit speed column, and hatch columns, overlap too

- **Where:** `src/core/job/material-test-layout.ts:48-76`. Column labels are centred on the cell
  with `centerOffset` clamped to 0, so a label wider than the cell starts at the cell's left edge
  and runs into the next one (`:58-60`, `:90-92`). Label size comes only from the cell
  (`labelSizeForCell`, `:78-80`). Nothing fits a label to the column pitch.
- **Anchor:**
  - **Contract:** ADR-497 D7 (labels show each column's value); ADR-044 ("record whether labels …
    are readable").
  - **Twin:** the Interval Test shrinks each label to 90% of its swatch
    (`interval-test-grid.ts:153-157`), and `interval-test-label-bounds.test.ts` pins that. The
    Material Test dialog's own preview turns column labels upright when they would overlap
    (`MaterialTestPreview.tsx` `uprightColumns`).
- **Scenario:** Open Material Test with the defaults (10 × 10, power 10–40, 5 mm cells, 1 mm gap)
  and Generate. Columns 4 and 5 burn "23.33" and "26.67". Their bounding boxes overlap by 1.14 mm:
  the last "3" of one (x 37.18–38.44) and the first "2" of the next (x 37.30–38.56) are drawn on
  top of each other. The merged glyph has segments a, b, c, d, e and g. The row reads like
  "23.3▯6.67", or "23.38 6.67" / "86.67". "33.33"/"36.67" do the same. Power 0–100 overlaps at 7
  pairs. A speed-column grid (1000–6000) overlaps every 4-digit pair by 0.30 mm. Hatch columns
  0.05–0.2 overlap 6 pairs by up to 1.14 mm. The coupon an operator reads settings from has
  unreadable or misleading column labels with no warning. The overlap is visible on the canvas only
  when zoomed in.
- **Evidence:** REPRO `zz-e5-labels.test.ts` (scene label geometry; compile emits these polylines
  unchanged):
  `dialogDefault: column-label overlaps 4: "23.33" x 31.30..38.44 overlaps "26.67" x 37.30..44.44 by 1.14 mm | … "33.33" … "36.67" … by 1.14 mm`;
  `speedColumns: column-label overlaps 8 … by 0.30 mm`; `intervalColumns: … 6`;
  `power0to100x10: … 7`; `interval default: overlaps 0`.
- **Refuter:** **CONFIRMED** (REPRO + READ). P2 kept, at the low end. What would refute it: a
  label-fitting step after `materialTestLabelObjects`, or glyphs that only touch and do not
  collide. Neither holds.
  - **Repro, run independently** (`zz-e5r-refute.test.ts`, deleted): this is the default dialog
    grid. Label size is `max(1.4, min(2.5, 5·0.42, 5·0.45))` = 2.1 mm, so a 5-character label is
    17 units × 0.42 = 7.14 mm wide on a 6 mm pitch.
    - `"23.33" x 31.30..38.44`: its last "3" runs 37.18–38.44, with its right vertical at 38.44.
    - `"26.67" x 37.30..44.44`: its "2" has verticals at 37.30 and 38.56.
    - The two digits are drawn 0.12 mm apart, which is below a diode's line width. They fuse into
      segments a, b, c, d, e and g, which is no valid digit. "33.33" and "36.67" fuse the same
      way. "26.67"/"30" and "36.67"/"40" touch (0.11 mm).
    - "13.33" → "16.67" does not collide, because a leading "1" is normalised to x = 0. So the
      default card has 4 colliding pairs.
  - **Cosmetic, or misread?** Burned values are correct, and 6 of 10 column labels stay clean
    (10, 13.33, 16.67, 20, 30, 40). The fused glyph is not a valid digit, so the operator can see
    that something is wrong; the defect is not silent. Context (…20, 23.3?, ?6.67, 30…) and the
    Experiment record recover the value. But column 5's tens digit is a genuine 2/3 ambiguity
    (26.67 vs 36.67, 37% more power). The defect is on the default grid that every user burns
    first. It breaks ADR-497 D7 and ADR-044's acceptance criterion ("record whether labels … are
    readable"), and the Interval Test twin already fits its labels.
  - **Verdict:** the contract is broken, on the default path, with a clear failure scenario. P2 is
    kept but not raised: the garble is visible and recoverable, not a silent mislabel.
- **Fix direction:** Fit each column label to the column pitch, as the Interval Test does (shrink,
  or stagger and rotate). Add a bounds test like `interval-test-label-bounds.test.ts` for the
  default grid and for 4-digit speed columns.

### P2-3 — A Cut test grid is cut hottest-first within each row on right-side and centre-origin machines (and under some line-order settings), against ADR-497's "first cell burned is the gentlest"

- **Where:**
  - `src/core/job/optimize-paths.ts:88-91`: with Inside first on (the default),
    `orderTopologyScopes` runs.
  - `src/core/job/topology-cut-packets.ts:34-57`: `orderCutPackets` re-plans the Line groups of one
    operation run by distance from the cursor. Each cut cell of a power, speed or passes column is
    its own group in the row's operation (`material-test-grid.ts:283-330`).
  - Fill grids are not affected: scanline groups pass through untouched (`optimize-paths.ts`
    comment at `optimizeGroupAny`).
- **Anchor:**
  - **Contract:** ADR-497 D3: "Every axis runs from its lowest-risk value … So the first cell burned
    is the gentlest."
  - **Ground truth:** LightBurn runs test boxes as "an ascending list" of risk.
- **Scenario:** A GRBL machine set up with a rear-right origin (or front-right, or centre) runs a
  Cut test (speed rows 3000→500, power columns 10→80%). Every row is cut 80%, 56.7%, 33.3%, then
  10%. The very first cut of the job is the 80% cell, and the hottest cell of each slower row runs
  before its gentle cells. The labels are still right; the risk order is not. The same reversal
  happens on a front-left machine whose project has Order by direction = right-to-left, Line start
  region = front-right, or Start point = job centre (job centre starts mid-row). Those settings
  persist in the project when Generate replaces the scene.
- **Evidence:** REPRO `zz-e5-order.test.ts` (`emitGcode`, first lit move per cell):
  - `line default: r0c0 r0c1 r0c2 r0c3 r1c0 …`
  - `line origin-rear-right: r0c3 r0c2 r0c1 r0c0 r1c3 …` (same for `origin-front-right` and
    `origin-center`)
  - `line cutRightToLeft` / `lineStartFrontRight`: `r0c3(80%/3000) r0c2 … r0c0(10%/3000) r1c3 …`
  - `line startJobCenter: r0c2 r0c1 r0c0 r0c3 …`
  - every fill variant: `r0c0 r0c1 r0c2 r0c3 r1c0 …`
- **Refuter:** **CONFIRMED** (REPRO + SOURCE). P2 kept, at the low end. What would refute it:
  D3 being only about axis order, a guard that keeps calibration cells in source order, or no
  shipped profile with a right or centre origin. None holds.
  - **ADR-497 D3, read directly:** "Every axis runs from its lowest-risk value … So the first
    cell burned is the gentlest". That is a claim about burn order, not only about axis order.
  - **LightBurn 2.1 Material Test, fetched:** the order follows "an ascending list of potential
    risk of burning or charring material".
  - **Repro, run independently** (`zz-e5r-refute.test.ts`, deleted): a Cut grid, speed rows
    3000/1750/500 × power columns 10–80%, run through `emitGcode`, first lit move per cell.
    - `front-left` and `rear-left`: `r0c0(3000/10%) r0c1 r0c2 r0c3 r1c0 …`
    - `rear-right`:
      `r0c3(3000/80%) r0c2(3000/57%) r0c1(3000/33%) r0c0(3000/10%) r1c3(1750/80%) … r2c3(500/80%) r2c2 r2c1 r2c0`.
      The grid's hottest cell runs 9th of 12 instead of last.
  - **Reach is wider than stated.** The catalogue's Generic Ruida CO2 profile is `origin:
    'rear-right'` (`profile-catalog.ts:163`). `emitRdFile` runs the same `prepareOutput` →
    `optimizePaths(…, device.origin)` (`emit-rd.ts:35`, `prepare-output.ts:269-274`). So the
    reversal hits the CO2 class, where cut-through tests are most used. The Ruida profile itself
    is marked experimental.
  - **Safety, or only order?** The same cells burn at the same values, so a full run has the same
    total exposure. What is lost is the early-abort margin: an operator who stops at the first
    flare or the first cut-through has already burned that row's hottest cell, and loses the
    gentler cells after it. Gentle cells are also cut beside a just-cut hot neighbour (1 mm
    gap). This is a minor and unmeasured heat effect. It is not a P1 hazard: the operator is
    present (`docs/safety.md:30`, "Never leave a running machine unattended"), and no cell gets more energy than its label.
  - **Verdict:** a broken contract (D3) with a clear failure scenario, on a catalogue profile.
    P2 is kept, not raised.
- **Fix direction:** Keep a calibration grid's cells in generated order. For example, give each
  cell its own priority or topology scope so the cut planner cannot reorder across cells, or emit
  calibration rows in source order. Test the emitted order (not `compileJob`) for Cut grids under
  each origin.

### P2-4 (refuter: P3) — Rows faster than about 9,000 mm/min (at 500 mm/s²) are given a capped 25 mm runway, never reach their labelled speed, and the dialog says the runway reaches it

- **Where:**
  - `src/core/job/material-test-grid.ts:247-261`: `materialTestRunwayMm` passes
    `maxMm: MAX_FILL_OVERSCAN_MM`.
  - `src/core/job/compile-job-defaults.ts:13` (`= 25`).
  - `src/ui/calibration/MaterialTestDialog.tsx:199-218`: `RunwayNote` prints the capped length as
    the run-up needed.
- **Anchor:**
  - **Contract:** ADR-497 D6: "Each engraved row runs the stored 5 mm, or the whole run-up its
    fastest cell needs … whichever is longer. Shorter is never used."
  - **Twin:** the same function computes the uncapped need, `automaticOverscanMm` (v²/2a × 1.1), and
    then clips it.
  - **Ground truth:** GRBL plans constant-acceleration ramps, and M4 scales power by
    `current_speed × inv_rate` (`stepper.c`).
- **Scenario:** A Falcon A1 Pro profile (max feed 36,000; accel 500 mm/s², the starter value) tests
  speed rows 6,000–20,000 mm/min with 5 mm cells. The 13,000 and 20,000 rows both get 25 mm. From
  rest, 25 mm reaches √(2·500·25) = 158 mm/s = 9,487 mm/min. The planner must also stop within the
  25 mm exit runway, so the 5 mm cell runs at about 9,500–9,950 mm/min. That is under half the
  "20000" label, and the "13000" row burns at the same speed as the "20000" row. The dialog says:
  "The fastest engraved cells need 25 mm of runway to reach 20,000 mm/min at 500 mm/s²". With M4
  (GRBL's default here), power is cut in proportion, so the darkness roughly follows the label even
  though the speed does not. On a constant-power profile (GRBL Constant, Marlin inline without
  `LASER_POWER_TRAP`), those cells get about 1.3–2.1× the labelled energy per mm, and the operator
  picks too low a power.
- **Evidence:** REPRO.
  - `zz-e5-twin.test.ts`: `runway speed 12000: runway 25 mm; entry feed 9487 exit(5mm cell) 10392`
    (from-rest bound, not counting the exit deceleration); `speed 20000/36000`: the same;
    `fast grid layers: Material test 20000 …:25 | … 13000 …:25 | … 6000 …:11`.
  - Emitted `fast-runway.gcode`: `; fill layer … speed 20000 mm/min … overscan 25.000 mm`, then
    `G1 X25.000 … F20000 S0` runway and lit `G1X30Y396F20000S200`.
  - `zz-e5-runway-note.test.tsx`: the note text quoted above.
  - The cap binds from √(25/1.1 · 2 · 500) ≈ 151 mm/s ≈ 9,045 mm/min.
- **Refuter:** **CONFIRMED** (REPRO + SOURCE + READ); **severity P2 → P3**. What would refute it:
  an uncapped grid runway, a note that names the cap, or arithmetic showing that 25 mm reaches
  the label speed. None holds, so the behaviour is real. The severity does not hold.
  - **Arithmetic, run independently** (`materialTestRunwayMm` plus a constant-acceleration
    triangle over runway + 5 mm cell + runway):

    | accel (mm/s²) | label (mm/min) | runway | cell runs at (mm/min) |
    |---|---|---|---|
    | 500 | 9,000 | 24.8 | 9,000 |
    | 500 | 10,000, 13,000 or 20,000 | 25 (need 30.6 / 51.6 / 122.2) | 9,487–9,950 |
    | 1,000 | 13,000 | 25 | 13,000 |
    | 1,000 | 20,000 | 25 | 13,416–14,071 |
    | 2,000 | 20,000 | 25 | 18,974–19,900 |
    | 3,000 | 20,000 | 20.4 | 20,000 |

    √(2·500·25) = 158.1 mm/s = 9,487 mm/min, as the auditor said.
  - **The note is false when capped.** `RunwayNote` (`MaterialTestDialog.tsx:208-217`) prints
    `runwayMm` (25) as the length "to reach" the fastest speed.
  - **The anchor is weaker than stated.**
    - The cap is an accepted contract, not drift. ADR-238 Amd 3 Consequences: "A machine that
      needs more than 25 mm of runway at its speed cannot get it from generic Scan Line". ADR-495's
      decision (line 28) holds automatic overscan "within the Overscan field's 0 to 25 mm range", and ADR-497 D6
      defines its run-up as "ADR-495's v² / 2a plus 10%".
    - D6's "Shorter is never used" is about the stored 5 mm. Its Alternatives section rejects
      automatic overscan because "it can be shorter than 5 mm"; the sentence does not promise an
      uncapped run-up.
    - Every Fill job at these speeds gets the same 25 mm, so the grid's edges do "burn as the
      operator's jobs will".
  - **LightBurn, fetched:** the overscan "is calculated as a percentage of Speed". No acceleration
    sizing and no reach-speed guarantee are documented, and the Material Test page does not
    mention overscan. KerfDesk's sized runway is already ahead of the reference.
  - **Reach.**
    - The default profile caps feed at 6,000, which needs 11 mm, so the default profile cannot
      hit this. It needs a profile above about 9,045 mm/min: the catalogue's Falcon A1 Pro
      (36,000) or a user-raised max feed.
    - The physical shortfall also needs the machine's *real* `$120/$121` to be near the profile's
      generic 500. The firmware accelerates at its own rate; at 2,000 mm/s² even 20,000 mm/min
      nearly arrives. The Falcon's vendor set hides `$$`, so its 500 is a starter value, not a
      measurement.
  - **Physical effect.** The repro emits `M4` for the Falcon (`grbl-dynamic`). GRBL `stepper.c`
    scales power by `current_speed × inv_rate`, so energy per mm follows the label, and the
    operator's chosen speed/power pair is still right. A wrong burn needs M3 or constant power
    plus a custom fast profile plus a truly slow machine.
  - **Verdict:** a real but narrow physical case, plus one false sentence in the dialog
    (doc/code drift). That is P3.
- **Fix direction:** When the need exceeds 25 mm, say so in the note: name the highest speed the
  cell can reach and the rows that cannot. Either cap the grid's speeds at that value with a
  disclosure, or allow a longer grid-only runway. Extend the runway tests past the cap; today they
  stop at 9,000 mm/min → 24.8 mm.

### P3-1 — Settings the grid does not vary come from the built-in defaults, with no base-settings editor and no use of the operator's layer defaults; the labels burn at a fixed 20% / 1,500 mm/min

- **Where:**
  - `src/core/job/material-test-grid.ts:220-241`: rows are `createLayer(…)` plus power, speed,
    passes, hatch and overscan only, so air assist is off, the fill is bidirectional at 0°, and the
    power mode is the device default.
  - `src/core/job/calibration-labels.ts:12-13,42-53`: the label layer.
  - `src/ui/commands/CalibrationGridDialogs.tsx:43`: the user's `layerDefaults`, which import, fill
    selection and new layers apply (`fresh-operation-seeding.ts`), are not passed in.
- **Anchor:**
  - **Ground truth:** LightBurn's Edit Material Setting: "all other settings applied here will apply
    to every test box". Edit Text Setting and Enable Text control the labels.
  - **Contract (spirit):** ADR-497 D6, "the grid should burn as the operator's jobs will".
- **Scenario:** A CO2 owner whose jobs all run with air assist (Make Default for All) runs a Cut
  test. Every cell is cut with air off, so the cut-through power read from the card is higher, and
  the char heavier, than in the jobs. Changing it means editing up to 20 row operations. On a weak
  diode, 20% at 1,500 mm/min may not mark the labels at all, with no dialog control. Job Review does
  show "air off" per group.
- **Evidence:** READ; repro G-code: every row header reads `power … speed … passes 1 overscan
  5.000 mm`, with no air word. The LightBurn quotes are from the fetched 2.1 page.
- **Refuter:** **CONFIRMED** (READ + SOURCE), P3. `MaterialDialog` passes only `maxFeedMmPerMin`
  and `accelMmPerSec2` to the generator (`CalibrationGridDialogs.tsx:41-43`), with no
  `layerDefaults`. LightBurn 2.1 says "all other settings applied here will apply to every test
  box" (fetched independently).
- **Fix direction:** Seed the rows from the operator's layer defaults, or add a "base settings"
  control (at least air assist and power mode). Expose label power, speed and on/off.

### P3-2 — The burned card names neither axis nor the settings held fixed, so a grid of "1 2 3 / 10 25 40" cannot be read back

- **Where:** `src/core/job/material-test-layout.ts:48-76`. Only the row values and column values
  are burned. `calibration-labels.ts:115-121` renders digits, "." and "-" only.
- **Anchor:** Ground truth: in LightBurn, "At the top, the sample shows additional universal
  settings" (Interval, Passes, Frequency), and fixed axes put speed on the left and power along the
  bottom. ADR-497 lets either axis be speed, power, passes or hatch spacing, so position no longer
  says which is which.
- **Scenario:** The operator burns Power-rows × Passes-columns on one scrap and Speed-rows ×
  Power-columns on another. A week later, "1 2 3" against "10 25 40" could be passes × power or
  power × passes. The fixed speed, power and interval appear nowhere on the material. The Experiment
  record in Material Library holds them, but not on the card.
- **Evidence:** READ plus the label sources in every repro grid (numbers only).
- **Refuter:** **CONFIRMED** (READ + REPRO + SOURCE), P3. `materialTestLabelObjects` emits only
  the column and row value labels. The refuter's repro labels are bare numbers
  (`calibration-label:0.05` … `0.01`). LightBurn 2.1, fetched independently: "At the top, the
  sample shows additional universal settings".
- **Fix direction:** Burn a short header (for example a letter or symbol per axis and the fixed
  values). The 7-segment font needs a few letters or symbols for that.

### P3-3 — Material Test axis values carry float noise into the saved G-code comments and the Experiment record (the Interval Test rounds)

- **Where:**
  - `src/core/job/material-test-axes.ts:142-146` (`linspace` without rounding).
  - `material-test-grid.ts:292`: `powerScale = value / layer.power × 100`, and the compiler
    multiplies it back.
  - Twin: `interval-test-grid.ts:238-242,276-278` rounds every step to 6 decimals.
- **Anchor:** Twin (Interval Test generator).
- **Scenario:** Saved G-code shows `; fill layer material-test-row-0 … power 19.999999999999996%`
  and `; requested override: … interval 0.02999999999999997 mm`. The Experiment stores hatch
  `0.030000000000000002`. Emitted S/F words are unaffected (S rounding absorbs it).
- **Evidence:** REPRO: `g3_intervalRows_powerCols-grbl1000.gcode` lines 6 and 88;
  `g5_speedRows_intervalCols-grbl1000.gcode` line 279; `experiment-summary.txt`.
- **Refuter:** **CONFIRMED** (REPRO + READ), P3. The auditor's saved
  `g3_intervalRows_powerCols-grbl1000.gcode` line 6 reads `power 19.999999999999996%`. The
  refuter's own grid gives cell `intervalMm` values of `0.030000000000000002` and
  `0.010000000000000002`. `linspace` (`material-test-axes.ts:142-146`) does not round. Emitted
  S/F words are unaffected.
- **Fix direction:** Round axis values as the Interval Test does, and compute a power column's
  cells so that `layer.power × scale / 100` returns the column value exactly (or round it in the
  comment).

### P3-4 — The Interval Test keeps the stored 5 mm runway at any speed; ADR-497's runway sizing was applied to the Material Test only

- **Where:** `src/core/job/interval-test-grid.ts:181-203` (`intervalLayer` sets speed, power and
  hatch, so the runway stays `LAYER_DEFAULTS.fillOverscanMm` = 5). Twin:
  `material-test-grid.ts:233-241`.
- **Anchor:** Twin (Material Test D6 sizing); ADR-497 context: a 5 mm runway "is too short above
  about 4,700" mm/min at 500 mm/s².
- **Scenario:** Following LightBurn's advice, the operator runs the Interval Test at the speed found
  by the Material Test, 6,000 mm/min. Each 8 mm swatch gets 5 mm of runway each side, so the head
  accelerates from 4,243 mm/min to a peak of about 5,690 mm/min mid-swatch and never runs at the
  "6000" burned label. Because every swatch shares the speed, the comparison of intervals stays
  fair. On M3 the swatches are darker than a 6,000 mm/min job.
- **Evidence:** REPRO: `twin-summary.txt` shows `ov5` for every swatch. The speeds come from the
  constant-acceleration arithmetic above.
- **Refuter:** **CONFIRMED** (READ + arithmetic), P3. `intervalLayer`
  (`interval-test-grid.ts:181-203`) sets no `fillOverscanMm`, so the runway stays 5 mm. The
  figures check out: √(2·500·5) = 70.7 mm/s = 4,243 mm/min, and √(500·18) = 94.9 mm/s =
  5,692 mm/min. As with P2-4, this assumes the machine's real acceleration equals the profile's
  500, and on M4 the energy per mm still follows the label. Every swatch shares one speed, so the
  interval comparison stays fair.
- **Fix direction:** Size the Interval Test runway with `materialTestRunwayMm` from Machine Setup's
  acceleration, as the Material Test does.

### P3-5 (L7) — The "gentlest first" tests check `compileJob`, not the program the machine runs, and the other three P2 paths have no regression test

- **Where:**
  - `src/core/job/material-test-grid.test.ts:149-170`, "compiles the first emitted group as the
    lowest-risk cell", and `interval-test-grid.test.ts:163-180`. Both use `compileJob` with the
    front-left default and a Fill grid; `optimizePaths`/`prepareOutput` reorder Cut groups
    afterwards (P2-3).
  - `material-test-grid-axes.test.ts`: hatch axes stay at or above 0.05 (P2-1); runway tests stop
    at 9,000 mm/min (P2-4); no label-bounds test (P2-2).
- **Anchor:** METHOD L7; ADR-497 Verification list.
- **Scenario:** Each P2 above passed CI because the test asserts the generator's intent, not the
  emitted program.
- **Evidence:** READ.
- **Refuter:** **CONFIRMED** (READ), P3. `material-test-grid.test.ts:149-170` runs
  `compileJob(grid.scene, DEFAULT_DEVICE_PROFILE)` on a Fill grid and asserts `job.groups[0]`.
  `optimizePaths` runs later, in `prepareOutput`, and is never exercised. The refuter's
  `emitGcode` repro shows that this order changes for Cut grids on rear-right origins.
- **Fix direction:** Assert risk order, label bounds, emitted spacing and reachable speed on
  `emitGcode` output.

## Known (not re-raised)

- **rolling-v2 21-P3-4:** a LightBurn interval below 0.05 mm is burned at 0.05 mm. This is the same
  engine floor as P2-1, which is the Material Test's own entry path. Rolling-v2 06-P2-4 (Cut Settings
  refuses Apply when an untouched field holds 0.03 mm) makes a Material Test pick of 0.03
  unenterable.
- **E1-P2-1:** FluidNC truncates fractional S. A Material Test's power columns on a `speed_map` top
  below 100 burn S0 or less than labelled.
- **E1-P3-2:** `$31 > 0` makes every low-power cell burn cooler than its label, and S ≤ `$31` almost
  off. The Material Test is where this hurts most, but it is the same finding.
- **E1-P3-3:** a Marlin S max above 255 wraps.
- **LBG-M05 (open part):** a Material Test in Image mode, and a border.
- **LBG-M10:** a dithered-image Interval Test.

## Refuted

The refuter (2026-10-23) refuted none of the 9 raised findings. One was lowered (P2-4 → P3:
the 25 mm cap is an accepted ADR-238 Amd 3 / ADR-495 limit, and on M4 the burn still follows the
label). The refuter raised no new P1 or P2. Candidates the auditor checked and dropped:

- **Power label vs S rounding:** at `$30=255`, "13.33" → S34 (13.33%) and "10" → S26 (10.2%). The
  difference is within ±0.5 S (E1's verified rounding); labels keep 2 decimals.
- **Speed above max feed shows a label never used:** the burned label is the effective feed
  (`material-test-axes.ts:62-70`). The dialog says "Burned speed labels show effective feed".
  Job Review lists `speed-out-of-range` per row and "6,000 mm/min effective (9,000 requested)".
  Duplicate "6000" columns are disclosed, not hidden.
- **Scan offset or overscan changes the effective interval:** no. Offsets shift only reversed rows
  in X, per cell feed (0.5/0.3/0.1 mm at 5000/3000/1000), and Y spacing is unchanged (0.25 mm in all
  cells).
- **LightBurn runs lowest interval first and KerfDesk widest first:** this is deliberate (ADR-497
  D3), and widest first is the lower-energy end.
- **Labels mirrored on rear or right origins:** `origin-transform.ts` keeps the canvas top at the
  back of the bed and the canvas left at the operator's left on every origin, so the 7-segment
  glyphs (drawn Y-down) read correctly.
- **Saved project shows a different grid:** serialize → deserialize → emit is byte-identical for
  hatch-column, passes-column, capped speed-column and Cut grids.
- **Zero, negative or NaN counts give an empty or endless grid:** counts clamp to 1..20 and pass
  counts to whole numbers (`min(count, high−low+1)`). Speeds clamp to ≥1, power to 0..100, and the
  interval to 0.01..10 (or ≥0.05 in the Interval Test). The dialog rejects non-integers and
  out-of-range values before Generate.

## Verified clean

- **Per-cell S, F and passes on 7 dialects** (table above). Power columns via `powerScale`, and
  speed, passes and hatch columns via per-cell overrides, all reach the emitted words. Cut cells
  emit exactly `passes` outlines.
- **Endpoints inclusive:** `linspace` includes Min and Max for count ≥ 2. Count 1 uses the
  lowest-risk end, and the label shows it. Passes keep one value per whole number.
- **Fill risk order:** row-major, gentlest first, under every optimisation variant (reverse layer
  order, source order, Inside first off, all Order by direction values, job-centre start, line
  start region) and every origin. Rows are operations in project order, scanline groups are never
  reordered, and labels burn last.
- **Interval Test:** emitted spacing equals each label (6-decimal labels); speed is one effective
  feed; swatches run widest first.
- **Twins:** the dialog preview uses Generate's own axes (`materialTestGridAxes`) and effective
  feeds. Job Review summarises each compiled group's effective power, speed and passes (3 dp). The
  Experiment captures the effective power and override per cell (`effectiveObjectPowerPercent`),
  with speed set to the effective feed. A saved project re-emits identically.
- **Gating:** Material, Interval and Scan Offset tests are laser-only (`machine-command-gate.ts:31-33`).
- **Labels never sit on a cell;** row labels never overlap (`zz-e5-labels`).

## Not verified

- No hardware, air-cut or material burn was run. Physical speeds in P2-4/P3-4 come from GRBL's
  constant-acceleration planner model, not measured motion. The M3 energy factors assume linear
  PWM.
- Job Review and the Material Test dialog were exercised headlessly (core summaries, and a jsdom
  render for the runway note), not in the Electron app.
- Rotary output of a test grid, and ADR-497 grids combined with laser leads, kerf or tabs, were not
  run.
- LightBurn's own byte output and runtime order for its generator were not observed, only its docs.
  The "use current layer settings" behaviour named in the brief does not exist in the fetched 2.1
  or 1.7 docs.
- FluidNC and grblHAL were not re-run here; E1 covers their S mapping.
- Repro sources and outputs are in
  `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\e5-repros\`.
  The files are `zz-e5-cells`, `zz-e5-order`, `zz-e5-twin`, `zz-e5-labels`, `zz-e5-experiment`
  and `zz-e5-runway-note`. Each ran with
  `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file>`
  from the audit worktree, placed next to the code it imports, and was then deleted from the repo.

```json
[
  {"id":"P2-1","severity":"P2","area":"ctl-material-tests","file":"src/core/job/material-test-axes.ts","line":21,"anchor":"Contract: ADR-497 D7, ADR-044; Twin: IntervalTestDialog.tsx:47-48 and interval-test-grid.ts:27 min 0.05, fill-hatching.ts:45 MIN_HATCH_SPACING_MM 0.05","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Material Test accepts hatch spacing 0.01-0.049 mm and burns those labels, previews and records them in the Experiment, but every such cell is filled at the engine's 0.05 mm floor (related KNOWN 21-P3-4 for the LightBurn import path)"},
  {"id":"P2-2","severity":"P2","area":"ctl-material-tests","file":"src/core/job/material-test-layout.ts","line":58,"anchor":"Contract: ADR-497 D7, ADR-044 label readability; Twin: interval-test-grid.ts:153-157 fits labels to the swatch, MaterialTestPreview uprightColumns","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The default 10x10 grid burns overlapping column labels (23.33/26.67 and 33.33/36.67 overlap by 1.14 mm, digits drawn on top of each other); 4-digit speed columns and hatch columns overlap too"},
  {"id":"P2-3","severity":"P2","area":"ctl-material-tests","file":"src/core/job/topology-cut-packets.ts","line":57,"anchor":"Contract: ADR-497 D3 first cell burned is the gentlest; Ground truth: LightBurn Material Test ascending risk order","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Cut test grids are re-planned per row by distance from the cursor: on rear-right (incl. the catalogue Generic Ruida CO2 profile), front-right or centre origins (or with right-to-left order, front-right line start, job-centre start) each row cuts its hottest cell first; fill grids keep the order"},
  {"id":"P2-4","severity":"P3","severityRaised":"P2","area":"ctl-material-tests","file":"src/core/job/material-test-grid.ts","line":258,"anchor":"Twin: RunwayNote text vs reachable speed (automaticOverscanMm uncapped need); the 25 mm cap itself is accepted contract (ADR-238 Amd 3, ADR-495); Ground truth: gnea/grbl stepper.c M4 rate-adjusted power","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Engraved rows above ~9,000 mm/min at a 500 mm/s2 profile get the 25 mm capped runway, so on a machine that really accelerates at 500 the cells labelled 10,000-36,000 run at about 9,500-10,000 mm/min, and the dialog says 25 mm reaches 20,000 mm/min. Refuter lowered to P3: the cap is an accepted limit, energy per mm follows the label on M4 (Falcon default), and the case needs a fast custom or Falcon profile plus a truly slow machine"},
  {"id":"P3-1","severity":"P3","area":"ctl-material-tests","file":"src/core/job/material-test-grid.ts","line":220,"anchor":"Ground truth: LightBurn Edit Material Setting applies to every test box, Edit Text Setting / Enable Text; Contract spirit ADR-497 D6","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Unvaried settings come from built-in layer defaults (air assist off, bidirectional 0 deg, device power mode) with no base-settings editor and no use of the operator's layer defaults; labels fixed at 20%/1500 mm/min"},
  {"id":"P3-2","severity":"P3","area":"ctl-material-tests","file":"src/core/job/material-test-layout.ts","line":48,"anchor":"Ground truth: LightBurn prints universal settings at the top of the sample; ADR-497 any-two-settings axes","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"The burned card names neither axis nor the fixed settings, so with ADR-497's any-two-settings grids the coupon cannot be read back without the Experiment record"},
  {"id":"P3-3","severity":"P3","area":"ctl-material-tests","file":"src/core/job/material-test-axes.ts","line":142,"anchor":"Twin: interval-test-grid.ts:238-242,276-278 rounds steps to 6 decimals","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Material Test axis values carry float noise into saved G-code comments (power 19.999999999999996%, interval 0.02999999999999997 mm) and Experiment records; emitted S/F are unaffected"},
  {"id":"P3-4","severity":"P3","area":"ctl-material-tests","file":"src/core/job/interval-test-grid.ts","line":181,"anchor":"Twin: material-test-grid.ts:233-241 runway sized for the fastest cell (ADR-497 D6)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Interval Test swatches keep a 5 mm runway at any speed; at 6,000 mm/min and 500 mm/s2 an 8 mm swatch peaks near 5,690 mm/min while the label says 6000"},
  {"id":"P3-5","severity":"P3","area":"ctl-material-tests","file":"src/core/job/material-test-grid.test.ts","line":149,"anchor":"METHOD L7; ADR-497 Verification","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Gentlest-first tests assert compileJob order for a front-left Fill grid, not the optimised program; no tests cover sub-0.05 hatch, label bounds or the runway cap"}
]
```
