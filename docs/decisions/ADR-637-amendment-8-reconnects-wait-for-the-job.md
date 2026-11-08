## ADR-637 Amendment 8 - The driver-swapping reconnects wait while a job runs

**Status:** Accepted (rolling audit v10, area V3, finding V3-P2-1, confirmed by an independent
refuter; the maintainer's standing instruction to fix confirmed audit findings). Amends Amendment 6
Decisions 2 and 3. It adds no Start guard (rule 7 / ADR-228) and writes no controller setting. |
**Date:** 2026-11-08

### Context

- Amendment 6 Decision 1 lets Save's driver switch run "only when nothing is in flight: no job, no
  motion or controller operation". `saveDriverSwitchBlocker` refuses an active job with "a job is
  running".
- The same reconnect has two more entry points: the toolbar's **Reconnect now** (Decision 3), which
  Save's deferred toast points at, and Machine Setup step 1's **Reconnect using selected profile**.
  Neither checked the job. The toolbar's button stayed enabled during a burn as the only primary
  button in the toolbar, with the hover "Close the port and reconnect with this machine profile's
  commands. Nothing moves."
- Closing a GRBL-family port soft-resets the controller first (`laser-disconnect-stop.ts`). In the
  audit's simulator run, pressing the button mid-job sent the reset, ended the job at line 36 of 47
  and reconnected with the new driver. Save's own deferral (Sleep after Release motors, Hold, Jog,
  an operation) leaves the mismatch notice up, and Start does not block on it, so a job can run
  under the notice.
- Ctrl+K's Disconnect is disabled while the machine is busy, and Forget Controller refuses during
  a job.

### Decision

1. **Both reconnects refuse while a job is active.** `reconnect-job-guard.ts` holds the check:
   `reconnectJobBlocker` returns Save's own reason, "a job is running", for every state
   `isActiveJob` covers (streaming, paused, tool change, and a done or errored stream still
   settling). `saveDriverSwitchBlocker` uses it, so all three routes name the job the same way.
2. **The buttons say why.** While a job is active the toolbar's **Reconnect now** and step 1's
   **Reconnect using selected profile** are disabled with the hover "Not while a job is running:
   reconnecting resets the controller, which would end the job. Let the job finish or stop it,
   then reconnect." The toolbar's "Nothing moves" hover shows only while the button can run.
3. **The actions refuse too.** `reconnectWithSavedProfile` (the toolbar) and step 1's reconnect
   and Find's follow-up reconnect call `assertReconnectAllowed` before closing the port, so a click
   that races the render is refused with a toast instead of resetting the controller.
4. **The operator's own Disconnect and "Use a different port…" are unchanged.** They are how an
   operator ends a session on purpose, they promise nothing about the job, and ending a job that
   way is by design (`docs/audits/2026-10-16-controller-reconnect-audit.md`).

### Consequences

- A mismatched driver stays live until the job ends. Job Review's identity warning still names it
  at Start, as before.
- Once the job is over (the streamer is released at Idle) the same buttons reconnect as before.

### Verification

- `reconnect-job-guard.simulator.test.tsx`: on the GRBL simulator with a framed job streaming and
  the profile switched to grblHAL, `reconnectWithSavedProfile` is refused with "a job is running",
  no soft reset reaches the controller and the job keeps streaming; after the job it reconnects
  with the grblHAL driver.
- `ConnectionBar.compact.test.tsx` and `DeviceSetupConnectStep.identity.test.tsx`: both buttons
  are disabled with the job named in the hover.
- No hardware was operated; all controllers are simulated.
