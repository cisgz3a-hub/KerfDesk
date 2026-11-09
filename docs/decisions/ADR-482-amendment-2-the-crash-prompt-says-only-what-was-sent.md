## ADR-482 Amendment 2 - The crash prompt says only what was sent, and the stop comes before any box (2026-11-09)

**Status:** Accepted. Amends Amendment 1 Decisions 1 and 2. | **Date:** 2026-11-09

### Context

Rolling audit v12, findings X1-P2-1 and X1-P3-1
(`docs/audits/2026-11-09-rolling-v12/X1-fix-job-safety.md`). Amendment 1 sent the stop "whatever the
close guard is doing". But the close guard's synchronous box ran first and held the stop back. The
prompt also said a reset had been sent whenever a network session existed, even one whose socket had
already failed.

### Decision

1. **The stop's listener is prepended**, so it runs before the close guard's (ADR-398 Amendment 9).
2. **The prompt waits for the stop's report**, which is bounded, and has three wordings:
   - **the reset was written:** "KerfDesk sent the network machine a reset, which stops a GRBL,
     grblHAL or FluidNC controller and turns its laser or spindle off, and follows it with M5 and M9.
     Check that it stopped." It then gives the E-stop for a beam or spindle still on;
   - **a network session took no reset:** "KerfDesk could not send the network machine a stop: its
     connection had already failed." Then the beam may still be on, and the E-stop or power cutoff
     first;
   - **no network session (USB):** unchanged from Amendment 1.
3. **A stop that throws or rejects** is reported and gets the USB wording, which claims nothing was
   sent.

### Verification

- `renderer-crash-recovery.test.ts` covers the three wordings, the order, and a rejected stop.
- `machine-network-crash-during-close.test.ts` checks the real "sent" and "could not send" cases
  against a loopback controller.
