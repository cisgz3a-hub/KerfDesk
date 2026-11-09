## ADR-693 - A rotary turns on Y, A or Z

**Status:** Accepted. Builds the missing feature rolling audit v12 X8-P2-1 raised (re-rated P1 by its refuter: no
A or Z rotary axis; `docs/audits/2026-11-09-rolling-v12/X8-rotary-complete.md`) and X8-P3-3 (one
rotary preset). Extends ADR-127 (one machine-space rotary job), ADR-373 (roller diameter, Test
rotation) and ADR-503 item 4 (published presets only). Replaces ADR-315 Decision 3's "no A-axis
output contract" for lasers. Taper (ADR-694) and surface feed (ADR-127 Amendment 2) are separate.
**Date:** 2026-11-10

### Context

KerfDesk drove a rotary only through the Y motor port: every emitter wrote the turn as `Y`. The
maintainer's Creality Falcon A1 Pro plugs its rotary into its own connector:

- Creality's Falcon A1/A1 Pro rotating kit guide says to connect the rotary to the A axis
  (https://wiki.creality.com/en/laser-engraver/falcon-a1/random-data/guide-A, step 3).
- Two published A1 Pro `$I` reads list the axes `[AXS:4:XYZA]` with `$103=8.900` steps per degree,
  3200 steps per 360° (https://github.com/barebaric/rayforge/pull/461; `falcon-a1-pro-dump.ts`).
- LightBurn users report that with Y the gantry moves and the rotary does not; one reports one turn
  at 360 with Z on an A1 (https://forum.lightburnsoftware.com/t/rotary-setup-falcon-a1-pro/189774).

Yet KerfDesk offered the A1 Pro the Creality "Y port" preset, so a rotary job would run the gantry
with the beam on instead of turning the glass.

LightBurn's Rotary Setup has a Rotary Axis choice: "Select Y Axis if you are unplugging your Y Axis
stepper motor wire and plugging it into the rotary instead", and "Select Z Axis or A Axis if you are
plugging your rotary into a dedicated rotary axis". Its "MM Per Rotation" is "the distance of
commanded movement" per turn
(https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/), and its Move window
jogs an A rotary in degrees (https://docs.lightburnsoftware.com/2.1/Reference/MoveWindow/).

### Decision

1. **The rotary has an axis: Y, A or Z** (`RotarySetup.axis`, `src/core/devices/rotary-axis.ts`).
   Absent is Y, so every project and machine profile saved before this decision opens and burns as
   it did. A setup put back on Y saves with no field.
2. **Motion per turn is in the axis's own commanded units**, as LightBurn's MM Per Rotation is:
   millimetres on Y and Z, degrees on A, which grblHAL and FluidNC count for a rotary axis. The
   scale law of ADR-127 and ADR-373 is unchanged. Switching between millimetres and degrees parks
   the other value; a first switch to A starts at 360°.
3. **Where each axis is offered.** Y on every controller. Z on GRBL, grblHAL and FluidNC. A on grblHAL
   and FluidNC only, which can have a fourth axis; stock GRBL 1.1 has none. Marlin, Smoothieware and
   Ruida stay on Y. A controller that cannot take the setup's axis gets no program
   (`rotary-axis-unexecutable`, a compile-integrity code): writing the turn as Y would move the
   gantry with the laser on. The Ruida `.rd` export refuses the same way.
4. **Output on A or Z.** The machine-space job keeps the turn in its Y slot. After the emitters and
   preflight have run on it, the turn is written under the axis letter, in code only, never in a
   comment. A line that already uses that letter refuses the program. The head's Y is never
   commanded: it stays over the part where the operator put it.
5. **Zero at the current turn.** Nothing reports where a dedicated rotary stands, so every job and
   every Frame on A or Z starts with `G92 A0` (or `G92 Z0`). G92 sets only the axis it names. A placed
   job's anchor maps to turn 0, not to the head's work Y (`zeroAtAnchor` in `rotary-transform.ts`).
   An Absolute job's lowest edge maps to 0, as on Y. A Current Position job's park turns the part back
   to 0.
6. **Frame follows the axis.** It zeroes the turn, traces the perimeter with the turn under the axis
   letter, and always ends back at turn 0, so the job's own `G92 A0` zeroes the turn that was framed.
   Its bed and no-go checks look at the head's own Y.
7. **Jog and Test rotation follow the axis.** `JogParams.da` turns A on the GRBL-family and Falcon
   builders; Marlin and Smoothieware refuse it. Test rotation turns the rotary on its axis. With a
   dedicated axis, the Y arrows move the head, and the jog pad gets rotary turn buttons in degrees
   (A) or millimetres (Z). Jog bounds keep the bed's Y range then.
8. **What the controller reports.** The status report's MPos/WPos value count (one per axis on
   grblHAL and FluidNC) and grblHAL's `$I` `AXS` letters (the connect read, or a Super Console
   report) are checked against the chosen axis. A controller whose own report has no such axis
   cannot take the program, so Start and Frame refuse it: a factual failure, not a policy judgment.
   Three status values have no A; `AXS` letters settle it outright. A fourth status value is only
   taken as A, never proven, so it never refuses.
9. **One confirmed Test rotation per dedicated axis.** KerfDesk cannot see which connector the
   rotary is in or where the firmware sends an axis. After a Test rotation finishes on A or Z, the
   operator confirms the rotary turned (`RotarySetup.axisConfirmed`). Until then Job Review warns
   before every burn on that axis. A Y rotary needs no confirmation, as before.
10. **A machine whose rotary connector is a dedicated axis.** When every preset its maker publishes
    for a machine names the same dedicated axis (the Falcon A1 Pro: A), a new rotary there starts on
    that axis, and a rotary left on Y gets a Job Review warning that the head would move across the
    part with the laser on. Y stays selectable for a rotary plugged in where the Y motor was.
11. **Older readers refuse what they would misread.** A reader that drops `axis` would drive an A
    rotary as Y. A machine profile file (`.lfmachine`) with a dedicated axis is written as schema 2,
    which 1.0.30 refuses; every other profile stays schema 1. Projects take the next project schema
    version this release (v22, shared with ADR-694's taper; whichever change merges second names its
    field in the same bump, and a release must not ship this decision without it).
12. **Feed on A.** grblHAL and FluidNC plan F over the length of the whole XYZA move with degrees
    counted as millimetres, so ADR-127 Amendment 2's per-move feed, computed in machine units, holds
    on A unchanged.
13. **Presets name their port** (amends ADR-503 item 4). Each preset carries the axis its maker's
    port is, and a machine on a vendor command set is offered only the presets for it:
    - Creality Rotary Kit Pro chuck, 40 mm per turn on the Y port, for Falcons on no vendor command
      set (Creality's manual, as before).
    - Creality Rotary Kit Pro chuck on the A1 Pro's rotary connector, A axis, 360° per turn, for the
      A1 Pro command set. Sources above; marked not checked on a machine, with Z named as the
      fallback, and the confirmation of item 9 is required.
    - xTool RA2 Pro chuck, 128 mm per turn, and roller, 32 mm per turn with a 17 mm roller, both on Y
      for the D1 Pro (Z on a D1), from xTool's own LightBurn guide (https://support.xtool.com/article/588).
    - Left out for want of a readable maker figure (2026-11-10): Ortur YRR / YRC (the Aufero YRR 2.0
      manual mirror is behind a bot check), Sculpfun's roller, Atomstack R3 / R3 Pro, and
      LaserPecker's rotary extension, which switches rotary mode in firmware (`M3032`) and publishes
      no per-turn figure.

### Consequences

- A project or machine profile from before this decision is byte-identical: a returning-user test
  opens a rotary project saved by 1.0.29 (`src/__fixtures__/returning-user/1.0.29-rotary.lf2.gz`)
  and burns what 1.0.29 burned from Absolute, Current Position and User Origin.
- The G-code inspector, the time estimate and Job Review's park disclosure still read the turn as
  Y. The estimate times an A turn with Y's limits; the inspector shows an A program flat, without
  its turn. Follow-up work, not a burn change.
- The maintainer's own A1 Pro has not been read. When its `$$` and `$I` with the rotary fitted are
  known, the A1 Pro preset's axis and per-turn value are data in `rotary-presets.ts`; nothing else
  changes.

### Evidence

- Simulated four-axis grblHAL (the GRBL simulator's `fourthAxisA`): Frame and Start of a rotary-A job
  turn A from `G92 A0` with no Y word and the head's Y unchanged; Test rotation sends
  `$J=G91 G21 A360.000` and back. A three-axis GRBL answers an A word with `error:20`.
- Simulated stock GRBL with a Y-port rotary: the same job frames and burns on Y with no A word and
  no `G92` (`rotary-axis.simulator.test.tsx`).
- Not verified: any physical rotary, the A1 Pro's real connector routing, and FluidNC's A units on a
  given configuration. No hardware was operated.
