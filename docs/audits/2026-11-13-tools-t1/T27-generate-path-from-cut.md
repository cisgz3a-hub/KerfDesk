# T27 Generate Path From Cut — auditor report
Tree: origin/main @ 3293fd15d. Command id: `tools.generate-path-from-cut`.

## Map
- Menu: `src/ui/commands/command-families.ts:132-139` (`generatePathFromCutCommand`, always enabled) → `ctx.generatePathFromCut` (`parity-tools-command-context.ts:24`).
- Handler: `src/ui/state/path-from-cut-actions.ts` `generatePathFromCut` → `exportProjectSelection(project, ids)` (line 36) → `prepareOutputSnapshot(... outputScope: { cutSelectedGraphics: ids.length > 0, useSelectionOrigin: false })` (no job origin, so absolute frame) → `cutPathsArtwork(job, toSceneCoords, { scanningOffsets })` → `pathFromCutMutation` adds one `imported-svg` (`source: 'Generated path from cut'`, identity transform, `operationIds: []`), selects it, one undo entry, `dirty: true`, success toast.
- Core: `src/core/job/cut-paths-artwork.ts` replays `buildToolpath` (the preview's step builder) over the prepared job's cut and fill groups with power > 0; raster groups counted and left out; CNC groups dropped; one path per colour.
- Help tooltip: `src/ui/help/parity-tools-command-help.ts:15`.
- Governing decisions: no ADR of its own. ADR-486 (and Amendment 3, kerf sides judged across the whole scene, before output scope), ADR-626 Amd 1 (lead side judged across the scene), ADR-415 (overcut on final pass), ADR-239 (runways), ADR-127 (rotary preview stays surface-true). October audit `docs/audits/2026-10-15-tools-vector.md:84` (R9) and register row 34.
- LightBurn: its nearest tool, "Convert to Cut", is documented as a developer debugging tool ("not how you produce GCode", https://docs.lightburnsoftware.com/1.7/Reference/ConvertToCut/), so there is no documented user behaviour to copy.
- Changes since 2026-10-16: none. Both source files were last changed on 2026-10-13 (`e9a0a27d8`, `106ef347d`), so the tool predates ADR-486 Amendment 3 (2026-10-20).

## October register re-check
Register row 34 (`2026-10-16-tools-quality-register.md:68`) repaired nothing; it passed menu, mutation, exact Undo/Redo and union bounds. Re-checked: Undo restores the identical project object (`project === original`), Redo restores the identical generated project, the stale-project guard holds (existing unit test). Still good.

## Checks run
Scripts: `C:\Users\stolk\kd-t1\zz-t27\t27-burn.test.ts` (log `t27-burn.log`) and `t27-more.test.ts` (log `t27-more.log`). Oracle: own G-code decoder (`zz-t27\decode.ts`, lit G1 moves mapped to scene) on `prepareOutput` + `emitPreparedGcode` of the full project with the same output scope; directed Hausdorff both ways, total lit length and bounding boxes.

| Check | Method | Result |
|---|---|---|
| Square, no kerf / kerf +0.25 / kerf -0.25 / nothing selected | oracle | Exact match: 10.5 mm out, 9.5 mm in, Hausdorff 0.000 |
| Rotated 35°, mirrored, 2 × 0.8 scaled ellipse, kerf 0.3, origins front-left / rear-right / centre | oracle | Exact match (len 131.486, Hausdorff 0.000) |
| Tabs 4 × 1 mm, overcut 2 mm, perforation 2/1, lead-in 3 mm | oracle | Exact match (76.0 / 82.0 / 53.0 / 82.997 vs 82.998) |
| Fill bidirectional, fill passes 2, fill on plate with unselected hole | oracle | Exact match with G-code |
| Hole selected alone, plate unselected, kerf 0.5 (same op and separate ops) | oracle | **Mismatch: generated 11 × 11, burned 9 × 9** (T27-P2-1) |
| Hole selected alone, leads | oracle | **Mismatch: lead on outside, burn's lead inside** (T27-P2-1) |
| Line passes 3 | oracle | 3 stacked identical polylines, toast "Added 3 burned path(s)" (T27-P3-1) |
| Scanning offset 0.3 mm, bidirectional fill | oracle | Rows zig-zag ±0.15 mm (commanded, not burned) — KNOWN, D8 |
| Rotary roller | oracle | Generated is surface-true (50..60) and G-code is machine-space by design (ADR-127) |
| Registration jig (box layer output off), nothing / art / box selected | oracle | Match; jig objects unchanged, no dissolve; box alone gives "Nothing here" toast |
| Variable text `{{serial:4}}` | script + existing unit test | Source template untouched; the tool materialises the serial before compile (unit test `path-from-cut-actions.test.ts`); real font render cannot load in Node |
| Undo / Redo / Save + reopen | script | Exact; `operationIds: []` survives reopen, full output unchanged (42.000 = source alone), generated-only output burns 0 |
| Generate again with nothing selected | script | The first generated copy is not included again |
| Empty project, output off, power 0 | script | Warning toast, nothing added |
| CNC project | script | "Nothing here is cut or filled. Assign the artwork to a Line or Fill operation…" (T27-P3-2) |
| Locked object selected | oracle | Match |

## Findings
### T27-P2-1: Selecting only a hole generates it with the kerf and leads on the wrong side, 2 × kerf larger than the burn
- Severity P2: the tool's stated purpose is to show "what the laser burns, kerf … included" for inspection or reuse; the result is wrong in a way the user can see on the canvas, and harm needs a second step. Arguably P1 if the copy is reused as artwork (it would cut the hole 2 × kerf too large), or if the user "corrects" their kerf after inspecting it.
- Where: `src/ui/state/path-from-cut-actions.ts:36` filters the project to the selection with `exportProjectSelection` before `prepareOutputSnapshot`. `prepareOutput` then gives compile and laser leads `input.sourceProject.scene` as the side scene (`prepare-output.ts:297`, `:379`), which is now the filtered scene, so ADR-486 Amendment 3 decision 1 ("judged among the scene … before the output scope") no longer holds here. Real Start/Save with Cut Selected Graphics passes the whole project and gets it right.
- Repro: `zz-t27\t27-burn.test.ts` cases C1/C3, `t27-more.test.ts` "two operations". Plate 30 × 30 at (100,100), hole 10 × 10 at (100,100), Line kerf 0.5, select the hole only:
  - generated: bbox 99.5..110.5, width 11.000, length 44.000;
  - burned (decoded G-code, Cut Selected Graphics, hole only): bbox 100.5..109.5, width 9.000, length 36.000; Hausdorff 1.414 / 1.000 mm.
  - Same with the hole on its own operation (generated length 44 vs burned 36). With leads (2 mm), the generated lead sits outside the hole (bbox from 98.586) while the burn's lead is inside (bbox from 100.000).
  - Selecting both, or nothing, matches exactly (Hausdorff 0.000).
- Oracle: decoded G-code of the real output path; ADR-486 Amendment 3 describes this exact 11 mm vs 9 mm case as the defect it fixed.
- Suggested fix: pass `source.project` unfiltered to `prepareOutputSnapshot` and let `outputScope.cutSelectedGraphics` choose the objects (as Start does); or pass the full scene as the side scene. Add a test with a hole selected alone.

### T27-P3-1: Multi-pass operations produce stacked duplicate copies with no word about it
- Severity P3. Ran it, but it follows the tool's "what burns" definition, so I record it as a design question.
- Where: `cut-paths-artwork.ts` replays `buildToolpath`, which loops `group.passes` (`toolpath.ts:89`, `:124`).
- Repro: `t27-burn.test.ts` B1: one square, passes 3, gives 3 identical overlapping polylines (length 120 = 3 × 40), and the toast says "Added 3 burned path(s)". Fill with passes 2 gives each row twice. If the user reuses the copy on a 3-pass operation, it burns 9 times, and the stacked copies cannot be seen on the canvas.
- Suggested fix: keep one copy of each identical pass (when the pass angle is unchanged), or say "N passes stacked" in the toast.

### T27-P3-2: CNC projects get a misleading "assign to a Line or Fill operation" warning
- Severity P3 (wording). `path-from-cut-actions.ts:100`; `cut-paths-artwork.ts` drops `cnc` groups without counting them.
- Repro: `t27-more.test.ts` "CNC project message": a CNC project with a square on a Line operation shows "Nothing here is cut or filled. Assign the artwork to a Line or Fill operation that outputs.", although it is already assigned and would cut.
- Suggested fix: count CNC groups and say that router toolpaths are not converted, or disable the command in CNC mode.

## Not a defect / limits
- Scanning-offset compensation is baked into the copy (reverse rows shifted by the commanded offset). This is KNOWN: `docs/audits/2026-10-22-controller-v3/D8-ctl-scan-offsets.md:351`, listed as a product question. Measured ±0.15 mm with a 0.3 mm offset.
- Rotary: the copy is surface-true while the G-code is machine-scaled, by design (ADR-127, the preview stays surface-true).
- The copy is one object for every operation, with no name or layer, bound to nothing. This is by design (tooltip, line 113 comment) and survives reopen.
- Variable text: the real font renderer cannot fetch fonts under Node (`Failed to parse URL /@fs/...`), so the rendered glyphs were not checked; the materialisation path is covered by the existing unit test with a mocked renderer. Unlike T26 Convert to Path, this tool never bakes template glyphs: it compiles through `prepareOutputSnapshot`, which evaluates the serial first, and the source text keeps its template.
- Registration jig: the source is never modified, so the T26 jig-dissolve problem does not apply here. Not checked: multi-slot jig instances, Print and Cut registration, a job with sub-layers, arcs on an arc-enabled machine, and how fast a very large fill is (thousands of rows in one object). No browser run (the tool has no dialog).
- A hidden object selected (`hidden: true` in the probe) generated and burned the same; the field name may not be the app's real visibility flag, so this is unverified.

## Totals
Raised 4; P1 0; P2 1; P3 2; known 1 (scan-offset rows baked into the copy — D8-ctl-scan-offsets.md:351).
