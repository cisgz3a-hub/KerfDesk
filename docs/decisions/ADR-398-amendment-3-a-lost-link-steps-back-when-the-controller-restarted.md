## ADR-398 Amendment 3 - A lost link steps back over the planner when the reconnect shows the controller restarted (2026-10-22)

**Status:** Accepted. Extends ADR-398 Decision 2 to a lost link, and qualifies the premise in
ADR-341 Amendment 6's Context that a dropped USB link leaves the controller running every line
it had received. | **Date:** 2026-10-22

**Amended by [ADR-398 Amendment 4](ADR-398-amendment-4-a-greeting-banner-does-not-prove-a-restart.md):**
grblHAL greets every network client, and every native-USB port open, with its startup banner
without resetting, and a network board cannot show a restart at all. On those links a banner no
longer proves a restart: the first status or Alarm decides, an unknown verdict does not step back,
and the restart hint names the line that would.

### Context

Rolling audit 2026-10-21, finding 18-P2-1
(`docs/audits/2026-10-21-rolling-v2/18-preflight-recovery.md`), confirmed by a refuter.

A USB link that drops mid-job is saved as a `disconnect`. Recovery treated it as a stop that
leaves the controller running what it had received: the record kept no planner backlog, and
the automatic laser restart began at the first unacknowledged line. GRBL answers a line once it
is queued, not once it has moved (ADR-398 Context). A stop that throws the planner away
therefore also throws away acknowledged moves that never ran.

That premise does not hold for Arduino-class GRBL boards:

- The Arduino Uno's DTR line reaches the ATmega328P's reset through a 100 nF capacitor, so the
  board "resets each time a connection is made to it from software" (Arduino Uno Rev3 docs,
  "Automatic (Software) Reset"). The GRBL wiki FAQ says the same of its flow-control lines.
- Chromium asserts DTR when it opens a serial port (`serial_io_handler_win.cc` sets
  `DTR_CONTROL_ENABLE`; POSIX asserts DTR at open). The Web Serial `open()` steps cannot avoid
  it, because `setSignals()` only works on a port that is already open. KerfDesk never calls
  `setSignals`.
- Auto-connect (ADR-420, ADR-639) reopens a re-enumerated port within about a second.
- GRBL runs `plan_reset()` on every reset (`main.c`).
- A Uno on a CNC shield takes its logic power from USB, so pulling the cable stops it at once.

In the refuter's repro (80 cuts of 30 mm at F600 on stock GRBL, 50 lines acknowledged and 54
sent), the lost link restarted at line 51. The same planner loss saved as `controller-reboot`
restarted at line 36. The difference was 15 cuts, about 450 mm, left unburned. Recording every
lost link as planner-discarding would fix that. It would also make every board that kept running
burn up to a whole planner twice: 15 blocks on GRBL and 100 on grblHAL.

### Decision

1. **A lost link keeps its backlog aside.** A `disconnect` record holds the planner backlog the
   run had at the stop as `plannerBacklogIfRestarted`. That backlog is the status-report
   backlog when a report showed one, otherwise the controller's whole planner (ADR-398
   Decision 2). It does not move the restart yet. Recording the stop is otherwise unchanged,
   including `sentLines` (ADR-341 Amendment 6). The field is optional, and older records read
   without it.
2. **The first reconnect decides.** The connection that follows the drop is read for the first
   of three signs:
   - A startup banner (the only thing that sets the detected controller kind; an M115 reply
     KerfDesk asked for is consumed first) means the controller restarted.
   - An `ALARM:` line or an Alarm status means its motion was stopped. GRBL raises a run-time
     alarm through a reset (`mc_reset()`), and every reset clears the planner. A board that
     boots with homing enabled also starts in Alarm (`HOMING_INIT_LOCK`, `main.c`). Start
     refuses an alarmed controller, so the alarm is not left over from before the job.
   - A status report without either means the controller kept running.

   Later events in the same connection do not count. A connection that ends before any sign
   leaves the verdict to the next one. The verdict goes to a run that was live when a link
   dropped, also when its record lands after the reconnect, or to a record already saved when
   the connection began (after an app restart). A record made during the connection waits for
   the next one.
3. **A restart steps back like a reboot.** On a banner or an Alarm, the saved laser run is
   revised once (CNC pass recovery keeps its own planner reserve and reads no backlog):
   - the held-back backlog becomes `plannerBacklog`, so the automatic restart steps back over
     it (ADR-398 Decision 2) and the restart hint says which bound applied;
   - the interruption keeps the kind `disconnect` and its `sentLines`;
   - the Review's detail says the controller restarted, or was in Alarm, when it reconnected.

   A controller that kept running gets the backlog dropped, and its restart and message stay as
   they were. A revision only touches the saved, unclaimed capsule at the revision it read. It
   bumps that revision, so a Start prepared from the older record is refused and the Review
   shows the new one. The execution history keeps the record made at the stop.
4. **Continue from where the head stopped is unchanged.** It stays an opt-in action and still
   reads `sentLines` (ADR-341 Amendment 6). Its text already says that a laser that restarted
   or lost power stopped earlier than the last line sent, and that Frame remaining area shows
   the difference.

### Consequences

- An Arduino-class board that resets on reconnect, or loses USB power, is recut over its
  planner instead of skipping it. The cost is that a board which kept running until its planner
  drained, and then reset only when the port reopened, recuts up to a planner of moves that had
  already burned. ADR-398 Decision 2 prefers that to skipping, and Continue from where the head
  stopped is the exact path for that board.
- A board that neither resets when its port opens nor loses power shows no banner on reconnect,
  so its restart is unchanged.
- The rule is independent of the firmware family. It applies wherever the driver reports a
  banner, an alarm or a status, so Marlin on a Mega 2560 (its `start` banner) is covered too.
- Regression tests:
  - `src/core/recovery/link-loss-restart.test.ts`: the audit's 60-cut program, restart line 41
    before the verdict, 26 after a banner or an Alarm, and 41 when the controller kept running.
  - `src/ui/laser/recovery-link-loss-restart.simulator.test.tsx`: the GRBL simulator drops the
    link with its planner full, then reconnects with and without its banner.
  - `src/ui/app/link-loss-restart-tracking.test.ts`: which connection's first answer settles
    which saved run.
  - The `settleLinkLossRestartMutation` cases in
    `src/ui/state/recovery/recovery-slot-mutations.test.ts`.
- The recovery stress suites whose yanked simulator keeps running now reconnect without a
  banner. The suites that model a reset controller resume from the revised record.

### Not covered

- The planner size behind a `planner-size` bound is read after the port has closed, so a
  session's measured `$I` or idle `Bf` size is gone and the family default applies (GRBL 15,
  grblHAL 100). That is exact for the stock GRBL boards this finding is about. A grblHAL build
  with a larger planner can step back short of it.
- A board that powers up without a DTR reset and with homing off shows neither a banner (it
  printed it before the port opened) nor an Alarm. It is read as having kept running, as
  before.
- If the operator connects a different machine first, that machine's answer decides.
- An alarm on a finished stream (after the last `ok`) is saved as an unexplained stop with no
  step-back. That is audit 05-P2-2, a related but separate path, and its fix is a separate
  change.
- No hardware was operated. These are code and simulator results only.
