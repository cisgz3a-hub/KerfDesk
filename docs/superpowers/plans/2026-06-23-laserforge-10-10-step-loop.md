# LaserForge 10/10 Step Loop

## Header

- Status: active operating loop
- Target repo: `C:\Users\Asus\LaserForge-2.0`
- Scope: focused GRBL LaserForge work only
- Reference policy: LightBurn is workflow reference; Rayforge is study-only architecture reference; no Rayforge code is copied
- First queue: Step 0 stabilize current dirty workspace, then verification harness, selection/transform polish, node/contour editing, fill/raster fidelity, machine/controller lifecycle, release gate

## Loop Contract

Every implementation step must be one narrow, reviewable slice. It is not complete until the step reaches 10/10 by the rubric below or is explicitly parked as externally blocked.

1. Lock the step.
   - Name one operator-visible outcome.
   - Record affected workflow, safety risk, and out-of-scope items.
   - Record required evidence: tests, browser smoke, G-code/artifact inspection, or hardware smoke.

2. Research before changing code.
   - Inspect the current LaserForge code, tests, docs, and dirty diff.
   - Check LightBurn docs or behavior only where the feature is meant to match operator workflow.
   - Check Rayforge only for architecture/workflow patterns.
   - Save sources and local paths in the step report.

3. Define the 10/10 rubric before implementation.
   - The final score is the minimum of correctness, safety, UX, regression coverage, real-artifact evidence, maintainability, and docs/audit clarity.
   - Any accepted high-severity finding caps the score at 6/10.
   - Any accepted medium-severity finding caps the score at 8/10.
   - Missing required browser, output, or hardware evidence caps the score at 9/10.
   - A step is 10/10 only when fresh verification passes and no accepted findings remain.

4. Prove the failure first.
   - For behavior changes, write or identify a failing test, failing browser path, bad generated artifact, bad G-code, or reproduced operator workflow before editing production code.
   - For docs/process-only steps, the proof is the missing or stale process artifact plus an audit report showing the gap.
   - For visual or CAM changes, use an independent render/artifact check whenever possible.

5. Implement the smallest slice.
   - Prefer new, single-responsibility files.
   - Preserve existing project compatibility and machine safety behavior.
   - Avoid refactors unless the step cannot safely reach 10/10 without them.

6. Verify with fresh evidence.
   - Run targeted tests for the changed subsystem.
   - Run `pnpm typecheck`, `pnpm lint`, and the relevant broader suite before claiming completion.
   - Use browser smoke for UI work.
   - Use emitted G-code or rendered artifacts for output work.
   - Use simulated controller tests first for machine work, then hardware smoke only when safe and available.

7. Audit the diff.
   - Report findings first.
   - Each finding must include trigger path, failure mode, consequence, severity, confidence, and concrete fix.
   - Reject false positives explicitly.
   - Rate the step with the minimum-score rubric.

8. Fix until 10/10.
   - While the rating is below 10/10, fix the highest-risk accepted finding.
   - Add or update the failing proof for that finding.
   - Re-run verification, re-audit, and re-rate.
   - Do not move to the next dependent step until this passes or the user explicitly accepts an external blocker.

9. Close out.
   - Commit only after the step is verified and audited.
   - Do not include unrelated dirty files in a commit.
   - Push/deploy only when requested or when the step explicitly requires it.
   - Record deferred work as a named next step, not hidden debt.

## Current Step Queue

1. Step 0: stabilize current dirty workspace.
   - Done at 10/10 when current drawing/workspace tests pass, browser smoke matches expected behavior, and audit finds no accepted regressions in the active UI slice.

2. Step 1: verification harness.
   - Done at 10/10 when visual/G-code verification is harder to fool and at least one fill/raster/path behavior is checked by an independent artifact path.

3. Step 2: selection and transform polish.
   - Done at 10/10 when selection, drag-select, resize, anchor/pivot, and shape-exit behavior are covered by tests and browser smoke.

4. Step 3: node, contour, and fill editing.
   - Done at 10/10 when imported/traced shapes, open contours, close contour, node operations, and fill eligibility are predictable and artifact-checked.

5. Step 4: fill/raster fidelity.
   - Done at 10/10 when cross-hatch, scan offsets, raster/fill direction metadata, and output stability are checked with G-code and rendered artifacts.

6. Step 5: machine/controller lifecycle.
   - Done at 10/10 when post-job settle, Home, Frame, Recover, reconnect, progress, and command ACK handling are covered by simulated controller tests and safe hardware smoke where relevant.

7. Step 6: release gate.
   - Done at 10/10 when repo audit, CI status, Cloudflare deployment, and deployed-site browser smoke all pass.

## Step Report Template

Use this shape for each step report under `audit/reports/`.

```md
# Step N - <title> - YYYY-MM-DD

## Step Contract
- Goal:
- User-visible success:
- Safety risk:
- Out of scope:
- Required evidence:

## Research
- LaserForge files/tests:
- LightBurn references:
- Rayforge references:
- Prior audits:

## Failing Proof
- Reproduction:
- Expected failure:
- Evidence:

## Implementation Summary
- Files changed:
- Compatibility notes:
- Safety notes:

## Verification
- Targeted tests:
- Typecheck:
- Lint:
- Browser/artifact/hardware:
- Not verified:

## Audit Findings
### STEP-XXX - <title>
- Severity:
- Confidence:
- Trigger path:
- Failure mode:
- Consequence:
- Concrete fix:
- Status:

## Rating
- Correctness:
- Safety:
- UX:
- Regression coverage:
- Real-artifact evidence:
- Maintainability:
- Docs/audit clarity:
- Final score:
```
