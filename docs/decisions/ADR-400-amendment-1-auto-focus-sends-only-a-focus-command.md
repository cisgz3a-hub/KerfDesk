## ADR-400 Amendment 1 - Auto-focus sends only a focus command, and a project file cannot choose it (2026-10-21)

**Status:** Accepted. | **Date:** 2026-10-21

### Context

ADR-400 decision 1 put Auto-focus through the driver's Console policy, which refuses lines that
never answer `ok` and lines holding a realtime character. It did not limit what the line does.
Rolling audit v2, report 13, finding P1-1 (`docs/audits/2026-10-21-rolling-v2/13-project-io.md`)
showed what that left open:

- A `.lf2` carries `device.autofocusCommand`, and the loader checked only that it is a string.
  Open installs the document's machine (ADR-500 Amendment 1 decision 2), so the file's line became
  what the next Auto-focus press sends.
- One press of a crafted file's Auto-focus wrote `G1 X300 Y10 F100 S1000 M3` to the GRBL simulator
  and burned a full-power line to X300, with no Frame and no Start review (PROJECT.md
  non-negotiable 21, ADR-565). `G0 X400 Y400` moved the head; `$32=0` turned laser mode off with
  no confirmation, because Auto-focus ignored the Console's `requiresConfirmation`.
- A file that copies the operator's profile id, name and bed size shows no machine notice, so the
  operator had no sign that anything had changed.
- The same file's positioning-light commands were already vetted on load and refused when they
  could fire the laser or change machine state (`core/devices/positioning-light.ts`).

### Decision

1. **One rule for what Auto-focus may send** (`core/devices/autofocus-command.ts`). Empty still
   disables the button. Otherwise the line must be one of the forms machines document for
   focusing:
   - `$HZ1`, or another numbered `$HZ`, under the Creality Falcon A1 Pro command contract, whose
     documented autofocus it is; and a bare `$HZ` on grblHAL and FluidNC, which home Z alone with
     it. Stock GRBL enters its homing state on `$H` and, built without single-axis homing (the
     default), answers the suffix with error:3 and stays stuck until a reset, so no `$H…` goes to
     it. Smoothieware runs any `$H…` as a full homing cycle (controller audit 2026-09-25 CG-9), and
     Marlin has no `$` commands. A profile with no controller kind is checked as the stock GRBL
     driver it connects with;
   - a Z-only probe: `G38.2`–`G38.5` with a Z target and an optional feed;
   - `G30` on Marlin and Smoothieware, their single Z probe at the current XY. On GRBL-family
     controllers `G30` moves to a stored position, so it is refused there.

   Every M-code is refused. Firmware M-codes switch the beam, air, fans and motors (Marlin's `M17`
   enables the steppers) or change machine settings. No machine in the catalogue or its sources
   documents an M-code for focusing, so a list of "safe" codes could not be trusted. A documented
   vendor focus form is added to the rule with its source. G0–G3 moves, X, Y or rotary axis words,
   `S` above 0, `$n=` and other `$…=` writes, `$J=` jogs, comments and several commands on one line
   are refused too, each with a reason that names the problem. A probe sequence or an M-code still
   goes through the Console, as ADR-092's 2026-08-02 amendment says.
2. **Load clears a refused command.** The project loader clears a file's refused Auto-focus command,
   as it drops a refused positioning light. The load check uses only the rules that do not depend
   on the controller. A later controller change therefore cannot make Save rewrite the value and
   refuse the project (ADR-204). A machine profile file or a restored last machine clears it with a
   review note. Machine Setup shows the reason beside the editor and does not save the profile
   until it is fixed.
3. **A project does not choose the Auto-focus command for the machine already in use.** When the
   opened file's machine has the same identity as the current one (profile id, name and bed, the
   identity the machine notice uses), Auto-focus keeps the current machine's own command from
   Machine Setup. An info toast says so when the file's command differed. A file for another
   machine brings its vetted command with the rest of that machine, behind the machine notice, and
   **Keep current machine** restores the current command too. The press is what makes the command
   matter, and a file can copy the identity that hides the notice. So the operator's own setting
   decides for their own machine.
4. **The button checks again before sending.** Whatever the command's source, Auto-focus applies
   rule 1 with the connected controller's kind. It also refuses anything the driver's Console
   policy classifies as other than plain G-code, or would ask to confirm. Nothing is written when
   it refuses.

### Consequences

- A shared project can no longer make Auto-focus burn, move the head in X or Y, or write controller
  settings. The Falcon `$HZ1` preset and documented single-line focus commands keep working.
- An operator who had typed a G0/G1 Z move or a setting write as their "auto-focus" sees why it is
  refused, and moves that line to the Console or a jog.
- No G-code emitter, Frame, Start or job behaviour changes. The Console is unchanged.

### Verification

- `core/devices/autofocus-command.test.ts`: accepted and refused forms, controller-specific rules,
  Machine Setup validation.
- `io/project/project-autofocus-command.test.ts`: load clears the audit payloads and keeps a focus
  command byte for byte; a machine profile clears it with a review note.
- `ui/laser/autofocus-crafted-project.simulator.test.tsx`: end to end through File > Open, the
  Auto-focus button and the GRBL simulator. A crafted file for the operator's Falcon keeps the
  operator's `$HZ1`; one for another machine loses the command on load; a direct press with each
  payload is refused. None of the payloads reaches the controller, and `$HZ1` never reaches stock
  GRBL.
- Not verified on hardware.
