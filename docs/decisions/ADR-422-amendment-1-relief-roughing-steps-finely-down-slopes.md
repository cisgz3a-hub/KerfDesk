## ADR-422 Amendment 1 - Relief roughing can step finely down slopes (2026-09-26)

**Status:** Accepted; software-verified through unit, property, compile and removal-simulation
tests, hardware qualification pending. | **Date:** 2026-09-26

Amends ADR-422's roughing levels. The Frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: nothing here adds a guard, a refusal or a warning.

### Context

ADR-422 gave the floor and every flat a level of its own, and recorded what it left: "Terraces
on slopes remain: a sloped surface has no flat to add a level at." Between two depth-per-pass
levels a slope keeps a staircase up to one pass tall, which the finishing ball meets as a full
slice of stock at every step. Fusion calls its remedy fine stepdown; Vectric's and Carveco's
answer is a finer pass depth for the whole roughing or a raster roughing pass.

### Decision

1. **Setting.** A new optional layer field, `reliefFineStepMm`, shown as **Slope step** (mm)
   with the relief rows. Absent or 0 is off, and a project without it compiles as before. A
   non-positive value in a file is dropped on load, like the other optional CNC fields.
2. **Fine levels.** With a slope step set, band levels are added every step below stock top and
   below each ladder level, down to more than 0.05 mm (ADR-422's minimum flat step) above the
   next ladder level. They are bands exactly as ADR-422 item 3 defines them: each clears only
   the cells at or below it that the next level down will not reach, so a fine level cuts the
   slope between two levels and never re-clears the open floor. Their slice top, and so their
   ADR-413 cutter reach, is the ladder level above them (ADR-422 item 4).
3. **Flats with fine levels.** A flat earns its own level only when the lowest level reaching it,
   fine levels included, sits more than 0.05 mm above it. A fine level at a flat stands in for
   it.
4. **Band growth.** Where a band is steeper than one cell per level, it breaks into single cells
   with gaps where the tip steps over it, and each fragment would be its own piece. Every band
   (fine and flat) grows by one cell into the deeper cells around it. The cutter may stand there
   at the band's depth too (their tips are deeper), and their stock stands at the same slice top,
   so the grown band keeps ADR-412's clearance and ADR-413's reach. On the ADR-412 bench this
   cut a fine band's pieces from up to 80 to at most 16.
5. **Links.** A band level's links may cross those deeper cells as well (ADR-424 item 3).

### Consequences

- A slope keeps at most one slope step, plus 0.05 mm just above a ladder level, above the tip
  surface the cutter may reach. A property test checks this bound for every cell of random
  cone maps with random pass depths and steps.
- Pyramid relief (0.2 slope, 1.5 mm per pass, no allowance), largest stock left above the model
  after roughing: 1.65 mm to 0.59 mm with a flat 1/8" end mill at a 0.3 mm step, 1.53 mm to
  0.40 mm with a 1/8" ball nose. What an end mill leaves beyond the step is its flat tip standing
  radius x slope above the face, which only the finishing bit removes.
- ADR-412 bench relief at a 0.5 mm step (40% stepover, 1.5 mm per pass): stock left on the
  10-45 degree slopes drops from 2.37 mm to 1.47 mm at the 95th percentile (2.72 mm to 1.72 mm
  at most); steep walls from 3.36 mm to 2.83 mm. Roughing takes 15.8 minutes instead of 10.6,
  with 96 lifts instead of 35. Before band growth and ADR-424's links the same step took 28.4
  minutes and 392 lifts. The rest of the extra time is mostly straight descents from safe Z at
  the plunge feed (3.2 minutes), the emitter follow-up ADR-424 records.
- Band growth also adds one cell of deeper floor round every ADR-422 flat band; the flats keep
  exactly their allowance.
- Tests: `relief-roughing-levels.test.ts` (fine levels, band floors and slice tops on a pyramid;
  no levels for a step no finer than the ladder; a fine level standing in for a flat; the
  terrace bound as a property); `relief-roughing-3d.test.ts` (the allowance on fine steps down a
  30 degree slope, links and ramps included); `relief-roughing-motion.test.ts` (a band linked
  across deeper cells, and not across a gap wider than a cut width);
  `compile-cnc-relief-roughing-coverage.test.ts` (the pyramid terraces through the compiler and
  the removal simulator); `project-machine-cnc.test.ts` (load); `CncReliefFinishFields.test.tsx`
  (the Slope step row).
