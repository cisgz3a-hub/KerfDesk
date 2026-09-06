> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# Laser Feature and Workflow Gap-Closure Research

Date: 2026-07-12
Baseline: `origin/main` at `3e4530748ad9b266f5a21904f033f68e2c0014bb`
Scope: Research and build planning only. No product code was changed by this audit.

## Executive verdict

KerfDesk's 7.4/10 laser score reflects a capable core surrounded by workflow gaps. The fastest credible route toward LightBurn is not a feature-for-feature rewrite. It is:

1. Expose and finish foundations that already exist, especially rotary, camera alignment, material assignment, optimization, and machine-position safety.
2. Add the production workflows that turn repeated jobs into reliable operations: variable text, arrays, quick nesting, print-and-cut, material-library migration, and controlled low-power positioning.
3. Replace the point-only geometry bottleneck with first-class curves, then build richer text, node editing, trace output, and project migration on that foundation.
4. Prove the workflows in browser automation, geometry fixtures, output invariants, and real-machine acceptance runs.

The projected result is about 9.0-9.2/10 if all four waves pass their gates. Reaching LightBurn's 9.4 breadth is a longer ecosystem effort involving controller coverage, hardware history, documentation depth, and specialist workflows. The score projections below are planning estimates, not audited scores.

## Research rules

- Match user outcomes, not LightBurn's implementation or interface.
- Use published behavior, open standards, clean-room mathematics, and license-compatible libraries.
- Keep the existing single output-preparation and safety pipeline authoritative.
- Do not claim a feature complete until preview, save/export, start, cancellation, persistence, and recovery behavior agree.
- Put machine-risk features behind explicit capability and safety gates.
- Prefer deterministic algorithms and reproducible fixtures over visual-only judgment.

## Where the 2.0-point gap comes from

| Sector | KerfDesk | LightBurn | Gap | Main reason |
|---|---:|---:|---:|---|
| Text and variable data | 5.0 | 10.0 | 5.0 | Static modal text; no CSV/serial/date fields, path text, or mature on-canvas editing |
| Rotary, camera, registration | 5.5 | 10.0 | 4.5 | Strong hidden foundations, but incomplete shipped workflows, rotary raster, profile persistence, and hardware proof |
| Layout and nesting | 6.5 | 9.5 | 3.0 | No general arrays, quick nest, irregular nest, or copy-along-path |
| 2D design | 7.0 | 9.5 | 2.5 | Point-based path model limits curve editing, text shaping, and high-fidelity import |
| Performance and scale | 6.5 | 9.0 | 2.5 | Point-dense geometry inflates memory, editing, serialization, and compile work |
| UX and documentation | 6.5 | 8.5 | 2.0 | Powerful features are fragmented or undiscoverable; some scope documentation is stale |
| Materials | 8.0 | 10.0 | 2.0 | Native library is solid, but no `.clb` migration and no full linked-preset workflow |
| Machine, origin, and control | 8.0 | 10.0 | 2.0 | Missing specialist positioning workflow and broad hardware acceptance matrix |
| Laser CAM and optimization | 8.5 | 10.0 | 1.5 | Fixed optimizer exists, but users lack cut-planner controls and feedback |

The gap is therefore concentrated. It is not evidence that the entire laser core needs rebuilding.

## Verified current foundations

### Rotary

The repository already has rotary configuration, job persistence, coordinate transformation, vector G-code behavior, and tests. The main gaps are a complete setup route, discoverable device/profile integration, raster wrapping, test-pattern calibration, and real-device validation. Rotary raster is currently refused explicitly rather than emitted incorrectly, which is a good safety boundary.

Relevant implementation areas:

- `src/core/devices/rotary.ts`
- `src/core/job/rotary-job.ts`
- `src/core/job/rotary-transform.ts`
- `src/io/gcode/emit-gcode.ts`

### Camera and registration

KerfDesk already contains checkerboard lens calibration, four-point homography, bed warping, automatic marker alignment, a burn-marker wizard, manual corner alignment, and USB/RTSP/machine-camera paths. This is more mature than the visible workflow score suggests.

The immediate correctness defect is profile fidelity: canonical profile serialization does not preserve every important camera/alignment field. The larger remaining work is trusted machine-origin integration, resilient recovery, multiple-hardware testing, and a coherent setup/validation UI.

Relevant implementation areas:

- `src/core/camera/homography.ts`
- `src/core/camera/warp-to-bed.ts`
- `src/core/camera/align-markers.ts`
- `src/ui/camera/wizard/camera-wizard-store.ts`
- `src/ui/camera/align-wizard/`
- `src/io/machine-profile/machine-profile-io.ts`

### Text

Text objects retain content and style metadata, but their usable geometry is pre-rendered into static paths with `opentype.js`. Four bundled fonts are registered. This is enough for ordinary static text but not for output-time variable evaluation or LightBurn-class text editing.

The architectural consequence is important: variable text must be materialized through one shared, asynchronous stage before machine preview, save/export, and start. Creating one-off geometry in individual UI or export paths would produce mismatched jobs.

Relevant implementation areas:

- `src/core/scene/scene-object.ts`
- `src/core/text/text-to-polylines.ts`
- `src/core/text/font-registry.ts`
- `src/ui/text/AddTextDialog.tsx`

### Trace and geometry

Trace already runs in a worker, so moving it to a worker is not the next fix. The deeper issue is that canonical colored paths contain polylines only. SVG curves are flattened early; fitted cubic curves are sampled back into points. This makes large traces expensive and weakens editing fidelity.

The long-term solution is a canonical segment model supporting line, cubic, and arc segments, with adaptive flattening only where preview or machine compilation needs it. Trace thresholds and simplification can improve first, but they cannot fully remove this structural ceiling.

Relevant implementation areas:

- `src/ui/trace/use-trace-worker-client.ts`
- `src/ui/trace/trace-worker.ts`
- `src/core/scene/scene-object.ts`
- `src/core/geometry/fit-cubics.ts`

### Materials and optimization

KerfDesk already has a native `.lfml.json` material library and assignment workflow. It does not accept `.clb`. A path optimizer also exists, but the UI exposes essentially one high-level option rather than a cut-planner workflow.

Relevant implementation areas:

- `src/ui/app/material-library-file-actions.ts`
- `src/core/job/optimize-paths.ts`
- `src/ui/laser/OptimizationSettingsDialog.tsx`

## Competitor and standards findings

### Variable text

LightBurn evaluates date/time, serial, CSV, and cut-setting variables consistently for preview, save/export, and output. It also defines current/start/end values, advance behavior, auto-advance, bake, offset, formatting, and maximum-width behavior. These are workflow semantics, not merely string replacement.

Research sources:

- [LightBurn Variable Text](https://docs.lightburnsoftware.com/2.1/Reference/VariableText/)
- [LightBurn Variable Text Formatting](https://docs.lightburnsoftware.com/latest/Reference/VariableText/VariableTextFormatting/)
- [RFC 4180 CSV format](https://www.rfc-editor.org/info/rfc4180/)

Conclusion: implement a typed field evaluator and state machine. Do not use ad hoc `split(',')` parsing or advance counters from UI events. Job state must advance only after a confirmed successful job according to an explicit policy.

### Nesting and arrays

LightBurn separates fast Quick Nest from dense irregular nesting. Quick Nest deliberately uses bounding boxes; dense nesting delegates to SVGnest. This supports a staged KerfDesk design:

- Phase A: deterministic rectangle packing for fast, predictable shop-floor layout.
- Phase B: irregular no-fit-polygon nesting in a cancellable worker.

SVGnest is MIT-licensed, browser-based, worker-capable, and implements no-fit polygons plus a genetic search. It is a reasonable Phase B evaluation candidate, subject to benchmark, security, maintenance, provenance, and integration review. `libnest2d` is LGPL-3.0 and conflicts with the repository's current dependency policy, so it should not be adopted without an explicit licensing-policy decision.

Research sources:

- [LightBurn Quick Nest](https://docs.lightburnsoftware.com/2.1/Reference/QuickNest/)
- [LightBurn Nest Selected](https://docs.lightburnsoftware.com/latest/Reference/NestSelected/)
- [LightBurn Grid Array](https://docs.lightburnsoftware.com/latest/Reference/GridArray/)
- [LightBurn Copy Along Path](https://docs.lightburnsoftware.com/2.1/Reference/CopyAlongPath/)
- [SVGnest](https://github.com/Jack000/SVGnest)
- [MaxRects algorithm survey](https://trszdev.github.io/maxrects-bssf-global-demo/RectangleBinPack.pdf)
- [libnest2d](https://github.com/tamasmeszaros/libnest2d)

Conclusion: ship general grid/circular arrays and deterministic MaxRects before irregular nesting. This captures most daily value with much lower geometry risk.

### Print-and-cut

LightBurn's workflow records two design targets and their two physical machine positions. The mapping supports translation, rotation, and optional uniform scale. Its documentation also emphasizes a gantry machine, homing, absolute coordinates, and avoiding manual head movement.

The clean-room two-point similarity transform is straightforward. For design points `p1`, `p2` and physical points `q1`, `q2`:

```text
s = |q2 - q1| / |p2 - p1|          (or 1 when scaling is locked)
theta = angle(q2 - q1) - angle(p2 - p1)
t = q1 - s * R(theta) * p1
q = s * R(theta) * p + t
```

The hard part is safe state management: position-known gating, target separation, consistent transformed preview/frame/start output, and invalidation after disconnect, alarm, reset, or manual-position uncertainty.

Research sources:

- [LightBurn Print and Cut](https://docs.lightburnsoftware.com/2.1/Reference/PrintAndCut/)
- [Rayforge Print and Cut](https://rayforge.org/docs/addons/print-and-cut/)

Conclusion: build and property-test the pure transform first, then place a guarded wizard around it. Reuse registration math and output-preparation primitives already in the app.

### Camera alignment

LightBurn's automatic alignment uses AprilTag markers, requiring at least four detected markers from its pattern, with a manual fallback and a burned validation grid. OpenCV documents the calibration, homography, and marker-detection mathematics. AprilTag 3 is BSD-2-Clause, but KerfDesk already has a marker detector, so a new native/WASM dependency should only be added if a controlled benchmark proves a material reliability gain.

Research sources:

- [LightBurn Camera Alignment](https://docs.lightburnsoftware.com/latest/Reference/Cameras/Alignment/)
- [OpenCV camera calibration and homography](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html)
- [OpenCV ArUco markers](https://docs.opencv.org/trunk/d9/d6d/tutorial_table_of_content_aruco.html)
- [AprilTag 3](https://github.com/AprilRobotics/apriltag)

Conclusion: correct profile round-tripping and validate the existing detector before changing detection technology.

### Rotary

LightBurn exposes roller/chuck selection, rotary enablement, axis behavior, object diameter/circumference, steps per rotation, and test/calibration behavior as one coherent setup workflow. Rayforge also demonstrates that rotary and print-and-cut are achievable in a modern open-source laser stack.

Research sources:

- [LightBurn Rotary Mode](https://docs.lightburnsoftware.com/latest/Reference/RotaryMode/)
- [Rayforge 1.6 rotary and print-and-cut](https://rayforge.org/fr/blog/rayforge-1.6-device-profiles-rotary-print-cut/)

Conclusion: expose the existing KerfDesk vector implementation first; add raster only after a clearly specified cylindrical mapping and seam policy pass fixtures.

### Material libraries

LightBurn material libraries use `.clb`, support load/save/merge, and distinguish Assign from Link. Available public descriptions indicate XML, but a trustworthy importer requires real files from multiple versions/vendors before a stable schema can be claimed. No suitable local `.clb` corpus was found during this research.

Research source:

- [LightBurn Material Library](https://docs.lightburnsoftware.com/latest/Reference/MaterialLibrary/)

Conclusion: begin with fixture acquisition and an import-only tolerant XML reader. Reject DTDs/external entities, cap file size/depth/record count, report unknown fields, and never silently coerce unsupported settings. Add Link semantics only after imported data is stable.

### Fire and positioning laser

LightBurn provides a low-power Fire function for supported diode-class devices and requires it to be enabled in device settings. This is safety-critical and should not be treated as a generic toggle.

Research sources:

- [LightBurn Move window](https://docs.lightburnsoftware.com/2.1/Reference/MoveWindow/)
- [LightBurn basic device settings](https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/BasicSettings/)

Conclusion: if implemented, use a momentary hold-to-fire control with an explicit device opt-in, low hard cap, connected-and-idle gate, and unconditional hard-off on release, blur, disconnect, alarm, route change, or component unmount. Keep it unavailable for unsupported controller classes.

### Curve-native design and migration

LightBurn offers node editing, shape properties, text-on-path, bending/welding, and system-font workflows. SVG 2 defines interoperable text-path behavior. Rayforge 1.8 reports a Rust-backed native Bezier pipeline and broad LightBurn project import, reinforcing that curve preservation and migration are becoming baseline competitive expectations.

Research sources:

- [LightBurn Edit Nodes](https://docs.lightburnsoftware.com/2.1/Reference/EditNodes/)
- [LightBurn Shape Properties](https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/)
- [LightBurn Text](https://docs.lightburnsoftware.com/latest/Reference/Text/)
- [SVG 2 text paths](https://www.w3.org/TR/SVG/text.html)
- [Rayforge 1.8 curve pipeline and LightBurn import](https://rayforge.org/de/blog/rayforge-1.8-rust-pipeline-lightburn-import/)
- [Rayforge import formats](https://rayforge.org/docs/files/importing/)
- [Rayforge LightBurn formats](https://rayforge.org/docs/files/formats/)

Conclusion: `.lbrn/.lbrn2` migration, advanced text, trace fidelity, and scalable editing should all follow a first-class segment model. Building each feature on flattened point arrays would multiply migration and performance debt.

## Proposed delivery waves

### Wave 0: Governance and reproducible baseline

Projected score: remains 7.4.
Purpose: prevent contradictory scope and unverifiable progress.

Deliverables:

1. Update `PROJECT.md` scope. It currently describes `.clb`, linked presets, variable text, and system fonts as out of scope, and still describes rotary as out of scope despite shipped backend work.
2. Add an ADR for the laser-competitiveness program: clean-room behavior research, license rules, canonical geometry direction, and output-materialization invariant.
3. Freeze benchmark fixtures for trace, text, nesting, large imports, camera alignment, rotary, and output safety.
4. Store the score formula and evidence required to change each score.

Exit gate:

- Every planned feature has an owner boundary, fixture, measurable acceptance rule, and license/provenance record.
- No score changes based only on screenshots or feature presence.

### Wave 1: Finish existing foundations

Projected score after acceptance: about 7.8.
Estimated size: 5-8 focused PRs.

Work packages:

| ID | Package | Size | Risk | Key result |
|---|---|---:|---|---|
| L1 | Camera/profile round-trip repair | M | Medium | Calibration, alignment, baud/device fields survive save/load/export/import |
| L2 | Rotary setup UI, profile binding, vector test pattern | M | Medium | Existing rotary backend becomes a complete user workflow |
| L3 | Rotary raster mapping | M/L | High | Cylindrical raster jobs work with explicit seam and bounds behavior |
| L4 | Momentary Fire control | M | Very high | Safe low-power diode positioning loop |
| L5 | Cut-planner controls | M | Medium | Inside-first, layer/priority, direction/start, and travel policies become visible and testable |
| L6 | Camera hardware acceptance | M plus hardware | High | Existing calibration/alignment is proven across supported camera paths |

Do not combine Fire, rotary raster, and camera changes in one PR. Their failure and hardware matrices are different.

### Wave 2: Production automation

Projected score after acceptance: about 8.5-8.7.
Estimated size: 9-13 focused PRs.

Work packages:

| ID | Package | Size | Dependency | Key result |
|---|---|---:|---|---|
| P1 | Typed variable formatter | M | Wave 0 | Date/time, serial, CSV, and job fields have deterministic semantics |
| P2 | CSV and serial state manager | M | P1 | Explicit range, offset, advance, reset, and failure behavior |
| P3 | Shared async text materialization | L | P1-P2 | Design preview, machine preview, export, save, and start use identical evaluated geometry |
| A1 | General grid and circular arrays | M/L | None | Repeated-layout workflow outside board capture |
| N1 | Deterministic Quick Nest | M | A1 useful | Fast bounding-box packing with rotation locks and padding |
| N2 | Irregular nesting worker | XL | N1 | Dense NFP placement with progress, cancellation, and deterministic seeds |
| R1 | Print-and-cut transform core | S/M | Position-state APIs | Pure, tested similarity transform |
| R2 | Print-and-cut wizard/output integration | M/L | R1 | Safe two-target registration through frame/start/export |
| M1 | `.clb` fixture corpus and schema notes | S | External files | Evidence before parser promises |
| M2 | `.clb` import-only parser | L | M1 | Safe, inspectable migration into native material data |
| M3 | Linked material semantics | M/L | M2 | Layer settings can deliberately follow library records |

Irregular nesting should be treated as optional within Wave 2. Quick Nest, arrays, variable data, and print-and-cut yield more predictable value first.

### Wave 3: Curve-native design foundation

Projected score after acceptance: about 9.0.
Estimated size: an XL program, not one PR.

Work packages:

| ID | Package | Size | Key result |
|---|---|---:|---|
| G1 | Segment schema and migration ADR | L | Defines line/cubic/arc ownership, transforms, bounds, serialization, and versioning |
| G2 | Canonical curve geometry | XL | Scene objects retain curves instead of only sampled points |
| G3 | Adaptive preview/compile flattening | L | Machine tolerance is explicit while editing remains compact |
| G4 | Curve-preserving SVG/DXF/trace paths | L/XL | Import and trace no longer discard editability early |
| G5 | Advanced node editing | XL | Handles, line/curve conversion, join/break, corner/smooth controls |
| T1 | On-canvas and system-font text | L | Text editing becomes direct and font coverage expands |
| T2 | Text on path, bend, weld | L/XL | Specialist text workflows build on canonical curves |
| I1 | `.lbrn/.lbrn2` read-only migration | XL | Users can move existing projects without claiming round-trip compatibility |

Migration strategy:

1. Add a versioned segment representation without deleting legacy point paths.
2. Read both formats and write the new format behind a feature flag.
3. Implement transforms, bounds, hit testing, undo, persistence, and compile flattening.
4. Migrate importers and trace one at a time.
5. Remove the legacy representation only after fixture equivalence and document migrations are proven.

### Wave 4: Proof, polish, and breadth

Projected score after acceptance: about 9.0-9.2.
Purpose: convert implementation into dependable product capability.

Deliverables:

- Playwright end-to-end flows for setup, import, trace, layers, materials, frame, start, pause/recover, rotary, variable jobs, and print-and-cut.
- Real-device acceptance matrix covering representative GRBL diode, FluidNC/grblHAL, supported camera routes, rotary types, and any supported DSP/controller family.
- Large-job performance budgets for import, trace, edit, preview, save, compile, and streaming.
- In-app discoverability and task-oriented documentation.
- Compatibility corpus for SVG, DXF, PDF, image, `.clb`, and LightBurn project migration.
- Release telemetry or opt-in diagnostics for failures that cannot be reproduced locally.

## Acceptance contracts

### Variable text

- The same evaluated geometry and values appear in design preview, machine preview, saved/exported job, and started output.
- CSV supports UTF-8, BOM handling, RFC 4180 quotes, embedded commas, and embedded newlines.
- A deterministic clock can be injected into tests.
- Cancelled, failed, or blocked jobs do not accidentally advance serial/CSV state.
- Auto-advance policy is explicit, persisted, undo-safe where relevant, and covered by recovery tests.
- Offset, range, formatting, missing-field errors, and maximum-width behavior are visible before output.

### Arrays and nesting

- Placement is deterministic for a fixed input, settings object, and seed.
- No item overlaps after configured padding and every item remains within the target bin.
- Groups, layer identities, transforms, and rotation locks are preserved.
- The whole operation is one undo step.
- Quick Nest meets a fixed interactive budget on a 100-rectangle fixture.
- Irregular nesting runs in a worker with progress, cancellation, timeout, and a best-so-far result.

### Print-and-cut

- Pure transform tests cover translation, rotation, scale lock/unlock, noise, and inverse mapping.
- Coincident or poorly separated target points are rejected with a useful error.
- Start requires absolute coordinates, homed/known position, and valid target capture.
- Design preview, frame, generated output, and streamed output use the same transform instance.
- Registration is invalidated after reset, disconnect, alarm, coordinate-system change, or loss of trusted position.
- Hardware runs record measured target error at multiple bed positions.

### Rotary

- Setup covers roller/chuck, axis, reverse direction, circumference/diameter, steps-per-rotation, and profile persistence.
- Vector and raster jobs share a documented wrap convention and seam location.
- Bounds and over-wrap behavior are explicit, with no silent clipping.
- The calibration/test pattern predicts measurable rotation.
- With rotary disabled, output remains byte-for-byte unchanged for fixed fixtures.
- At least one roller and one chuck device pass physical calibration and output tests before a full release claim.

### Camera

- All calibration and alignment data survives profile export/import and application restart.
- A burned grid validates bed mapping at center, corners, and intermediate points.
- Auto alignment has confidence/coverage diagnostics and a manual fallback.
- Disconnect, resolution change, camera change, and machine-origin change invalidate stale calibration appropriately.
- Browser, Electron bridge, USB, and RTSP capability claims are tested separately.

### `.clb` migration

- The fixture corpus includes at least five real libraries spanning versions, device classes, and vendors/users where legally obtainable.
- XML processing rejects DTDs and external entities and enforces file, depth, string, and record limits.
- Unsupported or unknown settings are reported, not silently discarded or coerced.
- Import is read-only in the first release; KerfDesk does not claim `.clb` round-trip compatibility.
- Native records retain source metadata and a repeatable conflict/merge policy.

### Curves, text, and trace

- Fixtures include the current architectural image set, geometric shapes, glyphs with bowls/corners/serifs, holes, open paths, arcs, and self-intersections.
- Metrics include topology, IoU where applicable, corner displacement, curve deviation, node/command count, and editability.
- Compile flattening uses an explicit machine-space tolerance and has worst-case segment limits.
- SVG curve imports remain curves through edit and save unless a user operation requires flattening.
- Trace presets are all benchmarked; no preset may merely alias another without the UI saying so.

### Fire control

- Available only on explicitly supported diode-class profiles and only after a deliberate device setting is enabled.
- Control is momentary hold-to-fire; no ordinary toggle can leave emission active.
- Firmware power is hard-capped independently of the displayed value.
- Release, pointer cancellation, keyboard cancellation, blur, navigation, disconnect, alarm, reset, and component unmount all issue hard-off behavior.
- Unsupported CO2/DSP/controller paths never receive Fire commands.
- The feature requires dedicated hardware acceptance before general availability.

## Recommended PR order

1. Scope correction, ADR, score rubric, and frozen fixtures.
2. Camera and machine-profile round-trip repair.
3. Rotary vector setup UI and profile workflow.
4. Rotary raster mapping and fixtures.
5. Momentary Fire behind capability and safety gates.
6. Print-and-cut pure transform and property tests.
7. Print-and-cut wizard and output integration.
8. Variable formatter.
9. CSV/serial state manager.
10. Shared async materialization across preview/save/export/start.
11. General grid/circular arrays.
12. Deterministic Quick Nest.
13. `.clb` corpus and import-only parser.
14. Linked material semantics.
15. Expanded cut-planner controls.
16. Curve-schema ADR and compatibility layer.
17. Canonical curves and adaptive compile flattening.
18. Curve-preserving import and trace.
19. On-canvas/path text and advanced node editing.
20. Read-only `.lbrn/.lbrn2` migration.
21. Consolidated browser and hardware acceptance release.

This sequence deliberately places small, high-value completions before the geometry program, while avoiding new flattened-geometry features that would have to be rewritten immediately.

## Score projection and evidence threshold

| Milestone | Projected score | What must be true before rescoring |
|---|---:|---|
| Current audited baseline | 7.4 | Existing scorecard evidence |
| Wave 1 accepted | ~7.8 | Rotary setup/vector, camera persistence, Fire safety, cut-planner UI, and hardware evidence pass |
| Wave 2 accepted | ~8.5-8.7 | Variable production jobs, arrays, Quick Nest, print-and-cut, and material migration pass end-to-end |
| Wave 3 accepted | ~9.0 | Curve-native import/edit/trace/text and migration workflows pass quality and performance gates |
| Wave 4 accepted | ~9.0-9.2 | Browser, hardware, documentation, compatibility, and large-job proof are complete |

No wave should inherit its projected score merely because code was merged. The competitive score must be recalculated from observed workflows and the acceptance evidence.

## Decisions to make before implementation

1. Confirm that variable text, `.clb` import, linked materials, system fonts, and rotary are now in product scope.
2. Decide whether irregular nesting is a near-term requirement or follows Quick Nest feedback.
3. Approve the first-class curve program as a versioned data-model migration rather than a local trace refactor.
4. Decide which controller and hardware families are release blockers for Rotary, Camera, Fire, and Print-and-Cut claims.
5. Acquire legally shareable `.clb`, `.lbrn`, and `.lbrn2` fixtures before promising compatibility.
6. Decide whether SVGnest's dependency health and architecture meet current repository gates; do not adopt `libnest2d` under the current license policy.
7. Define whether variable-job counters advance after successful stream completion, successful file export, or an operator-confirmed policy per destination.

## Immediate recommendation

Start Wave 0, then deliver camera profile round-tripping and the existing rotary vector workflow. In parallel, specify and property-test the print-and-cut transform and variable-text state semantics. These tasks expose real user value quickly and produce the architectural contracts needed for later work.

Do not begin with irregular nesting or `.lbrn2` import. Both are large compatibility projects, and both will be cheaper and more reliable after deterministic Quick Nest, fixture governance, and curve-native geometry are established.
