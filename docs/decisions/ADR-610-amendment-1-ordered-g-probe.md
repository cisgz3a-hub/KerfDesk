## ADR-610 Amendment 1 - Prove lost job replies with an ordered `$G`, not a timer (2026-10-18)

**Status:** Accepted by the maintainer's request to audit and upgrade the controller fixes. **Date:** 2026-10-18.

Replaces ADR-610's two timed proofs for GRBL-family controllers. Everything
else in ADR-610 stands: nothing acts until the whole program is on the wire and
only job lines are owed replies, the missing replies are applied as
acknowledgements, the ordinary post-job settle then confirms completion, and
nothing resets the controller.

### Context

An audit of ADR-610 against primary sources found two ways its timers could
finish a job the controller had not finished:

- **The `Bf` proof trusted a clamped number.** grblHAL prints the receive
  buffer's free bytes as a 16-bit value, and the maintainer's Falcon A1 Pro
  reported `Bf:512,65535` (laser-rx-capacity-evidence.ts). "As empty as the quiescent baseline" then
  holds even with lines waiting in the controller.
- **The Idle proof could not see a held program.** ADR-345 records a Falcon A1
  sitting Idle for about a minute with lines unacknowledged, then continuing.
  At the end of a job, 15 s of Idle would have finished the stream while those
  lines were still to run. The live bar would have gone away while the laser
  still had work queued.

Primary sources give a proof that has neither problem:

- GRBL reads serial lines strictly in order, one complete line at a time, and
  reports each line's status before reading the next (gnea/grbl `protocol.c`).
- `$G` has no machine-state gate in GRBL 1.1 (`system.c`: only `$$` is blocked
  during a cycle), in grblHAL (`system.c`: `output_parser_state`, flags
  `noargs`, `allow_blocking`, `allow_redirect`, no state check), or in FluidNC
  (`ProcessSettings.cpp`: `ReportCommand("G", ..., anyState)`; the job channel's
  commands are processed in order).

So a `[GC:...]` answer to a `$G` written after the last job line can only
arrive after every earlier line has been read and answered. Any reply still
missing at that moment was lost on the link.

### Decision

- For `grbl-v1.1`, `grblhal` and `fluidnc` drivers with `$G` as their modal
  query (the Falcon command contract keeps it), once two fresh Idle reports
  span 1 s after the last reply, KerfDesk writes one `$G`. It is the only `$`
  line allowed while a job is active (`'stream-probe'`), and only once the
  whole program is on the wire, so no job reply can be credited to it.
- The `[GC:` line proves the job lines written before the probe were read.
  The probe's own next reply settles the probe's reservation, never a job line.
  Then the still-missing replies are applied and the ordinary settle runs.
- While the probe owes its reply, the post-job settle and the Idle release
  wait, because either would take the probe's `ok` as its own. Replies that
  arrive meanwhile complete the job normally, and the probe then starts the
  settle.
- A controller holding its program answers the probe only after the held
  lines. The job is never finished early; the ADR-345 watchdog still governs a
  wait that never ends.
- If the probe's `ok` after `[GC:` is lost too, the probe finishes 2 s after
  the proof. If the job's last reply consumed the probe's `ok` because the
  `[GC:` was lost, the probe is released 10 s after it was sent.
- Every window above counts only time the status poll ran on schedule
  (ADR-356 Amendment 1). After a hidden, throttled or sleeping page resumes,
  replies queued meanwhile are still being read, so the Idle windows and both
  probe deadlines restart from the resumed tick rather than expiring at once.
- `$G` cannot complete a truncated motion line, unlike a bare newline. A probe
  merged with a half-received line is rejected as that line's `error:N`, which
  the existing stream-error path handles.
- Controllers without an ordering guarantee keep ADR-610's sustained-Idle
  rule (15 s, three reports, plus any G4 in flight). Today that is
  Smoothieware, whose `$G` is a shell command whose order against queued
  G-code has not been verified here. The `Bf` rule is withdrawn.

### Evidence and limits

`laser-lost-ack-reconcile.simulator.test.ts` drives the real store against the
GRBL simulator:

- one dropped `ok` finishes in under 5 s after exactly one `$G`;
- a controller holding the tail of its program is still streaming after 30 s,
  then completes through its real replies with no "lost" log;
- the probe's own lost reply finishes after the grace period;
- an undisturbed job sends no probe.

The existing hold and stall fixtures answered `$G` ahead of job replies they
were still withholding, which no ordered controller can do. They now queue
that answer behind the withheld replies, and their assertions are unchanged.

One case is left to the watchdog: Pause pressed during the second or two the
probe is out. The proof then arrives for a paused stream, whose missing
replies are not applied, and Resume waits as it did before this amendment.
No machine was operated.
