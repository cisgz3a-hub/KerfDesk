# Rolling audit v2 — CNC core

- **When:** 2026-10-21 16:30 +0800   **Tree:** origin/main @ `2c8d988db` (worktree HEAD
  `3c99e5465`; no `src/` difference). Re-checked against origin/main @ `d11a79fd3`: no audited
  file changed.
- **Scope:** `src/core/cnc/**`, `src/core/toolpath/**`, `src/core/toolpath3d/**`,
  `src/io/cnc/**` and the CNC emitter `src/core/output/cnc-grbl-*.ts`. Twins were followed into
  `src/core/job/toolpath-cnc.ts`, `src/core/job/estimate-duration.ts`,
  `src/ui/laser/prepared-job-metrics.ts` and `src/ui/laser/live-job-estimate.ts`.

  Governing documents:
  - ADR-250 (profile lead-in and lead-out) and ADR-253 (retract between passes)
  - ADR-258 and its Amendments 1–4 (tabs)
  - ADR-310 (clearing before profiles across tools) and ADR-416 (CNC keeps its own Max feed)
  - ADR-489/520 (air floors), ADR-491 (stay-down links, park height) and ADR-399 (GRBL-only CNC
    dialect)
  - PROJECT.md non-negotiables 1, 4, 5 and 6
- **Lenses run:** L1, L2, L3, L4, L6 and L7, as separate passes in one session. L5 was run only
  on the CNC comment and HTML/filename sinks (all sanitised). It was not run further, because
  `.lf2` validation belongs to area 13.
- **Method:** small projects were compiled through `emitGcode`, and the emitted text was checked
  by independent scripts:
  - a rule checker covering XY rapids, M3/M0, feed words and GRBL arc tolerance
  - a swept-disk pocket coverage and gouge model
  - a V-bit cone wall-clearance model
  - a cutter-footprint distance model for leads

  This was done for 24 projects that cover every cut type, multi-tool, coolant, park, tabs,
  ramp, helix, adaptive, rest, finish allowance, tapered and straight inlay, and relief. The
  repro tests are archived in this session's scratchpad (`…/scratchpad/repros-09/`). They are
  not in the repo.
- **Counts:** 4 raised → refuter: 3 confirmed, 1 refuted (P3-1 is KNOWN) → P1 1 / P2 1 / P3 1
  (+ 5 KNOWN re-observed). No severity changes.

## Headline

The emitter's motion contract is sound and is checked by independent scripts, not by the
repo's own predicates. In all 24 swept projects:

- every XY rapid is at safe Z
- every M3 follows a safe-Z lift, including after each M0 tool change
- every G1 has a feed, and arcs meet GRBL's 0.005 mm / 0.1 % radius rule
- clearing finishes before any profile across tools (ADR-310)
- pocket rings cut nothing outside the pocket or into an island
- V-carve depth follows the V-bit law exactly, with no wall gouge

The one physical defect is in **lead-ins**. The lead's collision check only knows about the
other contours of the same operation, and it ignores the hole a part sits in. So a default-on
arc lead can plunge into a kept neighbouring part when parts are closer than about 1.5 bit
diameters. This happens across two profile operations, or with a part nested in another part's
hole on one operation. Nothing warns.

Separately, the CNC time estimate on the live tile, and in Job Review when no controller is
connected, runs rapids at the **laser's** Max feed, not CNC's own (ADR-416).

## Findings

### P1-1 — A profile lead plunges into a kept part from another operation, or into the hole wall around a nested part

- **Where:**
  - `src/core/cnc/profile-lead-passes.ts:65,75`: `applyProfileLeadPasses` builds its obstacle
    set (`distinctClosedContours(passes)`) from the passes of the one group it is called for.
    It is called once per operation (`compile-cnc-job.ts:403`, `compile-cnc-operation-groups.ts:69`),
    so parts on other operations are never obstacles.
  - `profile-lead-passes.ts:141-167` (`leadObstacles`): a shape that contains this contour
    (`return !pointInPolygon(probe, shape)`) is dropped as an "enclosing parent". The comment
    says its interior is legitimate waste. The interior is waste, but the parent's wall is kept
    material. The lead is never checked to stay inside that parent's toolpath.
  - `leadClearsSiblings` (`:352`) therefore cannot see either neighbour.
- **Anchor:**
  - Contract: ADR-250 Decision 1 says the plunge lands in the waste. Its Consequences say leads
    fall back to a plunge when they enter "a disjoint neighbouring part".
  - Ground truth: the reach of the lead. A 90° arc lead with the default radius r (tool radius)
    starts r out from the toolpath, and its cutter reaches 3r = 1.5 D beyond the part edge.
- **Scenario:**
  1. Default settings (leads on), 1/8" end mill. Part A (40×30 mm) is Outside path on
     operation "a", 3 mm deep. Part B (20×10 mm) is Outside path on operation "b", placed 4 mm
     above A. 4 mm is more than one bit diameter, so the toolpaths do not overlap.
  2. A's lead plunges at `G0 X38.413 Y383.175` / `G1 Z-3.000 F300`. B's edge is at Y384, so the
     cutter reaches 0.763 mm into part B, full depth, at the lead-in. It does so again at the
     lead-out (X41.588), on every depth pass.
  3. With both parts on one operation, the sibling check drops the lead and the clearance is
     −0.001 mm, which is rounding.
  4. Same result for part-in-part nesting on a single operation. Part P (100×100) has a 60×60
     hole, and part S (40×36) sits in the hole 4 mm from its top wall. S's lead plunges at
     `X48.413 Y379.175`, 0.763 mm into P's hole wall.
  5. Preflight returns no issue, and no Job Review lead warning exists for CNC.
  6. With a 1/4" bit the reach is 9.5 mm, so typical nesting gaps of 6–9 mm are hit.
- **Evidence:** REPRO. Archived as `repros-09/src_io_gcode_zz-09-lead-gouge.test.ts` and
  `…zz-09-lead-nested.test.ts`. Both compile through `emitGcode`, then model the cutter as a
  disk of r = 1.5875 along every Z<0 move. Output:
  - `two-ops min clearance to … B -0.763 G1 Z-3.000 F300`
  - `one-op … to B -0.001`
  - `worst clearance of in-hole cuts to P's hole wall: -0.763`
  - `preflight []`

  Novelty: F380-01 (2026-09-05) fixed same-operation sibling crossings only. No audit names
  cross-operation or enclosing-parent leads, and no open PR touches the file.
- **Refuter:** CONFIRMED, P1 kept. I used my own geometry through `emitGcode`, with the kept
  outlines taken from separate on-path emissions and a cutter disk of r = 1.5875 on every
  Z<0 feed move:
  - Two operations, 4 mm gap: the cutter goes **0.7625 mm** into the other part on every
    depth pass. That is Z−1, −1.5 and −3. On a 6.35 mm through-cut it is Z−2 to −6.35.
  - Nested part, 4 mm from the hole wall: 0.7625 mm into the wall when the lead starts on the
    side facing that wall. It is 0 when the lead starts on a far side.
  - Controls: one operation gives −0.0005 mm, and leads `none` gives −0.0005 mm.
  - Gap sweep, 1/8" bit: the gouge appears below a 4.76 mm gap (3r).
  - Gap sweep, 1/4" bit, at gaps wider than the bit: 2.525, 1.525 and 0.525 mm at 7, 8 and
    9 mm.
  - Nothing warns. Preflight returns `[]`. The minimum-feature check reports 0 gaps, because
    it works per operation and only flags gaps narrower than the bit. CNC Job Review has no
    lead row. The only collision scan is for user no-go zones.
  - One correction: the default cut type is On path (`machine.ts:332`). Leads are default-on
    only after the operator picks Outside or Inside path, which is the normal choice for
    cutting out parts. Which part's lead does the damage depends on which start edge faces
    the gap.
  - P1 stays. This is silent damage to a kept part at cutting depth, the same class as P1
    F380-01.
- **Fix direction:**
  - Check leads against the cutter-offset contours of every profile or kept part in the job,
    not just the same group.
  - For an enclosing parent, require the lead to stay inside the parent's toolpath polygon
    instead of skipping it.
  - Keep the existing straight-plunge fallback.

### P2-1 — CNC time estimates run rapids at the laser's Max feed, not CNC's own (ADR-416)

- **Where:**
  - `src/ui/laser/live-job-estimate.ts:167-169` and `src/ui/laser/prepared-job-metrics.ts:43,60`
    pass `prepared.project.device`, which is the shared device whose `maxFeed` is the laser's.
  - `estimateJobDuration` then uses it as the rapid velocity and feed ceiling
    (`src/core/job/estimate-duration.ts:78` → `segment-blocks.ts:35-37`).
  - Twin: the Start countdown uses `deviceForActiveHead(...)` (`start-job-preparation.ts:88`),
    and compile, preflight and Frame use `cncHeadDevice`.
- **Anchor:**
  - Contract: ADR-416 Decision 4 says CNC compile, Frame, the live countdown and Job Review read
    CNC's own Max feed.
  - Twin: the live estimate tile and the Job Review fallback disagree with the countdown and
    with "Output max feed" in the same review.
- **Scenario:**
  1. CNC project with laser `device.maxFeed` 6000 and CNC `maxFeedMmPerMin` 1500. This is what
     a router-only setup has after the operator sets CNC Max feed in the CNC step.
  2. A 12-rectangle on-path job shows **1m 39s** on the live tile, and the same in Job Review
     when no trusted controller position is available.
  3. The same emitted program timed with the CNC head device takes **161 s (2m 41s)**: rapid
     travel 88 s, not 26 s.
  4. Connected Start review switches to the countdown's 2m 41s, so the two numbers disagree
     for the same program.
- **Evidence:** REPRO, archived as `repros-09/src_io_gcode_zz-09-estimate-device.test.ts`.
  Output: `liveTile … "label":"1m 39s"`, `jobReviewMetrics.totalSeconds 99.36`,
  `cncHeadDevice.totalSeconds 161.26`. Novelty: no audit names this. ADR-416 postdates the
  timing audits.
- **Refuter:** CONFIRMED, P2 kept.
  - Contract: ADR-416 Decision 4 names "the live countdown and Job Review" as readers of
    CNC's own Max feed. It has no later amendments.
  - Code: `prepareOutput` returns the shared device. Every live tile path (`useJobEstimate`,
    the worker, large-job preparation) goes through `estimateLiveJobFromPrepared` with
    `prepared.project.device`.
  - My repro: 12 on-path rectangles, laser Max feed 6000, CNC Max feed 1500.
    - The live tile shows `1m 56s` (115.7 s), and so does `buildPreparedJobMetrics` with no
      timeline.
    - The same program timed with `deviceForActiveHead` gives 183.5 s: rapids 95.8 s against
      28.0 s. `canvasJobTimingPlan` (the countdown) gives the same 183.5 s.
    - Control: with both Max feeds at 1500, the tile shows `3m 4s`.
  - The emitted feed words are the same in both cases, so only the timing is wrong.
- **Fix direction:** pass `deviceForActiveHead(project.device, project.machine)` into
  `estimateJobDuration` in both estimate paths, as the countdown already does. Add a CNC
  own-feed case to the estimate tests.

### P3-2 — The wrap reference program starts the spindle and rapids X/A right after its M0 tool prompt, with no Z lift

- **Where:** `src/core/cnc/wrap/cnc-wrap-reference-program.ts:30-39`. The sequence is
  `M5`, `; Tool …`, `M0`, then immediately `M3 S…`, `G4 P…`, `G0 X… A…`.
- **Anchor:** Twin. The main emitter's spindle-start invariant
  (`cnc-grbl-transitions.ts:90-130`) says touch-off leaves the new bit at Z0, so the program
  lifts to safe Z before M3 and before any XY move. The wrap post's own datum is
  "radial Z0 at cylinder surface".
- **Scenario:** a two-tool wrap study. After each `M0` the operator changes the bit and
  touches off on the cylinder. The program then spins up and rapids X and A with the bit on the
  surface. The same applies to the first tool. The program is "reference only"
  (`machineOutputAvailable: false`), but it is shown and saved "for controller simulation".
- **Evidence:** REPRO, archived as `repros-09/src_core_cnc_wrap_zz-09-wrap.test.ts`. Output:
  `M0` / `M3 S9000` / `G4 P1` / `G0 X4 A0` / `G1 Z-1 F25`.
- **Refuter:** CONFIRMED, P3 kept.
  - My own two-tool plan emits `G0 Z5` / `M5` / `M0` / `M3 S10000` / `G4 P2` /
    `G0 X12 A0` / `G1 Z-0.5` for both tools.
  - The page is reachable: Device setup → CNC job step → "Review offline wrap study…" shows
    the program and saves it in the JSON.
  - Z is at clearance going into `M0`, so the risk needs the touch-off at Z0 that the main
    emitter itself assumes.
  - It is reference only, so P3 is right.
- **Fix direction:** emit `G0 Z<clearance>` after each `M0` and before `M3`. Say "re-zero Z on
  the cylinder surface" in the prompt.

## KNOWN (re-observed on this tree, not re-raised)

- **K-1, TP-3 (2026-09-24), still open.** Profiles on different layers are not ordered
  inside-first. An outline operation listed first compiles
  `outline:profile-outside > hole:profile-inside` (REPRO `zz-09-tp3`).
- **K-2, AC-8 / CW-04, still open.** Drill makes one bit-size hole at each shape's bounding-box
  centre, and pecks return to Z0 and back at the plunge feed through air (REPRO sweep `drill`).
- **K-3, AC-2 / CW-03, still open, now disclosed.** Adaptive on a plain 40×30 mm pocket with a
  1/8" bit falls back to offset rings with "Adaptive verification simulated radial engagement
  above the configured limit" (REPRO sweep `pocket-adaptive-plain`).
- **K-4, TP-5 / AUDIT A5.** Default 4 tabs fully cover a 12 mm hole in a through-cut part, so
  the hole's deep passes ride at the tab top and the slug is not cut through. This is
  documented behaviour, with a UI full-coverage advisory.
- **K-5, P2-preview-2 (2026-09-29) and CNC full-chain 1.14 (2026-07-25), still open.** The
  toolpath simulator ignores "Retract between passes". This was raised as P3-1 and refuted as
  already known (see Refuted).
- Ledger items in this area that were not re-verified: 02-P2-2 (tapered inlay Pro tiering) and
  01-P2-1 (remote Zero Z skips the probed-Z warning).

## Refuted

- **P3-1: the toolpath simulator ignores "Retract between passes", so preview and scrubber
  do not match emitted motion** (`toolpath-cnc.ts:83-105`).
  - Refuted as new: it is KNOWN. 2026-09-29 P2-preview-2 already says "Retract between
    passes … is emitted but not drawn", and its fix is to "honour `retractBetweenPasses`, and
    extend the emitter-agreement test to cover … that flag". 2026-07-25 CNC full-chain 1.14
    has the same defect, the same untested `group()` helper and the same fix.
  - The report cited P2-preview-2 only for the tool-change park.
  - The defect is still present on this tree: `toolpath-cnc.ts` never reads the flag. It is
    tracked as K-5.
- **Straight-inlay insert tabs bypass the stock-bottom gate (ADR-258 Amd 3).** This is
  deliberate. Amd 3 item 3: "Inlay pairs, whose plug is cut from its own board, do not pass
  through this gate."
- **`G4 P3.000` read as milliseconds by Marlin or Smoothieware CNC.** By design: ADR-399 makes
  CNC output GRBL-only, refuses CNC Frame on those controllers and warns on export.
- **`plunged-travel` is advisory, not blocking.** By design: ADR-228 and `blocking-codes.ts`
  rule 7.
- **Tapered-inlay findings reported under code `cnc-inlay-invalid`.** That code is not in
  `COMPILE_INTEGRITY_PREFLIGHT_CODES`, so nothing is blocked.
- **CNC G-code comment injection (03-P1-1 twin).** Every free-text CNC comment goes through
  `sanitizeGcodeCommentValue`. `cutType`, `toolKind` and `feedSource.kind` are enum-validated
  on load (`normalize-layer.ts:93`, `normalize-cnc-tools.ts:48`, `normalize-cnc-feed-source.ts`).
- **`$30` versus Spindle max RPM mismatch unchecked.** It is checked in
  `controller-readiness.ts` / `controller-readiness-messages.ts:54-57`.

## Verified clean

- **Z safety (emitter).** The independent checker found 0 violations over 24 projects. Rules
  checked:
  - no XY `G0` below safe Z
  - every `M3` at or above safe Z
  - after `M0`, no XY move before a Z lift
  - no cutting move with the spindle off or at S0
  - a feed set before every G1/G2/G3

  The tool change emits `G0 Z<park>`, `M5`, `M9`, park XY, `M0`, the restated
  `G21 G90 G54 G94 G17`, `G0 Z<safe>`, `M3`, `G4`, `M8`. Air-floor rapids stop 1 mm above the
  highest Z of an earlier pass with byte-identical XY, which is the tab top on tabbed passes.
- **Depth.**
  - `zPassDepths` lands exactly on −depth, including 0.9/0.3 (no extra pass).
  - Tab-top passes are added to the ladder.
  - V-carve depth is h = (d − r₀)/tan(θ/2), capped at the flank. This matches Carbide 3D and
    Vectric forum formulas and the cone model: worst wall clearance +0.0004 to +0.0007 mm over
    star, L-shape, ring, 60°/90° V-bits, a flat-tip engraving bit, flat-depth and stepped modes.
  - The V-carve flat clearing pocket is inset by depth·tan(θ/2) + r_em, which is exact.
  - Z0 is always stock top. No bottom-zero mode exists.
- **Pocket geometry.** Offset, offset with lifts, raster-X, ramped and rest pockets with a
  circular island: no cut sample is closer than r − 0.001 mm to the wall or island. The floor at
  full depth is covered everywhere except the 27 unreachable sharp-corner samples.
- **Profile sides and cut direction.** Outside, inside and finish allowance (0.3 mm) offset to
  the correct side. Outside climb runs CW and pocket/inside climb runs CCW in machine
  coordinates. This matches Vectric's 2D Profile help (Outside: Climb CW; Inside: Climb CCW) and
  the material-on-right rule for M3. Finishing-pass tab windows align with the roughing tabs.
- **Ramp entry.** Open paths zig-zag and recut each level. The Z rate is capped below plunge
  (10° ramp at F1000 gives 174 mm/min). Tabbed ramps keep the tab top.
- **Tool order (ADR-310).** `[em6 pocket] → M0 → [em pocket, em profile]`. The M0 count equals
  the contiguous tool runs in `cncProgramFacts.toolPlan`, and `cncProgramGeometry` splits on the
  same M0s.
- **GRBL ground truth (gnea/grbl source):**
  - `mc_dwell` executes "dwell in seconds", so `G4 P3.000` is 3 s.
  - The I/J arc check fails only past 0.005 mm and 0.1 % of the radius. Helix half-circles and
    adaptive arcs pass.
  - M0 runs `protocol_buffer_synchronize` then a feed hold.
  - Axis words with no G word take the modal motion, so compact `X…Y…Z…` path3d lines are valid.
  - Whitespace and comments are not stored in the line buffer.
- **Surfacing program.** It lifts before M3, steps over at depth, has a stepover cap and keeps
  the exact requested depth.
- **Twin: material removal.** 3D removal reads the same passes the emitter cuts. Path3d and
  helix `zs` are carried per vertex.

## Not verified

- Relief roughing → finishing handoff against the true surface (area 16), and tiled seams and
  registration bores beyond reading.
- Recovery and pause re-entry with compact path3d lines (area 18).
- Two-sided side B mapping (covered by the 10-09 oracle).
- Tapered inlay physical fit (geometry only was read; the contact formula is consistent).
- Huge-job performance budgets.
- Controller behaviour of M0/M3/G4 on grblHAL or FluidNC, and any hardware or air cut.
- Whether a UI minimum stops a safe Z below 0.0005 mm, which would round to `G0 Z0.000`
  rapids.

```json
[
  {"id":"P1-1","severity":"P1","area":"cnc-core","file":"src/core/cnc/profile-lead-passes.ts","line":143,"anchor":"Contract: ADR-250 Decision 1 and Consequences (plunge lands in waste; lead must not enter a neighbouring part)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Lead obstacles come only from the same operation and skip enclosing parents, so a default arc lead plunges ~0.76 mm (1/8\" bit, 4 mm gap) into a kept part on another operation or into the hole wall around a nested part; no warning"},
  {"id":"P2-1","severity":"P2","area":"cnc-core","file":"src/ui/laser/live-job-estimate.ts","line":167,"anchor":"Contract: ADR-416 Decision 4; Twin: start-job-preparation.ts countdown uses deviceForActiveHead","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Live estimate tile and offline Job Review time a CNC program with the laser's Max feed for rapids (1m39s vs 2m41s with CNC Max feed 1500)"},
  {"id":"P3-1","severity":"P3","area":"cnc-core","file":"src/core/job/toolpath-cnc.ts","line":83,"anchor":"Twin: cnc-grbl-strategy.ts:304,397 retractBetweenPasses","evidence":"REPRO","verdict":"REFUTED","known":true,"summary":"KNOWN (09-29 P2-preview-2, 07-25 1.14): toolpath simulator skips the ADR-253 lift-and-replunge between same-XY passes; property test cannot see it"},
  {"id":"P3-2","severity":"P3","area":"cnc-core","file":"src/core/cnc/wrap/cnc-wrap-reference-program.ts","line":30,"anchor":"Twin: cnc-grbl-transitions.ts spindle-start invariant (safe-Z lift before M3 after M0)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Wrap reference program runs M3 and G0 X/A straight after its M0 tool prompt with no Z lift"}
]
```
