## ADR-057 Amendment 6 - The artwork run is checked against the Start from the outline burned with (2026-10-28)

**Status:** Accepted (rolling audit v5 finding J5-P2-1, confirmed by its independent refuter and
re-verified by the audit coordinator on main `09f7c0087`; the maintainer's standing instruction to
fix confirmed audit findings). ADR-057's first five amendments are unnumbered sections in
`DECISIONS.md`; this is the sixth. ADR-654 Amendment 4 gives the jig its camera advice. |
**Date:** 2026-10-28

### Context

ADR-057's Decision has both runs "burn from the same origin so the art lands where it sits relative
to the box", and Decision 3 anchors both runs to the box. Its first amendment adds that in Absolute
mode both runs emit at their true canvas positions. Either way works only when both runs use the
same Start from. Nothing recorded which one the outline used. The completion observer kept the job
placement only to cancel its own switch to **Artwork only**.

The audit's repro burned the outline from User Origin with WCO (15, 25), at machine X15–95 Y25–75.
The artwork burned at X50–60 Y45–55 from User Origin, inside the outline, but at X195–205
Y195–205 from Absolute Coordinates. Job Review at Absolute said nothing about the jig. The
camera's advice could lead an operator there (ADR-654 Amendment 4), and so could a plain change of
mind between the two Starts.

### Decision

1. **The outline run records its Start from.** When a complete outline run finishes cleanly (the
   same rule that switches to **Artwork only**), KerfDesk records the resolved Start from and job
   origin it compiled with, and which outline set burned: each outline's shape and its place within
   the set, wherever the set sits on the canvas (`registrationOutlineRun`). The record is kept in the
   session's controller state. It outlives a reconnect, so a cable change between the runs does not
   lose it, and **Forget controller** clears it. A failed, stopped or selected-only outline run
   records nothing. A record for another outline set never applies.
2. **The artwork run is checked against it.** When the artwork run's Start from, or its job origin
   at a relative Start from, differs from the recorded one, Job Review says so: "The jig outline
   burned from User Origin with the job origin at front left, but this artwork run starts from
   Absolute Coordinates. The artwork lands inside the burned outline only when both runs burn from
   the same Start from and job origin. Choose User Origin with the job origin at front left again,
   keep the work origin unchanged, and watch the Frame." This holds with or without camera
   placement, and it replaces the camera advice when both apply (ADR-654 Amendment 4 Decision 2).
3. **Job Review's jig steps name Start from.** The second step now reads "Keep its X/Y placement,
   Start from and the work origin unchanged."
4. **Advice only.** The warning is a Job Review warning. Frame and Start are unchanged, and nothing
   is refused (ADR-228, ADR-565). The phone and the MCP Start get it through `machineSnapshot`.

### Consequences

- An artwork run that would burn off the outline because its Start from or job origin changed is
  named before Start, whoever changed it.
- The record does not survive closing the app. An artwork run in a later session gets no check,
  as before, and the camera advice of ADR-654 Amendment 4 still applies.
- The work origin itself (the WCO) is not compared. A hand-set origin on a machine without homing
  can rightly be set again after a power cycle, so the step text asks for it to stay unchanged
  instead.

### Verification

- `src/ui/laser/registration-jig-completion.simulator.test.ts` runs the real Start flow against the
  GRBL simulator. It jogs to (15, 25), sets the origin there, and burns the outline from User
  Origin. After the outline settles, the record holds User Origin. With placement latched, the
  artwork run at User Origin gets the jig wording and no "Choose Absolute Coordinates". At Absolute
  Coordinates it gets the outline warning. This fails on main's code.
- `src/ui/laser/registration-jig-stream-completion.test.ts`: a finished outline records its origin,
  a failed one records nothing, a moved outline keeps its record and another outline set does not.
- `src/ui/laser/start-job-camera-placement.test.ts` covers the warning's words, a job origin change
  at the same Start from, an Absolute outline, and silence for a matching artwork run or an outline
  run.
- This is code and test evidence only. No machine was run.
