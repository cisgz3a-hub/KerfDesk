# Rolling audit v3 — CNC changes

- **When:** 2026-10-27 09:50–10:20 +0800   **Tree:** origin/main @ `9a2bf6b13` (worktree `src/` identical to it)
- **Scope:** `src/core/cnc`, `src/core/relief`, `src/core/geometry`, `src/core/min-feature`, `src/io/cnc`. Followed into their twins and output siblings: `src/core/preflight/cnc-*.ts`, `src/ui/app/tile-emission.ts`, `src/ui/laser/cnc-*-warnings.ts`, `src/io/gcode/prepare-output.ts`, `src/io/gcode/gcode-metadata.ts`.
  - Merges read: the 20 first-parent merges from `git log --first-parent --since=2026-10-21T00:00 origin/main -- <paths>`, #1308 through #1452. The focus was #1343, #1354/#1387, #1416, #1418, #1420, #1421, #1422, #1423, #1444, #1450, #1451 and #1452.
  - Branch-side merges with conflict hunks, read with `git show --cc`: `2f3ce9d69`, `44a8508cb`, `ce1b4f11d`, `f5fbce13a` (the 10-23 CNC v1 fixes), `a176fa7f8` (#1451 against #1450), `adc739125` (#1451 against #1440), and `f8327d768` (#1452 against #1451).
  - Governing ADRs: ADR-140 Amd 2, ADR-153 Amd 1, ADR-154 Amd 4, ADR-250 Amd 3, ADR-285 Amd 1, ADR-306 Amd 3, ADR-359 Amd 3, ADR-412 Amd 2, ADR-433 Amd 2 and Amd 3, ADR-572 Amd 1 and Amd 2, ADR-575 Amd 1, ADR-580 Amd 1, ADR-665, ADR-672.
  - Newer than the audited tree, not audited: #1453 (setup package defaults to one file per bit; F8-P2-1), #1454 and #1455.
- **Lenses run:** L8 (main lens: combined fixes, conflict resolutions, #1444 untested merge, sibling output paths), L3 and L7.
  - L1 was run only for the ADR claims of the PRs in scope.
  - L2, L4, L5 and L6 were not assigned.
  - The CNC v1 geometry was not re-checked, as instructed.
  - Repros:
    - Focused Vitest runs of #1444's five test files.
    - Three temporary Vitest files (`zz-g5-*`, now deleted). They reuse the repo's independent checkers: `through-cut-hold.test-support.ts` (flood fill), `tapered-inlay-fit.test-support.ts` (cone sweep) and `cnc-cutter-clearance.test-support.ts` (cutter disk). None of these checkers reads the planner.
- **Counts:** 3 raised → 0 refuted → P1 1 / P2 0 / P3 2 (+ 1 KNOWN: G1-P3-1 extended to three CNC merges). Refuter: all three CONFIRMED by REPRO, no severity change.

## Headline

The fixes combine correctly almost everywhere they were tried together:

- Finish allowance with tabs and leads, at the bit radius, with a ramp, with a stacked copy, with a Wall finishing recipe and around a nested part: nothing comes loose.
- The tapered inlay pocket now gets #1422's corner fix: the plug stops 0.003 mm short at most.
- The cross-operation check (#1451) catches the gouge that #1416's outward roughing ring makes into a neighbouring operation's part.
- Every conflict resolution kept both sides.
- #1444's tests pass.

The one serious gap is a sibling path. ADR-359 Amd 3 (#1450) keeps stacked copies on On path as a deliberate spring pass. The kept-wall model that ADR-250 Amd 3 leads and ADR-433 Amd 3 read normalises each operation's outlines even-odd, so a copied On path part has no wall at all. A neighbouring operation's lead then plunges 0.675 mm into that part, at every depth, and no notice appears (G5-P1-1).

## Findings

### G5-P1-1 — A stacked copy on an On path operation erases that part's kept wall, so another operation's lead plunges into it with no notice
- **Where:**
  - `src/core/cnc/profile-lead-kept-walls.ts:90`: `normalizeClosedPolylineTreeEvenOddChecked(closed)` over the operation's closed contours. On path walls take `clearedMm` at `:94`.
  - `src/core/cnc/cnc-stacked-copies.ts:53`: an On path operation returns its contours unmerged, because `CUT_TYPES_FILLING_CLOSED_OUTLINES` at `:27-33` has no `profile-on-path`.
  - `src/core/cnc/profile-lead-job-walls.ts:52-57`: these walls are the job's lead obstacles.
  - `src/core/cnc/compile-cnc-job.ts:169,210`: the same walls feed the ADR-433 Amd 3 cross-operation check.
- **Anchor:**
  - **Contract.** ADR-250 Amd 3 Decision 1: "Every kept wall in the job is an obstacle". It collects the walls of "Outside path, Inside path and On path" operations, "normalised even-odd as the offset normalises them". An On path cut is not an even-odd offset: it follows each outline. ADR-359 Amd 3 Decision 3: On path keeps every copy, which "can be a deliberate spring pass". Decision 1 of the same amendment says the lead walls see one copy "as the cut does", but only the filled cuts are merged.
  - **Twin.** The narrow-feature check keeps one copy of an exactly stacked outline for every cut type (`src/core/min-feature/stacked-outlines.ts:1-5`: "filled even-odd the copy cancels its twin and turns one part into a phantom gap, so the check keeps only the first copy"). The lead walls do not.
- **Scenario:** The scene is from `emit-gcode-cnc-lead-kept-parts.test.ts`, "keeps the whole cutter out of a part cut On path".
  - Part A is a 40 × 30 mm Outside profile on layer a. Part B is a 20 × 10 mm On path profile on layer b, 2.5 mm above A. Both use the 1/8" bit, depth 3 mm at 1.5 mm per pass, tabs off.
  - B's outline is listed twice in its path. That is what Duplicate without moving, a second import, or a deliberate spring-pass copy gives.
  - With one copy, A's arc lead is dropped for a straight plunge, and Job Review says so (`cnc-profile-lead-plunge`).
  - With two copies, B's two identical rings cancel even-odd, so B has no wall. A keeps its arc lead:
    - It plunges at `G0 X38.413 Y383.175`, then `G1 Z-1.500` and `G1 Z-3.000`.
    - That point is 0.675 mm inside B's line (B's edge is machine Y 382.5).
    - The cutter disk reaches 0.675 mm into the part B keeps past its own On path kerf, at both depths.
  - `emitGcode`'s preflight reports no issue at all: no lead plunge, no stacked copy and no kept-part line.
  - B is still cut, twice, as ADR-359 Amd 3 intends.
- **Evidence:** REPRO. A temporary Vitest file reused `emit-gcode-cnc-lead-kept-parts.test.ts`'s helpers, with B's outer ring listed twice. It judged the emitted program with `cnc-cutter-clearance.test-support.ts` against B inset by the cutter radius, which is B's kept material after its own On path cut. Command: `node ../../../node_modules/vitest/vitest.mjs run src/io/gcode/zz-g5-onpath.test.ts --silent=false --reporter=verbose`. Output:
  - On path, one copy, gap 2.5: clearance −0.0005 mm (rounding, on part A); lead dropped; issues `["cnc-profile-lead-plunge"]`.
  - On path, two copies, gap 2.5: **clearance −0.675 mm on part B** at `G1 Z-1.500 F300`; lead kept; issues `[]`.
  - On path, two copies, gap 3.0: **−0.175 mm on part B**; lead kept; issues `[]`.
  - Gap 3.5: no gouge, with or without the copy.
  - Control, Outside B with two copies, gap 2.5: the copies merge (`cnc-stacked-copies-merged`), the lead is dropped, and the profile's own 0.675 mm reach into B is named twice (`cnc-profile-cuts-kept-part`). This is the known ADR-433 Amd 3 case.
- **Refuter:** CONFIRMED, P1 kept. The refuter tried four ways to break it, and none held.
  - **Is the output really wrong?** Yes. The refuter wrote its own G-code walker and its own disk-against-rectangle check, without the repo's clearance support or any planner model. It ran `emitGcode` with B as two separate objects (Duplicate without moving), not one path listed twice. Results:
    - Gap 2.5: the lead `G0 X38.413 Y383.175` is kept, and the disk reaches 0.675 mm into B inset by r at `G1 Z-1.500` (the lead repeats at Z-3). Issues `[]`.
    - Gap 3.0: 0.175 mm. Gap 3.5: clear.
    - The same numbers with the copy reversed and starting at another vertex.
    - With three copies, the even-odd count is odd, so the wall comes back. The lead is then dropped and `cnc-profile-lead-plunge` is reported. That pins the cause on the even-odd normalisation at `profile-lead-kept-walls.ts:90`.
  - **Does a warning reach the operator?** No. The refuter ran the real Start path (`prepareCurrentStartJob`) and the real Job Review model (`buildJobReviewModel`, the `cnc-omission-review` fixture), with B 2.5 mm from A on each of the four sides. With one copy on the lead's side, Job Review shows "1 pass plunges straight down … a lead-in there would cut into a part next to it". With two copies, the lead is kept at `G0 X118.413 Y96.825`, 0.675 mm inside B's line, and that line disappears. No line takes its place:
    - `stackedCopyWarnings` returns `[]` for CNC (`stacked-copy-warnings.ts:37`).
    - `cnc-stacked-copies-merged` covers only the filled cut types.
    - The narrow-feature check works per operation and keeps one copy.
  - **The second effect (Not verified below) is now measured, and it is worse.** A runs a 1/4" bit and the On path B a 1/8" bit, with two copies of B:
    - Gap 5 mm: A's arc lead (`G0 X36.825 Y386.350`, then `G1 Z-1.500`) reaches 2.94 mm into B's kept material. Issues `[]`. With one copy, the lead is dropped and Job Review says so.
    - Gap 4 mm: A's own profile also reaches 0.76 mm into B. One copy names this (`cnc-profile-cuts-kept-part`); two copies drop that line too.
  - **Reach.** On path is the default CNC cut type (`machine.ts:332`, ADR-256). Under METHOD §3, reach could not lower this finding anyway.
  - **Novelty.** Nothing in `docs/audits/` names the On path even-odd wall:
    - meta M7-P2-2 covers the uncut filled pair;
    - rolling-v2 09-P1-1 covers the missing walls;
    - CNC v1 F3 does not mention it.
  - **Open PRs.** `gh pr list --state open` returns none. `profile-lead-kept-walls.ts` is unchanged on `origin/main` @ `a59f74ff9`.
  - **Attribution.** On path cut a stacked copy twice before #1450 too: ADR-359 Amd 3 Context table, measured on `adf300522`. So the gap came in with ADR-250 Amd 3 (#1343), which normalises On path walls even-odd although the On path cut does not. #1450 only claims that lead walls see one copy, and that claim holds only for filled cuts.
- **Fix direction:** Build each operation's kept walls from the outlines its cut actually follows. For On path (and the other non-merged cut types, if they ever become walls), drop exact stacked copies before the even-odd normalisation, as `StackedOutlines` does for the narrow-feature check. Add the two-copy On path neighbour to `emit-gcode-cnc-lead-kept-parts.test.ts`.

### G5-P3-1 — With a finish allowance, the cross-operation kept-part warning blames part spacing for a gap the bit can pass through
- **Where:**
  - `src/core/preflight/cnc-profile-part-issues.ts:72-73`, the fixed sentence "The parts sit closer together than the bit can pass between. Move them further apart."
  - The cause is the roughing ring: `src/core/cnc/finish-allowance.ts:29` and `src/core/cnc/compile-cnc-layer-passes.ts:110`. Roughing is offset by the bit radius plus the allowance.
- **Anchor:**
  - **Twin.** The warning's text against the measured cause. The reach is computed from every profile toolpath, the roughing ring included (`cnc-kept-part-cuts.ts`, `distinctToolpaths`). The text, however, names spacing narrower than the bit.
  - **Contract.** ADR-433 Amd 3 Decision 2 words this warning for parts "closer together than the bit can pass between". ADR-140 Amd 2 does not mention that a separate operation's roughing ring moves outward by the allowance.
- **Scenario:**
  - Two 40 × 30 mm parts on two Outside operations, 3.6 mm apart. 1/8" (3.175 mm) bit, 6.35 mm deep, default tabs, 0.5 mm finish allowance on both.
  - Each roughing ring runs 2.0875 mm off its own part, so its cut reaches 0.075 mm into the other part.
  - Job Review names it (correct and useful), but says the parts sit closer than the bit can pass between. They are 0.425 mm wider apart than the bit.
  - The operator who measures the gap sees a warning that looks wrong. The cheaper fix, a smaller allowance (any allowance up to 0.42 mm clears here: the reach is the allowance less 0.425 mm), is not named.
  - Without the allowance nothing is reported, and nothing is cut.
- **Evidence:** REPRO. A temporary Vitest file compiled the scene with `compileCncJob`.
  - With the 0.5 mm allowance, `keptPartCuts` held `depthMm` 0.0755 (L0 into L1) and 0.0745 (L1 into L0).
  - With no allowance, `keptPartCuts` was `[]`.
  - `loosePiecesMm2` reported no loose piece in either case.
- **Refuter:** CONFIRMED, P3 kept.
  - **What would refute it:** a branch for the allowance in the text, or a second Job Review line that names the cause.
    - The text is fixed (`cnc-profile-part-issues.ts:72-73`).
    - The finish-allowance advisory fires only from the bit radius up (`cnc-finish-allowance-warnings.ts:32`), so at 0.5 mm nothing names the allowance.
  - **REPRO through `emitGcode`:** 1/8" bit, 6.35 mm deep, default tabs, two Outside layers 3.6 mm apart.
    - Allowance 0.5 mm: two lines, "its 3.17 mm cut … cuts up to 0.08 / 0.07 mm into it … The parts sit closer together than the bit can pass between".
    - Allowance 0 mm or 0.42 mm: nothing.
    - Allowance 0.43 mm: 0.01 mm.
  - **Why P3 stays:** the cut, its depth and its position are reported correctly, and "move them further apart" does fix it. Only the stated cause is wrong.
- **Fix direction:** When the reaching toolpath is a finish-allowance roughing ring, or the gap exceeds the full-depth cut width, say that the finish allowance moves roughing outward and offer "reduce the allowance or move the parts apart".

### G5-P3-2 — Tile files give kept-part positions in whole-job machine coordinates, but each tile program is translated to its own origin
- **Where:**
  - `src/ui/app/tile-emission.ts:90` calls `runCncPreflight(project, machine, body, { compiledJob })` with no `coordinateMode` or `motionOffset`.
  - So `src/core/preflight/cnc-preflight.ts:87-89` sets `showPositions` true for every tile bit file.
  - `src/core/cnc/tile-plan.ts:1-8` translates each tile so that "the tile's min corner sits at the program origin".
- **Anchor:** **Contract.** ADR-433 Amd 3 Decision 2: "The position is given only when the program runs where it was compiled (machine coordinates, no motion offset)."
- **Scenario:**
  - Take a tiled CNC job whose parts on two profile operations sit closer than the bit.
  - Save tiles. The tile advisories carry "… cuts up to 0.67 mm into it at X 50 · Y 347.5 mm".
  - Those are whole-job coordinates. They are not where that spot lies in the tile file the operator runs from the tile's own zero.
  - The Start path suppresses the position for a relative-origin job. The tile path does not.
- **Evidence:** READ by the auditor (call site and `showPositions` rule above); REPRO by the refuter (below).
- **Refuter:** CONFIRMED by REPRO, P3 kept.
  - **What would refute it:** tile emission passing a coordinate mode, the sidecar positions being per tile, or tiles not being translated. None of these holds:
    - `emitTileFiles` (`tiled-output-preparation.ts:56`) passes the whole prepared Job.
    - `translatePass` (`tile-plan.ts:329-344`) subtracts `tile.rect.min`.
    - `emitGcode`'s twin (`emit-gcode.ts:261-265`) passes `relative-origin` for a Job Origin run.
  - **REPRO:** `prepareOutput` → `finalizeTiledOutput`, with two Outside layers 2.5 mm apart on 60 × 100 mm tiles.
    - Both tile files span X 0–60, Y 0–34.8.
    - The emission advisories say "… cuts up to 0.68 mm into it at X 62.5 · Y 380 mm" and "… at X 60 · Y 365 mm".
    - No tile file has a Y anywhere near 380.
  - **Why P3 stays:** the position is wrong only in advisory text. The cut itself is named correctly.
- **Fix direction:** Pass `coordinateMode: 'relative-origin'`, or the tile's motion offset, from `emitTileFiles` to `runCncPreflight`. Alternatively, translate the reported position into the tile's frame.

## KNOWN (not raised again)

- **G1-P3-1 (EMITTER_REVISION not advanced).** Three CNC-output merges in this area add to G1-P3-1's list. None mentions the revision in its ADR, and `gcode-metadata.ts:30-31` says to bump it "when the emitter's G-code-shaping behavior changes".
  - #1418 (ADR-665): the tapered plug is replanned as a start-depth V-carve.
  - #1420 (ADR-580 Amd 1): side reliefs are refit after a stock edit.
  - #1450 (ADR-359 Amd 3): a stacked closed shape that emitted no motion is now cut.
  - On main, the revision stayed `…-v29` across `9bca4a051` (#1450) and moved to v30 only with the laser #1440 at `0ea15b103`.
  - **Refuter:** CONFIRMED, KNOWN.
    - `git show <merge>^1` and `<merge>` give the same `EMITTER_REVISION` for each merge: `…-v25` across `3865d4423` (#1418) and `8acc4599c` (#1420), and `…-v29` across `9bca4a051` (#1450).
    - `gcode-metadata.ts` is untouched in each merge.
    - ADR-665, ADR-580 Amd 1, ADR-575 Amd 1 and ADR-359 Amd 3 do not mention the revision.
    - G1-P3-1 lists only laser merges, so this extends it and is not a new finding.
- **F8-P2-1** (single-file setup package with M0 bit changes, `src/io/cnc/cnc-setup-package.ts:28` and `:97` at the audited tree). Fixed by #1453 after the audited tree; not re-checked.

## Refuted

- **The ADR-433 Amd 3 check never names a cut into an On path part when both use the same bit**, because `reach = r − clearedMm − 0.005 ≤ 0` in `cnc-kept-part-cuts.ts`. Refuted as a missing warning:
  - In that geometry the On path cut always reaches the other part first, and is named.
  - REPRO, one copy, gaps 0.5, 1 and 1.5 mm: "its 3.17 mm cut … cuts up to 1.09 / 0.59 / 0.09 mm into it", each with "Move them further apart".
  - The lead that also enters B when A's toolpath starts inside B's ring (gap < r) is covered by the same warning.
- **The relief overlap warning (#1452, ADR-412 Amd 2 item 3) fires between a two-sided split's side A and side B.** Refuted:
  - `overlappingReliefWarnings` reads the project passed to `detectMachineJobWarnings`.
  - Every caller passes `prepared.project`, which `prepareOutput` has reduced to the active side (`prepare-output.ts:165,172`; `cnc-two-sided-setup.ts:19-27`; `start-job-readiness.ts:362`; `tiled-output-preparation.ts:68`; `output-preparation.ts:68,122`).
- **#1452's outside-stock law changes two-sided side programs at the map edge.** Refuted: each side mesh already carries a 1 mm frame at its stock face inside the map (`relief-two-sided-split.ts:28,86`). A cutter near the edge was already held at the stock top by the frame.
- **Island adaptive (#1421) combined with rest machining.** No combined path exists:
  - Legacy Rough first is not planned for an adaptive layer (`cnc-rest-operation.ts:59`).
  - Previous-stock rest takes ADR-153 Amd 1's disclosed full-pocket fallback (Decision 3).
- **At the bit radius (ADR-140 Amd 2 item 4), the stepped finishing ladder lacks the tab-top level that `depthsWithTabTopPass` (#1423) adds to roughing.** Refuted as a hold defect: the flood-fill checker finds nothing loose (see Verified clean).
- **The Design Studio instant carve tier disagrees with the compile for stacked copies and joined outlines.** Not raised:
  - ADR-272 Amd 1 clause 4 labels the instant tier as the target surface.
  - Its SIMULATE tier compiles through the real `compileCncJob`, so it follows #1450 and #1451.

## Verified clean

- **Conflict resolutions kept both sides.**
  - `a176fa7f8`:
    - `buildCncCompilationSidecar` takes both `mergedStackedCopies` (#1450) and `profileEvidence` (`profileOpenPaths`, `keptPartCuts`, #1451).
    - `collect-cnc-contours.ts` joins (ADR-672) and then merges copies (ADR-359 Amd 3).
    - `compile-cnc-job.ts` and `compile-cnc-operation-result.ts` carry all three.
    - `cnc-retained-compilation-sidecar.ts` keeps all three for derived recovery jobs.
  - `CollectedCncContour` keeps both `joinedOutline` and `stackedCopies`.
  - Every `EMITTER_REVISION` conflict (`2f3ce9d69`, `44a8508cb`, `ce1b4f11d`, `f5fbce13a`, `adc739125`, `f8327d768`) kept every earlier comment line and took the higher revision (v26 → v32). No code hunk of the 10-23 merges conflicted in these paths.
- **#1444 (merged without CI).**
  - Its five test files pass on the audited tree: 34 tests in `cnc-tool-reach.test.ts` + `cnc-group-maximum-depth.test.ts`; 11 in `cnc-program-reach.test.ts` + `cnc-program-reach-compiled-depth.test.ts`; 2 in `job-review-cnc-reach.test.ts`.
  - #1452's head contains #1444. Its CI ran typecheck and lint and all four unit shards, all green (`gh pr view 1452`).
  - The gate holds:
    - The review opens only on fixtures or on the job's own bits with reach data (`cnc-program-reach.ts`).
    - `cncToolSectionMaximumDepthsMm` groups sections exactly as `cncToolPlan` does.
    - Job Review, Save and separate-tool export all pass compiled depths.
- **Finish allowance (#1416) with tabs and default arc leads.** The emitted G-code was judged by `loosePiecesMm2`, which flood-fills from the sheet border, with the 1/8" bit, 6.35 mm deep, and 4 × 6 mm tabs 2 mm high. Nothing came loose in these cases:
  - allowance 4 mm, cut as the radius, with one part and with pairs 3.6 mm and 5.2 mm apart;
  - 0.5 mm with a 10° ramp entry, pair 3.6 mm apart;
  - 0.5 mm with an exact stacked copy of one part (merged, noted);
  - 0.5 mm with a Wall finishing recipe (3 mm per pass);
  - 0.5 mm with a part inside a plate;
  - two operations 3.6 mm apart, with and without the allowance.
  - **Refuter spot check: holds.** The refuter re-ran it through `emitGcode` and `loosePiecesMm2` with a 0.1 mm cell, 1/8" bit, 6.35 mm deep and default tabs. No loose piece in any of these:
    - allowance 4 mm, one part;
    - 0.5 mm, pair 3.6 mm apart on one operation;
    - 0.5 mm with a stacked copy (merged, noted);
    - 0.5 mm with a 10° ramp.
  - The tabs-off control comes out as a 1,186 mm² loose piece, so the checker does catch a freed part.
- **V-carve corners (#1422) with the tapered inlay (#1418).**
  - `measureInlayPairFit` on the ADR-665 test design gives these figures:

    | Bit | Pocket shortfall at contact | Emitted interference at the designed seat |
    | --- | --- | --- |
    | 60° | 0.0030 mm | 0.0099 mm |
    | 90° | 0.0017 mm | 0.0082 mm |

  - So the inlay pocket now gets the round-join core. The comment in `tapered-inlay-fit.test.ts`, "about 0.07 mm here", is stale.
  - The emitted bound there is relative to the shortfall, but the medial floor it depends on is pinned by ADR-285 Amd 1's own tests.
- **The cross-operation check (#1451) against the finish allowance (#1416).** The outward roughing gouge into a neighbouring operation's part is reported (0.075 mm). Only its wording is wrong (G5-P3-1).
- **One shared contour pool.** Compile, the compilation artifact, the lead walls, the min-feature targets, the diagnostics and every `collectLayerPolylines` caller read `collectLayerContours`. That covers the inlay, rest, helical, adaptive and V-carve issue checks, `cnc-tool-geometry` and the layer notes. So the ADR-672 join and the ADR-359 Amd 3 merge hold on every sibling for the filled cut types.
- **Sibling output paths share `prepareOutput` and `compileCncJob`.** Start, Save, the setup package (single file and per bit), tile files, Frame, the estimate and the Inspector all go through them. So the two-sided refit (#1420), the adaptive strips (#1421), the floor corners (#1422) and the relief footprint (#1452) reach each of them. Tile bit files run preflight per file against the whole compiled sidecar.
- **The finish-allowance Job Review warning** uses the same full-depth cut width and stage depth per pass as compile (`cnc-finish-allowance-warnings.ts`).

## Not verified

- **No hardware, air cut or material.**
- **No independent two-sided or relief compile run** after #1452. That rests on reading, and on ADR-580 Amd 1's emitted-program tests passing in #1452's CI.
- **The island adaptive emitted programs were not re-run** (heavy verifier). #1421's own independent height-field tests passed in #1452's CI.
- **The second effect of G5-P1-1 was not measured by the auditor.** A larger bit on the other operation would give a positive reach against the missing On path wall, so a real cross-operation gouge would go unnamed.
  - The refuter measured it; see G5-P1-1's Refuter line. With a 1/4" bit on A and two copies of the On path B:
    - the lead reaches 2.94 mm into B at a 5 mm gap;
    - A's own profile reaches 0.76 mm into B at a 4 mm gap.
  - Neither is reported.
- **A near-closed open outline over its own closed copy was not measured.** The ADR-672 join adds the gap vertex, so the two rings are not exact copies and still cancel even-odd. ADR-359 Amd 3 lists near copies as a follow-up.
- **#1453, #1454 and #1455** (newer than `9a2bf6b13`).
- **Whole-project typecheck** (not allowed here; covered by #1452's CI).

```json
[
  {"id":"G5-P1-1","severity":"P1","area":"cnc-delta","file":"src/core/cnc/profile-lead-kept-walls.ts","line":90,"anchor":"Contract: ADR-250 Amd 3 Decision 1 (On path walls are obstacles, normalised as the offset normalises them) + ADR-359 Amd 3 Decision 3 (On path keeps copies as a spring pass); Twin: min-feature stacked-outlines.ts keeps one copy","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"An exact stacked copy on an On path operation cancels that part's kept wall even-odd; a neighbouring operation's arc lead then plunges 0.675 mm (gap 2.5 mm, 1/8in bit) into the On path part at Z-1.5 and Z-3 with no preflight or Job Review notice, where one copy drops the lead and says so","refuter":"Own G-code walker + disk/rectangle check via emitGcode, B as two objects: 0.675 mm at gap 2.5, 0.175 at 3.0, clear at 3.5, same with a reversed copy; three copies (odd) restore the wall and the lead-plunge note; real prepareCurrentStartJob + buildJobReviewModel: the lead-plunge line vanishes with two copies and nothing replaces it; second effect measured: 1/4in A lead 2.94 mm into B at gap 5, A's profile 0.76 mm at gap 4 with the cnc-profile-cuts-kept-part line gone; On path is the default cut type; no prior audit or open PR; gap predates #1450 (ADR-250 Amd 3 even-odd On path walls); P1 kept"},
  {"id":"G5-P3-1","severity":"P3","area":"cnc-delta","file":"src/core/preflight/cnc-profile-part-issues.ts","line":72,"anchor":"Twin: warning text vs measured cause (finish-allowance roughing ring, finish-allowance.ts:29); Contract: ADR-433 Amd 3 Decision 2 wording","evidence":"REPRO","verdict":"CONFIRMED","known":false,"refuter":"emitGcode, two Outside layers 3.6 mm apart, 1/8in, 6.35 mm, tabs: allowance 0.5 gives 0.08/0.07 mm lines saying the parts sit closer than the bit can pass between; 0 and 0.42 give none, 0.43 gives 0.01; the finish-allowance advisory fires only from the radius up; P3 kept (cut, depth and position are right, only the cause is wrong)","summary":"With a 0.5 mm finish allowance, two Outside operations 3.6 mm apart under a 3.175 mm bit are reported as cutting 0.075 mm into each other because the parts sit closer than the bit can pass between; the cause is the allowance's outward roughing ring, and reducing the allowance is not offered"},
  {"id":"G5-P3-2","severity":"P3","area":"cnc-delta","file":"src/ui/app/tile-emission.ts","line":90,"anchor":"Contract: ADR-433 Amd 3 Decision 2 (positions only when the program runs where it was compiled)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"refuter":"prepareOutput + finalizeTiledOutput, two Outside layers 2.5 mm apart on 60x100 tiles: tile files span X 0-60, Y 0-34.8, emission advisories say 'at X 62.5 · Y 380 mm' and 'at X 60 · Y 365 mm'; translatePass subtracts tile.rect.min; emitGcode's twin passes relative-origin; P3 kept (advisory text only)","summary":"Tile bit files run CNC preflight without a coordinate mode or motion offset, so kept-part warnings print whole-job machine positions for programs translated to each tile's origin"},
  {"id":"G5-K-1","severity":"P3","area":"cnc-delta","file":"src/io/gcode/gcode-metadata.ts","line":157,"anchor":"Contract: gcode-metadata.ts:30-31 bump rule (as G1-P3-1)","evidence":"READ","verdict":"CONFIRMED","known":true,"refuter":"EMITTER_REVISION identical on both parents of 3865d4423 (#1418), 8acc4599c (#1420), 9bca4a051 (#1450); none of their ADRs mentions the revision; G1-P3-1 lists laser merges only","summary":"KNOWN G1-P3-1, extended: #1418 (ADR-665), #1420 (ADR-580 Amd 1) and #1450 (ADR-359 Amd 3) changed CNC output without advancing EMITTER_REVISION"}
]
```
