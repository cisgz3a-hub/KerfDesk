## ADR-654 Amendment 4 - Job Review gives a registration jig job its own camera placement advice (2026-10-28)

**Status:** Accepted (rolling audit v5 finding J5-P2-1, confirmed by its independent refuter and
re-verified by the audit coordinator on main `09f7c0087`; the maintainer's standing instruction to
fix confirmed audit findings). Extends Amendment 3 Decision 1 from Place Board to the registration
jig (ADR-057). ADR-057 Amendment 6 adds the check against the outline run. | **Date:** 2026-10-28

### Context

Amendment 3 stopped Job Review telling a Place Board job to "Choose Absolute Coordinates", because
that burns it at the outline's place on the canvas, off the board. A registration jig shares the
same outline layer and the same anchor: both its runs anchor to the outline (ADR-057 Decision 3).
Only `captured-board` outlines were exempted, so a jig still got the generic advice.

The jig is two Starts. In the audit's repro the outline burned from User Origin with WCO (15, 25).
Between the runs, the after-job refresh or a look at the camera picture latched camera placement
(ADR-663 Amendment 4). The artwork run was then told "Choose Absolute Coordinates to burn it where
it is placed". Following that moved the artwork from X50–60 Y45–55, inside the burned outline, to
X195–205 Y195–205, wholly outside it, and nothing at Absolute mentioned the jig.

### Decision

1. **Camera placement on a jig job.** When the scene holds a registration jig (outlines without
   `captured-board` provenance) and camera placement is on at a relative Start from, Job Review
   says the job burns where that Start from puts the jig outline, not where the outline shows on the
   camera picture, and that the artwork keeps its place inside the outline. It tells the operator
   to burn both runs from the same Start from and work origin, not to switch to Absolute
   Coordinates between the runs, and to lay the artwork out inside the outline on the canvas. It
   never advises Absolute Coordinates. The outline run and the artwork run get the same words.
2. **The outline's own Start from comes first.** When ADR-057 Amendment 6 knows where the outline
   burned from and the artwork run differs, its warning names that Start from and replaces this
   advice, so Job Review never gives two answers.
3. **Advice only.** Both are Job Review warnings. Frame and Start are unchanged, and nothing is
   refused (ADR-228, ADR-565). At Absolute Coordinates no camera warning is given, as before.

### Consequences

- An operator who follows Job Review on a jig's artwork run keeps the art inside the outline.
- The phone and the MCP Start read the same Job Review warnings through `machineSnapshot`, so they
  give the same advice.
- WORKFLOW F-CAM2 lists the jig wording beside the Place Board one.

### Verification

`src/ui/laser/start-job-camera-placement.test.ts` builds the jig with the real store
(`addRegistrationBox`, `setRegistrationOutput`) and runs the real `prepareStartJob` at User Origin
with WCO (15, 25) and placement latched. The outline and artwork runs get the jig wording and no
"Choose Absolute Coordinates". These cases fail on main's code. Not hardware-tested.
