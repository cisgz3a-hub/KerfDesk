# Selected-area second-pass quality audit

Date: 28 September 2026. Audited GitHub `main` snapshot: `be04c885b84e0396d0fb683a472112250b6db522`.

This document preserves the pre-fix findings and their original locations and commands.
See the [repair record](repair.md) for the subsequent implementation and verification.
Audit probes have been promoted to regression tests; the original failing logs remain
local baseline evidence. Absolute workspace links below refer to that local evidence,
which is not bundled in the repository. The repair record lists current regression commands.

The feature has a sound architecture and meaningful existing tests, but five reproduced defects need correction. Two affect output behaviour and should precede feature expansion. The most urgent is a constant-power laser transition that the ordinary emitter already protects against.

This audit covered the implementation at the snapshot above, including PR #829 and subsequent merged amendments, rather than judging the original PR in isolation. The working checkout at `C:/Users/Asus/LaserForge-2.0` was left untouched. All audit work was isolated at `D:/LaserForge/second-pass-audit-20260928`. At the audit-only stage, no production code was changed, no PR was created, and no deployment or physical hardware operation was performed.

## Confirmed findings

### SP-01 · P1 · Constant-power transitions can stop with the beam still powered

Location: [program-writer.ts:122](D:/LaserForge/second-pass-audit-20260928/src/core/laser-second-pass/program-writer.ts:122), including the beam-mode transition at line 107.

The second-pass writer changes air assist before its dark reposition. With two normal constant-power cut layers, the original emitter writes a laser-off move before changing air. Selecting both paths produces this sequence instead:

```gcode
G1X20F1200S600
M8
G0X30Y20S0
```

The opposite air transition has the same issue with M9. A third reproduction switches M3 to M4 where two cuts share an endpoint: the original includes a short dark excursion; the second-pass writer removes it and writes M5 directly after the powered cut.

All three sources came from the real ordinary GRBL emitter and passed the separate lit-planner-drain oracle; all three derived programs were accepted as ready but failed it. GRBL synchronises its motion queue before changing coolant, while M3 retains programmed power during a stop. These semantics are verified against [pinned GRBL coolant control](https://raw.githubusercontent.com/gnea/grbl/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/coolant_control.c) and its [laser-mode documentation](https://github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md). This establishes an output hazard and possible excess exposure, not a measured burn mark on the user's machine.

Repair: share the normal emitter's dark-transition rules or preserve equivalent real dark motion before draining air/mode changes. Reordering the air command alone does not fix shared endpoints. Introduce a new writer version so existing archived derived programs retain byte-exact lineage replay.

Evidence: [three independent reproductions](D:/LaserForge/second-pass-audit-20260928/src/core/laser-second-pass/build-program-writer3.test.ts), [complete source/derived failure log](D:/LaserForge/second-pass-audit-20260928/audit-second-pass-reproductions.log).

### SP-02 · P2 · Trimming can change the speed and exposure inside a small selection

Location: [sweep-window.ts:85](D:/LaserForge/second-pass-audit-20260928/src/core/laser-second-pass/sweep-window.ts:85).

The algorithm assumes that any positive original lead-in/lead-out is sufficient when moved beside a smaller painted area. That is false for supported jobs with short manual overscan: the original has also accelerated along the unselected part of the engraving before reaching the selected centre.

A real constant-power raster emitter produced a 100 mm row at F6000, S600, with 1 mm overscan and acceleration 500 mm/s². Its original feed sweep runs from X19 to X121. Painting a 2 mm spot in the centre changes that to X68–72, with powered motion only from X69 to X71. The new M3 command after positioning establishes a stop before the shortened sweep.

An independent one-dimensional acceleration bound gives 100 mm/s at the original centre, but at most `sqrt(2 × 500 × 2) = 44.72 mm/s` at the derived centre. The feed word and S600 are unchanged. Thus the promise to preserve speed/exposure is not established by matching programmed F/S values. This is an emitted-motion and kinematic calculation, not measured material darkness.

Repair: retain enough original approach/departure to preserve the source's velocity envelope. When saved kinematic evidence cannot prove a shorter path equivalent, retain the original sweep context. Test manual short overscan, acceleration/deceleration, constant-power output and junctions independently. Version the changed output.

Evidence: [reproduction](D:/LaserForge/second-pass-audit-20260928/src/core/laser-second-pass/build-program-writer3.test.ts), [output analysis](D:/LaserForge/second-pass-audit-20260928/audit-output-results/summary.md).

### SP-03 · P2 · A late archive failure loses the completed-job offer

Location: [start-job-execution-tracking.ts:191](D:/LaserForge/second-pass-audit-20260928/src/ui/laser/start-job-execution-tracking.ts:191), with the successful-staging return at line 160 and [start-job-transmission.ts:137](D:/LaserForge/second-pass-audit-20260928/src/ui/laser/start-job-transmission.ts:137).

The memory fallback is created when artifact staging fails. If staging succeeds but the subsequent activation transaction fails, the code discards the staged archive without registering that fallback. The accepted job can finish cleanly, but neither an archived completion nor an in-memory completed run remains, so no second-pass offer appears.

The reproduction uses the real GRBL simulator, Start flow, repository and storage backend. It injects one `mutate-slots` failure immediately before the actual activation operation. The stream settles; the archive receipt and active record are null, the kept completion is undefined, and the completion callback is never called. A warning already discloses missing recovery, so this finding is an availability gap rather than silent persistence success.

Repair: preserve the accepted execution in memory for activation failures as well as staging failures, using the existing clean-settle rule. Preserve truthful recovery/durable-intent state; do not claim the archive was written successfully.

Evidence: [fault-injection reproduction](D:/LaserForge/second-pass-audit-20260928/src/ui/laser/start-job-archive-activation-fallback.test.ts).

### SP-04 · P2 · The offer admits rotary jobs that the editor cannot process

Location: [second-pass-offer.ts:18](D:/LaserForge/second-pass-audit-20260928/src/ui/laser/second-pass/second-pass-offer.ts:18), versus [second-pass-worker.ts:128](D:/LaserForge/second-pass-audit-20260928/src/ui/laser/second-pass/second-pass-worker.ts:128).

Eligibility checks only laser machine kind and controller family. A rotary-enabled laser artifact returns true, but opening it reaches the worker's explicit flat-job refusal. The same incomplete eligibility is used when retaining an oversized job in memory. The test confirms both active rotary applicability and the erroneous positive offer.

Repair: use a shared supported-source eligibility check for the prompt, Machine-panel entry, memory retention and worker. Flat-only support is a deliberate scope limit; advertising an unusable editor is the defect. Full rotary support is a separate feature requiring its coordinate contract to be implemented and qualified.

Evidence: [rotary reproduction](D:/LaserForge/second-pass-audit-20260928/src/ui/laser/start-job-archive-activation-fallback.test.ts).

### SP-05 · P2 · A short viewport clips Start below the dialog

Location: [second-pass.css:1](D:/LaserForge/second-pass-audit-20260928/src/ui/laser/second-pass/second-pass.css:1), especially fixed height/hidden overflow, canvas minimum height and the wrapping footer.

Real Chrome measurements after dismissing notifications:

| CSS viewport | Result |
| --- | --- |
| 1366 × 768 | All footer controls visible and hit-testable |
| 1280 × 600 | All footer controls visible and hit-testable |
| 683 × 384 | Start occupies Y377–406; the panel ends at Y372 and clips it |

The last case models a small effective viewport, including the space pressure caused by enlarged browser UI. Actual browser zoom was not separately exercised. With notifications present, more controls are clipped. The parent dialog's ordinary scrolling is overridden by `overflow: hidden`.

Repair: let the workbench body scroll at short heights and retain a reachable footer; allow tools to collapse or reflow before the canvas minimum consumes the available space. Keep keyboard/focus behaviour in the regression coverage.

Evidence: [Chrome reproduction](D:/LaserForge/second-pass-audit-20260928/e2e/second-pass-workbench.spec.ts), [measurements and failure log](D:/LaserForge/second-pass-audit-20260928/audit-second-pass-layout.log), [screenshot](D:/LaserForge/second-pass-audit-20260928/audit-layout-results/audit-second-pass-layout-a-93113--laptop-and-short-viewports/workbench-683x384.png).

## Worthwhile upgrades after the correctness repairs

1. **Keep large previews responsive.** The canvas redraws every visible segment on the UI thread for each pan/zoom update. In synthetic real-Chrome measurements, 500,000 visible segments took 49–58 ms for JavaScript drawing submission, or 83–102 ms including forced raster completion. One million took 71–97 ms / 151–173 ms. Preview adds another output layer. Cache a display bitmap during interaction, then redraw exact geometry when movement settles. These measurements identify the drawing bottleneck; they are not whole-workflow timings or a guarantee on other computers. [Drawing call](D:/LaserForge/second-pass-audit-20260928/src/ui/laser/second-pass/second-pass-canvas-draw.ts:80), [benchmark](D:/LaserForge/second-pass-audit-20260928/audit-browser-results/ui-draw-benchmark.mjs), [raw samples](D:/LaserForge/second-pass-audit-20260928/audit-browser-results/ui-draw-benchmark.json).
2. **Highlight the selected stroke on the canvas.** Selection currently changes the list and power field, without passing the selected identity to the canvas. Spatial highlighting would make edits and removal easier when strokes overlap. [Selection handler](D:/LaserForge/second-pass-audit-20260928/src/ui/laser/second-pass/use-second-pass-workbench.ts:176).
3. **Show power capping immediately after Preview.** Capping is already disclosed in the prepared warnings and later Job Review. Surface it in the workbench next to the preview so the operator sees why increasing a multiplier may stop changing some tones. [Existing warning](D:/LaserForge/second-pass-audit-20260928/src/ui/laser/second-pass/second-pass-worker.ts:94).
4. **Bring capability documentation up to date.** WORKFLOW still says native arcs are refused, although ADR-432 and current code support the G17 XY I/J subset. Keep the stock `$12` arc-tolerance assumption explicit; measuring and sealing actual arc settings is a future fidelity improvement, not an additional reproduced defect in this audit.

## Code-quality assessment

The feature separates brush geometry, indexing, source parsing, output writing, worker preparation and machine execution sensibly. It retains the exact saved program instead of recompiling mutable artwork. Independent brush property tests, immutable preparation proofs, source-generation ownership, cancellation and Frame invalidation are substantive strengths. Draft failure handling preserves previous saved bytes, and overlap semantics avoid multiplying exposure merely because brush strokes overlap.

The main weakness is integration across those boundaries. The selective writer duplicates emission rules and has missed safeguards now present in the ordinary writer. Matching geometry and programmed power/feed is not a complete execution-equivalence check. Storage fallback is coupled to one failure phase, and supported-source checks are duplicated between the offer and worker. Repairs should consolidate these contracts instead of adding isolated exceptions.

## Verification and next work

- Existing focused unit/property/component/controller tests: 188 passed across 19 files. Independent completion-tracker review added 12 passing tests, for 200 distinct existing tests. Other reviewer reruns overlap and are not added to that total.
- New audit assertions: six unit/simulator cases fail as expected, covering SP-01 (three cases), SP-02, SP-03 and SP-04. The additional Chrome layout assertion fails for SP-05. These are retained as untracked audit evidence in the isolated checkout, not merged regression tests or production changes.
- Existing Chrome workflows: 11 of 12 passed on the initial run. One scenario timed out in `beforeEach` while opening the app, before entering the second-pass flow; its isolated unchanged retry passed in 18.3 seconds. All 12 selected scenarios therefore have passing executions, but the initial batch was not wholly green. The startup timeout's cause was not established, and it is not counted as a sixth feature defect.
- No full-repository release suite, hosted deployment verification, physical controller test or material burn was performed. Existing software evidence cannot qualify workpiece alignment, actual power response or hardware behaviour.

Repair order: SP-01 first; SP-02 next with conservative motion preservation and writer-version compatibility; then SP-03/04 and SP-05. Follow with the measured preview upgrade and targeted usability improvements. Acceptance should combine independent emitted-output/transition checks, modelled velocity checks, storage fault injection, browser interaction and finally separately authorised hardware qualification.

Commands and logs:

```powershell
pnpm exec vitest run src/core/laser-second-pass src/ui/laser/second-pass src/ui/laser/second-pass-execution.test.ts src/ui/laser/second-pass-preparation-proof.test.ts src/ui/laser/start-job-authorization.second-pass.test.ts src/ui/laser/start-job-unarchived-completion.test.ts --maxWorkers=2
pnpm exec vitest run src/core/laser-second-pass/audit-second-pass-output.test.ts src/ui/laser/audit-second-pass-execution.test.ts --maxWorkers=2
$env:PLAYWRIGHT_PORT='5198'
pnpm exec playwright test e2e/recovery-second-pass-stress.spec.ts e2e/production-workflows.spec.ts --grep 'second pass|second-pass|darkening|finished job' --output audit-browser-results
pnpm exec playwright test e2e/audit-second-pass-layout.spec.ts --output audit-layout-results
```

The broad first command was run before adding the failing audit files. To repeat the unchanged baseline now, exclude the two `audit-second-pass-*.test.ts` files. Playwright's output-directory cleanup can remove the benchmark artifacts if the same output folder is reused; copy them or choose another output path first.

Logs: [existing baseline](D:/LaserForge/second-pass-audit-20260928/audit-second-pass-unit.log), [new reproductions](D:/LaserForge/second-pass-audit-20260928/audit-second-pass-reproductions.log), [browser workflows](D:/LaserForge/second-pass-audit-20260928/audit-second-pass-browser.log), [isolated browser retry](D:/LaserForge/second-pass-audit-20260928/audit-second-pass-browser-retry.log), [layout](D:/LaserForge/second-pass-audit-20260928/audit-second-pass-layout.log).
