## ADR-239 Amendment 2 - A constant-power contour leaves by a laser-off exit (2026-10-28)

**Status:** Accepted, hardware verification pending. | **Date:** 2026-10-28

Amends ADR-239 Decisions 1-4, which gave 4040-safe contours an entry only. The entry, its length
formula, ADR-343's rule that an unknown bed envelope omits it, and Amendment 1's disclosure are
unchanged. ADR-257 keeps the 4040's Line cuts on M3 pending a hardware pass; this amendment does
not change that (see ADR-257 Amendment 1).

### Context

Quality audit Q1 (2026-10-28), finding Q6-P2-1, confirmed by an independent refuter with its own
GRBL planner model run on the emitted bytes:

- The catalogue Neotronics 4040 profile burns Line cuts with M3 (`cutPowerMode: 'constant'`).
  Under M3 GRBL holds the programmed power whatever the head's speed (gnea/grbl
  `doc/markdown/laser_mode.md`), and GRBL's own advice for M3 is to "add lead-in and lead-out
  motions around the line you want to cut".
- ADR-239 gave each contour a tangential laser-off entry, but nothing was written after the last
  burn point. The next line was the seek to the next contour, usually in another direction, so
  the head decelerated to that junction on the ink at full power. At the default 1500 mm/min and
  500 mm/s², path ends got 1.6-5.3x the line dose.
- A simulated 5 mm laser-off exit along the last edge brought simple-shape ends to 1.00x. Corners
  are a separate mechanism (junction deviation) that only M4 or a lower speed removes, and they
  are advised, not changed (ADR-257 Amendment 1).
- The last burn of an M3 job also ended in a lit stop: the job-end `M5` drained the planner with
  the beam on (accepted as inherent to M3 by OR-1 and ADR-398 Decision 1).

LightBurn adds no automatic laser-off exit; its Lead-In / Lead-Out are optional burned leads. The
exit is GRBL's documented M3 advice, applied where KerfDesk already applies GRBL's lead-in.

### Decision

1. `contourExitPoint` in `core/job/contour-entry.ts` is the entry's mirror: the last vertex carried
   on along the last non-degenerate edge, bounded by the bed, and null in the same cases (no
   tangent, no room, an end outside the known envelope, or an unknown envelope). Entry and exit
   share one tangent helper, so the entry's bytes are unchanged.
2. Compile bakes `exitRunwayMm` beside `entryRunwayMm` (same length) only where the group burns
   with constant power: the layer's Power mode if set, otherwise the dialect's default for its kind
   (`contourExitRunwayMm`). On the 4040 that is Line cuts (and their tab-span groups); Follow Shape
   fill is M4 there and gets no exit unless its operation is set to Constant. Under M4 GRBL already
   lowers power as the head slows, so an exit would only add motion.
3. The emitter writes one `G1 X.. Y.. F<burn feed> S0` (tagged `kerfdesk:laser-off-motion`) after
   each pass's last burn point, through the OR-1 output cursor. The junction into it is collinear,
   so the head passes the last vertex at burn feed and decelerates dark. Transitions held behind a
   lit M3 burn, including the job-end `M5`, now drain after it with the beam off.
4. The layer comment adds `contour-exit N mm effective laser-off feed`, or `contour-exit skipped
   (bed position unknown)`. Job Review's fact becomes "Contour entry and exit", and its skipped
   wording says each contour also stops at full constant power at its end.
5. Preview (`buildToolpath`), timing (which times the emitted program) and the Frame motion
   envelope (`computeJobMotionBounds`) include the exit. The envelope takes each pass's own last
   edge, so an overcut or a lead-out on the final pass moves it.
6. The emitter revision is bumped (v36).

### Consequences

- 4040 Line output gains one laser-off move per contour per pass, up to 5 mm long, outside the
  artwork; jobs take slightly longer and the Frame envelope can grow by up to 5 mm.
- The homing-off live Start path is unchanged: with the bed position unknown (the catalogue 4040
  inherits homing off, so every live Start), ADR-343 still omits both runways, and the 3.4-3.9x
  starts and the path ends remain. Job Review and the constant-power advice now say so and point
  to homing. Whether runways should apply when only the bed size, not its position, is known is
  still the maintainer question ADR-239 Amendment 1 left open.
- Archived jobs without `exitRunwayMm` keep their bytes. Generic, Falcon and GRBL Compatible
  profiles get no runways at all, as before.

### Verification

- `contour-entry.test.ts`: exit tangent, closing edge, degenerate trailing edges, bed bound,
  unknown envelope, mirror of the reversed entry; `contourExitRunwayMm` scoping by power mode.
- `compile-job-contour-entry.test.ts`: 4040 Line gets the exit, Dynamic Line and M4 Follow Shape
  do not, Constant Follow Shape does, overscan 0 and GRBL Compatible add none.
- `grbl-strategy-4040-contour-exit.test.ts`: the exit line after the last burn, open paths, a dark
  job-end `M5`, per-pass exits after a final-pass overcut, the bed bound, the skipped comment.
- `toolpath-contour-entry.test.ts`, `job-bounds-contour-entry.test.ts`: preview and envelope parity.
- Code and test evidence only. Nothing was burned; the 4040 scrap coupon ADR-239 asks for still
  applies.
