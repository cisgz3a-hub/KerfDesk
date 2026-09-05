# F22-1: independent review of existing surfacing remediation

Reviewed [PR #728 — Stream surfacing preparation and save output with cancellation](https://github.com/cisgz3a-hub/KerfDesk/pull/728) at **`47dc5261b20ffca430e9842e1cda0fd1a93914b5`**. Its first-100-PR finding F09 is the same defect as this audit's F22-1. No duplicate surfacing implementation is proposed for integration.

## Independent source conclusion

No confirmed blocker was found for F22-1. The reviewed source removes the accepted row-count × pass-count allocation and renderer freeze from the shipped save path:

- `src/core/cnc/surfacing.ts:75` returns replayable generated lines while retaining captured parameters, original row/depth iteration and exact final-depth text. Existing per-dimension 100,000 iteration limits remain; no new total-output limit is added.
- `src/core/preflight/standalone-cnc-preflight.ts:22` and the invariant scanners consume iterables and retain bounded findings by category. Independent scans replay the source; they do not cache the complete body. Modal Z, arc bounds, finite coordinates, feed/RPM and spindle-clearance checks remain present.
- `src/ui/machine/surfacing-worker-client.ts:15` owns one terminable Worker per save. `surfacing-worker-runtime.ts:8` emits at most 256 body lines per requested chunk. A new chunk is requested only after the writer accepts the previous one.
- `src/ui/machine/save-surfacing-program.ts:87` opens the destination picker during the initiating click, preserving browser activation. No writable transaction opens before preflight and the canonical blocking/advisory partition. This is the PR's single-click flow, not a later ready/save action.
- `src/platform/web/write-save-chunks.ts:3` aborts staged writes before finalization; after irreversible close begins, the UI stops offering cancellation. `src/ui/machine/surfacing-save-write.ts:8` serializes replacement writers. `use-surfacing-save.ts` retires pending requests on replacement, unmount and document-epoch changes.
- Both shipped runtimes receive streamed writers: `src/ui/app/main.tsx:33` derives the Electron adapter from the web adapter. The PR uses `SaveTarget.writeChunks`, with backpressure, rather than accumulating a complete Blob or string.

This review read the implementation and relevant existing tests. It did **not** rerun tests, reproduce browser interactions, inspect raw Chrome artifacts, operate hardware, or modify the PR owner's worktree. In-flight document replacement is supported by the hook's cleanup logic; the inspected panel tests exercise document-driven field reset, not a dedicated pending-export replacement regression.

## Owner-reported verification

The PR description reports 20 focused files / 133 passing tests, plus typecheck, touched-source lint/formatting, file-size/export checks and whitespace checks. It also reports independent comparisons of 300 emitter cases (61,212 lines), 500 modal-preflight cases and 2,000 scanner cases.

The owner reports actual Chrome/Worker checks for saved-byte/provenance parity, picker activation, responsive cancellation of a 100,000-row/99,999-pass request, cancellation during writing, visible finalization and serialized replacement writes without page/request errors. These are **owner-reported results**, not independently reproduced evidence from this lane. Hardware qualification remains outside the evidence.

## Current hosted status

GitHub API status observed **2026-09-05 09:31–09:32 UTC+08:00** for the same reviewed SHA:

| Surface                                                                                                                    | Observed status                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| PR                                                                                                                         | Open; base `main`; GitHub reports mergeable but merge state `BLOCKED` |
| [Chrome UX smoke](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/33935740265/job/101223242877)                       | In progress; no conclusion yet                                        |
| [Lint, typecheck, license, test, build](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/33935740205/job/101223249334) | In progress; no conclusion yet                                        |
| CodeRabbit                                                                                                                 | Success                                                               |

Hosted gates and merge remain outstanding at this observation. This note does not mark F22-1 merged or claim integrated-main verification; the integration owner must refresh the exact head/check state before merging.

## Documentation reconciliation for the integration owner

PR #728 does not change `DECISIONS.md` or `PROJECT.md`; its documentation changes are `WORKFLOW.md` and `docs/remediation-ledger.md`. Those first two files are byte-identical between audited base `ccaa3064` and the reviewed PR head, so no direct textual conflict with the root branch's ADR-316 append/status update is expected from this PR.

ADR-316 clause 6 was reconciled after this review to remove the inaccurate Blob-fallback wording. The reviewed implementation requires streamed `writeChunks`; it contains no Blob fallback. It records an owned cancellable Worker, bounded file chunks with backpressure, immediate destination selection, and preflight before the writable transaction opens.

The root's `PROJECT.md:3` wording about cancellable surfacing export is compatible and needs no surfacing-specific rewrite. Preserve its ADR-316 status/tail update while incorporating the PR's accurate `WORKFLOW.md` flow. Reconcile the two `docs/remediation-ledger.md` additions so F09/F22-1 point to the same PR and recorded merge/check evidence. Only this evidence note was written by the independent reviewer.
