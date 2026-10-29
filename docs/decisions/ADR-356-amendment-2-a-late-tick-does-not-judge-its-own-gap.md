## ADR-356 Amendment 2 - A late tick does not judge its own gap, and the Pause/Resume deadline and network request timeout count only time the page ran (2026-10-30)

**Status:** Accepted. | **Date:** 2026-10-30

Amends ADR-356 Decision 2 (the host-aware heartbeat) and Amendment 1 (the status poll record).
It also amends the 2 s liveness deadline of ADR-212's Pause/Resume transitions, and the request
timeout of the desktop network adapter (ADR-601). ADR-180 Amendment 3 (a laser escalates a failed
transition to a fail-dark reset) is unchanged. The stop sent before a failed network session
closes is ADR-398 Amendment 6.

### Context

Rolling audit v6, area K2 (`docs/audits/2026-10-28-rolling-v6/K2-watchdog-timing.md` on the audit
branch), tested every timer that can end a running job against a blocked renderer thread. A
refuter confirmed each finding through KerfDesk's real `app://` machine-network route, bridge,
session and TCP socket in Electron 44.5.1 (Chromium 152.0.7977.130).

The ordering behind them: Chromium gives a timer that fell due during a long task its queue
position only when that task ends. Input that arrived during the task is already queued ahead of
it, but a `fetch` reply's body is read on a task posted after the reply's own task, behind the
timers that fell due.

- **K2-P1-1 (P2): a false heartbeat reset on the desktop network transport.** On the window's
  network connection, a reply that arrived during a stall reached the store only after the overdue
  poll tick. ADR-356's grace needs a tick gap of 2 s or more. So once one reply was 250 ms late, a
  stall of 1.75–1.99 s reset a healthy job: `0x18`, M5, M9, the port closed, and a notice blaming
  the controller. Two late ticks widened the window to 1.5–1.99 s, three to 1.25–1.99 s.
- **K2-P3-2 (P3): USB depended on browser order.** On USB and the worker the same stall was
  harmless only because Chromium 152 runs the queued input first. HTML leaves the order between
  task sources to the implementation, and nothing in the code or tests would have noticed a change.
- **K2-P1-2 (P2): the Pause/Resume deadline was a plain 2 s timer.** During a stall no status query
  is written, so a stall that ended past the deadline failed the transition on any transport. On
  Resume the laser's fail-dark reset landed on a controller reporting `Run`. That happened even
  when `Run` had been read 1 ms before the deadline, because the refill write and the worker
  handshake settle on later tasks. The phone's Resume takes the same path.
- **K2-P2-1 (P2): a stall of about 5 s aborted the network read.** The request's own 5 s
  `AbortController` timer aborted a read whose reply had arrived early in the stall. The renderer
  then closed the session without a stop (ADR-398 Amendment 6).
- **K2-P3-1 (P3): the stated bound was wrong.** ADR-356's "declared lost after at most three
  further gaps" is a bound in gaps, not time. Measured from the last change it is 4B + 7 s for
  stalls of B ≥ 2 s, not the 3B + 2 s estimate.

Since the audit, ADR-676 moved desktop network sessions to a worker by default. There the reads
run off the window's thread and lines arrive as worker messages, as on USB. The window still
streams the session when Background streaming is off or the worker cannot start, and that path
kept all of the above.

### Decision

1. **A late tick does not judge its own gap** (`laser-stream-heartbeat.ts`).
   - A poll tick at least `LATE_POLL_TICK_MS` (500 ms, two poll periods) after the previous one
     vouches for silence only up to that previous tick. Input from its own gap may still be queued
     behind it, so the verdict on that gap moves to the next tick.
   - This uses no grace. Gaps of 2 s or more still re-open the query window, at most three times
     for one unchanged observation.
   - The rule holds for either task order, on every transport.
2. **Silence ends where the transport has read.**
   - `SerialConnection.inputReadThrough` (optional) says when every byte that had reached the host
     was last delivered as lines.
   - The window's desktop network connection reports when its last completed read was issued. The
     main process answers a read with everything it has queued, so all that reached it before then
     has been delivered.
   - The heartbeat declares loss only on 2 s of silence before both horizons. USB and the worker
     transports deliver as they read and report nothing.
3. **The Pause/Resume liveness deadline counts on-schedule polling**
   (`laser-pause-resume-transition.ts`).
   - The poll record keeps a running total, `onScheduleMs`. Each tick adds its gap, but at most
     `LATE_POLL_TICK_MS` of it.
   - The deadline expires once that total has grown by its timeout since it was armed.
   - After a stall the overdue poll tick runs before the deadline, because it fell due earlier. A
     poll that has not ticked since the deadline was armed is therefore not running, and the
     deadline keeps its wall-clock meaning.
   - The 30 s transition maximum is unchanged.
4. **An accepted report restarts the liveness deadline under every policy**
   (`laser-pause-resume-confirmation.ts`).
   - What is left after it is the host's own work: a Resume's refill write and the worker
     handshake. So a confirmation read before the deadline completes the transition.
   - A refill write that hangs is still bounded by a fresh 2 s of on-schedule polling and by the
     30 s maximum.
5. **The window's network request timeout counts time the window ran**
   (`desktop-machine-network-api.ts`).
   - `runningTimeDeadline` counts in 250 ms steps, and one step adds at most 500 ms. A step that ran
     late measured the window's own stall.
   - Reads and writes still time out after 5 s, and opening after 8 s, of that time. The worker
     transport is unchanged: its thread is not the one that stalls.

### Consequences

- **A page stall shorter than 2 s no longer resets a healthy network job.** The store rows that
  reset on `main` now keep the job: one late tick with a 1.75, 1.9 or 1.999 s stall, two with
  1.5 s, three with 1.25 s, replies read after the overdue tick.
- **The heartbeat no longer relies on browser task order.**
- **A real loss is still contained.** A controller that stays silent is declared lost on the first
  on-schedule tick after a stall, once 2 s have passed with nothing read.
- **Late detection, corrected (K2-P3-1).** With a stall of B ms just before every tick that would
  declare loss:

  | Stall B | Declared after the last change |
  |---|---|
  | none, or up to 250 ms | 2 s, unchanged |
  | over 250 ms, under 500 ms | 1.75 s + B |
  | 500 ms to under 2 s | 1.75 s + 2B |
  | 2 s or more | 3(B + 1.75 s) + 1.75 s + 2B = 5B + 7 s |

  - For B ≥ 2 s this was 4B + 7 s. Three graces still cap the re-opened windows. The fourth stall
    is now one the late tick after it cannot judge, and the fifth declares.
  - A host stalling at least 2 s before every verdict is already frozen, and a frozen page cannot
    stop the controller sooner.
- **Other detection costs.**
  - On the window's network connection a dead link is declared up to about a second later,
    because the main process holds an empty read for up to 1 s.
  - In a hidden tab throttled to one tick a second, detection takes 3 s instead of 2 s.
  - In a tab throttled to one tick a minute, it takes five delayed ticks instead of four.
- **Pause and Resume survive a stall.** A stall no longer fails them. A controller that stays
  silent still fails them after 2 s of on-schedule polling, with the stall counting at most
  0.5 s. In a hidden tab throttled to one tick a second, that is about 4 s.
- **A network request survives a stall.** A stall no longer aborts it. A main process that leaves
  it unanswered for 5 s of the window's running time still does.
- **Unchanged.**
  - The deadlines of Amendment 1 (`hostAwareSilenceRemainingMs`) and ADR-611 Amendment 1's 8 s
    "Not responding" window.
  - The acknowledgement watchdog of Decision 3.
  - The main process's 15 s renderer lease (audit KNOWN; controller-v3 D7).
  - The clock is still `Date.now()`. A forward clock step now looks like a late tick, which defers
    the verdict rather than declaring loss.

### Verification

- **`laser-stream-heartbeat-host-gap.test.ts` (real store, poll, heartbeat and containment).**
  - Replies read after the overdue tick: one late tick with a 1.75, 1.9 and 1.999 s stall, two
    with 1.5 s, three with 1.25 s. Each reset the job on `main` and keeps it here.
  - The same with replies read before the tick (passes on both).
  - A controller that stays silent is still reset on the tick after the stall.
  - Silence after the last completed network read does not count until a later read comes back.
- **`laser-stream-heartbeat.test.ts`.**
  - A late tick defers its verdict without a grace.
  - A walk that reproduces the bound table above.
  - The minute-throttled case declares on the fifth delayed tick.
- **`laser-store-pause-resume-host-gap.test.ts` (real store and laser Pause/Resume).**
  - Resume with the `Run` reply read after a 2.1 s stall.
  - Resume with `Run` read first but the refill settling after the stall.
  - Resume with `Run` arriving 1 ms before the deadline and later writes settling 4 ms after it
    (the refuter's case).
  - Pause with the parked report read after a 2.1 s stall.
  - Each sent `0x18` on `main`. A controller that never confirms is still reset after 2 s of
    on-schedule polling.
- **`desktop-machine-network-host-gap.test.ts`.**
  - A read whose reply arrived during a 5.4 s stall completes. On `main` it rejected with
    `AbortError`.
  - An unanswered read still aborts after 5 s of running time.
  - The read horizon follows completed reads.
- **`laser-status-poll-schedule.test.ts`** covers the running total.
- **A stall is modelled as one task.** `Date.now()` is frozen at its end while the fake timers
  catch up, so every timer that fell due runs at once and reads the same late clock.
- **Not verified.** These fixes were not run in Electron or Chromium; the audit's real-bridge probe
  measured the ordering, not this code. Not run on a machine, and real Wi-Fi reply latency was not
  measured.
