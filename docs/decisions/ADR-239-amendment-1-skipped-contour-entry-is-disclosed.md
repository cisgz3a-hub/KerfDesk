## ADR-239 Amendment 1 - A skipped contour entry says it was skipped (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

Amends ADR-239's disclosure: the G-code layer comment and Job Review's contour-entry facts. The
entry geometry, its length formula, and ADR-343's rule that an unknown bed envelope omits the entry
are unchanged.

### Context

ADR-343 stores the contour-entry envelope on the prepared job in program coordinates and omits the
optional entry when that envelope is unknown (`Job.contourEntryBounds === null`). The disclosure
did not follow. The layer comment (`contourEntryComment`) and both Job Review surfaces read only the
group's `entryRunwayMm`, so they still said the entry was effective:

- The file said `contour-entry 5.000 mm effective laser-off feed`, then the seek went straight to
  the ink edge and burned from rest (`G1 X30.000 Y370.000 F800 S0` then `G1 X50.000 Y370.000 F1500
  S300`, no ramp).
- Job Review said "5 mm effective target at operation feed · laser off" and "contour entry 5 mm
  effective (laser off)".

On the stock Neotronics 4040 profile homing is off, so the bed position is never known and every
live job (Absolute, User Origin and Current Position) took this path: the 4040 burned from rest,
which is what ADR-239 exists to prevent, while saying the opposite. Job Review promises facts from
the exact compiled job.

Rolling audit v2 03-P2-6 found this on 2026-10-21; meta audit v1 M2 re-checked it on main on
2026-10-23.

### Decision

1. `contourEntriesSkipped(job)` in `core/job/contour-entry.ts` is the one test: the job's envelope
   is null. The emitter omits the entry exactly then, so the disclosure and the bytes cannot
   disagree.
2. The layer comment on Line and Follow Shape groups says `contour-entry skipped (bed position
   unknown)` instead of `contour-entry N mm effective laser-off feed`.
3. Job Review's contour-entry fact reads "Not added · where the bed edges are in program coordinates
   is unknown, so each contour starts burning from rest", with the warning tone. The effective
   operation line reads "contour entry not added (bed position unknown)". It stays a fact, not a
   Start guard (ADR-228, ADR-565).
4. A job whose envelope is known, or an archived job with no envelope field (the legacy bed-size
   clamp), keeps the existing "effective" wording and bytes.

### Consequences

- The operator of a 4040 without homing now sees that its contours start from rest, and why.
  Whether ADR-239 should also apply when only the bed size (not its position) is known is a
  separate maintainer question that this amendment does not answer.
- A contour that individually gets no entry inside a known envelope (no tangent, no room before
  the bed edge, a start outside the envelope) is unchanged: the group target is still described as
  effective, as before.
- Output bytes change only in the comment of 4040 jobs with an unknown envelope. The emitter
  revision is bumped with ADR-415 Amendment 1.

### Verification

- `src/core/output/grbl-strategy-4040-contour-entry.test.ts`: with `contourEntryBounds: null`, a
  Line group and a Follow Shape group emit no ramp, no "effective laser-off feed", and two
  "skipped" comments. Failing before this change.
- `src/ui/laser/job-review/job-review-output-quality.test.ts` and
  `job-review-effective-operations.test.ts`: the skipped fact and summary, failing before this
  change; the effective wording for a known or legacy envelope still passes.
- Code and test evidence only. Nothing was burned.
