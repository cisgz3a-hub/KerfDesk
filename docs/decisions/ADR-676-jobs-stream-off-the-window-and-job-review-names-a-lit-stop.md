## ADR-676 - Marlin and network jobs stream off the window, and Job Review names a lit stop where the window still streams (2026-10-28)

**Status:** Accepted. Decisions 1 and 2 amended by Amendment 1 (2026-10-29): a Marlin stop posts
its stop lines right behind the release. Amendment 2 (2026-11-02): every unknown-command echo
with a line in flight hands the refill back and ends the job, and Pause posts its beam-off the
same way. | **Date:** 2026-10-28

Amends ADR-354 decision 4, which kept Marlin on the window transport, and ADR-354 Amendment 1
decision 2, which showed the fallback only in a browser. It carries ADR-398 Decision 1 ("no
planner drain with an M3 beam lit") from the program's own drains to the drains a stalled
transport causes. The two-adapter fallback ADR-552 accepted now gets a warning. The emitted
G-code, the Frame-first Start contract (PROJECT.md non-negotiable 21, ADR-565) and the GRBL-family
USB worker path are unchanged.

### Context

Rolling audit v6 K1 (`docs/audits/2026-10-28-rolling-v6/K1-in-window-stall-beam.md`, three P1s
and one P3, refuter-confirmed) found this mechanism. When the app window refills the stream, any
stall of the window's thread stops the refill. Large edits, Undo and imports all cause such
stalls (J10 measured 0.1-3 s). The controller then runs out of buffered moves: 0.1-0.8 s for
Marlin, 0.03-1 s for GRBL. It stops the head, and the beam keeps the power its last move set.
The firmware rules come from the pinned sources the audit cites:

- **Marlin fan output (`M106`):** it keeps its speed and has no timeout (planner.cpp
  L1388-L1399). On a hung window it stays on until the E-stop (K1-P1-1).
- **Marlin inline cutter (`M3 I`, the Marlin default):** it stays lit until
  `LASER_SAFETY_TIMEOUT_MS`. That is 1 s in stock builds, and there is no limit when a build sets
  0 or omits the define (temperature.cpp L3516-L3521; K1-P1-2).
- **GRBL, grblHAL and FluidNC under M3:** they keep S for the whole stall. Only M4 blocks turn the
  PWM off at an empty buffer (gnea/grbl stepper.c L392-L397; grblHAL gcode.c L4424; FluidNC
  Stepper.cpp L233-L241; K1-P1-3).
- Smoothieware and every M4 path go dark at a stop.

Marlin always streamed from the window: ADR-354's worker pump read only GRBL acknowledgements.
Desktop network sessions (FluidNC telnet, grblHAL raw TCP) also always streamed from the window.
A GRBL-family USB port reaches the window three ways: a missing or duplicate VID/PID, the profile
opt-out, or a worker that cannot start. Nothing warned about the lit stop. The desktop recorded
the fallback only in the Laser log.

Research, per the maintainer's "research what LightBurn does and copy":

- **LaserGRBL** streams from dedicated serial threads. `GrblCore` creates a "Serial TX Thread" and
  a "Serial RX Thread" at the highest thread priority. It counts characters there and marshals UI
  updates back to the window with `BeginInvoke`
  ([GrblCore.cs](https://github.com/arkypita/LaserGRBL/blob/master/LaserGRBL/Core/GrblCore.cs)).
  We read it for its design only; it is GPLv3, and nothing was copied.
- **LightBurn** is closed source, so how it threads its device stream cannot be checked. Its
  documentation defaults GRBL to Variable Power (M4). Constant Power Mode (M3) is an opt-in
  option on GRBL layers
  ([Cut Settings, Shared Settings](https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/SharedSettings/)).
  KerfDesk already follows that default (ADR-257 Amendment 1).

### Decision

1. **Marlin streams from the ADR-354 worker.** Each arm message names the acknowledgement
   grammar, `grbl` or `marlin` (`HostedStreamAcks`), which the store takes from the connection's
   driver when it arms the refill (`HostedStreamRefill.arm`). The open request is unchanged. Under
   Marlin's grammar the worker refills one line on each `ok`, ping-pong, as it already does for
   FluidNC.
   - **Replies that hand the refill back.** Every `Error:`, a skipped move or an unknown command,
     `Resend:`, and a boot banner. The worker hands the refill back before it forwards the line
     (`core/controllers/marlin/hosted-refill.ts`). The main thread then handles the following `ok`
     exactly as on the window transport (MA-12, ADR-395 Amendment 1).
   - **Main-thread writes.** Marlin has no realtime bytes. So any line the main thread writes
     while the worker holds the refill is a stop, cleanup or console line, and the worker
     retires the refill before that write goes out. This is how the GRBL worker treats the reset
     byte.
   - **Smoothieware** stays on the window. Its beam goes dark at every stop, and its replies have
     not been ported to the worker.
2. **A Marlin stop takes the refill back before it changes the stream.** Abort's quickstop and
   Disconnect's beam-off have no reset byte. So they first release the worker's refill
   (`releaseHostedRefillBeforeStop`), as Pause already does (ADR-354 decision 5). While both
   sides' streams still agree, a line the worker sends during that handshake is on the main
   thread's ledger too. Its `ok` therefore cannot settle a stop line's reply (audit F1).
3. **Desktop network sessions stream from a worker.** The desktop adapter opens the session in
   the window, as before. It then offers the session to a worker that the root entry supplies
   (`HostedNetworkSessionOpener`); platform/electron cannot import platform/web.
   - **What the worker does.** It reads and writes the session through the main process's own
     `app://app/api/machine-network/` routes: same-origin requests that pass `trustedAppRequest`
     (`platform/web/network-serial-worker-runtime.ts`). It runs the same serial worker core.
   - **Taking the session.** The worker takes the session only after its own first read succeeds.
     Until then nothing has been read from it. So a worker that cannot reach the route answers
     `network-unavailable`, and the window streams the session itself. A worker that does not
     answer in time fails the connect: its read may still hold the session's one read slot.
   - **After that.** The worker is the session's only reader and writer, and a failure closes the
     connection (ADR-354 decision 3).
4. **The Background streaming preference applies to Marlin and network connections.** The
   Machine Setup row is shown for them. An explicit `false` keeps the window transport, and the
   Laser log records that at connect.
5. **Job Review names a lit stop wherever the window still streams.** The live session records
   who refills its stream (`jobStreamHost`). When that is the window, Job Review reads the exact
   prepared program (`core/gcode/stopped-head-power.ts`). For the first lit move whose power
   would stay on at a stop, it puts one warning first in the list:
   - GRBL under M3: the beam stays on with no timeout, and until the E-stop if the window does not
     recover; the warning offers Dynamic (M4).
   - The Marlin cutter: lit until `LASER_SAFETY_TIMEOUT_MS`, 1 s in stock builds and no limit at 0.
   - The Marlin fan output: lit with no timeout, until the E-stop if the window does not recover.

   It also says how to reach the worker. It is a warning, not a refusal: the transport can still
   deliver the job (ADR-565; AGENTS.md machine policy).
6. **Every host shows the fallback as a notice.** A requested worker that falls back to the
   window raises a warning toast in the desktop app too. In one short clause the toast names the
   lit-stop risk: the stack of toasts is only a few lines tall, and Job Review gives the full
   warning for each job. The desktop toast points to Job Review; a browser's asks to keep KerfDesk
   visible instead. The Laser log line is unchanged.
7. **Not adopted:**
   - Switching M3 output to M4 automatically. It would change the burn, and LightBurn leaves M3 as
     the operator's choice; the warning offers it instead.
   - Refusing constant power on the window transport. That is a policy judgement, not a transport
     fact.
   - Marlin's `M4 I`. It goes dark at a stop, but it derives power from the feed rate, which is not
     GRBL dynamic power (gcode-dialects.ts), so it needs its own decision.
   - A notice after a stall that names the stop. It is left as a follow-up.

### Consequences

- A busy window no longer starves a Marlin USB port with a unique identity, or a desktop network
  session. That covers the default route for each P1. The stall stops UI updates only, as on the
  GRBL-family USB worker.
- The window transport remains for a USB adapter without a unique identity (two identical
  adapters, ADR-552), for a profile that turned the worker off, and for a worker that cannot
  start. Each of these now gets a connect notice and a Job Review warning before Start, for every
  job whose power would stay lit.
- Each Marlin Abort and Disconnect waits for one worker handshake before its stop lines. That is
  normally under a millisecond, and bounded by the 2 s handover deadline, after which the
  transport closes as before.
- A network connect may wait up to about 1 s more while the worker's first read long-polls a
  quiet session.
- A hosted network session's reads and writes no longer run on the window's thread. That is the
  path where rolling audit v6 K2-P2-1 (a renderer read timeout during a long window task) and
  K2-P1-1 (a late reply against the heartbeat) were found. Neither was re-measured here.
- The worker protocol gains `acks` on `arm`, and `HostedStreamRefill.arm` an optional `acks`
  argument. The network worker's messages are new.
  `DesktopMachineConnection` reports `backgroundStreamingUnavailable` only when a worker was
  asked for.

### Verification

- **The refuter's method:** `src/ui/state/in-window-stall-beam.thread.test.ts`. The controller
  model runs on its own `node:worker_threads` thread with the real clock: `marlin-fifo-model.ts`,
  which gains the fan output, or the GRBL simulator with 15 blocks and a 128-byte buffer. The real
  store runs on the test's thread, which a synchronous busy loop blocks 0.7 s into a fine engrave.
  The production worker core or network runtime runs on the controller's thread
  (`__fixtures__/controllers/stall-thread-entry.ts`). In the run measured on 2026-10-28, the beam
  was lit over a stopped head during the block for:

  | Run | Block | Lit over a stopped head |
  |---|---|---|
  | Marlin fan, window (control) | 1,600 ms | 1,334 ms |
  | Marlin inline, window (control) | 1,600 ms | 1,015 ms (the safety timeout) |
  | GRBL Compatible (M3), window (control) | 1,000 ms | 674 ms |
  | Marlin inline, USB worker | 1,600 ms | 0 ms |
  | Marlin fan, USB worker, then Abort | 1,600 ms | 0 ms |
  | grblHAL (M3), desktop network worker | 1,000 ms | 0 ms |

  Each control run also shows Job Review's warning for that kind of stop, read from the live
  session. Each worker run shows none, and its arm named the controller's grammar (`marlin` for
  Marlin, `grbl` for grblHAL). It sends the program to the controller once and in order, and has
  no job move after Abort's `M410`.
- **Unit tests:**
  - `serial-worker-core.marlin.test.ts`: the grammar, the lines that hand the refill back, and
    writes that retire it.
  - `network-serial-worker-runtime.test.ts`: the first-read handshake, numbered writes, a refill
    on `ok`, and close.
  - `stopped-head-power.test.ts`: real GRBL and Marlin emitter output, M4 and dynamic inline left
    unflagged.
  - `window-stream-lit-stop-warnings.test.ts`, `laser-connect-hosted-eligibility.test.ts`,
    `laser-background-streaming-notice.test.ts` and `MachineSetupDialogHost.network.test.tsx`.
- **End to end:** `electron/machine-network-renderer-integration.test.ts` streams a 60-line
  grblHAL job from the network runtime. It goes through the real main-process routes and bridge
  to a real loopback TCP controller, with every line delivered once and in order.
- **Not verified:**
  - Hardware.
  - A Marlin board on the worker in real Chrome.
  - The worker's `fetch` to `app://` inside a packaged desktop build. The scheme is registered
    standard, secure and fetch-capable, and the renderer's CSP allows `connect-src 'self'`. If the
    route is unreachable from the worker, the session falls back to the window with the notice.
