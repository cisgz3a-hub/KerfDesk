# KerfDesk against VCarve Pro, Aspire and Autodesk Fusion

Audit date: 8 October 2026. KerfDesk source baseline: `e3820ed51a8d3e9ae8eab16f47097c4011dbd703` on GitHub main. Scope: signs and production woodworking, artistic relief creation, and engineering CAD/CAM.

**VCarve Pro is the strongest documented fit for repeated sign and sheet production, Aspire for authoring decorative reliefs, and Fusion for parametric engineering through manufacturing. KerfDesk already has substantial CNC and relief CAM. Its highest-value improvement is to turn those engines into reusable, clearly described production workflows.**

These are workflow-fit judgments from current primary documentation and inspected KerfDesk source. The competing applications were not run on matched jobs. This audit establishes documented capability and implementation gaps; it does not establish measured superiority in speed, finish, accuracy, reliability, safety or learning time.

Read the detailed audits for [VCarve Pro](VCARVE-PRO.md), [Aspire](ASPIRE.md) and [Fusion](FUSION.md). The [implementation ledger](IMPLEMENTATION.md) combines their lessons into one ordered plan, with dependencies and acceptance checks.

## 1. What was actually examined

- GitHub main was refreshed before creating the isolated audit branch `codex/cnc-leaders-audit-20261008` at the baseline above. The worktree is `D:\LaserForge\cnc-leaders-audit-20261008`.
- The primary checkout on `claude/vcarve-stamp-subcell` has extensive unrelated work. That work was preserved and was not credited as main functionality.
- Existing CNC, relief, nesting, design, simulation and project-round-trip tests were run on the clean main baseline: **104 passed tests across 17 test files, zero failures and zero pending tests**. Vitest reports 43 suites because it counts nested suite blocks. The file count is 17. Raw results, selection, summary and the reproduction script are preserved in this local audit directory; generated audit evidence is excluded from the source PR. The final implementation and broad test snapshot are summarised in [BUILD.md](BUILD.md) and [the PR verification record](pr-verification.json).
- The test run confirms a selected software baseline. It is not a full release check, fresh browser workflow test, competitor benchmark, deployed-build check or physical-machine qualification.
- Official product pages and versioned Help were read for the competitors. Vectric's upgrade pages label **12.5** as latest in the retrieved content; the detailed audits use that documentation and label older Help references when needed. Fusion is continuously updated; its current Help and paid/core/extension distinctions govern this comparison. [VCarve releases](https://www.vectric.com/upgrade/vcarve/), [Aspire releases](https://www.vectric.com/upgrade/aspire/), [Fusion Manufacturing Extension](https://www.autodesk.com/products/fusion-360/manufacturing-extension).
- No application source, provider configuration, entitlement rule or hardware state was changed. These documents contain audit findings and proposed implementation work.

## 2. Who is stronger, and for which job?

| Job | Strongest documented fit among these benchmarks | Why it leads | What KerfDesk should learn |
|---|---|---|---|
| Repeat a sign family across materials and sheets | **VCarve Pro** | Automatic geometry selection, toolpath templates and sheet-aware production reduce repeated setup decisions. | Reuse machining intent across named parts and sheets; keep stock, side, tools and output identity visible. [Template Help](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/toolpath-templates/index.html) |
| Fit quantities of wood parts onto sheets while respecting grain | **VCarve Pro** | Nesting is an explicit production workflow with quantities, spacing and rotation rules. | Extend the pending KerfDesk nesting and sheet work with quantities, material records and per-part constraints. Independently validate the resulting placements. [Nesting Help](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/Nest%20Parts/index.html) |
| Build and revise an original decorative relief | **Aspire** | Components, vector-derived shapes and sculpting preserve editable artistic intent. | Add a relief component document, vector shape generators and masked sculpting above the existing canonical heightfield. [Aspire](https://www.vectric.com/products/aspire/), [Sculpting Help](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Sculpting/) |
| Machine imported one-sided reliefs | **No measured winner established** | All relevant algorithms and cutter geometry need matched-job evaluation. KerfDesk already has roughing, finishing, waterline and material-removal preview. | Keep the current engines; improve composition, cutter-specific rest finishing and evidence about remaining stock. [KerfDesk relief field](https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/relief/relief-heightfield.ts#L1) |
| Change an engineering part dimension and regenerate its manufacturing plan | **Fusion** | Constraints, parameters and feature history carry mechanical intent into CAM. | Start with bounded 2D parameters and dependency tracking. Full solid CAD is a separate architectural expansion. [Fusion design features](https://www.autodesk.com/products/fusion-360/features) |
| Plan machining with stock, fixture and tool assembly geometry | **Fusion** | Its manufacturing setup and tool models describe more of the physical cutting context. | Add explicit setup records and holder/fixture envelopes with clear simulation limits. [Fusion manufacturing](https://www.autodesk.com/products/fusion-360/fusion-360-for-manufacturing) |
| Design and operate basic laser and CNC work in one KerfDesk workspace | **KerfDesk is a strong fit when its controller and workflow suit the operator** | Its artwork, CNC, laser, review and sending flows share a workspace. That fit is valuable even without matching every specialist tool. | Preserve this coherence. Vectric also offers a separate Laser Module and VTransfer, so a claim of unique laser/CNC integration would be unsupported. [Vectric Laser Module](https://www.vectric.com/products/laser-module/) |

The winner changes with the task. A mechanical bracket benefits from Fusion's constraints and setup model. A run of personalised wooden signs benefits from VCarve's production templates. A carved animal plaque benefits from Aspire's component editing. KerfDesk should compete first on convenient mixed-machine work and a stronger production flow, with targeted depth in the tools its users actually use.

## 3. Strengths KerfDesk should keep

The current source deserves more credit than a simple feature checklist gives it:

- CNC already includes profile, pocket, drilling, variable-depth V-carve, straight inlay, tabs, leads, ramps, tiling, surfacing, two-tool rest pocketing and an adaptive pocket strategy. Existing capabilities should be extended through their current contracts.
- Relief work already has durable 16-bit heightfields, imported depth/brightness maps, STL top projection, mapping controls, masks, roughing, finishing, waterline and scallop-aware planning. It is a useful one-sided 2.5D machining foundation.
- Simulation already stamps paths using the active cutter's geometry. The removal preview is more substantial than a line animation. Its budgeted grids and lack of complete holder/machine geometry remain relevant limits.
- Design Studio has editable 2D entities, construction geometry and undo/redo. It can support useful parametric generators without immediately requiring a full mechanical CAD kernel.
- Revisioned multi-step process recipes, stage recipes, tool metadata, material libraries and compilation artifacts provide building blocks for contextual presets, selector-based templates and setup documentation.
- Exact reviewed-program ownership and reusable Frame evidence for unchanged footprint/placement should remain intact. New production features must hand off the right artifact without adding another ordinary Start policy gate. [ADR-565](../../decisions/ADR-565-frame-remains-valid-for-unchanged-placement.md).

The [project model](https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/project.ts#L142), [tool model](https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/cnc-tool.ts#L5), [sketch entities](https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/design/sketch-entity.ts#L17) and [per-tool simulation](https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/sim/stamp-toolpath.ts#L44) anchor these findings. The detailed audits cite the particular algorithm and UI boundaries.

## 4. Credit work already implemented in open PRs

The xTool-inspired work is relevant groundwork, but its availability must be stated accurately. At inspection:

- [PR #1084](https://github.com/cisgz3a-hub/KerfDesk/pull/1084), head `f100efdc83e7e59eb277b9aa2a35621407bd0db3`, contains artwork hierarchy, live Boolean compounds, text frames/CSV mapping, stable arrays, production manifests, sheet archives, nesting controls, material evidence, named snapshots and camera/artwork fixture records.
- [PR #1087](https://github.com/cisgz3a-hub/KerfDesk/pull/1087), head `88433fec3d0e44e0b4793e086af34d6c4760bdfb`, integrates and repairs related workflows.

They were open when inspected. Their source is credited as **pending implementation**, rather than main, released or hardware-qualified functionality. No new CI qualification was performed for those branches in this audit.

This changes the implementation plan. Extend their sheets instead of creating another sheet book; extend their nesting constraints instead of adding a competing nesting dialog; use their stable production rows instead of creating another batch queue. Their 2D artwork hierarchy is useful infrastructure, but does not supply Aspire's relief-combination model. Their camera fixture slots do not supply Fusion's physical CNC fixture/holder collision model.

## 5. What to add, change, replace or remove

| Decision | Current friction or boundary | Proposed change | Why it improves KerfDesk |
|---|---|---|---|
| **Keep and extend CAM engines** | Existing operations cover many router tasks but do not constitute a reusable job family. | Add semantic selectors, machining templates and inspectable stage dependencies. | A new sign can reuse a proven sequence while showing exactly which vectors and tools are affected. |
| **Replace unbound preset application** | Tool, material and machine settings can be selected independently. | Bind saved cutting data to tool/material/machine context, retaining explicit per-job overrides. | A user sees the intended context and the evidence behind a feed recipe before reusing it. |
| **Evolve the single setup surface** | The project stores one current CNC machine and rectangular stock record. | Introduce explicit machining setup identity; migrate an old project to one equivalent setup. | Stock, origin, side, fixture and output context remain understandable as production grows. |
| **Replace disconnected output summaries** | Toolpaths, review and exported files can require separate interpretation. | Derive a setup sheet and per-tool program manifest from the exact compilation artifact. | The document refers to the actual files and settings the operator is about to use. |
| **Add editable relief intent** | Mapping an imported field is editable, but there is no comparable relief component/sculpting document. | Retain component sources and edits, then materialise a revisioned canonical field for CAM. | Borders, lettering and ornament can be adjusted without remaking a flattened image. |
| **Add holder/fixture context to preview** | Cutter removal is present; complete reach and holder geometry are absent. | Add advisory collision/reach findings and identify the envelopes/resolution used. | The preview can reveal more setup problems without overstating its physical proof. |
| **Replace opaque regeneration** | Snapshot undo and operation parameters do not explain a CAD/CAM dependency graph. | Show which source, tool, stock or parameter change invalidated each prepared operation. | Recalculation becomes reviewable and changed geometry cannot silently reuse old output. |
| **Remove duplicate new workflow concepts during integration** | Multiple feature branches could introduce overlapping sheet, array, batch or library models. | Reconcile them into one canonical model before expanding the UI. Preserve existing project data through migration. | Less operator confusion and fewer inconsistent save/reopen paths. This is a proposed integration rule, not a verified current duplicate defect. |

No existing CNC or relief engine is identified here as deserving wholesale removal. The stronger competitor patterns are mainly durable intent, production context and connected preparation. Copying their icons or menu layouts would provide less benefit.

## 6. Recommended implementation order

1. Reconcile and verify the pending sheet, nesting, hierarchy and production work. Add explicit CNC setup identity, bound cutting-data records, operation dependencies, exact-program documentation and the benchmark fixtures.
2. Add selector-based machining templates and quantity/grain-aware multi-sheet production. Develop linked V-bit inlay separately from the existing straight-inlay operation. Add island-capable adaptive planning and stock-aware rest interactions where the test cases justify them.
3. Build the relief component compositor, vector-derived shapes, masked sculpting and linked clipping. Extend relief rest finishing and vector projection through existing CAM contracts.
4. Add qualified two-sided CNC setups and then bounded parametric design. Wrapped CNC, arbitrary post processors, simultaneous multi-axis, assemblies and full solid CAD need their own architecture and controller qualification.

The [ledger](IMPLEMENTATION.md) defines 22 primary items plus a selective feature backlog, with prerequisites, intended implementation surfaces and observable acceptance conditions. The three detailed reports cover 53 comparison areas. Priorities describe product order, not promised dates or estimates.

## 7. How to turn these judgments into measured results

A later benchmark should run the same files, tools, stock definitions, computer and documented software versions through each relevant product. Record operator steps, required manual repairs, regeneration time, estimated and actual cut time, path topology, maximum depth, cutter reach and residual material. Keep software comparisons separate from machine/material trials.

| Shared fixture | Main question | Evidence to collect |
|---|---|---|
| A sign with small letters, holes, a V-carve area and profile tabs | Does sign preparation preserve islands and explain cutter-limited detail? | Selected geometry, depth limits, reachable detail, stage/tool order and exact output. |
| Twelve parts with quantities, grain rules, engraving and two sheet sizes | Does production preserve part identity and fit validated placements? | Quantity fulfilment, grain compliance, containment, collisions, engraving attachment and sheet-specific output. |
| Straight inlay and a separate tapered V-bit inlay coupon | Are fit parameters and male/female outputs understandable? | Geometric offsets, clearance meaning, paired edits and later measured fit; do not conflate the two algorithms. |
| A relief plaque containing a dome, ornament, text and a clipped border | Can an operator revise one component and preserve the others? | Edit history, source linkage, field bounds, save/reopen, regenerated CAM and remaining stock. |
| A fixture and a long/short tool assembly over known stock | What collisions can the available simulation actually predict? | Tool/holder envelopes, clearance findings, unknown geometry disclosures and review artifact identity. |
| An asymmetric two-sided part | Does a flip preserve the expected origin and registration? | Side transform, Z datum, registration coordinates and independently checked output. |
| A bracket changed from 60 to 75 mm | Can linked holes and machining regenerate coherently? | Constraint/parameter result, source revision, invalidated stages and newly prepared output. |
| An interrupted serial production run | Can the operator distinguish completed, skipped and uncertain rows? | Stable row IDs, evidence state and explicit operator reconciliation before another run. |

These fixtures are proposed; this audit did not run them inside the competing applications. The passing 104-test baseline and the documented capabilities justify implementation priorities, not a numerical market score.