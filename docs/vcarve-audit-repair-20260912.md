# V-carve audit repair — 12 September 2026

The changes address all five reproduced audit findings and the internal depth-quality
counterexample. They build on `9134c3e74dbe1f4760729660e4d7ba56264b90fa`, including PR #782's
actual-clearing-based rest finishing. The original working checkout and the audit snapshot
were preserved. The working branch is `codex/vcarve-audit-fixes-20260912`.

## Reproductions and changes

| Finding | Reproduced behavior | Repair and regression evidence |
| --- | --- | --- |
| Stretched stroke conversion | Converting a 0.5 mm stroke around a 4 mm square stretched 2× in X discarded its width. The protected centre became a roughly 2 mm deep carve. | Preserve and compose an affine round-pen transform alongside the current centreline. Independent swept-cone probes keep centre removal at zero through conversion, Weld and save/reopen. |
| Script conversion | Changing a text object to an imported path lost nonzero winding. Overlapping glyph joins cancelled under even-odd fill. | Persist path winding; apply it in CNC, laser fill and canvas consumers. The bundled Dancing Script “Drive” retains every independently sampled fill point after conversion, repeated conversion and reopen. |
| Clearing dependency order | An earlier operation using a V-bit caused tool grouping to move a later V-bit finish before that finish's own clearing mill. | Group only ready operations. Repeated tools, crossed dependencies, multi-stage clearing, tiled regrouping and registration retain clearing prerequisites and profiles-last order. Independent stock-removal probes show the shortened finish depends on actual prior clearing. |
| Impossible depth-pass allocation | A 1 mm depth with a 10⁻¹² mm step attempted an array with one trillion entries. Some preflight eligibility checks also constructed depth arrays. | Check the existing array-length domain before allocation; count without allocation in preflight. Normal and dot compilation, synchronous and worker preparation, disabled operations and unrelated range errors are covered. |
| Final represented containment | Tiny rounded points outside the source received cutting depth from unsigned distance. Later fractional origin placement could also consume the original boundary certificate. | Require region membership and reserve final XY displacement. Round new V-carve depth levels and clipped Z toward the surface. Independent ordinary/tiled G-code probes cover holes, fractional placement, sharp/wide angles and flat tips. |
| Internal depth-quality defect | Two zero-depth endpoints could report accuracy even when a square's diagonal passes through 5 mm of required depth. | Refine and certify the interior depth field, then check the stitched profile; zero endpoints alone are insufficient. |

Independent review also reproduced and repaired three boundary cases: a rank-one pen
edited across its surviving axis still sweeps material; inverse arithmetic overflow must
produce a geometry error rather than a solid-fill or empty fallback; and a long chord
must not be falsely certified across a tiny protected hole through cancellation at large
coordinates. Integration testing additionally showed that compaction must retain
cutting-to-surface transitions to preserve fine source corners.

## Geometry and compatibility

- Project schema **7** preserves `fillRule` and `strokeTransform`. Legacy v6 projects
  migrate without geometry changes. Older readers reject v7 instead of silently changing
  cut regions. Corrupt winding/matrix data is validated on load.
- Affine pen metadata transforms the current geometry. It preserves later node edits,
  mirrors, rotations, nonuniform scaling, repeated conversion, cloning and Weld; it does
  not store a cached outline that can become detached from edited paths.
- Anisotropic stroke expansion and text winding do not replace laser or engraving
  centrelines. Converted font paths retain their fill semantics when switching operations.
- Final XY rounding at a 0.001 mm grid moves each endpoint by at most
  `sqrt(2) × 0.001 / 2` mm. Linear chords inherit this bound. The certificate reserves
  this distance plus numerical slack. Newly generated depth levels and tile-clipped Z
  round toward the stock surface, preventing extra cutter-radius growth. A newly clipped
  Z may be less than 0.001 mm shallower. Its corresponding radial loss is less than
  `0.001 × tan(angle / 2)` mm: below 0.001 mm for a 90° cutter, approaching 0.1146 mm
  for the extreme supported 179° cutter. This is a tiled output-grid limit.
- The physical cutter dimensions, flat-depth setting and Detail pitch keep their meanings.
  A pointed cutter leaves floor scallops. Independent final-G-code tests cover 30°, 60°,
  90°, 120° and 150° tools with pointed and flat tips at multiple Detail pitches, plus the
  audited narrow 30° L-shaped floor. For a pointed cutter, the pitch contribution to the
  worst ridge is bounded by `pitch / (2 × tan(angle / 2))`; path approximation and output
  representation contribute separately.
- Emitter revision: `vcarve-audit-repair-20260912-v1`.

## Verification

The focused tests exercise real conversion/store/compiler/persistence paths. Two Chrome
workflows open a CNC project, export a control program, Convert to Path, save, reopen,
export again and independently measure the final program at the protected centre or
joined text region. They also wait for the route preview to finish and capture it.
File-picker and serial APIs use the repository's browser fixtures; the scene, workers,
conversion, serialization, preview and output pipeline are the application code.
A third Chrome workflow exercises the unrepresentable pen: it displays the geometry
error, saves no partial G-code, produces no uncaught page error and sends no hardware
commands. All **three browser tests passed against both the development server and the
built production web bundle**, with preview/error screenshots retained. A separate
runtime check confirmed hashed production assets, HTTP 200 and no page or asset errors.

Final integrated checks passed:

- Full Vitest suite: **13,458 tests passed**, 22 existing tests skipped; **2,067 files
  passed**, 14 skipped. The frozen run completed in 1,035.18 seconds with no failures.
- Release-integrity script suite: **78 tests passed**.
- All three V-carve Chrome workflows passed against development (33.6 seconds) and
  production (9.8 seconds) builds. Browser-test TypeScript checking also passed.
- TypeScript, full ESLint, Electron ESLint and repository formatting checks passed.
- ADR numbering, action pinning, license closure, file-size and public-export checks
  passed. Browser discovery found all 40 suites and the separate production-bundle
  suite. The existing soft-size report remains advisory (195 files above its soft limit).
- Production web and Electron main-process builds passed. The working source was
  verified before the local repair commit; build labels retain that pre-commit base
  identity. This is local source/build evidence, not a published release qualification.

The production web build and Electron main-process build passed. The first web build
hit Windows' virtual-memory limit while several checks ran concurrently. Its retry
passed with process-local Go compiler concurrency and memory controls
(`GOMAXPROCS=2`, `GOMEMLIMIT=1024MiB`); no system settings or application code changed
to accommodate the build. The web build still reports its existing large-chunk warning.

The original independent coverage experiment was replayed against the fixes with the
same 100 shapes/settings, 168,100 probes and 200 dense checks of its analytic swept-cone
oracle. Maximum sampled overcut was **0 mm**, with no empty programs. The ordinary
24-case maximum sampled depth shortfall changed from **0.006480 to 0.006616 mm**.
Across the full experiment, the largest shortfall changed from **0.180777 to 0.183777 mm**
in the known 30° depth-capped floor scallop case.

One coarse-Detail sample is unchanged: a 64-sided circle at 30° and 1 mm Detail leaves
an expected 0.013801 mm shallow boundary cut untouched. Its ordinary 90°/automatic-Detail
control has no such missed samples. These finite measurements do not establish exact
continuous coverage at every setting. All 480 separate octagon corner probes retain
positive removal after the compaction correction, with maximum depth shortfall
**0.001859 mm**, including probes just 0.003 mm inward from the source vertices.

## Output size and compaction

The added containment reserve initially exhausted the existing 250,000-check compaction
budget on a connected-script fixture. Checking the mapped capsule before its neighbours
recovers valid compact paths within that same budget. Independent review checked 58
neighbourhood cases and 4,408 match/budget cases: the candidate set, acceptance predicate
and total failed-search cost remain unchanged. A mapped hit takes one check instead of
nine. The long-chord correction also preserves the analytic extrema and tolerance while
evaluating the geometric residual without the reproduced cancellation.

The four-artwork script fixture now emits **1,083,328 UTF-16 code units**
(1,083,340 UTF-8 bytes), **4.59%** above the base program. All 24 depth profiles meet
their requested tolerance; the largest observed coverage check count is 210,707.
Its exact text digest is retained in the regression. A separate 28,000-chord test
protects the budget behavior. The constrained artifact fixture has 17,589 lines; its
450 kB size bound, pass/depth and region-entry assertions, and modelled 16-block GRBL
wire margin still pass. These fixture measurements are not hardware cycle-time results.

## Scope of the result

The original audit evidence is retained at
`C:\Users\Asus\.codex\audits\vcarve-20260912-01a09562`.
Repair evidence is retained at
`C:\Users\Asus\.codex\audits\vcarve-fixes-20260912-01a09562`.

This repair does not merge, publish, deploy or operate hardware. It preserves the exact-job
Frame and advisory Job Review policies. Software containment and sampled removal checks
do not establish controller, packaged-desktop, air-cut or material-cut qualification.
