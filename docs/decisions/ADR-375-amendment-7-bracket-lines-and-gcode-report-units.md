## ADR-375 Amendment 7 - FluidNC bracket lines are `$` lines, and Smoothieware's report units are read back (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27

Amends ADR-375 decision 9 and corrects
[Amendment 6](ADR-375-amendment-6-console-reads-a-line-as-the-firmware-does.md) decision 1, after
rolling audit v3 findings G4-P1-1 and G4-P1-2 (both P1). Independent refuters confirmed both against
the pinned firmware, and the coordinator re-verified them in code on main `9a2bf6b13`. G4-P1-1 also
re-rates controller audit v2 C6-P3-1 from P3 to P1. Sources are FluidNC `v4.0.3`
(`25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f`), Smoothieware `edge` at
`91fe4286e8ee19f062260abf094b315f9cf6bedf`, gnea/grbl `bfb67f0c`, grblHAL core `d7aaee3d` and Marlin
`1cd56c4c`. No hardware was available, so none of this is hardware evidence.

### Context

- **FluidNC runs `[key]value` as `$key=value`.** `execute_line` hands a line that starts with `$` or
  `[` to `settings_execute_line`. That splits a `[` line at the first `]` where it splits a `$` line
  at the first `=`, and both reach `do_command_or_setting`, "the handler for all forms of settings
  commands"
  ([ProcessSettings.cpp L1088-L1113, L1209-L1240](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1209-L1240)).
  So every `$` command and setting has a bracket spelling:
  - `[13]1` is `$13=1`, Report/Inches (L1080, L729-L736). Status positions are then divided by
    25.4 ([Report.cpp L82-L84](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Report.cpp#L82-L84)).
  - `[RST]#` is `$RST=#` (L1067) and `[NVX]` is `$NVX` (L1034). Both erase the stored work
    offsets.
  - `[H]` is `$H`, `[J]…` is `$J=…`, and the WebUI's `[ESP…]` commands are their `$ESP…` forms.

  KerfDesk's FluidNC classifier only looked at lines that start with `$`, and Amendment 6's line
  reader only acts on a `$` command. So the Console sent each bracket line as G-code. In the audit's
  repro, `[13]1` went out unprompted, KerfDesk kept reading millimetres, and Move to position X60
  Y60 from X100 Y100 landed at X108.032 Y108.032. The next move landed at X203.779. `[RST]#` and
  `[NVX]` went out while the probed Work Z stayed current. In the same session, `$13=1` was refused
  and `$RST=#` was blocked.
- **FluidNC has a third spelling of `$13`.** The machine config's top-level `report_inches` item is
  the same flag
  ([MachineConfig.cpp L86](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Machine/MachineConfig.cpp#L86)).
  A runtime setting key loses one leading and one trailing `/` and matches without case
  ([RuntimeSetting.cpp L16-L27](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Configuration/RuntimeSetting.cpp#L16-L27),
  [RuntimeSetting.h L19-L24](https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Configuration/RuntimeSetting.h#L19-L24)).
  So `$report_inches=on` and `$/report_inches=true` also went out as G-code.
- **Smoothieware's reports follow its G-code units.**
  - `Kernel::get_query_string` prints MPos and WPos through `Robot::from_millimeters`, in the Idle
    branch as in the Run one
    ([Kernel.cpp L214-L234, L262-L287](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/libs/Kernel.cpp#L262-L287)).
    In inch mode that divides by 25.4
    ([Robot.h L52-L53](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.h#L52-L53)).
  - G20 and G21 set inch mode
    ([Robot.cpp L601-L602](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.cpp#L601-L602)).
  - M120 and M121 save and restore it
    ([Robot.cpp L344-L365](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.cpp#L344-L365)),
    so the jog's own G21 inside M120/M121 does not last.
  - M2 and M30 keep it
    ([Robot.cpp L726-L734](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.cpp#L726-L734)).
  - `$G` prints G20 or G21 from it
    ([SimpleShell.cpp L879-L892](https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/utils/simpleshell/SimpleShell.cpp#L879-L892)).

  Only Frame selected G21 before reading a position (`normalizeFrameReportUnits`, the 2026-10-02
  frame-lifecycle fix). Point moves, Go to work zero and the recovery move take a target or a delta
  from the raw report. After a Console G20, Move to position X60 Y340 drove the head to X156.063
  Y436.063, past a 400 mm bed.
- **The other firmwares do not follow G20.** The GRBL family's reports follow `$13`: gnea/grbl
  `printFloat_CoordValue`
  ([print.c L175-L181](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/print.c#L175-L181)),
  grblHAL
  ([report.c L202-L204](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L202-L204))
  and FluidNC (above). Marlin's M114 prints logical millimetres whatever G20 selects
  ([motion.cpp L191-L212](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/motion.cpp#L191-L212)).

### Decision

1. **The FluidNC Console reads a `[` line as the `$` line FluidNC runs.** `[key]value` becomes
   `$key=value`, and `[key]` or `[key` becomes `$key` (`fluidncDollarForm`). This happens before the
   long-name translation and every check, and the `$` form is what is sent, as a long name already
   was. So the bracket form gets the same handling as the `$` form:
   - the persistent-command block (`[RST]…`, `[NVX]`, `[Settings/Restore]…`, `[Settings/Erase]`);
   - the setting-write classification and confirmation (`[13]1`), which the FluidNC profile then
     refuses like `$13=1`;
   - the units tracking and the `$$` re-read where a write is sent, which keeps decision 9's rule
     that every setting write is read back;
   - Amendment 6's comment checks.

   Because `[RST]` and `[NVX]` are now blocked like `$RST=` and `$NVX`, they never reach the
   controller, and the Work-Z evidence stays true. A bracket key that holds `=` names no FluidNC
   command, but its `$` form would read as one, so it is refused.
2. **FluidNC's `report_inches` is refused when it has a value.** `$report_inches=…`,
   `$/report_inches=…` and their bracket forms are refused, like the numeric `$13=` write the
   profile never sends. With no value, it is a read and goes out.
3. **A driver whose position reports follow its G-code units says so.** It declares
   `reportUnitsSelectedBy(line)`, which returns the units a line leaves the reports in, or null.
   Only Smoothieware declares it. G20 gives inches and G21 gives millimetres. M121, or a line with
   both, gives unknown. The words are read loosely, comments and spaces included: a word the
   firmware would not run costs one `$G` read.
4. **A Console line that may leave other units is read back with `$G`.** That is a line whose
   units differ from those KerfDesk reads in, or any units line while the units are unconfirmed.
   - Before the line is written, the report units become unconfirmed, as for a `$13` write: every
     reported position and the work offset are hidden.
   - Once the controller has answered, the Console sends `$G`.
   - On a driver that declares the hook, the line handler records the units of every `[GC:]` report
     (`modalReportUnitsPatch`). So the Console's read, the operator's own `$G`, Frame's WCS read and
     the connect read all confirm them. KerfDesk then reads positions in the units the board
     reports.
   - If the read fails or names no units, positions stay hidden. The Console says to send `$G` or
     Frame, and a point move says the same.
   - A G21 while KerfDesk already reads millimetres changes nothing.
5. **An opened program that may leave other units hides the position too.** On a driver that
   declares the hook, it hides the reported position as its stream is installed. The next `$G` or
   Frame names the units. A CAM header's G21 while KerfDesk reads millimetres changes nothing.
6. **Kept:**
   - Frame still selects G21 itself before it reads a position (`normalizeFrameReportUnits`).
   - The GRBL family's units still come from `$13` and `$$`.
   - The jog still runs in millimetres inside M120/M121.
   - This adds no refusal to Frame, Start, Save G-code or output, and no Job Review gate.

### Consequences

- **Amendment 6 decision 1 is corrected.** It said its rule "holds on every GRBL-family profile
  (GRBL, grblHAL, FluidNC and the Falcon contract)". On FluidNC that held for comments and `/`, but
  not for the bracket form. With decision 1 above, it now holds for both.
- **After a Console G20 on Smoothieware, KerfDesk reads inches.** The DRO, the head marker, point
  moves, Go to work zero and the recovery move use the board's own units, which are not changed
  behind the operator's back. The next Frame selects G21 as before.
- **A board left in G20 is read in inches at connect.** On reconnecting to a Smoothieware board that
  an earlier session left in G20, the connect-time `$G` (`qualifyWithoutSettingsDump`, audit CG-2)
  now sets the units too.
- **Smoothieware programs with G20 hide the position.** After a program that selects G20, or an
  M121, the position stays hidden until `$G` or a Frame. That holds during the run too, where the
  reports would have been misread.
- **Not done:**
  - The bracket form of FluidNC's file and WebUI commands (`[ESP700]`, `[ESP220]`, `[ESP710]`) is now
    classified like its `$` form, which is still the KNOWN controller v2 C5-P3-2 (rolling audit v3
    G4-K-3).
  - A stock-GRBL profile talking to a FluidNC board does not translate bracket lines.
- **Tests:**
  - `fluidnc/fluidnc-bracket-commands.test.ts` and `smoothieware/report-units.test.ts` cover the
    classifiers.
  - `fluidnc-bracket-console.test.ts` runs the audit's FluidNC repro through the store.
  - `smoothie-console-report-units.simulator.test.ts` runs the Smoothieware repro, with inch mode
    and its M120/M121 stack modelled around the simulator. It covers the point move, G21, the
    recovery move and a `$G` that names no units.
  - `external-program-controller-state.test.ts` covers opened programs.
  - With the two drivers as on main, 13 of the 15 store tests fail; the two that pass are
    controls. The recovery move then lands at X88.819 instead of X60.
- The evidence is code and tests only, not hardware.
