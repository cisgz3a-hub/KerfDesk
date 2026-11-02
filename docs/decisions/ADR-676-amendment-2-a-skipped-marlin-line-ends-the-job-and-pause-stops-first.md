## ADR-676 Amendment 2 - A Marlin line skipped as unknown ends the job whatever the echo says, and Pause sends its beam-off ahead of the handback (2026-11-02)

**Status:** Accepted on 2026-11-02 |
**Amends:** ADR-676 Amendment 1 decision 1 (which echoes hand the refill back) and decision 2 (which
stops go ahead of the handback); applies ADR-395 decision 4 to a line the echo no longer names

### Context

Rolling audit v9 area R1 (`docs/audits/2026-11-02-rolling-v9/R1-fix-marlin-watchdog.md`,
refuter-confirmed) verified Amendment 1 on main. It holds for what it fixed, and two gaps remain.

- **R1-P1-1 (P1).** A Marlin line that lost its first byte was skipped, and the job ran on to `done`
  with no notice.
  - Marlin echoes the bytes it read, then answers `ok` (parser.cpp L133, L266, L390-L392; gcode.cpp
    L1119-L1122 at `1cd56c4c`). A line without `N` has no checksum (queue.cpp L473-L520).
  - The main thread and the worker acted only on an echo that read the same as the line in flight. A
    line that lost a byte can never read the same, so the echo was discarded.
  - A lost `M107` (fan) or `G0 … S0` (inline) burned about 31 mm across the workpiece at power 204.
    With every `G1` corrupted, 360 echoes arrived, nothing burned, and the job still ended `done`.
  - The same byte loss ends a GRBL job (`error:1`). Amendment 1 recorded the skip ("still skipped on
    both transports") but put nothing in front of the operator.
- **R1-P2-1 (P2, PLAUSIBLE).** Marlin Pause awaited the worker's `released` reply before it froze the
  stream and wrote its beam-off.
  - The reply queues behind every line the worker forwarded while the window was busy, and the
    controller can drain and stop lit meanwhile. Amendment 1 fixed this for Abort and Disconnect only.
  - The refuter measured a fan raster lit 24-80 ms at about 1 ms per forwarded line, and estimates
    100-200 ms on a 3 ms raster at ADR-352's 0.4 ms per line. On the fan dialect nothing times the
    dwell out, and the Pause notice does not mention it.

### Decision

1. **An Unknown-command echo during a stream is a skipped job line, whatever its text.**
   - Marlin answers lines in order, and under ping-pong the stream's line in flight is the oldest one
     owed an answer. The `ok` that follows ends the job through the MA-12 path: the stream stops as
     errored, and the stop lines go out with the beam off.
   - **Worker.** It hands the refill back on every such echo while a line is in flight
     (`core/controllers/marlin/hosted-refill.ts`). The text test is gone from this side.
   - **The refill is not silently lost.** This replaces Amendment 1 decision 1's way of protecting
     that: the job now ends, so no job is left streaming on the window with nothing said.
   - **The notice** names what KerfDesk sent and what the controller read, and says a skipped beam-off
     may have burned a line. It does not mention a missing build option, which an echo of the sent text
     still does (MA-12, unchanged).
2. **An echo of a non-job line still owed a reply stays in the log.**
   - The untracked-acknowledgement ledger now holds each write's lines, so the main thread can tell a
     Console query, or a stop line, from a job line. Ownership goes in this order:
     1. An echo that reads as the line in flight is that line.
     2. An echo that reads as a non-job line still owed a reply is that line, and the job runs on.
     3. Anything else is the line in flight.
   - The worker needs no such test. Any line the main thread writes while the worker holds the refill
     retires the refill first, so an echo the worker sees answers a job line.
   - With no line in flight there is nothing to skip, and the echo stays in the log on both sides.
   - **The safe direction is accepted.** A Console line that was itself damaged, or a command the LCD
     injected, reads as nothing KerfDesk owes, so it ends the job.
3. **A stream-side Pause posts its beam-off right behind the release, and freezes after the reply.**
   - With the worker holding the refill, Pause posts `release` and then its beam-off lines before its
     first await. The worker handles the release first, so it writes no job line after them.
   - **The freeze still waits for the reply.** Until then each forwarded `ok` steps this side's stream
     as it stepped the worker's, so Pause freezes at the line where the worker stopped. Nothing is sent
     twice or skipped on Resume, and a job line's reply cannot settle a beam-off (audit F1).
   - **Which lines.** The stream's position is not known until the reply, so the beam-off covers every
     position from the window's own onward (`streamPauseOffLinesFrom`): `M107` if a fan is held or any
     later line lights one, `M5 I` likewise for an inline beam. A line too many costs one `ok`. Resume
     still re-arms only what the final position holds.
   - The notice names the lines actually sent. Resume still waits for their replies.
   - **Unchanged.** A GRBL-family Pause awaits the release before its door byte, with its timing exact.
     With the window streaming, Pause freezes first and writes what its position needs.

### Consequences

- A job on which Marlin reports a skipped line stops at that line, on both transports and both
  dialects, and the operator is told. A job that would have ended `done` with a stray LCD echo now
  stops; that is the safe direction, and no such echo has been measured.
- **This closes the skipped-line case only.** Most single-byte losses give no echo: `S204` to `S20`,
  `M106 S204` to `M106 204` (full power), `M107` to `M17`. Design audit D-3 (line numbers and
  checksums) remains the whole fix.
- **A skip during a window stall.** The worker hands back at once and the job's stop waits for the
  window, so the head can stop lit for the rest of the stall. That is what an `Error:` line does there
  too. Refilling on would be worse: the next lines run without the one Marlin skipped.
- A Marlin Pause puts its beam-off on the wire within a message round trip, whatever backlog the window
  has. The freeze and the notice still wait for that backlog. Up to one extra `M107` or `M5 I` can go
  out, and Resume waits for its reply.
- **Checked, not changed.**
  - Tool change: Marlin reaches it with the refill already handed back or handing back, and the off
    lines are empty for a job with no fan or inline beam, so a Pause there posts nothing early.
  - The 90 s hold containment (N1-P3-1) needs no reordering for this: it writes its stop lines at once,
    and the first one retires the worker's refill. It still freezes before it takes the refill back, so
    its ledger can be one reply off when the hold fires with a backlog. That stays a follow-up.
  - N1-P3-2 stays a follow-up.
- **Not fixed here.** A GRBL-family Pause still sends its door byte behind the same backlog. It was not
  raised by the audit and has not been measured.

### Verification

- `in-window-stall-beam.thread.test.ts`, by the audit's method (real store, production worker on its
  own thread, Marlin FIFO model). Each new case fails on main's code.
  - **Skipped line, on the USB worker and the window transport.** A two-cut job on both dialects, with
    the beam-off or every `G1` losing its first byte, ends `errored` with a `controller-error` notice
    naming both texts. `M410` follows, and no job move follows the skipped line. Replaces Amendment 1's
    "keeps the refill through the echo" case. A clean job on the same program still ends `done`.
  - **Pause straight after a 1.6 s block, both dialects, 4 ms of window time per forwarded line.** The
    beam-off reaches the controller less than 100 ms after the block, no job move follows it, and the
    stream freezes at the last line the worker sent. Resume then runs the rest of the job to `done`.
- `laser-pause-hosted-handback.test.ts`: the beam-off is written before the release resolves, for a fan
  the window's position has not reached. A replaced connection gets nothing more. With the window
  streaming, nothing is written early. `laser-paused-completion.test.ts` holds a GRBL-family Pause to
  its exact timing, unchanged.
- `stream-pause-beam.test.ts`: the lines posted cover what `planMarlinStreamPauseBeam` needs at every
  later position of a mixed program.
- `laser-unknown-command.test.ts`: a damaged beam-off or move ends the job. A non-job echo does not. It
  does not excuse the job line in flight or an echo that reads as no line sent.
- `serial-worker-core.marlin.test.ts`: an echo of a damaged line hands back, and one with nothing in
  flight does not.
- **Not verified:** hardware, a real UART corruption rate, a Chromium renderer's per-line cost (which
  decides whether R1-P2-1 is P1), and an LCD-caused echo reaching USB.
