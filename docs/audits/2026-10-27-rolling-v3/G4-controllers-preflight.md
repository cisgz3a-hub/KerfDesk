# Rolling audit v3 — Controllers and preflight

- **When:** 2026-10-27   **Tree:** origin/main @ `9a2bf6b13` (the audit worktree's source is identical).
  #1454 (Console comment normalisation, ADR-375 Amd 6) merged after the tree, at `6f9df9786`; its
  diff and ADR were read with `git show 6f9df9786`, not run.
- **Scope:**
  - **Paths:** `src/core/controllers`, `src/core/devices`, `src/core/preflight`, `src/core/recovery`,
    `src/core/gcode-view`, `src/ui/gcode-inspector`, `src/ui/machine`.
  - **Merges:** 46 first-parent merges touched these paths since 2026-10-21. Every diff in scope was
    read. The hotspots were read in full:
    - Console and settings: #1379, #1446 (ADR-375 Amd 4–5), #1454 (Amd 6), #1377/#1427/#1429
      (password mask);
    - report mask and probe touch: #1382, #1450 (ADR-375 Amd 2, ADR-103 Amd 2);
    - profiles: #1385 (ADR-660), #1386 (ADR-664);
    - focus: #1388 (ADR-400 Amd 2);
    - Run G-code file: #1390, #1410, #1412, #1413, #1417, #1423 (ADR-630 Amd 4–8);
    - recovery: #1366/#1397 (ADR-398 Amd 3–4), #1391 (ADR-180 Amd 7);
    - power scale: #1400 (ADR-567 Amd 2);
    - no-go zones: #1392 (ADR-232 Amd 1);
    - Marlin skipped moves: #1381;
    - G-code view: #1287, #1351, #1362, #1368;
    - preflight and sidecar: #1427, #1440, #1447, #1450, #1451.
  - **Callers:** the callers these rely on were followed into `src/ui/state` (Console actions, point
    moves, report units).
- **Lenses run:**
  - L8 (siblings, conflicts, claims);
  - L2 (firmware claims re-fetched at pinned commits);
  - L3 (twins);
  - L6, partly: the stream-error stop path and the Console's evidence invalidation.
  - L1, L4, L5 and L7 were not run as separate passes.
- **Counts:** 2 raised → 0 refuted → P1 2 / P2 0 / P3 0 (+4 KNOWN still open). Refuter: both P1s
  CONFIRMED.
  - G4-P1-2 is new.
  - G4-P1-1 is not a new defect. It is a severity correction of the KNOWN controller v2 C6-P3-1,
    from P3 to P1 by effect.

## Headline

Two Console lines that the firmware runs as a units or `$` command still pass KerfDesk as plain G-code:

- **FluidNC's `[13]1`.** FluidNC runs `[key]value` exactly as `$key=value`. #1454 (ADR-375 Amd 6)
  says its rule holds on FluidNC, but the bracket form is never translated. So `[13]1` switches
  FluidNC to inch reports, and the `$13=1` refusal and re-read never apply. `[RST]#` and `[NVX]`
  also bypass the persistent-command block.
- **Smoothieware's `G20`.** Smoothieware then reports positions in inches.

KerfDesk keeps reading those reports as millimetres. In a fake-controller repro, the next point move
from X100 Y100 to X60 Y60 drove the head to X156.063 Y156.063 on both firmwares. The Frame already
normalises Smoothieware's units (frame-lifecycle P1, 2026-10-02); point moves never got that fix.

The fixes merged in this window hold on the siblings that were checked. Both merge conflicts in
scope kept both sides:

- `status-report-mask.ts` (#1446 against #1450);
- `cnc-retained-compilation-sidecar.ts` (#1450 against #1451).

## Findings

### G4-P1-1 — FluidNC's bracket form `[key]value` is still plain G-code to the Console after #1454: `[13]1` makes the next point move land 25.4× off, and `[RST]#`/`[NVX]` erase offsets with Work-Z evidence kept

- **Where:**
  - `src/core/controllers/fluidnc/fluidnc-command-names.ts:102-106`: `splitDollarCommand` returns
    null unless the line starts with `$`. So `fluidncGrblCommandForm` and `fluidncCommandKey` never
    see a `[key]value` line.
  - `src/core/controllers/fluidnc/driver.ts:45-54`: the line then goes to the shared classifier.
  - #1454's `grbl-line-reader.ts` and `disguisedSystemCommandRefusal` (`console-command.ts` at
    `6f9df9786`) only act when GRBL's view of the line starts with `$`. They pass `[13]1` as
    G-code with effect `machine-state` and no confirmation.
  - `src/ui/state/laser-console-actions.ts:336-337`: `machine-state` changes neither the
    report-units record nor `workZZeroEvidence`.
  - The point move computes its delta from the reported position:
    - `src/ui/state/laser-jog-actions.ts:94-98` (`inferCurrentMachinePosition(…,
      controllerSettings?.reportInches === true)`);
    - `reportInches` is only re-read after a `$13=` write (`grbl-settings-evidence.ts:35`).
- **Anchor:**
  - **Ground truth:** FluidNC v4.0.3.
    - `execute_line` sends a line that starts with `$` or `[` to the settings parser
      ([ProcessSettings.cpp L1224-L1240](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1224-L1240)).
    - `settings_execute_line` splits a `[` line at `]`
      ([L1209-L1221](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1209-L1221))
      and runs the same `do_command_or_setting` as a `$` line
      ([L1090-L1113](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1090-L1113)).
    - `13` is `Report/Inches`: `config->_reportInches = ((value[0] == '1') ? true : false);`
      ([L729-L736](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L729-L736),
      [L1080](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1080)).
    - Status positions are then divided by `MM_PER_INCH`
      ([Report.cpp L82-L84](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Report.cpp#L82-L84)).
    - `RST` and `NVX` are the same commands as their `$` forms
      ([L1034](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1034),
      [L1067](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1067)).
      `#` resets every coordinate system
      ([L157-L162](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L157-L162)).
  - **Contract** (ADR text from `docs/decisions`):
    - ADR-375 Amendment 6, Decision 1 (at `6f9df9786`): the Console sends a line only when the line
      the firmware reads gets the same safeguards. It says: "This holds on every GRBL-family profile
      (GRBL, grblHAL, FluidNC and the Falcon contract)".
    - ADR-400, Decision 1 (at `9a2bf6b13`): "FluidNC long names are read as their Grbl names, and
      `$NVX` and `$Settings/Erase` are blocked."
  - **Twin:**
    - the same driver refuses `$13=1` and blocks `$RST=#` and `$NVX`;
    - the Run G-code file normaliser already treats a bracket line as a `$` command (ADR-630 item
      11, `normalize-external-program.ts:273`).
- **Scenario:**
  1. A FluidNC laser is connected. `$$` reports `$13=0`, and the head is at machine X100 Y100.
  2. The operator types `[13]1` in the Console, for example to see inches on FluidNC's own WebUI.
     The Console sends it with no prompt. FluidNC now reports `MPos:3.9370,3.9370`, and KerfDesk
     still reads millimetres.
  3. A point move to machine X60 Y60 (canvas Position laser, a saved position, Move to position)
     sends `$J=G91 G21 X56.063 Y56.063`. The head goes to X156.063 Y156.063: 96 mm past the target,
     in the opposite direction.
  4. The same bypass sends `[RST]#` or `[NVX]`. FluidNC wipes G54–G59, G28 and G30, but Work-Z
     evidence stays current. A probed G54 Z0 is gone while CNC Start still trusts it.
  5. `$RST=#` is blocked and `$13=1` is refused in the same session.
- **Evidence:** REPRO.
  - **Classifier:** a temporary `src/core/controllers/zz-g4-fluidnc-bracket.test.ts` (deleted) ran
    each line through `fluidncDriver.prepareConsoleCommand`:
    - `$RST=*` REFUSED; `[RST]*`, `[rst]#` and `[Settings/Restore]*` OK, `kind=gcode
      effect=machine-state confirm=false`;
    - `$NVX` REFUSED; `[NVX]` and `[Settings/Erase]` OK, gcode;
    - `$13=1` is a confirmed setting write; `[13]1` OK as gcode;
    - `$H` has `effect=reference`; `[H]` has `effect=machine-state`.
  - **Store:** a temporary `src/ui/state/zz-g4-fluidnc-bracket-inches.test.ts` (deleted). The fake
    serial port behind the FluidNC profile switches to inch reports on `[13]1` or `$13=1`. Command:
    `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-g4-fluidnc-bracket-inches.test.ts`
    → 5 passed. Output:
    - `{"line":"[13]1","console":"sent","boardReportsInches":true,"reportInchesAfter":false,"jogLines":["$J=G91 G21 X56.063 Y56.063 F1000\n",…]}`
    - `{"line":"$13=1","console":"refused: KerfDesk does not send numeric $ setting writes on the FluidNC profile…","jogLines":["$J=G91 G21 X-40.000 Y-40.000 F1000\n",…]}`
    - `{"line":"[RST]#","console":"sent","written":["[RST]#\n"],"workZEvidenceKept":true}`
    - `{"line":"$RST=#","console":"refused: This persistent controller command is blocked in the Console","written":[]}`
    - `{"line":"[NVX]","console":"sent","workZEvidenceKept":true}`
  - Copies are in the auditor's scratchpad `g4-repros\`.
- **Novelty:** **KNOWN in part.** Controller v2 C6-P3-1 (open, no PR) raised the same bypass with
  the same three lines and a READ note that positions "are then read 25.4× too small". New here:
  - **The effect, reproduced.** A point move lands 96 mm off, the wrong way, so the finding is P1 by
    effect under METHOD §3. Meta audit v1 M6 re-rated the `$` comment twin, C5-P3-1, to P1 the same
    way.
  - **A sibling #1454 missed.** ADR-375 Amd 6 claims the rule covers FluidNC.
  - **The Work-Z evidence kept** after `[RST]#` and `[NVX]`.

  No open PR touches `fluidnc/` or the Console classifier (#1456 and #1457 do not).
- **Severity:** P1 (proposed). The machine moves to a wrong position and nothing warns. The DRO and
  the head marker show the inch numbers as millimetres, but nothing says they are wrong.
- **Refuter:** **CONFIRMED.** This is a severity correction of KNOWN C6-P3-1 (P3 → P1 by effect),
  not a new defect. P1 is kept.
  - **What would make it false:**
    - FluidNC does not run `[key]value` as a setting command;
    - `13` does not change the status-report units;
    - KerfDesk re-reads `$$` or detects inch reports before a point move;
    - a guard blocks point moves after a Console `machine-state` line;
    - a warning reaches the operator first.

    None of these holds.
  - **Ground truth.** Re-fetched at FluidNC tag `v4.0.3` (`25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f`):
    - **Bracket lines are settings commands.**
      - `execute_line` routes on `if (line[0] == '$' || line[0] == '[')`
        ([ProcessSettings.cpp L1234](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1234)).
      - `settings_execute_line` splits on `*line == '[' ? ']' : '='` (L1213).
      - It then calls `do_command_or_setting`, "the handler for all forms of settings commands"
        (L1088-L1090).
    - **`13` switches the report units.**
      - `13`/`Report/Inches` is `switchInchMM` (L1080), which sets `config->_reportInches` (L733).
      - Its state gate `notIdleOrAlarm` (L50-L53, checked in
        [Settings.cpp L407-L411](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Settings.cpp#L407-L411))
        lets it run in Idle.
    - **Reports follow `_reportInches`.**
      - `report_util_axis_values` does `value /= MM_PER_INCH`
        ([Report.cpp L83](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Report.cpp#L83)).
      - That covers MPos/WPos (L508) and WCO (L556).
    - **Only a later `$$` would correct KerfDesk.** `$$` prints `$13=` first (ProcessSettings.cpp
      L185-L186).
  - **KerfDesk:**
    - **The bracket line is never seen as a `$` command.**
      - `splitDollarCommand` returns null for a `[` line (`fluidnc-command-names.ts:104`).
      - #1454's `disguisedSystemCommandRefusal` returns null when GRBL's view does not start with
        `$` (read at `6f9df9786`).
      - No `fluidnc/` file changed up to origin/main `d96943476`.
    - **The units are never re-read.**
      - `reportInches` changes only through `$$` or a `$13=` write (`grbl-settings-evidence.ts:35`).
      - The point-move guards (`jogFrameCommandBlockMessage`, `confirmFreshManualMotionIdle`) check
        Idle and freshness, not units.
    - **Which point moves are affected.**
      - The canvas Position laser click is not affected on FluidNC: it needs a verified native bed
        frame, and only stock GRBL and the Falcon contract give one (`native-bed-frame.ts`).
      - Move to position (`head-move-dispatch.ts:98`), Go to work zero (`OriginRow.tsx:310`, whose
        target also comes from the inch WCO) and the recovery move (`laser-recovery-move.ts:31`) all
        reach `jogToMachinePosition` with no units check.
  - **Own REPRO.** File: `src/ui/state/zz-g4r-units.test.ts` (deleted). Command:
    `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-g4r-units.test.ts` → 8 passed.
    - **Board model:**
      - it parses `$` and `[` lines the way `settings_execute_line` does;
      - it moves the head in mm on `$J=`;
      - it divides MPos and WCO by 25.4 while `13` is set.
    - **Setup:** the head is at machine X100 Y100 with G54 at X50 Y50. The line goes through the real
      `sendConsoleCommand`. Then the real Move to position runs:
      `dispatchHeadMove({frame:'origin', xMm:10, yMm:10})`, whose target is machine X60 Y60.
    - **`$13=1`:** refused. The head lands at X60 Y60, then back at X100 Y100.
    - **`[13]1` and `[Report/Inches]1`:**
      - Both are sent. KerfDesk keeps `reportInches:false` and reads MPos as 3.937.
      - Move to position sends `$J=G91 G21 X8.032 Y8.032`. The head lands at **X108.032 Y108.032**,
        48 mm off.
      - A following `jogToMachinePosition(100,100)` lands at **X203.779**, 104 mm off. The error
        compounds.
      - There are no toasts, and `lastWriteError` is null.
    - **`[RST]#` and `[NVX]`:** sent, and the Work-Z evidence stays current. `$RST=#` is refused.
    - **Classifier:** `[13]1`, `[RST]#`, `[rst]*`, `[Settings/Restore]*`, `[NVX]`,
      `[Settings/Erase]` and `[H]` all come back `kind=gcode effect=machine-state confirm=false`.
  - **Warning:** none before the move.
  - **Novelty:**
    - C6-P3-1 (P3, open, no PR) already has the bypass and the "read 25.4× too small" consequence.
      So this is the §3 correction meta v1 M6 made for C5-P3-1.
    - New to the record:
      - the reproduced wrong move;
      - ADR-375 Amd 6 decision 1's FluidNC claim, which holds for comments and `/` but not for
        brackets;
      - the kept Work-Z evidence.
    - ADR-400 Decision 1 and the ADR-630 bracket twin (`normalize-external-program.ts:273`) were
      re-read and hold.
  - **Severity, §3:** the output is wrong (48 mm and 104 mm off target), reachable today, and nothing
    warns. P1 stands.
- **Fix direction:**
  - In `fluidncGrblCommandForm`, rewrite a leading `[key]value` to `$key=value` before
    classification, as long names already are. The block, the refusal, the confirmation and the
    `$13` re-read then apply unchanged.
  - Correct ADR-375 Amd 6 decision 1's FluidNC claim.

### G4-P1-2 — Smoothieware reports positions in the Console's or a program's `G20` inches, and point moves read them as millimetres; only the Frame normalises the units

- **Where:**
  - `src/core/controllers/smoothieware/driver.ts:96`: `frameReportUnitsCommand: 'G21'`.
  - It is used only by `normalizeFrameReportUnits` (`src/ui/state/frame-report-units.ts:102`), and
    only Frame calls that (`src/ui/laser/frame-controller-readiness.ts:55`).
  - A Smoothieware Console `G20` is classified by `commonConsoleStateEffect` as `machine-state`
    (`src/core/controllers/console-state-effect.ts:50`;
    `smoothieware/console-command.ts:80-84`). That records no units.
  - The point move takes its delta from the raw report with `reportInches` false
    (`src/ui/state/laser-jog-actions.ts:94-98`). Smoothieware has no `$$`, so nothing ever sets it.
- **Anchor:**
  - **Ground truth:** Smoothieware `Kernel::get_query_string` formats MPos and WPos through
    `robot->from_millimeters(...)`
    ([Kernel.cpp L214-L234 @ 91fe4286](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/libs/Kernel.cpp#L214-L234)).
    So after `G20` they are in inches. `M120`/`M121` around each jog restore that mode
    (`smoothieware/commands.ts:52-62`, citing `Robot.cpp`).
  - **Twin:** the Frame selects `G21` and takes a fresh report before it captures coordinates. The
    2026-10-02 frame-lifecycle audit fixed this as a P1: "Smoothieware inch reports change the next
    Frame's placement" (`docs/audits/2026-10-02-frame-lifecycle.md:17`). Point moves use the same
    reports and were not fixed.
- **Scenario:**
  1. On a Smoothieware laser or router at machine X100 Y100, the operator types `G20` in the
     Console. It goes out as ordinary G-code with no prompt.
  2. The board then reports `MPos:3.9370,3.9370`.
  3. A point move to X60 Y60 sends `M120 G21 G91 G0 X56.063 Y56.063 G90 M121`.
  4. The head drives to X156.063 Y156.063. A small bed hits the frame; on a router the bit
     crosses the work.
  5. An opened program that ends in `G20` may leave the board the same way. That path is not
     reproduced (see Not verified).
- **Evidence:** REPRO.
  - **Test:** a temporary `src/ui/state/zz-g4-smoothie-g20.test.ts` (deleted).
    - It uses the repo's `createSmoothieSimulator`.
    - Its adapter is wrapped so the status `MPos`/`WPos` are divided by 25.4 after a written `G20`
      and restored after `G21`, as `from_millimeters` does.
    - A real `jogToMachinePosition(100,100)` first moves the head, then the Console line runs, then
      `jogToMachinePosition(60,60)`.
  - **Command:** `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-g4-smoothie-g20.test.ts`
    → 2 passed.
  - **Output:**
    - baseline: `{"console":null,…,"jogWrites":["…M120\nG21\nG91\nG0 X-40.000 Y-40.000 F3000\nG90\nM121\n",…],"simPosAfter":{"x":60,"y":60,"z":0}}`
    - with `G20`: `{"console":"G20","consoleResult":"sent","reportedMPos":{"x":3.937,"y":3.937,"z":0},"jogWrites":["…M120\nG21\nG91\nG0 X56.063 Y56.063 F3000\nG90\nM121\n",…],"simPosAfter":{"x":156.063,"y":156.063,"z":0}}`
  - A copy is in the auditor's scratchpad `g4-repros\`.
- **Novelty:**
  - The 2026-09-25 controller audit's Smoothieware track lists "the inch-mode reports a Console
    `G20` would cause" under **Not covered** (`tracks/SM.md:758-760`).
  - The frame-lifecycle fix covered Frame only.
  - No later audit, ledger or open PR raises point moves on Smoothieware inch reports.
- **Severity:** P1 (proposed). The machine moves unexpectedly, to a wrong position, with no warning.
- **Refuter:** **CONFIRMED.** New, and P1 is kept.
  - **What would make it false:**
    - Smoothieware's Idle `?` report stays in mm after `G20`;
    - the jog's own `G21` leaves the board in mm;
    - KerfDesk re-asserts `G21` or normalises units before a point move;
    - the point move is absolute;
    - a warning reaches the operator first.

    None of these holds.
  - **Ground truth.** Re-fetched at Smoothieware `edge` =
    `91fe4286e8ee19f062260abf094b315f9cf6bedf`, the branch head on 2026-10-27:
    - **`G20` sets inch mode.** `case 20: this->inch_mode = true;`
      ([Robot.cpp L601-L602](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.cpp#L601-L602)).
    - **`from_millimeters` divides by 25.4 in that mode**
      ([Robot.h L53](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.h#L53)).
    - **The Idle report uses it.**
      - The branch "return the last milestone if idle" prints MPos and WPos through
        `from_millimeters`
        ([Kernel.cpp L262-L287](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/libs/Kernel.cpp#L262-L287)).
      - The auditor's L214-L234 is the Run branch. The point move reads the Idle branch, which
        behaves the same.
    - **The jog's `M121` puts inches back.**
      - `push_state` and `pop_state` save and restore `inch_mode` (Robot.cpp L348 and L362).
      - So after the jog's `M120 … G21 … M121`, the board reports in inches again.
    - **`M2` keeps inch mode.** It resets the WCS and absolute mode but not `inch_mode` (Robot.cpp
      L729-L734). A program that ends in `G20` therefore leaves inch reports too.
  - **KerfDesk:**
    - **The move is relative.** The Smoothieware jog is `G21 G91 G0 … G90` inside `M120`/`M121`.
    - **Its delta comes from the report.** `jogToMachinePosition` takes dx from
      `inferCurrentMachinePosition(…, reportInches === true)` (`laser-jog-actions.ts:94-98`).
      `reportInches` is never set on Smoothieware.
    - **Only Frame normalises the units.** `normalizeFrameReportUnits` has one caller,
      `frame-controller-readiness.ts:55`. So the 2026-10-02 units fix is Frame-only.
    - **The Console sends `G20` with no prompt.** It classifies as
      `kind=gcode effect=machine-state confirm=false`.
  - **Own REPRO.** Same temporary file, run with the same command.
    - **Model:** the repo's `createSmoothieSimulator`, with my own adapter. The adapter models
      `inch_mode`, including the `M120`/`M121` stack.
    - **Setup:** the head is at X100 Y100. Then Console `G20`. Then the real Move to position at bed
      X60 Y60, whose native target is X60 Y340.
    - **Result:**
      - Move to position sends `G0 X56.063 Y336.063`. The head lands at **X156.063 Y436.063**,
        past the 400 mm bed.
      - The next `jogToMachinePosition(100,100)` lands at **X249.919 Y518.895**.
    - **Baseline without `G20`:** the head lands exactly on X60 Y340, then X100 Y100.
  - **Warning:** none that §3 counts.
    - The only toast says "The controller-to-bed mapping is unverified, so the head goes where an
      Absolute job…". The baseline shows the same toast.
    - It says nothing about units and names a destination the head does not reach.
    - For an opened program, the Run review's "leaves the controller in inches" line
      (`external-program-review.ts:342`) comes before the run, not before the later point move. It
      does not say that point moves will be wrong.
  - **Novelty:** confirmed new.
    - `tracks/SM.md:758-760` lists it as not covered.
    - No later audit or ledger raises it.
    - The only open PR, #1457, touches none of these files.
  - **Severity, §3:** the output is wrong, reachable today, and nothing warns. P1 stands.
- **Fix direction:**
  - Treat a Smoothieware `G20`/`G21`, from the Console or an external run, as a report-units change
    (`reportUnitsUnconfirmed`).
  - Before any move computed from the reported position, normalise the units the way Frame does
    (owned `G21`, then a fresh report).
  - Or compute point moves as absolute machine targets rather than a delta from the report.

## KNOWN (still open on the tree)

- **G4-K-1 = meta v1 M4-P3-8 (P3).** The Run G-code file review and normaliser key grblHAL rules on
  the profile kind (`use-external-program.ts:46-47`), not on #1446's `grblHalEvidence`. New variants
  from Ortur's level-1 grblHAL fork (`Ortur_Laser_Firmware_17X-18X` @ `4849ac85`, `gcode.c`):
  - **Lines the fork runs.** It runs `G5` (L458), `G73`/`G81`–`G89` canned cycles (L472-479) and
    `G50`/`G51` scaling (`MACH3_SCALING` defined, L44, L582). The stock review marks those lines
    "Stock GRBL rejects this whole block" and leaves them out of the Frame.
  - **`M1`.** The fork holds at `M1` (L615-617), while the review says stock GRBL ignores it.
- **G4-K-2 = meta v1 M4-P3-9 (P3).** Smoothieware `M375` is still sent from an opened program.
  `storage-command-check.ts:43-54` lists 374, not 375.
- **G4-K-3 = controller v2 C5-P3-2 (P3).** On FluidNC, `$SD/Run=`, `$LocalFS/Run=`, `[ESP700]`,
  `[ESP220]`, `$RM=0`, `$LocalFS/Format`, `[ESP710]` and `$Bye` are one unconfirmed Console line.
  This repro shows each as `kind=gcode effect=machine-state confirm=false`. The commands are listed
  in FluidNC v4.0.3
  [FileCommands.cpp L660-L687](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/FileCommands.cpp#L660-L687).
- **G4-K-4 = controller v4 E4-P3-1 (P3).** `controller-block-check.ts` `takesAxisWords` (L72-74) still lacks
  `G49`, so `G0 G49 X10` is neither refused nor marked rejected.

**Refuter check (all four still open and KNOWN, P3 kept):**

- **G4-K-1:** READ. `useNormalizedProgram` still keys on `activeControllerKind`
  (`use-external-program.ts:46-47`).
- **G4-K-2:** REPRO. `storageCommandRefusal('M375','smoothieware')` returns null, while `M374` is
  refused.
- **G4-K-3:** REPRO. All eight FluidNC lines come back
  `kind=gcode effect=machine-state confirm=false`.
- **G4-K-4:** REPRO. `controllerBlockRejection('G0 G49 X10')` returns null, while
  `G0 G43.1 Z1 X10` is refused with error:24.
- **Origin:** each is in the cited earlier report (M4 L447, M4 L92, C5 json, E4 json). No open PR
  touches them.

## Refuted

- **Ortur level-1 grblHAL under the stock profile has a different jog envelope (far-edge
  pull-off).** Refuted. The fork's `system_check_travel_limits`
  ([system.c L533-L563 @ 4849ac85](https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/system.c#L533-L563))
  is the stock envelope with no pull-off. `jog-travel-limits.ts`'s `'grbl'` rule is right for it.
- **#1446/#1450 conflict dropped a side in `status-report-mask.ts`.** Refuted. Both
  `statusReportFieldsOff` and `pinStateReportOff` go through `readsGrblHalMask`. FluidNC strips the
  capability (`fluidnc/driver.ts:86`).
- **#1454's comment-aware classifier leaks a password through the mask.** Refuted (READ).
  `scanNumericKey` stops at `(`, `;` or `X` after `75`, and the `=` that follows is still masked, so
  `$75(x)=…` and `$75;x=…` are covered.
- **The Auto-focus feed cap (#1388) can be beaten by a left-over `G20`.** Refuted.
  `autofocus-action.ts:69-81` sends `G21` and `G90` before the probe line. The dispatch check runs
  in the store action for every caller (`laser-autofocus-actions.ts:79-85`).

## Verified clean

- **Conflict resolutions in scope.**
  - #1446 against #1450 in `status-report-mask.ts`, as above. The file's 6 tests pass on the tree.
    Refuter spot check:
    - `statusReportFieldsOff` and `pinStateReportOff` both call `readsGrblHalMask` first (READ).
    - `fluidnc/driver.ts:86` drops `statusReportMask`.
    - The test file passes: 6 of 6, re-run.

    The claim holds.
  - #1450 against #1451 in `cnc-retained-compilation-sidecar.ts`: all nine `CncCompilationSidecar`
    fields are filtered by the retained layer ids.
- **#1454 on GRBL, grblHAL and FluidNC `$` lines** (READ at `6f9df9786`):
  - `(x)$30=255`, `$30(x)=255`, `/$30=500` and `$RST(x)=*` are refused;
  - `$/RST=*` is refused through GRBL's view; `$Settings/Restore(x)=#` goes out (FluidNC refuses
    the unknown key itself);
  - stock-GRBL value comments keep the setting-write path, and the value reader in
    `console-setting-writes.ts` strips comments the same way.
- **#1381 Marlin skipped moves.** `HOME_FIRST_RE` takes any axis list, matching Marlin's
  `"Home %s First"`.
- **#1392 no-go zones.** The tool comment is now read by field name, so `tip-diameter-mm` no longer
  wins.
- **#1413/#1417 external-run state.**
  - `G59.1` reads as `null`, which counts as "other WCS".
  - `G43`, `G43.2`, `M61` and `T` void Work Z.
  - A `G54` header keeps both records.
- **#1427 `hasCuttingMove`.** Leading zeros and `.0` are accepted; comments are ignored.
- **#1440 rotary wrap.** The wrap limit is the scaled emitted Y of one turn (`rotaryYLimitMm`), and
  the start point is left out of the span.
- **#1386 laser dot.** Power is capped at 5% and the Falcon command set is required. The dot clears
  on `M5` (`laser-fire-actions.ts`).
- **MCP** has no raw console or G-code tool (`electron/mcp/machine-schemas.ts:56`).
- **L2, primary sources re-fetched at pinned refs:**
  - grblHAL `machine_limits.c` @ `d7aaee3d`: the pull-off applies only with hard limits, and only
    homed axes are checked. This matches `jog-travel-limits.ts`.
  - grblHAL `settings.h` @ `4ec1ae44` L655-672: `$10` bits 0, 4, 5 and 6 are machine position, pin
    state, WCO and overrides. This matches `status-report-mask.ts`.
  - FluidNC v4.0.3 `GCode.cpp` L633-636 and L1935-1938: `M1` is not supported. This matches
    `program-stops.ts`.
  - FluidNC v4.0.3 `SettingsDefinitions.cpp` L101: `$10` is a 0–3 GRBL setting, which supports
    #1446's FluidNC opt-out. L150: `$30` is an int proxy.
  - FluidNC v4.0.3 `GCode.cpp` L543-552: `G43` and `G49` are axis commands, which supports E4-P3-1.

## Not verified

- **An opened Smoothieware program that ends in `G20`.** Whether Smoothieware's `M2`/`M30` restores
  `G21` was not checked, so G4-P1-2's external-run path is unconfirmed. Only the Console path was
  reproduced.
  - Refuter, SOURCE: at `91fe4286`, `M2` (and `M30` in grbl mode, which falls through to it) resets
    the WCS and absolute mode but not `inch_mode` (Robot.cpp L726-L734). So the firmware side of
    this path holds.
  - The Run review does warn that the program "leaves the controller in inches"
    (`external-program-review.ts:342`).
  - This path is still not reproduced end to end. It does not change the P1, which rests on the
    Console path.
- **G4-P1-1 on a CNC with a probed Work Z.** The `[RST]#` scenario was reproduced at store level
  (evidence kept), not through a CNC Start.
- **Marlin standard (non-inline) `M3` and `G0`.** The Marlin reader appends `S0` to `G0`. Whether
  Marlin 2.1.2.8 turns the beam off on `G0` outside inline mode was not re-fetched.
- **Units on other firmware.** Marlin `M114` units after `G20`, and grblHAL `$13` under the
  stock-GRBL profile, were not traced.
- **Out of scope here.** The link-loss restart (#1366/#1397) and the FluidNC door resume (#1391)
  were read for siblings only: D7, G2 and meta M3 cover them.
- No hardware, simulator-only.

```json
[
  {"id":"G4-P1-1","severity":"P1","area":"controllers-preflight","file":"src/core/controllers/fluidnc/fluidnc-command-names.ts","line":106,"anchor":"Ground truth: FluidNC v4.0.3 ProcessSettings.cpp L1209-1240 ([key]value runs as $key=value), L729-736/L1080 ($13 report inches), Report.cpp L82-84; Contract: ADR-375 Amd 6 decision 1 (claims FluidNC), ADR-400 decision 1; Twin: $13=1 refused, $RST=/$NVX blocked, ADR-630 item 11 treats bracket lines as $ commands","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (own FluidNC board model, real sendConsoleCommand + dispatchHeadMove origin frame: [13]1 -> head X108.032 for target X60, then X203.779 for X100, no toast; [RST]#/[NVX] sent with Work-Z evidence current) + SOURCE FluidNC v4.0.3 (25ae119b) ProcessSettings.cpp L1213/L1234/L1088-1090/L1080/L733, Settings.cpp L407-411, Report.cpp L83/L508/L556","known":"C6-P3-1 (P3, open, no PR): severity correction P3 -> P1 by effect, not a new defect","summary":"FluidNC [key]value lines still go out as plain unconfirmed G-code after #1454: [13]1 switches FluidNC to inch reports while KerfDesk keeps reportInches false, and the next point move from X100 to X60 sends $J=G91 X56.063 (lands at X156); [RST]# and [NVX] wipe offsets with Work-Z evidence kept"},
  {"id":"G4-P1-2","severity":"P1","area":"controllers-preflight","file":"src/core/controllers/smoothieware/driver.ts","line":96,"anchor":"Ground truth: Smoothieware @91fe4286 Kernel.cpp L214-234 (Run) and L262-287 (Idle) print MPos/WPos through from_millimeters; Robot.cpp L601-602 G20/G21, Robot.h L53, Robot.cpp L348/L362 M120/M121 keep inch_mode; Twin: Frame normalises units first (frame-report-units.ts:102, 2026-10-02 frame-lifecycle P1 fix), point moves do not (laser-jog-actions.ts:94-98)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (createSmoothieSimulator + own inch_mode/M120-M121 adapter, real Console G20 + dispatchHeadMove bed X60 Y60: head X156.063 Y436.063 for target X60 Y340, then X249.919 Y518.895 for X100 Y100; only toast is the generic unverified-bed warning also shown in baseline) + SOURCE Smoothieware edge 91fe4286","known":false,"summary":"After a Console G20 on Smoothieware the board reports inches, KerfDesk reads them as mm, and a point move from X100 to X60 sends G0 X56.063 relative so the head goes to X156.063; only Frame normalises report units"},
  {"id":"G4-K-1","severity":"P3","area":"controllers-preflight","file":"src/ui/gcode-inspector/use-external-program.ts","line":46,"anchor":"Ground truth: Ortur_Laser_Firmware_17X-18X @4849ac85 gcode.c L44, L458, L472-479, L582, L615-617","evidence":"SOURCE","verdict":"KNOWN","known":"M4-P3-8","summary":"Run review keys grblHAL rules on the profile kind; a level-1 grblHAL under the stock profile runs G5, canned cycles, G51 scaling and stops at M1 while the review says otherwise"},
  {"id":"G4-K-2","severity":"P3","area":"controllers-preflight","file":"src/core/external-program/storage-command-check.ts","line":43,"anchor":"Ground truth: Smoothieware CartGridStrategy.cpp (M375 loads grid)","evidence":"READ","verdict":"KNOWN","known":"M4-P3-9","summary":"Smoothieware M375 still not refused in opened programs"},
  {"id":"G4-K-3","severity":"P3","area":"controllers-preflight","file":"src/core/controllers/fluidnc/driver.ts","line":45,"anchor":"Ground truth: FluidNC v4.0.3 FileCommands.cpp L660-687","evidence":"REPRO","verdict":"KNOWN","known":"C5-P3-2","summary":"FluidNC file-run, format and restart commands are one unconfirmed Console line"},
  {"id":"G4-K-4","severity":"P3","area":"controllers-preflight","file":"src/core/external-program/controller-block-check.ts","line":72,"anchor":"Ground truth: FluidNC v4.0.3 GCode.cpp L543-552; gnea/grbl gcode.c G43/G49 axis command","evidence":"READ","verdict":"KNOWN","known":"E4-P3-1","summary":"G49 with a motion word is not refused or marked rejected"}
]
```
