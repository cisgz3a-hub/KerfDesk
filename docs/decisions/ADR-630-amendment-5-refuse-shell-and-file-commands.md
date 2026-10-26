## ADR-630 Amendment 5 - An external run refuses shell, file and stored-program commands (2026-10-23)

**Status:** Accepted. Amends ADR-630 "Refusals". Keeps PROJECT.md non-negotiable 21 and ADR-565:
the completed Frame stays the only ordinary Start gate. Fixes controller audit v4 finding E4-P2-4.
| **Date:** 2026-10-23

### Context

ADR-630 Amendment 1 refuses a `$` line in an opened program, because the controller runs it as a
controller command and the Frame cannot trace what it does. Some firmware also gives ordinary-looking
lines to its shell, its file system or a program stored on the board:

- **Smoothieware.** `GcodeDispatch` ignores a line that starts with a lowercase letter, and
  `SimpleShell` runs it as a shell command, as it runs `$` lines. The Smoothieware Console already
  refuses such lines (`console-command.ts`). `M1000` passes the rest of its line to the same shell.
  Other M-codes act on files on the SD card: `M28` stores the following lines in a file until `M29`
  instead of running them, `M30` with a name deletes a file (when `grbl_mode` is off), `M24` and `M32`
  play a stored file, `M374` saves or deletes the levelling grid, `M500` and `M504` write a
  config-override file, `M501` runs one and `M502` deletes it. `GcodeDispatch` splits a line at each
  `G` and `M`, so these run wherever they stand on the line.
- **Marlin.** `M28` and `M928` store later lines in an SD-card file, `M30` with a name deletes one,
  `M24` and `M32` start an SD print, `M1000` resumes one after a power loss, `M500` saves the settings
  to EEPROM and `M997` starts a firmware update. Marlin reads only a line's first command.
- **grblHAL.** `G65`, `G66` and `M98` run a macro file from the controller's storage, and a named
  `O<name> call` loads `<name>.macro`.

None of these was refused. On Smoothieware the Run review's only sign was "Unreadable lines …
skipped", and lowercase G-code was framed as motion that the shell would refuse. So an opened file
could run commands, or change files on the board, that the review never showed.

grblHAL's and FluidNC's own file commands are `$` or `[ESP…]` lines, which Amendment 1 already
refuses. Stock GRBL keeps no files.

Sources:
- Smoothieware edge `91fe4286e`: `src/modules/communication/GcodeDispatch.cpp`,
  `src/modules/utils/simpleshell/SimpleShell.cpp`, `src/modules/utils/player/Player.cpp`,
  `src/modules/tools/zprobe/CartGridStrategy.cpp`.
- Marlin 2.1.2.8: `Marlin/src/gcode/gcode.cpp`, `Marlin/src/gcode/parser.cpp`, `sd/M30.cpp`,
  `control/M997.cpp`.
- grblHAL core `4ec1ae44b`: `gcode.c`, `ngc_flowctrl.c`; Plugin_SD_card `macros.c`.

### Decision

1. **A second policy refusal.** Using the connected controller's kind, an external run refuses a
   line the controller would hand to its shell, its files or a stored program. It is policy, like the
   `$` refusal: the Frame cannot trace what such a line runs, and a job is not where files on the
   board are changed. `storage-command-check.ts` holds the lists:
   - Smoothieware: a line that starts with a lowercase letter (the Console's rule,
     `isSmoothieLowercaseShellLine`), and `M24`, `M28`, `M29`, `M32`, `M374`, `M500`, `M501`, `M502`,
     `M504`, `M1000` or `M30` with a name, anywhere on the line. Like `Gcode::get_int`, the check
     reads a sign and leading zeros as part of the number.
   - Marlin: a first command of `M24`, `M28`, `M29`, `M32`, `M500`, `M928`, `M997`, `M1000` or `M30`
     with a name. A lowercase command letter counts, as on a `GCODE_CASE_INSENSITIVE` build.
   - grblHAL: `G65`, `G66` or `M98`, however spelt, and a named `O<…> call`.
2. **Bare `M30` still ends a program** on every controller. Only `M30` followed by a name is
   refused.
3. **The review names each line.** The refusal says which line it is, shows it as sent, and says in
   plain words what the controller would do with it ("is M28, which writes the lines after it into a
   file on the SD card instead of running them"). The dialog offers only **Close**, as for every
   refusal.
4. **Callers that pass only a baseline** get the Smoothieware checks when their baseline is
   Smoothieware's, as they already got Marlin's reader from Marlin's baseline.

### Not in this decision

- Marlin `M502` (factory settings, in memory until `M500`) and other settings commands stay review
  warnings, as unsupported commands. The Marlin Console still blocks `M500`/`M502`.
- grblHAL's `M6` can run a stored `tc.macro`. A tool change is ordinary CNC work, so it stays a
  review warning.
- Numbered `O… call` and other flow control on grblHAL and FluidNC are outside this amendment.

### Consequences

- An opened program with a Smoothieware shell line or SD-card command, or a Marlin or grblHAL
  command from the lists, cannot be framed or started. The operator removes the line, or uses the
  controller's own tools for files.
- Lowercase G-code on Smoothieware is refused instead of framed. On GRBL, grblHAL and FluidNC it
  still runs, because those controllers read it as capitals.

### Verification

- `storage-command-check.test.ts` covers each refused form per controller: Smoothieware lowercase
  shell words and G-code, every listed M-code, commands later on the line, signed and zero-padded
  numbers, and `M30` with and without a name. It also covers Marlin's first-command rule and
  lowercase letter, grblHAL `G65`/`G66`/`M98` and named `O<…> call`, and the dialects that get no
  such check.
- `normalize-external-program.test.ts` checks the refusal wording and line numbers per controller,
  that an ordinary Smoothieware laser program still sends byte for byte, that lowercase G-code still
  sends on GRBL, and that a baseline-only caller gets the Smoothieware checks.
- `RunGcodeFileDialog.test.tsx` shows the refused Smoothieware lines in the rendered Run review,
  with only **Close**.
- No hardware was run.
