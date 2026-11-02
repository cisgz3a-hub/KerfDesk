## ADR-676 Amendment 1 - The Marlin worker keeps its refill through a stray Unknown-command echo, and a Marlin stop sends its lines ahead of the handback (2026-10-29)

**Status:** Accepted on 2026-10-29. Decision 1 is replaced by Amendment 2 (2026-11-02): the echo
that does not name the line in flight means Marlin skipped that line, so the job ends. Its aim
stands: the refill never moves to the window with nothing said. Decision 2 stands, and Amendment 2
gives Pause the same order. |
**Amends:** ADR-676 decision 1 (which Marlin replies hand the refill back), decision 2 (the
order of a Marlin stop's release and stop lines) and its Consequences (the stop's wait)

### Context

Rolling audit v8 area N1 (`docs/audits/2026-10-29-rolling-v8/N1-fix-window-stall.md`,
refuter-confirmed) verified ADR-676 on main `33bc394c6`. It found two gaps on the new Marlin
worker path:

- **N1-P1-1 (P1).** The worker handed the refill back on every `echo:Unknown command`.
  - The main thread treats such an echo as a rejection only when it names the line in flight
    (MA-12, `laser-unknown-command.ts`). Any other echo stays in the log, and the job streams on.
  - Marlin echoes the bytes it read (parser.cpp L133, L390-L392). A line without `N` has no
    checksum (queue.cpp L473-L510). So a command letter lost on the UART turns `G1 X14 Y50` into
    `echo:Unknown command: "1 X14 Y50"`, then `ok`.
  - After one such echo the window refilled the rest of the job, and nothing re-armed the worker.
    `jobStreamHost` still said `worker`, and no notice was raised.
  - A later 1.6 s window block left the head lit for 1,020 ms (inline) and 1,392 ms (fan). That is
    K1-P1-2 and K1-P1-1 again, with no warning.
- **N1-P2-1 (P2).** Marlin Abort and Disconnect awaited the worker's `released` reply before
  writing `M107`, `M410`, `M5 I`.
  - The worker stops refilling at once, but its reply queues behind every line it forwarded while
    the window was busy.
  - After a stall, when an operator is most likely to press Abort, the stop lines waited for that
    backlog. Meanwhile the controller drained and stopped.
  - With a modelled 4 ms per forwarded line, the fan stayed at 204 over the stopped head for
    226 ms. The GRBL Abort posts its reset first for exactly this reason (`laser-job-stop.ts`).

### Decision

1. **An unknown-command echo hands the refill back only when it names the line in flight.**
   - The worker reads the echo against the oldest line its stream still owes an `ok`. It uses the
     main thread's own test, `echoedCommandMatchesLine` (`core/controllers/marlin/hosted-refill.ts`).
   - A match is a skipped job line, which ends the job (MA-12). It still hands back before the
     line is forwarded.
   - Any other echo is forwarded like any echo. The worker refills on the `ok` that follows, as
     the window does.
   - Both sides apply the same test to the same line: the worker's stream and the main thread's
     step through the same replies. So they cannot disagree.
   - The corrupted move itself is still skipped on both transports (MA-12, unchanged).
   - **Not adopted: re-arming after the handback.** The main thread could arm the worker again
     once it had decided the echo does not end the job. That still leaves at least one refill on
     the window, and a full handshake during which a stall leaves the beam lit. It also sends the
     whole program to the worker again. Keeping the refill loses nothing.
2. **A Marlin stop posts its stop lines right behind the release, and freezes after the reply.**
   - With the worker holding the refill, Abort and Disconnect post `release` and then every stop
     line in order, before their first await.
   - The worker handles the release first, so it writes no job line after the stop lines. It then
     writes them at once.
   - The stream is frozen only when the worker's reply arrives. Until then each forwarded `ok`
     steps this side's stream as it stepped the worker's. So a line the worker sent before the
     release is on this side's ledger, and its reply cannot settle a stop line (audit F1).
   - Disconnect retires its owned writes (the write epoch) before it posts, so the stop lines
     belong to the epoch the disconnect opens. Its 500 ms write bound starts once the reply has
     arrived, because the write replies queue behind the same backlog.
   - `releaseHostedRefillBeforeStop` is removed.

### Consequences

- A corrupted command letter no longer moves a Marlin job off the worker. The protection
  ADR-676 gives lasts for the whole job, so Job Review and the connect notice stay right.
- A Marlin Abort or Disconnect puts its stop lines on the wire within a message round trip,
  whatever backlog the window has. The stop's notice and the stream's freeze still wait for that
  backlog. This replaces the Consequences line "Each Marlin Abort and Disconnect waits for one
  worker handshake before its stop lines".
- The stop lines are posted together, so a broken transport reports each line that failed.
  Before, the first failure stopped the rest.
- The release handshake's 2 s deadline is unchanged. A silent worker still closes the transport,
  but the stop lines were posted to it first.
- **Not changed (follow-ups):**
  - N1-P3-1: the 90 s acknowledgement-hold containment still freezes before it takes the refill
    back.
  - N1-P3-2: Job Review's route advice for a worker that could not start, and the warning order.

### Verification

- `in-window-stall-beam.thread.test.ts` gains two cases, by the audit's method. Its harness moved
  to `__fixtures__/controllers/stall-thread-harness.ts`. The FIFO Marlin model now echoes a line
  that starts with no G, M or T (parser.cpp L266, gcode.cpp L1119-L1122).
  - **Corrupted line, fan dialect, USB worker.** The 20th `G1` reaches Marlin without its `G`.
    Result: one echo; `jobStreamHost` stays `worker`; the window writes no job line; every other
    line arrives once and in order. A 1.6 s block leaves the head lit 0 ms. On main's code the
    window wrote 341 job lines after the echo, and the head was lit 1,285-1,417 ms (two runs).
  - **Abort straight after a 1.6 s block, fan dialect, 4 ms of window time per forwarded line.**
    `M107` reaches the controller 2 ms after the block (main's code: 499 ms, behind the backlog).
    The head is lit 4-6 ms after the block (main's code: 162 ms). That residue is the model's
    timer step: `M410` stops the planner when it is read (queue.cpp L538-L545), and `M107`, read
    just before it, runs on the model's next service tick. No job move follows `M410`, and the
    ledger settles.
- `serial-worker-core.marlin.test.ts`: an echo that names the line in flight hands the refill
  back. An echo of any other text keeps it, and the worker refills on the `ok`.
- `laser-job-stop-write-race.test.ts` and `laser-disconnect-hosted-handback.test.ts`: the stop
  lines are written before the release resolves, and the stream keeps stepping until it does.
  The worker's line and each stop line then settle their own ledger.
- Each new or changed case fails on main's code.
- **Not verified:** hardware, and a real Chromium renderer's per-line cost.
