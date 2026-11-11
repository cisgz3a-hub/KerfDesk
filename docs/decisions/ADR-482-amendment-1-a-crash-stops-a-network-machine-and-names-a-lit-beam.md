## ADR-482 Amendment 1 - A renderer crash stops a network machine first, and the prompt says the beam or spindle may still be on (2026-11-08)

**Status:** Accepted. Amends the crash-reload decision of ADR-482. | **Date:** 2026-11-08

### Context

Rolling audit v11, finding W3-P1-1 (P1, refuter-confirmed;
`docs/audits/2026-11-08-rolling-v11/W3-electron-main-updater.md` on the audit branch; it folds in
rolling v2 04-P3-20 and 04-P3-23).

- A crashed renderer takes every control with it, and the streaming worker dies with it (ADR-354).
  Under M3, with a latched Fire, or with a spindle, a GRBL-family controller runs out its buffered
  moves and then holds the output on one spot.
- The prompt said only that the machine "may still finish moves it already received", which implies
  it then stops, and gave the E-stop only "if the machine may be unsafe".
- Main held a network session's socket and sent nothing on it (ADR-398 Amendment 8).

### Decision

1. **On `render-process-gone`, main first sends a network session its stop** (ADR-398 Amendment 8),
   for every reason and whatever the close guard is doing, then asks as before
   (`installRendererCrashRecovery`'s `stopMachine`, wired in `electron/desktop-renderer-crash.ts`).
2. **The prompt says what happened to the machine, with the E-stop first:**
   - **a network session was stopped:** KerfDesk sent the network machine a reset, then M5 and M9,
     which stops a GRBL, grblHAL or FluidNC controller and turns its laser or spindle off; check that
     it stopped, and use the physical E-stop or power cutoff now if the beam or spindle is still on;
   - **otherwise (USB):** if a job, Fire or the laser was running, the beam or spindle may still be
     on; KerfDesk can send a USB machine nothing now; it runs the moves it already received, and a
     constant-power (M3) laser, a Fire beam or a spindle stays on after them until the controller is
     reset; use the physical E-stop or power cutoff first;
   - then: reload KerfDesk, connect, use Abort or LASER OFF, and see where the job stopped.
3. **Unchanged:** the buttons ("Reload KerfDesk", "Not now"), `clean-exit` and a close attempt get no
   prompt, and the reload itself still sends nothing.

### Consequences

- A stop that throws is reported and the prompt takes the USB wording, which claims nothing was sent.
- Main cannot tell whether a USB job was running when the renderer died, so the USB wording is
  conditional ("if a job, Fire or the laser was running").

### Verification

- `renderer-crash-recovery.test.ts`: the stop runs before the prompt on every exit, including a
  close attempt and `clean-exit`; a throwing stop still asks, with the USB wording; both wordings put
  the E-stop before the reload, and neither says the machine "may still finish".
- `machine-network-crash-stop.test.ts`: the real modules end to end (ADR-398 Amendment 8).
