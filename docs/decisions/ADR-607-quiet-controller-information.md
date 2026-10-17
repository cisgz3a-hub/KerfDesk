## ADR-607 - Controller information stays out of the way unless the controller stops answering (2026-10-17)

**Status:** Accepted. | **Date:** 2026-10-17

Amends the toolbar notice of the compact connection bar (ADR-420 Amendment 2)
and the recovery offer of ADR-212 Amendment 1. Qualification itself, its
read-readiness gates, Retry and Reconnect, and every safety notice are
unchanged.

### Context

The maintainer asked for the controller to behave like LightBurn: no repeated
reconnect or re-read prompts. Every controller reset (Stop, Abort, a reboot)
re-runs the settings read, and each phase of that read briefly announced itself
in the toolbar: "Controller reset detected. Waiting to read controller
settings…", then "Reading controller settings…". A read that failed while the
controller was still answering announced "Controller information unavailable"
or "Controller connection needs recovery" with a Reconnect offer.

None of these states stops the machine. Since the Frame-first contract (ADR-565
and WORKFLOW "Controller qualification"), ordinary Start never gates on
qualification, and missing settings evidence appears in Job Review as a
warning. LightBurn reads settings only when the operator opens Machine
Settings, and announces the connection only when it is lost.

### Decision

- The toolbar's brief notice appears only when the current qualification has
  failed and the connected controller has stopped answering status queries
  (`controllerStoppedResponding`: no fresh status response from this session
  for the existing 8 s window). It reads "Controller is not responding".
- A routine read after a reset, and a failed read on a controller that still
  answers, announce nothing. Their state, the Retry button with its waiting
  reason, and the Reconnect offer when ownership is unresolved remain in
  **More connection options → Controller info**, exactly as before.
- Safety notices, Alarm banners, connection failures and Job Review warnings
  are untouched.

Together with ADR-606, which stops the job-end watchdog from resetting a
controller whose last replies were lost, this removes the resets and pop-ups
that made the controller look as if it kept needing a reconnect.

### Evidence and limits

`ConnectionBar-info-recovery.test.tsx` pins the cases: silent across every
qualifying phase, quiet for a failed read with live replies, announced once
the controller stops answering. The neighbouring tests open Controller info
from the menu. `e2e/controller-recovery-toast.spec.ts` keeps the toolbar-layout
checks and now expects no notice during routine reads. Rendered and
unit-tested only; no machine was operated.
