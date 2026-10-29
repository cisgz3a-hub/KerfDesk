## ADR-398 Amendment 6 - A failed network read or write lets the job's reset go out before the session closes (2026-10-30)

**Status:** Accepted. Extends ADR-398 Decision 2 and Amendment 5 to a desktop network session the
window could no longer read or write. | **Date:** 2026-10-30

### Context

Rolling audit v6, finding K2-P2-1 (P2), confirmed by a refuter through KerfDesk's real `app://`
machine-network route, bridge, session and TCP socket in Electron 44.5.1
(`docs/audits/2026-10-28-rolling-v6/K2-watchdog-timing.md` on the audit branch).

- **The window closed the session on any read or write error.** When the window streams a desktop
  FluidNC or grblHAL session (ADR-676 fallback, or Background streaming off), that included the
  request's own timeout after a page stall (fixed by ADR-356 Amendment 2).
- **No stop could follow.** `close()` marks the connection closed before its handlers run, so every
  later write, the store's reset among them, was refused.
- **The store recorded a lost link.** The notice was "Network connection was lost during an active
  job". The record had no planner backlog unless a reconnect showed the controller restarted
  (Amendments 3 and 4).
- **No host was left to stop the controller.** It ran out its buffer, and under M3 the drained head
  stayed lit (K1-P1-3).
- **The session could often still take writes.** The main process owns the socket, and the failure
  was the window's, so a stop could still have reached the controller.

### Decision

1. **A failed write leaves the session open** (`desktop-machine-network.ts`).
   - Its delivery is uncertain, so it is never retried, and no write already queued behind it is
     sent.
   - Writes issued after the failure go out, numbered after it.
   - The store's existing active-job containment of a failed write (reset, M5 and M9, then the
     quarantine close) therefore reaches the controller.
   - The main process closes a session whose write it refused (out of sequence, over its queue
     limit, or a socket error), and the next read reports that.
2. **A failed read lets the store stop the job first.**
   - `SerialConnection.beforeReadFailureClose` (optional) registers the store's handler.
   - The window's network connection waits for it for at most 3 s of the window's running time,
     then closes.
   - For a running job, the handler (`containActiveStreamReadFailure`) does what a failed write
     does: it freezes the stream, requests the reset, sends M5 and M9, and closes the session.
   - Its notice keeps the lost-link kind (`disconnect-during-job`), so every physical-stop and
     recovery rule that reads it is unchanged. The text says KerfDesk could no longer read the
     connection and requested a reset, which may not have arrived.
3. **The reset is recorded against the stream** (`streamReset`). Under Amendment 5 the stopped run
   records its planner backlog, so the restart steps back over moves the reset may have discarded.
   If the reset did not arrive, the controller ran what it had, and the step back re-burns at most
   a planner. Decision 2 prefers that to a skip.
4. **Unchanged.**
   - A read that the main process reports closed (its socket is gone) still closes at once: nothing
     can reach the controller.
   - With no job running, a failed read closes the session as before.
   - USB, and network sessions streamed from the worker, are unchanged.

### Consequences

- **A failure of the window's own path no longer leaves the controller without a stop.** This
  covers a timeout, an unusable reply, and an overlong line from the controller.
- **The notice tells the operator a reset was requested.** It still names the physical E-stop,
  because the reset may not have arrived.
- **An idle session whose write failed stays open.** It stays open until the main process reports
  it closed or a read fails. Before, the window closed it at once.
- **A job's last report may be lost.** The stop waits up to 3 s with reads stopped. A reset banner
  or Alarm sent in that time is not read, so the reset transaction falls back on its 500 ms banner
  deadline.

### Verification

- **`desktop-machine-network-job-stop.test.ts` (real store over the real window connection,
  against a fake main process that long-polls reads).**
  - When reads fail, `0x18`, M5 and M9 are written through the session before it closes, and the
    notice reads as above.
  - When a job write fails, `0x18` follows it through the session before the close, and nothing
    queued behind the failed write is sent.
  - Both failed against `main`'s transport, which closed the session first.
- **`desktop-machine-network.test.ts` and `desktop-machine-network-host-gap.test.ts`.**
  - An uncertain write is not retried, and nothing queued behind it is sent.
  - A stop written afterwards is numbered after it.
  - A failed read waits for the stop, and closes after 3 s of running time if the stop never
    settles.
- **Not verified.** No real main process or TCP socket was failed mid-job, and no machine was run.
