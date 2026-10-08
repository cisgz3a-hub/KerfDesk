## ADR-341 Amendment 8 - Jobs too large to archive keep a short record, and the Review moves to the job's points (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

After Amendments 5 and 6 the maintainer asked whether everything he had asked for was built.
Three pieces were not:

1. The Review could put the origin back and continue, but it could not take the head to the
   job's start or to where the burn would resume, so the operator jogged there by eye to
   check.
2. A job too large for the 64 MiB recovery archive (the photo engravings the maintainer runs
   on his Creality Falcon A1 Pro, 250,000 to 300,000 lines with their images) ran without any
   record. Amendment 6 left this open: after a lost connection there was no card, no saved
   origin and no stop, so the job could not be continued at all.
3. Continue from where the head stopped assumes the controller ran every line it had
   received. If the laser itself lost power, it stopped earlier, and the Review said so without
   saying how much earlier.

Amendment 7 made a clean finish of such an oversized run offer the second pass; this amendment
covers an interrupted one.

### Decision

1. **Go to job origin and Go to restart point.** Once the controller's origin is the one the
   job ran with, or one set from where the head stopped, the Review's placement section offers
   two beam-off jogs through the same jog as Go to work zero: to work X0 Y0, and to the point
   the resume re-enters at the chosen restart line (`resumeEntryPointMm`). The machine target is
   the controller's reported work offset plus the point, at the jog feed clamped to the head's
   maximum. A program that cannot be followed up to the restart line, or a controller that has
   not reported its offset, is said inline; nothing is sent.
2. **How far back a stop can sit.** Continue from where the head stopped now names the lines
   sent after the last one the controller confirmed and the XY travel they cover
   (`resumeTravelMm`), and says that confirmed lines may still have been queued, so the
   operator knows how far back along the path a power loss could have stopped the head.
   Distance inspection follows linear XY moves and the swept length of incremental-center
   G17 arcs, including modal arcs, signed-radius arcs and I/J full circles, in millimetres.
   Rounded I/J words allow at most 0.005 mm of start/end radius mismatch for this diagnostic;
   larger discrepancies stay unknown. That allowance is independent of firmware validity.
   It reports unknown for unsupported or ambiguous arc geometry, invalid words or nonfinite
   arithmetic instead of substituting an endpoint chord. Absolute arc centers, non-XY arc
   planes and arc-local P parameters are untracked. This is a single diagnostic walk;
   the archived executable transforms and the shared restart-point scan stay unchanged.
3. **A laser run without an archive keeps a short record.** When a fresh laser Start is
   accepted but its archive cannot be staged (over budget, or storage failed), Start hands the
   repository the run's start intent (ADR-337: fingerprint, length, output scope, placement)
   and the work offset the controller reported at Start. The repository holds it in memory
   while the run lasts. An interruption of that run writes it as a fingerprint-only capsule
   whose artifact carries the new optional `startWorkOffsetMm`. The interruption can arrive
   before Start has given up on the archive; the repository keeps it until the run is handed
   over, then writes it. A clean finish writes nothing. A painted second pass keeps no record,
   since no project reproduces it. The capsule gives the card, the Review, Restore saved origin
   with the saved numbers, the automatic restart line and the recovery refusal naming the saved
   origin. The post-Start toast and the Job Review capacity warning say what is kept.
4. **The Review can continue it without an archive.** A recovery of such a job rebuilds its
   program from the open project, which must reproduce the saved fingerprint, and its own
   archive is over the budget too, so staging it used to fail and the Review refused. When
   staging fails with `ExecutionArtifactTooLargeError` the attempt runs without an archive: the
   claim holds the capsule while Start is sent, and once the controller takes the program the
   capsule gives way to a short record for the recovery run. That record names the job's own
   program and maps the resume program's line counts back onto the job's (its preamble, then
   the job's lines one for one, checked line by line), so a second interruption leaves a capsule
   the Review continues from again. When the lines do not map one for one (a Marlin fan restore
   inserted among them), the recovery still runs but keeps no record, and the operator is told
   that tracking is unavailable. A refusal because the project no longer reproduces the
   fingerprint now says to open the project the job ran from, unchanged.
5. **Start from line** says, for a fingerprint-only record, that the card's Review finds the
   restart line in the open project.

### Consequences

- A lost connection during an oversized photo engraving now leaves the card. With the project
  still open and unchanged, the operator reconnects, homes if the machine was reset, restores
  the saved origin, and starts the recovery from the Review; a simulated run in
  `laser-recovery-oversized.test.ts` interrupts such a job, continues it, interrupts the
  recovery and continues again.
- A fingerprint-only record holds no program text, so Continue from where the head stopped,
  Frame remaining area and the two moves are not offered for it: each needs the program before
  the Review opens. The restore and the automatic restart still work.
- The record lives in memory until an interruption writes it. If the app itself dies mid-run,
  the ADR-337 intent covers only the arming window; a crash later in an oversized run still
  leaves nothing.
- Everything here is an operator action or information, not a gate (ADR-228).

### Alternatives rejected

- **Storing the G-code alone for oversized jobs.** Recovery needs the prepared project to
  rebuild the resume, and the images are what make these jobs large, so a G-code-only archive
  would still need the open project; the fingerprint already proves the project reproduces the
  program.
- **Raising the archive budget.** IndexedDB clones the whole archive on the Start path; the
  budget is what keeps the first byte prompt on large jobs.
- **A conservative second record at the recovery's restart line when the lines cannot be
  mapped.** It would claim a stop the run did not make, and a restart there burns the recovered
  stretch twice.
