# Tracing audit and accepted remediation batches

The eight-stage tracing audit is complete. It identified 20 confirmed defects across presets, settings, geometry, document lifetime, fill, preview and worker responsiveness. [The portable audit report](report.md) records the original findings, strengths, primary research and evidence limits.

This branch contains seven verified parent fixes and the separately verified native-worker queue portion of TR-020. The cooperative fallback portion of TR-020 and the other 12 parent findings remain in the managed remediation sequence. The branch is a draft while that work and current-main reconciliation continue.

| Finding             | Included behavior                                                                                 | Commit         |
| ------------------- | ------------------------------------------------------------------------------------------------- | -------------- |
| TR-013              | Ignore completed work after its trace session closes or its document changes.                     | `84d6cf2cdf75` |
| TR-014              | Use the applied image revision when tracing a page-backed image.                                  | `b6d8e863cd65` |
| TR-012              | Import a camera trace atomically with the correct source lifetime.                                | `07606c00f75e` |
| TR-017              | Prepare overlapping Follow Shape regions without depending on contour start vertices.             | `da23ceef6e00` |
| TR-018              | Keep constituent text counters and cross-object fill semantics stable when operations are shared. | `335d5fb5086d` |
| TR-019              | Use effective raster object settings and retain ownership of asynchronous preview requests.       | `013e1bad8bf8` |
| TR-016              | Settle empty or failed preview work and reuse an already prepared successful trace.               | `ac880230df16` |
| TR-020 / QUEUE only | Retire obsolete native worker requests while retaining healthy-worker reuse.                      | `8b297e83e163` |

## Source and publication boundary

The accepted changes were audited and implemented against <code>9209fcb33f4807ebfc1f7a55780069b6a7b0e23c</code>. Each commit reproduces a hash-verified accepted patch and is confined to its recorded product paths. The publication snapshot has 47 distinct changed product paths. The original checkout's 11 unrelated tracked edits and four unrelated source additions are excluded.

The publication checkout is separate from the still-active implementation checkout. It contains no unfinished INLINE changes. At publication preparation, current main was <code>c07cea275149832909d46f21c4dd7ec74d634f4a</code>; 12 of the seven parent fixes' 44 distinct paths had changed upstream. A three-way dry check reported conflicts in nine paths. Current-main reconciliation is required before this draft can be considered ready. No merge, deployment or machine operation is part of this publication.

## Verification

The accepted local sequence includes 601 distinct repository tests across 82 files plus two external ownership checks. Its browser evidence covers actual native workers, terminal preview settlement, prepared-result reuse, camera and document lifetime, generated raster pixels, fill geometry and software output. Counts and limits belong to their recorded runs; they are not additional tests performed by copying these commits.

Fresh verification of this publication checkout passed all 601 selected repository tests across 82 files with one worker, full TypeScript checking, and ESLint and formatting checks for all 47 changed product paths. The eight-commit product HEAD and all 47 source hashes remained unchanged during those checks. The earlier implementation typecheck had one inherited STL fixture diagnostic; that unrelated fixture is absent here. Hosted CI, current-main reconciliation, a production or packaged runtime, original-image fidelity and hardware qualification remain separate. The supplied screenshot was UI evidence; the original <code>213501.jpg</code> was not supplied.

## Evidence retained locally

Only this README, the portable authored report and its provenance manifest are included as audit documentation. The full evidence corpus remains in the original local audit directory, including fixtures, exhaustive oracle outputs, failed attempts, source fingerprints, browser traces and screenshots. Browser profiles, Vite caches, generated bulk logs and build outputs are deliberately excluded from Git. They have not been deleted or treated as committed work.

The portable report converts local evidence links to explicit identifiers and retains external primary-source links. Its source document is unchanged in the audit corpus. The provenance manifest records the source hash, adapted report hash and local reference identifiers. Focused regression tests are committed alongside the affected product code.

## Remaining work

Complete and independently verify TR-020/INLINE, then continue the remaining tracing fixes in the recorded order. Reconcile the accepted commit sequence with current main, run the resulting integration and static checks, verify the relevant rendered behavior, and monitor the PR checks before marking this draft ready. A successful software check does not qualify a physical machine or authorize deployment.
