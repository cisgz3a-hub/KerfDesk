# Branch consolidation and worktree audit, 9 October 2026

The maintainer requested an audit of every branch and uncommitted worktree, integration of qualified work into `main`, deletion of other branch names, and removal of merged worktrees to recover disk space. Work that was not qualified for integration was preserved in recovery references and an independent Git bundle.

## Inventory and integration decisions

The audit started at `origin/main` commit `b4333f0ed5145a6620603f3f6b611a700ebea885` with 769 local branches, 335 live remote branches including `main`, and 406 registered worktrees. Two obsolete remote-tracking refs were distinguished from live remote branches. The branch and worktree inventories were refreshed before mutations.

Across 823 distinct committed heads, 539 were already integrated or patch equivalent, 214 conflicted with current main, 55 had unrelated historical roots, 13 were mechanically clean additions, and two earlier repair heads were subsumed by newer open PR work. Mechanical mergeability was not treated as correctness or permission to restore superseded code.

The following eight histories were incorporated into the consolidated main:

| Source | Result |
| --- | --- |
| PR #1119, `afed9991b5f6` | Preserve retained relief v1 compatibility while supporting explicit v2 editing. |
| PR #1114, `bd66985b1999` | Repair saved-owner uncertainty, feedback and autosave ownership. |
| PR #1120, `1d77f81f4f81` | Remove the unused connection card while preserving the production toolbar and accessibility. |
| PR #1122, `15a3191476c7` | Repair factual wire encoding admission, Smoothieware comment handling, settled Abort cleanup and menu Escape handling. |
| PR #1121, `93f2d7eb4259` | Integrate sketch, parametric part, relief and project-sheet repairs. Reconcile relief compatibility disclosure and correct two browser assertions for the revised UI. |
| `2af16042d23e` | Retain dated July audit documents as historical records. |
| `f29214ba2c36` | Retain dated July competitive audit documents as historical records. |
| `483b06ac51b1` | Use a wider, strongly uniform binary ring to resolve otherwise tied tracing saddles. |

The historical documents retain their original dates and do not certify current product, provider, release or hardware state.

The following work remains recoverable and was not presented as completed application behaviour:

| Source | Reason to withhold integration |
| --- | --- |
| Draft PR #1110, `5a0ebf112934` | Viewer performance qualification remains explicitly held. Existing evidence includes a 1,106.9 ms first picker call and 33.3–35.8 ms draw invocation intervals without a comparable whole-app baseline or an uncontended host window. |
| Draft PR #1116, `d16b9590232e` | Release-note claims depend on the held viewer work. |
| Project-library generator, `565964239c1e` | No source consumer implements its catalogue schema; a clean merge does not supply integration. |
| Paused tracer patch archive, `8fdaf72314d3` | Historical patch text needs a fresh source audit before application. |
| Conflicting and unrelated historical heads | Preserve original history; selective forward-porting needs its own reconciliation and verification. |

## Uncommitted work and recovery

The 120 dirty worktrees were audited by changed source identity, test residue, evidence files and operation state. Their dispositions were 38 mixed historical source worktrees, 39 evidence/guidance/probe worktrees, 35 audit/regression residues, three already-main residues and five in-progress Git operations. No additional uncommitted production slice was independently qualified for integration.

Every dirty worktree received a private recovery snapshot, with before/after checks proving that its original working status and index bytes were preserved and the snapshot matched the selected working files. All 120 working-file ZIP archives passed CRC verification. Unfinished merges and cherry-picks retain operation metadata, original indexes and conflict-stage blobs. Generated browser state excluded from snapshots remains in its original retained checkout.

Two concurrent sessions created branches or changed source after the initial inventory. Their licensing and V-carve files received additional verified private snapshots, without changing their indexes or working files. The licensing checkout retry requires further review of an ambiguous prior provider response before discarding its saved request identifier. The V-carve snapshot raises ADR-285's 4,096-sample cap to 16,384, retains unconditional debug logging and supplies benchmarks without correctness assertions. These active snapshots were not qualified for integration. The separate snapshots and review findings retain an exact evidence boundary if those sessions subsequently change their source.

The independent backup directory is `D:\LaserForge-Recovery\branch-consolidation-20261009`. It contains the original all-ref bundle, `complete-recovery.bundle`, dirty-worktree archives, ignored-file archives, manifests and audit evidence. Git verified that the complete bundle records complete history. Recovery references live under `refs/recovery/branch-consolidation-20261009/`; these are private recovery refs, not branch names, and were not pushed.

For example, an archived branch can be inspected through `git log refs/recovery/branch-consolidation-20261009/branches/local/<original-name>`. To restore it for new work, create a branch from that exact ref. The complete bundle and manifests provide an independent restore source if the original repository is unavailable. Dirty-worktree manifests identify snapshot refs, working archives and original index/operation files; restore those into a separate checkout rather than overwriting main.

## Verification and cleanup record

The integration tree passed focused save, relief, controller and UI tests, 219 tracing integration tests, 26 tracing branch/oracle tests, type checking, lint, ADR numbering, a production web bundle and 23 Chrome workflow tests. The tracing oracle included all 65,536 binary 4×4 masks and independent cases across ring sizes, densities and pixel scales. The two repaired browser assertions select the actual canvas and follow the new creation-menu keyboard order.

The full 3,820-file unit run was still executing when this integration candidate was prepared. Four cases in two unchanged source suites exceeded their normal five-second timeout under concurrent system load; an independent one-worker replay passed all 31 cases with unchanged timeout settings. The original run and replay are retained separately.

Cleanup eligibility covers 184 integrated clean worktrees, including 35 with local ignored configuration, assets or receipts to archive first. The 120 original dirty worktrees, 82 unintegrated clean heads, active calling and payment worktrees, and newly concurrent work remain outside that deletion set. Eighteen missing registrations have their metadata archived before pruning. Removal rechecks current HEAD, status, operation markers and protected paths. On Windows, native deletion removes dependency junction entries without traversing their targets. Two application-held empty directories are recorded separately if their roots remain locked.

The final execution ledgers, complete test logs, branch deletion results and disk-space measurements are retained under the independent recovery directory's audit evidence. This document records the integration decision rather than predicting the outcome of operations still running when the candidate was prepared. Local source, test and browser evidence is separate from hosted CI, packaging, publication, commerce-provider state and hardware qualification. This audit performs no manual deployment, provider change or hardware operation.
