# Autodesk Fusion: engineering CAD and manufacturing

Audit date: 8 October 2026. KerfDesk main baseline: `e3820ed51a8d3e9ae8eab16f47097c4011dbd703`. The [overview](REPORT.md) records the 104-test baseline and limits; the [implementation ledger](IMPLEMENTATION.md) consolidates priorities.

**Fusion is stronger for dimension-driven engineering and manufacturing context. Its most useful lessons for KerfDesk are explicit setup ownership, tool assemblies, contextual cutting presets, dependency evidence and exact-program handoff. A full solid CAD system would be a separate product expansion.**

This audit inspected current official Help and source. It did not measure the competing applications on matched jobs or operate hardware. Findings about workflow strength are our suitability judgments.

## Product and edition boundaries

| Offering | Relevant documented scope |
|---|---|
| Paid Fusion core | Parametric CAD and standard manufacturing; libraries, templates, NC programs and simulation. Current Help includes positional tool orientation and fourth-axis wrapping. |
| Manufacturing Extension | Additional automated/advanced machining, simultaneous multi-axis strategies and collision avoidance, advanced probing/inspection/alignment and manufacturing capabilities. |
| Fusion for Manufacturing | Autodesk's Fusion-plus-Manufacturing-Extension bundle. |
| Personal use | Restricted non-commercial offering with limited CAM and document/data functionality. Autodesk's limitations include restricted rapid moves, multi-tool posting, probing and multi-axis access; it is not the equivalent commercial comparison. |

Sources: [manufacturing bundle](https://www.autodesk.com/products/fusion-360/manufacturing), [extension](https://www.autodesk.com/products/fusion-360/manufacturing-extension), [personal offering](https://www.autodesk.com/products/fusion-360/personal), [personal-use limitations](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Fusion-360-Free-License-Changes.html), [current multi-axis boundary](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-MULTI-AXIS-MILLING-OVERVIEW.htm). Dynamic price placeholders did not provide a dependable comparable price in this audit.

## 1. Driving dimensions and sketch constraints

Fusion dimensions can reference expressions and other dimensions; constraints preserve intended relationships during an edit. [Dimensions](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CREATE-DIMENSIONS.htm), [fully defined sketches](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/GUID-EFAC0B74-4EF6-4B7B-A10C-7B020E0F7A75.htm).

KerfDesk has numeric lines, circles, arcs and rectangles, but its [sketch model][K-sketch] stores independent entities. The reviewed design/scene surfaces have no general constraint graph.

**Fusion is stronger for engineering changes. Extend** named parameters in bounded part generators, then a clearly scoped constraint solver if demand warrants it. This allows board thickness or hole spacing to change coherently.

**Acceptance:** a bracket's dependent holes update correctly, unresolved references are explained and save/reopen preserves intent. Ledger D02/D03.

## 2. Feature history and the CAD kernel

Fusion has linked feature history and solid/surface modelling; upstream changes recompute referenced features. [Design history](https://help.autodesk.com/view/fusion360/ENU/?contextId=DESIGN_HISTORY), [solid conversion](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sculpt/files/GUID-9A356F5F-38E7-4DFA-A058-7E64CC519260.htm).

KerfDesk's scene contains artwork, shapes and reliefs. [Studio conversion][K-convert] materialises shapes or baked paths; STL relief CAM samples the highest surface. Its [bounded snapshot history][K-history] is undo/redo, not a parametric feature timeline.

**Fusion is stronger for bodies and assemblies. Defer** a general solid kernel; retain inputs and dependencies for useful local generators. Pending live compounds/arrays should be reused rather than replaced by another history system.

**Acceptance:** generated intent can be reopened and revised without discarding its source. Full assemblies, topology references and engineering solids require a separate architectural decision. Ledger D03 and deferred scope.

## 3. Machining setup and work coordinate ownership

Fusion setups own model selection, stock, coordinate orientation/origin and output offset. [Setup reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-REF-SETUP-MILL.htm), [create setup](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-CREATE-SETUP).

KerfDesk persists one [CNC machine configuration][K-machine], and emission deliberately restores [canonical G54][K-modal]. Named machine profiles are configuration snapshots, not executable multiple setups.

**Fusion is stronger for repeatable multi-face machining. Add** explicit setup records around current placement/artifact ownership. An initial single active setup is useful before extending execution.

**Acceptance:** stock, datum, operations and tool plan reopen together; changed setup inputs identify affected artifacts. Multiple WCS execution needs its own qualified controller contract. Ledger C03/D01/D04.

## 4. Stock and physical fixtures

Fusion accepts bounding-solid stock and fixture geometry; fixtures are included in stock-simulation collision findings. [Bounding-solid stock](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-USE-BOUNDING-SOLID.htm), [fixture reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-REF-SETUP-MILL.htm).

KerfDesk's [stock][K-stock] is rectangular with stock-top Z0 and an XY offset. Device no-go zones exist, but the bounded setup/CNC search found no physical fixture model.

**Fusion is stronger in workholding context. Extend** placement/no-go concepts with explicitly dimensioned fixture footprints/heights. Pending camera fixture slots do not supply this geometry.

**Acceptance:** findings identify clamp geometry, clearance assumptions and the reviewed motion. They remain Job Review warnings under the existing Frame/Start policy. Ledger C11.

## 5. Cutter, shaft, holder and reach

Fusion models holder segments, gauge length and length below holder, with strategy-specific shaft/holder handling. [Tool assemblies](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-TL-MILL-HOLDER-GAUGE-LINE.htm), [shaft/holder modes](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUIDD505C759-C325-4C99-BBDD-35FE39B3761F.htm).

KerfDesk's [tool type][K-tools] has cutting shape and optional shank diameter/flute count, without flute length, stickout or a holder profile.

**Fusion is stronger for deep cuts and reach. Extend** tool records with optional measured assemblies. Preserve legacy tools and make unknown dimensions visible. A virtual length change must not become an assumption that the operator physically extended a cutter.

**Acceptance:** short-flute and holder-over-clamp fixtures produce reproducible advisory findings; unknown geometry is disclosed. Ledger C11.

## 6. Material-specific cutting presets

Fusion presets retain cutting data for material, machine and rough/finish use. [Preset workflow](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-CREATE-TOOL-PRESET).

KerfDesk has local libraries and [stage recipes][K-stage], but [feed presets][K-feeds] are unbound numeric records. Its starter feed calculator labels provisional values appropriately.

**Fusion is stronger in preset identity. Extend** records with cutter/material/machine/application and provenance. Reuse pending material experiments as evidence rather than creating another notebook.

**Acceptance:** Apply previews differences; a new cutter cannot silently inherit another cutter's qualified feed record; operator overrides persist. Ledger C04.

## 7. Adaptive roughing

Current Help calls the former Adaptive Clearing strategy **2D Adaptive Roughing**, with boss/pocket support and an Optimal Load setting. [Strategy reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/2D-ADAPTIVE-READ.htm).

KerfDesk already has geometric adaptive engagement planning, but [nested/island contours are restricted][K-adaptive] with an offset-ring fallback. Its source distinguishes geometric engagement from physically measured load.

**Fusion is stronger in documented geometry coverage. Extend** island-aware planning. Do not promise Fusion-equivalent cycle time or tool life from the strategy name.

**Acceptance:** independent fixtures verify containment, reachable removal, entry/linking, engagement bounds and actual emitted motion around islands. Ledger C10.

## 8. Rest machining across stages

Fusion limits rest operations to material not removed by the preceding tool/operation. [Adaptive/rest reference](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-REF-2D-ADAPTIVE-CMD).

KerfDesk already has two-tool rest pocketing; its [resolver][K-rest] excludes adaptive rest and the helix combination.

**Fusion is broader in stage interactions. Extend** explicit previous-cutter/stock dependencies before lifting those restrictions. A changed roughing stage must change the rest basis.

**Acceptance:** the emitted large-tool pass establishes residual regions; inaccessible or incompletely cleared areas remain visible; finish does not rely on assumed removal. Ledger C05/C10 and relief R05.

## 9. Recalculation and dependency visibility

Fusion marks affected operations out of date and supports regeneration. [Generation workflow](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-GENERATE-OPERATIONS-OVERVIEW.htm).

KerfDesk [rebuilds preview from project/placement changes][K-preview], cancels superseded work and binds compilation tasks to current inputs. It already regenerates current data; the gap is explaining its dependency status to the operator.

**Fusion is stronger in inspectable status. Add** concise per-stage input/revision reasons. Preserve valid current artifacts when relevant inputs have not changed.

**Acceptance:** geometry/tool/roughing changes identify their affected stages; stale workers cannot appear current; tool-based ordering preserves dependencies. Ledger C05.

## 10. Stock simulation and collision verification

Fusion distinguishes tool-only and machine/post-aware simulation and reports relevant collision/overtravel/rapid-stock findings for configured models. [Manufacturing simulation](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-REF-SIMULATION).

KerfDesk has [depth-field removal][K-removal], parsed-program stock carving and [leftover/gouge comparison][K-stock-compare]. The bounded search did not establish a holder/fixture/full-machine collision engine.

**Fusion is stronger in physical geometry coverage. Extend** bounded envelopes and an explicit verification report, preserving cutter-specific removal and resolution disclosures.

**Acceptance:** the report identifies program digest, effective sampling, assumptions, covered envelopes and unmodelled machine parts. A simulation finding remains distinct from physical qualification. Ledger C11.

## 11. Operation templates

Fusion saves reusable sets of operations in local/cloud template libraries. [Store template](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-TEMPLATE-LIBRARY-STORE-AS-TEMPLATE.htm), [template library](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-TEMPLATE-LIBRARY-SELECTION).

KerfDesk already has [revisioned process recipes][K-recipe] containing multiple steps, CNC settings and copied tools. The essential mechanism exists.

**Fusion is stronger in manufacturing-context organisation. Extend** compatibility, reviewed cutter remapping, semantic selectors and application preview. Do not introduce a second template library.

**Acceptance:** import/Apply/Undo preserve stage settings and order; recipe updates do not silently mutate previously applied work. Ledger C04/C07.

## 12. NC programs, posts and setup sheets

Fusion owns selected setup/operation groups in persistent NC programs with post selection and setup documentation. [NC Program reference](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-REF-NC-PROGRAM), [post selection](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-REF-NC-PROGRAM-POST-SELECTION.htm).

KerfDesk uses built-in output strategies. Its [CNC emitter][K-emitter] links emitted lines to passes and uses manual M0 tool holds. Pending production rows provide useful run identity but are not an industrial post-processing system.

**Fusion is stronger in configurable manufacturing output. Add** persistent exact-program export records and setup sheets. Extend supported posts through declared capabilities and fixtures.

**Acceptance:** digest, setup basis, tool order, values and warnings match exported bytes; cancellation cannot document an absent file; arbitrary imported post code is outside the initial design. Ledger C06/D04.

## 13. Setup probing and inspection

Paid Fusion supports Probe WCS; Probe Geometry, Inspect Surface and Part Alignment add extension-dependent workflows. [WCS workflow](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-HOW-TO-PROBE-WCS-WORKFLOW.htm), [probing overview](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-PROBING-OVERVIEW).

KerfDesk already has [typed Z/corner touch-plate requests][K-probe]. Pending #1084 has measured surface grids/CSV without output compensation. This is evidence collection rather than equivalent model-driven inspection.

**Fusion is stronger in metrology integration. Extend selectively** local nominal/tolerance/actual/method records tied to source and program revisions. Any physical probing or compensation remains separately authorised/qualified.

**Acceptance:** measurement collection cannot silently change coordinate offsets or output; readings carry instrument/method and revision identity. Follow-up F01.

## 14. Manual dimensional inspection

Fusion has manual inspection plans for tools such as calipers/micrometers and supported tolerance dimensions. [Manual inspection](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-MANUAL-INSPECTION-OVERVIEW).

KerfDesk's canvas distance/angle measure tool and general notes are not a manufactured-part inspection plan.

**Fusion is stronger in repeat-production feedback. Add selectively** a small local checklist bound to the production/program record, using existing experiment evidence where possible.

**Acceptance:** nominal and measured dimensions are distinct; failed, unmeasured and uncertain results remain explicit; a revised program does not inherit a previous part's result. Follow-up F01.

## 15. Multi-axis and machine qualification

Current Fusion Help includes positional orientation and fourth-axis wrap in core; advanced simultaneous strategies/avoidance belong to the extension. [Multi-axis boundary](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-MULTI-AXIS-MILLING-OVERVIEW.htm).

KerfDesk's CNC passes represent supported XYZ/planar-arc/helical motion rather than rotary machine kinematics. Its [machine catalogue][K-catalog] distinguishes geometry starters from qualified drivers/posts.

**Fusion is stronger for that broader machinery. Defer** simultaneous machining until definitions, posts, protocols and physical evidence exist. Laser wrapping is not qualification for router rotary.

**Acceptance:** any future capability names exact supported transforms and output commands, with controller fixtures and separate physical-machine evidence. Ledger D04 and deferred scope.

## 16. Engineering drawings and collaboration

Fusion associates drawing dimensions/tolerances with designs and supplies cloud review/comment/reservation workflows. [Drawing dimensions](https://help.autodesk.com/view/fusion360/ENU/?contextId=DWG-DIMENSIONS), [collaboration](https://help.autodesk.com/view/fusion360/ENU/?contextId=ASM-IMPLICIT-RESERVATION).

KerfDesk's scene, notes and pending local snapshots/sheets do not form an engineering drawing or cloud team system.

**Fusion is stronger for engineering teams. Add selectively** dimensioned setup documents and portable review evidence. General drafting standards and cloud collaboration are separate scope.

**Acceptance:** annotations state the geometry/program revision and handoffs preserve exact identity. No automatic external upload is needed for the initial local workflow. Ledger C06 and deferred scope.

## 17. Offline and mixed laser/router work

Fusion can edit cached designs offline and documents a reconnection/licence-validation interval. [Offline mode](https://help.autodesk.com/view/fusion360/ENU/?contextId=ASM-FUSION-OFFLINE-MODE).

KerfDesk's product contract keeps CAM/preview/streaming local; its [project model][K-project] preserves router setup while in laser mode. This makes local mixed artwork/machine operation a strong architectural fit.

**KerfDesk has an advantage in that fit. Keep** coherent local project, preview and controller workflows while adding manufacturing context. This is not a measured reliability or usability win.

**Acceptance:** local reopen/edit/save/compile/preview and simulated transport work without networking, while respecting applicable licence admission and existing Frame/Start ownership. Qualify that workflow before using it as a marketing benchmark.

## Most useful changes for KerfDesk

Bind presets to cutter/material/machine; add setup and optional fixture/holder records; export exact-program documentation; show operation dependencies; then extend island/rest interactions. These improve practical engineering preparation without making a solid CAD kernel a prerequisite for router users.

The Autodesk platform also includes broader engineering, collaboration and manufacturing directions. A full clone would expand our product considerably. The immediate plan adopts its data ownership and preparation discipline while keeping KerfDesk's local mixed-machine workflow.

[K-sketch]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/design/sketch-entity.ts#L91
[K-convert]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/design/to-scene-object.ts#L7
[K-history]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/ui/design-studio/design-history.ts#L8
[K-machine]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/machine.ts#L266
[K-modal]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/output/cnc-grbl-transitions.ts#L50
[K-stock]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/machine.ts#L23
[K-tools]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/cnc-tool.ts#L7
[K-stage]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/cnc-stage-recipe.ts#L4
[K-feeds]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/ui/state/cnc-library-persistence.ts#L16
[K-adaptive]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/adaptive-pocket.ts#L30
[K-rest]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/cnc-rest-operation.ts#L45
[K-preview]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/ui/workspace/use-preview-toolpath.ts#L65
[K-removal]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/sim/removal-grid.ts#L22
[K-stock-compare]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/ui/gcode-inspector/stock-compare.ts#L21
[K-recipe]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/material-library/process-recipe.ts#L20
[K-emitter]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/output/cnc-grbl-strategy.ts#L79
[K-probe]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/controllers/grbl/probe.ts#L66
[K-catalog]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/cnc-machine-catalog.ts#L1
[K-project]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/project.ts#L154