# T27 Generate Path From Cut — refuter report
Tree: origin/main @ 3293fd15d (read only). Command id: `tools.generate-path-from-cut`.
Scratch: `C:\Users\stolk\kd-t1\zz-t27r` (`r27.test.ts`, `vitest.config.mts`, output `r27.log`).

Method: my own Vitest file on the real modules. It drives the real store action (`useStore.getState().generatePathFromCut()`). The oracle is my own G-code decoder over `prepareOutput` → `emitPreparedGcode`, with Cut Selected Graphics on and the same selection. It counts only G1 moves made while M3/M4 is on and S > 0. The device origin is set to `rear-left`, so machine X/Y equal scene X/Y and the oracle uses none of the app's coordinate mapping. I also give the expected result worked out by hand from ADR-486 Amendment 3 and ADR-626 Amendment 1 next to each decoded result. Free memory was 2.1 GB before each run, and I used one worker.

## Verdicts

| ID | Auditor | Refuter verdict |
|---|---|---|
| T27-P2-1 | P2: a hole selected alone gets its kerf and leads on the wrong side | **UPHELD at P2**, with one correction and a wider trigger. The error is 2 × kerf per side, so 4 × kerf across the width: 11 mm generated vs 9 mm burned with a 0.5 mm kerf. The auditor's title, "2 × kerf larger", understates it. The trigger is wider than holes: islands, compound letters inside a plate, and leads beside close unselected neighbours (ADR-626 Amd 10) all go wrong. Fill is not affected. |
| T27-P3-1 | P3: multi-pass operations give stacked duplicate copies | **UPHELD at P3** as a design or wording question. The copy matches the G-code exactly (passes 3: generated length 120 = G-code length 120), so it is not a defect against the tool's own contract. |
| T27-P3-2 | P3: misleading CNC message | **UPHELD at P3**. Reproduced. The command is always enabled, and the toast tells a CNC user to assign the artwork to a Line or Fill operation. |

## Evidence per claim

### T27-P2-1

**Cause confirmed by reading.** `path-from-cut-actions.ts:36` calls `exportProjectSelection(source.project, ids)`, which drops every unselected object (`export-artwork-svg.ts:98-119`). That filtered project then becomes `prepareOutput`'s `sourceProject` (`prepare-output.ts:200-203`). Compile receives `input.sourceProject.scene` as `sideScene` (`prepare-output.ts:127`, `:373-379`), and laser leads receive it as `scene` (`:297`). As a result, the side scene contains only the selection. Start and Save pass the whole project together with `outputScope` (for example `save-gcode-emission.ts:161-168`), so their side scene is the whole scene.

**Intent check: nothing intends this.**
- ADR-486 Amendment 3, decision 1, says "Preparation hands compile the project's whole scene, before the output scope", and it names Cut Selected Graphics with the hole selected alone as the defect it fixed.
- ADR-626 Amendment 1, item 1, says the same for leads, and Amendment 10 says parts that output leaves uncut are kept clear.
- The tool's tooltip (`parity-tools-command-help.ts:15-18`) promises to compile "exactly as output would".
- No ADR, `WORKFLOW.md` text or code comment mentions this tool's selection scoping.
- History shows the reason: the `exportProjectSelection` line came in with 106ef347d (2026-10-13), a week before ADR-486 Amd 3 and ADR-626 Amd 1 (2026-10-20). The amendments changed `prepareOutput`'s callers but did not touch this pre-filtered call. It was a missed call site, not a choice.
- The unit tests (`path-from-cut-actions.test.ts`) have no case with an unselected container.

**Reproduction (own script, `r27.log`).** Line operation, kerf offset 0.5 mm. Plate 40 × 40 at (40,40), hole 10 × 10 at (55,55), with the hole ring drawn reversed so that winding cannot decide the side.

| Case | Selection | Expected by hand | Generated | Burned (decoded G-code) | Hausdorff |
|---|---|---|---|---|---|
| R1a one op | hole | 9 × 9, 55.5..64.5, length 36 | 54.5..65.5, **length 44** | 55.5..64.5, length 36 | 1.414 |
| R1b | plate | 41 × 41, length 164 | match | match | 0.000 |
| R1c / R1d | both / nothing | hole 9 × 9 | match | match | 0.000 |
| R2a hole on its own kerf op | hole | 9 × 9 | **11 × 11 (44)** | 9 × 9 (36) | 1.414 |
| R3a plate op without kerf/leads/tabs | hole | 11 × 11 in both (Amd 3 decision 3: the plate is taken for a non-part) | 11 × 11 | 11 × 11 | 0.000, the control |
| R4a compound "O" ring (outer + counter, one object) inside the plate | ring | outer is a hole, 19 × 19; counter is an island, 9 × 9 | **outer 21 × 21** (49.5..70.5) | 19 × 19 (50.5..69.5) | 1.414 |
| R4b | plate + ring | as R4a | match | match | 0.000 |
| R5 plate and hole in one compound object | it | 9 × 9 hole | match | match | 0.000 (no trigger) |
| R6a plate > hole > island, three objects | island | the island is depth 2, so 11 × 11 either way | 11 × 11 | 11 × 11 | 0.000 |
| R6b | hole | 39 × 39 | **41 × 41 (164)** | 39 × 39 (156) | 1.414 |
| R6c/d | hole + island | hole 39 × 39, island 11 × 11 | **hole 41 × 41, island 9 × 9** (both flipped) | hole 39, island 11 | 1.414 |
| R7a leads only (line, 2 mm, auto side, kerf 0) | hole | lead inside the hole | lead reaches **y 53, 2 mm into the plate** | lead inside, 55..65 | 2.000 |
| R7b | both | lead inside | match | match | 0.000 |
| R11a leads only, outer square with four unselected neighbours 1 mm away | square | lead kept clear of the neighbours (Amd 10) | lead **2 mm, to y 48, into neighbour n1** (30..49) | lead shortened to 0.5 mm (y 49.5) | 1.500 |
| R11b | nothing | | match | match | 0.000 |
| R8a/b/c Fill, plate + hole | hole / plate / both | Fill is scoped the same way in both paths | match (100 / 1600 / 1500 mm) | match | 0.000 |
| R9a Fill with kerf 0.5 | hole | | match | match | 0.000 |

**How wide the trigger is.** Any selection that leaves out an enclosing part edge on a Line operation with a kerf offset, leads or tabs triggers it. That includes a hole, a nested hole, a hole with its island (both flip), and a text-like compound object inside a plate (the letter outlines and their counters both flip). Leads alone are enough, even with no hole: R11 shows that selecting a part beside close unselected parts gives a lead that runs into a neighbour, where Start shortens it. Cases with no trigger: selecting the outer part, selecting everything or nothing, a hole and plate in one object, an island selected alone (it is outer either way), any Fill operation, and a plate operation without kerf, leads or tabs. Real `TextObject` glyphs could not be rendered under Node (the auditor saw the same font-fetch failure). R4 uses a compound imported path as a stand-in for a stencil letter, so text was not run with real glyphs. Text is a single object, so its counters move with its outlines. The trigger is text inside an unselected plate.

**Severity: P2 stays.** It is not P1. Under the AREAS.md table, P1 "Harms a job", and this tool never burns anything: the copy has `operationIds: []` (`path-from-cut-actions.ts:113`) and burns only after the user assigns it. Start, Save and Frame stay correct, because `prepareOutput` itself is right. Harm takes two further steps: select the hole alone, then reuse or trust the copy. That fits P2's "real defect with limited harm: a wrong result". The magnitude (1 mm per side at 0.5 mm kerf, a 2 mm lead into the part) exceeds T26-P2-1 (0.247 mm off-round on reuse, graded P2). Since T26-P2-1 is P2, this one should not be lower. The case for P1 is that the tool's stated purpose includes reuse as artwork. That is not enough to raise it, because the result is a drawn copy and not a burn.

**Fix check.** Pass `source.project` unfiltered and keep `outputScope.cutSelectedGraphics` / `selectedObjectIds`, as Start does. `validateOutputScope` already scopes the burn (R1b/R8 show the scoping alone gives the same burn). `exportProjectSelection`'s extra dependants (image masks, path-text guides) need checking against `validateOutputScope`'s own dependant handling. Add tests R1a, R6c and R11a.

### T27-P3-1 (multi-pass)
R10a: one 10 mm square at passes 3 gives 3 polylines with generated length 120.000, and the decoded G-code length is also 120.000 (Hausdorff 0). The toast "Added 3 burned path(s)" is accurate. The copy is exactly what burns, so this is a wording or design question (the stacked copies cannot be seen, and reuse multiplies passes), not a defect. P3 stands. A fix in the toast wording costs nothing.

### T27-P3-2 (CNC)
R10b: with `machine: DEFAULT_CNC_MACHINE_CONFIG` and a square on a Line operation, no object is added. The toast says "Nothing here is cut or filled. Assign the artwork to a Line or Fill operation that outputs." The command is always enabled (`command-families.ts:132-139`). It is wording only, so P3 stands.

## Extra findings
None raised. Two widenings of T27-P2-1 that share its single cause (line 36) are folded in rather than given separate IDs:
- islands and compound letters flip with their hole (R4a, R6c/d);
- ADR-626 Amd 10: leads run into unselected neighbours even with no hole (R11a).

The missing unit-test case is part of the P2 fix.

## Totals
Verdicts: T27-P2-1 upheld P2 (corrected to 2 × kerf per side, 4 × kerf across; wider trigger: islands, compound letters, leads beside unselected neighbours; Fill not affected); T27-P3-1 upheld P3 (copy equals the G-code; wording or design only); T27-P3-2 upheld P3. Extra raised: 0 (none; two widenings folded into T27-P2-1).
