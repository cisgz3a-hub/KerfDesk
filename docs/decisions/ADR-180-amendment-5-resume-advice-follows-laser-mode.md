## ADR-180 Amendment 5 - The CNC Resume advice follows the controller's laser mode (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

### Context

Amendment 2 made CNC Pause send GRBL's safety-door byte. Resume then restores the spindle and holds
motion for `SAFETY_DOOR_SPINDLE_DELAY` (4.0 s in stock `config.h`). The Resume advisory has said so
ever since: "Resume restarts the spindle, waits for it to reach speed, then continues the same
line".

That is true only at `$32=0`. In laser mode GRBL skips the delay ("When in laser mode, ignore
spindle spin-up delay", `protocol.c`), and grblHAL does the same. So spindle power returns in the
same instant motion restarts, and the stopped bit is pushed through the material at cutting feed.
Laser mode also runs the spin-up dwell after `M3` with the spindle off, because it passes zero
spindle speed on every non-cutting motion (`gcode.c`).

Job Review already reported `$32=1` on a router job. But the warning sat inside the folded Warnings
list, and routers often keep `$32=1` after a laser session. The 2026-09-24 CNC audit found both
(MC-1, critical; JR-1, high).

### Decision

1. The CNC Resume advisory keeps its spin-up wording only when the controller has reported `$32=0`.
   With `$32=1`, it says Resume restarts motion at once with no spindle spin-up, and recommends
   **ABORT JOB** and recovery from the interrupted-job card. With `$32` unreported, it says the
   mode is unconfirmed and Resume may restart motion without spindle spin-up. It recommends
   verifying `$32=0` before resuming, or aborting and recovering; missing evidence does not prove
   that the controller is in laser mode.
2. The `$32=0` wording names GRBL's fixed delay (4 s in stock GRBL) rather than "waits for it to
   reach speed".
3. The `$32=1` Job Review warning names all three effects: the dwell after `M3` runs with the
   spindle off, plunges start with the bit not at speed, and Resume has no spin-up. Job Review
   opens its Warnings list whenever a router job's `$32` warning (on, or unreported) is present.
4. Everything stays advisory. Resume, Frame and Start are never refused for `$32` (PROJECT.md
   non-negotiable 21).

### Consequences

- An operator on a router left in laser mode is told plainly, at Resume and in Job Review, that
  the spindle will not spin up first.
- JR-1's guarded one-click "Send `$32=0`", and a warning when a router project writes `$32=1` from
  the Console or Machine Settings, remain follow-ups.
- Based on GRBL and grblHAL source and the audit's grbl-sim runs, not on hardware.
