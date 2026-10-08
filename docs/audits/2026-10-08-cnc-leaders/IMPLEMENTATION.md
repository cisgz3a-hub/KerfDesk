# CNC and relief implementation ledger

Date: 8 October 2026. Proposed work derived from the [VCarve Pro](VCARVE-PRO.md), [Aspire](ASPIRE.md) and [Fusion](FUSION.md) audits. Main baseline: `e3820ed51a8d3e9ae8eab16f47097c4011dbd703`.

**Build a connected production system around the current engines, then add editable relief creation and bounded parametric design.** This is an ordered implementation list, not a claim that the items are implemented. Source work already in open PRs is credited explicitly. Scope descriptions are architectural size, not calendar estimates.

Local build status and qualification boundaries are recorded in [BUILD.md](BUILD.md). This ledger preserves the original acceptance plan.

## Ordering and durable rules

| Wave | Items | Intended outcome |
|---|---|---|
| 1. Shared foundation | C01-C06, C11 | One production model, reproducible benchmarks, explicit setup/tool context, reviewable regeneration and exact-program documentation. |
| 2. Repeatable routing | C07-C10 | A sign or sheet family can reuse machining intent, quantities and validated geometry rather than being set up from scratch. |
| 3. Original reliefs | R01-R07 | Relief components can be created, revised and machined through the existing heightfield/CAM contract. R05 can proceed once the stock and cutter contracts are ready. |
| 4. Broader design and machining | D01-D04 | Qualified two-sided work, constrained 2D design, linked part generators and explicitly supported CNC wrapping/posts. |

All work remains generic across machine brands. Physical features require truthful controller capabilities and machine qualification; a brand-neutral model does not make every controller support every operation.

- Preserve old projects through versioned migration, and preserve legacy sources until deliberate conversion succeeds.
- Keep one owner for each sheet, part, tool, setup, production row and prepared artifact. Reuse the pending xTool workflow models where their semantics fit.
- Keep geometry, selection, CAM preparation, Job Review and output connected by revision identity. A source change must never silently use an older program.
- Keep existing Frame/Start/output policy and entitlement boundaries. Fixture, collision, tool, configuration and policy findings belong in Job Review as warnings unless executable output or transport actually fails. A warnings panel must not become another ordinary Start gate.
- Keep precision and display resolution separate. A fast preview must state what it sampled and cannot certify geometry it does not model.
- Existing Pro assignments stay as they are. New commercial tier assignments need a separate product decision; this audit changes none.
- Generate our own implementation and assets from documented behaviour. Vendor source, bundled clipart, tool databases and proprietary file formats are not implementation assets supplied by this audit.

## C01. Reconcile pending production foundations

**Action: integrate and extend existing work. Priority: first. Scope: cross-feature integration.**

The artwork hierarchy, sheet book, material notebook, production manifest, retained arrays and nesting controls already exist in [PR #1084](https://github.com/cisgz3a-hub/KerfDesk/pull/1084), with related integration in [#1087](https://github.com/cisgz3a-hub/KerfDesk/pull/1087). They are pending rather than current-main features. Creating a second implementation of those ideas would increase save/reopen and operator-state risk.

Reconcile their schema and ownership with current main before expanding production. Preserve inactive sheet archives, the active scene/setup, stable part instances and production row identities. CNC manufacturing setup identity is an extension, not a rename of camera fixture slots or 2D hierarchy.

**Surfaces:** pending `src/core/scene/project-sheets.ts`, `production-manifest.ts`, artwork hierarchy/array models, related project I/O and workspace UI. Verify their final paths when integrating the branches.

**Acceptance:** old and new projects reopen with the same active/inactive sheets and stable rows; undo does not move operations to another part; an interrupted row remains uncertain until operator reconciliation; cancellation does not commit half a nest. Run the existing focused branch regressions after integration. No automatic hardware replay.

## C02. Add matched benchmark fixtures and evidence records

**Action: add reusable verification fixtures. Priority: first and ongoing. Scope: evidence infrastructure.**

The current audit has 104 passing tests, but no matched competitor runs. Create the eight fixtures in [the report](REPORT.md#7-how-to-turn-these-judgments-into-measured-results), with expected units, geometry, tool definitions and depth bounds. Include tiny/unreachable features, islands, grain constraints, exact tool output and asymmetric two-sided coordinates.

Record software version, input digest, relevant settings, operator actions, calculation time, residual geometry and any manual repairs. A benchmark record must distinguish source tests, rendered output, controller simulation, air cuts and material trials. This prevents feature presence from becoming an unsupported quality score.

**Surfaces:** `docs/audits`, focused test fixtures under the current CNC/relief/nesting modules; a small shared machine-readable benchmark schema only if multiple consumers require it.

**Acceptance:** fixtures and expected values are reproducible without a physical machine; the report shows unrun lanes explicitly; benchmark regeneration detects a meaningful output or geometry change. Do not add assertion-only tests for documentation text.

## C03. Make machining setup identity explicit

**Action: evolve the existing setup model. Priority: Wave 1. Depends on: C01. Scope: schema plus UI and output identity.**

Main has one current CNC machine record, rectangular stock and global placement context. VCarve's job/sheet identity and Fusion's manufacturing setups show why stock, origin, Z datum, side and machine context should travel together.

Introduce a named setup record that references stock, origin/datum, assigned operations, chosen machine capabilities, output mode and later fixtures. The first migration creates one equivalent setup for an existing project. The first increment can keep one active setup; multiple executable coordinate systems require additional qualification.

**Surfaces:** `src/core/scene/project.ts`, `machine.ts`, project I/O, workspace stock/setup controls, `src/core/cnc/cnc-compilation-artifact.ts` and output handoff ownership.

**Acceptance:** migrated projects produce equivalent placement and executable coordinates; switching a setup cannot reuse another setup's artifact; stock/datum changes show affected operations; UI names the active sheet and setup before export or review. Canonical G54/manual tool changes remain the supported execution contract until a separate extension is qualified.

## C04. Bind cutting data to tool, material and machine

**Action: replace unbound preset application with contextual records. Priority: Wave 1. Depends on: C03. Scope: library model and selection UI.**

Existing tools, stage recipes, material data and feed calculations are useful. Extend them with a named cutting-data record keyed by tool geometry/family, material and machine context. Store feed, plunge, spindle, engagement limits, provenance and operator qualification notes. Retain explicit per-job overrides and show differences from the saved record.

This borrows Vectric's context-specific tool data and Fusion's presets. It reduces repeated setup work and makes reuse inspectable. It does not invent universal feeds or treat an untested manufacturer value as qualified for every machine.

**Surfaces:** `src/core/scene/cnc-tool.ts`, `cnc-stage-recipe.ts`, current feed calculator/tool catalog/material library and corresponding selection panels. Extend the canonical libraries instead of adding parallel catalogues.

**Acceptance:** a record intended for a 3 mm cutter in plywood does not silently overwrite a 6 mm metal-cutting setup; units round-trip; imported records keep provenance and conflicts are previewed; overrides survive reopening; missing evidence is shown without another Start gate.

## C05. Show operation dependencies and recalculation reasons

**Action: extend preparation evidence. Priority: Wave 1. Depends on: C03-C04. Scope: core revision tracking and UI.**

Snapshot undo, parameter fields and toolpath preparation do not provide a parametric dependency graph. Give each operation an inspectable input signature: source geometry/relief revision, selected roles, setup, tool, recipe, previous-stock dependency and relevant algorithm revision.

Show concise reasons such as “stock thickness changed” or “border component revised”. Preserve current valid prepared results where inputs remain identical. Materialising a change must produce a new artifact or leave the old one clearly associated with its earlier inputs.

**Surfaces:** CNC compilation artifacts, operation planning/cache ownership, scene revision models, operation list and Job Review.

**Acceptance:** changing a tool or selected boundary marks precisely the dependent stages; unrelated renaming does not force CAM recalculation; reopening retains enough identity to explain status; regeneration and cancellation cannot swap a different artifact into an active handoff. Test dependency behaviour rather than UI labels alone.

## C06. Generate setup sheets and program manifests from the exact artifact

**Action: connect export and operator documentation. Priority: Wave 1. Depends on: C03-C05. Scope: exporter and review UI.**

Create an HTML/printable setup sheet containing the project/sheet/setup name, source/program digest, units, stock, origin/Z datum, machine/dialect, ordered tools, feed data, tool holds, warnings, preview and exact exported filenames. A per-tool output manifest should describe the files actually produced from the same compilation artifact.

This takes VCarve's setup-sheet and save-toolpath lessons and Fusion's setup/NC-program organisation. It prevents a manually copied instruction sheet from drifting away from the reviewed output.

**Surfaces:** CNC compilation artifact, existing G-code export/file-choice helper, tool sections, Job Review and report/export rendering.

**Acceptance:** every manifest filename maps to a generated program digest; missing or cancelled files do not appear as completed exports; single-file manual tool-change and separate-tool modes preserve the correct order and stops; save/reopen cannot substitute another setup. An edited annotation remains distinguishable from generated program facts.

## C07. Add selector-based machining templates

**Action: add durable machining intent over existing operations. Priority: Wave 2. Depends on: C01, C03-C05. Scope: schema, selector UI and operation binding.**

A stage recipe holds machining values. A production template also says which geometry gets profile, pocket, drilling or V-carve. Define semantic roles such as outer boundary, holes, pocket areas and lettering, with previewable selectors based on part identity, named groups/layers and supported geometry rules.

Apply a template to selected parts or sheets with an explicit preview of matched and unmatched roles. Reuse the current CAM engines and stage recipe records. Add an operation-aware defect list and route accepted repairs through the existing geometry repair tools. Preserve the original artwork unless an accepted repair is applied.

**Surfaces:** pending hierarchy/sheet models, current operation/stage recipes, design vector validation, selected-object panels and project I/O.

**Acceptance:** applying a sign template twice does not duplicate stages; renamed/unmatched roles are shown; nested holes stay holes; a text change rebinds the intended role; applying to multiple sheets reports the per-sheet matches. Operator edits are preserved or explicitly previewed before replacement.

## C08. Extend nesting into quantity-aware sheet production

**Action: extend pending nesting and sheets. Priority: Wave 2. Depends on: C01, C03, C07. Scope: production model and worker.**

Add requested quantity, material/thickness, permitted rotations, grain direction, sheet/remnant identity and attached artwork to each part definition. Extend existing nesting goals and independent validation. Report produced/unplaced quantities and reasons, not only percentage utilisation.

This is VCarve's production lesson applied to KerfDesk's shared laser/CNC workspace. Quantity nesting and a serial production manifest are different concepts: they can reference the same stable part definition without automatically starting machines.

**Surfaces:** pending nesting/part/sheet records and cancellable worker; current `src/core/nesting`; production manifest and sheet-specific operation output.

**Acceptance:** a two-sheet fixture fulfils the specified quantities or lists unplaced parts; every rotation obeys its rule; engravings and holes follow the part; material/stock identities remain intact; an independent containment/collision pass approves the placement before committing it; cancel leaves the old layout intact.

## C09. Add linked tapered V-bit inlay intent

**Action: add a separate inlay mode; keep straight inlay. Priority: Wave 2. Depends on: C03-C07. Scope: substantive geometry/CAM.**

Current paired inlay uses a straight female pocket and male outside profile. Add a distinct tapered V-bit inlay record with clear pocket depth, engagement depth, glue clearance and surface clearance meanings. Retain one editable source intent for both pieces, with optional intentional detachment.

VCarve's dedicated V-inlay demonstrates the missing workflow. Its documented male/female outputs are no longer linked after creation; KerfDesk can improve revision handling with explicit linkage. This is a proposed advantage until tested, not a current win.

**Surfaces:** `src/core/cnc/inlay-pair-operation.ts`, V-carve geometry, scene operation types, inlay panels and project I/O. Do not relabel existing straight-inlay depth as a V-bit glue-gap parameter.

**Acceptance:** analytical wedge/angle fixtures verify contact depth and both clearance types; source edits regenerate both outputs; unreachable details are disclosed; each piece records its intended side/setup/tool. Material fit requires a later physical coupon, separately recorded.

## C10. Extend adaptive clearing and stock-aware 2D rest operations

**Action: extend current planners. Priority: Wave 2. Depends on: C02-C05. Scope: substantive CAM.**

Current adaptive planning is restricted for nested/island geometry, and current rest pocketing is a two-tool path with explicit unsupported interactions. Add island-capable adaptive planning incrementally, then support rest operations against an explicit previous cutter/stock result where the geometry is proven.

Keep fallback descriptions visible. Do not promise Fusion-equivalent constant engagement or less tool wear from the algorithm name. Improvements must come from envelope, engagement, entry and residual-stock evidence.

**Surfaces:** `src/core/cnc/adaptive-pocket.ts`, `cnc-rest-operation.ts`, pocket-region planner, entry/linking logic, compilation artifacts and removal simulation.

**Acceptance:** island fixtures show no crossings; path segments stay in reachable cutter-centre regions; unsupported combinations produce truthful fallback/warning evidence; rest paths remove meaningful residual material without skipping required cuts; cutter changes invalidate the previous-stock dependency. Physical efficiency claims wait for matched trials.

## C11. Add tool assemblies, fixtures and reach findings

**Action: extend geometry context and review. Priority: Wave 1 foundation, richer simulation later. Depends on: C03-C05. Scope: tool/setup schema and advisory geometry checks.**

Add flute length, stickout, shank and holder envelope to the existing cutter model. Allow explicit fixture/clamp geometry and dimensions in a setup. Begin with bounded envelopes whose meaning is easy to inspect. Display cutter, shank and holder separately where supported.

Fusion shows why cutter diameter alone is insufficient. KerfDesk's current per-tool removal preview remains valuable; holder reach and fixtures add a different analysis. Camera/artwork fixture slots in pending work are placement records, not physical collision geometry.

**Surfaces:** `src/core/scene/cnc-tool.ts`, setup model, `src/core/sim`, 3D preview, Job Review and exact setup sheet.

**Acceptance:** known short-flute/holder-over-clamp fixtures produce reproducible findings; unknown geometry and clearance resolution are disclosed; a tool assembly edit invalidates the analysis; warnings do not introduce a new policy Start refusal. Full machine/linkage collision is outside this initial scope.

## R01. Add a relief component and level document

**Action: add editable artistic intent. Priority: Wave 3 foundation. Depends on: C01, C05. Scope: new model/materialiser plus migration.**

Represent relief components with stable IDs, retained source/provenance, physical transform, height/base adjustment, visibility, supported combine mode, level/group and mask. Define composition order and neutral/outside semantics precisely. Materialise the composite into the existing revisioned U16 heightfield for CAM.

This is Aspire's most valuable lesson. Pending artwork hierarchy can supply selection/naming patterns, but additive/subtractive height composition requires its own typed semantics. It remains one-sided 2.5D; it does not supply a solid model or undercuts.

**Surfaces:** `src/core/scene/relief`, current relief source materialisation/project I/O, scene object revision, relief property panels and viewer.

**Acceptance:** analytic component fixtures verify every combine mode and Z range; units, masks and transform precision survive reopening; an old imported field retains equivalent machining; cancelled composition does not mutate the active field; component edits update the compilation signature.

## R02. Create relief shapes from vectors

**Action: add native relief generators. Priority: Wave 3. Depends on: R01. Scope: geometry generators and controls.**

Begin with planar/flat regions, domes and sloped/angled profiles inside supported closed boundaries. Retain the source vector reference and shape parameters. Expose physical height and an unambiguous base datum. Preview the resulting field and disclose unsupported/self-intersecting boundaries.

This moves users from remapping an imported image to creating editable raised lettering, borders and plaques. Reuse vector validation and canonical height materialisation rather than inventing an unrelated mesh pipeline.

**Acceptance:** symmetric and concave fixtures match analytical heights within the declared materialisation tolerance; resizing the source updates the component; holes and mask edges preserve their intended meaning; a user can change height and save/reopen without flattening the generator.

## R03. Add masked sculpting with stroke undo

**Action: add a precision-aware relief editor. Priority: Wave 3. Depends on: R01-R02. Scope: interactive editing and history.**

Provide add, remove, smooth and flatten brushes with physical diameter, strength, selected component/region and optional source-image overlay. Keep one completed stroke as one undo step. Store meaningful edit intent or bounded field patches with a versioned persistence strategy; do not repeatedly quantise through 8-bit display images.

Aspire's sculpting is stronger for adjusting local form than global gamma/depth sliders. The existing mapping controls remain useful for source interpretation and must remain accessible.

**Acceptance:** edits affect only the selected region/component; undo restores exact pre-stroke data; save/reopen preserves heights; cancelled strokes do not persist; flattened planes respect the chosen height and masks. Stress a large field for responsiveness without changing the declared CAM resolution.

## R04. Add linked clipping and reusable local relief components

**Action: preserve source linkage during composition. Priority: Wave 3. Depends on: R01-R03. Scope: model plus asset workflow.**

Let a level/component use a referenced vector boundary as a live clip. Store local reusable components with source, size, units, provenance and our own/licensed asset content. Allow explicit bake/detach with preview and undo when an operator wants a fixed field.

This supports borders, medallions and repeated ornament without repeatedly editing pixels. Live clipping should have explicit inclusion/outside meaning rather than silently changing zero into transparency.

**Acceptance:** moving or editing a clip updates the composition; components outside the clip cannot reappear after reopening; a detached field remains stable; import of a reusable component previews scaling and base height; original source assets are preserved until a successful deliberate replacement.

## R05. Add cutter-specific 3D rest finishing

**Action: extend relief finishing. Priority: Wave 3, can start earlier after contracts. Depends on: C03-C05, C11. Scope: substantive CAM and residual geometry.**

Main already has roughing, one finishing tool, flat skipping, waterline and scallop controls. Add rest finishing that references the preceding relief cutter and predicted remaining stock, with a threshold for useful residual regions. Keep the expected stock resolution and uncertainty visible.

This learns from Aspire's multi-tool finish workflow while retaining our current heightfield engine. An extra fine pass over the whole model is not automatically a stock-aware rest pass.

**Acceptance:** analytic concavity and small-detail fixtures identify the regions a large cutter cannot reach; the smaller cutter covers those regions within tolerance; a larger cutter's path/tool change invalidates the rest result; uncertain low-resolution areas are disclosed rather than silently omitted. Report estimated savings separately from measured material trials.

## R06. Project vector machining onto a relief surface

**Action: add an explicit surface-following operation. Priority: Wave 3. Depends on: R01, C03-C05, C11. Scope: tool contact and depth semantics.**

Support engraving/profile-like intent at a defined depth relative to the chosen relief surface. Retain the vector source and target relief revision. Define whether the requested depth is vertical or along a supported contact model; expose cutter-envelope and slope limitations.

VCarve and Aspire show the usefulness of text or line detail over curved plaques. KerfDesk's relief surface is a natural substrate, provided this is not treated as a simple unchecked Z lookup.

**Acceptance:** analytic slopes and domes verify contact/depth semantics; steep/unreachable regions are disclosed; clearance moves account for the target surface; changing the surface invalidates output; output remains within the supported three-axis contract. No physical curved-surface measurement is implied.

## R07. Add rail/profile-based relief and moulding generators

**Action: extend relief authoring and specialised machining selectively. Priority: later Wave 3. Depends on: R01-R02, R06. Scope: new generator and optional CAM strategy.**

Start with bounded sweep/extrusion from one rail and profile, then add an explicit two-rail increment with multiple positioned cross-sections and width-dependent scaling. Retain all rails, sections and direction/height settings. Validate self-intersections and define corner handling, profile orientation and sampling tolerance. Keep the result within a supported single-valued relief domain.

Aspire's sweep/extrude tools and VCarve's moulding workflow fit router users who make frames and decorative trim. Keep authoring a relief and generating a dedicated moulding toolpath as distinct operations.

**Acceptance:** straight/curved rail fixtures preserve profile and dimensions; two-rail fixtures verify constant/varying widths, reversed rails and intermediate-section continuity. Crossing or multi-valued surfaces are disclosed. Tight corners produce clear evidence; source edits remain linked; materialised output works with existing relief CAM. A specialised moulding strategy requires its own cutter-envelope regression fixtures.

## D01. Add explicit two-sided CNC setups

**Action: extend setup transforms and registration. Priority: Wave 4. Depends on: C03-C06, C11. Scope: substantive coordinates/output.**

Represent side A/B, flip axis, registration features and each side's datum in the setup model. Preview their relationship and maintain separate reviewed artifacts. Reuse sheet/part identities and do not confuse two-sided artwork with an executable coordinate transform.

VCarve's two-sided workflow and Fusion's multiple setups illustrate a practical router expansion. This is more immediately relevant than simultaneous five-axis CAM, but its coordinate effects require governing-document review and focused tests before coding.

**Acceptance:** an asymmetric fixture has independently derived coordinates on both sides; registration and thickness changes regenerate relevant stages; each export names the correct side/datum; stale Frame evidence is invalidated when placement/footprint changes under the existing policy. Physical flip accuracy needs separate fixture trials.

## D02. Add bounded 2D constraints and named parameters

**Action: extend precision design. Priority: Wave 4. Depends on: C05 and a design-model ADR. Scope: solver and persistence.**

Begin with a defined subset of dimensional, coincident, horizontal/vertical and equal constraints plus named parameters. Handle under-, fully- and over-constrained states visibly. Preserve unconstrained existing entities and retain a deliberate bake-to-path option.

Fusion's constrained sketches are stronger for engineering intent. Our current independent entities and snapshot history are a useful starting point, but a solver must be introduced deliberately; renaming undo history as a feature timeline would not provide that capability.

**Acceptance:** resizing an analytical bracket preserves its constrained holes; inconsistent constraints identify the conflict without corrupting geometry; parameter units and references round-trip; changes invalidate only the associated machining sources; unrelated sketches keep working.

## D03. Add linked parametric part generators

**Action: preserve editable dimensions for common parts. Priority: Wave 4; a simple generator can precede the general solver. Depends on: C05 and the chosen design schema. Scope: bounded generators and source binding.**

Create useful bracket, panel, hole-grid and enclosure/fixture generators with named dimensions and dependencies. Store their intent and materialise geometry through existing scene/CAM interfaces. Preview the geometry update and affected operations before accepting it.

This captures a practical part of Fusion's regeneration value without promising a full solid/assembly kernel. Existing retained arrays, live Booleans and joint resizing in pending work should be reused for their supported semantics.

**Acceptance:** a 60-to-75 mm change updates the intended hole positions and boundaries, preserves overrides and regenerates linked CAM; generated IDs remain stable; invalid dimensions produce reviewable errors; bake/detach is explicit and undoable. A drawing preview must not claim engineering tolerance verification.

## D04. Qualify CNC wrapping and additional output capabilities separately

**Action: broaden supported capability-driven output. Priority: later Wave 4. Depends on: C03-C06, D01 and controller-specific qualification. Scope: machine/output architecture.**

Laser rotary is not CNC rotary machining. For CNC wrapping, define axis mapping, stock/cylinder datum, units, safe moves and allowed strategies against an explicit controller/post capability record. Additional coordinate systems, ATC or post families must similarly declare supported commands and transitions.

VCarve's wrapped jobs and Fusion's indexed/wrap workflows are useful benchmarks. Implement only the combinations proven by fixtures and controller simulation, then qualify particular machine/accessory setups. “All machines” means reusable architecture and truthful profiles, not unsupported universal motion.

**Acceptance:** independent coordinate fixtures verify wrap radius/axis direction; unsupported posts or modes remain clearly unavailable; per-tool files/manual holds remain correct; simulated controllers accept the expected program; physical evidence names the exact qualified machine/accessory/firmware. Do not enable arbitrary copied vendor posts.

## Selective feature backlog after the shared foundations

These smaller or more specialised recommendations complete the detailed audit coverage. They are proposed follow-ups rather than prerequisites for every user. Choose their order using the benchmark cases and actual demand; do not enable a new motion strategy through UI fields alone.

| Item | Change and benefit | Prerequisites | Meaningful acceptance |
|---|---|---|---|
| V01. Drill cycles | Add drill geometry, explicit centres, starting surface and peck-retract intent for holes below existing pockets. [VCarve comparison](VCARVE-PRO.md#9-drilling). | C03-C05, capability-driven output. | Independently derived Z/feed/retract sequence; explicit motion works on controllers without canned cycles. |
| V02. Fluting | Add retained variable-depth/taper-along-vector intent for decorative borders. [VCarve comparison](VCARVE-PRO.md#10-decorative-fluting). | C03-C05, depth/contact fixtures. | Reversed paths reverse end meaning; curves and maximum step-down remain correct in emitted passes. |
| V03. CNC textures | Add seeded, clipped groove patterns as reproducible machining intent. [VCarve comparison](VCARVE-PRO.md#11-machined-textures). | C03-C05/C07. | Identical save/reopen pattern, excluded holes, explicit depth passes and exact output identity. |
| V04. Profile production controls | Add editable depth schedules and feature entry choices over existing profile/finish planning. [VCarve comparison](VCARVE-PRO.md#7-production-profiling). | C03-C05. | A laminated-board schedule retains inside-first order and aligned finishing tabs. |
| V05. Tab and lead variants | Add triangular tabs and ramp-on-lead where useful. [VCarve comparison](VCARVE-PRO.md#13-tabs-ramps-and-leads). | Existing continuous tab/ramp contract, C02. | Short-contour cleanup reaches depth without weakening tabs or cutting into the finished wall. |
| V06. V-carve surfaces/stages | Add explicit starting-surface and ordered clearance-tool controls through the stage model. [VCarve comparison](VCARVE-PRO.md#5-v-carving). | C03-C05/C10. | Pocket-floor lettering uses the intended surface; clearing precedes its dependent finishing; reach/depth evidence remains valid. |
| A01. Weave | Extend retained extrusion with deterministic crossing heights for rope borders. [Aspire comparison](ASPIRE.md#5-extrusion-and-weave). | R01/R07. | Corner, seam and crossing fixtures reproduce a declared top-down field without claiming undercuts. |
| A02. Radial forms | Add profile-driven Turn/Spin-style relief generators for rosettes. [Aspire comparison](ASPIRE.md#6-turn-and-spin). | R01-R02. | Hemisphere/stepped analytical heights and finite centre samples; unsupported underside geometry is disclosed. |
| A03. Artistic brightness creation | Expose the existing artistic source meaning through a complete photo-to-component creation flow with histogram/physical depth controls. [Aspire comparison](ASPIRE.md#8-bitmap-to-relief-creation-and-source-meaning). | R01-R03. | Exact depth samples stay exact; ordinary-photo luminance is labelled artistic; mask meaning survives reopening. |
| A04. Relief interchange | Add orientation review and resolved-relief STL export; retain the separate existing simulated-stock exporter. [Aspire comparison](ASPIRE.md#9-stl-and-3d-interchange). | R01, declared units/tolerance. | Asymmetric axis/scale fixtures; mask closure and export error are explicit; source provenance is retained. |
| A05. Tile/assembly intent | Extend current XY tile preview for cutter overlap/feed-through; consider separate Z slicing only for thick relief assemblies. [Aspire comparison](ASPIRE.md#11-xy-tiling-and-z-slicing). | C03/C06, current tiling; R01 for slices. | Reviewed tile-local output, seam heights and cutter edge reach; independent thickness/assembly records for Z slices. |
| A06. Relief strategy choices | Add arbitrary raster angles and compare roughing ordering/offset finish only where geometry evidence supports them. [Aspire comparisons](ASPIRE.md#13-roughing-strategy-choices). | C02/C05, current rough/finish contracts. | Equivalent protected surfaces, declared cusp/contact behaviour and checked links; estimated savings remain separate from measured trials. |
| A07. Scalar textures | Add editable pattern spacing/shift/reflection and physical tile dimensions for relief backgrounds. [Aspire comparison](ASPIRE.md#18-resolution-and-relief-textures). | R01/R04 and pending array placement. | Deterministic masks/seams/composition; display quality cannot change the canonical field or G-code. |
| F01. Inspection records | Add local nominal/tolerance/actual/method checklists bound to program and production rows, using pending material/surface evidence. [Fusion comparisons](FUSION.md#13-setup-probing-and-inspection). | C01/C03/C06/C08. | Failed/unmeasured/uncertain states stay distinct; new output does not inherit old physical results; collecting readings cannot silently change WCS or output. |
## Work deliberately outside this 22-item plan

A full solid CAD kernel, mechanical assemblies, general feature timeline, CAE/FEA, PCB design, simultaneous multi-axis, mill-turn, full-machine digital twins, cloud collaboration and automatic physical-machine measurement would each expand the product substantially. They need their own scope, architecture and demand evidence. Fusion should guide the quality of manufacturing context before its entire platform becomes the target.

If mechanical CAD interchange becomes the priority, first qualify the files and geometry our users need, including loss/provenance disclosures. Rendering an imported mesh or exporting an STL does not establish parametric solid/assembly interchange.

## Replacement and removal decisions

The plan recommends no wholesale removal of current profile, pocket, V-carve, relief or preview engines. Replace loose context and disconnected workflow surfaces with shared models: unbound preset application with contextual cutting data; a single global setup surface with explicit setup identity; copied output notes with exact-artifact documentation; opaque recalculation with input signatures; destructive relief editing with retained component intent and deliberate baking.

During integration, retire only a duplicated surface/model whose replacement preserves its supported data and behaviour. That requires evidence from the final merged implementation. This audit does not identify specific existing files as dead code to delete.