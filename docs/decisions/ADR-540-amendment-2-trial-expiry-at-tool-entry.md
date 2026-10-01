## ADR-540 Amendment 2 - The trial ends for new Pro tool choices after 30 days (2026-09-30)

**Status:** Implemented in source; publication follows the desktop release process | **Date:** 2026-09-30 | **Amends:** ADR-540 item 4 for trials

### Context

The owner explicitly requested a 30-day desktop Pro trial without buying first,
limited to one computer and protected against repeated trials on that computer.
The server already retains the original trial expiry for each Windows installation
identity. However, ADR-540's session grace allowed a trial user to keep choosing
new Pro tools indefinitely by leaving the app open.

### Decision

1. Starting a trial requires an online grant, with no purchase or licence key.
   The original server expiry remains 30 days after the first start for that
   device identity; reinstalling the app does not create another trial.
2. A trial session cannot authorize a new Pro tool choice at or after its expiry.
   Runtime and renderer checks retire stale trial access, including when a window
   resumes after its timer was suspended. Trial clock-error protection still
   applies. Paid and developer licence rights are unchanged.
3. Expiry does not close an open tool, remove existing project operations, stop a
   job or gate Preview, estimates, Frame, Start, Save G-code or machine control.
   The existing tool-entry check is the only entitlement gate.
4. The device identity is the Windows installation identity, not hardware
   attestation. Ordinary app reinstall and profile deletion do not renew the
   server trial. A changed Windows identity, restored VM state or modified client
   remains outside an absolute same-physical-computer guarantee.

### Consequences

The trial portion of ADR-540 item 4 is superseded. The browser stays Free. These
repairs need a new desktop release before they protect an already installed app;
publishing a PR or updating only the licensing service does not update that app.

An open window retains an observed expiry even if the wall clock moves backwards.
After correcting an incorrectly fast clock, a still-valid trial may require an
app restart to recover in the renderer. A paid activation remains available.
