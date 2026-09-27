# CNC speed and quality remediation

27 September 2026. Quality first; all supported controller families receive equal
attention within their actual capabilities.

## Evidence boundary

The original audit captured dirty checkout
`a37082457b76d56b8c9ba92be27db027b5a92cb0`. Implementation started from main
`c81504fcda188b71652f9fe32597d8c435c5bc54` in the isolated worktree
`D:\LaserForge\speed-quality-remediation-20260927`. The primary checkout remains
preserved. Existing repairs are distinguished from changes made by this task.

Publication integration also includes main's V-carve artifact reuse (PR #958,
ADR-444) and relief planner changes (PR #939, ADR-412, 413, 421, 422, 423, 424 and
450). Those relief planners supersede this task's initial planar-link prototype.
The prototype and its private metadata/helpers were removed before publication;
its timing figures are historical evidence, not results for the final planner.

No hardware was operated. The user confirmed that no machine is available.
Physical trials remain **NOT RUN**. A completed Frame for the exact reviewed job
remains the sole ordinary Start policy gate. CNC output remains supported on
GRBL, FluidNC and grblHAL; Marlin, Smoothieware and Ruida retain their existing
laser capabilities without fabricated CNC support.

## Finding disposition

| Finding | Current disposition and evidence |
| --- | --- |
| C1: one-peck drilling omitted | Already repaired on the implementation base. The drilling cycle starts at stock top and contains a real cutting segment even for one peck. Existing drilling/output regressions retained. |
| C2: tool grouping broke clearing/profile order | Already repaired through global phases and tool-section dependencies. Stage splitting preserves same-cutter part order and prerequisite stages; covered by stage and part-order tests. |
| C3: finishing-only shallow relief omitted | Already repaired. Finishing is independent of an empty roughing pass list; preserved with independent finishing recipes. |
| C4: requested scallop exceeded by grid rounding | Preserve the request-aligned finishing grid, conservative stride, far-edge coverage and strategy spacing from main. These constrain the sampled geometric model, not measured material roughness. |
| C5: transforms changed cutter compensation or spacing | Preserve machine-space XY scaling before physical cutter compensation and placement afterward. Main's exact sampled-surface cutter-contact implementation remains authoritative. |
| C6: chart chipload differed from programmed value | Fixed. Display chart starting values separately from nominal chipload calculated from represented feed/RPM and flute count, including feed limits and output rounding. Engagement still determines actual chip thickness. |
| C7: different cutting stages shared one recipe | Fixed. Optional cutter-bound feed, plunge, RPM and applicable depth values for pocket roughing, V clearing, relief finishing and profile wall finishing; schema 11 persistence, manual/material-starting controls, provenance and review labels. |
| C8: clearing left redundant V finishing | Base already used clearing-aware V finishing. Preserve it with stage settings and main's artifact-local V geometry cache. A tool change can still outweigh cutting-time savings. |
| C9: relief rows repeatedly retract | Main's general linked raster/roughing planners and waterline/flat-finishing strategies supersede the initial planar shortcut. Preserve these planners and remove the prototype, its cost filter and origin/tile prefix metadata. No prototype speed or cost-proof claim is transferred to the new planner. |
| C10: diagnostics repeated planning | Fixed remaining duplicate work by consuming compiled groups before contour collection or planning. Preserve actual completion, offset, resolution and materialization evidence. |
| C11: surfacing depth/recipe unclear | Base already preserved shallow final depth. Expose feed, plunge, RPM and stepdown with labelled cutter/material starting values; tests follow edited fields through saved output and exact remainder depth. |

## Stage settings and prepared-job identity

Absent recipes retain shared values. A recipe is bound to a cutter ID; selecting a
different cutter does not silently apply the old recipe. Explicit numeric recipes
remain manual when material changes. The operator can request fresh material/tool
starting values for a particular stage without overwriting another stage.

Profile finishing initially seeds stepdown with the full cut depth to preserve
the previous one-pass finish. Relief finishing follows its surface, so its recipe
exposes feed, plunge and RPM without falsely presenting stepdown as active.

Schema 11 retains these motion settings. Malformed present recipes fail structural
loading rather than silently reverting cutting values. Legacy files migrate
without fabricated recipes. Scene/machine identity, prepared review keys, Frame
signatures and recovery retain the stage settings.

A new V-carve integration regression places a non-V operation before the cached V
operation and edits stage settings immutably while keeping the same artwork. It
checks actual operation indices, emitted stage values/depth/order, unchanged old
artifact output after refinalization, and one V contour collection per artifact.

## Relief integration and quality limits

The compiled job uses main's X/Y raster, raster-plus-waterline and roughing-endmill
flat-finishing strategies. Stage recipes apply to the relevant finishing groups
without changing their passes, bounds or planning evidence. The four integration
cases check those properties together with represented F321, plunge 123 and S9000.
There is no separate crosshatch setting in the current implementation.

Main's relief path reduction permits up to 0.002 mm of extra stock relative to
its unreduced sampled path. This is a bounded geometric allowance, unlike the
lossless laser Fill text compaction. It does not certify subcell source detail,
fixtures, workholding, cutter runout or a physical surface finish. Final cycle
speed and quality require machine/material trials; no universal gain is claimed.

The prototype used a planar interior connector with a represented feed-cost
filter. Its removal avoids stacking two linking systems and leaves the current
planner responsible for relief geometry. The old prefix metadata and restoration
hooks have no remaining consumers. Shared Preview/ETA source reuse is retained.

## Historical prototype measurements

These figures describe the superseded implementation at `a016f9063`, not the
publication candidate. A 10 by 10 mm flat model with a 3.175 mm ball nose and
0.025 mm requested scallop estimated 63.561 seconds with independent entries and
36.271 seconds with the prototype at F1000/plunge200. At F100/plunge1000 its cost
filter retained the original 138.870-second estimate. These software estimates
were never physical cycle measurements and do not establish current-plan gains.

Archived probe source and JSON remain under
`D:\LaserForge\audits\2026-09-27-speed-quality\cnc-remediation`. They depend on the
historical implementation; deleted prototype tests are not current release checks.

## Verification

Initial stage/persistence, chipload, diagnostics, part-order and surfacing checks
are recorded in the coordinating report and archived logs. Their overlapping run
counts are not added as a distinct total. The initial browser workflow enabled a
profile recipe, edited its values, compiled, saved, reopened and disabled it while
preserving the primary recipe; no machine was connected.

Publication integration added these checks:

- V-carve artifact/stage reuse: 12 files, 61 passed, one existing opt-in benchmark
  skipped; scoped lint and formatting passed.
- Relief/contact/mask/origin/tile reconciliation: 149 distinct tests across
  13 files passed. Four strategy cases preserve exact passes, planning evidence
  and bounds while emitting the selected stage values. Scoped lint, formatting
  and diff checks passed.

The first relief run caught four test assertions that assumed spaces between
compact G-code words. Those assertions were corrected. An existing tiny-ball
spacing fixture exceeded its default timeout at roughly a million cells; its
surface was reduced from 12 mm to 1 mm while retaining the same tool, cusp, grid,
spacing formula and more than 20 rows. Production behavior and timeout policy
were unchanged. The affected 18-test suite then passed; the other 12 files had
already passed. Logs and the hash manifest are in the `publication-cnc` directory.

Full release checks and exact PR/main/deployment identities are recorded in the
publication evidence directory once completed. This report does not turn a
focused passing run into a full release or physical qualification claim.

## Physical qualification

The accompanying pack provides setup records, artwork fixtures, measurement
sheets and paired A/B trials for all supported families. Applicable trials remain
**NOT RUN** and unsupported CNC combinations are **NOT APPLICABLE**. Record actual
cutting time, tool changes, surface appearance, dimensions, burn/kerf or chatter,
chip evacuation and rework before promoting any machine/material recipe.
