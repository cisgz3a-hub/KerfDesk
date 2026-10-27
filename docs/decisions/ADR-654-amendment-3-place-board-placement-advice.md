## ADR-654 Amendment 3 - Job Review gives a Place Board job its own placement advice (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27

Fixes rolling audit v4 H6-P3-2 (P2 after its refuter),
`docs/audits/2026-10-27-rolling-v3/H6-camera-placement.md`. Unit-tested through the real
`addCapturedBoard`, Start preparation and Job Review warnings; not hardware-tested.

### Context

ADR-228 Amendment 1 warns a camera-placed job whose Start from is not Absolute Coordinates:
"Choose Absolute Coordinates to burn it where it is placed". It fired for any job while camera
placement was latched, Place Board jobs included.

A Place Board job is laid out on the board's outline, which ADR-654 Decision 3 centres on the
canvas. Decision 5 sets User Origin, front-left, and Decision 6 puts the work origin at the
board's corner. Following the advice burns the artwork at the centred outline, not on the board.
On a 400 × 400 mm bed, a 100 × 50 mm board lying at (20, 20) has its outline at (150, 175), 130 mm
and 155 mm away in X and Y.

The latch stays on while the picture is hidden, so the operator may see no picture that
contradicts the advice. Nothing in Start or Job Review checked a Place Board job at Absolute
Coordinates either.

### Decision

1. **Camera placement on a Place Board job.** When the scene holds a Place Board outline
   (`captured-board` provenance) and camera placement is on, Job Review says that the outline is
   centred on the canvas, not where the board shows on the camera picture.
   - At User Origin it says the job burns on the board Place Board registered there, and to lay
     the artwork out on the outline rather than on the board in the camera picture.
   - At another relative Start from it says the job burns where that origin puts the outline, and
     to choose User Origin.
   - It never advises Absolute Coordinates.
2. **A Place Board job at Absolute Coordinates.** With or without camera placement, Job Review says
   that the job burns where the outline sits on the canvas, not on the board, and to choose User
   Origin to burn it on the board (`placeBoardAbsoluteWarning`).
3. **Advice only.** Both are Job Review warnings. Frame and Start are unchanged, and nothing is
   refused (ADR-228, ADR-565).

### Consequences

- An operator who follows Job Review on a Place Board job keeps the burn on the board.
- An outline drawn on the canvas but not yet registered (Decision 3) gets the Absolute warning too,
  since its burn would also land at the centred outline.
- WORKFLOW F-CAM2 lists the Place Board wording beside the camera warning.
