## ADR-224 Amendment 5 - Job Review keeps the clock of the program it shows (2026-11-12)

**Status:** Accepted. | **Date:** 2026-11-12

### Context

Job Review re-prepares the job when the operator presses Confirm and accepts only the exact bytes
it showed (ADR-224, ADR-345): changed bytes are shown again and need a new Confirm. A job with
variable text is time-bound, so it is never reused and every re-preparation evaluated its date and
time fields with a fresh clock. A field with seconds (`{{time}}`, `{{datetime}}`, or `%S`) never
reproduced the shown value, so every Confirm showed the review again as changed and the job could
not be started. A field with minutes asked for an extra Confirm whenever the minute turned during
the review. Nothing wrong was burned, because the gate only streams bytes it has shown.

Oracle audit O1 area O5 found it (O5-P2-2) against its property "Preview text equals emitted
text".

### Decision

1. A review's re-preparation evaluates variable text with the clock of the program on screen,
   remembered for every time-bound compile (`shownProgramClock`). An unchanged job therefore
   reproduces its bytes and one Confirm starts it.
2. The burned date and time are the ones the operator approved in the review, not the moment of
   the Confirm click. A review left open for a long time burns the time it shows; reopening Start
   evaluates the clock again.
3. Edits made inside the review still re-prepare and are shown again, with the same clock.
   Print-and-Cut registration is not pinned: the marks captured now are used, as before.

### Consequences

- Variable-text jobs with seconds can be started again.
- Preview and output agree to the second.

### Verification

- `job-review-gate.variable-clock.test.ts`: a `{{time}}` job confirms in one click after the clock
  moved three seconds, and streams the program shown.
- NOT verified: the Worker path in a real browser (the test uses the in-process call the Worker
  makes). Frame then Start still compile with two clocks; whether a changing time can move the
  job bounds enough to revoke the Frame is listed for the maintainer, because pinning Start to the
  Frame's clock would burn the Frame's time.
