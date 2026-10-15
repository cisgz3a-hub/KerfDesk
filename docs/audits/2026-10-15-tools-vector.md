# Tools audit: Vector and Fill repair

Audit started 15 October 2026; verification continued 16 October, Asia/Shanghai.
Scope: all 20 `TOOLS_VECTOR_IDS` commands and the six Fill repair commands.
This is an evidence ledger, not a claim of universal correctness or hardware qualification.
Interactive computer-use results are owned by the parent audit. This sub-audit also supplies
`e2e/tools-vector-audit.e2e.ts`, which exercises actual menu/dialog/pointer/Undo controls using
synthetic artwork as setup; browser automation and interactive computer use are separate evidence.

## Findings and changes

- **Fixed — Convert to Path discarded placed laser and CNC tabs.** The old
  `materializeVectorObject` result omitted both anchor arrays. Two regression cases failed
  before the fix. `vector-path-conversion.ts` now preserves their physical positions when
  baking the transform, including nonuniform scaling, reflection and rotation. A broken-open
  contour retains tabs for its future straight closure, following ADR-494 Amendment 1.
  The change is limited to conversion; newly derived boolean/offset artwork does not silently
  inherit source tabs. The regression verifies both anchor families and one undo record.
- **Fixed — Warp/Deform visibly exceeded its 0.05 mm error contract during enlargement.**
  A fresh independent analytic probe enlarged a 0.1 mm cubic to 100 mm using both tools:
  start `(0,0)`, controls `(0,0.1)`, `(0.1,0.1)`, end `(0.1,0)`; multiply the initial
  handles by 1000. Both outputs contained only 10 points. Comparing 4097 samples of the
  exact enlarged cubic with the nearest output segment measured **0.925926 mm** maximum
  error. This is a reproducible artwork-accuracy failure, not a hypothetical large-coordinate
  concern. Raw failing probe: `2026-10-15-tools-vector-warp-probe.txt`.
  Removed the 0.001 mm source tolerance floor and the 1000 stretch-estimate cap. Independent
  4097-sample regressions now pass at both 1000× and 10000× enlargement, each within 0.05 mm
  using fewer than 256 output points. Canonical flattening failure no longer substitutes
  coarse cached polylines: preparation refuses the operation at 200000 segments per object,
  excessive subdivision, or nonfinite stretch. Preview and Apply retain the whole original
  scene on failure; Apply explains the refusal, with no Undo entry or partial mutation.
  The 9×9 sampled Jacobian and sampled bent-line tests remain numerical estimators rather
  than a mathematically certified universal bound. That architectural limitation remains
  documented; the concrete enlargement defect and silent budget fallback are repaired.
- **Fixed — Join Paths moved existing tabs under nonuniform scaling.**
  `vector-path-join.ts` materializes repaired objects to world coordinates and remaps unaffected
  tab path indices, but kept their old local perimeter fraction. Existing identity-transform
  tab tests missed this. A new regression reproduced a 5 mm position error.
  The shared `materialized-tab-anchors.ts` helper now reprojects each retained anchor onto its own resulting contour, keeping both laser and CNC tab positions.
- Geometry operations are generally separated from store mutation, use immutable plans,
  preserve operation ownership deliberately, and have meaningful error/undo tests. This
  architecture is suitable, but those strengths do not replace live pointer/keyboard tests.

## Research used as independent design criteria

The sources below were retrieved during this audit. Product documentation establishes the
reference workflow; the mathematics/format specifications establish geometry semantics.
Agreement with another product is not itself proof of KerfDesk correctness.

- **R1 — [W3C SVG paths](https://www.w3.org/TR/SVG2/paths.html):** authoritative path segments,
  explicit closure and elliptical-arc semantics. Applied to conversion, joining, closure,
  direction, trim/extend/cut and fillet review.
- **R2 — [Clipper boolean operation definitions](https://angusj.com/clipper2/Docs/Units/Clipper/Types/ClipType.htm):**
  union, intersection, subtraction and exclusive-or sets; difference depends on operand order.
- **R3 — [Clipper offset rules](https://www.angusj.com/clipper2/Docs/Units/Clipper.Offset/Classes/ClipperOffset/_Body.htm):**
  normalize intersecting closed regions before offsets; opposite hole winding; distinguish
  open end caps from polygon ends; inward contraction requires closed area.
- **R4 — [Qt projective transforms](https://doc.qt.io/qt-6.8/qtransform.html):**
  quadrilateral mapping may be nonconstructible. KerfDesk explicitly uses a bilinear fallback
  when a pole-free projective mapping is unavailable.
- **R5 — [LightBurn Optimize Shapes](https://docs.lightburnsoftware.com/latest/Reference/OptimizeSelectedShapes/):**
  user-selected error tolerances, source comparison, confirmation and cancellation.
- **R6 — [LightBurn Resize Slots and Tabs](https://docs.lightburnsoftware.com/2.2/Reference/ResizeSlots/):**
  distinguish openings from tabs, measured material thickness and detection tolerance;
  malformed/curved/ambiguous geometry needs deliberate handling.
- **R7 — [W3C affine/skew transforms](https://www.w3.org/TR/css-transforms-1/):**
  matrix composition and tangent-based shear. Applied to `T^-1 W T` local geometry baking.
- **R8 — [LightBurn Tools menu](https://docs.lightburnsoftware.com/2.0/Reference/UI/ToolsMenu/):**
  closed cutter shapes, intersection-bounded trimming and four-/sixteen-handle workflows.
- **R9 — local manufacturing contracts:** PROJECT.md frame/output non-negotiables;
  ADR-494 Amendment 1 tab placement; per-tool governing ADR comments in source. These are
  product requirements, not external research or physical calibration evidence.

## Per-command ledger

`Tests` names are repository paths abbreviated to the relevant basename; geometry tests live
under `src/core/geometry`, action tests under `src/ui/state`, command tests under
`src/ui/commands`. A stress case listed as an existing fixture is distinct from a new workload
measurement. Browser/native, accessibility, save/reopen and material tests remain separate.

| Command | Design/code reviewed; research | Automated checks | Stress/boundary evidence and remaining gap | Computer use |
|---|---|---|---|---|
| `tools.convert-to-path` | `vector-path-tools.ts`, `vector-path-actions.ts`; R1/R9. Bake transforms, retain bindings, explicit shape-to-path conversion. Fixed dropped tabs. | `vector-path-tools`, `vector-path-actions`, `vector-path-output-preservation`, new `vector-path-conversion-tabs` | New closed/open tab tests combine 3:1 anisotropic scale, mirror and 35° rotation; pre-fix 2 failures, post-fix pass. No enormous-curve UI latency qualification. | Parent audit |
| `tools.generate-path-from-cut` | `path-from-cut-actions.ts`, `cut-paths-artwork.ts`; R9. Uses prepared output, strips output ownership from new copy, retains source. | `path-from-cut-actions`, `cut-paths-artwork` | Existing stale-project/document checks, overcut, laser-off travel and scan compensation cases. Huge generated artwork responsiveness not established. | Parent audit |
| `tools.weld` | `vector-path-weld.ts`, `vector-path-weld-plan.ts`; R2. Union within explicit operation/stroke/colour partitions. | `vector-path-weld`, `vector-path-weld-plan`, `vector-path-weld-state`, `vector-path-op-failure` | Engine failure, mixed settings, multiple operation roots, hole/topology cases. New 1000-object union workload exercises shared region normalization but is not a separate 1000-object Weld workflow. | Parent audit |
| `tools.union-silhouette` | `vector-path-union.ts`, `vector-repair-actions.ts`; R2/R9. Explicit destination operation; silhouette combines regions. | `vector-path-union`, `vector-repair-actions`, `VectorRepairDialogHost` available separately | New 1000 overlapping rectangles: single region, independent shoelace area 3003 mm². | Parent audit |
| `tools.join-paths` | `vector-path-join.ts`, endpoint joining; R1/R9. Same operation/settings only, bridge gaps, exclude ambiguous and tabbed open endpoints. | `vector-path-join`, `vector-repair-actions` | Existing 5000-edge chain expects 4999 joins without recursive concatenation; three-way junction excluded. New regression reproduces and fixes a 5 mm physical-tab error after nonuniform transform baking. | Parent audit |
| `tools.resize-joints` | `joint-resize.ts`, detection and topology helpers; R6. Explicit reviewed candidate IDs, opening fit allowance distinct from tab depth. | `joint-resize`, `joint-resize-actions` | Guards: 64 contours/2000 points per object, 20000 reviewed points overall. Tests include ambiguity, curved/locked input, touching boundaries, negative fit allowance, stale selection and mirrored scaling; cap-scale workload not benchmarked. | Parent audit |
| `tools.prepare-stamp` | `stamp-height.ts`, `stamp-source.ts`, state ownership; R9. Height intent only, anisotropic physical pixel pitch, threshold/mirror/padding. | `stamp-height`, `stamp-source`, `stamp-worker-client`, `stamp-preparation-actions`, `stamp-export` | Independent rectangle-edge distance oracle; rejects 2000×2000 above 2m pixels, tiny physical pitch causing excessive padding, bad thresholds/dimensions. Limits: 2m pixels/8192 per edge. No burn/material certification. | Parent audit |
| `tools.offset-shapes` | `offset-shapes.ts`, action plan; R3. Region normalization, holes, cap styles, both directions, explicit deletion option. | `offset-shapes`, `offset-shapes-actions`; round chord error suite available separately | New 250 separated squares, +1/-1 mm miter offsets, independent total areas 36000/16000 mm². Existing open/inward, collapse, hole/island, invalid distance cases. | Parent audit |
| `tools.rubber-band-outline` | `rubber-band-outline.ts`, convex hull; R1/R9. World outline points; transformed bitmap corners; rejects negligible area. | `rubber-band-outline`, new `tools-vector-audit-stress` | New 10000 rectangles / 50000 points including duplicated collinear vertices → 4-corner 100×100 mm hull, area 10000 mm². | Parent audit |
| `tools.close-paths` | `path-direction-edits.ts`, cleanup actions; R1/R9. Preserve existing curve; add closing line; report longest gap. | `path-cleanup-actions`, `close-path-preserve-geometry`, `path-node-curve-command-tabs` available separately | Existing 10000×5000 transformed near-seam geometry checks; no arbitrary local-epsilon endpoint loss. No many-contour browser timing. | Parent audit |
| `tools.reverse-paths` | direction edits and tab fraction reversal; R1/R9. Reverse segment order/control points/sweep; preserve tab position. | `path-cleanup-actions`; `path-node-curve-command-tabs` available separately | Existing broken contour, manual laser/CNC tabs and open direction-planner caveat cases. No large-array timing benchmark. | Parent audit |
| `tools.optimize-shapes` | `shape-optimize/*`, preview/state plan; R1/R5. World tolerance, exact source curves, incremental contour work and cancellation. | `shape-optimize/optimize-contour`, `optimize-object`, `optimize-shapes-actions` | Existing 2000-sample circle, independent dense curve comparison, corner preservation and scaled/mirrored tolerance. No whole-scene frame-budget guarantee. | Parent audit |
| `tools.warp` | homography + bilinear fallback; `warp-deform-*`; R4/R8 | `warp-deform-map`, `warp-deform-paths`, `warp-deform-actions`, workspace tool, new accuracy/budget tests | Existing corner exactness/collapsed/crossed handles; new analytic 1000×/10000× cubic enlargement <=0.05 mm/<256 points. Refuses >200000 segments/object instead of coarse fallback. Sampled estimates are not a certified global bound. | Parent audit |
| `tools.deform` | tensor-product cubic Bernstein patch, adaptive mapped-line subdivision; R1/R8 | Same Warp/Deform suites and new accuracy/budget tests | Existing 2000-point dense reference, bent closure/nonuniform transforms; new analytic enlargement and atomic over-budget refusal. Depth-12 exhaustion refuses, rather than silently accepting coarse output. | Parent audit |
| `tools.subtract` | `vector-path-booleans.ts`; R2. Bottom-most subject, union remaining clips. | `vector-path-booleans`, vector action/output/failure tests | New 100 translated rectangle cases each assert independent difference area 122 mm²; holes, disjoint/empty and invalid-engine paths covered. | Parent audit |
| `tools.intersect` | same boolean engine; R2. Sequential intersection across every selected object, canonical result. | Same boolean suites | New 100 translated rectangle cases each assert independent area 78 mm². Higher-count overlap has source/tests, no dedicated maximum-selection stress. | Parent audit |
| `tools.exclude` | same boolean engine; R2. Sequential symmetric difference, canonical region ordering. | Same boolean suites | New 100 translated rectangle cases each assert independent area 244 mm². Numerical near-coincident input covered by existing suite only where explicitly named. | Parent audit |
| `tools.cut-shapes` | `cut-shapes.ts`, `cut-shape-sides.ts`, action plan; R2/R8. Top-most closed cutter; preserve uncut sources, separate inside/outside. | `cut-shapes`, `trim-cut-shapes-actions`, `cut-shapes-limits` | Existing exactly-at-project-limit and one-over-limit cases, open/closed/mixed colours, IDs and unchanged exact curves. No universal load claim. | Parent audit |
| `tools.trim-shapes` | trim model/index/crossings/curve split; R1/R8. Nearest visible outline segment bounded by true crossings. | `trim-shapes`, `trim-analytic-crossings`, `trim-analytic-index`, `trim-bounds-index`, `trim-curve-split`, `trim-singular-arcs`, state options | Existing 1024 sparse-segment analytic index workload; exhaustive index oracle; singular arcs. Pointer responsiveness needs computer use. | Parent audit |
| `tools.extend-shapes` | extend endpoint model, analytic line/cubic/arc ray intersections; R1 | `extend-shapes`, `extend-ray`, parameter/arc-span/canonical-bounds suites, state/workspace tests | Existing 100000 scale short segment, tiny arc spans, genuine off-end rejection, overlap/contact/parallel/singular/stale target and mirrored nonuniform cases. | Parent audit |
| `tools.fill-selection` | `fill-selection-actions.ts`; R2/R9. Isolate selected artwork when shared operation would alter other artwork. | `fill-selection-actions`, `command-fill-selection` | Existing mixed ownership, reuse versus isolate operation cases. No new high-object-count fill assignment stress. | Parent audit |
| `tools.close-open-fill-contours` | `close-open-fill-contours-actions.ts`; R1/R9. Only selected qualifying Fill contours, finite positive tolerance. | `close-open-fill-contours-actions`, curve suite, command gating | Existing canonical near-closure and transformed seams; preserves unaffected geometry. No many-contour UI stress. | Parent audit |
| `tools.close-fill-contours-with-tolerance` | same actions with explicit world-mm tolerance; R1/R9 | Same fill closure suites | Invalid/zero/nonfinite tolerance guard and above/below gap cases. Unit coverage is not a dialog stress run. | Parent audit |
| `tools.close-paths-with-tolerance` | `close-within-tolerance.ts`, cleanup actions; R1. Bridge or meet ends, tangent-control movement. | `close-within-tolerance`, `close-paths-tolerance-actions` | Existing transformed gap, move-end cubic tangent and remaining-open counts. Infinity is accepted by core predicate; UI validation must keep finite input. | Parent audit |
| `tools.radius-fillet` | `curve-fillet.ts`, path-fillet actions; R1/R8. Tangent circle at straight corners, reverse bite, radius removal. | `curve-fillet`, `path-fillet-actions` | Existing radius-too-large, short adjacent edges, transformed geometry and inverse removal fixtures. No dense-corner workload benchmark. | Parent audit |
| `tools.shear` | `shear-bake.ts`, actions; R7. Exact affine curves, local `T^-1 W T`, retained placement. | `shear-bake`, `shear-actions` | ±85° input bound and singular transform checks, mirrored/nonuniform transform and arc cases. Simultaneous X/Y shear can itself become singular; no blanket topology-preservation promise. | Parent audit |

## Execution evidence

- Before fix: `vector-path-conversion-tabs.test.ts`: 2 tests failed because anchors were absent.
- After fix: `tools-vector-audit-stress.test.ts` + `vector-path-conversion-tabs.test.ts`:
  **2 files, 6 tests passed**, 26.00 seconds wall time, 432 ms summed test time in that run.
- Broader vector/fill run: **65 files / 433 tests passed** in 194.68 s; manifest and summary in `2026-10-15-tools-vector-tests.json`.
- Supplementary stress/offset/curve-tab/dialog suites: **5 files / 43 tests passed**, including the four new stress workloads; full results in `2026-10-15-tools-vector-additional-tests.json`.
- After shared-helper Join/Convert repair: **4 files / 27 tests passed**; full results in `2026-10-15-tools-vector-fix-tests.json`.
- After Warp/Deform enlargement/budget repair: **5 files / 55 tests passed**; full results in `2026-10-15-tools-vector-warp-fix.json`. The pre-fix two-test failure is retained separately in the probe transcript.
- Full repository TypeScript check passed after the first conversion repair; final shared-helper type/lint checks recorded below.
- Targeted ESLint passed for the conversion/tab repair, browser audit and Warp/Deform repair;
  file-size policy passed. The parent audit owns the final aggregate TypeScript run.
- Initial browser run passed Convert to Path, Generate Path from Cut, Weld, Join Paths and
  Resize Joint Openings, each with actual mutation, one Undo entry, exact scene restoration,
  no page errors, no serial events and a result screenshot in `artifacts/tools-audit/runs/.audit-vector-e2e`.
  Union silhouette timed out during workspace startup before its command ran. The suite was
  intentionally interrupted before completion to repair the newly reproduced Warp/Deform
  defect.
- **All 26 representative browser workflows subsequently passed:** the initial five above,
  Union silhouette in `artifacts/tools-audit/runs/.audit-vector-remaining-e2e`, and the final 20 in
  `artifacts/tools-audit/runs/.audit-vector-final-e2e`. Every command has a result screenshot; every test asserted one
  Undo entry, an actual scene mutation and exact restoration through keyboard Undo, with
  no page errors or serial events. The final 20-run report is
  `2026-10-15-tools-vector-browser-final.json`.
  These runs used the repaired Warp/Deform and atomic Adjust source. They preceded the
  later autosave timeout-only repair; they are not an exact-source rerun of that repair.
- The browser harness reuses one page per worker after its cold load, then explicitly resets
  scene, selection, Undo, tool mode and Warp session, and verifies no dialog remains before
  each command. Each command remains a separate test. A failed worker is replaced. Actions
  have a 30-second bound after readiness. One earlier Stamp attempt used an invalid 75 DPI;
  the product correctly reported the supported 127–635 range. The corrected 127 DPI workflow
  passed. That harness failure and the startup timeout are retained, not called product failures.
- Test setup: isolated lockfile dependencies; Windows Vitest temporary cache required a writable
  workspace TEMP/TMP. Earlier EPERM/dependency setup failures are environmental failures and
  are not counted as product test passes.
- No hardware, machine connection, material burn, publication, merge or deployment performed.
- Final focused ESLint passed for all 38 changed/new audit TypeScript files, including the
  three browser suites; the exact file list and exit code are recorded in
  `2026-10-16-tools-focused-lint.json`. A final `git diff --check` also passed.
- Final application and e2e TypeScript checks both passed with no diagnostics, including
  the later autosave repair; commands and exit codes are in
  `2026-10-16-tools-final-static-checks.json`.

Direct computer use on 2026-10-16 confirms **26 of 26** vector commands with
visible results and Undo. The parent used its already-loaded IAB tab, including the bundled
runtime on port 5199 for Prepare Stamp. Exact per-command observations and screenshots are
recorded in rows 33–58 of the master quality register. Resize Joint Openings used a drawn
30×30 mm outer rectangle minus a 3×10 mm inner slot. Apply with material thickness 3.5 mm
and allowance 0.1 mm was independently checked by reopening detection: Undo restored the
3.000 mm width; Redo re-detected 3.600 mm width and 10.000 mm depth. Screenshot:
`docs/audits/evidence/tools-quality-2026-10-16/direct-resize-joint-verified.png`.

The direct tolerance workflow checked both sides of the threshold: default 0.5 mm left a
72.216 mm gap open; 73 mm closed it; Undo restored the source. Optimize Shapes completed a
nontrivial five-point zigzag simplification after an earlier rectangle preview correctly
reported no change. Prepare Stamp completed a reviewed 1212×1212-pixel/121.2 mm preview at
0.1 mm pitch with 93998 face pixels, added an image, and restored three objects/three
operations through Undo. Its screenshot is `docs/audits/evidence/tools-quality-2026-10-16/direct-stamp.png`.

Preserved failed attempts are separate from those successful workflows:

- The child's fresh IAB workspace stayed on its loading splash for over eight minutes with
  no app console errors. Reload, a server restart, rebind and one recovery tab failed to
  reach a command; browser focus/navigation calls timed out at 30 seconds. Screenshot:
  `cua-vector/startup-blocked.png`. Ordinary fixtures were prepared in `fixtures/vector`
  but were not imported by this child. No browser security settings were changed.
- The parent's first Prepare Stamp preview on the development server hit a Convert to
  Bitmap worker timeout after approximately 60 seconds and was cancelled. Screenshot:
  `docs/audits/evidence/tools-quality-2026-10-16/direct-stamp-timeout.png`. The later bundled-runtime
  success does not erase that timeout or establish a code repair for it.

All 26 tools have both representative automated browser and direct computer-use evidence.
Remaining work to claim every tool is qualified: run tool-specific maximum-size/cancellation/
save-reopen cases where marked missing, and
separately qualify installed desktop/device-dependent workflows. The sampled Warp/Deform
estimates and whole-scene work limits remain the explicit numerical limitations above.
