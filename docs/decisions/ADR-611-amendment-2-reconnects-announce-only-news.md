## ADR-611 Amendment 2 - A reconnect announces only news, in machine words (2026-10-20)

**Status:** Accepted by the maintainer's request to implement the controller
behaviour audit. **Date:** 2026-10-20.

The controller behaviour audit (`docs/audits/2026-10-19-controller-behaviour-audit.md`,
F-5 and F-9) found two gaps left after ADR-611. A connect still ended with an
8 s "Machine settings detected" toast after every successful `$$` read, so a
machine power-cycled per job with auto-connect on repeated it every time, even
when the read found nothing new. While the read ran, the status line already
said "Connected", and the only sign of progress was inside Controller info.
The failed-read titles named an internal check: "Controller information
unavailable" and "Controller connection needs recovery" read like a hardware
fault.

### Decision

- While a connected controller's settings are read, the status line beside the
  dot reads **Connecting…** (waiting for its first reply) and then **Reading
  settings…** (after a reset, and while `$$` runs), with an amber dot. It turns
  to **Connected** when the read ends, whether it succeeded or failed. No
  notice announces these phases; the recovery card over the canvas (ADR-642)
  still opens only for a failed read on a controller that stopped answering.
- The "Machine settings detected" toast appears when the read offers profile
  updates (a detected value differs from the profile), or when its review
  items (homing and limit settings, unknown settings) differ from the last read
  announced for this machine profile in this run. The record lives in memory,
  keyed by the device profile signature, so a reload or another profile
  confirms its first read again. Machine Setup still shows every read.
- Titles say what happened to the machine. A failed read reads **Couldn’t read
  machine settings**; a controller that stopped answering reads **Machine
  stopped answering**, on the canvas recovery card, its folded button and in
  Controller info. The detail text, Retry and Reconnect are unchanged, and
  Reconnect is still offered whenever `controllerReconnectRecommended` holds.

### Evidence and limits

`ConnectionBar-info-recovery.test.tsx` and `WorkspaceControllerRecovery.test.tsx`
pin the phase status text and the new
titles; `MachineConnectionToolbar.test.tsx` pins the toast rule (an unchanged
reconnect stays quiet, updates always announce, a new profile confirms once).
Unit-tested only; no machine was operated.
