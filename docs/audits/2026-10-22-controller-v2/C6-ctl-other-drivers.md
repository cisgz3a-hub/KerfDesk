# Controller audit v2 — C6 Other drivers (`ctl-other-drivers`)

- **When:** 2026-10-22 09:50   **Tree:** origin/main @ `99a2e64b7` (audit worktree HEAD `2740a600a`;
  only audit docs differ from `99a2e64b7`; `git fetch` at 09:20 showed origin/main unchanged)
- **Scope:**
  - Drivers: `src/core/controllers/grblhal/**`, `fluidnc/**`, `marlin/**`, `smoothieware/**`.
  - Shared interface: `controller-driver.ts`, `controller-capabilities.ts`,
    `select-controller-driver.ts`, `detect-controller.ts`, `relative-jog-commands.ts`,
    `console-setting-writes.ts`, and the GRBL base driver and classifier these drivers inherit
    (`grbl/driver.ts`, `grbl/response.ts`, `grbl/console-command.ts`).
  - Consumers read where a driver value lands: `laser-frame-motion-plan.ts`, `framed-run.ts`,
    `laser-line-handler.ts`, `laser-interactive-command.ts`, `laser-unknown-command.ts`,
    `console-command-transport.ts`, `external-program/normalize-external-program.ts`,
    `gcode-view/laser-render-state.ts`.
  - Governing: ADR-094 (driver seam, capability-gated UI), ADR-095 (Marlin), ADR-096
    (Smoothieware), ADR-364 (resume in the program dialect), ADR-395 (Marlin abort, skipped
    commands), ADR-396 (work offset on Marlin/Smoothieware), ADR-397 (Smoothieware asks the
    board), ADR-400 (GRBL family follows the firmware), ADR-456 (FluidNC acknowledged lines),
    ADR-565 and PROJECT.md non-negotiable 21 (Frame), ADR-630 (external programs), ADR-644.
- **Lenses run:** L2 (per firmware, against pinned source), L3, L4, L6, L7 as separate passes;
  L1 folded into each finding's anchor. L5 skipped: the only untrusted input is the operator's
  own Console line (covered here under L4) and the controller's replies (treated as firmware
  ground truth).
- **Primary sources fetched this session** (downloaded to the session scratchpad, read by line):
  - grblHAL core `d7aaee3d`: `protocol.c`, `system.c`, `report.c`, `settings.c`, `gcode.c`,
    `state_machine.c`, `motion_control.c`, `config.h`.
  - FluidNC `v4.0.3`: `ProcessSettings.cpp`, `SettingsDefinitions.cpp`, `Report.cpp`,
    `Protocol.cpp`, `GCode.cpp`, `Channel.cpp`, `RealtimeCmd.h`, `Settings.cpp/.h`, `Jog.cpp`,
    `Main.cpp`.
  - Marlin `2.1.2.8`: `module/motion.cpp/.h`, `gcode/motion/G0_G1.cpp`, `gcode/gcode.cpp/.h`,
    `gcode/queue.cpp`, `gcode/parser.cpp`, `gcode/geometry/G92.cpp`, `gcode/host/M114.cpp`,
    `M115.cpp`, `gcode/control/M3-M5.cpp`, `M108_M112_M410.cpp`, `M999.cpp`, `M7-M9.cpp`,
    `M106_M107.cpp`, `MarlinCore.cpp`, `core/language.h`, `Configuration.h`,
    `Configuration_adv.h`; `lcd/language/language_en.h` (MSG_HOME_FIRST).
  - Smoothieware `38e2cc08`: `Laser.cpp/.h`, `Kernel.cpp`, `GcodeDispatch.cpp`,
    `SimpleShell.cpp`, `Robot.cpp`, `USBSerial.cpp`, `SerialConsole.cpp`, `Endstops.cpp`,
    `Switch.cpp`.
  - Smoothieware docs: smoothieware.org/laser-cutter-guide, /supported-g-codes.
- **Counts:** 8 raised → 0 refuted → P1 0 / P2 2 / P3 6 (+ 9 KNOWN re-observed). Refuter
  (2026-10-22): 8 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED. No severity changes.

## Headline

The four drivers match their firmware on the commands that move or stop the machine: realtime
bytes, `$J=`/0x85 on grblHAL and FluidNC, Marlin's M410 quickstop and stream-side pause,
Smoothieware's Ctrl-X halt and M999, and each firmware's Home. The defects sit where a driver
leaves the controller in a state the next program does not expect, or where the firmware
skips a line but still answers `ok`:

- **Smoothieware.** Every Frame, jog and Home sends `M221 S0`, which sets Smoothieware's global
  laser power scale to 0 %. KerfDesk's own output re-arms it with `M221 S100` at each M3/M4.
  A G-code file made elsewhere (ADR-630 Run), which sets power only with `S`, then runs with
  no burn. The Frame is mandatory before that Start, so this always happens.
- **Marlin.** On a build with `NO_MOTION_BEFORE_HOMING` (or a stopped Marlin), Marlin skips
  every G0/G1 with an `echo:Home XYZ First` line and still answers `ok`. KerfDesk counts each
  skipped line as done, so a Frame that never moved is recorded as complete. On such a build
  with a Z axis, KerfDesk's own `G28 X Y` Home never satisfies Marlin.

The Console's persistent-write blocks are also bypassable on all three non-GRBL firmwares
(FluidNC `[RST]#`, Marlin `M500 ;x`, Smoothieware `M500`/`M1000 rm …`).

## Command map (as audited)

| Operation | grblHAL / FluidNC (GRBL base) | Marlin | Smoothieware |
|---|---|---|---|
| Status | `?` realtime | `M114` queued, only while idle | `?` realtime (USB and UART) |
| Pause / Resume | 0x84 door, then `~` | stream-side; `M107`/`M5 I` queued | stream-side only (no `!`/`~`) |
| Abort | Ctrl-X | `M107`, `M410`, `M5 I` | Ctrl-X (halts), then `M5`, `M9` |
| Jog | `$J=G91 G21 …` + 0x85 | `G21`,`G91`,`G0 … F`,`G90` | tool-off + `M120`,`G21`,`G91`,`G0`,`G90`,`M121` |
| Frame | `M5`,`M9`, `$J=G90 G21 X Y F` | `M5 I`,`M107`,`G21`,`G90`,`G0 …` | tool-off, `G21` normalize, `M120` … `M121` |
| Home | `$H` (FluidNC also `$HX`, `$H=`) | `G28 X Y` | `M400`, tool-off, `$H`, then `G28.6` verify |
| Unlock | `$X` | — | `M999` |
| Probe / Fire | `G38.2` / `G1 F M3 S` | — / — | — / — |
| Smoothie tool-off | | | `fire off`, `M400`, `M221 S0`, `M5`, `M9` |

## Findings

### P2-1 — Smoothieware: every Frame, jog and Home leaves the laser power scale at 0 % (`M221 S0`), so an external program that sets power only by `S` runs with no burn

- **Where:**
  - `src/core/controllers/smoothieware/commands.ts:37-43`. `SMOOTHIE_FRAME_TOOL_OFF_LINES`
    includes `M221 S0`. The jog (`:66-73`), the Frame (`driver.ts:87`, prepended by
    `laser-frame-motion-plan.ts:30`) and Home (`driver.ts:76`) all send it.
  - `src/core/external-program/normalize-external-program.ts:68-72`. The Smoothieware baseline
    of an external run is `G17G21G90G0`. Nothing restores the power scale.
  - `src/core/gcode-view/laser-render-state.ts:21`. The Inspector and Run review assume
    `smoothiePowerScale: 1` until the program's own `M221`.
  - `src/core/controllers/grbl/native-laser-resume.ts:77,92`. A resume of a program with no
    `M221` (`beam.scale === null`) restores no scale either.
- **Anchor:**
  - Ground truth, Smoothieware `38e2cc08` `Laser.cpp`:
    - `M221 S` sets `this->scale = S / 100` (L198-212).
    - Every G1-G3 block burns at `requested_power * ratio * scale` (L241-255).
    - `M120`/`M121` push and pop only feed, seek, absolute, inch and WCS
      (`Robot.cpp:331-352`), so the jog's push/pop does not restore the scale.
  - SOURCE smoothieware.org/laser-cutter-guide: "M221 Snnn globally scales the laser power
    provided by G1 by nnn percent."
  - Contract, ADR-630: the baseline sets "every mode the review reads the program in that the
    controller keeps between programs". The scale is such a mode, and KerfDesk itself sets it to
    0 in the Frame that ADR-565 requires before Start.
  - Twin:
    - KerfDesk's own Smoothieware output writes `M400` + `M221 S100 P<mode>` at every M3/M4
      (`smoothieware-strategy.ts:68`), so it is unaffected.
    - The Inspector renders the external program at scale 1 (`laser-render-state.ts:21`).
- **Scenario:**
  - A LightBurn-style Smoothieware file: `G00 G17 G40 G21 G54`, `G90`, `M3`, `G0 X0 Y0`,
    `G1 X10 Y0 S0.5 F600`, `G1 X10 Y10`, `M5`. Smoothieware's laser module ignores M3/M5, and
    power comes from `S` × scale.
  - The operator opens it with Run G-code file, frames it (mandatory) and presses Start.
  - The Frame sent `M221 S0` and the program never sets the scale, so every burn runs at
    0 % (or at `laser_module_minimum_power`).
  - The Run review and Inspector showed burns at 50 %. The job "completes" with nothing cut and
    no warning.
  - The scale also persists after KerfDesk disconnects, until the board resets. A KerfDesk job
    also ends with `M221 S0`, so the next program from another sender runs dark as well.
- **Evidence:** REPRO, temporary Vitest
  `src/core/controllers/smoothieware/zz-c6-external-scale.test.ts` (deleted).
  - Method: the real `normalizeExternalProgram(…, 'smoothieware')`, the real
    `smoothiewareDriver.commands.frameToolOffLines` + `buildFrameLines`, run through the repo's
    Smoothieware power oracle (`__fixtures__/controllers/smoothie-laser-power-model.ts`).
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/core/controllers/smoothieware/zz-c6-external-scale.test.ts --silent=false`.
  - Output:
    - `frame lines ["fire off","M400","M221 S0","M5","M9","M120","G21","G90","G0 X0.000 Y0.000 F3000",…,"M121"]`
    - `no Frame: burn powers [0.5,0.5] scale 1`
    - `after Frame: burn powers [] scale 0`
    - `jog lines ["fire off","M400","M221 S0","M5","M9","M120","G21","G91","G0 X1.000 F1000","G90","M121"]`
  - Supporting search: LightBurn's Smoothieware output, as quoted on its forum, sets power with
    `S` on G1 and uses `M3`/`M106`, with no `M221`.
- **Severity:** P2, not P1. The result is wrong power, but it is an obvious no-burn, not a
  hazard or a subtly wrong part. Every Smoothieware user who runs a file made elsewhere hits it,
  and the review says the opposite.
- **Refuter:** CONFIRMED. Reproduced at store level, with the source fetched again. Severity P2
  kept.
  - Source: Smoothieware edge `Laser.cpp`, fetched 2026-10-22.
    - The constructor sets `scale = 1` (L46). `M221 S` sets `this->scale = S / 100` (L204).
    - Every G1-G3 block burns at `requested_power * ratio * scale` (L251).
    - Nothing else writes `scale`, and `on_halt` keeps it.
    - `Robot.cpp` `push_state`/`pop_state` (L344-365) save only feed, seek, absolute, inch and
      WCS.
    - smoothieware.org/laser-cutter-guide: "M221 Snnn globally scales the laser power provided
      by G1 by nnn percent."
  - Nothing restores the scale:
    - Outside the strategy and resume code, no non-test `src/` file sends `M221 S100`.
    - `startExternalProgram` → `startJob(gcode)` (`laser-job-actions.ts` `runStartJob`) streams
      the normalized bytes with nothing added.
    - The connect-time `M221` probe (`laser-module.ts`) checks only that the module is present.
      It never reads the scale.
  - REPRO: temporary store test `src/ui/gcode-inspector/zz-c6r-smoothie-scale.test.ts`
    (deleted).
    - Setup: the Smoothieware simulator, then the real `frameExternalProgram`, then the real
      `startExternalProgram`. The file is the scenario's file.
    - Output: `frame recorded true scale after frame 0`, `started true`, job sent
      `["G17G21G90G0","G00G17G40G21G54","G1X10Y0S0.5F600","G1X10Y10"]`, `final scale 0
      burnPowers []`.
    - Control, the same file with `M221 S100` as its first line: `final scale 1 burnPowers
      [0.5,0.5]`.
  - New: there is no workaround inside the flow. A Console `M221 S100` after the Frame restores
    the scale but drops the Frame record (`scale after console 1 frameVerification kept
    false`). Start then refuses with "Frame this program first". Only a file that sets M221
    itself burns.
  - Severity: P1 was considered ("silently produces wrong physical output: power") and
    rejected:
    - The failure is dark. The beam stays off, or makes a faint pass at
      `laser_module_minimum_power`.
    - It shows on the first burn line, and it uses up no stock.
    - KerfDesk itself gives no signal: the review renders at scale 1 and the job ends normally.
- **Fix direction:**
  - Put `M221 S100` in the Smoothieware external-program baseline. Or drop `M221 S0` from the
    tool-off lines: G0 never fires (`Laser.cpp:245`) and `fire off` already ends manual mode.
  - Either way, have the Run review state the scale the program will run at.

### P2-2 — Marlin: a move Marlin skips with `echo:Home XYZ First` (or while stopped) is acknowledged `ok` and counted as done, so a Frame that never moved is recorded complete

- **Where:**
  - `src/core/controllers/marlin/response.ts:18,41-47`. `echo:Home XYZ First` falls to the
    generic `{ kind: 'message', tag: 'echo' }`. Only `echo:Unknown command` gets the
    skipped-line treatment (`:21`, ADR-395 / MA-12).
  - `src/ui/state/laser-unknown-command.ts`, `laser-interactive-command.ts:256-264`. The skip
    handling exists for `unknown-command` events only.
  - `src/ui/state/framed-run.ts:239-253`. Frame completion compares the end position with the
    pre-Frame position. A Frame whose moves were all skipped passes, because the head never
    left.
  - `src/core/controllers/marlin/commands.ts:8`. Home is `G28 X Y`, which never homes Z.
- **Anchor:**
  - Ground truth, Marlin 2.1.2.8:
    - `module/motion.h:461-465`: with `NO_MOTION_BEFORE_HOMING`, `MOTION_CONDITIONS` is
      `IsRunning() && !homing_needed_error()`.
    - `gcode/motion/G0_G1.cpp:48`: `if (!MOTION_CONDITIONS) return;`.
    - `module/motion.cpp:1479-1496`: prints `echo:` + "Home %s First" for every unhomed main
      axis, Z included (`axes_should_home`, `:1465-1477`; `language_en.h` MSG_HOME_FIRST).
    - `gcode.cpp` then answers the line with `ok`.
    - When stopped, `queue.cpp:523-535` prints the unprefixed STR_ERR_STOPPED for each G0-G3,
      and the move is skipped the same way.
    - `Configuration.h:1697` documents the option (off by default).
  - Twin: ADR-395 already treats Marlin's other "skipped, then `ok`" reply (`Unknown command`)
    as a refusal for jobs and owned commands.
  - Contract: ADR-565 and PROJECT.md non-negotiable 21. A completed Frame is the sole Start
    gate, and here it is minted for motion that never happened.
- **Scenario:**
  - A Marlin laser build with `NO_MOTION_BEFORE_HOMING`.
  - The operator Frames without homing. If the build has a Z axis, the same happens after
    KerfDesk's Home, because `G28 X Y` leaves Z unhomed.
  - Every `G0` answers `echo:Home XYZ First` then `ok`. KerfDesk logs the echo and records the
    Frame as complete. Jogs report done the same way.
  - Start is unlocked. Every G0/G1 of the job is skipped with `ok`, but `M106 S<n>` still runs.
  - On a fan-wired laser (`marlin-fan` dialect), `M106` drives the fan output immediately when
    the planner is empty (`planner.cpp:1388-1399`). So the beam lights at the parked spot for
    the time it takes to stream each burn group's skipped G1 lines.
  - Inline `M3 I` does not burn: its power applies only to planned blocks.
- **Evidence:**
  - REPRO (classifier), temporary Vitest `src/core/controllers/zz-c6-console-bypass.test.ts`
    (deleted). Output:
    - `classify {"kind":"message","tag":"echo","body":"Home XYZ First"}`
    - control `classify {"kind":"unknown-command","command":"M8",…}`
    - `classify {"kind":"unknown","raw":"Printer stopped due to errors. …"}`
  - SOURCE as above.
  - READ: the Frame completion path (`framed-run.ts:249`). No store-level run was done: the
    Marlin simulator has no `NO_MOTION_BEFORE_HOMING` option.
- **Severity:** P2. It needs a non-default build option, but the result is a false Frame record
  and, on fan-wired builds, a stationary burn.
- **Refuter:** CONFIRMED. Reproduced at store level, with Marlin 2.1.2.8 fetched again. Severity
  P2 kept.
  - Source: Marlin 2.1.2.8, fetched 2026-10-22. Marlin answers `echo:Home XYZ First`, then
    `ok`.
    - `motion.h:461-462`: `MOTION_CONDITIONS` adds `!homing_needed_error()`.
    - `G0_G1.cpp:48`: the move returns early.
    - `motion.cpp:1479-1495`: prints `SERIAL_ECHO_START` + "Home %s First" for every main axis
      that is not homed. This includes Z, because `axes_should_home` uses `main_axes_mask`.
    - `gcode.cpp:1122`: `queue.ok_to_send()` then answers the line.
  - Default: off.
    - `Configuration.h:1697` is commented out. So are the Prusa MK3, Ortur 4 and Anet A8
      example configs (MarlinFirmware/Configurations `release-2.1.2.5`).
    - Shipped laser firmware was not surveyed.
    - On a build with no Z axis, KerfDesk's `G28 X Y` satisfies the check, so only the Frame
      before Home is hit. On a build with a Z axis, KerfDesk's Home never satisfies it.
  - KerfDesk has no detection:
    - Only `Unknown command` and `busy` echoes are acted on.
    - A grep of `src/` for `Home .*First`, `homing_needed` or `NO_MOTION_BEFORE_HOMING` finds
      nothing.
    - The line goes only to the transcript as `kind: 'message'`.
  - REPRO: temporary store test `src/ui/gcode-inspector/zz-c6r-marlin-home-first.test.ts`
    (deleted).
    - Setup: the Marlin simulator behind an adapter that answers each G0/G1 with
      `echo:Home XYZ First` and `ok` and runs no motion.
    - Frame, through the real `frameExternalProgram`: `frame recorded true`. All five Frame
      `G0` lines were skipped, the simulator stayed at `0,0`, and no notice appeared. The
      `M114` after each leg reported `X:0.00 Y:0.00`, and nothing compared it with the leg's
      target.
    - Start, through `startExternalProgram`: `started true`. `M106 S128` was sent and the
      simulator fan lit at `0,0` with no motion.
  - The `M106` claim is real, and it differs from an ordinary job start.
    - With `LASER_SYNCHRONOUS_M106_M107` off (the default, `Configuration_adv.h:3504`), M106
      sets the fan at once. With it on, the sync block on an empty planner also applies at once
      (`planner.cpp` `check_axes_activity`, L1388-1430).
    - In a real job the head moves under the beam. Here the beam stays on one spot while each
      burn group's skipped G1 lines are streamed.
  - The stopped case is weaker than written. `stop()` first prints `Error:Printer stopped due
    to errors…` (`MarlinCore.cpp:975`), which KerfDesk classifies as an error, so the operator
    sees an error before the skipped moves.
  - Severity: P2 kept.
    - It needs a non-default option, and there are signals: the head visibly does not move
      during the Frame, and the echo line shows in the Console.
    - Still, it breaks the sole Start gate (ADR-565) in a clear scenario, and on a fan-wired
      laser the beam lights in one spot.
- **Fix direction:**
  - Classify `echo:Home … First` (and the stopped line) as a skipped-line event, like
    `Unknown command`, so the Frame, jog and job stop with the reason.
  - On Marlin, consider `G28` (all axes) when the build reports a homed-Z requirement.

### P3-1 — FluidNC's bracket form `[key]value` bypasses the FluidNC Console classification: `[RST]#`, `[NVX]` and `[13]1` go out as ordinary G-code

- **Where:** `src/core/controllers/fluidnc/fluidnc-command-names.ts:91-113`
  (`splitDollarCommand` returns null unless the line starts with `$`) and
  `src/core/controllers/fluidnc/driver.ts:45-54`.
- **Anchor:**
  - Ground truth, FluidNC v4.0.3 `ProcessSettings.cpp:1224-1253`: `execute_line` sends any line
    starting with `$` or `[` to `settings_execute_line`. That function splits `[key]value` at
    `]` (`:1209-1221`) and runs it through the same `do_command_or_setting` (`:1090-1101`). So
    `[RST]#` is `$RST=#` and `[NVX]` is `$NVX`.
  - Twin: HF-6 blocks `$RST=…`, `$Settings/Restore=…` and `$NVX` in the same driver, and refuses
    `$13=`. The block's stated reason is "erases every setting and work offset".
- **Scenario:**
  - `[RST]#` or `[Settings/Restore]#` resets every G54-G59, G28 and G30 offset, and `[NVX]`
    erases the stored settings. Each passes the Console with no confirmation.
  - `[13]1` (`switchInchMM`, a UserCommand) switches FluidNC to inch reports. KerfDesk keeps
    `reportInches: false`, because only a `$13=` write triggers the units re-read. WPos, MPos
    and WCO are then read 25.4× too small until the next `$$`.
- **Evidence:** REPRO, same temporary test through `fluidncDriver.prepareConsoleCommand`:
  - `"$RST=#" REFUSED`, `"[RST]#" SENT … kind=gcode effect=machine-state confirm=false`
  - `"$NVX" REFUSED`, `"[NVX]" SENT …`
  - `"$13=1" … settingIssue=refused`, `"[13]1" SENT … kind=gcode`
  - `"[Settings/Restore]#" SENT`
  - Related: `"$axes/x/steps_per_mm=40" SENT … confirm=false`. FluidNC's live YAML write is
    unconfirmed, while the read-only `$100=40` proxy is refused.
- **Refuter:** CONFIRMED.
  - Source: FluidNC v4.0.3 `ProcessSettings.cpp`, fetched again.
    - `execute_line` (L1224-1240) sends any line that starts with `$` or `[` to
      `settings_execute_line`.
    - `settings_execute_line` splits a `[` line at `]` (L1213), then runs
      `do_command_or_setting` (L1090).
    - The commands are `RST`/`Settings/Restore` (L1067), `NVX` (L1034) and `13` (L1080).
  - KerfDesk: `splitDollarCommand` returns null without a leading `$`.
  - Repro through `fluidncDriver.prepareConsoleCommand`:
    - `$RST=#` REFUSED, `[RST]#` SENT confirm=false.
    - `$NVX` REFUSED, `[NVX]` SENT. `[Settings/Restore]#` SENT.
    - `$13=1` is a confirmed setting-write. `[13]1` goes out as plain gcode, confirm=false.
- **Fix direction:** Translate a leading `[key]value` to `$key=value` in `fluidncGrblCommandForm`
  before classification, as long names already are. Consider confirming YAML `$path=value`
  writes as `$N=` writes are on GRBL.

### P3-2 — Marlin's Console blocks only the exact text `M500`/`M502`; `M500 ;save`, `M 500` and `M0502` are sent

- **Where:** `src/core/controllers/marlin/console-command.ts:46`
  (`upper === 'M500' || upper === 'M502'`); `marlin/driver.ts:107` (`isSetupOnlyPayload`
  `/(^|\n)\s*M50[02]\b/i` misses `M0500` and `M 500`).
- **Anchor:**
  - Ground truth, Marlin 2.1.2.8:
    - `queue.cpp:369-371` drops `;` comments before parsing.
    - `parser.cpp:180-209` skips spaces between the letter and the code and reads leading
      zeros, so `M 500`, `M0500` and `M500 ;x` all run M500.
  - Contract: the module header says persistent writes "are blocked, matching the GRBL
    console's $RST/$N policy".
  - Twin: rolling-v2 17-P3-2, the GRBL `/` prefix bypass of the same kind of block.
- **Scenario:** The operator, or a macro, sends `M500 ; save`. Marlin stores the live settings
  to EEPROM with no Console refusal.
- **Evidence:** REPRO, same temporary test. Output:
  - `"M500" REFUSED`, `"M500 ;save" SENT`, `"M 500" SENT`, `"M0502" SENT`, `"M502 X" SENT`
  - `isSetupOnlyPayload M0500 false M 500 false`
- **Refuter:** CONFIRMED.
  - Source: Marlin 2.1.2.8, fetched again.
    - `parser.cpp:176` skips spaces after `G`/`M`/`T`, and the digit loop reads `0500` as
      500.
    - `queue.cpp:370` drops everything after `;`.
  - Repro:
    - `M500` and `m500` are REFUSED.
    - `M500 ;save`, `M 500`, `M0502` and `M502 X` are SENT.
    - `isSetupOnlyPayload` is false for `M0500` and for `M 500`.
- **Fix direction:** Match the command code the way Marlin parses it: strip comments, allow
  spaces after the letter and leading zeros, then compare the first word.

### P3-3 — Smoothieware's Console blocks `config-set`/`config-load` but sends `M500`, `M502`, `M504` and the `M1000` shell pass-through, which write or delete files on the SD card

- **Where:** `src/core/controllers/smoothieware/console-command.ts:65` (block regex) and
  `:97`. A capitalised `M` line is never treated as shell. `smoothieware/driver.ts:113` does
  the same for `isSetupOnlyPayload`.
- **Anchor:**
  - Ground truth, Smoothieware `GcodeDispatch.cpp`:
    - `M500` rewrites `/sd/config-override` (`:327-344`).
    - `M502` deletes it (`:359-363`).
    - `M501`/`M504` load or save named overrides (`:346-357`).
    - `M1000 <cmd>` passes the rest of the line to `SimpleShell::parse_command` (`:303-324`).
      That table holds `rm`, `mv`, `reset`, `dfu`, `upload`, `save`, `load` and `switch`
      (`SimpleShell.cpp:64-92`).
    - `config-set` itself is not in that table (`:274-281`), so `M1000 config-set` only prints
      "Command not found".
  - Twin:
    - The Smoothieware Console's own policy ("persistent Smoothie configuration … blocked").
    - The Marlin Console, which blocks the same M500/M502 words.
- **Scenario:** The operator types `M500` or `M1000 rm /sd/config` (or a macro holds it). Both
  are accepted as ordinary G-code with no confirmation. The first overwrites the override
  file. The second deletes the board's configuration file, which the next boot needs.
- **Evidence:** REPRO, same temporary test. Output:
  - `"config-set sd x 1" REFUSED`
  - `"M500" SENT`, `"M502" SENT`, `"M504 copy" SENT`
  - `"M1000 config-set sd …" SENT`, `"M1000 fire 50" SENT`
  - `smoothie isSetupOnlyPayload M500 false`
  - Correction from source: `M1000 fire 50` reaches SimpleShell, not the Laser module, so it
    prints "Command not found" and fires nothing. It is listed only to show the pass-through is
    open.
- **Refuter:** CONFIRMED.
  - Source: Smoothieware edge `GcodeDispatch.cpp` and `SimpleShell.cpp`, fetched again.
    - M1000 passes the rest of the line, lowercased, to `SimpleShell::parse_command`, then
      prints `ok`.
    - M500 truncates and rewrites `config-override`. M502 deletes it. M501/M504 load or save a
      named override.
    - The SimpleShell table holds `rm`, `mv`, `reset`, `dfu`, `upload`, `load` and `save`.
  - Repro:
    - `config-set sd x 1` is REFUSED.
    - `M500`, `M502`, `M504 copy`, `M1000 rm /sd/config` and `M1000 reset` are all SENT with
      confirm=false.
    - `isSetupOnlyPayload` is false for `M500` and for `M1000 rm /sd/config`.
- **Fix direction:** Block M500/M501/M502/M504 and refuse `M1000` (or apply the shell
  allow-list to its argument), in the Console and in `isSetupOnlyPayload`.

### P3-4 — Marlin silently keeps only the first 95 characters of a line and runs them; KerfDesk checks line length for GRBL, grblHAL and FluidNC but not Marlin

- **Where:**
  - `src/core/controllers/grbl/line-buffer-limit.ts:64` returns null for every controller but
    GRBL and grblHAL.
  - FluidNC has its own check (`fluidnc-line-limit.ts`, used by
    `laser-start-program-assertions.ts:85`).
  - External Marlin lines keep their spaces (`normalize-external-program.ts:133`).
- **Anchor:**
  - Ground truth, Marlin 2.1.2.8 `queue.cpp:383-388`: past `MAX_CMD_SIZE - 1`, "Skip the rest
    on overflow", with no error. The line runs truncated. `Configuration_adv.h:2404` sets
    `MAX_CMD_SIZE 96`.
  - Twin: the GRBL, grblHAL and FluidNC Start checks refuse a line their parser cannot hold.
- **Scenario:** An external Marlin program (ADR-630) with a line such as
  `G1 X123.4567 Y234.5678 … S…` padded past 95 characters. Marlin drops the trailing words, so
  a trailing `S` or `F` is lost and the move runs at the modal power or feed. There is no error
  and no `Unknown command`. KerfDesk's own Marlin lines are far shorter, so this is reachable
  only through external programs or the Console.
- **Evidence:** SOURCE (above) + READ.
- **Refuter:** CONFIRMED.
  - Source: Marlin 2.1.2.8, fetched again.
    - `queue.cpp:387-388`: `if (ind >= MAX_CMD_SIZE - 1) sis = PS_EOL; // Skip the rest on
      overflow`, with no error.
    - `Configuration_adv.h:2404`: `MAX_CMD_SIZE 96`.
  - KerfDesk:
    - `findLineBufferOverflow` returned `null` for a 112-character line on `'marlin'`.
    - Start's general size check (`findOversizedLine`) uses the profile's `rxBufferBytes`,
      which defaults to GRBL's 128. So a line of 96 to 127 characters reaches Marlin.
- **Fix direction:** Add Marlin's 95-character limit (spaces count, `;` comments do not) to the
  Start line check, as for FluidNC.

### P3-5 — Marlin's `FIRMWARE_NAME` reply is classified as a welcome banner; any M115 not typed exactly `M115` resets the session

- **Where:**
  - `src/core/controllers/marlin/response.ts:35`. `FIRMWARE_RE` gives `kind: 'welcome'`.
  - `src/ui/state/console-command-transport.ts:93-101`. The identity exchange is owned only
    when the line is exactly `M115`.
  - `laser-line-handler.ts:101-105` then runs `handleWelcomeLine`, which voids homing, origin,
    the Frame and every owed reply.
- **Anchor:**
  - Ground truth: Marlin prints `FIRMWARE_NAME:` only from `M115` (`gcode/host/M115.cpp:63`).
    Its boot lines are `start` and `Marlin <ver>` (`MarlinCore.cpp:1185,1285`). Only a
    user-configured `STARTUP_COMMANDS` could print it unprompted (`:1576-1578`).
  - Twin: Smoothieware's classifier files the same line as a message, never a reboot
    (`smoothieware/response.ts`, "it must not cross the controller-reset boundary").
- **Scenario:** The operator types `M115 ; id`, or a macro holds `M115 S0`. The reply crosses
  the reset boundary. Homing and origin become unknown and the completed Frame is dropped. The
  M115's own `ok` then arrives with nothing owed.
- **Evidence:** READ.
- **Refuter:** CONFIRMED, reproduced.
  - REPRO: temporary store test with the Marlin simulator.
    - Console `M115`: epoch stayed at 2, and homing stayed `confirmed`.
    - Console `M115 ;id`: epoch went from 2 to 3, and homing became `unknown`. The
      `FIRMWARE_NAME` reply crossed the reset boundary.
  - Source:
    - `M115.cpp:63` prints `FIRMWARE_NAME`.
    - At boot, `MarlinCore.cpp` prints `start` (L1185) and `Marlin <ver>` (L1285).
    - `FIRMWARE_NAME` appears at boot only through user `STARTUP_COMMANDS` (L1576-1578).
  - Comment drift: stock Marlin does not do what `console-command-transport.ts:89-91` says
    ("Marlin can also print FIRMWARE_NAME unprompted at boot").
  - Not observed: the "`ok` with nothing owed" part. `pendingUntrackedAcks` was 0 afterwards.
- **Fix direction:** Recognise M115 by its parsed command code. Or classify `FIRMWARE_NAME` as an
  identity message on Marlin, as on Smoothieware.

### P3-6 — Capability and driver comments describe values no driver uses

- **Where:**
  - `src/core/controllers/controller-capabilities.ts:25`: "Read-only settings dump (Marlin
    M503)". Marlin's driver sets `settings: 'none'` (`marlin/driver.ts:41`), and the only
    `readonly-dump` driver is FluidNC (`fluidnc/driver.ts`).
    `controller-readiness-messages.ts:20` maps `readonly-dump` to `fluidnc-yaml`.
  - `src/core/controllers/controller-driver.ts:58`: "Marlin: ['M5', 'M107']". The driver sends
    `['M5 I', 'M107']` (`marlin/commands.ts`). Plain `M5` would leave inline mode selected.
- **Anchor:** Twin, comment against code.
- **Scenario:** A maintainer adding a driver copies the documented Marlin values and gets the
  settings panel's read-only lane, or a plain `M5`.
- **Evidence:** READ.
- **Refuter:** CONFIRMED. Each comment was checked against the code it describes.
  - `readonly-dump` appears only in `fluidnc/driver.ts:96`, and `marlin/driver.ts:41` sets
    `settings: 'none'`.
  - `marlin/commands.ts:17` is `['M5 I', 'M107']`, not the commented `['M5', 'M107']`.
- **Fix direction:** Update both comments.

## KNOWN (re-observed, not re-raised)

- **CS-04 (2026-07-26).** Marlin `M114` is parsed as `state: 'Idle'`
  (`marlin/response.ts`, `parseMarlinPositionReport`). Unchanged.
- **CS-05 (2026-07-26).** Marlin `clearOrigin: 'G92.1'` (`marlin/driver.ts:81`). Re-checked:
  `G92.cpp` `default: return;` ignores G92.1 without `CNC_COORDINATE_SYSTEMS`. Reset origin uses
  the host-recorded computed G92 (`host-recorded-origin.ts`), so only the raw command field is
  stale.
- **D-3 (2026-10-20 design).** Marlin lines carry no `N`/checksum.
- **D-4 / P-4 (2026-10-20).** grblHAL is never sent `$I` (`grblhal/driver.ts:84`) or 0x87.
- **CS-02 (2026-07-26), extended.** Reset-based stops can run uninspected automation. On
  FluidNC this also covers the `after_reset` macro, which runs after a Ctrl-X in Idle
  (`Protocol.cpp:411-414`), and `after_unlock`, which runs on every `$X`
  (`ProcessSettings.cpp:283-284`).
- **ADR-373 residual risk.** A jog keeps the modal beam. On Marlin's fan dialect a jog `G0`
  does not blank an `M106` left lit (the jog sends no tool-off lines).
- **Rolling-v2 18-P3-1** (Smoothieware G0 seek rate) and **03-P2-8** (Smoothieware manifest).
  Not re-raised.
- **Rolling-v2 03-P2-2** (Marlin air changes). Fixed by #1342/#1353 and not re-examined.
- **C3-P2-1/P2-2, C4-P2-1** (grblHAL jog limits, setting writes). Not re-raised.
- **Rolling-v2 17-P3-2** (GRBL `/` prefix bypass). P3-2 is the Marlin twin, raised separately
  because it is a different parser and file.

## Refuted

The refuter (2026-10-22) refuted none of the eight findings; all are CONFIRMED.

Candidates this audit raised and dropped itself:

- **`M1000 fire 50` fires the Smoothieware laser untracked.** Dropped.
  `GcodeDispatch.cpp:303-324` hands M1000 to `SimpleShell::parse_command`, whose table has no
  `fire`. The Laser module's `fire` is handled only on `ON_CONSOLE_LINE_RECEIVED`. Kept only as
  evidence for P3-3.
- **Smoothieware multi-command lines get one `ok` per command, desynchronising acks.** Dropped.
  `ok_per_line` defaults to true (`Kernel.cpp:122`), so `G17G21G90G0` gets one `ok`
  (`GcodeDispatch.cpp:410-420`).
- **FluidNC inch reports are never read.** Dropped. FluidNC's `$$` prints `$13=<0|1>` first
  (`ProcessSettings.cpp:185-193`, `switchInchMM`). The GRBL settings path reads it as on GRBL.
  Only the bracket form escapes (P3-1).
- **Marlin `G21` in every jog and Frame is "Unknown command" on builds without
  `INCH_MODE_SUPPORT`.** Dropped. `gcode.cpp:388-393` maps G21 to `NOOP` there.
- **grblHAL or FluidNC ignore Pause's 0x84 without a door switch.** Dropped. grblHAL
  `protocol.c:889-894` raises EXEC_SAFETY_DOOR in every state but SafetyDoor, and FluidNC
  `Protocol.cpp:585-650` does the same.
- **FluidNC Fire (`G1 F M3 S`) does not light in laser mode.** Dropped. `GCode.cpp:1593-1640` is
  GRBL's laser-mode logic: a G1 modal with no axis words syncs the spindle at S.
- **The Marlin double boot banner (`start`, then `Marlin <ver>`) orphans a qualification
  reply.** Not raised: speculative timing, see Not verified.

## Verified clean

- **Realtime bytes.**
  - grblHAL and FluidNC share GRBL's `?`, `!`, `~`, Ctrl-X, 0x84, 0x85 and 0x90-0x9D
    (FluidNC `RealtimeCmd.h`). FluidNC's 0x87-0x8A are macros, and KerfDesk sends none.
  - Marlin's realtime table is all null.
  - Smoothieware claims only `?` and Ctrl-X. Its `!`/`~` need `enable_feed_hold`, which
    defaults to `grbl_mode` (`Kernel.cpp:119`; `USBSerial.cpp:220-230`).
- **Status parsing and inches.**
  - grblHAL and FluidNC use GRBL's grammar and read `$13` from `$$`. FluidNC scales MPos, WPos
    and FS by `_reportInches` (`Report.cpp:82-84,529`).
  - Marlin `M114` is always mm (`motion.cpp:192-212`, no unit conversion).
  - Smoothieware reports in parser units (`Kernel.cpp:214-238`). Frame selects G21 first
    (`frame-report-units.ts`), and the Smoothieware `M120`/`M121` jog wrapper restores the
    operator's units.
  - Smoothieware reports `Alarm` while halted (`Kernel.cpp:193`), so jog, Frame and Home, all
    gated on Idle, never send `fire off` to a halted board (which would ignore it and strand
    an ack).
- **Failure replies.**
  - Marlin: `echo:busy:` is a keepalive. `Error:` is followed by the line's `ok`. A kill
    answers nothing. `Unknown command` is a skipped line. An owned `M115` is consumed as
    identity.
  - Smoothieware: a G-code error prints `error:`/`Error:` and "Entering Alarm/Halt state"
    with no `ok`, and halts (`GcodeDispatch.cpp:385-403`). It is classified as terminal.
    `!!` and `error:Alarm lock` while halted are terminal. `M999` prints a WARNING then `ok`.
  - FluidNC: `error:N` and, with `verbose_errors`, a following `[MSG:ERR: …]` line
    (`Channel.cpp:266-280`). The error keeps its terminal meaning.
- **Capabilities.**
  - Probing and CNC are GRBL-family only. Marlin and Smoothieware have no unlock-free Home from
    Alarm (Smoothieware `homeFromAlarm: false`).
  - FluidNC sets `statusWhileHoming: true` and grblHAL sets `false` (C3 checked timing).
  - grblHAL `stickyLineError`, FluidNC `readonly-dump`, and Smoothieware
    `softResetReboots: false` each match source.
- **Home.** Marlin `G28 X Y` homes X and Y only (`G28.cpp`). Smoothieware `$H` homes in both
  dialects, then `G28.6` confirms. FluidNC `$H` runs in Alarm and Critical
  (`ProcessSettings.cpp:1044-1053`, `allowConfigStates`).
- **FluidNC `$X`** marks every axis homed (`ProcessSettings.cpp:278`). KerfDesk still keeps
  homing unknown after Unlock, which is the conservative reading.
- **Banner detection** for grblHAL, FluidNC, Marlin and Smoothieware, including FluidNC's
  configurable `Start/Message` default (`SettingsDefinitions.cpp:107-108`).

## Not verified

- **No hardware run.** In particular, the Smoothieware no-burn of P2-1 was not burned on a
  board. It rests on Laser.cpp and the repo's power oracle.
- **P2-2 through the store.** The Marlin simulator has no `NO_MOTION_BEFORE_HOMING` option, so
  the auditor only read the Frame-completion path. How common the option is in shipped laser
  builds was not surveyed.
  - Refuter: the store path has now been run, with an adapter that answers each move with
    Marlin's skip reply.
  - The shipped-build survey is still open. Three example configs were checked, and the option
    is off in all three.
- **Marlin double banner.** `start` (`MarlinCore.cpp:1185`) and `Marlin <ver>` (`:1285`) both
  reset the session. Whether a qualification `M114` written between them can leave an orphan
  `ok` depends on board setup time and was not measured.
- **Marlin host actions** (`//action:pause`/`cancel` with `HOST_ACTION_COMMANDS`, off by
  default) are classified unknown and ignored. Whether a laser host-streamed job ever shows
  Marlin's LCD pause/stop items was not checked.
- **grblHAL alarm and error tables, and Console classification beyond the four drivers'
  overrides,** belong to C5.
- **grblHAL/FluidNC Home timing** belongs to C3.

```json
[
  {"id":"C6-P2-1","severity":"P2","area":"ctl-other-drivers","file":"src/core/controllers/smoothieware/commands.ts","line":40,"anchor":"Ground truth: Smoothieware 38e2cc08 Laser.cpp:198-212,251-264 (M221 S sets global scale; burn = S x ratio x scale), Robot.cpp:331-352 (M120/M121 do not save it); smoothieware.org laser guide 'M221 Snnn globally scales the laser power provided by G1'; Contract: ADR-630 baseline resets modes kept between programs; Twin: smoothieware-strategy.ts:68 restores M221 S100, laser-render-state.ts:21 renders scale 1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Every Smoothieware Frame/jog/Home sends M221 S0 (power scale 0%); an external program (ADR-630) that sets power only by S, run after its mandatory Frame, burns nothing while the review shows burns"},
  {"id":"C6-P2-2","severity":"P2","area":"ctl-other-drivers","file":"src/core/controllers/marlin/response.ts","line":47,"anchor":"Ground truth: Marlin 2.1.2.8 motion.h:461-465, G0_G1.cpp:48, motion.cpp:1465-1496 (NO_MOTION_BEFORE_HOMING skips G0/G1 with 'echo:Home XYZ First' then ok; Z included), queue.cpp:523-535 (stopped); Twin: ADR-395/MA-12 Unknown-command skip handling; Contract: ADR-565 completed Frame","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Marlin moves skipped with 'echo:Home XYZ First' (or while stopped) are acked ok and counted done; a Frame that never moved is recorded complete (framed-run.ts:249 compares only the unchanged position), and KerfDesk's G28 X Y never satisfies a build with Z; a fan-wired job then lights M106 at the parked spot"},
  {"id":"C6-P3-1","severity":"P3","area":"ctl-other-drivers","file":"src/core/controllers/fluidnc/fluidnc-command-names.ts","line":106,"anchor":"Ground truth: FluidNC v4.0.3 ProcessSettings.cpp:1209-1253 ([key]value runs as $key=value); Twin: HF-6 $RST=/$NVX/long-name blocks and $13= refusal in the same driver","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"FluidNC bracket syntax bypasses the Console: [RST]#, [Settings/Restore]#, [NVX] erase offsets/settings unblocked; [13]1 switches to inch reports without the report-units re-read"},
  {"id":"C6-P3-2","severity":"P3","area":"ctl-other-drivers","file":"src/core/controllers/marlin/console-command.ts","line":46,"anchor":"Ground truth: Marlin 2.1.2.8 queue.cpp:369-371 (; comments dropped), parser.cpp:180-209 (spaces after letter, leading zeros); Contract: module header blocks M500/M502 like GRBL $RST","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Marlin Console blocks only exact 'M500'/'M502'; 'M500 ;save', 'M 500', 'M0502' are sent, and isSetupOnlyPayload misses M0500 / M 500"},
  {"id":"C6-P3-3","severity":"P3","area":"ctl-other-drivers","file":"src/core/controllers/smoothieware/console-command.ts","line":65,"anchor":"Ground truth: Smoothieware GcodeDispatch.cpp:303-363 (M500 writes /sd/config-override, M502 deletes it, M504, M1000 shell pass-through to rm/mv/reset/upload), SimpleShell.cpp:64-92; Twin: Smoothieware config-set/config-load block and Marlin M500/M502 block","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Smoothieware Console blocks config-set/config-load but sends M500, M502, M504 and M1000 <shell> (e.g. M1000 rm /sd/config) unconfirmed; isSetupOnlyPayload misses them too"},
  {"id":"C6-P3-4","severity":"P3","area":"ctl-other-drivers","file":"src/core/controllers/grbl/line-buffer-limit.ts","line":64,"anchor":"Ground truth: Marlin 2.1.2.8 queue.cpp:383-388 (overflow: skip the rest, no error), Configuration_adv.h:2404 MAX_CMD_SIZE 96; Twin: GRBL/grblHAL/FluidNC Start line checks","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Marlin silently truncates a line past 95 characters and runs the rest (trailing S/F lost); KerfDesk has no Marlin line-length check, and external Marlin lines keep their spaces"},
  {"id":"C6-P3-5","severity":"P3","area":"ctl-other-drivers","file":"src/core/controllers/marlin/response.ts","line":35,"anchor":"Ground truth: Marlin 2.1.2.8 M115.cpp:63 (FIRMWARE_NAME only from M115), MarlinCore.cpp:1185,1285 (boot lines); Twin: smoothieware/response.ts files FIRMWARE_NAME as a message","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Marlin FIRMWARE_NAME is a welcome banner; an M115 not typed exactly 'M115' (comment, argument) crosses the controller-reset boundary and voids homing, origin and Frame"},
  {"id":"C6-P3-6","severity":"P3","area":"ctl-other-drivers","file":"src/core/controllers/controller-capabilities.ts","line":25,"anchor":"Twin: marlin/driver.ts:41 settings 'none' (readonly-dump is FluidNC only); controller-driver.ts:58 vs marlin/commands.ts ['M5 I','M107']","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Capability/driver comments say Marlin uses readonly-dump (M503) and stop lines ['M5','M107']; Marlin uses 'none' and ['M5 I','M107']"}
]
```
