# CNC audit v2 — J1 V-carve maths and the rest of the CNC side (`cnc-oracle-sweep`)

- **When:** 2026-11-11 **Tree:** origin/main @ `a1518de75`
- **Asked for:** "deep audit my cnc side for example my vcarve and all the math etc behind it and
  then the rest of the bits".
- **Scope:**
  - V-carve: `src/core/cnc/vcarve-*.ts`, `radial-envelope.ts`, `vcarve-depth.ts`,
    `vcarve-clearance.ts`, `tapered-inlay*.ts`.
  - Bits: `src/core/scene/cnc-tool.ts`, `cnc-tool-starters.ts`, `src/core/cnc-tapered-ball.ts`,
    `src/core/sim/tool-kernels.ts`, `src/core/cnc/layout-cut-widths.ts`,
    `src/ui/machine/cnc-bit-modeled-catalog.ts`, `cnc-bit-tapered-ball-catalog.ts`.
  - Other operations through the real compile and emit path (`compileCncJob` →
    `cncGrblStrategy.emit`): outside, inside and on-path profiles, tabs, ramps, finish allowance,
    offset, raster, adaptive, helical and rest pockets, drill, the four mirrored origins.
  - Warnings: `src/ui/laser/machine-job-warnings.ts` and the modules it calls.
- **Method:** [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md), with one
  change: this round ran in a single session, so there was **no independent refuter**. Every
  finding below was reproduced by the auditor with an oracle that shares no code with the CAM
  (verdict `AUDITOR-REPRO`). A refuter pass is still owed before the P1 is counted as confirmed.
- **Lenses run:** L2 (cutter and depth maths against first principles), L3 (emitted program against
  the design; CNC warning twins), L4 (narrow angles, flat tips, over-flank depths, tiny shapes,
  mirrored origins), L6 (what Job Review says), L7 lightly. L1 per finding. L5 skipped: no trust
  boundary in this area.
- **Counts:** 5 raised → P1 1 (KNOWN, still open, re-rated) / P2 1 / P3 3 (+2 KNOWN re-observed)

## Headline

**The V-carve maths holds.** An independent oracle parsed 18 emitted V-carve programs and swept
its own cone over every feed move. No program cut outside the artwork or deeper than the cone law
allows (worst 0.0002 mm). The stock left standing matches the documented floor scallop to 0.003 mm.
The tapered inlay plug seats in its pocket with at most 0.010 mm of wall gap. Twenty-five profile,
pocket and drill programs cut no kept material, never exceeded their depth, and never moved a rapid
into uncut stock.

**Two things an ordinary job will hit, both with default settings:**

1. Small holes and small parts that share a layer with a larger shape are **not cut through**, and
   Job Review says nothing. The default four 6 mm tabs cover the whole loop of any hole under about
   15 mm across. This is the open KNOWN item K-4 / TP-5 / AUDIT A5, re-rated here to P1.
2. A V-carve that reaches **exactly** the stock bottom raises no warning. The default stock
   (6.35 mm) and the starter 90° V-bit (12.7 mm cut, 6.35 mm of flank) make that the default
   outcome on any stroke 12.7 mm wide or more.

## How the oracle works

The oracle is in [evidence/oracle.ts.txt](evidence/oracle.ts.txt). It uses production code only to
build the scene, compile it and emit G-code.

- **Parser.** Its own modal G0/G1/G2/G3 reader, with I/J arcs cut into chords of 0.002 mm sagitta.
- **Cutters.** Its own height-above-tip formulas: flat disc, sphere, cone, truncated cone, and a
  ball that meets a taper tangentially.
- **Removal.** For every grid cell and every feed move it finds the exact lowest cutter surface by
  minimising a convex function along the move. Nothing is sampled, so a result can never report
  more removal than the program makes.
- **Targets.** Distance to the outline and an even-odd fill, both its own.
- **Motion.** Rapids below safe height, feed on descending moves, spindle state, and a replay that
  checks every rapid ending below Z0 lands in stock earlier moves already cut.

One oracle error was found and fixed during the run. The first V-carve target for a flat-tip
engraving bit used `(d − r0) / tan` everywhere and reported a 0.93 mm "gouge". That law gives the
depth of the tip centre. The wall a tip flat leaves is `d / tan`, the same as a point, because the
edge of the flat traces it. Against `d / tan` the three flat-tip cases gouge 0.0000 mm.

## Findings

### J1-P1-1 — Shapes too small for their tabs are not cut through, and a mixed layer gets no warning (KNOWN K-4 / TP-5 / AUDIT A5, still open; re-rated P1)

- **Where:**
  - `src/core/cnc/cnc-tabs.ts:13-16` and `src/core/geometry/tabs-bridges.ts:144-145`: when tab
    windows cover a contour's whole perimeter, the loop stays one full bridge.
  - `src/ui/laser/cnc-full-tab-coverage-warnings.ts:76-78`: the warning fires only when the layer
    cuts **nothing** below its tab top. Its header (`:19-21`) says so: "a layer where only SOME
    shapes are fully covered still has deep passes from the others and is not flagged here".
- **Anchor:**
  - Contract: `METHOD.md` §3 as clarified 2026-10-23 — a defect reachable today that silently
    produces wrong depth is P1 "however few users meet it".
  - Twin: the same condition on a layer where every shape is covered does warn ("the part will NOT
    be cut through").
- **Scenario:** default layer settings (tabs on, 4 per shape, 6 mm wide, 2 mm high), default 1/8"
  end mill, 6.35 mm deep.
  - **A plate with holes, Outside:** an 80 × 60 mm plate with 8, 12 and 16 mm holes. The plate and
    the 16 mm hole cut to 6.35 mm. The 8 mm and 12 mm holes stop at 4.35 mm all the way round.
  - **Holes, Inside:** 8, 12 and 30 mm holes on one layer. The 30 mm hole cuts through; the 8 and
    12 mm holes stop at 4.35 mm.
  - **Small parts, Outside:** a 6 mm square and an 8 mm disc beside a 40 × 30 mm part. Both small
    parts stop at 4.35 mm.
  - In all three, `detectMachineJobWarnings` returns no warning about tabs or depth.
  - Each window is tab width plus cut width, 9.175 mm, so four cover 36.7 mm of path. That swallows
    every Inside hole under 14.9 mm across, every Outside disc under 8.5 mm and every Outside
    square under 6.0 mm.
- **Evidence:** AUDITOR-REPRO, [evidence/tabs-and-stock.test.ts.txt](evidence/tabs-and-stock.test.ts.txt).
  Depth of every cut cell within 3 mm of each outline, on the waste side:

  | Case | Shape | Deepest | Cells at each depth |
  | --- | --- | --- | --- |
  | Plate, Outside | plate | 6.350 | 6.35: 73,987 · 4.35: 7,229 (four tabs) |
  | | 8 mm hole | **4.350** | 4.35: 4,224 |
  | | 12 mm hole | **4.350** | 4.35: 7,736 |
  | | 16 mm hole | 6.350 | 6.35: 4,653 · 4.35: 6,595 |
  | Holes, Inside | 8 mm hole | **4.350** | 4.35: 4,224 |
  | | 12 mm hole | **4.350** | 4.35: 7,736 |
  | | 30 mm hole | 6.350 | 6.35: 16,326 · 4.35: 7,274 |
  | Small parts, Outside | 6 mm square | **4.350** | 4.35: 9,536 |
  | | 8 mm disc | **4.350** | 4.35: 9,836 |
  | | 40 × 30 mm part | 6.350 | 6.35: 35,516 · 4.35: 6,500 |

  `warnings: []` for all three.
- **Novelty:** KNOWN. `docs/audits/2026-10-23-cnc-v1/F3-cnc-profile-entry.md` lists it under "KNOWN
  (re-observed, not raised)" as K-4 / TP-5 / AUDIT A5, first reported 2026-09-24. No fix PR exists.
- **Severity reasoning:** the user asks for a through hole and gets a blind groove 2 mm short, on
  default settings, with nothing on screen. That is silently wrong depth. It is not a gouge and
  nothing comes loose, but §3 has no reach or direction clause. Earlier audits left it as KNOWN
  without a severity; under the 2026-10-23 clarification it is P1.
- **Verdict:** AUDITOR-REPRO. Refuter owed.
- **Fix direction:** fit automatic tabs to each contour instead of keeping the loop whole: drop to
  fewer tabs, then narrower ones, so at least half of every loop cuts through. Where even one tab
  cannot fit, keep the bridge and name the count in Job Review ("3 shapes on layer X are too small
  for their tabs and will not be cut through"). Make the warning per contour either way.

### J1-P2-1 — A V-carve that reaches exactly the stock bottom raises no warning, and the defaults land there

- **Where:** `src/ui/laser/cnc-compiled-depth-warnings.ts:118-121`. The check warns when the
  emitted depth is greater than the stock, or equal to it only when `warnAtStockBottom` is set.
  The relief call sets it (`:66`); the V-carve call (`:40-44`) does not.
- **Anchor:**
  - Twin: relief and V-carve share `detectDepthWarnings`. Relief at the stock bottom says "reaches
    the configured stock bottom"; V-carve at the same depth says nothing.
  - Contract: `src/core/scene/machine.ts:150-153` — without a flat depth a V-carve follows "the
    depth required by local stroke width", so only this warning tells the user how deep that is.
- **Scenario:** a new CNC project (stock 6.35 mm), the starter bit "90° V-bit — 12.7 mm (1/2") cut"
  (`vb-90`), a V-carve layer with Flat depth off (the default for new layers), and a 40 × 20 mm
  rectangle. The cone's flank is 6.35 mm tall, so the flat core is cut at Z−6.350 across a region
  27 × 7 mm: the full stock thickness. `detectCompiledVCarveDepthWarningsForJob` returns `[]` and
  Job Review shows only the starter-feed note. Any stroke at least 12.7 mm wide does the same.
- **Evidence:** AUDITOR-REPRO, [evidence/tabs-and-stock.test.ts.txt](evidence/tabs-and-stock.test.ts.txt):

  | Bit | Stock | Deepest Z | Depth warnings |
  | --- | --- | --- | --- |
  | `vb-90` | 6.35 (default) | −6.350 | none |
  | `vb-90` | 6.0 | −6.350 | "0.35 mm past the bottom, into the spoilboard" |
  | `vb-90` | 6.5 | −6.350 | none (0.15 mm of floor left) |
  | `vb-60` | 6.35 | −5.499 | none (0.85 mm of floor left) |

- **Novelty:** new. `docs/audits/2026-10-21-rolling-v2/16-relief.md` covers the relief side only.
- **Severity reasoning:** the carve is what flowing mode specifies, so the depth itself is not
  wrong. The missing piece is the warning the app already gives for the same condition one cut type
  over, and the default stock and default 90° bit meet exactly at the boundary. P2.
- **Verdict:** AUDITOR-REPRO.
- **Fix direction:** pass `warnAtStockBottom` for V-carve with its own sentence (a V-carve has no
  tabs either). Consider one more line when less than a set floor remains, for example under
  0.5 mm, since a 0.15 mm skin is not a sign either.

### J1-P3-1 — A fully tabbed contour is cut again at the tab top for every deeper level

- **Where:** `src/core/cnc/compile-cnc-layer-passes.ts:365-381` builds one pass per level; with
  every window merged, `tabRampedPoints` returns the whole loop at the tab top.
- **Anchor:** Twin — `cnc-tabs.ts:13-16` says "the deep pass is skipped"; since ADR-258 it is
  emitted at the tab-top height instead.
- **Scenario:** the 10 mm square hole of `in-smallHoles` (Inside, 3 mm deep, 1.5 mm per pass). The
  program makes three identical laps at Z−1.000: one real, two through air. The header reads
  `passes: 9` and `emitted-max-mm: 1.000`.
- **Evidence:** AUDITOR-REPRO — three `G1 X41.588 Y371.588` laps at one Z in the emitted program
  ([evidence/ops-matrix.test.ts.txt](evidence/ops-matrix.test.ts.txt), case `in-smallHoles`).
- **Verdict:** AUDITOR-REPRO. Time and pass-count only; fixing J1-P1-1 removes most of it.
- **Fix direction:** drop a level whose every point sits at or above a level already cut.

### J1-P3-2 — The tapered inlay's "Radial fit gap" leaves no gap; it seats the plug deeper and shrinks the glue gap

- **Where:** `src/core/cnc/tapered-inlay-settings.ts:92-97` (`taperedInlayWallStartDepth` =
  engagement + gap / tan); the field label at `src/ui/layers/CncTaperedInlayFields.tsx:40`
  ("Radial fit gap", unit "mm/side").
- **Anchor:** Contract — ADR-665 Context: "Seated, the walls touch when the plug's top is `T` into
  the pocket." The decision is sound; the label and the glue-gap figure do not say it.
- **Scenario:**
  - Defaults (60° bit, gap 0.05, glue gap 0.5): the walls touch, the plug's top sits 2.575 mm
    deep, and the real glue gap is **0.42 mm**, not 0.5.
  - 30° bit, gap 0.2: contact needs 3.246 mm but the pocket is 3 mm deep. The plug lands on the
    floor ridges at 2.807 mm, leaving a real seam **0.11 mm** wide at the surface. No finding names
    either number.
- **Evidence:** AUDITOR-REPRO, [evidence/inlay-fit.test.ts.txt](evidence/inlay-fit.test.ts.txt) —
  `seat 2.5752` (expected 2.5866) for the default; `seat 2.8075, wall.maxHorizontalGap 0.118,
  seam.maxInsetMm 0.112` for the 30° case.
- **Verdict:** AUDITOR-REPRO. P3: the geometry is as decided; the words mislead.
- **Fix direction:** rename the field (for example "Extra seating depth as a wall gap"), show the
  resulting glue gap, and add a Job Review note when gap / tan exceeds the glue gap.

### J1-P3-3 — "Set Stock thickness" is impossible advice when the stock really is 6.35 mm

- **Where:** `src/core/cnc/cnc-tabs.ts:55,72,88` treat a stock thickness equal to the shipped
  default as never set.
- **Anchor:** Contract — ADR-258 Amendment 3 measures a tab from the stock bottom once the stock
  thickness is set; 6.35 mm (1/4") is also the most common real sheet.
- **Scenario:** real 6.35 mm stock, Outside profile 7 mm deep. Tabs are measured from the cut floor,
  so 1.35 mm of each is in the stock instead of 2 mm. Job Review says so and adds "Set Stock
  thickness to keep them full height", but the field already holds the right value. Entering 6.36
  gives full 2 mm tabs.
- **Evidence:** AUDITOR-REPRO — tab cells at 5.00 mm with the default stock and at 4.36 mm with
  6.36 mm stock ([evidence/tabs-and-stock.test.ts.txt](evidence/tabs-and-stock.test.ts.txt), cases
  `rect-default-stock-depth7` and `rect-stock-6.36-depth7`).
- **Verdict:** AUDITOR-REPRO. P3: disclosed, but the remedy offered cannot be taken.
- **Fix direction:** record that the user has set the stock (a flag beside the number) instead of
  reading the value itself. This is a maintainer decision: it changes saved-project meaning.

## Known (re-observed, not raised)

- **The V-carve clearing end mill inherits the V-bit layer's feed and plunge** (F1000 / F300 on
  `em-3175` in `wide-vb60-flat2-clear-dpp075`). 2026-09-24 CNC full audit.
- **Material recipes band V-bits by their full cut diameter** (`resolve-cnc-auto-settings.ts:107`).
  F4 K-4, disclosed by the angled-tool feed advisory.

## Refuted

- **Flat-tip engraving bits gouge 0.93 mm.** Oracle error, described above. Against the wall law
  `d / tan` the gouge is 0.0000 mm in all three cases.
- **Narrow V-bits leave up to 0.55 mm standing.** That is the documented floor scallop,
  pitch / (2 · tan): 0.284 mm at 20° (measured 0.286) and 0.571 mm at 10° (measured 0.550).
  ADR-319 §6.
- **A V-bit or ball-nose pocket leaves ribs.** The floor of a 2 mm pocket cut with a 60° V-bit runs
  from 1.6 to 2.0 mm. That follows from spacing rings by the cut width of one pass (ADR-368
  Amendment 3) and is the shape of the bit.
- **Rapids go below the stock top.** They do, by design (ADR-489): the replay found every one of
  them landing in stock already cut, 0 hits in 25 programs.
- **Mirrored origins reverse climb.** In machine numbers the kept side flips for rear-left and
  front-right and stays for rear-right, which is what `machine-frame-handedness.ts` intends.

## Verified clean

**V-carve, 18 programs.** Gouge is the worst removal beyond `min(cap, d / tan)`, including outside
the outline. Short is the worst stock left; the bracket counts 0.05 mm cells over 0.15 mm.

| Case | Cap mm | Gouge mm | Short mm | Source of the shortfall |
| --- | --- | --- | --- | --- |
| Wide slab, `vb-90`, flowing | 6.350 | 0.0000 | 0.050 | floor scallop |
| Wide slab, 60° 12.7 mm, flowing, 2 mm per pass | 10.999 | 0.0000 | 0.087 | floor scallop |
| L, `vb-60`, flowing | 5.499 | 0.0000 | 0.087 | floor scallop |
| L, `vb-60`, flowing, 10° ramp asked | 5.499 | 0.0000 | 0.087 | floor scallop |
| Star, `vb-60`, flowing, 0.7 mm per pass | 5.499 | 0.0000 | 0.088 | floor scallop |
| Star, 150° bit, flat 0.8 mm | 0.800 | 0.0000 | 0.014 | — |
| 0.4 mm ring, `vb-30`, flowing | 5.925 | 0.0000 | 0.014 | — |
| Comb of 0.12–0.6 mm teeth, `vb-30` | 5.925 | 0.0000 | 0.177 (108) | scallop 0.187 |
| Comb, 10° bit | 18.145 | 0.0000 | 0.550 (2,708) | scallop 0.571 |
| Two acute spikes, 20° bit | 9.003 | 0.0000 | 0.286 (176) | scallop 0.284 |
| Ellipse with island, 720 segments, 20° bit | 9.003 | 0.0000 | 0.287 (12,504) | scallop 0.284 |
| Same ellipse, 90° 3.175 mm, flat 0.6, Detail 0.02 | 0.600 | 0.0000 | 0.011 | — |
| Slab with islands, 30° flat tip, flat 1.2, 0.5 per pass | 1.200 | 0.0000 | 0.285 (72) | tip flat at corners |
| L, 60° flat tip, flat 1 mm | 1.000 | 0.0000 | 0.058 | tip flat |
| Comb, 30° flat tip, flowing | 4.992 | 0.0000 | 0.854 (3,916) | tip flat, r0 / tan = 0.933 |
| Wide slab, `vb-60` flat 2 + `em-3175` clearing, 0.75 per pass | 2.000 | 0.0000 | 0.087 | floor scallop |
| Wide slab, `vb-60` flat 10 (past the flank) + clearing | 5.499 | 0.0000 | 0.088 | both bits capped at 5.499 |
| Slab with islands, `vb-60` flat 1.5 + `em-1588` at 80 % | 1.500 | 0.0002 | 0.074 | floor scallop |

In every program: no rapid across XY below safe height, no descending feed above the 300 mm/min
plunge rate (a sloped move is capped by its Z rate, for example F387 on a 51° descent), no cut with
the spindle off.

**Tapered inlay, 2 default programs.** The plug field was mirrored back into the pocket and lowered
until first contact.

| Bit | Seat depth (contact expected) | Worst wall gap, horizontal | Visible seam cells |
| --- | --- | --- | --- |
| `vb-60` | 2.575 (2.587) | 0.008 mm | 0 |
| `vb-90` | 2.542 (2.550) | 0.010 mm | 0 |

**Profiles, pockets and drill, 25 programs.** Kept is any removal over 0.002 mm more than 0.036 mm
inside material that must stay.

- **Kept material cut:** 0 cells in all 25.
- **Depth:** the deepest cell is within 0.002 mm of the requested depth in 24 programs and no cell
  is deeper. The exception is `in-smallHoles`, where every hole is fully tabbed (J1-P1-1).
- **Wall position:** the first cut cell is within one grid cell (0.025 mm) of the line for end
  mills, ball nose and V-bit alike, so the cut-width-at-depth layout (ADR-368) lands the flank on
  the line.
- **Tabs:** 4 tabs of 6 mm at the right height: 2 mm above the cut floor on default stock, 2 mm
  above the stock bottom on 9 mm stock cut 9.5 mm deep.
- **Direction:** climb keeps the kept material on the right for Outside, Inside and Pocket;
  conventional puts it on the left.
- **Rapids:** 0 of 44 rapids that end below Z0 touch uncut stock.
- **Strategies covered:** offset, raster X and Y, adaptive (6.35 mm bit, with an island), helical
  entry, ramp entry, two-bit rest machining, finish allowance 0.3 mm, ball nose and V-bit used as
  profile and pocket cutters.

**Cutter maths, by derivation.**

- `radial-envelope.ts`: `r(h) = r0 + h·tan(A/2)` and its inverse are the truncated cone; the flank
  cap `(R − r0) / tan` is where it reaches the cut diameter.
- `cnc-tapered-ball.ts`: a ball of radius R meets a flank at angle α from the axis at radius
  `R·cos α` and height `R·(1 − sin α)`; slope and height match there, so the profile is smooth.
- `layout-cut-widths.ts`: ball width at depth h is `2·√(h(D − h))`; cone width is
  `2·r0 + 2·h·tan(A/2)`.
- `tool-kernels.ts` uses the same three laws, so the preview and the CAM cannot disagree.
- `tapered-inlay-settings.ts`: with slope s, the pocket at depth z is the design shrunk by `z·s`;
  the plug at distance u from its top is the design shrunk by `(T − u)·s`. They coincide when the
  plug's top is T deep. The measured seats above agree.
- Tapered-ball catalog: the stored cut diameters follow from the sellers' tip, side angle and
  flute length (Amana 46280: 6.23 mm on a 6.35 mm shank; SpeTool W01001: 3.15 mm on 3.175 mm).

## Not verified

- **Relief and 3D** (roughing, finishing, rest, two-sided): not run through the oracle. Last
  audited in `2026-10-23-cnc-v1/F6` and `2026-11-09-rolling-v12/X6`.
- **Tiling** (`tile-plan.ts`): read only. The clip and the translation are straightforward; no
  tiled program was measured against its untiled twin.
- **Surfacing wizard, tool reach and holder clearance, rotary, wrap:** not covered.
- **Object transforms** (rotation, mirror, non-uniform scale): every case used the identity
  transform, so the outline the compiler sees was the outline measured.
- **Text and curved artwork:** polygons only. Curve flattening (ADR-453) was measured in F1.
- **Machine behaviour:** nothing here was cut. All evidence is the emitted program.

```json
[
  {
    "id": "J1-P1-1",
    "severity": "P1",
    "area": "cnc-oracle-sweep",
    "file": "src/ui/laser/cnc-full-tab-coverage-warnings.ts",
    "line": 76,
    "anchor": "Contract: METHOD §3 (2026-10-23); Twin: whole-layer full-coverage warning",
    "evidence": "REPRO",
    "verdict": "AUDITOR-REPRO",
    "known": "F3 K-4 / TP-5 / AUDIT A5 (2026-09-24), still open",
    "summary": "Shapes whose tab windows cover their whole loop stop at the tab top; on a layer with any larger shape Job Review says nothing (8 and 12 mm holes at 4.35 of 6.35 mm, default settings)"
  },
  {
    "id": "J1-P2-1",
    "severity": "P2",
    "area": "cnc-oracle-sweep",
    "file": "src/ui/laser/cnc-compiled-depth-warnings.ts",
    "line": 119,
    "anchor": "Twin: relief warnAtStockBottom",
    "evidence": "REPRO",
    "verdict": "AUDITOR-REPRO",
    "known": null,
    "summary": "A V-carve reaching exactly the stock bottom gets no warning; default 6.35 mm stock and the starter 12.7 mm 90° V-bit land there on any stroke 12.7 mm wide"
  },
  {
    "id": "J1-P3-1",
    "severity": "P3",
    "area": "cnc-oracle-sweep",
    "file": "src/core/cnc/compile-cnc-layer-passes.ts",
    "line": 365,
    "anchor": "Twin: cnc-tabs.ts:13 says the deep pass is skipped",
    "evidence": "REPRO",
    "verdict": "AUDITOR-REPRO",
    "known": null,
    "summary": "A fully tabbed contour is re-cut at the tab top once per deeper level"
  },
  {
    "id": "J1-P3-2",
    "severity": "P3",
    "area": "cnc-oracle-sweep",
    "file": "src/core/cnc/tapered-inlay-settings.ts",
    "line": 92,
    "anchor": "Contract: ADR-665 Context (walls touch at T)",
    "evidence": "REPRO",
    "verdict": "AUDITOR-REPRO",
    "known": null,
    "summary": "Radial fit gap seats the plug deeper instead of leaving a gap; the real glue gap is 0.42 not 0.5 mm, and a gap over glue·tan leaves an unreported seam"
  },
  {
    "id": "J1-P3-3",
    "severity": "P3",
    "area": "cnc-oracle-sweep",
    "file": "src/core/cnc/cnc-tabs.ts",
    "line": 55,
    "anchor": "Contract: ADR-258 Amendment 3",
    "evidence": "REPRO",
    "verdict": "AUDITOR-REPRO",
    "known": "disclosed by the through-cut tab warning",
    "summary": "Real 6.35 mm stock reads as never set, so over-deep cuts get thinner tabs and the warning's remedy cannot be taken"
  }
]
```
