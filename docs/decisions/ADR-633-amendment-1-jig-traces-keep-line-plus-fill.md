## ADR-633 Amendment 1 - The jig tracer commits Line + fill as the Trace dialog does (2026-10-22)

**Status:** Accepted. Amends ADR-633; applies ADR-454 to the jig tracer. | **Date:** 2026-10-22

### Context

Rolling audit v2, finding 07-P2-3. The jig tracer offers every trace style through the shared
preset picker, but `buildJigTraceObject` kept only Edge Detection and Centerline as trace modes.
Every other style, Line + fill included, became `filled-contours`. A Line + fill trace made in the
jig therefore put both colours on Fill operations. Fill skips the open pen strokes, so they never
burned, although the preview showed them as lines. ADR-454 binds those strokes to a Line
operation that burns once down their centre.

### Decision

The Trace dialog's mapping from trace options to the traced object's mode moves to
`ui/trace/trace-mode-for-options.ts`, and both the dialog and the jig tracer use it. Line + fill
keeps `hybrid`, so the jig's fresh import and its replace route (ADR-633 Decision 2) both bind the
strokes to a Line operation and the outlines to a Fill operation, through
`freshArtworkModeForColor`.

### Consequences

A Line + fill trace committed in the jig burns its pen lines as the Trace dialog's does. Every
other style keeps the mode it had. Audit 07-P3-3 is not part of this amendment: the jig still
skips Colour layers' darkness-ordered powers.

### Verification

`jig-trace-import.test.ts` builds a Line + fill trace through `buildJigTraceObject`, imports it
into a jig session, and checks that the stroke colour lands on a Line operation and the fill
colour on a Fill operation.
