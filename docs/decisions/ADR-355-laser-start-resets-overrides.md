## ADR-355 - A laser job starts at 100% feed, rapid and power (2026-09-23)

**Status:** Accepted. | **Date:** 2026-09-23

### Context

An operator ran a raster image, used the live **+/−** Feed and Power
overrides during it, stopped it, cleared the canvas, imported a new image and
typed a new speed and power. The new job burned like the one they had just
stopped.

KerfDesk's output was correct. Replaying the exact sequence against the
simulated controller shows the second job's G-code carrying the new values
(`F3000`, max `S700` for 70%, where the first job sent `F1500`, `S300`). The
difference was in the **controller**, not in the program:

- Override percentages are held by the firmware and multiply every commanded
  feed and power until they are changed or reset. KerfDesk never re-sends
  them, and it never cleared them either.
- A job that completes leaves them in place.
- **ABORT JOB** sends a soft reset. Stock GRBL 1.1 resets overrides there, but
  grblHAL resets the feed override only when `$676` ("Reset actions") has
  bit 3 ("Clear feed override") set, and the rapid override only with bit 2.
  A controller configured without those bits carries a reduced or raised feed
  straight into the next job.

For laser jobs, KerfDesk surfaced this only as "· overrides active" on the
collapsed controller summary in Job Review. CNC already treats non-baseline
overrides as a Start concern (`cncOverrideStartIssue`). Laser had nothing, and
in the operator's session the Warnings list was already seven items long and
collapsed.

The operator chose the behaviour: every new laser job starts at 100%.

### Decision

1. **A laser Start resets feed, rapid and power overrides to 100%** when the
   controller reports anything else, or has not reported `Ov:` yet this session
   and so cannot be proved to be at 100%. Known-baseline values send nothing.
2. **The reset goes out just ahead of the first program window.** The three
   GRBL realtime bytes (`0x90` feed reset, `0x95` rapid 100%, `0x99` spindle
   reset) are their own write, with no newline, immediately before the
   program's first window: a queued line may not carry a byte above 0x7F
   (ADR-361, audit transport-2). GRBL acts on realtime bytes on arrival and
   never stores them in its receive buffer, so they cost no RX budget, owe no
   acknowledgement, are not charged to the streamer's in-flight accounting, and
   cannot reorder behind a queued line. The decision is made after every
   refusal point, and the reset is held back when the window itself cannot go
   on the wire, so **a refused Start sends nothing at all**.
3. **Only Start resets.** Pause/Resume never pass through Start, so
   adjustments made during a job stay in effect for that job. Every laser
   stream that does pass through Start resets: ordinary framed runs, recovery
   restarts and second passes.
4. **Controllers without realtime overrides are never sent the bytes**, the
   same capability gate the override buttons use (a 0x90-0x9D byte would land
   in such a firmware's line buffer).
5. **CNC is unchanged.** Its override policy (warn; allow safe reductions) is a
   separate, earlier decision.
6. **Job Review says it.** For a laser job with leftover overrides the
   controller summary reads "overrides reset to 100% at Start", and the
   Overrides row reads e.g. "Feed 60% · Rapid 100% · Spindle 80% — reset to
   100% when this job starts". The console log records the values that were
   reset.

### Consequences

- What the operator set and reviewed is what burns, whatever the controller
  was left holding.
- An operator who deliberately wants a reduced override for a whole job must
  set it after Start, during the job. The previous behaviour carried it over
  silently, which is the failure this decision removes.
- This adds no gate and removes none. Frame remains the sole ordinary Start
  policy gate (ADR-228/230/232/237); nothing here can refuse a Start.

### Verification

- `laser-start-override-reset.test.ts`: the decision for leftover, unknown,
  baseline, CNC and no-capability cases; on the real store, a controller
  reporting `Ov:60,100,80` gets the reset in front of the first program window
  (`\x90\x95\x99G21\n`) with the streamer's in-flight accounting still
  `G21\n` / 4 bytes, and the log names the old values; a baseline controller
  gets the program alone; a Start refused for the RX buffer sends nothing.
  The first test fails with the wiring removed.
- `job-review-live-rows.test.ts`: laser wording, unchanged CNC wording, and no
  extra text at 100%.
- **NOT verified on hardware.** No machine is available, and whether a given
  Falcon build keeps the feed override across Abort depends on its `$676`.
  The reset itself is standard GRBL/grblHAL realtime behaviour.
