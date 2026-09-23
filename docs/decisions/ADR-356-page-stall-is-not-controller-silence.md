## ADR-356 - A page stall is not controller silence: sliced serial dispatch and host-aware watchdogs (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends the heartbeat detection in ADR-212 (a connected stream-heartbeat failure requests
containment) and the ack-watchdog telemetry of ADR-345. Complements ADR-352 (per-line UI
cost) and ADR-354 (worker-owned transport); it changes none of their decisions.

### Context

An operator burning a 298,082-line photo engrave on a Creality Falcon A1 Pro from
kerfdesk.com (build 90c791c5f) reached 219,145 acknowledged lines (74 %) after 1 h 29 min.
Chrome then showed **Page Unresponsive**: an input event had gone unacknowledged for Chromium's
15-second hang timeout (`kHungRendererDelay`). The job was lost.

An investigation against that exact build (six measured lenses, one verifier pass and a real
Chrome reproduction) found no single function that blocks for 15 s by itself. It found a main
thread that does everything during a job: the serial read, acknowledgement and refill loop,
every per-acknowledgement store update and render, and the burn-canvas paint. The only
multi-second stall reproduced came after the page was minimised and restored at 74 %: longest
task 11.95 s, longest gap 17.7 s, with `runReadLoop` → `advanceStream` → refill leading the
profile. Three defects in how the host treats its own stalls were found in code no open change
touched:

1. **The serial read loop never yielded.** `runReadLoop` awaited `reader.read()` and dispatched
   every line of the chunk synchronously. Chromium holds up to `SERIAL_BUFFER_BYTES` (4 KiB,
   about a thousand `ok` lines) while the page is busy. A read whose chunk is already queued
   resolves as a microtask, so the backlog was handed over as one task. Anything the controller
   answered in the meantime joined the same task. Input, rendering and the status poll could
   not run until it ended.
2. **The heartbeat could abort a job the operator had waited for.** After a gap, the first tick
   used its single scheduling grace and sent a fresh `?`. The reply sits behind the backlog
   from (1). If the host stalled for 2 s again before processing it, the next tick declared the
   link lost, and the containment reset the controller and ended the job. Acknowledgements
   arriving throughout did not count as evidence that the link was alive.
3. **A page stall was reported as a controller hold.** The ack watchdog measured wall time
   since its last observation. The first tick after a 20 s stall said "Controller holding
   program … for 20 s … KerfDesk is connected and waiting". After 90 s it raised a safety notice
   saying the controller had not acknowledged, blaming the machine for the page's own stall.

### Decision

1. **Sliced dispatch** (`src/platform/web/serial-read-slice.ts`, `web-serial.ts`).
   - The main-thread read loop dispatches lines synchronously while the current task has spent
     less than `READ_LOOP_SLICE_MS` (8 ms), then continues on a later task.
   - A read that resolves on a later task starts a fresh budget. A task turn is detected by a
     posted `MessageChannel` message having been delivered, so ordinary chunks never yield.
   - The yield uses `MessageChannel`, not a timer, because hidden tabs throttle timers and the
     stream must not slow down. Runtimes without `MessageChannel` fall back to `setTimeout(0)`.
   - Lines keep their wire order and are each dispatched exactly once.
   - A connection closed during a yield receives no further lines. They are dropped exactly as
     bytes still in flight at close are.
2. **Host-aware heartbeat** (`laser-stream-heartbeat.ts`).
   - The probe identity includes the streamer's acknowledged-line count, so an acknowledgement
     proves the link just as a fresh status report does. It is controller output parsed from a
     line the host sent.
   - A tick at least `HOST_SCHEDULING_GAP_MS` (2 s) after the previous one re-opens the query
     window at most `ACTIVE_STREAM_SCHEDULING_GRACES` (3) times for one unchanged observation.
   - Two seconds with neither a report nor an acknowledgement while the host is polling on
     schedule still requests fail-dark containment, as before. A silent controller behind a
     host that keeps stalling is still declared lost after at most three further gaps.
3. **Host-aware ack watchdog** (`laser-stream-stall.ts`, re-exported from
   `laser-store-helpers`).
   - The stall probe records when it last checked.
   - A tick at least `HOST_SCHEDULING_GAP_MS` after the previous one restarts the wait at that
     tick. The hold bar, its log line and the 90 s notice therefore count only time the page was
     observing.

### Consequences

- **A backlog no longer freezes the page.** Draining it no longer blocks input, rendering or the
  status poll. The total work is unchanged: a backlog drains at the same per-line cost, now
  interleaved with frames.
- **Normal traffic is unchanged.** Steady-state chunks are dispatched exactly as before and never
  yield.
- **Waiting out a page stall no longer ends the job by itself.** The heartbeat no longer aborts
  the job while acknowledgements are arriving, or across up to three host stalls. Real link loss
  is still contained within 2 s of on-schedule polling.
- **Detection is slower in a throttled hidden tab.** A dead link in a hidden tab whose timers are
  throttled to one tick a minute is contained after up to four delayed ticks instead of two.
- **The hold bar tells the truth after a stall.** It no longer claims a controller hold that was
  the page's own stall. In a hidden tab throttled below one tick per 2 s, a genuine hold is
  reported once the page is polling on schedule again.
- **The page's causes of stalls are not removed.** A frozen page still stops feeding a
  main-thread transport. ADR-352 reduces the per-line cost, and ADR-354 moves the refill to a
  worker. This decision only stops the host from turning its own stalls into a one-task
  catch-up, a false abort or a false diagnosis.

### Verification

- **The new tests fail on the previous code (7 of them) and pass here.**
  - `web-serial-read-slice.test.ts`: a timer runs while a 400-line backlog of slow handlers
    drains, all lines arrive in order, and a close during a yield stops delivery.
  - `laser-stream-heartbeat.test.ts`: a second stall before the resumed reply, an
    acknowledgement without a status report, and the bounded re-grant.
  - `laser-store-helpers.test.ts`: a scheduling gap restarts the stall clock; a controller that
    stays silent once polling resumes is still flagged.
- **The affected suites pass**: 35 files, 273 tests covering the web serial transports, the
  heartbeat fault, pause/resume, post-job settle, the hold bar and poll tests.
- **Node differs from browsers here.** Node drains a chain of `MessagePort` messages in one go,
  where a browser runs each as its own task. The loop tests therefore run the timer fallback,
  and a separate test pins that the `MessageChannel` yield resumes on a later task.
- **Not verified:** a real Chrome Web Serial port, the Falcon, or whether Chromium's readable
  enqueues buffered bytes synchronously on pull. The dispatch bound holds either way. No
  machine is available to this project.
