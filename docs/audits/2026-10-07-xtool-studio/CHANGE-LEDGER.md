# KerfDesk work ledger following the xTool Studio audit

Date: 7 October 2026. Baseline: `76b5ff53e3be7df6c160a8b26820e61188595f08`.

All entries are proposals. No application implementation, licence change, provider change, deployment or machine qualification is claimed. The [audit](REPORT.md) contains the competitor evidence, current-source comparison and reasons for each decision.

Relative scope: **small** is primarily a bounded UI/data integration; **medium** crosses several existing surfaces; **large** needs a persistence/core model change; **device/service** needs external infrastructure or hardware qualification. These are not delivery-time estimates.

| ID | Proposed work | Audit records | Priority / relative scope | Dependency | Acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| KXS-01 | Material experiment notebook: test manifest, result photo registration, cell selection, observations and recipe capture | 20–23 | First / medium | Existing material grid and recipe model | Save/reopen/export/import retains exact cell settings, effective feed, machine/head/tool, photo association and chosen recipe revision |
| KXS-02 | Material chooser and setting provenance: searchable cards, result preview, current/stale/manual states and bulk difference view | 20, 23, 26 | First / medium | Existing matching, links and process recipes | Apply changes only intended operations; manual edits and unavailable/stale snapshots survive; undo restores bindings |
| KXS-03 | Artwork names and nested design hierarchy, distinct from manufacturing run order | 04–05 | First / large | Scene/schema migration and selection ownership | Nested groups, masks, text guides, locks and custom names round-trip; design stacking does not rewrite CNC stages/tools |
| KXS-04 | Reuse expression parsing, expose node coordinates/alignment and add graphical simplification comparison | 06–08 | First / small to medium | Existing numeric parser and node/repair engines | Inputs preserve units/physical dimensions; dense repair fixtures keep topology and bindings; no second expression engine |
| KXS-05 | Boolean result preview with optional retained operands/compound intent | 09 | First preview / medium; retained compounds / large | Existing Boolean engine; model/persistence for compounds | Inspect result before commit; operand edits recompute predictably; undo and save/reopen retain editability |
| KXS-06 | Text boxes with wrapping/fitting/overflow plus variable preview and column mapping | 12–15 | First / medium to large | Text model/layout and existing variables | Long names, Unicode, fonts, blank values and minimum text sizes produce visible results; deterministic preview matches emitted paths |
| KXS-07 | Saved production manifest with row IDs, placements, reviewed variants and completed/skipped/failed state | 15, 32, 35 | First/second / large | KXS-06; existing variable advancement and job ownership | No serial advancement on cancelled/ambiguous outcomes; row-to-design assignment remains stable; uncertain physical runs are not replayed automatically |
| KXS-08 | Persistent editable arrays and explicit expansion to independent instances | 14 | Second / large | Array model/schema; compiler materialisation boundary | Count/spacing/source edits after reopen retain overrides, variables, groups/masks and operations; object budgets enforced before expansion |
| KXS-09 | Reviewable assembly-joint resizing with semantic joints first, then bounded detection | 10–11 | Second / large | Existing box geometry, kerf/fit inputs and dogbones | Uncertain features remain unchanged; thickness and allowance stay separate; inspected geometry and physical coupons verify fit |
| KXS-10 | Goal-based nesting, permitted rotations/grain, remnant stock and cancellable best-result optimisation | 24 | Second / large | Existing fast/outline solver, worker and stock geometry | Independent containment/collision checks; parts keep attached engravings; best accepted valid result never regresses; fallback/time budget visible |
| KXS-11 | Named project sheets with per-sheet scene/setup/output scope and explicit active job | 02–03 | Second / large | Schema migration, durable recovery, Frame/job identity | Open/save/recover old/new projects; switching sheets never outputs another sheet or silently reuses unrelated spatial evidence |
| KXS-12 | Reusable fixture/batch placement and camera qualification record | 18, 31–32 | Second / large plus physical work | Existing camera and piece placement; KXS-07 | Store coordinate basis/height/calibration; expose uncertain detections; measure positioning error across bed locations/heights |
| KXS-13 | Local start/resume view, asset metadata, visible project notes and named snapshots | 01, 03 | First/second / medium | Existing recent projects, personal artwork, templates and recovery | No relocation of originals; missing files recover clearly; snapshot comparison does not overwrite current work |
| KXS-14 | Image/trace workflow clarity: source comparison, output purpose, topology indicators and consistent masked preview | 16–18 | First / medium | Existing Image Studio and trace engines | Prepared pixels and compiled raster agree; path topology/dimensions measured on shared fixtures; advanced algorithms preserved |
| KXS-15 | Diagnostic bundle and clearly visible device/transport/build identity | 27–28, 37–38 | First / medium | Existing serial diagnosis, build info and Super Console | Locally inspect/export redacted evidence; no default artwork/credential upload; settings configuration distinct from firmware flashing |
| KXS-16 | Preview explanation, import dimension/content review and fixed large-file benchmarks | 29, 39–40 | First / medium | Existing previews/import workers/export paths | Preview/compiled output agree; rasterised/omitted content visible; instrument end-to-end latency and preserve object/operation identity |
| KXS-17 | Rotary placement/seam visualisation and targeted laser stamp taper | 25, 33 | Later / medium plus material qualification | Supported rotary/PWM contracts | Wrap geometry independently checked; taper output and physical stamps qualified; router rotary CAM not implied |
| KXS-18 | Optional photo-assisted material search, ranking and artwork/relief generation | 19, 22 | Later / service | KXS-01, labelled dataset, explicit cost/privacy choices | Holdout evaluation with uncertainty; local/manual path survives service failure; generated imagery does not bypass design/CAM review |
| KXS-19 | Controller-specific network, firmware-image and offline file adapters | 27–28, 36 | Later / device/service | Supported protocol/packages and verified recovery model | Device identity, version reread, interrupted transfers and reviewed artifact handoff demonstrated on each supported target |
| KXS-20 | Measured laser surface/focus and conveyor adapters | 31, 34–35, 37 | Later / device/service | KXS-07/12 plus sensors/motion/firmware events | Physical error/collision/workholding qualification; acknowledged workpiece/feed identity; duplicate/interruption handling verified |

## Proposed data extensions

Reuse existing records and version them. Do not create parallel preset or process databases.

- **Experiment record:** test ID and schema version, selected design/program reference, generated cell IDs/effective settings, profile/head or router tool/operation, material/batch/thickness, result photo and registration, observations/measured outcome, chosen cell and resulting recipe revision.
- **Batch manifest:** design revision, input data identity, stable row/instance IDs, rendered variant references, fixture/piece placements, sequence allocation, review state and factual completion/skip/failure evidence. Keep physical-job recovery semantics separate.
- **Editable intent:** array/compound/text-box/warp definitions, source references, instance overrides and explicit expansion/conversion. Output consumes a stable materialised snapshot through the existing compiler.
- **Placement qualification:** calibration/model scope, capture identity/time, material plane/height, coordinate transform, coverage/residuals and physical check results. Do not borrow a vendor's accuracy claim.
- **Project sheets:** stable sheet IDs, scenes/setup/output scope and recovery/migration rules. Define how shared assets and machine contexts work before adding cross-sheet production.

## Existing contracts to preserve

1. The Frame/Start behaviour of ADR-565: completed spatial evidence for unchanged footprint/placement; every Start reviews and claims the current executable program. Speed-dependent geometric changes still matter.
2. The existing account/licence boundary. Pro checks apply to choosing Pro tools, never Frame, Start, output, Save G-code or a running job. New Free/Pro assignments are a separate product decision.
3. Explicit artwork-to-operation bindings, CNC stage/tool ordering, manual recipe edits, saved revision snapshots, units and machine/tool/stock distinctions.
4. Local work, interoperable exports, current recovery, and separate permission scope for phone/MCP access.
5. Source/test, rendered, simulator, controller and material/hardware evidence remain distinguishable. Passing unit/component tests do not qualify hardware.

## Concrete first implementation slice

Start with **KXS-01**, using the existing grid generator and recipe capture. Save exact cell settings, accept an uploaded/captured photo, align it manually, let the user select a cell, and save that cell with its result image. Include save/reopen and portable export/import. This slice delivers a useful complete workflow without requiring AI, a cloud account or a new controller protocol.

Then combine **KXS-02**, the bounded parts of **KXS-04**, and the first batch/text preview work in **KXS-06**. Model changes for nested groups, editable arrays and sheets should be separate, reviewable changes with migration and output-identity checks.
