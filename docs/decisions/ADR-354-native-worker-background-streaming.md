## ADR-354 - Open the serial port in the worker and restore background refill after Resume (2026-09-23)

**Status:** Accepted. Supersedes ADR-334's window-owned transferred streams, opt-in default,
silent fallback and one-time arm. Hardware qualification remains separate.

### Context

The Falcon operator reports that streaming pauses when Chrome is minimised and resumes when
Chrome is restored. ADR-334 can move the acknowledgement ledger into a worker, but its native
port and stream source/sink algorithms still belong to the window. Transferring those streams
does not remove that scheduling dependency. Its profile flag is also off by default, and Pause
or a tool change releases hosting for the remainder of the job.

A controlled Chrome reproduction blocks the window for two seconds while an independent
controller fixture continues acknowledging. The ordinary path sends one line during the block;
the transferred-stream worker sends none. Opening the simulated port inside the production
native worker removes that dependency. This is browser and software evidence, not a measurement
of USB, firmware or physical motion.

### Decision

1. The user still selects the port with the window's Web Serial picker. For a compatible
   GRBL-family driver, a dedicated worker then obtains the already granted port with
   `navigator.serial.getPorts()` and opens it. The native port, streams, read loop and refill all
   originate in that worker. The existing stream pump and ordered handover protocol remain the
   source of truth for acknowledgements and the single refill writer.
2. Web Serial supplies no transferable port handle or unique physical identifier. The selected
   port must have valid USB vendor/product IDs and be the sole matching granted wrapper in the
   window. The worker independently requires exactly one match, and both sides revalidate before
   open. Missing or ambiguous identity falls back to the exact window-picked port before native
   open is requested. It never chooses arbitrarily among identical adapters.
3. Enumeration, probe and open are bounded. Startup faults before open may use the selected
   window port. Once native open is requested, an error, worker crash or timeout closes that
   attempt and requires reconnect; it cannot silently create another owner. The worker owns
   native close. Forget revokes the original selected permission after transport shutdown.
4. Background streaming is on by default for GRBL-family connections. Explicit `false` remains
   a persistent profile opt-out through machine-profile and project round trips. Marlin and
   Smoothieware retain their existing transport. A requested worker path that cannot be used
   displays a warning to keep KerfDesk visible. Changing the preference requires reconnecting.
5. Confirmed Resume and tool-change Continue send their first resumed window, then re-arm via
   the same ready barrier used by Start. The snapshot remains valid only for the initiating
   connection, write epoch, controller session, stream generation and run; Resume also retains
   its transition token. Continue waits for an outstanding release before consuming its held
   M0. A late ready reply cannot resume a cancelled or replacement run.
6. Stream locks and the native port are released on EOF, disconnect, explicit close and worker
   failure. Close observers are isolated so one throwing subscriber cannot prevent the others
   or transport cleanup. An early closing message bounds unsolicited cleanup even if the
   stream drain or native close never resolves; final closed still acknowledges completed
   cleanup. New writes are refused while closing and pending writes are rejected when
   ownership ends.
7. The transport fixes of ADR-361 hold on this path. A UART line error (framing, parity, break,
   overrun) leaves the port open, so the worker reads on from its own port's fresh readable,
   within the shared recovery budget; it never accepts a window-realm replacement stream.
   Cleanup drains the writer with the bounded close rather than aborting it, so the M5/M9 a
   Disconnect queues last reach the controller before the port closes.

### Consequences and verification

The renderer can stop processing tasks without stopping an armed worker's acknowledgement and
refill loop. UI updates and new operator actions still require the renderer. This does not
promise continuity through browser shutdown, OS sleep, USB disconnection or firmware faults.
The Frame-first contract and controller output are unchanged.

Regression tests cover port identity ambiguity, enumeration and handshake timeouts, open
failure without a second owner, late replies, EOF, crashes, Forget, profile persistence, and
Pause/Resume/Continue ownership. A real Chrome worker test sends 1,000 numbered G-code lines
exactly once in order, refills during a two-second window stall, stops after release, and
resumes after re-arming. The incident verification record is in
`docs/audits/2026-09-23-background-serial.md`.

Primary API references:

- [Web Serial specification](https://wicg.github.io/serial/): worker exposure, granted ports,
  permission identity and native open/close.
- [Chrome Web Serial guide](https://developer.chrome.com/docs/capabilities/serial): the picker
  and previously granted ports.
- [Chromium SerialPort implementation](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/serial/serial_port.cc):
  streams created in the port's owning execution context.
