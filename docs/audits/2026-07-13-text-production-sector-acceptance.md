# KerfDesk Text and Variable Data Sector Acceptance

**Date:** 2026-07-13

**Baseline:** `origin/main` at `836ffd6c`

**Candidate stack:** PR #58 + PR #70 + PR #71 + `codex/text-9-sequence-controls`

**Status:** Candidate evidence complete; not yet shipped on `main`

## Verdict

The 2026-07-11 competitive audit rated Text and Variable Data **5.0/10** because the shipped
application had ordinary text but no production-data workflow. The Laser 9 candidate added typed
date, time, serial, CSV, and cut-setting fields; embedded CSV data; deterministic output snapshots;
and advancement only after successful export or completed streaming.

This ticket closes the remaining long-run sequencing gap with bounded record and serial ranges,
configurable step size, forward and reverse wrap, reset, persistence, and direct operator controls.
The stacked candidate now earns **9.1/10** for Text and Variable Data. Shipped `main` remains at the
audit baseline until the stack is merged and rerun there.

## Evidence

| Capability | Evidence | Result |
| --- | --- | --- |
| Typed variable fields | Date, time, serial, CSV, power, speed, and passes tokens | Accepted in PR #58 |
| Self-contained projects | Normalized CSV records and sequence settings persist in `.lf2` | Accepted |
| Shared evaluated output | Preview, frame, estimate, export, and start consume one prepared snapshot | Accepted in PR #58 |
| Safe auto-advance | Successful export/completed stream can advance; failed output and stale jobs cannot | Accepted |
| Bounded production runs | Configurable record Start/End and serial Start/End | Accepted |
| Sequence transport | Previous, Reset, and Next controls with configurable Advance By | Accepted |
| Deterministic wrapping | Forward and reverse wrapping for CSV and optional serial ranges | Accepted |
| Stale-project recovery | Persisted ranges clamp to the embedded CSV; stale current values enter the range predictably | Accepted |
| Long-run stability | 10,000 advances stay inside configured 800-record and 9,000-serial-value ranges | Accepted |
| Undo | Manual next, previous, reset, CSV changes, and sequence changes are undoable state mutations | Accepted |
| Accessibility | Sequence fieldset, named inputs, named wrap toggle, and text buttons | Accepted |
| Real-browser workflow | Import CSV, configure bounds, reset, wrap forward, wrap backward, create text, save, and inspect project | Accepted |

## Verification

- TypeScript: passed.
- Focused ESLint: passed.
- Focused Vitest: **5 files, 27 tests passed**.
- Browser acceptance: bounded variable production workflow passed in Chromium.
- Core sequence stress: **10,000 deterministic advances** passed.
- Full `pnpm release:check`: passed in **420.7 seconds**.

## Why 9.1

The candidate covers the complete practical batch-text loop: define reusable typed fields, embed
source data, select a production range, control serial behavior, preview the current item, advance
manually or only after successful output, wrap predictably, reverse mistakes, reset the run, undo
changes, and reopen the same self-contained project. These are observable workflows with both pure
logic and real-browser gates.

The score remains below the category leader because KerfDesk does not yet offer barcode/QR variable
fields, database-backed live data sources, or a dedicated high-volume label imposition workflow.
Those are breadth gaps rather than correctness gaps in the shipped candidate architecture.

## Score Boundary

- **Shipped `main`: 5.0/10** until the candidate stack merges and passes on `main`.
- **Stacked software candidate: 9.1/10** after the verification above and a green full release gate.
- This rating does not increase Layout/Nesting, Rotary/Camera, CNC, UX, or hardware sectors.
