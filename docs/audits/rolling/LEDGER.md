# Rolling audit ledger

One line per 30-minute audit iteration. Areas rotate; pick the least-recently covered.

| When (local) | Tree | Area | Report | P1 | P2 | P3 |
|---|---|---|---|---|---|---|
| 2026-07-17 01:46 | d7125728 | CNC WCS-at-connect (C6, #241) + recovery wire boundary (#242) | [report](2026-07-17-0146-cnc-wcs-connect-recovery.md) | 0 | 1 | 3 |

| 2026-07-17 04:50 | 941dcb66 (main 677e60fe) | CI workflows + policy scripts | [report](2026-07-17-0450-ci-workflow-scripts.md) | 0 | 1 | 3 |
| 2026-07-17 05:15 | cecea01a | SVG importer (parse-path-d + flatten-curves) | [report](2026-07-17-0515-svg-importer.md) | 1 | 0 | 2 |
| 2026-07-17 05:50 | 6f4c5a89 | Project persistence (.lf2 round-trip) | [report](2026-07-17-0550-project-persistence.md) | 0 | 1 | 2 |
| 2026-07-17 06:25 | 1705ac41 | G-code laser emitter + preflight boundary | [report](2026-07-17-0625-gcode-laser-emitter.md) | 0 | 1 | 1 |
| 2026-07-17 06:45 | origin/main ed40b6d5 | Docs-vs-code drift (ADR integrity + enforcement claims) | [report](2026-07-17-0645-docs-vs-code-drift.md) | 0 | 0 | 2 |
| 2026-07-17 07:15 | ed40b6d5 (rebased) | Platform adapters (Web Serial + file/camera) | [report](2026-07-17-0715-platform-adapters.md) | 0 | 1 | 1 |
| 2026-07-17 07:45 | ed40b6d5 | Core geometry (clipper boolean/offset seam) | [report](2026-07-17-0745-core-geometry-booleans.md) | 0 | 0 | 3 |
| 2026-07-17 08:15 | ed40b6d5 | Layers panel + visibility/output parity baseline | [report](2026-07-17-0815-layers-panel-parity.md) | 0 | 0 | 1 |
| 2026-07-17 10:10 | origin/main 58cb3ae2 | Job Review Start gate (ADR-224, #259) | [report](2026-07-17-1010-job-review-gate.md) | 0 | 0 | 0 |

**"Fix all" session (08:30–10:05):** every open P1/P2 and 13 of 16 P3s fixed via PRs #262 #263 #264 #265 #267 #268 #269 #271 #272 (plus #260 earlier). Deferred with reasons: audit-level policy (needs a level/override decision), Weld cross-color parity + curve-preserving booleans (need LightBurn reference verification / design), e2e-gates-deploy (new blocking gate — needs explicit ADR-206 approval).

P2-1 (iter 1) fixed via PR #260 (approved "fix", 2026-07-17 04:44). P3-4 addendum added to iter-1 report 04:45 (ackless option dropped by store wiring — found during the fix). Iterations 02:16–04:16 coalesced: the fix task occupied the session.
