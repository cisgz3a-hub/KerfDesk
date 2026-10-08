# Integration with current main

9 October 2026. Branch: `codex/fix-competitor-findings-20261007`. Qualified source checkpoint: `134aeda2e19de083964fa6b6fcc076ff141f1a89`. Integrated main: `2cd5600ac519fadd7095a4367bbd57db1efef70d`.

All ten competitor-derived repairs are carried forward from the [7 October report](REPORT.md). Main was merged into the isolated repair worktree without changing the dirty primary checkout or the original audit. The 7 October full-suite and browser figures remain evidence for their original source checkpoint; this document records the new integration qualification.

## Integration changes

- Retained Boolean results stay visible in open-Fill omission diagnostics but cannot be mutated by Close open paths. Expanding a Boolean result restores ordinary path repair. Mixed selections repair only eligible ordinary paths.
- A review captures its document epoch when it opens. Switching or duplicating sheets cannot redirect an older laser or CNC omission-reveal action, including after a rebuild. Same-document edits and renames remain valid.
- Main's acknowledgement-stall containment now retains the original sender and ACK facts before resetting or replacing Frame state. Repeated containment and non-streaming controls do not add false incidents.
- Owned reset write, reset-information and genuine readiness/debt failures retain their causes. Replaced owners cannot contaminate another connection. Responsive Alarm, Sleep and busy controllers retain main's waiting behaviour. Earlier physical-stop warnings survive cleanup independently of the retained failure history.
- The SVG viewport decision is ADR-574. Main's ADR-570/571 and the other repair owner's reserved ADR-572/573 are preserved.

Frame reuse and each Start's fresh executable review follow ADR-565. Review warnings remain advisory. The proprietary licence matches the current main licence exactly.

## Local verification

| Check | Integration result |
| --- | --- |
| Selected regression suite | 198 files; 2,211 unique tests qualified, no configured skips or unhandled run errors. The combined run passed 2,210 cases; its one remaining fixture was strengthened and passed on a one-case rerun. |
| Integration regressions | 29 new cases cover retained Booleans, document ownership, ACK-stall context and real reset failure/reconnect flows. |
| Source types | Exit 0 at the final source checkpoint. E2E and Electron type checks also pass. |
| Lint and formatting | The full baseline scan found two lint errors, corrected and verified with zero-warning checks on all affected files. Full formatting passed; corrected files were formatted. Electron lint passes. |
| Repository checks | File-size, soft-size, ADR-number, index-export and generated-privacy checks pass. |
| Renderer builds | Browser-Free and desktop builds exit 0, embedding `134aeda2`, version `0.1.3147` and emitter revision `operation-topology-fill-ownership-contour-packets-20261007-v17`. Browser-Free has only Line Art data; desktop has all eight presets. |
| Browser workflows | The fresh 22-case run is in progress at this documentation checkpoint. Its final receipt and the ready PR record completion; no timing budgets were increased. |

The source checkpoint differs from the combined-run checkpoint only in the strengthened timeout fixture. All 95 changed production files under `src`, excluding fixtures and test support, match the qualified source hashes. Subsequent documentation commits do not change those sources.

The initial integration run recorded three test failures: two incomplete scheduler fixtures lacked the real initial diagnostic state, and the equal-text cleanup fixture expected the old timeout wording. Correcting that wording exposed main's intentional preservation of the earlier console SafetyNotice; the final fixture now verifies notice identity, both distinct retained causes, timestamps, close count and late completion. Two new fixture typing issues and the merged disconnect helper's complexity were also corrected. Failed evidence is preserved in `attempt1` and `attempt2`.

[INTEGRATION-EVIDENCE.json](INTEGRATION-EVIDENCE.json) records the source checkpoints, counts and result hashes. Raw logs, the 198-file manifest, build bundles, browser traces and final hosted-check records are retained under `output/competitor-repairs/pr-integration-20261009` in the isolated worktree. The historical 7 October evidence has not been replaced. The local dependency junction and existing Vite cache are reused; local execution does not establish a cold-start performance result.

Hosted CI is followed against the ready PR's exact head. Passing hosted checks and Linux package smoke do not qualify published builds, Windows/macOS installers, provider state, physical machines or material results. This task authorizes a ready PR without merging or deployment.
