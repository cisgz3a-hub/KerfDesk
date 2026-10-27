# CNC audit v1 — F8 Output and viewer (`cnc-output-viewer`)

- **When:** 2026-10-23 to 2026-10-26.
- **Tree:** worktree `claude/rolling-audit-20261021` @ `817c2292e`. `git diff HEAD origin/main` is empty for every file in scope at origin/main `adf300522` (fetched 2026-10-26). The paths compared:
  - the scope paths below;
  - `src/core/output/**`, `src/core/sim/**` and `src/core/geometry/**`;
  - `src/core/job/toolpath-cnc*.ts`, `src/ui/workspace/cnc-removal-grid.ts` and `cnc-cut3d-surface.ts`;
  - `src/ui/laser/save-output-emission.ts`, `src/ui/app/CncSetupDocumentExport.tsx`, `src/core/cnc/tile-registration-passes.ts`, `helical-entry.ts` and `tile-plan.ts`.

  The CAM fixes merged since then (#1416, #1421, #1422, #1423) change adaptive, tab, rest and V-carve geometry. They do not change the emitter, the precision contract, the simulator or the viewer. Corpus programs built on origin/main would differ in their CAM, not in how they are written or shown.
- **Scope:**
  - `src/core/cnc/cnc-output-precision.ts`, `coordinate-representation/`, `output-representation/`, `cnc-contour-emission.ts`, `cnc-grbl-coordinate-parser.ts`, `cnc-pass-emission.ts`, `motion-polish.ts`, `cnc-compilation-artifact.ts`, `cnc-compilation-sidecar.ts`
  - `src/io/cnc/**`: program facts, filenames, geometry, preview, reach, XYZ paths, setup document and package, tool programs, wrap study
  - `src/ui/cnc-viewer3d/**` and `src/core/toolpath3d/**`
  - Followed into:
    - the CNC emitter: `src/core/output/cnc-grbl-strategy.ts`, `cnc-grbl-helical.ts`, `cnc-grbl-transitions.ts`, `cnc-grbl-emit-head.ts`;
    - the simulator and grid: `src/core/job/toolpath-cnc.ts`, `src/core/sim/stamp-toolpath.ts`, `removal-grid-display.ts`;
    - the workspace grid: `src/ui/workspace/cnc-removal-grid.ts`, `cnc-cut3d-surface.ts`, `use-cnc-3d-scene.ts`;
    - the Save path: `src/ui/laser/save-output-emission.ts`, `src/ui/app/CncSetupDocumentExport.tsx`.
- **Governing:**
  - PROJECT.md non-negotiable 5 (deterministic G-code).
  - ADR-261 (CNC 3D viewport, display-only).
  - ADR-425 item 5 (display pooling).
  - ADR-392 Amendment 2 (one tile file per bit; the `M0` problem in Run G-code file).
  - ADR-310 (multi-tool order).
  - 2026-09-24 GC-1 (helix as half circles).
  - The leaders plan C06 "Exact setup packages" (`docs/audits/2026-10-08-cnc-leaders/BUILD.md:20`). No ADR governs the setup package.
- **Lenses run:** L1, L2, L3, L4 and L7 as separate passes (the stressed lenses). L5 was light: one loaded-project case, under P3-3. L6 was skipped: the emitter and the viewer have no failure path of their own beyond the KNOWN ones.
- **Counts:** 6 raised → P1 0 / P2 1 / P3 5 (+5 KNOWN re-observed, not re-raised). 4 candidates self-refuted. Refuter (2026-10-26): 6 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED, 0 KNOWN. No severity changes. No refuter-raised finding.

## Method

**Corpus.** `zz-f8-corpus.test.ts` (deleted; a copy is in the scratchpad) built each case through the real Save path:
1. `prepareOutput`;
2. `emitSavePreparedOutput`, which gives the combined program, the per-tool programs and the program facts;
3. `buildCncSetupDocument`, in both modes;
4. the workspace's own removal grid: `buildPreviewToolpathFromPrepared` → `computeCncRemovalGrid` → `downsampleRemovalGrid(…, 360)`, which is the Cut 3D display;
5. tiled cases through `finalizeTiledOutput`.

**Origin.** Every case used the rear-left origin, where scene XY is machine XY (ADR-261 §2 table) and the job origin offset is (0, 0). The grid can therefore be compared with the program cell for cell.

**Oracles.** Three independent oracles with no KerfDesk code, all in the scratchpad `f8-repros/`.
- `f8-oracle.mjs` walks the emitted text as stock GRBL 1.1h does:
  - Line storage (`protocol.c`): whitespace and comments are dropped, and at most 79 characters are stored.
  - `read_float` in float32 (`nuts_bolts.c`), with 8 captured digits.
  - The radius check of `gcode.c` for every G2/G3, in float32.
  - The angular travel of `mc_arc`, with a float32 centre and `ARC_ANGULAR_TRAVEL_EPSILON`.
  - A replay of every move into a height field at the viewer grid's own cell centres:
    - an end mill exactly (minimum Z over the chord interval inside the disc);
    - V-bits and ball noses sampled every 0.01 mm against the physical cone or sphere;
    - each section with the bit named in its own `; cnc tool:` comment;
    - end mills also at ±0.002 mm radius, so that boundary cells do not count.
- `f8-polish.mjs` checks emission fidelity: every emitted cutting sample, every 0.05 mm, against the compiled pass geometry. For `profile` it also measures the offset from the drawn shapes.
- `f8-display.mjs` and `f8-lines.mjs` separate the display pooling from the grid sampling.

**Primary sources.** The firmware sources were fetched at pinned SHAs:
- gnea/grbl `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e` (v1.1h, master tip);
- grblHAL/core `4ec1ae44b857a70d2f9298344feac4b43ed0eb6b`;
- bdring/FluidNC `6735500abb71be33c09a3f202d66ad5fc9499063`.

## Headline

**Program text is sound in every case.** Coordinate words are absolute and formatted from their own values, so rounding cannot accumulate. Emitted cutting paths stay within 0.0007 mm of the compiled geometry. Across the arcs checked:
- every one of 180 native G2/G3 passes GRBL's radius rule, the worst at 1.0 % of the 0.005 mm limit;
- no full circle collapses;
- the longest stored line is 44 characters, against GRBL's 79.

For the end-mill programs, the viewer's removal grid equals an exact replay of the program.

**The defects are in the hand-off around the program.**
- **Setup package (F8-P2-1).** The package defaults to "Single file · manual M0 tool changes" and prints "At each M0, load the indicated cutter, … re-zero Z". KerfDesk's own Run review says this cannot be done, because the controller takes no jog or Zero Z at an `M0`.
- **Cut 3D and the 3D result pane (F8-P3-1).** They erase thin deeper grooves inside a cut floor. Axis-aligned V-lines in a recess are 0.7–5.4 % visible, against 100 % in the grid behind them.
- **The rest are P3:**
  - a latent arc rule that is looser than GRBL's (F8-P3-2);
  - exponent words from out-of-range loaded values (F8-P3-3);
  - setup-sheet feeds that are not the emitted words (F8-P3-4);
  - per-tool files with no bit or zero header (F8-P3-5).

## Measurements

Viewer grids are the workspace grid (cell = max(0.2 mm, extent / 1000)). Cut 3D displays are `downsampleRemovalGrid(grid, 360)`.

Two definitions apply throughout. "Shallower" means the viewer shows less removal than the program, beyond the ±0.002 mm cutter band. The arc ratio is delta_r divided by GRBL's threshold.

| Program | Worst G2/G3 radius error (GRBL rule) | Worst polish / emission deviation | Viewer vs independent replay | Source |
|---|---|---|---|---|
| `profile`: outside 40 × 30 rect + Ø16 circle (tabs, 10° ramp), inside Ø12, 1/8" EM | no arcs | 0.00031 mm from the compiled passes. Drawn-shape offset: outside circle −0.0013…+0.0009; inside circle −0.0015…+0.0018; rect ≥ −0.0005 mm | grid 0.2 mm: 0 cells. Cut 3D 0.4 mm: 25 blocks show the tab top over a tab-edge cut, which is intended (ADR-425 item 5) | grbl `gcode.c` L803-805; ADR-425 item 5 |
| `helix`: 4 helical pockets at X 950–1100, Y 620–780, 3°, 1/8" EM | 56 arcs, worst 5.0e-5 mm at r 4.0 (ratio 0.010); worst `mc_arc` travel error 1.9e-5 rad on a half circle | 0.00068 mm | grid 0.2 mm (787k cells): 0 cells; Cut 3D: 0 | `gcode.c` L796-806; `motion_control.c` L100; `config.h` L407 |
| `adaptive4`: three adaptive pockets (U, rotated rect, U at X 1110–1150), 4 mm EM | 100 arcs, worst 9.5e-7 mm (ratio 0.0002); travel 8.7e-8 rad | 0.00070 mm (helix-to-contour link inside the bore) | grid 1.14 mm: 0 cells; Cut 3D 3.43 mm: 0 | same |
| `tiled-0/1`: 700 × 300 job, 2 tiles, Ø8.1 registration bores, 1/8" EM | 16 same-point full circles, J0.000: delta_r 0; travel = 2π within 1.7e-7 rad | not run | tile files have no viewer | `motion_control.c` L100 |
| `vcarve`: star + bar, 60° V | no arcs | 0.00000 mm | grid 0.2 mm: 710 of 97,918 cells shallower, at most 0.082 mm; the bit is sampled every half cell. 0 deeper | KNOWN PV-2 family |
| `multitool`: 6.35 rough → 2 mm rest → V60 → 6.35 release (4 sections) | no arcs | 0.00067 mm | grid: 0 cells over 0.05 (max 0.036, V-bit); Cut 3D: 20 tab blocks, intended. Sections, `M0` prompts, separate files and setup rows agree (below) | ADR-310 |
| `recess`: 560 × 360 × 2 mm recess (25.4 mm EM), V60 lines 0.5 mm below the floor, 0.8 mm slot 1 mm below | no arcs | 0.00060 mm | grid 0.564 mm: 1,638 cells shallower, at most 1.0 mm, all at the slot edge (KNOWN PV-2). Cut 3D 1.692 mm: 986 blocks shallower than the grid's own deepest cell. Axis-aligned V-lines 0.7 / 0.7 / 5.4 % visible against 100 % in the grid; slot 46.7 %; diagonal and circle 98–100 % | **F8-P3-1**; ADR-425 item 5 |
| `micro`: 0.0004 mm steps at X 9876.5 and X 20, 2 mm EM | no arcs; detail precision `X9876.5436` (4 dp, 8 digits) | 0.00005 mm | grid 9.86 mm: **0 cut cells** although the program engraves two paths | KNOWN PV-2 |
| unit: arc pass, end radius 10.05 on r 10 | written as `G3 X50.000 Y60.050 I-10.000 J0.000`; GRBL delta_r 0.04999 > 0.010: **error:33** | — | — | **F8-P3-2** |

Line length and syntax:
- The longest stored line is 44 characters (`G2 X1049.554 Y780.434 Z-1.000 I-3.733 J-1.436 F150`). The limits are GRBL 79, grblHAL 256 and FluidNC 255. The longest raw line is an 85-byte comment.
- Every word reads cleanly through the `read_float` model.
- `-0.000` appears twice (`tiled-0.nc:584,593`). That is KNOWN GC-3.

## Findings

### F8-P2-1 — The setup package defaults to one file with `M0` bit changes, and tells the operator to re-zero Z at each `M0`. GRBL takes no jog or Zero Z there, and KerfDesk's own Run review says so.

- **Where:**
  - `src/io/cnc/cnc-setup-package.ts:97`: the single-file instruction reads "At each M0, load the indicated cutter, keep the same G54 XY datum, re-zero Z on stock top … before resuming."
  - `src/ui/app/CncSetupDocumentExport.tsx:25`: `useState<CncSetupExportMode>('single-file')`, the default.
  - `CncSetupDocumentExport.tsx:104`: the option is labelled "Single file · manual M0 tool changes".
  - The program itself, at `src/core/output/cnc-grbl-transitions.ts:99-101`: `; tool change: load …`, `; re-zero Z on the stock top, then cycle-start to resume`, `M0`.
- **Anchor:**
  - **Ground truth.** In stock GRBL an `M0` sets a feed hold and suspends. While it is suspended no line is parsed, and a jog is accepted only in Idle or Jog (sources below).
  - **Twin.** `src/core/external-program/kerfdesk-bit-changes.ts:10-14`, KerfDesk's Run G-code file warning for the same bytes: "The controller then takes no jog or Zero Z until cycle start, and the new bit's spindle start and plunge are already sent, so it would cut at the old bit's Z zero."
  - **Contract.** ADR-392 Amendment 2, Context, the choice between fixes (a) and (c), as it stands in `docs/decisions` on origin/main. It keeps the `M0` file only for "a single-file save of a multi-bit job run through Run G-code file", and Decision 3 adds that warning. The amendment fixes tiles by writing one file per bit. It does not cover the setup package.
- **Scenario:**
  1. Take a multi-bit job, for example `multitool`: 6.35 mm rough, then 2 mm rest, then V60, then 6.35 mm release.
  2. Save the setup sheet in its default mode.
  3. The HTML prints the instruction above. Its only embedded program is the combined file, with three `M0` holds.
  4. A program downloaded from an offline package cannot be run by project Start, which compiles from the project and holds host-side. It runs through Run G-code file or another sender, and both send the `M0` to the controller.
  5. At the `M0` the operator cannot jog to the touch-off point or zero Z. In KerfDesk the Run review warns. In any other sender the only guidance is the sheet's instruction, which cannot be followed.
  6. Cycle start then runs the next bit on the old bit's Z zero, at the wrong depth. This is the same mechanism as E3-P2-1, which was CONFIRMED for tiles.

  The safe mode exists and its files are correct: each is a complete program with its own modal block and safe lift. It is not the default, and the sheet does not say why it should be chosen.
- **Evidence:**
  - **REPRO.** `F8_CASES=multitool node ../../../node_modules/vitest/vitest.mjs run src/io/cnc/zz-f8-corpus.test.ts` (copy in `f8-repros/`).
    - `multitool.setup-single-file.html` contains the "At each M0 … re-zero Z" instruction and the tool order "End mill 6.35 → End mill 2 → V-bit 60 → End mill 6.35".
    - `multitool.nc` has `M0` at lines 113, 501 and 677.
  - **SOURCE**, gnea/grbl @ `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`:
    - [`grbl/gcode.c#L1086-L1089`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L1086-L1089): "system_set_exec_state_flag(EXEC_FEED_HOLD); // Use feed hold for program pause."
    - [`grbl/protocol.c#L546`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L546): "while (sys.suspend) {"
    - [`grbl/system.c#L131-L132`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L131-L132): "// Execute only if in IDLE or JOG states."
- **Novelty:** not in E3 or ADR-392 Amendment 2, which cover tile files and Run G-code file, nor in any CNC v1, meta or rolling-v2 ledger. No open PR touches `src/io/cnc`.
- **Severity note:** P2, matching E3-P2-1 for the same mechanism. The depth is wrong only if the operator cycle-starts without re-zeroing. Being unable to jog at the hold is itself a visible signal.
- **Refuter (2026-10-26):** CONFIRMED (REPRO + SOURCE). P2 kept.
  - **Default.** `CncSetupDocumentExport.tsx:25` starts in `'single-file'`, and `cnc-setup-package.ts:28` falls back to it when no mode is passed. The dialog adds guidance text only for the separate-tool mode (`:121-127`). Own repro (`zz-f8r-setup-m0.test.ts`, deleted; copy in scratchpad `f8r-repros\`), on the `preparedCncToolSections` fixture with no mode passed:
    - the manifest reads `single-file`;
    - the HTML prints "At each M0, load the indicated cutter, … re-zero Z on stock top … before resuming";
    - the only download is the combined `sign.nc`.
  - **The bytes reach the controller.** The embedded program was streamed as Run G-code file streams it (`external-run.ts:253`, `toolChangePause: false`), with every line before the `M0` acknowledged. Two inputs were used: the fixture, and the auditor's real-Save-path `multitool.setup-single-file.html`.
    - For `multitool`, 13 lines are in GRBL's buffer from the `M0` on: `M0`, the modal block, `G0Z3.810`, `M3S12000`, `G4P3.000`, `G0X40.034Y57.865`, then the plunge `G1Z-1.500F200`, ….
    - The fixture shows the same, with the plunge `G1Z-1.000F37` in flight.
  - **The Run review warns.** Both programs get the generic `M0` notice and "This file changes bits at an M0 stop (load End mill 2, then 2 more). … so it would cut at the old bit's Z zero. Start the job from its project, which holds for the re-zero, …" (`kerfdesk-bit-changes.ts:10-14,31`).
    - The warning names the danger plainly, before Start. In KerfDesk the wrong-depth cut is therefore not silent.
    - Its second remedy, "or save its tiles again", does not fit a setup-package file, which is not tiled. It does not point to the separate-tool mode.
  - **Ground truth.** Fetched at gnea/grbl `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`:
    - `gcode.c` L1084-1089: the M0 synchronizes, sets `EXEC_FEED_HOLD`, then "Execute suspend".
    - `protocol.c` L546: `while (sys.suspend)` services only realtime bytes. No line is parsed in the loop. A `$J=` or a `G10 L20 Z0` is not refused there; it waits in the RX buffer behind the program lines already sent. Only a cycle start from a completed hold resumes (`protocol.c` L349).
    - `system.c` L131-132 refuses `$J=` outside Idle and Jog in any case.
    - Stock GRBL's only control inputs are door, feed hold, reset and cycle start (`system.c` L49-54). There is no pendant or MPG jog input. A pendant either goes through the sender, which meets the same suspend, or drives the steppers outside GRBL, which loses position.
    - grblHAL `4ec1ae44b857a70d2f9298344feac4b43ed0eb6b` `system.c` L241 also refuses `$J` outside Idle, Jog and Tool change.
  - **Other senders.** This narrows the auditor's "in any other sender". The sources were read, not run.
    - Sienci-Labs/gsender `426eaa1925c8ba4616882d297bb1ef2ae20652da` `src/server/controllers/Grbl/GrblController.js` L512-531 rewrites the `M0` to `(M0)` and pauses host-side. The controller goes Idle, so the sheet's instruction can be followed there.
    - cncjs/cncjs `747ffcd5f208ad6556846196d12845c6e6a7fb72` `src/server/controllers/Grbl/GrblController.js` L416-425 sends the `M0` but stops streaming after it. Nothing is buffered, but the operator must release the hold with `~` before a jog is parsed.
    - UGS (`winder/Universal-G-Code-Sender` master `67d626525`) intercepts only `M6` (`ToolChangeInterceptor.java`). The `M0` reaches GRBL with the following lines buffered, as in KerfDesk.
  - **Novelty.** `gh pr view 1403` (merge `427db7e7b`) lists no file under `src/io/cnc`, and not `CncSetupDocumentExport.tsx`.
    - ADR-392 Amendment 2, Context, keeps fix (c), warning only, for "a single-file save of a multi-bit job run through Run G-code file". So the `M0` bytes are a decided residual of E3-P2-1. The same Context says "(c) alone leaves the file unusable."
    - What is new is the setup sheet's own printed instruction, which contradicts the Run review, and its default when a safe mode sits in the same control. Neither is in E3, ADR-392 Amendment 2, rolling-v2, the controller v4 ledger or meta-v1 M4.
  - **Severity.**
    - Not P1. A clear warning reaches the KerfDesk operator before Start (METHOD §3). On a UGS-type sender, jog and Zero Z visibly do nothing at the hold. Meta-v1 M4 judged the same reasoning "defensible" for E3-P2-1.
    - Not P3. It is the default of an ordinary export, the printed instruction is misleading on KerfDesk's own Run G-code file and on UGS, and the ADR calls such a file unusable there.
  - **Fix direction, added.** Point the Run review's second remedy at the separate-tool export, not only at tiles.
- **Fix direction:**
  - Default the setup package to ordered separate-tool files whenever the job has more than one bit.
  - Otherwise, replace the single-file instruction with one that matches the controller. The `M0` re-zero works only under KerfDesk project Start. Outside it, use the separate files.

### F8-P3-1 — Cut 3D and the 3D result pane erase a narrow deeper groove (or gouge) inside a flat cut floor

- **Where:**
  - `src/core/sim/removal-grid-display.ts:105-107` and `:113-133`: a block "wholly below the stock top" with two flat levels shows the majority level.
  - Used by `src/ui/workspace/cnc-cut3d-surface.ts:13,17` (360 cells across) and `src/ui/workspace/use-cnc-3d-scene.ts:34,255` (300 across).
- **Anchor:**
  - **Twin.** The 2D depth shading reads the full grid (ADR-425, Consequences: "The 2D depth shading is drawn from the full grid, not the display copy"). Cut 3D reads the pooled copy.
  - **Ground truth.** The emitted program, replayed independently.
  - **Contract context.** ADR-425 item 5 (`docs/decisions/ADR-425-3d-viewer-fixes-batch-1.md:86-92`) chose the rule to keep tabs. It promises only "So thin grooves and V-carve strokes in uncut stock still always show". It says nothing about deeper features inside a cut. The resolution banner says only that the cells are larger (`src/ui/workspace/preview-resolution.tsx:22`).
- **Scenario:**
  - A 560 × 360 mm recess, 2 mm deep, with V60 lines engraved 0.5 mm below its floor and a 0.8 mm slot 1 mm below.
  - Cut 3D display blocks are 1.692 mm (factor 3).
  - A one-column groove makes a 3 × 3 block of 6 floor cells and 3 groove cells. That is two levels, so the block shows the floor.
  - Axis-aligned engraved lines vanish from the 3D view, although the program cuts them and the 2D shading shows them.
  - Any narrow deeper mark in a floor goes the same way, a gouge included. Tabs are protected by the same rule, which is its purpose.
  - Factor 3 starts at a cut extent of about 145 mm with 0.2 mm cells. The 3D result pane (300 across) pools 4 × 4.
- **Evidence:**
  - **REPRO.** `F8_CASES=recess …zz-f8-corpus.test.ts`, then:
    - `node f8-display.mjs <out> recess`: 986 display blocks shown at −2.000 where the grid's own block holds −2.38 (V) or −3.00 (slot), e.g. "(100.06,61.15) shown -2.000 grid-deepest -2.388 deep cells 3/9".
    - `node f8-lines.mjs <out>`: "V line y=100: visible in 0.564 mm grid 100.0%, in Cut 3D display (1.692 mm) 0.7%"; x=100 5.4 %; slot 46.7 %; diagonal 100 %; circle 98.1 %.
  - **L7.** ADR-425 tests only "a 4 mm tab" and "a one-cell groove in stock". There is no test of a groove inside a cut.
- **Refuter (2026-10-26):** CONFIRMED (REPRO, two inputs). P3 kept.
  - **Own minimal grid** (`zz-f8r-setup-m0.test.ts`, test 2). A 9 × 9 grid of 0.2 mm cells sits at −2 mm, with one column at −2.5 mm. `downsampleRemovalGrid(grid, 3)` shows −2 in all 9 blocks, so the groove is gone. The same column cut 0.5 mm into uncut stock shows −0.5 in its 3 blocks.
  - **The rule is the one ADR-425 item 5 chose** (`removal-grid-display.ts:105-107`). The ADR says only that grooves "in uncut stock still always show". Losing a deeper groove inside a cut is a side effect it does not state, not a broken clause.
  - **Why P3.** The pane is display-only (ADR-261), and the 2D depth shading still shows the groove.
  - **Not KNOWN.** No audit after ADR-425 names `removal-grid-display`.
- **Fix direction:**
  - Treat a two-level block as a tab only when its higher level is the majority and touches the block edge on both sides of the deeper part. Otherwise keep the deepest value.
  - Or pool the higher level only when the deeper cells do not form a line running through the block.
  - Say in the banner that features narrower than a display cell may not show.

### F8-P3-2 — The CNC arc emitter writes a native G2/G3 for any end-radius mismatch up to 0.127 mm, while GRBL rejects more than max(0.005 mm, 0.1 % r) (latent)

- **Where:**
  - `src/core/output/cnc-grbl-strategy.ts:354-366` emits G2/G3 when `circularArcGeometry(pass).kind === 'ok'`.
  - `src/core/geometry/circular-arc.ts:20-22,36` sets that tolerance at `CIRCULAR_ARC_RADIUS_TOLERANCE_MM = 0.127` and says "Internal geometry tolerance, not a stock GRBL arc-acceptance rule".
  - The emitter's own comment, at `cnc-grbl-strategy.ts:321-323`, claims the fallback keeps output "controller-safe".
- **Anchor:**
  - **Ground truth.** [`grbl/gcode.c#L796-L806`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L796-L806): "[Arc definition error] > 0.005mm AND 0.1% radius".
  - The same rule is in grblHAL [`gcode.c#L3789-L3794`](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/gcode.c#L3789-L3794) and FluidNC [`GCode.cpp#L1714-L1720`](https://github.com/bdring/FluidNC/blob/6735500abb71be33c09a3f202d66ad5fc9499063/FluidNC/src/GCode.cpp#L1714-L1720).
  - **Twin.** The laser arc emitter replays its words GRBL's way before writing them (`src/core/output/grbl-laser-arc-moves.ts:94-102`, `src/core/job/cut-arc-moves.ts:237-259`). The CNC emitter does not.
- **Scenario:**
  - An arc pass with start radius 10 and end radius 10.05 is written as `G3 X50.000 Y60.050 I-10.000 J0.000 F1000`.
  - GRBL's delta_r is 0.04999, which is above 0.010, so the line fails with error:33 mid-job.
  - Not reachable today. The only producer of `arc` passes is the tile registration bore (`tile-registration-passes.ts:36-46`). Its circles are exact, and translation keeps J = 0.
- **Evidence:** **REPRO** `zz-f8-latent.test.ts`, test 1; `latent.log` reads "G3 X50.000 Y60.050 I-10.000 J0.000 F1000 {"deltaR":0.0499992…,"fails":true}". **L7**: `cnc-grbl-strategy.test.ts:228-283` tests only an exact arc and a degenerate one.
- **Refuter (2026-10-26):** CONFIRMED (READ + SOURCE, with the auditor's REPRO). Latent, P3 kept.
  - **The gate.** `cnc-grbl-strategy.ts:358` emits native G2/G3 whenever `circularArcGeometry` is `ok`, and that accepts any radius mismatch up to 0.127 mm (`circular-arc.ts:22,36`).
  - **The firmware rule.** Fetched at gnea/grbl `bfb67f0c` `gcode.c` L802-805: a delta_r above 0.005 mm fails if it is above 0.5 mm or above 0.1 % of r. At r 10 the limit is 0.010 mm, so a 0.05 mm mismatch is error:33.
  - **Why it is latent.** `CncArcPass` has one producer, `tile-registration-passes.ts:39-46`: full rings with start equal to end and J 0. `tile-plan.ts:339-345` moves start, end and centre by the same offset, so the radii stay equal. No other code builds a CNC `arc` pass (grep for `CncArcPass` and `kind: 'arc'`).
- **Fix direction:** Gate native CNC arcs on the same GRBL replay the laser path uses (`emittedArc`). Otherwise use the sampled-G1 fallback.

### F8-P3-3 — A loaded project with spindle values outside the UI's range writes exponent words (`M3 S3e+21`, `G4 P2e+21`), which GRBL rejects

- **Where:**
  - `src/core/output/cnc-grbl-transitions.ts:133` (`M3 S${Math.max(0, Math.round(rpm))}`) and `:138` (`G4 P${fmt(spinupSec)}`).
  - The loader, at `src/io/project/deserialize-project.ts:218-222`, accepts any positive `spindleMaxRpm` and any non-negative `spindleSpinupSec`. The UI limits them to 1,000–60,000 RPM and 0–30 s (`src/ui/laser/device-setup/DeviceSetupCncMachineStep.tsx:79-80,90-91`).
- **Anchor:**
  - **Twin.** Feed words are spelled through `formatGcodeDecimal`, whose own comment says "GRBL does not accept JavaScript's exponent notation in an S or F word" (`src/core/gcode/decimal-word.ts:3-4`). The CNC `S` and `P` words are not.
  - **Ground truth.** The letter `E` is no word GRBL knows: [`grbl/gcode.c#L322`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L322) "default: FAIL(STATUS_GCODE_UNSUPPORTED_COMMAND);", which is error:20.
- **Scenario:**
  - A hand-edited or corrupted project with `spindleMaxRpm: 5e21`, `spindleSpinupSec: 2e21` and a layer rpm of 3e21 round-trips through serialize and deserialize unchanged.
  - The program then emits `M3 S3e+21` and `G4 P2e+21`, with no preflight issue.
  - GRBL rejects the M3 line. A sender that does not stop on error would cut with the spindle off.
- **Evidence:** **REPRO** `zz-f8-latent.test.ts`, test 2; `latent.log` reads `loaded-params {"spindleMaxRpm":5e+21,"spindleSpinupSec":2e+21…}` and `exponent-lines ["M3 S3e+21","G4 P2e+21"] []`.
- **Refuter (2026-10-26):** CONFIRMED (auditor REPRO + SOURCE). P3 kept. This is not a P2 input-validation gap: no controller misreads the word.
  - **When exponent text appears.** Only at 1e21 and above, where `toFixed` and `String` switch to exponent form. The loader already drops non-finite values (`deserialize-project.ts:421-428`).
  - **Values below that.** From 60,001 up to 1e21, values print as plain digits. GRBL's `read_float` keeps 8 digits and scales the rest, so it reads them correctly and clamps S to `$30`. A huge `G4 P` only waits.
  - **GRBL refuses the line.** Fetched at `bfb67f0c`: GRBL reads `S3`, then the letter `E`, which falls to `default: FAIL(STATUS_GCODE_UNSUPPORTED_COMMAND)` (`gcode.c` L322, error:20).
  - **grblHAL and FluidNC refuse it too.** They take `E` as a word and then refuse the line for unused words:
    - grblHAL `4ec1ae44` `gcode.c` L2001 and L3987;
    - FluidNC `6735500a` `GCode.cpp` L976 and L1782.
  - **KerfDesk stops the job.** The whole `M3` or `G4` line is refused, never run with a wrong value. KerfDesk's streamer makes any `error:` terminal (`streamer.ts:276-285`), and the error path soft-resets a GRBL-family controller that may still hold buffered motion (`laser-error-line.ts:226-252`).
  - **What harm needs.** A crafted project plus a third-party sender set to ignore errors, which would then plunge with the spindle off.
- **Fix direction:** Spell `S` and `P` through `formatGcodeDecimal`, and clamp the loaded values to the UI ranges. Or add both to the coordinate-encodability refusal.

### F8-P3-4 — The setup sheet and manifest print feeds and RPM as entered, not as emitted, while Job Review prints the emitted values

- **Where:**
  - `src/io/cnc/cnc-program-facts.ts:57-60` copies the group's raw `feedMmPerMin`, `spindleRpm` and `safeZMm`.
  - `src/io/cnc/cnc-setup-document.ts:76` prints them.
  - The emitter writes `effectiveGcodeFeedMmPerMin` (floored) and `Math.round(rpm)`.
  - Job Review does the same as the emitter (`src/ui/laser/job-review/job-review-effective-operations.ts:215-217`).
- **Anchor:** **Twin**: the setup sheet and manifest against the program and Job Review.
- **Scenario:** A feed of 914.4 mm/min (36 in/min typed in inch units) is printed as "914.4" on the sheet and in the manifest. The program sends `F914`, and Job Review shows 914.
- **Evidence:** **REPRO** the `profile` case: the sheet row reads "prof-out (profile-outside) | End mill 3.175 | 914.4 | 300 | 12000 | 3.81 | 6", and `profile.nc` has `F914`.
- **Refuter (2026-10-26):** CONFIRMED (READ + artefact). P3 kept.
  - **The two sides.** `cnc-program-facts.ts:57-60` copies the raw `group.feedMmPerMin`, `spindleRpm` and `safeZMm`. The emitter and Job Review use `effectiveGcodeFeedMmPerMin`, which floors feeds of 1 and above (`feed-word.ts:9-14`; `job-review-effective-operations.ts:215-217`).
  - **In the auditor's artefacts.** `profile.setup-single-file.html` has the row `<td>914.4</td>`. `profile.nc` has 26 `F914` words and no `F914.4`.
  - **Why P3.** The gap is under 1 mm/min.
- **Fix direction:** Build the facts from the represented values the emitter writes: feed, RPM, safe Z text.

### F8-P3-5 — Separate-tool files carry no bit or zero header; KerfDesk's per-bit tile files do

- **Where:**
  - `src/io/cnc/cnc-tool-programs.ts:78-116` emits each section as a single-tool job, so no `; tool: … (load before starting)` line is written (`cnc-grbl-strategy.ts:116-124`).
  - The "load this bit, re-zero Z" guidance lives only in the HTML (`cnc-setup-package.ts:104`).
- **Anchor:** **Twin**: ADR-392 Amendment 2, Decision 1, in `docs/decisions` on origin/main. "every file's header names its bit and what to zero", as `src/core/cnc/tile-bit-files.ts:80-90` does for tile bit files.
- **Scenario:**
  - The file `job-002-tool-em2.gcode` starts with the provenance header, the modal state, `G0 Z3.810` and `M3 S12000`.
  - Its bit is named only in `; cnc tool-name:` after the spindle start. Nothing in it says "load this bit and zero Z".
  - Once downloaded out of the HTML, the files are told apart only by their names.
- **Evidence:** **REPRO** `multitool.tool-2.nc`, lines 1-24.
- **Refuter (2026-10-26):** CONFIRMED (READ + artefact). P3 kept.
  - **Why the line is missing.** `cnc-tool-programs.ts:86-91` emits each section as its own job. `cnc-grbl-strategy.ts:116-124` writes `; tool: … (load before starting)` only when one job holds more than one bit, so a one-bit section gets none.
  - **In the auditor's file.** `multitool.tool-2.nc` names its bit only at line 23, `; cnc tool-name: End mill 2`, after `M3 S12000`. No line says to load the bit or zero Z.
  - **The twin.** `tile-bit-files.ts:80-90` writes both lines for tile bit files.
  - **Why P3.** The filename carries the tool id, and the sheet's table names the cutter for each file.
- **Fix direction:** Prepend the same bit and zero header as the tile bit files. It is comment-only, so the bytes stay exact apart from the comment.

## KNOWN (re-observed, not re-raised)

- **PV-2 / 18 K-13 / 26 K-11 (2026-09-24).**
  - Half-cell tool sampling misses thin cuts. `micro`: 0 cut cells for two engravings at 9.86 mm cells. `recess`: 1,638 slot-edge cells.
  - It also under-reads V-groove depth by up to 0.082 mm (`vcarve`).
  - PV-2's fix (cell depth from distance to the segment) covers both.
- **P2-preview-2 (2026-09-29) / E3 K-3.** The tool-change park visit and the park height are not drawn: the simulator hops straight between sections (`toolpath-cnc.ts:83-95`).
- **09-P3-1 / K-5.** The ADR-253 retract between passes is not drawn.
- **The air-floor rapid (ADR-489) is drawn as a full-length plunge** (`toolpath-cnc.ts:96-106`, a single `plunge` step from safe Z). Noted in F3 as part of the 2026-09-29 preview items.
- **GC-3 (2026-09-24).** `-0.000` coordinate words: `tiled-0.nc:584,593` (`G1 X0.000 Y-0.000`).

## Refuted (self-refuted candidates)

- **"The viewer misses about 790 boundary cells of the release profile."** Those cell centres lie exactly at the bit radius from emitted 3-decimal paths. With a ±0.002 mm cutter band, the count is 0.
- **"Cut 3D shows the tab top over the full-depth cut in 20–25 blocks."** This is ADR-425 item 5's intended tab rule.
- **"`adaptive4` cuts 1.0 mm off its compiled geometry."** That move is the helix-to-contour link (`G1 X1143.120 Y783.780`), 0.5 mm from the helix centre inside the Ø7 mm bore. With the link included, the deviation is 0.00070 mm.
- **"Tile registration full circles could collapse like GC-1."** Every ring starts at centre + (r, 0), so J = 0. The float32 cross product in `mc_arc` is then exactly 0, giving a travel of 2π, measured within 1.7e-7 rad. Translation by tile and placement keeps the start Y and the centre Y equal.

## Verified clean

- **Rounding drift (Q1).** None. Every XYZ word is absolute (G90) and formatted from its own value (`cnc-output-precision.ts:20-23`). Helix opposite points and return offsets are derived from the emitted text (`cnc-grbl-helical.ts:59-64`).
  - Emission fidelity across 7 programs (≈1.1 M samples) is at most 0.00070 mm. That is within √2 × 0.0005.
  - G21 is always written (`cnc-grbl-transitions.ts:51`), so no inch output exists.
- **Arcs (Q1, L2).** 180 native arcs pass GRBL's float32 radius rule, the worst at 1.0 % of the limit. No arc's `mc_arc` travel deviates by more than 1.9e-5 rad.
  - The half-circle helix (GC-1) holds at X ≈ 1100 mm.
  - The rule is the same in grblHAL (which also uses a double-precision centre) and FluidNC.
- **Precision at the parser (L2).** Detail contours pick 4 decimals with at most 8 captured digits (`X9876.5436`). Every word in every corpus program reads the same through an independent `read_float` model (8 digits on GRBL, 9 on grblHAL: [`nuts_bolts.h#L475`](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/nuts_bolts.h#L475)).
- **Line length and format (Q4).** The longest stored line is 44 characters. The limits:
  - GRBL [`protocol.h#L32`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.h#L32) "#define LINE_BUFFER_SIZE 80" and [`protocol.c#L141`](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L141), which stores up to 79 characters;
  - grblHAL [`protocol.h#L36`](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/protocol.h#L36): 257;
  - FluidNC [`Channel.h#L60`](https://github.com/bdring/FluidNC/blob/6735500abb71be33c09a3f202d66ad5fc9499063/FluidNC/src/Channel.h#L60): 255.

  Comment values are bounded at 40–48 bytes and are not stored by GRBL. No exponent appears except under P3-3.
- **Motion polish (Q2).** Profile offsets stay within −0.0015…+0.0018 mm of the analytic offset of the drawn shapes. Start rotation, ramp entry and tab rises keep XY on the compiled path.
- **Multi-tool (Q3).** These all agree for `multitool`:
  - the tool plan [em6, em2, v60, em6];
  - the `M0` prompts ("End mill 6.35 (load before starting)", "End mill 2", "V-bit 60", "End mill 6.35");
  - the order of the separate files (`-001-tool-em6` … `-004-tool-em6`);
  - the setup rows, whose F, plunge, S and safe Z match each section's words.

  Each separate file is a complete program with modal state and a safe lift before M3, and it does not depend on the previous file's head position. Air floors stay within one group (F7), so a file is right in its turn with a fresh Z zero. The validators reject a section-count, operation-order, tool-identity or digest mismatch (`cnc-setup-package.ts:54-81`).
- **Viewer against the program (Q5).** For end mills the workspace grid equals an exact replay: 0 cells beyond the ±0.002 mm band in `profile`, `helix`, `adaptive4` and `multitool`. No G0 move removes stock in any program.
- **`cnc-compilation-artifact.ts`** (read). It rejects worker results from another job, unknown or duplicate tasks, and binding mismatches before V-carve evidence is used.

## Not verified

- **Other senders' handling of `M0`** (UGS, gSender, CNCjs). P2-1 rests on stock GRBL and on KerfDesk's own Run G-code file. The refuter later read their sources at pinned commits but did not run them (see the P2-1 refuter note): gSender strips the `M0` and holds host-side, CNCjs sends it and stops streaming, and UGS passes it through.
- **grblHAL and FluidNC `read_float` with double-precision decimal scaling.** The AVR float model was used. Their arc rules were read in source, not run.
- **Other origins.** Viewer frame mapping was checked only at rear-left (the identity case). Other origins were covered by the 2026-09-24 audit.
- **Other viewers.** The G-code Inspector's carved stock (ADR-487), the Design Studio 3D viewport and the live-run pane (KNOWN 26-P2-1) were not compared. WebGL rendering was not inspected, only the data that feeds the mesh.
- **Relief and 3D-finishing programs** (F6 area). The wrap study program (KNOWN 09-P3-2) was not re-checked.
- **The corpus was compiled at `817c2292e`.** Programs compiled at `adf300522` would include the CAM fixes #1416, #1421, #1422 and #1423. F8's own files are unchanged.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\`:
- `f8-repros\`:
  - `zz-f8-corpus.test.ts`: corpus generator. Copy it into `src/io/cnc/` to run, with `F8_CASES=<names>` and `F8_TILED=1`.
  - `zz-f8-latent.test.ts`: P3-2 and P3-3.
  - `f8-oracle.mjs`, `f8-polish.mjs`, `f8-display.mjs`, `f8-lines.mjs`: the independent oracles.
  - `latent.log`.
- `f8-out\`: programs, grids, setup sheets and facts.
- `f8-src\`: pinned firmware sources.

The repo copies of both test files have been deleted.

Refuter (2026-10-26), in the same scratchpad:
- `f8r-repros\zz-f8r-setup-m0.test.ts` (copy; the repo copy was deleted) and `f8r.log`.
- `f8r-src\`: the pinned firmware and sender sources it read (gnea/grbl, grblHAL, FluidNC, gSender, CNCjs, UGS).

```json
[
  {"id":"F8-P2-1","severity":"P2","area":"cnc-output-viewer","file":"src/io/cnc/cnc-setup-package.ts","line":97,"anchor":"Ground truth: grbl gcode.c L1086-1089, protocol.c L546, system.c L131-132 (M0 suspends; no jog/Zero Z); Twin: kerfdesk-bit-changes.ts:10-14 Run review warning; Contract: ADR-392 Amendment 2 Context (c) and Decision 3","evidence":"REPRO+SOURCE","verdict":"CONFIRMED","refuter":"CONFIRMED P2 kept: own repro of default single-file mode + instruction; Run review warns clearly (kerfdesk-bit-changes.ts:31) and 13 lines incl. M3 and plunge are buffered past M0 under Run G-code file; grbl bfb67f0c protocol.c L546, system.c L131-132; not P1 (clear warning before Start), not P3 (default export, misleading sheet; ADR-392 Amd 2 calls a warn-only M0 file unusable); bytes are ADR-392 Amd 2 (c) residual, sheet text and default are new; gSender strips M0, CNCjs holds after M0, UGS passes it","known":false,"summary":"Setup package defaults to the single-file M0 program (CncSetupDocumentExport.tsx:25) and tells the operator to re-zero Z at each M0; GRBL takes no jog or Zero Z at M0 and the package's program can only run outside project Start, so cycle start cuts the next bit at the old Z zero (E3-P2-1 mechanism, not covered for setup packages)"},
  {"id":"F8-P3-1","severity":"P3","area":"cnc-output-viewer","file":"src/core/sim/removal-grid-display.ts","line":107,"anchor":"Twin: 2D shading reads the full grid (ADR-425 Consequences) vs Cut 3D pooled copy; Ground truth: replay of emitted program; ADR-425 item 5 promises grooves only in uncut stock","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED P3: 9x9 grid, one -2.5 column in a -2 floor pools to -2 in all blocks; same groove in stock shows -0.5; ADR-425 item 5 side effect, display-only","known":false,"summary":"Two-level display pooling erases narrow deeper grooves/gouges inside a cut floor: V60 lines 0.5 mm below a 2 mm recess floor 0.7-5.4% visible in Cut 3D vs 100% in the grid; 0.8 mm slot 46.7%"},
  {"id":"F8-P3-2","severity":"P3","area":"cnc-output-viewer","file":"src/core/output/cnc-grbl-strategy.ts","line":358,"anchor":"Ground truth: grbl gcode.c L796-806 (also grblHAL gcode.c L3789-3794, FluidNC GCode.cpp L1714-1720); Twin: laser emittedArc replay (cut-arc-moves.ts:237-259)","evidence":"REPRO+SOURCE","verdict":"CONFIRMED","refuter":"CONFIRMED latent P3: 0.127 gate vs grbl gcode.c L802-805; only producer is exact registration rings (tile-registration-passes.ts:39-46, translation keeps radii)","known":false,"summary":"Latent: CNC arc passes are written as native G2/G3 for end-radius mismatch up to 0.127 mm (circular-arc.ts:22); a 0.05 mm mismatch at r10 is error:33 on GRBL; only exact registration circles reach it today"},
  {"id":"F8-P3-3","severity":"P3","area":"cnc-output-viewer","file":"src/core/output/cnc-grbl-transitions.ts","line":133,"anchor":"Twin: formatGcodeDecimal for F words (decimal-word.ts:3-4); Ground truth: grbl gcode.c L322 unknown letter -> error:20","evidence":"REPRO+SOURCE","verdict":"CONFIRMED","refuter":"CONFIRMED P3, not P2: exponent only at >=1e21; GRBL refuses the line (E -> error:20, gcode.c L322), grblHAL and FluidNC refuse it as unused words; never misread; KerfDesk error is terminal and soft-resets","known":false,"summary":"A loaded project with spindleMaxRpm/spinup outside the UI ranges (deserializer accepts any positive) emits 'M3 S3e+21' and 'G4 P2e+21' with no preflight issue"},
  {"id":"F8-P3-4","severity":"P3","area":"cnc-output-viewer","file":"src/io/cnc/cnc-program-facts.ts","line":57,"anchor":"Twin: setup sheet/manifest vs emitted F/S words and Job Review (job-review-effective-operations.ts:215-217)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED P3: facts copy raw feed; emitter and Job Review floor (feed-word.ts:9-14); profile sheet 914.4 vs 26 F914 words","known":false,"summary":"Setup sheet prints feed 914.4 mm/min where the program sends F914 and Job Review shows 914"},
  {"id":"F8-P3-5","severity":"P3","area":"cnc-output-viewer","file":"src/io/cnc/cnc-tool-programs.ts","line":78,"anchor":"Twin: ADR-392 Amendment 2 Decision 1 tile bit-file headers (tile-bit-files.ts:80-90)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED P3: single-tool sections get no load/zero header (cnc-grbl-strategy.ts:116-124); tile bit files do (tile-bit-files.ts:80-90)","known":false,"summary":"Separate-tool files carry no 'load this bit and zero Z' header; tile bit files do"},
  {"id":"F8-K-1","severity":"P3","area":"cnc-output-viewer","file":"src/core/sim/stamp-toolpath.ts","line":264,"anchor":"Ground truth: replay","evidence":"REPRO","verdict":"KNOWN","known":"2026-09-24 PV-2; rolling-v2 18 K-13, 26 K-11","summary":"Half-cell sampling: micro engravings 0 cells at 9.86 mm grid; 0.8 mm slot edge cells; V-groove depth under-read up to 0.082 mm"},
  {"id":"F8-K-2","severity":"P2","area":"cnc-output-viewer","file":"src/core/job/toolpath-cnc.ts","line":83,"anchor":"Twin: emitter tool-change park","evidence":"READ","verdict":"KNOWN","known":"2026-09-29 P2-preview-2; E3 K-3","summary":"Tool-change park visits and park height not drawn"},
  {"id":"F8-K-3","severity":"P3","area":"cnc-output-viewer","file":"src/core/job/toolpath-cnc.ts","line":83,"anchor":"Twin: ADR-253 retract","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 09-P3-1 / K-5","summary":"Retract between passes not drawn"},
  {"id":"F8-K-4","severity":"P3","area":"cnc-output-viewer","file":"src/core/job/toolpath-cnc.ts","line":96,"anchor":"Twin: ADR-489 air descent","evidence":"READ","verdict":"KNOWN","known":"CNC v1 F3 note; 2026-09-29 preview items","summary":"Air-floor G0 descent drawn as a full plunge"},
  {"id":"F8-K-5","severity":"P3","area":"cnc-output-viewer","file":"src/core/cnc/cnc-output-precision.ts","line":21,"anchor":"Twin: string head comparison","evidence":"REPRO","verdict":"KNOWN","known":"2026-09-24 GC-3","summary":"-0.000 coordinate words (tiled-0.nc:584,593)"}
]
```
