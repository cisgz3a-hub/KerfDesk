# Rolling audit — layers panel + visibility/output parity baseline

- **When:** 2026-07-17 08:15 (+08)
- **Tree:** audit branch on `origin/main` @ `ed40b6d5` (verified unchanged upstream at audit time).
- **Scope:** the CLAUDE.md rule-3 parity baseline end-to-end — `src/core/scene/layer.ts` (model), `src/core/job/compile-job.ts` (output filtering), `src/ui/workspace/draw-preview.ts` / `draw-raster-preview.ts` (canvas + preview), `src/ui/layers/LayerRow.tsx` (toggles), plus a regression-watch re-read of `use-debounced-commit.ts` (the PR #230 numeric-snap fix) and size-rule spot checks on the largest panel files.
- **Method:** static read with the LightBurn baseline as the reference contract. **Not verified:** no rendered/perceptual pass (nothing drawn and compared); LightBurn behavior asserted only where CLAUDE.md itself states the baseline.
- **Report-only** per CLAUDE.md collaboration rule 1 — nothing was fixed.

---

## P3-1 — multi-operation artwork takes only its FIRST operation's layer for canvas visibility

For operation-bound paths the faint-artwork underlay resolves the governing layer as `operationIds.flatMap((id) => layerByColor.get(id) ?? [])[0]` ([draw-preview.ts:86-91](../../src/ui/workspace/draw-preview.ts)) — index `[0]`, first bound operation only. An object bound to two operations (ADR-211 allows the array) disappears from the canvas when its *first* operation is hidden, even while a second, visible operation still references and will run it. Inverse skew: it stays visible per operation 1 while hidden operation 2's binding is invisible-on-canvas but still output-gated correctly at compile (compile iterates every operation layer independently). Canvas-only nuance — output is unaffected — but it breaks "hiding a layer hides its objects" in the multi-binding case in both directions. Fix direction: treat artwork as visible if **any** bound operation layer is visible (and pick emphasis from the visible ones).

---

## Verified clean (checked, no finding) — the parity baseline holds end-to-end

- **`visible` and `output` are separate per-layer switches** ([layer.ts:66-67](../../src/core/scene/layer.ts)), matching LightBurn's eye/Output split; sub-operations compose as `layer.output && subLayer.enabled` ([layer.ts:219](../../src/core/scene/layer.ts)).
- **Output filtering uses `output` only:** `compileJob` iterates `outputOperationLayers` ([compile-job.ts:57](../../src/core/job/compile-job.ts), [layer.ts:225-227](../../src/core/scene/layer.ts)) with no `visible` term — a hidden-but-output layer still burns, which **is** LightBurn's behavior.
- **Canvas hiding is artwork-only, exactly per rule 3:** the `!layer.visible` skip at [draw-preview.ts:91](../../src/ui/workspace/draw-preview.ts) is in the *faint artwork underlay*; the toolpath preview (`drawPreview`) draws the compiled job, so it includes hidden-but-output geometry. `draw-raster-preview.ts:8-9` documents the same policy ("preview shows what burns, not what is merely visible"). All three surfaces agree: preview == emitted, canvas == visibility.
- **The LayerRow Output toggle is honestly labeled** ("Include this operation in preview and machine output") and output-off rows dim without hiding ([LayerRow.tsx:54-67,105](../../src/ui/layers/LayerRow.tsx)).
- **The PR #230 numeric-field fix is intact:** the debounce timer commits to the store only and never rewrites the visible draft; reconciliation happens solely on blur and external value change; blank-field editing holds without snap-back and blur-on-blank restores the committed value (LightBurn behavior) — all with the protective comments in place ([use-debounced-commit.ts:54-123](../../src/ui/layers/use-debounced-commit.ts)). The memory-flagged regression ("don't re-add setDraft to the debouncer commit") has not recurred.
- **Size rules:** the largest panel files (388/374 raw lines) are 6-8 sub-components each — per-component sizes are well inside the 150/250 rule; no file exceeds the hard cap.

## Not verified

- No rendered output was produced or compared (static audit); the multi-operation visibility nuance (P3-1) was traced in code, not demonstrated on a canvas.
- The cut-settings dialog's field-by-field parity with LightBurn's cut settings editor is covered by `cut-settings-output-parity.test.ts` and was not re-derived here.
- Repo-wide note (out of scope but observed): the report-only soft-line-limit scan currently lists **127 files** over the 250 counted-line tier — a debt trend the maintainer may want on a dashboard rather than per-audit anecdotes.
