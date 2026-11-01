## ADR-375 Amendment 11 - KerfDesk's own G21 keeps Smoothieware's report units, and a FluidNC board's bracket lines are read on any GRBL-family profile (2026-10-28)

**Status:** Accepted; software-verified with the repo's Smoothieware simulator and a FluidNC board
model through the real store. Not hardware-tested. | **Date:** 2026-10-28

Corrects [Amendment 7](ADR-375-amendment-7-bracket-lines-and-gcode-report-units.md). One of its
Consequences did not hold, and this does one item it lists as "Not done". Follows rolling audit v5
findings J7-P1-1 and J7-P1-2 (both P1). The auditor, an independent refuter with its own firmware
models and the coordinator all confirmed both in main's code. Sources are Smoothieware `edge` at
`91fe4286e8ee19f062260abf094b315f9cf6bedf` and FluidNC `v4.0.3`
(`25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f`), as Amendment 7 cites them. No hardware was available,
so none of this is hardware evidence.

### Context

- **J7-P1-1: KerfDesk's own G21 changed Smoothieware's units behind its own back.** Amendment 7
  reads a Smoothieware board's reports in inches after a Console G20, or when the board was left in
  G20 at connect. Three origin writes still send a plain `G21` before their `G92`, outside
  M120/M121 (`writeXyOffset` in `laser-origin-restore.ts`):
  - Restore saved origin (the recovery review);
  - Place Board's corner origin;
  - Continue from where the head stopped.

  Auto-focus sends the same `G21` before a `G38.2`/`G38.4` command (`autofocus-action.ts`). G21
  clears inch mode
  ([Robot.cpp L601-L602](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.cpp#L601-L602)),
  and MPos and WPos are printed in the current units
  ([Kernel.cpp L262-L287](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/libs/Kernel.cpp#L262-L287)).
  So the board went back to millimetres while KerfDesk still read inches. Before Amendment 7
  KerfDesk never read inches here, so these writes kept the two in step. Now they split them.
  - In the audit's simulator repro, Move to position X60 from X100 sent `G0 X-2480.000 Y-2480.000`.
  - Go to work zero drove the head to X-1170.
  - A second Restore saved origin wrote `G92 X2490.000 Y2490.000`.
  - No notice or toast appeared.

  Amendment 7's Consequence that the board's units "are not changed behind the operator's back"
  was false for these writes. Frame, the twin, sends the same G21 and records millimetres in the
  same step (`frame-report-units.ts`). The jog's G21 sits inside M120/M121, so it does not last.
  The camera ring job frames before it streams, so its program's G21 changes nothing. Probing, the
  surface probe and the start mark run only on the GRBL family, whose reports follow `$13`.
- **J7-P1-2: a FluidNC board under the stock-GRBL profile still took `[13]1` as G-code.**
  Amendment 7 taught the FluidNC driver that FluidNC runs a line starting with `[` as a `$` command
  ([ProcessSettings.cpp L1209-L1240](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1209-L1240)).
  A FluidNC board greets as `Grbl 3.x [FluidNC …]`, and it often runs under the default stock-GRBL
  profile. There `detectControllerFromBanner` already names it FluidNC, but the stock driver still
  read the line as G-code.
  - `[13]1` went out with no confirmation and no `$$` re-read. The board then reported inches,
    KerfDesk kept millimetres, and the next point move from X100 to X60 sent
    `$J=G91 G21 X56.063 Y56.063`. The head went to X156.
  - `[RST]#` wiped G54-G59 while the probed Work Z stayed current.
  - In the same session `$13=1` asked for confirmation and `$RST=#` was blocked.

  That broke Amendment 6 decision 1: a line goes out only when both readings get the same
  safeguards, on every GRBL-family profile. Amendment 7 listed the gap as "Not done".

### Decision

1. **KerfDesk records the units its own units line selects.** This applies on a driver that
   declares `reportUnitsSelectedBy` (Amendment 7 decision 3; only Smoothieware does), as Frame
   does (`owned-report-units.ts`, `beginOwnedReportUnitsLine`).
   - It covers the origin writes' `G21` and Auto-focus's setup lines.
   - If a line may leave other units than KerfDesk reads in, the report units become unconfirmed
     before it is written. Every reported position and the work offset are then hidden.
   - Once the controller acknowledges the line, KerfDesk reads positions in the units it selected.
     A report that arrived while the line was in flight is dropped. The origin write's `G92` is then
     confirmed from a report in those units.
   - When the units change, the Console transcript says so: "… selected millimetres (G21), so the
     controller now reports positions in millimetres". An operator who chose G20 there sees that
     the board is back in millimetres.
   - A line that fails or is cancelled leaves the units unconfirmed. Positions stay hidden until
     `$G` or Frame names them, as for a Console line that cannot be read back.
   - A G21 while KerfDesk already reads millimetres changes nothing and says nothing.
2. **KerfDesk's own programs are checked as opened programs are.** As the stream is installed, a
   KerfDesk program that may leave other units than KerfDesk reads in hides the position until
   `$G` or the next Frame names the units (`ownedProgramReportUnitsPatch`, Amendment 7 decision 5).
   One pass over the program text decides it. An ordinary Start has framed first, and Frame
   selected G21, so nothing changes there. This catches a recovery, which frames nothing before it
   streams.
3. **A GRBL-family profile reads a line as FluidNC runs it once the banner shows FluidNC.**
   - This covers the stock-GRBL and grblHAL profiles and the Falcon contract on either.
   - The Console line is put in the form a FluidNC board runs first (`fluidncBoardCommandForm`).
     `[key]value` becomes `$key=value`, and a long name becomes its Grbl name. FluidNC's own
     refusals apply: `$NVX` in every spelling, and `report_inches` with a value.
   - The profile's own classifier then checks that `$` form, and the `$` form is what is sent
     (`board-console-command.ts`).
   - So `[13]1` gets the profile's `$13=1` confirmation, and the acknowledged write is re-read
     with `$$`. That keeps `reportInches` true to the board.
   - `[RST]#`, `[Settings/Restore]#` and `[NVX]` are blocked, so the work offsets and the probed
     Work Z stay true.
   - This holds in the Console's store action, in its confirmation step and its disabled reason,
     and in Auto-focus's command policy.
   - The FluidNC driver keeps its own reading. Marlin and Smoothieware keep theirs.
4. **Kept:**
   - Frame still selects G21 itself.
   - The jog still runs in millimetres inside M120/M121.
   - The GRBL family's units still come from `$13` and `$$`.
   - This adds no refusal to Frame, Start, Save G-code or output, and no Job Review gate.

### Consequences

- **Amendment 7 is corrected.** After a Console G20 on Smoothieware, KerfDesk reads inches until a
  line selects G21. The operator's own lines, or KerfDesk's origin writes, Auto-focus or Frame, can
  do that. KerfDesk reads the new units at once and says so in the Console. A board left in G20 at
  connect is read the same way.
- **Amendment 7's "Not done" stock-GRBL line is done**, when the banner shows FluidNC.
- **The FluidNC refusal text names no profile.** It says KerfDesk "does not send it to a FluidNC
  controller", since the stock-GRBL profile now gives it too.
- **Not done:**
  - A FluidNC board whose banner KerfDesk did not see (one connected without a reset) is still
    read by the profile. Stock GRBL answers `error:1` to a line starting with `[`, so refusing it
    there would lose nothing, but this amendment does not.
  - The bracket form of FluidNC's file and WebUI commands (`[ESP…]`) is still the KNOWN controller
    v2 C5-P3-2 (rolling audit v3 G4-K-3).
  - Under a GRBL profile, a FluidNC or grblHAL board's opened program is still reviewed by the
    profile (M4-P3-8, P3).
- **Tests:**
  - `smoothie-owned-report-units.simulator.test.ts` runs the audit's Smoothieware repros. It wraps
    the simulator in the inch-mode model from `smoothie-inch-board.test-support.ts`, which is now
    shared with Amendment 7's test. It covers:
    - a Console G20, then Place Board's corner origin;
    - a board left in G20, then Restore saved origin twice;
    - Continue from where the head stopped;
    - Auto-focus's setup;
    - a control with no G20.

    After each owned write, Move to position, Go to work zero and the recovery move land where they
    should. With the tracking disabled, the four repros fail and the control passes.
  - `owned-report-units.test.ts` covers the program check.
  - `frame-after-completed-coordinate.audit.test.ts` streams a program that ends in G20, then
    frames. Before its Frame, the offset is now hidden, where KerfDesk used to read the inch
    report (5, 2) as millimetres. After the Frame, the G92 datum is kept as before.
  - `fluidnc-bracket-under-grbl-profile.test.ts` runs the audit's FluidNC repro through the store
    under the stock-GRBL profile. It shares `fluidnc-board.test-support.ts` with Amendment 7's
    test. It covers `[13]1` unconfirmed and confirmed, the reset and erase lines, and
    `report_inches`. After each, the next point move sends `$J=G91 G21 X-40.000 Y-40.000`. With the
    session reading disabled, all 11 fail.
  - `board-console-command.test.ts`, `run-console-command.test.ts` and
    `console-command-availability.test.ts` cover the profile matrix, the confirmation step and the
    disabled reason.
- The evidence is code and tests only, not hardware.
