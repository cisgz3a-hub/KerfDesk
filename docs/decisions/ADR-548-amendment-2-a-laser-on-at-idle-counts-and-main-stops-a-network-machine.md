## ADR-548 Amendment 2 - A laser left on at Idle counts, and main writes a network machine its stop as the session ends (2026-11-08)

**Status:** Accepted. Amends ADR-548 items 1 and 3. | **Date:** 2026-11-08

### Context

Rolling audit v11, findings W3-P2-1 (P2) and W3-P1-1 (P1), both refuter-confirmed
(`docs/audits/2026-11-08-rolling-v11/W3-electron-main-updater.md` on the audit branch).

- **Item 1 counted "a running job or a latched Fire, the same things the close handoff stops".**
  Since ADR-375 Amendment 9 the close handoff also turns off a laser the controller reports on at
  Idle with nothing here running it (a file that ends without `M5`, a Console `G1 … M3 S…`, any
  `M3 S…` under `$32=0`), and the update close refuses for it. Session end did not count it: the
  report was `{ busy: false }`, Windows was not asked to wait, and no `M5` went out. The beam stayed lit
  on one spot after KerfDesk was gone.
- **Only the window could send the stop**, and Electron ends the process as soon as the
  `session-end` handlers return (Amendment 1). On a network machine the socket belongs to main, which
  can write to it synchronously in that handler.

### Decision

1. **The window counts a laser left on at Idle** (`jobWouldBeCutOff` in
   `src/ui/app/desktop-session-end.ts`, by `unownedControllerOutput`, the close handoff's own test).
   Main is told `{ busy: true }`, so Windows is asked to wait, and when it ends the session anyway the
   window's `bestEffortStop` sends `M5` (or `M5 M9`), as the ordinary close does.
2. **The notices name it:** "while a job runs or the laser is on … Abort it, or use LASER OFF", and
   "KerfDesk is sending Abort or LASER OFF". They still promise nothing (Amendment 1).
3. **When the session ends while the window reports work, main also writes a network session the
   reset, `M5` and `M9` in one synchronous write** (ADR-398 Amendment 8), on `session-end` and on a
   critical `query-session-end`. It is logged to the support log.

### Consequences

- A Windows restart with the laser lit at Idle now waits for the operator, as one during a job does.
- The window's stop and main's may both reach a network machine; a second reset is harmless.
- A USB machine still depends on the window's stop leaving in time (Amendment 1).
- **Not changed:** Frame, Jog, Home and Probe still count as idle (rolling v2 04-P3-21).

### Verification

- `desktop-session-end.test.tsx`: an `A:S` report at Idle on a connected laser reports `{ busy: true }`;
  the `asked` phase sends nothing, the `ending` phase sends `M5`.
- `session-end-guard.test.ts`: main's stop runs on a critical query and on `session-end` while busy,
  never on a query it can delay or when idle.
- `machine-network-crash-stop.test.ts`: with the real guard and bridge, `session-end` while busy
  writes `0x18`, `M5` and `M9` to a loopback controller before the socket ends; an idle session is
  left alone.
- **Not verified:** a real Windows restart with a machine attached.
