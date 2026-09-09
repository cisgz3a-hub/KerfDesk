# Loop 1 — governance, architecture, and Frame-only guard compliance

Status: complete

Audited tree: `claude/vcarve-stamp-subcell` at `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`, including the inherited working-tree changes.

## Audit design

This loop used a contract-to-code trace. It started from the literal guard definition in `AGENTS.md`, `CLAUDE.md`, PROJECT non-negotiable 21, and ADR-224/228/230/231/232/237. It then traced production behaviors that block, refuse, cap, clamp, hide, disable, rewrite, or confirm before an action. Each behavior was tested against the only permitted categories: the exact Frame permit, factual transport inability, compile integrity, or exact handoff consistency.

The primary and blind independent auditor worked separately. An adversarial verifier built its own false-positive checklist before seeing either result, then reproduced, narrowed, or rejected the merged candidates.

## Research and verification base

Repository sources:

- `AGENTS.md:15-53`, `CLAUDE.md:35-46`, `PROJECT.md:358-388`
- `DECISIONS.md:9831-10409`, including ADR-224 and ADR-228 through ADR-232
- `DECISIONS.md:10994-11208` and `DECISIONS.md:13326-13552`, covering removed work/import refusals
- current production and test paths cited per finding

No external behavioral claim was needed in this loop. The governing project sources and current implementation are the primary authorities.

Focused executable check:

```text
pnpm vitest run <9 guard-adjacent test files>
9 test files passed; 64 tests passed; exit 0
```

Covered test files included native-project budgets, rotary G-code, variable CSV, processed bitmap budgets, CNC tile budgets, Fire, jog no-go behavior, and SVG parsing.

## Reconciled findings

### L1-01 — fixed `.lf2` scene ceilings refuse Open and canonical Save

- State: **Confirmed — directly corroborated and verifier-retained**
- Severity: **P2**
- Trigger: a finite project crosses fixed layer/object/group/member/polyline/point/curve counts.
- Mechanism: `src/io/project/project-scene-integrity-validator.ts:3-77` rejects the project; `src/io/project/deserialize-project.ts:84-92` returns invalid; `src/io/project/prepare-project-persistence.ts:11-38` routes canonical Save through the same validator; `src/ui/app/file-actions.ts:266-278` aborts canonical Save.
- Evidence: `src/io/project/project-security-validation.test.ts:102-112` and `src/io/project/project-scene-curve-budget.test.ts:17-32` pin the refusals; both passed in the focused run.
- Classification: a predictive count policy, not malformed input or an observed allocation/materialization failure.
- Branch note: some geometry ceilings differ on local `origin/main`; base layer/object/group/member ceilings survive there. The finding is stated for the audited tree.

### L1-02 — configured no-go zones veto direct jog commands

- State: **Confirmed — directly corroborated and verifier-retained**
- Severity: **P1**
- Trigger: an otherwise valid direct jog crosses an enabled configured no-go zone.
- Mechanism: `src/ui/state/laser-jog-actions.ts:307-318` and `:362-375` throw before dispatch.
- Evidence: `src/ui/state/laser-jog-actions.zone-guard.test.ts:92-104` and `:134-149` require zero `$J=` writes; all four focused tests passed.
- Classification: configured spatial policy, not controller transport inability. Bed-bound findings on the same path are already warning-only.

### L1-03 — standalone machine commands are gated by confirmations outside Job Review

- State: **Confirmed — directly corroborated and verifier-retained**
- Severity: **P2**
- Affected actions: Release Motors (`src/ui/laser/OriginRow.tsx:187-190`), persistent G54 set/clear (`OriginRow.tsx:243-256`), Zero Z overwrite (`src/ui/laser/use-zero-z-action.ts:19-26`), M5/M9 reset (`src/ui/laser/AccessoryResetControls.tsx:28-39`), and persistent console writes (`src/ui/laser/console/run-console-command.ts:15-35`).
- Classification: the governing definition expressly includes confirmations before otherwise-available machine commands. These are not the single Start-time Job Review.
- Qualification: the audit does not claim the intent checks are undesirable; it establishes that they contradict the literal one-guard contract.

### L1-04 — valid feed and RPM requests are silently rewritten

- State: **Confirmed — directly corroborated and verifier-narrowed**
- Severity: **P1**
- Mechanism: Frame feed is reduced to live controller maxima in `src/ui/state/frame-feed-limits.ts:8-24` and consumed by `src/ui/state/laser-frame-motion-plan.ts:16-59`; laser vector/raster speeds are capped in `src/core/job/vector-group-fields.ts:8-24` and `src/core/job/compile-job-raster.ts:141-159`; CNC feed/RPM are capped in `src/core/cnc/compile-cnc-helpers.ts:47-55` and applied by `src/core/cnc/compile-cnc-job.ts:195`.
- Evidence: current tests pin the rewrites, including `src/core/job/compile-job.test.ts:112-125` and `src/core/cnc/compile-cnc-job.test.ts:227-242`.
- Classification: the program remains producible, but the operator's valid request is changed rather than warned about. Power's intrinsic 0–100 domain and pass-count integer normalization were excluded as ordinary value-domain validation.

### L1-05 — predictive raster work budgets refuse conversion and processed-bitmap export

- State: **Confirmed — primary plus verifier corroboration**
- Severity: **P2**
- Trigger: predicted work exceeds 50,000,000 pixel-pass units or 64 MiB estimated working memory.
- Mechanism: `src/core/raster/raster-budget.ts:3-8` and `:67-91` return `too-large`; `src/ui/raster/ConvertToBitmapDialog.tsx:66-89` disables/refuses conversion; `src/ui/app/save-processed-bitmap.ts:31-69` returns before the file picker or write.
- Evidence: `src/ui/app/save-processed-bitmap.test.ts:70-88` pins the no-picker result and passed in the focused run.
- Classification: predictive policy, not an observed `RangeError` or materialization failure.

### L1-06 — CNC tiled export refuses plans above 500 files

- State: **Confirmed — independently discovered and verifier-retained**
- Severity: **P2**
- Trigger: the exact finite grid requires more than 500 tile jobs.
- Mechanism: `src/core/cnc/effective-cnc-tile-grid.ts:5-6` defines the ceiling and `:71-102` returns `work-budget-exceeded`; `src/ui/app/save-tiled-gcode.ts:92-103` aborts; `src/ui/app/tiled-save-work-budget.ts:11-24` states that no files were written.
- Evidence: `src/core/cnc/effective-cnc-tile-grid.test.ts:98-120` pins 500 accepted and the next larger plan refused; ten focused tests passed.
- Classification: export policy; the grid is already known, transport and handoff are not involved, and no actual allocation failure has occurred.

### L1-07 — variable CSV import uses fixed size, row, and column refusals

- State: **Confirmed — verifier-only discovery, source and tests verified**
- Severity: **P2**
- Trigger: more than 10,000,000 characters, 100,000 rows, or 1,000 columns.
- Mechanism: `src/core/variables/parse-csv.ts:11-16` and `:49-59` return errors before a dataset can be embedded; `src/ui/text/VariableTextControls.tsx:69-96` reports the error and does not call `setCsv`; `src/io/project/project-variable-validator.ts:3-5` and `:93-115` repeat the count limits at persistence.
- Evidence: `src/core/variables/parse-csv.test.ts` passed in the focused run.
- Classification: fixed size/count judgment, not invalid CSV syntax or an observed engine failure.

## Withheld and disputed candidates

- **Rotary raster policy:** the empty/non-writable output path is real (`src/io/gcode/emit-gcode.ts:218-235`), and the same artifact emits when its boolean is true. The verifier treated Labs plus profile capability as defining an experimental surface rather than refusing an established action. Retained as a governance ambiguity, not a canonical finding.
- **Low-power Fire:** Labs/profile hiding/refusal and the 5% cap are real. The verifier treated those rules as defining an experimental command surface; connection/Idle/busy checks are factual transport. Retained as a governance ambiguity.
- **SVG walk depth 256:** `src/io/svg/parse-svg.ts:165-177` silently stops deeper traversal. A recursion bound can be parser integrity; undisclosed partial geometry remains a correctness candidate for Loop 6 and was not runtime-reproduced here.
- **Pointer and continuous-jog normalization:** not promoted separately from the direct no-go veto.

## Documentation and contract drift

- `WORKFLOW.md:814-815` still prescribes Frame feed caps even though controller-setting policy is warning-only under the controlling rule.
- `WORKFLOW.md:862-903` retains review-before-Frame and M7-refusal details that conflict with the current Frame-then-Review flow and advisory M7 implementation.
- `src/ui/laser/JobControls.tsx:188-195` and `:360-367` retain stale review-before-Frame tooltips.
- ADR-129 still describes the direct-jog no-go guard as accepted after the later standing denial.

## Correctly rejected guard candidates

- exact one-use Frame permit and Start-time Job Review;
- project/controller/origin/evidence drift checks that protect exact handoff;
- disconnected, no status, Alarm/non-Idle, busy-operation, MPG, and RX-line conditions that make transport unavailable;
- non-finite/unconstructable/empty artifacts and actual materialization failure;
- warning-only large-job preview and estimate degradation;
- genuine parser recursion/entity integrity boundaries when they fail explicitly rather than silently rewriting content.

## Limitations

- The audited branch is 209 commits behind and 36 commits ahead of local `origin/main`; findings are current-working-tree facts, not a claim about remote current `main`.
- The worktree was inherited dirty, and `src/ui/app/file-actions.ts` is among the inherited modified paths.
- No browser, E2E, hardware, serial, perceptual, deployment, or external-service qualification occurred.
- The focused tests prove the present behaviors are pinned; they do not prove physical correctness.

## Loop decision

Loop 1 closes with seven canonical findings, two governance ambiguities, one parser-correctness handoff to Loop 6, and four documentation-drift records. No fix was implemented. Loop 2 starts with the geometry/numeric invariant design in `coverage-map.md`.
