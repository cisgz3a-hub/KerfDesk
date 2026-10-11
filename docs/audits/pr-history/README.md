# Historical PR audit and repair loop

The maintainer authorised continuing the audit through the complete PR history on 11 October 2026, with **fix → test → commit → push → PR → CI verification** for each repair batch. This ledger records coverage and publication separately. A local fix is not a published PR, and a published PR is not a passing or merged change.

## Working record

- [Current status](STATUS.md) shows publication and CI progress. [Confirmed defects and repairs](FINDINGS.md) provides each trigger, impact and attribution.
- `findings.json` contains every confirmed current defect, its trigger, impact and historical attribution.
- [Historical findings and dispositions](DISPOSITIONS.md) records defects already fixed before this audit, unmerged proposals, documented limitations and investigated candidates without sufficient evidence. `dispositions.json` preserves their reasons and local evidence references; these are not counted as new repairs.
- `repairs.json` maps findings to focused changes, local verification, commit, branch, PR and CI evidence. Three related material-preset defects share one coherent repair.
- `coverage.json` retains the full PR inventory, review scopes and explicit gaps. Historical evidence paths refer to the local audit archive, which includes intentionally failing probes and is not shipped with repair PRs.
- `state.json` records the continuation cursor, partial-review backlog, active ownership, authorisation and completion criteria.
- The initial local archive is `docs/audits/2026-10-11-pr-history/`. Preserve it while reconciling new evidence into this ledger.

## Repeatable procedure

1. Fetch `origin`, inspect the checkout, refresh live PR/CI state and reconcile changes to `origin/main`. Read all review comments on the current repair and tracking PR heads, compare comment IDs with recorded dispositions, and retain unresolved follow-ups regardless of their posting time. A timestamp cutoff alone is not evidence that a comment was handled. Preserve unrelated changes and use isolated publication worktrees. Search existing open repair PRs before creating another one.
2. Finish the current repair batch before starting the next audit batch. Take a bounded chronological slice, and reserve a lane for the oldest unfinished review scope. Do not mark a large checkpoint complete from its title, tests or a sampled subsystem.
3. Divide independent review scopes between agents. One coordinator owns the Git index, integration, findings ledger and publication. Separate the repair author from its reviewer where possible; label self-review accurately.
4. Trace suspected historical flaws to current code. Reproduce substantive bugs, retain a passing control and record their actual introduction when later descendants caused them. Distinguish current defects, resolved defects, unmerged proposals and documented limitations.
5. Repair confirmed flaws and add focused regressions. Run appropriate related tests, typecheck, lint, formatting and file-size checks. Inspect machine/output governing documents for affected behavior; source and mock-controller tests do not qualify hardware.
6. Make focused commits. Publish each coherent repair from current main on a `codex/audit-*` branch with a clear problem/behavior description and verification evidence. Check `LICENSE` says “All rights reserved” before every push. Keep history and raw probe archives out of product patches.
7. Create a reviewable PR, then query checks for its **latest pushed commit**. Require successful `Lint, typecheck, license, test, build` and `Chrome UX smoke`. Repair relevant failures and verify the replacement commit. Record blocked or failed checks honestly; a queued, missing, skipped or cancelled gate is not successful CI verification. Tie independent approval to the same published source: cherry-picked commit IDs can differ, so compare every repair file against the reviewed Git tree before recording `review.verifiedPublishedHead`.
8. Update the ledger, then continue. Reconcile merged fixes on the next refresh; unmerged repair branches remain visible and must not be rediscovered as untreated defects. Review the audit's own repair PRs through their peer review and CI evidence to avoid a recursive duplicate audit.

Completion requires a refreshed inventory with no remaining review gaps, all confirmed current defects repaired and published, and successful required CI for the latest repair heads. PRs stay open for maintainer review. Merging, deployment, release publication, provider changes and hardware operation require separate authorisation.

Advance to the next audit batch only when every current repair has `cycleVerified: true`: required CI passed, review applies to the published head, no reviewed follow-up remains unpublished, and an open branch has been reconciled with the current main snapshot. A closed, unmerged PR does not count as delivery. An external merge does not erase unresolved review or unpublished changes. Preserve these combined conditions when refreshing status or disabling the continuation automation.

CI snapshots distinguish `absentRequired` (required check names not yet present) from `unmetRequired` (every required check without a completed successful result, including queued, running, failed and skipped checks). `missingRequired` is retained as a legacy alias for `absentRequired`; an empty value does not mean CI passed. Only the complete combined cycle conditions above allow advancement.
