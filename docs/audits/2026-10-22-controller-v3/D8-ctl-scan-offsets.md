# Controller audit v3 — D8 Scan offsets (`ctl-scan-offsets`)

- **When:** 2026-10-22 evening   **Tree:** origin/main @ `7cd526213` (worktree `src/` identical to
  `7cd526213`; the worktree HEAD only adds audit documents). `origin/main` moved to `c0263f3be`
  during the audit. None of the changed files touches scan offsets: the diffs to `job.ts`,
  `profile-catalog.ts` and `falcon-profiles.ts` contain no scan, offset or bidirectional lines.
- **Scope:**
  - Model: `src/core/devices/{scan-offset-profile,scan-offset-measurement-format,device-profile-patch,controller-profile-compatibility}.ts`, `src/core/job/{scan-offset,scan-offset-calibration-pattern,scan-direction-policy,fill-sweep-plan,fill-hatching,layer-fill,fill-group-build,compile-job-raster}.ts`.
  - Emission: `src/core/output/{grbl-strategy,grbl-fill-emission,marlin-strategy,smoothieware-strategy}.ts`, `src/core/raster/{emit-raster,emit-raster-sweep}.ts`.
  - Twins: `toolpath.ts`, `toolpath-raster-steps.ts`, `job-bounds.ts`, `job-start-bounds.ts`, `first-process-point.ts`, `optimize-paths.ts`, `job-origin.ts`, `prepare-output.ts`, `draw-preview.ts`, `cut-paths-artwork.ts`.
  - Policy and I/O: `src/core/preflight/scan-offset-policy.ts`, `src/io/project/{project-scan-offset-validator,deserialize-project}.ts`, `src/io/machine-profile/machine-profile-io.ts`.
  - UI: `ScanOffsetOverrideNotice`, `MachineSetupRasterDiagnostics`, `machine-setup-raster-diagnostic-checks`, `machine-setup-scan-facts`, `MeasuredScanOffsetApply`, `ScanOffsetEditor`, `ScanOffsetMeasurementFormatControls`, `scan-offset-measurement-draft`, `ScanOffsetCalibrationDialog`, `ScanOffsetCommandDialog`, `job-intent-warnings`, `job-review-live-rows`, `job-review-detail-facts`.
- **Governing:**
  - ADR-052 (DECISIONS.md:3164).
  - ADR-038 (unidirectional option).
  - The ADR-236 decision bullet on scan-offset caps (DECISIONS.md:11242-11246).
  - ADR-445 §3 (calibration labels use the emitted feed).
  - ADR-492 (image scan angle).
  - ADR-565 (scanning calibration is a spatial input).
  - ADR-500 Amendment 1 §2 (Open uses the document's machine).
  - WORKFLOW F-SO1, F.2.f item 4 and F-A7d item 4.
  - PROJECT.md non-negotiables 2 (origin honesty) and 21 (Frame).
- **Primary sources fetched:**
  - LightBurn "Scanning Offset Adjustment", versions 1.7 and 2.0 (docs.lightburnsoftware.com), and the Documentation repo's `ScanningOffsetAdjustment.md`.
  - LightBurn forum threads 3152 ("Scanning offset adjustment fields"; staff member Oz on the meaning of the sign) and 4205 ("More scanning offset queries"; Oz on halving and sign).
  - softsolder.com, 2024-09-24, "Scanning Offset Adjustment: LightBurn vs RDWorks" (observed scan-to-vector placement).
- **Lenses run:** L1, L2, L3, L4 and L7 as separate passes, plus L6 inside L4 (failure on overflowed tables).
  - L5 is limited to `.lf2` and `.lfmachine.json` scan-offset fields, inside L4. No network or IPC input carries scan offsets.
- **Counts:** 6 raised → refuter: confirmed 5 / plausible 1 / refuted 0 → P1 0 / P2 1 / P3 5 (+ 2 KNOWN re-encountered). Severity changes: none.

## Headline

The correction itself is consistent. A positive value moves reverse rows along their own travel.
That is the sign LightBurn's staff describe ("start scanning later"), and the LightBurn Line Shift
conversion (×2, sign kept) is right. Emission, preview, bounds, start-point and estimate all use
the same value at the same emitted feed. Every bidirectional path is covered: fill, island, angled
and cross-hatch fill, images at any scan angle, and Marlin and Smoothieware.

The defects are in where a corrected job lands:

- **Placement (P2-1).** With User Origin, Current Position or Verified Origin placement, the job
  anchors on the compensated reverse rows' commanded extent. Enabling a table therefore moves the
  whole job, Line cuts included, by the full table offset (half of it for centre anchors). The
  Frame envelope is the same with and without the table, so it gives no cue. (Refuter: it starts
  at the runway, X−5 in the repro, not exactly at the origin. The shift happens only when a
  bidirectional fill or image row defines the anchor-side edge.)
- **Design position (P3-1).** Reverse-only correction leaves the corrected fill or image half the
  measured separation off its vector outline. LightBurn's half-each shift centres it. ADR-052
  rejected half-each on the claim that reverse-only keeps registration, but the physics shows the
  opposite.

## Setting → emitted effect → source

| Setting | Emitted effect | Source |
|---|---|---|
| `device.scanningOffsets` (mm/min → full signed separation, mm) | `v = offsetForSpeed(table, floor(F))`; linear between points, `(F/s0)·o0` below the first, clamped above the last, 0 for an empty table | `scan-offset.ts:69-102` |
| → Scanline, Island and cross-hatch fill | each `reverse` sweep translated by `v` along its own travel vector; runways and shared split points are computed after the shift | `fill-sweep-plan.ts:80-93`, `grbl-fill-emission.ts:68-70` |
| → Image (threshold, dither, grayscale, pass-through, streamed rows, any scan angle) | every coordinate of a reverse row, runways included, gets `x += −v` in the scan frame | `emit-raster-sweep.ts:51,113-139`, `grbl-strategy.ts:355` |
| → Offset fill (Follow Shape) | none: contours, not rows | `fill-group-build.ts:41` |
| → Marlin and Smoothieware | the same, through `grblStrategy.emit` with the device spread | `marlin-strategy.ts:19-34`, `smoothieware-strategy.ts:21` |
| Layer or object `bidirectionalScanOffsetMm` | replaces the table value for that group; non-finite → dropped → table; finite over-cap → applied, plus a Job Review warning | `compile-job-raster.ts:155`, `fill-group-build.ts:25`, `layer-fill.ts:61`, `scan-offset-policy.ts:43-66` |
| `fillBidirectional` / `imageBidirectional` false, sensitive Island Fill | no reverse rows, no shift | `fill-hatching.ts:306`, `emit-raster.ts:221`, `scan-direction-policy.ts:84-86` |
| `bidirectionalScanPolicy: require-verified-offsets` + status | pending → one-way (even with the expert override); verified or legacy → bidirectional; uncalibrated → one-way unless expert | `scan-direction-policy.ts:24-53` |
| Coupon `baseline` | bidirectional forced, override 0 | `scan-offset-calibration-pattern.ts:186-189`, `scan-direction-policy.ts:36-38` |
| Coupon `verification` | the table is used; on a require-verified profile, bidirectional only if the table is non-empty (P3-3) | `scan-direction-policy.ts:39` |
| Measurement entry (LightBurn convention, mm/s) | offset ×2 with the sign kept; speed ×60; capped at 1% of the shorter bed axis, at most 5 mm | `scan-offset-measurement-format.ts:11-43`, `scan-offset-measurement-draft.ts:141-176` |
| Job placement (User / Current / Verified Origin) | the anchor uses the compensated burn bounds, so the whole program moves by `v` (P2-1) | `job-origin.ts:101-112`, `job-bounds.ts:218,249-251` |
| Interactive edit, controller or dialect change | the table becomes pending; an identity or dialect change clears it and lists the change; a bed edit that makes the table invalid clears it | `DeviceSetupOptionsStep.tsx:106-110`, `controller-profile-compatibility.ts:69-71`, `device-profile-patch.ts:21-31` |
| `.lfmachine.json` import / `.lf2` Open | import: the cap is enforced and the status becomes pending. Open: structure only, the cap is not checked and the status is kept (P3-2, P3-4) | `machine-profile-io.ts:175-242`, `project-scan-offset-validator.ts:6-21` |

## Answers to the six questions

1. **Sign and direction.** Only reverse rows move: positive along their travel, negative against
   it. That matches LightBurn's staff description: positive values "start scanning later" (for
   backlash), negative values "start the scan earlier" (for firing lag). The coupon labels show
   speeds only and say nothing about direction (P3-5).
2. **Interpolation.** The table is linear between points, clamped above the last point and scaled
   from rest below the first. ADR-052 and the Job Review coverage warning describe this exactly.
   LightBurn documents only that it "will use this information to compute the correct
   adjustments for other speeds", so the behaviour off the ends cannot be compared (Not verified).
3. **Coverage.** Every bidirectional path is covered (see the table). Rotary scans images along X
   and shifts fill in machine units at the commanded F, which is correct for a time lag. Origin
   mirroring is safe because hatching runs in machine coordinates. Each operation and sub-layer
   uses its own speed. Overscan moves with the row.
4. **Calibration pattern.** The burned labels equal the layer speed, which equals the emitted F
   after the cap and floor (ADR-445 §3). The defaults match LightBurn's 50 × 10 mm swatch with a
   0.5 mm interval, and a 5 mm runway covers 5% of speed up to 6000 mm/min. Units are mm/min
   throughout, and a mm/s entry is converted ×60 and rejected above maxFeed. The sign cannot be
   read from the coupon (P3-5). A verification coupon on a require-verified profile with no table
   is one-way (P3-3).
5. **Policy and override.** The override notice and the non-finite message are true. A local
   override survives a machine switch by design; Job Review names it as "local scan offset …
   replaces device table". The device table's magnitude is never checked after Open (P3-2). A
   file's "verified" status survives Open, but an import downgrades it to pending (P3-4).
6. **Twin.** Preview, start bounds, first-process point, Frame motion bounds, estimate, island
   ordering and Raster Diagnostics all call `planFillSweeps` or the same raster row parity, at the
   same feed. They agree with the emitted coordinates. The placement anchor is the exception
   (P2-1).

## Findings

### D8-P2-1 — Anchored placement uses the compensated reverse rows, so a scan-offset table moves the whole placed job, Line cuts included, by the full offset

- **Where:**
  - `src/core/job/job-bounds.ts:218` (fill) and `:249-251` (image): the burn bounds, without overscan, include the reverse rows at their compensated commanded position.
  - `src/core/job/job-origin.ts:108-111` anchors on those bounds; `src/io/gcode/prepare-output.ts:389` applies the result to the whole program.
  - `src/io/gcode/prepare-output-scan-offset-placement.test.ts` pins "anchors the calibrated reverse-row minimum at $label".
- **Lens:** L1, L3, L7.
- **Anchor:**
  - Contract: ADR-052 says "forward rows and all vector cuts stay at exact design coordinates" (DECISIONS.md:3213).
  - Twin: the same placement bounds leave out the overscan runways, which do not burn. The compensation shift does not change where the rows burn either; the compensation exists so that reverse rows burn on top of forward rows.
- **Scenario:**
  1. A profile has `scanningOffsets [{3000, +0.4}]`, which is LightBurn's backlash sign.
  2. A job has a 20 × 6 mm Fill and the same rectangle as a Line cut, placed at User Origin, front-left anchor.
  3. Without the table, the Line cut starts at X 0. With the table, it starts at X 0.4, and the forward rows move with it.
  4. Current Position at (100, 100): the cut moves from 100 to 100.4.
  5. Centre anchor: the cut moves ±0.2. Front-right anchor with −0.4: the cut moves −0.4. Absolute placement: no change.
  6. Frame and Job Review show the commanded envelope starting at the origin, so nothing tells the operator that the cut, and the burned rows, sit `|v|` inside it.
  7. Job Review's burn-area size is also `|v|` wider than the artwork.
- **Evidence:** REPRO, `emitGcode` with `jobOrigin`. A copy of the test is in the scratchpad (`d8-repros/zz-d8-scan-offset.test.ts`, outputs in `run-all.txt`).
  ```
  R3  line min X {"zero":0,"plus":0.4,"minus":0}   most negative X in program -2   (overscan already goes below the origin)
  R3b {"current":[100,100.4],"centre":[-10,-9.8,-10.2],"right":[-20,-20,-20.4],"absolute":[50,50]}
  ```
  The existing placement test asserts that `G-code not.toMatch(/[XY]-/)`. R3 shows the overscan
  runway reaching X −2 regardless, so keeping commanded motion at or above the origin cannot
  explain the anchor choice.
- **Refuter:** CONFIRMED. Severity stays P2.
  - **What would make it false:**
    - an ADR that accepts the shift;
    - a sound "no negative X" reason;
    - LightBurn behaving the same way;
    - a layout limit that makes the shift rare.
  - **Own repro.** `emitGcode` plus `prepareOutput`, default profile, 20 × 6 mm fill at 3000 mm/min, table point at 3000 mm/min. Copy in the scratchpad: `zz-d8r-placement.test.ts`.
    - Fill and Line on the same rectangle, +0.3: the Line's min X goes from 0 to 0.3 at User Origin front-left.
    - Current Position (100, 100): from 100 to 100.3.
    - Centre anchor: from −10 to −9.85 (+0.3) or −10.15 (−0.3).
    - Front-right anchor with −0.3: from −20 to −20.3.
    - Absolute placement: no change.
    - Forward fill rows move with the Line. A fill-only job moves too (forward rows from 0 to 0.3).
    - Burn width goes from 20 to 20.3. Preflight is ok with 0 issues in every case.
  - **Narrower than raised:**
    - When the fill sits inside its Line outline (fill X 35–55 inside a 30–60 outline), nothing moves. The shift needs a reverse row of a bidirectional fill or image to define the anchor-side edge.
    - Registration-jig placement (ADR-057) is unaffected: `computeRegistrationBoxBounds` calls `computeJobBounds` without the device (`registration-placement.ts:22`).
    - Images are covered by the same code: `job-bounds.ts:249-251` adds the shifted rectangle to the burn bounds, and `job-bounds.test.ts` pins a raster `computeJobBounds` minX of −0.25 (READ).
  - **Intent:**
    - The device-aware anchor and the pinning test arrived together in #306 (`2b62c7294`). Neither the PR body nor DECISIONS.md gives a reason for it.
    - ADR-052 step 4 says only that "Frame placement and safety checks see compensated output extents". No ADR accepts moving vector cuts.
    - Two contracts say the opposite: ADR-052 ("keeps the design position authoritative") and WORKFLOW F-B13c item 2 (WORKFLOW.md:2705: "Job Origin aligns artwork bounds").
    - Not KNOWN: no earlier audit and no open PR covers it.
  - **Negative X:**
    - The pinning test's `not.toMatch(/[XY]-/)` holds only with `fillOverscanMm: 0`.
    - On the Neotronics 4040 profile with the layer default of 5 mm overscan, User Origin front-left emits X−5 at 1500, 3000 and 6000 mm/min, with or without a table, and preflight is ok.
    - The default profile emits X−5 even with 0 overscan (feed-matched runways). The auditor's X−2 comes from 2 mm overscan and is consistent.
  - **Ground truth:**
    - LightBurn's Job Origin is placed on "the smallest possible rectangle that can fully contain all graphics" (docs.lightburnsoftware.com/2.0/Reference/CoordinatesOrigin/). That is the graphics, not the output.
    - LightBurn's Scanning Offset guide (2.0) and Device Settings page say nothing about placement.
    - No forum post was found either way on whether Scanning Offset Adjustment moves a job placed at User Origin, so the direct LightBurn behaviour is Not verified.
  - **Correction:** with runways, the Frame starts at the runway (X−5 here), not exactly at the origin. It is identical with and without the table, so it still gives no cue.
  - **Severity:**
    - For P1: it is a silent change in the position of vector cuts.
    - Against P1: the shift is bounded by the table cap (at most 1% of the shorter bed axis, at most 5 mm; real tables are 0.1–0.5 mm). Fill and Line registration within one job is kept. Only edge-defining fills and images trigger it, and the jig path is unaffected.
    - Against P3: an ordinary user hits it today. The ADR-052 population (a calibrated table, plus Current Position or User Origin, plus an image-only or text-fill job at a left or right anchor) triggers it. It breaks two contracts and LightBurn's anchor rule, the Frame hides it, and a test pins it. P2 stands.
- **Fix direction:**
  - Anchor placement (and the job-size figure) on the uncompensated burn extent, that is design and forward rows.
  - Keep the compensated extents for the motion envelope, bounds and zone checks, and for Frame.
  - Update the pinning test to assert that the Line cut does not move.
  - The severity could be argued as P1 (a silent position change), but at typical table values it is sub-millimetre.

### D8-P3-1 — Reverse-only compensation leaves a calibrated fill or image half the measured separation off its vector outline; ADR-052's reason for rejecting half-each is physically inverted

- **Where:**
  - `src/core/job/scan-offset.ts:104-142` (reverse rows only).
  - The ADR-052 Decision (DECISIONS.md:3212-3214) and its rejected alternative (DECISIONS.md:3261-3263).
  - `ScanOffsetMeasurementFormatControls.tsx:47`: "forward rows remain on design coordinates".
- **Lens:** L2.
- **Anchor:** Ground truth.
  - LightBurn moves every line, so the user should "enter half the measured distance" (LightBurn 1.7 and 2.0 guide).
  - LightBurn's "Initial Offset … shift[s] the entire engraving left or right to align it with vector cuts" (LightBurn 2.0 guide).
  - softsolder (2024-09-24) observed that LightBurn's one-way engraving stays "slightly leftward-shifted" relative to the vectors. Rows that every scan direction displaces do not sit on design.
- **Scenario:**
  1. A machine has a 1 ms firing lag at 3000 mm/min: each row is displaced 0.05 mm along its travel, so the separation is 0.1 mm.
  2. KerfDesk's correct entry is −0.1, and both row directions then burn at design + 0.05 mm.
  3. The Line outline's vertical edges travel along Y and stay on design.
  4. So the engraving overlaps its outline by 0.05 mm on one side and leaves a 0.05 mm gap on the other. LightBurn's half-each shift (±0.05) puts both directions on design.
  5. There is no Initial Offset control, so the operator cannot correct it. The LightBurn-convention note says "also verify raster-to-vector placement", but there is nothing to adjust.
- **Evidence:**
  - REPRO, a lag model applied to the emitted G-code: `R2 {"E":0.05, "cal":{"forwardLeft":50.05,"reverseLeft":50.05}, "verticalLineXs":[70,50]}` (design X 50).
  - SOURCE as quoted above.
  - Related: `docs/audits/2026-09-05-cnc-laser-corrections.md:40` already lists "absolute placement, and raster/vector alignment still require an operator coupon" as a boundary. It does not record that the reverse-only geometry guarantees the offset, or that no control can remove it.
- **Refuter:** PLAUSIBLE. Severity stays P3; this is a maintainer decision.
  - **LightBurn guide (2.0, re-fetched):** it says to enter half the measured distance because LightBurn "moves each line by the amount you specify". Its Initial Offset shifts the whole engraving to line it up with vector cuts.
  - **No control in KerfDesk:** `RasterGroup.initialXOffsetMm` exists (`job.ts:207`), but no source file sets it. The UI note at `ScanOffsetMeasurementFormatControls.tsx:51-53` says Initial Offset is not represented.
  - **Depends on unmeasured physics:**
    - Under a pure firing-lag model the geometry holds.
    - Under a pure backlash model, reverse-only correction is exact and half-each would be off by half the backlash.
    - Which model applies is unmeasured hardware behaviour.
  - **ADR-052:** it rejected half-each on purpose ("Revisit only if a machine shows asymmetric lag"). Its rationale is what this finding disputes.
  - Not reproduced on hardware, so PLAUSIBLE.
- **Fix direction:** This is a maintainer decision. Either:
  - split the correction half to each direction, which keeps the full-gap entry and moves both directions by `v/2`; or
  - add an Initial Offset style "scan placement" shift and correct ADR-052's rationale.

### D8-P3-2 — An `.lf2` scan table is validated for structure only: an over-cap table is emitted with no warning, and a crafted table that interpolates to ±Infinity silently drops every reverse row

- **Where:**
  - `src/io/project/project-scan-offset-validator.ts:6-21`: lines 9-11 claim "the Start path surfaces the same finding as a Job Review warning instead".
  - `src/core/preflight/scan-offset-policy.ts:14-41` checks operation overrides only.
  - `src/core/job/scan-offset.ts:86-89`: `hi − lo` can overflow.
  - `src/core/job/fill-sweep-plan.ts:51` filters the non-finite sweeps away.
- **Lens:** L1, L4, L6.
- **Anchor:**
  - Contract: the ADR-236 bullet says "Device calibration tables keep their stricter input-time validation; this warning policy applies to job operation overrides" (DECISIONS.md:11245-11246).
  - Twin: `.lfmachine.json` import rejects the same table through `validateMachineProfile` → `validateScanOffsetProfile` (`profile-catalog.ts:275`). The interactive patch silently clears the whole table at the first Machine Setup edit (`device-profile-patch.ts:25-31`).
- **Scenario:**
  - A legacy or shared `.lf2` on a 200 × 200 mm bed (cap 2 mm) carries `{3000, 4.5}`. It opens. Reverse rows are emitted 4.5 mm left, `preflight.ok` is true, and there is no scan-offset issue. Job Review shows only "1 point(s) · …".
  - A crafted table `{1000, −1e308}, {5000, 1e308}` gives `offsetForSpeed(…, 3000) = Infinity`. Three of the six fill rows are emitted, `preflight.ok` is true, and there is no issue.
  - On an image, the same table would hit the raster emitter's `scanOffsetMm must be finite` throw. That path was read only, not run.
- **Evidence:** REPRO:
  ```
  R4 {"ok":true,"codes":[],"edges":{"forwardLeft":50,"reverseLeft":45.5,...,"rows":6}}
  R5 offsetForSpeed Infinity; open ok; emit ok=true codes=[] rows=3 (rowsNoTable=6)
  ```
- **Refuter:** CONFIRMED. Severity stays P3, not P2.
  - **Own repro** (`serializeProject` → `deserializeProject` → `emitGcode`, default profile; copy in the scratchpad: `zz-d8r-infinity.test.ts`):
    - The table `{1000, −1e308}, {5000, 1e308}` opens unchanged.
    - `offsetForSpeed(…, 3000)` returns Infinity.
    - The output has 3 forward rows and 0 reverse rows; without the table there are 3 and 3.
    - There is no Infinity or NaN in the text. Preflight is ok with 0 issues.
  - **READ:** `scan-offset-policy.ts` checks operation overrides only. `.lf2` Open uses `normalizeScanOffsetTable`, which checks structure only.
  - **Why it is not P2:**
    - Only a hand-crafted file reaches it. No measurement, no editor entry and no `.lfmachine.json` import produces such values.
    - The failure leaves the laser off: rows are missing, so the part is under-burned, and there is no motion outside the envelope.
    - The image path throws instead.
    - Preview uses the same `planFillSweeps` call, so it shows the same missing rows (READ).
    - The same file can already spoil a job silently with legal values: a 4 mm table, within the cap on the 400 mm default bed, emits with preflight ok and 0 issues.
  - **Over-cap half:** the validator comment promises a warning at Start that does not exist, which is doc/code drift.
- **Fix direction:**
  - Add a device-table magnitude advisory to the Start and Save preflight, as the validator comment promises.
  - Reject or neutralise non-finite results of `offsetForSpeed`, for example by clamping each table point to the cap at use.
  - Tell the operator when an interactive edit clears an invalid table.

### D8-P3-3 — "Verify saved table" on a require-verified profile with no saved table burns one-way rows, while the dialog and WORKFLOW call it an uncorrected comparison to inspect for alternating edges

- **Where:**
  - `src/core/job/scan-direction-policy.ts:39`: verification bypasses the fallback only when the table is non-empty.
  - `src/ui/calibration/ScanOffsetCalibrationDialog.tsx:122` and `:238-241`.
  - WORKFLOW.md:5072-5074.
- **Lens:** L3.
- **Anchor:** Contract. WORKFLOW F-SO1 item 1 says "with no saved points it remains a useful uncorrected comparison"; the dialog says "inspect alternating edges physically".
- **Scenario:** On a Neotronics 4040 profile with an empty table, an operator chooses Verify saved table. Every swatch compiles as `uncalibrated-profile-fallback`, one-way, so there are no alternating edges to compare. The warning still promises an uncorrected comparison.
- **Evidence:** REPRO: `R6 [{"bidirectional":false,"reason":"uncalibrated-profile-fallback"} ×2]`.
- **Refuter:** CONFIRMED (P3).
  - **Code trace:**
    - With an empty table, `effectiveScanOffsetCalibrationStatus` returns `uncalibrated` (`scan-offset-profile.ts:66`).
    - The verification bypass requires a non-empty table (`scan-direction-policy.ts:39`).
    - Without the expert override, the result is `uncalibrated-profile-fallback`, one-way (`:52`).
  - **Text:** the dialog (`ScanOffsetCalibrationDialog.tsx:122, :240`) and WORKFLOW.md:5072-5074 still promise an uncorrected comparison.
  - This matches the auditor's R6.
- **Fix direction:** On such profiles, either warn that the coupon will run one-way and point to Baseline, or treat an empty-table verification like a baseline (bidirectional, zero offset).

### D8-P3-4 — Opening a `.lf2` keeps the file's "verified" scan status (bidirectional on require-verified profiles), while importing the same table as a machine profile marks it pending

- **Where:**
  - `src/io/project/deserialize-project.ts:338-341` keeps the status.
  - `src/io/machine-profile/machine-profile-io.ts:232-242` marks imports pending "because the file does not bind them to this physical machine and laser head".
  - `scan-direction-policy.ts:46-47`.
- **Lens:** L3, L4.
- **Anchor:** Twin: the two import paths for the same calibration data treat its status differently.
- **Scenario:** A shared `.lf2` from another owner of the same built-in 4040 profile carries their table and `verified`. On Open, the device is installed. When the profile id, name and bed match, no banner shows (12-P2-1, 13-P1-1). Scanline Fill then runs bidirectionally with the other machine's table, and Job Review says "verification recorded". The same table imported as `.lfmachine.json` would stay one-way and pending.
- **Evidence:** REPRO: `R7 {"openedStatus":"verified","dirOpened":[{"bidirectional":true,"reason":"calibrated-bidirectional"}],"imported":"pending"}`.
- **Known:** The mechanism, Open installing the document's device wholesale, is KNOWN as 12-P2-1 (now P3) and is by design under ADR-500 Amendment 1 §2. The finding is the status twin, which alone changes the scan direction.
- **Refuter:** CONFIRMED (P3).
  - **Code trace:**
    - On `.lf2` Open, any valid status is kept when the table is non-empty: `normalizeScanOffsetCalibrationStatus` (`scan-offset-profile.ts:74-79`) is called from `deserialize-project.ts:338`.
    - `.lfmachine.json` import sets the status to `pending` unless the read mode is `restore` (`machine-profile-io.ts:232-242`).
  - This matches R7.
  - **Not covered by ADR-500:** Amendment 1 §2 says Open uses the document's machine, but it says nothing about calibration status.
  - **Novelty:** the status twin is new; neither `12-camera.md` nor `13-project-io.md` mentions scan offsets.
- **Fix direction:** Mark a table pending on Open unless it equals the machine's remembered table (as for `restore`), or show it in the machine banner.

### D8-P3-5 — The coupon and tutorial give no way to tell the sign; the module comment and ADR describe lag semantics that need a negative entry; no core test uses a negative table

- **Where:**
  - The coupon has no direction cue: `scan-offset-calibration-pattern.ts:99-145` emits swatches and speed labels only.
  - The tutorial step says "Measure the signed gap" (`calibration-tutorials.ts:111-113`).
  - The module comment says "slide each reverse row back along its own travel" (`scan-offset.ts:9-10`), and ADR-052 says "slides the lagging row back into registration" (DECISIONS.md:3206-3207).
  - The core property tests use positive tables only (`scan-offset.test.ts:46-50, 89-108`). There are no negative-table raster or fill emitter tests.
- **Lens:** L2, L7.
- **Anchor:**
  - Ground truth: LightBurn staff on forum thread 3152 say positive values mean "start scanning later" (backlash) and negative values "start the scan earlier" (power-supply lag).
  - Contract: WORKFLOW F-SO1 item 4 asks for "the full signed forward-versus-reverse separation".
- **Scenario:**
  1. Under firing lag, the cause ADR-052 is written for, the correct KerfDesk entry is negative.
  2. An operator measures a 0.1 mm comb on the baseline coupon. The burn does not show which rows ran in reverse, so the operator enters +0.1, the unsigned magnitude.
  3. Reverse rows move a further 0.1 mm along their travel, and the zipper doubles to 0.2 mm.
  4. Only the next verification burn reveals it. LightBurn has the same ambiguity, so this is guidance, not a convention bug.
- **Evidence:** SOURCE (forum thread 3152) and READ. The R1 REPRO confirms the code's direction: `reverseLeft 50 → 49.6` for +0.4.
- **Known:** Related to KNOWN H1 (`docs/audits/2026-07-17-burn-quality-findings-register.md:288-292`, "sign may be inverted"). The new evidence shows the sign matches LightBurn's, so H1's inversion worry does not hold. What remains is the guidance and test gap.
- **Refuter:** CONFIRMED (P3).
  - **Sign source:** re-fetched forum thread 3152. Oz says negative values start the scan earlier (power-supply lag) and positive values start it later (backlash).
  - **No direction cue:** the coupon emits swatches and speed labels only (`scan-offset-calibration-pattern.ts:128-140`), and the tutorial says only "Measure the signed gap" (`calibration-tutorials.ts:111-113`).
  - **Correction to the test-gap claim:**
    - A fill emitter test does use a negative override: `grbl-fill-compaction.test.ts:153`, −0.23.
    - The placement test uses a −0.5 table.
    - No core lookup test and no raster-emitter test uses a negative table.
- **Fix direction:**
  - Burn a direction mark on the coupon, for example an arrow or a dot at each reverse row's start.
  - In the tutorial, state "reverse ends further along reverse travel → negative".
  - Correct the comment and ADR wording.
  - Add negative and sign-crossing table tests for the lookup and both emitters.

## Refuted

None at the refuter stage either: no raised finding was refuted or found KNOWN.

Refutations the refuter tried for P2-1, which failed:
- **Deliberate, documented trade-off.** No. The anchor change and its test came in with #306, which records no reason. No ADR accepts moving vector cuts.
- **Keeps the program free of negative X.** No. Runways already reach X−5 in User Origin placement, and preflight is ok.

Candidates the auditor dropped before raising:
- **Sign inverted against LightBurn.** No. LightBurn staff confirm that positive means "start later", which is the same as KerfDesk (see P3-5).
- **Optimizer or start point reverses fill sweeps and breaks the flag-direction link.** No. Fill sweeps are never reversed (`optimize-paths.ts:191-202`; `applyJobStartPoint` changes only cut and CNC groups, `job-start-point.ts:117-140`), and every hatch keeps "reverse ⇔ travels −x′" (`fill-hatching.ts:306-313`).
- **Rotary Y scaling makes the shift wrong.** No. A time lag is `τ·F` in machine units, and the shift is applied in machine units at the commanded F.
- **Preview or bounds use a different feed than emission.** No. `offsetForEmittedFeed(speed)` equals `offsetForSpeed(roundedPositiveFeed(speed))` (`feed-word.ts:9-14`, `grbl-laser-lines.ts:34-39`).
- **Raster row parity differs between emitter and twins.** No. Every twin counts a row only when it has a powered span, and collapsed sweeps still count (`emit-raster.ts:217-250`, reverse at `:221`, `toolpath-raster-steps.ts:30-63`, `job-start-bounds.ts:103-121`).
- **A material recipe's local offset leaks into other layers.** This is documented behaviour (WORKFLOW F-ML2 step 3, WORKFLOW.md:4994-4998), not raised.

## Verified clean

- **Direction.** Every consumer (fill, raster, preview, motion and burn bounds, start bounds, first-process point, estimate, island ordering) moves only reverse rows, by the same signed `v` along their own travel, with runways and shared split points included. Confirmed by R1 and by the existing `grbl-strategy-scan-offset`, `emit-raster-scan-offset`, `scan-offset` and `scan-offset-calibration-pattern` tests, re-run: 34 of 34 pass.
- **LightBurn conversion.** ×2 with the sign preserved is correct under LightBurn's "enter half" rule and its "positive = start later" sign. mm/s ×60 is correct.
- **Interpolation.** Linear between points, clamped above the last, scaled from rest below the first. It matches ADR-052, and the Job Review coverage warning text ("Below the first sample, correction scales from zero; above the last sample, it stays at the last offset") matches the code. The lookup uses the represented F everywhere.
- **Coverage.** Scanline, Island, angled and cross-hatch fill; images at any scan angle, cross-hatch and angle per pass (separate groups); dithered, grayscale, pass-through and streamed rows; multi-pass (parity resets per pass in the emitter and every twin); Marlin and Smoothieware; origin mirroring; rotary. Offset fill and one-way operations are correctly untouched.
- **Calibration labels.** Labels, layer speed and emitted F agree (cap, then floor); the defaults follow LightBurn's procedure; baseline forces 0 and bidirectional; verification uses the table (with the P3-3 exception).
- **Status lifecycle.**
  - Interactive table edits and Apply set pending.
  - A controller or dialect change clears the table and lists the change.
  - A bed change that invalidates the table clears it.
  - Pending stays one-way on require-verified profiles, even with the expert override.
  - A table change invalidates the Frame, because scanning calibration is a spatial input (ADR-565).
- **Messages.** The non-finite override message is true (falls back to the table); the override notice and the Job Review local-offset fact are true; the Raster Diagnostics runway check is unaffected by the shift because the runway moves with the row.

## Not verified

- **LightBurn's off-table behaviour and interpolation method.** The docs say only "compute the correct adjustments for other speeds", and the forum threads do not say either.
- **LightBurn's sign.** It is not in the official docs; the evidence is a staff forum post.
- **LightBurn's job-origin anchor with scanning offsets.** No source says directly whether it anchors on the design or the compensated extent. The refuter found the general rule: Job Origin uses the rectangle that contains all graphics (CoordinatesOrigin reference, 2.0). That points to the design extent.
- **Hardware.** There was no burn. Whether firing lag or backlash dominates on the 4040 and Falcon is unknown, and P3-1 and P3-5 rest on a lag model and a backlash model.
- **UI rendering.** Not checked in a browser. The raster-path throw for an Infinity table (P3-2) was read only, not run.
- **Generate Path From Cut** bakes the commanded, compensated reverse rows into new artwork (`path-from-cut-actions.ts:56-62`). This matches the preview. Whether "what the laser burns" should mean the burned position is a product question.

## Known (re-encountered, not re-raised)

- **H1** (`2026-07-17-burn-quality-findings-register.md:288`): the scan-offset sign may be inverted. It is resolved by the UI convention text and by LightBurn's sign; the residue is P3-5.
- **12-P2-1 (now P3):** Open installs the document's device wholesale. The scan table and its status travel with `.lf2` files; this is the basis of P3-4.
- Rolling-v2 area 03 Verified clean: "Scan offset applies to reverse rows only, interpolated and clamped as ADR-052 says". Consistent with this audit.

```json
[
  {"id":"D8-P2-1","severity":"P2","area":"ctl-scan-offsets","file":"src/core/job/job-bounds.ts","line":218,"anchor":"Contract ADR-052 (DECISIONS.md:3213 forward rows and vector cuts stay at design coordinates); Twin: placement bounds exclude non-burning overscan but include the compensation shift; job-origin.ts:108 anchors on computeJobBounds","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"User Origin / Current Position / Verified Origin placement anchors on the compensated reverse rows, so a scan-offset table moves the whole placed job, Line cuts included, by the full offset (+0.4 -> cut at X0.4; centre +/-0.2; right anchor with negative values); the Frame envelope is identical with and without the table; a test pins it; refuter: only when a bidirectional fill/image row defines the anchor-side edge (an enclosed fill does not move), jig-box placement unaffected"},
  {"id":"D8-P3-1","severity":"P3","area":"ctl-scan-offsets","file":"src/core/job/scan-offset.ts","line":104,"anchor":"Ground truth: LightBurn guide (enter half; each line moves; Initial Offset aligns with vector cuts), softsolder 2024-09-24; Contract: ADR-052 rationale DECISIONS.md:3212,3261","evidence":"REPRO","verdict":"PLAUSIBLE","known":false,"summary":"Reverse-only correction leaves a calibrated fill/image half the measured separation off its vector outline (lag model: rows at design+0.05 for 0.1 separation, outline on design); LightBurn's half-each centres it; no Initial Offset control; ADR-052's reason for rejecting half-each is physically inverted (maintainer decision)"},
  {"id":"D8-P3-2","severity":"P3","area":"ctl-scan-offsets","file":"src/io/project/project-scan-offset-validator.ts","line":9,"anchor":"Contract: ADR-236 decision bullet DECISIONS.md:11245 (device tables keep stricter input-time validation); validator comment claims a Start warning; Twin: .lfmachine.json import rejects the same table (profile-catalog.ts:275)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A .lf2 scan table is checked for structure only: an over-cap 4.5 mm table on a 200 mm bed opens and shifts reverse rows 4.5 mm with no preflight issue; a crafted +/-1e308 table interpolates to Infinity and silently drops every reverse fill row (3 of 6 emitted, preflight ok)"},
  {"id":"D8-P3-3","severity":"P3","area":"ctl-scan-offsets","file":"src/core/job/scan-direction-policy.ts","line":39,"anchor":"Contract: WORKFLOW F-SO1 item 1 (WORKFLOW.md:5074) and ScanOffsetCalibrationDialog.tsx:122 promise an uncorrected comparison","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Verify saved table on a require-verified profile (4040) with no saved table compiles every swatch one-way (uncalibrated-profile-fallback), so there are no alternating edges to inspect, while the dialog and WORKFLOW call it an uncorrected comparison"},
  {"id":"D8-P3-4","severity":"P3","area":"ctl-scan-offsets","file":"src/io/project/deserialize-project.ts","line":338,"anchor":"Twin: machine-profile-io.ts:232-242 marks imported tables pending because a file is not bound to this machine; .lf2 Open keeps 'verified'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Opening a shared .lf2 keeps the file's 'verified' scan status, so on a require-verified profile Scanline Fill runs bidirectionally with another machine's table and Job Review says 'verification recorded'; the same table imported as a machine profile stays pending and one-way (mechanism KNOWN 12-P2-1)"},
  {"id":"D8-P3-5","severity":"P3","area":"ctl-scan-offsets","file":"src/core/job/scan-offset-calibration-pattern.ts","line":99,"anchor":"Ground truth: LightBurn staff, forum t/3152 (positive = start later for backlash, negative = start earlier for lag); Contract: WORKFLOW F-SO1 item 4 signed separation","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"The coupon has no direction cue and the tutorial does not define the sign, while scan-offset.ts:9 and ADR-052 describe 'slide back' lag semantics that need a negative entry; entering the unsigned measured gap doubles a firing-lag zipper; no core test uses a negative table (related KNOWN H1, whose inversion worry does not hold)"}
]
```
