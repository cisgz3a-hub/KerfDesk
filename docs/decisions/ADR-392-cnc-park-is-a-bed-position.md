## ADR-392 - A CNC park is a bed position (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Phase H.9 ("parking parity", PROJECT.md) added the Machine Setup park without saying which frame its
numbers are in. This decision names the frame. The Frame-first contract (PROJECT.md non-negotiable
21, ADR-228) is untouched: the new Job Review note is a warning, and nothing here refuses Frame or
Start.

### Context

CNC audit CO-1 (`docs/audits/2026-09-24-cnc-full-audit.md`, high, reproduced): at every bit change
and at the end of the job, the program parked with `G0 X Y` using the Machine Setup park numbers as
they were, while the cuts moved to wherever zero was set. `translateCncGroup` shifted the passes but
not `parkXMm`/`parkYMm`. With zero at bed (150, 100) and a park of X0 Y380, the bit-change park
landed at bed (150, 480), 80 mm past the back of a 400 mm bed. Stock GRBL ships with soft and hard
limits off (`DEFAULT_SOFT_LIMIT_ENABLE 0` in
[defaults.h](https://github.com/gnea/grbl/blob/master/grbl/defaults.h)), so the carriage runs into
the end of travel mid-job and loses steps, and every cut after the change is shifted. Job Review
showed only an out-of-bed advisory and printed the park as bare numbers.

The audit named two consistent frames:

- **A: a bed position.** The park moves with the job like every cut. Where zero sits on the bed is
  unknown, the job parks at its start instead.
- **B: machine coordinates.** `G53 G0` on homed machines.

A is chosen:

- B exists only after homing. Routers without homing switches, including the 4040 that prompted
  the audit, would still need A's fallback, so B does not remove the unknown case.
- The Machine Setup park sits beside the bed size and stock fields, all in bed millimetres, and the
  out-of-bed advisory already reads the park in bed terms. Machine coordinates depend on `$23` and
  the homing corner, so the same numbers would mean different places on different machines.
- A reuses the frame KerfDesk already trusts for Absolute artwork, contour-entry bounds and the
  motion-bounds preflight: `trustedMotionOffsetForPreflight`, which needs a confirmed Home and the
  controller evidence that places the bed (`resolveNativeBedFrame`). It adds no new source of trust.

### Decision

1. **A configured park is a bed position.** Preparation moves it into program coordinates with the
   translation that takes a bed point to program coordinates:
   - Absolute: the cuts' own offset (`absoluteProgramOffset`, zero when bed and program coincide),
     so park and cuts shift together.
   - User Origin and Current Position: minus the bed position of program zero.
     `runtimeCoordinatePreparationOptions` now returns that position as `workZeroBedPosition`, a new
     `PrepareOutputOptions` field, whenever `trustedMotionOffsetForPreflight` knows it.
2. **Unknown means set aside, never guessed.** When zero's bed position is unknown, the configured
   park is removed from the job's groups. That covers no confirmed Home this session, a machine
   without homing, controller evidence that does not place the bed, and every Verified Origin job,
   whose origin is set by hand (ADR-053). The emitter's existing fallback then applies: Current
   Position parks where the head started, and the other modes park at program X0 Y0. Bed numbers are
   never written as program coordinates.
3. **Job Review says so.** `detectCncParkSetAsideWarnings` warns when Machine Setup has a park and
   the prepared job carries none. The "Park after job" fact labels the configured value as a bed
   position. Machine Setup's CNC limits text, its review page and the CNC setup reference all state
   the frame.
4. **No park set: unchanged.** Current Position parks at its start and every other mode at program
   X0 Y0, still labelled "Machine origin".

One seam places the park: `placeCncParks(job, bedToProgram)` in `src/core/job/job-origin.ts`, called
by `completePreparedOutput` right after `applyJobOriginOffset`. Emission, the preview, the duration
estimate, Job Review metrics (`resolveJobParkTarget`), the park-outside-frame note and recovery all
read the same placed park. `workZeroBedPosition` is carried wherever `absoluteProgramOffset` was:
`emitGcode`, the executable-plan emission, the prepare-output snapshot and its cache key, the live
estimate, the draw preview, and the large-job and preparation-worker paths and their request keys.

The emitter revision advances to `cnc-park-bed-position-20260925-v1`, because output for any job with
a configured park changes.

### Consequences

- A park chosen for bit access lands on the same bed spot wherever zero is set, which is what a park
  is for. A park that is on the bed no longer trips the out-of-bed advisory.
- Saved G-code for a User Origin or Current Position job that is not connected to a homed machine
  has no bed-position park. It parks at its origin, and Save's warnings say so.
- A park field that was ever edited cannot return to unset (audit MC-7), so a touched field is a
  configured bed park. A field left at 0, 0 now parks at bed (0, 0) once zero's bed position is
  known, rather than at program zero.
- Not changed here: an unset park is still labelled "Machine origin" although placed jobs park at
  program zero. A machine-coordinate (`G53`) park for homed machines remains a possible explicit
  option later.

### Evidence

- `src/core/job/job-origin-park.test.ts`: the park shifts by the bed-to-program translation, is
  dropped when that translation is unknown, and a job without a park is returned unchanged.
- `src/ui/laser/cnc-park-bed-position.test.ts`, on a homed stock-GRBL fixture where native (0, 0) is
  bed (358, 268) and a G54 at native (-300, -100) is bed (58, 168). A park at bed (0, 200) ends the
  program with `G0 X-58.000 Y32.000` for both User Origin and Absolute. With no controller, the User
  Origin job ends with `G0 X0.000 Y0.000` and never `G0 X0.000 Y200.000`, and Job Review carries the
  set-aside warning. With zero placed on the bed it does not.
- Red checks: forcing the translation to (0, 0) fails the three emission cases, and disabling the
  detector fails the warning case.
