# CNC speed and quality remediation

27 September 2026. Quality first; all supported controller families have equal
priority within their actual capabilities. This is the CNC implementation lane
for the user's instruction to fix the audit findings.

## Evidence boundary

The audit captured dirty checkout `a37082457b76d56b8c9ba92be27db027b5a92cb0`.
Remediation instead starts from current main
`c81504fcda188b71652f9fe32597d8c435c5bc54` in the isolated shared worktree
`D:\LaserForge\speed-quality-remediation-20260927`. The primary C: checkout is
preserved. Several high-priority findings were already fixed on this newer base;
they are not represented as newly fixed by this change.

No hardware was operated. No merge, deployment or physical cutting qualification
is implied. Frame for the exact reviewed job remains the sole ordinary Start
policy gate. CNC motion is still supported only on the existing GRBL, FluidNC and
grblHAL families; Marlin, Smoothieware and Ruida retain `cncJobs: false`. Equal
attention does not mean inventing CNC support in a laser-only output strategy.

## Per-finding status

| Audit finding | Revalidated status and remediation | Main evidence |
|---|---|---|
| C1: one-peck drilling omitted | Already fixed on base. A drill cycle explicitly starts at stock top, giving even one peck a real segment. The generic path3d emitter's rejection of degenerate one-point paths remains appropriate. | `src/core/cnc/drill-peck.ts:40`; ADR-318; existing drilling/output regressions |
| C2: tool grouping broke clearing/profile dependencies | Already fixed on base. Global clearing and profile phases are separate; ready tool sections respect secondary-stage prerequisites. New stage splitting preserves same-cutter part order and existing operation dependencies. | `src/core/cnc/cnc-tool-sections.ts:14`; ADR-310/319; `cnc-stage-recipes.test.ts`; `compile-cnc-part-order.test.ts` |
| C3: finishing-only shallow relief omitted | Already fixed on base. Finishing is compiled independently of an empty roughing pass list. Preserved under independent finishing recipes. | `src/core/cnc/compile-cnc-relief.ts:120`; `relief-finishing-compile.test.ts` |
| C4: requested scallop could be exceeded by grid rounding | Already fixed on base. Row stride floors the request; compiler finishing resolution is no coarser than requested spacing and uses the tapered ball tip where relevant. Rows include the far edge. Planar geometric scallop is not a universal material roughness guarantee. | `src/core/relief/relief-finishing.ts:56`; `src/core/cnc/compile-cnc-relief.ts:58`; ADR-289/368 |
| C5: relief transforms changed physical cutter/spacing | Already fixed on base. XY scale is included before physical cutter dilation and spacing; residual placement is applied afterward. New links require residual isometry. Shared curve flattening was revalidated separately by the coordinating lane. | `src/core/cnc/relief-machine-space.ts:23`; `compile-cnc-relief.ts:249`; ADR-289 |
| C6: displayed chart chipload differs from programmed value | Fixed. Display chart target separately from nominal chipload after feed limits and exact F/S representation. F>=1 uses the emitter's floor policy; supported fractional feeds remain fractional. Job Review derives nominal chipload from the actual compiled group and cutter flute count. | `src/core/cnc/nominal-chipload.ts`; `src/ui/layers/FeedsCalculatorRow.tsx:133`; `src/ui/laser/job-review/job-review-effective-operations.ts:89` |
| C7: secondary/finish cutters shared one cutting recipe | Fixed. Optional cutter-bound recipes for pocket roughing, V clearing, relief finishing and profile wall finishing; explicit UI/manual/material-starting values; stage-specific actual feed/plunge/RPM/depth, provenance and review labels; schema 11 persistence. Missing or wrong-cutter recipe preserves shared defaults. Profile stage markers survive lead/ramp conversion and disappear from final passes. | `src/core/scene/cnc-stage-recipe.ts`; `src/core/cnc/cnc-stage-settings.ts:14`; `compile-cnc-job.ts:396`; `profile-finishing-stage.ts`; `src/ui/layers/CncStageRecipeFields.tsx`; `src/io/project/project-cnc-stage-validator.ts` |
| C8: flat V clearing did not remove redundant V work | Already fixed on base with stock-aware V finishing. Preserved while the clearing cutter obtains its own recipe. This does not promise a shorter total job after manual tool change/touch-off. | `src/core/cnc/vcarve-rest-finishing.ts`; its regression suite; `cnc-stage-recipes.test.ts` |
| C9: every relief row retracted/replunged | Fixed conservatively for proved planar interior cases. Full cylinder/domain/sample/representation proof, exact existing-row retraces, stage-aware feed-cost rejection, one original pass per row, and exact original-row restoration for later origin/tile changes. All unsupported proofs retain independent entries. | `src/core/relief/relief-planar-row-links.ts:19`; `relief-row-link-cost.ts:15`; `relief-finishing.ts`; `src/core/job/job-origin.ts:281`; `src/core/cnc/tile-plan.ts:176` |
| C10: diagnostic replanning and incomplete quality-budget disclosure | Most evidence propagation was already fixed on base. Remaining dropped-vector diagnostics now consume compiled groups before any contour collection/planning, and missing compiled operations avoid an unnecessary pocket planner. Existing named completion/materialization and resolution evidence remains intact. Stage depth routing is integrated by the app lane. | `src/core/cnc/compile-cnc-diagnostics.ts:17`; `compile-cnc-diagnostics-prepared.test.ts`; existing relief/offset evidence suites |
| C11: shallow surfacing depth and hidden cutting recipe | Core shallow-depth preservation was already fixed on base; original observation concerned the API, not a confirmed normal UI path. Newly expose feed, plunge, RPM and stepdown with active-tool/material starting values and machine limits. Visible fields reach saved G-code, including exact final remainder depth. | `src/core/cnc/surfacing.ts:148`; `src/ui/machine/SurfacingFields.tsx:13`; `save-surfacing-program.ts`; `SurfacingPanel.test.tsx` |

## Stage recipe behaviour and identity

Absent recipes retain the old output policy. Profile wall finishing initially
seeds its independent stepdown with the whole depth so merely enabling the
control preserves the old one-pass finish. The operator may then choose smaller
finish steps. Relief finishing follows its sampled surface, so its recipe shows
feed/plunge/RPM and does not falsely offer stepdown as an active finishing control.

The recipe is bound to a cutter ID and does not automatically follow a different
selected tool. The UI explains inheritance when a retained recipe belongs to a
different cutter. Explicit numeric recipes remain manual when material changes;
the operator may request fresh material/tool starting values. The material action
does not silently overwrite another stage's manual values.

Schema 11 prevents an older reader silently discarding these physical motion
settings. Malformed present recipes fail structural loading instead of reverting
feeds/depths behind the operator's back. Legacy files migrate with no fabricated
recipe. The app reviewer independently traced complete scene/machine retention
keys, immutable CNC/tool edits, exact prepared review keys, Frame signatures and
prepared-project/nonraster recovery cloning: no omitted stage allowlist was found.

## Relief link proof and measured tradeoff

The first proposed edge shortcut was rejected during independent review because
the swept strip extended outside the known heightmap domain. The implemented
version retraces exact row vertices inward, crosses vertically with its entire
cutter cylinder inside the known physical width/height, then retraces the next
row's existing vertices to preserve complete original coverage. Every overlapping
sample plus one sample halo must lie at or below the represented cutting Z.
Actual transformed/GRBL-parsed endpoint XY error enlarges the envelope; it is not
assumed to be a fixed decimal-rounding error. Masks and non-isometric residual
transforms skip linking. Nonzero later origin changes and all tile clipping strip
the exact prefix and restore the original rows before geometry changes.

The represented added prefix distance at the capped stage feed must cost less
than the removed plunge at the capped plunge feed. Removed rapid time is ignored
in this conservative selection. The geometric proof runs before this economic
filter. Unknown values keep independent entries. Neither calculation models
unrecorded fixtures, unsampled source detail, actual forces or measured surface
quality; the acceleration/transport model also remains an estimate.

Deterministic fixture: flat -2 mm heightmap, 40 by 40 cells at 0.25 mm, physical
10 by 10 mm, 3.175 mm ball nose, 0.025 mm scallop request, safe Z 5 mm, S12000,
no spindle dwell. Device is the repository's generic GRBL 400 by 400 starter with
6000 mm/min max feed, 500 mm/s² acceleration and 0.01 mm junction deviation.
Results come from actual emitted G-code and `estimateJobDuration`:

| Recipe | Rows | Safe-Z commands | Motion points | Lines | Software estimated seconds |
|---|---:|---:|---:|---:|---:|
| F1000/plunge200, independent | 21 | 22 | 840 | 897 | 63.561 |
| F1000/plunge200, qualified links | 21 | 9 | 1009 | 1027 | 36.271 |
| F100/plunge1000, independent | 21 | 22 | 840 | 897 | 138.870 |
| F100/plunge1000, final selection | 21 | 22 | 840 | 897 | 138.870 |

The normal fixture removes 13 retracts and reduces this estimate 42.9%. It adds
points and output lines. An intermediate implementation without the economic
filter estimated 156.653 seconds for the slow recipe, a 12.8% loss; final selection
rejects those links and retains byte-equivalent independent geometry. No universal
runtime or physical finish improvement is claimed.

Reproduction source, bundled probe and JSON evidence are in
`D:\LaserForge\audits\2026-09-27-speed-quality\cnc-remediation\`.
`row-link-evidence.json` records the intermediate cost comparison;
`row-link-evidence-final.json` records the final filter. The build command is:

```text
node node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/bin/esbuild D:/LaserForge/audits/2026-09-27-speed-quality/cnc-remediation/row-link-evidence.ts --bundle --platform=node --outfile=D:/LaserForge/audits/2026-09-27-speed-quality/cnc-remediation/row-link-evidence.cjs
node D:/LaserForge/audits/2026-09-27-speed-quality/cnc-remediation/row-link-evidence.cjs
```

## Focused verification

All commands run from the isolated worktree, with `--maxWorkers=1`. Counts below
are separate overlapping runs, not distinct-test totals. Full integration gates
belong to the coordinating report.

1. Initial nominal chipload/feed calculator/UI/compiler/part-order selection:
   5 files, 41 passed, 22.47 seconds. Later exact feed representation refinements
   were covered in the final nominal suite below.
2. Stage recipes, prepared diagnostics, nominal chipload, schema persistence,
   migrations and surfacing UI-to-output: 6 files, 34 passed, 24.46 seconds.
3. Relief finishing recipe integration, stage recipes, part ordering, secondary
   feed advisories and effective Job Review: 5 files, 44 passed, 16.90 seconds.
4. Final relief cost selection, row-link proof, finishing compile, mask safety
   and tapered ball: 5 files, 30 passed, 15.03 seconds.
5. Independent reviewer ran the preceding geometry/origin/tile proof snapshot:
   4 files, 26 passed, 15.43 seconds. The final cost addition is covered by the
   30-test run above and has been submitted for independent review.
6. Coordinating task verified the actual browser stage flow: enable wall recipe,
   edit F321/plunge72/S7100/0.7 mm stepdown, retain primary F900, compile, Save As,
   reopen exact groups, and disable to return to shared values. One browser test
   passed and the laptop layout was visually inspected.

Final selected test commands:

```text
pnpm exec vitest run src/core/cnc/cnc-stage-recipes.test.ts src/core/cnc/compile-cnc-diagnostics-prepared.test.ts src/core/cnc/nominal-chipload.test.ts src/io/project/project-cnc-stage-recipes.test.ts src/io/project/migrations.test.ts src/ui/machine/SurfacingPanel.test.tsx --maxWorkers=1
pnpm exec vitest run src/core/cnc/relief-finishing-compile.test.ts src/core/cnc/cnc-stage-recipes.test.ts src/core/cnc/compile-cnc-part-order.test.ts src/core/preflight/cnc-secondary-tool-feed.test.ts src/ui/laser/job-review/job-review-effective-operations.test.ts --maxWorkers=1
pnpm exec vitest run src/core/relief/relief-row-link-cost.test.ts src/core/relief/relief-planar-row-links.test.ts src/core/cnc/relief-finishing-compile.test.ts src/core/relief/relief-finishing-mask-safety.test.ts src/core/relief/relief-finishing-tapered-ball.test.ts --maxWorkers=1
```

Earlier iteration failures were test-fixture defects: omitted migration step 10
in an explicit mock registry; missing tool diameter in a synthetic emitted CNC
group; and a raised obstruction placed on the wrong side of the serpentine
connector. These were corrected and rerun. Independent review also strengthened
initially vacuous boundary-based Z/height tests to interior positive-control cases.
Final tests include partial terminal cells, 45-degree placement at large machine
coordinates, exact translation/tile restoration, positive fractional F words and
unknown-cost fallback. Targeted ESLint checks pass after budget-preserving helper
extraction; full lint/type/build/format results are owned by the coordinator.

## Remaining physical qualification

Qualify each cutter/material/machine recipe with controlled coupons and record
dimensional error, surface appearance, burrs/chatter/burning, actual RPM, chip
evacuation, tool wear, total time including changes, and rework. Compare links on
representative reliefs only after confirming stock/fixtures and source resolution.
Retain independent entry whenever proof fails. These changes do not increase
global feeds, discard geometry, coarsen finish targets or add new Start policy
gates. General curve fitting, more aggressive pocket linking and universal adaptive
machining remain separately scoped work rather than unsupported speed claims.
