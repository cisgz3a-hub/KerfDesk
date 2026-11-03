## ADR-327 Amendment 1 - CNC Job Origin anchors the artwork, not the cutter's reach (2026-10-26)

**Status:** Accepted; software-verified through unit tests, hardware qualification pending. |
**Date:** 2026-10-26

Amends ADR-327 item 1 for CNC profiles. The Frame-first Start contract (ADR-228/230/232/237,
ADR-565) is unchanged: no Start gate is added or removed.

### Context

ADR-327 says the nine anchors name physical corners of the artwork as drawn on the canvas, and
WORKFLOW F-B13c item 2 says Job Origin aligns artwork bounds. ADR-052 Amendment 1 applied that to
scan offsets: `computeJobPlacementBounds` measures the design, and LightBurn places its Job Origin
on "the smallest possible rectangle that can fully contain all graphics".

A CNC group carries only toolpaths, so placement measured each group's tool-centre bounds widened
by the bit radius: the cutter's reach. The 2026-09-24 CNC audit (CO-3) asked for one rule to be
picked and documented. None was, and `coordinate-origin-audit.test.ts` pinned the reach anchor from
#832 on. Meta audit v1 M7-P2-3 reproduced it on main (`adf300522`), and a refuter confirmed it. At
User Origin, front-left anchor, zero set on the board corner:

- a 1/8" Outside profile put the artwork corner at (3.175, 3.175);
- an On-path profile put it at (1.588, 1.588);
- a 0.5 mm deep engraving with the 12.7 mm 90° V-bit put it at (6.35, 6.35), although that cut is
  about 1 mm wide. The reach used the bit's full body radius, not its cut width at depth.

Frame traced the same widened box, so nothing told the operator the artwork was set in.

### Decision

1. **A CNC group records its artwork's extent.** The compiler stamps each group with
   `designBounds`: the bounds of its operation's outlines in program coordinates, and for a relief
   the rectangle its heightmap is carved in, placed as the relief compiler places it
   (`src/core/cnc/cnc-design-bounds.ts`). Every group an operation compiles (roughing, finishing,
   clearing, the inlay pair) carries the operation's extent.
2. **Job Origin placement reads it.** `computeJobPlacementBounds` measures a CNC group by
   `designBounds`, so User Origin, Verified Origin and Current Position put the drawn corner on the
   target, whatever the cut type and bit. The CNC registration box anchors on the box as drawn.
3. **Everything that measures motion keeps the reach.** Frame, burn and motion bounds, the bed,
   envelope, stock and no-go checks, the start point, the estimate and Preview all keep the cutter's
   reach, profile leads included. An Outside profile now cuts past work zero by at least one bit
   diameter, and Frame traces that.
4. **The extent moves with the job and stays out of tiles.** Placement translates it with the
   toolpaths. A tile is zeroed on its own frame, so a clipped tile group does not carry the whole
   job's extent. A group without one, from an archive or a hand-built job, keeps the reach anchor.
5. Absolute placement does not change. Neither does laser placement: its burn geometry is the
   design.

### Consequences

- A placed CNC job moves by the reach it used to anchor on, toward the anchor: by one diameter for
  an Outside profile and one radius for On-path or an engraving. Saved G-code keeps its old
  placement; preparing the project again gives the corrected program. `EMITTER_REVISION`
  `cnc-artwork-anchor-20261027-v33` marks programs placed this way.
- An operator who set zero on the board corner for an Outside profile now cuts past the corner by
  the bit. That is where the part's drawn edge is, as in LightBurn; Frame shows the reach.
- The V-bit body-radius reach is unchanged where it still applies (Frame, envelope). It is the
  conservative motion bound, and no longer moves the job.

### Verification

- `src/io/gcode/prepare-output-cnc-design-anchor.test.ts`: at User Origin, front-left, a 1/8"
  Outside profile, a 1/8" On-path profile and a 0.5 mm engraving with the 12.7 mm V-bit each put
  the drawn 50 mm square at (0, 0) to (50, 50). Frame motion bounds still reach at least 3.175,
  1.588 and 6.35 mm past zero. The engraving cuts through the work-zero corner, and the placed
  groups carry the placed extent.
- `src/core/job/coordinate-origin-audit.test.ts` now pins the artwork anchor for CNC on every
  origin, anchor and Start-from mode, the same matrix as laser.
- Code and test evidence only. Nothing was cut on a machine.

### Implementation correction (2026-10-27 last-100 PR audit)

A closed bowtie can have zero algebraic signed area while its two lobes are both pocketed.
The bounds calculation now resolves that ambiguous case with the compiler's even-odd fill
normalization instead of discarding the outline. Collinear and retraced empty pocket outlines
remain omitted. Drill follows its own compiler rule: every finite closed contour with at least
three points contributes a centre hole, even when collinear, so its artwork also stays in bounds.
Regression tests cover the empty-contour controls and a compiled bowtie-plus-square pocket at
User Origin; its complete artwork anchors at zero while Frame still measures actual motion.
The correction and closed-start route re-scoring use emitter revision
`audit-placement-and-route-20261102-v41`. No placement policy or Frame/Start gate changes.

**Amendment 2 (2026-11-02):** [an older CNC job whose Job Origin now counts more contours says how
far its cut moved](ADR-327-amendment-2-older-cnc-jobs-say-how-far-the-cut-moved.md): fixes rolling
audit v9 R8-P2-1.
