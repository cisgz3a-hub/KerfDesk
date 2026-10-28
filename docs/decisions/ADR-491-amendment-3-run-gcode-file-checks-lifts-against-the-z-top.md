## ADR-491 Amendment 3 - Run G-code file checks the program's lifts against the live Z top (2026-10-28)

**Status:** Accepted; software-verified through unit tests, hardware qualification pending. |
**Date:** 2026-10-28

Extends [Amendment 2](ADR-491-amendment-2-park-lift-checked-against-the-live-z-top-and-drawn.md)
Decisions 1 and 2 to the Run G-code file review (ADR-630). Follows rolling audit v5 finding J7-P2-2
(P2), which an independent refuter confirmed and the coordinator re-verified in main's code. The
Frame-first Start contract (ADR-228) is unchanged: the addition is information, never a Start
block. No emitted program changes.

### Context

Amendment 2 checks a CNC job's park lift against the machine's Z top whenever the inputs are
known. `checkCncLiftAgainstZTop` and `detectCncParkZTopWarnings` were called only from Start's
readiness policy and Job Review's machine section. The Run G-code file review reads only the XY
envelope, the units and the program's commands. Neither `src/ui/gcode-inspector` nor
`src/core/external-program` read `zTravelMm` or the firmware Z limits.

Since ADR-392 Amendment 3 a setup package holds one file per bit, and that is the default. Every
per-bit file ends with the same `G0 Z<park>` as the combined program, and #1472 made Run G-code
file treat the gap between two files like an in-app bit change. Take a homed router with 75 mm of
Z travel, limits off, the stock top zeroed 40 mm below the homed top, and a 50 mm park. In-app
Start warns that the lift goes 10 mm past the top. Run G-code file runs each per-bit file, sends
`G0 Z50.000` to machine Z +10, and says nothing. Z stalls on its stop. The next file's Zero Z heals
a stall at a bit change. A stall at the job end carries into the next job on that zero, which then
cuts deeper (meta audit v1 M7-P1-2). The live inputs are the same session's `$$`, Home and work
offset that Start uses.

### Decision

1. **The Run review reads how high the program lifts Z** (`externalProgramZLifts`, a new
   `zLifts` field of the review).
   - In work coordinates it takes the highest Z of the motion the Frame outline places. That outline
     is read with `boundsFromStart` from where the head stands, so it counts the starting Z. It
     leaves out G53 and probe moves, and moves on an axis whose origin G10 or G92 moved.
   - In machine coordinates it takes the highest Z any G53 move names. G53 applies to its own block
     only and is never relative. The value is read in the units then in effect.
2. **A CNC project runs the same check as Start, with the same evidence.**
   - The highest work Z goes through `checkCncLiftAgainstZTop`. It needs this session's `$$`, and
     either Home or soft limits on. The profile's Z travel stands in for an unread `$132`. It also
     needs the controller's reported work offset, in millimetres when `$13=1`, and G54 active.
   - A G53 Z is already a machine position. It is compared with the machine Z top directly
     (`checkMachineZAgainstZTop`), so no work offset is needed.
3. **A lift past the top is a Run review warning.** It is listed beside the outline's bed warnings.
   - It gives the lift, how far past the top it goes, and the same consequence as Start: an alarm
     with limits on, a stall and lost steps with them off, and a deeper cut on the next job on this
     zero.
   - For a work Z it gives the highest Z that fits. For a KerfDesk file that means setting Park
     height that low and saving the file again; otherwise zero Z higher. When even the work zero is
     above the top, it says to zero Z again on the stock top.
   - For a G53 lift it gives the highest machine Z that fits.
   - Frame stays the only gate, and nothing is refused (PROJECT.md rule 21, ADR-228).
4. **When the check cannot run, the Run review says nothing**, as Start does. Job Review's "Z top
   not checked" row has no Run review counterpart.
5. Not changed: a Laser project's Run review, the XY envelope, Frame, and Start.

### Verification

- `src/ui/gcode-inspector/external-run-z-top.test.ts`:
  - A real per-bit file from the setup package builder ends with `G0 Z8.000`. It is normalized and
    parsed as the Run dialog does, and its review reads a lift of 8.
  - With the stock top zeroed 5 mm under the homed top, the review warns that the lift goes 3 mm
    past the top, and advises Z5 or a 5 mm Park height. Zeroed 40 mm under the top, it fits.
  - A work zero above the top advises zeroing again.
  - A G53 lift to machine Z 3 is 3 mm past a top at 0, with no work offset reported. Machine Z -1
    fits.
  - Without a Home this session and with soft limits off, and on a Laser project, there is no
    warning.
- `src/core/external-program/program-z-lifts.test.ts`: the highest work Z of a park lift; the
  starting Z of a program that only cuts; G53 Z read as a machine Z and kept out of the work
  outline; G53 Z in inches under G20 and G91, and back in millimetres after G21.
- `src/ui/laser/cnc-park-z-top.test.ts` and `src/core/external-program/external-program-review.test.ts`
  still pass with the shared top comparison.
- Code and test evidence only. No machine was moved.
