# T35 Close Path — refuter report
Tree: origin/main @ eeac725e8 (`C:\Users\stolk\kd-t1\t31-main`, includes #1902 / ADR-486 Amendment 4). Command id: `tools.close-paths`.
Scratch: `C:\Users\stolk\kd-t1\zz-t35r` (own scripts and own G-code decoder `gdec.ts`; the auditor's `zz-t35` was read, not run). Memory was 1.96–2.11 GB free before each Vitest run; every run used `--maxWorkers=1` and one file.

## Verdicts

| Claim | Verdict | Grade |
|---|---|---|
| T35-P2-1 Closing line over the path's own stroke loses that stroke at any kerf, silently | **CONFIRMED** (own geometry, own decoder; scope wider than reported) | **P2 kept** (not P1, not P3) |
| T35-P3-1 No gap limit vs LightBurn 0.5 mm; info toast only | CONFIRMED (read: ADR-480 §6 and its addendum keep "unrestricted gap behavior"; `toast()` always `'info'`, `path-cleanup-actions.ts:298-300`) | P3 (maintainer decision) |
| T35-P3-2 Toast does not say a closed path now fills / kerf-offsets (T07-P3-1 pattern) | CONFIRMED; link is a pattern match, not the same defect (T07 is the Fill repair changing Line; here Close Path changes Fill) | P3 |
| T35-P3-3 Menu enabled for a Boolean compound, then "no open paths" (READ ONLY) | CONFIRMED by reading: `design-tools-command-context.ts:82-92` checks kind and lock only; `isPathEditable` (`path-cleanup-actions.ts:139-145`) also excludes `isBooleanCompoundObject`; the compound then lands in `skippedOpenObjects` and is described as "Text and drawn shapes" | P3 |
| T35-P3-4 Ends within float noise get a zero-length seam segment | CONFIRMED by reading: `closePolyline` uses `point-math.ts:19-21` `samePoint` (exact `===`) while the same file's private `samePoint` allows 1e-9 | P3 |
| T35-P3-5 Test gap for partly retraced closures | CONFIRMED (the ADR-486 Amd 4 test list covers only whole out-and-back paths) | P3 |
| Known link: locked objects skipped silently = T10-P3-1 | CONFIRMED: `editableSelection` drops `locked === true` (`:154`); `skippedOpenObjects` (`:237-246`) counts only non-editable kinds, so a locked imported path is never mentioned. Same pattern as LEDGER T10-P3-1 (Close Paths with Tolerance) | known |
| Known link: T35-P3-2 = T07-P3-1 | Pattern-related (LEDGER row 141: "Closing a Fill contour also changes the Line cut … without saying so") | known pattern |

## Evidence: T35-P2-1

### Own repro (`zz-t35r/r1-close-kerf.test.ts`, log `r1.log`)
Own shapes (not the auditor's), placed at (100, 100), Line operation "Cut", `closeOpenPaths` called directly and cross-checked against the store action (`store==core true` for every case). Lit G1 length decoded by `gdec.ts` (laser on, S > 0, G1 only).

| Shape (scene mm) | `retracesItself` | Kerf 0 open → closed | Kerf +0.1 | Kerf −0.1 | Kerf +0.001 | Diagnostics / advisories | Toast |
|---|---|---|---|---|---|---|---|
| "P": (0,0)→(0,50)→(25,50)→(25,25)→(0,25); closing line runs down the lower 25 mm of stem | false | 125 → 150 | 125 → **100.800** | 125 → **99.200** | 125 → 100.008 | `[]` / `[]` | info "Closed 1 path. The widest gap closed was 25 mm." |
| "b": (0,60)→(0,0)→(20,0)→(20,30)→(0,30); closing line runs up the upper 30 mm of stem | false | 130 → 160 | 130 → **100.800** | 130 → **99.200** | 130 → 100.008 | `[]` / `[]` | "…widest gap closed was 30 mm." |
| Lollipop: 40 mm stick, 20 × 20 loop, stick back; ends coincide | false | 160 → 160 | 160 → **80.800** | 160 → **79.200** | 160 → 80.008 | `[]` / `[]` | "Closed 1 path." (no gap figure) |

Decoded closed-ring segments at +0.1 for "P": `(99.900,275.100)->(125.100,275.100)->(125.100,249.900)->(99.900,249.900)->(99.900,275.100)` (machine Y = 400 − scene Y): only the bowl box 25 × 25 ± 0.1. Machine Y 275..300, the lower stem (scene y 0..25), has no lit move. The lollipop's segments are only the loop box x 139.9..160.1; both sticks (80 mm of drawn stroke; the auditor's 60 mm figure is for a 30 mm stick) are absent. Even a 0.001 mm kerf loses them.

Oracle: by hand. The closed ring's even-odd region is only the box; the retraced stem has winding 0 on both sides, so it has no boundary after normalisation. Ring outline = 4 × 25.2 = 100.8 (P) and 4 × 20.2 = 80.8 (b, lollipop), matching the decoded figures exactly.

A note on the auditor's "expected ≈120 mm": a kerf-offset stick-with-loop has no defined "right" outline, so the cleaner statement is: a stem the user drew once, and that burned once before Close Path, burns zero times after it.

### Scope is wider than exact retraces (own repro, same log)
"P" whose end misses the stem by 0.05 mm (`Pnear`): `retracesItself` false, closes. Kerf +0.1 burns 150.750 (the sliver grows into a thin ring, nothing lost). Kerf **−0.1 burns 99.200**: the 25 mm lower stem (now a 0.05 mm sliver) collapses on the shrinking side, again with `diag []`, `adv []`. Amendment 1's closed-up count reads whole rings only, so a partly collapsed ring is not named either. On the bundled EMS Casual Hand "P" (`r4.log`), Close Path then kerf −0.1 burns 28.550 against 54.215 at kerf 0 (diagnostics not logged for that run). An end that lands *near* the stem is more common in hand-drawn art than one that lands exactly on it, so the fix must cover slivers narrower than the kerf, not just exact overlap. See T35R-P2-2.

### Q1 — What ADR-486 Amendment 4 says
- Decision 4: Close Path and Close Paths with Tolerance "skip them", where "them" means a contour that "encloses no area" (decision 1: the kerf's even-odd normalisation returns nothing).
- Limits, first bullet, verbatim: "A contour that encloses area only in part keeps that part, and the rest is dropped without a count. An example is a retraced stick with a loop at its end."
- So the ADR **knows and accepts the kerf-stage limit**. It does **not** promise a warning or a follow-up, and it does **not** say Close Path guards against partial cases. It is silent on the fact that Close Path (and DXF import, see T35R-P2-1) *manufactures* that ring from an open stroke that burned in full. The Context section's own harm argument ("the tools that did it" turned a burning stroke into a ring the kerf drops) applies to the partial case unchanged. The accepted limit is about the kerf stage's reporting, not a decision that Close Path may create such rings. That is why this is not a P3 "accepted limit".

### Q2 — Why `kerf-offset-no-area` does not fire
`layer-kerf.ts:246-253` counts `noArea` per **whole ring** through `closedContourEnclosesNoArea(ring.points)`. In `zero-area-contour.ts` that function returns `false` at once when `|area| > perimeter × 0.001`. For the "P" ring: area 625 mm², perimeter 150 mm, threshold 0.15 mm², so it never reaches the boolean engine. The ring as a whole encloses area, so it is not counted. The retraced part vanishes inside `offsetOrNull` (the even-odd read), and nothing compares the offset result with the ring's own length. Confirmed: yes, the ring has non-zero area overall, and only the retraced part collapses.

### Q3 — Does Close Path still avoid the pure out-and-back case?
Yes. Own cases in `r1.log`, all `retracesItself true`, `closed 0`, toast "1 path runs back over itself, so it stays open: …", burn unchanged at kerf 0, ±0.1 and 0.001:
- out-and-back with coincident ends (0,0)→(30,0)→(0,0): 60.000 mm;
- collinear partial retrace (0,0)→(30,0)→(10,0): 50.000 mm;
- out-and-back with a 5 mm spur folded back at the far end: 70.000 mm.
It fails only when the ring has some area (P, b, lollipop, spur, hook).

### Q4 — How ordinary is the input?
- **DXF import.** An unflagged LWPOLYLINE lollipop (ends meet) is closed **by the importer itself** (`r3.log`: 1 polyline, closed true). It then loses 80 of 160 mm at kerf +0.1 with no diagnostic, before the user touches Close Path (T35R-P2-1). A "P"-shaped LWPOLYLINE imports open (125 mm burns at any kerf) and needs Close Path to be hit.
- **Single-line fonts** (after Convert to Path; Close Path refuses live text). `r2.log`: at 20 mm, subpaths that Close Path closes and whose closed ring loses more than 0.3 mm of stroke to even-odd cancellation:
  - Relief SingleLine: 2 of 64 ("P", "R");
  - EMS Nixish: 41 of 70 (almost every letter, because it retraces its own strokes);
  - EMS Decorous Script: 4 of 70;
  - EMS Casual Hand: 0 of 70 by exact overlap, but it is hit by the shrinking-side sliver case.
  The pipeline (`r4.log`, open k0.1 → Close Path → closed k+0.1): Relief "P" 32.862 → 27.258, Relief "R" 39.429 → 33.265, Nixish "H" 75.048 → 45.030 (−0.1: 30.420), Nixish "T" 43.970 → 36.558.
- **Kerf on these layers.** Kerf Offset is a cut-out setting. Single-line text or sketch strokes on a non-zero-kerf Line layer is an uncommon but legitimate combination, for example a cut layer that holds both a part outline and a hand-drawn shape the user closes to cut it out.
- **Mitigation (READ).** The Preview draws the compiled job (`ui/workspace/preview-*.tsx`), so a user who checks Preview can see the missing stroke. The canvas still shows it.

### Q5 — Grade
**P2 stays.**
- **Not P3.** The loss is reproduced on real G-code, nothing in the toast, compile diagnostics or Job Review advisories names it, and the ADR accepts only the kerf stage's counting gap, not Close Path creating the ring. AREAS.md lists "a missing warning" as P2 at least.
- **Not P1.**
  1. It needs three things together: a non-zero Kerf Offset on the Line operation, a stroke whose closing segment overlaps (or lands within the kerf of) its own stroke, and the user choosing Close Path (or a DXF lollipop).
  2. The ledger precedent for the same mechanism is P2. T30R-P2-1 is a doubled LINE that burns 0.000 mm on the growing side with no Job Review warning, graded P2. T30-P1-2 was re-graded P2 by its refuter.
  3. The Preview shows the result.
  4. LightBurn would close the lollipop too (gap 0 is inside its 0.5 mm limit), and its kerf has no defined output for a dangling stick. The defect is the missing guard or warning, not a miscomputed offset.

## Extra findings

### T35R-P2-1: DXF import closes a partly retraced LWPOLYLINE (lollipop) by itself, and kerf then drops the stick silently
- **Severity P2:** a silent wrong burn with no tool action at all. Same mechanism and same grade as T35-P2-1 and T30R-P2-1.
- **Where:** `src/io/dxf/dxf-entities.ts`, the "ends meet" rule. ADR-486 Amd 4 decision 3 skips only rings that enclose **no** area, through the same `closedContourEnclosesNoArea` test.
- **Repro:** `zz-t35r/r3-dxf.test.ts`, `r3.log`. LWPOLYLINE flag 70 = 0, points (0,0) (40,0) (40,−10) (60,−10) (60,10) (40,10) (40,0) (0,0) imports as 1 closed polyline. Kerf 0: 160.000 mm. **Kerf +0.1: 80.800 mm**, `diag []`, `adv []`.
- **Oracle:** the even-odd region is the 20 × 20 loop only; 4 × 20.2 = 80.8. The 40 mm stick, drawn twice (80 mm), is absent.
- **Fix:** use the same "would part of the ring vanish" predicate proposed for T35-P2-1 in the DXF ends-meet rule. Fix in the same session.

### T35R-P2-2: A closing line that lands within the kerf of the stroke (not on it) loses that stroke on the shrinking side, silently
- **Severity P2:** a silent wrong burn. It is more common than the exact-overlap case in hand-drawn art. The current guard cannot see it, and a fix aimed only at exact overlap would miss it.
- **Where:** `path-direction-edits.ts:64-67` (closes it); `layer-kerf.ts:246-277` (`closedUp` counts only rings whose whole offset is empty; `noArea` only whole zero-area rings).
- **Repro:** `r1.log` `Pnear`: the "P" end at (0.05, 25). Kerf −0.1: 124.950 → **99.200** mm, `diag []`, `adv []` (the 25 mm stem is gone). Kerf +0.1 is fine (150.750). Supporting: `r4.log`, EMS Casual Hand "P" at kerf −0.1 burns 28.550 against 54.215 at kerf 0.
- **Oracle:** the sliver triangle between the stem and the closing line is at most 0.05 mm wide, narrower than the 0.2 mm the −0.1 offset removes, so it collapses. Expected: either kept open, or warned.
- **Fix:** make the Close Path predicate (and the kerf stage's count) compare the kerf result's length with the ring's length, rather than test for zero area. Fold this into the T35-P2-1 fix.

### T35R-P3-1: At kerf 0 the closing line burns over the stroke it retraces, a second pass on that stretch, without a word
- **Repro:** `r1.log`. "P" 125 → 150 mm, "b" 130 → 160 mm: the 25 or 30 mm stem gets two passes, double energy on that stretch. The toast reports only the gap.
- **Grade P3:** it does what the user asked, and LightBurn's "new line between the points" does the same. Wording only. Suggest that the retraced note also covers "the closing line runs over N mm of the path".

## Totals
Verdicts: T35-P2-1 CONFIRMED P2 (scope wider: near-retrace slivers on the shrinking side, and DXF import makes the lollipop ring itself); T35-P3-1 CONFIRMED P3; T35-P3-2 CONFIRMED P3 (known pattern T07-P3-1); T35-P3-3 CONFIRMED P3 (READ ONLY); T35-P3-4 CONFIRMED P3; T35-P3-5 CONFIRMED P3; locked-silent = T10-P3-1 CONFIRMED known. Refuted 0, re-graded 0.
Extra raised: 3 (P1 0, P2 2: T35R-P2-1 DXF lollipop closed on import, T35R-P2-2 near-retrace sliver on the shrinking side; P3 1: T35R-P3-1 double pass at kerf 0).
