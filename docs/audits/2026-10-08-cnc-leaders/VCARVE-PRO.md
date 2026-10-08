# VCarve Pro: signs and production woodworking

Audit date: 8 October 2026. KerfDesk main baseline: `e3820ed51a8d3e9ae8eab16f47097c4011dbd703`. The [overview](REPORT.md) records evidence limits and the 104-test baseline. Proposed work is consolidated in [IMPLEMENTATION.md](IMPLEMENTATION.md).

**VCarve Pro's strongest advantage is repeatable production: it connects geometry selection, stock, tools, sheets, machining and shop-floor handoff. KerfDesk already has many of the cutting algorithms; its main opportunity is to preserve and reuse machining intent.**

This is a source and documentation comparison. Workflow advantages are our fit judgments. Comparative surface quality, calculation speed, cycle time and learning effort were not measured.

## Product and version boundaries

Vectric's current pages identify V12.5. The detailed links below deliberately use the verified **V12.0 VCarve Pro manual**, so their version is explicit. They describe documented functions rather than every latest-release improvement. Pro adds production features such as nesting, templates, gadgets and setup sheets over Desktop. The Advanced Machining Module is a separate V12+ add-on; cabinet import, drill banks and controller cutter compensation should not be attributed to every base Pro installation. [Current VCarve comparison](https://www.vectric.com/products/vcarve/), [upgrades](https://www.vectric.com/upgrade/vcarve/), [Advanced Machining Module](https://www.vectric.com/products/advanced-machining-module/).

VCarve also imports 3D models and provides roughing/finishing, multi-tool relief rest finishing and projection of conventional toolpaths onto a model surface. Aspire's distinctive advantage is native artistic relief construction. For KerfDesk, keep the existing imported-relief CAM and selectively add residual finishing and surface-following vector work. [Current 3D machining and projection scope](https://www.vectric.com/products/vcarve/). Ledger R05/R06.
Pending [#1084](https://github.com/cisgz3a-hub/KerfDesk/pull/1084) and [#1087](https://github.com/cisgz3a-hub/KerfDesk/pull/1087) already contain sheets, hierarchy, retained arrays, improved nesting controls and production manifests. Those are pending branch implementations. Recommendations below extend that work where appropriate.

## 1. Material, stock, datums and sheets

VCarve records stock dimensions, surface/table Z zero, XY datum and editable sheets. [Job setup](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Job%20Setup%20Single/index.html), [sheet management](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/SheetManagement/index.html).

KerfDesk has a real stock footprint, thickness, material key and XY offset; CNC depth references stock-top Z0. Its [stock model][K-stock] and [project model][K-project] contain one current CNC configuration. Pending sheets archive inactive project setups, which already preserves useful context.

**VCarve is stronger in manufacturing organisation. Extend** sheets with explicit stock/material/setup identity, quantity and remnant metadata. This fits existing project ownership and prevents one sheet's settings from being mistaken for another's. Alternate Z datums require an explicit coordinate contract.

**Acceptance:** two sheets with different thickness/material reopen correctly; activating one restores its setup and cannot reuse output prepared for the other. Ledger C01/C03/C08.

## 2. Vector validation and repair

VCarve marks intersections, overlapping contours and zero-length spans, includes a V-carving interpretation and permits zero-span repair. [Vector Validator](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Vector%20Validator/index.html).

KerfDesk already [joins paths without merging independently owned machining][K-join] and [compares transformed geometry plus operation binding for duplicates][K-duplicates]. Those are valuable repair foundations. The reviewed design/geometry surfaces do not establish a comparable navigable operation-aware defect list.

**VCarve is stronger in documented defect discovery. Extend** repair with canvas markers, a defect list and an explanation of the affected operation. Preserve curves, manual tabs and semantic ownership when a repair is accepted.

**Acceptance:** overlapping outlines, zero spans and an ambiguous endpoint cluster are individually discoverable; repairs are previewed and undoable. Ledger C07 and the follow-up backlog.

## 3. Nesting, grain and quantities

VCarve supports rotation increments, optional mirroring, hole nesting, part copy counts, boundary exclusions and paired-side nesting. Rotation/mirror restrictions are useful for directional material; the documentation does not establish a separate comprehensive grain ontology. [Nest Parts](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Nest%20Parts/index.html).

KerfDesk's [quick nest][K-quick-nest] packs rectangular units with quarter-turn rotation and obstacles. Its [outline compactor][K-outline] uses real contours with a conservative fallback. Pending work extends goals, rotations, grain constraints and cancellation.

**VCarve is stronger in demand-to-sheet production. Extend** persistent quantities and material-compatible allocation. Keep attached engraving and holes tied to the part through every placement.

**Acceptance:** twelve constrained A parts and seven B parts use compatible sheets, preserve direction and list unplaced demand explicitly. Independently check containment and collisions. Ledger C08.

## 4. Tool database and cutting data

VCarve separates cutter geometry from machine/material cutting data and provides hierarchy, notes and import/merge. [Tool Database](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Tool%20Database/index.html).

KerfDesk has custom bits, named machine profiles and saved feeds. [Feed presets][K-feeds] are named numeric records without cutter/material/machine bindings. Its automatic starter resolver already records provenance; those values should remain provisional where unqualified.

**VCarve is stronger in workshop data identity. Extend** the existing library with context-bound cutting records, qualification notes and reviewed application. This improves reuse without inventing universal feeds.

**Acceptance:** a cutter can have distinct plywood/hardwood records for two routers; changing the library does not silently change an operation's reviewed numbers. Ledger C04.

## 5. V-carving

VCarve offers start depth, flat depth, ordered clearance tools and selectable start points alongside variable-depth carving. [V-Carve Toolpath](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/VCarve%20Toolpath%20Creator/index.html).

KerfDesk already has [medial V-carving with emitted-grid depth certification][K-vcarve], flat-depth controls, V-specific ramps and a clearance stage. It is inaccurate to describe V-carving as absent or elementary solely because the competitor has more controls.

**VCarve is stronger in setup flexibility; output quality is unmeasured. Extend** explicit starting-surface and ordered clearing intent through current stage recipes and dependencies.

**Acceptance:** lettering within an existing pocket references the intended surface; clearance tools precede their dependent finish; fine/unreachable detail remains disclosed. Ledger C05/C07 and follow-up controls.

## 6. Tapered V-inlay and straight inlay

VCarve generates tapered plug/pocket toolpaths with glue-gap and surface-clearance settings. The manual says the generated pair is no longer linked after creation. [VCarve Inlay](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/VCarve%20Inlay%20Toolpath/index.html).

KerfDesk's [inlay pair][K-inlay] is straight-sided: female pocket and male outside profile. That should remain a valid distinct workflow.

**VCarve is stronger in tapered inlay availability. Add** linked source/cutter/gap intent for a separate V-bit mode. Keeping the halves linked could improve revision handling over the documented Vectric behaviour, but that is a proposed future advantage.

**Acceptance:** angle/source edits regenerate both halves; analytical mating geometry checks contact and both clearance types; later physical coupons verify actual fit. Ledger C09.

## 7. Production profiling

VCarve supports selected entry points, editable depth passes, tool-radius compensation and last-pass allowances. [Profile Toolpath](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/uiProfileMachineForm/index.html).

KerfDesk already offsets profiles, orders inner cuts and retains rough/finish stages. Its [depth ladder][K-depth] derives levels from total depth and maximum step-down.

**VCarve is stronger in editable production controls. Extend** explicit depth schedules and feature entry choices, preserving current finish and tab geometry. A thin facing can then be treated deliberately rather than using a uniform schedule.

**Acceptance:** a laminated-board fixture uses the requested depths, retains inside-first order and preserves tab alignment through finishing. Follow-up backlog V04.

## 8. Pocketing and rest clearing

VCarve allows an ordered clearance-tool list and remaining-stock machining with finishing allowance. [Pocketing](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/uiPocketMachineForm/index.html).

KerfDesk already offers offset/raster/adaptive strategies, stay-down links, helix entry and two-tool rest pocketing. The [rest resolver][K-rest] has explicit unsupported adaptive/helix combinations. These restrictions must be resolved through valid stage dependencies, not removed cosmetically.

**VCarve is stronger in arbitrary tool-chain authoring. Extend** stages to multiple clearing tools with deliberate wall/floor finish allowance. Retain current geometric checks.

**Acceptance:** 12/6/3 mm tools clear an island pocket; later stages act on accessible residual material and still finish the requested boundary. Ledger C10.

## 9. Drilling

VCarve has drill geometry, start depth and full/relative peck retract settings. [Drilling](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Drilling%20Toolpath/index.html).

KerfDesk's [peck planner][K-drill] drills closed-contour bounding-box centres using explicit plunge-feed pecks returning to stock top. Its [tool-kind model][K-tools] has no dedicated drill geometry.

**VCarve is stronger in drilling configuration. Extend** explicit hole centres, drill geometry and peck-clearing heights. Explicit motion remains appropriate for controllers without canned cycles.

**Acceptance:** a hole below a pocket floor has the intended start depth, cutting feed and retract. Follow-up V01.

## 10. Decorative fluting

VCarve varies depth along a vector with selectable end tapering. [Fluting](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Fluting%20Toolpath/index.html).

The reviewed [CNC operation model][K-cut-types] has no decorative fluting mode. A contour entry ramp is a different machining intent.

**VCarve is stronger in availability. Add selectively** an operation that emits supported 3D path passes. This is useful for sign borders and decorative furniture when users need it.

**Acceptance:** reversing a curve reverses end-taper meaning; the path reaches the specified depth and respects depth-per-pass. Follow-up V02.

## 11. Machined textures

VCarve creates randomised grooves or uses selected vectors with boundary, depth and length controls. Its manual explicitly says ordinary Pass Depth does not govern this strategy; that behaviour should not automatically become our policy. [Texture Toolpath](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Texture%20Toolpath/index.html).

KerfDesk has relief CAM, but the reviewed operation model/search does not contain an equivalent CNC texture generator.

**VCarve is stronger for quick sign backgrounds. Add selectively** seeded texture recipes with a preview, clipping and ordinary explicit passes.

**Acceptance:** reopening reproduces identical grooves; holes remain excluded; a requested deep texture has a deliberate multi-pass plan. Follow-up V03.

## 12. Moulding from rail and section

VCarve machines a section along a rail with clearance tooling, variable stepover and flat skipping, without requiring imported 3D geometry. [Moulding Toolpath](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/uiExtrudedToolpathForm/index.html).

The reviewed CNC/design model has no equivalent; a moulding bit in a catalogue is not a moulding strategy. Existing relief cutter-contact and rough/finish logic are useful foundations.

**VCarve is stronger in availability. Add later** a retained rail/section operation. Keep creating a relief surface and dedicated moulding CAM as separate functions.

**Acceptance:** open/closed rails preserve section direction, height and endpoints; clearance and finishing produce one coherent predicted surface. Ledger R07.

## 13. Tabs, ramps and leads

VCarve documents rectangular/triangular tabs, smooth/zigzag ramps and ramp-on-lead controls. [Profile controls](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/uiProfileMachineForm/index.html).

KerfDesk already carries tabs in a continuous path, completes contour ramps and supports arc/line leads. [Tab/ramp logic][K-tabs], [lead passes][K-leads].

**VCarve is stronger in configurable forms. Extend selectively** triangular-tab and ramp-on-lead intent; keep exact-depth completion and finishing-tab alignment.

**Acceptance:** a short tabbed contour reaches full-depth cleanup without weakening tabs or plunging on the finished wall. Follow-up V05.

## 14. Two-sided machining

VCarve stores both faces, flip direction and Z references. [Double-sided setup](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Job%20Setup%20Double/index.html).

Main's project model lacks machining-side identity. Pending sheets organise artwork/setups but do not themselves define a physical flip transform.

**VCarve is stronger. Add** paired setups sharing stock, registration features and a declared flip transform. This fits production-router work after setup identity is established.

**Acceptance:** independently derived asymmetric coordinates align for both supported flip directions; every review/export names its face and datum. Ordinary Frame evidence remains governed by placement/footprint. Ledger D01.

## 15. Rotary CNC

VCarve defines cylinder dimensions, wrap axis and surface/axis Z zero. [Rotary setup](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Job%20Setup%20Rotary/index.html).

KerfDesk's [rotary predicate][K-rotary] explicitly applies to laser and excludes CNC. Roller/chuck laser scaling does not supply router angular-axis kinematics.

**VCarve is stronger in router rotary availability. Add later** as a qualified capability with wrap simulation and controller-specific output.

**Acceptance:** a revolution has independently verified angular travel, seam and direction for a declared controller. Physical-machine/accessory qualification is separate. Ledger D04.

## 16. Machining templates and vector selectors

VCarve selects closed/open/circular vectors on named layers and reapplies template settings to new geometry. [Vector Selector](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/vector-selector/index.html), [Toolpath Templates](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/toolpath-templates/index.html).

KerfDesk already serialises complete project templates and [applies process recipes with tools and operations][K-apply]. The [recipe model][K-recipe] has revisioned multi-step machining intent; per-path assignments depend on path count/order. The missing improvement is semantic re-selection, not a template library from scratch.

**VCarve is stronger in reusable geometry rules. Extend** recipes with previewed selectors for named roles, groups, shapes and import layers. An AMM-style cabinet adapter can later use those foundations.

**Acceptance:** a revised panel reselects pocket/drill/cutout roles and shows matches before Apply; missing roles and cutter remaps are clear; applying again does not duplicate stages. Ledger C07.

## 17. Simulation and customer proofs

VCarve offers sheet material appearance, machined-area colours and animated removal. [Preview Toolpaths](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Preview%20Toolpaths/index.html).

KerfDesk [stamps per-step tool geometry][K-sim] and its parsed-program stock view uses tool identities. This is substantial artifact inspection. Budgeted grids and unmodelled holders/fixtures must remain disclosed.

**VCarve is stronger in documented presentation controls. Extend** printable proof export with material appearance, stage/tool isolation, sheet/side identity and resolution. Appearance is presentation; it does not certify machine finish.

**Acceptance:** a proof identifies the exact prepared program and unknown tool assumptions. Ledger C06/C11.

## 18. Post-processors and shop-floor setup sheets

VCarve exposes versioned post content and creates HTML job sheets with layout, datum, tools, clearance and time information. [Post content](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/post-processor-content/index.html), [Create Job Sheet](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/create-job-sheet/index.html).

KerfDesk already has declared [output dialects][K-dialects] and compiled tool-plan extraction; the bounded export search did not establish a comparable CNC setup-sheet exporter.

**VCarve is stronger in handoff documentation and post portability. Add** exact-artifact setup sheets now. Extend output strategies only for documented controller capabilities; AMM drill banks/compensation are separate machine-dependent functions.

**Acceptance:** documentation uses actual compiled tools, order, stock, side, datum, safe Z and digest, with estimate assumptions. Ledger C06/D04.

## Most useful changes for KerfDesk

The practical priorities are setup identity, selector-based recipes, bound cutting data, linked V-bit inlay and exact-artifact setup sheets. These turn current algorithms into a repeatable sign-production workflow. Keep artwork/operation ownership, feed provenance, rest geometry, continuous tab paths and per-tool simulation. No finding here justifies wholesale CAM replacement.

The next measurable comparison should use the same sign, quantity-nesting and inlay fixtures in both applications. Passing source tests establish a baseline, not comparative carved quality.

[K-stock]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/machine.ts#L17
[K-project]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/project.ts#L142
[K-join]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/geometry/vector-path-join.ts#L33
[K-duplicates]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/geometry/duplicate-shapes.ts#L27
[K-quick-nest]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/nesting/quick-nest.ts#L32
[K-outline]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/nesting/outline-compact-nest.ts#L70
[K-feeds]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/ui/state/cnc-library-persistence.ts#L16
[K-vcarve]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/vcarve-medial.ts#L12
[K-inlay]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/inlay-pair-operation.ts#L23
[K-depth]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/depth-passes.ts#L27
[K-rest]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/cnc-rest-operation.ts#L40
[K-drill]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/drill-peck.ts#L1
[K-tools]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/cnc-tool.ts#L5
[K-cut-types]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/machine.ts#L63
[K-tabs]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/cnc-tab-ramp.ts#L1
[K-leads]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/profile-lead-passes.ts#L45
[K-rotary]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/job/rotary-job.ts#L16
[K-apply]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/material-library/apply-process-recipe.ts#L15
[K-recipe]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/material-library/process-recipe.ts#L20
[K-sim]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/sim/stamp-toolpath.ts#L8
[K-dialects]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/devices/gcode-dialects.ts#L1