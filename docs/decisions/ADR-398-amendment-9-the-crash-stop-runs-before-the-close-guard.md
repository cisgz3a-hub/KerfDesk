## ADR-398 Amendment 9 - The crash stop runs before the close guard's box, and reports only resets written (2026-11-09)

**Status:** Accepted. Corrects Amendment 8 Decision 2 (the order it promised) and its count.
| **Date:** 2026-11-09

### Context

Rolling audit v12, findings X1-P2-1 (P2) and X1-P3-1 (P3), both refuter-confirmed
(`docs/audits/2026-11-09-rolling-v12/X1-fix-job-safety.md`, PR #1642).

- **X1-P2-1: the order.** Amendment 8 sends the stop on `render-process-gone` "before the close guard is
  asked anything". But `main.ts` installs the close guard first, and Node calls a listener in the order it
  was added.
  - When the renderer dies during a close, the guard's listener opens the "App controls unavailable"
    box with `showMessageBoxSync`. That blocks the main thread until the operator answers.
  - The crash stop and the 15 s lease waited behind it. In the refuter's harness the stop went out
    31 ms after a crash with no close under way. During a close it went out 1,098 ms or 2,159 ms
    after the crash, 1 ms after the operator answered the box.
- **X1-P3-1: the count.** `stopAll` returned the number of sessions. A session whose socket had already
  failed stays in the bridge's map until the window's read loop or the lease closes it. Its
  `stopAndClose` writes nothing. The crash prompt still said a reset, `M5` and `M9` had been sent.

### Decision

1. **The crash stop's listener is prepended** (`webContents.prependListener` in
   `installRendererCrashRecovery`), so it runs before every other `render-process-gone` listener,
   whatever order they were installed in.
   - The reset's `socket.write` is issued synchronously inside that listener, so it reaches the OS
     before the guard's box can block the thread.
   - `M5` and `M9` follow the restart banner as before. If the box is open by then, they go out once
     the operator answers it.
2. **The box's E-stop line is an instruction, not a condition**: "If a job, Fire or the laser was
   running, the beam or spindle may still be on: use the physical E-stop or power cutoff first." It
   used to say "if the machine may be unsafe". The same box also opens for an unresponsive renderer.
3. **A stop reports the resets the OS took.**
   - `MachineNetworkSession.stopAndClose` resolves `true` once the reset's write completes, and
     `false` when the session was already closed, the socket was gone, or the write failed or timed
     out (500 ms).
   - `MachineNetworkBridge.stopAll` resolves `{ sessions, sent }`.
   - The crash prompt waits for that report, which is bounded by the write's 500 ms (ADR-482
     Amendment 2).
   - The session-end log says "Sent …" only when the reset was written, and logs that the stop could
     not be sent otherwise.

### Consequences

- The prompt now appears a few milliseconds later, after the reset's write is acknowledged. In the
  worst case, a write that never completes, it appears after 500 ms.
- On a crash during a close, the box still blocks `M5`, `M9` and the graceful close until it is
  answered. The reset itself has gone out, and on GRBL, grblHAL and FluidNC the reset turns the laser
  or spindle off.

### Verification

- `electron/machine-network-crash-during-close.test.ts` wires the real close guard (with its real box
  text, `showMessageBoxSync` mocked), crash recovery and bridge in `main.ts`'s order, against a
  loopback grblHAL controller:
  - when the renderer dies during a close, `Socket.write` has carried `0x18` before the box is
    called, and the controller then receives `0x18`, `M5` and `M9`;
  - the box's text gives the E-stop unconditionally;
  - a session whose controller dropped the connection gets the "could not send" prompt.
  - On `origin/main`'s crash recovery and box text, the first three tests fail.
- `renderer-crash-recovery.test.ts`: the stop runs before a listener added earlier, a rejected stop
  is reported, and the prompt still asks with the USB wording.
- **Not verified:** a real Electron crash during a close, with a real synchronous box; hardware.
