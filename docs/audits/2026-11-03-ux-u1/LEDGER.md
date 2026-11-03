# New-user experience audit U1 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| U1 | Install and first launch | origin/main @ 22dca0a20 (refuter c93fbb3bc; no app, download-page or website change) | [U1-install-first-launch.md](U1-install-first-launch.md) | 13 | 0 | 1 (P2-3 coordinator) | 3 | 9 | 6 |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| U1-P2-3 (P1, coordinator) | U1 | **A returning beginner sees an empty canvas, and their first design can become unreachable.** On return there is no modal, card or toast; the only way back is a 12 px grey "Recover autosave" link in the status bar. A beginner who misses it and draws something new loses the link at once; on the next visit only the newest work is offered, and the first design, though still stored in the browser, cannot be reached from the app. No ADR covers moving the offer from a banner into the status bar (#1137). Raised to P1 by the coordinator: design work silently lost (v7 design rule, METHOD) | **READ** (main): `AutosaveRecoveryControl.tsx:20,39`. Auditor + refuter REPRO (three sessions, fresh profile) | fix card proposed |
| U1-P2-1 | U1 | **In Firefox or Safari, Import, Open and Save fail with "File System Access API is required…", and nothing on the first visit says the browser won't work.** By design there is no fallback (Chromium only), but the only "use Chrome or Edge" text sits in the download page's Preview callout. Drag-and-drop import still works, unannounced. Worse: Ctrl+O on an edited canvas asks to save, Save fails, leaving Cancel or Don't Save | **READ** (main): `web-adapter.ts:1-6`, WORKFLOW F-A9 step 7. Auditor + refuter REPRO (picker functions removed before page scripts; MDN compat v8.1.8) | fix card proposed |
| U1-P2-2 | U1 | **The download page's "Install in three steps" skip the browser's block on the unsigned installer** (Edge: … → Keep → Show more → Keep anyway). Microsoft's documentation quoted verbatim; not run, since downloading was out of bounds | **READ**: download page source; Microsoft documentation (archived link in the report) | fix card proposed |
| U1-P2-4 | U1 | **With no machine connected, Frame job's hover says "Wait for an Idle status report before framing."**, which a beginner cannot act on; the G-code Inspector already says "Connect to the machine first." | **READ** (main): `JobActionControls.tsx:266`, `external-run.ts:63`. Auditor + refuter REPRO | fix card proposed |
