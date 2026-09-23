## ADR-341 Amendment 3 - Resumed and painted jobs burn what the original burned, and say why they stopped (2026-09-23)

**Status:** Accepted. | **Date:** 2026-09-23

### Context

A deep re-audit of interrupted-job recovery, the automatic completion offer and
painted second passes compared what recovered programs burn with what the original
program burns, using an independent G-code interpreter over real emitter output, the
GRBL simulator's wire bytes and real Chrome. Earlier stress tests had compared the
resume builder's output with itself, so they could not see these defects:

1. **Raster rows resumed mid-row ran dark.** The beam-off re-entry is a `G0`, which
   leaves the modal motion at rapid. Image rows continue with axis-only lines
   (`X51S100`), and GRBL laser mode never fires on `G0`, so those rows moved as dark
   rapids. On an 80 x 20 mm Falcon photo at 10 lines/mm, 40 of 41 restart points lost
   burn, 35 mm on average and up to 79 mm.
2. **Air assist stayed off after a resume.** `M7`/`M8` were never tracked, and a
   controller reset turns the coolant outputs off.
3. **A rejected line was skipped.** GRBL answers a line it rejects with `error:N`; the
   stream counts that answer as acknowledged, so the automatic restart began after it.
4. **Nothing showed where the rest of the job would land.** A controller reset clears a
   `G92` origin, and on Windows opening the port resets Arduino-class controllers, but
   the review showed neither the saved nor the current origin and had no Frame.
5. **Large photo jobs silently lost their recovery archive.** The archive estimate
   charged three bytes per character, so G-code above about 22 million characters
   looked like 64 MiB although browsers store it at one byte per character.
6. **Fixing 1 and 2 would strand saved recoveries.** Lineage replay rebuilds each saved
   resume and painted stage and requires byte-identical output.
7. **Painted passes replayed whole sweeps.** A 5 mm spot on a wide row took about 90 s
   instead of about 14 s, and the output repeated `G1` and `S` on every line.
8. **A Start reconciled after a crash never reached the run history,** so its archive
   could not be read for lineage replay or painting.
9. Smaller: a keystroke meant for a field could answer the completion offer; Abort and
   a page reload were recorded as "The job stream ended unexpectedly."; pressing Start
   right after a job ended could be refused as "Another job Start is already being
   prepared"; a second window kept showing a recovery card another window had used.

### Decision

1. **Laser resume transform 2.** The resume preamble re-issues the air assist the
   program had active (`M7`, `M8`) before the beam-off re-entry. The first resumed line
   that relies on the modal motion mode gets the program's own motion word, in the
   line's own spacing style. A line relies on it when it has axis words and no explicit
   axis command, following GRBL: `G10`, `G28`, `G30`, `G92` and `G43.1` consume their
   axis words, while modal words such as `G90` or `G21` do not stop the motion. Burn
   detection in the replay follows the same rule. A program that never named a motion
   mode is left to the controller and its power stays off, as before.
2. **Transforms and writers are versioned in the archive.** Every recorded resume step
   carries `version`; a step without one was built by transform 1. Every painted stage
   carries `writerVersion`; a stage without one was written by writer 1. Replay uses
   the recorded version, and version 1 of both is kept byte-for-byte.
3. **Painted-pass writer 2.** A selected sweep is replayed from its first painted point
   less the sweep's own lead-in to its last painted point plus its own lead-out,
   crossing unpainted parts at S0, so the head reaches every painted point at the
   speed the original reached there. A side with no lead-in or lead-out keeps the full
   sweep on that side, because a shorter approach would change that speed. Repeated
   `G1` and unchanged `S` words are omitted, and equal-power brush intervals within one
   source move are written as one move.
4. **A controller rejection restarts at the rejected line.** The automatic restart
   finds the rejected line by its exact streamed text at or before the acknowledged
   count, within the 256 answers that can follow it before the stop takes effect, and
   falls back to the acknowledged count otherwise. The picker shows the automatic line
   and says that lines the controller ran after the rejection may burn again.
5. **The recovery review shows placement and origin.** It shows the saved placement,
   the work origin the job ran with and the current one, and warns when they differ by
   more than 0.05 mm. **Frame remaining area** traces the rest of the job from the
   chosen line through the ordinary Frame preparation, without a run candidate, so it
   issues no permit. Both are information; Frame remains the only ordinary Start guard
   (rule 7, ADR-228) and recovery Start keeps its own qualification.
6. **Archive estimate.** A string of printable ASCII, tabs and line breaks (G-code,
   base64) counts one byte per character, as the structured clone of every browser
   engine and UTF-8 store it; any other string, and every object key, keeps the maximum
   UTF-8 bytes per UTF-16 code unit. Keys stay at the maximum because there is one per
   node of a large job and scanning each would cost Start more than it saves (ADR-352).
   Job Review warns before Start when the program and its packed motion data alone
   exceed the 64 MiB archive budget.
7. **Reconciling an archive-backed Start appends its history record**, an interruption
   at zero acknowledged lines, exactly as a stale active run is promoted.
   **Recording an interruption the history already holds succeeds.** The tracker
   records an errored stream when it errors and again when the stream disappears; if
   the next job's activation cleared the capsule in between, the repeat was refused
   and surfaced as a false "recovery tracking hit an unexpected error" warning.
8. **Smaller corrections.** The completion offer opens with focus on its surface and its
   dismiss button reads **Not now**. Abort and the app closing record why KerfDesk stopped
   the stream, tied to that stream's epoch, and are saved as cancellations with truthful
   messages. Start waits up to two seconds for the previous run's record to close before
   refusing, then names what still holds the handoff. Committed recovery-slot changes are
   announced on a BroadcastChannel so every window refreshes its recovery card.

### Consequences

- Saved recoveries and painted passes replay unchanged. Transform 1 matched the shipped
  builder on 1,240 restarts of real emitter output and 85,887 restarts of random
  programs; writer 1 matched the shipped writer on 240 random selections.
- A resumed program's bytes change only where the old one was wrong: one motion word on
  the first line that relied on the modal motion, and the air words.
- A controller-error recovery may burn again, once, the few lines the controller ran
  after the rejected line before the stop arrived. The review says so; skipping a burn
  was the worse and invisible failure.
- Painted passes are shorter in time and bytes and their Frame covers only the trimmed
  motion. They still cross unpainted parts of a sweep between two painted spots.
- More photo jobs keep a recovery archive and the completion offer; the budget itself
  and the history limits are unchanged.

### Alternatives rejected

- **A standalone `G1 F<feed>` after the re-entry.** Valid in GRBL 1.1, but it depends
  on every GRBL-family parser accepting a motion word with no axis words. Naming the
  motion on the line that needs it is what the program itself would have done.
- **Rebuilding saved lineage with the new transform.** Replay proves sealed bytes; old
  recoveries and painted passes would have been refused.
- **Refusing recovery Start when the origin moved.** A new Start guard; rule 7 keeps
  Frame the only one. The warning and the remaining-area Frame inform the operator.
- **Raising the archive budget.** Unnecessary once ASCII text is counted as stored, and
  the budget bounds memory on the Start path.
