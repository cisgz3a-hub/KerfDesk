## ADR-491 Amendment 2 - The park lift is checked against the live Z top, and Preview draws it (2026-10-26)

**Status:** Accepted; software-verified through unit tests, hardware qualification pending. |
**Date:** 2026-10-26

Amends ADR-491 item 3 and Amendment 1 item 3, and closes the follow-up recorded there. The
Frame-first Start contract (ADR-228) is unchanged: both additions are information, never a Start
block. The emitted program does not change.

### Context

The park height is a work Z above the stock top, so where the lift lands in the machine depends on
where Z was zeroed. Amendment 1 compared the park height with the Z travel, and the job's whole Z
range with it, but left the live check as a follow-up (second CNC audit P2-control-1). No one took
it. Meta audit v1 M7-P1-2 reproduced it on main (`adf300522`): on a homed router with 75 mm of Z
travel and the stock top zeroed 40 mm below the homed top (WCO Z -40), a 50 mm park sends
`G0 Z50.000` to machine Z +10 at every bit change and at the job end. `detectCncZTravelWarnings`
returned nothing, and Job Review's park row stayed in default tone. GRBL with `$23=0` homes Z to
the top, where machine Z is 0. With soft limits on it refuses the move with an alarm, and with hard
limits on the switch trips ALARM:1. With both off, the default, Z stalls on its stop and loses steps.
A bit-change stall is healed by the mandatory Zero Z; a job-end stall carries into the next job on
the same zero, which cuts deeper.

The same audit (M7-P2-5) found the CNC preview drew the job end as a rapid at the stock top to
program 0,0. It ignored the park height, a configured park, the bit-change parks and the per-pass
retracts (ADR-253) that the emitter writes.

### Decision

1. **The lift is checked against the machine's Z top when the inputs are known.** The highest lift
   is `max(safe Z, park height)`, the height the emitter lifts to. The Z top comes from the same
   firmware envelope the manual-motion limits use (ADR-375): this session's `$$` (`$132`, `$23`,
   `$27`, `$21`, `$20`), with the profile's recorded Z travel standing in for an unread `$132`. It
   applies when the controller enforces soft limits or this session's Home tied machine position to
   the switch. A hard-limits switch keeps its pull-off clear. The lift lands at machine Z = lift +
   WCO Z, using the controller's reported work offset (in millimetres when `$13=1`).
2. **A lift past the top is a Start warning.** It gives the lift, how far past the top it goes,
   what follows (alarm with limits on, a stall and lost steps with them off), and the highest Park
   height that fits, or says to zero Z again when even the zero is above the top.
3. **Job Review's Park height row says the result.** It adds "N mm under the Z top", or "N mm past
   the Z top with the work zero set now" with the advice in warning tone. When the check cannot run
   it says "Z top not checked:" and why: no `$$` and Home (or soft limits), no work offset reported
   yet, or a G55 to G59 offset active while the program runs in G54.
4. **The check uses the work zero set now.** A multi-bit job re-zeroes Z at each bit change, so
   later parks land where each new zero puts them.
5. **Preview draws the program's parks and retracts.** With a park requested, the CNC preview lifts
   to the park height and moves to `parkTarget` at every bit change and at the job end, with a
   configured park winning as in the program. After a bit-change park the head's Z is unknown until
   the next lift, as it is after the touch-off. A group that retracts between passes (ADR-253) lifts
   to safe Z before each contour or path3d pass replunges, as the emitter does. `parkTarget` and
   `parkHeightMm` moved to `src/core/cnc/cnc-park.ts` so the emitter and the preview read one rule.
6. Not changed: a Machine Setup limit on the park height field remains a recorded follow-up. The
   live check covers the case the static travel check cannot.

### Verification

- `src/ui/laser/cnc-park-z-top.test.ts`: the audit's router (75 mm, WCO Z -40, `$20=0`, `$21=0`)
  finds a 50 mm park 10 mm past the top and advises 40 mm; a 30 mm park fits with 10 mm to spare;
  an inch offset is converted; a 2 mm pull-off with hard limits lowers the top; no Home with soft
  limits off, no offset, unconfirmed units and an active G55 each report the check as not run; an
  unhomed GRBL with soft limits on is checked against its own envelope; the profile's travel stands
  in for an unread `$132`.
- `src/ui/laser/job-review/job-review-live-rows.test.ts`: the Park height row in each of the three
  results.
- `src/core/job/toolpath-cnc.test.ts`: the simulator-equals-emitter property now draws random
  retract-between-passes groups; a two-bit job with a configured park draws two lifts to Z40 and two
  moves to the bed park, matching the emitted `G0 Z40.000` and `G0 X5.000 Y250.000`; a job without
  a park lifts to safe Z and returns to the finish fallback; no park is drawn when none is asked for.
- Code and test evidence only. No machine was moved.
