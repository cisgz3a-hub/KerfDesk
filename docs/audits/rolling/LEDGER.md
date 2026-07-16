# Rolling audit ledger

One line per 30-minute audit iteration. Areas rotate; pick the least-recently covered.

| When (local) | Tree | Area | Report | P1 | P2 | P3 |
|---|---|---|---|---|---|---|
| 2026-07-17 01:46 | d7125728 | CNC WCS-at-connect (C6, #241) + recovery wire boundary (#242) | [report](2026-07-17-0146-cnc-wcs-connect-recovery.md) | 0 | 1 | 3 |

| 2026-07-17 04:50 | 941dcb66 (main 677e60fe) | CI workflows + policy scripts | [report](2026-07-17-0450-ci-workflow-scripts.md) | 0 | 1 | 3 |
| 2026-07-17 05:15 | cecea01a | SVG importer (parse-path-d + flatten-curves) | [report](2026-07-17-0515-svg-importer.md) | 1 | 0 | 2 |

P2-1 (iter 1) fixed via PR #260 (approved "fix", 2026-07-17 04:44). P3-4 addendum added to iter-1 report 04:45 (ackless option dropped by store wiring — found during the fix). Iterations 02:16–04:16 coalesced: the fix task occupied the session.
