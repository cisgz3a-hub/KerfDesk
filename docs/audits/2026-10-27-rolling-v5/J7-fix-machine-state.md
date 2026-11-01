# Rolling audit v5 — Machine-state fixes

- **When:** 2026-10-28, early morning +0800   **Tree:** origin/main @ `93334429e` (#1484 merged).
  - Merge commits: #1461 `50ff179e1`, #1454 `6f9df9786`, #1466 `1ce909730`, #1469 `3f31eef30`, #1457 `a59f74ff9`, #1446 `c05e26b62`. Later PRs on the same code: #1470 `7a459ef2d`, #1479 `99f570ead`, #1482 `4ffba1039`, #1484 `93334429e`.
  - **Repros ran on main's exact tree, not the worktree.** The worktree (`b4c9637c0` base) differs from main in 205 source files, including `laser-store.ts`, `laser-job-actions.ts` and `project-bed-reconciliation.ts`. So `git archive 93334429e` was unpacked to the scratchpad (`…\scratchpad\j7-main\`) with an NTFS junction to the repo's `node_modules`, and every Vitest file ran there. No tracked file and no repo file was touched.
  - **Test truth** was checked by swapping the PR's parent version of a file in with `vi.mock` (parent of each merge's first parent), in that same copy.
- **Scope:** fix verification (L10) and entry-point parity (L9) of:
  - #1461 (ADR-375 Amd 7): FluidNC `[key]value` lines and Smoothieware G20/G21 report units. Findings fixed: G4-P1-1, G4-P1-2.
  - #1454 (ADR-375 Amd 6): a comment or `/` in a Console `$` line. Finding fixed: meta M6-P2-1 (= C5-P3-1).
  - #1466 (ADR-500 Amd 2, ADR-440 Amd 6, ADR-637 Amd 3): same-machine Open keeps the machine, Keep current machine is an Undo step, profile import asks first, LightBurn GRBL variants flagged. Findings fixed: H4-P1-1, H9-P1-1, H4-P2-1, H4-P3-1.
  - #1469 (ADR-654 Amd 2): Place Board and camera-target Undo restore Start From. Finding fixed: H9-P2-1.
  - #1457 (ADR-327 Amd 1, ADR-491 Amd 2, ADR-433 Amd 4): CNC Job Origin anchors the artwork, park lift against the live Z top, preview parks, nest spacing from the bit. Findings fixed: M7-P2-3, M7-P1-2, M7-P2-5.
  - #1446 (ADR-375 Amd 5): grblHAL value checks and `$10` under a stock-GRBL profile. Finding fixed: M3-P3-3.
  - Later PRs on the same code: #1470 (ADR-375 Amd 8), #1479 (Amd 9), #1482 (ADR-440 Amd 8, ADR-654 Amd 4) and #1484.
- **Lenses run:** L10 (all six PRs), L9 (Console / macros / Run G-code file / phone / MCP; Open / import / Keep / Undo / remote Undo; Place Board / camera target / remote `finish_board`; Start / recovery / Run G-code file / exports for the park check), L8 (conflict survival of every added line, and the neighbours of each fix), L7 (pre-fix runs), L2 spot check of the Ortur `$$` claim behind #1446.
  - Not run: L5 (J3/J4 own the remote trust boundary), L4 beyond the interleavings named below.
- **Repros:** three temporary Vitest files plus four pre-fix swaps and fourteen existing test files, one at a time, from `…\scratchpad\j7-main\` with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> --silent=false --disableConsoleIntercept`. The files are listed under "Repro files" at the end.
- **Counts:** 4 raised → 0 refuted → P1 2 / P2 2 / P3 0 (+ 7 KNOWN re-observed). Refuter: 4 CONFIRMED, no severity change. One J7-P1-1 sub-claim (the recovery move from the recovery review) is refuted; the finding stands on the other moves.

## Headline

Every finding these six PRs name is fixed on main for the path it reported. Each regression test that was run on the pre-fix code fails there, and every line the PRs added is still on main except five that #1482 rewrote on purpose and the superseded emitter revision.

Four gaps remain on siblings:

- **J7-P1-1 (regression from #1461).** #1461 now records Smoothieware's inch reports after a Console G20, or at connect when the board was left in G20. KerfDesk's own origin writes then send a plain `G21` outside `M120`/`M121` (Restore saved origin, Place Board's corner origin, Set origin at the head-stop point). The board goes back to millimetres while KerfDesk keeps reading inches. In the simulator repro the next Move to position X60 from X100 sent `G0 X-2480.000 Y-2480.000`, and the recovery move to work point (10, 10) drove the head to X-1160 Y-1160, with no warning. (Refuter: the recovery review hides its move buttons in this state, so that move needs a direct call. Go to work zero drove the head to X-1170 instead, and a second Restore saved origin wrote `G92 X2490.000 Y2490.000`.)
- **J7-P1-2 (fix gap of #1461, named "Not done" in ADR-375 Amd 7).** A FluidNC board under the default stock-GRBL profile still takes `[13]1` and `[RST]#` as plain G-code. KerfDesk already knows the board is FluidNC (`detectedControllerKind: 'fluidnc'`). The repro reproduces G4-P1-1 in full: `[13]1` went out, the board reported inches, KerfDesk kept millimetres, and the next point move sent `$J=G91 G21 X56.063 Y56.063` (head to X156). `[RST]#` went out with the probed Work Z kept.
- **J7-P2-1 (twin of #1466).** A phone or MCP Undo can undo **Keep current machine**. The file's machine comes back with its notice on the PC only, and the remote receipt says nothing changed. In the repro the burn moved from `G1 X381 Y20` with a clamp collision to `G1 X20 Y380` with none.
- **J7-P2-2 (twin of #1457).** The park-lift Z-top check reaches Start, Job Review, recovery and phone/MCP Start, but not Run G-code file. Running a KerfDesk per-bit file there sends the same `G0 Z<park>` with no check.

## Fix verification (L10)

| PR | Original finding | Fixed on main? | Siblings (L9) | Regression (L8) | ADR matches code | Test fails pre-fix |
|---|---|---|---|---|---|---|
| #1461 | G4-P1-1: FluidNC `[13]1`, `[RST]#`, `[NVX]` sent as G-code | **Yes.** `fluidnc-bracket-console.test.ts` 10/10. `fluidncDollarForm` turns the line into its `$` form before every check (`fluidnc/driver.ts:62-77`) | Macros run the same `runConsoleCommand` → `driver.prepareConsoleCommand`. Run G-code file refuses `$` and `[` lines (ADR-630 item 11). MCP and phone have no console (`electron/mcp/machine-schemas.ts:56`). Long names and `report_inches` are refused too. **Gap: a FluidNC board under the stock-GRBL profile (J7-P1-2)** | None found | Yes, D1–D2. The Consequences say "Not done: a stock-GRBL profile talking to a FluidNC board does not translate bracket lines" (J7-P1-2) | **Yes, run:** 9 of 10 fail with the parent `fluidnc/driver.ts` (1 control passes) |
| #1461 | G4-P1-2: Smoothieware Console G20 → point moves 25.4× off | **Yes for the Console.** `smoothie-console-report-units.simulator.test.ts` 5/5: `G20` → `$G` → `reportInches: true`, and the move lands on X60 Y60 | Opened programs hide the position (`external-program-controller-state.ts` `reportUnitsPart`); connect-time `$G` sets the units; Frame selects G21 (`frame-report-units.ts:70-74`). **Gap: KerfDesk's own `G21` writes are not tracked (J7-P1-1)** | **J7-P1-1:** before #1461 KerfDesk never read inches on Smoothieware, so its own `G21` writes kept the two in step. Now they split them the other way | D3–D5 yes. The Consequence that the units "are not changed behind the operator's back" is false for KerfDesk's own writes (J7-P1-1) | **Yes, run:** 4 of 5 fail with the parent `smoothieware/driver.ts`; the recovery move lands at X88.819 instead of X60 |
| #1454 | M6-P2-1: `(x)$30=255`, `$30(x)=255`, `$/30=255`, `$RST(x)=*` sent unchecked | **Yes.** `console-command-comments.test.ts` 118/118 across GRBL, grblHAL and FluidNC; `laser-store-console-disguised-commands.test.ts` 12/12 | grblHAL and the Falcon contract wrap the shared classifier (`grblhal/driver.ts:44-46`, `falcon-command-contract.ts:40-45`); FluidNC calls it after its own translation; macros share the path. `grblLineReaderView` matches gnea/grbl `protocol.c` byte by byte, including `;` inside `( … )` and an unclosed `(` | None found | Yes. D1's FluidNC claim was corrected by Amd 7 | **Yes, run:** 87 of 118 fail with the parent `grbl/console-command.ts` |
| #1466 | H4-P1-1: same-machine Open reverts origin, zones … | **Yes.** `opened-machine-kept.test.tsx` 6/6. `withCurrentMachineSetup` keeps every device field and the CNC head's values (`project-bed-reconciliation.ts:169-183`) | Every Open path goes through `setProject`: File Open, Recent, templates, autosave restore, sheet switch and production rows (7 callers, grep). The bed-differs branch (J5-P2-2) is fixed by #1482: `opened-machine-older-bed-and-origin.test.tsx` 5/5 | None found. #1482 rewrote 5 of #1466's lines on purpose (`replacedSetupLabels` → `differingSetupLabels`) | Yes, ADR-500 Amd 2 D1–D4 | **Yes, run:** 5 of 6 fail with the parent `project-actions.ts` and persistence hook |
| #1466 | H9-P1-1: Undo/Redo after Keep reinstalls the file's machine | **Yes on the desktop.** Keep pushes its own step, clears Redo and captures the context, which now holds the notice (`project-actions.ts:236-247`, `setup-history-context.ts:15,29`). The persistence hook pauses while the notice is open (`use-machine-profile-persistence.ts:21`); `use-machine-profile-persistence.test.tsx` 19/19 | **Gap: phone/MCP Undo (J7-P2-1).** The notice is read only by the PC banner and the persistence hook | Undo of any context step taken before the notice was answered asks again. This is documented (ADR-440 Amd 6 Consequences), so it is not raised | D1–D3 yes; D2's "the operator sees the question again" holds only for a desktop Undo | Same run as above |
| #1466 | H4-P2-1: profile import replaces zones and calibrations without asking | **Yes.** `DeviceSetupIdentifyStep.import.test.tsx` 3/3 | `ImportExportPanel` has one caller, and `MachineSetupImportExport.tsx` is the only `.lbdev`/`.lfmachine` reader in `src/ui` and `electron` | None | ADR-637 Amd 3 D1–D3 yes | Not run (the `replaces` prop is new) |
| #1466 | H4-P3-1: vendor `.lbdev` imports silently as stock GRBL | **Yes, as a review row** (`lbdev-import.ts` `grblVariantReview`) | — | — | D4 yes (no catalogue mapping, by choice) | Not run |
| #1469 | H9-P2-1: Place Board / camera-target Undo leaves Start From behind | **Yes.** `board-capture-undo.test.ts` 5/5 (capture, circle, outline at 5°, resize, a later edit); `calibration-actions.test.ts` 10/10 | Remote `finish_board` drives the same panel handlers (`machine-board-panel.test.tsx`). The other `setJobPlacement` callers are explicit placement edits (`JobPlacementControls`, `NoHomingPositionGuide`, `set-origin-placement`). The other `replaceSceneWithGeneratedScene` callers pass no placement. The remote changes no placement | None. The captured context now also carries the machine notice (above) | D1–D3 yes. D3 deliberately adds no notice for an outline Undo; the output then matches the canvas | By reasoning: the parent code has no context capture, and the H9 refuter's pre-fix output is exactly what the new asserts reject |
| #1457 | M7-P2-3: CNC anchor on the cutter's reach | **Yes.** `prepare-output-cnc-design-anchor.test.ts` 5/5 | Start, Save and the setup package use design bounds; tiles use their own frame; recovery uses the archived job (H3 L9 table, re-read) | None found | ADR-327 Amd 1 D1–D5 yes | By reasoning (the pre-fix reach anchor is M7's repro) |
| #1457 | M7-P1-2: park lift past the Z top, silent | **Yes for Start.** `cnc-park-z-top.test.ts` 11/11. Start warning (`start-job-readiness-policy.ts:76`), Job Review row, recovery and phone/MCP Start (same policy) | **Gap: Run G-code file of a KerfDesk per-bit file (J7-P2-2).** The lift the check uses (`cncHighestLiftMm`) equals the emitted `parkHeightMm` (group `safeZMm`/`parkZMm` come only from `params`) | None | D1–D5 yes; D1 does not scope out Run G-code file | New module (fails by absence) |
| #1457 | M7-P2-5: preview parks; Quick Nest 2 mm | **Yes.** `toolpath-cnc-parks.test.ts` 3/3; Quick Nest and Production nest both take `cncNestSpacing` | Dock padding is not a nest | None | ADR-491 Amd 2 D5, ADR-433 Amd 4 yes | By reasoning |
| #1446 | M3-P3-3: `$100=26,67` on grblHAL under a GRBL profile | **Yes.** `laser-store-console-setting-writes.test.ts` 16/16 | The re-read now flags a partly stored value on every driver (a level-2 build that shows nothing); `$10` and the `Pn:` hint read grblHAL's layout from the dump; FluidNC drops the mask entry (`fluidnc/driver.ts:110`) | None | Yes, D1–D5. **L2 check:** Ortur `system.c` @ `4849ac85` calls `report_grbl_settings(true)` for `$$` at `COMPATIBILITY_LEVEL <= 1`, and `report.c` prints the control-invert and pull-up settings when `all` is set, so the "settings" evidence does fire on Ortur's level-1 build | By reasoning (`session` is a new parameter) |
| Later | #1470, #1479, #1482, #1484 | — | #1470's `jog-hold-aim.ts` scales by `reportInches`, so it inherits J7-P1-1 as a consumer. #1479's LASER OFF goes through `sendConsoleCommand` with `M5`, which has no units or `$` interplay. #1482 rewrote #1466's label helper and kept its behaviour. #1484 touches none of the J7 PRs' files (script) | — | — | — |

**Conflict survival (L8).** For each of the six merges, every added non-comment `src` line was grepped in main's version of its file:

| PR | Added lines | Missing on main |
|---|---|---|
| #1461 | 214 | 0 |
| #1454 | 52 | 0 |
| #1466 | 237 | 5, all in `project-bed-reconciliation.ts`, rewritten by #1482 (`differingSetupLabels`, Auto-focus moved to a named label) |
| #1469 | 51 | 0 |
| #1457 | 462 | 1, `EMITTER_REVISION` v33, superseded by later bumps |
| #1446 | 146 | 0 |

Of the later PRs, only #1470 (`store.ts`) and #1482 (`start-job-readiness-policy.ts`, `project-bed-reconciliation.ts`) share files with the J7 PRs.

## Findings

### J7-P1-1 — After #1461 reads Smoothieware's inch reports, KerfDesk's own origin writes send a plain `G21`; the board reports millimetres again while KerfDesk reads inches, and the next point move lands 25.4 × off

- **Where:**
  - `src/ui/state/laser-origin-restore.ts:188`: `if (!grblFamily) await write('G21\n');`. This is inside `writeXyOffset` (`:155`), which serves:
    - `restoreWorkOrigin` (`:70`; the checkpoint/recovery banner's Restore saved origin, `CheckpointResumeBanner.tsx:150`);
    - `setOriginAtMachinePoint` (`:80`; Place Board's corner origin, `use-board-capture-handlers.ts:253`, `use-board-outline-handlers.ts:58`);
    - `setOriginAtProgramPoint` (`:107`; continue from the head-stop point, `CheckpointResumeBanner.tsx:151`).
  - Units are tracked only for Console lines (`laser-console-settings-write.ts:32`), opened programs (`external-program-controller-state.ts` `reportUnitsPart`), `[GC:]` reports (`laser-line-handler.ts:236-243`) and Frame (`frame-report-units.ts:70-74`). Owned writes are never passed to `reportUnitsSelectedBy`.
  - The point move scales the raw report by `reportInches` (`laser-jog-actions.ts:96-100`). So do the recovery move, Go to work zero and the hold aim (`jog-hold-aim.ts:55`).
  - Other owned `G21` lines with the same effect (READ, not run):
    - Auto-focus sends `G21` and `G90` before a `G38.2`/`G38.4` command (`autofocus-action.ts:76`);
    - the camera ring job runs with `requireFrame: false` (`transient-camera-job.ts:66`), and its Smoothieware program starts with `G21` (`smoothieware-strategy.ts:10` builds on `grbl-strategy.ts:96`).
- **Anchor:**
  - **Ground truth** (as cited by ADR-375 Amd 7 at Smoothieware `91fe4286`): G21 clears inch mode (Robot.cpp L601-L602). Outside `M120`/`M121` nothing restores it, and MPos/WPos are printed through `from_millimeters` (Kernel.cpp L262-L287).
  - **Contract:** ADR-375 Amendment 7 Consequences (`ADR-375-amendment-7-bracket-lines-and-gcode-report-units.md:119-121`): after a Console G20, the DRO, point moves, Go to work zero and the recovery move "use the board's own units, which are not changed behind the operator's back". KerfDesk's own `G21` changes them behind its own back.
  - **Twin:** Frame sends the same `G21` and records millimetres in the same step (`frame-report-units.ts:70-74`); the origin writes do not.
  - **L8:** before #1461, `reportInches` was never true on Smoothieware, so these `G21` writes could only bring the two back into step.
- **Scenario:**
  1. A Smoothieware laser is in G20, either from a Console `G20` or left by an earlier program and read at connect (ADR-375 Amd 7: "A board left in G20 is read in inches at connect"). KerfDesk now reads inches, correctly.
  2. The operator uses Place Board, Restore saved origin after a link loss, or Continue from the head-stop point. KerfDesk writes `G21`, then the `G92`, both correct.
  3. The board now reports millimetres. KerfDesk still multiplies by 25.4, so the DRO says X2540 for a head at X100. No notice or toast appears, and `lastWriteError` stays null.
  4. The next Move to position, Go to work zero or recovery move computes its delta from that number. The head drives about 2.4 m toward the stops. (Refuter: the recovery move is not offered here, because the review sees Origin now differ from Origin then. See Refuted.)
  5. Only a later Frame or a `$G` corrects it.
- **Evidence:** REPRO, `…\scratchpad\j7-main\src\ui\state\zz-j7-smoothie-owned-g21.simulator.test.ts`, 4 passed.
  - **Setup:** the repo's `createSmoothieSimulator` inside #1461's own inch-mode wrapper, copied from `smoothie-console-report-units.simulator.test.ts`. G20/G21 set the mode, M120/M121 push and pop it, MPos/WPos are divided by 25.4 in inches, and `$G` names the mode. The calls are the real store actions.
  - **Console G20, then Place Board origin:**
    - `after-G20 {"reportInches":true,"mPosX":3.937,"sim":{"x":100,…}}`;
    - `after-origin {"reportInches":true,"mPosX":100,"written":["G21\n","G92 X50.000 Y50.000\n"]}`;
    - `jogToMachinePosition(60,60)` → `"…M120\nG21\nG91\nG0 X-2480.000 Y-2480.000 F3000\nG90\nM121\n"`, `sim {"x":-2380,"y":-2380}`, `lastWriteError: null`.
  - **Board left in G20 at connect, then Restore saved origin (50, 50):**
    - the same `G21` + `G92`, then Move to X60 → `sim {"x":-2380,"y":-2380}`;
    - the recovery move `moveHeadToWorkPoint({x:10,y:10})` (expected machine 60, 60) → `sim {"x":-1160,"y":-1160}`.
  - **Control without G20:** the same origin and move land at `{"x":60,"y":60}` with `G0 X-40.000 Y-40.000`.
- **Severity:** P1. A reachable machine move to a wrong position, about 2.4 m off, with no warning (METHOD §3). The DRO's impossible number is not a warning of the mismatch (§3, 2026-10-27).
- **Novelty:** new. G4-P1-2 is the Console G20 itself, which #1461 fixed. No audit names `laser-origin-restore.ts` or owned `G21` writes with report units (`grep` of `docs/audits`). No open PRs.
- **Refuter:** **CONFIRMED**, P1 kept.
  - **Repro.** I wrote my own simulator repro on main's tree. Inch mode is modelled from Smoothieware `91fe4286`, re-fetched: Robot.cpp L344-L365 and L601-L602, Kernel.cpp L262-L287, Robot.h L52-L53.
    - Console G20, then Place Board origin: KerfDesk wrote `G21` then `G92 X50.000 Y50.000`. Move to X60 sent `G0 X-2480.000 Y-2480.000`, and the head went to X-2380.
    - Board left in G20 at connect, then Place Board origin, then Go to work zero: the target was X1270 and the head went to X-1170.
    - Continue from where the head stopped wrote the same `G21`. It then rejected as unconfirmed, and the next Move to X60 still went to X-2380.
  - **Regression.** `gh pr view 1461` confirms #1461 added `reportUnitsSelectedBy` to the Smoothieware driver and the `[GC:]` units patch to the line handler. Its parent has neither.
  - **Warnings at the three entry points.** None names the units.
    - Place Board and Restore resolve and write only a Console line ("…has not confirmed the new work offset … jog once to refresh it before Start"). No toast appears, and `lastWriteError` stays null.
    - Head-stop rejects with "the controller has not confirmed the new work offset".
  - **Correction.** The recovery move is not reachable from the review in this state (see Refuted).
  - **Worse than reported.** The review keeps offering Restore saved origin. A second press wrote `G92 X2490.000 Y2490.000`, which moves the board's own work zero to machine X-2390 Y-2390.
- **Fix direction:**
  - Treat every owned write on a driver with `reportUnitsSelectedBy` like a Console line: record the units it selects, as Frame does. Or wrap the origin `G21` in `M120`/`M121`, as the jog does.
  - Do the same for Auto-focus's setup lines and for any stream installed without a Frame.
  - Add the owned-write cases to `smoothie-console-report-units.simulator.test.ts`.

### J7-P1-2 — A FluidNC board under the stock-GRBL profile still takes `[13]1` and `[RST]#` as plain G-code; G4-P1-1 reproduces in full although KerfDesk has detected FluidNC

- **Where:**
  - `src/core/controllers/fluidnc/driver.ts:62-65`: the bracket translation lives only in the FluidNC driver.
  - Under a stock-GRBL profile, the driver is `grblDriver` (`grbl/driver.ts:95`). Its classifier passes `[13]1` as `gcode`/`machine-state`, because `disguisedSystemCommandRefusal` acts only when GRBL's view starts with `$` (`grbl/console-command.ts:100-101`).
  - The session already knows the board: `detectControllerFromBanner` matches `Grbl x [FluidNC` (`detect-controller.ts:15`), and the repro shows `detectedControllerKind: "fluidnc"`.
  - ADR-375 Amd 7 Consequences (`:128-132`) list "A stock-GRBL profile talking to a FluidNC board does not translate bracket lines" under "Not done".
- **Anchor:**
  - **Ground truth:** FluidNC v4.0.3 runs `[key]value` as `$key=value`. ADR-375 Amd 7 Context cites ProcessSettings.cpp L1209-L1240, L1080 and Report.cpp L82-L84 at `25ae119b`, as re-fetched by G4's refuter.
  - **Contract:** ADR-375 Amendment 6 Decision 1 (`:56-70`): a line is sent "only if … both readings get the same safeguards", and "This holds on every GRBL-family profile". The board's reading of `[13]1` is `$13=1`, which this profile confirms and re-reads.
  - **Twin:** #1446 (ADR-375 Amd 5) keys grblHAL's checks on what the session shows under a stock-GRBL profile. The same pattern was not applied to FluidNC.
- **Scenario:** a FluidNC board is connected under the default GRBL profile (D6 shows this case: the connection card still says GRBL v1.1).
  1. The operator types `[13]1`. KerfDesk sends it with no prompt and no `$$` re-read, and the board now reports inches.
  2. The next Move to position from X100 to X60 sends `$J=G91 G21 X56.063 Y56.063`, so the head goes to X156.
  3. `[RST]#` is also sent. It wipes G54–G59 while the probed Work Z stays current.
  4. In the same session, `$13=1` asks for confirmation and `$RST=#` is blocked.
- **Evidence:** REPRO, `…\scratchpad\j7-main\src\ui\state\zz-j7-fluidnc-under-grbl.test.ts`, 4 passed. The test uses G4's FluidNC board model from `fluidnc-bracket-console.test.ts`, connected with `controllerKind: 'grbl-v1.1'`.
  - `[13]1 {"driver":"grbl-v1.1","detected":"fluidnc","consoleResult":"sent","boardInches":true,"reportInches":false,"sent":["[13]1\n","$J=G91 G21 X56.063 Y56.063 F1000\n",…],"toasts":null}`
  - `[RST]# {"consoleResult":"sent","workZKept":true,"sent":["[RST]#\n",…]}`
  - `$13=1 {"consoleResult":"refused: … needs confirmation."}`; `$RST=# {"consoleResult":"refused: … blocked in the Console …"}`
- **Severity:** P1 by effect. The move is 96 mm off and an offset wipe goes unannounced, the same as G4-P1-1; §3 has no reach clause.
  - The only signals are the identity line in the Console transcript at connect and Job Review's firmware row (D6). Neither names the units, and neither comes before a point move.
  - A refuter may weigh that the ADR records it as "Not done". That records the gap; it does not decide it is safe.
- **Novelty:**
  - It is new as a finding. Only ADR-375 Amd 7's "Not done" line names it.
  - Family: M4-P3-8 (FluidNC/grblHAL under a GRBL profile in Run G-code file review, P3) and D6's connection-card P3. Neither covers the Console.
  - No open PRs.
- **Refuter:** **CONFIRMED**, P1 kept.
  - **Repro.** I built my own FluidNC model and ran it through the real store on the stock-GRBL profile. The model follows FluidNC v4.0.3 `25ae119b`, re-fetched: `execute_line` sends `$` and `[` lines to `settings_execute_line` (ProcessSettings.cpp L1209-L1240, L1067, L1080; Report.cpp L82-L84).
    - `[13]1` and `[Report/Inches]1` were sent. The board reported inches while `reportInches` stayed false, and Move to X60 from X100 sent `$J=G91 G21 X56.063 Y56.063`, putting the head at X156.063.
    - `[RST]#` was sent. The board's G54 Z went from -30 to 0, while the Work Z evidence and its epoch stayed current.
    - `$13=1` asked for confirmation, and the FluidNC profile refused `[13]1`.
  - **Warnings.** Two signals exist, and neither names the units or the bracket line:
    - the connect-time Console line "Controller banner looks like fluidnc, but the profile selected grbl-v1.1. Check the device profile's controller setting.";
    - Job Review's identity row (`controller-identity-warnings.ts:64-72`).

    So §3 does not lower it. The "Not done" in ADR-375 Amd 7 records the gap; it is not a warning to the operator.
  - **Contract.** `grbl/console-command.ts:91-95` already says a stock-GRBL profile may be talking to FluidNC.
  - **Novelty.** C6-P3-1 and G4-P1-1 covered only the FluidNC profile.
- **Fix direction:** run `fluidncDollarForm` (and the long-name translation) in the stock driver's Console path whenever the session shows FluidNC (`detectedControllerKind === 'fluidnc'`), as #1446 does for grblHAL. Alternatively, refuse a line starting with `[` on any GRBL-family profile unless it is a known WebUI `[ESP…]` form.

### J7-P2-1 — A phone or MCP Undo can undo **Keep current machine**: the file's machine comes back with its notice on the PC only, and the remote receipt reports nothing changed

- **Where:**
  - `src/ui/remote-control/arrange.ts:209-218` (`applyHistory`): it calls the store's `undo`/`redo`. The receipt is changed artwork ids plus `historyProjection` (`authoring-projections.ts:10-12`: `canUndo`/`canRedo` only).
  - `keepCurrentMachinePatch` makes Keep an Undo step (`project-actions.ts:236-247`). Undoing it restores the file's machine and `projectBedReconciliation` from the context (`setup-history-context.ts:29`).
  - `projectBedReconciliation` has two readers, the PC banner and the persistence hook (`git grep`; nothing in `src/ui/remote-control`, `services/remote-control/app` or `electron/mcp`). No Start or Job Review check reads it.
- **Anchor:**
  - **Contract:** ADR-440 Amendment 6 Decision 2: "Undoing Keep brings back the file's machine together with its notice, so the operator sees the question again". D1 says the Undo list names the step. Neither holds for the remote caller.
  - **Twin (L9):** desktop Undo vs phone/MCP Undo of the same step.
  - **Contract:** ADR-569's phone-only workflow (import → Frame → Review → Start) never shows the PC banner.
- **Scenario:**
  1. On the PC the operator opens a file saved before an origin and bed correction, and chooses **Keep current machine**. The machine is rear-right, 400 × 410, with a clamp zone.
  2. At the machine, the phone (or an MCP agent) sends Undo, for example a second Undo after undoing its own last move, or with no phone edits left. Keep is the step undone.
  3. The receipt is `{"changedArtworkIds":[],…}`. The phone shows no machine change.
  4. The phone's Frame → Start burns with the file's front-left, 400 × 400 machine and no clamp zone.
- **Evidence:** REPRO, `…\scratchpad\j7-main\src\ui\app\zz-j7-remote-undo-keep.test.tsx`, first case. Setup: the real store, persistence hook and banner, a file round-tripped with `serializeProject`/`deserializeProject`, and output from `emitGcode`.
  - `after-keep {"origin":"rear-right","zones":1,"bed":410,"notice":false,"burn":{"line":"G1 X381.000 Y20.000 F1500 S500","noGo":1}}`
  - `after-remote-undo {"receipt":{"changedArtworkIds":[],"selection":["line-object"],"history":{"canUndo":false,"canRedo":true}},"origin":"front-left","zones":0,"bed":400,"notice":true,"burn":{"line":"G1 X20.000 Y380.000 F1500 S500","noGo":0},"pcToasts":[]}`
- **Severity:** P2.
  - The burn moves about 360 mm per axis and a clamp guard drops.
  - The app does show the specific mismatch, on the PC banner, naming the bed, origin and zones (ADR-440 Amd 8). That is why it is not P1.
  - A refuter may argue P1 for the phone-only workflow, where no warning reaches the operator who acted.
- **Novelty:**
  - H9-P3-1 (open) is a different gap in the same receipt: a refusal reported as an ordinary `ok`.
  - H8 marked remote Undo clean, deferring to H9.
  - H9-P1-1's fix assumed a desktop Undo.
  - A remote Undo of any other machine step (a Machine Setup save, a device edit) has the same silent receipt. That predates #1466 and is not raised separately.
  - No open PRs.
- **Refuter:** **CONFIRMED**, P2 kept.
  - **Repro.** I ran my own repro through the real remote dispatcher, `applyRemoteWrite({command:'undo'})` (`writes.ts:115-117`).
    - After Keep, the Undo depth was 1, so the phone's Undo was enabled with no phone edits.
    - The receipt was `{changedArtworkIds:[], history:{canUndo:false,canRedo:true}}`.
    - The machine went back to front-left, 400 × 400, with no zones.
    - The first burn moved from `G1 X30 Y10` to `G1 X30 Y390`, and clamp collisions fell from 5 to 0.
    - The PC banner came back naming origin and no-go zones. No toast appeared.
  - **Guards.** The write gate (`adapter.ts:288-295`) checks only permission, `pendingUndo` and the revision. `git grep` finds no `projectBedReconciliation` reader in the remote code, MCP, Start or Job Review.
  - **Severity.** P1 is not adopted, because the app shows the specific mismatch on the PC before any output. The coordinator may weigh strict §3 for the phone-only workflow.
- **Fix direction:**
  - Name the undone step in the remote receipt, and return a machine-change notice when the step changed the device.
  - Or have phone/MCP Start (and its Review) carry an open machine notice as a warning.
  - Or refuse a remote Undo of a machine step.

### J7-P2-2 — The park-lift Z-top check (#1457) reaches every Start but not Run G-code file, where a KerfDesk per-bit file sends the same park lift

- **Where:**
  - `checkCncLiftAgainstZTop` / `detectCncParkZTopWarnings` (`src/ui/laser/cnc-park-z-top.ts:39,72`) are called only from `start-job-readiness-policy.ts:76` and `JobReviewMachineSection.tsx:84` (`git grep`).
  - The Run G-code file review keeps an XY-only envelope (`core/external-program/external-program-review.ts:25-30`). Neither `src/ui/gcode-inspector` nor `src/core/external-program` reads `zTravelMm` or the firmware Z limits.
  - Per-bit setup-package files (the default since ADR-392 Amd 3) end with the same park as the combined program (H3, `H3-cnc-journey.md:315`). #1472 made Run G-code file treat the gap between them like an in-app bit change.
- **Anchor:**
  - **Twin (L9):** Start vs Run G-code file of the same KerfDesk program; the live inputs (`$$`, Home, WCO) are the same session's.
  - **Contract:** ADR-491 Amendment 2 Decision 1, "The lift is checked against the machine's Z top when the inputs are known". In Run G-code file they are known.
- **Scenario:**
  1. A homed router has 75 mm of Z travel and limits off. The stock top is zeroed 40 mm below the homed top. Park height is 50.
  2. In-app Start warns "… 10 mm past the top of Z travel …".
  3. The operator saves the setup package instead, and runs each per-bit file with Run G-code file.
  4. Each file ends with `G0 Z50.000` (machine Z +10), and the review says nothing. Z stalls on its stop. A bit-change stall is healed by the next file's required Zero Z (#1472). The last file's job-end stall carries into the next job on that zero, which cuts deeper (M7-P1-2).
- **Evidence:** READ (callers above, `git grep` on main). The emitted lift was not re-run; the per-bit park is H3's verified-clean row.
- **Severity:** P2, matching its parent M7-P1-2 (P2 after its refuter) and H3-P2-1, a warning missing on the setup-package path. A refuter may lower it to P3: Run G-code file has never checked Z, and H3's L9 table marked this cell "n/a".
- **Novelty:** H3 listed "Run G-code file of a KerfDesk file: n/a" for the park check (`H3-cnc-journey.md:48`) without raising it. Not elsewhere in `docs/audits/`. No open PRs.
- **Refuter:** **CONFIRMED** by two lines of evidence. P2 kept.
  - **Callers.** `git grep` on main finds the two checks called only at `start-job-readiness-policy.ts:76` and `JobReviewMachineSection.tsx:84`. `external-program-review.ts:25-38` reviews only the XY envelope, the units and warnings.
  - **Emitted lift.** `cnc-tool-programs.test.ts` passed 9/9 on main's tree. It asserts that every per-bit file ends with `G0 Z<park>`, `M5`, `M9` and the park XY.
  - **Contract.** ADR-491 Amd 2 D2 puts the warning on Start only.
  - **Not P3.** The default package (ADR-392 Amd 3) reaches it today, with the same physical effect as M7-P1-2 (P2). That Run G-code file never checked Z makes the gap older, not latent.
  - **Not P1,** for M7's reasons: the lift is the operator's park height, the limits alarm when on, and the next file's Zero Z heals a bit-change stall.
- **Fix direction:**
  - Give the external review a Z envelope (work-Z max and min from the parser).
  - Run `checkCncLiftAgainstZTop` on its maximum with the same live evidence.
  - Add a Run-review warning with the same wording.

## KNOWN re-observed

- **G4-K-3 = controller v2 C5-P3-2 (P3).** FluidNC file and WebUI commands (`$SD/Run=`, `[ESP700]`, …) still go out unconfirmed. Since #1461 the bracket forms are classified like their `$` forms, which are still open (ADR-375 Amd 7 "Not done").
- **M4-P3-8 / G4-K-1 (P3).** Under a GRBL profile, a FluidNC or grblHAL board's opened program is reviewed by the profile kind. This is the Run G-code file sibling of J7-P1-2.
- **D6 connection card (P3).** A FluidNC board under a GRBL profile shows "GRBL v1.1" on the connection card, and the identity mismatch is only a transcript line and a Job Review row. It is the only signal for J7-P1-2.
- **H9-P3-1 (P3).** A remote Undo that the job lock refuses still returns a plain receipt: `applyHistory` is unchanged (`arrange.ts:209-218`). J7-P2-1 is another gap in the same receipt.
- **G4-K-4 = E4-P3-1 (P3).** `takesAxisWords` still lacks `G49`. Seen in passing, not re-run.
- **ADR-500 Amd 2 Consequence (documented, not a finding).** **New** with a machine notice still open keeps the file's machine for the fresh canvas and closes the notice. The ADR records this as "left as it was".
- **ADR-440 Amd 6 Consequence (documented, not a finding).** Undoing a context step taken before the notice was answered brings the notice back, even after **Use project machine**. Reproduced (`zz-j7-remote-undo-keep.test.tsx`, second case: `after-undo-capture {"notice":true,…}` after a Place Board capture, Use project machine and two Undos). The ADR states it: "Answering again is the only cost".

## Refuted

Candidates the auditor checked and dropped:

- **#1466 keeps the file's job placement with the kept machine's homing, so Absolute can arrive on a machine whose homing was turned off since.** Not raised. ADR-500 Amd 2 D1 keeps the job's placement on purpose, and the operator can choose Absolute on an unhomed profile directly. `resolveAbsolute` does not refuse it (`job-placement.ts:228-244`). Whether Start or Job Review warns about an unhomed Absolute was not traced (see Not verified).
- **`cachedCncMachine` after a same-machine Open of a Laser file brings the file's CNC values.** Refuted. It is `setup.project.parkedCncMachine` (current values via `withCncParams`) or the resolution's parked copy, which is null when there is none (`project-actions.ts:107`, `project-machine-capability.ts:63-73`).
- **ADR-654 Amd 2 leaves no word after an outline-registration Undo (the H9 refuter's sub-site).** Not raised. D3 decides no new warning, and after Undo the output follows the restored canvas at Absolute (`board-capture-undo.test.ts`, outline case).
- **#1461's units patch misreads a GRBL `$G`.** Refuted. `captureModalReport` applies units only when the driver declares `reportUnitsSelectedBy`, which only Smoothieware does (`laser-line-handler.ts:241-243`, `smoothieware/driver.ts:121`).
- **The Smoothieware jog's own `M120 … G21 … M121` desyncs the units.** Refuted. It is not a Console line, so it is not tracked, and M121 restores the mode it saved (the simulator wrapper models this; the existing test lands on X60).
- **`[13](x)1`, `[RST(x)]#`, `[ 13 ]1` on the FluidNC profile.** Refuted by reading:
  - `$13=(x)1` is a setting write, refused on the FluidNC profile;
  - `$RST(x)=#` meets the comment check, whose view `$RST=#` is blocked;
  - `$ 13 =1` is compacted to `$13=1` and refused.
- **#1446's grblHAL evidence never fires on Ortur's level-1 build.** Refuted at the source (L2, above).
- **J7-P1-1's recovery move from the recovery review.** Refuted by the refuter; the finding stands on Move to position, Go to work zero, Place Board's own moves and a second Restore.
  - On a board left in G20, the review after Restore saved origin reads Origin now 1270, 1270 against Origin then 50, 50.
  - So `originInPlace` is false and Move to job points is hidden (`LaserRecoveryPlacement.tsx:92,128`).
  - The X-1160 move needs a direct `moveHeadToWorkPoint` call.

## Verified clean

- **Every added line survives** (script above); the only rewrites are #1482's intended ones.
- **#1454 classifier** across GRBL, grblHAL, FluidNC and the Falcon wrapper, including `;` inside a parenthesis comment, an unclosed `(`, `)` before `$`, and value comments kept as setting writes. The stock value reader `stockGrblSettingValue` strips comments the same way (`console-setting-writes.ts:130-143`).
- **#1461 FluidNC profile:** `[13]1`, `[Report/Inches]1`, `$Report/Inches=1`, `[RST]#`, `[rst]*`, `[Settings/Restore]#`, `[NVX]`, `[Settings/Erase]`, `$report_inches=on` and `[report_inches]true` are all refused with nothing written (10/10).
- **#1461 Smoothieware, Console and opened programs:** a `$G` that names no units keeps the position hidden and refuses a point move; a G21 while reading millimetres reads nothing back.
- **#1466 Open paths:** all seven `setProject` callers. Keep is a named Undo step, Redo is cleared, and the persistence hook saves nothing while a notice for another machine is open (19/19).
- **#1466 import:** a single `ImportExportPanel` caller and a single machine-profile file reader in the UI.
- **#1469:** all three Place Board writes and the camera target capture the context. Redo restores User Origin, and a later edit's Undo keeps it (5/5, 10/10).
- **#1457:** the checked lift equals the emitted `parkHeightMm` (group safe Z and park Z come only from `params`). The check runs for Start, recovery and phone/MCP Start. Both nest dialogs take `cncNestSpacing`.
- **#1446:** stock check first, then grblHAL check with the evidence named; the partial-store re-read works on every driver (16/16).

## Not verified

- **Hardware:** none was used. Smoothieware and FluidNC behaviour comes from the repo's simulators plus the inch-mode and bracket models in #1461's own tests.
- **J7-P1-1's READ siblings** (Auto-focus `G21`; the camera ring job on Smoothieware) were not run. Whether a Smoothieware profile exposes Auto-focus with a `G38.2` command in the UI was not traced.
- **J7-P2-2:** the per-bit file's last park line was taken from H3's verified row, not regenerated here.
- **#1457 V-bit Frame reach** and two-sided placement were not re-run (ADR-327 Amd 1 D3 keeps the reach for motion; tests updated in the PR).
- **A same-machine Open of a file saved at Absolute after homing was turned off** (#1466 keeps the job's placement with the current machine). Whether Start or Job Review warns about Absolute on an unhomed profile was not traced.
- **#1469 and #1457 pre-fix runs:** these were judged by reasoning, not swapped in, because each spans four or more files.

## Repro files

No file was created in the repo. The scratchpad copy of main is `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\`. Its `node_modules` is an NTFS junction to the repo's: remove it with `cmd /c rmdir …\j7-main\node_modules` before deleting the folder, or the delete follows the junction.

| File (under `j7-main\`) | Purpose |
|---|---|
| `src\ui\state\zz-j7-smoothie-owned-g21.simulator.test.ts` | J7-P1-1: Console G20 or board in G20 at connect → owned origin `G21` → point move and recovery move |
| `src\ui\state\zz-j7-fluidnc-under-grbl.test.ts` | J7-P1-2: FluidNC board model under the stock-GRBL profile |
| `src\ui\app\zz-j7-remote-undo-keep.test.tsx` | J7-P2-1 (remote Undo of Keep), and the documented notice re-ask |
| `src\ui\state\zz-j7-prefix-fluidnc-bracket.test.ts` + `src\core\controllers\fluidnc\zz-j7-prefix-driver.ts` | #1461 FluidNC test against the parent driver |
| `src\ui\state\zz-j7-prefix-smoothie-units.simulator.test.ts` + `src\core\controllers\smoothieware\zz-j7-prefix-driver.ts` | #1461 Smoothieware test against the parent driver |
| `src\core\controllers\grbl\zz-j7-prefix-comments.test.ts` + `zz-j7-prefix-console-command.ts` | #1454 test against the parent classifier |
| `src\ui\app\zz-j7-prefix-opened-machine-kept.test.tsx` + `src\ui\state\zz-j7-prefix-project-actions.ts` + `src\ui\app\zz-j7-prefix-persistence.ts` | #1466 test against the parent actions and hook |

**Refuter.**
- **Tree check.** All 10,119 files of `j7-main` that are tracked on `origin/main` hash-match `93334429e`, including all 9,791 under `src`.
- **Own repros.** I ran three repros in `j7-main` and deleted them afterwards:
  - `src\ui\state\zz-j7r-owned-g21.simulator.test.ts` (6/6);
  - `src\ui\state\zz-j7r-fluidnc-grbl-profile.test.ts` (5/5);
  - `src\ui\app\zz-j7r-remote-undo-keep.test.tsx` (1/1).
- **Tests run on main's tree, one at a time:**
  - `cnc-tool-programs.test.ts` 9/9;
  - spot checks of the auditor's verdicts: #1454 `console-command-comments.test.ts` 118/118, #1446 `laser-store-console-setting-writes.test.ts` 16/16, and #1469 `board-capture-undo.test.ts` 5/5.
- **Firmware sources,** re-fetched at the pinned SHAs: Smoothieware `91fe4286` (Robot.cpp, Robot.h, Kernel.cpp, SimpleShell.cpp) and FluidNC `25ae119b` (ProcessSettings.cpp, Report.cpp).

```json
[
  {"id":"J7-P1-1","severity":"P1","area":"fix-machine-state","file":"src/ui/state/laser-origin-restore.ts","line":188,"anchor":"Ground truth: Smoothieware 91fe4286 Robot.cpp L601-L602 (G21 clears inch mode), Kernel.cpp L262-L287 (reports via from_millimeters); Contract: ADR-375 Amd 7 Consequences (units 'not changed behind the operator's back'); Twin: Frame records mm with its G21 (frame-report-units.ts:70-74), origin writes do not","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED P1. Own Smoothie inch-mode repro on main tree (91fe4286 Robot.cpp L344-L365/L601-L602, Kernel.cpp L262-L287 re-fetched): Console G20 -> Place Board origin G21+G92 X50 -> Move to X60 sends G0 X-2480 (head X-2380); board in G20 at connect -> Place Board origin -> Go to work zero target X1270 (head X-1170); head-stop rejects as unconfirmed, next point move still X-2380. Regression confirmed (gh pr view 1461: reportUnitsSelectedBy + [GC:] units patch; parent has neither). Only signals: a Console line (Place Board, Restore) or an unconfirmed-offset error (head-stop), none names units; no toast, lastWriteError null. Correction: recovery Move to job points is hidden after Restore here (Origin now 1270 vs then 50, LaserRecoveryPlacement.tsx:92,128), X-1160 needs a direct call; a second Restore press writes G92 X2490 Y2490 (board work zero at machine X-2390)","known":false,"summary":"After #1461 records Smoothieware inch reports (Console G20, or a board left in G20 read at connect), Restore saved origin, Place Board's corner origin and Set origin at the head-stop point write a plain G21 outside M120/M121; the board reports mm while KerfDesk still scales by 25.4. Repro: Move to X60 from X100 sends G0 X-2480 Y-2480 (sim lands X-2380); Go to work zero lands X-1170 (the recovery review hides its move in this state; a second Restore writes G92 X2490); no warning. Pre-#1461 these G21 writes kept the units in step"},
  {"id":"J7-P1-2","severity":"P1","area":"fix-machine-state","file":"src/core/controllers/fluidnc/driver.ts","line":64,"anchor":"Ground truth: FluidNC v4.0.3 ProcessSettings.cpp L1209-L1240, L1080, Report.cpp L82-L84 ([key]value runs as $key=value); Contract: ADR-375 Amd 6 D1 (send only when both readings get the same safeguards, on every GRBL-family profile); Twin: #1446 keys grblHAL checks on session evidence under a GRBL profile; ADR-375 Amd 7 lists this as 'Not done'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED P1. Own FluidNC model (v4.0.3 25ae119b ProcessSettings.cpp L1209-L1240, L1067, L1080; Report.cpp L82-L84 re-fetched) under grbl-v1.1 via the real store: [13]1 and [Report/Inches]1 sent, reportInches stays false, Move to X60 from X100 sends $J=G91 G21 X56.063 Y56.063 (head X156.063); [RST]# sent, G54 Z -30 -> 0, Work Z evidence and epoch kept; $13=1 needs confirmation; FluidNC profile refuses [13]1. Only signals: connect-time Console identity line and Job Review identity row, neither names units or the bracket line; ADR-375 Amd 7 Not done is not a warning","known":false,"summary":"Under the stock-GRBL profile a FluidNC board (detectedControllerKind 'fluidnc') still takes [13]1 and [RST]# as plain G-code: [13]1 switches the board to inch reports with no re-read, and the next point move from X100 to X60 sends $J=G91 G21 X56.063 Y56.063; [RST]# is sent with Work Z kept; $13=1 is confirmed and $RST=# blocked in the same session"},
  {"id":"J7-P2-1","severity":"P2","area":"fix-machine-state","file":"src/ui/remote-control/arrange.ts","line":209,"anchor":"Contract: ADR-440 Amd 6 D1-D2 (Undo of Keep brings the notice back 'so the operator sees the question again'; the Undo list names the step); Twin: desktop vs phone/MCP Undo; ADR-569 phone-only workflow","evidence":"REPRO","verdict":"CONFIRMED","refuter":"CONFIRMED P2. Own repro through the real dispatcher applyRemoteWrite undo (writes.ts:115-117): Keep is undo depth 1; receipt changedArtworkIds [] canUndo false canRedo true; device back to front-left 400x400 no zones; first burn G1 X30 Y10 -> X30 Y390, clamp collisions 5 -> 0; PC banner returns, no toast. Write gate (adapter.ts:288-295) checks only permission, pendingUndo, revision; no projectBedReconciliation reader in remote, MCP, Start or Job Review. P1 not adopted: the specific mismatch shows on the PC before output; coordinator may weigh strict section 3 for the phone-only workflow","known":false,"summary":"A phone or MCP Undo can pop the Keep current machine step: the file's machine (front-left, 400x400, no clamp zone) returns with its notice on the PC banner only, and the remote receipt is changedArtworkIds [] with canUndo/canRedo; the burn moves from G1 X381 Y20 (1 no-go collision) to G1 X20 Y380 (0). projectBedReconciliation is read only by the PC banner and the persistence hook"},
  {"id":"J7-P2-2","severity":"P2","area":"fix-machine-state","file":"src/ui/laser/cnc-park-z-top.ts","line":72,"anchor":"Twin: Start/Job Review/recovery/phone-MCP Start run the ADR-491 Amd 2 Z-top check, Run G-code file of the same KerfDesk per-bit file does not; Contract: ADR-491 Amd 2 D1 ('checked … when the inputs are known')","evidence":"READ","verdict":"CONFIRMED","refuter":"CONFIRMED P2 (two lines). git grep: checks called only at start-job-readiness-policy.ts:76 and JobReviewMachineSection.tsx:84; external-program-review.ts:25-38 has an XY envelope only, no Z top. cnc-tool-programs.test.ts 9/9 on main tree: every per-bit file ends G0 Z<park>, M5, M9, park XY. ADR-491 Amd 2 D2 scopes the warning to Start. Not P3: reachable on the default package (ADR-392 Amd 3) with the same effect as M7-P1-2 (P2); an older gap is not a latent one","known":"adjacent: H3 L9 table lists the cell 'n/a' without raising it; parent M7-P1-2 (P2)","summary":"checkCncLiftAgainstZTop is called only from start-job-readiness-policy.ts:76 and JobReviewMachineSection.tsx:84; the Run G-code file review has an XY-only envelope and no Z check, so a default per-bit setup-package file run there lifts to G0 Z<park> past the Z top (park 50, WCO Z -40, 75 mm travel) with no warning, where in-app Start warns"}
]
```
