## ADR-356 Amendment 1 - Status-silence deadlines count only time the poll ran on schedule (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

ADR-356 made the stream heartbeat and the ack watchdog host-aware: a page stall is not controller
silence. The controller commands that wait on status reports were left out. These are
`non-idle-status-activity` commands such as the post-job settle marker, and `waitForFreshIdle`.
Each armed a one-off timer for its whole timeout, 30 s for the settle marker and 8 s for fresh
Idle, and every status report re-armed it.

Chrome runs the timers of a tab hidden for five minutes once a minute. The 250 ms status poll
is a chained interval, so it sends `?` once a minute. A one-off timer armed from a serial read
still fires on time. When a job finished in a minimised Chrome, the post-job settle got at most
one status report a minute. Fresh Idle needs two reports within 8 s, so it timed out with
"Timed out waiting for fresh Idle." The job's last moves could likewise outlast the settle
marker's 30 s. The run was then recorded as interrupted, and no second pass was offered for a
job that had finished (ADR-341 Amendment 4).

### Decision

1. The status poll records each tick (`recordStatusPollTick`, `laser-status-poll-schedule.ts`)
   before any early return. It records when the timer last ran, and when it last resumed after a
   gap of at least `HOST_SCHEDULING_GAP_MS` (2 s).
2. A status-silence deadline counts only time the poll ran on schedule (`armSilenceTimer`).
   - When its timer fires and the poll has not run within the gap, it waits a full timeout again.
   - After the poll resumes, silence is measured from the later of arming and resuming.
   - With no poll recorded, as in narrow harnesses, the deadline keeps its wall-clock meaning.
3. Teardown clears the record with the poll.
4. Fixed wall-clock timeouts (`timeoutMode` other than `non-idle-status-activity`) are unchanged.

### Consequences

- A job that finishes in a hidden or minimised tab settles on the throttled poll's reports and
  is recorded as completed.
- A controller that stays silent while the poll runs on schedule still fails the settle after
  the same timeout as before.
- In a throttled hidden tab, a silent controller is detected only once the tab is polling on
  schedule again. This is the trade ADR-356 made for the heartbeat.

### Evidence

- `laser-post-job-settle.test.ts`: in an emulated minute-throttled tab, the settle completes on
  the throttled Idle reports, and waits for the settle marker while the final moves take longer
  than its timeout. Both fail before this change with "Timed out waiting for fresh Idle." A
  silent controller once the poll is back on schedule still fails the settle.
- `laser-status-poll-schedule.test.ts` covers the tick record and the remaining-time rule.
- Headless Chromium always reports the page as visible, so the throttling itself was emulated.
  Not verified in a minimised Chrome on real hardware.
