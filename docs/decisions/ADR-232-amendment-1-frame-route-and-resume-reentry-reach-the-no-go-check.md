## ADR-232 Amendment 1 - The Frame's own route and a resume's re-entry move reach the no-go check, and the CNC envelope uses the full bit diameter (2026-10-22)

**Status:** Accepted (controller audit v3 D5 findings P2-1, P2-3 and P2-4, confirmed by an
independent refuter and the audit coordinator; the maintainer's standing instruction to fix
confirmed audit findings). | **Date:** 2026-10-22

### Context

ADR-232 §1 lets configured no-go findings appear in Job Review but never refuse Frame or Start.
§5 requires tests that no-go findings reach review. ADR-129's 2026-07-15 amendment says zone checks
follow the physical path, and that a live Start supplies the head position so the move from the
head to the first XY is checked too. Controller audit v3 area D5 (no-go zones and laser-off motion)
found three paths where motion never reached the check:

- **P2-1, the CNC cutter envelope.** The CNC scan widens each zone by the cutter radius read from
  the program's `; cnc tool:` comment. The emitter writes
  `; cnc tool: <kind>; diameter-mm: D[; angle-deg: A][; tip-diameter-mm: T]`. A greedy regex took
  the last `diameter-mm:` on the line, which is the tip for an engraving bit with a flat or a
  tapered ball nose. A clamp 1 mm from the cut got no warning, while an end mill of the same
  diameter was flagged. The full diameter is the physically right keep-out: a 30° 3.175 mm bit with
  a 0.2 mm flat is full width 5.55 mm above its tip, and even its slot at the surface is wider than
  the tip. The G-code Inspector already read the field by name (`program-tools.ts`).
- **P2-3, the project Frame.** ADR-232 deleted ADR-231's Frame guard ("its perimeter must clear
  enabled no-go zones") but did not move that perimeter check into a warning. The Frame's approach,
  perimeter and return were compared with zones nowhere, while every jog was
  (`laser-jog-warnings.ts`) and so was an opened program's Frame outline (ADR-630 Amendment 1
  item 2). A clamp crossed only by the perimeter got a "Frame complete" success toast and no Job
  Review line.
- **P2-4, laser resumes.** The saved recovery confirmed the warnings of the original program,
  scanned from the live head. The resume program it sends starts with a beam-off rapid from where
  the head stands now (after homing, a far corner) straight to the restart point, a move the
  original never makes. In the audit's scene `G0 X10 Y370 S0` from (390, 390) crossed a rear clamp
  that the full scan never reached. The manual Start from line and Choose restart point showed no
  preflight warnings at all.

### Decision

1. **The CNC envelope reads `diameter-mm` by field name.** `cutterRadiusFromToolComment` splits the
   `; cnc tool:` payload on `;` and takes the field named exactly `diameter-mm`, never
   `tip-diameter-mm`. A kind-less comment (`; cnc tool: diameter-mm: D`) still parses.
2. **The Frame's own route is compared with enabled zones.** The route is the one
   `buildFrameDispatchPlan` sends: the approach from the head to the perimeter's first point, the
   traced perimeter with the project's Frame start point, and the return leg when the Frame has one.
   - The segments use the jog guard's test (`firstZoneCrossedBySegment`). A CNC Frame widens each
     zone by the active bit's radius, as the CNC job scan does for travel at safe Z.
   - The work-coordinate route reaches native machine coordinates through the controller's own
     offset (machine minus work position), as an opened program's outline does, and reaches the bed
     only through a verified native-to-bed frame. That is the rule Start's own zone scan follows
     (`trustedMotionOffsetForPreflight`). Without one, Job Review already says zones cannot be
     checked, and the Frame adds nothing.
   - As the Frame is sent, each crossing is a warning toast and a console log line, as a jog's is.
     The Frame is sent unchanged. This covers every Frame: the project Frame, the split Frame
     (ADR-353), the transient camera and second-pass Frames, the recovery Frame and an opened
     program's Frame.
   - A project or split Frame's candidate carries the findings (`frameNoGoWarnings`). Start's Job
     Review lists them beside the job's own findings, and a review rebuild keeps them, because they
     belong to the Frame that Start claims.
3. **A laser resume's confirmation lists its own re-entry move.** The resume program actually sent
   is scanned from the live head with Start's trusted bed offset. Crossings on its preamble lines
   (the beam-off re-entry) are added to the original program's warnings. The replayed tail is the
   original program from the restart line, which the original scan already covered.
   - The saved recovery confirms the combined list and records it as the run's `warningsShown`.
   - The manual Start from line and Choose restart point now show the same "Controller warning"
     confirmation (the prepared source's warnings plus the re-entry crossings) before the laser-mode
     and resume questions.
   - Without a trusted bed offset or a verified head position, nothing is added; the original
     program's warnings already say zones cannot be checked.
4. **Nothing refuses.** Every finding above is a warning (ADR-232 §1, AGENTS.md machine and output
   policy).

### Consequences

- Tests cover each path through the real emitter and resume builder: the emitted engraving and
  tapered ball-nose comments; the Frame route's approach, outline and return legs, start point, work
  offset and CNC radius; the toast from the store's `frame` action; the permit and Job Review
  carrying the Frame finding through a rebuild; and the saved and manual resume confirmations. The
  physical-safety test that was titled "keeps a perimeter no-go finding advisory" ran without a
  verified bed mapping, so it could not show a finding. It is renamed to say it covers the
  non-refusal on an unverified mapping, and a new test covers a perimeter-only crossing reaching the
  permit.
- grblHAL, FluidNC, Marlin and Smoothieware (except the Falcon A1 Pro vendor contract), and an
  unhomed or `$130`-mismatched GRBL, have no verified bed mapping. On them the Frame route and the
  resume re-entry are not compared, as Start's entry move is not.
- The recovery's original-program warnings still include the head-to-first-part leg and lines
  before the restart line, which the resume never sends. That over-warning is unchanged.
- The manual restart may now show a confirmation it did not show before, such as the saved-profile
  power note, because it lists the same prepared-source warnings the saved recovery does.
- The other D5 findings stay open: P2-2 (lit rapids in opened programs under `$32=0`) and P3-1 to
  P3-7.
- Code and test evidence only. Nothing was run on hardware.
