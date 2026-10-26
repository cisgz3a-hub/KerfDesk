# Rolling audit v2 — G-code viewers (Inspector, CNC 3D viewer, G-code view)

- **When:** 2026-10-22 01:00–02:00 +0800   **Tree:** origin/main @ `902f1d0c0` (worktree HEAD
  `df7411a98` adds only audit docs; `git diff origin/main HEAD -- src electron` is empty).
- **Scope:** `src/ui/gcode-inspector/**` (parse, worker, findings, readouts, burn and stock
  previews, source pane, Run on machine), `src/ui/cnc-viewer3d/**`, and the UI-facing side of
  `src/core/gcode-view/**` (render model, word layer, arcs, placement, Program Health).
  Twins followed into `src/core/gcode/word-scan.ts`, `arc-solve.ts`, `modal-axes.ts`,
  `src/core/external-program/**`, `src/core/job/motion-manifest*.ts`, `src/core/toolpath3d`,
  `src/ui/workspace/{Cnc3DPane.tsx,use-cnc-3d-scene.ts,design-scene-source.ts}`.
  Governing: ADR-255 (+ Amd 1, Amd 2, the two 2026-08-05 lens amendments), ADR-261, ADR-268,
  ADR-425, ADR-426, ADR-470, ADR-485, ADR-487, ADR-501, ADR-525, ADR-627, ADR-629,
  ADR-630 (+ Amd 1). Prior audits: 2026-07-25 Inspector design and self-audit, 2026-07-26 viewer
  competitive audit, 2026-09-24 CNC full audit (PV-1..4), 2026-09-29 second pass (WA-3, WA-4,
  P2-preview-3), reports 03, 04, 05, 16 and 18 of this round.
- **Lenses run:** L2, L3, L4, L7 stressed (one pass each); L1 and L6 lightly (contract clauses of
  ADR-255/487/630, worker error path). L5 only as untrusted-file input (L4). No browser run.
- **Counts:** 10 raised → 0 refuted → P1 0 / P2 0 / P3 10 (+ 11 KNOWN re-observed). Refuter: 10
  confirmed (P3-4 and P3-7 narrowed), 0 plausible, 0 refuted. Severity changes: P2-1 P2 → P3 (the pane
  is not mounted in production); KNOWN K-1 (WA-4) P3 → P2 (it now shortens the external-run Frame).

## Headline

The Inspector's parser is faithful to GRBL v1.1 where it claims to be: R-arc sign, full circles,
units on F/I/J/R, G91 arcs, comments, block delete, case and M2/M30 resets all match `gcode.c` /
`protocol.c` in repros. The one ordinary-user defect is next door in the CNC **3D result pane**:
during a run it places the bit and reveals the path by the streamed program's route length, but
measures along a different route (the absolute-placed preview, started at an assumed origin). On
a User Origin job the pane still shows the bit at the first plunge, with nothing revealed, after
the job has finished. The rest are P3: Run-review line numbers that do not match the file, a burn
preview that burns after `M5` on opened files, a Studio bed outline that ignores the program's
absolute offset, and non-finite numbers that reach the drawing as NaN. The largest open risk is
still a KNOWN item. Since ADR-630 lets opened files run, skipped G18/G19 arcs (K-4) shrink the
Frame outline, not just the picture.

**Refuter's note on the headline:** P2-1 is real but latent. The 3D result pane has not been mounted
in production since #633, so it is P3. The top item in this area is the KNOWN WA-4 (K-1 below),
re-rated P2. Through the real Run chain, an opened program with one G18/G19 arc gets a Frame that
stops 10 to 30 mm short of where GRBL moves. In a G18 raster, half the part is never framed. See
"Refuter ruling on the WA-4 re-rating".

## Findings

### P2-1 — CNC 3D result pane follows a live job on the wrong route basis: bit and revealed path are off by the difference between two routes (hundreds of mm on User Origin jobs) (refuter: P3, latent; the pane is not mounted)
- **Where:**
  - `src/ui/cnc-viewer3d/viewer3d-live-run.ts:55`: `revealMm: run.route.confirmedRouteMm` (the
    streamed program's motion-manifest route). `headMm` (`:51`) is computed but never read.
  - `src/ui/workspace/use-cnc-3d-scene.ts:190`: `setScrubMm(live.revealMm)` →
    `viewer3d-content.ts:165`: the bit goes to `pointAtArcLength(toolpath.moves, atMm)`, and the
    lines are revealed to the same millimetre.
  - The pane's moves come from `design-scene-source.ts:50`: `prepareOutput(project,
    { outputScope })` with no `jobOrigin` (absolute placement), via
    `buildPreviewToolpathFromPrepared` with the preview's assumed start
    (`draw-preview.ts:212,274`).
- **Anchor:**
  - Twin: `run.route.confirmedRouteMm` is measured along `buildMotionManifest(gcode,
    { initialPosition: reported work position })` of the placed, streamed bytes
    (`canvas-motion-plan.ts:137-141`). The pane measures along the preview toolpath. The two
    routes share neither start, placement nor preamble. The Inspector's own live view
    (`inspector-live-progress.ts`) does this correctly: it matches manifest blocks to model
    segments by source line and geometry, and declines when they differ.
  - Contract: the module states "the cutter sits where the controller says the head is, and the
    path is revealed to the length the controller has confirmed". `Cnc3DPane.tsx:84` says "the
    controller — not the scrubber — says where the bit is". ADR-261 §2 allows arc-length agreement
    only between views that share the preview route.
- **Scenario:** A 4040 CNC project cuts a 50 mm square at canvas (100..150, 100..150) with the
  default profile-on-path bit. The job runs from User Origin (the default when homing is off),
  with the head at work 0,0, Z10.
  - The streamed program's total route is 319.0 mm. The pane's route is 837.3 mm, and its first
    cut starts at 316.2 mm.
  - When the controller starts the first cut (manifest route 62.6 mm), the pane draws the bit on
    its approach travel at scene (19.8, 340.6, Z3.81).
  - When the job finishes (319.0 mm confirmed), the pane draws the bit at the first plunge
    (100, 100, Z1.0). The cut path is still unrevealed.
  - Absolute placement from work (200,150,Z10) has a −125 mm offset. From work 0,0,Z10 it has
    +11 mm (the preamble `G0 Z3.81` and the approach).
- **Evidence:** REPRO. Temporary `src/ui/workspace/zz-26-cnc-live-reveal.test.ts` (deleted; copy in
  the auditor's scratchpad `repros-26/`). `node ../../../node_modules/vitest/vitest.mjs run
  src/ui/workspace/zz-26-cnc-live-reveal.test.ts --silent=false`:
  `user-origin, head at 0,0,Z10 {"manifestTotal":319.03,"paneTotal":837.27,"manifestFirstProcessAt":62.61,"paneFirstCutAt":316.23,"paneBitWhenControllerAtFirstProcess":{"x":19.80,"y":340.60,"z":3.81},"paneBitAtManifestEnd":{"x":100,"y":100,"z":1.003}}`.
  `viewer3d-live-run.test.ts` only tests the pure field copy, so nothing pins the basis.
- **Novelty:** No prior report. The 2026-07-25 3D roadmap (item 9) asked for this wiring. No
  later audit checked the basis.
- **Refuter:** CONFIRMED (mechanism), **severity P2 → P3: latent, not reachable in production**.
  Own repro (`zz-26r-live-basis.test.ts`, deleted): even in the pane's best case (Absolute job, head
  at the preview's assumed 0,0) the two routes differ (pane 854.7 mm, manifest 863.4 / 865.7 mm from
  Z0 / Z10), and `LiveViewerState.headMm` has no reader anywhere in `src`, so the bit is placed by
  arc length, never by the report. Display-only: `liveViewerState` feeds only `setScrubMm`
  (`viewer3d-content.ts:162-168`); nothing reaches the controller. But `Cnc3DPane` has not been
  mounted since #633 (2026-08-03): `App.tsx:77-84` says it "is deliberately not mounted", App imports
  nothing else from it, and its only mount is the E2E harness (`e2e/fixtures/cnc-3d-pane-harness.tsx`,
  "Production never imports this module"). `Cnc3DFullPage` opens only from that pane. Latent → P3
  (METHOD §3). Fix before the pane is ever mounted again.
- **Fix direction:** Place the bit at `reportedHead`, mapped into the scene frame through the job
  placement. Reveal by mapping the confirmed manifest block back to the preview step it came from
  (by line or pass span), as the Inspector does. Otherwise show no reveal rather than a wrong one.

### P3-1 — Run review warnings cite line numbers of the normalized program, not the opened file; refusals in the same dialog cite file lines
- **Where:** `src/core/external-program/external-program-review.ts:141-143` passes Program Health
  findings through verbatim. Their details carry `line + 1` of the model
  (`finding-checks.ts:38`, `:161`). That model parses the normalized bytes: baseline line first,
  comments, blank lines and `%` removed (`normalize-external-program.ts:103,120`). Refusals count
  source lines (`normalize-external-program.ts:110,117,125`).
- **Anchor:** Twin. The refusal and the warnings are in the same Run dialog. The Inspector source
  pane beside it shows the opened file. ADR-630 says the dialog "states" the transformations, but
  it never says the line numbers are in the sent program.
- **Scenario:** A Fusion-style file starts with two `(...)` header lines and a blank line. It cuts
  at file line 6 before `M3` at line 8, and has a G18 arc at line 9.
  - The review says "first cutting move is on line 4, before the spindle/laser is switched on at
    line 6" and "Some moves could not be drawn … First: line 7".
  - With a `$H` added at file line 10, the refusal says "Line 10". The operator looks up the wrong
    lines.
- **Evidence:** REPRO. `zz-26-run-lines.test.ts` (scratchpad copy). Sent lines
  `["G17G21G90G94G0","G21G90","G0X0Y0Z5","G1Z-1F100","G1X10","M3S10000","G18G2X20Z-1I5K0"]`, then
  the warnings quoted above.
- **Novelty:** Not in reports 05 or 18 or the ADR-630 audit. Open PR #1351 changes the review for
  Marlin but not the line mapping.
- **Refuter:** CONFIRMED. Own run (the WA-4 case B file below, no comment lines): the G18 arc on file
  line 6 is reported as "First: line 7", because the baseline line is prepended. The normalizer's
  refusals count source lines (`lineNumber`, `normalize-external-program.ts:109-125`). A refusal
  replaces the review, so the two numberings meet across two attempts rather than on one screen. P3.
- **Fix direction:** Keep a normalized-to-source line map from the normalizer and translate finding
  lines through it, or say "line N of the sent program".

### P3-2 — Burn preview on an opened file burns moves after `M5`/`M2`, and moves of a program that never switches the laser on
- **Where:**
  - `src/ui/gcode-inspector/burn-grid.ts:82-84`: `burnsAt` = `segKind === cut && segPower > 0`.
  - For an opened file `machineKind` is undefined, so `isLaserOffFeed` (`laser-render-state.ts:51`)
    and `renderedPower` (`:54-63`) ignore the spindle state.
  - `use-laser-burn.ts:126-130` offers the burn preview for any opened file that carves nothing
    below Z0.
- **Anchor:**
  - Contract: ADR-487 §5, "Each move the laser is on for lays its beam's width of burn".
  - Ground truth: GRBL laser mode, where `M5` and a program end switch the laser off.
  - Twin: the same text with `machineKind: 'laser'` burns correctly.
- **Scenario:** An opened file runs `M4 S800 / G1 X10 F1000 / M5 / G1 X20 / G1 Y10`. The preview
  burns lines 3, 5 and 6, where the machine burns only line 3. A file with `G1 … S800` and no
  `M3`/`M4` burns everywhere.
- **Evidence:** REPRO. `zz-26-burn-m5.test.ts`:
  - `afterM5 opened-file burning lines (0-based): [2,4,5]` against `laser … [2]`
  - `noSpindleOn opened-file … [1,2]` against `[]`
  - `afterM2 opened-file … [2,4]` against `[2]`
- **Refuter:** CONFIRMED. Own repro with `burnsAt`: `M3 S500 / G1 X10 / M5 / G1 X20 / G1 Y5` burns
  lines [2,4,5] as an opened file and [2] as laser; with `M30` [2,4] against [2]; `G1 X10 S500` with no
  M3 burns [1] against []. File > Open leaves `machineKind` undefined (`withCurrentDevice` adds only
  timing and laser), and `use-inspector-materials.ts:27` passes that to the burn.
- **Fix direction:** The burn path is only offered when the file is read as a laser program. It
  can use the spindle state the word layer already tracks (`modal.spindleMode`) without changing
  the CNC-neutral `segKind`.

### P3-3 — Studio's laser work-area outline ignores the absolute program offset, so a negative-workspace GRBL job is drawn off the bed
- **Where:** `src/ui/gcode-inspector/gcode-inspection-source.ts:89-96`.
  `projectInspectionContext` draws `machineBoundsForDevice` (bed frame). It receives the
  `EmittedDesignPlacement` whose `jobOriginOffset` holds the Absolute offset
  (`prepare-output.ts:301-305`, set by `job-placement.ts:194-212`), and uses it only for reliefs.
- **Anchor:** Contract, from the module's own comment (`:39-40`): "The machine bed in program
  coordinates, only when the program runs in that frame". ADR-426 item 4 says the outline is the
  machine's work area.
- **Scenario:** A homed GRBL with native travel −400..0, and a profile bed of 400×400 that matches
  `$130`/`$131`. An Absolute job is emitted at bed − 400 (program X −390..−340, Y −60..−10).
  Studio draws the work area at X 0..400, Y 0..400, so the job appears entirely off the bed. The
  same happens with any nonzero WCO in Absolute.
- **Evidence:** REPRO. `zz-26-workarea.test.ts`:
  `program cut bounds {"minX":-390,"maxX":-340,"minY":-60,"maxY":-10}` against `studio workArea
  {"minX":0,"maxX":400,"minY":0,"maxY":400}`. Studio is opt-in (Classic draws no outline), hence P3.
- **Refuter:** CONFIRMED (both twins read; consistent with the auditor's repro). `projectInspectionContext`
  draws `machineBoundsForDevice` and uses `placement` only for the design (`gcode-inspection-source.ts:76-96`).
  Absolute output is shifted by `absoluteProgramOffset` (−WCO, or −the bed position of work zero:
  `job-placement.ts:191-211`, `prepare-output.ts:301-305`). So the outline and the program disagree
  whenever that offset is nonzero. Drawn only by Studio (`studio-furniture.ts:41-42`). P3.
- **Fix direction:** Translate the outline by `placement.jobOriginOffset`, or omit it when the
  offset is nonzero.

### P3-4 — Non-finite `I`/`J`/`R`/`F`/`P` words reach the model: NaN arc vertices, "~NaNs" time, no finding
- **Where:**
  - `src/core/gcode-view/gcode-render-model-builder.ts:263-266` guards only the X/Y/Z target.
  - In `emitArc` (`:368-383`) a radius of `Infinity` gives `|radius − endRadius| = NaN`, and
    `NaN > tolerance` is false, so the arc is drawn.
  - `render-model-words.ts:189,199` store any F or P.
  - `inspector-readouts.ts:118-123` formats NaN as "NaNs".
- **Anchor:** The audit question (Q4: an honest error for malformed numbers). Twin: the X/Y/Z path
  already skips non-finite targets with a reason ("non-finite target coordinate").
- **Scenario:** An opened file with `G2 X0 Y0 I1000…0 J0` (a 401-digit `I`; `parseFloat` →
  Infinity) gives 362 segments with 1,436 non-finite coordinates, NaN motion bounds and total time
  NaN. The readout shows "Est. time ~NaNs", and Program Health is silent. A 401-digit `P` dwell
  gives an infinite time. In the Run review, the envelope silently drops the arc. Hostile or
  corrupt input only, with no hang or crash.
- **Evidence:** REPRO. `zz-26-nonfinite.test.ts`:
  `G2 X0 Y0 I1000000000 {"segs":362,"nanPositions":1436,"motion":{"minX":null,…},"total":null,"findings":["cut-before-spindle","no-program-end"]}`.
- **Refuter:** CONFIRMED, narrowed to I/J and P. Own repro: a 402-digit `I` gives 361 segments,
  1,436 non-finite coordinates, null (NaN) bounds and "~NaNs"; a 402-digit `P` gives an infinite time
  shown as "~Infinitym NaNs"; no finding in either case. Through the real Run chain the `I` arc is
  left out of a finite envelope (X 0..10, Y 0..10) with no warning, as claimed. Not for F (the timing
  clamps it: 0.4 s) or R (no NaN; that arc vanishes, also with no finding). Hostile input only, P3.
- **Fix direction:** Skip lines whose I/J/R are non-finite with a reason, and treat non-finite
  F/P/S as unsupported values, as X/Y/Z already are.

### P3-5 — A space inside a number (`X1 0`) makes the Inspector discard the line as junk, though GRBL runs it (`X10`)
- **Where:** `src/core/gcode/word-scan.ts:111-131` (`scanCompleteGcodeWords` rejects a bare
  number between words). `native-laser-render-words.ts:11` uses it for the Inspector's own view.
- **Anchor:**
  - Ground truth: GRBL `protocol.c`, "Throw away whitepace and control characters" (every byte at
    or below a space) before parsing.
  - Contract: ADR-255 decision 7 (GRBL-flavour dialect). ADR-630 already normalizes "`G 1 X1 0 0`
    is read and run as `G1X100`", so the Run review is right.
  - Twin: the opened-file Inspector view and its own Run review read the same line differently.
- **Scenario:** `G1 X1 0 F100` draws nothing and gives "Unreadable lines". GRBL, and the Run
  review, move to X10.
- **Evidence:** REPRO. `zz-26-parser.test.ts`:
  `spaces in number {"n":0,…,"cats":[4,7],…,"findings":["junk-line@1","no-motion@null"]}`.
- **Refuter:** CONFIRMED. Own repro: the Inspector draws 0 segments for `G1 X1 0 F100` (findings
  `junk-line`, `no-motion`); `canonicalLine` gives `G1X10F100`, and the Run review's model of the
  normalized bytes moves X 0..10. Ground truth fetched: gnea/grbl `protocol.c` drops every byte at or
  below a space ("Throw away whitepace and control characters"), and `gcode.c`'s header says the
  line it parses holds "no whitespace", so GRBL runs `X10`.
- **Fix direction:** Feed the viewer the same canonical line form the normalizer builds
  (`canonicalLine`), keeping the raw line for the source pane.

### P3-6 — The canvas "G-code 3D" view draws the program frame, so on rear-origin and front-right machines (shipped xTool D1 Pro is rear-left) the job appears mirrored against the Design view
- **Where:**
  - `src/ui/gcode-inspector/CanvasGcodeView.tsx:1-5` ("answers 'what will this run?' at a glance";
    it replaces the design canvas).
  - The Inspector draws raw program XY with +Y away.
  - `origin-transform.ts:60-63`: on rear-left, machine Y equals scene Y, toward the operator.
  - `brand-laser-profiles.ts:92`: xTool D1 Pro is `origin: 'rear-left'`.
- **Anchor:** Twin, Design canvas against G-code 3D in the same canvas slot. The 2026-07-25 design
  §4.3 chose the program frame for the Inspector screen ("X right, Y away"). Cut 3D handles this
  with `ViewerWorkAxes` direction flags (`cnc-cut3d-work-frame.ts`).
- **Scenario:** An xTool D1 Pro user types "HELLO" and switches Design → G-code 3D. The text is
  drawn upside-down and mirrored, because program Y=0, the back of the bed, is drawn nearest the
  viewer. The burn itself is correct. The operator may "fix" it with a mirror and burn mirrored
  text.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (two lines, read; no browser run). `origin-transform.ts:60-63` keeps
  rear-left machine Y equal to canvas Y (toward the operator); the Inspector renders the program frame
  Z-up and right-handed (`preview-scene.ts:48`, design doc §4.3), and nothing under
  `src/ui/gcode-inspector` or `src/ui/viewer3d` reads the device origin. So a rear-left job is drawn
  flipped top-to-bottom against the canvas. Whether to change it is a maintainer decision; P3.
- **Fix direction:** Maintainer decision. Either orient the canvas view as the bed (as Cut 3D's work
  axes do), or label it "program coordinates" and point the triad's +Y the way the machine moves.

### P3-7 — The main-thread fallback drops the opened file's `openedFile`, `laser`, start and placement fields
- **Where:** `src/ui/gcode-inspector/use-gcode-inspection.ts:97,101-114`. For a `blob` source,
  `inspectionContextOf` rebuilds the source with only machineKind, laserPowerControl, timing,
  workArea and design.
- **Anchor:** Twin. The worker path returns the caller's `source` unchanged (`:63`).
- **Scenario:** With no `Worker`, an opened `.nc` comes back without `openedFile`, so Run on machine
  is not offered, and without `laser`, so the burn preview has no head. Latent: Worker exists in
  every supported runtime.
- **Evidence:** READ.
- **Refuter:** CONFIRMED, scenario narrowed. The fields are dropped (`use-gcode-inspection.ts:97,101-114`),
  but "Run on machine is not offered" is wrong: the button reads `props.program.source.openedFile`
  (`use-gcode-inspector-slot.tsx:39-52`), never the inspection's returned source, and nothing else
  reads `openedFile`. The real effect is the burn preview falling back to `DEFAULT_LASER` (S1000,
  0.1 mm spot; `use-laser-burn.ts:81,85`) rather than the device's laser. The Run dialog parses a
  `text` source, which keeps its fields. Latent, P3.
- **Fix direction:** Spread the original source and replace only `kind`/`text`.

### P3-8 — The ADR-255 own-output-clean gate tests one three-point cut per strategy, not "every program emitted by any built-in strategy"
- **Where:** `src/core/gcode-view/own-output-clean.test.ts:16-131`. One laser `cut` triangle for
  GRBL, Marlin and Smoothieware, and one CNC profile. There is no fill, raster, air assist,
  multi-pass, native arcs (ADR-432), tabs/ramps/helix, multi-tool `M0`, park or Focus Test output.
- **Anchor:** Contract: ADR-255 decision 8, acceptance gate 2.
- **Scenario:** A new emitted word in a fill or air path (for example a Marlin `M3 I` variant) would
  reach the Inspector unflagged by the gate.
- **Evidence:** REPRO (coverage only). `zz-26-own-output.test.ts` ran the full `emitGcode` on a
  line + fill project with air assist. It found 0 unsupported, 0 junk and 0 skipped for GRBL,
  Marlin and Smoothieware, plus a CNC circle. So today's output is clean; the gate just does not
  pin it.
- **Refuter:** CONFIRMED (read). The gate's fixtures are one 3-point laser cut per strategy and one
  CNC contour + arc (`own-output-clean.test.ts:16-112`). The other unsupported-word assertions
  (`native-controller-inspection.test.ts:42`, `controller-native-modes.test.ts:101`,
  `gcode-render-model-native-laser.test.ts:25`) also use 1 mm lines. ADR-255's gate text is "every
  program emitted by any built-in strategy" (`DECISIONS.md:12926`). Coverage gap only; P3.
- **Fix direction:** Drive the gate from real projects through `emitGcode` (fill, image, air,
  multi-pass, CNC tabs/helix/multi-tool) for each strategy.

### P3-9 — Probe and LinuxCNC-only cycle words are drawn as moves in the previous motion mode, raising false rapid warnings (extends K-5)
- **Where:** `src/core/gcode-view/render-model-words.ts:314` (unsupported G code: count it, keep
  the axis words). `G38.2` is not applied as a motion mode, so `G38.2 Z-10 F50` after a `G0` is
  drawn as a rapid plunge.
- **Anchor:** Ground truth: GRBL `G38.2` is a group-1 feed motion that stops on contact. Twin: the
  placement reader already treats probes as motion modes for the Frame
  (`render-model-placement.ts:44,88`).
- **Scenario:**
  - `G0 Z5 / G38.2 Z-10 F50 / G0 X10` gives warnings "Rapid plunge below Z0" and "Rapid moves
    across the work below Z0".
  - `G85 X10 Y10 Z-5 R1` is drawn as a rapid diagonal to Z−5, with a "rapid-through-material"
    warning.
- **Evidence:** REPRO. `zz-26-parser.test.ts`:
  `G38 … "findings":["rapid-plunge@2","rapid-through-material@3",…]`.
- **Novelty:** The same mechanism as K-5 (PV-3, which lists G10/G92/G53/G28). The probe and
  LinuxCNC-cycle instances are not named there. The coordinator may fold this into K-5.
- **Refuter:** CONFIRMED. Own repro (CNC): `G0 Z5 / G38.2 Z-10 F50 / G0 X10` draws all three moves
  as motion 0 (rapid), with findings `rapid-plunge@2` and `rapid-through-material@3`, plus
  `unsupported-word:G38.2`. Ground truth fetched: gnea/grbl `gcode.c` puts `case 38` with G0-G3 under
  `AXIS_COMMAND_MOTION_MODE`, so G38.2 is a group-1 motion mode. P3; the K-5 fold is sensible.
- **Fix direction:** As PV-3: treat `G38.x` as a feed motion mode whose end is unknown, and
  unsupported cycles as unplaced.

## KNOWN (re-observed, not re-raised)

- **K-1 (18 K-4 / WA-4)** G18/G19 arcs are skipped without advancing position
  (`gcode-render-model-builder.ts:362-365`). **The impact has changed since ADR-630:** the Run
  review's Frame envelope now misses the arc. In the repro (`zz-26-run-lines.test.ts`),
  `G18 G2 X20 Z-1 I5 K0` from X10 gives an envelope of X 0..10 while GRBL moves to X20. The only
  warnings are the generic "Some moves could not be drawn" and "does not interpret K", and neither
  says the Frame leaves the move out. Suggest re-rating against PROJECT.md NN21 / ADR-630.
  **Refuter:** CONFIRMED and re-rated **P2** (see "Refuter ruling on the WA-4 re-rating" below). One
  correction: the K warning does name the Frame outline, but only as "what [K] does", and an R-form arc
  gets no Frame-related warning at all.
- **K-2 (18 K-5 / PV-3)** `G10`/`G92`/`G53`/`G28` axis words are drawn as moves. Re-observed:
  `G28 G91 Z0` is drawn as a plunge to work Z0. P3-9 adds the probe and cycle instances.
- **K-3 (18 K-6)** `ARC_RADIUS_TOLERANCE_MM = 0.127` (`render-model-arc-center.ts:10`). Re-observed:
  `G2 X10 Y0 R4.95` is drawn as a semicircle, where GRBL fails `4r² − d² < 0` (error:33).
- **K-4 (PV-4)** Silent on lines GRBL 1.1 rejects. Re-observed with `K` on a G17 arc and with bare
  axis words after `G80`; GRBL sets motion mode to none, then answers error:31.
- **K-5 (03-P3-12 / 18 K-10)** Laser Z below 0 is flagged as "rapid below Z0".
- **K-6 (09-P2-1)** CNC timing at the laser Max feed. The Inspector inherits it through
  `deviceInspectionTiming` (`gcode-inspection-source.ts:129-146`, `maxFeedMmPerMin: device.maxFeed` at `:135`).
- **K-7 (04-P3-6)** "Full window" does nothing on desktop (`use-full-window.ts`).
- **K-8 (05-P3-1)** An external run does not retire the previous recovery capsule.
- **K-9 (18-P3-2)** The external-run Frame omits the G28/G30 intermediate point.
- **K-10 (P2-preview-3, 2026-09-29)** The carved stock is only half-cell exact on sloped ball/V
  moves.
- **K-11 (16-P3-4, 18 K-13 / PV-2)** The relief viewer drops the mirror; the 3D pane samples thin
  V-bit lines coarsely. Neither is re-tested; both are outside this area's files.

## Refuter ruling on the WA-4 re-rating (K-1)

**Ruling: P2 (up from P3). CONFIRMED by repro through the real Frame-bounds chain.**

- **ADR-630 is live.** File > Open marks `.nc`/`.gcode`/`.tap` sources `openedFile: true`
  (`gcode-open-action.ts:63-65`). The Inspector then shows **Run on machine...**
  (`use-gcode-inspector-slot.tsx:41-52`, `GcodeInspectorDialog.tsx:94-96`), enabled while connected
  and Idle. `RunGcodeFileDialog` normalizes the file, re-inspects it from the head with
  `boundsFromStart`, and `prepareExternalRun` stores `review.envelope` as `run.envelope`.
  `frameExternalProgram` traces exactly that rectangle (`external-run.ts:103`), and
  `startExternalProgram` streams the bytes after that Frame.
- **Mechanism.** `emitArc` returns false for G18/G19 (`gcode-render-model-builder.ts:361-365`), and
  `emitMotion` returns before `program.moveTo` and the modal update (`:268-279`; its comment
  assumes "the controller would have rejected the line", which GRBL does not for G18/G19). The arc adds
  nothing to the outline, and the position does not advance.
- **Repro** (own `zz-26r-wa4.test.ts`, deleted). The chain was `normalizeExternalProgram` →
  `inspectGcodeText` with the dialog's own source shape (CNC, `boundsFromStart`, head at work
  0,0,Z10) → `reviewExternalProgram` → `prepareExternalRun` → `buildGrblFrameJogLines(run.envelope)`:

  | Case | Frame traced | Where GRBL moves | Frame short by |
  |---|---|---|---|
  | A: `G1 X10`, `G18 G2 X20 Z-1 I5 K0`, then `G0 Z5`, `G17`, `G0 X0 Y0` | X 0..10, Y 0 | X 10..20 | 10 mm in X |
  | B: as A, with `R5` instead of `I5 K0` | X 0..10, Y 0 | X 10..20 | 10 mm in X |
  | C: G18 raster, each pass one arc X−25↔X25, stepping Y −20..20 | X −25..0 (0 is the head's start), Y −20..20 | X −25..25 | 25 mm, half the part |
  | D: `G1 Y10`, then the lead-out `G19 G3 Y40 Z29 J0 K30` | X 0, Y 0..10 | Y 10..40 | 30 mm in Y |

  Case D has the shape of real Fusion output. A Carbide3D forum thread quotes Fusion-posted
  `G19 G3 Y5.76 Z-6.829 J-8.765 K-29.517` (radius about 31 mm) on a GRBL Shapeoko. Its workaround
  edits the post to XY-only arcs (`allowedCircularPlanes`).
- **Ground truth.** gnea/grbl `gcode.c` runs arcs in every plane: G18 maps `axis_0 = Z`, `axis_1 = X`;
  G19 maps `axis_0 = Y`, `axis_1 = Z`.
- **What the operator is told.** There is no Job Review or preflight for an external run. The Run
  dialog is its one review (ADR-630), and it shows:
  - "Some moves could not be drawn: … First: line 7 — G18/G19 plane arcs are not renderable (XY
    only)." This is a Program Health notice. Its line number is off by one (P3-1).
  - When the arc uses K: "The Inspector does not interpret K, so what it does is not in this review
    or the Frame outline." For an R-form arc (case B), this warning is absent, and no warning
    mentions the Frame at all.

  Neither warning says the head will leave the framed outline. Every other kind of motion the outline
  leaves out does get that warning: G53, G92, G10 L2/L20, probes, G28/G30 and G55-G59 each say "not
  in the Frame outline … the head still makes them" (`external-program-review.ts:73-92,211-216,271-280`).
  The dialog's stated outline size (`RunGcodeFileSummary.tsx:50-52`) and the bed and no-go checks
  (`external-run-bed.ts:35,59-60`) also use the short envelope. So an arc that leaves the bed or
  enters a no-go zone is not flagged either.
- **Inconsistent with itself.** A program whose only motion is an undrawable arc is refused
  ("could not construct a finite motion envelope"; pinned at `external-program-review.test.ts:278`).
  The same arc beside one straight move is framed as if it did not exist.
- **Why not P3.** It is reachable today on a shipped path: open a file, connect, then Run. It breaks a
  contract with a clear failure scenario. PROJECT.md non-negotiable 21 says "the physical Frame is the
  spatial source of truth". ADR-630 says "The envelope covers rapid, linear and arc moves". ADR-630
  Amendment 1 says omitted motion is named as "not in the Frame outline". On a router, the bit can
  travel 10 to 30 mm, or half a part, past the traced outline and into a clamp.
- **Why not P1.** In this ledger, P1 means physical harm with no warning (03-P1-1, 09-P1-1). Here the
  review names the line and says it "produced no geometry" before Frame and before Start. The machine
  runs exactly what the file says. The case needs a third-party program with non-XY arcs. The
  coordinator could argue P1 for the R-form case, where nothing ties the notice to the Frame. I keep
  it at the top of P2.
- **Fix direction.** Give G18/G19 arcs their in-plane geometry: the arc's X or Y extent from its box
  in the XZ/YZ plane, plus the end point, so the position advances. Until then, treat an undrawable
  arc as an envelope that cannot be built, and refuse, as the lone-arc case already does. That is a
  factual refusal under non-negotiable 21. At minimum, give it the explicit "not in the Frame outline"
  warning.

## Refuted

Candidates the auditor dropped before raising:

- *R-form arcs bulge the wrong way.* No. `rArcGeometry` puts the centre at
  `(dx/2 + h·dy/d, dy/2 − h·dx/d)` for CW minor, which is GRBL's `i = 0.5(x − y·h_x2_div_d)`,
  `j = 0.5(y + x·h_x2_div_d)` with `h_x2_div_d = −2h/d`. Repro: `G2 X10 Y0 R10` peaks at Y 1.34,
  `R-10` sweeps the major arc to Y 18.66, and `G3 R10` dips to Y −1.34.
- *The full-circle epsilon differs from mc_arc.* GRBL turns any end within 5e-7 rad of the start
  into a full turn (`ARC_ANGULAR_TRAVEL_EPSILON`). The Inspector does so only for coincident
  points (1e-9 mm). With 3-decimal coordinates the two agree except on exactly equal points, which
  both treat as a full circle. Not reachable.
- *Marlin `G4 P` (ms) or `G4 S` (s) is misread.* `G4 S2` sets S=2, and `G4 P500` dwells 500 s.
  That is correct GRBL semantics, which ADR-255 decision 7 adopts. KerfDesk emits no `G4` for
  Marlin or Smoothieware (grep of `src/core/output`). Open PR #1351 adds a Marlin reader for runs.
- *Block delete `/` should skip the line.* GRBL `protocol.c`: "Block delete NOT SUPPORTED. Ignore
  character." Drawing the line matches what GRBL runs.
- *Float32 route and time arrays lose precision.* Per-kind totals telescope within rounding
  (about 60 mm in 1e6 mm). The time estimate uses Float64 `segLengthMm`. Playback granularity
  stays sub-segment for jobs under about 8 h.
- *The Cut 3D/3D pane mirror or work triad is wrong per origin.* No. `cnc-cut3d-work-frame.ts`
  derives x/y direction from `toSceneCoords` for all five origins. `localFromScene`,
  `buildToolpathLines` and `buildSurfaceGeometry` share one Y mirror (checked against ADR-261 §2).
  Report 16 verified placement numerically.

## Verified clean

- **GRBL v1.1 word reading** (`stripControllerComments`, `scanCompleteGcodeWords`). `(…)` and
  `;` comments, `;` inside parentheses, an unclosed `(` hiding only the rest of the line, a `/`
  prefix, `N` words, lowercase, CRLF / lone CR, and a BOM (trimmed). Repro
  `comments`/`blockdel`/`lineno+case`. Source: gnea/grbl `protocol.c`.
- **Modal state.**
  - Units: F, I, J and R take the block's own G20/G21, so `G1 F10 G20 X1` gives F 254 mm/min and
    X 25.4.
  - G91 with I/J relative arcs.
  - M2/M30 reset G1, G17, G90 and the spindle, and keep units, F and S (`gcode.c` [21]).
  - G4 P is in seconds (`mc_dwell(float seconds)`).
- **Arcs.** IJ full circles; an R full circle is rejected, as GRBL does (`STATUS_GCODE_INVALID_TARGET`)
  and LinuxCNC does ("end point … same as the current point" is an error). Bounds include the
  exact arc box (`arcAabb`).
- **Own output.** Full `emitGcode` of a line + fill project with air assist (GRBL, Marlin,
  Smoothieware) and of a CNC circle profile: 0 unsupported, 0 junk, 0 skipped. Only the "no program
  end" info note appears.
- **Source pane mapping.** The text and blob line indexes split on the same CR/LF rules as
  `iterateLines`. Byte offsets survive invalid UTF-8.
- **Live Inspector progress** (`inspector-live-progress.ts`). It requires the inspected bytes to
  equal the run's queue, and the manifest block geometry to equal the model segments. Otherwise it
  says why (the right contrast to P2-1).
- **External-run bed check** (`external-run-bed.ts`). The work-to-machine offset comes from the
  report, inches are converted, corners are re-ordered after a native-to-bed flip, and "not
  compared" shows when the bed position is unknown.
- **Top-view fallback image.** Y is flipped from image rows; the fit uses the same scale on both
  axes.

## Not verified

- No browser or WebGL run. Rendering, the Studio look, the view cube and "Full window" were read
  only.
- Huge files (hundreds of MB, single lines over V8's string limit, worker out-of-memory) were not
  run: the PC froze under load earlier. By reading, a huge single line ends as a worker
  `RangeError` message, and worker OOM behaviour (`onerror` against a renderer crash) is
  unconfirmed. ADR-485's own measurements (2.4 M moves) were not repeated.
- LinuxCNC canned-cycle G91 semantics for repeated bare-XY holes. GRBL runs no cycles, and
  grblHAL's behaviour was not fetched.
- Smoothieware/Marlin-specific rendering of opened files (PR #1351 is changing the Marlin path).

```json
[
  {"id":"P2-1","severity":"P3","area":"gcode-viewers","file":"src/ui/cnc-viewer3d/viewer3d-live-run.ts","line":55,"anchor":"Twin: motion-manifest confirmedRouteMm (placed program from reported head) vs preview toolpath arc length; Contract: module docstring + Cnc3DPane.tsx:84","evidence":"REPRO","verdict":"CONFIRMED (severity P2->P3: latent, Cnc3DPane not mounted since #633)","known":false,"summary":"CNC 3D result pane places the bit and reveals the path by the streamed route length measured along the absolute preview route; User Origin job ends with the bit at the first plunge and nothing revealed (319 vs 837 mm)"},
  {"id":"P3-1","severity":"P3","area":"gcode-viewers","file":"src/core/external-program/external-program-review.ts","line":141,"anchor":"Twin: normalizer refusals use source lines; Inspector source pane shows the file","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Run review warnings cite normalized-program line numbers (baseline added, comments/blanks removed) while refusals cite file lines"},
  {"id":"P3-2","severity":"P3","area":"gcode-viewers","file":"src/ui/gcode-inspector/burn-grid.ts","line":82,"anchor":"Contract ADR-487 §5; Ground truth GRBL laser M5/M2 off; Twin machineKind laser","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Opened-file burn preview burns moves after M5/M2 and when no M3/M4 is ever sent"},
  {"id":"P3-3","severity":"P3","area":"gcode-viewers","file":"src/ui/gcode-inspector/gcode-inspection-source.ts","line":89,"anchor":"Contract: gcode-inspection-source.ts:39-40, ADR-426 item 4","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Studio work-area outline ignores the Absolute program offset; negative-workspace GRBL job drawn entirely off the bed"},
  {"id":"P3-4","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/gcode-render-model-builder.ts","line":368,"anchor":"Twin: X/Y/Z non-finite guard at :263; audit Q4 honest error","evidence":"REPRO","verdict":"CONFIRMED (narrowed to I/J and P; R and F give no NaN)","known":false,"summary":"Non-finite I/J/R/F/P words produce NaN arc vertices and NaN/Infinite time with no finding"},
  {"id":"P3-5","severity":"P3","area":"gcode-viewers","file":"src/core/gcode/word-scan.ts","line":111,"anchor":"Ground truth GRBL protocol.c discards whitespace; Twin ADR-630 canonical line","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A space inside a number (X1 0) makes the Inspector discard a line GRBL runs as X10"},
  {"id":"P3-6","severity":"P3","area":"gcode-viewers","file":"src/ui/gcode-inspector/CanvasGcodeView.tsx","line":1,"anchor":"Twin: Design canvas vs G-code 3D canvas view; Cut 3D work axes","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Canvas G-code 3D view shows rear-origin/front-right jobs (xTool D1 Pro) mirrored against the Design view; maintainer decision"},
  {"id":"P3-7","severity":"P3","area":"gcode-viewers","file":"src/ui/gcode-inspector/use-gcode-inspection.ts","line":97,"anchor":"Twin: worker path returns the source unchanged","evidence":"READ","verdict":"CONFIRMED (narrowed: Run on machine still offered; only burn laser falls back to defaults)","known":false,"summary":"Main-thread fallback rebuilds a blob source without openedFile/laser/start fields (latent)"},
  {"id":"P3-8","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/own-output-clean.test.ts","line":16,"anchor":"Contract ADR-255 decision 8 gate 2","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Own-output-clean gate covers one tiny job per strategy, not fill/raster/air/arcs/CNC features"},
  {"id":"P3-9","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/render-model-words.ts","line":314,"anchor":"Ground truth GRBL G38.2 feed motion mode; Twin render-model-placement probes","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: K-5 / PV-3 mechanism","summary":"G38.x probes and LinuxCNC cycles drawn as moves in the previous motion mode, raising false rapid-plunge/through-material warnings"},
  {"id":"K-1","severity":"P2","area":"gcode-viewers","file":"src/core/gcode-view/gcode-render-model-builder.ts","line":362,"anchor":"Ground truth GRBL G18/G19 arcs; Contract ADR-630 Frame envelope","evidence":"REPRO","verdict":"CONFIRMED (re-rated P3->P2 by refuter)","known":"WA-4 / 18 K-4","summary":"G18/G19 arcs skipped; since ADR-630 the external-run Frame envelope omits them: Frame X0..10 vs GRBL X20 (10 mm), G19 lead-out 30 mm, G18 raster half the part; only a generic \"could not be drawn\" notice"},
  {"id":"K-2","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/render-model-words.ts","line":314,"anchor":"Ground truth GRBL G10/G92/G53/G28","evidence":"REPRO","verdict":"KNOWN (not re-checked by refuter)","known":"PV-3 / 18 K-5","summary":"G10/G92/G53/G28 axis words drawn as moves"},
  {"id":"K-3","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/render-model-arc-center.ts","line":10,"anchor":"Ground truth gcode.c arc checks","evidence":"REPRO","verdict":"KNOWN (not re-checked by refuter)","known":"18 K-6","summary":"Arc radius tolerance 0.127 mm; R-form too-small arcs drawn"},
  {"id":"K-4","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/finding-checks.ts","line":20,"anchor":"Ground truth GRBL error codes","evidence":"REPRO","verdict":"KNOWN (not re-checked by refuter)","known":"PV-4","summary":"Silent on GRBL-rejected lines (K on G17 arc, axis words after G80)"},
  {"id":"K-5","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/finding-checks.ts","line":91,"anchor":"Twin laser Z semantics","evidence":"READ","verdict":"KNOWN (not re-checked by refuter)","known":"03-P3-12","summary":"Laser Z below 0 flagged as rapid below Z0"},
  {"id":"K-6","severity":"P2","area":"gcode-viewers","file":"src/ui/gcode-inspector/gcode-inspection-source.ts","line":135,"anchor":"Contract ADR-416 D4","evidence":"READ","verdict":"KNOWN (not re-checked by refuter)","known":"09-P2-1","summary":"Inspector CNC timing uses the laser Max feed"},
  {"id":"K-7","severity":"P3","area":"gcode-viewers","file":"src/ui/gcode-inspector/use-full-window.ts","line":12,"anchor":"ADR-426 item 6","evidence":"READ","verdict":"KNOWN (not re-checked by refuter)","known":"04-P3-6","summary":"Full window does nothing on desktop"},
  {"id":"K-8","severity":"P3","area":"gcode-viewers","file":"src/ui/gcode-inspector/external-run.ts","line":225,"anchor":"ADR-341 Amd 4","evidence":"READ","verdict":"KNOWN (not re-checked by refuter)","known":"05-P3-1","summary":"External run does not retire the previous recovery capsule"},
  {"id":"K-9","severity":"P3","area":"gcode-viewers","file":"src/core/gcode-view/render-model-placement.ts","line":10,"anchor":"Ground truth GRBL G28/G30 intermediate point","evidence":"READ","verdict":"KNOWN (not re-checked by refuter)","known":"18-P3-2","summary":"External-run Frame omits the G28/G30 intermediate point"},
  {"id":"K-10","severity":"P3","area":"gcode-viewers","file":"src/ui/gcode-inspector/stock-sweep.ts","line":139,"anchor":"ADR-487","evidence":"READ","verdict":"KNOWN (not re-checked by refuter)","known":"P2-preview-3 (2026-09-29)","summary":"Carved stock half-cell exact on sloped ball/V moves"},
  {"id":"K-11","severity":"P3","area":"gcode-viewers","file":"src/ui/relief-viewer/Relief3DViewerDialog.tsx","line":69,"anchor":"Twin draw-relief mirror","evidence":"READ","verdict":"KNOWN (not re-checked by refuter)","known":"16-P3-4; PV-2 / 18 K-13","summary":"Relief viewer drops mirror; 3D pane samples thin V-bit lines coarsely"}
]
```
