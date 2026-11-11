## ADR-398 Amendment 8 - Main sends the stop itself when no window can: a crash, the lease, the quit and a refused write (2026-11-08)

**Status:** Accepted. Extends Amendments 6 and 7 to the network closes the window takes no part in.
| **Date:** 2026-11-08

### Context

Rolling audit v11, finding W3-P1-1 (P1, refuter-confirmed;
`docs/audits/2026-11-08-rolling-v11/W3-electron-main-updater.md` on the audit branch).

- **Since #1534 every route on which the window closes a network session waits for the store's
  stop first** (Amendment 7). The closes the main process makes on its own did not:
  - **a crashed renderer.** Main kept the live socket, wrote nothing on it, and refused Connect
    ("Disconnect the current network session before opening another.") until its 15 s lease ran out;
  - **the lease** then destroyed the socket, still with no stop;
  - **`dispose()`**, which `will-quit` runs after a forced close, destroyed it within 1 ms;
  - **the session itself**, on an out-of-order write (R1-P3-1 part 2), on an overfull receive queue
    and on invalid Telnet framing.
- **Closing the socket stops nothing** on grblHAL or FluidNC (pinned in Amendment 7). Under M3, with
  a latched Fire, or with a spindle, the controller then keeps the output on after its last move,
  with no timeout (`src/core/gcode/stopped-head-power.ts`).
- The refuter's Node repro with the real bridge, crash recovery and session-end guard measured
  `bytesFromMainAfterCrash: 0` and a socket closed 14,802 ms after the crash.

### Decision

1. **Main writes the stop Disconnect writes** (`machine-network-session.ts` `stopAndClose`). Both
   channels main supports reach a GRBL-family controller (grblHAL raw TCP, FluidNC Telnet), so the
   stop is the same as the store's for that family (`laser-disconnect-stop.ts`):
   - the realtime reset `0x18` at once;
   - then `M5` and `M9` once the controller's restart banner arrives ("Grbl…", which covers GRBL,
     grblHAL and FluidNC), or after 500 ms, the store's banner wait. The reset clears the
     controller's receive buffer, so lines written with it can be lost;
   - then a graceful end of the socket, destroyed when the controller closes its side or after 1 s.
     Destroying it at once resets the connection, and a TCP reset can make the controller's side
     drop bytes it has not read.
   - Every wait is bounded; a controller that never answers still gets `M5` and `M9`, and the socket
     is gone within about 2.5 s.
2. **Where it applies:**
   - **the renderer gone** (`render-process-gone`, every reason, before the reload prompt and before
     the close guard is asked anything; ADR-482 Amendment 1). The session is released at once, so
     Connect after Reload is not refused; an `open` waits for a stop still going out;
   - **the lease**, when nobody has read the session for 15 s;
   - **`dispose()` on `will-quit`** and **Windows ending the session** (ADR-548 Amendment 2), where the
     process can end straight away. There the reset, `M5` and `M9` go in one synchronous write, then
     the graceful end;
   - **a refused out-of-order write, an overfull receive queue and invalid framing.** The window still
     reads the session closed at once, with the same error.
3. **Not changed:**
   - **The window's own Close** sends nothing more: the store's stop (Amendments 6 and 7) came first.
   - **A full write queue, a failed write and a lost socket** close with no stop: the socket cannot
     carry one.
   - **USB.** The port belongs to the renderer's Web Serial connection; main has no handle on it.
     Opening the port from main after a crash was not adopted: it would add a native serial stack
     beside Chromium's, bypass the operator's port grant, and on an Arduino-class board its own DTR
     edge resets the controller anyway, which is what the next Connect already does. The crash
     prompt names the E-stop first instead (ADR-482 Amendment 1).

### Consequences

- **A reset can lose position.** It is what Abort and Disconnect already send, and the next session
  steps back over the planner after every reset and app restart (Amendment 5).
- **An idle network session is reset when the app quits or its renderer goes.** Disconnect already
  resets a GRBL-family controller every time, so this matches it.
- **A feed hold first was not adopted.** It would keep the beam or spindle on while the head
  decelerates, and main would have to read status reports to know when the hold ended. The store's
  own containment is a reset too.

### Verification

- `electron/machine-network-crash-stop.test.ts`: the real bridge, crash recovery and session-end
  guard against a loopback controller that answers a reset with its banner, on grblHAL raw TCP and
  FluidNC Telnet. After a crash, the controller reads the job, then `0x18`, its own banner, `M5` and
  `M9`, and only then the end of the socket; the old session is gone and a new Connect opens. The same
  order for the lease (fake clock, nothing at 14,999 ms), a refused out-of-order write, and with a
  close attempt under way. `dispose()` writes `0x18`, `M5` and `M9` before the end. A silent
  controller still gets `M5` and `M9` within the bounds. The window's own Close sends nothing.
- `machine-network-bridge.test.ts`: the refused replay is never sent; the stop is.
- **Not verified:** hardware; the physical M3 or Fire hold; a real Electron renderer crash (the event
  was emitted on a stand-in window).
