## ADR-491 Amendment 1 - Job Review shows the park height and checks the job's Z range against the Z travel (2026-09-29)

**Status:** Accepted; software-verified through unit tests, hardware qualification pending. |
**Date:** 2026-09-29

Amends ADR-491 item 3. The Frame-first Start contract (ADR-228) is unchanged: both additions are
Job Review information, never a Start block.

### Context

ADR-491 item 3 gave the park height no default because "a lift past the top of the Z travel stalls
the axis, and a Z that lost steps at the top would cut the next job deeper, so only the operator can
say how much room the machine has." Nothing then compared the operator's value with that room. The
second CNC audit (`docs/audits/2026-09-29-cnc-audit-second-pass.md`, P2-gcode-1, reproduced) set a
120 mm park height on the 4040 Max profile, which records 75 mm of Z travel: the job ended with
`G0 Z120.000`, preflight was empty and Job Review's park row showed only the bed X and Y. The first
audit's JR-3 found the same gap for any job whose depth plus safe Z exceeds the travel. Machine
Setup accepts 0.5 to 200 mm. GRBL's soft limits are off by default (`defaults.h`
`DEFAULT_SOFT_LIMIT_ENABLE 0`), so nothing stops the move at the top.

### Decision

1. **Job Review shows the park height** under Machine as "Park height: N mm above stock top · job
   end and bit changes", the same `max(safe Z, park height)` the emitter lifts to. It is in warning
   tone, with "at or above the T mm Z travel", when the height reaches the recorded Z travel.
2. **A job whose Z range is longer than the Z travel gets a warning.** The range runs from the
   deepest compiled cut up to the highest lift the job commands: every group's safe Z and the park
   height. The Z travel is the controller's `$132` when connected, otherwise the machine profile's
   recorded value; with neither, nothing is said. The warning names the lift (park height or safe Z)
   and says no work zero fits both ends.
3. Not changed here: the check against the live work offset on a homed machine (second audit
   P2-control-1), which needs a confirmed Home and the live offset in the warning inputs, and a
   Machine Setup field limit. Both remain recorded follow-ups.

### Verification

`src/ui/laser/cnc-z-travel-warnings.test.ts` compiles a 6 mm deep profile: with a 120 mm park
height and 75 mm recorded travel it warns with the full sentence; with 30 mm it is silent; a
reported `$132` of 30 mm is preferred and named; an 80 mm deep job names the safe Z; with no travel
known it is silent. `src/ui/laser/job-review/job-review-live-rows.test.ts` shows the park height
row in default tone at the safe Z and in warning tone at 120 mm against 75 mm of travel. No hardware
result is claimed.
