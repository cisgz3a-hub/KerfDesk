# Aspire: creating and machining artistic reliefs

Audit date: 8 October 2026. KerfDesk main baseline: `e3820ed51a8d3e9ae8eab16f47097c4011dbd703`. See the [overview](REPORT.md) for the 104-test baseline and evidence boundaries, and the [implementation ledger](IMPLEMENTATION.md) for the integrated order.

**Aspire is stronger for creating original relief artwork because it retains components, vector-derived forms and local sculpting. KerfDesk already has a substantial one-sided relief machining pipeline. Add the editable creation layer above that pipeline.**

The comparison uses current official Aspire 12.5 Help and inspected KerfDesk source. The vendor applications were not run on shared jobs, so this is a capability/fit judgment rather than a measured finish or speed comparison. [Current Aspire release page](https://www.vectric.com/upgrade/aspire/).

Aspire converts imported full meshes into relief components. That is a suitable artistic comparison for KerfDesk's scalar heightfields, without implying full solid CAD. Its Advanced Machining Module is a separate machining add-on; it is not required for the relief authoring described here. [Model import contract](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/import-a-component-or-3d-model/index.html), [module scope](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/advanced-machining-module/index.html).

Pending PRs #1084/#1087 provide 2D hierarchy, arrays, live vector Booleans, sheets and production records. Reuse them for naming/selection/placement where their semantics fit. A 2D artwork group does not define additive/subtractive relief composition.

## 1. Component tree, combine modes and levels

Aspire combines components and levels with Add, Subtract, Merge High, Merge Low and specialist Multiply. [Composition guide](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/page/user-guide/).

KerfDesk's [relief object][K-object] owns one durable source, and its [compiler][K-compile] plans reliefs per object. Multiple overlapping reliefs therefore do not establish a shared editable component model.

**Aspire is stronger in composition. Add** ordered scalar components with explicit baseline, height range, masks and levels. Materialise one immutable revisioned field for preview/CAM. This makes raised lettering, a border and ornament separately revisable.

**Acceptance:** analytic overlapping ramps verify each combine mode; reorder, hide, undo and reopen reproduce the same field; CAM machines the composite rather than recutting independent overlapping surfaces. Ledger R01.

## 2. Dynamic properties and deliberate baking

Aspire retains height, tilt and fade properties, and can consolidate components by baking; its preserve-originals option keeps the source components. [Dynamic properties](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/page/user-guide/), [Baking Components](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/baking-components/index.html).

KerfDesk's current relief properties include placement, physical dimensions and depth/mapping, but not the same composition-level properties.

**Aspire is stronger in reversible composition edits. Add** dynamic component properties and a deliberate “Bake a copy” action. Retain source identity until conversion succeeds.

**Acceptance:** baked/unbaked surfaces agree within declared sampling and quantisation tolerance; placement/masks survive; undo/cancel restore sources; out-of-range heights are disclosed rather than silently lost. Ledger R01/R04.

## 3. Vector-derived relief shapes

Aspire creates flat, round, angled, smooth and custom forms from closed vectors. [Create Shape](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Create%20Shape/).

KerfDesk has [typed sketch entities][K-sketch] and drawing/modification tools, but [scene conversion][K-convert] produces 2D geometry. Relief import/mapping does not supply a linked vector-to-height recipe.

**Aspire is stronger in native shape creation. Extend** Design Studio with retained vector-to-field recipes, starting with planes, domes and slopes. This suits badges, raised text and plaques without external STL authoring.

**Acceptance:** circles/rectangles match analytical profiles; holes remain holes; concave/small boundaries are treated reproducibly; source and height edits survive save/reopen. Ledger R02.

## 4. Two-rail sweep

Aspire supports open/closed rails, multiple cross-sections, their placement, direction and width/height controls. [Two Rail Sweep](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Two%20Rail%20Sweep/index.html).

Bounded searches of KerfDesk design, relief, scene and Studio authoring found no relief sweep. The Studio reference to two rails is toolbar layout, not surface geometry.

**Aspire is stronger in availability. Add later** a retained scalar sweep for leaves, ribbons and borders after the component/shape model is stable.

**Acceptance:** constant width preserves section dimensions; reversed rails are explicit; intermediate sections remain continuous; crossing or multi-valued surfaces are disclosed. Ledger R07.

## 5. Extrusion and weave

Aspire sweeps sections or existing components along rails and applies height changes at crossings for a woven appearance. [Extrude and Weave](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Extrude%20and%20Weave/index.html).

The reviewed KerfDesk authoring/CAM surfaces have no equivalent retained relief generator.

**Aspire is stronger for rope borders and decorative panels. Add selectively** extrusion first, then deterministic crossing-height rules. Treat the result as a supported top-down surface.

**Acceptance:** rail reversal, sharp corners, closed seams and overlap composition reproduce after reopening. Neither the scalar result nor its preview should imply machinable undercuts. Ledger R07 and follow-up A01.

## 6. Turn and Spin

Aspire revolves an open profile about a declared endpoint axis/centre into a relief component. [Turn and Spin](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Turn%20and%20Spin/index.html).

KerfDesk's sketch union has no rotational relief recipe, and the scoped relief search found none.

**Aspire is stronger in radial-form authoring. Add later** profile-driven rosettes and symmetric ornaments. Modelling a radial component and executing rotary CNC are different capabilities.

**Acceptance:** hemisphere and stepped radial fixtures match analytical fields; centre samples stay finite; unrepresentable underside geometry is disclosed. Follow-up A02.

## 7. Sculpting, local restoration and stroke undo

Aspire documents Smooth, Smudge, Deposit, Remove and Undo Brush, adjustable brush controls, transparency preservation and component brushes. [Sculpting](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Sculpting/index.html).

KerfDesk's [selected relief controls][K-properties] edit depth and mapping. The source search did not establish a comparable interactive height sculptor; the product plan still marks Relief Map Studio as planned. The source inspection, rather than that plan alone, supports the gap.

**Aspire is stronger in local form editing. Add** deterministic masked add/remove/smooth/flatten tools with one undo transaction per stroke before advanced custom brushes. Keep exact source samples and precision separate from display pixels.

**Acceptance:** untouched U16 samples stay identical; masks are respected; cancel/undo restore samples and digest; a large worker-backed stroke cannot commit to a replaced document. Ledger R03.

## 8. Bitmap-to-relief creation and source meaning

Aspire creates components from bitmaps and recommends direct conversion to retain 16-bit data. [Create Component from Bitmap](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/create-component-from-bitmap/index.html).

KerfDesk already [decodes declared grayscale depth samples][K-depth-import] and has polarity, endpoints, gamma, crop and masks in its [canonical field mapping][K-field]. Its schema recognises `brightness-emboss`, and the [source-meaning UI][K-meaning] labels it as artistic emboss rather than recovered geometry. The reviewed import/authoring path does not establish a complete ordinary-photo relief creator.

**Aspire is stronger in connected artistic authoring; keep KerfDesk's explicit source interpretation. Extend** a clearly labelled brightness-relief creation path with histogram, physical dimensions and depth preview. Do not turn arbitrary luminance into a claim of recovered 3D shape.

**Acceptance:** exact depth imports retain samples; artistic photo intent has a distinct source label; transparent pixels follow the chosen outside-mask meaning. R01-R03 and follow-up A03.

## 9. STL and 3D interchange

Aspire imports several mesh formats, orients/converts them into reliefs, and exports triangulated models with tolerance/count and back-face controls. [Import](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/import-a-component-or-3d-model/index.html), [STL export](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Export%20Model%20as%20an%20STL%20file/index.html).

KerfDesk already has binary/ASCII STL parsing and [top-down import preparation][K-stl]. It also has a separate simulated-stock STL export in the G-code Inspector; that is not an authoring export of a resolved relief component. The scoped authoring/export search did not establish the latter.

**Aspire is stronger in relief interchange. Extend** orientation review and add resolved-field export before expanding file formats. Preserve explicit units and provenance.

**Acceptance:** asymmetric fixtures prove axis/scale interpretation; exported masks/back closure and maximum approximation error are declared. Follow-up A04.

## 10. Clipping, clearing and splitting

Aspire can clip levels while retaining sources and separately clear/split components with vectors. Its documented level clip has an explicit update after boundary edits. [Level Clipping](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/level-clipping/index.html), [Clearing/Splitting](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/clearing-or-splitting-components/index.html).

KerfDesk has rectangular crop and inclusion masks, but its reviewed source model has no linked relief/vector clipping reference.

**Aspire is stronger in composition boundaries. Add** live vector masks and explicit split results through the existing geometry kernel. A automatically refreshed clip could improve revision convenience, subject to tests.

**Acceptance:** holes, mirrors and rotation align in canvas, field and CAM; boundary deletion/editing has a defined result; excluded stock remains meaningful to cutter clearance. Ledger R04.

## 11. XY tiling and Z slicing

Aspire distinguishes individual tiles from feed-through stock and provides overlaps/individual previews; Z slicing is a separate function. [Toolpath Tiling](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/toolpath-tiling-manager/index.html), [Slice Model](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Slice%20Model/index.html).

KerfDesk already has [tile planning][K-tiles], registration planning and per-tile export. Tiling is present. The reviewed relief authoring does not supply a Z-slice assembly model.

**Aspire is stronger in documented tile/assembly controls. Extend** preview with cutter overlap and assembly/feed-through intent. Consider Z slicing only when thicker relief assemblies justify it.

**Acceptance:** assembled XY tiles preserve seam heights; tile-local output matches reviewed placement; short final tiles and ball-nose edge reach are checked. Follow-up A05.

## 12. Moulding CAM

Aspire machines an open cross-section along a rail directly, with profile-aware stepover and larger clearance tooling. [Moulding Toolpath](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/uiExtrudedToolpathForm/index.html).

KerfDesk lacks that dedicated operation in the inspected model. Existing flat-finish/skip, roughing and cutter-contact machinery provide reuse opportunities.

**Aspire is stronger for trim and frames. Add later** vector-profile CAM alongside, rather than conflating it with, relief generation.

**Acceptance:** analytic sections, reversed profiles and curved rails preserve intended contact; mitres are explicit; stock left for finish is independently checked. Ledger R07.

## 13. Roughing strategy choices

Aspire offers Z-level/3D raster roughing, level/depth ordering and optional avoidance of machined areas. Its Help cautions that extra retracts can negate an expected time saving. [3D Roughing](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Rough%20Machining%20Toolpath/index.html).

KerfDesk already has [waterline levels, concentric clearing, slope steps, allowance and flat finishing][K-rough]. Those are meaningful strategies, not merely an imported STL preview.

**Aspire has broader documented choices; no performance winner is established. Extend selectively** ordering/strategy comparisons backed by stock-contact fixtures.

**Acceptance:** common fixtures preserve equivalent protected surfaces and depth limits; cutting/travel lengths and simulated estimates are separate from actual machine measurements. Follow-up A06.

## 14. Finishing patterns

Aspire offers offset finishing and adjustable raster angle. [3D Finishing](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Finish%20Machining%20Toolpath/index.html).

KerfDesk has [scallop-derived spacing][K-finishing], raster/waterline choice and X/Y raster direction. Keep its explicit steep-wall passes and resolution disclosures.

**Aspire is stronger in directional choice. Extend** arbitrary-angle raster first, then surface-following offsets where fixtures show value.

**Acceptance:** rotated analytical ridges preserve declared cusp/contact behaviour; links, boundaries and nonuniform scaling are independently checked. Follow-up A06.

## 15. Remaining-material relief finishing

Aspire uses an ordered finishing-tool list for residual regions, with minimum-detail and boundary-expansion controls. [Rest finishing](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Finish%20Machining%20Toolpath/index.html).

KerfDesk resolves [one relief finishing tool][K-finish-tool]; its rest planner is pocket-specific. Flat skipping is useful, but is not general cutter-specific relief rest finishing.

**Aspire is stronger in staged relief finishing. Add** finish-stage dependencies against previous cutter coverage and a predicted residual field.

**Acceptance:** wide-ball then narrow-ball results match required narrow-tool coverage; skipped regions are demonstrably finished; uncertain stock enlarges work conservatively; tiled stages retain the correct dependency. Ledger R05.

## 16. Double-sided reliefs

Aspire owns two sides, flip direction and a shared physical Z reference. [Double-sided Setup](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Job%20Setup%20Double/index.html).

KerfDesk's canonical field is explicitly one-sided. Two relief objects or sheet archives alone do not define physical side/datum ownership.

**Aspire is stronger in two-sided relief organisation. Add later** paired sides through explicit CNC setups after one-sided authoring is stable.

**Acceptance:** asymmetric front/back fixtures verify supported flip axes and datums; each side owns its program/placement review; physical registration remains separately qualified. Ledger D01.

## 17. Rotary reliefs

Aspire has cylinder dimensions, axis/surface zero, wrapping and rotary simulation. [Rotary Setup](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Job%20Setup%20Rotary/index.html).

KerfDesk's [laser rotary implementation][K-rotary] excludes CNC. Its current planar heightfield and XYZ toolpath contract are not a wrapped scalar domain with angular output.

**Aspire is stronger in availability. Defer** to a dedicated capability design with seam, radial/axial and unwind semantics.

**Acceptance:** independent software fixtures verify full-revolution mapping and dimensions before an expressly authorised machine trial. Ledger D04.

## 18. Resolution and relief textures

Aspire exposes modelling resolution and editable texture areas with spacing, shifts and reflections. [Modelling resolution](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Job%20Setup%20Single/index.html), [Create Texture Area](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/Create%20Texture%20Area/index.html).

KerfDesk already distinguishes canonical source samples, tool-dependent CAM grids and [display-only resolution][K-display]. Preserve this useful precision contract. Pending arrays are placement infrastructure, not a scalar texture recipe.

**Aspire is stronger in texture authoring; KerfDesk's resolution transparency is valuable. Add selectively** retained scalar patterns whose physical size and composition are explicit.

**Acceptance:** enlarged regions preserve physical tile size; masks/seams/overlaps are deterministic; display quality cannot change the canonical digest or G-code; modelling pitch, CAM pitch and cusp remain separately visible. Follow-up A07.

## Most useful changes for KerfDesk

Build relief composition first, then vector shape creators, masked sculpting, linked clipping and cutter-specific rest finishing. These address the main creative gap while preserving exact grayscale import, existing rough/finish engines and resolution disclosure. A plaque's border, text and ornament should remain independently editable, then produce one coherent field for CAM.

The extra sweeps, radial forms, textures, slicing and interchange belong in a staged backlog. They should follow evidence of user demand and the stable component model. Full engineering solids are outside this relief-authoring plan.

[K-object]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/scene-object.ts#L529
[K-compile]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/compile-cnc-relief.ts#L117
[K-sketch]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/design/sketch-entity.ts#L28
[K-convert]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/design/to-scene-object.ts#L43
[K-properties]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/ui/layers/SelectedReliefProperties.tsx#L94
[K-depth-import]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/ui/import/depth-map-import-preparation.ts#L40
[K-field]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/scene/relief/relief-heightfield.ts#L13
[K-meaning]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/ui/layers/ReliefSourceMeaning.tsx#L13
[K-stl]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/ui/import/stl-import-preparation.ts#L38
[K-tiles]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/plan-tiles.ts#L6
[K-rough]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/relief/relief-roughing.ts#L1
[K-finishing]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/relief/relief-finishing-strategy.ts#L57
[K-finish-tool]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/cnc/compile-cnc-relief.ts#L210
[K-rotary]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/core/job/rotary-job.ts#L16
[K-display]: https://github.com/cisgz3a-hub/KerfDesk/blob/e3820ed51a8d3e9ae8eab16f47097c4011dbd703/src/ui/relief-viewer/relief3d-display-resolution.ts#L11