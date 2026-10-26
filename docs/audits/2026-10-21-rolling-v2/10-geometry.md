# Rolling audit v2 — Geometry

- **When:** 2026-10-21 16:50 +0800   **Tree:** origin/main @ `2c8d988db` (worktree HEAD `3c99e5465`;
  no audited file changed up to `c708073a7`, the newest `origin/main` at the time of writing)
- **Scope:** `src/core/geometry/**` (booleans, weld, offsets, kerf offset, dogbone, tabs,
  perforation, arc fitting), `src/core/shapes/**`, `src/core/nesting/**`, `src/core/parts/**`,
  `src/core/min-feature/**`, `src/core/sketch-constraints/**`, `src/core/grid/**`. Callers were
  read where a finding depends on them: `src/ui/state/nest-actions.ts`, `nest-outline.ts`,
  `offset-shapes-actions.ts`, `src/ui/commands/BooleanDialogHost.tsx`, `OffsetShapesDialog.tsx`,
  `src/core/job/line-tabs.ts`, `layer-kerf.ts`, `cut-arc-moves.ts`, `curve-flatten.ts`.

  Governing documents:
  - ADR-410 (Offset Shapes) and its Amendments 1 (round chord tolerance) and 2 (Bevel = Square join)
  - ADR-432 (native arcs) and ADR-453 (fewest-chord flattening)
  - ADR-415 (perforation, overcut), ADR-494 and Amendment 1 (laser tabs)
  - ADR-433 (minimum feature), ADR-486 (kerf), ADR-480 (delete duplicates)
  - The comment contracts in `vector-path-regions.ts:26-28` and `dogbone-operations.ts:17-20`

  Prior audits read:
  - `rolling/2026-07-17-0745-core-geometry-booleans.md`
  - `2026-08-30-ten-loop-repo-audit/loop-02-geometry-transforms-and-units.md`
  - `2026-09-05-feature-remediation/geometry.md`, `2026-09-23-lightburn-geometry-fixes.md`
  - `2026-10-15-tools-vector.md`, `2026-09-29-cnc-audit-second-pass.md` (WA-6, WA-7)
  - the BQ-5 entry of `2026-07-17-burn-quality-findings-register.md`
- **Lenses run:** L1, L2, L3, L4 and L7, as separate passes in one session, plus L6 (engine
  failure paths) where it touched the same code. L5 was only touched for crafted values in
  `.lf2` cut extras (P3-4); the importers belong to areas 13 and 14.
- **Counts:** 5 raised + 1 KNOWN → refuter: 6 confirmed, 0 plausible, 0 refuted → P1 0 / P2 1 /
  P3 4 (+ 1 KNOWN, K-1, raised from Low to P2). Six auditor-side candidates were dropped before
  raising (listed under "Refuted").

## Headline

The geometry core holds up well under heavy random testing. These all stayed within their
contracts across tens of thousands of random cases:

- **Arc fitting.** Measured end to end through the emitter's 3-decimal I/J words and GRBL's
  `mc_arc` chords, including mirrors and Y flips.
- **Curve flattening.** Under scaled transforms.
- **Booleans and weld.** Checked against an independent winding-number oracle.
- **The three offset join styles.** Checked against a distance oracle.
- **Nesting.** Checked against an independent placement oracle that applies the placements the
  way the UI does.

The faults sit at the edges:

- **P2-1.** The new Weld "absorbed" warning (merged today in #1308) tells the user that a bar
  joining two shapes "lies entirely inside another shape … so Weld removes it". That is false:
  the bar is the bridge that joins them.
- **K-1 (KNOWN WA-6, low until now; refuter agreed to P2).** Dogbone still unions with non-zero
  at 0.01 mm. A CAD DXF plate imported the ordinary way loses its bolt hole and joinery slot when
  Dogbone is applied. The repro below shows this is the normal CNC import case, not an exotic one.
- **P3-1.** The Clipper2 union bug that can fill a region lying in none of the inputs is open
  upstream (clipper2-ts#35, Clipper2#1109). It reproduces at KerfDesk's 1 µm grid through Weld.
- **P3-2.** Laser tabs and perforation leave small closed shapes entirely uncut with no Job
  Review notice, although CNC has that advisory.

## Findings

### P2-1 — Weld warns that a joining shape "lies entirely inside another shape" and will be removed when it is the bridge that joins them

- **Where:**
  - `src/core/geometry/vector-path-weld-change.ts:46-56`: a source is reported `absorbed` when
    none of its own vertices survives on the welded outline.
  - `src/ui/commands/BooleanDialogHost.tsx:257-259,103,305-308` shows that as
    `role="alert"`: "“<name>” lies entirely inside another shape in the same operation, so Weld
    removes it."
- **Anchor:**
  - Twin: the warning against the union `weldVectorObjects` actually returns.
  - Contract: the function's own docstring, "Sources whose every outline lies inside another
    shape of the same operation, so Weld removes them".
- **Scenario:** Two circles 30 mm apart (r 8 mm) and a 2 mm bar whose ends sit inside each
  circle, on one operation. Open Weld. The dialog says the bar lies inside another shape and
  that Weld removes it. In fact the weld keeps the bar: it becomes the bridge, adds 28 mm² and
  turns two outlines into one. Welding a connecting bar into letters or stencil islands is a
  common Weld use. Every bar whose corners all sit inside other shapes triggers the false
  warning, and it may lead the user to cancel or to delete the bar. The heuristic's premise,
  "a source with no surviving vertex lies wholly inside other shapes", is false whenever the
  source's surviving boundary is bounded only by intersection points.
- **Evidence:** REPRO (`src/core/geometry/zz-10-weld-absorbed.test.ts`, deleted after the run):
  ```text
  {"outputRings":1,"outputArea":"429.11","sumCirclesArea":"400.98",
   "change":{"changed":true,"absorbedIds":["bar"]}}
  ```
  L7: `BooleanDialogHost.test.tsx:201` only covers a shape fully inside another.
- **Refuter:** CONFIRMED, P2 kept. I rendered `BooleanDialogHost` with two r 8 circles and a
  20 × 2 mm bar whose corners sit inside them (own `zz-10r` tests, deleted). The `role="alert"`
  read "“Bar” lies entirely inside another shape in the same operation, so Weld removes it.",
  Apply stayed enabled, and Apply produced one ring (two rings and 401.95 mm² without the bar,
  430.05 mm² with it). Toolbar Weld always opens this dialog (`tool-command-context.ts:101`). It
  does not stop the weld; it only misleads, and the dialog's own before/after preview contradicts
  it. A false alert on a common bridging weld is still a misleading result an ordinary user hits.
- **Fix direction:** Call a source absorbed only when the welded region without it equals the
  welded region with it (one extra union per candidate, already bounded by the dialog's
  background worker), or when its area is fully covered: `differenceD(source, others)` is
  empty. Add the bridging-bar case as a test.

### P3-1 — The Clipper2 union can fill a region that lies in none of its inputs (open upstream bug); KerfDesk's 1 µm unions have no guard

- **Where:** every geometry `unionD` at `VECTOR_PATH_PRECISION_DECIMALS` = 3:
  - `vector-path-weld.ts:103`
  - `vector-path-regions.ts:53,86,104` (Weld, Union silhouette, booleans, Offset Shapes,
    nest outlines)
  - `polygon-difference.ts:102,137` (kerf and pocket normalisation)
- **Anchor:** Ground truth:
  - Clipper2 FillRule docs: NonZero fills "only non-zero sub-regions".
  - countertype/clipper2-ts issue #35 (open since 2026-09-14): "`union` can return a region
    that is in none of the inputs". It is inherited from AngusJohnson/Clipper2#1109. Its cause
    is integer rounding of intersection points, which moves an edge across a narrow crack.
  - clipper2-ts `2.0.1-17` is pinned in `package.json`.
- **Scenario:** Weld (or any of the callers above) of shapes that leave a crack narrower than
  about 1 µm near a shared or near-shared vertex. The minimal repro is three rings already on
  the 1 µm grid:
  ```text
  A (52.905,54.964)(53.526,54.914)(53.639,54.501)(53.867,54.969)
  B (51.42,56.126)(53.031,54.953)(52.882,56.131)
  C (53.031,54.953)(53.065,54.683)(53.816,54.382)
  ```
  The union at 3 decimals adds a 0.097 mm² triangle, about 0.6 mm across. Point (53.40, 54.80)
  has winding 0 in every input but 1 in the output. Through Weld, the extra area becomes artwork
  and is cut. The kerf, pocket and fill normalisations call the same engine, so there it could be
  burned without appearing on the design canvas (not reproduced on those paths). It is rare
  (1 in about 7,200 random boolean or weld operations in the fuzz) and needs near-touching
  geometry.
- **Evidence:** REPRO.
  - Fuzz: `zz-10-boolean-fuzz.test.ts` (deleted), seed 1, trial 118, Weld of three random
    objects.
  - Minimised with both APIs (`zz-10-weld118e.test.ts`, deleted):
    ```text
    {"inputWindingAtP":[0,0,0],"u3":{"rings":1,"area":"1.15383","windingAtP":1},
     "u6":{"rings":1,"area":"1.05677","windingAtP":0},
     "u64x1000":{"rings":1,"area":"1.15383","windingAtP":1}}
    ```
  - SOURCE: `gh api repos/countertype/clipper2-ts/issues/35`, still open.
- **Refuter:** CONFIRMED, P3 kept. Both GitHub items are open pull requests, not issues (same
  author, unmerged): clipper2-ts#35 (maintainer comment 2026-09-29: waiting on upstream) and
  Clipper2#1109. The newest clipper2-ts on npm is `2.0.1-18` (2026-07-04) and `2.0.1` dates from
  2025-12-21, so no published build carries the fix. On the pinned `2.0.1-17` the upstream integer
  repro still fills (−7, 7), and the auditor's three rings give area 1.15383 with winding 1 at
  (53.40, 54.80) at 3 decimals and through `weldVectorObjects`; 2, 4, 5 and 6 decimals are correct.
- **Fix direction:** Track clipper2-ts#35 and upgrade when it is fixed. Until then, add a cheap
  post-check where a union's output area exceeds the summed input area or a sampled interior
  point has input winding 0, and retry at 4–6 decimals (both gave the correct result here).

### P3-2 — Laser Line tabs and perforation leave a small closed shape entirely uncut with no notice; the CNC twin warns

- **Where:**
  - `src/core/geometry/tab-layout.ts:60`, and the merged-window path through
    `tabs-bridges.ts` `burnSegmentsBetweenTabs`, return no burns when the tab windows cover
    the perimeter.
  - `src/core/geometry/perforation.ts:35-41` returns no dashes when a closed shape is shorter
    than one gap.
  - `src/core/job/line-tabs.ts:69-82` adds no diagnostic, and the compiled `Job` carries none.
- **Anchor:**
  - Twin: CNC reports the same degenerate coverage through
    `src/ui/laser/cnc-full-tab-coverage-warnings.ts:39` (`machine-job-warnings.ts:55`).
    Laser Line tabs (ADR-494) and perforation (ADR-415) have no counterpart.
  - Contract: ADR-415 item 2 says "A shape too short to hold one gap is left uncut, as tabs
    already leave a shape they would swallow". The behaviour is decided; telling the operator
    is not.
- **Scenario:** A Line operation with tabs of 3 mm × 4 per shape cuts a sheet with a 40 mm
  part and a 2.5 mm part. The small part gets no burn at all at the default tab power of 0. It
  stays fully attached, and Job Review says nothing. Any part under about 12 mm of perimeter
  is affected, for example small letters or dots cut as parts. Perforation does the same to
  shapes shorter than one gap.
- **Evidence:** REPRO (`src/core/job/zz-10-tab-swallow.test.ts`, deleted):
  ```text
  {"groups":1,"segments":4,"segmentsOnSmall":0,"diagnostics":"[\"groups\"]"}
  ```
  The big square gets 4 burns, the small one 0, and the job has no diagnostics field.
- **Refuter:** CONFIRMED, P3 kept. `applyLineTabs` on a 10 mm and a 2.5 mm square (3 mm × 4
  tabs) gave 4 burns, none on the small square, which went whole into `tabSpans`;
  `perforatePolyline` on a 2 mm closed square with a 3 mm gap gave 0 dashes. Neither
  `lineLeadDiagnostics` nor `compileDiagnosticWarnings` has a full-coverage case. The uncut
  outcome is ADR-415's decided behaviour; only the notice is missing, so P3 fits.
- **Fix direction:** Count contours whose tab or perforation windows cover the whole
  perimeter, the way `tabbedContours` is already counted. Raise a Job Review advisory naming
  the operation, mirroring the CNC full-coverage warning.

### P3-3 — Offset Shapes on a zero-area closed path reports "Adds two new shapes: ." and Offset silently does nothing

- **Where:**
  - `src/core/geometry/offset-shapes.ts:199-210`: `splitPath` treats a closed ring with fewer
    than 3 distinct points as neither closed nor open, so it is dropped. A closed collinear ring
    becomes an empty region.
  - `:119-150` returns `ok` with both results `null`.
  - `src/ui/commands/OffsetShapesDialog.tsx:193-199`: `summary()` with no parts prints
    "Adds two new shapes: ." and keeps Offset enabled.
  - `src/ui/state/offset-shapes-actions.ts:128`: `if (first === undefined) return state;` —
    no toast, no undo step.
- **Anchor:**
  - Twin: the same line as an open path is outlined (24 × 4 mm here). A closed 2-vertex DXF
    polyline is also treated as open and outlined.
  - Contract: ADR-410 item 3, "Offset is unavailable while the offset cannot be made, and the
    reason is shown".
- **Scenario:** An SVG `<polygon points="0,0 10,0"/>`, or `<path d="M0 0 L10 0 Z"/>`, imports
  as a closed 3-point line. Select it, then Tools → Offset Shapes, Outward 2 mm. The status line
  says "Adds two new shapes: ." and Offset can be clicked; nothing is created and nothing is
  said. In a mixed selection the degenerate line is silently left without an outline.
- **Evidence:** REPRO (`src/core/geometry/zz-10-offset-empty.test.ts`, deleted):
  ```text
  closed M0 0 L10 0 Z outward ok {"outward":null,"inward":null}
  closed collinear 3pt outward ok {"outward":null,"inward":null}
  open line outward ok {"outward":{"minX":-1.997,"minY":-2,"maxX":11.997,"maxY":2},"inward":null}
  ```
  The dialog text was read from `summary()`; it was not rendered.
- **Refuter:** CONFIRMED, P3 kept. `parseSvg` of `<polygon points="0,0 10,0"/>` and of
  `M0 0 L10 0 Z` each gave one closed 3-point polyline; `offsetShapes` outward 2 mm returned `ok`
  with both results `null`, while the open `M0 0 L10 0` was outlined. In the dialog `prepared` is
  set for any `ok` (`OffsetShapesDialog.tsx:176-179`), so Offset is enabled, and `summary()` with
  no parts falls to "two new shapes" (read, not rendered).
- **Fix direction:** Treat a closed ring whose distinct points are collinear (zero area) as an
  open line in `splitPath`. Have `offsetPaths` return an error when both results are empty,
  so the dialog disables Offset with a reason.

### P3-4 — Perforation has no work bound; a crafted `.lf2` with a tiny cut and skip length stalls compile

- **Where:**
  - `src/core/geometry/perforation.ts:41`: the loop steps by `cutMm + skipMm` with no floor.
  - `src/core/job/operation-cut-extras.ts:32-37` accepts any positive value.
  - `src/io/project/project-cut-extras-validator.ts:21-22`: `optionalPositiveNumber`, no
    minimum. The UI clamps to 0.01 mm (`cut-settings-draft.ts:42`,
    `object-properties-actions.ts:289-290`).
- **Anchor:** Twin: the other bounded geometry passes, min-feature (`feature-budget.ts`) and
  tab remapping (c98c7004d), cap their work. Contract: the UI's own 0.01 mm minimum is not
  enforced on load.
- **Scenario:** A `.lf2` sets `perforationCutMm` = `perforationSkipMm` = 1e-9 on a Line
  operation. Compile iterates length ÷ 2e-9 times per path, about 220 s per 100 mm, and Preview
  or Start hangs (worker or main thread, by job size). This is latent: no UI path produces it.
- **Evidence:** REPRO (`src/core/geometry/zz-10-perforation.test.ts`, deleted), on a 100 mm
  line:
  ```text
  cut=skip=0.00001 ... dashes 0 ms 25
  cut=skip=0.000001 ... dashes 0 ms 219
  ```
  Time is linear in 1/period.
- **Refuter:** CONFIRMED, P3 kept (latent: crafted file only; no load clamp found in
  `migrations.ts` or the validator, and the settings clipboard only copies existing layers). A
  100 mm line took 25 ms at 1e-5 and 165 ms at 1e-6, with 0 dashes. It is worse than linear at the
  extreme: with cut = skip = 1e-300, `startMm += periodMm` stops changing at about 3.6e-284, so the
  loop never ends (checked by float arithmetic, not by running the loop).
- **Fix direction:** Clamp perforation lengths to the UI minimum in `perforationPatternFor`
  (or in the project validator), so a crafted file cannot request sub-resolution dashes.

### K-1 (KNOWN WA-6) — Dogbone fills even-odd holes; an ordinary CAD DXF plate loses its bolt hole and joinery slot

- **Known:** `docs/audits/2026-09-29-cnc-audit-second-pass.md` WA-6 ("Low · Open · Confirmed in
  code", not reproduced there). New evidence: the trigger is the normal DXF import, not an
  exotic drawing, so the severity should rise to P2.
- **Where:**
  - `src/core/geometry/dogbone.ts:53`: `unionD(rings.value, FillRule.NonZero)`, the
    two-argument overload, which also uses 2 decimals.
  - Reached from `dogbone-operations.ts:36` and `src/ui/state/vector-path-actions.ts:156`.
- **Anchor:**
  - Twin: the canvas reads ordinary artwork as even-odd (`object-display.ts:216`), and CNC
    pockets normalise with EvenOdd (`pocket-paths.ts:147`).
  - Contract: `dogbone-operations.ts:17-20`, "holes and overlapping rings retain the same union
    semantics as the compiler", and `vector-path-regions.ts:26-28`.
- **Scenario:** A DXF is imported through `parseDxf`:
  - It has an 80 × 40 plate as a closed LWPOLYLINE, an M6 `CIRCLE` and a 10 × 6 slot.
  - CAD draws all three counter-clockwise, and they land in one path with no fill rule.
  - The canvas and CAM therefore show a plate with two holes.

  Apply Dogbone (6 mm bit) and the plate is replaced in place by a single ring: both the hole
  and the slot vanish. The CNC job then cuts neither. The slot is exactly the joinery that
  Dogbone exists for. Undo recovers it if noticed.
- **Evidence:** REPRO (`src/core/geometry/zz-10-dogbone-dxf.test.ts`, deleted):
  ```text
  import: paths 1 rings closed area -3200.0 | closed area -31.8 | closed area -60.0 fillRule [ null ]
  dogbone: rings 1
  ```
- **Refuter:** CONFIRMED; severity raised from Low to P2 (agreed). WA-6 is still "Low · Open". No
  commit has touched `dogbone.ts` or `dogbone-operations.ts` since 2026-09-28, and no open PR
  touches them. `unionD(paths, fillRule)` runs `booleanOpD` at its default precision 2
  (`clipper2-ts/dist/Clipper.js:84`). Through `parseDxf` → `dogboneOperationRegions` (what
  `vector-path-actions.ts:156` calls; `prepareDogboneEdit` does not re-normalise):
  - CCW plate, `CIRCLE` and CCW slot: 3 rings in, 1 out. Both holes are lost.
  - CW plate and CW slot: the slot is lost and the circle is kept.
  - CW plate and CCW slot: both are kept.

  A DXF `CIRCLE` always imports with the orientation of a DXF-CCW outline, so every round hole or
  island in a CCW outline is filled. A same-direction slot is filled whichever way the outline
  runs. The physical result is wrong (holes not cut, or an island milled away). It is visible
  before cutting, because the hole outlines vanish from the canvas and the Preview, so it is not
  P1. The broken contract (`dogbone-operations.ts:17-20`) and the reproduced scenario meet P2.
  One correction to the scenario: v1 never relieves hole rings (`dogbone.ts:8-11`), so even an
  even-odd-correct run would not relieve the plate's slot. The cleaner ordinary case is the
  documented one: a "closed pocket or slot outline" with an island (tutorial `dogbone`), such as
  a DXF `CIRCLE` boss inside a CCW pocket, whose island Dogbone fills and the pocket then clears.
- **Fix direction:** As WA-6 says, normalise each path with its own fill rule
  (`normalizeVectorObjectBatches`, 3 decimals) before finding corners. Add the DXF plate as a
  regression test.

## Refuted

The refuter refuted none of the raised findings (P2-1, P3-1..P3-4 and K-1 all reproduced).

Candidates the auditor dropped before raising them:

- **Nest outline overlaps an obstacle at padding 0.** The overlap is 3.3e-7 mm, from
  `clean()`'s 1e-6 rounding of contact placements. That is below the 0.001 mm emitted
  resolution; with a 1e-5 mm tolerance, 4,000 trials were clean.
- **Round outward offset reaches 2 × the distance.** This was an oracle artefact: an even-odd
  needle sliver about 0.006 mm wide is real filled geometry and is offset correctly.
- **Kerf offset's Miter limit 2 squares sharp corners nearer than the kerf.** Refuted
  analytically. Clipper2 truncates at "a distance of one delta from the original vertex"
  (MiterLimit docs). Every point of the square edge projects onto the edge rays at or before
  the vertex, so no point is nearer the part than the kerf.
- **Perforation drops dashes of exactly 0.001 mm.** 28,496 of 50,000 dashes were dropped
  because float error put them under `MIN_DASH_MM`, but the UI minimum is 0.01 mm, so this is
  unreachable.
- **Clipper2-ts loses integer precision above 2^53 at 6 decimals (nest collision).**
  `Core.js` switches to BigInt for unsafe products and throws on unsafe coordinates.
- **Weld's "Nothing to weld" can refuse a real merge.** This needs a merge and a split whose
  ring count and summed |area| cancel exactly within perimeter/1000. No realistic construction
  was found.

## Verified clean

- **Arc fitting, ADR-432 (L2, L3, L4).** `fitArcMoves` was fuzzed and each fit replayed the way
  GRBL executes it: 3-decimal X/Y/I/J through `emittedArc`, the fallback chords, and
  `controllerArcChordPoints` at `$12` = 0.002.
  - Inputs: random cubic chains (C1 and kinked), elliptical arcs, full circles as two
    semicircle arcs, and dense noisy polylines.
  - Placements: scale 0.2–3.2, non-uniform scale, rotation, `mirrorX`/`mirrorY`, and a Y flip
    standing in for `toMachineCoords`.
  - 6,300 curves and about 80,000 arcs, compared by Hausdorff distance against the mapped
    source.
  - Worst deviation 0.02315 mm against the 0.025 mm contract. There were no failures, so G2/G3
    direction is never inverted and full circles are handled.
- **Flattening, ADR-453 and loop-02 L2-01.** 6,000 random cubics, at sizes 0.01–900 mm,
  tolerances 0.001–0.1 mm and transform scales 0.05–8. The worst machine-space deviation is
  0.99974 × tolerance (`flattenColoredPathCurvesForTransform` uses the largest axis scale),
  and the local worst is 0.999995 × tolerance. The loop-02 L2-01 scale defect is fixed.
- **Booleans, Weld and fill rule (L3, L4).** Checked against an independent winding and
  crossing oracle over random objects:
  - Rings: self-intersecting, collinear and duplicate points, holes of either winding.
  - Fill rules: `nonzero`, `evenodd` and undefined.
  - Placement: transformed, scaled from 0.01× to 30×, at coordinates near (1500, 900) mm.
  - 1.75 M point checks over 1,800 random trials (7,200 subtract, intersect, exclude and weld
    operations). The only disagreement was the Clipper defect in P3-1.
  - Results read identically under even-odd and non-zero at every sampled point, so stored
    results (no `fillRule`) render and compile the same everywhere.
  - Empty results come back as typed errors (`empty-result`, `collapsed`).
  - NaN or Infinity in transforms or points gives `operation-failed`, never a throw or a
    garbage result.
  - A 1e9 mm square works. A sub-micron object collapses on the 1 µm grid: booleans and the
    panel offset return typed errors, while Offset Shapes returns nothing (the P3-3 path).
- **Fill-rule consistency (Q1).** Canvas (`object-display.ts:216`), Fill
  (`layer-fill.ts:231`, `fill-material-components.ts:57`), SVG export, booleans, Offset
  Shapes, Weld and nest outlines all read an undefined rule as even-odd, and as non-zero for
  text. The one outlier is Dogbone (K-1). An undeclared SVG `fill-rule` is read as even-odd,
  although SVG's initial value is `nonzero` (w3.org SVG2 painting, "Initial: nonzero"). That is
  the recorded BQ-5 LightBurn-parity decision, so it is not raised again.
- **Offset joins (Q3, L1, L2).** Checked against Clipper2's JoinType and MiterLimit docs:
  - Round uses `min(d/500, 0.024)` as its arc tolerance (Amd 1; clipper2-ts `arc_const` = 0.002
    confirmed).
  - Bevel is Clipper Square, which keeps the distance (Amd 2).
  - Corner is Miter with limit 4.
  - Open caps are Round, Square and Square.

  A distance-oracle fuzz (about 830,000 checks) found that every style's outward result contains
  every point within d − tol of the region. Round never exceeded d + tol, Corner 4d and Bevel
  1.5d. No inward result came within d − tol of the boundary. The properties-panel offset
  (round) matched too.
- **Nesting (Q4).** 6,000 random jobs through `layoutNest` (tidy, compact and grid; fast and
  outline) and through `quickNest` and `outlineNest` directly, the legacy path. Inputs were
  star polygons with holes, outlines smaller than their bounds, rotations {0}, {0, 90} and
  {0, 90, 180, 270}, padding 0–6 mm and locked obstacles.

  An oracle independently re-applied each placement the way `nest-actions.ts` `placeUnit`
  does (rotate about the unit centre, then align the rotated bounds). No part left the bed,
  came nearer than the padding, overlapped (containment included) or used a disallowed
  rotation. Holes travel with their parts, and "nothing fits" returns null, which the UI
  reports as "N selected unit(s) do not fit". Production nests are validated independently
  before use.
- **Min-feature (Q5).** Probes were all reported correctly:
  - widths: a 0.1 mm strip, a 0.1 mm part, a 0.05 mm neck, a 20° spike tip, a dense traced
    strip;
  - gaps: a 0.1 mm gap, 0.1 mm round and square holes, two slots, open lines 0.1 mm apart.

  A work-budget overrun returns `complete: false`, and Job Review lists it as partial
  (`min-feature-warnings.ts:155`).
- **Parts and sketch constraints (Q6).**
  - Generator validation keeps holes inside the boundary, with clearance and without overlap.
  - Hole winding is opposite to the boundary.
  - The sketch solver rejects non-finite coordinates, residuals and derivatives, and coordinates
    beyond ±1e6.
  - Zero-length distance and equal derivatives use a fixed direction instead of NaN.

## Not verified

- **GRBL arc semantics.** `mc_arc` chord count, `$12` and the angular-travel epsilon were taken
  from the code's citations and area 03's fetch; the GRBL source was not fetched here. Firmware
  with a non-stock `$12` was not modelled.
- **Upstream fix status.** Resolved by the refuter: #35 and #1109 are open, unmerged pull
  requests, and every published clipper2-ts (latest `2.0.1-18`, 2026-07-04) predates them.
- **Canvas rendering.** The P3-2 and P3-3 states were not rendered in a browser (the preview
  of an uncut tabbed part, the Offset dialog text).
- **Editing tools.** Joint resize, Copy Along Path, trim, extend, fillet, warp and deform, and
  shape optimisation were only skimmed; the 2026-10-15 tools audit covered them.
  `sketch-constraints` was read, not fuzzed.
- **Kerf arcs.** For tight radii comparable to the kerf, the kerf-offset chords used for arc
  fitting (`KERF_ARC_SOURCE_TOLERANCE_MM` 0.005) may sit up to about 2 × 0.005 mm from the true
  offset curve. This was estimated analytically, not measured.

```json
[
  {"id":"P2-1","severity":"P2","area":"geometry","file":"src/core/geometry/vector-path-weld-change.ts","line":52,"anchor":"Twin: absorbed warning vs actual weldVectorObjects union; Contract: describeWeldChange docstring","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Weld dialog warns that a bar joining two circles 'lies entirely inside another shape … so Weld removes it' because none of its vertices survives; the bar is the bridge and adds 28 mm² to the weld"},
  {"id":"P3-1","severity":"P3","area":"geometry","file":"src/core/geometry/vector-path-weld.ts","line":103,"anchor":"Ground truth: Clipper2 NonZero fill definition; clipper2-ts PR #35 / Clipper2 PR #1109 (open, unmerged)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"clipper2-ts 2.0.1-17 union at 3 decimals adds a 0.097 mm² region lying in none of the inputs (minimal 3-ring repro, also via Weld fuzz); no post-check in weld/regions/kerf normalisation; precision 6 is correct"},
  {"id":"P3-2","severity":"P3","area":"geometry","file":"src/core/geometry/tab-layout.ts","line":60,"anchor":"Twin: CNC full-tab-coverage advisory (cnc-full-tab-coverage-warnings.ts:39) has no laser counterpart; Contract: ADR-415 item 2","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Laser Line tabs (and perforation) leave a small closed part entirely uncut when windows cover its perimeter (2.5 mm square, tabs 3 mm x 4: 0 burns) and the Job carries no diagnostic"},
  {"id":"P3-3","severity":"P3","area":"geometry","file":"src/core/geometry/offset-shapes.ts","line":205,"anchor":"Twin: same line as an open path is outlined; Contract: ADR-410 item 3 (unavailable with reason)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Offset Shapes on a zero-area closed path (SVG polygon '0,0 10,0') returns ok with no objects; dialog says 'Adds two new shapes: .' and Offset silently does nothing"},
  {"id":"P3-4","severity":"P3","area":"geometry","file":"src/core/geometry/perforation.ts","line":41,"anchor":"Twin: bounded min-feature/tab work; Contract: UI 0.01 mm minimum not enforced on load","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Perforation loop has no work bound; a crafted .lf2 with cut/skip 1e-9 mm makes compile iterate length/2e-9 times (~220 s per 100 mm); latent, UI clamps to 0.01"},
  {"id":"K-1","severity":"P2","area":"geometry","file":"src/core/geometry/dogbone.ts","line":53,"anchor":"Twin: canvas even-odd and CNC pocket EvenOdd normalisation; Contract: dogbone-operations.ts:17-20","evidence":"REPRO","verdict":"CONFIRMED","known":"WA-6 (2026-09-29-cnc-audit-second-pass.md, Low, not reproduced; refuter reproduced it and agreed to raise it to P2)","summary":"Dogbone unions rings with NonZero at 2 decimals; a CAD DXF plate (CCW outline, CIRCLE hole, slot, one path, no fill rule) loses both hole and slot (3 rings in, 1 out); proposed raise to P2"}
]
```
