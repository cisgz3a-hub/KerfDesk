# xTool Studio audit and KerfDesk change recommendations

Audit date: 7 October 2026. KerfDesk baseline: `76b5ff53e3be7df6c160a8b26820e61188595f08`, fetched and checked against remote main. xTool comparison: official documentation through Studio Desktop 1.9. Application source was not changed during the audit. The subsequent authorised implementation is recorded separately in the [implementation list](../../implementation/xtool-workflows-20261007.md) and [verification record](../../implementation/xtool-workflows-verification-20261007.md); the baseline findings below remain the audit snapshot.

## Decision

KerfDesk should learn most from Studio's connected manufacturing workflows: preparing a design, selecting a material, retaining evidence from a test, and repeating the result. The best investment is to connect and improve KerfDesk's existing tools, then add a small number of substantial capabilities.

The leading proposals are a photographed material-test notebook, editable arrays, reusable production batches, a clearer object hierarchy, better nesting choices, reviewable joint resizing and project sheets. These can benefit both laser and CNC users. Automatic focus, measured curved-surface engraving and conveyor execution need compatible devices and protocols; adding their buttons would not recreate the capability.

This audit does not establish that Studio produces better engravings, packs parts more efficiently on identical inputs, estimates time more accurately or places designs more precisely. It establishes documented workflows and compares them with current KerfDesk source. Statements about expected benefits below are engineering assessments, with acceptance criteria to test them.

## Evidence and current-version corrections

Studio is XCS's successor; xTool ended XCS updates at 2.7. Studio 1.9 is documented on 11 September 2026. Some help pages retain older terminology or capabilities. [Transition notice][X-transition], [Studio 1.9][X-19].

Important corrections to an audit based on older pages:

- Current project files default to `.xs`; `.xcs` remains a compatibility export. Cloud version history is documented. [Studio 1.7.30][X-17].
- The May nesting guide's future grid-layout statement is superseded by Matrix mode. No current numeric capacity was verified. [Nesting guide][X-nest], [Studio 1.9][X-19].
- The older layer page's eight-colour description is superseded by the release documenting sixteen identified layers. Its warning about newly created same-colour objects not inheriting processing parameters remains a significant model distinction. [Layers and objects][X-objects], [Studio 1.5][X-15].
- Illustrator import scope differs between the products; see record 39. [Studio 1.9][X-19], [PDF-compatible artwork][K-pdf].
- The new interrupted-resume claim concerns O1 printing. Generic post-crash laser recovery remains unverified. [Studio 1.9][X-19].
- A legacy camera Batch Fill guide's restrictions must not be presented as universal Studio 1.9 limits. The separate Customthings Enterprise workflow is also not a standard Studio feature. [Legacy Batch Fill][X-legacy-batch], [Enterprise workflow][X-enterprise].

KerfDesk was inspected in the clean isolated checkout at `D:\LaserForge\competitive-audit-20261007`. The primary checkout has substantial unrelated work, which was preserved and excluded from this baseline. The audit added 47 selected test files: 347 tests passed, with no failures or pending tests. The preceding comparison already ran 566 passing tests in 41 other files at the same source revision; those were reused, not rerun. Together that is 913 passing tests across 88 distinct files. See [verification summary](verification-summary.json) and [raw new results](verification-vitest.json).

The test evidence supports the existing foundations. It does not qualify real machines or prove the recommendations. Studio was not installed or exercised, no competitor account was created, and no hardware was operated. Earlier local KerfDesk browser checks covered workspace entry, CNC drawing and preview; this extension of the audit relies on source and focused component/core tests.

Edition scope matters: current source contains tools that the Free browser bundle strips. Camera alignment, Design Studio, advanced tracing, V-carve/relief/adaptive tools and G-code inspection are marked Pro; ordinary component tests are not proof that those tools are available in Free. The proposals below preserve the existing boundary, including Line Art as the sole Free tracer, and do not change sales/provider state. [Pro feature registry][K-pro], [Free build separation][K-free-build].

## What the comparison actually says

| Area | Studio's documented strength | KerfDesk today | Decision |
| --- | --- | --- | --- |
| Material learning | Physical results feed back into reusable settings | Recipes, revisions, matching and flexible grids already exist | Extend them into one experiment workflow |
| Repetition | Arrays can remain editable; tabular personalisation has batch previews | Arrays, CSV text and serial advancement exist; arrays become ordinary objects | Preserve editable intent and add a production manifest |
| Project organisation | Named canvases, local/cloud assets and history | One project scene, recent projects, personal artwork, notes and recovery | Add sheets and visible organisation; reuse local storage foundations |
| Design editing | Repair and composition controls are grouped around the selected object | Many equivalent tools exist across the main canvas and Pro workspaces | Consolidate access where it reduces friction; preserve engines |
| Nesting | Different layout goals and ongoing optimisation | Fast/outline nesting, bounded contour solver and 90-degree rotation | Extend the solver and workflow; benchmark results |
| Assembly fitting | General thickness-driven joint resizing | Parametric box fitting and CNC dogbones exist | Add reviewable joint detection for imported assemblies |
| Ordinary laser processing | Fill/raster strategies and parameter controls | Contour fill, cross-hatch, scan angles and eleven raster algorithms exist | Keep; improve explanations and comparisons |
| Machine experience | Deep integration with supported xTool devices | Guided controller setup, diagnostics and broad generic profiles | Improve visibility; extend capabilities only where supported |
| Camera automation | Factory-integrated focus, capture and sensing | Calibrated bed/head camera, piece detection and placement exist | Improve qualification and workflow; hardware automation is separate |
| CNC manufacturing | Useful shared design/material/batch ideas | Tool-aware router CAM, stock, relief and stage ordering | Adapt the workflow without replacing router engineering |

## Forty areas to adopt, improve, retain or defer

Priorities: **P1** means the next product improvement programme; **P2** means a subsequent substantial feature; **P3** means a targeted or hardware/service-dependent extension. These are proposals, not estimates of delivery time. **Keep** means the existing implementation should survive the redesign. **Replace surface** means change the user workflow while retaining its underlying data and engine.

### 01. Start screen and reusable local assets

**Studio evidence.** Home, personal storage, template discovery and processing materials have distinct destinations; newer Local Space adds covers, tags and filters without relocating originals. Cloud storage and template discovery have account/network dependencies. [Navigation][X-home], [Studio 1.8][X-18].

**KerfDesk baseline.** Recent projects, pinning, personal artwork and project templates already exist. A saved personal artwork record retains selected content and portable assets. [Recent projects][K-recent], [Personal artwork][K-artwork], [Project templates][K-templates].

**Change: replace surface, P1.** Offer a compact start/resume view with recent work, reusable parts, examples and materials. Keep direct entry to the current workspace. Add useful thumbnails and filters to existing local records before developing a marketplace.

**Why and fit.** It should make known projects and fixtures easier to find. Laser logos and router components can use the same asset system. Avoid Studio's confusing reuse of “materials” for both artwork assets and physical process materials. Verify that opening, locating a missing file and restoring a recent project remain clear and do not move original files.

### 02. Named sheets inside one project

**Studio evidence.** A project can contain multiple canvases that users add, rename, duplicate and delete. The guide does not establish multi-canvas execution semantics. [Canvas management][X-canvas].

**KerfDesk baseline.** The current project stores one scene, workspace, job setup and machine context. CNC tiling is a manufacturing feature, not a substitute for independent document sheets. [Project model][K-project].

**Change: add, P2.** Introduce sheets for design alternatives, stock layouts, test coupons and fixture setups. Start with an explicit active sheet and explicit selected job. Keep cross-sheet production as a later, separately specified capability.

**Why and fit.** Related designs stay together without filling one bed with off-job artwork. Laser sheets can represent material runs; CNC sheets can hold distinct stock setups. This needs a schema migration, per-sheet placement identity, save/recovery support and unambiguous Frame ownership. A sheet switch must never silently select or stream another sheet's work.

### 03. History, notes and repeat-job context

**Studio evidence.** Cloud history can restore or duplicate earlier versions. Project notes can be visible during editing/processing and can trigger reminders. [Studio 1.7.30][X-17], [Studio 1.8][X-18].

**KerfDesk baseline.** Versioned projects, undo, durable recovery and saved project notes already exist. Notes are edited through a dedicated command. [Project model][K-project], [Project notes][K-notes], [Recovery][K-autosave].

**Change: extend, P1/P2.** Surface existing notes in the preparation view and add named local snapshots with compare/duplicate/restore. Store the design, recipe and fixture revisions used by a repeat run.

**Why and fit.** Operators can answer “which version made the successful piece?” Cloud sync is optional infrastructure, not a prerequisite for this benefit. Notes should remain informative; they must not become an extra Start gate. Verify restore after a schema upgrade and preserve the current document when opening an old snapshot for comparison.

### 04. Object hierarchy, names and group editing

**Studio evidence.** Its object list exposes named objects/groups, visibility, locks and hierarchy/stacking. Nested groups can be entered directly without repeated ungrouping. Colour grouping does not automatically assign new-object process settings. [Object list][X-objects], [Grouping][X-groups].

**KerfDesk baseline.** Groups are flat lists of object IDs, without a parent/child group model. Artwork labels derive largely from content, type or source; operation names are editable. A searchable run-order view reports actual CNC stages/tools, but is not a full design hierarchy. [Group actions][K-groups], [Run-order view][K-run-order], [Artwork operations][K-operations].

**Change: extend, P1.** Add a named design tree with visible editing scope and group breadcrumbs, while retaining the run-order view as a separate manufacturing view.

**Why and fit.** Finding one label or hidden component in an imported assembly becomes easier. Preserve explicit operation IDs and distinguish stacking, grouping and execution order. Test nested groups, masks, path-text guides, locks, selection and undo; dragging a design row must not accidentally change CNC tool/stage order.

### 05. A predictable contextual inspector

**Studio evidence.** Creation tools, contextual editing and device/processing controls occupy predictable regions. Its overview presents multiple project tabs and a dedicated canvas panel. [Studio overview][X-overview].

**KerfDesk baseline.** The artwork inspector already separates artwork adjustment from operation editing, and the rail has settings, run-order and material views. Basic laser controls deliberately reveal advanced settings through a secondary surface. [Artwork inspector][K-inspector], [Panel tabs][K-panel-tabs], [Basic laser controls][K-basic-laser].

**Change: keep and refine, P1.** Make selection identity, object count, current process and machine context consistently visible. Reuse existing tabs. Consolidate duplicate entry points only after recording which tasks they support.

**Why and fit.** Users should predict whether a control changes the artwork, operation or machine. This matters more in a combined laser/router product. Verify discoverability with novice and experienced users; screenshots alone do not prove Studio needs fewer clicks. Keep expert controls reachable and keyboard-accessible.

### 06. Arithmetic, units and coordinate anchors

**Studio evidence.** Numeric fields support calculations and mm/inch conversion; object positioning has a documented anchor convention. [Studio 1.6.6][X-166], [Positioning][X-position].

**KerfDesk baseline.** Numeric Edits already supports arithmetic, functions, units, percentages, anchor choice and aspect locking. Several other geometry dialogs use ordinary number parsing. [Expression parser][K-numeric], [Numeric toolbar][K-numeric-ui].

**Change: normalise where incomplete, P1.** Reuse the existing parser in appropriate geometry fields, showing the interpreted result and units. Keep machine/work coordinates visibly distinct from artwork coordinates. Do not add a second expression engine.

**Why and fit.** Entering a half-inch offset or a calculated label width should not require a separate calculator. CNC users particularly need unit clarity. Reject invalid/non-finite expressions before committing a change; conversions must preserve physical size. A decimal input control is not proof that all fields already share expression support.

### 07. Selection and snapping in crowded drawings

**Studio evidence.** Snapping shows guides, and a precise vector-path selection option can avoid overlapping bounding-box hits. [Selection guide][X-selection].

**KerfDesk baseline.** Grid/object/node/midpoint/centre/intersection snapping, alignment guides and modifier-based suppression already exist. [Snap settings][K-snap], [Pointer snapping][K-pointer-snap].

**Change: retain existing selection tools, improve unresolved cases, P1.** Use dense imported fixtures to assess zoom-aware line selection, overlapping-object cycling and contained/crossing selection. Distinguish visually coincident endpoints from genuinely joined topology.

**Why and fit.** Selecting a hole inside a panel should be predictable. This improves both laser assembly editing and CNC profile preparation. Do not replace a working selection model solely because Studio exposes a toggle. Acceptance requires repeatable dense-path selection and consistent pixel tolerance at different zoom levels.

### 08. A coherent node-repair workspace

**Studio evidence.** Numeric node editing, handle types and simplification are documented; later releases add direct add/delete/break tools, segment bending, endpoint merging and intersection trimming. [Node editing][X-nodes], [Studio 1.8][X-18].

**KerfDesk baseline.** Smooth/Corner/Curve/Line/Start/Break/Join commands, repair, trimming and optimisation exist. Numeric node coordinates/alignment were not found in the inspected UI. Optimisation previews statistics; its dialog lacks a graphical before/after overlay. [Node toolbar][K-toolstrip], [Optimisation dialog][K-optimise].

**Change: consolidate access, P1.** Reuse these engines in a coherent repair mode with node coordinates, alignment, topology feedback and graphical comparison. Make the editing scope and exit clear.

**Why and fit.** Imported paths can be repaired without a chain of unrelated dialogs. Show open ends, duplicate paths and resulting contour counts. Laser fill and CNC pockets require different validity checks, so a visually smooth curve alone is insufficient. Verify repair against holes, touching paths and tiny features without quietly changing intended dimensions.

### 09. Boolean and offset previews

**Studio evidence.** Boolean and compound operations are documented; current history includes Boolean previews and selectable offset precision. [Booleans][X-booleans], [Compounds][X-compounds], [Studio 1.7.30][X-17], [Studio 1.8][X-18].

**KerfDesk baseline.** Booleans replace selected operands with combined artwork, with undo. Offset Shapes already has a graphical source/inward/outward preview. Saved editable Boolean compounds were not found. [Boolean action][K-boolean-action], [Offset preview][K-offset-preview].

**Change: extend Booleans, P1/P2.** Add a result preview and optional retained compound/operands. Keep the existing offset preview and consider retained offset parameters separately. Explain editability and physical tolerance rather than only a rendering-quality label.

**Why and fit.** Users can see which part a subtraction removes before losing the source composition. Keep one undo step and optional original retention. Test nested holes, self-intersections, scale extremes and resulting laser/CNC contours; do not replace the geometry engine without an independently demonstrated defect.

### 10. Consistent corner editing

**Studio evidence.** Vector corner styles include rounding, inverted rounding and chamfering. [Studio 1.9][X-19].

**KerfDesk baseline.** Rectangles retain one global radius. Design Studio supports selected-corner fillets/chamfers, but some edits convert parametric shapes to paths; inverted rounding was not found. [Corner application][K-corner-apply], [Corner geometry][K-corners].

**Change: extend access, P2.** Offer a consistent selected-path corner preview, integrating current fillet/chamfer routines where applicable. Add inverted rounding only if customer demand supports it.

**Why and fit.** Shared corner controls reduce the need to switch workspaces for small edits. Laser corner styling and CNC inside-corner relief are different intentions: preserve dogbone/tool-radius controls. Handle short edges, neighbouring radii and self-intersections explicitly, and retain the source path until acceptance.

### 11. Assembly joints that follow material thickness

**Studio evidence.** Detected slots/cross joints can be resized for thickness. [Studio 1.9][X-19].

**KerfDesk baseline.** Box generation already knows its joint geometry, offers fit coupons and handles CNC corner relief. That is not general detection in arbitrary imported artwork. [Box generation][K-box], [Dogbone geometry][K-dogbone].

**Change: add, P2.** Prefer semantic joints from our generators; propose detected joints for imported vectors with an editable before/after list. Keep material thickness, fit allowance and measured laser kerf as separate inputs.

**Why and fit.** Changing a 3 mm assembly to a different sheet should not require editing every slot. Router joints also need cutter diameter and relief. Begin with known rectangular slots/cross-laps, leave uncertain features unchanged, and run physical fit coupons before claiming assembly accuracy. A uniform resize of the whole design is not an adequate substitute.

### 12. Text boxes that fit variable content

**Studio evidence.** Text boxes offer growth, wrapping and automatic fitting. Font/spacing controls are also documented. [Studio 1.9][X-19], [Text editing][X-text].

**KerfDesk baseline.** Editable text, font handling and CSV-driven variable text already exist. [Text object][K-text], [Variable controls][K-variables].

**Change: extend, P1.** Add explicit text-box constraints, wrapping and fit rules where missing, with minimum readable size and overflow disclosure. Preserve editable source text.

**Why and fit.** A batch containing short and long names should stay inside its label boundary. The same composition rules serve engraved tags and carved signs. Test Unicode shaping, multi-line content, missing fonts, generated variables and physical dimensions; long names should not silently shrink into unusable lettering.

### 13. Editable path text and warp

**Studio evidence.** Path text, text warp and explicit conversion/welding boundaries are documented. [Text warp][X-warp], [Curve/weld][X-weld], [Studio 1.7.30][X-17].

**KerfDesk baseline.** Editable text-on-path, alignment, bending and welding already exist. Generic Warp/Deform previews live, but applying it converts text/parametric shapes into ordinary paths. [Path text][K-path-text], [Warp plan][K-warp].

**Change: keep and unify, P2.** Improve direct guide/offset manipulation and retain editable warp parameters where practical. Preserve an editable original when converting to outlines.

**Why and fit.** Typography remains reusable when the customer changes a name or size. Useful for laser badges and CNC signs. General perspective/envelope distortion is a separate enhancement, not evidence that our path-text engine is absent. Verify guide reversal, offsets, baseline placement and font portability before claiming equivalent results.

### 14. Arrays that remain editable

**Studio evidence.** Arrays can be re-edited after creation, with spacing and centre controls. Grid and circular placement workflows are documented. [Studio 1.7.30][X-17], [Grid arrays][X-grid-array], [Circular arrays][X-circle-array].

**KerfDesk baseline.** Grid, point-rotation and circular arrays already support rich spacing, mirroring and variable advancement. The applied array becomes ordinary objects; its layout specification is not saved in the project. [Array layout][K-array-layout], [Array host][K-array-host].

**Change: add persistent intent, P1/P2.** Store an array definition and source members, allow count/spacing edits, and offer explicit expansion to independent objects. Preserve per-instance overrides through a defined rule.

**Why and fit.** A customer can change 20 labels to 30 without rebuilding the composition. Laser blanks and router repeated parts share the benefit. The compiler should consume a deterministic materialised snapshot through the current pipeline. Test save/reopen, variables, masks, groups, object budgets, undo and a changed source object.

### 15. A production manifest for personalised batches

**Studio evidence.** Current variables support tabular replacements, fit/alignment and previews; a detailed workflow imports XLSX plus companion assets from a ZIP. The documented machine workflow is not proof of universal generic-controller batch support. [Variables][X-batch-variables].

**KerfDesk baseline.** CSV text fields, serial/record sequencing, optional per-array advancement and advancement after successful export or stream already exist. [Variable controls][K-variables], [Batch sequences][K-batch-sequence].

**Change: extend, P1/P2.** Add a saved manifest with row IDs, rendered previews, explicit skipped/invalid rows, placement references and completed/failed state. Later add image/vector variables and XLSX import if they justify their complexity.

**Why and fit.** The operator can see which personalised items will be made and which remain. CSV is a useful simple route and should remain. Sequence allocation must not advance after cancellation or an ambiguous failure. Router batches need stock/tool context; conveyor delivery requires additional hardware. Resume from a manifest is not permission to replay an uncertain physical job.

### 16. One image-preparation journey

**Studio evidence.** Bitmap editing groups tonal changes, crop/cutout, enhancement, tracing and optional AI operations. [Bitmap editing][X-bitmap].

**KerfDesk baseline.** Image Studio already has adjustments, filters, layers, masks, history, retouch and Apply/Apply & Trace. Main-canvas image settings control the actual engraving pipeline. [Image Studio][K-image-studio], [Image adjustments][K-image-adjustments], [Image processing][K-image-processing].

**Change: keep engines, refine surface, P1.** Provide a clear route from source image to prepared image to emitted raster, with original/current comparison. Decide which basic edits belong on the canvas and which advanced edits belong in Image Studio.

**Why and fit.** Users can judge what each edit does to the manufactured result. Do not remove layers or retouch simply because Studio's entry flow appears simpler. Avoid double-applying edits between the image editor and engraving settings. Compare prepared pixels, preview and compiled raster on the same fixture.

### 17. Trace by intended manufacturing result

**Studio evidence.** Tracing provides a source/vector overlay and separates boundary and centreline purposes. Its guide contains inconsistent smoothness-scale wording, so exact parameter parity is uncertain. [Image tracing][X-trace].

**KerfDesk baseline.** Line Art, centreline, hybrid line/fill, colour layers, photo and other presets already exist; the hybrid engine uses local stroke width. Only Line Art is Free under the current edition policy. [Trace presets][K-trace-presets], [Hybrid tracing][K-hybrid], [Pro features][K-pro].

**Change: keep algorithms, improve comparison, P1.** Explain “cut an outline”, “engrave strokes” and “fill regions”; show a zoomable overlay, open contours, holes, path count and expected motion. Keep expert controls available.

**Why and fit.** Choosing output purpose is more useful than guessing which preset name will work. Do not replace a stronger hybrid algorithm on the evidence of a cleaner dialog. Benchmark topology, dimensions, excessive segments and emitted path behaviour on a shared image corpus. Visual quality and physical burn quality need separate evaluation.

### 18. Reversible masks and physical-art capture

**Studio evidence.** Masks are reversible; M2 adds photographed-artwork contour extraction. [Masks][X-mask], [Studio 1.9][X-19].

**KerfDesk baseline.** Owned image masks, camera capture/trace and print-and-cut registration already have implementations. [Camera tracing][K-camera-trace], [Mask ownership][K-mask].

**Change: integrate, P2.** Offer a capture → scale/registration → trace/offset → compare → accept journey using current components. Preserve the photo and source geometry.

**Why and fit.** Hand-drawn patterns and printed labels can enter production with fewer disconnected steps. A physical outline still requires calibrated dimensions and placement. Test mask save/reopen/export, image rotation, registration, offset direction and correspondence between visible mask and actual raster output.

### 19. Optional AI artwork and image-to-relief

**Studio evidence.** AI services generate/edit assets, while an AI relief feature produces depth maps. Some image services expose credit costs; availability depends on account/service access. [Studio 1.6.6][X-166], [Bitmap editing][X-bitmap], [Atomm credits][X-credits].

**KerfDesk baseline.** Relief heightfield/CAM and image-editing foundations already exist. A generated depth map could enter those import paths, but it would not prove usable relief geometry. [Heightfield model][K-heightfield], [Relief conversion][K-relief].

**Change: optional extension, P3.** Keep generation outside the deterministic CAM core. Import the result beside its original, disclose cost before requesting it and require the normal design/preview workflow before output.

**Why and fit.** This can help users create artwork but is lower priority than making existing tools reliable and easy to use. A visually plausible depth map can contain false depth and poor machining detail. Qualify scale, masks, gradients and relief toolpaths; avoid equating generated imagery with production-ready geometry.

### 20. A visible material and process chooser

**Studio evidence.** Material selection is integrated with device/process settings and custom schemes can retain material identity, supplier information, result images and defaults. [Material management][X-material-save], [Material parameters][X-material-apply].

**KerfDesk baseline.** Matching already considers machine/profile, laser model/head, optical characteristics, material, thickness and confidence. Automatic recipe seeding, explicit links, revisions and stale-source handling exist. [Recipe matching][K-material-match], [Automatic recipes][K-auto-recipe], [Process recipes][K-process-recipe].

**Change: replace surface, P1.** Keep one recipe system and show a searchable material card, machine/tool compatibility, result thumbnail and source/qualification state together. Reuse the guided preset wizard and ordered process recipes.

**Why and fit.** Users can choose a recipe based on evidence instead of its name alone. Laser recipes need head/process context; router recipes need the cutter, stock and operation. Never silently replace manual edits or stale linked snapshots. Do not add another overlapping “preset”, “scheme” or “recipe” database.

### 21. A photographed material-test notebook

**Studio evidence.** A machined test matrix can be photographed, mapped into clickable cells, analysed and saved with its settings and preview image. Current recognition requires Studio 1.9+, supported devices and internet access. [Test Matrix Smart Analysis][X-matrix].

**KerfDesk baseline.** Our grid varies any two of speed, power, passes and engraving spacing, records effective feed labels, and accounts for acceleration runway. Saving process settings and project notes already works, but the inspected workflow does not provide a registered photo-to-cell experiment record. [Material tests][K-material-test], [Grid generation][K-material-grid].

**Change: add the connection, P1.** Preserve generated cell IDs and exact effective settings in a test manifest. Attach a camera or uploaded result photo, align it to the grid, let the user choose/rate a cell, and save the selected recipe plus evidence in one action. Manual selection should work locally before any AI ranking.

**Why and fit.** This is the highest-value Studio lesson: the experiment becomes reusable knowledge. Router coupons can retain measured depth, edge finish and fit alongside cutter/feed/depth information. Test photo registration, cell/settings identity, changed machine profiles and portable export. A dark-looking cell is not proof that a laser cut went through; a photograph cannot establish every CNC quality measure.

### 22. Photo-assisted material search and honest recommendations

**Studio evidence.** Material recognition supports camera/uploaded images, candidate selection and flat laser settings on eight named machine models. It distinguishes library-backed matches from derived recommendations and may suggest a grid instead. [Recognition guide][X-recognition].

**KerfDesk baseline.** Machine/head compatibility and starter/calibrated/imported/unsupported distinctions already exist. We do not have evidence of a comparable physically tested recognition dataset. [Recipe matching][K-material-match].

**Change: optional search aid, P3.** Use photographs to narrow candidate materials, then show source, confidence and missing information. Keep material identity correction and manual library search available. Do not make a photo directly author a production operation without review.

**Why and fit.** It can shorten searching, but the material dataset and machine calibration determine the usefulness. xTool attributes its solution to more than 1,700 materials and tens of thousands of physical matrices/photos; those are vendor claims, not an independently audited comparison. [Parameter-system explanation][X-parameter-system]. For CNC, tool geometry, depth, workholding and machine capability are indispensable additional inputs. Build reliable saved evidence before investing in recognition.

### 23. Recipe codes, portability and calibrated transfer

**Studio evidence.** Auto Mode can recognise official material QR codes; custom parameters can be imported/exported, including newer bundles with result images. Automatic focus/background refresh in Auto Mode is device-dependent. [Auto Mode][X-auto-mode], [Material management][X-material-save], [Studio 1.8][X-18].

**KerfDesk baseline.** Library import/export, recipe revisions and machine/head matching exist. Matching a head class is not proof that physically correct settings transfer between machines. [Recipe matching][K-material-match], [Process recipes][K-process-recipe].

**Change: extend, P2.** Add a versioned recipe/evidence bundle and optional stock/fixture code lookup. Resolve a code into visible proposed settings. Keep the existing saved snapshot when its source is unavailable or stale.

**Why and fit.** A code on a stock bin or fixture can reopen a known setup. Router recipes need cutter identity and operation semantics; laser recipes need the actual head and process. Preserve explicit units and qualification. Do not infer transferable power/speed from watts alone. A recipe lookup is preparation and must not silently start or move the machine.

### 24. Nesting by manufacturing goal

**Studio evidence.** Three layout goals and continuing optimisation are documented. The guide adds free rotation, grouping/containment and device-specific camera stock contours. [Studio 1.9][X-19], [Nesting guide][X-nest].

**KerfDesk baseline.** Quick Nest already chooses fast bounds or outline-aware packing, preserves groups and considers locked-object obstacles. The outline path is bounded to 32 units; larger/unsupported work falls back to bounds. Rotation is currently 90-degree. [Nesting action][K-nest-action], [Outline solver][K-nest-solver], [Nesting dialog][K-nest-ui].

**Change: extend, P2.** Keep Fast as a predictable baseline. Add explicit tidy/grid/material-saving goals, permitted angle sets, grain direction, remnant contours and clamp/defect exclusion. Run improvements in a cancellable worker that exposes the best valid layout found.

**Why and fit.** The operator can choose between neat presentation and material economy. CNC clearance must include the cutter and workholding, rather than copying laser spacing. Preserve engravings/holes with their parent part. Report rectangular fallbacks. Benchmark identical part sets, rotation rules, stock, clearance and time budgets; Studio's optimisation feature does not prove better packing on those tests.

### 25. Laser processing strategies and stamp ramp

**Studio evidence.** Bitmap modes cover common dithering/grayscale strategies. P/S/M devices gain stamp ramp. [Bitmap processing][X-dither], [Studio 1.9][X-19].

**KerfDesk baseline.** Follow Shape already performs successive offset contours, alongside scanline and island fill. Vector/image scan angle, cross-hatch, per-pass angle, overscan, pixel pass-through and eleven raster algorithms exist. Laser stamp ramp was not found in the inspected operation/output model. [Fill controls][K-fill-ui], [Contour fill][K-offset-fill], [Image controls][K-raster-ui], [Raster algorithms][K-dither].

**Change: keep ordinary processing; targeted addition, P3.** Improve strategy explanations and small comparison previews. Explore stamp edge taper as a separately qualified laser feature if stamp users justify it.

**Why and fit.** Much of Studio's ordinary process breadth is already covered. Removing our image/grayscale controls would sacrifice useful capabilities. CNC ramp entry is unrelated to a laser stamp taper. New modulation requires emitter tests and physical stamp results; do not infer quality from the screen preview or expose pulse controls to a controller that cannot implement them.

### 26. Copying, defaults and visible setting differences

**Studio evidence.** Processing settings can be copied/pasted; cross-project copies can retain them, and defaults are scoped to material/process mode. [Studio 1.6.6][X-166], [Material management][X-material-save].

**KerfDesk baseline.** Layer setting clipboard controls and ordered process recipes already exist. Automatic material seeding respects manual edits and uses provenance. [Setting clipboard][K-setting-clipboard], [Automatic recipes][K-auto-recipe], [Process recipe panel][K-recipe-panel].

**Change: refine, P1.** Make “copy these settings”, “apply this process” and “link to this material revision” distinguishable. Show a concise settings difference before bulk replacement where it is useful; keep the action undoable.

**Why and fit.** Reuse is faster when users understand what will change. Geometry, stock, origin, clearance and machine limits should not travel implicitly with an ordinary process copy. Test multiple operations, mixed selections, referenced CNC tools and old/stale presets. Avoid replacing explicit provenance with Studio's colour-selection behaviour.

### 27. Device-first setup without forced connection

**Studio evidence.** New projects expose remembered/additional device selection and USB connection; supported Wi-Fi setup is a separate device workflow. [USB setup][X-usb], [Wi-Fi setup][X-wifi].

**KerfDesk baseline.** Identify/Confirm/Review, Find my machine, alternate port/baud discovery, controller mismatch handling and offline setup exist. Controller reads do not move the machine. [Setup connection][K-setup-connect], [Read-only autofill][K-auto-fill].

**Change: keep and expose, P1.** Give the chosen controller, machine/head and transport a stable visible identity. Use capabilities to reveal relevant options. Continue allowing design and setup without a connected device.

**Why and fit.** Studio's closed device family makes model recognition easier; our hardware breadth needs an equally clear review step. A USB adapter identifier is not a unique physical-machine identity. Network discovery/provisioning is a later controller-specific addition, not something standard GRBL serial already provides.

### 28. Diagnostics, support evidence and firmware inventory

**Studio evidence.** Connection diagnosis distinguishes driver, cable/network and computer issues; feedback can attach logs. Device settings show identity/firmware/plugin information and vendor-specific update paths. [USB diagnostics][X-usb-diagnostics], [Device settings][X-device-settings], [Firmware update][X-firmware].

**KerfDesk baseline.** Connection feedback, silent-controller/baud diagnostics, status, timestamped console transcripts, labelled snapshots and comparisons exist. Firmware-family/build information is available; the setup's Firmware section configures controller settings, not firmware-image flashing. [Connection bar][K-connection], [Super Console][K-console], [Build identity][K-build-info].

**Change: refine, P1.** Assemble an operator-readable diagnostic report: app/build, controller reports, transport, profile/head, recent failure and redacted log. Offer local export before any optional support upload.

**Why and fit.** Support can diagnose a failure with fewer repeated requests. Keep sensitive file paths, project artwork and credentials out of default bundles. Firmware flashing is P3 and requires authorised packages, device protocols and recovery procedures. Do not rename settings writes as a firmware update or reproduce generic instructions to disable computer protections.

### 29. Preview that explains the job and its estimate

**Studio evidence.** Animated path preview includes estimated time, visibility, playback and scrubbing. A newer flat preview documents layer/exploded views and material thickness. [Preview overview][X-overview], [Studio 1.8][X-18].

**KerfDesk baseline.** Route playback/scrubbing, travel visibility, time/distance breakdown, asynchronous preparation and CNC removal preview exist. Source-level estimates and rendered previews are not measured machine results. [Preview controls][K-preview], [CNC simulation][K-cnc-preview].

**Change: extend explanation, P1/P2.** Show selected operation/stage, removed versus retained material, passes and setup dependencies. Distinguish geometric simulation, assumed engraving appearance and calibrated time prediction. Retain advanced G-code inspection.

**Why and fit.** A user can recognise a wrong order, missing inner cut or unsuitable stock setup before output. Laser cut-through cannot be guaranteed solely by a path simulation. CNC cutter/removal accuracy and laser appearance require different models. Validate estimates against recorded real jobs, disclosing controller and material conditions.

### 30. Placement, Frame and machine-local handoff

**Studio evidence.** F1 Ultra offers rectangular/outline framing and a Ready state followed by a physical device start button. That is a supported-device sequence, not a universal Frame policy. [Framing and handoff][X-flat].

**KerfDesk baseline.** Frame and Start remain accessible in the workspace. ADR-565 preserves completed Frame evidence for unchanged footprint/placement while Start reviews and claims the current executable program. [Workspace actions][K-job-actions], [Frame policy][K-frame-policy].

**Change: retain contract, refine explanation, P1.** Display which placement was framed and why spatial changes need another Frame. Keep warnings in Job Review. Implement physical handoff acknowledgement only where the controller actually supports it.

**Why and fit.** The workflow stays understandable across serial lasers, file-based devices and routers. Do not import a camera guide's claim that framing is unnecessary, add cloud/account checks to Start, or invalidate good spatial evidence merely for a non-spatial parameter edit. Speed-dependent runway/offset geometry can still change the footprint and must be handled correctly.

### 31. Qualified camera placement and close-up capture

**Studio evidence.** Background capture, focus and placement are joined on supported devices. M2 support gives device-specific positioning ranges; close-up stitching depends on flatness, height and calibration. Those ranges are vendor support statements, not universal measured precision. [Flat capture][X-flat], [Positioning ranges][X-camera-ranges], [Stitching][X-stitch].

**KerfDesk baseline.** Bed/head calibration, lens/plane models, height areas, capture binding, head stitching and calibration accuracy models already exist. Camera alignment is a Pro feature. [Camera accuracy][K-camera-accuracy], [Head camera][K-head-camera], [Pro features][K-pro].

**Change: extend qualification, P1/P2.** Show calibration scope, material plane/height, residuals, coverage and capture freshness together. Offer a simple positioning check coupon. Build a measured qualification record across the bed and at different heights.

**Why and fit.** Confidence comes from the actual setup, not a polished background image. CNC use also requires a known stock/work coordinate relationship; the camera cannot establish Z zero or clearance by itself. Recalibration and head/module changes need explicit scope. Factory autofocus requires real sensors, Z control and a supporting protocol.

### 32. Camera batches and reusable fixture placement

**Studio evidence.** Batch Fill recognises similar physical blanks and replicates a sample design, subject to machine/material/environment constraints. Reflective, hollow, low-contrast and complex materials can defeat recognition. [Batch Fill][X-camera-batch], [Recognition limitations][X-camera-limits].

**KerfDesk baseline.** Find pieces shows numbered detections, size/angle and inclusion choices, then places the selected design relative to a sample or centred on each piece. Calibration and a live image are required for the workflow. [Pieces control][K-pieces], [Piece placement][K-piece-placement].

**Change: extend, P2.** Save sample-relative placement, fixture/piece geometry, included instances and an orientation rule as reusable intent. Connect row-specific designs from the batch manifest. Require the operator to review proposed detections.

**Why and fit.** Repeated coaster/tag runs can reuse the same setup instead of reconstructing placement. Router fixtures need clamp/stock-height and tool-clearance metadata. Highlight uncertain/out-of-view pieces and avoid treating recognition as physical qualification. Keep batch placement distinct from a running job queue and preserve exact-job Frame ownership.

### 33. Rotary geometry and wrap preview

**Studio evidence.** Rotary setup joins roller/chuck mode, diameter/perimeter, focus and a visible start reference; newer supported models add a surface placement mini-preview. [Rotary workflow][X-rotary], [Studio 1.8][X-18].

**KerfDesk baseline.** Rotary setup and output exist as a laser-only scale-Y path; they are not generic CNC fourth-axis machining. [Rotary output][K-rotary].

**Change: extend presentation, P2.** Add a useful wrap-placement/seam preview and clearly show diameter, circumference, effective scale and start reference. Retain test rotation and known controller constraints.

**Why and fit.** Users can see the intended placement on a tumbler rather than only a stretched flat view. Tapered shapes and independent rotary axes need a separately specified model. Do not infer xTool RA2/RA3 protocol support or advertise router rotary CAM from a laser wrap preview.

### 34. Measured curved-surface work

**Studio evidence.** Supported machines measure a bounded surface with a selected sampling density, show progress and construct an editable surface model. F1 Ultra guidance limits suitable surfaces and measurements. [Curved workflow][X-curved], [M2 measurements][X-curved-m2].

**KerfDesk baseline.** Relief heightfields and machining are implemented, but that does not recreate sensor-driven dynamic laser focus. [Heightfield model][K-heightfield], [Relief conversion][K-relief].

**Change: defer general automation, P3.** Introduce a capability-specific surface-measurement interface only when a real device/protocol can supply calibrated measurements. Keep imported surface data distinct from measured data.

**Why and fit.** It could benefit curved engraving and router surface references, but the manufacturing models differ. Laser compensation needs focus/output support; routers additionally need cutter envelopes, stock, clearance and collision reasoning. Measure spatial errors and failed samples before enabling compensated output. A rendered 3D model alone is not qualification.

### 35. Conveyor and continuous personalised production

**Studio evidence.** Supported conveyor workflows distinguish repeated and different designs, recognise workpieces and coordinate feeding with processing. One documented UV conveyor workflow forbids cutting and stops after repeated no-material detections. [Repeated designs][X-conveyor-same], [Different designs][X-conveyor-variable].

**KerfDesk baseline.** Arrays, variables and piece placement provide preparation foundations, but they do not establish closed-loop conveyor synchronisation.

**Change: retain software preparation; hardware extension P3.** First finish the batch manifest, reviewed instances and deterministic sequence allocation. Add conveyor/slide adapters only after defining device events, feed acknowledgement, workpiece identity and interruption behaviour.

**Why and fit.** Personalisation is useful without a conveyor, so most customers should not wait for one. Automatic feeding is a system feature involving cameras, fixtures, motion and firmware. CNC transfer needs an even stronger workholding/tool-state model. Do not advertise unsupervised continuous production from a software batch list.

### 36. Host-independent repeat jobs

**Studio evidence.** F1 Ultra can export vendor job files to USB or back up a completed job to the device for touchscreen execution; offline focus is manual in that guide. [Offline processing][X-offline].

**KerfDesk baseline.** Save G-code and controller/file-specific output already exist; on-machine storage and local execution depend on the target controller. [Controller capabilities][K-capabilities].

**Change: capability-based extension, P3.** Where supported, offer reviewed file handoff and verify the uploaded artifact identity. Retain ordinary G-code export and make device instructions accessible.

**Why and fit.** Repeat work can continue without a live host connection on capable controllers. A proprietary `.xf` exporter cannot be assumed from public user instructions. GRBL serial, Ruida files and CNC controllers have different execution paths; host-independent operation is not generic stream recovery.

### 37. Live status, sensors and interruptions

**Studio evidence.** Device settings can react to flame, tilt/movement and enclosure sensors. Continue after certain pauses is documented; broad post-crash laser resume is not established. [Device alerts][X-device-settings], [Pause/Continue example][X-continue].

**KerfDesk baseline.** Controller status, output state, console evidence and existing lifecycle/recovery logic are implemented. Reported feed/S values are controller reports, not measured beam output. [Status display][K-status], [Super Console][K-console].

**Change: extend capable-device events, P3.** Make reported events understandable and link each to supported operator actions. Preserve the provenance of controller state and actual run ownership.

**Why and fit.** The app can explain why a device paused, but the app cannot manufacture a missing sensor. Do not present camera monitoring as a certified emergency interlock. Never infer the executed line or physical position from a reconnect alone; resume must follow the controller's verified recovery semantics.

### 38. Phone access, cloud boundaries and privacy choices

**Studio evidence.** Mobile support is device-specific; cloud projects/AI need sign-in. Settings describe an optional data-use agreement for algorithm training, but the inspected guide does not establish its default. [Software/platform availability][X-download], [Data settings][X-data].

**KerfDesk baseline.** Phone/MCP pairing and separately approved view/edit/control permissions already exist. A phone can also supply an overhead camera. [Remote controls][K-remote], [Phone camera workflow][K-phone-camera].

**Change: keep and clarify, P1/P2.** Improve phone status/previews and visible permission scope. Retain local operation, revoke pairing easily and keep optional sync/AI services separate from machine control.

**Why and fit.** A phone can help inspect a bed or monitor a job without rebuilding an entire mobile CAM application. Do not replace our permissioned local connection with a mandatory cloud account. Explicitly state which assets leave the device for an optional service; service failure must not block local editing, Save G-code, Frame, Start or a running job.

### 39. Import/export as a reviewed manufacturing boundary

**Studio evidence.** Imports expose DXF units and SVG sizing. `.ai` supports flattened or editable layered import. Export covers SVG/PNG/JPG, while editor DXF export is absent. [Vector import][X-vector-import], [Studio 1.9][X-19], [Export][X-export].

**KerfDesk baseline.** SVG/DXF, paged PDF/PDF-compatible AI, HPGL, raster and STL import paths exist, along with SVG/DXF and other artwork exports. Some unsupported PDF content is rendered rather than editable. [Import routing][K-import], [PDF artwork][K-pdf], [Artwork export][K-export].

**Change: keep interchange breadth; extend review, P1/P2.** Show interpreted dimensions, units, editable/rasterised content, omitted features and operation mapping before acceptance. Retain original-source reimport.

**Why and fit.** Import errors often become wrong physical size or missed cuts. Full native AI/PSD parsing is a separate dependency/format project and lower priority than a clear current scope. Do not downgrade DXF export to imitate Studio. There is no verified separate “SVG Mapping” module beyond sizing/colour behaviour.

### 40. Large-file responsiveness and honest performance work

**Studio evidence.** Large-vector improvements include optional same-style merging. Comparative speed remains unmeasured. [Studio 1.9][X-19].

**KerfDesk baseline.** Worker-backed job preparation, packed project transfer and large-file save/recovery paths exist. [Large-job preparation][K-large-job], [Packed transfers][K-packed].

**Change: measure before replacing, P1.** Instrument import, first render, selection, dragging, undo, preparation and save on a fixed corpus. Consider reversible grouping/merging only if it preserves distinct part, operation and variable identities.

**Why and fit.** Responsiveness is a user benefit when measured end-to-end. Merging identical styles can hide separate parts or wrongly combine process intent in our explicit-operation model. Preserve source/object mapping, cancellation and truthful progress. Use the same computer and files for both applications before assigning a speed winner.

## Specialist features and the surrounding ecosystem

These are relevant to the broad audit, but their priority or compatibility differs from the core workflow proposals.

| Studio area | Documented scope | KerfDesk decision and reason |
| --- | --- | --- |
| Fonts and design resources | Bundled/local fonts can work offline; cloud fonts need connectivity. [Font guide][X-fonts] | Retain portable fonts and local artwork. Expand a curated, appropriately licensed catalogue where it helps actual sign/tag work; font count is not a quality metric. |
| Manufacturing generators | Parametric box styles and image-based puzzles are documented. [Studio 1.2][X-12] | Reuse our box, kerf and fit-coupon infrastructure. Save generator parameters and expand frequently requested products before an unbounded novelty gallery. |
| AI support and result advice | Guided troubleshooting and result-analysis suggestions are documented. [Studio 1.6.6][X-166] | First connect existing diagnostic evidence and experiment results. An assistant can explain proposed changes, with their source and uncertainty, without issuing machine commands or rewriting settings silently. |
| Pulsed/dual-source marking | F2 Ultra exposes source selection, pulse width/frequency and related parameters. [F2 Ultra parameters][X-mopa] | This requires a compatible pulsed source/controller. It is not ordinary GRBL PWM; defer hardware support rather than displaying nonfunctional controls. |
| Print-specific appearance | Pattern fill is limited to Apparel Printer/M2 in the cited release; print shadows are also documented. [Studio 1.8][X-18], [Studio 1.7.30][X-17] | Do not treat printer appearance controls as a laser/CNC gap. A future pattern generator must define real vector/raster output separately. |
| Multi-device print/cut | O1/laser combinations use a staged registration workflow. [Studio 1.8][X-18] | Retain our print-and-cut foundation. General multi-device routing needs coordinate transfer, registration and explicit job ownership; it is a separate extension. |
| Capture and presentation | P3 can record and edit/share job video. [Studio 1.8][X-18] | Improve useful local monitoring/result capture before social publishing. KerfDesk already has camera job-watch/timelapse foundations; a video does not prove job success or camera accuracy. [Job-watch frames][K-timelapse] |
| Training and examples | Studio offers template/resource discovery; its release history documents integrated learning. [Navigation][X-home], [Learning notes][X-learning] | Improve task-linked examples and explanations in our existing help/tutorial system. Teach the material-test and repeat-job workflow, with no extra Start gate. |

## What to change or remove

These are the concrete replacement decisions supported by the audit. They target workflow behaviour, not wholesale engine replacement.

| Existing behaviour/surface | Proposed replacement | What stays | Expected improvement and verification |
| --- | --- | --- | --- |
| A test ends with separate notes and copied settings | One experiment record with result photo, cell selection and recipe save | Grid generator, effective settings, recipe provenance | Reopen a physical experiment and recover the chosen settings without manual transcription |
| An applied array loses its layout intent | Editable array definition with explicit Expand action | Existing layouts, variables and deterministic compiled snapshot | Reopen and change quantity/spacing without rebuilding artwork |
| Names derive mainly from source/type and groups are flat | User artwork names, nested groups and design tree | Operation identity and separate run order | Locate/edit nested parts while retaining manufacturing bindings |
| General Boolean result replaces its operands | Preview plus optional retained compound/source | Current geometry routines and undo | Revise a subtraction later without reconstructing operands |
| Text has no persistent box-fit policy | Editable text box with wrapping/fit/overflow rules | Current fonts, shaping, path/bend text and variable evaluation | Preview long/short batch values and keep them within a label boundary |
| Material/test/recipe entry points feel separate | One material journey using the existing model | Preset wizard, revision links, process recipes and manual settings | Find a recipe, test it and save evidence in one recognisable path |
| Thickness changes require manual edits in imported assemblies | Proposed joint changes with a reviewed diff | Semantic generator joints, kerf, dogbones and fit coupons | Change known joints only; prove intended fit with coupons |
| Nesting offers one bounded outline choice and fast fallback | Goal-based layout with explicit fallback and optimisation controls | Fast baseline, part bindings and undo | Compare valid layouts under equal time/clearance rules |
| One scene carries unrelated design alternatives | Named sheets with explicit job selection | Versioned project, local recovery and exact artifact ownership | Save/reopen alternatives and never output an unintended sheet |

Remove repeated manual transcription and lost parametric intent as these replacements become reliable. Remove duplicate controls only when an equivalent route exists, saved data still loads and real task tests show the replacement is easier. Do not hide expert settings merely to reduce the visible button count.

There is no evidence-based reason here to remove hybrid tracing, contour fill, raster controls, CNC CAM, tool libraries, G-code inspection, interoperable exports, offline workflows or the permissioned phone/MCP connection. Those are useful foundations. Proposed Free/Pro assignments for new capabilities need a separate product decision; this audit does not change existing editions.

## The target KerfDesk workflow

Use a connected journey while preserving direct access to every existing task:

1. **Design:** open/create a project, select a sheet and edit named artwork. Keep source assets and editable intent.
2. **Prepare:** select the machine/head or router tool/stock, choose a material/recipe and show its source, revision and qualification.
3. **Learn:** generate a test when useful, associate the exact settings with the actual result, and save the chosen recipe revision.
4. **Place:** use stock, fixture or calibrated camera placement; review batch instances and variables.
5. **Review/run:** preview the exact program, retain the existing spatial Frame contract and Start-time review, and execute through supported controller capabilities.
6. **Record/repeat:** retain completion state, empirical results and revisions so a later run can recover the intended setup.

These should be helpful destinations, not a mandatory wizard that makes an experienced operator click through six screens for every job. Changes to warnings or machine admission must follow existing policy. The current Frame contract remains authoritative, and licence/cloud checks must not gate output.

## Implementation order and acceptance criteria

### First programme: connect the existing foundations

1. **Material experiment notebook.** Add test manifest/cell identity, photo attachment/registration, manual selection, result notes and one-action recipe capture. Acceptance: a saved/exported/imported record reproduces the exact effective settings for the selected cell; photos remain associated with the correct run and machine/head/tool. Complete this without an AI service.
2. **Object and recipe clarity.** Add artwork names/design hierarchy, consolidate the material view and surface existing project notes. Acceptance: users locate hidden/nested parts, distinguish artwork from operations, and understand current/stale/manual settings without accidental reassignment.
3. **Batch previews and text fitting.** Show variable-column mapping, row validation and every rendered instance; preserve deterministic sequence allocation. Acceptance: long names, blank fields, missing assets and cancelled runs produce explicit results without duplicate or skipped serials.
4. **Targeted editing improvements.** Reuse numeric expression entry, add missing node coordinates/alignment, preview Booleans and visually compare simplification. Preserve the graphical offset preview already shipped. Acceptance: repaired fixtures preserve dimensions, holes and output bindings through undo/save/reopen.

### Second programme: retain intent and expand production

5. **Editable arrays.** Define persistence, instance overrides, source edits and expansion. Acceptance: after reopen, count/spacing changes preserve intended variables and manufacturing operations; the current compiler consumes one fixed snapshot.
6. **General joint resizing.** Begin with semantic and unambiguous rectangular joints, then broaden detection. Acceptance: uncertain features remain unchanged, the proposed diff is inspectable, and laser/router fit coupons verify the correction.
7. **Nesting and remnants.** Add angle/grain constraints and a worker with accept-best/cancel. Acceptance: collision and stock containment are independently verified, the best accepted layout never regresses, and fallbacks are disclosed.
8. **Sheets and reusable fixtures.** Extend the schema/recovery model with explicit job ownership. Acceptance: sheet/fixture switches cannot silently reuse another setup's spatial evidence or output scope.

### Third programme: build optional services and device adapters

9. **Photo-assisted search/AI ranking.** Evaluate an independently assembled, consented test dataset; expose provenance, uncertainty and user correction. Acceptance: performance is measured against labelled holdout materials and manual selection remains usable offline.
10. **Camera qualification and capable-device focus/surface work.** Publish measured setup-specific tolerances, not borrowed marketing precision. Acceptance: physical placement/measurement errors are recorded across positions/heights and unsupported device controls remain unavailable.
11. **Network/firmware/offline adapters.** Support specific protocols and authenticated artifact handoff with failure/recovery evidence. Acceptance: transport identity, partial transfer, version verification and device execution state are explicit.
12. **Conveyor/continuous batches and cloud collaboration.** Add only when the batch model and device events are stable. Acceptance: workpiece identity, acknowledged motion, duplicate prevention, interruption semantics, revocation and local fallback are demonstrated on the supported system.

The detailed work ledger is in [CHANGE-LEDGER.md](CHANGE-LEDGER.md). Relative scope and dependencies are given there; delivery dates would require implementation spikes and physical qualification plans.

## Shared benchmarks needed before declaring a winner

| Claim | Fair experiment | Useful measurements |
| --- | --- | --- |
| Easier first successful job | Same artwork and task, matched novice/experienced participants, comparable supported devices | Completion, wrong-setting actions, help requests, time and retained understanding |
| Better tracing | Same lossless image corpus, comparable settings and output purpose | Open/closed topology, lost holes, geometric error, path count and emitted travel |
| Better nesting | Same parts/stock/rotations/spacing and fixed compute budget | Validity, utilisation, retained part identity, time, repeatability and cancel behaviour |
| Faster large-file editing | Same hardware and vector corpus | Import-to-interaction time, drag/selection latency, memory, save and recovery completion |
| More accurate camera placement | Matched fixtures, material heights and bed positions, physical measurement | Maximum/median placement error, outliers, calibration drift and failure detection |
| Better material recommendations | Known material batches, machine/head/tool records and physical tests | Recommendation usefulness, uncertainty, cut-through/finish/fit and repeatability |
| Better time estimate | Recorded emitted programs and actual controller runs | Absolute/relative time error by process, firmware, buffering and pause conditions |
| Better batch production | Same personalised fixture/data and interruption scenarios | Misassigned rows, duplicates, missed items, recovery correctness and total operator effort |

No benchmark result is fabricated in this audit. The passing baseline tests cannot substitute for these comparisons.

## Limits and questions left open

The audit found documentation, not xTool's private implementation, model weights, calibration database or device protocols. “Recreate” here means independently implementing useful observable workflows using KerfDesk's architecture and our own assets/data.

Unverified points include current numeric nesting limits, optimality/performance, cloud conflict resolution, exact AI entitlements/costs for every tool, local availability of all cloud assets, broad post-crash laser recovery, and full native Illustrator/PSD fidelity. Factory camera claims do not establish accuracy on arbitrary cameras or materials. Enterprise jig services, printer-only pattern/ink features, crystal inner engraving and MOPA/galvo controls should not be presented as generic laser/router features.

The best-supported strategic recommendation is to make KerfDesk's existing design, CAM, recipes, cameras and variables work as one recoverable manufacturing system. The highest-value first implementation is the material experiment notebook, followed by object/recipe clarity and validated batch previews. That adds a practical reason for users to return: their previous successful work becomes easier to repeat.

[X-transition]: https://support.xtool.com/article/3414
[X-19]: https://support.xtool.com/article/3808
[X-18]: https://support.xtool.com/article/3630
[X-17]: https://support.xtool.com/article/3486
[X-15]: https://support.xtool.com/article/3427
[X-166]: https://support.xtool.com/article/3426
[X-home]: https://support.xtool.com/article/3443
[X-overview]: https://support.xtool.com/article/2442
[X-canvas]: https://support.xtool.com/article/2549
[X-objects]: https://support.xtool.com/article/2532
[X-groups]: https://support.xtool.com/article/2545
[X-position]: https://support.xtool.com/article/2544
[X-selection]: https://support.xtool.com/article/2548
[X-nodes]: https://support.xtool.com/article/2521
[X-booleans]: https://support.xtool.com/article/2523
[X-compounds]: https://support.xtool.com/article/2522
[X-text]: https://support.xtool.com/article/2529
[X-warp]: https://support.xtool.com/article/3439
[X-weld]: https://support.xtool.com/article/2530
[X-grid-array]: https://support.xtool.com/article/2535
[X-circle-array]: https://support.xtool.com/article/2536
[X-batch-variables]: https://support.xtool.com/article/2911
[X-bitmap]: https://support.xtool.com/article/2533
[X-trace]: https://support.xtool.com/article/2527
[X-mask]: https://support.xtool.com/article/2531
[X-credits]: https://www.xtool.com/products/atomm-credits
[X-material-save]: https://support.xtool.com/article/2401
[X-material-apply]: https://support.xtool.com/article/1306
[X-nest]: https://support.xtool.com/article/3481
[X-legacy-batch]: https://support.xtool.com/article/771
[X-enterprise]: https://support.xtool.com/article/2243
[X-matrix]: https://support.xtool.com/article/3816
[X-recognition]: https://support.xtool.com/article/3835
[X-parameter-system]: https://support.xtool.com/article/3826
[X-auto-mode]: https://support.xtool.com/article/3290
[X-dither]: https://support.xtool.com/article/2432
[X-usb]: https://support.xtool.com/article/2433
[X-wifi]: https://support.xtool.com/article/2434
[X-usb-diagnostics]: https://support.xtool.com/article/3618
[X-device-settings]: https://support.xtool.com/article/3011
[X-firmware]: https://support.xtool.com/article/2998
[X-flat]: https://support.xtool.com/article/3018
[X-camera-ranges]: https://support.xtool.com/article/3432
[X-stitch]: https://support.xtool.com/article/3475
[X-camera-batch]: https://support.xtool.com/article/2542
[X-camera-limits]: https://support.xtool.com/article/1365
[X-rotary]: https://support.xtool.com/article/3028
[X-curved]: https://support.xtool.com/article/3044
[X-curved-m2]: https://support.xtool.com/article/3350
[X-conveyor-same]: https://support.xtool.com/article/2704
[X-conveyor-variable]: https://support.xtool.com/article/2897
[X-offline]: https://support.xtool.com/article/3054
[X-continue]: https://support.xtool.com/article/1367
[X-download]: https://www.xtool.com/pages/xtolol-studio-software-download
[X-data]: https://support.xtool.com/article/3407
[X-vector-import]: https://support.xtool.com/article/2520
[X-export]: https://support.xtool.com/article/2546
[X-fonts]: https://support.xtool.com/article/3398
[X-12]: https://support.xtool.com/article/3411
[X-learning]: https://support.xtool.com/article/1773
[X-mopa]: https://support.xtool.com/article/2197

[K-import]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/app/import-dispatch.ts
[K-pdf]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/import/pdf-artwork-source.ts
[K-recent]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/recent-projects/RecentProjectsDialog.tsx
[K-artwork]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/library/personal-artwork-model.ts
[K-templates]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/app/project-template-actions.ts
[K-project]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/scene/project.ts
[K-notes]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/commands/ProjectNotesDialog.tsx
[K-autosave]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/state/autosave-durable.ts
[K-run-order]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/layers/ArtworkRunOrderPanel.tsx
[K-operations]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/scene/artwork-operation.ts
[K-inspector]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/layers/SelectedObjectProperties.tsx
[K-panel-tabs]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/layers/ArtworkPanelTabs.tsx
[K-basic-laser]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/layers/SelectedLaserOperationFields.tsx
[K-booleans]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/geometry/vector-path-booleans.ts
[K-corners]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/design/ops/fillet-corner.ts
[K-box]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/box/generate-box.ts
[K-dogbone]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/geometry/corner-dogbone.ts
[K-text]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/text/text-object.ts
[K-variables]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/text/VariableTextControls.tsx
[K-path-text]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/text/text-on-path.ts
[K-array-layout]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/scene/array-layout.ts
[K-array-host]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/commands/ArrayDialogHost.tsx
[K-batch-sequence]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/variables/batch-sequence.ts
[K-image-studio]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/image-editor/ImageEditorOverlay.tsx
[K-image-adjustments]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/image-editor/editor-adjustments.ts
[K-image-processing]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/raster/image-processing.ts
[K-trace-presets]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/trace/trace-presets.ts
[K-hybrid]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/trace/hybrid/trace-hybrid.ts
[K-pro]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/licensing/pro-features.ts
[K-camera-trace]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/WORKFLOW.md#f-cam5-trace-from-camera-adr-110-adr-440-adr-441-amendment-2
[K-mask]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/library/personal-artwork-owned-clip.test.ts
[K-heightfield]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/scene/relief/relief-heightfield.ts
[K-relief]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/relief/mesh-to-heightmap.ts
[K-material-match]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/material-library/material-matching.ts
[K-auto-recipe]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/material-library/auto-recipe.ts
[K-process-recipe]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/material-library/process-recipe.ts
[K-material-test]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/calibration/MaterialTestDialog.tsx
[K-material-grid]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/job/material-test-grid.ts
[K-nest-action]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/state/nest-actions.ts
[K-nest-solver]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/nesting/outline-compact-nest.ts
[K-nest-ui]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/commands/QuickNestDialog.tsx
[K-fill-ui]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/layers/CutSettingsFillFields.tsx
[K-offset-fill]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/job/offset-fill.ts
[K-raster-ui]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/layers/CutSettingsImageFields.tsx
[K-dither]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/raster/dither.ts
[K-setting-clipboard]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/layers/LayerSettingsClipboardButtons.tsx
[K-recipe-panel]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/material-library/ProcessRecipePanel.tsx
[K-setup-connect]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/laser/device-setup/DeviceSetupConnectStep.tsx
[K-auto-fill]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/laser/device-setup/use-controller-auto-fill.ts
[K-connection]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/laser/ConnectionBar.tsx
[K-console]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/laser/super-console/SuperConsoleDialog.tsx
[K-build-info]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/controllers/grbl/build-info.ts
[K-preview]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/workspace/preview-overlays.tsx
[K-cnc-preview]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/sim/removal-grid.ts
[K-job-actions]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/laser/WorkspaceJobActions.tsx
[K-frame-policy]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/docs/decisions/ADR-565-frame-remains-valid-for-unchanged-placement.md
[K-camera-accuracy]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/camera/model/camera-model-accuracy.ts
[K-head-camera]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/camera/model/head-camera.ts
[K-pieces]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/camera/pieces/PiecesControl.tsx
[K-piece-placement]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/camera/pieces/piece-placements.ts
[K-rotary]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/job/rotary-job.ts
[K-capabilities]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/controllers/controller-capabilities.ts
[K-status]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/laser/StatusDisplay.tsx
[K-remote]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/WORKFLOW.md#f-remote1-phone-and-mcp-workspace-controls-adr-564568569
[K-phone-camera]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/WORKFLOW.md#f-cam11-a-phone-as-the-overhead-camera-adr-448
[K-export]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/app/export-artwork-format.ts
[K-large-job]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/workspace/large-job-preparation.ts
[K-packed]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/packed-project-transfer.ts
[K-groups]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/state/scene-group-actions.ts
[K-numeric]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/numeric-expression.ts
[K-numeric-ui]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/commands/NumericEditsBar.tsx
[K-snap]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/workspace/snap-settings.ts
[K-pointer-snap]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/workspace/workspace-pointer-snap.ts
[K-toolstrip]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/workspace/ToolStrip.tsx
[K-optimise]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/commands/OptimizeShapesDialog.tsx
[K-boolean-action]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/state/vector-path-actions.ts
[K-offset-preview]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/commands/OffsetShapesPreview.tsx
[K-corner-apply]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/design-studio/design-corner-apply.ts
[K-warp]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/ui/state/warp-deform-plan.ts
[K-free-build]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/scripts/browser-free-build.ts
[K-timelapse]: https://github.com/cisgz3a-hub/KerfDesk/blob/76b5ff53e3be7df6c160a8b26820e61188595f08/src/core/camera/job-watch/timelapse-frames.ts
