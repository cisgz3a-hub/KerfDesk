# Meta audit v1 — M1 Rolling-v2 P1s (`meta-rolling-v2-p1`)

- **When:** 2026-10-23 08:30–09:40 (+08)   **Tree:** worktree HEAD `8e8255608`, which is
  origin/main `ca3dbeb79` plus audit docs. Re-checked at the end against origin/main
  `48f3d8b5a` (#1411): none of the files audited here changed (`git diff --name-only HEAD
  48f3d8b5a -- src` touches only external-program, material-test, fill-hatching and calibration
  files, and none of them writes a G-code comment from a project string).
- **Scope:** the six rolling-v2 P1s and their fix PRs:
  - 03-P1-1 (#1340)
  - 03-P1-2 and 03-P1-3 (#1345; #1374 carries the #1285 review fixes)
  - 09-P1-1 (#1343)
  - 13-P1-1 (#1352)
  - 21-P1-1 (#1360)

  Sources: `docs/audits/2026-10-21-rolling-v2/{03,09,13,21}-*.md`, `LEDGER.md`, ADR-626
  Amendments 8–9, ADR-250 Amendment 3, ADR-400 Amendment 1, ADR-093 Amendment 1 and ADR-433.
- **Method:** METHOD.md with the meta changes in AREAS.md. All evidence comes from runs, not
  from the reports' own words.
  - **Pre-fix runs.**
    - `git archive 8efbe186e` (the commit before #1345 merged, and before #1360) was unpacked into
      the scratchpad, with `node_modules` as a junction to the repo's packages.
    - #1343 (`b2906e45e^..b2906e45e` source diff) and #1340 (source files of `d5cc878f5`) were
      reverse-applied there with `patch -R`.
    - #1352's two Auto-focus gates (`project-controller-normalization.ts` and
      `laser-autofocus-actions.ts`) were reverse-applied the same way.
    - The fix PRs' own regression tests and the original audit repros were then run against
      that pre-fix code.
  - **Current-tree runs.** The original repros from the audit scratchpad were re-run on the
    current tree: `repros-09/*lead-gouge*` and `*lead-nested*`, `area13-repros/zz-13-autofocus-from-file`
    and `a21-repros/zz-21-starter-overwrite`. Fresh variant tests ran beside them. Every run was a
    single Vitest file: `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file>`.
  - **Copies.** Repro copies, patches and outputs are in the scratchpad `m1-repros\`. All
    `zz-m1-*` files were deleted from the tree. The snapshot was deleted, junction first.
- **Counts:** 4 meta findings raised: P1 0 / P2 2 / P3 2. Own candidates refuted: 3. All six P1s
  were genuine, rated correctly and fixed on main. **After the refuter:** confirmed 4, plausible 0,
  refuted 0; P1 0 / P2 0 / P3 4. M1-P2-1 and M1-P2-2 keep their IDs but are lowered to P3
  (M1-P2-1 a contract question; M1-P2-2 KNOWN from ADR-250 Amendment 3). M1-P3-1 is KNOWN too
  (disclosed in ADR-626 Amendment 8).

## Headline

All six P1s were real when they were raised, and the reported numbers reproduce exactly on
pre-fix code:
- 03-P1-3: 1.273, 1.414 and 2.000 mm.
- 09-P1-1: −0.7625 mm and −2.525 mm.
- 21-P1-1: "has mine false".

Every fix is merged and holds on main for the original scenario and for 60+ variants. Each fix
PR's regression test fails on pre-fix code, with one hole: the 03-P1-3 90° line-lead case passes
on old code too (M1-P3-1).

The corrections are about the **edges of the fixes**:
1. **03-P1-2 residual (M1-P2-1).** A plate whose open lines stop more than 0.5 mm short still
   gets the same 1.5–2 mm lead burn with no warning. ADR-626 Amendment 8 draws its line at that
   gap.
2. **09-P1-1 neighbour (M1-P2-2).** Parts on two CNC operations placed closer than the bit are
   cut into by the profile contour itself. ADR-433 checks gaps only within one operation. Since
   #1343, the only Job Review line is a lead-plunge advisory that speaks of "a mark".
3. **Stale ledger (M1-P3-2).** The rolling-v2 LEDGER still lists all six P1s as open.

Refuter: items 1 and 2 reproduce but are lowered to P3. Item 1 lies outside the boundary ADR-626
Amendment 8 drew on purpose. Item 2 is the operator's layout, cut the same with Lead None, and
ADR-250 Amendment 3 already records it. See each finding's Refuter line and the spot-check below.

## Summary: one row per P1

| P1 | Genuine at the time? (severity) | Fix merged? | Fix effective on main? | Regression test adequate? | Variants tried → result |
|---|---|---|---|---|---|
| 03-P1-1 layer id/colour G-code injection | **Yes**: with #1340 reverted, its test fails 10/11. On GRBL, 8 injected executable lines (89 vs 81). P1 is right (fires the laser) | #1340 MERGED 2026-10-21T22:59:07Z. Its commit `d5cc878f5` landed through #1351's merge `99d8743b7` | **Yes** (11/11) | **Yes** (5 dialects, LF/CR/CRLF, id and colour, line/fill/offset/image) | Id and colour holding U+2028, U+0085, VT/FF, and `!~?`+`Ä×`+U+0097 → 0 executable X300 lines, no non-ASCII or realtime byte in the program. `\n\n\n` id → load refused |
| 03-P1-2 leads into a LINE-drawn plate | **Yes**: the #1345 test fails pre-fix; arc 94 lit samples in the plate from (146.387, 141.149), the report's X46.387 shifted 100 mm. P1 right | #1345 MERGED 2026-10-22T13:17:32Z (`d9a9aa0a6`) | **Yes** for touching LINEs and gaps ≤ 0.5 mm. **No** for gaps > 0.5 mm (M1-P2-1) | **Yes** (arc and 90° cases fail pre-fix) | Gap 0.4 → side-unknown 1, `line-open-outline`, 0 in plate. SVG single open path whose ends meet → side-unknown 1. **Gap 0.6 / 1.0 → 1.49 / 1.99 / 1.66 mm into the plate (arc / 90° / 45°), no issue** |
| 03-P1-3 leads into an overlap-split neighbour | **Yes**: pre-fix, 2.000 (90°, mid-edge start), 1.414 (45°), 1.273 (arc) mm into B, exactly as reported. P1 right | #1345 (as above). #1374 MERGED 2026-10-22T10:23:41Z, not part of this fix | **Yes**: all 0.000 | **Partly**: its 90° cases pass on pre-fix code (M1-P3-1) | Partial shared edge (both orders), three in a row, a near-coincident edge with merge tolerance 0.2, separate artworks; 1 and 2 passes; arc/90°/45° → 0 samples in any part |
| 09-P1-1 CNC leads into kept parts | **Yes**: with #1343 reverted, its test fails 7/10 (−0.7625 at 4 mm, −1.4625 at 3.3 mm, −2.525 with 1/4" at 7 mm). P1 right | #1343 MERGED 2026-10-22T13:06:05Z (`b2906e45e`) | **Yes**: the original repros give −0.001 (was −0.763), with `cnc-profile-lead-plunge`. Adjacent contour gouge remains (M1-P2-2) | **Yes** | Arc radius 6 mm at a 5 mm gap; sweep 180° at 4 mm; 6 mm line lead; nested child on its own operation with a 6 mm radius; tabs on; mixed bits → leads dropped, −0.001. **Cross-operation gap below the bit → contour gouge** (M1-P2-2) |
| 13-P1-1 project Auto-focus command | **Yes**: with both gates reverted, the original repro writes `G1 X300 Y10 F100 S1000 M3\n`, result `ok`. P1 right | #1352 MERGED 2026-10-21T22:59:21Z (`b32eebc95`) | **Yes**: the original path loads `""`, writes nothing; simulator test 16/16 | **Yes**: 11/16 fail with the load and dispatch gates reverted. The other 5 are held by the separate same-identity gate | 33 payloads (lowercase, `S1000 M3`, G38 with M/S/X, F-less, F1000, `$J=`, `$RST=*`, `$N0=`, `$C`, `$SLP`, `$H`, G28/G30/G53/G10/G92, M106/M62/M17, N-word, comment, `;`) → all refused at load and dispatch, except the documented forms |
| 21-P1-1 Starter Presets overwrite | **Yes**: pre-fix, the original repro gives "entries 6 has mine false"; localStorage too. P1 right on METHOD's wording (data loss; narrow reach was stated) | #1360 MERGED 2026-10-22T14:59:38Z (`d9f69b856`) | **Yes**: "entries 7 has mine true", copy `-2` | **Yes**: fails pre-fix. It folds persistence with `reconcileActiveDocument` rather than mounting the hook | Edit the copy, delete another library, press again → `-3` opens, both edited libraries kept. `.lfml.json` Open and `.clb` Import both use `importMaterialLibrary` (no replace) |

### Refuter spot-check of two "genuine and fixed" verdicts (13-P1-1, 03-P1-2)

Both verdicts hold. The checks used fresh `git archive` snapshots of the true pre-merge first
parents, with `node_modules` joined in by a junction; both snapshots are deleted, junction first.
- **13-P1-1, pre-#1352 `99d8743b7`.**
  - The original `area13-repros/zz-13-autofocus-from-file` loads `"G1 X300 Y10 F100 S1000 M3"`,
    writes `["G1 X300 Y10 F100 S1000 M3\n"]`, and the result is `ok`.
  - #1352's `autofocus-crafted-project.simulator.test.tsx` (from `b32eebc95`) fails **16/16**
    there, by assertion or timeout and not by import. That is stronger than the meta auditor's
    11/16, which came from reverting only two gates: the same-identity gate is part of #1352 too.
  - On the current tree the repro loads `""`, writes `[]` and gives `preflight-failed`. The
    simulator test passes 16/16.
- **03-P1-2, pre-#1345 `8efbe186e`.**
  - #1345's `laser-leads-open-outlines.test.ts` (from `d9a9aa0a6`) gives 11 failed / 5 passed.
    All five 03-P1-2 cases fail by assertion (first lit sample `{x: 146.387, y: 141.149}`).
  - My own DXF repro, touching LINEs: arc 94 samples 1.490 mm into the plate, 90° line 1.994 mm,
    no issue. These are the reported 1.49 / 1.99 mm.
  - On the current tree the #1345 test passes 16/16.

## Findings

### M1-P2-1 — A plate whose open lines stop more than 0.5 mm short still gets the 03-P1-2 lead burn, with no warning
- **Corrects:** 03-P1-2 (fix #1345, recorded as fixing the defect).
- **Kind:** Fix incomplete. A residual variant of the same defect reproduces on main.
- **Where:**
  - `src/core/job/laser-lead-open-outlines.ts:37-38`: `OPEN_OUTLINE_GAP_MM` = 0.5, stroke
    radius 0.25. Ends more than about 0.48 mm apart close no region.
  - `src/core/preflight/line-open-outline-issues.ts:68`: the advisory joins only at the same
    0.5 mm.
  - ADR-626 Amendment 8, decision 2: "stop up to 0.5 mm short".
- **Anchor:**
  - Contract: ADR-626 clause 4 says the free end can never end inside another part. Amendment 1
    D3 says an unknown side gets no lead, plus a warning.
  - Ground truth: a 0.6–1 mm gap in an outline leaves the plate held by a bridge. It is still a
    kept part, as drawn micro-joints are.
  - Amendment 8 scopes the gap on purpose ("wider gaps are for Join paths"). The physical result
    is the P1's.
- **Scenario:** the 03-P1-2 plate, an 80 mm square drawn as four DXF LINEs with an r5 CIRCLE hole.
  One corner is left 0.6 mm (or 1.0 mm) open, as a hand-drawn bridge would be. Leads are on with
  automatic side.
  - The hole is read as an outer contour.
  - Its lead burns into the plate: arc 1.49 mm, 90° line 1.99 mm, 45° line 1.66 mm.
  - `job.diagnostics` has no side-unknown, and preflight is `[]`.
  - At 0.4 mm the same file gets side-unknown 1 plus `line-open-outline`, and nothing burns in the
    plate.
- **Evidence:** REPRO, `m1-repros\zz-m1-03-variants.test.ts` on the current tree
  (`03-main.txt`):
  - `gap 0.6 arc: inPlate 94 sideUnknown 0 issues [] … ~1.490`
  - `gap 0.6 line90: inPlate 39 … ~1.994`
  - `gap 1 line45: inPlate 78 … ~1.663`
  - `gap 0.4 arc: inPlate 0 sideUnknown 1 issues ["line-open-outline"]`
- **Severity:** P2. The output is the P1's (a silent burn into a kept part, visible only as a
  normal-looking lead in preview). The trigger, though, is a drawn gap over 0.5 mm with leads on,
  which ADR-626 Amendment 8 deliberately leaves out. This is a **maintainer decision**: P3 if the
  boundary stands as designed, P1 if bridges with leads are judged an ordinary workflow.
  LightBurn's behaviour for the same file was not checked.
- **Refuter:** CONFIRMED as behaviour, but re-rated **P2 → P3 as a contract question**, not
  "fix incomplete".
  - **Repro.** I wrote my own DXF repro and ran it on the current tree, with the gap at a corner
    and mid-edge, and with arc and 90° line leads.
    - Gaps of 0.55, 0.6 and 1.0 mm: 94 / 39 lit samples in the plate, 1.490 / 1.994 mm deep. No
      side-unknown, and preflight `[]`.
    - Gaps of 0.3 and 0.45 mm: side-unknown 1 plus `line-open-outline`, and nothing in the plate.
    - On pre-fix `8efbe186e` the same repro gives 1.490 / 1.994 mm at gaps of 0, 0.3 and 0.6 mm.
      Outside the fixed band, then, main behaves exactly as before the fix.
  - **Not a gap in the fix.** 03-P1-2's scenario was LINEs that touch, and #1345 fixes that (see
    the spot-check). ADR-626 Amendment 8 drew the boundary on purpose and gives the reason:
    - Decision 1 "leaves every drawn gap open; wider gaps are for Join paths and for decisions 2
      and 4".
    - Decision 2 takes the 0.5 mm gap Fill already offers to close
      (`CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM`).
    - Clause 9 and Amendment 8 keep open paths "neither containers nor part edges".
    - So the code meets its written contract. The ADR does not list this consequence under "Not
      covered", which makes it a question for the maintainer.
  - **Realism.** A 0.6–1.0 mm gap does not come from DXF export rounding.
    - The importer closes an entity at 1e-4 mm (`CLOSURE_EPS_MM`) and joins pieces at 1e-4 mm
      (`DXF_JOIN_TOLERANCE_MM`).
    - Join paths defaults to 0.05 mm (`JoinPathsDialog.tsx:13`). Fill's 0.5 mm is the widest
      closing tolerance in the app.
    - A gap that wide is a deliberate bridge or a gross drafting error. KerfDesk's supported
      bridge is laser tabs, which keep the outline a ring (ADR-626 clause 3; the tabbed plate in
      Amendment 1's tests).
  - **LightBurn.** Its Line Mode docs, fetched today, say the lead side is the Angle sign, set per
    layer, and the page describes no scrap-side detection. The same file in LightBurn therefore
    leads every hole outward into the plate, whether the plate is closed or not. The "copy
    LightBurn" rule gives no reason to raise this.
  - **Side note, no new finding.** At exactly 0.5 mm, `line-open-outline` fires, because Join paths
    joins at 0.5 mm. The side detector only closes ends up to about 0.48 mm apart (which the ADR
    states), so the hole lead still burns 1.49 / 1.99 mm while the advisory names only the
    outline. This belongs in the same maintainer decision.
- **Fix direction:**
  - Under automatic side, judge a closed contour side-unknown when open Line paths come within
    the lead's own reach of closing round it, for example gap ≤ lead length + kerf, instead of
    the fixed 0.5 mm.
  - Or at least name it in Job Review the way `line-open-outline` names ≤ 0.5 mm outlines.

### M1-P2-2 — CNC parts on two profile operations placed closer than the bit are cut into by the contours themselves; ADR-433 checks one operation at a time, and the only Job Review line since #1343 talks about a plunge mark
- **Corrects:** 09-P1-1's scope and area 09's headline ("The one physical defect is in
  lead-ins"). The 09 gap sweeps and #1343's sweep start at 3.3 mm, just above the 1/8" diameter,
  so no run covered a cross-operation gap narrower than the bit. The 09 refuter recorded that the
  minimum-feature check "works per operation" but did not test past it.
- **Kind:** Missed adjacent defect. #1343's disclosure is misleading for it.
- **Where:**
  - `src/core/min-feature/operation-targets.ts:238` (`minFeatureTargets`): one target per
    operation (ADR-433 decision 1).
  - `src/core/preflight/cnc-profile-lead-plunge-issues.ts:24`: "The plunge can leave a mark on
    that edge."
  - The profile contour itself (no lead involved).
- **Anchor:**
  - Twin: the same two parts on one operation get one ADR-433 gap warning (2.5 mm and 3.0 mm) and
    no gouge, because the outline merges. On two operations they get no gap warning and do gouge.
  - Contract: ADR-433 says Job Review warns when a gap is narrower than the band one bit diameter
    wide.
  - Ground truth: the cutter disk.
- **Scenario:**
  - Setup: 1/8" end mill, Outside path. Part A (40×30) is on operation "a" and part B (20×10) on
    operation "b", with a 2.5 mm gap.
  - Each contour's cutter reaches 0.676 mm into the other part, at every depth pass. A 3.0 mm gap
    gives 0.176 mm.
  - Preflight lists only `cnc-profile-lead-plunge` ("…a lead-in there would cut into a part next
    to it. The plunge can leave a mark on that edge"), and `checkProjectMinimumFeatures` reports
    `0gaps` for both operations.
  - Mixed bits make it worse. With B on a 1/4" bit and a 4 mm gap, B's contour sits 3.175 mm out
    and reaches 2.35 mm into A (geometry). The run's issues are again only the lead-plunge code.
  - Before #1343 the same jobs were silent.
- **Evidence:** REPRO, `m1-repros\zz-m1-cnc-lead-variants-final.test.ts`, with the same
  independent cutter-disk model as #1343's `cnc-cutter-clearance.test-support.ts`
  (`09-narrow-minfeature.txt`):
  - `minfeature ["0gaps/minnull","0gaps/minnull"]` / `narrow gap 2.5 two-ops: clearance -0.676 in part-b … issues ["cnc-profile-lead-plunge"]`
  - `minfeature ["1gaps/min2.5"]` / `narrow gap 2.5 one-op: clearance -0.001 … issues []`
- **Severity:** P2. A kept part is cut at full depth, and the only Job Review line understates
  it as a plunge mark. It is not P1, because the line does point at "a part next to it" and says
  to "leave more space", and the layout error is the operator's. Before #1343 it was silent.
  Route it to CNC v1 F3/F7, which have not run yet.
- **Refuter:** CONFIRMED as behaviour, but **KNOWN** and not a correction to 09-P1-1. Re-rated
  **P2 → P3**: what is left is a missing cross-operation advisory and understated wording.
  - **Repro.** My own test: 1/8" bit, Outside path, 3 mm deep, the same 40×30 and 20×10 parts.
    - Two operations: a 2.5 mm gap puts the cutter 0.676 mm into part-b. A 2.0 mm gap, Quick
      Nest's default CNC spacing, puts it 1.176 mm in. The minimum-feature check reports `0gaps`
      for both operations.
    - One operation: −0.001 mm, and 1 gap reported.
  - **Not a lead finding.** With **Lead None** the two-operation gouge is the same (−0.676 /
    −1.176 mm), and preflight is `[]`. Each contour sits where the drawing put it. The lead-plunge
    line appears only because a lead was also blocked. 09's headline ("the one physical defect is
    in lead-ins") stands: this is the operator's layout, cut exactly as drawn, one operation at a
    time.
  - **KNOWN.** The premise that no run covered a cross-operation gap narrower than the bit is
    wrong.
    - ADR-250 Amendment 3 (#1343) ran an emit-hash probe. It covered gaps of 2 and 3.5 mm, the
      first part on its own operation, and 1/16", 1/8" and 1/4" bits.
    - Its Verification records: "456 programs still bring the cutter within a kept part … the
      parts are closer than the cut width, so the profile itself cuts the neighbour. Leads do not
      cause these."
    - The 09 refuter also recorded that the minimum-feature check "works per operation".
    - The same-operation version is 2026-09-29 P2-review-3 (Quick Nest's 2 mm CNC spacing), still
      open: `QuickNestDialog.tsx:38` still has `padding: '2'`.
  - **Contract.** ADR-433 decision 1 builds one target per operation by design, and no ADR
    promises a cross-operation gap check. A grep of `src/core/preflight`, `src/core/min-feature`
    and `src/ui/laser/job-review` finds no cross-operation overlap or kerf check anywhere.
  - **What stands (P3).**
    - A cross-operation gap narrower than the cut width gets no warning at all when leads are off.
    - `cnc-profile-lead-plunge` says only that the plunge "can leave a mark".
    - Its docstring says "the program is safe as compiled" (`cnc-profile-lead-plunge-issues.ts:7`),
      which is untrue when the contour itself reaches the neighbour.
    - Route it with P2-review-3's fix (CNC part spacing at least the cut width) to CNC v1 F7.
- **Fix direction:**
  - Run ADR-433's gap test across every profile and pocket operation of the job, using each side's
    own cut width, or reuse #1343's job-wide kept walls (`profileLeadJobWalls`) to flag a contour
    whose cutter reaches another operation's kept side.
  - Word the lead-plunge advisory so it does not imply that the contour itself is clear.

### M1-P3-1 — #1345's regression test does not cover the 90° line-lead case of 03-P1-3 (it passes on pre-fix code)
- **Corrects:** the 03-P1-3 fix record (ADR-626 Amendment 8 Verification, #1345).
- **Kind:** Fix without a failing regression test for one reported variant.
- **Where:** `src/io/gcode/laser-leads-open-outlines.test.ts:258-325`. Part A starts at the
  shared corner. With 90° line leads at a corner start, no lead reaches B, even on old code.
- **Anchor:** METHOD L7, plus AREAS "fix ineffective … or whose fix has no regression test". The
  ADR itself says "Every case except those last two **and the 90° overlap case** failed before
  this amendment."
- **Scenario / Evidence:** REPRO.
  - The #1345 test on pre-fix `8efbe186e` gives 11 failed / 5 passed. Both
    `keeps every lead out of both parts (line 90° leads, 1 pass / 2 pass)` cases pass
    (`1345-test-on-pre-fix.txt`).
  - The report's 2.000 mm case needs A to start mid-edge.
  - `m1-repros\zz-m1-03-p13-line90.test.ts`, pre-fix: `A mid-edge line90: into B 2.000`,
    `line45 1.414`, `arc 1.273`. Main: all `0.000`.
  - The fix works; only the guard is missing.
- **Refuter:** CONFIRMED, P3 kept; the underlying fact is KNOWN.
  - I ran #1345's test (from `d9a9aa0a6`) on a fresh `git archive 8efbe186e`: 11 failed / 5
    passed. Both `line 90° leads, 1 pass / 2 pass` overlap cases pass. The failures are assertions,
    not load errors (lit samples at `x: 41.414` and `x: 41.273`).
  - The auditor's archived mid-edge runs agree: `03-p13-pre-fix.txt` gives 2.000 / 1.414 /
    1.273, and `03-p13-main.txt` gives 0.000.
  - ADR-626 Amendment 8's Verification already discloses it ("and the 90° overlap case"), so the
    fact is known. The arc and 45° cases guard the mechanism, `topologyRings`. A mid-edge 90° case
    is still worth adding as a P3 test card.
- **Fix direction:** add the mid-edge-start (or forced-start) 90° case to the 03-P1-3 block.

### M1-P3-2 — The rolling-v2 LEDGER still records every P1 fix as open
- **Corrects:** `docs/audits/2026-10-21-rolling-v2/LEDGER.md:20-27` and the P1 rows
  `:80-82, :105, :109, :116`. The file was last written at `ef72907cd`, 2026-10-22 07:30 +08,
  and is the same on origin/main and the audit branch.
- **Kind:** Stale record.
- **Scenario:**
  - The LEDGER lists #1343 and #1345 as "Open", and 21's fix as "In progress". The six P1 rows
    all have "Fix status: open".
  - GitHub (`gh pr view`) shows all of them MERGED:
    - #1340: 2026-10-21 22:59Z, via #1351's merge commit `99d8743b7`
    - #1352: 22:59Z
    - #1374: 2026-10-22 10:23Z
    - #1343: 13:06Z
    - #1345: 13:17Z
    - #1360: 14:59Z
  - The same rows also leave the P2s these PRs fixed as open: 03-P2-9, 13-P2-1/2 and
    21-P2-1..3. M2 reconciles those.
  - Minor: the 09-P1-1 row says "0.76 mm into the neighbour at every depth pass below a 4.76 mm
    gap". 0.76 mm is the 4 mm value. The gouge is 4.7625 mm − gap: 1.46 mm at 3.3 mm.
  - Other records are right: D2 says "13-P1-1 … Fixed by #1352", C7 says "13-P1-1 (fixed)", and
    ADR-626 Amd 8, ADR-250 Amd 3, ADR-400 Amd 1 and ADR-093 Amd 1 are on main.
- **Evidence:** LIVE `gh pr view <n> --json state,mergedAt,mergeCommit`. `git log -1 --
  docs/audits/2026-10-21-rolling-v2/LEDGER.md` on HEAD and `origin/claude/rolling-audit-20261021`.
- **Refuter:** CONFIRMED, with one wording fix.
  - **`gh pr view` today.**
    - #1340: MERGED 2026-10-21T22:59:07Z. Its merge commit is `99d8743b7`, the same as #1351's.
    - #1352: MERGED 22:59:21Z.
    - #1374: MERGED 2026-10-22T10:23:41Z.
    - #1343: MERGED 13:06:05Z.
    - #1345: MERGED 13:17:32Z.
    - #1360: MERGED 14:59:38Z.
  - **LEDGER state.** The last commit is `ef72907cd` (2026-10-22 07:30 +08) on HEAD, origin/main
    and origin/claude/rolling-audit-20261021, and all six P1 rows say `open`.
  - **Wording fix.** The LEDGER's "Fix PRs" block (state "2026-10-22, morning") already lists
    #1340 and #1352 under **Merged**. What is stale is #1343 and #1345 under "Open", 21 under "In
    progress", and the six rows' status cells. The headline and JSON claim that "all six" are
    shown open is too broad.
- **Fix direction:** set the six P1 rows to "fixed (#PR, merge SHA)", with a "Corrected by
  meta-v1 M1" note. Note that #1340 merged through #1351.

## Refuted (own candidates)

- **The CNC kept-wall skip rule lets a lead whose plunge lies inside a neighbour through.**
  `leadClearsKeptWalls` skips a wall "whose kept side already holds the lead's start". The
  `start` it tests is `leadIn.at(-1)`, the contour start, not the plunge point. Runs with a 6 mm
  arc radius at a 5 mm gap, a 180° sweep, a 6 mm line lead, and a nested child with a 6 mm radius
  all drop the lead (−0.001 mm, notice raised).
- **A crafted Auto-focus line still reaches the controller.** 33 payloads were tried. All were
  refused at load (`normalizeAutofocusCommand` → `""`) and at dispatch, on GRBL, grblHAL,
  FluidNC, Marlin, Smoothieware and Falcon, apart from the documented focus forms. The
  unbounded |Z| of an accepted `G38.2` (for example `G38.2 Z+300 F150`) is KNOWN: it is the
  D2-P3-3 refuter addendum, and #1388 bounded F and refused G38.3/.5 but not |Z|. That belongs to
  M3, not here.
- **Starter Presets can still overwrite through another import path.** `SavedLibrariesDialog.tsx:36`
  binds both `.lfml.json` Open and `.clb` Import to `importMaterialLibrary`
  (`resolveImportedLibrary`: "never replaces a saved library"). No other caller installs a
  fixed-id document.

## Verified clean

- **03-P1-1:** every laser comment sink that interpolates a project string goes through
  `gcodeCommentLabel` or `sanitizeGcodeCommentValue`. That covers layer, offset-fill, fill,
  image and cnc-skipped headers, provenance `fillStyle`/`ditherAlgorithm`, the profile header,
  tile bit names and the CNC tool name. A grep on origin/main `48f3d8b5a` finds no raw one left.
  `layer.color` is still not hex-validated on load, but it is now inert (optional hardening).
- **03-P1-2/3:** the open-line region detector unions lines across every burning Line operation,
  with output on or off, and the overlap-removal outline rides through the packet cleanup and the
  part coalescing (2-pass cases).
- **09-P1-1:** both lead callers (`compile-cnc-layer-group.ts:61`,
  `compile-cnc-operation-groups.ts:71`, the inlay pair) pass the job-wide kept walls. On-path
  neighbours are judged by their cleared band, and Inside-path neighbours keep the lead into
  their slug (PR test, 10/10 on main).
- **13-P1-1:** Auto-focus has three independent gates (load normalisation, same-identity keep,
  dispatch re-check). Machine-profile import and the remembered last machine use
  `recoverProfileCommands`.
- **21-P1-1:** repeated presses never overwrite an edited library; each makes a numbered copy.
- **Citations:** every `file:line` in the six P1 entries was re-read at its audited SHA
  (`70c01e11f`, `2c8d988db`, `902f1d0c0`) and says what the report says. That includes the
  `grbl-strategy.ts:284/311/392` raw interpolation, `project-layer-shape-validator.ts:37-39`,
  `streamer.ts:141-151`, `laser-lead-sides.ts:104`, `dxf-entities.ts:56-61`,
  `remove-cut-overlaps.ts:140`, `profile-lead-passes.ts:65,75,141-143`, `machine.ts:332`
  (default On path), `project-shape-validator.ts:124`, `laser-autofocus-actions.ts:77-78`,
  `MaterialLibraryPanel.tsx:85` and `material-library-builders.ts:37`. The DECISIONS.md ADR-273
  quote ("remain inert comments instead of creating controller commands") exists at line 14843.

## Not verified

- **LightBurn's behaviour** for a hole inside a plate whose outline has a gap over 0.5 mm, which
  bears on M1-P2-1's severity under the "copy LightBurn" rule.
- **Job Review UI rendering** for M1-P2-2. Only `preflight.issues` and
  `checkProjectMinimumFeatures` were read, not the mounted Job Review list.
- **CNC inlay pairs** as neighbours: an inlay-pair operation is not a profile cut type, so its
  insert outline is not a kept wall. The pair is cut from separate boards, so this was not judged
  a defect and was not run.
- **#1374:** only its merge state was checked. It carries ADR-626 Amendment 9 (bounded work,
  collinear overlaps), not these P1s.
- **Full #1352 and #1360 reversals.** #1352's source does not reverse-apply cleanly on
  `8efbe186e` (`project-actions.ts` changed since), so only its two Auto-focus gates were
  reverted. #1360 was tested on `8efbe186e`, which predates it.
- **Overwritten auditor output.** Re-running the original 09 nested repro wrote over the auditor's
  `scratchpad\zz09-lead-nested.txt` and `.nc` with today's main result (−0.001). The original
  −0.763 is kept in report 09 and reproduced by #1343's test with the fix reverted.
- **Hardware:** none was used.

```json
[
  {"id":"M1-P2-1","severity":"P3","severity_raised":"P2","area":"meta-rolling-v2-p1","corrects":"03-P1-2","kind":"contract question (outside ADR-626 Amd 8's deliberate 0.5 mm boundary; raised as fix incomplete)","file":"src/core/job/laser-lead-open-outlines.ts","line":37,"anchor":"Contract: ADR-626 clause 4 and Amendment 1 D3; Ground truth: a bridged plate is a kept part (Amendment 8 scopes gaps to 0.5 mm)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Reproduced (0.55/0.6/1.0 mm gaps: 1.490 arc / 1.994 line90 into plate, no warning). Amd 8 decision 1 leaves drawn gaps open and decision 2 takes Fill's 0.5 mm on purpose; clause 9 keeps open paths out of parity, so code meets its contract. Wide gaps are not DXF rounding (import 1e-4 mm, Join paths 0.05 mm). LightBurn sets lead side per layer by angle sign, no scrap-side detection. At exactly 0.5 mm the advisory fires but the lead still burns (detector closes <=0.48 mm). Maintainer decision.","known":false,"summary":"DXF plate whose LINEs leave a 0.6-1.0 mm corner gap: hole lead burns 1.49 (arc) / 1.99 (90 deg) / 1.66 (45 deg) mm into the plate on main, no side-unknown, preflight []; 0.4 mm gap is handled"},
  {"id":"M1-P2-2","severity":"P3","severity_raised":"P2","area":"meta-rolling-v2-p1","corrects":"09-P1-1 (scope; area 09 headline) - correction not upheld: not a lead defect","kind":"missing cross-operation advisory; understated lead-plunge wording (raised as missed adjacent defect)","file":"src/core/min-feature/operation-targets.ts","line":238,"anchor":"Twin: one-operation layout gets an ADR-433 gap warning and no gouge, two-operation layout gets neither warning nor protection; Contract: ADR-433","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Reproduced (2.5 mm gap -0.676, 2.0 mm -1.176 into part-b). Identical with Lead None, preflight [] - operator layout cut as drawn, not a lead defect. KNOWN: ADR-250 Amd 3 Verification records 456 probe programs where 'the profile itself cuts the neighbour. Leads do not cause these' (gaps 2 and 3.5 mm covered). ADR-433 decision 1 is per operation by design; no cross-operation check exists. Same-op twin is open 2026-09-29 P2-review-3 (Quick Nest 2 mm CNC spacing). Residual P3: no cross-op advisory; lead-plunge wording and its 'safe as compiled' docstring understate.","known":true,"known_ref":"ADR-250 Amendment 3 Verification (#1343); 2026-09-29 P2-review-3","summary":"Two CNC profile operations, parts 2.5 mm apart with a 1/8in bit: each contour cuts 0.676 mm into the other part (3.0 mm gap: 0.176; 1/4in neighbour at 4 mm: 2.35); min-feature reports 0 gaps and the only issue is the lead-plunge advisory about a mark"},
  {"id":"M1-P3-1","severity":"P3","area":"meta-rolling-v2-p1","corrects":"03-P1-3 (fix record, #1345 test)","kind":"fix without failing regression test for one variant","file":"src/io/gcode/laser-leads-open-outlines.test.ts","line":258,"anchor":"METHOD L7; ADR-626 Amendment 8 Verification says the 90 deg overlap case passed before the fix","evidence":"REPRO","verdict":"CONFIRMED","refuter":"#1345 test on fresh 8efbe186e: 11 failed / 5 passed, both 90 deg overlap cases pass; failures are assertions. Disclosed in ADR-626 Amd 8 Verification, so KNOWN; guard still worth a P3 test card.","known":true,"known_ref":"ADR-626 Amendment 8 Verification","summary":"The 90 deg line-lead cases of the 03-P1-3 test pass on pre-fix code; the reported 2.000 mm burn needs a mid-edge start (pre-fix 2.000, main 0.000) and has no guard"},
  {"id":"M1-P3-2","severity":"P3","area":"meta-rolling-v2-p1","corrects":"rolling-v2 LEDGER rows 03-P1-1/2/3, 09-P1-1, 13-P1-1, 21-P1-1","kind":"stale record","file":"docs/audits/2026-10-21-rolling-v2/LEDGER.md","line":20,"anchor":"GitHub PR state (gh pr view)","evidence":"LIVE","verdict":"CONFIRMED","refuter":"gh pr view: all six MERGED at the stated times; LEDGER last commit ef72907cd on HEAD, origin/main and the audit branch. Wording fix: the LEDGER's Fix PRs block already lists #1340 and #1352 as Merged; stale are #1343/#1345 (Open), 21 (In progress) and all six row status cells.","known":false,"summary":"LEDGER (last written 2026-10-22 07:30 +08) shows all six P1 rows as open (its Fix PRs block lists #1340 and #1352 as merged, #1343/#1345 open, 21 in progress); #1340 (via #1351), #1352, #1374, #1343, #1345 and #1360 are all MERGED by 2026-10-22 14:59Z; 09-P1-1 row also misstates the gouge as 0.76 mm for every gap below 4.76 mm"}
]
```
