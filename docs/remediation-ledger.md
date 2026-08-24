# Last-100-PR audit remediation ledger

Implementation branch: `codex/pr100-remediation`.

Source audit: `C:\Users\Asus\KerfDesk-pr-audits\2026-08-23-221807\audit-findings.md`.

This ledger is the single integration record for the 13 active findings. It does
not authorize a new guard: Frame remains the only guard, and policy concerns stay
warnings in Job Review.

| Finding | Remediation | Status | Verification |
|---|---|---|---|
| AUD-100-001 | Preserve an existing G-code target when preparation fails | implemented | web destination-reservation and file-action regressions pass; disposable native-picker qualification was attempted but the Windows automation helper could not start |
| AUD-100-002 | Re-land sub-cell cutter-position stamping | verified | exact sub-cell regression cases and simulator suite pass |
| AUD-100-003 | Ignore hidden engraving tip-flat state for other tool kinds | verified | Add CNC bit form suite passes |
| AUD-100-004 | Align V-carve AABB filtering with tolerant intersection domain | verified | near-endpoint deterministic regression passes |
| AUD-100-005 | Re-land material-library streaming on current main | verified | streamed material and SVG import suites pass |
| AUD-100-007 | Use the visible `Traced edges` term in the accessible name | verified | DOM accessible-name regression passes |
| AUD-100-008 | Move autosave session/clear state out of mutable module globals | verified | autosave suite passes with session-scoped generation state |
| AUD-100-009 | Reconcile the orphan wood viewer with current main | superseded | current main already carries the later carved-wood material and shader architecture; obsolete standalone replacement was not reintroduced |
| AUD-100-010 | Keep the open-path note scoped to its layer | verified | layer clarity suite passes |
| AUD-100-011 | Use deterministic casing for fixed-English tooltip copy | verified | fixed-English implementation and TypeScript verification pass |
| AUD-100-012 | Replace obsolete Start-blocking probe copy with warning truth | verified | reminder-only notice and readiness-policy suites pass |
| AUD-100-013 | Replace custom-bit deletion refusal with assignment reset | verified | library UI/store action regressions pass |
| AUD-100-014 | Preserve every positive Stepover value through planners | verified | 1%, 40%, and 200% pocket/rest/surfacing/relief cases pass |

## Integration rules

- Preserve unrelated user work in `C:\Users\Asus\LaserForge-2.0`.
- One implementation owner and one remediation branch.
- Donor PRs are evidence; every orphaned change is reconciled onto current main.
- Focused tests and `pnpm release:check` must pass before merge or deployment; both passed on this branch before handoff.
- Hardware and native-picker qualification are reported separately from code tests.
