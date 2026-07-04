# Audit Corpus Index

This directory contains the active audit trackers, historical audit reports,
evidence captures, prompts, and helper scripts for LaserForge-2.0 / KerfDesk.

## Current Active Audit

| File | Purpose |
|---|---|
| `REPOSITORY-SECTOR-ARCHITECTURE-2026-07-03.md` | Sector map and repository architecture overview for the 2026-07-03 whole-repo audit. |
| `REPOSITORY-SECTOR-AUDIT-2026-07-03.md` | Main finding ledger, pass log, and after-fix audit record. Treat this as the current source for open and fixed audit findings. |
| `REPOSITORY-SECTOR-PROGRESS-2026-07-03.md` | Memory/progress tracker for completed sectors, fix phases, counts, and next steps. |

## Subdirectories

| Path | Contents | Notes |
|---|---|---|
| `evidence/` | Captured outputs and supporting artifacts. | Evidence can be date- and command-specific; check the linked report before treating it as current. |
| `external/` | External reference snapshots. | Prefer primary upstream docs when refreshing old claims. |
| `findings/` | Structured findings files from prior audit runs. | Historical unless explicitly revalidated in the current active audit. |
| `fixtures/` | Audit-only fixtures. | Test-owned fixtures should live under `src/__fixtures__` unless a finding documents otherwise. |
| `prompts/` | Saved audit prompts and loop instructions. | Useful for reproducing audit method, not proof of current behavior. |
| `reports/` | Dated deep-dive reports. | May contain resolved or superseded findings; cross-check against the active audit ledger. |
| `scripts/` | Audit helper scripts. | Keep helpers read-only unless a fix phase explicitly updates them. |

## Navigation Rules

1. Start with the current active audit files above when deciding what is open.
2. Use dated reports as evidence trails, not as the latest verdict.
3. When a report and the active audit disagree, verify the current checkout and update the active audit/progress files.
4. Keep new audit outputs dated and scoped so future passes can tell current evidence from historical context.
