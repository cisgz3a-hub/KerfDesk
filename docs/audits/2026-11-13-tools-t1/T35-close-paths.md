# T35 Close Path — auditor report
Tree: origin/main @ eeac725e8. Command id: `tools.close-paths`.

"Close Paths with Tolerance" is a separate command (`tools.close-paths-with-tolerance`, dialog `ClosePathsToleranceDialog.tsx`). It was audited as T10 and is ledgered there (T10-P2-1/2 fixed by #1851, T10-P3-1..3). This report covers it only where it shares Close Path's code: the retraced-path predicate and the toast.

## Map
- Menu: Tools → Vector → Close Path. `src/ui/commands/design-tools-commands.ts:76-82` calls `pathCommand`. It is enabled when `canEditSelectedPaths` is true (`design-tools-command-context.ts:82-92`: an unlocked imported-svg, traced-image or polyline shape is selected). The tooltip is in `src/ui/help/design-tools-command-help.ts:31-35`.
- Store: `closeSelectedPaths` in `src/ui/state/path-cleanup-actions.ts:49-66`.
  - `editSelectedPaths` works on the unlocked `isPathEditable` objects. Boolean compounds, text and drawn rectangles, ellipses and polygons are excluded.
  - The whole action is one `pushUndo`. It clears the node selection.
  - Polyline shapes sync `spec.closed` through `synchronizePolylineShapeGeometry`.
  - Toast: `closeMessage` reports the count and the widest gap, plus `retracedPathsNote` (`retraced-paths-note.ts`).
- Core: `closeOpenPaths` in `src/core/geometry/path-direction-edits.ts:69-102`.
  - Each closeable subpath of 3 or more points gets a straight closing segment.
  - The polyline repeats its first point unless its ends are exactly equal. The curve gets a `line` segment to its start.
  - It skips a subpath when `retracesItself` (`:54-60`, through `zero-area-contour.ts`) finds that the closed ring would enclose no area. That is ADR-486 Amendment 4.
  - The gap is measured in world mm through the object's transform.
- Governing decisions: ADR-480 §6 (LBG-F08), ADR-486 Amendment 4 (#1902, commit 8b60d6daa), ADR-494 Amendment 1 (tab anchors on reversed or closed contours), and WORKFLOW section F-A6e.
- Changes since 2026-10-16 on these files: 8b60d6daa (retraced paths stay open, ADR-486 Amd 4) and ab3226fd1 (shared helpers, C2-P3-1).
- LightBurn: the Close Path reference (docs.lightburnsoftware.com/latest/Reference/ClosePath/, read 2026-11-14) says:
  - it closes a shape that is connected except at its start and end nodes, "by creating a new line between the points";
  - the start and end nodes must be within **0.5 mm** of each other;
  - for wider gaps, use Close Selected Paths with Tolerance.

## October register re-check
Row 42 (`close-paths`) recorded: open 3-point L → "Closed 1, gap 72.216 mm", and an exact Undo. It is still fixed.
- S1: an open box closes with a 30 mm line. The toast says "The widest gap closed was 30 mm." Undo restores the scene exactly (JSON equal), Redo repeats it exactly, and save then reopen keeps the closed 5-point ring.
- S10a: a 3-point drawn polyline closes. `spec.closed` becomes true and the gap reads 28.284 mm (oracle √800).

## Checks run
| Check | Method | Result |
|---|---|---|
| Straight closing segment, G-code delta | `zz-t35/t35-burn.test.ts` S1, decoded lit length | +30.000 mm (oracle 30.000). The closed ring burns 140.000 mm |
| Non-uniform scale 3 × 0.5 plus 30° rotation | S2 | Toast gap 5 mm (oracle 10 × 0.5 = 5). G-code +5.000 |
| Out-and-back path (#1902) | S3, kerf 0.1 | Stays open. The toast explains why. 100 mm burns before and after |
| Kerf names a whole zero-area contour | `src/ui/state/retraced-paths-kerf.test.ts` (repo suite) | Passes (54/54 across 3 Close Path suites) |
| Closing line that runs back over part of the stroke (spur, hook) | `t35-spur.test.ts`, kerf ±0.1, `compileJob` diagnostics and `prepareOutput` advisories | **Art lost silently, see T35-P2-1** |
| Lollipop (stick, loop, stick back; ends already meet) | `t35-spur.test.ts`, kerf ±0.1 | **60 mm of stick lost silently, see T35-P2-1** |
| Hook at kerf 0 | `t35-curve.test.ts` C2 | The 20 mm stem burns twice (80→40, then 60→80) |
| Fill operation: open C becomes a hatched square | S6 | 0 mm → 4000 mm of hatch (200 rows at 0.1 mm over a 20 × 20 mm square). This is the intended effect. The toast says only "Closed 1 path." (T07-P3-1 pattern) |
| Far ends: a 190 mm closing line across the part | S7 | Closes. Info toast "widest gap closed was 190 mm". No warning variant |
| Exact cubic semicircle, r 20, scale 1 and 2 | `t35-curve.test.ts` C1 | The curve gets a `line` segment and the polyline closes with it. +40.000 / +80.000 mm (oracle the diameter) |
| Near-coincident ends (0, 1e-12, 1e-6, 1e-3 mm) | S8 | Exactly equal ends: the flag is set and no point is added. Otherwise a seam point is added, so the segment is 1e-12 mm long. The G-code delta is 0.000 mm for gaps up to 1e-6 |
| Locked object, mixed selection | S9a/b | Locked stays open. The free object closes. The toast does not mention the locked one |
| Degenerate input (NaN middle point, 2-point line, 1 point, empty, 3 equal points) | S9c, `closeOpenPaths` direct | No throw. Only the NaN-middle path closes (ends finite). 2-point, 1-point, empty and all-equal stay open |
| 400 objects × 50 points | S9d | 11.7 ms, one toast, one undo step |
| Variable text, variable barcode, jig guard (#1882/#1900) | read: `selectionHasEditablePaths`, `isPathEditable`, `objectVariableTemplate` | Close Path cannot reach text or barcode (`shape/barcode`) objects at all, so nothing is rebuilt and the guard is not needed. Jig artwork copies are edited in place like any node edit |
| Tabs (ADR-494) | read: `closingLineFraction` in `cnc-tab-anchors.ts:257-265`; `projectCncTabAnchor` places tabs only on closed contours | An anchor fraction on an open contour is already measured over the length including its closing line, so Close Path keeps tab positions. No anchors are rewritten on close |
| Repo suites | vitest `path-direction-edits`, `path-cleanup-actions`, `retraced-paths-kerf` | 54/54 pass |

## Findings

### T35-P2-1: A closing line that runs back over the path's own stroke loses that stroke from the burn at any kerf, with no warning
- **Severity: P2.** It is a wrong burn, and nothing on canvas, in the toast, in the compile diagnostics or in the Job Review advisories says so. It is limited to operations with a non-zero Kerf Offset and to strokes whose closing line lands on themselves. The geometry is ordinary: a hand-drawn or single-line "6", "9", "P" or "b", or a hook that ends on its own stem.
- **Where:**
  - `src/core/geometry/path-direction-edits.ts:64-67`. `closeableUnlessRetraced` skips only a ring that encloses **no** area (`retracesItself`, `:54-60`). A ring that encloses area **in part** is closed.
  - `src/ui/state/path-cleanup-actions.ts:49-66` then says "Closed 1 path."
  - `src/core/job/layer-kerf.ts` normalises the ring even-odd. The retraced part (the closing line, plus the original stroke under it) has no region and is dropped. `noArea` counts only whole rings.
- **Repro:** `C:\Users\stolk\kd-t1\zz-t35\t35-spur.test.ts`, log `t35-spur.log`. All cases are on a Line operation; the "before" figure is the open path's lit length and the "after" figure is the lit length after Close Path.

  | Case | Kerf | Before | After | Expected | Lost from the art the user drew |
  |---|---|---|---|---|---|
  | Hook (10,80)→(10,40)→(30,40)→(30,60)→(10,60): the closing line (10,60)→(10,80) runs back up the stem | +0.1 | 100.000 mm | 80.800 mm | ≈120 mm | The 20 mm stem tail (y 60..80) is gone from the G-code. `jobDiag []`, `advisories []`. Toast: "Closed 1 path. The widest gap closed was 20 mm." |
  | Hook | −0.1 | 100.000 mm | 79.200 mm | ≈120 mm | The same 20 mm stem tail, no diagnostics |
  | Spur (10,10)→(40,10)→(40,30)→(25,30)→(25,10) | +0.1 | 85.000 mm | 70.800 mm | | 15 mm of the bottom edge, x 10..25 |
  | Spur | −0.1 | 85.000 mm | 69.200 mm | | 15 mm of the bottom edge, x 10..25 |
  | Lollipop: 30 mm stick, 20 mm square, stick back; ends already meet | ±0.1 | 140 mm | 80.8 / 79.2 mm | | Both 30 mm sticks, 60 mm in all. Toast: "Closed 1 path." with no gap at all |

  - Same hook at kerf 0 (`t35-curve.test.ts` C2): 120 mm burns, and the stem segment y 60..80 is lit twice.
  - Control: the same spur contour imported already closed burns 70.800 mm, also with no diagnostic. The kerf stage is the same either way. What is new here is that **Close Path turns a fully burning open stroke into that ring**.
- **Oracle:** hand geometry, compared with the decoded lit G1 moves.
  - Before the close, the open stroke is not kerf-offset and burns its full drawn length.
  - The closed ring's even-odd region is only the square or loop part: the hook's 20 × 20 mm box, the spur's 15 × 20 mm box, the lollipop's 20 × 20 mm square. The offset outlines in the log are exactly those boxes ± 0.1 mm. Every stick or spur outside them is absent.
- **Known context:** ADR-486 Amendment 4 "Limits" already names the kerf behaviour: "A contour that encloses area only in part keeps that part, and the rest is dropped without a count", with the example of a retraced stick with a loop. It is not in any ledger. The new part is that Close Path manufactures this ring from an open stroke that burned in full, and then reports success.
- **Suggested fix:** two parts.
  1. Extend Close Path's predicate. Compare the closed ring's even-odd outline length (or its kerf result) with the ring's own length. Leave the path open and say so (as the retraced note does) when part of the ring would vanish; at least warn when the closing segment overlaps an existing segment.
  2. Have the kerf stage count partly-dropped length too.

  The 0.5 mm LightBurn limit (P3-1) would also stop the hook and spur cases, but not the lollipop.

### T35-P3-1: Close Path has no gap limit, unlike LightBurn's 0.5 mm; a 190 mm closing line gets only an info toast (parity, maintainer decision)
- **READ plus run:** S7. A V-path whose ends are 190 mm apart closes across the part. The G-code gains a 190.000 mm cut, and the toast "The widest gap closed was 190 mm." uses the `info` variant (`path-cleanup-actions.ts:293-294`).
- ADR-480 §6 chose "close any gap and report the widest" on purpose. Its quote of LightBurn has no limit, but LightBurn's current reference requires start and end within 0.5 mm and sends wider gaps to Close Paths with Tolerance.
- Suggested: either copy LightBurn's 0.5 mm limit and point to Close Paths with Tolerance, or keep the ADR rule and use a warning toast above a threshold. This is the maintainer's choice ("research what LightBurn does and copy").

### T35-P3-2: The toast does not say that a closed path is now filled or kerf-offset
- S6: an open C on a Fill operation burns 0 mm before and 4000 mm of hatch after. The toast says only "Closed 1 path. The widest gap closed was 20 mm."
- This matches the user's own settings, and the canvas preview shows it. This is the same pattern as known T07-P3-1. Counted as known.

### T35-P3-3: The menu is enabled for a boolean compound or for unpaired curves, then says "The selection has no open paths to close." (READ ONLY)
- `design-tools-command-context.ts:82-92` gates on kind only.
- `isPathEditable` (`path-cleanup-actions.ts:139-147`) also excludes `booleanCompound`, and `closeOpenPaths` skips paths whose curve and polyline counts differ.
- The message is then wrong for an open path. Same pattern as T07-P3-3.

### T35-P3-4: Ends within float noise get an extra seam point (a zero-length segment)
- `closePolyline` uses exact equality (`path-direction-edits.ts:158`). Ends 1e-12 mm apart gain a duplicate point, so the last segment is 1.0e-12 mm (S8).
- The G-code is unchanged at 3 decimals. This is tidiness only. Suggested: treat ends within 1e-9 mm as the seam, as `samePoint` in the same file already does.

### T35-P3-5: Test gap — nothing covers a partly retraced closure
- The repo suites (54 tests) cover the whole out-and-back case only.
- Add the hook, spur and lollipop cases from `t35-spur.test.ts` at kerf ±0.1.

## Not a defect / limits
- **Variable text, variable barcodes, jig (#1882/#1900).** Close Path never edits text or barcode objects. `selectionHasEditablePaths` and `isPathEditable` admit only imported-svg, traced-image and polyline shapes, so it cannot rebuild `{{serial}}` glyphs. A single-line-font text with open strokes gets "Text and drawn shapes keep their own paths; convert them to paths first."
- **Locked objects are skipped silently.** This is known T10-P3-1, the same pattern. Counted as known.
- **Curves are closed exactly** (cubic + line). The G-code delta equals the chord at scale 1 and 2. Flattening is known T26-P2-1.
- **Tabs.** Anchors stay put on close (read `closingLineFraction`), and the ADR-494 notices do not apply because no anchor moves. A runtime check was not made: tabs cannot be placed on an open contour in the UI.
- **Path text on a guide that gets closed.** Text keeps its rendered glyphs, which is the same as any other guide edit. Not checked further.
- **Jig artwork copies are separate objects.** Closing one copy changes only that box, the same as a node edit. READ ONLY.
- **Not checked:** the browser (dialog-free command, so no dialog to check) and inch display.

## Totals
Raised 6; P1 0; P2 1; P3 5; known 2 (T35-P3-2 = T07-P3-1 pattern, counted in Raised; locked-silent = T10-P3-1, not counted in Raised). T35-P2-1's kerf behaviour is listed in ADR-486 Amendment 4 Limits, but not as a Close Path defect in any ledger.
