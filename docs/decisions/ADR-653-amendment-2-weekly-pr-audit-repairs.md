# ADR-653 Amendment 2 - Repair the weekly audit's confirmed interpretation and document gaps

**Status:** Accepted for implementation by the maintainer's 2026-10-22 request to fix all 20 findings, audit the fixes again and create a PR. This adds no merge, release or hardware permission.

## Decision

- Stock GRBL review models known rejected blocks atomically: rejected values, commands and arc geometry in the active G17/G18/G19 plane cannot change the reviewed modes, tool state or position. Arc acceptance follows stock GRBL's absolute and relative radius criteria. Geometry checks use only axes whose work position is known; displaced or unknown axes cannot prove rejection. This preserves the plane support in ADR-630 Amendment 2. Build-dependent commands and unsupported placement disclose uncertainty. The original executable remains unchanged, and warnings explain that later buffered lines can run after an error. This is bounded interpretation, not a complete firmware validator or a new Start gate.
- Marlin fan selectors are validated before fan-zero projection. Repeated, spaced or lowercase selectors disclose ambiguity rather than proving laser-off. External-program timing uses the connected controller override in both laser and CNC contexts. Unsupported G10 variants keep an explicit review warning.
- Canvas numbering retains history-free placement and output-scope changes in its rollback snapshot, including changes following acknowledged origin operations. Save finishes the visible numbering interaction before any asynchronous picker or write. A failed save remains dirty. Commit-time font limits throw through the existing insertion guard so the text editor retains its draft.
- Weld calls a source absorbed only when its complete contribution is covered by other sources in the same operation/settings batch. A bridge that contributes even a small region survives. Closed offset rings are classified as strokes only when collinear; zero signed area alone does not erase self-intersecting filled lobes.
- Jig Save validates the combined scene against the canonical persistence budgets and integrity rules before publishing it. A conflict keeps the draft open. Aspect-locked corner resizing follows proportional pointer travel on either axis. Tiny selected jig artwork retains an interior move target.
- Material-test cells show their generated physical proportions. Matrix spacing stays schematic to keep labels readable and is explicitly labelled as such.
- Asynchronous photo loads belong to a dialog request: an older success or error cannot overwrite a newer photo, outline or size. This repair is applied to the existing photo feature PR, without importing that entire feature into main.
- A missing macOS/Linux update feed after a verified candidate is a failed check. It cannot report up-to-date. The verified candidate is retained for recovery and download remains unavailable until a successful recheck.

The related controller design audit is corrected, including Idle acknowledgement timing, missing-response ambiguity, Marlin resend acknowledgement ownership and boot-lock inference. Those proposals remain documentation; no new controller recovery protocol is implemented.

The obsolete no-Free desktop website proposal is closed. Deployment credentials belong to the main-only production environment under ADR-651; the remediation ledger records live migration separately from source checks.

## Evidence and boundaries

See [the 20-finding remediation ledger](../audits/2026-10-22-weekly-pr-remediation.md) for repairs, independent re-review and verification. Primary firmware references are the [pinned stock GRBL parser](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c), [GRBL interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface), [Marlin parser](https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/parser.h) and [Marlin queue](https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp). The implementation is independently expressed; no upstream code is copied.

Frame remains the sole ordinary Start policy gate. Software tests and browser checks do not qualify physical controllers, air cuts, materials, installers or a deployment.
