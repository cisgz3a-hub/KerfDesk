## ADR-398 Amendment 7 - The network worker route lets the job's reset go out before the session closes, too (2026-11-02)

**Status:** Accepted. Extends Amendment 6 to the default route, replacing its Decision 4's "network
sessions streamed from the worker" exclusion. | **Date:** 2026-11-02

### Context

Rolling audit v9, finding R1-P2-2 (P2, refuter-confirmed;
`docs/audits/2026-11-02-rolling-v9/R1-fix-marlin-watchdog.md`).

- **Amendment 6 fixed the window route only.** ADR-676 made the worker the default. On it a failed read
  or write closed the session with no reset, and under M3 the head stayed lit until the E-stop. The
  window route sent `0x18` at +32 ms on the same failure.
- **Closing the socket stops nothing** (`telnetd.c` L239-L249, `stream.c` L524-L528 in grblHAL;
  `TelnetClient.cpp` L47-L56 in FluidNC).
- **The reason given for leaving the route out covers a page stall, not this.** ADR-356 Amendment 2 says
  the worker's "thread is not the one that stalls". A stall of the Electron main process still reaches
  it: a synchronous dialog held for 8,642 ms served no reads, and the worker-style read aborted at
  5,001 ms (Electron 44.5.1).
- **The one route found during a job** is the "App controls unavailable" dialog, which names the E-stop
  first, so this stays P2. It would be P1 if a main-process stall of 5 s or more were found with no
  warning first.

### Decision

1. **A failed read waits for the store's stop** (`network-serial-worker-runtime.ts`).
   - The worker keeps its writer and reports `read-failing`. The connection runs the same
     `beforeReadFailureClose` handlers the window's does (`network-serial-connection.ts`), so the store
     runs `containActiveStreamReadFailure` unchanged, and answers `read-failure-settled`.
   - The session then closes, once the write queue has drained within its existing bound.
   - **The wait is at most 3 s**, the same as the window's. It is a plain timer, because this thread does
     not stall with the page. A close of the session ends the wait early.
   - With no job running, the handler returns at once and the session closes as before.
2. **A failed write leaves the session open.**
   - Its delivery is uncertain, so it is never retried. The stream it errored rejects whatever was queued
     behind it, so no job line follows one that may be lost.
   - Writes issued after the failure go out on a fresh stream, numbered after it. So the store's existing
     containment (a reset, M5 and M9, then the quarantine close) reaches the controller.
   - The main process closes a session whose write it refused, and the next read reports that.
   - A failed refill and the refills queued behind it report one failure, so containment runs once.
3. **Unchanged.**
   - A read that the main process reports closed still closes at once: nothing can reach the controller.
   - The 5 s request timeout stays, since the failure is real there.
   - The overlong-line trigger does not apply to this route: the session stays open.
   - USB is unchanged. Its read failures mostly mean the port has gone, and it has no such handler.
   - The window route is unchanged.

### Consequences

- **The default route now matches the window route on the same failures.** The notice, the
  `disconnect-during-job` and `write-failed` kinds, and the recorded `streamReset` are the same, because
  the store's path is the same.
- **A job's last report may be lost.** The stop runs with reads stopped, so the reset falls back on its
  500 ms banner deadline, as on the window route.
- **An idle session whose write failed stays open** until the main process reports it closed or a read
  fails. Before, the worker closed it at once.

**What this does not fix:**

- **The stalled main process also carries the socket.** Nothing reaches the controller until it answers,
  on either route. The stop helps from then on, and only if that comes within the 3 s wait plus the
  write's own 5 s. During the stall refilling stops too, so under M3 the head stops lit.
- **The window must answer.** The stop is the store's decision. If the page is hung through the 3 s, the
  session closes with no stop. That is the case behind the one trigger found, and that dialog names the
  E-stop first. Having the worker send the reset itself would leave the store with no record of it, so a
  restart could skip the moves the reset discarded; it was not adopted.
- **A write the main process never saw** (R1-P3-1 Part 2). The stop goes out numbered after it, the session
  refuses it as out of sequence, and it destroys the socket. The window route does the same. Whether
  Chromium can drop such a request has not been measured.

### Verification

- `desktop-machine-network-job-stop.test.ts` now runs on both routes: the real store and connection, and
  for the worker route the real network worker runtime, against a fake main process. When reads fail, and
  when a job write fails, `0x18`, M5 and M9 go out through the session before it closes, and nothing queued
  behind the failed write is sent. The worker-route cases fail on main's code. The window-route cases pass
  on both, so that route is unchanged.
- `network-serial-worker-runtime.test.ts`: a failed read keeps the session open and numbers the stop in
  sequence; a close ends the wait; the session closes after 3 s if the stop never settles; a read reported
  closed still closes at once; a failed write stays open with its stop numbered after it; a write queued
  behind it is rejected and never sent.
- **Not verified:** a real main-process stall during a job, a real job through the "App controls
  unavailable" dialog, and hardware. The failure was injected at the route.
