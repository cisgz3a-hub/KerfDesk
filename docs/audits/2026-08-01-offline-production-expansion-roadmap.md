# CurveDesk offline production expansion roadmap

**Date:** 2026-08-01
**Verified baseline:** `main` at `000db901997d837a8612d5d2fe71af2562a539aa`
**Status:** implementation plan; offline variable-data imposition adopted by ADR-279; the
other three initiatives remain planned until their own governing decisions land
**Product name:** CurveDesk. Existing `laserforge-*` storage markers and `.lf*` compatibility
formats are not renamed by this program.

## Executive decision

CurveDesk is not missing four blank feature areas. It already has most of the hard foundations:
offline variable text, deterministic arrays, versioned machine/material codecs, calibrated camera
warping, board tiling, cutter-shaped stock simulation, a 3D stock view, and STL import. The product
gaps are the workflows that join those foundations into trustworthy production tools.

The recommended order is:

1. build offline variable-data imposition, beginning with a pure batch-sequence planner;
2. build a portable workshop bundle after making the CNC tool library strict and versioned;
3. build camera-assisted manual target placement and a real-frame qualification corpus;
4. build closed commanded-stock STL export in parallel with the camera foundation; and
5. add automatic camera detection only after the corpus establishes measurable limits.

This order delivers production value without inventing schemas, physical-accuracy thresholds, or
new machine guards. Frame remains the only guard. The program adds no block, refusal, gate, cap,
clamp, delay, hide, disable, rewrite, or confirmation beyond existing factual compile-integrity,
transport, and handoff preconditions. Other concerns are editor or Job Review information.

## Evidence language

This plan uses five evidence labels deliberately:

- **SOURCE-CONFIRMED** — current behavior read from the named source on the verified baseline.
- **TEST-CONFIRMED** — an automated test or CI artifact passed for the stated software behavior.
- **OFFICIALLY DOCUMENTED** — a primary vendor or project source describes the comparison feature.
- **UNVERIFIED** — the design is feasible but has not been implemented or measured in CurveDesk.
- **HARDWARE-ONLY** — only a controlled physical fixture can establish the conclusion.

Green tests prove software contracts. They do not prove camera rigidity, physical placement,
controller tracking, cutter geometry, stock flatness, or the shape left by a real machine.

## What CurveDesk is today

| Area | Capability today | Confirmed gap | Evidence |
| --- | --- | --- | --- |
| Variable data | Embedded CSV, serial, date/time and cut-setting fields; bounded ranges; manual and policy-matched ordinary single-file `.gcode` export/stream advancement; tiled G-code and file-only `.rd` do not currently advance | Every object in one prepared output receives one global record/serial context, so ordinary array copies repeat the same record | `src/core/scene/variable-template.ts:18-49`, `src/io/gcode/prepare-output-snapshot.ts:28-38,98-165`, `src/ui/state/variable-data-actions.ts:82-128`, `src/ui/laser/variable-stream-advancement.ts:8-39`, `src/ui/app/file-actions.ts:117-133,153-161,192-202`, `src/ui/app/save-tiled-gcode.ts:72-80,105-138`, `src/ui/app/save-rd-action.ts:38-55` — **SOURCE-CONFIRMED** |
| Layout | Grid and board fill are deterministic row-major layouts; circular arrays use deterministic angular order; existing arrays are bounded to 500 placed units | No imposition pipeline connects array slots to distinct variable contexts or an exact batch manifest | `src/core/scene/array-layout.ts:3-79`, `src/core/scene/tile-into-region.ts:31-72`, `src/ui/state/board-tile-actions.ts:32-72` — **SOURCE-CONFIRMED** |
| Portable data | Machine profiles and material libraries have deterministic, validated document codecs; multiple material libraries persist locally | No selective whole-workshop bundle exists; CNC library persistence has no strict document marker/schema and drops malformed members permissively | `src/io/machine-profile/machine-profile-io.ts:24-109`, `src/io/material-library/material-library-io.ts:19-123`, `src/ui/state/material-library-collection.ts:18-40,162-188`, `src/ui/state/cnc-library-persistence.ts:1-12,65-107` — **SOURCE-CONFIRMED** |
| Camera | USB/machine-JPEG/machine-RTSP sources, lens calibration, source binding, registered top-down warp, height compensation, overlay, trace and snapshots | No sample-blank selection, similar-workpiece detection, arbitrary target proposal editor, or same-design copy workflow | `src/ui/camera/frame-source.ts:18-35,86-119`, `src/core/camera/calibrate.ts:22-68,111-181`, `src/core/camera/camera-capture-binding.ts:39-49`, `src/core/camera/warp-to-bed.ts:24-45`, `src/core/camera/surface-height-compensation.ts:29-60`, `src/ui/camera/WorkspaceCameraOverlay.tsx:31-70`, `src/ui/camera/trace-from-camera.ts:42-95`, `src/ui/camera/snapshot.ts:16-31` — **SOURCE-CONFIRMED** |
| Board placement | Manual head-position board capture supports rectangle/circle; one selected design can fill a regular region | It is not camera segmentation and cannot place rigid copies at irregular physical targets | `src/core/scene/board-capture.ts:1-12,23-30`, `src/ui/state/board-tile-actions.ts:1-84` — **SOURCE-CONFIRMED** |
| CNC stock | Stock footprint/thickness, flat/ball/cone cutter kernels, deterministic removal grids, 2D depth shading and 3D stock preview already exist | Current render mesh is an open surface, not a closed remaining-stock solid | `src/core/scene/machine.ts:15-32`, `src/core/sim/removal-grid.ts:1-36`, `src/core/sim/tool-kernels.ts:1-11,58-74`, `src/core/heightfield/stepped-surface-mesh.ts:62-66,126-205` — **SOURCE-CONFIRMED** |
| STL | Binary and ASCII STL import become a deterministic relief heightmap | No STL emitter or commanded-stock export UI exists; the Inspector renders centerlines without stock setup | `src/io/stl/index.ts:1-4`, `src/ui/gcode-inspector/use-viewer3d-scene.ts:31-45`, `WORKFLOW.md:4901-4964` — **SOURCE-CONFIRMED** |

Targeted stock-simulation/parser coverage passed 31/31 during this audit stream:
`pnpm exec vitest run src/core/sim/stamp-toolpath.test.ts
src/core/sim/stamp-toolpath-per-tool.test.ts src/io/gcode/gcode-reimport-parity.test.ts
src/core/heightfield/stepped-surface-mesh.test.ts
src/core/toolpath3d/toolpath-surface-registration.test.ts src/io/stl/parse-stl.test.ts`. That is
**TEST-CONFIRMED** software evidence only; no CAD interoperability or physical cut was tested.

## Official category reference points

- [LightBurn Variable Text](https://docs.lightburnsoftware.com/latest/Reference/VariableText/)
  documents Current/Start/End/Advance By, per-copy offsets, automatic array offsets and batch-page
  advancement. CurveDesk should match the understandable workflow while retaining its existing
  manual-or-policy-matched-successful-output advancement contract.
- [LightBurn User Bundles](https://docs.lightburnsoftware.com/latest/Reference/UserBundles/)
  documents selective migration of settings, devices, presets and libraries, excludes projects,
  and preserves conflicting destination content.
- [xTool Batch Fill](https://support.xtool.com/article/771) documents sample-based detection of
  similar blanks and its real limitations: separation, contrast, lighting, reflection, bed damage
  and similar size/shape.
- [Autodesk manufacturing simulation](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUID76F8D8EF-2725-4203-944B-B9345936DDDB.htm)
  distinguishes toolpath animation from stock verification, and
  [Autodesk mesh export](https://help.autodesk.com/cloudhelp/ENU/Fusion-Mesh/files/MESH-EXPORT-TOOLS.htm)
  establishes STL as one conventional mesh-interchange output.

These are workflow references, not implementation authority and not proof of CurveDesk behavior.

## Program-wide contracts

### Offline and local

- No accounts, cloud sync, live database or network service is introduced.
- Batch data, bundle contents, camera frames and stock meshes remain local.
- Large materialization, image analysis and mesh export move to bounded workers before production
  UI wiring; the UI thread must not become the hidden size limit.

### Frame and warnings

- Frame remains the only guard.
- This program adds no block, refusal, gate, cap, clamp, delay, hide, disable, rewrite, or
  confirmation to preview, project save, import/export, Apply, output, Frame, or Start beyond the
  existing factual compile-integrity, transport, and handoff preconditions.
- A batch becomes ordinary project/prepared-output geometry before Frame. Frame binds that exact
  output as it does any other job.
- Camera UI state is not added back to `FramedRunExternalEnvironment`.
- Detection limitations, aggregate-rectangle Frame limitations, recipe provenance, resolution and
  simulation approximations are editor/Job Review warnings only.
- A compile/evaluation failure may report that the requested program cannot be produced. It may not
  be relabeled as a material, camera-confidence or policy refusal.

### Determinism and provenance

- Pure core functions receive time, IDs and external data from callers.
- Batch order, bundle bytes and STL bytes are deterministic for identical inputs.
- Every production batch eventually owns a manifest that maps slot → source record/serial →
  materialized object IDs and binds the exact post-success cursor.
- Display provenance never changes motion or authorizes Start.

### Honest limits

- Camera match values are named measured scores, not “confidence.”
- Exported stock is named **Commanded simulated stock**, never “machined stock” or “scan.”
- STL units are disclosed as millimetres because STL has no standard unit field.
- Software cannot certify physical record-to-blank placement or remaining stock.

### Accessibility and runtime parity

- Every new dialog and review surface is fully keyboard reachable, places focus deliberately,
  restores it on close, associates validation with its field, and announces async progress,
  cancellation, completion and errors through the existing accessible status patterns.
- Camera targets have a non-drag alternative: an ordered table exposes include/exclude plus numeric
  X, Y and angle editing. Candidate outlines, measured scores and ambiguous regions remain available
  as text; color is never their only signal.
- Bundle component selection and conflict copies work with keyboard and screen-reader controls.
- Stock export provides a textual dimensions, resolution, triangle-count and approximation summary;
  the 3D surface is not the only way to inspect the result.
- Dialogs, tables and previews retain usable focus, contrast and zoom at narrow widths and 200% zoom.
- Component and real-browser acceptance cover both web and Electron platform adapters. Camera
  source and file-picker differences are tested explicitly rather than inferred from one runtime.

## Ranked opportunity backlog

Rough scope is expressed as coherent PR count rather than calendar estimates.

| Rank | Opportunity | Impact and user value | Evidence | Prerequisite | Rough scope | Principal risk |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Adopt the program and imposition contract | Removes the verified pre-GOV-1 source-of-truth contradiction before code; gives every later PR an executable boundary | Automatic imposition was explicitly deferred at verified baseline `fb759bef` in `PROJECT.md:107,608-609` and ADR-164 | This roadmap, ADR-279, F-D6 | 1 docs PR | Ambiguous advancement semantics if skipped |
| 2 | Pure variable batch-sequence planner | First reusable primitive for correct record/serial assignment and exact post-batch state | Existing `advanceVariableSequence` already owns sequence-setting resolution, stride and wrap | Rank 1 | 1 small core PR | Off-by-one or double consumption |
| 3 | Transient variable materialization + exact preview | Lets operators verify every record before output without committing a project schema | One shared context today; renderer already accepts explicit record/serial overrides | Rank 2 | 2–3 PRs | Long text overlap, large render cost |
| 4 | Artifact-bound batch advancement/recovery | Makes high-volume production trustworthy: failures and mismatched policies consume zero; a matched success consumes exactly the artifact | Current identity-bound, policy-matched success advances once | Rank 3 | 1–2 PRs | Resume/retry advances twice |
| 5 | Strict versioned CNC-library codec | Makes workshop migration safe instead of copying permissive local JSON | Machine/material codecs are strict; CNC library is not | None | 1 tidy-first PR | Breaking existing local restoration |
| 6 | Portable workshop bundle v1 | One selective, non-overwriting migration file for machine-safe profiles, material libraries and CNC tools | Official bundle workflow; current component codecs | Rank 5 | 2–3 PRs | Moving machine-local trust or unsafe recipes |
| 7 | Pure arbitrary-target rigid-copy foundation | Shared editor primitive for camera-assisted irregular batches | Array actions clone groups but only at grid/circle placements | None | 1 core/state PR | Broken IDs, groups or rotation pivots |
| 8 | Manual camera-assisted batch draft | Validates capture-to-project and editable proposal UX before computer vision | Registered bed raster and binding already exist | Rank 7 | 2 PRs | Stale capture or wrong transform basis |
| 9 | Closed commanded-stock mesh + binary STL emitter | Converts existing simulation into an interoperable artifact | Removal grid and cutter kernels exist; emitter does not | None | 1–2 pure core/IO PRs | Non-manifold mesh, mirrored coordinates, huge output |
| 10 | Native-project stock export worker/UI | Practical CNC differentiation without inventing another motion interpreter | Current native prepared job can build the removal grid | Rank 9 | 2 PRs | UI stalls or display-grid export |
| 11 | Camera detector + proposal editor | High production payoff for repeated irregularly placed blanks | xTool documents category value and limitations; CurveDesk has no detector corpus | Rank 8 plus annotated real frames | 3–5 PRs + qualification | False positive placement on physical stock |
| 12 | Inspector stock setup/surface/export | Gives external G-code an honest commanded-stock view | Inspector currently renders centerlines only | Rank 9 | 2–4 PRs | Unknown tool/stock/canned-cycle semantics |

## Initiative 1 — offline variable-data imposition

### User outcome

An operator selects one complete design unit (variable text plus companion artwork), chooses a
row/column sheet and spacing, and sees an exact preview where every slot resolves to its own CSV row
and serial value. Preview, Frame, Job Review, Save G-code and Start consume the same materialized
artifact. Save Project neither consumes records nor persists transient phase-one imposition.
Successful output advances the saved cursor by exactly the slots in that artifact only when the
configured export/stream policy matches; `manual` never auto-advances.

### First contract: batch sequence planning

The first implementation slice is pure and schema-free:

```ts
type VariableBatchSlot = {
  readonly slotIndex: number;
  readonly recordIndex: number;
  readonly serialValue: number;
};

type VariableBatchPlan = {
  readonly slots: ReadonlyArray<VariableBatchSlot>;
  readonly nextVariables: ProjectVariableData;
};
```

Rules:

1. the planner accepts a caller-supplied ordered slot-seed list and emits ordered slot indices, not
   seed values or final bounds-derived translations;
2. it adds no second count normalization, cap, clamp, or rewrite; the retained grid layout request
   and existing array generator remain responsible for producing one through 500 slots;
3. slot zero uses the current project record and serial exactly;
4. every later slot is one application of existing `advanceVariableSequence(..., 'next')`;
5. existing `advanceBy` is therefore the per-slot stride and is never silently rewritten to the
   batch size;
6. existing range wrap and safe-integer behavior remain the authority;
7. `nextVariables` is the state after exactly `slotSeeds.length` advancements; and
8. neither input is mutated.

This slice does not decide whether imposition later persists in `.lf2`. It provides the stable
sequence contract both transient and persisted designs would need.

### Materialization contract

1. Freeze one valid clock value for the whole batch so date/time fields do not change mid-sheet.
2. Materialize the selected design unit once per planned slot with that slot's record/serial
   context.
3. Retain the original grid `ArraySpec`; measure every real rendered unit before placement.
   Cell width/height use the maximum rendered envelope across the requested range, not the current
   row's placeholder or current text bounds.
4. Derive final `ArrayPlacement` values only after measurement, using the retained rows, columns, and
   spacing. Place units in row-major order and center each real unit within the maximum cell envelope.
   Circular imposition remains deferred until its variable-width collision policy is specified.
5. Preserve layers, operations, groups, artwork order and non-variable companion geometry; mint
   all new IDs outside pure core.
6. Build a transient project first. Editable/persisted imposition is a later schema decision after
   the output workflow passes browser acceptance.

### Advancement and recovery contract

- Preview, estimate, Save Project, Frame and Job Review consume zero records. Save Project does not
  persist the transient phase-one imposition.
- Cancel, render failure, compile failure, stale project identity, export write failure, disconnect,
  aborted stream and incomplete recovery consume zero records.
- `manual` advancement changes on neither output trigger.
- `after-successful-export` applies the exact `nextVariables` stored with the prepared artifact once
  only after successful Save G-code export, including tiled G-code and the experimental file-only
  `.rd` path.
- `after-successful-stream` applies that state once only after a fully completed stream.
- A successful trigger that does not match the configured policy consumes zero records.
- A recovered/retried artifact carries a consumption identity so the same completed artifact cannot
  advance twice when its policy matches.
- The batch manifest is diagnostic and consistency evidence; it does not create another guard.

### Error, empty and edge behavior

- Missing CSV column/record, invalid clock, invalid serial or text-render failure is a typed
  compile-integrity failure naming the slot and source record; the scene and cursor remain unchanged.
- Opening the imposition surface with no variable design shows an explanatory empty state; it does
  not alter the project.
- A range that wraps within a sheet shows the repeated mapped indices in preview rather than hiding
  wrap.
- Serial-only projects keep the record index unchanged and advance the serial through existing
  rules.
- Output-selection scope, long strings, multiline text, path text, hidden layers, groups and a
  500-slot stress fixture require explicit tests before live output wiring.

### Definition of software complete

- Pure planner properties and deterministic 500-slot stress pass.
- Exact materialized preview maps every visible slot to its source record/serial.
- All three policies across successful export and completed fake-stream triggers advance zero or
  once exactly as configured.
- Failure and stale/recovery fixtures advance zero or once as appropriate.
- Non-variable output snapshots remain byte-identical.
- Browser acceptance covers preview → Job Review → Frame → Start without any new guard and covers
  the keyboard/nonvisual alternatives in the program-wide accessibility contract.

### Qualification boundary

Rendered sheet inspection can confirm text and record mapping. A de-energized Frame/air movement can
confirm commanded coverage. A supervised scrap sheet can establish the exact tested machine/material
placement. None proves every machine or stock.

## Initiative 2 — portable workshop bundle

### User outcome

An operator exports selected portable setup components to one local file, moves it to another
computer, reviews the components in the import workspace, and applies them without overwriting
existing destination data. Projects and machine-session trust never ride inside the bundle.

### Proposed v1 envelope

The later governing ADR should adopt a deterministic JSON document such as:

```ts
type WorkshopBundleV1 = {
  readonly format: 'curve-desk-workshop-bundle';
  readonly bundleSchemaVersion: 1;
  readonly components: {
    readonly machineProfiles?: readonly PortableMachineProfileDocument[];
    readonly materialLibraries?: readonly MaterialLibraryDocument[];
    readonly cncToolLibrary?: CncToolLibraryDocument;
  };
};
```

- Canonical JSON uses two spaces, LF endings and one trailing newline.
- No runtime ZIP dependency is added for v1; the single JSON document remains inspectable and
  deterministic.
- Each component retains its own schema version and validator.
- Import parses all components, reports invalid members precisely, and permits valid independent
  members to be selected and applied.
- ID/name conflicts create a deterministic destination copy; no existing profile, library or tool
  is overwritten silently.

### Tidy-first prerequisite

Extract current CNC-library restoration into a strict versioned IO codec before bundle work. The
codec must round-trip all valid current fields, reject an invalid document as a document, and keep
the existing app-level persistence behavior byte/behavior compatible through adapter tests.

### Included in v1

- portable machine profile facts and operator defaults after stripping local trust/state;
- all selected material-library documents, preserving advisory device hints and provenance; and
- the strict CNC tool library.

### Explicitly excluded

- projects, autosaves, recovery checkpoints and execution archives;
- Frame candidates/permits, configured-device signatures, controller observations and homing/WCS
  evidence;
- serial permissions, selected ports, live machine state and active operations;
- camera source URLs, credentials/tokens, capture bindings, calibration/alignment and physical
  plane measurements;
- Labs opt-ins, update state and window layout;
- PWA/browser caches and crash reports.

Later versions may add hotkeys, image presets, material-test presets and layer defaults only after
each has a storage-independent codec. Raw `localStorage` copying is permanently out of scope.

### Recipe trust

Imported recipes retain source/device hints and warnings. Cross-machine reuse is never blocked;
the destination shows the mismatch in the library and Job Review. A bundle cannot turn advisory
recipe data into trusted machine capability or physical qualification.

### Definition of software complete

- deterministic serialize/parse round-trip and future/old schema errors;
- selective import with collision copies and no overwritten destination entry;
- corrupt component isolation and atomic application per selected component;
- web + Electron save/open browser tests;
- no excluded local/session key appears in fixture bundles; and
- migration between two clean test profiles reproduces selected portable data only.

## Initiative 3 — camera-assisted same-design batch fill

### User outcome

An operator freezes one registered top-down capture, marks one physical blank as the sample, places
one design relative to it, reviews/edit targets for similar blanks, and applies ordinary rigid
project copies. Automatic proposals remain editable; manual add/move/rotate remains available when
vision is poor.

### Phase A: arbitrary-target rigid-copy foundation

Before camera or CV code, extract a pure placement plan and one state action that materializes a
selected multi-object/group template at ordered targets:

```ts
type RigidPlacementTarget = {
  readonly xMm: number;
  readonly yMm: number;
  readonly rotationDeg: number;
};
```

- translation + rotation only; never inferred scale;
- preserve layer/operation bindings, groups, raster masks, curves and source ordering;
- mint unique object/group IDs in the state boundary;
- one Apply equals one undo step; and
- deterministic target order drives deterministic object order.

### Phase B: manual camera draft

1. Freeze one fresh registered still, capture binding, pixel basis and material surface height.
2. Draw/adjust the sample blank region and define the design's sample-relative transform.
3. Click target centers and angle handles on the registered bed image.
4. Show ghost copies and permit include/exclude/add/move/rotate.
5. Apply through the rigid-copy foundation, creating ordinary project objects.

After Apply, later Camera-panel changes do not invalidate Frame. Project edits do, through the
existing exact-output signature. Camera state must not be reintroduced as a Start guard.

### Phase C: bounded regular-workpiece detection

The initial honest envelope is flat, separated, similarly shaped, visibly contrasting pieces.
Using the operator's sample ROI:

1. bounded downsample and local contrast/color description;
2. mask cleanup and connected contours using existing pure image/contour primitives;
3. candidate area, aspect, contour/moment, color and orientation measurements;
4. observable per-candidate deltas against the sample; and
5. ordered proposals in bed coordinates.

Do not call the result “AI” or “confidence.” Do not auto-scale artwork. Do not auto-commit proposals.
Threshold defaults wait for an annotated first-party corpus; synthetic fixtures alone cannot choose
a production threshold.

### Display and Job Review

- show candidate outline, center, angle and measured score components;
- show unmatched/ambiguous regions without refusing Apply;
- disclose that ordinary Frame traces the aggregate job rectangle, not each blank; and
- carry optional display-only provenance after its schema ADR: capture binding, surface height,
  source template IDs, generated IDs and measured scores.

### Required corpus and qualification

Software fixtures cover rotation, holes, noise, lighting gradients and near-touching shapes. The
real corpus must add clean/scratched/honeycomb beds, reflective and low-contrast stock, shadows,
holes, close spacing, multiple heights, camera sources and bed quadrants. Record precision/recall,
center error in mm and angle error. Then run de-energized placement/Frame and low-power scrap marks.
No production threshold is set until those measurements exist.

### Definition of software complete

- rigid-copy properties and state identity/undo tests pass;
- manual fake-camera flow applies editable ordinary geometry;
- annotated corpus metrics are reproducible and reported by fixture version;
- every automatic proposal can be corrected or removed;
- save/reopen preserves applied geometry and bounded display provenance; and
- non-camera Frame/Start/output behavior remains unchanged.

## Initiative 4 — commanded stock removal and STL export

### Corrected scope

Stock-removal simulation and STL import are already built. The missing product is a closed artifact
representing the simulator's commanded remaining stock, plus export and Inspector integration.

### Exact artifact semantics

- Name: **Commanded simulated stock**.
- Scope: 3-axis/2.5D heightfield removal only.
- Coordinates: machine work-coordinate millimetres; X/Y retain the configured stock origin and
  axes, Z=0 is stock top, bottom is `-thicknessMm`. Never export the canvas's mirrored scene frame.
- Tool shapes: reuse the existing flat/engraving, ball-nose and V-cone kernels.
- Depth: removal-grid depths at or below `-thicknessMm` mean absent material/through holes. The
  remaining-stock mesh emits no material or vertices below the finite stock bottom and never emits
  a zero-thickness face there.
- Closure: top faces, interior step walls, through-hole walls, outer perimeter sides and remaining
  bottom faces form a closed solid.
- Format: deterministic little-endian binary STL, computed finite normals, fixed 80-byte header and
  no timestamp.
- Resolution: use the export removal grid, never the 300-cell display downsample. Disclose actual
  mm/cell, triangle count and any existing four-million-cell coarsening.
- Limits: no holder/shank/flute-length collision, machine kinematics, controller tracking,
  deflection, runout, backlash, stock flatness or material-result claim.

### Pure foundation

Create new focused modules:

- `src/core/heightfield/remaining-stock-triangles.ts`;
- `src/core/heightfield/remaining-stock-triangles.test.ts`;
- `src/io/stl/emit-binary-stl.ts`; and
- `src/io/stl/emit-binary-stl.test.ts`.

Tests prove finite coordinates, exact dimensions, outward winding, through holes, every
non-degenerate undirected manifold edge appearing twice, deterministic bytes, record counts and
round-trip parsing through the existing STL parser.

### Native-project export

A worker prepares the current CNC project through the existing exact output path, builds the
machine-coordinate toolpath/removal grid, generates the mesh/STL off-thread, and writes through the
platform save adapter. File and full-page 3D surfaces keep the action available; invalid/empty
compilation reports the factual inability to construct the requested artifact. Resolution and
approximations are always visible.

### Inspector follow-up

External G-code needs explicit editable stock origin/dimensions/top/thickness/resolution and tool
geometry. Add one-tool support first, then T-word mapping and supported canned cycles. Unsupported
or skipped motion remains visible in Program Health and the export summary; it never hides or
blocks the surface/export action.

### Definition of software complete

- analytic flat/pocket/V/ball/through fixtures produce manifold deterministic files;
- native emission → reimported G-code → removal grid remains within existing raster tolerance;
- worker cancellation and pressure disclosure keep the UI responsive;
- CurveDesk reimports the binary output with expected dimensions/orientation;
- at least two external CAD/STL viewers agree on dimensions/orientation; and
- browser visual fixtures confirm the displayed surface. Physical coupon comparison is separate.

## Missing fundamentals, differentiating bets and defer list

### Missing fundamentals

- exact per-slot sequence plan and artifact-bound consumption;
- maximum rendered-envelope spacing for variable text;
- strict component codecs and non-overwriting bundle collision rules;
- arbitrary rigid-copy state primitive;
- annotated real camera corpus and measurable error reporting;
- closed manifold stock mesh and deterministic STL bytes;
- worker paths and pressure disclosure for large batches/meshes; and
- explicit software-vs-hardware qualification records.

### Differentiating bets

- completely offline personalized sheet production with exact failure-safe advancement;
- one portable, inspectable workshop migration file without an account;
- camera-assisted batches whose proposals stay editable and measurable; and
- exporting commanded simulated stock from the same cutter-shaped model used in preview.

### Avoid or defer

- live databases, barcode/QR generation and cloud sync until offline imposition is trustworthy;
- raw browser-storage bundles or migration of controller/Frame/camera trust state;
- opaque “AI confidence,” auto-scaling or automatic camera commit;
- setting camera match thresholds from synthetic fixtures alone;
- per-blank Start guards or reintroducing camera UI into Frame identity;
- exporting the downsampled display stock surface;
- hidden STL decimation, volumetric CSG/SDF, undercuts, multi-side or rotary stock claims; and
- claiming physical stock/placement from simulation, air movement or green tests.

## Recommended next five initiatives

### Step 1 — merge governance

Land this roadmap, the two `PROJECT.md` scope corrections, ADR-279 and F-D6. Good result: current
source no longer says the initiative being built is deferred, and no runtime behavior changes.

### Step 2 — build the pure variable batch planner

Add only `batch-sequence.ts`, its tests and one barrel export. Good result: slot order/count,
geometry independence, wrap, stride, serial-only behavior, safe-integer inheritance, determinism,
non-mutation and no planner cap/rewrite pass.

### Step 3 — build transient exact materialization and preview

Render each slot with one clock, compute the maximum envelope, then derive placements from the
retained grid specification and preview the slot manifest. Good result: long/short fixture rows
cannot overlap and no `.lf2` schema changes.

### Step 4 — harden portable data and manual camera placement

Land the strict CNC-library codec, then the bundle envelope. In a separate stream land arbitrary
rigid placement and the manual camera draft. Good result: migration never overwrites; camera Apply
creates ordinary editable project geometry without CV claims.

### Step 5 — land stock STL foundation, then qualify camera automation

Build the closed mesh/emitter and worker export while collecting real camera frames. Good result:
manifold CAD-readable commanded stock exists before Inspector expansion, and camera automation
starts only with versioned measurable fixtures.

## Current release blockers and misleading surfaces

- **Resolved prerequisite:** PR #569 repaired dormant production browser contracts; PR #561 restored
  discovery of every `.e2e.ts` and `.spec.ts` suite. Both are merged on this baseline.
- **Scope contradiction:** before this roadmap, `PROJECT.md` and ADR-164 explicitly deferred the
  first requested initiative. ADR-279 is required before implementation.
- **Variable-data wording:** “variable text shipped” is true; “batch sheet imposition shipped” is
  false until the materializer, manifest and advancement phases land.
- **Camera wording:** overlay, trace, manual board capture and regular board fill are real; calling
  any of them smart/same-design camera fill would be misleading.
- **Stock wording:** removal grids and 3D preview are real; STL export and a closed remaining-stock
  artifact are absent.
- **Bundle wording:** individual machine/material exports are not a portable workshop bundle, and
  current CNC-library JSON is not safe bundle input.
- **Hardware:** no camera-batch accuracy, record-to-workpiece sheet, external CAD STL, or physical
  stock coupon has been qualified by this plan.

## Planned PR sequence

Each row is one coherent review unit. No row adds or widens a guard or non-factual refusal.

| PR | Scope | Required verification |
| --- | --- | --- |
| GOV-1 | This document + PROJECT + ADR-279 + F-D6 | Prettier, ADR-number check, full release gate |
| VAR-1 | Pure batch sequence planner | Focused sequence/planner tests, typecheck, lint, full release |
| VAR-2 | Async slot materialization + max envelope | Renderer fixtures, 500-slot pressure benchmark |
| VAR-3 | Imposition dialog + exact preview/manifest | Component + real-browser success/error/empty/edge |
| VAR-4 | Artifact-bound `.gcode`/`.rd` export and stream advancement/recovery | Identity, stale, failure, retry, resume, exact-once tiled/`.rd` tests |
| VAR-5 | Optional persisted editable imposition, only if still justified | Project schema migration + reopen E2E |
| BND-1 | Strict CNC-library codec with compatibility adapter | Current payload round-trip and corrupt fixtures |
| BND-2 | Bundle envelope + component selection/import | Deterministic bytes, collisions, exclusions, web/Electron |
| CAM-1 | Pure arbitrary-target rigid copy | Geometry properties, IDs/groups/order, one undo |
| CAM-2 | Manual registered-still proposal editor | Fake-camera browser flow and stale-capture display |
| CAM-3 | Versioned annotated corpus + detector | Metrics, performance and editable proposals |
| CAM-4 | Display provenance + Job Review information | Save/reopen and no readiness/preflight changes |
| STL-1 | Closed remaining-stock triangles + binary emitter | Manifold/determinism/parser round-trip |
| STL-2 | Native worker export + UI | Responsiveness, cancellation, exact coordinate fixtures |
| STL-3 | Inspector stock setup and surface | Native-read parity, unsupported-motion information |

## First slice ready to build

After GOV-1 merges, start VAR-1 with these files only:

- `src/core/variables/batch-sequence.ts`;
- `src/core/variables/batch-sequence.test.ts`; and
- `src/core/variables/index.ts`.

Run at minimum:

```powershell
pnpm exec vitest run src/core/variables/batch-sequence.test.ts src/core/variables/sequence.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm release:check
```

VAR-1 is done when its exact diff is pure-core/test/barrel only, all named checks pass, CI is green,
and the PR text states plainly that no UI, persistence, G-code, machine, Frame, Start or hardware
behavior changed.
