# CNC 3D view — three.js upgrade research and roadmap

**Date:** 2026-07-25  
**Status:** research only — nothing here is implemented, rendered, or perceptually verified.  
**Produced by:** two Claude Code workflows run in worktree `cnc-3d-threejs-upgrade-9d1216`.

> **Provenance.** This document is a faithful rendering of two workflow results that
> previously existed only in a volatile `%LOCALAPPDATA%\Temp` scratchpad. It is committed
> here so the work survives a temp-dir sweep. Every claim below is the output of a
> read-only agent that was instructed to cite `file:line` evidence and to write
> "UNVERIFIED" when it could not confirm something — but **the claims themselves have not
> been independently re-checked**, and no 3D output was ever rendered or looked at.
> Treat file:line references as a starting point to verify, not as established fact.

## Workflow provenance

| Workflow | Agents | Tokens | Status |
|---|---|---|---|
| `cnc-3d-threejs-research` | 10 | 1,477,464 | complete |
| `threejs-best-tooling` | 6 | 564,271 | **incomplete — 2 of 6 agents died** |

The following agents never ran to completion:

- `verify:reference-implementations` — You've hit your weekly limit · resets Jul 28, 3am (Asia/Shanghai)
- `rank:best-tools` — You've hit your weekly limit · resets Jul 28, 3am (Asia/Shanghai)

So the r180 API verification below is real but **partial**: the reference-implementation
sweep and the final "best tool per job" ranking do not exist and would need re-running.

---

# Part 1 — Design proposal

## Summary

Today's CNC 3D pane (`src/ui/workspace/Cnc3DPane.tsx` + `src/ui/relief-viewer/relief-three-scene.ts`, 113 lines) renders exactly one thing: a smooth-displaced removal heightfield with a wire stock box, lit by one ambient + one directional light, rebuilt from scratch on every project edit. It shows no toolpath, no tool, no bed, no origin, no depth ramp, no scrubber sync, no live machine head, and it resets the operator's camera on every keystroke. The upgrade path is: (a) fix the renderer fundamentals that are cheap and immediately visible (DPR cap, IBL + tone mapping, complete disposal, vertical pocket walls); (b) make the scene persistent so it updates instead of rebuilding; (c) add true 3D toolpath rendering from data the repo already has — `ToolpathStep.z`/`plunge.fromZ/toZ`, `CncPath3dPass.points: Vec3[]`, and `MotionManifest.MotionPoint{x,y,z}` — drawn as fat `LineSegments2` colored by move kind and depth; (d) add the CAD furniture operators expect (cutter geometry from `CncTool`, bed + origin triad, ViewHelper gizmo, section clipping, hover readout, screenshot); (e) wire it to the two live signals that already exist but no 3D surface reads — `useUiStore.scrubberT` and `useLaserStore.liveCanvasRun`. Everything here is display-only and must stay display-only: none of it may block, gate, or refuse Frame or Start. Two things must be decided before any toolpath geometry is correct: the ADR-102 §2 import boundary (three is currently permitted only beneath `src/ui/relief-viewer/`), and the Z frame ambiguity in `mapToolpathToScene`, which today produces scene-frame XY (+Y down) mixed with machine-frame Z (+Z up) — a left-handed frame that will render mirrored or inverted the moment a 3D polyline is drawn in it. NOT VERIFIED: I ran no tests, built no bundle, and rendered nothing — every claim below is read from the current tree or from the supplied research map.

## Current gaps (16)

What the CNC 3D pane lacks today, relative to best-in-class CAM viewers.

1. No toolpath is rendered at all. The pane draws only `reliefSurfaceMesh(downsampleRemovalGrid(grid, 300))` (Cnc3DPane.tsx:137). Rapids, feeds, plunges, leads, ramps, tabs, helical entries and drill pecks are entirely invisible in 3D — the operator sees the result of the cut but never the motion that produced it.

2. The whole three.js scene is destroyed and rebuilt on every edit. The effect at Cnc3DPane.tsx:131-161 has deps `[grid, thickness]` and its cleanup calls `handleRef.current?.dispose()`. Because the `PerspectiveCamera` and `OrbitControls` are constructed inside `createReliefThreeScene` (relief-three-scene.ts:83-89), every project change snaps the operator's orbit back to the default 3/4 view. There is no update path — `ReliefSceneHandle` exposes only `dispose` and `resize`.

3. No device-pixel-ratio handling. `renderer.setPixelRatio` is called nowhere in src; three's default `_pixelRatio` is 1 and `setSize(width, height, false)` (relief-three-scene.ts:47) passes `updateStyle=false`. On any HiDPI display the 3D view is rendered at CSS-pixel resolution and upscaled — this is the single most visible quality defect.

4. `dispose()` leaks GPU resources. relief-three-scene.ts:104-110 disposes controls, `geometry`, `stockGeometry` and the renderer, but never the `MeshStandardMaterial`, the `LineBasicMaterial`, or the `EdgesGeometry` created inline at :72 — which is the geometry actually attached to the `LineSegments`. Because the pane rebuilds on every edit, these leak once per edit.

5. Lighting is a 2015-era default: one `AmbientLight(0xffffff, 0.55)` + one `DirectionalLight(1.1)` (relief-three-scene.ts:77-81). No environment map, no PMREM/IBL, no tone mapping, no `outputColorSpace` configuration, no shadows. A carved surface with no environment reflection and no contact shadow reads as flat plastic, not machined material.

6. Vertical walls render as one-cell ramps. `reliefSurfaceMesh` emits one vertex per cell centre with two triangles per quad (relief-surface-mesh.ts:28-35), and the scene calls `geometry.computeVertexNormals()` (relief-three-scene.ts:58). A 6 mm-deep pocket wall therefore becomes a single-cell chamfer with an averaged ~45° normal — the exact geometry a machinist most needs to read is the geometry that is most wrong.

7. The pane is disconnected from the preview scrubber. `useUiStore.scrubberT`, `previewPlaying`, `previewPlaybackSpeed` and the rAF playback loop in `use-preview-playback.ts` drive the 2D canvas only; `use-cnc-removal-grid.ts` builds a scrubbed grid but short-circuits with `if (!previewMode ...) return null`. Cnc3DPane instead calls `buildPreviewToolpath` itself with deps `[project, outputScope, collapsed]` and always simulates the whole job. The 3D and 2D previews are two independent simulations that can disagree.

8. No cutter is drawn. `activeCncTool` and the `CncTool` kind union (end-mill / ball-nose / engraving / v-bit, with `tipAngleDeg`) already drive `kernelForTool` for the removal stamp (tool-kernels.ts:44-61), but nothing renders the bit. There is no indication of what is cutting, where it is, or whether the tool is a ball nose or a V-bit.

9. No live machine state reaches 3D. `useLaserStore.liveCanvasRun` carries `reportedHead: MotionPoint{x,y,z}`, `route.confirmedRouteMm`, `lifecycle`, `reportedFeedMmPerMin`, `reportedSpindleRpm` and `plan.cncPassSpans` — and is consumed only by the 2D overlay (`use-canvas-motion-overlay.ts`). Cnc3DPane imports `useStore`/`useOutputScope` and never touches `useLaserStore`. During an actual cut, the 3D pane shows the design-time simulation, not the machine.

10. Removal-grid simulation is synchronous on the main thread. `useDesignRemovalGrid` (Cnc3DPane.tsx:89-119) runs `buildPreviewToolpath` + `computeRemovalGrid` inside a `useMemo`. `useDeferredValue` defers the render but does not move the work off the main thread; there is no worker and no incremental update. Stamp cost is roughly 2·L/mmPerCell × π·(r/mmPerCell)² kernel writes, i.e. cubic in 1/mmPerCell — raising fidelity makes typing janky.

11. No CAD furniture. There is no bed plane, no dual-density grid, no origin triad, no job bounding box, no view cube or standard views (top / front / right / iso), no section or clipping plane, no wireframe or x-ray mode, no hover coordinate/depth readout, no measurement, and no screenshot export. The only orientation cue is a grey wire box around the stock.

12. No depth or pass encoding on the surface. The material is a flat `SURFACE_COLOR = 0xb08050` (relief-three-scene.ts:23) with no depth ramp, no per-pass hue, and no cavity/AO term — while the 2D canvas overlay does ramp depth (`draw-cnc-removal.ts` SHALLOW_RGB [196,160,116] → DEEP_RGB [74,48,28]). 2D and 3D disagree, and the comment claiming the 3D tone 'matches the canvas depth map' is not pinned by `theme-sync.test.ts`, which pins only `--lf-accent` and `--lf-danger`.

13. Zero automated coverage of the 3D pane. There is no `Cnc3DPane.test.tsx`, no `Cnc3DPaneToggle.test.tsx`, and no `relief-three-scene.test.ts`. The two dialog tests only assert the jsdom no-WebGL fallback string, and everything after `new three.WebGLRenderer(...)` (relief-three-scene.ts:45-93 — geometry, the `geometry.scale(1,-1,1)` mirror, lights, camera, controls, render) is unreachable in jsdom and untested by anything.

14. Colors bypass the theme system. `SURFACE_COLOR`/`STOCK_EDGE_COLOR`/`BACKGROUND_COLOR` are numeric hex literals, which the ADR-047 ESLint rule does not catch (its selector matches string `Literal` values only). There is no 3D counterpart to `canvas-theme.ts`, so 3D appearance can drift from the 2D canvas with nothing failing.

15. The `resize` capability exists but is half-wired. `ReliefSceneHandle.resize` is implemented and Cnc3DPane's ResizeObserver calls it, but `Viewer3DDialogShell` types its retained handle as `{ dispose }` only (Viewer3DDialogShell.tsx:33) and never calls resize — so both 3D dialogs render at a fixed 720×480 buffer regardless of window size.

16. Bundle and chunking are unmanaged for growth. `vite.config.ts` has no `manualChunks` branch for three; it lands in a Rollup-auto dynamic chunk purely because the only import is a dynamic `import()`, with `chunkSizeWarningLimit: 750` and a comment stating the three chunk is ~704 KB minified and that a real code-split is a separate refactor. Adding `lines/`, `ViewHelper`, PMREM and any postprocessing grows that chunk against PROJECT.md's <1 MB compressed budget.

## Proposed features (20)

| # | Feature | Effort | Value |
|---|---|---|---|
| 1 | HiDPI-correct, IBL-lit, tone-mapped scene | S | high |
| 2 | Geometrically correct vertical walls | M | high |
| 3 | Persistent scene with incremental surface update | M | high |
| 4 | True 3D toolpath geometry from the prepared job | M | high |
| 5 | Fat-line toolpath colored by move kind | M | high |
| 6 | Depth and pass color ramps with a legend | M | high |
| 7 | Animated cutter with correct bit geometry | M | high |
| 8 | Scrubber-synced playback shared with the 2D preview | M | high |
| 9 | Live machine head during a job | M | high |
| 10 | Bed, stock block, origin triad and dual-density grid | S | medium |
| 11 | View gizmo and standard views | S | medium |
| 12 | Section view via a draggable clipping plane | M | medium |
| 13 | Hover readout and measurement | L | medium |
| 14 | Tool-mark and scallop realism | M | medium |
| 15 | Material appearance: volumetric wood grain with triplanar projection | M | medium |
| 16 | Wireframe / x-ray / surface-only display modes | S | medium |
| 17 | Screenshot export | S | medium |
| 18 | Off-thread removal-grid simulation | L | medium |
| 19 | Shadows and contact shadow | M | low |
| 20 | GPU heightfield stamping (speculative — do not schedule yet) | L | low |

### 1. HiDPI-correct, IBL-lit, tone-mapped scene

**Effort:** S · **Value:** high

Cap `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`; generate a `RoomEnvironment` through `PMREMGenerator` with a small blur sigma (~0.04) and assign it to `scene.environment` (leaving `scene.background` a flat CAD backdrop); set `renderer.toneMapping = NeutralToneMapping` (hue-preserving, unlike ACES, so operation color codes still match their swatches) with `scene.environmentIntensity` dialled down so line work stays readable. Also complete `dispose()` — the two materials and the inline `EdgesGeometry` are currently leaked.

**Data source.** None — pure renderer configuration in src/ui/relief-viewer/relief-three-scene.ts. RoomEnvironment verified present at node_modules/three/examples/jsm/environments/RoomEnvironment.js (r180, zero-arg constructor).

**three.js technique.** PMREMGenerator.fromScene(new RoomEnvironment(), 0.04) → scene.environment; NeutralToneMapping; setPixelRatio cap.

### 2. Geometrically correct vertical walls

**Effort:** M · **Value:** high

Replace the smooth-displaced grid with a stepped-cell mesh: each cell is a flat quad at its own height, plus an explicit vertical quad between horizontally-adjacent cells whose heights differ. Emit normals explicitly instead of `computeVertexNormals()`, and clamp the slope so a genuine height discontinuity produces a horizontal wall normal rather than an averaged ramp normal. This is the difference between a pocket that looks milled and one that looks melted.

**Data source.** New pure-core builder alongside src/core/relief/relief-surface-mesh.ts, consuming the same `Heightmap` shape (`RemovalGrid` is structurally a `Heightmap`), returning the existing `ReliefSurfaceMesh` typed-array contract plus a normals array.

**three.js technique.** Non-indexed BufferGeometry with explicit `normal` attribute; wall quads carry the min/max of the neighbour pair. Vertex count ~4-6× the plain displaced grid, so pair with the display downsample already in place.

### 3. Persistent scene with incremental surface update

**Effort:** M · **Value:** high

Extend the scene handle from `{dispose, resize}` to `{dispose, resize, updateSurface, updateToolpath, updateTool, setCamera, ...}` so a project edit swaps the geometry in place and re-renders instead of tearing down the renderer. Fixes the camera-reset-on-every-keystroke defect and removes the per-edit shader recompile + full buffer re-upload caused by constructing a new `WebGLRenderer` on the same reused canvas.

**Data source.** Refactor of src/ui/relief-viewer/relief-three-scene.ts and the effect at src/ui/workspace/Cnc3DPane.tsx:131-161. No new data.

**three.js technique.** Long-lived Scene/Camera/Renderer/OrbitControls; per-update `geometry.dispose()` + swap, or preallocated buffers with `addUpdateRange`/`needsUpdate`. Keep render-on-demand (`controls.addEventListener('change', render)`) — no rAF loop.

### 4. True 3D toolpath geometry from the prepared job

**Effort:** M · **Value:** high

Render the actual motion in 3D. `ToolpathStep` already carries Z on three carriers (`cut.z`, `travel.z`, `plunge.fromZ/toZ`), but `path3d` cut steps collapse their per-vertex Z to a first→last ZSpan at the toolpath boundary — which silently flattens leads, ramps, drill pecks and relief finishing. Add an optional `polyline3d?: ReadonlyArray<Vec3>` to the cut step, written only by the `path3d`/`arc`/`helix` branches of `toolpath-cnc.ts`, and a pure lift that turns any step list into typed 3D polylines. Additive, no G-code change.

**Data source.** src/core/job/toolpath-types.ts (`ToolpathStep`, `ZSpan`), src/core/job/toolpath-cnc.ts (the four `case` branches at :119-159 which already hold `CncPath3dPass.points: Vec3[]` and `CncHelicalContourPass`), src/core/geometry/vec3.ts.

**three.js technique.** None yet — this is pure core producing plain arrays, per ADR-102 §2 (geometry conversion stays a pure core function returning typed arrays).

### 5. Fat-line toolpath colored by move kind

**Effort:** M · **Value:** high

Draw the 3D polylines as `LineSegments2` with real thickness — one batched object per move kind, not per move. Kind palette follows LightBurn (the project's stated reference): red = traversal/rapid, drawn recessive (thinner, lower opacity, dashed, `renderOrder` below cuts); solid for cuts; a distinct hue for plunge/retract and for lead/ramp spans. A 'show traversal moves' toggle matching LightBurn's exact wording. Note OpenBuilds uses the opposite convention (red = G1 cut) — LightBurn wins here.

**Data source.** The 3D polylines from the previous feature, tagged by `ToolpathStep.kind` and `travel.motion` ('rapid' | 'feed', absent = rapid).

**three.js technique.** three/addons/lines/{LineSegments2,LineSegmentsGeometry,LineMaterial}.js — all verified present in the installed 0.180.0 tree. `worldUnits:false` for constant CSS-pixel width; `dashed` + `computeLineDistances()` for rapids; `resolution` is auto-updated by `LineSegments2.onBeforeRender` in r180 (do NOT set it manually — that advice is stale).

### 6. Depth and pass color ramps with a legend

**Effort:** M · **Value:** high

Two switchable per-vertex ramps on the toolpath: colour-by-Z (how deep is this move) and colour-by-pass (which depth pass cut this). Pass identity is the honest hard part — `cut.passIndex` is an index into the flat `CncGroup.passes` list that already includes tab splits, extra contours and finishing passes, so it is NOT a depth-pass ordinal; derive the depth ladder from the step's own Z instead, mirroring how `preview-overlays.tsx:182-193` infers pass boundaries from downward plunges. Same ramp applied to the machined surface so 2D and 3D agree.

**Data source.** `cut.z`/`plunge.toZ` per step; `src/core/cnc/depth-passes.ts` `zPassDepths` for the ladder; the 2D ramp endpoints in src/ui/workspace/draw-cnc-removal.ts for parity.

**three.js technique.** `LineSegmentsGeometry.setColors` (6 floats per segment: explicit start+end rgb) with `material.vertexColors = true`. Build colors through `THREE.Color` so ColorManagement does the sRGB→linear conversion — hand-authored 0..1 values from a CSS palette will render too bright.

### 7. Animated cutter with correct bit geometry

**Effort:** M · **Value:** high

Draw the real tool as a solid of revolution derived from the same `CncTool` record that drives the cut: flat end-mill, ball-nose (quarter-arc cap), V-bit (cone from `tipAngleDeg`), engraving. Semi-transparent orange (CAMotics' convention — an opaque tool hides exactly the cut you are inspecting) with a duller shank cylinder above the flute, positioned at the scrubbed or live head. Deriving the profile from the same record as `kernelForTool` is what stops the preview lying about the bit.

**Data source.** `activeCncTool(project)` and the `CncTool` union already consumed by src/core/sim/tool-kernels.ts:44-61 (`end-mill` / `engraving` / `ball-nose` / `v-bit` with `tipAngleDeg`, 60° fallback).

**three.js technique.** `THREE.LatheGeometry(profilePoints, 48)` + `MeshStandardMaterial({transparent:true, opacity:0.5})`. The profile array is one pure function per tool kind with an `assertNever` default arm.

### 8. Scrubber-synced playback shared with the 2D preview

**Effort:** M · **Value:** high

In Preview mode the 3D pane consumes the SAME scrubbed removal grid and the same `scrubberT` as the 2D canvas rather than running its own full-job simulation, so the two views can never disagree. Toolpath reveal is driven by `geometry.setDrawRange` against the arc-length position, not by geometry rebuild, so scrubbing and 1×/10×/40× playback are free. Outside Preview mode the pane keeps its live design-time simulation.

**Data source.** src/ui/state/ui-store.ts (`scrubberT`, `previewPlaying`, `previewPlaybackSpeed`), src/ui/workspace/use-cnc-removal-grid.ts (already quantizes to 120 scrub buckets), src/core/job/toolpath-slice.ts `sliceToolpath(toolpath, cut)` which cuts at an arc-length position in mm.

**three.js technique.** `BufferGeometry.setDrawRange(0, count)` with a precomputed move→vertex-offset table; geometry laid out in program order. Interpolate the tool inside the active move rather than snapping to move boundaries.

### 9. Live machine head during a job

**Effort:** M · **Value:** high

While a job is running, place the tool at `liveCanvasRun.reportedHead` and reveal the toolpath up to `route.confirmedRouteMm`, with the completed portion drawn in the burned-trail treatment and the remainder recessive — the 3D twin of the existing 2D live overlay. Gate feed/RPM readouts on `lifecycle === 'running'` exactly as `canvas-motion-badge.tsx:132-138` does (a held or finished run reports 0 and a stopped run's last sample is stale).

**Data source.** src/ui/state/laser-store.ts `state.liveCanvasRun`; src/ui/state/canvas-motion-plan.ts `LiveCanvasRun` (`reportedHead: MotionPoint`, `route`, `lifecycle`, `controllerState`, `reportedFeedMmPerMin`, `reportedSpindleRpm`, `plan.cncPassSpans`). `MotionManifest` blocks are already true 3D (`MotionPoint{x,y,z}`, `kind: 'travel'|'process'|'plunge'|'park'`, `routeStartMm`/`routeEndMm`).

**three.js technique.** `setDrawRange` on the confirmed range plus a second material for the completed trail; tool transform updated per status frame. Strictly display-only — informs, never gates.

### 10. Bed, stock block, origin triad and dual-density grid

**Effort:** S · **Value:** medium

The orientation vocabulary every CAD viewer has: a translucent bed plane (with `depthWrite:false` so paths below Z0 stay visible through it), a fine + coarse two-density grid so scale reads at every zoom level, coloured X/Y/Z axis lines at the WCS origin, the stock block as a proper translucent solid rather than only a wire box, and a job bounding box. All in one named Group with its own disposal so bed-size changes do not leak.

**Data source.** `project.device.bedWidth`/`bedHeight`, the stock origin/extents already computed at Cnc3DPane.tsx:94-99 via `toSceneCoords`, and `machine.safeZMm` for the clearance plane.

**three.js technique.** Two `GridHelper`s at different divisions and colours, or fat-line grids so major lines can be 2 px and minor 1 px; `AxesHelper`; `BoxGeometry` + `EdgesGeometry` for stock. An analytic derivative-based shader grid looks best but needs `clipping:true` + the clipping chunks to survive section views.

### 11. View gizmo and standard views

**Effort:** S · **Value:** medium

A corner orientation gizmo with click-to-snap, plus explicit Top / Front / Right / Isometric buttons and a Fit-to-stock action. This is the one commercial UI element with no open-source CNC equivalent and its absence is immediately felt.

**Data source.** Camera state only; stock bounds for Fit.

**three.js technique.** `three/addons/helpers/ViewHelper.js` — verified present in r180. Ctor `(camera, domElement)`; render AFTER the main render (it calls `clearDepth()` and manages its own viewport); `handleClick(event)` returns whether it consumed the click; `viewHelper.animating` must keep requesting frames under render-on-demand. Hardcoded to a 128 px bottom-right square — repositioning requires forking the file.

### 12. Section view via a draggable clipping plane

**Effort:** M · **Value:** medium

Slice the stock and toolpath on a draggable plane to answer 'is this pocket actually the right depth'. High diagnostic value specifically for CNC. Fat lines clip correctly for free because `LineMaterial` is constructed with `clipping: true` and includes the clipping-plane shader chunks — so the toolpath sections along with the part.

**Data source.** None — a plane driven by a UI slider, in world space.

**three.js technique.** `renderer.localClippingEnabled = true` + per-material `clippingPlanes`. Set `side: DoubleSide` on the stock so the cut face is not a hollow shell; a proper stencil cap is optional polish. Allocate the max plane count up front — changing the NUMBER of planes recompiles the shader and hitches.

### 13. Hover readout and measurement

**Effort:** L · **Value:** medium

Hovering the machined surface reports X / Y / Z (depth below stock top) at that point; hovering a toolpath segment reports its move kind, Z, and — if available — the G-code line it came from. A two-click measure mode reports XY distance and Z delta. The G-code cross-link is a genuine differentiator LightBurn does not have.

**Data source.** The removal grid for surface depth (`grid.depth` is row-major, `gridCellOfPoint` already exported from core/sim); `CncPassSpan {groupIndex, passIndex, firstRawLine, lastRawLine}` from `emitPreparedGcodeWithCncPassSpans` for the line link — noting spans are null for non-CNC, refused emissions and metadata-headed output.

**three.js technique.** Raycast against the surface mesh for depth. For toolpath picking at scale, GPU picking (encode segment index as a colour attribute, render 1 px scissored into a render target, `readRenderTargetPixels`) is O(1) in segment count where `Line2.raycast` is not — and note `LineSegments2.raycast` reads `material.resolution`, which is stale for one frame after a resize.

### 14. Tool-mark and scallop realism

**Effort:** M · **Value:** medium

Three cheap layers that make the surface read as machined: (1) let scallops emerge naturally by simulating below the stepover; (2) a cavity/AO term computed from neighbour height differences — jscut's trick of darkening where the local gradient is steep costs two texture fetches and gets most of the benefit of a real AO pass; (3) an optional cusp-height overlay colour-mapping residual scallop height so the operator can see where the finish will be rough. Gate (3) on simulation resolution being finer than the stepover, and say so — otherwise it is measuring aliasing, not scallops.

**Data source.** The removal grid depth field; ball-nose cusp height h ≈ s²/(8R) for the overlay's expected value.

**three.js technique.** Neighbour-sampled normals + a gradient-driven darkening term injected into `MeshStandardMaterial` via `onBeforeCompile` (keeps all of three's lighting/shadow/tone-mapping chunks working). Avoid `dFdx`/`dFdy` on world position — screen-space derivatives blur across the wall and reintroduce the ramp artifact.

### 15. Material appearance: volumetric wood grain with triplanar projection

**Effort:** M · **Value:** medium

A single top-down wood texture on a heightfield is the giveaway that it is fake — pocket walls get smeared streaks instead of end grain. Generate grain procedurally as a function of stock-space position so the grain exists in the volume and cutting reveals a genuine cross-section; blend three planar samples weighted by the surface normal so vertical walls get end grain automatically. Roughness varies with the cavity term so cusp valleys look duller.

**Data source.** Stock-space position only; stock thickness from `stockThicknessMm(project)`. Colour endpoints should be pinned to the 2D ramp in src/ui/workspace/draw-cnc-removal.ts so 2D and 3D cannot drift.

**three.js technique.** `MeshStandardMaterial` + `onBeforeCompile` injecting a triplanar sampler into the `map_fragment` chunk; 3D value noise in GLSL (no texture — a 300 mm board at 0.05 mm detail would need an absurd bitmap). Chunk names can change between three releases, so pin the version and re-check after upgrades.

### 16. Wireframe / x-ray / surface-only display modes

**Effort:** S · **Value:** medium

Toggle between shaded surface, shaded + toolpath overlay, toolpath-only (surface hidden), and x-ray (surface at low opacity so buried motion is visible). Carbide Create overlays toolpath lines on the shaded simulation; this is the same idea with an explicit control.

**Data source.** None — visibility and material state.

**three.js technique.** `object.visible` flips plus a transparent/`depthWrite:false` material variant. Cheap; the only care needed is transparency draw order against the clipping planes.

### 17. Screenshot export

**Effort:** S · **Value:** medium

Export the current 3D view as a PNG at a chosen multiplier — for documentation, forum posts, and 'here is what I am about to cut' sanity checks. Optionally render one high-quality frame first (progressive/accumulated AA) so the export is cleaner than the interactive view.

**Data source.** The renderer's canvas.

**three.js technique.** Render at an increased size, `canvas.toBlob()`, restore. For the high-quality frame, `SSAARenderPass` at `sampleLevel: 4` (16 full scene renders in one frame — unusable interactively, ideal for a one-shot export).

### 18. Off-thread removal-grid simulation

**Effort:** L · **Value:** medium

Move `buildPreviewToolpath` + `computeRemovalGrid` off the main thread so raising fidelity does not make typing janky. Worker owns the `Float32Array`; post it back with a transfer list (zero-copy) and upload only the dirty sub-rectangle to the GPU texture rather than the whole field. NOT VIABLE TODAY as SharedArrayBuffer: I verified vite.config.ts sets no COOP/COEP headers, so SAB is unavailable — use transferable ArrayBuffer ping-pong.

**Data source.** src/core/sim (`computeRemovalGrid`, `kernelForTool`, `RemovalGrid`) is already pure and worker-safe; the pane's `useDesignRemovalGrid` becomes an async hook. Precedent exists in the tree — ADR-243/244 already shipped an off-thread preview worker for rasters.

**three.js technique.** `THREE.DataTexture(arr, w, h, RedFormat, FloatType)` or `renderer.copyTextureToTexture` for partial dirty-rect uploads. A full 1200×1200 Float32 upload is 5.8 MB per frame and will stall; a 64×64 dirty rect is 16 KB.

### 19. Shadows and contact shadow

**Effort:** M · **Value:** low

One shadow-casting directional light with its orthographic frustum tightly fitted to the work envelope (a 2048² map over a 1500 mm bed is ~0.7 mm/texel, which is fine; the same map over a default 1000-unit frustum is mush), plus a contact shadow under the part. A shadow of the tool on the stock is a real depth cue, not decoration.

**Data source.** Stock/bed bounds for the shadow frustum.

**three.js technique.** `PCFSoftShadowMap`, `shadow.normalBias` (usually the better knob than `bias` for thin plates). Because the scene is mostly static, set `renderer.shadowMap.autoUpdate = false` and flip `needsUpdate` only when geometry changes — this makes shadows nearly free under render-on-demand.

### 20. GPU heightfield stamping (speculative — do not schedule yet)

**Effort:** L · **Value:** low

SPECULATIVE. Replace CPU kernel stamping with jscut's technique: render each move as an instanced impostor into a top-down orthographic depth buffer, where the depth test itself performs the min-reduction and the resulting depth buffer IS the machined heightmap. O(moves) GPU work independent of stock resolution, and scrubbing becomes a single uniform. I have NOT prototyped this in this repo and cannot vouch for the browser/GPU support matrix here. It also conflicts with ADR-102 §2's 'geometry conversion stays a pure core function' principle, since the simulation would move onto the GPU and out of the testable core — that is a maintainer decision, not mine.

**Data source.** Would consume the same 3D polylines; would REPLACE src/core/sim/stamp-toolpath.ts as the display path while that stays the CPU reference implementation for tests.

**three.js technique.** InstancedBufferGeometry of capsule impostors writing `gl_FragDepth`, rendered into a `WebGLRenderTarget` with a `DepthTexture`. Note: `MinEquation` blending into a `FloatType` colour target needs `EXT_float_blend`, which three does NOT auto-request — the depth-buffer path avoids that entire class of bug.

## Staged plan (17 stages)

Each stage is intended to be one independently reviewable diff with one intent,
per the tight-leash rule in `CLAUDE.md`.

### Stage 0 — ADR-257: CNC 3D viewport upgrade — scope, import boundary, and non-guard status

**Intent.** Record the architectural decision before any code: amend ADR-102 §2 to permit three.js beneath a new `src/ui/cnc-viewer3d/` folder (or explicitly keep everything under `src/ui/relief-viewer/`), restate that the whole viewport is display-only and may never gate Frame or Start, add the PROJECT.md phase row this work currently has no slot for, and add the WORKFLOW.md flows (next free id is F-CNC46) with their success/error/empty/edge states.

**Touched files**

- `DECISIONS.md`
- `PROJECT.md`
- `WORKFLOW.md`
- `RESEARCH_LOG.md`

**Tests**

- None — docs only. `pnpm format:check` must pass; DECISIONS.md has mixed EOL historically, so edit via PowerShell .NET, not sed/Edit.

### Stage 1 — Render quality: DPR cap, IBL environment, tone mapping, complete disposal

**Intent.** Make the existing 3D view visibly sharper and better lit without changing what it draws — cap pixel ratio at 2, light the surface with a PMREM-prefiltered RoomEnvironment, tone-map with NeutralToneMapping, move the numeric colour constants into a theme module beside canvas-theme.ts, and dispose the two materials and the EdgesGeometry that currently leak on every rebuild.

**New files**

- `src/ui/theme/viewer3d-theme.ts`

**Touched files**

- `src/ui/relief-viewer/relief-three-scene.ts`

**Tests**

- No jsdom-reachable seam — all of this runs after `new WebGLRenderer`, which throws in jsdom. Verify perceptually in a fresh dev server on a HiDPI display and state plainly that automated tests prove nothing here.
- Existing Relief3DViewerDialog.test.tsx / Cut3DPreviewDialog.test.tsx must still reach the 'no WebGL' fallback (the failure path must not change shape).

### Stage 2 — Stepped-wall surface mesh so pocket walls render vertical

**Intent.** Add a pure-core mesh builder that emits flat per-cell quads plus explicit vertical wall quads with authored normals, so a depth-pass wall stops rendering as a one-cell 45° ramp; core/relief/index.ts is currently at 17 exports against the hard cap of 20, so this consumes one of the remaining slots.

**New files**

- `src/core/relief/stepped-surface-mesh.ts`
- `src/core/relief/stepped-surface-mesh.test.ts`

**Touched files**

- `src/core/relief/index.ts`
- `src/ui/workspace/Cnc3DPane.tsx`
- `src/ui/relief-viewer/relief-three-scene.ts`

**Tests**

- stepped-surface-mesh.test.ts: analytic heightmaps (flat field → no wall quads; one-step field → exactly one wall quad row with correct height pair; single-row degenerate → zero indices), index-range validity, and explicit normal correctness (top faces +Z, wall faces horizontal).
- Property test: total vertex/index counts match the closed-form for a W×H map.

### Stage 3 — Extract the scene into src/ui/cnc-viewer3d/ with a persistent handle (pure refactor)

**Intent.** Move the three.js scene out of relief-three-scene.ts into a dedicated viewer3d module split by responsibility (scene lifecycle / lighting / camera), with relief-three-scene.ts left as a thin delegate so the two dialogs are untouched behaviourally — flagged as a pure refactor with no behaviour change, per the tidy-first rule.

**New files**

- `src/ui/cnc-viewer3d/viewer3d-types.ts`
- `src/ui/cnc-viewer3d/viewer3d-scene.ts`
- `src/ui/cnc-viewer3d/viewer3d-lighting.ts`
- `src/ui/cnc-viewer3d/viewer3d-camera.ts`
- `src/ui/cnc-viewer3d/index.ts`

**Touched files**

- `src/ui/relief-viewer/relief-three-scene.ts`
- `src/ui/relief-viewer/Cut3DPreviewDialog.tsx`
- `src/ui/relief-viewer/Relief3DViewerDialog.tsx`
- `src/ui/workspace/Cnc3DPane.tsx`

**Tests**

- No new behaviour to test in jsdom; the two existing dialog fallback tests are the regression guard and must stay green.
- Add a pure unit test for the camera-fit maths (orbit radius / target from stock bounds) since that function takes plain numbers and needs no WebGL.

### Stage 4 — Incremental surface update so the camera stops resetting on every edit

**Intent.** Add `updateSurface(mesh)` to the scene handle and change Cnc3DPane's effect so a grid change swaps geometry in place instead of destroying and rebuilding the renderer, which is what currently resets the operator's orbit and forces a shader recompile on every keystroke.

**New files**

- `src/ui/cnc-viewer3d/viewer3d-surface.ts`

**Touched files**

- `src/ui/cnc-viewer3d/viewer3d-scene.ts`
- `src/ui/cnc-viewer3d/viewer3d-types.ts`
- `src/ui/workspace/Cnc3DPane.tsx`

**Tests**

- No jsdom seam. Perceptual check: orbit the pane, edit a shape, confirm the camera does not snap back.
- Manual leak check: rebuild the surface N times and confirm renderer/program count is stable (browser devtools, stated as manual).

### Stage 5 — Split Cnc3DPane.tsx to make room (pure refactor)

**Intent.** Cnc3DPane.tsx is at 248 raw lines against a 250-line React component cap, so extract the inner PaneScene component and the removal-grid hook into their own files before any feature lands in that file — no behaviour change.

**New files**

- `src/ui/workspace/Cnc3DPaneScene.tsx`
- `src/ui/workspace/use-cnc-design-grid.ts`
- `src/ui/workspace/use-cnc-design-grid.test.ts`

**Touched files**

- `src/ui/workspace/Cnc3DPane.tsx`
- `src/ui/workspace/index.ts`

**Tests**

- use-cnc-design-grid.test.ts: the grid-spec derivation (cell size from stock extents and PANE_TARGET_CELLS_PER_AXIS, collapsed → null, non-CNC machine → null) is plain arithmetic and testable without WebGL.
- No test for the scene component itself — jsdom has no WebGL; note the '3D view unavailable in this browser.' string differs from the dialog shell's, so a copied test would not match.

### Stage 6 — Core: preserve per-vertex Z on 3D CNC cut steps

**Intent.** Add an optional `polyline3d?: ReadonlyArray<Vec3>` to the cut step, written only by the path3d/arc/helix branches of toolpath-cnc.ts, plus a pure lift that turns a step list into typed 3D polylines — so leads, ramps, drill pecks and helical entries stop being flattened at the toolpath boundary.

**New files**

- `src/core/job/toolpath-3d.ts`
- `src/core/job/toolpath-3d.test.ts`

**Touched files**

- `src/core/job/toolpath-types.ts`
- `src/core/job/toolpath-cnc.ts`
- `src/core/job/index.ts`

**Tests**

- toolpath-3d.test.ts: a path3d pass (lead/ramp/drill peck) round-trips its intermediate vertex Z instead of collapsing to a first→last span; a flat contour pass yields a constant-Z polyline; a plunge yields a vertical two-point polyline; an arc yields sampled points whose count matches ARC_CHORD_TOLERANCE_MM behaviour.
- Invariant test: the sum of emitted 3D polyline lengths must NOT be used as the scrubber length — assert that `step.length` is carried through verbatim for arc and helix steps, where the true arc length deliberately differs from the polyline chord sum.
- Existing G-code snapshot tests must be byte-identical (this is additive metadata only).

### Stage 7 — Resolve the scene-frame Z convention and map toolpaths in 3D

**Intent.** MapToolpathToScene currently maps XY into scene space (+Y down) while leaving Z in machine space (+Z up) — a left-handed mix that will render any 3D polyline mirrored or inverted — so decide and document the convention with the maintainer and encode it in one place before drawing a single 3D line.

**Touched files**

- `src/ui/workspace/preview-scene-frame.ts`
- `src/ui/workspace/preview-scene-frame.test.ts`

**Tests**

- preview-scene-frame.test.ts: extend the existing coverage to assert the Z convention explicitly for cut/travel/plunge, and re-assert the existing `expect(scene.totalLength).toBe(45)` invariant (both transforms are isometries, so lengths must still pass through untouched).
- Add a handedness assertion so a future change cannot silently reintroduce a left-handed frame.

### Stage 8 — Fat-line toolpath rendering colored by move kind

**Intent.** Draw the 3D polylines as batched LineSegments2 with real thickness, one object per move kind, following LightBurn's convention that red means traversal — the single change that turns the pane from a result view into a toolpath view.

**New files**

- `src/ui/cnc-viewer3d/viewer3d-toolpath.ts`
- `src/ui/cnc-viewer3d/viewer3d-toolpath-colors.ts`

**Touched files**

- `src/ui/cnc-viewer3d/viewer3d-scene.ts`
- `src/ui/cnc-viewer3d/viewer3d-types.ts`
- `src/ui/cnc-viewer3d/index.ts`
- `src/ui/workspace/Cnc3DPaneScene.tsx`
- `src/ui/theme/viewer3d-theme.ts`

**Tests**

- viewer3d-toolpath-colors is a pure kind→colour table with an assertNever default arm and IS unit-testable in jsdom (it imports no three).
- The geometry builder itself is not jsdom-testable. Perceptual check against a known job: a rectangular pocket with a lead-in should show red rapids above the stock, a plunge line, and a closed cut loop at depth.

### Stage 9 — Depth and pass colour ramps with a legend

**Intent.** Add switchable colour-by-depth and colour-by-pass ramps on the toolpath and the machined surface, with the band derivation living in pure core so it is testable, and the ramp endpoints pinned to the 2D depth ramp so the two previews agree.

**New files**

- `src/core/job/toolpath-depth-bands.ts`
- `src/core/job/toolpath-depth-bands.test.ts`
- `src/ui/cnc-viewer3d/Viewer3DLegend.tsx`

**Touched files**

- `src/ui/cnc-viewer3d/viewer3d-toolpath.ts`
- `src/ui/cnc-viewer3d/viewer3d-toolpath-colors.ts`
- `src/core/job/index.ts`
- `src/ui/theme/viewer3d-theme.ts`

**Tests**

- toolpath-depth-bands.test.ts: banding derived from step Z (NOT from `cut.passIndex`, which indexes the flat pass list including tab splits and finishing passes and cannot yield a depth ordinal); assert a tabbed job's tab-top pass lands in the correct band; assert a laser step with no Z is excluded rather than treated as depth 0.
- Colour-ramp endpoints pinned against the 2D ramp so 2D and 3D cannot drift (extend the theme-sync test pattern).

### Stage 10 — Animated cutter with correct bit geometry

**Intent.** Derive the cutter's revolution profile from the same CncTool record that drives the removal kernel and render it as a semi-transparent LatheGeometry with a duller shank, so the operator can see whether a ball nose or a V-bit is doing the cutting.

**New files**

- `src/core/sim/tool-profile.ts`
- `src/core/sim/tool-profile.test.ts`
- `src/ui/cnc-viewer3d/viewer3d-tool.ts`

**Touched files**

- `src/core/sim/index.ts`
- `src/ui/cnc-viewer3d/viewer3d-scene.ts`
- `src/ui/cnc-viewer3d/index.ts`

**Tests**

- tool-profile.test.ts: the lathe profile for each `CncTool` kind is a pure array of 2D points — assert flat end-mill is a rectangle silhouette, ball-nose's cap matches R − sqrt(R² − r²) within tolerance, v-bit's slope matches d / tan(θ/2) with the 60° fallback and the `Math.max(1, tipAngleDeg)` guard, and that the default arm is assertNever.
- Cross-check property: the profile's radial offset function must agree with `kernelForTool`'s dz for the same tool, so the drawn tool cannot lie about the simulated one.

### Stage 11 — Scrubber sync: share the preview grid and reveal the toolpath by draw range

**Intent.** In Preview mode the 3D pane consumes the same scrubbed grid and the same `scrubberT` as the 2D canvas instead of running an independent full-job simulation, and reveals the toolpath with `setDrawRange` so scrubbing and 1×/10×/40× playback cost nothing.

**New files**

- `src/ui/workspace/use-cnc-3d-source.ts`
- `src/ui/workspace/use-cnc-3d-source.test.ts`

**Touched files**

- `src/ui/workspace/Cnc3DPane.tsx`
- `src/ui/workspace/Cnc3DPaneScene.tsx`
- `src/ui/cnc-viewer3d/viewer3d-toolpath.ts`
- `src/ui/cnc-viewer3d/viewer3d-types.ts`

**Tests**

- use-cnc-3d-source.test.ts: the source-selection function is a discriminated union over (previewMode, liveRun, design) with an assertNever default arm and is fully testable — assert preview mode selects the scrubbed preview grid, design mode selects the pane's own grid, and collapsed selects nothing (no recompute while collapsed, per ADR-223).
- Arc-length reveal: assert the move→vertex-offset table is monotonic and that the mm position maps through `sliceToolpath`'s arc-length contract, not a 0..1 fraction.

### Stage 12 — Bed, stock block, origin triad, dual-density grid and view gizmo

**Intent.** Add the orientation vocabulary — translucent bed with depthWrite off, fine+coarse grid, coloured origin triad, solid translucent stock, job bounding box — plus a ViewHelper corner gizmo and Top/Front/Right/Iso/Fit presets, all in one disposable Group.

**New files**

- `src/ui/cnc-viewer3d/viewer3d-stage.ts`
- `src/ui/cnc-viewer3d/viewer3d-view-gizmo.ts`

**Touched files**

- `src/ui/cnc-viewer3d/viewer3d-scene.ts`
- `src/ui/cnc-viewer3d/viewer3d-camera.ts`
- `src/ui/cnc-viewer3d/index.ts`
- `src/ui/theme/viewer3d-theme.ts`

**Tests**

- Camera-preset maths (top / front / right / iso positions and fit radius from stock bounds) is pure and testable.
- The stage geometry itself is not jsdom-testable; perceptual check only. ViewHelper must be rendered after the main render and its `animating` flag must keep requesting frames under render-on-demand — verify by orbiting after a gizmo click.

### Stage 13 — Section clipping plane and display modes

**Intent.** Add a draggable section plane plus shaded / shaded+toolpath / toolpath-only / x-ray display modes behind a small toolbar, allocating the clipping-plane array at its maximum size up front so changing the plane count never triggers a shader recompile mid-interaction.

**New files**

- `src/ui/cnc-viewer3d/viewer3d-clipping.ts`
- `src/ui/cnc-viewer3d/Viewer3DToolbar.tsx`

**Touched files**

- `src/ui/cnc-viewer3d/viewer3d-scene.ts`
- `src/ui/cnc-viewer3d/viewer3d-types.ts`
- `src/ui/cnc-viewer3d/index.ts`
- `src/ui/workspace/Cnc3DPaneScene.tsx`

**Tests**

- Toolbar is a plain presentational component and IS testable in jsdom (render, assert aria-pressed on each toggle, assert callbacks fire) — model the display mode as a discriminated union, not booleans.
- Plane-position maths is pure and testable. The visual result is not.

### Stage 14 — Hover readout and measurement

**Intent.** Report X/Y/Z depth under the cursor on the machined surface and the move kind plus source G-code line on a hovered toolpath segment, with the depth lookup living in pure core and the pick itself in the viewer.

**New files**

- `src/ui/cnc-viewer3d/viewer3d-picking.ts`
- `src/ui/cnc-viewer3d/Viewer3DReadout.tsx`
- `src/core/sim/removal-grid-probe.ts`
- `src/core/sim/removal-grid-probe.test.ts`

**Touched files**

- `src/ui/cnc-viewer3d/viewer3d-scene.ts`
- `src/ui/cnc-viewer3d/index.ts`
- `src/core/sim/index.ts`

**Tests**

- removal-grid-probe.test.ts: depth-at-point over a synthetic grid, including out-of-bounds (returns a 'outside' union arm, not a throw — core returns Result, never throws for control flow) and the untouched-stock case (depth 0).
- Viewer3DReadout is presentational and jsdom-testable; add a visually-hidden data-attribute probe span mirroring the `canvas-motion-probe` pattern so the values are machine-readable for e2e.

### Stage 15 — Live machine head in 3D during a job

**Intent.** Place the cutter at `liveCanvasRun.reportedHead` and reveal the toolpath to `route.confirmedRouteMm` while a job runs, as the 3D twin of the existing 2D live overlay — display-only, informing and never gating.

**New files**

- `src/ui/cnc-viewer3d/viewer3d-live-run.ts`

**Touched files**

- `src/ui/workspace/use-cnc-3d-source.ts`
- `src/ui/workspace/Cnc3DPaneScene.tsx`
- `src/ui/cnc-viewer3d/viewer3d-toolpath.ts`
- `src/ui/cnc-viewer3d/viewer3d-tool.ts`

**Tests**

- The mapping from `LiveCanvasRun` to a viewer state (tool transform + confirmed reveal length + whether feed/RPM are meaningful) is pure and testable — assert feed and RPM are suppressed unless `lifecycle === 'running'`, matching canvas-motion-badge.tsx:132-138, and that pass position is omitted rather than guessed when `cncPassSpans` is undefined.
- NOT hardware-verified — mock-only. State that plainly.

### Stage 16 — Screenshot export and scallop/cavity shading

**Intent.** Add PNG export at a chosen multiplier and a neighbour-gradient cavity/darkening term injected into the surface material via onBeforeCompile, which buys most of the perceived benefit of a real AO pass for two extra texture fetches.

**New files**

- `src/ui/cnc-viewer3d/viewer3d-screenshot.ts`
- `src/ui/cnc-viewer3d/viewer3d-surface-shading.ts`

**Touched files**

- `src/ui/cnc-viewer3d/viewer3d-surface.ts`
- `src/ui/cnc-viewer3d/Viewer3DToolbar.tsx`
- `src/ui/cnc-viewer3d/index.ts`

**Tests**

- The export filename/scale derivation is pure and testable; the render itself is not.
- Perceptual check only for the shading: render a known ball-nose scallop field at a known stepover and confirm the cusps read; state that the cusp overlay is meaningless when the sim cell size exceeds the stepover.

## Risks (12)

1. ADR-102 §2 currently permits three.js only beneath `src/ui/relief-viewer/`, and the rule is documentation-and-review enforced, not lint-enforced (eslint.config.mjs contains no rule mentioning 'three'). Every new viewer module in this plan violates the letter of that ADR until it is amended. Note the tree is already borderline: Cnc3DPane.tsx deep-imports `../relief-viewer/relief-three-scene`, past that folder's barrel, which CLAUDE.md's 'cross-module imports go through index.ts' arguably forbids while eslint-plugin-boundaries does not flag it (both are type 'ui').

2. Bundle budget. PROJECT.md sets a <1 MB compressed web bundle target with every dependency charged against it; vite.config.ts documents the three chunk at ~704 KB minified and raised chunkSizeWarningLimit to 750 explicitly to accommodate it. Adding lines/, ViewHelper, PMREM/RoomEnvironment and any postprocessing grows that chunk. I did NOT build, so I have no measured before/after figure. ADR-102's own reversal trigger is 'bundle-size or supply-chain audit flags three.js → replace the viewer with a static isometric canvas projection'.

3. Version skew: three@^0.180.0 runtime against @types/three@^0.185.0 dev types — five minors apart. Nothing in the tree currently imports any addon except OrbitControls, so lines/, ViewHelper, PMREM and RoomEnvironment are all untested integrations under this Vite config and this type/runtime pairing. LineMaterial in particular gained and moved properties across that range.

4. Test blindness. In vitest, `src/__fixtures__/jsdom-canvas-setup.ts:113` forces getContext to return null for any webgl request, so `new WebGLRenderer` throws and EVERY line after relief-three-scene.ts:44 is unreachable. All new scene code will be outside automated coverage by construction. The mitigation is to push as much logic as possible into pure modules (camera maths, colour tables, tool profiles, depth banding, source selection) — but the visual result itself will only ever be verified by looking at it. Also note the trap at src/ui/app/App.mount.test.tsx:163-165, which stubs getContext unconditionally for every context id, so any future 3D test placed in that file would hand three a fake non-null context instead of failing cleanly.

5. Left-handed frame. `mapToolpathToScene` produces scene-frame XY (+Y down, ADR origin transform inverse) mixed with machine-frame Z (+Z up, 0 = stock top, negative into stock). That is not a problem in 2D, where Z is only ever read as a scalar, but it means any 3D polyline drawn in that frame is mirrored or inverted. Getting this wrong produces a preview that looks plausible and is wrong — precisely the failure mode CLAUDE.md rule 2 warns about.

6. Arc-length desync. On arc and helical-contour steps, `step.length` is the true arc/helix length and deliberately does NOT equal the chord sum of `step.polyline` (toolpath-cnc.ts:141, :147-157). Any 3D reveal or scrubber that re-derives length from the rendered geometry will drift from the 2D scrubber. Similarly, the very first retract of a CNC job emits no step at all (toolpath-cnc.ts:78-90) and contributes 0 to totalLength — a 3D view that draws it will show motion the scrubber does not account for.

7. `cut.passIndex` is a trap. It indexes the FLAT `CncGroup.passes` list, which already includes the depth ladder, tab splits, extra contours and finishing passes. Colouring 'by pass' from it will produce confident nonsense. Depth must be derived from Z.

8. Performance regression on integrated GPUs. The removal grid is already stamped synchronously on the main thread; stepped-wall meshes multiply vertex count 4-6×; fat lines cost 4 verts + 2 tris per segment; GTAO roughly doubles geometry cost. Without render-on-demand discipline (which the current scene has and must keep) and a DPR cap, this gets slower before it gets prettier. PROJECT.md's 60 fps on a 5,000-segment scene budget is the bar.

9. Guard-rule pressure. A richer 3D view surfaces more conditions (tool below stock bottom, path outside bed, no-go zone entry, unreachable Z). Every one of those must be a colour cue or a Job Review warning — never a block, never a refusal, never a disabled Start. Rendering a warning tint is fine; refusing to render, refusing to Frame, or gating Start on any of it violates CLAUDE.md rule 7 and PROJECT.md #21 outright.

10. CI mechanics that will bite: `src/core/cnc/index.ts` is ratcheted at 67 exports in scripts/index-export-baseline.json and may only shrink, so no new exports there; `src/core/relief/index.ts` is at 17 of a hard cap of 20; a new `src/ui/cnc-viewer3d/index.ts` is capped at 20; `pnpm format:check` runs prettier repo-wide and is NOT part of `pnpm lint`; DECISIONS.md has historically mixed EOL and sed/Edit flip CRLF→LF, so doc edits need PowerShell .NET.

11. SharedArrayBuffer is unavailable. I verified vite.config.ts sets no COOP/COEP headers, so the worker stage must use transferable ArrayBuffer ping-pong, not SAB — the Kiri:Moto zero-copy pattern does not apply here without a headers change.

12. Scope. This is a large, multi-week body of work against a maintainer whose stated norm is 'tight leash — small, individually-verified diffs'. The staged plan is written so each stage is independently shippable and reversible; the risk is treating it as one epic rather than 17 separate reviews.

## Open questions — maintainer decisions (9)

1. Where does three.js live? Amend ADR-102 §2 to permit a new `src/ui/cnc-viewer3d/` folder (my recommendation — 15+ new modules do not belong inside relief-viewer, whose responsibility is the relief dialog), or keep everything under `src/ui/relief-viewer/` and accept the naming mismatch? Related: does OrbitControls (and now ViewHelper, PMREM, lines/) count as a separate dependency under ADR-017/ADR-098 §2? ADR-102 records only the 'three' package and RESEARCH_LOG.md pins ^0.180.0.

2. What is Z in scene frame? `preview-scene-frame.ts` maps XY into scene space (+Y down) and passes Z through untouched in machine space (+Z up). Is that an intentional asymmetry or an unnoticed one? Nothing in the file's header comment addresses Z. This must be decided before stage 8 or every 3D toolpath will be drawn in a left-handed frame.

3. Which phase does this land in? PROJECT.md marks BOTH Phase F and Phase L as [In progress] with no single 'current phase' declaration, and no CNC-3D item appears in the backlog or in 'Future feature notes' — the CNC 3D items (H.2, H.11/G4, H.12) are all recorded as Built. PROJECT.md itself says work outside a phase requires a revision plus a DECISIONS.md entry.

4. Is a bigger three chunk acceptable? Concretely: what is the maximum compressed size you will accept for the lazily-loaded 3D chunk, given PROJECT.md's <1 MB total budget and ADR-102's reversal trigger? My recommendation is to defer all postprocessing (GTAO, bloom, outline) until that number exists and is measured.

5. Red means rapid or red means cut? LightBurn and CAMotics use red for traversal; OpenBuilds uses red for G1 cutting. LightBurn is this project's stated reference, so my recommendation is red = traversal with a 'show traversal moves' toggle in LightBurn's exact wording — confirm before the palette is pinned.

6. Should the pane keep its own design-time simulation? Today it computes an independent grid at 500 cells/axis with deps [project, outputScope, collapsed], while `use-cnc-removal-grid.ts` computes a separate scrubbed grid for the 2D preview only in Preview mode. My recommendation is: share the preview grid in Preview mode, keep the independent design-time grid outside it. Confirm you want the two views to be forced into agreement.

7. How do you want 3D verified? There is no golden-image, headless-GL, pixelmatch or screenshot-diff infrastructure in the tree, the perceptual harness (src/__fixtures__/perceptual/) is strictly 2D binary masks, and the one CNC-3D e2e test asserts only layout attributes and never checks that WebGL initialized. Do you want a screenshot-diff capability built (new dependency, ADR-017 evaluation), or is manual visual check in the dev browser the accepted bar — as ADR-102's own Verification section implies?

8. Does the removal simulation stay in pure core? ADR-102 §2 requires the heightmap→mesh conversion to stay a pure core function returning plain typed arrays. A GPU heightfield sim (the jscut technique) would move the simulation itself onto the GPU and out of the testable core. That is a genuine architectural trade — I am not proposing it, only flagging that the fidelity ceiling of the CPU stamper is real and the escape hatch has a cost you would be paying.

9. Does the 3D pane get a hardware air-cut before any of this is called done? ADR-103 records that every output-affecting feature lands CLAIMED until a 4040 air-cut. This work is display-only and emits nothing, so my reading is that it does not need one — confirm you agree, because if the 3D view is going to be trusted as a pre-cut check, its fidelity matters as much as the emitter's.

---

# Part 2 — Codebase map

Six read-only agents mapped the areas a 3D upgrade touches. Evidence is quoted as
`file:line` by the agent that made the claim.

## 2.1 Toolpath data model in src/core/job/ (+ CNC depth-pass expansion in src/core/cnc/ and the UI frame mapping in src/ui/workspace/)

### Findings

- **`Toolpath` is exactly two fields: an ordered step list plus a cumulative length. No metadata, no per-job header, no device reference.**
  - Evidence: src/core/job/toolpath-types.ts:56-59 `export type Toolpath = { readonly steps: ReadonlyArray<ToolpathStep>; readonly totalLength: number; };`
- **`ToolpathStep` is a 3-variant discriminated union on `kind`: 'travel' | 'cut' | 'plunge'. There are no other variants.**
  - Evidence: src/core/job/toolpath-types.ts:14-43 `export type ToolpathStep = | { readonly kind: 'travel'; ... } | { readonly kind: 'cut'; ... } | { readonly kind: 'plunge'; ... };`
- **travel variant fields: kind:'travel'; from: Vec2; to: Vec2; length: number; motion?: 'rapid'|'feed'; z?: ZSpan. `motion` absent means rapid.**
  - Evidence: src/core/job/toolpath-types.ts:15-24 `readonly kind: 'travel'; readonly from: Vec2; readonly to: Vec2; readonly length: number;` … `readonly motion?: TravelMotion; readonly z?: ZSpan;` with comment at :20 "Absent means legacy/unspecified travel and is treated as rapid."
- **cut variant fields: kind:'cut'; color: string; source?: RasterToolpathSource; polyline: ReadonlyArray<Vec2>; length: number; z?: ZSpan; groupId?: string; passIndex?: number.**
  - Evidence: src/core/job/toolpath-types.ts:25-34 `readonly kind: 'cut'; readonly color: string; readonly source?: RasterToolpathSource; readonly polyline: ReadonlyArray<Vec2>; readonly length: number; readonly z?: ZSpan; readonly groupId?: string; readonly passIndex?: number;`
- **plunge variant fields: kind:'plunge'; at: Vec2; fromZ: number; toZ: number; length: number. It has NO `z` ZSpan and NO `color`; length is |Δz| so the scrubber advances through it.**
  - Evidence: src/core/job/toolpath-types.ts:35-43 `// Vertical-only move at a fixed XY: a CNC plunge (toZ < fromZ) or retract (toZ > fromZ). length = |Δz| …` then `readonly kind: 'plunge'; readonly at: Vec2; readonly fromZ: number; readonly toZ: number; readonly length: number;`
- **`ZSpan` is `{ from, to }` (plain numbers) and `TravelMotion` is `'rapid' | 'feed'`.**
  - Evidence: src/core/job/toolpath-types.ts:11-12 `export type ZSpan = { readonly from: number; readonly to: number }; export type TravelMotion = 'rapid' | 'feed';`
- **`RasterToolpathSource` (the cut step's `source`) carries raster provenance only — no Z: kind:'raster'; objectId?: string; source?: string; passIndex: number; rowIndex: number; spanIndex: number; pixelStartX: number; pixelEndX: number.**
  - Evidence: src/core/job/toolpath-types.ts:45-54 `export type RasterToolpathSource = { readonly kind: 'raster'; readonly objectId?: string; readonly source?: string; readonly passIndex: number; readonly rowIndex: number; readonly spanIndex: number; readonly pixelStartX: number; readonly pixelEndX: number; };`
- **Vec2 is 2D only — `{ x, y }`. There is no Vec3 anywhere in ToolpathStep; 3D lives only in the Job-level CncPath3dPass.**
  - Evidence: src/core/scene/scene-object.ts:9 `export type Vec2 = { readonly x: number; readonly y: number };`; src/core/job/job.ts:135 `readonly points: ReadonlyArray<Vec3>;` (CncPath3dPass, Job level, not Toolpath level)
- **YES, steps carry Z. Three carriers: `cut.z` (ZSpan), `travel.z` (ZSpan), and `plunge.fromZ`/`plunge.toZ`. Units are millimetres, same as XY.**
  - Evidence: src/core/job/toolpath-types.ts:9-10 `// Z extent of a step (CNC, Phase H.2). Laser steps omit it; CNC steps carry it so the simulator can depth-shade and the scrubber can report head Z.`
- **Sign convention is Z-up with 0 = stock top and NEGATIVE = into the stock (ADR-098). Safe/retract heights are positive.**
  - Evidence: src/core/geometry/vec3.ts:1-3 `// Vec3 — a point in 3D machine space (mm). … Z follows the CNC convention from ADR-098: 0 = stock top, negative = into the stock.`; src/core/job/job.ts:127 `readonly zMm: number; // cutting depth for this pass; negative below stock top`; src/core/job/toolpath-cnc.ts:52 `const safeZ = Math.max(0, group.safeZMm);`
- **Laser steps (contour/fill/raster) omit Z entirely — `z` is undefined, not 0 — and consumers must default it. The removal-grid simulator treats a missing z as 0 and skips the step.**
  - Evidence: src/core/sim/stamp-toolpath.ts:81-83 `const zFrom = step.z?.from ?? 0; const zTo = step.z?.to ?? 0; if (zFrom >= 0 && zTo >= 0) return; // laser steps carry no depth`
- **Only CNC groups produce Z-bearing steps. `appendTravelStep` (used by every laser/fill/raster/contour path) never writes `z`; the single travel-with-z is the CNC safe-Z rapid.**
  - Evidence: src/core/job/toolpath-math.ts:35-41 pushes `{ kind: 'travel', from, to, length: dist(from, to), ...(motion === undefined ? {} : { motion }) }` — no z; src/core/job/toolpath-cnc.ts:59-65 `steps.push({ kind: 'travel', from: head, to: first, length: dist(head, first), z: { from: safeZ, to: safeZ } });`
- **Depth passes are NOT a per-step depth index. They are pre-expanded at compile time into separate `CncPass` entries on the Job, each carrying one absolute `zMm`. The toolpath just walks that flat list.**
  - Evidence: src/core/job/job.ts:113-118 `// CNC (router/mill) passes. Pre-expanded by core/cnc/compile-cnc-job.ts (depth ramping, tab splitting, pocket rings) so the emitter is a dumb, safe motion printer`
- **The depth ladder is computed by `zPassDepths(depthMm, depthPerPassMm)` — returns NEGATIVE Z levels ordered shallow→deep, with the final entry forced to exactly -depthMm.**
  - Evidence: src/core/cnc/depth-passes.ts:11-23 `export function zPassDepths(depthMm: number, depthPerPassMm: number): ReadonlyArray<number> { … out.push(-Math.min(depthMm, i * perPass)); } out[out.length - 1] = -depthMm;`
- **Two pass-ordering strategies exist. `contourMajorPasses` finishes each contour to full depth before the next (profiles/engrave); `depthMajorPasses` clears every ring at one depth before stepping down (pockets).**
  - Evidence: src/core/cnc/compile-cnc-job.ts:341-344 `// Complete each contour to full depth before moving to the next … function contourMajorPasses(`; src/core/cnc/compile-cnc-job.ts:411-413 `// Clear every ring at one depth before stepping down — pockets remove the floor level by level. function depthMajorPasses(`; dispatch at :247-256 `settings.cutType === 'pocket' ? depthMajorPasses(toolpaths, depths) : contourMajorPasses(…)`
- **The cut step's `passIndex` is the index into `CncGroup.passes` — a FLAT list that already includes the depth ladder, tab splits, extra contours and finishing passes. It is NOT a depth-pass ordinal and cannot be used to derive depth.**
  - Evidence: src/core/job/toolpath-cnc.ts:33-36 `for (let passIndex = 0; passIndex < group.passes.length; passIndex += 1) { const pass = group.passes[passIndex]; … head = appendPassSteps(steps, head, pass, passIndex, group, state);` — passed straight through to the cut step at :117
- **There is no target-depth field anywhere in the Toolpath. Total depth and step-down live on the scene-level layer settings and never reach the toolpath.**
  - Evidence: src/core/scene/machine.ts:130-133 `// Total cut depth below stock top (positive). … readonly depthMm: number; readonly depthPerPassMm: number; // max material removed per Z pass (positive)`
- **The UI infers pass boundaries heuristically from downward plunges, not from any pass field on the step.**
  - Evidence: src/ui/workspace/preview-overlays.tsx:180-190 `// CNC pass starts = downward plunges. … if (step.kind === 'plunge' && step.toZ < step.fromZ) { fractions.push(walked / toolpath.totalLength); }`
- **Arcs exist at the JOB level (CncArcPass, CncHelicalContourPass = native G2/G3), but the Toolpath is POLYLINE-ONLY. Arcs are flattened to sampled points when the cut step is built.**
  - Evidence: src/core/job/job.ts:139-159 defines `CncArcPass` (start/end/center/clockwise/zMm/closed) and `CncHelicalContourPass`; src/core/job/toolpath-cnc.ts:136-145 `case 'arc': return { kind: 'cut', … polyline: sampleCircularArcPoints(pass), length: circularArcLengthMm(pass), z: { from: pass.zMm, to: pass.zMm }, …`
- **GOTCHA for a 3D renderer: on arc and helical-contour cut steps, `step.length` is the TRUE arc/helix length, which does NOT equal the chord-sum of `step.polyline`. Re-deriving length from the polyline will desync the scrubber.**
  - Evidence: src/core/job/toolpath-cnc.ts:141 `length: circularArcLengthMm(pass),` and :147-157 `const helixLength = Math.hypot(Math.PI * 2 * radius * Math.max(1, Math.floor(pass.revolutions)), pass.zMm - pass.startZMm); … length: helixLength + dist(pass.start, first) + polylineLength(pass.polyline),`
- **Arc flattening tolerance is 0.05 mm chord deviation, with angular step clamped between 1° and 15° per segment.**
  - Evidence: src/core/geometry/arc-sampling.ts:9-11 `export const ARC_CHORD_TOLERANCE_MM = 0.05; const MIN_STEP_RAD = Math.PI / 180; … const MAX_STEP_RAD = Math.PI / 12;`
- **path3d cut steps also lose their per-vertex Z: the rendered polyline is the flat XY projection while `z` is collapsed to a first→last ZSpan. Intermediate vertex Z is discarded at the toolpath boundary.**
  - Evidence: src/core/job/toolpath-cnc.ts:119-135 `// The rendered polyline is the XY projection; the arc length is 3D … polyline: xy, length: path3dLength(pass.points), z: { from: pass.points[0]?.z ?? 0, to: pass.points[pass.points.length - 1]?.z ?? 0 },`
- **`sliceToolpath(toolpath, cut)` cuts the step list at an ARC-LENGTH position (mm), not a 0..1 fraction, returning `{ whole, partial, head }`. Callers multiply the scrubber fraction by totalLength themselves.**
  - Evidence: src/core/job/toolpath-slice.ts:9 `export function sliceToolpath(toolpath: Toolpath, cut: number): SlicedToolpath {` with :10 `if (cut >= toolpath.totalLength)`; src/ui/workspace/draw-preview.ts:129 `const sliced = sliceToolpath(toolpath, scrubberT * toolpath.totalLength);`
- **sliceToolpath truncates the boundary step per-variant: travel by XY lerp, plunge by interpolating toZ, cut by truncating the polyline at the residual length.**
  - Evidence: src/core/job/toolpath-slice.ts:31-48 `if (step.kind === 'travel') { const to = lerp(step.from, step.to, length / step.length); return { ...step, to, length }; } if (step.kind === 'plunge') { const t = length / step.length; return { ...step, toZ: step.fromZ + (step.toZ - step.fromZ) * t, length }; }`
- **`SlicedToolpath` is `{ whole: ReadonlyArray<ToolpathStep>; partial: ToolpathStep | null; head: Vec2 | null }` — the head is 2D only, no Z is reported.**
  - Evidence: src/core/job/toolpath-types.ts:80-84 `export type SlicedToolpath = { readonly whole: ReadonlyArray<ToolpathStep>; readonly partial: ToolpathStep | null; readonly head: Vec2 | null; };`
- **`totalLength` is DISTANCE IN MILLIMETRES, not time — the plain sum of every step's `length`. It mixes XY arc length (travel/cut), vertical |Δz| (plunge), 3D length (path3d) and true arc length (arc/helix) into one scalar.**
  - Evidence: src/core/job/toolpath.ts:53-54 `const totalLength = steps.reduce((sum, s) => sum + s.length, 0); return { steps, totalLength };`; src/core/job/toolpath-math.ts:7-11 `dist` = `Math.hypot(dx, dy)`; src/core/job/toolpath-types.ts:36-37 `length = |Δz|` for plunge
- **`summarizeToolpathDistances` splits that total into cutMm / travelMm / plungeMm / totalMm — all millimetres, confirming the unit.**
  - Evidence: src/core/job/toolpath.ts:167-177 `let cutMm = 0; let travelMm = 0; let plungeMm = 0; … return { cutMm, travelMm, plungeMm, totalMm: cutMm + travelMm + plungeMm };`; type at src/core/job/toolpath-types.ts:70-76
- **Feed rate, spindle RPM and laser power are ABSENT from every ToolpathStep. The only per-step appearance attribute is `color: string` on cut steps.**
  - Evidence: src/core/job/toolpath-types.ts:14-43 — the full union contains no feed/speed/power/rpm/S field; the cut variant's only descriptive field is :27 `readonly color: string;`
- **Those values live one level up on the Job groups: CncGroup carries feedMmPerMin, plungeMmPerMin, spindleRpm, spindleSpinupSec, toolDiameterMm, safeZMm; Cut/Fill/RasterGroup carry power (0..100 %) and speed (mm/min).**
  - Evidence: src/core/job/job.ts:210-221 `readonly toolDiameterMm: number; readonly feedMmPerMin: number; // already capped to device.maxFeed  readonly plungeMmPerMin: number; readonly spindleRpm: number; // S value; capped to machine spindleMaxRpm`; src/core/job/job.ts:40-41 `readonly power: number; // 0..100 (percent)` … `readonly speed: number; // mm/min`
- **The only step→group backlink is the optional `groupId` on CNC cut steps, and it holds the LAYER id, not a group array index. No production code reads it — the only writes are in toolpath-cnc.ts.**
  - Evidence: src/core/job/toolpath-cnc.ts:116 `groupId: group.layerId,` (same at :133, :143, :159); repo-wide grep for `groupId` in non-test src returns only those 4 write sites plus the type declaration at src/core/job/toolpath-types.ts:32
- **Because the Toolpath has no feeds, duration estimation runs off the Job (with its groups and the device profile), never off the Toolpath.**
  - Evidence: src/core/job/estimate-duration.ts:52-59 `export function estimateJobDuration(job: Job, device: DeviceProfile, options: JobDurationEstimateOptions = {}): JobDurationEstimate { const plannerJob = jobWithCncAsCutGroups(job); …`
- **`mapToolpathToScene(toolpath, jobOriginOffset, device)` does exactly two things per point: subtract the job-origin translation, then apply `toSceneCoords` (the inverse device origin transform). Result is SCENE space.**
  - Evidence: src/ui/workspace/preview-scene-frame.ts:23-28 `const mapPoint = (p: Vec2): Vec2 => toSceneCoords({ x: p.x - jobOriginOffset.x, y: p.y - jobOriginOffset.y }, device); return { steps: toolpath.steps.map((step) => mapStep(step, mapPoint)), totalLength: toolpath.totalLength };`
- **Scene space is the SVG/canvas convention: +X right, +Y DOWN, origin at the top-left of the bed — the frame the workspace canvas, design ghost and raster sim all draw in. Machine space (+Y away from operator) is what the Job/Toolpath is in before mapping.**
  - Evidence: src/core/devices/origin-transform.ts:5-6 `Scene convention (input):  +X right, +Y down  (matches SVG / canvas convention)` / `Machine convention (output): depends on origin (matches GRBL / LightBurn).`; src/ui/workspace/preview-scene-frame.ts:1-8 `The prepared job is in machine/work coordinates … The workspace canvas, the design ghost, and the raster sim all draw in SCENE space`
- **`toSceneCoords` is a real inverse (not a re-apply) because 'center' origin is a translation, not a mirror. Per-origin: front-left `y: bedH - p.y`; rear-left identity; front/rear-right also mirror X; center `{ x: p.x + bedW/2, y: bedH/2 - p.y }`.**
  - Evidence: src/core/devices/origin-transform.ts:25-30 `// Exact inverse of toMachineCoords. Most origin transforms are their own inverse (axis mirrors), but 'center' is not …` and :33-43 the switch body
- **The mapping touches XY ONLY. `z`, `fromZ`, `toZ`, `motion`, `source`, `groupId`, `passIndex` and `length` all pass through unchanged via object spread — so after mapping, XY is scene-frame while Z is still machine-frame (0 = stock top, negative into stock).**
  - Evidence: src/ui/workspace/preview-scene-frame.ts:31-39 `if (step.kind === 'travel') { return { ...step, from: mapPoint(step.from), to: mapPoint(step.to) }; } if (step.kind === 'plunge') { return { ...step, at: mapPoint(step.at) }; } return { ...step, polyline: step.polyline.map(mapPoint) };`
- **Both transforms are isometries, so step lengths and `totalLength` are deliberately copied verbatim — arc-length/scrubber math stays valid without recomputation.**
  - Evidence: src/ui/workspace/preview-scene-frame.ts:10-11 `Both are isometries, so step lengths and the scrubber's arc-length math stay valid untouched.`; test assertion src/ui/workspace/preview-scene-frame.test.ts:117 `expect(scene.totalLength).toBe(45);`
- **CNC step emission mirrors the emitter's motion contract exactly: retract-to-safe-Z (as a plunge step) → rapid travel at safe Z → plunge to pass depth → cut. Same-XY depth chaining skips the retract+travel pair, and head Z is one modal state threaded across ALL groups.**
  - Evidence: src/core/job/toolpath-cnc.ts:18-24 `// Head Z persists ACROSS CNC groups (the emitter tracks one modal Z for the whole job) … export type CncSimState = { zMm: number | null };`; :56-72 the alreadyAtStart / appendRetract / plunge sequence
- **An unknown initial Z is adopted as 'already at safe Z' WITHOUT emitting a step — so the very first retract of a job is invisible in the toolpath and contributes 0 to totalLength.**
  - Evidence: src/core/job/toolpath-cnc.ts:78-90 `// The emitter's preamble parks at safe Z from an unknown prior position; the simulator has no length for that move, so an unknown Z is adopted as "already at safe Z" without emitting a step.` then `if (state.zMm === null || head === null) { state.zMm = safeZ; return; }`
- **`buildToolpath(job, options)` is the sole entry point; options are startPoint, parkPoint, scanningOffsets, bedSizeMm. Group dispatch is a 4-way switch on group.kind: raster / fill / cut / cnc.**
  - Evidence: src/core/job/toolpath.ts:42-55 and :64-82 `switch (group.kind) { case 'raster': … case 'fill': … case 'cut': … case 'cnc': return appendCncGroupSteps(steps, prevEnd, group, cncState); }`; options type at src/core/job/toolpath-types.ts:61-68
- **The public barrel re-exports the types from toolpath-types.ts and the functions from toolpath.ts — `Toolpath`, `ToolpathStep`, `SlicedToolpath`, `ToolpathDistanceSummary`, `buildToolpath`, `sliceToolpath`, `summarizeToolpathDistances`. Note `ZSpan` and `TravelMotion` are NOT re-exported from the barrel.**
  - Evidence: src/core/job/index.ts:60-66 `export type { SlicedToolpath, Toolpath, ToolpathDistanceSummary, ToolpathStep } from './toolpath-types'; export { buildToolpath, sliceToolpath, summarizeToolpathDistances } from './toolpath';`
- **An existing 3D-capable consumer already exists: `computeRemovalGrid` stamps a tool kernel along cut/plunge steps using step.z, producing the depth field behind the CNC material-removal shading. It documents the linear-Z-by-arc-length approximation inside a cut step.**
  - Evidence: src/core/sim/stamp-toolpath.ts:13-16 `// Approximation (documented): a cut step carries one Z span across its whole polyline; Z interpolates linearly by arc length within the step. Contour passes are exact (flat Z); path3d steps are exact at vertices and linear between`

### Relevant files

- `src/core/job/toolpath-types.ts`
- `src/core/job/toolpath.ts`
- `src/core/job/toolpath-cnc.ts`
- `src/core/job/toolpath-slice.ts`
- `src/core/job/toolpath-math.ts`
- `src/core/job/toolpath-raster-steps.ts`
- `src/core/job/job.ts`
- `src/core/job/index.ts`
- `src/core/job/estimate-duration.ts`
- `src/core/job/motion-manifest.ts`
- `src/core/cnc/depth-passes.ts`
- `src/core/cnc/compile-cnc-job.ts`
- `src/core/cnc/compile-cnc-helpers.ts`
- `src/core/geometry/vec3.ts`
- `src/core/geometry/circular-arc.ts`
- `src/core/geometry/arc-sampling.ts`
- `src/core/devices/origin-transform.ts`
- `src/core/scene/scene-object.ts`
- `src/core/scene/machine.ts`
- `src/core/sim/stamp-toolpath.ts`
- `src/ui/workspace/preview-scene-frame.ts`
- `src/ui/workspace/draw-preview.ts`
- `src/ui/workspace/preview-overlays.tsx`
- `src/ui/workspace/use-preview-toolpath.ts`
- `src/core/job/toolpath-passes.test.ts`
- `src/ui/workspace/preview-scene-frame.test.ts`

### Could not verify

- I did not run pnpm test / typecheck / lint (read-only task). Every claim is from reading the current tree, not from execution.
- I did not verify anything perceptually — no toolpath was rendered or compared to a reference. The Z sign convention and arc-length claims are read from code and comments, not observed in a preview.
- UNVERIFIED: whether `mapToolpathToScene` leaving Z in machine convention is intentional or an unnoticed asymmetry. The file comment (preview-scene-frame.ts:1-11) only discusses XY; nothing states what Z should be in scene frame. For a 3D upgrade this is the ambiguity to resolve with the maintainer — the current output has scene-frame XY (+Y down) mixed with machine-frame Z (+Z up), which is a left-handed mix.
- UNVERIFIED: I found no production consumer of `cut.groupId` (grep over non-test src returns only the 4 write sites in toolpath-cnc.ts and the type declaration). I did not exhaustively check test fixtures or any code outside src/.
- UNVERIFIED: whether the alternate motion model (`MotionManifest` / `MotionBlock` in src/core/job/motion-manifest.ts, which DOES carry true 3D `MotionPoint {x,y,z}` per point and a `kind: 'travel'|'process'|'plunge'|'park'`) is intended to replace or coexist with `Toolpath` for 3D preview. It is a separate parallel type built from emitted G-code (buildMotionManifest), consumed by src/ui/workspace/draw-canvas-motion-route.ts — I did not trace how the two models are reconciled.
- I did not read every CNC pass producer (surfacing.ts, adaptive-pocket.ts, vcarve-ladder.ts, relief-roughing.ts, drill-peck.ts, helical-entry.ts, profile-lead-passes.ts). I verified the depth-ladder call sites via grep for zPassDepths but did not confirm each producer's Z sign individually.
- UNVERIFIED: the exact `passExitZMm` semantics for helical-contour when revolutions is fractional — toolpath-cnc.ts:149 floors it for the helix length but job.ts places no integer constraint on the field.

## 2.2 G-code emission + parse pipeline (Scene → Job → G-code text → parsed motion), with focus on CNC Z semantics and candidate 3D-view data sources

### Findings

- **`prepareOutput(project, options)` is the single Scene→Job entry point. Signature: `prepareOutput(project: Project, options: PrepareOutputOptions = {}): PreparedOutput`. `PrepareOutputOptions = { jobOrigin?: JobOriginPlacement; outputScope?: OutputScope }`.**
  - Evidence: src/io/gcode/prepare-output.ts:35-38 `export type PrepareOutputOptions = { readonly jobOrigin?: JobOriginPlacement; readonly outputScope?: OutputScope; };` and :53-56 `export function prepareOutput(project: Project, options: PrepareOutputOptions = {}): PreparedOutput {`
- **`PreparedOutput` is a discriminated union. A SUCCESS contains exactly three fields: `job: Job`, `project: Project` (the output-scoped project), and `jobOriginOffset: Vec2`. It contains NO G-code text and NO emitted lines — emission is a separate step.**
  - Evidence: src/io/gcode/prepare-output.ts:40-49 `export type PreparedOutput = | { readonly ok: true; readonly job: Job; readonly project: Project; readonly jobOriginOffset: Vec2; } | { readonly ok: false; readonly preflight: PreflightResult };`
- **The success path is: validate output scope → `runPreEmitPreflight` → `compileForMachine` → `applyJobOriginOffset` → `optimizePaths`. The returned `job` is the OPTIMIZED, origin-placed job — the same one Save/Start/Preview/Estimate all consume.**
  - Evidence: src/io/gcode/prepare-output.ts:89-94 `return { ok: true, project: outputProject, job: optimizePaths(placed, project.optimization, project.device.scanningOffsets), jobOriginOffset: offset, };`
- **Machine routing happens in `compileForMachine`: a CNC machine compiles via `compileCncJob(scene, device, machine)`, everything else via `compileJob(scene, device)`.**
  - Evidence: src/io/gcode/prepare-output.ts:105-110 `return machine !== undefined && machine.kind === 'cnc' ? compileCncJob(project.scene, project.device, machine) : compileJob(project.scene, project.device);`
- **`prepareOutputSnapshot(project, options): Promise<PreparedOutputSnapshot>` wraps `prepareOutput` and adds variable-text materialization + optional print-and-cut registration. `PreparedOutputSnapshot = PreparedOutput & { evaluationContext: VariableEvaluationContext }` — same `job` shape, plus the clock/recordIndex/serial context. It is memoized per (renderer, project, cache key).**
  - Evidence: src/io/gcode/prepare-output-snapshot.ts:36-38 `export type PreparedOutputSnapshot = PreparedOutput & { readonly evaluationContext: VariableEvaluationContext; };` and :90-91 `const prepared = prepareOutput(registeredProject, outputOptions(options)); return { ...prepared, evaluationContext };`
- **The final emitted artifact is ONE string, not an array. `EmitGcodeResult = { gcode: string; preflight: PreflightResult }`. The CNC emitter builds a `string[]` internally and joins with `\n` plus a trailing `\n`.**
  - Evidence: src/io/gcode/emit-gcode.ts:40-43 `export type EmitGcodeResult = { readonly gcode: string; readonly preflight: PreflightResult; };`; src/core/output/cnc-grbl-strategy.ts:145 `return lines.join(LINE_END) + LINE_END;` with :59 `const LINE_END = '\n';`
- **Files literally named `emit-*.ts` (non-test) are only four, and NONE of them is the CNC motion emitter: src/core/raster/emit-raster.ts (laser image/raster G-code), src/io/gcode/emit-gcode.ts (pipeline seam), src/io/gcode/emit-gcode-snapshot.ts (variable-text async wrapper), src/io/rd/emit-rd.ts (Ruida .rd byte stream, not G-code).**
  - Evidence: `find src -name "emit-*.ts" -not -name "*.test.ts"` → src/core/raster/emit-raster.ts, src/io/gcode/emit-gcode-snapshot.ts, src/io/gcode/emit-gcode.ts, src/io/rd/emit-rd.ts; src/io/rd/emit-rd.ts:1-2 `// emitRdFile — the Ruida twin of emitGcode`
- **The real CNC emitter is `src/core/output/cnc-grbl-strategy.ts` (`cncGrblStrategy`, id 'grbl-cnc'), split across cnc-grbl-emit-head.ts, cnc-grbl-transitions.ts, cnc-grbl-helical.ts, cnc-grbl-coolant.ts, cnc-grbl-job-groups.ts. Laser dialects live in grbl-strategy.ts / marlin-strategy.ts / smoothieware-strategy.ts.**
  - Evidence: src/core/output/cnc-grbl-strategy.ts:442 `export const cncGrblStrategy: OutputStrategy = { id: 'grbl-cnc', emit: emitJob };`; src/core/output/index.ts:7 `export { cncGrblStrategy, emitCncJobWithPassSpans } from './cnc-grbl-strategy';`
- **CNC preamble emits exactly `G21`, `G90`, `G54`, `G94`, then safe-Z retract + `M3 S<rpm>` + optional `G4 P<spinup>`, then optional `M7`/`M8` coolant. Postamble: retract to max safe Z, `M5`, optional `M9`, `G0 X<park> Y<park>`.**
  - Evidence: src/core/output/cnc-grbl-strategy.ts:106-130 `lines.push('G21'); lines.push('G90'); ... lines.push('G54'); lines.push('G94');` + `appendSpindleStart(...)` + `appendCoolantStart(...)`; :158-162 `appendRetract(lines, head, state.maxSafeZ); lines.push('M5'); if (coolantIsOn) lines.push('M9'); ... lines.push(\`G0 X${fmt(park.x)} Y${fmt(park.y)}\`);`
- **CNC motion words emitted are exactly: `G0 Z<safe>` (retract), `G0 X Y` (rapid at safe Z), `G1 Z<depth> F<plunge>` (plunge), `G1 X Y [F<feed>]` (2D cut), `G1 X Y Z [F]` (path3d), `G2`/`G3 X Y I J F<feed>` (planar arc), `G2`/`G3 X Y Z I J F<plunge>` (helical). Plus `M3 S`, `M5`, `M0`, `M7/M8/M9`, `G4 P`. NO G53 and NO G92 are ever emitted.**
  - Evidence: src/core/output/cnc-grbl-emit-head.ts:30 `lines.push(\`G0 Z${safeZ}\`);`; src/core/output/cnc-grbl-strategy.ts:298 `lines.push(\`G0 X${startX} Y${startY}\`);`, :303 `lines.push(\`G1 Z${passZ} F${plunge}\`);`, :419 `lines.push(\`G1 X${x} Y${y} Z${z}${feedWord}\`);`, :436 `lines.push(\`G1 X${x} Y${y}${feedWord}\`);`, :348 `lines.push(\`${direction} X${endX} Y${endY} I${i} J${j} F${feed}\`);`; src/core/output/cnc-grbl-helical.ts:34 `arcLines.push(\`${direction} X${startX} Y${startY} Z${z} I${i} J${j} F${plunge}\`);`; grep for 'G53|G92' over src/core/output, src/io, src/core/cnc, src/core/job returned ZERO hits
- **Coordinates are formatted at fixed 3 decimals; feeds are rounded to whole mm/min with a floor of 1.**
  - Evidence: src/core/output/cnc-grbl-emit-head.ts:6-7 `const DECIMAL_PLACES = 3; const MIN_FEED_MM_PER_MIN = 1;` and :17-24 `return n.toFixed(DECIMAL_PLACES);` / `return Math.max(MIN_FEED_MM_PER_MIN, Math.round(feedMmPerMin));`
- **YES — the repo already contains a full clean-room modal G-code PARSER that reads G-code text back into motion segments: `parseGcodeProgram(text): ParseGcodeProgramResult` in src/io/gcode/parse-gcode-program.ts. It produces a `Toolpath` (travel/cut/plunge steps with Z spans) plus a summary of cut/travel/plunge mm.**
  - Evidence: src/io/gcode/parse-gcode-program.ts:56 `export function parseGcodeProgram(text: string): ParseGcodeProgramResult {` and :94-99 `return { kind: 'ok', toolpath: { steps, totalLength: ... }, summary: summarize(lines.length, steps), notes: [...] };`
- **parseGcodeProgram tracks full modal state: motion mode (G0/G1/G2/G3), unit scale (G20/G21), absolute/incremental (G90/G91), and modal X, Y AND Z. It emits `plunge` steps for pure-Z moves, `travel` steps (with optional z span) for G0, and `cut` steps with `z: {from,to}` for G1/G2/G3.**
  - Evidence: src/io/gcode/parse-gcode-program.ts:42-50 `type ModalState = { motion: 0|1|2|3; unitScale: number; absolute: boolean; x: number; y: number; z: number; ended: boolean; };` and :230-253 emitLinear pushing `{kind:'plunge', at, fromZ, toZ, length}` / `{kind:'travel',...}` / `{kind:'cut', ..., z: { from: state.z, to: target.z }}`
- **parseGcodeProgram handles arcs fully: I/J incremental-center form AND R form (with major/minor-arc side solving), radius mismatch validation at 0.127 mm, full-circle same-point sweep, and helical Z carried onto the cut step's z span. It rejects G18/G19 planes. It does NOT track feed (F) — F is consumed as a word but never stored or used.**
  - Evidence: src/io/gcode/parse-gcode-program.ts:299-340 `function arcCenter(...)` with `const r = words.get('R'); ... const wantMinor = r >= 0; const side = (clockwise ? -1 : 1) * (wantMinor ? 1 : -1);`; :199-201 `if (key === 'G18' || key === 'G19') { return \`Line ${lineNumber}: ${key} plane arcs are not supported (XY/G17 only).\`; }`; ModalState at :42-50 has no feed field
- **A SECOND parser exists: `buildMotionManifest(gcode, options): MotionManifest` in src/core/job/motion-manifest-parser.ts. It parses the exact started program into `MotionBlock`s carrying 3D `MotionPoint {x,y,z}` polylines, kind ('travel'|'process'|'plunge'|'park'), cumulative route mm, and BOTH rawLineIndex and sendableLineIndex. It tracks G0-G3/G20/G21/G90/G91 and M3/M4/M5/M106/M107 spindle-armed state plus S power, and samples arcs via sampleMotionArc.**
  - Evidence: src/core/job/motion-manifest-parser.ts:41-44 `export function buildMotionManifest(gcode: string, options: BuildMotionManifestOptions): MotionManifest {`; src/core/job/motion-manifest.ts:11-23 `export type MotionBlock = { readonly rawLineIndex: number; readonly sendableLineIndex: number; ... readonly kind: MotionBlockKind; readonly points: ReadonlyArray<MotionPoint>; readonly lengthMm: number; readonly routeStartMm: number; readonly routeEndMm: number; };`; parser :163-177 applyGCode/applyMCode
- **Additional partial G-code text scanners (line-oriented, not full motion reconstruction): src/core/invariants/cnc-motion.ts (`findPlungedTravelIssues`, `findSpindleStartClearanceIssues`) tracks modal Z only; src/core/invariants/predicates.ts (`findOutOfBoundsCoords`) tracks modal X/Y and arc AABBs; src/core/preflight/relative-motion-envelope.ts and src/core/preflight/no-go-zones.ts track modal X/Y + G90/G91; src/core/controllers/grbl/resume-program.ts scans modal state for laser start-from-line (CNC resume is refused there).**
  - Evidence: src/core/invariants/cnc-motion.ts:20-41 `export function findPlungedTravelIssues(gcode: string, options: { readonly safeZMm: number }) ... let modalZ: number | null = null;`; src/core/invariants/predicates.ts:104-113 `// Modal position, so a G2/G3 arc knows its start point ... let pos = { x: 0, y: 0 };`; src/core/controllers/grbl/resume-program.ts:53-55 `if (options.machineKind === 'cnc') { return { kind: 'error', reason: CNC_AUTOMATIC_RECOVERY_DISABLED_REASON }; }`
- **YES — `Job` is the intermediate representation between Scene and G-code text. `Job = { groups: ReadonlyArray<Group> }` where `Group = CutGroup | FillGroup | RasterGroup | CncGroup`. It is explicitly documented as 'the intermediate representation that sits between Scene and G-code'.**
  - Evidence: src/core/job/job.ts:1-2 `// Job — the intermediate representation that sits between Scene and G-code.` and :232-238 `export type Group = CutGroup | FillGroup | RasterGroup | CncGroup; export type Job = { readonly groups: ReadonlyArray<Group> }; export const EMPTY_JOB: Job = { groups: [] };`
- **`CncGroup` carries every value a 3D view needs: layerId, color, cutType, toolId/toolName/toolDiameterMm, feedMmPerMin, plungeMmPerMin, spindleRpm, spindleSpinupSec, coolant, safeZMm, retractBetweenPasses, parkXMm/parkYMm, and `passes: ReadonlyArray<CncPass>`.**
  - Evidence: src/core/job/job.ts:198-230 `export type CncGroup = { readonly kind: 'cnc'; readonly layerId: string; ... readonly toolDiameterMm: number; readonly feedMmPerMin: number; readonly plungeMmPerMin: number; ... readonly safeZMm: number; ... readonly passes: ReadonlyArray<CncPass>; };`
- **`CncPass` is a 4-variant union and is the single best 3D source: `CncContourPass {zMm, polyline: Vec2[], closed}` (flat Z), `CncPath3dPass {points: Vec3[], closed}` (TRUE per-vertex XYZ — leads, ramps, drill pecks, relief finishing), `CncArcPass {start,end,center,clockwise,zMm,closed}`, `CncHelicalContourPass {start,center,clockwise,startZMm,zMm,revolutions,polyline,closed}`. Helpers `cncPassXyPoints(pass)` and `cncPassEntryDepthMm(pass)` are exported.**
  - Evidence: src/core/job/job.ts:125-196: `export type CncContourPass = { readonly kind: 'contour'; readonly zMm: number; ... }`, `export type CncPath3dPass = { readonly kind: 'path3d'; readonly points: ReadonlyArray<Vec3>; ... }`, `export type CncArcPass = ...`, `export type CncHelicalContourPass = ...`, `export type CncPass = CncContourPass | CncPath3dPass | CncArcPass | CncHelicalContourPass;` plus `export function cncPassXyPoints` / `export function cncPassEntryDepthMm`
- **There is also a lossier IR downstream of Job: `Toolpath = { steps: ToolpathStep[]; totalLength }` built by `buildToolpath(job, options)`, whose CNC branch (`appendCncGroupSteps`) mirrors the emitter's motion contract and attaches `z: ZSpan {from,to}` per step. For path3d passes this collapses the whole polyline to ONE from/to Z span — a documented approximation. So for a faithful 3D view, `Job`/`CncPass` is strictly richer than `Toolpath`.**
  - Evidence: src/core/job/toolpath.ts:42-55 `export function buildToolpath(job: Job, options: BuildToolpathOptions = {}): Toolpath`; src/core/job/toolpath-cnc.ts:119-135 `case 'path3d': // The rendered polyline is the XY projection ... z: { from: pass.points[0]?.z ?? 0, to: pass.points[pass.points.length - 1]?.z ?? 0 },`; src/core/sim/stamp-toolpath.ts:13-16 `// Approximation (documented): a cut step carries one Z span across its whole polyline; Z interpolates linearly by arc length within the step.`
- **SAFE Z comes from the machine config, clamped non-negative at compile, and is emitted as `G0 Z<max(0,safeZMm)>` by appendRetract. The postamble uses the max safe Z any group used.**
  - Evidence: src/core/cnc/compile-cnc-job.ts:169 `safeZMm: Math.max(0, config.params.safeZMm),`; src/core/scene/machine.ts:199 `readonly safeZMm: number; // travel clearance above stock top`; src/core/output/cnc-grbl-emit-head.ts:27-32 `const safeZ = fmt(Math.max(0, safeZMm)); if (head.z === safeZ) return; lines.push(\`G0 Z${safeZ}\`);`
- **CUT DEPTH Z comes from `zPassDepths(depthMm, depthPerPassMm)` — NEGATIVE values (Z0 = stock top), shallow→deep, with the last pass snapped exactly to -depthMm.**
  - Evidence: src/core/cnc/depth-passes.ts:11-24 `export function zPassDepths(depthMm: number, depthPerPassMm: number): ReadonlyArray<number> { ... out.push(-Math.min(depthMm, i * perPass)); } out[out.length - 1] = -depthMm; return out;`
- **PLUNGE is always `G1 Z<passZ> F<plunge>` at `group.plungeMmPerMin` — never a rapid. The emitter skips it when the head is already at that Z, and skips the retract+rapid pair when the next pass starts at the same XY (depth chaining).**
  - Evidence: src/core/output/cnc-grbl-strategy.ts:294-306 `if (retractBetweenPasses) appendRetract(...); const alreadyAtStartXy = head.x === startX && head.y === startY; if (!alreadyAtStartXy) { appendRetract(...); lines.push(\`G0 X${startX} Y${startY}\`); ... } if (head.z !== passZ) { lines.push(\`G1 Z${passZ} F${plunge}\`); head.z = passZ; }`
- **RETRACT-BETWEEN-PASSES (ADR-253) is a per-group boolean that forces a lift to safe Z before every contour/path3d pass replunge instead of stepping Z down in place.**
  - Evidence: src/core/job/job.ts:222-224 `readonly retractBetweenPasses?: boolean;`; src/core/output/cnc-grbl-strategy.ts:294 `if (retractBetweenPasses) appendRetract(lines, head, safeZMm);` and :383 same for path3d; src/core/cnc/compile-cnc-job.ts:171 `retractBetweenPasses: resolveRetractBetweenPasses(settings),`
- **RAMP entry (`applyRampEntry`, opt-in via `settings.rampEntryDeg`) converts a contour pass into a `path3d` pass: it descends along the toolpath at the configured angle (clamped 0.5°–45°) starting from the previous pass's Z (or 0 = stock top for a new contour), cuts the loop at depth, then re-cuts the ramped span level for closed loops.**
  - Evidence: src/core/cnc/motion-polish.ts:114-131 `export function applyRampEntry(passes, rampAngleDeg) { const angle = Math.min(Math.max(rampAngleDeg, 0.5), MAX_RAMP_ANGLE_DEG); ... const fromZ = pass.zMm >= previousZ ? 0 : previousZ; const ramped = rampContour(pass, fromZ, tangent);` and :133-151 `rampContour` returning `{ kind: 'path3d', points, closed: false }`
- **LEADS (ADR-250, `applyProfileLeadPasses`) also convert closed profile contour passes into `path3d` passes — lead-in arc/line, the loop, lead-out — with EVERY lead point riding the pass's own cutting depth `pass.zMm` (leads are flat, not ramped). Leads are skipped when rampEntryDeg is set or tabs are enabled.**
  - Evidence: src/core/cnc/profile-lead-passes.ts:210-227 `function ledPath3d(pass, leadIn, leadOut): CncPath3dPass { const z = pass.zMm; ... for (const point of leadIn) points.push({ x: point.x, y: point.y, z }); ... return { kind: 'path3d', points, closed: false }; }`; :44-48 `if (settings.rampEntryDeg !== undefined) return passes; ... if (settings.tabsEnabled) return passes;`
- **TABS never appear as a distinct token in the emitted G-code. They appear ONLY as geometry: a tabbed depth pass is SPLIT into multiple shorter open `contour` passes (the tab windows are simply absent from the polyline), so the emitter retracts to safe Z, rapids over each tab, and replunges — producing the classic G0 Z / G0 XY / G1 Z pattern at each tab.**
  - Evidence: src/core/cnc/compile-cnc-job.ts:390-409 `function appendTabbedPasses(...) { for (const piece of splitPassForTabs(toolpath, {...}, manualCenters)) { if (piece.points.length >= 2) passes.push(contourPassFromPolyline(piece, zMm)); } }`; src/core/cnc/cnc-tabs.ts:4-7 `// Model: tabs occupy the bottom \`tabHeightMm\` of the cut. Passes at or above the tab top cut the full loop; passes below it skip the tab intervals`
- **The tab top Z is `tabTopZMm(depthMm, tabHeightMm) = -(max(0,depthMm) - clamp(tabHeightMm))`, and a pass needs tabs only when `zMm < tabTopZMm - 1e-9`. The compiler INSERTS an extra full-loop pass at exactly the tab top so tab height is not quantized to the depth-per-pass grid.**
  - Evidence: src/core/cnc/cnc-tabs.ts:33-40 `export function tabTopZMm(depthMm, tabHeightMm): number { const height = Math.min(Math.max(0, tabHeightMm), Math.max(0, depthMm)); return -(Math.max(0, depthMm) - height); } export function passNeedsTabs(zMm, depthMm, tabHeightMm) { return zMm < tabTopZMm(depthMm, tabHeightMm) - TAB_EPS; }`; src/core/cnc/compile-cnc-job.ts:379-388 `depthsWithTabTopPass` returning `[...depths, tabTop].sort((a, b) => b - a)`
- **Tab skip width is the requested tab width PLUS one full tool diameter, so the physical bridge equals the requested width after the cutter radius eats each side. Degenerate coverage (windows swallow the whole perimeter) yields NO pieces — the deep pass is skipped entirely rather than freeing the part.**
  - Evidence: src/core/cnc/cnc-tabs.ts:48 `const tabSizeMm = Math.max(0, settings.tabWidthMm) + Math.max(0, settings.toolDiameterMm);` and :11-13 `// Degenerate coverage: when the requested windows swallow a contour's whole perimeter, the split returns NO pieces — the deep pass is skipped`
- **DRILL cut type produces a path3d peck cycle whose Z alternates between each depth step and Z0 (stock top) for chip clearing; the whole cycle rides the plunge feed because compile pins the drill group's cut feed to min(feed, plunge).**
  - Evidence: src/core/cnc/drill-peck.ts:19 `const PECK_CLEAR_Z_MM = 0;` and :41-52 `function peckCycle(at, depths) { ... points.push({ x: at.x, y: at.y, z: depths[i] ?? 0 }); if (i < depths.length - 1) { points.push({ x: at.x, y: at.y, z: PECK_CLEAR_Z_MM }); } } return { kind: 'path3d', points, closed: false };`; src/core/cnc/compile-cnc-job.ts:152-155 `const cutFeed = settings.cutType === 'drill' ? Math.min(settings.feedMmPerMin, settings.plungeMmPerMin) : settings.feedMmPerMin;`
- **HELICAL entry Z: each helical pass descends from the previous depth level (`startZMm`, 0 for the first) to `zMm` over `revolutions` full G2/G3 circles, with per-revolution Z linearly interpolated and emitted at the PLUNGE feed; the emitter then links to the pocket contour with a `G1 X Y F<feed>` at depth.**
  - Evidence: src/core/cnc/helical-entry.ts:44-49 `const zMm = depths[depthIndex]; ... const startZMm = depthIndex === 0 ? 0 : (depths[depthIndex - 1] ?? 0); ... passes.push(helicalPass(entry, startZMm, zMm, settings.angleDeg));`; src/core/output/cnc-grbl-helical.ts:31-34 `const z = fmt(pass.startZMm + (pass.zMm - pass.startZMm) * progress); arcLines.push(\`${direction} X${startX} Y${startY} Z${z} I${i} J${j} F${plunge}\`);`
- **path3d in-cut Z changes ride G1 at the CUTTING feed, except pure-vertical (same-XY) segments which switch to the PLUNGE feed, with modal F suppression between identical feeds.**
  - Evidence: src/core/output/cnc-grbl-strategy.ts:414-419 `const wantFeed = x === head.x && y === head.y ? plunge : feed; const feedWord = modalFeed === wantFeed ? '' : \` F${wantFeed}\`; modalFeed = wantFeed; lines.push(\`G1 X${x} Y${y} Z${z}${feedWord}\`);`
- **`emitPreparedGcodeWithCncPassSpans` returns a sidecar `spans: CncPassSpan[] | null` mapping each emitted pass to its 1-based raw line range `{groupIndex, passIndex, firstRawLine, lastRawLine}` — a ready-made Job-pass ↔ G-code-line index for a 3D view. It is null for non-CNC, refused emissions, and metadata-headed output.**
  - Evidence: src/io/gcode/emit-gcode.ts:79-84 `export type EmitPreparedCncGcodeResult = EmitGcodeResult & { readonly spans: ReadonlyArray<CncPassSpan> | null; };` and :141 `const spans = cncEmission !== null && options.metadata === undefined ? cncEmission.spans : null;`; src/core/output/cnc-pass-spans.ts:9-19 type definition
- **A 3D CNC pane already exists and does NOT use the Job passes directly — it goes Project → buildPreviewToolpath (prepareOutput + buildToolpath) → computeRemovalGrid (heightfield) → reliefSurfaceMesh → three.js. So the current 3D view renders a downsampled removal heightfield, not toolpath geometry.**
  - Evidence: src/ui/workspace/Cnc3DPane.tsx:92-118 `const toolpath = buildPreviewToolpath(project, { outputScope }); ... const result = computeRemovalGrid(toolpath, {...}, kernel);` and :137 `void createReliefThreeScene(canvas, reliefSurfaceMesh(display), thickness)`; three.js is a real dependency per package.json:57 `"three": "^0.180.0"`
- **When `options.metadata` is supplied, a `;`-comment provenance header is PREPENDED to the body; preflight runs on the header-free body only, and pass spans are suppressed because the header shifts raw line numbers.**
  - Evidence: src/io/gcode/emit-gcode.ts:137-141 `const preflight = runEmitPreflight(prepared.project, body, options, rotaryStage); const gcode = options.metadata ? gcodeMetadataHeader(options.metadata, headerAssumptionsFor(prepared.project)) + body : body;`

### Relevant files

- `src/io/gcode/prepare-output.ts`
- `src/io/gcode/prepare-output-snapshot.ts`
- `src/io/gcode/emit-gcode.ts`
- `src/io/gcode/emit-gcode-snapshot.ts`
- `src/io/gcode/parse-gcode-program.ts`
- `src/io/gcode/index.ts`
- `src/io/gcode/gcode-metadata.ts`
- `src/io/gcode/standalone-cnc-gcode.ts`
- `src/io/rd/emit-rd.ts`
- `src/core/job/job.ts`
- `src/core/job/toolpath.ts`
- `src/core/job/toolpath-cnc.ts`
- `src/core/job/toolpath-types.ts`
- `src/core/job/motion-manifest.ts`
- `src/core/job/motion-manifest-parser.ts`
- `src/core/job/motion-manifest-arc.ts`
- `src/core/output/cnc-grbl-strategy.ts`
- `src/core/output/cnc-grbl-emit-head.ts`
- `src/core/output/cnc-grbl-transitions.ts`
- `src/core/output/cnc-grbl-helical.ts`
- `src/core/output/cnc-grbl-coolant.ts`
- `src/core/output/cnc-pass-spans.ts`
- `src/core/output/output-strategy.ts`
- `src/core/output/index.ts`
- `src/core/output/grbl-strategy.ts`
- `src/core/raster/emit-raster.ts`
- `src/core/cnc/compile-cnc-job.ts`
- `src/core/cnc/depth-passes.ts`
- `src/core/cnc/cnc-tabs.ts`
- `src/core/cnc/motion-polish.ts`
- `src/core/cnc/profile-lead-passes.ts`
- `src/core/cnc/drill-peck.ts`
- `src/core/cnc/helical-entry.ts`
- `src/core/cnc/compile-cnc-special-passes.ts`
- `src/core/cnc/compile-cnc-relief.ts`
- `src/core/invariants/cnc-motion.ts`
- `src/core/invariants/predicates.ts`
- `src/core/invariants/gcode-words.ts`
- `src/core/preflight/cnc-motion-bounds-preflight.ts`
- `src/core/preflight/relative-motion-envelope.ts`
- `src/core/preflight/no-go-zones.ts`
- `src/core/controllers/grbl/resume-program.ts`
- `src/core/sim/stamp-toolpath.ts`
- `src/core/scene/machine.ts`
- `src/ui/workspace/Cnc3DPane.tsx`
- `src/ui/workspace/draw-preview.ts`
- `src/ui/state/canvas-motion-plan.ts`
- `src/ui/app/gcode-open-action.ts`

### Could not verify

- UNVERIFIED: I did not run `pnpm test`, `pnpm lint`, or `pnpm typecheck`. Every claim is read from source only — no behavior was executed or perceptually verified.
- UNVERIFIED: I did not read the full bodies of src/core/output/grbl-strategy.ts (laser), marlin-strategy.ts, smoothieware-strategy.ts, or src/core/raster/emit-raster.ts. My statements about laser motion words are limited to their file headers; I did not enumerate laser-side emitted words.
- UNVERIFIED: I did not read src/core/cnc/surfacing.ts, vcarve-ladder.ts, adaptive-pocket-operation.ts, rest-pocket.ts, inlay-pair.ts, or finish-allowance.ts in full — those cut types certainly contribute passes/Z but I did not trace their exact Z derivation line-by-line. A grep for 'z'/'zMm' in surfacing.ts returned no hits, which I cannot explain without reading it.
- UNVERIFIED: I did not read src/core/output/cnc-grbl-job-groups.ts (collectIndexedCncGroups) or src/core/output/select-output-strategy.ts, so I cannot state exactly how non-CNC groups inside a CNC job are handled or the full laser dialect dispatch table.
- UNVERIFIED: I did not read src/io/gcode/prepared-output-persistence.ts or src/io/gcode/program-materialization.ts beyond their imported symbol names, so I cannot describe how a PreparedOutput is archived/restored.
- UNVERIFIED: I did not confirm whether `sampleArcPoints` (core/geometry, used by parseGcodeProgram) and `sampleCircularArcPoints` (used by the emitter and toolpath-cnc) use the SAME sampling tolerance. If they differ, a parsed program and a natively-compiled job will produce differently-tessellated arcs in any 3D view built on both.
- UNVERIFIED: whether the existing three.js scene helper `src/ui/relief-viewer/relief-three-scene.ts` can render line/polyline geometry at all — I only confirmed it takes a `reliefSurfaceMesh(...)` heightfield mesh plus a thickness. I did not read the file.
- UNVERIFIED: G53/G92 grep was scoped to src/core/output, src/io, src/core/cnc, src/core/job. Those words DO appear in src/core/controllers/grbl/commands.ts, src/ui/state/*origin*, and jog paths — I did not read those to confirm they are live-command-only (not part of any emitted program), though no emitter path references them.

## 2.3 Existing three.js / 3D stack (relief-viewer, Cnc3DPane, core/sim removal grid, core/relief surface mesh, bundling)

### Findings

- **relief-three-scene.ts is the ONLY module in the repo that imports three. Repo-wide grep (excluding pnpm-lock.yaml) returns exactly three hits, all in this file: a type-only `import type { WebGLRenderer } from 'three'`, `await import('three')`, and `await import('three/examples/jsm/controls/OrbitControls.js')`.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:8 `import type { WebGLRenderer } from 'three';`, :33 `const three = await import('three');`, :34 `const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');` — no other src file matched the grep
- **createReliefThreeScene is the single scene-building entry point. Exact signature: `createReliefThreeScene(canvas: HTMLCanvasElement, mesh: ReliefSurfaceMesh, stockThicknessMm: number): Promise<ReliefSceneResult>`. It is NOT exported from src/ui/relief-viewer/index.ts — Cnc3DPane deep-imports the module file directly.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:28-32 `export async function createReliefThreeScene(canvas..., mesh: ReliefSurfaceMesh, stockThicknessMm: number,): Promise<ReliefSceneResult>`; src/ui/relief-viewer/index.ts:1-2 exports only `Cut3DPreviewDialog` and `Relief3DViewerDialog`; src/ui/workspace/Cnc3DPane.tsx:19-22 `} from '../relief-viewer/relief-three-scene';`
- **The scene module's exported types are: `ReliefSceneHandle = { dispose: () => void; resize: (width, height) => void }` and `ReliefSceneResult = { kind:'ok'; handle } | { kind:'no-webgl'; reason: string }`. There is no update/mutate path — a handle can only be disposed or resized.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:11-21 `export type ReliefSceneHandle = { readonly dispose: () => void; ... readonly resize: (width: number, height: number) => void; };` and `export type ReliefSceneResult = | { readonly kind: 'ok'; ... } | { readonly kind: 'no-webgl'; readonly reason: string };`
- **The scene is render-on-demand: there is no rAF loop and no setAnimationLoop. It renders once at build and thereafter only on OrbitControls 'change' and on resize(). A grep for `requestAnimationFrame|setAnimationLoop|setPixelRatio` across src/ui/relief-viewer returns no matches.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:90-92 `const render = (): void => renderer.render(scene, camera); controls.addEventListener('change', render); render();`; grep of `setPixelRatio|requestAnimationFrame|setAnimationLoop` over src/ui/relief-viewer: "No matches found"
- **The renderer buffer is never DPR-scaled: our code never calls setPixelRatio, and three's default `_pixelRatio` is 1, while setSize is called with updateStyle=false. On a HiDPI display the 3D view is rendered at CSS-pixel resolution and upscaled.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:47 `renderer.setSize(width, height, false);` (no setPixelRatio anywhere in src); node_modules/three/build/three.module.js:15137 `let _pixelRatio = 1;`
- **Scene contents are fixed and minimal: one indexed BufferGeometry Mesh with MeshStandardMaterial (DoubleSide, smooth normals), one LineSegments wire box built from EdgesGeometry(BoxGeometry) for the stock outline, one AmbientLight(0.55) + one DirectionalLight(1.1). No toolpath lines, no grid, no shadows, no tone mapping, no color-space configuration.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:59-81 — `new three.Mesh(geometry, new three.MeshStandardMaterial({ color: SURFACE_COLOR, side: three.DoubleSide, flatShading: false }))`, `new three.LineSegments(new three.EdgesGeometry(stockGeometry), new three.LineBasicMaterial({ color: STOCK_EDGE_COLOR }))`, `scene.add(new three.AmbientLight(0xffffff, 0.55));`
- **Geometry is uploaded via copies and then baked in place: positions/indices are `.slice()`d, the geometry is mirrored on Y (`scale(1,-1,1)`), recentred, and normals are computed on the CPU by three every rebuild.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:52-58 `geometry.setAttribute('position', new three.BufferAttribute(mesh.positions.slice(), 3)); geometry.setIndex(new three.BufferAttribute(mesh.indices.slice(), 1)); geometry.scale(1, -1, 1); geometry.translate(-mesh.widthMm / 2, mesh.heightMm / 2, 0); geometry.computeVertexNormals();`
- **Camera is Z-up perspective, FOV 40°, near 0.1 / far 10000, positioned on a radius of `max(widthMm, heightMm, stockThicknessMm*4) * 1.6`. Because the camera is constructed inside createReliefThreeScene, every scene rebuild resets the operator's orbit to the default 3/4 view.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:83-87 `const camera = new three.PerspectiveCamera(CAMERA_FOV_DEG, width / height, 0.1, 10_000); camera.up.set(0, 0, 1); const orbitRadius = Math.max(mesh.widthMm, mesh.heightMm, stockThicknessMm * 4) * 1.6; camera.position.set(orbitRadius * 0.7, -orbitRadius * 0.7, orbitRadius * 0.6);` — combined with the full rebuild at src/ui/workspace/Cnc3DPane.tsx:131-161
- **dispose() leaks GPU resources: it disposes controls, the surface geometry, the BoxGeometry and the renderer — but never the MeshStandardMaterial, the LineBasicMaterial, or the EdgesGeometry (which is a separate geometry created inline at line 72 and is the one actually attached to the LineSegments).**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:104-110 `dispose: () => { controls.removeEventListener('change', render); controls.dispose(); geometry.dispose(); stockGeometry.dispose(); renderer.dispose(); }` vs :71-74 which creates `new three.EdgesGeometry(stockGeometry)` and two materials
- **three's WebGLRenderer.dispose() does not call forceContextLoss — it only removes canvas listeners and tears down its caches. Since the pane reuses the same <canvas> element and three obtains the context via `canvas.getContext('webgl2', attrs)`, each rebuild re-creates the renderer/program cache (shader recompile + full buffer re-upload) on the existing context.**
  - Evidence: node_modules/three/build/three.module.js:15824-15847 `this.dispose = function () { canvas.removeEventListener(...); background.dispose(); ... programCache.dispose(); xr.dispose(); animation.stop(); };` (no forceContextLoss); :15176-15207 `function getContext(contextName, contextAttributes) { return canvas.getContext(contextName, contextAttributes); }` … `_gl = getContext('webgl2', contextAttributes);`
- **Viewer3DDialogShell owns the dialog chrome and a 3-state machine ('loading' | 'ready' | 'failed'), takes a `buildScene(canvas) => Promise<ReliefSceneResult>` prop that must be referentially stable, and cancels/disposes on unmount. It exports VIEWER_CANVAS_WIDTH_PX=720 and VIEWER_CANVAS_HEIGHT_PX=480.**
  - Evidence: src/ui/relief-viewer/Viewer3DDialogShell.tsx:10-11 `export const VIEWER_CANVAS_WIDTH_PX = 720; export const VIEWER_CANVAS_HEIGHT_PX = 480;`; :18-25 props incl. `readonly buildScene: (canvas: HTMLCanvasElement) => Promise<ReliefSceneResult>;`; :30-52 effect with `cancelled` flag and `handle?.dispose()` cleanup, deps `[buildScene]`
- **The dialog shell deliberately drops the resize capability: it types the retained handle as `{ readonly dispose: () => void }` only and never calls handle.resize, so both dialogs render at a fixed 720×480 buffer regardless of window size.**
  - Evidence: src/ui/relief-viewer/Viewer3DDialogShell.tsx:33 `let handle: { readonly dispose: () => void } | null = null;`; :63-69 `<canvas ref={canvasRef} width={VIEWER_CANVAS_WIDTH_PX} height={VIEWER_CANVAS_HEIGHT_PX} ...>` with `style={canvasStyle}` = `{ display:'block', maxWidth:'100%', borderRadius:4 }` (:115-119)
- **Relief3DViewerDialog rebuilds the relief heightmap at display resolution then converts it to a mesh: DISPLAY_CELLS_ACROSS = 256, MIN_DISPLAY_CELL_MM = 0.25, so mmPerCell = max(0.25, targetWidthMm/256) ≈ ~130k triangles as its comment states.**
  - Evidence: src/ui/relief-viewer/Relief3DViewerDialog.tsx:13-15 `// ~256 cells across keeps the display mesh under ~130k triangles. const DISPLAY_CELLS_ACROSS = 256; const MIN_DISPLAY_CELL_MM = 0.25;`; :44 `const mmPerCell = Math.max(MIN_DISPLAY_CELL_MM, relief.targetWidthMm / DISPLAY_CELLS_ACROSS);`
- **Relief3DViewerDialog passes `targetWidthMm` as BOTH the width and the height argument to heightmapCellSize, so the auto-coarsening cell-count check assumes a square footprint rather than the relief's actual height. (Observation only — the real heightmap dimensions come from meshToHeightmap.)**
  - Evidence: src/ui/relief-viewer/Relief3DViewerDialog.tsx:45-49 `const displayCellSize = heightmapCellSize(relief.targetWidthMm, relief.targetWidthMm, mmPerCell,);` vs src/core/relief/heightmap.ts:23-27 `heightmapCellSize(widthMm: number, heightMm: number, requested: number)`
- **Relief3DViewerDialog and Cut3DPreviewDialog both smuggle non-WebGL failures through the `no-webgl` variant: heightmap errors, cell-size errors and thrown exceptions are all reported as `kind: 'no-webgl'` with the underlying reason string.**
  - Evidence: src/ui/relief-viewer/Relief3DViewerDialog.tsx:50-51 `if (displayCellSize.kind === 'error') { return { kind: 'no-webgl', reason: displayCellSize.reason }; }` and :62 `if (heightmap.kind === 'error') return { kind: 'no-webgl', reason: heightmap.reason };`; src/ui/relief-viewer/Cut3DPreviewDialog.tsx:30-34 catch → `{ kind: 'no-webgl' as const, reason: ... }`
- **Cut3DPreviewDialog feeds a RemovalGrid straight into reliefSurfaceMesh because RemovalGrid is structurally a superset of Heightmap (both carry widthCells/heightCells/mmPerCell/depth). Display resolution is DISPLAY_CELLS_ACROSS = 360 (~260k triangles per its comment).**
  - Evidence: src/ui/relief-viewer/Cut3DPreviewDialog.tsx:14-15 `// ~360 display cells across ≈ 260k triangles — smooth on integrated GPUs. const DISPLAY_CELLS_ACROSS = 360;`; :26-29 `const display = downsampleRemovalGrid(grid, DISPLAY_CELLS_ACROSS); ... reliefSurfaceMesh(display)`; type compatibility: src/core/sim/removal-grid.ts:6-15 vs src/core/relief/heightmap.ts:7-13
- **The three viewers have three distinct mount points: Relief3DViewerDialog from the relief properties panel, Cut3DPreviewDialog from the Preview overlay in Workspace, and Cnc3DPane mounted unconditionally in App (it self-nulls when the machine is not CNC).**
  - Evidence: src/ui/layers/SelectedReliefProperties.tsx:9,47; src/ui/workspace/Workspace.tsx:32 `import { Cut3DPreviewDialog } from '../relief-viewer';` and :188-193; src/ui/app/App.tsx:16,71 `<Cnc3DPane />`; src/ui/workspace/Cnc3DPane.tsx:46 `if (project.machine?.kind !== 'cnc') return null;`
- **Cnc3DPane's lifecycle: `useDeferredValue(project)` → `useDesignRemovalGrid` useMemo (deps `[project, outputScope, collapsed]`) recompiles the toolpath AND stamps the whole removal grid synchronously on the main thread on every project change; there is no worker and no incremental update.**
  - Evidence: src/ui/workspace/Cnc3DPane.tsx:43-45 `const deferredProject = useDeferredValue(project); const grid = useDesignRemovalGrid(deferredProject, outputScope, collapsed);`; :89-119 `return useMemo(() => { ... const toolpath = buildPreviewToolpath(project, { outputScope }); ... const result = computeRemovalGrid(toolpath, {...}, kernel); ... }, [project, outputScope, collapsed]);`
- **The pane's whole three.js scene is destroyed and rebuilt from scratch whenever the grid identity or stock thickness changes — the effect deps are `[grid, thickness]`, and the cleanup disposes the handle. There is no path that updates an existing geometry in place.**
  - Evidence: src/ui/workspace/Cnc3DPane.tsx:131-161 — effect body `void createReliefThreeScene(canvas, reliefSurfaceMesh(display), thickness)`, cleanup `handleRef.current?.dispose(); handleRef.current = null;`, deps `[grid, thickness]`
- **Pane sizing: the canvas element is fixed at 244×240 attrs but CSS width 100%; a ResizeObserver (registered once, deps []) calls `handle.resize(canvas.clientWidth, canvas.clientHeight)`, and the freshly-built scene is explicitly re-fit to the laid-out size right after creation.**
  - Evidence: src/ui/workspace/Cnc3DPane.tsx:31-32 `const CANVAS_WIDTH_PX = 244; const CANVAS_HEIGHT_PX = 240;`; :147 `outcome.handle.resize(canvas.clientWidth, canvas.clientHeight);`; :165-173 ResizeObserver effect; :238-243 `canvasStyle` = `{ display:'block', width:'100%', height: CANVAS_HEIGHT_PX, borderRadius: 4 }`
- **Pane width is operator-controlled and persisted: clamped to [200, 560] px with default 260, 16 px keyboard step, stored under 'laserforge.cnc-3d-pane-width.v1'. Drag is tracked on window pointermove/pointerup, and ArrowLeft widens / ArrowRight narrows.**
  - Evidence: src/ui/workspace/use-cnc-pane-width.ts:10-14 `export const MIN_PANE_WIDTH_PX = 200; export const MAX_PANE_WIDTH_PX = 560; export const DEFAULT_PANE_WIDTH_PX = 260; const KEYBOARD_STEP_PX = 16; const STORAGE_KEY = 'laserforge.cnc-3d-pane-width.v1';`; :54-77 window listeners; :84-95 arrow-key handler
- **Collapse state is a pure function of an explicit stored preference plus a viewport media query: `cncPaneCollapsed(preference, canvasFocusViewport)` returns true for 'collapsed', false for 'expanded', else the viewport result of '(max-width: 1439px)'. Preference key is 'laserforge.cnc-3d-pane-visibility.v1'. Collapsed width is a hard-coded 44 px.**
  - Evidence: src/ui/workspace/use-cnc-canvas-focus.ts:3-4 `export const CNC_CANVAS_FOCUS_QUERY = '(max-width: 1439px)'; export const CNC_PANE_VISIBILITY_STORAGE_KEY = 'laserforge.cnc-3d-pane-visibility.v1';`; :13-20 `cncPaneCollapsed`; src/ui/workspace/Cnc3DPane.tsx:201 `width: collapsed ? 44 : widthPx,`
- **Collapsing the pane also kills the simulation: `collapsed` is a useMemo dependency and short-circuits to null, so no grid is computed and PaneScene is not rendered at all while collapsed.**
  - Evidence: src/ui/workspace/Cnc3DPane.tsx:91 `if (collapsed || machine === undefined || machine.kind !== 'cnc') return null;`; :70 `{!collapsed && <PaneScene grid={grid} stockThicknessMm={stockThicknessMm(project)} />}`
- **Cnc3DPaneToggle is a pure presentational button (no three/3D awareness): it renders '◂' + a vertical '3D result' label when collapsed and '▸' when expanded, with aria-expanded={!collapsed}.**
  - Evidence: src/ui/workspace/Cnc3DPaneToggle.tsx:1-31 — `aria-label={collapsed ? 'Expand 3D result pane' : 'Collapse 3D result pane'} aria-expanded={!collapsed}` and the ◂/▸ children
- **RemovalGrid is exactly: `{ widthCells: number; heightCells: number; mmPerCell: number; originX: number; originY: number; depth: Float32Array }`, all readonly, row-major, depth ≤ 0 with 0 = untouched stock top; length = widthCells * heightCells.**
  - Evidence: src/core/sim/removal-grid.ts:6-15 `export type RemovalGrid = { readonly widthCells: number; readonly heightCells: number; readonly mmPerCell: number; readonly originX: number; readonly originY: number; readonly depth: Float32Array; };`
- **Resolution knobs for the grid: DEFAULT_CELL_MM = 0.2 mm and MAX_GRID_CELLS = 4,000,000 (≈16 MB Float32). Requests over the cap auto-coarsen to `sqrt(area / MAX_GRID_CELLS)`; the requested size is floored at 1e-3 mm.**
  - Evidence: src/core/sim/removal-grid.ts:33-36 `export const DEFAULT_CELL_MM = 0.2; ... export const MAX_GRID_CELLS = 4_000_000;`; :78-87 `const requestedMm = Math.max(1e-3, requested); ... const mmPerCell = Math.sqrt(area / MAX_GRID_CELLS);`
- **Stamping semantics (computeRemovalGrid): travel steps are ignored; plunges stamp a single tip at the interpolated reached Z; cut steps skip entirely when both zFrom and zTo are ≥ 0 (laser steps carry no depth); Z interpolates linearly by arc length across the whole step.**
  - Evidence: src/core/sim/stamp-toolpath.ts:63-72 `if (step.kind === 'travel') return; if (step.kind === 'plunge') { ... const reachedZ = step.fromZ + (step.toZ - step.fromZ) * t; if (reachedZ < 0) stampTip(...) }`; :81-83 `const zFrom = step.z?.from ?? 0; const zTo = step.z?.to ?? 0; if (zFrom >= 0 && zTo >= 0) return;`
- **Sampling density is half a cell: `sampleSpacing = grid.mmPerCell / 2`, `samples = max(1, ceil(segLen / sampleSpacing))`, and the loop runs s = 0..samples inclusive — so a polyline segment costs about (2·segLen/mmPerCell + 1) kernel stamps.**
  - Evidence: src/core/sim/stamp-toolpath.ts:121-123 `const sampleSpacing = grid.mmPerCell / 2; const samples = Math.max(1, Math.ceil(p.segLen / sampleSpacing)); for (let s = 0; s <= samples; s += 1) {`
- **stampTip is a max-depth (min-Z) accumulator over the kernel disc: for each offset it computes surfaceZ = tipZ + offset.dz, skips surfaceZ ≥ 0, and writes only when strictly deeper than the current cell. This makes the grid order-independent for a fixed path (deepest visit wins).**
  - Evidence: src/core/sim/stamp-toolpath.ts:134-144 `for (const offset of kernel.offsets) { const index = gridCellIndex(grid, cx + offset.dx, cy + offset.dy); ... const surfaceZ = tipZ + offset.dz; if (surfaceZ >= 0) continue; const current = grid.depth[index] ?? 0; if (surfaceZ < current) grid.depth[index] = surfaceZ; }`
- **Three kernel shapes exist, keyed on CncTool.kind — flat (end-mill AND engraving, dz = 0), ball-nose (dz = r − sqrt(r²−d²)), and v-bit (cone, dz = d / tan(θ/2) with a 60° fallback and a `Math.max(1, tipAngleDeg)` guard). The default arm is `assertNever`.**
  - Evidence: src/core/sim/tool-kernels.ts:44-61 `switch (tool.kind) { case 'end-mill': case 'engraving': return 0; case 'ball-nose': ... return radiusMm - Math.sqrt(inside); case 'v-bit': { const tipAngleDeg = tool.tipAngleDeg ?? FALLBACK_V_TIP_ANGLE_DEG; ... return dMm / Math.tan(halfAngleRad); } default: return assertNever(tool.kind, 'CncToolKind'); }`
- **Kernel build cost / size: kernelForTool scans the (2·radiusCells+1)² box with radiusCells = ceil(radiusMm/mmPerCell) and keeps only cells inside the disc, so |offsets| ≈ π·(radiusMm/mmPerCell)². Total stamp cost ≈ Σ_segments (2·segLen/mmPerCell) × π·(radiusMm/mmPerCell)² — cubic in 1/mmPerCell.**
  - Evidence: src/core/sim/tool-kernels.ts:31-42 `const radiusCells = Math.max(0, Math.ceil(radiusMm / mmPerCell)); for (let dy = -radiusCells; dy <= radiusCells; dy += 1) { for (let dx = -radiusCells; dx <= radiusCells; dx += 1) { const dMm = Math.hypot(dx, dy) * mmPerCell; if (dMm > radiusMm) continue; offsets.push(...) } }`
- **downsampleRemovalGrid is a deepest-of-block (min) reducer with integer factor `ceil(max(widthCells,heightCells)/across)`; it returns the SAME grid object unchanged when factor ≤ 1, and multiplies mmPerCell by the factor while keeping originX/originY.**
  - Evidence: src/core/sim/removal-grid-display.ts:9-13 `const factor = Math.ceil(Math.max(grid.widthCells, grid.heightCells) / across); if (factor <= 1) return grid;`; :17-26 `let deepest = 0; ... if (value < deepest) deepest = value;`; :32 `mmPerCell: grid.mmPerCell * factor,`
- **core/sim's public surface (index.ts) is 12 exports: createRemovalGrid, coarsenedCellSize, gridCellIndex, gridCellOfPoint, DEFAULT_CELL_MM, MAX_GRID_CELLS, kernelForTool, computeRemovalGrid, downsampleRemovalGrid plus the RemovalGrid/ToolKernel/result types.**
  - Evidence: src/core/sim/index.ts:3-21 — the full export block
- **ReliefSurfaceMesh is exactly `{ positions: Float32Array; indices: Uint32Array; widthMm: number; heightMm: number }`, all readonly, in the heightmap-local frame (mm), with Z = depth (0 = stock top, negative into the stock).**
  - Evidence: src/core/relief/relief-surface-mesh.ts:11-17 `export type ReliefSurfaceMesh = { readonly positions: Float32Array; readonly indices: Uint32Array; readonly widthMm: number; readonly heightMm: number; };`
- **Mesh topology is one vertex per CELL CENTRE (offset by +0.5 cell in x and y), two triangles per cell quad. Exact counts for a W×H heightmap: vertices = W·H, positions length = 3·W·H, indices length = 6·(W−1)·(H−1), triangles = 2·(W−1)·(H−1). Degenerate single-row/column maps produce zero indices.**
  - Evidence: src/core/relief/relief-surface-mesh.ts:28-30 `positions[vertex] = (col + 0.5) * mmPerCell; positions[vertex + 1] = (row + 0.5) * mmPerCell; positions[vertex + 2] = map.depth[row * widthCells + col] ?? 0;`; :33-35 `const quadCols = Math.max(0, widthCells - 1); const quadRows = Math.max(0, heightCells - 1); const indices = new Uint32Array(quadCols * quadRows * INDICES_PER_CELL_QUAD);` with INDICES_PER_CELL_QUAD = 6 (:20); confirmed by src/core/relief/relief-surface-mesh.test.ts:38 `expect(mesh.indices).toHaveLength(12);` for a 3×2 map
- **Concrete triangle budgets from those knobs: relief dialog 256 across → 2·255² = 130,050 tris; cut-preview dialog 360 across → 2·359² = 257,762 tris; CNC pane 300 across → up to 2·299² = 178,802 tris. No normals are supplied — three recomputes them per rebuild.**
  - Evidence: src/ui/relief-viewer/Relief3DViewerDialog.tsx:14 `const DISPLAY_CELLS_ACROSS = 256;`; src/ui/relief-viewer/Cut3DPreviewDialog.tsx:15 `const DISPLAY_CELLS_ACROSS = 360;`; src/ui/workspace/Cnc3DPane.tsx:30 `const PANE_DISPLAY_CELLS_ACROSS = 300;`; formula from src/core/relief/relief-surface-mesh.ts:33-35; src/ui/relief-viewer/relief-three-scene.ts:58 `geometry.computeVertexNormals();`
- **The CNC pane's simulation resolution is PANE_TARGET_CELLS_PER_AXIS = 500 with mmPerCell = max(DEFAULT_CELL_MM 0.2, maxDim/500), and the grid is built in SCENE coordinates via toSceneCoords so the pane matches the Preview dialog's orientation.**
  - Evidence: src/ui/workspace/Cnc3DPane.tsx:29 `const PANE_TARGET_CELLS_PER_AXIS = 500;`; :102-105 `const mmPerCell = Math.max(DEFAULT_CELL_MM, Math.max(widthMm, heightMm) / PANE_TARGET_CELLS_PER_AXIS,);`; :94-99 `const a = toSceneCoords(stock.originOffset, project.device);`
- **three is a runtime dependency at ^0.180.0, resolved to exactly 0.180.0 in the lockfile; @types/three is a devDependency at ^0.185.0 resolved to 0.185.0 — a 5-minor version skew between the runtime library and its type definitions.**
  - Evidence: package.json:57 `"three": "^0.180.0",` and :68 `"@types/three": "^0.185.0",`; pnpm-lock.yaml:50-52 `three: specifier: ^0.180.0 / version: 0.180.0`; pnpm-lock.yaml:78-80 `'@types/three': specifier: ^0.185.0 / version: 0.185.0`; node_modules/three/package.json (main checkout) `"version": "0.180.0"`
- **vite.config.ts has NO manualChunks branch for three. The manualChunks function names vendor-react, vendor-state, vendor-cam (clipper2-ts + dompurify), cnc-stroke-fonts, core, io, ui-workbench and then `return undefined` — so three lands in a Rollup-auto dynamic chunk purely because the only import of it is a dynamic import().**
  - Evidence: vite.config.ts:74-93 manualChunks body — `if (normalized.includes('/node_modules/react')) return 'vendor-react'; ... if (normalized.includes('/src/ui/laser/') || normalized.includes('/src/ui/workspace/')) { return 'ui-workbench'; } return undefined;` (no 'three' branch)
- **The chunk-size warning limit was raised to 750 KB explicitly to accommodate the three chunk, and the config comment states a real three.js code-split is tracked as a separate refactor.**
  - Evidence: vite.config.ts:64-71 `// Accepted chunk budget: 750 KB. The three.js relief-preview chunk (three.module) is ~704 KB minified ... A real three.js code-split is tracked as a separate refactor. chunkSizeWarningLimit: 750,`
- **Only ONE three addon is currently imported anywhere: OrbitControls, via the `three/examples/jsm/controls/OrbitControls.js` path (not the `three/addons/...` alias). No Line2 / LineMaterial / LineSegmentsGeometry / loaders / post-processing imports exist in src.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:34 `const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');` — repo-wide grep for `three/examples|three/addons` returned only this line
- **CONFIRMED PRESENT in the installed package: node_modules/three/examples/jsm/lines/ contains Line2.js, LineGeometry.js, LineMaterial.js, LineSegments2.js, LineSegmentsGeometry.js, Wireframe.js, WireframeGeometry2.js and a webgpu/ subdir. Matching .d.ts files exist in @types/three/examples/jsm/lines/.**
  - Evidence: `ls C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/` → Line2.js, LineGeometry.js, LineMaterial.js, LineSegments2.js, LineSegmentsGeometry.js, Wireframe.js, WireframeGeometry2.js, webgpu; `ls .../@types/three/examples/jsm/lines/` → Line2.d.ts, LineGeometry.d.ts, LineMaterial.d.ts, LineSegments2.d.ts, LineSegmentsGeometry.d.ts, Wireframe.d.ts, WireframeGeometry2.d.ts, webgpu
- **Other addon controls available alongside OrbitControls in the installed tree: ArcballControls, DragControls, FirstPersonControls, FlyControls, MapControls, PointerLockControls, TrackballControls, TransformControls.**
  - Evidence: `ls C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/controls/` → ArcballControls.js, DragControls.js, FirstPersonControls.js, FlyControls.js, MapControls.js, OrbitControls.js, PointerLockControls.js, TrackballControls.js, TransformControls.js
- **ADR-102 is the governing constraint for any three.js work: three is UI-only (allowed beneath src/ui/relief-viewer/ and nowhere else, never core/ or io/), must be lazy-loaded via dynamic import(), and heightmap→mesh conversion must stay a pure core function returning plain typed arrays. Note that Cnc3DPane (in src/ui/workspace/) imports the relief-viewer scene module — it does not import three itself, so the letter of the rule holds.**
  - Evidence: DECISIONS.md:4576-4586 `2. **three.js is UI-only.** It may be imported beneath \`src/ui/relief-viewer/\` and nowhere else — never in \`core/\` or \`io/\`. ... 3. **Lazy-loaded.**`; src/ui/workspace/Cnc3DPane.tsx:19-22 imports `createReliefThreeScene` (not three)
- **There is no ESLint rule restricting three imports — eslint.config.js contains no occurrence of 'three'. The ADR-102 boundary is documentation + review, not machine-enforced.**
  - Evidence: `grep -n "three" eslint.config.js` returned no output
- **ADR-102's Verification section claims 'CI cross-checks package.json against' the RESEARCH_LOG dependency row, but scripts/check-licenses.mjs only mentions RESEARCH_LOG in a comment and checks SPDX licenses, not versions. No script in scripts/, src/ or .github/ was found that compares the RESEARCH_LOG version string to package.json.**
  - Evidence: DECISIONS.md:4602-4603 `- RESEARCH_LOG.md dependency row (version, license re-verified) — CI cross-checks package.json against it.`; scripts/check-licenses.mjs:16 `// Every new allowlist entry requires an ADR-017 and RESEARCH_LOG review.` is the only RESEARCH_LOG reference; grep -rln RESEARCH_LOG over scripts/ src/ .github/ hit no other build script
- **RESEARCH_LOG.md pins the documented three version as ^0.180.0 — a version bump would need this row updated to stay consistent with ADR-102's verification requirement.**
  - Evidence: RESEARCH_LOG.md:798-808 `### three — adopted for the 3D relief viewer (2026-07-03, ADR-102)` … `- **Version:** ^0.180.0 (pinned caret; see package.json)` … `- **Types:** \`@types/three\` (dev dependency, MIT/DefinitelyTyped).`
- **Existing tests never mock three: both dialog tests run the REAL dynamic import in jsdom and assert the '3D view unavailable' fallback, with 20 s waitFor / 30 s test timeouts. A grep for `vi.mock('three')` across src returns nothing. Any upgrade that changes the failure path will surface in these two tests.**
  - Evidence: src/ui/relief-viewer/Relief3DViewerDialog.test.tsx:1-3 `// jsdom has no WebGL, so the dialog's graceful fallback IS the testable path (ADR-102 §4): the real three.js import runs`; :53-58 `await vi.waitFor(() => { expect(host.textContent).toContain('3D view unavailable'); }, { timeout: 20_000 },);` and :72 `}, 30_000);`; identical pattern at src/ui/relief-viewer/Cut3DPreviewDialog.test.tsx:46-51,65; `grep -rn "vi.mock('three'" src/` → no output
- **There is no test file for Cnc3DPane.tsx, Cnc3DPaneToggle.tsx, use-cnc-pane-width.ts or use-cnc-canvas-focus.ts co-located in src/ui/workspace/ — the directory listing shows no Cnc3DPane*.test.tsx / use-cnc-*.test.ts sibling.**
  - Evidence: `ls src/ui/workspace/` shows Cnc3DPane.tsx, Cnc3DPaneToggle.tsx, use-cnc-pane-width.ts, use-cnc-canvas-focus.ts but no matching .test files (contrast RegistrationJigPanel.test.tsx, ToolStrip.test.tsx which are present)
- **File-size headroom for the upgrade (400 counted-code-line hard cap): Cnc3DPane.tsx is the largest at 249 physical lines, relief-three-scene.ts 113, Viewer3DDialogShell.tsx 124, use-cnc-pane-width.ts 98, stamp-toolpath.ts 144, removal-grid.ts 127, tool-kernels.ts 61, relief-surface-mesh.ts 58.**
  - Evidence: Read tool line counts: src/ui/workspace/Cnc3DPane.tsx ends at line 248 (+1), src/ui/relief-viewer/relief-three-scene.ts:113, src/ui/relief-viewer/Viewer3DDialogShell.tsx:124, src/core/sim/stamp-toolpath.ts:144, src/core/sim/removal-grid.ts:127

### Relevant files

- `src/ui/relief-viewer/relief-three-scene.ts`
- `src/ui/relief-viewer/Viewer3DDialogShell.tsx`
- `src/ui/relief-viewer/Relief3DViewerDialog.tsx`
- `src/ui/relief-viewer/Cut3DPreviewDialog.tsx`
- `src/ui/relief-viewer/index.ts`
- `src/ui/relief-viewer/Relief3DViewerDialog.test.tsx`
- `src/ui/relief-viewer/Cut3DPreviewDialog.test.tsx`
- `src/ui/workspace/Cnc3DPane.tsx`
- `src/ui/workspace/Cnc3DPaneToggle.tsx`
- `src/ui/workspace/use-cnc-pane-width.ts`
- `src/ui/workspace/use-cnc-canvas-focus.ts`
- `src/ui/workspace/Workspace.tsx`
- `src/ui/workspace/index.ts`
- `src/ui/app/App.tsx`
- `src/ui/layers/SelectedReliefProperties.tsx`
- `src/core/sim/index.ts`
- `src/core/sim/removal-grid.ts`
- `src/core/sim/stamp-toolpath.ts`
- `src/core/sim/tool-kernels.ts`
- `src/core/sim/removal-grid-display.ts`
- `src/core/relief/relief-surface-mesh.ts`
- `src/core/relief/relief-surface-mesh.test.ts`
- `src/core/relief/heightmap.ts`
- `src/core/relief/index.ts`
- `vite.config.ts`
- `package.json`
- `pnpm-lock.yaml`
- `DECISIONS.md`
- `RESEARCH_LOG.md`
- `scripts/check-licenses.mjs`

### Could not verify

- The worktree C:/Users/Asus/LaserForge-2.0/.claude/worktrees/cnc-3d-threejs-upgrade-9d1216 has NO node_modules directory. All node_modules inspection (three 0.180.0, examples/jsm/lines/, examples/jsm/controls/, @types/three 0.185.0, three.module.js internals) was done against the MAIN checkout at C:/Users/Asus/LaserForge-2.0/node_modules. The worktree's pnpm-lock.yaml resolves three to the same 0.180.0, so they should match, but I did not run an install to prove it.
- UNVERIFIED: the '~704 KB minified' three chunk size quoted in vite.config.ts:66-67. I did not run `vite build`, so I have no measured chunk sizes, gzip figures, or chunk names for the current bundle.
- UNVERIFIED: whether importing 'three/examples/jsm/lines/Line2.js' / LineMaterial.js / LineSegmentsGeometry.js actually resolves and bundles cleanly under this Vite config and passes tsc with the 0.180 runtime vs 0.185 types. The files and .d.ts exist on disk; nothing in the repo imports them today, so the integration is untested.
- UNVERIFIED: any runtime/perceptual behavior. I did not start the dev server, render a scene, or look at the 3D output. Every claim about visual appearance is inferred from the code, not observed. In particular I have not confirmed that the camera-reset-on-rebuild, the missing setPixelRatio, or the undisposed materials/EdgesGeometry produce user-visible symptoms.
- UNVERIFIED: real performance numbers. The stamping cost formula (≈ 2·L/mmPerCell × π·(r/mmPerCell)² kernel writes) is derived from the loops in src/core/sim/stamp-toolpath.ts and src/core/sim/tool-kernels.ts, not measured. No profiling of the Cnc3DPane useMemo or the scene rebuild was performed.
- UNVERIFIED: how repeated `new WebGLRenderer({ canvas })` on the same reused <canvas> behaves across many pane rebuilds in a real browser. I confirmed from node_modules/three/build/three.module.js:15824-15847 that dispose() does NOT call forceContextLoss, and at :15176-15207 that three obtains the context via canvas.getContext('webgl2', attrs); the conclusion that the existing context is reused rather than leaked follows from DOM getContext semantics, which I did not test empirically.
- I did not read buildPreviewToolpath (src/ui/workspace/draw-preview.ts), toSceneCoords, activeCncTool, meshToHeightmap, or the 2D draw-cnc-removal.ts / draw-relief.ts canvas shading paths — they are upstream/parallel to the 3D stack and were out of the requested scope.
- I did not check the Playwright e2e suite (*.e2e.ts) for any 3D-pane coverage, nor did I run pnpm test / lint / typecheck (read-only task).

## 2.4 Governing-doc constraints on a CNC 3D view upgrade (DECISIONS.md ADRs, PROJECT.md phase/non-negotiables, WORKFLOW.md flows, file-size + boundaries enforcement)

### Findings

- **ADR-102 is the governing three.js ADR. Its decision line 1 adopts three.js as a runtime dependency by explicit override of ADR-098 §2.**
  - Evidence: DECISIONS.md:4555 heading '## ADR-102 — three.js for the 3D relief viewer (explicit ADR-098 §2 override)'; DECISIONS.md:4572 '1. Adopt **three.js** (MIT) as a runtime dependency, explicitly overriding ADR-098 §2 for this one library.' Status/date at DECISIONS.md:4557-4558 'Status: Accepted / Date: 2026-07-03'.
- **ADR-102 §2 is the hardest constraint on any 3D upgrade: three.js may be imported ONLY beneath src/ui/relief-viewer/, never in core/ or io/, and the heightmap→mesh conversion must stay a PURE core function returning plain Float32Arrays.**
  - Evidence: DECISIONS.md:4576-4582 '2. **three.js is UI-only.** It may be imported beneath `src/ui/relief-viewer/` and nowhere else — never in `core/` or `io/`. clipper2-ts remains the only geometry dependency of the core. The heightmap→mesh conversion stays a PURE core function returning plain `Float32Array`s (positions/indices/normals feed three's BufferGeometry at the UI boundary), so the viewer's geometry is testable without WebGL.'
- **ADR-102 §3 requires three.js to stay lazy-loaded via dynamic import() so the base bundle is unchanged until a 3D view opens; §4 requires a graceful non-WebGL fallback that component tests assert.**
  - Evidence: DECISIONS.md:4583-4587 '3. **Lazy-loaded.** The viewer dialog imports three via dynamic `import()` so the ~150 KB gzip lands in its own chunk and the base bundle is unchanged until the first 3D view opens. 4. Environments without WebGL (jsdom, headless CI) get a graceful fallback message, which is what component tests assert.'
- **ADR-102 records an explicit reversal trigger: a bundle-size or supply-chain flag on three.js means replacing the viewer with a static isometric canvas projection (pure core, no dependency).**
  - Evidence: DECISIONS.md:4607-4610 '### Reversal triggers — Bundle-size or supply-chain audit flags three.js → replace the viewer with a static isometric canvas projection (pure core, no dependency).'
- **ADR-102's verification bar names three artifacts: a RESEARCH_LOG.md dependency row CI-cross-checked against package.json, pure mesh-builder unit tests + a jsdom fallback component test, and a visual check in the isolated preview browser.**
  - Evidence: DECISIONS.md:4599-4605 '- RESEARCH_LOG.md dependency row (version, license re-verified) — CI cross-checks package.json against it. - Pure mesh-builder unit tests against analytic heightmaps; component fallback test in jsdom; full gate. - Visual check of the rendered relief in the isolated preview browser.'
- **ADR-103's relevant decision is G4: the general (non-relief) 3D cut preview is the H.2 material-removal grid rendered as a shaded heightfield in the ADR-102 three.js viewer, UI-only, same lazy chunk, same jsdom fallback.**
  - Evidence: DECISIONS.md:4652-4655 '- **G4. General 3D cut preview.** The H.2 material-removal grid rendered as a shaded heightfield in the ADR-102 three.js viewer for ANY CNC job (not just reliefs). UI-only, same lazy chunk, same jsdom fallback.' Heading at DECISIONS.md:4613.
- **ADR-103 explicitly carries over ADR-098 §1/§3: clean-room, no new runtime deps (G4 reuses ADR-102's three.js), defaults must keep existing G-code byte-identical, and output-affecting features land CLAIMED until a 4040 air-cut.**
  - Evidence: DECISIONS.md:4680-4687 '### Constraints carried over — ADR-098 §1/§3 unchanged: clean-room, no new runtime deps (G1–G8 add none; G4 reuses ADR-102's three.js), every output-affecting feature lands CLAIMED until a 4040 air-cut. Defaults must keep existing G-code byte-identical…'
- **ADR-105's relevant decision is G9: the persistent, docked, collapsible CNC-mode 3D pane renders the ADR-102 scene LIVE while designing, computing a coarse toolpath + removal grid outside Preview mode, debounced per edit; UI-only, compile/emit untouched.**
  - Evidence: DECISIONS.md:4735-4740 '- **G9 — persistent 3D pane.** A docked, collapsible right-side pane in CNC mode renders the simulated cut result (stock + removal heightfield, the ADR-102 scene) LIVE while designing — Easel's split-view. The pane computes a coarse toolpath + removal grid outside Preview mode, debounced per edit; Preview mode reuses the scrubbed preview grid. UI-only; compile/emit untouched.' Heading at DECISIONS.md:4727.
- **ADR-191 pins the pane's resize contract: width clamped to [200, 560] px, persisted in localStorage key 'laserforge.cnc-3d-pane-width.v1', a resize(w,h) method on the three.js scene handle, a ResizeObserver re-fit, and a 44 px collapsed strip with the handle hidden while collapsed.**
  - Evidence: DECISIONS.md:8110-8116 'The CNC "3D result" pane (`Cnc3DPane`) exposes a drag handle on its left edge… clamped to [200, 560] px. The chosen width persists in localStorage (`laserforge.cnc-3d-pane-width.v1`)… The three.js scene handle gains a `resize(w, h)` method, and a ResizeObserver re-fits the renderer and camera on every width change so the render-on-demand scene stays crisp instead of scaling a stale buffer.' Consequences at DECISIONS.md:8118-8123 'The pane still collapses to a 44 px strip via its existing toggle; the resize handle is hidden while collapsed.'
- **ADR-191 declares pane width to be session-durable UI state, not project data — explicitly excluded from undo and from .lf2.**
  - Evidence: DECISIONS.md:8121-8122 'Pane width is session-durable UI state, not project data, so it is not in undo or `.lf2`.'
- **ADR-223 (also 3D-pane governing, not in the requested list) sets the responsive default: at (max-width: 1439px) CNC starts in Canvas Focus with 3D collapsed to a named 44 px restore strip; explicit operator choice persists in 'laserforge.cnc-3d-pane-visibility.v1' and overrides later breakpoint changes.**
  - Evidence: DECISIONS.md:9583-9588 '- With no saved visibility preference, a CNC viewport matching `(max-width: 1439px)` starts in **Canvas Focus**: the 3D result pane collapses to a named 44 px vertical restore strip. Wider viewports start with 3D open. - Clicking the existing 3D collapse/expand control records `collapsed` or `expanded` in `laserforge.cnc-3d-pane-visibility.v1`.' Heading at DECISIONS.md:9560.
- **ADR-223 explicitly bars the 3D pane from touching output: Canvas Focus changes UI layout only, not project data, undo, compilation, G-code, controller state, or any machine-safety gate; and the removal-grid hook must not recompute while collapsed.**
  - Evidence: DECISIONS.md:9591-9592 '- Canvas Focus changes UI layout only. It does not change project data, undo, compilation, G-code, controller state, or any machine-safety gate.'; DECISIONS.md:9600-9601 '- Because the existing removal-grid hook receives the collapsed state, the live 3D simulation is not recomputed while Canvas Focus is active.'
- **ADR-098 §2 is the standing no-new-runtime-dependency mandate that ADR-102 overrode for exactly one library; clipper2-ts remains the only geometry dependency.**
  - Evidence: DECISIONS.md:4322-4331 (ADR-098 §2) '2. **All parsers are clean-room.** DXF, STL, and G-code (.nc) parsers are hand-written in `src/io/` — no parser libraries. clipper2-ts (already adopted) remains the only geometry dependency; no new runtime dependencies are planned for Phase H.' Heading at DECISIONS.md:4306.
- **ADR-119 is a documented precedent that a 3D preview does NOT automatically get three.js: the box designer's assembled 3D preview was deliberately built without it.**
  - Evidence: DECISIONS.md:6005 'NOT three.js: a dialog preview needs no camera, no lazy chunk, and…' (within '### Decision 2 — assembled 3D preview', DECISIONS.md:5995); ADR-119 heading at DECISIONS.md:5960.
- **The highest ADR number present in DECISIONS.md is ADR-253; the next free number is 254. There are 202 '## ADR-' headings, and numbering gaps are documented as reserved blocks, not free slots.**
  - Evidence: `grep -c '^## ADR-' DECISIONS.md` = 202; max of `grep -oE 'ADR-[0-9]+'` on those headings = 253; DECISIONS.md:11750 '## ADR-253 - Retract between passes for profile and line cuts' (Date: 2026-07-24, Status: Accepted, DECISIONS.md:11752-11753). DECISIONS.md:14-16 'The index is numerically complete; gaps in the numbering are reserved blocks with no ADR body (e.g. most of 054–091, reserved by the build plan).' No ADR reference above 253 exists in DECISIONS.md/PROJECT.md/WORKFLOW.md/CLAUDE.md/AGENTS.md/CONTRIBUTING.md/RESEARCH_LOG.md.
- **PROJECT.md has TWO phases marked in progress; the latest is Phase L. Phase F is '[In progress]' and Phase L — v0.11 'Image Studio' is '[In progress — IE-1 under construction]'. There is no phase currently open for CNC 3D work.**
  - Evidence: PROJECT.md:115 '### Phase F — v0.6 "Raster engrave" [In progress]'; PROJECT.md:239 '### Phase L — v0.11 "Image Studio" [In progress — IE-1 under construction]'; PROJECT.md:254 'IE-1 … | In progress'.
- **The CNC 3D / simulation items are all recorded as already Built under Phase H, not as backlog: H.2 (removal grid), H.11/G4 (general 3D cut preview), H.12 (persistent live 3D pane).**
  - Evidence: PROJECT.md:144 '| H.2 | Toolpath simulation: stock XY model, Z-aware steps, material-removal grid, depth-shaded preview | Built |'; PROJECT.md:153 '| H.11 | Market-parity build-out (ADR-103): … general 3D cut preview … | Built (G1–G8) |'; PROJECT.md:154 '| H.12 | Easel-parity pack (ADR-105): persistent live 3D pane, pocket raster fill …, bundled local design library | Built |'.
- **PROJECT.md's Phase H preamble names ADR-102 as the governing constraint for the three.js dependency and ADR-101 (gate-and-hide) for laser/CNC UI separation.**
  - Evidence: PROJECT.md:138 '…UI separation between laser and CNC modes is governed by ADR-101 (gate-and-hide); the 3D relief viewer's three.js dependency by ADR-102 (UI-only override of ADR-098 §2).'
- **No CNC 3D / simulation / visualization item appears in PROJECT.md's 'Future feature notes (uncommitted; capture-only)' backlog or in 'Out of scope'. A 3D-view upgrade therefore has no existing phase slot and would need a PROJECT.md revision + a DECISIONS.md entry per the doc's own rule.**
  - Evidence: PROJECT.md:272-295 'Future feature notes (uncommitted; capture-only)' lists only Convert-to-Bitmap, Material/Interval Test, Trace control realignment, Capture Board Corners — no 3D item. PROJECT.md:261 'Requires a new `PROJECT.md` revision and a `DECISIONS.md` entry. Anticipated, not committed:'; PROJECT.md:512 'Reject any of these mid-development without a `PROJECT.md` revision and a `DECISIONS.md` entry.'
- **Non-negotiable #21 (Maintainer authority) verbatim: Frame is the only Start guard and the physical Frame is the spatial source of truth; no policy finding may be relabeled as a factual refusal category.**
  - Evidence: PROJECT.md:329 '21. **Frame is the only Start guard, and the physical Frame is the spatial source of truth** (ADR-228, ADR-230, ADR-232). A clean completed Frame for the exact current job is the sole ordinary Start authorization on laser and CNC; Start only claims that one-use permit plus unavoidable live transport/handoff facts, and Job Review remains the single warning surface. Calculated bed overhang, configured no-go zones, and controller-setting policy may inform that review but may not refuse Frame or Start. Factual transport inability, an unconstructable executable artifact, and exact-handoff inconsistency remain refusals because no valid command or matching stream can exist. No policy finding may be relabeled as one of those factual categories.'
- **Non-negotiables 1-9 (Safety + correctness) are: bounds check; origin honesty; laser-off on travel; no partial output; deterministic G-code; units honest; power scale honest; no telemetry (only pinned release discovery); Abort reachable always.**
  - Evidence: PROJECT.md:303-311 '1. **Bounds check** … 2. **Origin honesty** … 3. **Laser-off on travel** … 4. **No partial output** … 5. **Deterministic G-code** — same input + same parameters → byte-identical output. Snapshot-tested. 6. **Units honest** … 7. **Power scale honest** … 8. **No telemetry; only pinned release discovery** … 9. **Abort reachable always** — the software Abort / Controller Reset control is reachable from any window state during a job. No modal can block it.'
- **Non-negotiables 10-20 (Architectural) directly bound a 3D upgrade: #15 file-size limits, #17 single responsibility, #18 discriminated unions, and #20 third-party libraries must pass the ADR-017 evaluation policy (license, maintenance, fit, size, CVE status).**
  - Evidence: PROJECT.md:315-325 '10. **Pure-function pipeline core** (ADR-010). 11. **Platform-agnostic core** … 12. **Module boundaries are public APIs** … 13. **All invariants property-tested** … 14. **G-code snapshot-tested** … 15. **File-size limits enforced** (ADR-015): files ≤ 400 lines hard, ≤ 250 soft; components ≤ 250 hard; functions ≤ 80 hard. 16. **Co-located tests** … 17. **Single responsibility per file** … 18. **Discriminated unions for state** … 19. **`SceneObject` extensible from day one** … 20. **Third-party libraries pass evaluation policy** (ADR-017): license, maintenance, fit, size, CVE status.'
- **PROJECT.md sets a hard performance budget a heavier three.js scene must respect: web bundle < 1 MB compressed with each dependency charged against it, web cold-start < 2 s, and 60 fps pan/zoom on a 5,000-segment scene.**
  - Evidence: PROJECT.md:506 '- Web bundle target: < 1 MB compressed. Each adopted dependency adds to this budget — see ADR-017.'; PROJECT.md:338-339 '- Web cold-start < 2 s, desktop cold-start < 3 s. - 60 fps pan/zoom on a 5,000-segment scene.'
- **WORKFLOW.md has exactly two 3D-view flows, both CNC: F-CNC23 (modal 3D cut preview from Preview route controls) and F-CNC28 (persistent live 3D result pane). Both specify the same four states including a no-WebGL error arm.**
  - Evidence: WORKFLOW.md:2881 '### F-CNC23. View the simulated cut in 3D — Phase H.11 (ADR-103 G4)'; WORKFLOW.md:2895-2896 '#### Error — no WebGL … 1. The dialog opens with "3D view unavailable: <reason>" instead of crashing (same fallback contract as the relief viewer).'; WORKFLOW.md:3057 '### F-CNC28. Watch the live 3D result while designing — ADR-105 G9'; WORKFLOW.md:3066-3068 '#### Error — no WebGL … 1. The pane shows "3D view unavailable in this browser" instead of crashing.'
- **F-CNC23 pins concrete behavioral contracts a 3D upgrade must preserve: the surface reflects the scrubber position, drag orbits / scroll zooms, depth is true to scale, the display grid downsamples to ~360 cells across keeping the deepest value per block, the button only appears when a removal grid exists, and laser previews never show it.**
  - Evidence: WORKFLOW.md:2885-2904 '2. The 3D surface reflects the scrubber position: scrub to 40%, open 3D, and only the material removed so far is missing. Drag orbits, scroll zooms; depth is true to scale. 3. The display grid downsamples to ~360 cells across, keeping the deepest value per block so narrow slots stay visible. … #### Empty 1. The button only appears when a removal grid exists … Laser previews never show it. #### Edge — huge stock 1. The underlying grid already coarsens beyond 4M cells…'
- **F-CNC28 pins the pane's contracts: docked between canvas and layers panel, continuously simulating the CURRENT job with deferred re-render, drag orbits / scroll zooms / true-to-scale depth, collapse to a sliver, an honest empty state for jobs that cannot produce toolpaths, and it never renders in laser mode.**
  - Evidence: WORKFLOW.md:3059-3078 '1. In CNC mode a docked "3D result" pane sits between the canvas and the layers panel, continuously simulating the CURRENT job: edit a shape, change a depth, swap a bit — the heightfield re-renders (deferred so typing stays smooth). Drag orbits, scroll zooms; depth is true to scale. The collapse button shrinks it to a sliver. … #### Empty 1. With no output-enabled CNC content it shows a hint … honest feedback, not an error. #### Edge — laser mode 1. The pane never renders in laser mode.'
- **WORKFLOW.md also fixes the Canvas Focus responsive rule in its global workspace-chrome section (not a numbered flow), and the highest existing CNC flow id is F-CNC45, so the next free flow id is F-CNC46.**
  - Evidence: WORKFLOW.md:76 '- **CNC Canvas Focus**: at 1439 px wide or below, CNC starts with the 3D result collapsed to a named 44 px restore strip unless the operator has already chosen otherwise…'; WORKFLOW.md:3475 '### F-CNC45. Pass-boundary CNC recovery review - Phase H.13 (ADR-215)' is the highest `### F-CNC<n>` heading.
- **scripts/check-file-size-policy.mjs enforces a HARD 600 RAW PHYSICAL LINE backstop (exit 1), counting CRLF-normalized physical lines including blanks and comments, over src, electron, scripts, audit/scripts plus four root config files, for extensions .cjs/.cts/.js/.jsx/.mjs/.mts/.ts/.tsx. It does NOT exempt test files.**
  - Evidence: scripts/check-file-size-policy.mjs:4 'const MAX_RAW_LINES = 600;'; :5-12 roots and sourceExtensions; :28-33 countPhysicalLines normalizes \r\n and counts every line; :49-59 'if (lines > MAX_RAW_LINES) … process.exit(1);'
- **scripts/check-soft-line-limit.mjs is REPORT-ONLY (always exit 0) at 250 COUNTED code lines, skipping blank and comment-only lines via a string-aware scan, and it explicitly excludes *.test.* files and anything under __fixtures__.**
  - Evidence: scripts/check-soft-line-limit.mjs:17 'const SOFT_LIMIT = 250;'; :30-32 'return !/\.test\.[cm]?[jt]sx?$/.test(path) && !path.includes("__fixtures__");'; :183-185 '// Report-only: the soft tier never fails the build … process.exit(0);'; :4-15 explains ESLint cannot hold warn/250 and error/400 on max-lines simultaneously (ADR-132).
- **scripts/check-index-exports.mjs is a ratchet, not a static cap: SOFT_CAP 10 / HARD_CAP 20 over every src/**/index.ts. New barrels hard-cap at 20; legacy over-cap barrels are pinned to scripts/index-export-baseline.json and may only shrink — growth fails, and a shrink that is not locked in by lowering the baseline in the same change ALSO fails.**
  - Evidence: scripts/check-index-exports.mjs:15-19 'const SOFT_CAP = 10; const HARD_CAP = 20; const SCAN_ROOT = "src"; const BARREL_NAME = "index.ts"; const BASELINE_PATH = "scripts/index-export-baseline.json";'; :105-114 regressions / staleBaseline / slackBaseline computation; :116-142 three separate process.exit(1) branches.
- **src/core/sim/index.ts is a ratcheted over-cap barrel is NOT true — the only CNC-related baseline entry is src/core/cnc/index.ts at 67, which may only shrink. Adding new exports there to support a 3D upgrade would fail the ratchet.**
  - Evidence: scripts/index-export-baseline.json:7 '"src/core/cnc/index.ts": 67,' — grep for 'ui/workspace', 'ui/relief-viewer', and 'core/sim' in that file returns no rows, so those barrels are held to the plain HARD_CAP of 20.
- **eslint.config.mjs enforces ui → { core, io, platform-types } and nothing else; ui may NOT import platform/web or platform/electron directly. core may import only core; io may import core + io.**
  - Evidence: eslint.config.mjs:44-57 boundaryRules: '{ from: { type: "core" }, allow: { to: { type: "core" } } }, { from: { type: "io" }, allow: { to: { type: ["core", "io"] } } }, … { from: { type: "ui" }, allow: { to: { type: ["core", "io", "platform-types"] } } }'; :123-125 "'boundaries/dependencies': ['error', { default: 'disallow', rules: boundaryRules }], 'boundaries/no-unknown': 'error', 'boundaries/no-unknown-files': 'error'".
- **There is NO ESLint rule anywhere in eslint.config.mjs restricting three.js imports. ADR-102 §2's 'relief-viewer only' rule is documentation-enforced and PR-review-enforced, not CI-mechanical. The only no-restricted-imports block is core-scoped and lists Node builtins.**
  - Evidence: eslint.config.mjs:247-257 the sole 'no-restricted-imports' entry, scoped to files 'src/core/**' (:222), pattern group "['node:*', 'fs', 'path', 'os', 'child_process', 'worker_threads']". No occurrence of 'three' anywhere in eslint.config.mjs (334 lines, read in full).
- **The ADR-102 §2 constraint is currently HONORED in the tree: exactly one module imports three, and it does so lazily.**
  - Evidence: `grep -rn "from 'three'|import('three')" src/ electron/` returns only src/ui/relief-viewer/relief-three-scene.ts:8 "import type { WebGLRenderer } from 'three';" and :33 "const three = await import('three');". The file's header comment at src/ui/relief-viewer/relief-three-scene.ts:1-2 states 'createReliefThreeScene — the ONLY module that touches three.js (ADR-102 §2: three is UI-only, lazy-loaded).' OrbitControls is also lazily imported at :34 "const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');".
- **three is a runtime dependency at ^0.180.0 with @types/three ^0.185.0 as a devDependency, and RESEARCH_LOG.md carries the ADR-102 dependency row CI cross-checks against. A version bump would need that row updated.**
  - Evidence: package.json:57 '"three": "^0.180.0",'; package.json:68 '"@types/three": "^0.185.0",'; RESEARCH_LOG.md:798-808 '### three — adopted for the 3D relief viewer (2026-07-03, ADR-102) — **Version:** ^0.180.0 (pinned caret; see package.json) — **License:** MIT … **Role:** WebGL scene graph for the relief 3D viewer ONLY — imported beneath `src/ui/relief-viewer/`, lazy-loaded, never in core/ or io/ … **Types:** `@types/three` (dev dependency, MIT/DefinitelyTyped).'
- **The current three.js scene module is small and render-on-demand (no rAF loop), which is the performance contract an upgrade would be changing. Its handle exposes only dispose() and resize(w,h), and it returns a discriminated result union { kind:'ok' } | { kind:'no-webgl' }.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:3-4 '…orbit controls, and render-on-demand (no rAF loop — renders on interaction/resize only).'; :12-19 'export type ReliefSceneHandle = { readonly dispose: () => void; … readonly resize: (width: number, height: number) => void; };'; :21-23 'export type ReliefSceneResult = | { readonly kind: "ok"; readonly handle: ReliefSceneHandle } | { readonly kind: "no-webgl"; readonly reason: string };'. File is 113 raw lines.
- **Cnc3DPane.tsx (the persistent pane) is at 248 raw physical lines — under the 600 raw backstop and under the 250 counted-line soft limit — but it is the closest 3D file to the component hard cap of 250, so an upgrade landing in that file will need a split.**
  - Evidence: `wc -l src/ui/workspace/Cnc3DPane.tsx` = 248; `node scripts/check-soft-line-limit.mjs` does NOT list Cnc3DPane.tsx among the 154 over-250 files (it lists src/ui/workspace/use-workspace-drag.ts 398, preview-overlays.tsx 384, drag-state.ts 374, draw-preview.ts 360, draw-scene.ts 348, Workspace.tsx 322 …). CLAUDE.md size table: 'React component | 150 lines | 250 lines'.
- **Cnc3DPane reaches past the relief-viewer barrel with a deep import of relief-three-scene, and the removal-grid pure-core lives in src/core/sim/ while the mesh builder lives in src/core/relief — that is the pure-core seam ADR-102 §2 requires an upgrade to keep.**
  - Evidence: src/ui/workspace/Cnc3DPane.tsx:19-22 'import { createReliefThreeScene, type ReliefSceneHandle } from "../relief-viewer/relief-three-scene";'; :8 'import { reliefSurfaceMesh } from "../../core/relief";'; :10-16 'import { computeRemovalGrid, downsampleRemovalGrid, DEFAULT_CELL_MM, kernelForTool, type RemovalGrid } from "../../core/sim";'; :137 'void createReliefThreeScene(canvas, reliefSurfaceMesh(display), thickness)'. src/ui/relief-viewer/index.ts exports only Cut3DPreviewDialog and Relief3DViewerDialog.
- **release:check is the gate a 3D upgrade must pass, and it runs all three file-size scripts plus prettier --check repo-wide, which pnpm lint does NOT cover.**
  - Evidence: package.json:33 '"release:check": "pnpm typecheck && pnpm lint && pnpm lint:electron && pnpm format:check && pnpm license-check && pnpm audit:deps && pnpm test && pnpm test:release-integrity && pnpm build:web && pnpm build:electron-main && pnpm check:file-size && pnpm check:soft-size && pnpm check:index-exports"'; package.json:20 '"format:check": "prettier --check ."'.
- **ESLint's mechanical size gates are file 400 counted lines (skipBlankLines + skipComments), function 80, complexity 12 — all 'error', with only max-lines-per-function relaxed for test files.**
  - Evidence: eslint.config.mjs:17-19 'const FILE_LINE_LIMIT = 400; const FUNCTION_LINE_LIMIT = 80; const COMPLEXITY_LIMIT = 12;'; :115-120 "'max-lines': ['error', { max: FILE_LINE_LIMIT, skipBlankLines: true, skipComments: true }], 'max-lines-per-function': ['error', { max: FUNCTION_LINE_LIMIT, skipBlankLines: true, skipComments: true, IIFEs: true }], complexity: ['error', COMPLEXITY_LIMIT],"; :314-321 test-file overrides turn off only max-lines-per-function, no-non-null-assertion, boundaries/dependencies, no-restricted-imports.
- **ADR-047's raw-color lint rule applies to any new UI files in a 3D upgrade: string hex and rgb()/rgba() literals in src/ui are errors requiring var(--lf-*) tokens. Numeric three.js color literals (0xRRGGBB) do not trip it because the selector matches string Literal values only.**
  - Evidence: eslint.config.mjs:282-299 files 'src/ui/**/*.ts(x)', rules no-restricted-syntax selectors 'Literal[value=/#[0-9a-fA-F]{3,8}/]' and 'Literal[value=/rgba?\\(/]'. src/ui/relief-viewer/relief-three-scene.ts:25-27 uses numeric literals 'const SURFACE_COLOR = 0xb08050; const STOCK_EDGE_COLOR = 0x707070; const BACKGROUND_COLOR = 0x1c1f24;' with no eslint-disable present.

### Relevant files

- `DECISIONS.md`
- `PROJECT.md`
- `WORKFLOW.md`
- `CLAUDE.md`
- `RESEARCH_LOG.md`
- `package.json`
- `eslint.config.mjs`
- `scripts/check-file-size-policy.mjs`
- `scripts/check-soft-line-limit.mjs`
- `scripts/check-index-exports.mjs`
- `scripts/index-export-baseline.json`
- `src/ui/relief-viewer/relief-three-scene.ts`
- `src/ui/relief-viewer/index.ts`
- `src/ui/relief-viewer/Cut3DPreviewDialog.tsx`
- `src/ui/relief-viewer/Relief3DViewerDialog.tsx`
- `src/ui/relief-viewer/Viewer3DDialogShell.tsx`
- `src/ui/workspace/Cnc3DPane.tsx`
- `src/ui/workspace/Cnc3DPaneToggle.tsx`
- `src/ui/workspace/use-cnc-pane-width.ts`
- `src/ui/workspace/use-cnc-canvas-focus.ts`
- `src/ui/workspace/draw-cnc-removal.ts`
- `src/core/sim/removal-grid.ts`
- `src/core/sim/removal-grid-display.ts`
- `src/core/sim/stamp-toolpath.ts`
- `src/core/sim/tool-kernels.ts`
- `src/core/sim/index.ts`

### Could not verify

- UNVERIFIED: whether the maintainer considers 'current phase' to be Phase F or Phase L. PROJECT.md marks BOTH as [In progress] (PROJECT.md:115 and :239) with no single 'current phase' declaration anywhere in the file. I did not find a line that names one.
- UNVERIFIED: I did not read the bodies of src/core/relief/* or src/core/sim/removal-grid.ts, so I cannot state the exact ReliefSurfaceMesh shape, the mesh-builder's purity, or the real cell/vertex limits beyond what WORKFLOW.md F-CNC23 asserts (~360 display cells, 4M-cell grid coarsening).
- UNVERIFIED: actual current export counts of src/ui/workspace/index.ts, src/ui/relief-viewer/index.ts, and src/core/sim/index.ts. I confirmed only that they are absent from scripts/index-export-baseline.json, which means they are at or under HARD_CAP 20 — I did not run check-index-exports.mjs to get the live numbers.
- UNVERIFIED: current bundle size and whether a three.js upgrade would breach PROJECT.md:506's <1 MB compressed budget. I did not build.
- UNVERIFIED: whether OrbitControls (three/examples/jsm) counts as a separate dependency under ADR-017/ADR-098 §2. ADR-102 does not mention it; RESEARCH_LOG.md:798-808 records only the 'three' package. This is an open governance question for any upgrade that pulls more from three/examples/.
- UNVERIFIED: whether src/ui/workspace/Cnc3DPane.tsx:19's deep import of '../relief-viewer/relief-three-scene' (past the relief-viewer barrel) is a CLAUDE.md 'cross-module imports must go through index.ts' violation. eslint-plugin-boundaries classifies both as type 'ui' (eslint.config.mjs:31), so CI does not flag it; whether the maintainer reads 'module' as folder-level is not stated in any doc I read.
- UNVERIFIED: whether ADR-102's stated '~150 KB gzip' three.js chunk figure is still accurate at ^0.180.0. I did not measure.
- I did not run pnpm test, pnpm lint, pnpm typecheck, or pnpm format:check. I ran only scripts/check-soft-line-limit.mjs (report-only, read-only). No files were modified.

## 2.5 Test + verification environment for 3D (three.js) code in LaserForge/KerfDesk

### Findings

- **The unit-test environment is jsdom globally, with no per-file environment override anywhere in src/.**
  - Evidence: vitest.config.ts:12 `environment: 'jsdom',`; a repo-wide grep for `@vitest-environment` in src/ returned zero hits.
- **WebGL is deliberately UNAVAILABLE in the vitest environment: a single global setup file forces HTMLCanvasElement.prototype.getContext to return null for any webgl/webgl2/experimental-webgl request.**
  - Evidence: vitest.config.ts:16 `setupFiles: ['src/__fixtures__/jsdom-canvas-setup.ts'],`; src/__fixtures__/jsdom-canvas-setup.ts:113 `if (contextId.includes('webgl')) return null;` with the rationale at lines 10-12 ("webgl → null (a genuine 'WebGL unavailable' ...) Three.js turns that into its own catchable error, so the 3D viewers hit their real no-webgl fallback").
- **The same setup file returns a Proxy-based no-op 2D context for '2d', so canvas draw paths run without jsdom 'Not implemented' noise. It is intentionally narrow: toDataURL still throws and getImageData returns a zeroed buffer.**
  - Evidence: src/__fixtures__/jsdom-canvas-setup.ts:111 `if (contextId === TWO_D_CONTEXT_TYPE) return canvas2dContextStub(this);`; lines 16-18 "PNG encoding (toDataURL) is left to jsdom (still throws), getImageData returns a zeroed (fully transparent) region".
- **There is NO mocking of three.js anywhere. The two 3D dialog tests import and execute the REAL three.js module; the mocking strategy is exclusively the null-WebGL getContext stub.**
  - Evidence: Repo-wide grep for `vi.mock` matching three/relief/webgl returned zero hits (grep over src/ for `vi.mock(` lists only pwa-register, toast-store, layers, laser, image-loader, etc.). src/ui/relief-viewer/relief-three-scene.ts:33-34 does the real dynamic `const three = await import('three');` / `await import('three/examples/jsm/controls/OrbitControls.js');`.
- **The exact mock/assert strategy in Cut3DPreviewDialog.test.tsx and Relief3DViewerDialog.test.tsx is identical: mount the component into a real jsdom DOM via createRoot inside React `act`, then `vi.waitFor` for the literal string '3D view unavailable', then click Close and assert the onClose spy. No renderer, geometry, camera, or pixel is inspected.**
  - Evidence: src/ui/relief-viewer/Cut3DPreviewDialog.test.tsx:46-51 `await vi.waitFor(() => { expect(host.textContent).toContain('3D view unavailable'); }, { timeout: 20_000 });`; src/ui/relief-viewer/Relief3DViewerDialog.test.tsx:53-58 identical; both files set `IS_REACT_ACT_ENVIRONMENT = true` (lines 10-13) and carry a 30_000 ms per-test timeout.
- **Relief3DViewerDialog.test.tsx documents in its header comment that the fallback IS the only testable path, i.e. the tests are explicitly not fidelity tests.**
  - Evidence: src/ui/relief-viewer/Relief3DViewerDialog.test.tsx:1-3 "jsdom has no WebGL, so the dialog's graceful fallback IS the testable path (ADR-102 §4): the real three.js import runs, the renderer fails to start, and the viewer reports it instead of crashing."
- **I ran the two 3D tests and confirmed the mechanism empirically: three.js emits 'THREE.WebGLRenderer: Error creating WebGL context.' to stderr and both tests pass in ~4.3s.**
  - Evidence: `pnpm exec vitest run src/ui/relief-viewer` → stderr line `THREE.WebGLRenderer: Error creating WebGL context.`, then `Test Files 2 passed (2) / Tests 2 passed (2) / Duration 4.33s`, EXIT=0.
- **The error is swallowed at one place: relief-three-scene.ts wraps only the `new WebGLRenderer` call in try/catch and returns a discriminated `{kind:'no-webgl'}` result. Everything after that line (geometry, lights, camera, OrbitControls, render) is UNPROTECTED and never executes in jsdom.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:36-44 `let renderer: WebGLRenderer; try { renderer = new three.WebGLRenderer({ canvas, antialias: true }); } catch (err) { return { kind: 'no-webgl', reason: ... }; }` — lines 45-93 (setSize, BufferGeometry, geometry.scale(1,-1,1), lights, PerspectiveCamera, OrbitControls, render()) run only on a real WebGL context.
- **There is NO test file for relief-three-scene.ts and NO test file for Cnc3DPane.tsx. Cnc3DPane has zero direct test coverage of any kind.**
  - Evidence: `ls src/ui/relief-viewer/` lists only Cut3DPreviewDialog.test.tsx and Relief3DViewerDialog.test.tsx (no relief-three-scene.test.ts); `grep -rln "Cnc3DPane" src/ e2e/` returns only src/ui/app/App.tsx, src/ui/workspace/Cnc3DPane.tsx, Cnc3DPaneToggle.tsx, index.ts, use-cnc-pane-width.ts — no .test file.
- **Cnc3DPane's only automated coverage is its surrounding layout hooks, which never mount the canvas or the three.js scene.**
  - Evidence: src/ui/workspace/ contains use-cnc-canvas-focus.test.tsx and use-cnc-pane-width.test.ts but no Cnc3DPane.test.tsx / Cnc3DPaneToggle.test.tsx; the scene lives in the inner `PaneScene` component at src/ui/workspace/Cnc3DPane.tsx:122-194, which is only rendered when `!collapsed` (line 70).
- **Cnc3DPane's failure text differs from the dialog shell's, so a test copied from the dialogs would not match it.**
  - Evidence: src/ui/workspace/Cnc3DPane.tsx:187 renders `3D view unavailable in this browser.` while src/ui/relief-viewer/Viewer3DDialogShell.tsx:73 renders `3D view unavailable: {state.reason}`.
- **The three-state scene lifecycle is centralized in Viewer3DDialogShell for the two dialogs, but Cnc3DPane re-implements its own copy of that state machine (loading/ready/failed + cancel + dispose) independently.**
  - Evidence: src/ui/relief-viewer/Viewer3DDialogShell.tsx:13-52 (`ViewerState` union + effect with `cancelled`/`handle.dispose()`); src/ui/workspace/Cnc3DPane.tsx:34 `type PaneSceneState = 'loading' | 'ready' | 'failed';` and 131-161 a separate effect with its own cancelled flag, plus a ResizeObserver effect at 165-173 the dialogs do not have.
- **The 3D geometry itself IS unit-tested, but only as pure arrays with no renderer — this is the ADR-102 §2 design (heightmap→mesh stays in pure core so it is testable without WebGL).**
  - Evidence: src/core/relief/relief-surface-mesh.ts:22 `export function reliefSurfaceMesh(map: Heightmap): ReliefSurfaceMesh` returning Float32Array/Uint32Array; src/core/relief/relief-surface-mesh.test.ts:14-47 asserts vertex-center placement, quad triangulation index validity, and the degenerate single-row case. DECISIONS.md:4577-4583 states the mesh conversion "stays a PURE core function returning plain Float32Arrays ... so the viewer's geometry is testable without WebGL".
- **A geometry transform applied ONLY inside the three.js module is therefore outside all test coverage — notably the Y-mirror and recentering.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:56-57 `geometry.scale(1, -1, 1); geometry.translate(-mesh.widthMm / 2, mesh.heightMm / 2, 0);` — these run after the un-catchable renderer construction, so no jsdom test ever reaches them and relief-surface-mesh.test.ts does not model them.
- **The perceptual harness DOES exist at src/__fixtures__/perceptual/ (61 files) but has NO README and NO index.ts — it is a set of directly-imported TypeScript modules, documented in DECISIONS.md ADR-025 rather than in-tree docs.**
  - Evidence: `ls src/__fixtures__/perceptual` shows 61 entries with no README/index.ts (`find src/__fixtures__ -iname '*.md'` returns only src/__fixtures__/lightburn/external/README.md). DECISIONS.md:1070 `## ADR-025 — Perceptual fidelity harness for the trace pipeline`.
- **The perceptual harness is strictly 2D and binary: it produces a `Mask` (Uint8Array, 1 = ink) and can render exactly three input kinds — vector paths/polylines, a Toolpath's cut steps, and emitted G-code. It has NO ability to render a heightmap, a mesh, a 3D scene, or shading.**
  - Evidence: src/__fixtures__/perceptual/rasterize.ts:26-31 `export type Mask = { width; height; data: Uint8Array }` and :46 `rasterizeColoredPaths` / :58 `rasterizePolylines`; toolpath-rasterize.ts:17 `rasterizeToolpathBurn(toolpath, ...)` ("only cut/burn steps contribute ink", lines 4-5); gcode-rasterize.ts:1-7 parses GRBL text back to a mask. A grep of the whole perceptual folder for `relief|heightmap|removalGrid|three|webgl` returns only unrelated prose hits (e.g. png.ts:25 "three panels", box-sheet.test.ts corner-relief settings).
- **Ground truth in the harness is analytic, not golden files: the same closed-form predicate fills both the source bitmap and the truth mask, and IoU/precision/recall is the comparator.**
  - Evidence: src/__fixtures__/perceptual/shapes.ts:3-9 "The SAME predicate fills both the source image (what the tracer sees) and the ground-truth mask ... it is, by construction, exactly the set of black pixels in the source"; compare.ts:20 `export type MaskMetrics` / :32 `export function compareMasks(predicted, truth)`; DECISIONS.md:1101-1108 (decision items 2 and 4).
- **The harness's only human-eyeballable output is an opt-in side-by-side PNG dump gated on the PERCEPTUAL_ARTIFACTS env var, written to ./perceptual-artifacts/ — off during a normal `pnpm test`.**
  - Evidence: src/__fixtures__/perceptual/png.ts:22-23 `const ARTIFACT_ENV = 'PERCEPTUAL_ARTIFACTS'; const ARTIFACT_DIR = 'perceptual-artifacts';` and :38-39 `const flag = process.env[ARTIFACT_ENV]; if (flag === undefined || flag === '') return null;`. Diff legend at :30-32 (green=TP, red=FP, blue=FN). `encodeRgbPng` is exported at :98 for other harness modules to write raw RGB.
- **There is NO headless-GL, node-canvas, puppeteer, pixelmatch, or image-snapshot dependency in the tree. Nothing in the repo can rasterize a WebGL frame outside a real browser.**
  - Evidence: grep for `"gl"|headless-gl|node-canvas|"canvas"|puppeteer|pixelmatch|jest-image-snapshot` across package.json and pnpm-lock.yaml returned zero hits. Runtime deps at package.json:48-59 are clipper2-ts, dompurify, electron-updater, imagetracerjs, lucide-static, opentype.js, react, react-dom, three@^0.180.0, zustand.
- **The e2e suite is Playwright with real Chrome (channel 'chrome', headless), and it DOES have exactly one CNC-3D-pane spec — but that spec only asserts layout attributes and bounding-box widths; it never asserts that WebGL initialized or that anything rendered.**
  - Evidence: playwright.config.ts:18-19 `channel: 'chrome', headless: true`; e2e/workbench.e2e.ts:207 test name 'CNC laptop layout starts in Canvas Focus and preserves an explicit 3D restore', asserting only `toHaveAttribute('data-cnc-layout-mode', ...)` (lines 217, 222, 234), `aria-expanded` (218, 223-226) and a >180px width delta (230). It never queries the '3D result pane' canvas or the 'Live 3D cut result' aria-label.
- **That e2e spec starts at a viewport (1366×768) where the pane is collapsed, so PaneScene — and therefore three.js — is not even mounted until the expand click, and nothing after the click checks the scene state.**
  - Evidence: e2e/workbench.e2e.ts:210 `await page.setViewportSize({ width: 1366, height: 768 });` and :217 expects `data-cnc-layout-mode` = 'canvas-focus'; src/ui/workspace/Cnc3DPane.tsx:70 `{!collapsed && <PaneScene .../>}` gates the canvas on the expanded state.
- **`pnpm test:e2e` runs ONLY e2e/workbench.e2e.ts (11 tests). The five e2e/*.spec.ts files are orphaned by the default config — Playwright resolves playwright.config.ts before playwright.config.mjs, and the .ts config's testMatch is '**/*.e2e.ts'.**
  - Evidence: playwright.config.ts:9-10 `testDir: './e2e', testMatch: '**/*.e2e.ts'`; Playwright's resolver order is `for (const ext of ['.ts', '.js', '.mts', '.mjs', '.cts', '.cjs'])` at node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/lib/common/*.js:1536. Verified by running `pnpm exec playwright test --list` → 'Total: 11 tests in 1 file', all workbench.e2e.ts. The .spec.ts files are still typechecked (e2e/tsconfig.json:7 `"include": ["./**/*.ts", "../playwright.config.ts"]`).
- **No screenshot-diff / golden-image mechanism exists in e2e. Screenshots and traces are captured only on failure, as debugging artifacts.**
  - Evidence: grep for `toHaveScreenshot|toMatchSnapshot|screenshot(` across e2e/ returned zero hits; playwright.config.ts:20-21 `trace: 'retain-on-failure', screenshot: 'only-on-failure'`.
- **The browser smoke workflow is separate from CI and is explicitly non-blocking on main by design.**
  - Evidence: .github/workflows/e2e.yml:1 `name: Browser smoke`, :43 `pnpm exec playwright install --with-deps chrome`, :49 `run: pnpm test:e2e`, and :5-8 "OBSERVABILITY ONLY on main: deploy.yml gates on the CI workflow alone — making deploys additionally require this workflow would be a new blocking gate". .github/workflows/ci.yml runs `pnpm release:check` only, which per package.json:33 contains no e2e step.
- **The dev server is `pnpm dev:web` → plain `vite`, pinned to port 5173 with strictPort (so it fails rather than drifting to another port); preview is 4173.**
  - Evidence: package.json:35 `"dev:web": "vite"`; vite.config.ts:110-113 `server: { port: 5173, strictPort: true }`; :114-117 `preview: { port: 4173, strictPort: true }`. Playwright's own webServer overrides this: playwright.config.ts:24 `pnpm exec vite . --host 127.0.0.1 --port ${port} --strictPort` with PLAYWRIGHT_PORT defaulting to 5173 (line 4).
- **`__GIT_SHA__` exists as a Vite compile-time define, NOT as a window global — `window.__GIT_SHA__` is undefined at runtime. The live build SHA must be read from the DOM (the toolbar build badge) instead.**
  - Evidence: vite.config.ts:53 `__GIT_SHA__: JSON.stringify(gitShortSha()),`; src/vite-env.d.ts:12-14 `declare const __BUILD_TIME__/__GIT_SHA__/__APP_VERSION__: string;` with the comment "by the time JS runs in the browser these are already inlined literals"; a grep for `window.__` across src/ non-test files returned zero hits. It surfaces in the UI at src/ui/common/Toolbar.tsx:54 `const sha = __GIT_SHA__;` rendered as `v{version} - {sha}` (line 68, aria-label 'Build version') and in src/ui/commands/CommandShell.tsx:399 `Commit ${__GIT_SHA__}`.
- **ADR-102 itself names the intended verification for the three.js viewer, and the only visual step in it is a manual browser check — there is no automated fidelity gate for 3D.**
  - Evidence: DECISIONS.md:4601-4607 Verification section: "Pure mesh-builder unit tests against analytic heightmaps; component fallback test in jsdom; full gate." and "Visual check of the rendered relief in the isolated preview browser." ADR-102 §4 (DECISIONS.md:4589-4590): "Environments without WebGL (jsdom, headless CI) get a graceful fallback message, which is what component tests assert."
- **ADR-102 §2 states three.js may be imported beneath src/ui/relief-viewer/ and nowhere else, but this is NOT lint-enforced, and Cnc3DPane.tsx already reaches into that folder's internal module rather than its barrel.**
  - Evidence: DECISIONS.md:4573-4576 "three.js is UI-only. It may be imported beneath src/ui/relief-viewer/ and nowhere else"; eslint.config.mjs contains no rule mentioning 'three' (grep for three/relief-viewer in eslint.config.mjs returns only the __fixtures__ ignore lines 36 and 315). src/ui/workspace/Cnc3DPane.tsx:19-22 imports `createReliefThreeScene, type ReliefSceneHandle` from `'../relief-viewer/relief-three-scene'`, while src/ui/relief-viewer/index.ts only exports Cut3DPreviewDialog and Relief3DViewerDialog.
- **One test in the repo overrides getContext to return a truthy 2D-ish stub for EVERY context id including webgl — a trap for any future 3D test placed in that file, because three.js would then get a fake non-null 'context' instead of failing cleanly.**
  - Evidence: src/ui/app/App.mount.test.tsx:163-165 `vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasRenderingContextStub() as CanvasRenderingContext2D);` — unconditional on contextId, unlike the global setup at src/__fixtures__/jsdom-canvas-setup.ts:113. App.mount.test.tsx does not currently reach Cnc3DPane (grep for Cnc3DPane / '3D result' in it returns nothing), and Cnc3DPane returns null unless machine.kind === 'cnc' (Cnc3DPane.tsx:46).
- **The vite build already treats three.js as a known oversized chunk with a documented budget, which is the constraint any three.js upgrade has to stay inside.**
  - Evidence: vite.config.ts:65-71 "The three.js relief-preview chunk (three.module) is ~704 KB minified ... Raising the ceiling to a documented 750 KB budget" with `chunkSizeWarningLimit: 750`. three is not named in the manualChunks function (vite.config.ts:74-93), so it lands in its own dynamic-import chunk.
- **Installed three.js versions: runtime `three@^0.180.0` but types `@types/three@^0.185.0` — a five-minor-version skew between the library and its type definitions.**
  - Evidence: package.json:57 `"three": "^0.180.0"` under dependencies; package.json:68 `"@types/three": "^0.185.0"` under devDependencies.

### Relevant files

- `vitest.config.ts`
- `vite.config.ts`
- `package.json`
- `playwright.config.ts`
- `playwright.config.mjs`
- `eslint.config.mjs`
- `src/vite-env.d.ts`
- `src/__fixtures__/jsdom-canvas-setup.ts`
- `src/__fixtures__/perceptual/rasterize.ts`
- `src/__fixtures__/perceptual/compare.ts`
- `src/__fixtures__/perceptual/png.ts`
- `src/__fixtures__/perceptual/shapes.ts`
- `src/__fixtures__/perceptual/toolpath-rasterize.ts`
- `src/__fixtures__/perceptual/gcode-rasterize.ts`
- `src/ui/relief-viewer/relief-three-scene.ts`
- `src/ui/relief-viewer/Viewer3DDialogShell.tsx`
- `src/ui/relief-viewer/Cut3DPreviewDialog.tsx`
- `src/ui/relief-viewer/Cut3DPreviewDialog.test.tsx`
- `src/ui/relief-viewer/Relief3DViewerDialog.tsx`
- `src/ui/relief-viewer/Relief3DViewerDialog.test.tsx`
- `src/ui/relief-viewer/index.ts`
- `src/ui/workspace/Cnc3DPane.tsx`
- `src/ui/workspace/Cnc3DPaneToggle.tsx`
- `src/ui/workspace/use-cnc-pane-width.ts`
- `src/ui/workspace/use-cnc-canvas-focus.ts`
- `src/core/relief/relief-surface-mesh.ts`
- `src/core/relief/relief-surface-mesh.test.ts`
- `src/core/sim/removal-grid.ts`
- `src/core/sim/removal-grid-display.ts`
- `src/ui/app/App.mount.test.tsx`
- `src/ui/app/build-info.ts`
- `src/ui/common/Toolbar.tsx`
- `e2e/workbench.e2e.ts`
- `e2e/tsconfig.json`
- `e2e/fixtures/kerfdesk-test.ts`
- `e2e/fixtures/browser-apis.js`
- `.github/workflows/ci.yml`
- `.github/workflows/e2e.yml`
- `DECISIONS.md`

### Could not verify

- UNVERIFIED: whether Playwright's headless Chrome (channel 'chrome') in this repo's CI actually exposes a working WebGL context (SwiftShader or otherwise). No test in the repo ever asserts it, and I did not launch a browser to check. If it does not, an e2e assertion like 'the 3D pane does NOT say unavailable' would fail in CI even though it passes locally.
- UNVERIFIED: whether the three.js scene has ever actually been eyeballed. There is no rendered artifact, golden image, or verification note for the 3D viewer anywhere in the tree — only the ADR-102 line saying a 'Visual check ... in the isolated preview browser' is the intended step (DECISIONS.md:4607).
- UNVERIFIED: I did not run `pnpm test` (full suite), `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, or `pnpm test:e2e`. I ran only `pnpm exec vitest run src/ui/relief-viewer` (2 files, both pass) and `pnpm exec playwright test --list` (listing only, no browser launched, no dev server started).
- UNVERIFIED: whether a dev server is currently occupying port 5173. Because vite.config.ts:111-112 sets strictPort, `pnpm dev:web` will hard-fail rather than pick another port if the maintainer's server is already running — and per CLAUDE.md rule 4 that running server holds the maintainer's real scene, so it must not be driven.
- UNVERIFIED: what a real WebGL run does with the code after relief-three-scene.ts:44. Every line from setSize through OrbitControls and render() is unreachable in jsdom, so I have no evidence about its behavior beyond reading it. In particular the geometry.scale(1,-1,1) mirror at line 56 has no test of any kind.
- UNVERIFIED: whether the five orphaned e2e/*.spec.ts files (foundations, performance, production-workflows, shape-properties, ux-shell) still pass under `playwright test -c playwright.config.mjs`. They typecheck but are not executed by any script or workflow I found.
- Not investigated: whether ADR-105/ADR-103 or WORKFLOW.md specify additional verification obligations for the CNC 3D pane beyond ADR-102's. I read ADR-102 in full and only the opening of ADR-103.

## 2.6 UI theme + 2D canvas rendering map for a new 3D (three.js) CNC view

### Findings

- **The Canvas2D palette is a TS constant object `canvasTheme` (23 named tokens) — CSS custom properties deliberately cannot reach raw ctx calls, so a 3D view must read colors from here, not from CSS.**
  - Evidence: src/ui/theme/canvas-theme.ts:13-60 — `export const canvasTheme = { viewportSurround: '#fafafa', bedFill: '#ffffff', bedStroke: '#888888', grid: '#d8d8d8', origin: '#cc0000', selection: '#1976d2', ... previewTravel: '#bbbbbb', previewFeedTravel: '#7c5ce7', previewCut: '#2563eb', previewHeadFill: '#ff3b30', previewHeadStroke: '#fff', ... } as const;` with header comment at :1-11 "Draw modules render with raw ctx fill/stroke values; CSS custom properties can't reach them"
- **CNC-specific canvas tokens already exist and are wood-toned: stock footprint fill/stroke and the CNC tab handle colors.**
  - Evidence: src/ui/theme/canvas-theme.ts:38-41 — `stockFill: 'rgba(193, 154, 107, 0.12)', stockStroke: 'rgba(160, 120, 70, 0.55)'`; :35-36 `cncTabHandleFill: '#f7c948', cncTabHandleStroke: '#5b4512'`
- **The chrome palette is `--lf-*` custom properties defined once in tokens.css under `:root`. Full list: surfaces --lf-bg-0/1/2/-input, --lf-border, --lf-border-strong; text --lf-text/-muted/-faint; semantic --lf-accent, --lf-accent-hover, --lf-danger, --lf-danger-hover, --lf-success, --lf-warning, --lf-on-fill; on-light fg --lf-accent-fg, --lf-danger-fg, --lf-success-fg, --lf-warning-fg, --lf-trace-fg; tints --lf-tint-danger/-warning/-info/-success, --lf-accent-wash; --lf-focus, --lf-backdrop, --lf-shadow; type --lf-font, --lf-font-mono, --lf-text-xs..xl; space --lf-space-1..6, --lf-radius-sm/md/lg; z --lf-z-menu/-dialog/-toast.**
  - Evidence: src/ui/theme/tokens.css:25-90 — e.g. `:24 :root {`, `:25 --lf-bg-0: #f8fafc;`, `:38 --lf-accent: #1976d2;`, `:40 --lf-danger: #c62828;`, `:88 --lf-z-menu: 100;`
- **There is exactly ONE theme — unified light chrome. tokens.css has no `prefers-color-scheme` block and no `[data-theme]` block; `color-scheme: light` is scoped to surface classes only. A 3D view does not need a dark/light variant.**
  - Evidence: src/ui/theme/tokens.css:12-17 header comment "Theme: unified light chrome. The canvas viewport keeps its light bed"; grep for `prefers-color-scheme|data-theme` in tokens.css returns no hits — only `color-scheme: light` at lines 311, 328, 394, 508, 570, 619
- **ADR-047 exists and is marked Superseded by ADR-049 for its dark-chrome color values, but its token architecture, the canvas-theme.ts partition, and the no-raw-hex policy remain in force.**
  - Evidence: DECISIONS.md:2637-2641 — `## ADR-047 - Design tokens + shared chrome classes (dark chrome, light bed)` / `**Status:** Superseded by ADR-049 (chrome is now light; the token/class architecture, kit primitives, and styling policy below remain in force — only the dark color values and the `[data-theme='light']` future-theme mechanism are replaced).`; DECISIONS.md:2768 `## ADR-049 — Unified light chrome (supersedes ADR-047's dark-chrome decision)`
- **ADR-047's no-raw-hex rule is CI-enforced by ESLint over `src/ui/**`: STRING literals matching `#rrggbb` or `rgb()/rgba()` are errors; `src/ui/theme/**` and `*.test.ts(x)` are exempt; justified exceptions carry an eslint-disable.**
  - Evidence: eslint.config.mjs:283-298 — `files: ['src/ui/**/*.ts', 'src/ui/**/*.tsx'], ignores: ['src/ui/theme/**', '**/*.test.ts', '**/*.test.tsx']` with selectors `Literal[value=/#[0-9a-fA-F]{3,8}/]` ("Raw hex color in ui/ chrome — use a var(--lf-*) token from src/ui/theme/tokens.css (ADR-047)") and `Literal[value=/rgba?\(/]`
- **The rule matches string literals only, so three.js NUMERIC hex colors (0xRRGGBB) pass without a disable — the existing 3D scene uses them unguarded.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:23-25 — `const SURFACE_COLOR = 0xb08050; const STOCK_EDGE_COLOR = 0x707070; const BACKGROUND_COLOR = 0x1c1f24;` and grep for `eslint-disable` across src/ui/relief-viewer/* returns no hits
- **Exactly two values are pinned across the tokens.css ↔ canvas-theme.ts boundary by a sync test: selection ↔ --lf-accent, out-of-bounds ↔ --lf-danger.**
  - Evidence: src/ui/theme/theme-sync.test.ts:21-27 — `expect(tokenValue(css, '--lf-accent')).toBe(canvasTheme.selection);` and `expect(tokenValue(css, '--lf-danger')).toBe(canvasTheme.outOfBounds);`
- **draw-cnc-removal.ts renders CNC depth shading as an offscreen ImageData bitmap: transparent where untouched, lerped wood ramp shallow→deep, normalized against the DEEPEST cell in the grid (not against stock thickness).**
  - Evidence: src/ui/workspace/draw-cnc-removal.ts:12-15 — `const SHALLOW_RGB = [196, 160, 116]; const DEEP_RGB = [74, 48, 28]; const SHALLOW_ALPHA = 110; const DEEP_ALPHA = 235;`; :55-59 `let deepest = 0; for (const cellDepth of grid.depth) { if (cellDepth < deepest) deepest = cellDepth; } if (deepest >= 0) return null;`; :66 `const t = Math.min(1, depth / deepest);`
- **The removal bitmap is cached per RemovalGrid instance in a WeakMap and blitted with imageSmoothingEnabled=false at grid.originX/originY in SCENE space.**
  - Evidence: src/ui/workspace/draw-cnc-removal.ts:19 `const bitmapCache = new WeakMap<RemovalGrid, HTMLCanvasElement | null>();`; :29-36 `ctx.imageSmoothingEnabled = false; ctx.drawImage(bitmap, view.offsetX + grid.originX * view.scale, view.offsetY + grid.originY * view.scale, grid.widthCells * grid.mmPerCell * view.scale, ...)`
- **draw-relief.ts is a SEPARATE grayscale heightmap preview for ReliefObject only (light=stock top, dark=floor), normalized against obj.reliefDepthMm — different ramp and different normalization from the CNC removal overlay.**
  - Evidence: src/ui/workspace/draw-relief.ts:13-14 `const TOP_GRAY = 232; const FLOOR_GRAY = 64;`; :72-75 `const depthRange = Math.max(1e-9, reliefDepthMm); const t = Math.min(1, Math.max(0, -(map.depth[i] ?? 0) / depthRange)); const gray = Math.round(TOP_GRAY + (FLOOR_GRAY - TOP_GRAY) * t);`; :12 `DISPLAY_CELLS_ACROSS = 256`
- **draw-relief.ts draws axis-aligned only — object rotation is NOT applied in v1.**
  - Evidence: src/ui/workspace/draw-relief.ts:3-4 comment "Rendered at the object's transformed AABB; rotation draws axis-aligned in v1 (noted in F-CNC7's edge states)."; :29-38 uses `transformedBBox(obj)` and a plain drawImage
- **draw-canvas-motion.ts is the LIVE-machine overlay (not preview): it draws the approach dash, FRAME START + JOB START markers with an arrow, and a live head dot with a text label showing controller state, Z (CNC only) and `Pass n/N`.**
  - Evidence: src/ui/workspace/draw-canvas-motion.ts:28-44 `drawCanvasMotionOverlay` calls drawCanvasMotionRoute / drawApproach / drawStartMarkers and, when `plan.capability === 'realtime'` and `run?.reportedHead` is set, `drawHead(...)`; :137-143 `const z = run.plan.machineKind === 'cnc' ? ` • Z ${run.reportedHead?.z.toFixed(2)} mm` : ''; drawLabel(..., `${run.controllerState ?? run.lifecycle}${z}${passLabel(run)}`)`
- **The live overlay's three fixed colors bypass the ADR-047 lint with a file-level disable justified as "scene data drawn into the always-light canvas": RED #dc2626 (markers/head/labels), COMPLETED #f87171 (burned trail), PLANNED rgba(71,85,105,0.28).**
  - Evidence: src/ui/workspace/draw-canvas-motion.ts:1-2 `/* eslint-disable no-restricted-syntax -- controller motion is scene data drawn into the always-light canvas; fixed colors keep the safety trail unambiguous. */`; :19-24 `const RED = '#dc2626'; ... const COMPLETED = '#f87171'; const PLANNED = 'rgba(71, 85, 105, 0.28)';`
- **Pass progress on the live overlay is derived from confirmed route distance against cncPassSpans — it freezes when the route is uncertain, and is omitted entirely rather than guessed.**
  - Evidence: src/ui/workspace/draw-canvas-motion.ts:149-154 `const spans = run.plan.cncPassSpans; if (spans === undefined) return ''; const passes = cncPassPosition(spans, run.route.confirmedRouteMm); return passes === null ? '' : ` • Pass ${passes.current}/${passes.total}`;`; src/ui/state/canvas-pass-progress.ts:65-74 `cncPassPosition` returns `{current, total, remaining}`
- **draw-canvas-motion-route.ts draws the route in three styles at fixed DEVICE pixel widths: planned 1.2px, completed process 2.4px solid, completed travel 1.5px dashed [6,4]; plunge blocks are skipped entirely (no XY extent).**
  - Evidence: src/ui/workspace/draw-canvas-motion-route.ts:49-51 `strokeScenePath(ctx, cached.planned, view, plannedColor, 1.2, []); strokeScenePath(ctx, cached.process, view, completedColor, 2.4, []); strokeScenePath(ctx, cached.travel, view, completedColor, 1.5, [6, 4]);`; :178 `if (block.kind === 'plunge' || block.points.length < 2) return;`; :245-259 `strokeScenePath` sets `ctx.lineWidth = widthPx / view.scale` under a scene-space setTransform
- **The route layer is incrementally rasterized into an offscreen canvas keyed by a viewKey of canvas size + scale + offsets; only the newly-confirmed route range is appended each frame, and it resets when the route rewinds.**
  - Evidence: src/ui/workspace/draw-canvas-motion-route.ts:127 `const viewKey = `${target.width}:${target.height}:${view.scale}:${view.offsetX}:${view.offsetY}`;`; :110-116 `if (target < cached.confirmedRouteMm) { resetRouteRaster(...) } appendConfirmedRasterRange(...); ctx.drawImage(cached.canvas, 0, 0);`
- **The live overlay renders on a SECOND stacked canvas above the base scene canvas, so a 3D view has an existing precedent for a separate compositing layer.**
  - Evidence: src/ui/workspace/WorkspaceCanvasLayers.tsx:47-54 second `<canvas ref={motionRef} ... data-testid="canvas-motion-layer" />` with `canvasMotionLayerStyle` = `{ position: 'absolute', inset: 0, ..., pointerEvents: 'none' }` at :66-72
- **Preview-mode 2D layering order is: faint artwork (30% alpha) → raster sim → CNC removal depth shading → route lines. This is the order a 3D view should mirror.**
  - Evidence: src/ui/workspace/draw-scene.ts:156-181 `drawPreviewModeScene` calls `drawObjectsFaint` then `drawRasterPreview` then `if (opts.cncRemovalGrid != null) drawCncRemoval(...)` then `drawPreview(...)`; src/ui/workspace/draw-preview.ts:46-47 `ctx.globalAlpha = 0.3;`
- **The preview route itself draws future path at 0.18 alpha, completed at 0.72 alpha, with a red head marker only while scrubberT < 1.**
  - Evidence: src/ui/workspace/draw-preview.ts:123-136 — `if (showFuture && scrubberT < 1) { ctx.globalAlpha = 0.18; drawWholeSteps(...) }`, then `ctx.globalAlpha = 0.72; drawWholeSteps(ctx, sliced.whole, ...)`, then `if (sliced.head !== null && scrubberT < 1) drawHead(ctx, sliced.head, view);`
- **Live machine state reaches the UI through ONE Zustand store (useLaserStore) with these selectors: `state.liveCanvasRun` (whole live run), `state.statusReport` (raw GRBL frame), `state.wcoCache`, `state.workOriginActive`, `state.streamer`, `state.trustedPositionEpoch`, `state.connection`.**
  - Evidence: src/ui/state/laser-store.ts:95,97,121,126,144,170,190 — `readonly connection: ConnectionState;`, `readonly statusReport: StatusReport | null;`, `readonly streamer: StreamerState | null;`, `readonly liveCanvasRun?: LiveCanvasRun | null;`, `readonly trustedPositionEpoch?: number;`, `readonly wcoCache: WorkCoordinateOffset | null;`, `readonly workOriginActive: boolean;`
- **`LiveCanvasRun` is the single struct carrying everything a 3D live view needs: reportedHead {x,y,z}, route.confirmedRouteMm, lifecycle, controllerState, reportedFeedMmPerMin, reportedSpindleRpm, startedAtMs, endedAtMs, plus plan (manifest + cncPassSpans).**
  - Evidence: src/ui/state/canvas-motion-plan.ts:64-86 — `export type LiveCanvasRun = { readonly plan: CanvasMotionPlan; readonly reportedHead: MotionPoint | null; readonly route: RouteReconciliationState; readonly lifecycle: LiveCanvasLifecycle; readonly controllerState: string | null; readonly accuracyReason: string | null; readonly reportedFeedMmPerMin: number | null; readonly reportedSpindleRpm: number | null; readonly startedAtMs: number; readonly endedAtMs: number | null; }`
- **The recommended UI-side selector for the live run is `useLaserStore((state) => state.liveCanvasRun ?? null)`, already used by the canvas overlay hook, which returns a `{plan, run, showStartMarkers}` overlay object.**
  - Evidence: src/ui/workspace/use-canvas-motion-overlay.ts:34 `const liveRun = useLaserStore((state) => state.liveCanvasRun ?? null);`; :76-79 `if (liveRun !== null && !staleTerminalRun) { return { plan: liveRun.plan, run: liveRun, showStartMarkers }; }`
- **Feed and RPM are fresh scalar samples written on every status frame; spindle is passed through UNSCALED and is RPM only on CNC (on a laser the same FS: slot is the power S value, ADR-220).**
  - Evidence: src/ui/state/live-canvas-run.ts:38-44 `const reportedFeedMmPerMin = normalizeReportedFeedRateToMm(report.feed, reportInches); ... reportedFeedMmPerMin, reportedSpindleRpm: report.spindle,`; src/ui/workspace/canvas-motion-badge.tsx:143-150 `if (overlay.plan.machineKind !== 'cnc') return ''; if (run.lifecycle !== 'running' || run.reportedSpindleRpm === null) return '';`
- **Feed/RPM/elapsed are shown only while `lifecycle === 'running'` — a held/finished run reports 0 and a stopped run's last sample is stale. A 3D readout must keep that gating.**
  - Evidence: src/ui/workspace/canvas-motion-badge.tsx:132-138 comment "Feed is only meaningful while the machine is actively cutting: a held or finished run reports 0..." + `if (run.lifecycle !== 'running' || run.reportedFeedMmPerMin === null) return '';`
- **Live readouts are also exposed as machine-readable DOM data-attributes on a visually-hidden probe span — the existing verification seam for these values.**
  - Evidence: src/ui/workspace/canvas-motion-badge.tsx:52-65 `<span data-testid="canvas-motion-probe" data-lifecycle data-confirmed-route-mm data-reported-head-x data-reported-head-y data-pass-current data-pass-total data-reported-feed data-reported-spindle data-elapsed-seconds ... />`
- **Raw controller position for a non-job readout comes from `statusReport.mPos ?? statusReport.wPos` plus `wcoCache` (never `statusReport.wco`, which is null on most frames).**
  - Evidence: src/ui/laser/StatusDisplay.tsx:14-18 `const report = useLaserStore((s) => s.statusReport); const wcoCache = useLaserStore((s) => s.wcoCache); ... const pos = report.mPos ?? report.wPos;` with header comment at :6-10 explaining the wcoCache rule
- **`scrubberT` lives in the UI Zustand store (`useUiStore`) as a 0..1 fraction of TOTAL PATH LENGTH (arc length), default 1, clamped on write. Companion state: previewPlaying, previewPlaybackSpeed ('slow'|'normal'|'fast'), showPreviewTravel, showCanvasStartMarkers.**
  - Evidence: src/ui/state/ui-store.ts:122-131 `readonly scrubberT: number; // 0..1 fraction along total path length; F-A8` ... `readonly previewPlaying: boolean; ... readonly previewPlaybackSpeed: PreviewPlaybackSpeed;`; :303-314 `scrubberT: 1, setScrubberT: (next) => set({ scrubberT: clamp01(next) }), ... previewPlaying: false, ... previewPlaybackSpeed: 'normal',`
- **Playback is a rAF loop in usePreviewPlayback that advances scrubberT via a time-based timeline (1x/10x/40x), auto-rewinds from 1 on play, and stops itself at 1.**
  - Evidence: src/ui/workspace/use-preview-playback.ts:12-16 `const PLAYBACK_RATE: Record<PreviewPlaybackSpeed, number> = { slow: 1, normal: 10, fast: 40 };`; :56-60 `if (scrubberRef.current >= 1) { scrubberRef.current = 0; ... setScrubberT(0); }`; :80-83 `if (next >= 1) { setPreviewPlaying(false); return; }`
- **Scrubber UI = a range input (step 0.005) in overlays.tsx, plus Play/Pass-step/Restart/Speed controls in preview-overlays.tsx. CNC pass boundaries for the stepper are derived from DOWNWARD plunge steps' arc-length fractions.**
  - Evidence: src/ui/workspace/overlays.tsx:129-147 `PreviewScrubber` with `<input type="range" min={0} max={1} step={0.005} value={scrubberT} ... />`; src/ui/workspace/preview-overlays.tsx:182-193 `passBoundaryFractions` — `if (step.kind === 'plunge' && step.toZ < step.fromZ) { fractions.push(walked / toolpath.totalLength); }`
- **The scrubber feeds the removal grid via a QUANTIZED bucket (120 buckets) so dragging reuses memoized grids; UI grid targets ~1000 cells/axis.**
  - Evidence: src/ui/workspace/use-cnc-removal-grid.ts:21-23 `const SCRUB_BUCKETS = 120;` / `const UI_TARGET_CELLS_PER_AXIS = 1000;`; :34 `const quantT = Math.ceil(Math.max(0, Math.min(1, scrubberT)) * SCRUB_BUCKETS) / SCRUB_BUCKETS;`; :62 `{ uptoLengthMm: toolpath.totalLength * quantT }`
- **A three.js scene already exists and ADR-102 constrains it: three.js is UI-only, importable ONLY beneath src/ui/relief-viewer/, must be lazy-loaded via dynamic import(), and must fall back gracefully with no WebGL. A new 3D view must live under that path or amend the ADR.**
  - Evidence: DECISIONS.md:4577-4590 — "**three.js is UI-only.** It may be imported beneath `src/ui/relief-viewer/` and nowhere else — never in `core/` or `io/`" and "**Lazy-loaded.** The viewer dialog imports three via dynamic `import()`"; src/ui/relief-viewer/relief-three-scene.ts:1-3 "the ONLY module that touches three.js (ADR-102 §2: three is UI-only, lazy-loaded)"; :33-34 `const three = await import('three'); const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');`
- **The existing 3D scene is Z-up, renders ON DEMAND (no rAF loop — only on OrbitControls 'change' and resize), mirrors Y, recenters on origin, and draws a wire stock box from z=0 down one thickness.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:84 `camera.up.set(0, 0, 1); // Z-up: depth reads vertically`; :89-92 `const controls = new OrbitControls(camera, canvas); const render = (): void => renderer.render(scene, camera); controls.addEventListener('change', render); render();`; :56-57 `geometry.scale(1, -1, 1); geometry.translate(-mesh.widthMm / 2, mesh.heightMm / 2, 0);`; :70-76 stock BoxGeometry + EdgesGeometry positioned at `-stockThicknessMm / 2`
- **The 3D surface color (0xb08050) is documented as matching the 2D canvas depth map — so 2D/3D color parity is already an explicit intent, but the value is NOT pinned to canvasTheme by any test.**
  - Evidence: src/ui/relief-viewer/relief-three-scene.ts:23 `const SURFACE_COLOR = 0xb08050; // carved-wood tone, matches the canvas depth map` — vs src/ui/workspace/draw-cnc-removal.ts:12-13 SHALLOW_RGB [196,160,116] = 0xc4a074 and DEEP_RGB [74,48,28] = 0x4a301c; theme-sync.test.ts pins only --lf-accent and --lf-danger
- **A live 3D CNC pane already ships (Cnc3DPane) — it is a resizable, collapsible rail that recomputes its OWN coarse removal grid on every edit (500 cells/axis compute, 300 display) and rebuilds the whole three scene from scratch whenever the grid or thickness changes.**
  - Evidence: src/ui/workspace/Cnc3DPane.tsx:29-32 `const PANE_TARGET_CELLS_PER_AXIS = 500; const PANE_DISPLAY_CELLS_ACROSS = 300; const CANVAS_WIDTH_PX = 244; const CANVAS_HEIGHT_PX = 240;`; :131-161 the effect calls `createReliefThreeScene(canvas, reliefSurfaceMesh(display), thickness)` with deps `[grid, thickness]` and `handleRef.current?.dispose()` on cleanup
- **RemovalGrid is structurally a Heightmap, so `reliefSurfaceMesh(grid)` consumes it directly — the 2D depth data and the 3D mesh come from the SAME pure core value. Both existing 3D consumers downsample first.**
  - Evidence: src/ui/relief-viewer/Cut3DPreviewDialog.tsx:26-29 `const display = downsampleRemovalGrid(grid, DISPLAY_CELLS_ACROSS); // RemovalGrid is structurally a Heightmap (cells + depth field), so the relief mesh builder consumes it directly. return await createReliefThreeScene(canvas, reliefSurfaceMesh(display), stockThicknessMm);`; src/core/sim/removal-grid.ts:6-15 RemovalGrid {widthCells, heightCells, mmPerCell, originX, originY, depth: Float32Array}
- **reliefSurfaceMesh returns plain typed arrays in a heightmap-local frame with Z as depth (0 at stock top, negative into the material) — usable by any renderer without WebGL.**
  - Evidence: src/core/relief/relief-surface-mesh.ts:1-18 — "One vertex per heightmap cell center, two triangles per cell quad; Y is the heightmap row axis and Z is depth (0 at the stock top, −reliefDepthMm at the floor)." and `export type ReliefSurfaceMesh = { positions: Float32Array; indices: Uint32Array; widthMm: number; heightMm: number; }`
- **The motion manifest is already 3D: MotionPoint carries z, block distance uses a 3-axis hypot, and blocks are typed travel/process/plunge/park with route start/end distances — so a 3D route ribbon can be built without new core work.**
  - Evidence: src/core/job/motion-manifest.ts:3-23 `export type MotionPoint = { readonly x, y, z: number };` ... `export type MotionBlockKind = 'travel' | 'process' | 'plunge' | 'park';` with `points`, `lengthMm`, `routeStartMm`, `routeEndMm`; src/ui/workspace/draw-canvas-motion-route.ts:339-341 `function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); }`
- **The 2D preview route DELIBERATELY drops plunges (no XY extent) and defers depth to the removal grid — the biggest thing a 3D view can add over the 2D canvas.**
  - Evidence: src/ui/workspace/draw-preview.ts:261-263 — `} else if (step.kind === 'plunge') { // Vertical-only move — no XY extent to draw in the 2D route. The depth-shaded CNC preview (H.2 removal grid) is where plunges show.`
- **The 2D removal grid is computed ONLY in preview mode — a live run never produces one, so today no depth visualization tracks the live machine.**
  - Evidence: src/ui/workspace/use-cnc-removal-grid.ts:37 `if (!previewMode || cncMachine === null || toolpath === null) return null;`; src/ui/workspace/use-canvas-motion-overlay.ts:75 `if (previewMode) return null;` — the two paths are mutually exclusive
- **No 3D surface currently consumes live machine state: Cnc3DPane reads only project/outputScope, and Cut3DPreviewDialog takes a static grid + thickness. Wiring liveCanvasRun into 3D would be new.**
  - Evidence: src/ui/workspace/Cnc3DPane.tsx:17-18 imports only `activeCncTool, type OutputScope, type Project` and `useOutputScope, useStore` — no useLaserStore; src/ui/relief-viewer/Cut3DPreviewDialog.tsx:17-21 props are `{ grid: RemovalGrid; stockThicknessMm: number; onClose }`
- **The 3D dialog shell already implements the loading/ready/failed state machine and dispose-on-unmount contract a new viewer should reuse, and it styles its chrome with --lf-* tokens.**
  - Evidence: src/ui/relief-viewer/Viewer3DDialogShell.tsx:13-16 `type ViewerState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; reason: string };`; :84-96 `background: 'var(--lf-backdrop)'` / `background: 'var(--lf-bg-1)', color: 'var(--lf-text)', border: '1px solid var(--lf-border)'`
- **The 3D pane's collapsed/expanded state and width are persisted preferences with named localStorage keys and a media-query default — reuse these rather than adding new view state.**
  - Evidence: src/ui/workspace/use-cnc-canvas-focus.ts:3-4 `export const CNC_CANVAS_FOCUS_QUERY = '(max-width: 1439px)'; export const CNC_PANE_VISIBILITY_STORAGE_KEY = 'laserforge.cnc-3d-pane-visibility.v1';`; src/ui/workspace/use-cnc-pane-width.ts:10-15 `MIN_PANE_WIDTH_PX = 200; MAX_PANE_WIDTH_PX = 560; DEFAULT_PANE_WIDTH_PX = 260; const STORAGE_KEY = 'laserforge.cnc-3d-pane-width.v1';`
- **three is a real runtime dependency at ^0.180.0 with @types/three ^0.185.0 — a version skew between the runtime and its types exists in package.json.**
  - Evidence: package.json:57 `"three": "^0.180.0",` and package.json:68 `"@types/three": "^0.185.0",`
- **The 2D scene-space→canvas mapping every draw module uses is a uniform scale + offset (no rotation), computed once per frame by computeView; a 3D view can adopt the same ViewTransform contract for XY.**
  - Evidence: src/ui/workspace/draw-canvas-motion.ts:175-177 `function sceneToCanvas(point: Vec2, view: ViewTransform): Vec2 { return { x: view.offsetX + point.x * view.scale, y: view.offsetY + point.y * view.scale }; }`; src/ui/workspace/draw-scene.ts:101-107 `const view = computeView(canvasW, canvasH, project.device.bedWidth, project.device.bedHeight, opts.view);`

### Relevant files

- `src/ui/theme/canvas-theme.ts`
- `src/ui/theme/tokens.css`
- `src/ui/theme/theme-sync.test.ts`
- `eslint.config.mjs`
- `DECISIONS.md`
- `package.json`
- `src/ui/workspace/draw-cnc-removal.ts`
- `src/ui/workspace/draw-relief.ts`
- `src/ui/workspace/draw-canvas-motion.ts`
- `src/ui/workspace/draw-canvas-motion-route.ts`
- `src/ui/workspace/draw-preview.ts`
- `src/ui/workspace/draw-scene.ts`
- `src/ui/workspace/draw-stock.ts`
- `src/ui/workspace/draw-bed-chrome.ts`
- `src/ui/workspace/canvas-motion-badge.tsx`
- `src/ui/workspace/use-canvas-motion-overlay.ts`
- `src/ui/workspace/use-cnc-removal-grid.ts`
- `src/ui/workspace/use-preview-playback.ts`
- `src/ui/workspace/preview-overlays.tsx`
- `src/ui/workspace/overlays.tsx`
- `src/ui/workspace/Workspace.tsx`
- `src/ui/workspace/WorkspaceCanvasLayers.tsx`
- `src/ui/workspace/Cnc3DPane.tsx`
- `src/ui/workspace/Cnc3DPaneToggle.tsx`
- `src/ui/workspace/use-cnc-canvas-focus.ts`
- `src/ui/workspace/use-cnc-pane-width.ts`
- `src/ui/relief-viewer/relief-three-scene.ts`
- `src/ui/relief-viewer/Cut3DPreviewDialog.tsx`
- `src/ui/relief-viewer/Relief3DViewerDialog.tsx`
- `src/ui/relief-viewer/Viewer3DDialogShell.tsx`
- `src/ui/state/ui-store.ts`
- `src/ui/state/laser-store.ts`
- `src/ui/state/live-canvas-run.ts`
- `src/ui/state/canvas-motion-plan.ts`
- `src/ui/state/canvas-pass-progress.ts`
- `src/ui/laser/StatusDisplay.tsx`
- `src/core/sim/removal-grid.ts`
- `src/core/sim/index.ts`
- `src/core/relief/relief-surface-mesh.ts`
- `src/core/relief/index.ts`
- `src/core/job/motion-manifest.ts`

### Could not verify

- UNVERIFIED (perceptual): I did not render anything. Every claim about colors and layering comes from reading source, not from looking at pixels. Per CLAUDE.md rule 2, none of this is proof the 2D or 3D output currently LOOKS right.
- UNVERIFIED: I did not run pnpm test / lint / typecheck / format:check (task is read-only), so I cannot say whether the tree is currently green.
- UNVERIFIED: whether the three.js SURFACE_COLOR 0xb08050 actually matches the 2D removal ramp perceptually. The comment claims it does, but 0xb08050 is not either endpoint of the 2D ramp (SHALLOW 0xc4a074 / DEEP 0x4a301c) and no test pins them.
- UNVERIFIED: whether `Literal[value=/#.../]` in ESLint really coerces NUMERIC literals to a string that cannot match. I reasoned this from the selector plus the absence of any eslint-disable in relief-three-scene.ts; I did not run ESLint to confirm 0xb08050 passes.
- UNVERIFIED: I read only lines 1-140 of src/ui/state/canvas-motion-plan.ts (the type definitions) — I did not read its plan-construction body, so I cannot describe how coordinateFrame/machine vs relative mapping is computed beyond the mapControllerPointToScene call sites.
- UNVERIFIED: I did not read the full 15.7KB src/ui/theme/tokens.css — the --lf-* list above is the complete set of custom-property DEFINITIONS found by grep, but I did not enumerate the .lf-* utility classes (.lf-btn, .lf-rail, .lf-dialog*, .lf-banner--*, .lf-chip, etc.) beyond what ADR-047 names.
- UNVERIFIED: I did not check WORKFLOW.md or PROJECT.md for whether a live/3D CNC view is in the current phase or has an existing user flow spec (F-CNC entries). ADR-102's UI-only/relief-viewer-only import boundary may need a maintainer decision or an ADR amendment before three.js is imported from a new directory.
- UNVERIFIED: whether the removal-grid recompute cost is acceptable at higher 3D fidelity. Cnc3DPane rebuilds the ENTIRE three scene (new geometry, new renderer) on every grid change; I did not profile it.

---

# Part 3 — External research

How best-in-class CAM viewers are built, modern three.js technique, and material-removal
simulation algorithms.

## 3.1 How best-in-class CNC CAM toolpath viewers/simulators look and are built — source-verified rendering techniques from gcode-preview, CAMotics, Kiri:Moto, jscut, OpenBuilds CONTROL, ncviewer.com, gcode-viewer (npm), plus documented behavior of Fusion 360, LightBurn, Easel, Carbide Create. All three.js advice verified against the three@0.180.0 actually installed in this repo.

### Depth-buffer-as-heightmap material removal (jscut, GPU, 2 passes)

The single best cost/benefit technique found. jscut simulates the cut workpiece entirely on the GPU with zero CPU voxel work. Pass 1 rasterizes the toolpath's swept volume into an offscreen framebuffer viewed straight down; the depth test itself resolves the minimum reachable Z per texel, so the depth/color buffer IS the machined heightmap. Pass 2 renders that texture as a displaced grid surface. Each move emits exactly 18 vertices: 2 triangles for a quad at the lower endpoint, 2 for a quad at the upper endpoint, 2 for the connecting rectangle (offset by the perpendicular of the XY direction times cutter radius). The fragment shader turns the two endpoint quads into true round cutter footprints with `if (radius > 0.0 && distance(gl_FragCoord.xy, center) > radius) discard;`. A `stopAtTime` uniform linearly clamps pos2 toward pos1 inside the vertex shader, so scrubbing/playback is free — no geometry rebuild, just a uniform change.

**In three.js.** Pass 1: build one non-indexed BufferGeometry with 18 verts per move and attributes `pos1`(vec3), `pos2`(vec3), `startTime`, `endTime`, `command`(float 0..17). Use a RawShaderMaterial/ShaderMaterial with `depthTest:true, depthWrite:true, depthFunc:LessEqualDepth`, and write `gl_Position` directly in NDC (skip the camera matrices entirely — it's an implicit orthographic top view). Map Z with `gl_Position.z = 1.9999*(z - bottom)/(top - bottom) - 1.0`. Render into `new THREE.WebGLRenderTarget(N, N, {depthBuffer:true, type:HalfFloatType or UnsignedByteType})` via `renderer.setRenderTarget(rt)`. Store normalized cut depth in the red channel (`color.r = (z - pathTopZ)/(bottom - pathTopZ)`). Pass 2: `new THREE.PlaneGeometry(w, h, N-1, N-1)` with a ShaderMaterial whose vertex shader does `float z = texture2D(heightMap, uv).r;` and displaces position. N=1024 gives ~0.15 mm resolution on a 150 mm part. Use `renderer.getContext()` only if you need raw depth readback; otherwise the R channel is enough.

**Cost / benefit.** Highest visual payoff per line of code in this whole list. O(moves) GPU work regardless of stock resolution, and instant time-scrubbing via one uniform. Limits: strictly 2.5-D (top-down heightmap — no undercuts, no 4th/5th axis, no flip jobs), and cutter shape is only a flat/round disk unless you extend the fragment shader to modulate depth by radial distance (add `gl_FragDepth` offset for a ballnose). For a GRBL router app this is exactly the right constraint.

### CPU heightmap grid with a precomputed tool profile stencil (Kiri:Moto CAM anim-2d)

Kiri:Moto's shipping CNC material-removal animation. The stock is a regular XY grid of Float32 vertices (`stepsX * stepsY`, two triangles per cell, index buffer built once). The cutter is precomputed once per tool into a flat `Float32Array` of `(dx, dy, dz)` triples — a discretized stencil of the tool's underside sampled at grid resolution. Cutting is then a trivial min-blend: for each stencil entry, `const tz = tool.pos.z - dz; if (tz < grid[iz]) grid[iz] = tz;`. Long moves are subdivided so no step exceeds one grid cell (`st = ceil(max(|dx|,|dy|,|dz|) / rez)`), and moves shorter than one cell are skipped outright. The grid buffer lives in a `SharedArrayBuffer` so the worker mutates the exact Float32Array that three.js is drawing — the main thread only sets `needsUpdate`. The tool itself is rendered as a second heightmap grid built from the same profile (so a ballnose looks like a ballnose for free).

**In three.js.** `const sab = new SharedArrayBuffer(nx*ny*3*4); const pos = new Float32Array(sab); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(new Uint32Array(ind), 1));` Worker writes into `pos` directly; main thread does `mesh.geometry.attributes.position.needsUpdate = true` (and skip `computeVertexNormals()` per frame — do it every N frames or use a flat-shaded MeshPhongMaterial with `flatShading:true` as Kiri does, `transparent:true, opacity:0.9, side:DoubleSide`). Tool profile generation: iterate a square of pixels of side `ceil(shaftDia/rez)`, keep those inside flute radius, and set dz per shape — ball: `sqrt(rPix² - dist²)*rez - fluteRad`; taper: `((dist - tipRadPix)/tipMaxRadOffset) * -fluteLen`; flat: 0; plus a shaft ring at `-fluteLen` when shaftDia > fluteDia. SharedArrayBuffer needs COOP/COEP headers; fall back to a transferable ArrayBuffer ping-pong if you can't set them.

**Cost / benefit.** Works with zero GPU features, easy to debug, and the tool-profile stencil is genuinely tiny code. Cost is CPU-bound: O(moves × stencil area), so a 6 mm endmill at 0.25 mm resolution is ~450 grid writes per step. Kiri mitigates with speed multipliers and a `depth > 600` yield. Good fallback and good for a step-through debugger; the jscut GPU approach is better for a fluid preview.

### Manifold WASM CSG boolean subtraction on sliced stock (Kiri:Moto CAM anim-3d)

Kiri's high-fidelity/indexed (4th-axis) path. Real mesh booleans, not a heightmap. Stock is a `Manifold.cube([x,y,z], true)` that is split into N slabs along X (`sliceCount = animesh/100`, each `new Stock(sliceWidth, y, z).translate(xmin,0,0)`), so each subtraction only touches the slabs the tool overlaps and the resulting meshes stay small. The tool swept volume is composed from `Manifold.cylinder` + `Manifold.sphere` primitives, and each affected slab does `this.mesh = this.mesh.subtract(toolMesh.mesh)`. Because it's a true B-rep, it handles undercuts, rotary/indexed stock and multi-side setups that a heightmap cannot.

**In three.js.** Add `manifold-3d` (WASM, Apache-2.0) as a worker-side dep. Convert to three via `const m = manifoldMesh.getMesh(); geo.setAttribute('position', new THREE.BufferAttribute(m.vertProperties, 3)); geo.setIndex(new THREE.BufferAttribute(m.triVerts, 1)); geo.computeVertexNormals();` Keep the whole CSG loop in a worker and only post the vertex/index arrays back (transferable). Batch: accumulate the swept volume of K consecutive moves into one Manifold union before subtracting, otherwise you pay a full boolean per move.

**Cost / benefit.** Highest fidelity and the only option that survives rotary/indexed work, but orders of magnitude slower than either heightmap approach and mesh complexity grows monotonically. Kiri gates it behind `controller.manifold` and reserves it for the 3D/indexed mode. Only worth it for LaserForge if 4th-axis or flip jobs are on the roadmap; otherwise skip.

### Implicit signed distance field + Marching Cubes / Cubical Marching Squares on an adaptive grid tree (CAMotics)

Correcting a premise in the brief: CAMotics is NOT dexel-based. It builds an implicit scalar field and isosurfaces it. `CutWorkpiece::depth(p)` returns `min(workpiece.depth(p), -toolSweep.depth(p))` — a CSG difference expressed as a field, never as stored geometry. `ToolSweep` is an AABB tree of per-move swept bounding boxes; a point query collects intersecting moves, sorts them by start time, and evaluates the per-tool analytic sweep (`ConicSweep` for cylindrical/conical/snubnose, `SpheroidSweep` for ball/spheroid, `CompositeSweep`). The surface is extracted by `Renderer::render()` which partitions space into `2^(ceil(log2(threads))+2)` `GridTreeRef` jobs run on a thread pool, with two `RenderMode`s: `MCUBES_MODE` (`CorrectedMC33` — Marching Cubes 33 with the topology corrections) and `CMS_MODE` (`CubicalMarchingSquares`, backed by `QEF.cpp` for dual-contouring-style feature-preserving vertex placement, which is why CAMotics keeps sharp edges that plain MC would round off).

**In three.js.** The three.js equivalent is a compute-in-worker + streamed BufferGeometry: implement `depth(p)` as a JS/WASM function over analytic tool sweeps, run a marching-cubes kernel over chunked grids in N workers, and post back position+normal Float32Arrays per chunk. Practical shortcut: use the marching-cubes implementation in `three/addons/objects/MarchingCubes.js` for prototyping, but it is a fixed-resolution metaball demo — for real work write your own chunked MC and skip empty cells using an AABB tree of move bboxes (the `cull()`/`getBounds()` trick CAMotics uses is what makes it tractable). Use QEF/dual-contouring vertex placement if sharp corners matter.

**Cost / benefit.** Best geometric generality of the open-source options (handles any tool shape analytically, exports STL) and thread-parallel by construction, but it is a batch computation, not a live animation — CAMotics re-renders the surface rather than incrementally updating it. Far more implementation work than jscut's two shaders. Cite it as the reference for correctness, not as the thing to copy.

### Tri-dexel (the commercial standard: ModuleWorks / RhinoCAM / Fusion)

A dexel is a 'depth element' — a ray that stores entry/exit depth intervals along one axis. Tri-dexel stores three orthogonal ray fields (X, Y, Z) simultaneously and merges them into a polygonal surface for display. It is the accuracy/speed compromise the commercial CAM industry standardized on: voxels are fast but directionally biased and cannot do undercuts; polygonal/B-rep booleans are exact but degrade badly with toolpath complexity; tri-dexel gets near-polygonal accuracy at 2×–7× the speed, and GPU tri-dexel is now shipping (MecSoft 2026 on CUDA).

**In three.js.** Not realistically implementable in three.js in reasonable time — mention it only as the reason a single-axis heightmap looks 'flat' next to Fusion. If you ever need undercuts without full CSG, the cheap 80% is dual-dexel: run the jscut depth-buffer pass twice (top view and a second axis), and use the second field only to mask undercut regions.

**Cost / benefit.** Reference-quality; out of scope for a browser app. Named here so the technique choice is a deliberate one rather than an omission.

### Fat lines: LineSegments2 + LineSegmentsGeometry + LineMaterial

How gcode-preview and Kiri:Moto both get toolpaths that read as ribbons rather than 1px hairlines. gcode-preview flattens every path into a `lineVertices` array of paired endpoints and builds ONE `LineSegments2` per color per chunk. Note the sharp contrast with ncviewer.com, whose bundle contains only `LineSegments`/`BufferGeometry` (no Line2) — that is exactly why ncviewer looks thin and dated next to Kiri or a modern slicer preview. This is the cheapest single visual upgrade available.

**In three.js.** `import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'; import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'; import { LineMaterial } from 'three/addons/lines/LineMaterial.js';` (both `three/addons/*` and `three/examples/jsm/*` resolve in the 0.180.0 installed here — verified in its package.json exports map). `const g = new LineSegmentsGeometry().setPositions(flatXYZPairs); const m = new LineMaterial({ color, linewidth: 2, worldUnits: false });` Set `worldUnits:true` to express linewidth in mm (so it scales with zoom like real cut width) or leave false for constant screen-space px. r180's LineMaterial also exposes `dashed` (+`dashSize`/`gapSize`, needs `computeLineDistances()`) — use dashed for rapids, solid for cuts. `alphaToCoverage:true` softens edges when MSAA is on. LineMaterial needs `resolution` set on resize.

**Cost / benefit.** Very high payoff, ~20 lines. Costs 4 verts + 2 tris per segment vs 2 verts, and one draw call per material — batch aggressively by color. Caveat carried over from gcode-preview's source: `LineSegments2` does not support a material array, so per-segment coloring needs either separate objects or the instanceColor path.

### Per-segment color in ONE mesh via geometry.addGroup + material array (Kiri:Moto)

Kiri's key batching trick, and the reason its speed-colored toolpaths stay at a handful of draw calls. Rather than one object per color, it accumulates vertices in a single buffer and records color RUNS: when the color changes it rewrites the previous run's count and pushes `{start, count, materialIndex}`. Then `cface.forEach((c,i) => geo.addGroup(c.start, c.count, i))` and `new THREE.Mesh(geo, matArray)`. Same pattern for line geometry (`grp.push([vl, Infinity, cc.idx])` with the previous group's count patched retroactively) and for the extruded `paths` geometry (`cpath`).

**In three.js.** Build one interleaved position/normal buffer while walking the program. Maintain `runs = [{start, count, color}]`; on color change, `runs.at(-1).count = currentVertexIndex - runs.at(-1).start` and push a new run. Then `runs.forEach((r,i) => geo.addGroup(r.start, r.count, i)); new THREE.Mesh(geo, runs.map(r => makeMat(r.color)))`. Cache materials in a `Map<hex, Material>` (both gcode-preview and Kiri do this) so N runs of M distinct colors compile M programs, not N.

**Cost / benefit.** Turns thousands of draw calls into a handful. Works for Mesh and plain LineSegments; does NOT work for LineSegments2. Modest complexity. This is the pattern to use if you want per-move coloring (speed, depth, pass index, operation) without a perf cliff.

### Volumetric toolpath ribbon/tube geometry (three approaches, all readable)

When a line isn't enough and you want the path to have real cut width and height. Three shipping implementations: (a) gcode-preview's `ExtrusionGeometry` — a custom BufferGeometry that sweeps a rounded rectangular cross-section (independent `lineWidth` × `lineHeight`, 8 radial segments) along the point list, computing the frame per-corner instead of using `computeFrenetFrames` (`tangent = normalize(normalize(P - Pprev) + normalize(Pnext - P))`, then a min-axis-picked normal and `B = cross(tangent, N)`); it scales X/Y by `lineWidth*0.5` and Z by `lineHeight*0.5`, which is what makes it read as a flattened bead rather than a round tube. (b) Kiri's `pathTo3D` — takes a 2D offset outline (left/right rails), emits top faces at `z+height`, bottom at `z-height`, then quad walls along both rails plus end caps, with hand-authored normals (never `computeVertexNormals`, which would smear the crease). (c) aligator/gcode-viewer's `LineTubeGeometry` — a true Frenet-framed tube with a per-vertex `color` attribute.

**In three.js.** For CNC, (a) or (b) is the right shape — a cut is wider than it is deep. Port `ExtrusionGeometry` almost verbatim: set `lineWidth = toolDiameter`, `lineHeight = stepdown`, `radialSegments = 6..8`. Push each path's geometry into an array and merge (see the BatchedMesh entry). Set the normal attribute explicitly; `computeVertexNormals()` on a ribbon rounds off exactly the edges you want crisp.

**Cost / benefit.** Turns a toolpath diagram into something that reads as material. ~8× the vertex count of fat lines (8 radial segments × 2 rings per point) — gcode-preview keeps it behind a `renderTubes` flag for exactly that reason. Good default: fat lines for the whole program, tubes only for the current operation or a Z-range slice.

### BatchedMesh for thousands of path geometries under one material

gcode-preview's answer to draw-call explosion in tube mode: every path becomes its own BufferGeometry, then all of them go into a single `BatchedMesh` sharing one material. `BatchedMesh` is in three core (verified present in the 0.180.0 build here) — no addon import.

**In three.js.** `const maxVerts = geometries.reduce((a,g) => g.attributes.position.count*3 + a, 0); const bm = new THREE.BatchedMesh(geometries.length, maxVerts, undefined, material); geometries.forEach(g => { const id = bm.addGeometry(g); bm.addInstance(id); });` BatchedMesh also gives you free per-instance visibility (`setVisibleAt`) and per-instance color (`setColorAt`) — which is a cleaner way to do pass-by-pass reveal or per-operation highlight than rebuilding geometry. Reserve capacity up front; `addGeometry` past the reserved count throws.

**Cost / benefit.** Huge win (thousands of draws → one) with a small API surface. Requires knowing total vertex count up front, and per-instance frustum culling is coarser than per-object. Strictly better than `mergeGeometries` when you still want to address individual paths.

### Speed → color ramps (Kiri:Moto's hand-rolled HSV vs three's Lut)

Kiri colors every cut segment by feed rate: `rate_to_color(point.speed, maxSpeed)` runs a segmented HSV ramp with a different segment count for CAM (2 segments) than FDM (4), and separate light/dark-theme variants (`color4light2` vs `color4dark`) so the ramp stays legible on both backgrounds. A new polygon is started whenever the speed changes (`if (!lastOut.emit || (ckspeed && out.speed !== lastOut.speed))`), which is what feeds the addGroup color-run batching above. aligator/gcode-viewer does the same thing with three's built-in `Lut` and its `cooltowarm` preset. CAMotics does a simpler variant: cutting moves are `Color(0, intensity, 0.5*(1-intensity))` where `intensity = |speed|/maxSpeed`, so slow moves go blue-ish and fast moves go green.

**In three.js.** `import { Lut } from 'three/addons/math/Lut.js'; const lut = new Lut('cooltowarm', 512); lut.setMin(minFeed); lut.setMax(maxFeed); const c = lut.getColor(feed);` Verified presets in r180: `rainbow`, `cooltowarm`, `blackbody`, `grayscale`; `lut.addColorMap(name, [[stop, hex], ...])` registers your own. For LaserForge, two ramps are worth having: feed rate (diagnose where the controller will slow down) and Z depth / pass index (see which pass cut what). Follow Kiri's lead and define separate light/dark ramps rather than one ramp on two backgrounds.

**Cost / benefit.** Near-zero cost, and it is the difference between a toolpath that looks like a drawing and one that tells you something. Take the built-in `Lut` over hand-rolled HSV — the presets are perceptually better than the segmented ramps, and `cooltowarm` is colorblind-safer than rainbow.

### Move-type color coding — the actual conventions each app uses

Verified from source and docs, so LaserForge can match rather than invent. CAMotics (`ToolPathView::getColor`): RAPID = red, CUTTING = speed-ramped green/blue, PROBE = blue, DRILL = yellow; the selected move is forced WHITE and non-selected moves are multiplied by 0.3 to dim them. OpenBuilds CONTROL (`theme.js` LINE_COLOURS + `3dview.js`): G0 = rgb(0,200,0) green, G1 = rgb(200,0,0) red, G2 = rgb(0,0,200) blue, everything else magenta rgb(200,0,200); arcs get their own line at 0x0000cc. Fusion 360 (documented): gold = stay-down, yellow = rapid, green = lead-in/lead-out, blue = cutting, red = ramp. LightBurn: black = cut lines, solid black = fill areas, red = traversal moves. Kiri:Moto: moves/rapids are deliberately DESATURATED (0x666666 dark theme / 0xaaaaaa light) so cuts dominate. Note the direct conflict — CAMotics/LightBurn use red for rapids, OpenBuilds uses red for G1 cutting. LightBurn is the stated reference for this project, so red = traversal is the one to match.

**In three.js.** Model move type as a discriminated union tag on each emitted segment (`'rapid' | 'cut' | 'plunge' | 'lead' | 'ramp' | 'retract' | 'probe'`), map tag → color in one table, and feed the color-run batching. Follow Kiri and make rapids visually recessive: lower opacity (`transparent:true, opacity:0.5`), thinner linewidth, and `renderOrder` below cuts — the toggle should be 'show traversal moves' (LightBurn's exact wording), default on.

**Cost / benefit.** Free, and it is where a viewer either matches operator expectations or fights them. The one real decision to surface: red-means-rapid (LightBurn/CAMotics/Fusion) vs red-means-cut (OpenBuilds).

### Vertex-colored single Line — the minimal-effort coloring path (OpenBuilds CONTROL)

OpenBuilds' whole toolpath is ONE `THREE.Line` with `vertexColors`, `transparent:true, opacity:0.8`, colored per-point by G-word. It's the cheapest possible per-move coloring, and worth knowing as the floor. Two API traps if you copy it: it uses `THREE.VertexColors` (removed — now `vertexColors: true`), `geometry.addAttribute` (removed — now `setAttribute`), and `new THREE.Geometry()` in the grid code (removed entirely). None of that compiles on r180.

**In three.js.** `geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 });` Note `THREE.Line` draws a connected strip — a rapid between two disjoint regions draws a spurious connector. Use `LineSegments` with explicit endpoint pairs (what gcode-preview does) unless the program is genuinely one continuous chain.

**Cost / benefit.** One draw call, trivially simple, but 1px hairlines on all platforms (`LineBasicMaterial.linewidth` is ignored by every WebGL renderer). Fine as a fallback tier for huge programs; not the primary look.

### Z-range scrubbing via clipping planes AND shader discard (gcode-preview's dual path)

gcode-preview implements layer/depth range filtering two different ways because the two geometry types need different mechanisms. For `LineSegments2` it walks the scene and assigns real `material.clippingPlanes` (`new Plane(new Vector3(0,1,0), -minZ)` and `new Plane(new Vector3(0,-1,0), maxZ)`). For the tube ShaderMaterial it can't use built-in clipping, so it passes `clipMinY`/`clipMaxY` uniforms and does `if (vWorldY < clipMinY || vWorldY > clipMaxY) discard;` in the fragment shader — with the world Y computed in the vertex shader as `vWorldY = (modelMatrix * vec4(position,1.0)).y`. There's also a real subtlety documented in the source: lines are offset by `-lineHeight/2` because G-code specifies the TOP of the cut, so an unoffset line sits exactly on the clip plane and flickers.

**In three.js.** `renderer.localClippingEnabled = true;` then set `material.clippingPlanes = [...]` per material (local) or `renderer.clippingPlanes` (global). For custom ShaderMaterials either add `clipping: true` and include the `<clipping_planes_pars_fragment>`/`<clipping_planes_fragment>` chunks, or do gcode-preview's explicit varying+discard, which is simpler to reason about. Same machinery gives you a free SECTION VIEW: swap the Y planes for an X or Y plane the user drags.

**Cost / benefit.** Instant, geometry-free filtering — the single most useful interaction in a CNC preview (isolate one depth pass). Discard-based clipping disables early-Z, so keep it to the paths, not the stock. Remember the half-height offset; it's a real flicker bug otherwise.

### Playback by index-buffer slicing, not geometry rebuild (aligator/gcode-viewer)

`LineTubeGeometry.slice(start, end)` implements progressive reveal by calling `this.setIndex(this.indices.slice(startI, endI))` — the vertex buffer is untouched, only the index range changes. Index math is `(radialSegments+1)*6` per point. jscut achieves the same thing even more cheaply with its `stopAtTime` uniform. Both beat the naive approach (rebuilding geometry per frame) by orders of magnitude.

**In three.js.** Best option in r180 is `geometry.setDrawRange(start, count)` — no buffer reallocation at all, just a draw-call parameter. Build the geometry once in program order, keep a `moveIndex -> vertexOffset` lookup, and `geometry.setDrawRange(0, offsetForMove(t))` each frame. For BatchedMesh use `setVisibleAt(id, bool)`. For the current tool position, interpolate within the active move rather than snapping to move boundaries (what CAMotics' `getPtAtTime` does).

**Cost / benefit.** Effectively free playback and time-scrubbing. `setDrawRange` requires the geometry to be laid out in program order (which it should be anyway). This plus a time slider is what LightBurn's Preview does in 2D and what operators already expect.

### Tool rendered as a solid of revolution from real tool parameters (CAMotics ToolView)

CAMotics composes the cutter from GL primitives per `ToolShape`: CYLINDRICAL = `GLConic(r, r, len)`; CONICAL = `GLConic(0, r, len)`; SNUBNOSE = `GLConic(snubDia/2, r, len)`; BALLNOSE = `GLSphere(r)` + `GLCylinder(r, r, len-r)` + a `GLDisk` cap on top; SPHEROID = a scaled sphere. Color is orange `rgba(1, 0.5, 0, 0.5)` — semi-transparent so you can see the cut through it — and falls back to solid RED with a default 1/8-inch conical shape when the tool table has no radius, which is a nice 'you didn't configure this' signal. Kiri instead renders the tool as a heightmap grid built from the same profile stencil used for cutting, so the drawn tool is guaranteed to match the cutting tool exactly.

**In three.js.** `THREE.LatheGeometry` is the right primitive — one profile array covers every shape: flat endmill = `[(0,0),(r,0),(r,len)]`; ballnose = quarter-arc points from `(0,0)` to `(r,r)` then up to `(r,len)`; V-bit = `[(0,0),(r, r/tan(halfAngle))]` then up; tapered = linear ramp from tip radius to flute radius. `new THREE.LatheGeometry(points, 48)` + `MeshStandardMaterial({ color: 0xff8000, transparent: true, opacity: 0.5, roughness: 0.3, metalness: 0.6 })`. Add a `CylinderGeometry` shank above the flute in a duller gray, and optionally a collet/holder cylinder — Fusion's simulation shows holder+shaft separately and that's what makes collision reads possible.

**Cost / benefit.** Cheap (one lathe + one cylinder), and the semi-transparent orange convention is worth copying verbatim — an opaque tool hides exactly the cut you're trying to inspect. Deriving the profile from the same tool record that drives the toolpath is the part that prevents the preview from lying.

### Direction arrows, retract/engage/tool-change markers (Kiri:Moto render.js)

Kiri annotates the path with tiny geometry that reads instantly: direction arrows are 3-point triangles built by projecting the endpoint along `slope.angle ± 20°` at `arrowSize` 0.2 mm, emitted for EVERY segment (`arrowAll = true`) into a separate 'arrows' layer at 0.75 opacity. Event markers are tiny regular polygons drawn as filled areas with distinct sidedness and Z-offsets so they never z-fight: tool change = 4-gon, blue face 0x0000ff / line 0x000055, `z + 0.03`; retract = 5-gon, red 0xff0000 / 0x550000, `z + 0.01`; engage (first cut after retract) = 7-gon, green 0x00ff00 / 0x005500, `z + 0.02`. All at radius 0.2 and 0.5 opacity, each in its own toggleable layer.

**In three.js.** Arrows: for each segment build 3 verts into one merged BufferGeometry, one `MeshBasicMaterial` with `transparent:true, opacity:0.75, side:DoubleSide`. Better for large programs: an `InstancedMesh` of one small ConeGeometry with per-instance matrices from segment midpoint + `quaternion.setFromUnitVectors(up, segmentDir)`. Markers: an `InstancedMesh` per event type with `setColorAt`, or three small merged geometries. Give each its own tiny Z-offset (Kiri's 0.01/0.02/0.03) rather than relying on `polygonOffset`.

**Cost / benefit.** Very high signal for very little geometry, and each type being its own layer object means toggling is a one-line `.visible` flip. The distinct-polygon-sidedness idea (4/5/7-gon) is a neat legend-free way to distinguish markers even in monochrome. Instance the arrows if segment counts run into six figures.

### Cheap edge/crease darkening from neighbor height differences (jscut)

jscut gets a convincing 'machined surface' look with zero postprocessing. In the heightmap render vertex shader it samples the current vertex and two neighbors, then `float transition = min(0.4, 100.0*max(abs(p0.z-p1.z), abs(p0.z-p2.z))); color = mix(topColor, botColor, tp.z); color = mix(color, transitionColor, transition);` — i.e. base color interpolates white (top of stock) → blue (deepest cut), then anywhere the surface has a steep local gradient (a cut wall) it darkens toward black. That single line is what makes pocket walls and profile edges pop without any AO pass.

**In three.js.** In a displaced-plane vertex shader, sample `heightMap` at `uv ± (1/N)` in both axes, compute the max absolute delta, and pass it as a varying to darken the fragment. Depth colormap: `mix(new Color(0xffffff), new Color(0x2255cc), normalizedDepth)`, or feed the depth through a `Lut` for a nicer ramp. Also consider deriving the surface normal from the same neighbor samples (`normal = normalize(cross(dx, dy))`) so you can light it properly instead of only tinting it — near-free once you're sampling neighbors anyway.

**Cost / benefit.** Two extra texture fetches per vertex for most of the perceived benefit of an AO pass. Strongly recommended before reaching for GTAO. It also happens to be the exact place to encode 'this pass cut here' as a hue if you want per-pass coloring on the machined surface.

### Real ambient occlusion and outlines via postprocessing (r180 addons)

None of the surveyed open-source viewers ship AO — CAMotics uses fixed OpenGL lighting, Kiri uses MeshPhong/MeshLambert/MeshMatcap, gcode-preview uses a hand-written 2-term shader (fixed light dir `(-0.8,-0.2,-0.8)`, `diff*directional + ambient`, then `min(color*brightness, 1.0)`). Commercial viewers (Fusion) do have proper shading and that's a visible quality gap. r180 ships everything needed as addons — verified present in this repo's node_modules.

**In three.js.** `import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'; import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'; import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'; import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';` GTAOPass is the modern/better one (SAOPass and SSAOPass are also present). Add `OutlinePass` for selection highlighting (CAMotics does selection by forcing the move WHITE; an outline reads better on a mesh). Add `SMAAPass` or `FXAAPass` if you disable MSAA for the composer. Cheaper non-postprocess option: `MeshMatcapMaterial` (Kiri offers it) bakes a whole lighting environment into one texture — no lights, one texture fetch, and it looks like machined metal for free.

**Cost / benefit.** GTAO is the single biggest 'this looks like Fusion' upgrade but costs a full extra pass and forces you into a composer (which then interacts with clipping planes and transparency ordering). Do it AFTER the heightmap and the jscut edge trick — those get you most of the way. Matcap is the high-value/low-risk middle option.

### Shadows and a gradient sky/background (OpenBuilds CONTROL, CAMotics)

OpenBuilds is the most 'finished-looking' of the open-source CNC viewers and the reason is entirely lighting/environment, not toolpath rendering. It runs two plain DirectionalLights plus a third shadow-caster (`castShadow`, 2048² shadow map, ortho shadow camera clamped to `±d`, `shadow.bias = -0.0001`, `color.setHSL(0.1, 1, 0.95)` for a warm key), a HemisphereLight (present but hidden by default), `scene.fog = new THREE.Fog(color, 1, 20000)` whose color tracks the sky bottom, and a 9900-radius `SphereGeometry(64,15)` skydome with a custom top/bottom gradient ShaderMaterial on `DoubleSide`. CAMotics does the flat-2D version: `GradientBackground` draws 2 full-screen triangles in NDC with per-vertex top/bottom colors and `glDisable(GL_DEPTH_TEST)` around the draw. Kiri's `moto/space.js` uses light RIGS of 2/4/6 DirectionalLights at graded intensities (e.g. `x1,y1,z1 @ 2.5`, `x0,y1,-z1 @ 0.5`, plus two at `0xeeeeee`) rather than a single key.

**In three.js.** Gradient background, cheapest version: a `ShaderMaterial` on a large `SphereGeometry` with `side: BackSide` and `depthWrite: false`, or just a CSS gradient behind a transparent canvas. Shadows: `renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;` and tightly fit the ortho shadow camera to the stock bounds (a loose frustum is why most three.js shadows look blocky). Match `scene.fog` color to the background so the far grid fades instead of terminating. A shadow of the tool on the stock is a genuinely useful depth cue, not just decoration.

**Cost / benefit.** Low cost, disproportionate perceived quality — this is where 'looks like a demo' becomes 'looks like a product'. Shadow map cost is one extra depth render per frame; only render it when the scene is dirty, not every frame.

### Bed/stock furniture: build volume box, dual-density grid, axes triad, rulers with labels

The standard vocabulary, consistent across all of them. gcode-preview's `BuildVolume` composes a `LineBox(x, z, y)` wireframe in 0x888888, a major `Grid(10)` in 0x888888, an optional minor `Grid(1)` in 0x444444, and an `AxesHelper(10)` with Z negated to fix handedness — all in one named Group that is disposed and rebuilt when dimensions change. OpenBuilds redraws its grid on every extents change with a 10-unit step at 0x888888 and a 100-unit step at 0x666666, plus rulers, per-axis colored lines (X = 0xcc0000 red, Y = 0x00cc00 green) and 3D text labels, with an inches/mm switch. Kiri's platform is a `MeshPhongMaterial({ color:0xeeeeee, opacity:0.6, transparent:true, depthWrite:false, side:FrontSide })` — `depthWrite:false` is the important detail, it lets toolpaths below Z0 still be visible through the bed. Kiri's grid: minor 0xeeeeee, major 0xcccccc, X axis 0xff6666, Y axis 0x6666ff. ncviewer exposes 'Show grid' / 'Show rapid movement' / 'Show toolpath points' / Z-up vs Y-up plot orientation, and a DRO for X/Y/Z/A/B/C.

**In three.js.** Two `GridHelper`s at different divisions and colors (or hand-built `LineSegments` for non-square beds), a `Box3Helper`/custom LineBox for the stock and separately for the job bounding box, `AxesHelper` at the WCS origin. Put the whole lot in one named `Group` with a `dispose()` so bed-size changes don't leak. Copy Kiri's `depthWrite:false` on the bed plane. For labels use CSS2DRenderer/sprites rather than TextGeometry. gcode-preview also persists camera position/rotation/zoom/target to localStorage and restores on load — small touch, and operators notice when it's missing.

**Cost / benefit.** Cheap and expected. The dual-density grid (fine + coarse) is what makes scale readable at every zoom; a single grid always looks wrong at one end of the zoom range. Dispose properly — gcode-preview has an explicit `Disposable` list precisely because rebuilding the volume every parameter change otherwise leaks GPU memory.

### View cube / axis gizmo

Fusion 360's ViewCube is the reference for orientation control and is the one commercial UI element with no open-source CNC equivalent in this survey — none of gcode-preview, Kiri, CAMotics, OpenBuilds or ncviewer ships one. three.js does have an axis-gizmo equivalent built in.

**In three.js.** `import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';` (verified present in 0.180.0). `const vh = new ViewHelper(camera, renderer.domElement);` — render it in a second pass after the main render with `renderer.autoClear = false; vh.render(renderer);`, and forward pointer events to `vh.handleClick(event)` for click-to-snap-to-axis with animated transitions. For an actual cube (not a triad), build a small `BoxGeometry` with 6 canvas-texture materials in its own Scene + OrthographicCamera in a corner viewport (`renderer.setViewport`) and raycast face hits to snap the main camera.

**Cost / benefit.** `ViewHelper` is ~10 lines and covers 90% of the value. A true labeled cube is maybe half a day and is a visible parity item against Fusion/Easel. Do the ViewHelper first.

### Section view via draggable clipping plane

The 'is my pocket actually the right depth' answer. Fusion has it; none of the open-source viewers surveyed do (gcode-preview's clipping planes are Z-range only). Reuses the exact same machinery as depth-range scrubbing.

**In three.js.** `renderer.localClippingEnabled = true;` then assign `material.clippingPlanes = [plane]` to the stock and toolpath materials, with `plane = new THREE.Plane(new THREE.Vector3(-1,0,0), x)` driven by a slider. Add `clipShadows: true` if shadows are on. To avoid the hollow-shell look, render the capped cross-section: draw the clipped mesh with `stencilWrite`/`stencilFunc` front and back faces to build a stencil mask, then draw a full-plane quad through the stencil in a 'cut material' color. Or simply set `side: THREE.DoubleSide` on the stock so you at least see interior walls rather than through them.

**Cost / benefit.** Very high diagnostic value for a CNC app (unlike a laser app, where depth is the whole point of Z). Basic clipping is trivial; the stencil cap is the fiddly part and is optional — DoubleSide gets you most of the way.

### Below-Z0 red tint via material.onBeforeCompile injection (Kiri:Moto)

A precise, transferable trick: Kiri tints any part of the animated stock that has been cut below Z=0 red, WITHOUT writing a custom material — it patches the stock's MeshPhongMaterial in place. `material.onBeforeCompile = shader => { ... }` prepends `varying vec3 vWorldPosition;` to both shaders, sets it after the `<worldpos_vertex>` chunk, then after `<dithering_fragment>` does `if (vWorldPosition.z < 0.0) gl_FragColor.rgb += vec3(0.5, 0.0, 0.0);`. All of MeshPhong's lighting, shadows and fog keep working.

**In three.js.** Same code, verbatim, on r180 (`onBeforeCompile(shader, renderer)` is still supported; `material.customProgramCacheKey()` should return a stable key if the injection varies). Uses for LaserForge: red tint where the toolpath goes below the stock bottom (through-cut into the spoilboard), amber where it enters a no-go zone, or a hue per depth pass on the machined surface. Note this is a display cue only — per the project's guard rule it must inform, never refuse.

**Cost / benefit.** Near-zero cost, no custom shader to maintain, and it composes with the full standard material feature set. The best way to add semantic coloring to lit geometry without giving up lighting. Caveat: chunk names can change between three releases, so pin the version and test after upgrades.

### GPU picking by encoding move index as a vertex color (CAMotics)

CAMotics makes every move clickable/hoverable without any CPU raycast: `pushVertex` writes both the display color and a second attribute `Color::fromIndex(index)` — the move's array index encoded as RGB. Render the scene to an offscreen buffer with the pick colors, read back the pixel under the cursor, decode back to a move index, then map that to a G-code file+line (`ToolPathView::setByLine(filename, line, position)` drives a bidirectional link between the 3D view and the G-code editor).

**In three.js.** Keep a parallel `pickColor` BufferAttribute (`index & 0xff`, `(index>>8) & 0xff`, `(index>>16) & 0xff`, /255). Render the scene into a 1×1 scissored WebGLRenderTarget with an override material using `vertexColors:true` and no lighting/tone-mapping, then `renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, buf)`. Set `renderer.outputColorSpace`/tone mapping off for the pick pass or the values come back wrong. Alternative for fat lines: `Line2.raycast` works but is slow at scale; GPU picking is O(1) in segment count.

**Cost / benefit.** Exactly right for a G-code-line ↔ 3D-view cross-highlight, which is a genuinely differentiating feature and something LightBurn does not have. Costs one extra tiny render per pointer move (scissor to 1px, it's negligible) and one extra vertex attribute. The colorspace/tone-mapping gotcha is the only real trap.

### Progressive / chunked rendering so the UI never blocks (gcode-preview, Kiri)

gcode-preview's `renderAnimated(pathCount)` defaults to `job.paths.length / 60` paths per frame and builds each chunk into its own named `Group` inside a parent group, driven by a `requestAnimationFrame` loop that resolves a Promise on completion. Kiri streams from the worker: geometry arrives as `mesh_add` / `mesh_update` / `mesh_move` / `mesh_del` messages, with the position buffer itself living in a SharedArrayBuffer so 'update' is just a `needsUpdate` flag rather than a data copy.

**In three.js.** Parse and build in a Worker; post back transferable `Float32Array`/`Uint32Array` buffers (or a SharedArrayBuffer if COOP/COEP headers are set) and construct `BufferAttribute`s on the main thread. Budget by TIME not by count (`while (performance.now() - t0 < 8) { buildNextChunk(); }`) so behavior is stable across machines. Give each chunk its own Group so you can dispose or hide a range without touching the rest.

**Cost / benefit.** Essential for large programs and the thing that separates a viewer that feels fast from one that stalls. Adds real complexity around disposal and cancellation — gcode-preview maintains an explicit `disposables` array precisely because chunked rebuilds otherwise leak.

### Coordinate-frame conversion: G-code Z-up into three's Y-up

Every viewer hits this and they solve it differently. gcode-preview rotates the whole path group: `group.quaternion.setFromEuler(new Euler(-Math.PI/2, 0, 0))`, then its clipping planes and shader clip uniforms all operate on WORLD Y (`vWorldY = (modelMatrix * vec4(position,1.0)).y`) — which is why layer filtering in that codebase reads as 'Y' even though it's the part's Z. Its `BuildVolume.createAxes()` additionally negates the axes helper's Z scale to fix handedness. ncviewer instead exposes the choice to the user: 'Plot Orientation: Vertical (Z-Up)' vs 'Horizontal (Y-Up)'. OpenBuilds and Kiri keep the world Z-up and orient the camera instead.

**In three.js.** Cleanest for a CNC app: keep the SCENE Z-up (`camera.up.set(0,0,1)`, `controls.object.up.set(0,0,1)`) so every coordinate in the app matches the G-code and the DRO with no mental transform — this is what OpenBuilds and Kiri do and it eliminates a whole class of sign bugs. If you instead rotate the group, be consistent about whether clipping/AABB math is in local or world space; gcode-preview's mixed approach is the source of its layer-offset subtleties.

**Cost / benefit.** Free if decided up front, expensive to change later. Z-up matches the machine, the operator's mental model, and every G-code value you display.

### App-by-app visual element inventory (what to actually put on screen)

Consolidated survey. gcode-preview: build-volume LineBox, dual grid, axes triad, job bounding box, extrusion paths (lines or tubes), travel moves, per-tool colors, top-layer/last-segment colors, layer range slider. NO stock, NO tool, NO material removal (it's a printer preview). Kiri:Moto CAM: translucent platform, dual grid, speed-colored cuts, desaturated rapids, per-segment direction arrows, tool-change/retract/engage markers, animated stock with material removal, a tool mesh matching the real cutter, model/stock/transparency toggles, speed multipliers 1x–8x + '!!', X/Y/Z DRO readout, progress %. CAMotics: gradient background, axes, workpiece AABB, machine part views, cut-surface mesh, semi-transparent orange tool, move-type-colored path with speed intensity, selection highlight, plus a values panel (current/total/remaining time and distance, feed, speed, tool, program file+line). OpenBuilds CONTROL: skydome, fog, shadows, dynamic grid with rulers and 3D labels, colored axis lines, G0/G1/G2-colored toolpath, blue cone at the live machine position, light/dark themes, view checkboxes. ncviewer.com: grid, axes, thin colored toolpath, toolpath points toggle, rapid toggle, XYZABC DRO, Z-up/Y-up plot orientation, perspective or orthographic. Fusion 360: stock with material removal, tool with holder/shaft, gold/yellow/green/blue/red move colors, stock-comparison colors (red = excess stock remaining, blue = gouge), ViewCube, transparency, colorization by material/global-fill/per-toolpath, 'Fast (3-axis only)' mode that degrades stock to a plain box and disables comparison colors. LightBurn: 2D only — black cut lines, solid black fills, red traversal (toggleable), grayscale 'Shade According to Power', green cutting-boundary border, time slider, 1/10x–40x playback, cut distance + rapid distance + total time stats, 'Start Here' resume, invert mode, legend. Easel: 3D material block preview with a Simulate button; documented that anything absent from the preview will not be carved (the preview is derived from the actual toolpath, not the drawing). Carbide Create: animated simulation with a high-resolution toggle, toolpath lines overlaid on the shaded simulation.

**In three.js.** Minimum viable set for a CNC preview that reads as best-in-class: (1) bed plane with depthWrite:false + dual grid + axes triad; (2) translucent stock box; (3) machined-surface heightmap (jscut GPU technique) with depth colormap + neighbor-gradient edge darkening; (4) fat-line toolpath, speed- or depth-ramped, with recessive dashed rapids and a 'show traversal moves' toggle; (5) LatheGeometry tool at 50% orange with a shadow; (6) time slider + play/pause driving `setDrawRange` and the `stopAtTime` uniform; (7) Z-range clip slider; (8) ViewHelper gizmo; (9) stats panel (cut distance, rapid distance, estimated time) — LightBurn's exact stat set, since it's the stated reference.

**Cost / benefit.** Items 1, 2, 4, 6, 8, 9 are a day or two total and get you to parity with OpenBuilds/ncviewer. Item 3 is the one that jumps you past them to Easel/Carbide territory, and jscut's shader pair makes it far cheaper than it looks. Items 5 and 7 are polish with real diagnostic value. Everything here is display-only and belongs in the informational surface — none of it should gate Frame or Start.

**Sources**

- https://github.com/remcoder/gcode-preview — src/scene-manager.ts, src/extrusion-geometry.ts, src/build-volume.ts, src/helpers/colorMaterial.ts (branch: develop; read via gh api, full source)
- https://www.npmjs.com/package/gcode-preview
- https://github.com/CauldronDevelopmentLLC/CAMotics — src/camotics/sim/CutWorkpiece.cpp, sim/ToolSweep.cpp, render/Renderer.cpp, render/RenderMode.h, contour/ (CorrectedMC33, CubicalMarchingSquares, GridTree, QEF), view/ToolPathView.cpp, view/ToolView.cpp, view/GradientBackground.cpp
- https://camotics.org/manual.html
- https://github.com/GridSpace/grid-apps — src/kiri/core/render.js, src/kiri/app/layers.js, src/kiri/app/stack.js, src/geo/paths.js (pathTo3D), src/geo/csg.js, src/moto/space.js, src/kiri/mode/cam/app/anim-2d.js, src/kiri/mode/cam/work/anim-2d.js, src/kiri/mode/cam/work/anim-3d.js, src/kiri/mode/cam/core/tool.js
- https://grid.space/kiri/
- https://github.com/tbfleming/jscut — js/RenderPath.js, js/rasterizePathVertexShader.txt, js/rasterizePathFragmentShader.txt, js/renderHeightMapVertexShader.txt, js/renderHeightMapFragmentShader.txt
- https://github.com/aligator/gcode-viewer — src/LineTubeGeometry.ts, src/SegmentColorizer.ts
- https://github.com/OpenBuilds/OpenBuilds-CONTROL — app/js/viewer.js, app/js/theme.js, app/lib/3dview/3dview.js, app/lib/3dview/workers/verylitegcodeviewer.js
- https://docs.openbuilds.com/doku.php?id=docs%3Asoftware%3Aopenbuilds-control
- https://ncviewer.com/ — plus its shipped bundles (_nuxt/vendor.*.js confirmed to contain three.js: BufferGeometry, LineSegments, PerspectiveCamera, OrthographicCamera, GridHelper, AxesHelper; no Line2/LineSegments2)
- https://docs.lightburnsoftware.com/2.1/Reference/Preview/
- https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Understanding-toolpath-colours-in-Fusion-360.html (via search summary; direct fetch 403)
- https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Toolpath-simulation-stock-comparison-colors-are-flipped-in-Fusion.html (via search summary; direct fetch 403)
- https://help.autodesk.com/view/fusion360/ENU/?guid=MFG-SIMULATE-DISPLAY-TOOLPATHS (503 at fetch time; content via search summaries)
- https://mecsoft.com/blog/revolutionizing-cam-simulation-nvidia-gpu-accelerated-tridexel-simulation-in-rhinocam-visualcad-cam/
- https://en.wikipedia.org/wiki/Dexel
- https://support.easel.com/hc/en-us/articles/10369535844243-3D-Carving-Instructions and https://inventables.zendesk.com/hc/en-us/articles/360012642834-Previewing-the-design (Easel app itself is behind auth — renderer NOT source-verified)
- https://carbide3d.com/carbidecreate/pro/ and https://community.carbide3d.com/t/carbide-create-now-with-animated-simulation/76274 (closed source — NOT source-verified)
- LOCAL: C:\Users\Asus\LaserForge-2.0\.claude\worktrees\cnc-3d-threejs-upgrade-9d1216\node_modules\three\package.json — confirms three@0.180.0 and that BOTH 'three/addons/*' and 'three/examples/jsm/*' resolve
- LOCAL: node_modules/three/examples/jsm/ — verified present in r180: lines/{Line2,LineGeometry,LineMaterial,LineSegments2,LineSegmentsGeometry}.js; math/Lut.js (presets rainbow|cooltowarm|blackbody|grayscale); helpers/ViewHelper.js; postprocessing/{GTAOPass,SAOPass,SSAOPass,OutlinePass,EffectComposer,RenderPass,OutputPass,FXAAPass,SMAAPass}.js; BatchedMesh + InstancedMesh confirmed in core
- LOCAL SCRATCHPAD (all fetched sources saved for re-reading): C:\Users\Asus\AppData\Local\Temp\claude\C--Users-Asus-LaserForge-2-0--claude-worktrees-cnc-3d-threejs-upgrade-9d1216\a8652c89-00ef-4915-9635-d001b129960a\scratchpad\ — scene-manager.ts, extrusion-geometry.ts, kiri-render.js, kiri-layers.js, kiri-stack.js, kiri-polygon.js, geo-paths.js, moto-space.js, cam-anim2d.js, cam-work-anim2d.js, cam-work-anim3d.js, cam-tool.js, jscut-RenderPath.js, LineTubeGeometry.ts, ob-viewer.js, ob-theme.js, ob-lite.js, ob-3dview.js, ToolPathView.cpp, nc-app.js, nc-vendor.js, nc-viewer-layout.js

## 3.2 Modern three.js r180 rendering techniques for a fantastic-looking technical/CAD 3D viewport — module paths verified against the installed three@0.180.0 tree (node_modules/three/examples/jsm + src) and cross-checked against threejs.org docs/manual and the official migration guide

### Fat lines: Line2 vs LineSegments2 vs Wireframe (pick the right one)

WebGL's native `gl.LINES` ignores `linewidth` on every desktop driver, so `THREE.Line`/`LineMaterial`'s built-in width is a no-op. The `lines/` addon family draws each segment as an instanced camera-facing quad, giving real thickness, round/butt joins and correct depth. This is the single highest-impact change for a CAD viewport — toolpaths, edges and dimension lines stop being 1px aliased hairlines.

**In three.js.** Verified r180 paths (all under `three/addons/lines/`, i.e. `node_modules/three/examples/jsm/lines/`):
- `three/addons/lines/Line2.js` → `Line2` — a CONTIGUOUS polyline. Ctor `new Line2(geometry = new LineGeometry(), material = new LineMaterial({color: Math.random()*0xffffff}))`. Note the default material is a RANDOM color — always pass your own.
- `three/addons/lines/LineGeometry.js` → `LineGeometry`. `setPositions(Float32Array|number[])` takes a flat contiguous `[x,y,z, x,y,z, ...]` point list; also `setFromPoints(Vector3[])` and `fromLine(line)`.
- `three/addons/lines/LineSegments2.js` → `LineSegments2` — DISJOINT segments. `Line2 extends LineSegments2`.
- `three/addons/lines/LineSegmentsGeometry.js` → `LineSegmentsGeometry`. `setPositions()` here needs a multiple of 6: `(xyz xyz)` per segment. Helpers: `fromWireframeGeometry()`, `fromEdgesGeometry()`, `fromMesh()`, `fromLineSegments()`.
- `three/addons/lines/LineMaterial.js` → `LineMaterial`.
- `three/addons/lines/Wireframe.js` + `three/addons/lines/WireframeGeometry2.js` → fat wireframe overlay.
Internally `setPositions` builds an `InstancedInterleavedBuffer(array, 6, 1)` and sets `instanceStart`/`instanceEnd` `InterleavedBufferAttribute`s, so N segments = N instances = ONE draw call per Line2.
WebGPU note: the JSDoc in `Line2.js` says verbatim it "can only be used with WebGLRenderer. When using WebGPURenderer, import the class from `lines/webgpu/Line2.js`." That dir exists in r180 and contains exactly `Line2.js`, `LineSegments2.js`, `Wireframe.js`.

**Cost / benefit.** Very high visual payoff, low cost. Memory ~2x a plain line buffer (interleaved start+end duplicates shared vertices) and one instanced draw per object. The real cost is CPU-side: rebuilding `setPositions` reallocates the interleaved buffer + recomputes bounding box AND bounding sphere every call, so do not call it per frame on a large toolpath. Batch many static polylines into ONE `LineSegments2` where possible — 10k separate `Line2` objects is 10k draw calls; one `LineSegments2` with 10k segments is 1.

### LineMaterial: screen-space (CSS px) vs world-units linewidth

`linewidth` means two different things depending on `worldUnits`. Screen-space (default) keeps lines a constant on-screen thickness at any zoom — the correct CAD/blueprint behavior, because a 2px edge stays 2px whether you're zoomed to the whole bed or one tab. World-units makes lines thicken as you zoom in — correct when the line REPRESENTS physical width (e.g. drawing a 3.175mm endmill's actual cut swath, or kerf width).

**In three.js.** `import { LineMaterial } from 'three/addons/lines/LineMaterial.js'`.
Ctor takes a plain params object via `setValues()`; the base is a `ShaderMaterial` built from `ShaderLib['line']` with `clipping: true` hardcoded.
All of these are getter/setter pairs backed by `defines` or `uniforms`, verified in r180 source:
- `worldUnits` (bool) — toggles the `WORLD_UNITS` define. **Default false.** Because `this.defines = {}` on ShaderMaterial and LineMaterial never seeds it, `worldUnits`, `dashed` and `alphaToCoverage` ALL default to `false` in r180.
- `linewidth` (number) — uniform. JSDoc verbatim: "Controls line thickness in CSS pixel units when `worldUnits` is `false` (default), or in world units when `worldUnits` is `true`."
- `resolution` (Vector2) — see the gotcha entry.
- `alphaToCoverage` (bool) — `USE_ALPHA_TO_COVERAGE` define. JSDoc: "When enabled, this can improve the anti-aliasing of line edges when using MSAA."
- `color`, `opacity`, `vertexColors`.
Toggling `worldUnits`/`dashed`/`alphaToCoverage` mutates `defines`, which triggers a **shader recompile** — never do it in an animation loop or on a slider's `input` event.

**Cost / benefit.** Free at runtime. Recommended CAD setup: `worldUnits:false` for geometry edges/grid/axes (1–2 CSS px), `worldUnits:true` only for the cut-swath visualization. Caveat on `alphaToCoverage`: it only does anything if the WebGL context actually has MSAA — i.e. `new WebGLRenderer({antialias:true})` AND you are rendering direct to canvas. Route through EffectComposer and the default composer render target has no `samples`, so alphaToCoverage silently degrades to hard edges (see the MSAA gotcha entry).

### The LineMaterial `resolution` gotcha — it is AUTOMATIC in r180, and most tutorials are stale

Screen-space line width needs the viewport size in the shader to convert clip-space offsets to pixels. Every pre-r16x tutorial tells you to manually do `material.resolution.set(window.innerWidth, window.innerHeight)` on resize. In r180 that is unnecessary and your manual value gets overwritten every frame.

**In three.js.** Verified in `LineSegments2.js`:
```js
onBeforeRender( renderer ) {
  const uniforms = this.material.uniforms;
  if ( uniforms && uniforms.resolution ) {
    renderer.getViewport( _viewport );
    this.material.uniforms.resolution.value.set( _viewport.z, _viewport.w );
  }
}
```
And `LineMaterial`'s own JSDoc: "This must be kept updated to make screen-space rendering accurate. The `LineSegments2.onBeforeRender` callback performs the update for visible objects."
UNITS: `WebGLRenderer.getViewport()` returns `_viewport`, which `setViewport`/`setSize` store UNMULTIPLIED — the pixel-ratio multiply happens only at the `state.viewport(_currentViewport.copy(_viewport).multiplyScalar(_pixelRatio).round())` GL call. So `resolution` is in **CSS pixels**, matching the `linewidth` docstring. Do NOT set it to `width * devicePixelRatio` — that classic snippet now makes lines too thin on HiDPI.
Residual real gotchas:
1. It only fires "for visible objects" — a frustum-culled or `visible:false` line never refreshes its shared material.
2. **Raycasting reads it outside the render loop.** `LineSegments2.raycast()` calls `raycastScreenSpace()` which uses `material.resolution` directly; immediately after a resize but before the first render, picking is off by one frame. Also `raycast` hard-errors to console if `raycaster.camera` is unset when `worldUnits === false`, and honors `raycaster.params.Line2.threshold`.
3. If you split-screen with `setViewport`, resolution correctly tracks the sub-viewport — which is what you want, but means one shared material is fine only because it's rewritten per object per frame.

**Cost / benefit.** Free. Net effect: delete your resize handler's resolution code. Do keep `raycaster.params.Line2 = { threshold: N }` and, if you pick right after a resize, force one render before hit-testing.

### Dashed fat lines (hidden edges, center lines, rapid moves)

Dashed thick lines are how you distinguish rapid/travel moves from cutting moves, or hidden edges from visible ones, without relying on color alone. Standard CAD line-type vocabulary.

**In three.js.** On the geometry side you MUST first call `line.computeLineDistances()` (defined on `LineSegments2`, r180 line ~283). It walks `instanceStart`/`instanceEnd`, accumulates cumulative arc length, and writes `instanceDistanceStart`/`instanceDistanceEnd` as an `InstancedInterleavedBuffer(lineDistances, 2, 1)`. Without it, dashes render as garbage (undefined attribute).
On the material: `material.dashed = true` (sets the `USE_DASH` define → recompile), then `dashSize`, `gapSize`, `dashScale`, `dashOffset` — all plain uniforms, all cheap to animate.
Fragment shader does `if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard;` — note the source carries a literal `// todo - FIX` and `// todo FIX - maybe change to totalSize` next to `gapSize`, so treat exact dash phasing as approximate.
Animating `dashOffset` over time gives the "marching ants" / flow-direction effect for showing cut direction — one uniform write per frame, no recompile.

**Cost / benefit.** Near-free. `computeLineDistances()` is O(segments) on CPU and allocates a new Float32Array — call it once after geometry construction, not per frame. Caveat: `dashScale` multiplies distance in the VERTEX shader, and with `worldUnits:false` the dash length is in world distance, not screen distance — so dashes get visually denser as you zoom out. If you need screen-constant dashes you have to drive `dashScale` from camera distance yourself.

### Per-vertex colors on fat lines (color-by-Z / by-feedrate / by-pass)

Gradient-colored toolpaths — color by depth pass, by feedrate, by move type — in a single draw call. This is the visual that makes a CNC preview look professional rather than like a debug dump.

**In three.js.** `material.vertexColors = true`, then feed colors to the geometry. The two geometries take DIFFERENT layouts:
- `LineSegmentsGeometry.setColors(array)` wants a multiple of 6: `(rgb rgb)` per segment, i.e. explicit start and end color. It builds `InstancedInterleavedBuffer(colors, 6, 1)` → `instanceColorStart`/`instanceColorEnd`.
- `LineGeometry.setColors(array)` wants ONE rgb per point (`[r1,g1,b1, r2,g2,b2, ...]`) and expands it internally to the paired format (verified: it loops `length = array.length - 3` and emits overlapping pairs) before calling `super.setColors()`.
**Color-space gotcha:** ColorManagement is on by default (r152+). `Color.setHex(0xff8800)` / `setStyle()` converts sRGB→linear-working for you, so pushing `c.r, c.g, c.b` into the array is CORRECT. But hand-authoring raw 0–1 values copied from a CSS palette pushes sRGB numbers into a linear pipeline and they will render noticeably too bright/washed. Round-trip through `Color` instead.
Also note `setColors` does NOT recompute bounds, and unlike `setPositions` it doesn't touch `instanceCount` — the counts must already match.

**Cost / benefit.** Free — one extra interleaved attribute, same single draw call, no branching. Big perceptual win. Only cost is the CPU array build; for a long toolpath prefer writing straight into a preallocated `Float32Array` rather than `push()`ing onto a JS array.

### EffectComposer baseline chain + OutputPass ordering

The post-processing spine. Everything else (AO, bloom, outline, AA) hangs off it. Getting the ORDER and the final OutputPass right is what separates a correct HDR pipeline from a washed-out or double-tone-mapped one.

**In three.js.** All under `three/addons/postprocessing/`, all verified present in r180:
`EffectComposer.js`, `RenderPass.js`, `OutputPass.js`, `ShaderPass.js`, `Pass.js`, `MaskPass.js`, `ClearPass.js`, `SavePass.js`, `TexturePass.js`, `CubeTexturePass.js`, `RenderTransitionPass.js`, `RenderPixelatedPass.js`.
```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';
const composer = new EffectComposer( renderer );          // ctor( renderer, renderTarget? )
composer.addPass( new RenderPass( scene, camera ) );      // ( scene, camera, overrideMaterial=null, clearColor=null, clearAlpha=null )
// ... AO -> bloom -> outline ...
composer.addPass( new OutputPass() );                      // ctor takes NO args
```
Order rule: everything that works in linear HDR goes BEFORE `OutputPass`; `OutputPass` is last and applies tone mapping + output color space. Verified in `OutputPass.js`: it caches `_outputColorSpace`/`_toneMapping`, reads `renderer.toneMappingExposure` every frame into a uniform, and rebuilds defines (`SRGB_TRANSFER`, `LINEAR_TONE_MAPPING`, `REINHARD_TONE_MAPPING`, `CINEON_TONE_MAPPING`, …) when `renderer.outputColorSpace` or `renderer.toneMapping` changes. So you still set `renderer.toneMapping` / `toneMappingExposure` normally — OutputPass mirrors them.
Default internal RT is `new WebGLRenderTarget(w*pixelRatio, h*pixelRatio, { type: HalfFloatType })` — HDR-capable, good. `composer.setSize(w,h)` takes CSS px and multiplies by `_pixelRatio` internally; `composer.setPixelRatio(r)` exists separately.
AA passes go LAST, after OutputPass, because they should operate on tone-mapped LDR (bright HDR pixels confuse edge detection).

**Cost / benefit.** One extra full-screen blit vs direct rendering — negligible. But see the MSAA gotcha: adopting EffectComposer at all has a hidden AA cost you must pay back explicitly.

### THE MSAA GOTCHA: EffectComposer silently kills `antialias: true`

The most common reason a viewport looks WORSE after adding post-processing. `new WebGLRenderer({antialias:true})` only multisamples the DEFAULT framebuffer. The moment RenderPass renders into the composer's offscreen render target, that MSAA does nothing, and every edge in your CAD model goes jaggy.

**In three.js.** Verified: `EffectComposer`'s default RT is constructed with only `{ type: HalfFloatType }` — **`samples` is never set**, so it defaults to 0 (no MSAA).
Three fixes, in order of preference for a CAD viewport:
1. Pass your own multisampled RT (WebGL2 only, which is r180's floor anyway):
```js
const size = renderer.getDrawingBufferSize( new THREE.Vector2() );
const rt = new THREE.WebGLRenderTarget( size.x, size.y, { type: THREE.HalfFloatType, samples: 4 } );
const composer = new EffectComposer( renderer, rt );
```
`renderTarget2 = renderTarget.clone()` so both ping-pong buffers inherit `samples`.
2. Add `SMAAPass` after `OutputPass`.
3. Use `SSAARenderPass`/`TAARenderPass` instead of `RenderPass` for a still viewport (see the progressive-AA entry).
Remember `alphaToCoverage` on LineMaterial ALSO depends on real MSAA, so fix (1) is what re-enables crisp fat-line edges under post-processing.

**Cost / benefit.** `samples: 4` costs roughly 2–3x the render-target bandwidth of `samples: 0`. On integrated GPUs (Intel Iris Xe / UHD, AMD Vega iGPU) at 1080p this is usually still cheaper and much better-looking than SMAA, because iGPUs are bandwidth-limited but MSAA resolve is fixed-function. At 4K on an iGPU, drop to `samples: 2` or switch to SMAA. Always cap DPR first (see the DPR entry) — that's the bigger lever.

### Ambient occlusion: GTAOPass is the r180 choice; SSAO/SAO are legacy

AO is the single biggest 'this looks like a real CAD renderer' effect. It darkens creases, pockets, bores and the contact line where a part meets the bed, which is exactly the geometry a machinist needs to read. Without it, a flat-shaded part reads as a silhouette.

**In three.js.** All three exist in r180 at `three/addons/postprocessing/`: `GTAOPass.js`, `SSAOPass.js`, `SAOPass.js`. **Use GTAOPass.** Ground-Truth AO is physically-derived, far less haloing/noise than SSAO, and is the one actively maintained.
```js
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
// ctor( scene, camera, width = 512, height = 512, parameters, aoParameters, pdParameters )
const gtao = new GTAOPass( scene, camera, w, h );
gtao.blendIntensity = 1.0;                       // r180 property, default 1.
gtao.output = GTAOPass.OUTPUT.Default;
gtao.updateGtaoMaterial({ radius, distanceExponent, thickness, scale, samples, screenSpaceRadius });
gtao.updatePdMaterial({ /* Poisson denoise params */ });
gtao.setSceneClipBox( box3 );                    // restrict AO to a Box3 — perfect for a machine bed
composer.addPass( gtao );
```
Verified `GTAOPass.OUTPUT = { Off:-1, Default:0, Diffuse:1, Depth:2, Normal:3, AO:4, Denoise:5 }` — invaluable for tuning; set `output = GTAOPass.OUTPUT.AO` to see the raw AO buffer.
Cost control: by default the pass owns its G-buffer and does a FULL EXTRA SCENE RENDER with `scene.overrideMaterial = this.normalMaterial` (a `MeshNormalMaterial` with `NoBlending`) into `normalRenderTarget`. You can skip that entirely: `gtao.setGBuffer( depthTexture, normalTexture )` with your own textures sets `_renderGBuffer = false`. Constructor also accepts `parameters.depthTexture` / `parameters.normalTexture`.
SSAOPass ctor is `(scene, camera, width=512, height=512, kernelSize=32)`; SAOPass is `(scene, camera, resolution = new Vector2(256,256))`.
Migration note (r180→r181, from the official guide): "GTAONode render target optimized: AO now accessible only in the `r` channel" — that's the TSL/WebGPU node, not GTAOPass, but flag it if you later port.

**Cost / benefit.** Highest visual-quality-per-effect, but the most expensive pass here. Budget on an integrated GPU: full-res GTAO with the default normal prepass roughly DOUBLES your geometry cost plus adds AO + denoise fullscreen work. Mitigations that work: (a) construct at half resolution (`new GTAOPass(scene, camera, w/2, h/2)`) — AO is low-frequency and upsamples fine; (b) feed your own depth/normal via `setGBuffer` to kill the prepass; (c) lower `samples`; (d) `setSceneClipBox` so AO only evaluates inside the work envelope. On a render-on-demand viewport (see that entry) the cost is paid only on camera moves, which makes even full-res GTAO viable on an iGPU.

### Anti-aliasing passes: SMAAPass and the new zero-arg FXAAPass

Post-AA cleans the edges MSAA can't (specular aliasing, shader-produced edges like fat-line ends) and is the cheap fallback when you can't afford multisampled render targets on a weak iGPU.

**In three.js.** Both are real Pass subclasses in r180 — this is an API change worth knowing:
- `import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'` — **`constructor()` now takes NO arguments** in r180. Older tutorials do `new SMAAPass(w, h)`; that's stale. It sizes itself via `setSize(w,h)`, which the composer calls (it resizes `_edgesRT` and `_weightsRT`).
- `import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js'` — **`constructor()` also takes no arguments**, and it has its own `setSize()`. This replaces the old `new ShaderPass(FXAAShader)` + manually poking `uniforms.resolution.value.set(1/w, 1/h)`, which was a perennial bug source. `shaders/FXAAShader.js` still exists if you need the raw shader.
Place both AFTER `OutputPass`.

**Cost / benefit.** FXAAPass: ~0.2–0.5ms at 1080p even on an iGPU — essentially free, but it blurs fine text and thin lines, which is actively bad for a CAD viewport full of 1px dimension lines. SMAAPass: ~2–3x FXAA's cost (two extra render targets: edges + blend weights), much better edge reconstruction and far less text/line smearing. **For CAD, prefer multisampled RT > SMAA > FXAA.** FXAA is a last resort for low-end hardware.

### OutlinePass — selection highlighting and silhouette emphasis

The glowing selection outline. In a CAD viewport this is how you show 'this operation / this contour is selected' without changing the object's material, and it reads correctly even when the selected object is occluded.

**In three.js.** `import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';`
`constructor( resolution, scene, camera, selectedObjects )` — note `resolution` is FIRST and is a `Vector2`, unlike most other passes:
```js
const outline = new OutlinePass( new THREE.Vector2(w, h), scene, camera, [] );
outline.selectedObjects = [ mesh ];       // reassign the array to change selection
outline.edgeStrength = 3.0;
outline.edgeGlow = 0.0;                   // 0 = crisp technical outline
outline.edgeThickness = 1.0;
outline.visibleEdgeColor.set( '#ffcc00' );
outline.hiddenEdgeColor.set( '#884400' ); // shows through occluders — very useful for CAD
outline.pulsePeriod = 0;                  // >0 animates, forces continuous rendering
```
For a permanent technical look, set `edgeGlow = 0` and keep `edgeThickness` at 1 — the default glow reads as a game effect, not a CAD one.

**Cost / benefit.** Moderate: it re-renders the SELECTED objects into a depth mask + does a separable blur, so cost scales with selection size, not scene size. Cheap when you select one part. Two warnings: (1) `pulsePeriod > 0` defeats render-on-demand — leave it 0; (2) it does not respect clipping planes on its mask render the way your main material does, so under a section view an outlined object can outline geometry you've clipped away. Verify perceptually before shipping it alongside section views.

### Bloom — use sparingly, and only for emissive machine state

On a technical viewport, bloom is usually WRONG — it destroys line crispness and reads as 'game engine'. The legitimate CAD uses are narrow: a glowing laser spot, a hot cut point, an active-tool indicator, or a status LED.

**In three.js.** `import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';`
`constructor( resolution, strength = 1, radius, threshold )` — `resolution` is a `Vector2`, first arg. There's also a simpler legacy `BloomPass.js` in the same folder.
Correct CAD usage is SELECTIVE bloom: set a high `threshold` (e.g. 0.9–1.0) so only genuinely HDR-bright emissive materials bloom and your white edges/text do not. This requires the composer's HalfFloat RT (which is the r180 default) plus `material.emissive` + `emissiveIntensity > 1`. The layer-mask two-pass technique (render bloom-only layer into a separate composer, additively combine) is the standard way to guarantee nothing else blooms — three ships `webgl_postprocessing_unreal_bloom_selective` as the reference.
Place BEFORE `OutputPass`.

**Cost / benefit.** Expensive on integrated GPUs — UnrealBloomPass runs a 5-level mip pyramid with separable Gaussian blurs, i.e. ~10 extra fullscreen passes. On an Iris Xe at 1080p budget 3–6ms. For a CAD viewport my recommendation is: default OFF, and if you want the laser-spot glow, prefer a cheap additive billboard sprite over a full bloom chain. Reserve bloom for a 'presentation mode' toggle.

### Progressive/temporal AA for a static viewport (SSAARenderPass, TAARenderPass)

The killer technique for CAD specifically: when the camera is NOT moving (which is most of the time in a CAD app), accumulate jittered samples over successive frames to converge on a near-offline-quality, completely alias-free image. Combines beautifully with render-on-demand.

**In three.js.** Both replace `RenderPass` (they render the scene themselves):
- `import { SSAARenderPass } from 'three/addons/postprocessing/SSAARenderPass.js';` — `constructor( scene, camera, clearColor = 0x000000, clearAlpha = 0 )`. Set `sampleLevel` (0–5; level N = 2^N samples). At `sampleLevel = 4` (16 samples) edges are effectively perfect. Set `unbiased = true` for correctness.
- `import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';` — `constructor( scene, camera, clearColor, clearAlpha )`, extends SSAARenderPass. Set `accumulate = true` to progressively refine while idle and reset on camera change.
Pattern: on `controls.addEventListener('change', ...)` set `taaPass.accumulate = false` (fast, single-sample, interactive); when the camera settles, set `accumulate = true` and keep rendering a handful of frames to converge, then stop.

**Cost / benefit.** SSAARenderPass at `sampleLevel=4` costs literally 16 full scene renders in ONE frame — unusable for interaction, perfect for an 'export high-quality screenshot' button. TAARenderPass with `accumulate` spreads that over 16 successive idle frames, so each frame stays cheap and quality builds while the user reads the screen. On an integrated GPU this is the best quality-per-watt option in the whole list for a mostly-static CAD viewport, and it's strictly better than SMAA when idle. Do not combine with an animated bloom pulse or anything that changes per frame, or it never converges.

### IBL for the CAD look: RoomEnvironment + PMREMGenerator + ACESFilmic

The difference between 'three.js default lighting, looks like 2015' and 'looks like Fusion 360 / Onshape'. A studio environment map gives machined metal its characteristic soft gradient falloff and edge highlights that no combination of point lights reproduces. This is the highest-value lighting change you can make.

**In three.js.** ```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const pmrem = new THREE.PMREMGenerator( renderer );
const envMap = pmrem.fromScene( new RoomEnvironment(), 0.04 ).texture;
scene.environment = envMap;
// scene.background stays your flat CAD backdrop — do NOT set it to envMap
```
**r180 API check:** `RoomEnvironment`'s `constructor()` takes NO arguments (older code passed the renderer — stale). `PMREMGenerator.fromScene( scene, sigma = 0, near = 0.1, far = 100, options = {} )` where `options.size = 256` default and `options.renderTarget` positions the internal cube camera. A small `sigma` (blur radius in radians, ~0.02–0.06) softens the room's harsh box edges — important, since RoomEnvironment is literally boxes + point lights (it imports `BoxGeometry`, `MeshLambertMaterial`, `MeshStandardMaterial`, `PointLight`, `InstancedMesh`) and unblurred it puts visible rectangles in your reflections.
Also in `three/addons/environments/`: `DebugEnvironment.js`.
Tone mapping — verified r180 constants: `NoToneMapping(0)`, `LinearToneMapping(1)`, `ReinhardToneMapping(2)`, `CineonToneMapping(3)`, `ACESFilmicToneMapping(4)`, `CustomToneMapping(5)`, `AgXToneMapping(6)`, `NeutralToneMapping(7)`.
```js
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // or NeutralToneMapping
renderer.toneMappingExposure = 1.0;
```
For CAD I'd actually recommend **`NeutralToneMapping`** over ACES: ACES noticeably shifts saturated hues (your color-coded layers/operations will not match their swatches), whereas Neutral (Khronos PBR Neutral) preserves hue and saturation and is designed exactly for product/e-commerce viewing where color fidelity matters. ACES is the cinematic default, Neutral is the accurate one.
Scene-level dials, all verified present in r180 `Scene.js`: `environmentIntensity` (default 1), `environmentRotation` (Euler), `backgroundBlurriness` (0), `backgroundIntensity` (1), `backgroundRotation` (Euler). `environmentIntensity` is the right knob to dial the IBL down so it doesn't wash out your line work.
Dispose the PMREMGenerator (`pmrem.dispose()`) after generating; keep the texture.

**Cost / benefit.** One-time cost (~a few ms to render + prefilter the cube at 256px), then FREE per frame — it's just a texture lookup. No shadow maps, no extra lights, no per-frame CPU. This is the best visual-quality-per-millisecond item in this entire report and it works fine on integrated GPUs. Only ongoing cost is ~256px×6 mip chain of VRAM.

### MeshStandardMaterial vs MeshPhysicalMaterial for CAD parts

Choosing the wrong one costs you real frame time for features a CAD viewport never uses.

**In three.js.** **Use `MeshStandardMaterial` for essentially all CAD geometry.** With an env map, `metalness ~0.9 / roughness ~0.35` reads as machined aluminum; `metalness 0 / roughness 0.6` reads as MDF/acrylic stock.
`MeshPhysicalMaterial` extends Standard and adds (all verified in r180 `MeshPhysicalMaterial.js`): `clearcoat`/`clearcoatMap`/`clearcoatRoughness`/`clearcoatNormalMap`/`clearcoatNormalScale`, `ior` (default 1.5, with the legacy `reflectivity` accessor mapping `ior = (1 + 0.4*r)/(1 - 0.4*r)`), `iridescence`/`iridescenceIOR` (1.3)/`iridescenceThicknessRange` ([100,400])/`iridescenceMap`/`iridescenceThicknessMap`, `sheenColor` (default black = off)/`sheenRoughness`/`sheen*Map`, `transmission`/`transmissionMap`/`thickness`/`thicknessMap`/`attenuation*`, `anisotropy`/`anisotropyRotation`/`anisotropyMap`, `specularIntensity`/`specularColor`, `dispersion`.
The ONLY CAD-relevant ones: `transmission` + `thickness` + `ior` for genuinely transparent stock (acrylic sheet), and `anisotropy` for brushed-metal directionality. `clearcoat` for a glossy painted/anodized finish.
Migration note (r180→r181, official guide): "PBR material lighting improved… rough materials tend to be a bit brighter than in previous versions" and "PMREM reflections enhanced" — so if you tune roughness values now against r180, expect a mild brightness shift when you upgrade past r180. Pin the version or re-tune.

**Cost / benefit.** MeshPhysicalMaterial compiles a materially larger shader even when the features are at their default-off values — every enabled feature adds defines and ALU. `transmission` is the worst: it forces an extra opaque-scene render into a transmission render target, roughly doubling scene cost, and it does not play well with many post-processing passes. On an integrated GPU, one transmissive part can halve your frame rate. Rule: Standard everywhere; Physical only on the specific objects that need it, never as the global default.

### Shadows: PCFSoft directional + the contact-shadow trick

Real-time shadow maps give you the grounding cue that tells the eye where the part sits relative to the bed. Without any shadow, parts float. But a single directional shadow map over a large machine bed is low-resolution and ugly — the contact-shadow technique is the better-looking, cheaper answer for CAD.

**In three.js.** Shadow map types verified in r180 `constants.js`: `BasicShadowMap(0)`, `PCFShadowMap(1)`, `PCFSoftShadowMap(2)`, `VSMShadowMap(3)`.
```js
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
light.shadow.mapSize.set( 2048, 2048 );
light.shadow.bias = -0.0005;      // tune to kill acne without peter-panning
light.shadow.normalBias = 0.02;   // usually the better knob for thin CAD plates
// tighten the ortho frustum to the WORK ENVELOPE, not the whole scene:
const c = light.shadow.camera; c.left=-W/2; c.right=W/2; c.top=H/2; c.bottom=-H/2; c.near=1; c.far=D; c.updateProjectionMatrix();
```
The frustum tightening is the whole game — a 2048 map over a 1500mm bed is ~0.7mm/texel, which is fine; the same map over a default 1000-unit frustum is mush.
**Contact shadows** (the `webgl_shadow_contact` technique — there is no addon class, you build it): render the scene from an `OrthographicCamera` placed under the part looking UP, into a render target, with a depth-fade material; then ping-pong that RT through a `blurPlane` mesh doing horizontal then vertical blur (renderTarget → blurPlane/horizontalBlur → renderTargetBlur → blurPlane/verticalBlur → renderTarget); finally map the blurred texture onto a ground plane with a transparent `MeshBasicMaterial`. Known limitation reported against the official example: it can flicker/distort when viewed from far away or with a large plane size.
For CSM over very large beds there's `three/addons/csm/` in r180.
Also note `material.clipShadows` (default false) — set true if you want section-view clipping to also cut the shadow.

**Cost / benefit.** PCFSoft at 2048² is one extra scene render per shadow-casting light per frame — on an iGPU that's real money. Two strong mitigations for CAD: (1) the scene is mostly STATIC, so set `renderer.shadowMap.autoUpdate = false` and flip `renderer.shadowMap.needsUpdate = true` only when geometry actually changes — this makes shadows nearly free; (2) contact shadows can be baked ONCE into a texture for a static part and cost literally nothing thereafter. Combined with render-on-demand, shadow cost effectively disappears. Use exactly ONE shadow-casting directional light; additional shadowed lights multiply cost linearly for almost no readability gain.

### Matcap — the zero-lighting-cost 'shaded CAD preview' look

MeshMatcapMaterial bakes an entire lighting environment into one small sphere-map texture, sampled by view-space normal. It's exactly the shading model Blender's 'Solid' viewport, SolidWorks quick-render and countless CAD tools use for their fast preview mode, and it's the fastest good-looking material in three.js.

**In three.js.** `THREE.MeshMatcapMaterial` — core, no import path needed beyond `three`. Verified present at `src/materials/MeshMatcapMaterial.js`.
```js
const mat = new THREE.MeshMatcapMaterial({ matcap: matcapTexture, color: 0xcccccc });
matcapTexture.colorSpace = THREE.SRGBColorSpace;   // matcaps are authored in sRGB
```
It supports `normalMap`, `bumpMap`, `displacementMap`, `flatShading`, and `color` tinting, but takes NO lights and NO env map. Pair a neutral grey studio matcap with fat-line edges (Line2 wireframe overlay) and you get a very convincing technical shaded view.
Strong CAD pattern: offer two view modes — 'Shaded' (matcap, instant, works on any GPU) and 'Realistic' (Standard + IBL + GTAO), with matcap as the default on low-end devices or during camera motion.

**Cost / benefit.** Dramatically cheaper than anything PBR: no lights loop, no IBL, no shadow lookups — one texture fetch. Frequently 2–4x the frame rate of a MeshStandardMaterial scene on an integrated GPU. The trade-off is that it's view-space, so the lighting rotates with the camera and objects never cast/receive shadows or reflect their surroundings. For a technical viewport that's usually acceptable and sometimes preferable (consistent readability at every angle). Excellent fallback tier.

### Clipping planes for section views

Section/cutaway views — slice the model on a plane to inspect internal geometry, pocket depths, or the toolpath inside a part. Core three.js, no addon, and it costs almost nothing.

**In three.js.** Verified in r180 `WebGLRenderer.js` and `Material.js`:
```js
renderer.localClippingEnabled = true;                 // required for per-material planes
const plane = new THREE.Plane( new THREE.Vector3(0,-1,0), 0 );
material.clippingPlanes = [ plane ];                  // Material.clippingPlanes, default null
material.clipIntersection = false;                    // default false: union of half-spaces
                                                      // true: intersection — clip only where ALL planes agree
material.clipShadows = false;                         // default false; true = shadows are clipped too
// global planes (apply to everything, no localClippingEnabled needed):
renderer.clippingPlanes = [ plane ];                  // default []
```
Planes are in WORLD space and must be updated if you want them to follow an object (`plane.applyMatrix4( obj.matrixWorld )` against a stored original).
Helper: `THREE.PlaneHelper` (core, `src/helpers/PlaneHelper.js`) visualizes the cutting plane.
**Fat lines DO clip correctly** — verified `LineMaterial` is constructed with `clipping: true` and its shader includes `<clipping_planes_pars_vertex>`, `<clipping_planes_vertex>`, `<clipping_planes_pars_fragment>`, `<clipping_planes_fragment>`. So your toolpath preview sections along with the part. (Custom `ShaderMaterial`s do NOT clip unless you pass `clipping: true` and add those chunks yourself — that's the classic trap.)
**Capped sections** (filling the cut face with a solid color instead of showing a hollow shell) is not built in — the standard technique is the two-pass stencil buffer approach using `Material.stencilWrite`/`stencilFunc`/`stencilRef`/`stencilZPass` (all verified present on `Material`) plus a back-face/front-face pass and a cap plane. three ships `webgl_clipping_stencil` as the reference.

**Cost / benefit.** Very cheap — a per-fragment `discard` and a few uniforms. BUT: enabling clipping forces a shader recompile for affected materials, and CHANGING THE NUMBER of clipping planes recompiles again (the count is a define). Adding/removing planes at runtime causes hitches; allocate the max number of planes up front and disable unused ones by pushing them out of the scene bounds instead. The `discard` also disables early-Z on that material, which on tile-based integrated GPUs has a measurable cost — apply clippingPlanes only to the materials that need sectioning, not globally.

### InstancedMesh for repeated primitives

One draw call for thousands of identical meshes. In a CNC/laser viewport the obvious targets are: bed hold-down holes, t-slot features, grid dots, tab markers, drill-point indicators, per-move arrow glyphs, jog waypoints.

**In three.js.** `THREE.InstancedMesh( geometry, material, count )` — core. Verified r180 API:
```js
const im = new THREE.InstancedMesh( geo, mat, N );
im.setMatrixAt( i, matrix );
im.instanceMatrix.needsUpdate = true;
im.setColorAt( i, color );          // lazily allocates instanceColor as InstancedBufferAttribute(N*3), filled with 1
im.instanceColor.needsUpdate = true;
im.count = visibleN;                // shrink to draw fewer without reallocating — the cheap 'hide' mechanism
im.computeBoundingSphere();         // needed for correct frustum culling after moving instances
im.setMorphAt( i, obj );            // morph targets per instance
im.dispose();
```
Gotchas: (1) `count` is the DRAW count, capped at the allocated size — you cannot grow past the constructor's N without rebuilding; (2) frustum culling is all-or-nothing on the whole InstancedMesh, so a bed-wide instanced set is never culled — keep `boundingSphere` accurate or it may be wrongly culled; (3) raycasting against InstancedMesh returns an `instanceId` on the intersection; (4) `setColorAt` requires `material.vertexColors`-independent handling — instanceColor multiplies the material color automatically.

**Cost / benefit.** Enormous win: 5000 separate `Mesh`es ≈ 5000 draw calls ≈ certain jank on an integrated GPU; 5000 instances = 1 draw call and typically <1ms. The limitation is that ALL instances share one geometry and one material. If you need varied geometry, use BatchedMesh.

### BatchedMesh for many DIFFERENT geometries in one draw call

The generalization of instancing: many distinct geometries AND distinct transforms in a single draw call, with per-instance frustum culling and sorting that InstancedMesh cannot do. This is the right tool for 'draw 800 different parts nested on a sheet' or 'draw every distinct pocket/boss in one call'.

**In three.js.** `THREE.BatchedMesh` — core in r180 (`src/objects/BatchedMesh.js`), no addon import.
```js
// constructor( maxInstanceCount, maxVertexCount, maxIndexCount = maxVertexCount * 2, material )
const bm = new THREE.BatchedMesh( 1000, 200000, 400000, material );
const boxId    = bm.addGeometry( boxGeo );          // ( geometry, reservedVertexCount=-1, reservedIndexCount=-1 )
const sphereId = bm.addGeometry( sphereGeo );
const i0 = bm.addInstance( boxId );                 // returns instanceId
bm.setMatrixAt( i0, matrix );
bm.setColorAt( i0, color );
bm.setVisibleAt( i0, false );
bm.setGeometryIdAt( i0, sphereId );                 // swap which geometry an instance draws
bm.deleteInstance( i0 );  bm.deleteGeometry( boxId );
bm.optimize();                                      // defragment after many deletes
bm.computeBoundingBox();
```
Verified per-instance properties: `perObjectFrustumCulled` (default **true**) and `sortObjects` (default **true**) — these are the big advantages over InstancedMesh. Note in the source that frustum culling is skipped for `camera.isArrayCamera`.
Also verified: it can be resized — there are methods taking `maxInstanceCount` and `(maxVertexCount, maxIndexCount)` to grow the pools.
`three/addons/utils/SceneOptimizer.js` → `SceneOptimizer` is an r180 addon that AUTOMATES this: it walks a scene, groups meshes by material, and converts them into `BatchedMesh` (verified: it constructs `new THREE.BatchedMesh(...)`, calls `addGeometry`/`addInstance`/`setMatrixAt`/`setColorAt`, names the result `${name}_batch`, and reports `stats.batchedMeshes`). Options object includes `debug`. Note it neutralizes per-mesh color (`batchedMaterial.color.set(1,1,1)`) and folds it into per-instance color instead.

**Cost / benefit.** Best-of-both: InstancedMesh's draw-call count with per-object culling and sorting. Costs more VRAM than strictly necessary because you preallocate `maxVertexCount`/`maxIndexCount` pools, and `addGeometry` copies into them. Per-instance culling/sorting is CPU work each frame proportional to instance count — for a few thousand it's cheap; if you have tens of thousands of ALWAYS-visible instances, InstancedMesh with `perObjectFrustumCulled` off-equivalent is leaner. Caveat: geometries added to one BatchedMesh must share attribute layout, and all share one material.

### ViewHelper (axes gizmo) — the corner orientation cube

The clickable XYZ axis gizmo in the corner. Every serious CAD tool has one; its absence is immediately noticeable. It orients the user and gives one-click access to standard views.

**In three.js.** `import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';`
Verified r180 API:
```js
const viewHelper = new ViewHelper( camera, renderer.domElement );  // ctor( camera, domElement )
viewHelper.center.copy( controls.target );   // Vector3, the point it orbits around
viewHelper.setLabels( 'X', 'Y', 'Z' );
viewHelper.setLabelStyle( '24px Arial', '#000000', 14 );  // ( font='24px Arial', color='#000000', radius=14 )
// in the render loop, AFTER the main render:
if ( viewHelper.animating ) viewHelper.update( delta );
viewHelper.render( renderer );
// on pointer events:
if ( viewHelper.handleClick( event ) ) { /* it consumed the click */ }
viewHelper.dispose();
```
Implementation details worth knowing (read from source): it is HARDCODED to a `dim = 128` px square in the **bottom-right** corner. `render()` computes `x = domElement.offsetWidth - dim` and — importantly — `y = renderer.isWebGPURenderer ? domElement.offsetHeight - dim : 0`, i.e. it accounts for the flipped viewport origin between backends. It calls `renderer.clearDepth()`, saves/sets/restores the viewport itself, and renders with its own internal `orthoCamera`. So you must call it AFTER your main render (or after `composer.render()`), and it is NOT part of the post-processing chain — it won't get AO'd or bloomed, which is what you want.
`handleClick` returns a boolean and does its own raycast against the gizmo; it returns false while `animating`. `turnRate` is `2 * Math.PI` rad/sec.
To reposition it away from bottom-right you must fork the file — `dim` and the corner math are not configurable.

**Cost / benefit.** Trivial cost (a handful of tiny sprites and lines in a 128px viewport). Very high UX value. Two integration gotchas: (1) because it renders after the composer, it bypasses your AA — it may look slightly aliased next to a TAA'd scene; (2) `viewHelper.animating` must drive continued rendering, so in a render-on-demand setup you must keep requesting frames while it animates.

### Grids: GridHelper, PolarGridHelper, and infinite-grid alternatives

The ground grid is the primary scale reference in a CAD viewport. A well-made grid with major/minor divisions and distance fade reads as professional; a flat single-density GridHelper reads as a tutorial.

**In three.js.** Core helpers, verified present in r180 `src/helpers/`: `GridHelper.js`, `PolarGridHelper.js`, `AxesHelper.js`, `Box3Helper.js`, `BoxHelper.js`, `PlaneHelper.js`, `ArrowHelper.js`, `CameraHelper.js`, plus the light helpers.
`new THREE.GridHelper( size, divisions, colorCenterLine, colorGrid )` — it's a `LineSegments` with `LineBasicMaterial`, so it suffers the 1px-hairline problem. **CAD-quality pattern:** stack TWO GridHelpers (minor at e.g. 10mm dim grey, major at 100mm brighter), and/or rebuild the grid as a `LineSegments2` + `LineMaterial` so major lines can be 2px and minor 1px. Set `material.depthWrite = false` and a small `polygonOffset` to avoid z-fighting with a bed plane.
**`InfiniteGridHelper` is NOT in three.js** — I verified by grepping the entire r180 `src/` and `examples/jsm/` trees for `infinitegrid`/`contactshadow` (case-insensitive): zero hits. It is a well-known community shader (a full-screen or large quad with a `ShaderMaterial` that computes grid lines analytically from world position using `fwidth()`-based derivatives for pixel-perfect antialiased lines, plus a distance fade). If you want one you write it yourself or vendor it. The derivative-based approach is strictly better-looking than line geometry: constant apparent line width, no aliasing, and free LOD (fade minor lines out as you zoom away).
Since a custom `ShaderMaterial` grid will NOT respect clipping planes by default, pass `clipping: true` and include the `clipping_planes_*` chunks if you use section views.
`three/addons/objects/Sky.js` → `Sky` provides a physical sky (Preetham); r180 JSDoc says it's WebGLRenderer-only and to use `SkyMesh` (`three/addons/objects/SkyMesh.js`) with WebGPURenderer. For a technical viewport a Sky is usually the wrong choice — a subtle vertical gradient background or flat color keeps line work readable. `three/addons/objects/GroundedSkybox.js` exists if you want a grounded HDRI.

**Cost / benefit.** GridHelper: free. Fat-line grid: still one draw call, negligible. Analytic shader grid: one fullscreen-ish quad, cheap, and BY FAR the best-looking — it's the single easiest way to make the viewport feel like Fusion/Blender. Watch the fragment cost of the analytic grid on iGPUs if the quad covers the whole screen; it's still far cheaper than any post-processing pass.

### Render-on-demand — the biggest performance win for a CAD app

A CAD viewport is static the overwhelming majority of the time. Running a 60fps rAF loop that re-renders an unchanging image burns battery, spins fans, heats a laptop, and — on a machine controller UI — steals CPU from the serial streaming loop. Rendering only when something actually changed is the correct architecture and it makes expensive effects (GTAO, TAA, 4x MSAA) affordable on integrated GPUs.

**In three.js.** ```js
let needsRender = true;
const invalidate = () => { needsRender = true; };
controls.addEventListener( 'change', invalidate );   // OrbitControls fires 'change' on every move
// also invalidate on: resize, scene mutation, selection change, material/uniform edits
renderer.setAnimationLoop( () => {
  if ( controls.enableDamping ) { controls.update(); }   // damping needs continuous update while settling
  if ( ! needsRender ) return;
  needsRender = false;
  composer.render();
  viewHelper.render( renderer );
} );
```
Use `renderer.setAnimationLoop(fn)` rather than raw `requestAnimationFrame` — it's the API that also works under WebXR and handles WebGPU's async init.
r180 Controls API notes (verified): `OrbitControls` ctor is `( object, domElement = null )` and it extends the core `Controls` base (`src/extras/Controls.js`) which now has `connect( element )` / `disconnect()`. The base logs `'THREE.Controls: connect() now requires an element.'` when called without one — the source comment says "@deprecated, the warning can be removed with r185", so pass the element explicitly. `controls.update( deltaTime = null )` is required if `enableDamping` or `autoRotate` is true.
Things that silently defeat render-on-demand: `OutlinePass.pulsePeriod > 0`, `TAARenderPass.accumulate` (intentionally — but you must bound the number of accumulation frames), `viewHelper.animating`, any animated dashOffset. Track them with a small 'continuous render requested' counter rather than a single boolean.

**Cost / benefit.** Frequently 95%+ reduction in GPU work for a typical CAD session. This is the enabling technique for everything expensive in this report: with render-on-demand, full-resolution GTAO + 4x MSAA + TAA convergence is entirely reasonable on an Intel iGPU, because you pay only on interaction. Implementation cost is a modest discipline burden — every mutation path must call `invalidate()`, and a missed call shows up as a stale viewport, which is a confusing bug class. Centralize invalidation in your store subscription rather than sprinkling it.

### BufferGeometry attribute updates — partial ranges, usage hints, and what forces a realloc

When a toolpath preview updates live (streaming progress, changing a parameter), naively rebuilding geometry every frame causes GC pressure and driver-side buffer reallocation stalls. r180 has a partial-update API that most code doesn't use.

**In three.js.** Verified in r180 `src/core/BufferAttribute.js`:
- `attribute.setUsage( THREE.DynamicDrawUsage )` — constants verified in `src/constants.js`: `StaticDrawUsage = 35044`, `DynamicDrawUsage = 35048`, `StreamDrawUsage = 35040`.
- `attribute.needsUpdate = true` — the setter increments `version`.
- **`attribute.addUpdateRange( start, count )`** and **`attribute.clearUpdateRanges()`**, backed by an `updateRanges = []` array. This is the modern replacement for the old single `updateRange` object (which was `{offset, count}`); the JSDoc verbatim says "Use the `addUpdateRange()` function to add ranges to this array." Multiple disjoint ranges per frame are supported now, which the old API could not do.
Pattern for a live-updating toolpath:
```js
positions.setUsage( THREE.DynamicDrawUsage );
// per update:
positions.clearUpdateRanges();
positions.addUpdateRange( changedStart * 3, changedCount * 3 );  // in ELEMENTS, not vertices
positions.needsUpdate = true;
```
**Fat-line caveat:** `LineSegmentsGeometry.setPositions()` allocates a BRAND NEW `InstancedInterleavedBuffer` and calls both `computeBoundingBox()` and `computeBoundingSphere()` every time. So for a streaming toolpath, do NOT call `setPositions` per frame — allocate the full-size buffer once, then write into `geometry.attributes.instanceStart.data.array` directly and use `addUpdateRange`/`needsUpdate` on the underlying `InstancedInterleavedBuffer`. Recompute bounds only occasionally.
Also: never call `geometry.dispose()` + recreate per frame; that's the #1 cause of sawtooth memory graphs in three apps.

**Cost / benefit.** Large win for anything live. A full `setPositions` on a 100k-segment toolpath is a multi-MB allocation + full GPU upload + O(n) bounds pass — easily 10–30ms, i.e. a visible hitch. A targeted `addUpdateRange` upload of the changed tail is sub-millisecond. Cost is bookkeeping complexity: you must preallocate a max size and track the write cursor. Worth it only where updates are actually incremental.

### Geometry merging (BufferGeometryUtils) — fewer draw calls, better vertex cache

Draw-call count, not triangle count, is what kills three.js performance on integrated GPUs. Merging static geometry that shares a material into one BufferGeometry is the oldest and still one of the most effective optimizations.

**In three.js.** `import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';`
Verified exported functions in r180 (`examples/jsm/utils/BufferGeometryUtils.js`):
- `mergeGeometries( geometries, useGroups = false )` — the r180 name. (It was renamed from `mergeBufferGeometries` back in r152; any tutorial using the old name is stale.) With `useGroups = true` it emits geometry groups so you can pass an array of materials and keep per-part materials in ONE object — still one object, but N draw calls internally; with `false` you get a true single draw call but a single material.
- `mergeAttributes( attributes )`
- `mergeVertices( geometry, tolerance = 1e-4 )` — welds duplicate vertices; essential before computing smooth normals or `EdgesGeometry` on imported STL/OBJ, which are typically fully unwelded.
- `mergeGroups( geometry )`
- `toCreasedNormals( geometry, creaseAngle = Math.PI / 3 )` — smooth-shades below the crease angle, flat above. **This is the CAD-look normals function**: it gives you smooth fillets and crisp machined edges on the same part, which neither `computeVertexNormals()` nor `flatShading` achieves alone.
- `toTrianglesDrawMode( geometry, drawMode )`
All geometries passed to `mergeGeometries` must have the SAME set of attributes and matching indexed/non-indexed state, or it returns null and warns.
Complementary: `three/addons/utils/SceneOptimizer.js` (BatchedMesh conversion, see that entry) and `three/addons/utils/GeometryCompressionUtils.js` for attribute quantization.

**Cost / benefit.** Merging trades flexibility for speed: you lose per-object visibility, per-object raycasting granularity (you get one hit object, not which part), and per-object transforms — merged geometry is baked in world space. For a CAD app where users select individual features, that's often unacceptable; BatchedMesh is the better modern answer because it preserves per-instance identity, culling and visibility. Use `mergeGeometries` for genuinely static decoration (machine frame, bed fixtures, t-slots) and BatchedMesh for selectable parts. `mergeVertices` + `toCreasedNormals` are pure wins on imported meshes with no downside beyond a one-time CPU pass.

### Device pixel ratio cap and resolution discipline

The cheapest, highest-leverage performance knob there is. On a 3x-DPR laptop, an uncapped renderer is drawing 9x the pixels of a 1x render — and on an integrated GPU that alone is the difference between 60fps and 20fps, before any effect is enabled.

**In three.js.** ```js
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );   // never uncapped
renderer.setSize( width, height );                                   // CSS px; three multiplies internally
composer.setSize( width, height );                                   // composer takes CSS px too and applies its own _pixelRatio
```
Units recap, verified from `WebGLRenderer.js`: `setSize`/`setViewport` store CSS-pixel values in `_viewport`; the GL call multiplies by `_pixelRatio`. `renderer.getSize()` returns CSS px, `renderer.getDrawingBufferSize()` returns DEVICE px. If you construct your own render target for the composer you must size it with `getDrawingBufferSize`, not `getSize` — mixing these up is the classic half-resolution / quarter-resolution bug.
`EffectComposer` reads `renderer.getPixelRatio()` at construction into `_pixelRatio` and applies it in `setSize`, so calling `renderer.setPixelRatio()` AFTER creating the composer leaves the composer stale — call `composer.setPixelRatio()` too, or create the composer after.
Adaptive pattern: measure frame time, and if it exceeds budget step the cap down 2 → 1.5 → 1. Because a CAD viewport is mostly static, a very effective variant is DYNAMIC resolution: render at DPR 1 while the camera is moving, then re-render at full DPR (plus TAA accumulation) once it settles. The user never perceives the low-res frames during motion.

**Cost / benefit.** Capping DPR at 2 typically costs nothing perceptually (2x is already beyond most people's acuity at laptop viewing distance) and saves >50% of fragment work on 3x displays. The motion/idle DPR swap is close to free to implement on top of render-on-demand and is the single best iGPU technique in this report. Only real caveat: thin 1px lines and text look softer at DPR 1, so make sure the low-res frames only appear during motion, never at rest.

### WebGPURenderer and TSL in r180 — status and honest recommendation

Whether to adopt `three/webgpu` now. Short answer for a production CAD/CNC tool on r180: NO, not yet — but structure your code so the port is possible later.

**In three.js.** Verified facts for r180:
- Import surface exists: `package.json` exports `"./webgpu": "./build/three.webgpu.js"` and `"./tsl": "./build/three.tsl.js"`. Usage is `import * as THREE from 'three/webgpu'` instead of `'three'`.
- **Official status, quoted from the threejs.org manual page on WebGPURenderer: "The renderer itself is still in an experimental state although its maturity level has been greatly improved in the last years."** That is r180-era language. Not a production guarantee.
- Automatic WebGL2 fallback: "If a device/browser doesn't support WebGPU, the renderer can automatically fall back to using a WebGL 2 backend." You can force it for testing with `new THREE.WebGPURenderer({ antialias: true, forceWebGL: true })`.
- Async init: use `renderer.setAnimationLoop()` (handles it), or `await renderer.init()`.
- **`EffectComposer` is NOT supported.** The WebGPU post-processing API is the `PostProcessing` class — I verified it is exported from `src/Three.WebGPU.js` (`export { default as PostProcessing } from './renderers/common/PostProcessing.js'`) and its own JSDoc says verbatim "Note: This module can only be used with `WebGPURenderer`." Usage: `const pp = new PostProcessing(renderer); pp.outputNode = pass(scene, camera);`
- **Correction to a claim circulating in secondary sources:** some 2026 blog posts describe a public `RenderPipeline` class as the WebGPU post-processing API. That is WRONG for r180. `src/renderers/common/RenderPipeline.js` exists but is marked `@private`, extends the internal `Pipeline` base alongside `ComputePipeline`/`Pipelines`, and represents a GPU render pipeline object — it is NOT exported from `three/webgpu` (I grepped `Three.WebGPU.js` and `Three.WebGPU.Nodes.js`: zero hits). The public API is `PostProcessing`.
- TSL effect nodes DO exist and are rich — `three/addons/tsl/display/` in r180 contains `GTAONode.js`, `BloomNode.js`, `SMAANode.js`, `FXAANode.js`, `OutlineNode.js`, `DepthOfFieldNode.js`, `SSRNode.js`, `TRAANode.js`, `DenoiseNode.js`, `MotionBlur.js`, `ChromaticAberrationNode.js`, `Lut3DNode.js`, `SSAAPassNode.js`, `PixelationPassNode.js`, plus `boxBlur.js`/`hashBlur.js`. Also `three/addons/tsl/shadows/TileShadowNode.js` and `three/addons/tsl/lighting/TiledLightsNode.js`.
- **`ShaderMaterial`, `RawShaderMaterial` and `onBeforeCompile()` are not supported** — the manual states this part of an app "must be ported to node materials and TSL." This is the killer for a CAD app: `LineMaterial` IS a `ShaderMaterial`, which is exactly why r180 ships parallel `three/addons/lines/webgpu/Line2.js`, `LineSegments2.js`, `Wireframe.js`, and why `Sky.js` has a `SkyMesh.js` twin.
- Churn evidence from the official migration guide, r179→r181: `DepthOfFieldNode` "rewritten… with a new API"; `TRAAPassNode` renamed to `TRAANode`; `GaussianBlurNode` sigma semantics changed ("Custom sigma values must be doubled"); `ReflectorNode`/`AnamorphicNode`/`GaussianBlurNode` resolution changed from Vector2 to scalar `resolutionScale`; then in r181 `PassNode.setResolution()/getResolution()` → `setResolutionScale()/getResolutionScale()`, TSL `PI2` renamed to `TWO_PI`, WebGPU async methods deprecated. That is a lot of breaking API movement in two releases.
Also r180-specific from the migration guide, unrelated to WebGPU but relevant if you load HDRIs: **`RGBELoader` was renamed to `HDRLoader`** and `RGBMLoader` was REMOVED in r180.

**Cost / benefit.** Benefit if you adopt: compute shaders, better draw-call submission, MRT-based post-processing, and a genuinely nicer authoring model in TSL. Cost: experimental status per three's own docs, a hard break on `ShaderMaterial`/`onBeforeCompile`, a completely different post-processing stack you'd rewrite, per-release API churn (four separate breaking renames across r179–r181), and a parallel set of `lines/webgpu` classes to maintain. **Recommendation: stay on `WebGLRenderer` for r180 production.** The techniques in this report — IBL + Neutral tone mapping, GTAO, fat lines, MSAA render target, render-on-demand, DPR capping — deliver the 'fantastic-looking CAD viewport' outcome entirely on WebGL2 with no experimental dependency. Keep the port cheap by isolating renderer construction, the post-processing chain, and material creation behind small factory modules, so the WebGPU swap is a few files rather than a rewrite.

**Sources**

- Local ground truth — three@0.180.0 installed at C:\Users\Asus\LaserForge-2.0\.claude\worktrees\cnc-3d-threejs-upgrade-9d1216\node_modules\three (package.json confirms version 0.180.0 and the exports map: './addons/*' -> './examples/jsm/*', './webgpu' -> './build/three.webgpu.js', './tsl' -> './build/three.tsl.js'). Every module path, constructor signature, property name and default in this report was read directly from this tree.
- Local: node_modules/three/examples/jsm/lines/ — Line2.js, LineSegments2.js, LineGeometry.js, LineSegmentsGeometry.js, LineMaterial.js, Wireframe.js, WireframeGeometry2.js, and the webgpu/ subfolder (Line2.js, LineSegments2.js, Wireframe.js)
- Local: node_modules/three/examples/jsm/postprocessing/ — full directory listing verified; EffectComposer.js (default RT is HalfFloatType with NO samples), OutputPass.js, GTAOPass.js (GTAOPass.OUTPUT enum, setGBuffer, normalMaterial prepass), SSAOPass.js, SAOPass.js, OutlinePass.js, SMAAPass.js and FXAAPass.js (both zero-arg constructors in r180), UnrealBloomPass.js, RenderPass.js, TAARenderPass.js, SSAARenderPass.js
- Local: node_modules/three/src/ — constants.js (tone mapping + shadow map + draw usage constants), renderers/WebGLRenderer.js (localClippingEnabled, getViewport/setViewport CSS-pixel semantics), materials/Material.js (clippingPlanes, clipIntersection, clipShadows, stencil*), materials/MeshPhysicalMaterial.js, scenes/Scene.js (environmentIntensity, environmentRotation, backgroundBlurriness/Intensity/Rotation), objects/BatchedMesh.js, objects/InstancedMesh.js, core/BufferAttribute.js (addUpdateRange/clearUpdateRanges/updateRanges), extras/PMREMGenerator.js, extras/Controls.js, helpers/
- Local: node_modules/three/src/renderers/common/PostProcessing.js and RenderPipeline.js, plus src/Three.WebGPU.js — used to confirm PostProcessing IS the public WebGPU post-processing API and RenderPipeline is @private and NOT exported (contradicting a secondary blog source)
- Local: node_modules/three/examples/jsm/utils/BufferGeometryUtils.js (mergeGeometries, mergeAttributes, mergeVertices, mergeGroups, toCreasedNormals, toTrianglesDrawMode) and SceneOptimizer.js
- Local: node_modules/three/examples/jsm/environments/RoomEnvironment.js, helpers/ViewHelper.js, controls/OrbitControls.js, objects/Sky.js + SkyMesh.js, tsl/display|shadows|lighting/
- https://github.com/mrdoob/three.js/wiki/Migration-Guide — official migration notes r175 through r181 (RGBELoader->HDRLoader and RGBMLoader removal in r180; DepthOfFieldNode rewrite; TRAAPassNode->TRAANode; GaussianBlurNode sigma doubling; resolutionScale changes; r181 PBR lighting/PMREM changes and PassNode setResolutionScale rename)
- https://threejs.org/manual/en/webgpurenderer.html — official WebGPURenderer manual: experimental-state quote, WebGL2 fallback, forceWebGL, await renderer.init(), EffectComposer/ShaderMaterial/onBeforeCompile unsupported
- https://threejs.org/manual/en/how-to-use-post-processing.html — official post-processing manual: composer.render() replaces renderer.render(), OutputPass is last and performs sRGB conversion + tone mapping
- https://github.com/mrdoob/three.js/releases/tag/r180 — r180 release notes
- https://threejs.org/examples/webgl_shadow_contact.html and https://github.com/mrdoob/three.js/blob/master/examples/webgl_shadow_contact.html — official contact-shadow reference implementation (orthographic under-camera, ping-pong horizontal/vertical blur planes, fill plane)
- https://github.com/mrdoob/three.js/issues/20848 — documented flickering/distortion limitation of the contact-shadow example at distance / large plane size
- https://discourse.threejs.org/t/shadow-contact-threejs/29505 — three.js forum thread on the contact-shadow technique

## 3.3 Material removal simulation for a browser/three.js CNC preview: heightmap (Z-map), dexel/tri-dexel, GPU heightfield stamping in WebGL2, voxel/SDF + marching cubes, and making the cut surface look right

### Z-map / heightfield as the core stock representation

Stock = a 2D grid of scalar Z values over the XY bed, z[i][j] = top surface height at that cell. Cutting is a pure min-reduction: z = min(z, toolBottomZ). This is the standard approach (Van Hook, SIGGRAPH '86 'Real-time shaded NC milling display', which reported ~10 cutting ops/sec on 1986 hardware and framed it as image-space Boolean subtraction). cncsim.js does exactly this in the browser: 'a height-field to machine the part; simply a 2D grid of heights... When the tool intersects the part, the height-field is modified and the model is updated.'

**In three.js.** Back it with a Float32Array of w*h in a Web Worker; mirror it into a THREE.DataTexture (format: THREE.RedFormat, type: THREE.FloatType) or a WebGLRenderTarget. Never store a mesh as ground truth — the grid is truth, the mesh/texture is a view. For a 3-axis router (which is all LaserForge emits) a Z-map is exactly sufficient: no undercuts are representable by a 3-axis tool anyway, so tri-dexel buys nothing on the cut side.

**Cost / benefit.** Memory = 4 bytes/cell. 300×300 mm stock at 0.25 mm = 1200×1200 = 1.44M cells = 5.8 MB. At 0.1 mm = 3000×3000 = 9M cells = 36 MB (borderline). Cost is O(cells under tool) per move, independent of program length. Cannot represent undercuts, side-milling under an overhang, or a 4th axis.

### Tool as an analytic bottom-profile function h(r), not a mesh

Every 3-axis cutter's lower envelope is a radially symmetric height offset above the tool tip: h(r) for r = radial distance from the tool axis. Flat endmill: h = 0 for r <= R, else +inf. Ball nose: h = R - sqrt(R^2 - r^2) for r <= R. V-bit (included angle A): h = r / tan(A/2). Bullnose/torus (corner radius rc, radius R): h = 0 for r <= R-rc, else rc - sqrt(rc^2 - (r-(R-rc))^2). Tapered ball (taper angle t, tip radius rt): ball cap up to the tangency radius rt*cos(t), then linear h = (r - rt*cos t)/tan(t)... + cap offset. Cutting a cell = z = min(z, toolTipZ + h(r)).

**In three.js.** Encode as a discriminated union in core: {kind:'flat',radius} | {kind:'ball',radius} | {kind:'vbit',includedAngleDeg} | {kind:'bullnose',radius,cornerRadius} | {kind:'taperedBall',tipRadius,taperDeg}, with a single pure `bottomOffsetMm(profile, r): number` and `maxRadiusMm(profile)`. Same function is used by the CPU stamper AND is transliterated into GLSL for the GPU path — keep them in one place so they cannot drift. Guard r > maxRadius by returning Infinity (CPU) / discard (GLSL).

**Cost / benefit.** Zero memory, exact (no tessellation error), branch-free per cell for the common ball/flat cases. Note CAMotics' own issue #1 flags the opposite problem: it has no closed-form depth function for its tool sweeps, which is precisely why it cannot do dual contouring. Having the closed form is a real architectural advantage — do not throw it away by tessellating tools.

### Capsule stamping: swept segment as distance-to-segment + Z lerp

A G1 move from P0=(x0,y0,z0) to P1 is a swept tool. For a heightfield you do NOT need to sample the path in tiny steps. For each grid cell c, project c onto the XY segment: t = clamp(dot(c-P0xy, d)/|d|^2, 0, 1); r = |c - (P0xy + t*d)|; zAtT = z0 + t*(z1-z0). Then z[c] = min(z[c], zAtT + h(r)). That is the exact lower envelope for a linear XYZ move with a radially symmetric tool — one pass, no marching. Arcs (G2/G3): distance-to-arc has a closed form too (radial distance to the circle, clamped to the swept angular span), or split the arc into chords at a sagitta tolerance of ~0.2 * cellSize.

**In three.js.** Pure function in src/core: `stampSegment(zmap, profile, p0, p1)`. Iterate only the conservative AABB of the two endpoints inflated by maxRadius — convert to integer cell ranges once, clamp to grid. Two nested for-loops, no allocation. Keep it under the 80-line function cap by extracting `segmentAabbCells()` and `radialDistanceToSegment()`.

**Cost / benefit.** Exact for the dominant case, and cost is proportional to swept footprint area, not to path length in steps. A 50 mm move with a 6 mm cutter at 0.25 mm cells touches ~(50+6)*6/0.0625 ≈ 5.4k cells — sub-millisecond. Caveat: this is exact only if the move is monotone in Z along the segment (it is, for a straight-line G1) and the tool is radially symmetric (all standard router tools are). Helical/ramp arcs need the arc form or chording.

### Separable min-filter for the flat-endmill fast path

For a flat endmill, h(r) is a step function, so the stamp is a morphological erosion by a disc — and a disc erosion can be approximated by separable 1D min-filters (or done exactly by a van Herk/Gil-Werman running-min in O(1) per pixel per axis for the square case, then corrected). pngcam's author hits exactly this wall from the other direction: 'quite slow for high-resolution heightmaps because at every single step... we have to examine a tool-sized circle of pixels', and notes the overlapping-subproblem structure invites a DP solution.

**In three.js.** Only worth it for full-field operations (e.g. 'what does the finished part look like' precompute, or a facing pass). Implement van Herk/Gil-Werman running min over rows then columns for the square kernel, then a small circular correction. Do it in a Worker on the Float32Array.

**Cost / benefit.** Turns O(R^2) per cell into O(1) per cell per axis. Only pays off for very large tools or full-field passes; for typical incremental segment stamping the AABB loop is already cheap and this adds a whole second code path. Recommend deferring unless profiling shows the stamper is hot.

### Supersampling the Z-map for anti-aliased walls

A Z-map quantizes cut boundaries to cell centers, so a vertical wall lands on a cell boundary and stair-steps in XY. Two mitigations: (a) simulate at 2× or 3× the display grid and box-downsample for rendering — but downsample with min for 'material present' semantics and with mean only for the shading normal, otherwise you thicken walls; (b) store per-cell subpixel coverage: alongside z, keep a 0..1 coverage value = fraction of the cell's area inside the tool footprint (analytically approximable as clamp(0.5 - (r - R)/cellSize, 0, 1)), and use coverage to blend the wall edge in the fragment shader.

**In three.js.** Simplest robust version: simulate at cellSize/2, render the displaced mesh at cellSize, and pass BOTH the fine height texture (for per-pixel normals and relief) and the coarse one (for vertex displacement). Coverage can ride in the G channel of an RG16F/RG32F target.

**Cost / benefit.** 2× supersample = 4× memory and 4× stamp cost. Coverage is nearly free (one extra clamp in the inner loop) and buys most of the visual win, because the eye reads the wall edge, not the wall interior. Recommend coverage first, supersampling only if it still reads jaggy.

### GPU stamping via a top-down orthographic DEPTH buffer (recommended GPU path)

The depth test IS a min-reduction, in hardware, with early-Z. Set up an orthographic camera looking straight down -Z covering the stock's XY extents, near/far bracketing the stock's Z range. Render each toolpath move as a small piece of geometry whose fragment depth equals the tool's bottom surface. The depth buffer after all moves IS the heightfield, for free, at 24- or 32-bit precision, with no float-blend extension needed and no ping-pong.

**In three.js.** const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType) }); — verified against three@0.180.0: RenderTarget accepts options.depthTexture, and DepthTexture's signature is (width, height, type=UnsignedIntType, mapping, wrapS, wrapT, magFilter=NearestFilter, minFilter=NearestFilter, anisotropy, format=DepthFormat, depth=1). Then renderer.autoClear = false; renderer.setRenderTarget(rt); renderer.clearDepth() ONCE at job start; render only the new segments each frame. Reconstruct world Z in the consumer shader by un-mapping ortho depth: z = near + d * (far - near) for an orthographic camera (linear — no perspective divide, which is the whole reason to use ortho here).

**Cost / benefit.** Fastest option, hardware-accurate min, benefits from early-Z rejection, and is naturally incremental (never clear, just keep drawing). Downsides: you get depth only (no per-cell coverage or 'which pass cut this' payload unless you add an MRT color attachment), and reading it back to CPU for e.g. a depth-probe readout costs a stall. Add a second color attachment via `count: 2` on the render target if you need pass-index/coverage alongside.

### GPU stamping via THREE.MinEquation blending into a float color target (alternative)

Instead of the depth buffer, render into an R16F/R32F color target with blending set to min. Gives you the height as a sampleable color texture directly, plus room for extra channels (coverage, pass index, timestamp for 'chips fly here' effects).

**In three.js.** material.blending = THREE.CustomBlending; material.blendEquation = THREE.MinEquation; material.blendSrc = THREE.OneFactor; material.blendDst = THREE.OneFactor. Verified in three@0.180.0: MinEquation is exported from src/constants.js (value 103) and WebGLState maps it to gl.MIN. CRITICAL, verified gotcha: three's WebGLExtensions auto-requests EXT_color_buffer_float and OES_texture_float_linear but NOT EXT_float_blend — so blending into a THREE.FloatType (32-bit) target throws INVALID_OPERATION unless you call renderer.getContext().getExtension('EXT_float_blend') yourself. THREE.HalfFloatType blends without it.

**Cost / benefit.** More flexible payload than the depth path, and directly sampleable. But half-float has a 10-bit mantissa: near 1.0 the step is ~2^-11, so a normalized-depth encoding over a 50 mm Z range resolves to ~0.024 mm — too coarse for a finish-pass preview. Either take the EXT_float_blend path (widely available on desktop, spottier on mobile) or normalize Z over the *stock thickness only* rather than the machine envelope. The depth-buffer path avoids this entire class of bug — prefer it unless you need the extra channels.

### Instanced capsule impostors: one draw call for the whole toolpath

Don't build a mesh per move. Emit ONE instanced quad (or a short box) per G-code segment, sized to the segment's XY AABB inflated by the tool radius, and let the fragment shader compute the exact tool-bottom Z at that pixel using the same distance-to-segment + h(r) math as the CPU path, writing it to gl_FragDepth. Fragments outside the swept footprint discard.

**In three.js.** THREE.InstancedBufferGeometry with a base PlaneGeometry(1,1) plus THREE.InstancedBufferAttribute streams for p0 (vec3), p1 (vec3), and a packed tool index. ShaderMaterial with glslVersion: THREE.GLSL3 — gl_FragDepth is core in GLSL ES 3.00 (no EXT_frag_depth needed), and three r180 is WebGL2-only so GLSL3 is always available. Set material.depthWrite = true, depthTest = true, depthFunc = THREE.LessDepth, and disable color writes (colorWrite = false) if you're only after depth. Note writing gl_FragDepth defeats early-Z, so keep the impostor quads tight to the swept AABB.

**Cost / benefit.** An entire 200k-segment program becomes one draw call and renders in a few ms. Per-pixel exactness (no tessellation of the tool), and the same closed-form h(r) is shared with the CPU reference implementation so you can unit-test the GLSL against the TS. Main cost: losing early-Z from gl_FragDepth, and instance attribute upload for very long programs (chunk into batches of ~50k).

### Progressive / incremental accumulation instead of re-simulating

Because min is associative and idempotent-in-order, the heightfield after N moves is just the running min. So a scrubbing timeline works as: monotonic forward scrub = draw only the newly-revealed segments; backward scrub = replay from the last keyframe. Keep periodic keyframes (a copy of the height texture every ~2% of the program) so backward scrubbing is bounded.

**In three.js.** Keep renderer.autoClear = false and never clear the accumulation target during forward playback. For keyframes use renderer.copyTextureToTexture (r180) or blit via a fullscreen quad into a ring of 8–16 snapshot targets. CAMotics' own design note for real-time cutting is the same shape: 'invalidate regions of the 3D space and have the renderer regenerate affected 3D blocks as needed.'

**Cost / benefit.** Turns O(program) per frame into O(new segments) per frame — this is what makes a 60fps scrub possible on a 500k-line program. Keyframe ring at 1024×1024 R32F costs 4 MB each; 16 of them = 64 MB. Halve with HalfFloatType if you also halve the Z range you encode.

### Vertex-shader displacement of a static plane grid

Never rebuild geometry on the CPU. Allocate a PlaneGeometry once at the render resolution, and displace each vertex's Z in the vertex shader by sampling the height texture. Vertex texture fetch is unconditionally available in WebGL2.

**In three.js.** const geo = new THREE.PlaneGeometry(stockW, stockH, segX, segY); rotate to XY-up to match the CNC Z-up convention. Use MeshStandardMaterial + onBeforeCompile to inject `transformed.z = texelFetch(uHeight, ivec2(gl_VertexID % (segX+1), gl_VertexID / (segX+1)), 0).r;` into the `begin_vertex` chunk (texelFetch, not texture(), so you land exactly on cell centres with no filtering slop). Keep the standard material so you inherit three's lighting/tonemapping/shadow chunks instead of reimplementing them.

**Cost / benefit.** Zero per-frame CPU work, zero GC. But mesh density is fixed: 1024×1024 segments = 1.05M verts / 2.1M tris, fine on desktop, heavy on integrated GPUs; 512×512 = 262k verts / 524k tris is the safe default. This decouples cleanly from simulation resolution — simulate at 0.1 mm, render at 0.5 mm, and recover the fine detail per-pixel (see the normal-mapping and relief entries).

### Crisp vertical walls, method A: stepped mesh with explicit wall quads

A displaced smooth grid ramps between adjacent cells, so a 6 mm-deep pocket wall renders as a 45° chamfer one cell wide. Fix: render each cell as a FLAT quad at its own height, and insert a vertical quad between horizontally-adjacent cells whose heights differ. This is the 'Minecraft heightfield' topology and it produces geometrically exact vertical walls.

**In three.js.** Build once as an InstancedMesh of unit boxes (one per cell, scaled in Z by the height texture in the vertex shader) — 1024² instances is too many, so chunk it: 64×64 tiles of 128×128 cells, frustum-culled, and only rebuild a tile's instance buffer when its dirty flag is set. Alternatively a non-indexed BufferGeometry with 4 verts/cell where the vertex shader snaps all 4 to the same sampled height, plus a second geometry of wall quads. Wall quads need the *pair* of heights, so give each wall vertex two texel coords and pick min/max by a per-vertex flag attribute.

**Cost / benefit.** Exact walls, correct silhouette from any angle, correct shadows. Costs ~4–6× the vertex count of a plain displaced grid, and cell-sized stair-steps become visible in XY on curved walls unless you also raise the grid resolution. Best for pockets/profiles (LaserForge's dominant CNC case), overkill for 3D relief carving.

### Crisp vertical walls, method B: per-pixel relief raymarching of the heightfield

Keep a cheap coarse displaced mesh, and in the fragment shader raymarch the view ray against the high-resolution height texture (classic relief mapping / relaxed cone step mapping). You get exact per-pixel wall silhouettes, self-occlusion, and correct parallax at a fraction of the geometry cost. Add a modest 'skirt' extrusion so the coarse proxy always encloses the true surface, or silhouettes clip.

**In three.js.** ShaderMaterial (glslVersion GLSL3) on a box proxy of the stock. Transform the view dir into stock space, linear-march 16–32 steps in the height texture, then 5 binary-search refinement steps. Rabbid76's graphics-snippets writeup has a directly-portable GLSL parallax/relief reference. Relaxed cone stepping (Policarpo & Oliveira) needs a precomputed cone map — recomputing it every cut is expensive, so use plain linear+binary march for a live sim and reserve cone maps for a static 'finished part' view.

**Cost / benefit.** Detail is decoupled from triangle count entirely — a 4096² height texture readable on a 12-triangle proxy box. Costs ~20–40 texture fetches per pixel (fine at 1080p on discrete GPUs, painful on integrated), and shadows/depth need gl_FragDepth writes to stay consistent with the rest of the scene. Strong option for a 'zoom in and inspect the finish' mode.

### Normals from the heightfield, with a discontinuity guard

Do NOT bake vertex normals. Compute them per-pixel from central differences on the height texture: n = normalize(vec3(-(hR-hL)/(2*cell), -(hU-hD)/(2*cell), 1)). The Iowa NC-milling tech report describes exactly this: normals derived from neighbouring z-map values via finite differences for shading. The critical addition for CNC: clamp the slope. A wall is a genuine discontinuity, and central differences across it produce a garbage 45°-ish normal that makes walls look like ramps. If abs(hR-hL) > wallThresholdMm (e.g. 1.5 * cellSize), treat the cell as a wall and emit a horizontal normal pointing away from the higher side instead.

**In three.js.** texelFetch the 4 neighbours in the fragment shader at the SIMULATION resolution (not the mesh resolution), then feed the result into MeshStandardMaterial's normal via onBeforeCompile injecting into the `normal_fragment_maps` chunk. Avoid dFdx/dFdy on world position for this — screen-space derivatives blur across the wall over a 2×2 quad and reintroduce the exact artifact you're removing.

**Cost / benefit.** 4 texture fetches per pixel, and it is the single highest-leverage change for making the preview read as 'machined' rather than 'melted'. The threshold is a tunable that must be a named constant, not an inline literal.

### Tool-mark and scallop visualization

What makes a CNC preview convincing is the cusps, not the shape. Three complementary layers: (1) let them emerge — if you simulate at <= 1/4 of the stepover, ball-nose scallops appear automatically from the min-stamping, no faking; (2) an ambient-occlusion / cavity term computed from the heightfield (compare each cell to the mean of a 5–9 tap neighbourhood; darken where below) which makes cusp valleys read strongly; (3) an explicit 'cusp height' analysis overlay that colour-maps residual scallop height so the operator can see where the finish will be rough.

**In three.js.** Cusp math for the overlay: for a ball nose of radius R at stepover s on a flat surface, h = R - sqrt(R^2 - (s/2)^2), which simplifies to h ≈ s^2/(8R) when s << D; rules of thumb are Ra ≈ h/4 and Rz ≈ h. Compute per-cell residual as (localMax - localMin) over a stepover-sized window and colour-ramp it into a toggleable overlay pass. Keep the colour ramp out of raw hex per ADR-047.

**Cost / benefit.** The AO term is one extra 9-tap pass and transforms perceived quality. The cusp overlay is a genuine product feature (it is a diagnostic LightBurn has no analogue for and Easel does not offer), but note it is only meaningful if the sim resolution is finer than the stepover — at 0.5 mm cells and a 0.4 mm stepover the overlay is measuring aliasing, not scallops. Gate the overlay on resolution and say so in the UI.

### Material appearance: triplanar wood with correct end-grain on walls

A single top-down wood texture on a heightfield is the giveaway that it is fake — pocket walls get smeared streaks instead of end grain. Triplanar projection fixes it: blend three planar samples weighted by the squared (or quartic) components of the surface normal, so top faces get face grain and vertical walls get end grain automatically. For wood specifically, generate the grain procedurally as a function of stock-space position so it is consistent across cut depth: rings = fract(noise-warped distance from a grain axis), i.e. the grain exists in the *volume*, and cutting reveals a genuine cross-section.

**In three.js.** MeshStandardMaterial + onBeforeCompile, injecting a triplanar sampler into `map_fragment`. Volumetric grain: pass world/stock-space position (available as vWorldPosition if you enable it, or add a varying) and evaluate 3D value noise in GLSL — no texture needed, and it is resolution-independent, which matters because a 300 mm board at 0.05 mm detail would need an absurd texture. Also vary roughness with the cut-mark AO term so cusp valleys look slightly duller.

**Cost / benefit.** Volumetric procedural grain is the single strongest 'this is real' cue for a router preview and costs ~3 noise evaluations per pixel. Triplanar triples texture fetches if you use a bitmap. Because the grain is a function of position, it costs nothing to keep consistent as material is removed — that is the whole point.

### Dexel / tri-dexel representation

A dexel ('depth element') is a ray along one axis carrying an ordered list of solid intervals [zEnter, zExit] rather than a single height. A single-axis dexel field generalizes a Z-map to handle multiple solid layers along Z (overhangs). Tri-dexel casts rays along X, Y AND Z simultaneously and merges the three fields, which makes it direction-independent: MecSoft's writeup states plainly that the older voxel/box method 'is often direction-dependent, meaning it cannot simulate undercuts or multi-sided setups', while TriDexel 'handles undercuts and multi-sided setups with ease'. This is what CAMotics-class and commercial sims (RhinoCAM, VisualCAD/CAM) use. Origin is Benouamer & Michelucci's triple-ray representation; US5710709A covers 5-axis dexel NC verification.

**In three.js.** Structure: three Float32Array-backed interval lists, typically stored as a flat array + per-ray offset index (CSR-style) because interval counts vary. Cutting a ray = interval subtraction against the tool's swept solid along that ray. Rendering requires reconstructing a surface — either contour each dexel field and merge, or feed the merged field to marching cubes. In JS this is realistically a Worker + WASM job, not a main-thread one.

**Cost / benefit.** Buys you undercuts, true side walls with correct normals from the X/Y fields (this is the real win even for 3-axis: the Z-field alone has no information about a vertical wall, but the X and Y dexel fields sample it densely), and 4th/5th-axis capability later. Costs roughly 3× the memory of a Z-map plus variable-length interval bookkeeping, and a much harder surface-reconstruction step. HONEST ASSESSMENT for LaserForge: for 3-axis GRBL routing, a Z-map plus the wall-quad or relief technique gets ~90% of the visual result for ~20% of the work. Reach for tri-dexel only if a 4th axis or multi-side setup is on the roadmap.

### Voxel / SDF + marching cubes in the browser

Represent stock as a scalar field (occupancy or signed distance) on a 3D grid; cut by min/max-combining the field with the tool's swept-volume SDF; extract a surface with marching cubes. CAMotics does essentially this — its sim directory is built around Sweep/ToolSweep/ConicSweep/SpheroidSweep/CompositeSweep evaluated through an AABBTree + OctTree move lookup, with marching cubes for surface extraction.

**In three.js.** Swept-volume SDFs compose nicely: a moving sphere is a capsule SDF (exact closed form), a moving cylinder is a rounded-box-ish sweep, a V-bit is a cone sweep. Combine with min(). Extract with marching cubes in a Worker (three's examples/jsm/objects/MarchingCubes.js exists but is built for metaballs on a small uniform grid — for a real stock you want your own chunked implementation writing into a reused BufferGeometry with setDrawRange).

**Cost / benefit.** Fully general (undercuts, any axis count) but memory is cubic: 300×300×20 mm at 0.25 mm = 1200×1200×80 = 115M voxels — impossible in a browser tab without sparse/octree storage. Known quality trap, in CAMotics' own words: marching cubes 'has problems detecting sharp features... particularly noticeable when simulating a conical tool', and raising resolution to compensate costs exponentially. Dual contouring fixes sharp features but needs Hermite data (normals at edge crossings) — which you actually CAN supply, because unlike CAMotics you have a closed-form h(r) and can differentiate it analytically. Still: not recommended as the primary path for a 3-axis browser preview.

### Resolution and performance budget (concrete numbers)

Real shipping browser sims expose a resolution ladder rather than one setting. sim.mycnc.app offers exactly: Ultra 0.1 mm (labelled Slow), High 0.25 mm, Medium 0.5 mm, Low 1 mm (labelled Fast), with the grid computed as stock dimension / resolution. That ladder is a good default to copy. For scale on the GPU side: a 4096×4096 R32F height texture is 67 MB (33 MB at half-float) and is about the largest single texture that is safe across desktop GPUs — for a 300 mm stock that is 0.073 mm/texel. 8192² R32F would be 268 MB and will fail or thrash on integrated GPUs.

**In three.js.** Ship 0.25 mm as the default (1200×1200 for a 300 mm stock = 1.44M cells = 5.8 MB Float32 — comfortable), let power users pick 0.1 mm, and decouple render mesh resolution (512² or 1024² plane) from simulation resolution. Detect the budget: cells = ceil(w/res) * ceil(h/res); if cells > a named MAX_SIM_CELLS, coarsen and TELL the user in the preview UI rather than silently degrading. Per CLAUDE.md rule 7, this is a preview-quality knob, not a guard — it must never refuse to render.

**Cost / benefit.** Published GPU-vs-CPU deltas from MecSoft's tri-dexel work give an order-of-magnitude sense of what GPU offload buys: 3-axis wheel hub 12 min → 2 min (5×), 2-axis 98-part nest 33 min → 16 min, 5-axis 2 min → 18 s (6.5×). NOT VERIFIED BY ME: I have not benchmarked any of this in this repo or in a browser; these are vendor-published figures for a desktop native app and should be treated as directional only.

### Worker + zero-copy transfer architecture for the CPU path

If you keep a CPU-side Z-map (worth doing regardless, as the testable ground truth and for depth-probe readouts), it must live off the main thread. Simulate in a Worker on a Float32Array and get the result to the GPU without copying it through the main thread twice.

**In three.js.** Worker owns the Float32Array; post it back with a transfer list (structuredClone transfer, zero-copy) or use a SharedArrayBuffer if COOP/COEP headers are already set (they are needed for SAB — check the Cloudflare/vite config before assuming). On the main thread, wrap it in a THREE.DataTexture(arr, w, h, THREE.RedFormat, THREE.FloatType) and set texture.needsUpdate = true, or use renderer.copyTextureToTexture for partial dirty-rect uploads so you re-upload only the changed sub-rectangle instead of the whole field. Kiri:Moto is the proof this scales in-browser: it is pure JS using 'web workers for distributed computing, WASM for accelerated computation, and ThreeJS for visualization'.

**Cost / benefit.** Keeps the UI at 60fps regardless of program size and gives you a deterministic, unit-testable pure-core simulator (fits the repo's pure-core rule: no window/document, RNG and clock injected). Dirty-rect uploads matter: a full 1200×1200 Float32 texture upload is 5.8 MB per frame, which will stall; a 64×64 dirty rect is 16 KB.

### Validating the sim against ground truth (the fidelity problem)

A material-removal sim is exactly the class of feature where green tests prove nothing — a geometrically wrong stamp still produces a plausible-looking lump. Build the verification in from the start.

**In three.js.** Three cheap, high-value checks: (1) ANALYTIC — stamp a single ball-nose plunge to depth d and assert the resulting Z-map matches R - sqrt(R^2 - r^2) within one cell, as a property test over random R and d (fast-check is already a dependency); (2) VOLUMETRIC — sum(stockThickness - z) * cellArea must equal the analytically-integrated removed volume for a straight slot within a tolerance that scales with cellSize, which catches double-counting and off-by-one AABB bugs; (3) PERCEPTUAL — render a known shape (a 45° V-groove, a stepped pocket, a ball-nose scallop field at a known stepover) to PNG in the existing perceptual harness (src/__fixtures__/perceptual/, ADR-025) and eyeball it against the expected geometry. Add a golden-image diff only after the renderer stabilizes.

**Cost / benefit.** Cheap to write, and it is the only thing standing between 'the tests pass' and 'the preview is lying to the operator about how deep the pocket is'. The volumetric check in particular catches the most common heightfield bug class (wrong cell-range clamping) that no snapshot test would ever surface.

**Sources**

- https://www.semanticscholar.org/paper/Real-time-shaded-NC-milling-display-Hook/018b2581bbe632f83338d0cd10fffd29c37ea4b3
- https://user.engineering.uiowa.edu/~amalek/sweep/TR186298.pdf
- https://patents.google.com/patent/US5710709A/en
- https://camotics.org/
- https://github.com/CauldronDevelopmentLLC/CAMotics
- https://github.com/CauldronDevelopmentLLC/CAMotics/issues/1
- https://github.com/CauldronDevelopmentLLC/CAMotics/issues/2
- https://mecsoft.com/blog/revolutionizing-cam-simulation-nvidia-gpu-accelerated-tridexel-simulation-in-rhinocam-visualcad-cam/
- https://www.euspen.eu/knowledge-base/ICE21279.pdf
- https://incoherency.co.uk/blog/stories/cnc-heightmap-toolpaths.html
- https://github.com/jes/pngcam
- https://github.com/Jamezo97/cncsim.js
- https://github.com/nraynaud/webgcode
- https://sim.mycnc.app/
- https://docs.grid.space/kiri-moto/
- https://github.com/GridSpace/grid-apps
- https://developer.mozilla.org/en-US/docs/Web/API/EXT_float_blend
- https://threejs.org/docs/#api/en/textures/DepthTexture
- https://threejs.org/examples/webgl_materials_blending_custom.html
- https://github.com/mrdoob/three.js/issues/2282
- https://github.com/Rabbid76/graphics-snippets/blob/master/documentation/normal_parallax_relief.md
- https://www.researchgate.net/publication/255571970_Relaxed_Cone_Stepping_for_Relief_Mapping
- https://www.cs.rice.edu/~jwarren/papers/dmc.pdf
- https://www.boristhebrave.com/2018/04/15/dual-contouring-tutorial/
- https://www.machiningdoctor.com/calculators/ball-nose-surface-finish/
- https://cutviewer.com/tools/stepover-calculator/
- https://link.springer.com/article/10.1007/s40436-024-00539-4
- local: C:\Users\Asus\LaserForge-2.0\.claude\worktrees\cnc-3d-threejs-upgrade-9d1216\node_modules\three\src\constants.js (three@0.180.0 — MinEquation=103, MaxEquation=104, HalfFloatType, RedFormat, DepthFormat)
- local: C:\Users\Asus\LaserForge-2.0\.claude\worktrees\cnc-3d-threejs-upgrade-9d1216\node_modules\three\src\renderers\webgl\WebGLState.js (equationToGL[MinEquation] = gl.MIN, line 597)
- local: C:\Users\Asus\LaserForge-2.0\.claude\worktrees\cnc-3d-threejs-upgrade-9d1216\node_modules\three\src\renderers\webgl\WebGLExtensions.js (auto-requests EXT_color_buffer_float and OES_texture_float_linear; EXT_float_blend NOT auto-requested)
- local: C:\Users\Asus\LaserForge-2.0\.claude\worktrees\cnc-3d-threejs-upgrade-9d1216\node_modules\three\src\textures\DepthTexture.js (constructor signature)
- local: C:\Users\Asus\LaserForge-2.0\.claude\worktrees\cnc-3d-threejs-upgrade-9d1216\node_modules\three\src\core\RenderTarget.js (options.depthTexture, options.count for MRT)
- local: C:\Users\Asus\LaserForge-2.0\.claude\worktrees\cnc-3d-threejs-upgrade-9d1216\package.json (three ^0.180.0, @types/three ^0.185.0)

---

# Part 4 — three.js r180 API verification

Read from the **installed** `three@0.180.0` tree under `node_modules/three/`, which is
stronger evidence than documentation or blog posts. Note the version skew flagged in the
risks: the repo runs `three@^0.180.0` against `@types/three@^0.185.0`.

## 4.1 Thick/wide polyline rendering in three.js r180 (0.180.0) via examples/jsm/lines — Line2 / LineSegments2 / LineGeometry / LineSegmentsGeometry / LineMaterial. All claims read from the installed package at C:/Users/Asus/LaserForge-2.0/node_modules/three/ (version confirmed 0.180.0 in package.json:3).

### Line2

**Module.** `three/examples/jsm/lines/Line2.js  (equivalently 'three/addons/lines/Line2.js' — both resolve via package.json exports map lines 12-14)`

**Signature.** class Line2 extends LineSegments2. constructor(geometry: LineGeometry = new LineGeometry(), material: LineMaterial = new LineMaterial({ color: Math.random() * 0xffffff })). Instance props: readonly isLine2 = true; type = 'Line2'.

Pairs with LineGeometry. This is the POLYLINE class — a continuous chain of points. It adds no methods of its own; it exists purely so LineGeometry's pair-expanding setPositions/setColors/setFromPoints are the ones you call. ALWAYS pass an explicit material: the default is a RANDOM color (Math.random()*0xffffff), which would silently produce a different color every reload. Canonical usage from the file's own JSDoc (Line2.js:15-24): const geometry = new LineGeometry(); geometry.setPositions(positions); geometry.setColors(colors); const material = new LineMaterial({ linewidth: 5, vertexColors: true }); const line = new Line2(geometry, material); scene.add(line). WebGLRenderer ONLY — for WebGPURenderer use three/examples/jsm/lines/webgpu/Line2.js (that directory exists and contains Line2.js, LineSegments2.js, Wireframe.js).

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/Line2.js:29-54 (class + constructor defaults), :12-13 (WebGLRenderer-only note), :15-24 (usage example)*

### LineSegments2

**Module.** `three/examples/jsm/lines/LineSegments2.js`

**Signature.** class LineSegments2 extends Mesh. constructor(geometry: LineSegmentsGeometry = new LineSegmentsGeometry(), material: LineMaterial = new LineMaterial({ color: Math.random() * 0xffffff })). Instance props: readonly isLineSegments2 = true; type = 'LineSegments2'. Methods: computeLineDistances(): this; raycast(raycaster: Raycaster, intersects: Array<Object>): void; onBeforeRender(renderer: WebGLRenderer): void.

Pairs with LineSegmentsGeometry. This is the DISJOINT-SEGMENTS class — each consecutive vertex PAIR is an independent segment. It is a Mesh subclass (instanced quad-strip expanded in the vertex shader), so it participates normally in frustum culling, layers, renderOrder, and material sorting. Use LineSegments2 when your data is already pairs (e.g. rapid moves, grid lines, per-move-colored toolpath segments); use Line2 when your data is a point chain. IMPORTANT r180 behavior: LineSegments2.onBeforeRender automatically writes the material's `resolution` uniform from renderer.getViewport() on every frame the object is actually rendered — see the 'resolution' entry.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/LineSegments2.js:251-274 (class + constructor), :283-310 (computeLineDistances), :318-409 (raycast), :411-422 (onBeforeRender)*

### LineSegmentsGeometry

**Module.** `three/examples/jsm/lines/LineSegmentsGeometry.js`

**Signature.** class LineSegmentsGeometry extends InstancedBufferGeometry. constructor(). Props: readonly isLineSegmentsGeometry = true; type = 'LineSegmentsGeometry'. Methods: setPositions(array: Float32Array | Array<number>): this; setColors(array: Float32Array | Array<number>): this; applyMatrix4(matrix: Matrix4): this; fromWireframeGeometry(g: WireframeGeometry): this; fromEdgesGeometry(g: EdgesGeometry): this; fromMesh(mesh: Mesh): this; fromLineSegments(ls: LineSegments): this; computeBoundingBox(): void; computeBoundingSphere(): void; toJSON(): undefined (unimplemented stub, body is a `// todo` comment).

ARRAY LAYOUT (the load-bearing detail): setPositions takes PAIR format — length must be a multiple of 6, laid out [x1,y1,z1, x2,y2,z2] per segment; it wraps the array in `new InstancedInterleavedBuffer(lineSegments, 6, 1)` and exposes it as two InterleavedBufferAttributes: 'instanceStart' (itemSize 3, offset 0) and 'instanceEnd' (itemSize 3, offset 3). It then sets `this.instanceCount = this.attributes.instanceStart.count` and calls computeBoundingBox() + computeBoundingSphere(). setColors is exactly parallel: multiple of 6, [r1,g1,b1, r2,g2,b2] per segment, one InstancedInterleavedBuffer(colors, 6, 1) exposed as 'instanceColorStart' (offset 0) and 'instanceColorEnd' (offset 3). The base (non-instanced) geometry is a fixed 8-vertex / 18-index quad-with-endcaps template built in the constructor — 6 triangles per segment. Note setPositions/setColors accept ONLY Float32Array or a plain Array: any other typed array (Float64Array, a subarray view is fine since it is still a Float32Array) leaves the local variable `undefined` and will throw downstream — there is no else branch and no validation. computeBoundingSphere() console.errors if the radius is NaN, which is your NaN-coordinate tripwire.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/LineSegmentsGeometry.js:97-125 (setPositions), :134-155 (setColors), :43-49 (8-vertex/18-index template), :220-288 (bounding volumes, NaN console.error at :282), :290-294 (toJSON stub)*

### LineGeometry

**Module.** `three/examples/jsm/lines/LineGeometry.js`

**Signature.** class LineGeometry extends LineSegmentsGeometry. constructor(). Props: readonly isLineGeometry = true; type = 'LineGeometry'. Methods (all override/extend the parent): setPositions(array: Float32Array | Array<number>): this; setColors(array: Float32Array | Array<number>): this; setFromPoints(points: Array<Vector3 | Vector2>): this; fromLine(line: Line): this.

ARRAY LAYOUT: unlike the parent, LineGeometry.setPositions takes a FLAT POINT LIST [x1,y1,z1, x2,y2,z2, x3,y3,z3, ...] — one triple per polyline VERTEX, length a multiple of 3 — and expands it internally into the parent's pair format by duplicating interior points. Concretely for N points it allocates `new Float32Array(2 * (3N - 3))` = 6N-6 floats and calls super.setPositions, yielding instanceCount = N-1 segments. setColors is the identical transform on [r,g,b] per point — so the colors array must have the SAME point count as the positions array (3 floats per vertex, N vertices), NOT the pair count. setFromPoints(points) takes Vector3 or Vector2 objects and writes pair format directly (`points[i].z || 0`, so Vector2 is fine); it calls super.setPositions, bypassing LineGeometry.setPositions. There is no setFromPoints-equivalent for colors. fromLine(line) just forwards line.geometry.attributes.position.array to setPositions and assumes NON-INDEXED source geometry; it does NOT copy colors (the body literally has a `// set colors, maybe` comment).

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/LineGeometry.js:50-73 (setPositions expansion, note `const length = array.length - 3` and `new Float32Array(2*length)`), :81-104 (setColors), :112-135 (setFromPoints), :143-153 (fromLine)*

### LineMaterial

**Module.** `three/examples/jsm/lines/LineMaterial.js`

**Signature.** class LineMaterial extends ShaderMaterial. constructor(parameters?: LineMaterialParameters). It calls super({ type: 'LineMaterial', uniforms: UniformsUtils.clone(ShaderLib['line'].uniforms), vertexShader, fragmentShader, clipping: true }) then this.setValues(parameters). FULL set of LineMaterial-specific accessors (all getter+setter pairs on the prototype): color: Color (backed by uniforms.diffuse.value, default 0xffffff); worldUnits: boolean (backed by defines.WORLD_UNITS, default false); linewidth: number (backed by uniforms.linewidth.value, default 1); dashed: boolean (backed by defines.USE_DASH, default false); dashScale: number (uniforms.dashScale.value, default 1); dashSize: number (uniforms.dashSize.value, default 1); dashOffset: number (uniforms.dashOffset.value, default 0); gapSize: number (uniforms.gapSize.value, ACTUAL default 1); opacity: number (uniforms.opacity.value, default 1.0); resolution: Vector2 (uniforms.resolution.value, default new Vector2(1,1)); alphaToCoverage: boolean (backed by defines.USE_ALPHA_TO_COVERAGE, default false). Inherited-but-relevant plain Material/ShaderMaterial props you also pass in the SAME parameters object: vertexColors: boolean, transparent: boolean, depthTest: boolean, depthWrite: boolean, side, blending, toneMapped, fog: boolean, polygonOffset*, clippingPlanes, visible, userData.

UNIFORM DECLARATION (ground truth, UniformsLib.line at LineMaterial.js:9-19): { worldUnits: {value:1}, linewidth: {value:1}, resolution: {value:new Vector2(1,1)}, dashOffset: {value:0}, dashScale: {value:1}, dashSize: {value:1}, gapSize: {value:1} }, merged with UniformsLib.common (which supplies diffuse: new Color(0xffffff) and opacity: 1.0) and UniformsLib.fog. NOTE the `worldUnits` UNIFORM is vestigial — it is declared but never read by either shader; the real switch is the WORLD_UNITS #define set by the accessor. `vertexColors` is NOT a LineMaterial accessor — it is the standard Material boolean; WebGLPrograms reads `material.vertexColors` (WebGLPrograms.js:296) and WebGLProgram emits `#define USE_COLOR` (WebGLProgram.js:629, :798). `alphaToCoverage` does double duty: the define drives smoothstep AA in the fragment shader, and WebGLState reads `material.alphaToCoverage === true` to enable gl.SAMPLE_ALPHA_TO_COVERAGE (WebGLState.js:795-797) — the LineMaterial getter returns the define's presence so both stay in sync. Constructor colors: Material.setValues sees currentValue = this.color = a Color instance and takes the `currentValue.isColor` branch calling `currentValue.set(newValue)`, so `new LineMaterial({ color: 0x22aaff })` works and applies sRGB→working-space conversion. TS: @types/three exports `interface LineMaterialParameters extends ShaderMaterialParameters` with alphaToCoverage/color/dashed/dashScale/dashSize/dashOffset/gapSize/resolution/worldUnits all typed `?: T | undefined`, which is exactOptionalPropertyTypes-compatible.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/LineMaterial.js:9-19 (UniformsLib.line), :21-27 (ShaderLib['line'] merge), :428-453 (constructor), :461-693 (every accessor). Uniform defaults for diffuse/opacity: node_modules/three/src/renderers/shaders/UniformsLib.js:10-11. vertexColors→USE_COLOR: node_modules/three/src/renderers/webgl/WebGLPrograms.js:296 and WebGLProgram.js:629,:798. alphaToCoverage GL state: node_modules/three/src/renderers/webgl/WebGLState.js:795-797. Material.setValues isColor branch: node_modules/three/src/materials/Material.js setValues(). Types: node_modules/@types/three/examples/jsm/lines/LineMaterial.d.ts:3-13*

### LineMaterial.resolution (the viewport uniform)

**Module.** `three/examples/jsm/lines/LineMaterial.js (accessor) + three/examples/jsm/lines/LineSegments2.js (auto-updater)`

**Signature.** get resolution(): Vector2 / set resolution(value: Vector2)  — the setter does `this.uniforms.resolution.value.copy(value)`, i.e. it COPIES INTO the existing Vector2, it does not replace the reference. Default value is new Vector2(1, 1).

In r180 you do NOT have to manage this for rendering. LineSegments2.onBeforeRender(renderer) runs `renderer.getViewport(_viewport); this.material.uniforms.resolution.value.set(_viewport.z, _viewport.w)` every frame, for every object the renderer actually draws. renderer.getViewport returns the CSS-pixel viewport (WebGLRenderer._viewport, NOT multiplied by pixelRatio — pixelRatio is applied separately into _currentViewport), and renderer.setSize() calls setViewport(0,0,width,height), so a browser resize is picked up automatically on the next frame with zero code from you. THERE IS NO SEPARATE setResolution() HELPER — the property setter IS the helper. Three cases where you must still set it yourself: (a) any object that is frustum-culled, has visible=false, or fails object.layers.test(camera.layers) never gets onBeforeRender (WebGLRenderer.js:1992-2005 gates it) so its resolution goes stale — this only matters for raycasting, since a non-rendered object's stale uniform is invisible; (b) raycasting BEFORE the first render, because raycastScreenSpace reads material.resolution to convert to screen space and a (1,1) resolution makes every hit test wrong; (c) if you share ONE LineMaterial across many objects AND render to multiple viewports/render-targets of different sizes in one frame, the last onBeforeRender wins for raycast purposes. If you forget it entirely and only ever render normally: nothing breaks, because r180 sets it for you. Only `linewidth` accuracy depends on it, and only via that auto-update path.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/LineMaterial.js:649-659 (accessor, .copy() semantics) and :642-648 (JSDoc stating LineSegments2.onBeforeRender performs the update). node_modules/three/examples/jsm/lines/LineSegments2.js:411-422 (the auto-update). node_modules/three/src/renderers/WebGLRenderer.js:703-705 (getViewport returns CSS-pixel _viewport), :718-731 (setViewport), setSize→setViewport(0,0,width,height), :1992-2005 (layers/visibility gate before object.onBeforeRender). Shader consumption: LineMaterial.js:103 (`float aspect = resolution.x / resolution.y`) and :220 (`offset /= resolution.y`)*

### Per-vertex colors

**Module.** `three/examples/jsm/lines/LineGeometry.js  /  three/examples/jsm/lines/LineSegmentsGeometry.js`

**Signature.** LineGeometry.setColors(array: Float32Array | Array<number>): this  — flat per-POINT [r,g,b, r,g,b, ...], one triple per polyline vertex, same vertex count as the positions you passed to setPositions. LineSegmentsGeometry.setColors(array): this — flat per-SEGMENT-PAIR [r1,g1,b1, r2,g2,b2, ...], length a multiple of 6. Resulting attributes in BOTH cases: 'instanceColorStart' and 'instanceColorEnd', InterleavedBufferAttribute(InstancedInterleavedBuffer(colors, 6, 1), 3, offset 0 / offset 3).

THREE THINGS ARE REQUIRED, all of them: (1) call geometry.setColors(...); (2) set material.vertexColors = true (or pass vertexColors: true in the constructor params) — without it WebGLProgram never emits `#define USE_COLOR`, the vColor varying is never declared, and your colors are silently ignored with no warning; (3) values must be floats in 0..1 IN THE RENDERER'S WORKING (LINEAR) COLOR SPACE. No color-space conversion is applied to raw geometry color attributes. If your source is an sRGB hex, convert it: `const c = new THREE.Color().setHex(0x22aaff)` (Color.setHex defaults colorSpace=SRGBColorSpace and calls ColorManagement.colorSpaceToWorking) then push c.r, c.g, c.b. Semantics: the vertex shader picks per-quad-end with `vColor.xyz = (position.y < 0.5) ? instanceColorStart : instanceColorEnd`, so each segment linearly interpolates start→end color across its length. The fragment shader's `#include <color_fragment>` chunk does `diffuseColor.rgb *= vColor` — vertex colors MULTIPLY material.color, so leave material.color at white (0xffffff) unless you deliberately want a tint. Per-vertex ALPHA is NOT available: WebGLPrograms only sets vertexAlphas when geometry.attributes.color exists with itemSize 4 (WebGLPrograms.js:297), and LineSegmentsGeometry never creates a 'color' attribute — only 'instanceColorStart'/'instanceColorEnd'. There is no per-vertex WIDTH attribute in this implementation.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/LineSegmentsGeometry.js:134-155 (setColors → instanceColorStart/instanceColorEnd). LineGeometry.js:81-104 (per-point expansion). LineMaterial.js:43-44 (attribute declarations), :90-94 (vColor selection under USE_COLOR), :392 (`#include <color_fragment>`). node_modules/three/src/renderers/shaders/ShaderChunk/color_fragment.glsl.js (`diffuseColor.rgb *= vColor`). color_pars_vertex.glsl.js (varying vec3 vColor under USE_COLOR). node_modules/three/src/math/Color.js:203-214 (setHex applies colorSpaceToWorking). WebGLPrograms.js:296-297 (vertexColors / vertexAlphas)*

### worldUnits (screen-space vs world-space width)

**Module.** `three/examples/jsm/lines/LineMaterial.js`

**Signature.** get worldUnits(): boolean / set worldUnits(value: boolean) — sets or deletes defines.WORLD_UNITS (empty-string value). Default false.

worldUnits = FALSE (default, screen space): `linewidth` is the FULL line width in CSS PIXELS and is constant on screen regardless of camera distance or zoom. The vertex shader expands in NDC: `offset *= linewidth; offset /= resolution.y;` on a quad whose position.x is ±1, giving total width = linewidth CSS px exactly. Lines never get thinner as you dolly out — this is what you want for a CNC toolpath overlay that must stay legible at any zoom. It also means the line does NOT depth-shrink, so it can appear to float over geometry it should be behind. worldUnits = TRUE: `linewidth` is the FULL line width in WORLD (object-local, pre-matrixWorld) UNITS — for LaserForge that means millimetres. The shader builds a real oriented world-space billboard (`float hw = linewidth * 0.5; worldPos.xyz += position.x < 0.0 ? hw*worldUp : -hw*worldUp;` plus a worldFwd thickness so the tube has depth), and the fragment shader does a true ray-vs-segment closest-approach test (closestLineToLine) and discards outside radius — i.e. it renders as a proper round TUBE that perspective-shrinks with distance and interpenetrates 3D geometry correctly with real depth. Use worldUnits:true when the line width MEANS something physical (e.g. drawing a 3.175 mm endmill's actual cut width, or kerf width); use false for UI/annotation lines. Practical caveat: at worldUnits:true a mm-scale linewidth on a far-zoomed view collapses to sub-pixel and aliases badly — pair it with alphaToCoverage:true. The `resolution` uniform is still used in world-units mode (for `aspect`), and raycasting branches on this flag too (raycastWorldUnits vs raycastScreenSpace).

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/LineMaterial.js:479-497 (accessor), :500-505 (JSDoc: 'thickness in CSS pixel units when worldUnits is false ... world units when true'), :156-193 (WORLD_UNITS vertex branch), :195-230 (screen-space vertex branch, `offset *= linewidth; offset /= resolution.y`), :327-357 (WORLD_UNITS fragment tube test). LineSegments2.js:399-407 (raycast branch)*

### Dashed lines

**Module.** `three/examples/jsm/lines/LineSegments2.js (computeLineDistances) + three/examples/jsm/lines/LineMaterial.js (dash uniforms)`

**Signature.** LineSegments2.prototype.computeLineDistances(): this  — inherited by Line2. Adds geometry attributes 'instanceDistanceStart' and 'instanceDistanceEnd' as InterleavedBufferAttribute(InstancedInterleavedBuffer(lineDistances, 2, 1), 1, offset 0 / offset 1). Material side: dashed: boolean (define USE_DASH), dashSize: number, gapSize: number, dashScale: number, dashOffset: number.

YES, computeLineDistances IS REQUIRED, and it is a method on the OBJECT (Line2 / LineSegments2), NOT on the geometry — the source even carries the comment 'for backwards-compatibility, but could be a method of LineSegmentsGeometry'. Exact required order: (1) geometry.setPositions(...) — this must come first because computeLineDistances reads geometry.attributes.instanceStart/instanceEnd; (2) const line = new Line2(geometry, material); (3) line.computeLineDistances(); (4) material.dashed = true (or pass dashed:true to the constructor). You must RE-CALL computeLineDistances() after every setPositions() — nothing does it for you and stale distances give wrong dash phase. The `dashed` setter sets material.needsUpdate = true when the value actually changes, so toggling it at runtime recompiles correctly. UNITS (non-obvious): dashSize/gapSize/dashOffset are compared against vLineDistance = dashScale * (accumulated distance computed from the raw instanceStart/instanceEnd values), i.e. OBJECT-LOCAL world length — they are NOT screen pixels, and this is true even when worldUnits is false. So a dash pattern set in mm stays in mm and its on-screen dash length changes with zoom, while the line's WIDTH stays constant in px. dashScale multiplies the distance (so LARGER dashScale = MORE, shorter dashes for a fixed dashSize). The pattern period is dashSize + gapSize; the fragment discards where `mod(vLineDistance + dashOffset, dashSize + gapSize) > dashSize` — animate dashOffset for a marching-ants effect with zero geometry churn. IMPORTANT VISUAL SIDE EFFECT: dashed mode DISABLES the round caps and round joints. The fragment shader unconditionally discards the endcap band (`if (vUv.y < -1.0 || vUv.y > 1.0) discard;`) under USE_DASH, and in WORLD_UNITS the vertex shader skips the cap extension entirely (`#ifndef USE_DASH`). Dashed lines therefore render with butt ends and visibly notched corners at polyline joints. For LineSegments2 (disjoint pairs) the distance accumulator is still CUMULATIVE across all segments in the buffer, so the dash phase carries over between unrelated segments — usually not what you want for disconnected rapids.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/LineSegments2.js:276-310 (computeLineDistances, incl. the 'could be a method of LineSegmentsGeometry' comment at :285 and the cumulative accumulator at :298-299). LineMaterial.js:64-71 (USE_DASH vertex attributes), :98 (vLineDistance = dashScale * instanceDistance), :170-185 (`#ifndef USE_DASH` cap extension skip), :249-255 (dash fragment uniforms), :319-325 (endcap discard + mod test), :525-549 (dashed setter with needsUpdate), :557-621 (dashScale/dashSize/dashOffset/gapSize accessors)*

### Raycasting (Line2 / LineSegments2)

**Module.** `three/examples/jsm/lines/LineSegments2.js`

**Signature.** raycast(raycaster: Raycaster, intersects: Array<Object>): void. Threshold source: `const threshold = (raycaster.params.Line2 !== undefined) ? raycaster.params.Line2.threshold || 0 : 0;` then `_lineWidth = material.linewidth + threshold;`. Intersection objects pushed have shape { point: Vector3, pointOnLine: Vector3, distance: number, object: LineSegments2, face: null, faceIndex: number (the SEGMENT index), uv: null, uv1: null }.

YES, raycasting is fully supported and implemented (not a stub). The controlling property is `raycaster.params.Line2.threshold` — and this key DOES NOT EXIST on a default Raycaster. Raycaster's constructor initialises params to exactly { Mesh: {}, Line: { threshold: 1 }, LOD: {}, Points: { threshold: 1 }, Sprite: {} } — no Line2 entry — so the threshold silently defaults to 0 and hit-testing is exactly linewidth-wide unless you explicitly do `raycaster.params.Line2 = { threshold: 10 }` yourself. Note the threshold is ADDED to linewidth, so its units follow worldUnits: world units when worldUnits is true, CSS pixels when false. Two code paths: worldUnits:true → raycastWorldUnits() does a true 3D ray-vs-segment distance test against _lineWidth*0.5, camera-independent. worldUnits:false → raycastScreenSpace() projects every segment to screen space using material.resolution and camera matrices, so raycaster.camera MUST be set (Raycaster.setFromCamera does this) — otherwise it console.errors 'LineSegments2: "Raycaster.camera" needs to be set...'. Both paths are preceded by boundingSphere then boundingBox rejection tests, each expanded by the worst-case line half-width (getWorldSpaceHalfWidth for screen-space mode), so a large culled buffer is cheap; but a hit inside the box costs an O(segmentCount) loop with TWO new Vector3 allocations per HIT. faceIndex gives you the segment index, which maps directly back to your toolpath move index — that is the useful handle for click-to-inspect-a-move. Both loops iterate `Math.min(geometry.instanceCount, instanceStart.count)`, so shrinking instanceCount also shrinks raycasting.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/LineSegments2.js:318-409 (raycast, threshold at :329, _lineWidth at :337, camera error at :323-327, bounds culling at :339-397, branch at :399-407), :54-92 (raycastWorldUnits), :94-225 (raycastScreenSpace, intersect shape at :210-219), :38-52 (getWorldSpaceHalfWidth). Default params WITHOUT Line2: node_modules/three/src/core/Raycaster.js:87-93*

### Updating positions without rebuilding / instance-count trimming

**Module.** `three/examples/jsm/lines/LineSegmentsGeometry.js + three/src/core/InterleavedBuffer.js + three/src/renderers/WebGLRenderer.js`

**Signature.** In-place: geometry.attributes.instanceStart.data  → the shared InstancedInterleavedBuffer. Write into `.array` (Float32Array, stride 6), then set `geometry.attributes.instanceStart.needsUpdate = true` (InterleavedBufferAttribute's setter delegates straight to `this.data.needsUpdate = value`, which does `this.version++`). Partial upload: buffer.addUpdateRange(start: number, count: number) / buffer.clearUpdateRanges(). Usage hint: buffer.setUsage(THREE.DynamicDrawUsage). Trimming: geometry.instanceCount = n (number). Bounds: geometry.computeBoundingBox(); geometry.computeBoundingSphere().

THREE WAYS TO AVOID REBUILDING, best first. (1) TRIM, don't rebuild — allocate the buffer ONCE at full size, then set `geometry.instanceCount = n` to draw only the first n segments. WebGLRenderer does `const instanceCount = Math.min(geometry.instanceCount, maxInstanceCount); renderer.renderInstances(drawStart, drawCount, instanceCount)`. This is a single scalar write, zero GPU traffic, and it is exactly the right mechanism for progressive toolpath playback / pass-by-pass reveal. It also automatically shrinks the raycast loop. (2) EDIT IN PLACE — get the Float32Array via geometry.attributes.instanceStart.data.array, patch the floats you need (stride 6: [sx,sy,sz,ex,ey,ez] per segment), and flag needsUpdate on the attribute. Set `.setUsage(DynamicDrawUsage)` on the InstancedInterleavedBuffer once beforehand, and use addUpdateRange(start,count) to upload only the touched slice instead of the whole buffer. YOU MUST manually call geometry.computeBoundingBox() and geometry.computeBoundingSphere() afterwards — in-place edits leave the cached bounds stale, which breaks frustum culling AND the raycast bounds rejection. (3) FULL REBUILD via setPositions() — this allocates a brand-new Float32Array and a brand-new InstancedInterleavedBuffer + two InterleavedBufferAttributes every call, so it churns GC and forces a full GPU re-upload. For LineGeometry it allocates TWICE the point data (Float32Array(2 * (3N-3))). Avoid per-frame. See the _maxInstanceCount pitfall — growing a geometry via setPositions after first render is a trap.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/WebGLRenderer.js:1250-1255 (instanceCount clamp + renderInstances). node_modules/three/src/core/InterleavedBufferAttribute.js:101-103 (needsUpdate delegates to data). node_modules/three/src/core/InterleavedBuffer.js:101-105 (needsUpdate → version++), :113-119 (setUsage), :127-139 (addUpdateRange / clearUpdateRanges). LineSegmentsGeometry.js:111-121 (setPositions allocates fresh buffer + attributes and recomputes bounds), :220-288 (computeBoundingBox/Sphere). LineGeometry.js:54-56 (2x allocation)*

### Module format / bundling (dynamic-import compatibility)

**Module.** `three/examples/jsm/lines/*.js  — all five modules`

**Signature.** Pure ES modules. Named exports only, one class each: export { Line2 }, { LineSegments2 }, { LineGeometry }, { LineSegmentsGeometry }, { LineMaterial }. No default exports.

CONFIRMED SAFE for the existing lazy-load pattern. three's package.json declares "type": "module" and an exports map with both "./examples/jsm/*": "./examples/jsm/*" and "./addons/*": "./examples/jsm/*", so either specifier resolves. Every external import is the bare specifier 'three' — LineSegments2.js imports { Box3, InstancedInterleavedBuffer, InterleavedBufferAttribute, Line3, MathUtils, Matrix4, Mesh, Sphere, Vector3, Vector4 } from 'three'; LineSegmentsGeometry.js imports { Box3, Float32BufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, Sphere, Vector3, WireframeGeometry } from 'three'; LineMaterial.js imports { ShaderLib, ShaderMaterial, UniformsLib, UniformsUtils, Vector2 } from 'three'. Nothing reaches into three/src, nothing touches window/document/process at module scope, no CJS, no side-effectful globals beyond three's own ShaderLib (see pitfall). ZERO NEW DEPENDENCIES — these files are already on disk inside the existing `three@^0.180.0` dependency, so ADR-098 §2 is not engaged at all. The host repo already proves the pattern works under Vite: src/ui/relief-viewer/relief-three-scene.ts:34 does `const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');`. The identical form — `const { Line2 } = await import('three/examples/jsm/lines/Line2.js');` — will code-split the same way. They are also re-exported from three/addons (Addons.js:72-78) but do NOT import that barrel: it pulls in the entire addons surface and destroys code-splitting.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/package.json:4 ("type": "module"), :12-14 (exports map for ./examples/jsm/* and ./addons/*). Import lines: LineSegments2.js:1-14, LineSegmentsGeometry.js:1-10, LineMaterial.js:1-7, Line2.js:1-3, LineGeometry.js:1. node_modules/three/examples/jsm/Addons.js:72-78. Existing project usage: C:/Users/Asus/LaserForge-2.0/.claude/worktrees/cnc-3d-threejs-upgrade-9d1216/src/ui/relief-viewer/relief-three-scene.ts:34. Declared dep: package.json:57 ("three": "^0.180.0")*

### Pitfalls (24)

- SILENT DRAW-COUNT CLAMP when a geometry GROWS. WebGLBindingStates caches `geometry._maxInstanceCount = data.meshPerAttribute * data.count` the FIRST time the geometry is bound, guarded by `=== undefined`, and it is ONLY ever deleted in WebGLGeometries.onGeometryDispose. WebGLRenderer then draws `Math.min(geometry.instanceCount, maxInstanceCount)`. So if you render a LineGeometry with 500 segments and later call setPositions() with 5000 segments on the SAME geometry object, only the first 500 render — no error, no warning. Fix: either allocate at max size once and trim with geometry.instanceCount, or call geometry.dispose() before growing, or create a fresh LineGeometry. Evidence: node_modules/three/src/renderers/webgl/WebGLBindingStates.js:361-363 and :403-405; WebGLGeometries.js:40-44; WebGLRenderer.js:1250-1255.
- `worldUnits` setter does NOT set needsUpdate — this is an inconsistency in the material itself. `dashed` (LineMaterial.js:531-537) and `alphaToCoverage` (:673-681) both set this.needsUpdate = true when the value flips, but `worldUnits` (:485-497) only mutates this.defines. Toggling material.worldUnits after the shader program has been compiled will NOT recompile it, and the change appears to do nothing. Fix: set `material.needsUpdate = true` yourself immediately after assigning worldUnits, or decide worldUnits at construction time and never change it.
- @types/three IS VERSION-SKEWED AND WRONG IN ONE PLACE. package.json pins three ^0.180.0 but @types/three ^0.185.0 (verified: node_modules/@types/three/package.json version 0.185.0). Concretely, LineSegments2.d.ts:21 declares `resolution: Vector2` as a property ON THE OBJECT — no such property exists on LineSegments2 at runtime in r180 (only material.resolution does). Under strict TS you will be allowed to write `line.resolution = v`, it compiles, and it does absolutely nothing. Always go through `line.material.resolution`. Also LineGeometry.d.ts does not redeclare setFromPoints, so TS resolves it to BufferGeometry.setFromPoints — signature-compatible, but the runtime semantics differ (LineGeometry's override builds pair format).
- gapSize's JSDoc default is WRONG in the source. LineMaterial.js:610 documents `@default 0` but the actual uniform initialiser is `gapSize: { value: 1 }` at LineMaterial.js:17 (the @types d.ts:73 correctly says 1). Do not rely on the JSDoc; pass gapSize explicitly.
- Importing LineMaterial MUTATES three's shared singletons at module-evaluation time: it assigns `UniformsLib.line = {...}` and `ShaderLib['line'] = {...}` at top level (LineMaterial.js:9-19 and :21-27) before the class is even declared. Consequences: (a) if two copies of `three` ever end up in the bundle, LineMaterial will be patching the OTHER copy's ShaderLib and instanceof checks / uniform lookups break in confusing ways — keep a single three instance (Vite dedupe); (b) this is genuine module-level mutable state, so if a reviewer cites the CLAUDE.md 'no module-level mutable variables' rule, the correct answer is that it lives in three's vendored code, not ours, and is unavoidable when using this addon.
- vertexColors is silently ignored if you forget it. geometry.setColors() alone does nothing visible — WebGLPrograms reads `material.vertexColors` to emit `#define USE_COLOR`, and without it the vColor varying is never even declared. No warning is logged. Symptom: every line renders in material.color.
- Vertex colors MULTIPLY material.color (`diffuseColor.rgb *= vColor` in the color_fragment chunk). If material.color is anything other than white your per-move colors come out tinted/darkened. Set color: 0xffffff whenever vertexColors is true.
- Vertex color values get NO color-space conversion. Raw floats in the instanceColor attributes are treated as already being in the renderer's working (linear) space. Feeding sRGB-derived 0..1 values (e.g. hex/255) produces visibly washed-out lines. Convert via `new THREE.Color().setHex(0x…)` (Color.js:203-214 applies ColorManagement.colorSpaceToWorking) and read .r/.g/.b.
- Per-vertex ALPHA is impossible with this implementation. WebGLPrograms only enables vertexAlphas when `geometry.attributes.color` exists with itemSize 4 (WebGLPrograms.js:297); LineSegmentsGeometry only ever creates instanceColorStart/instanceColorEnd. Fade-out effects must go through material.opacity (uniform, whole-object) or a second material.
- Dashed lines LOSE the round caps and round joins. Under USE_DASH the fragment shader unconditionally discards the endcap band (`if (vUv.y < -1.0 || vUv.y > 1.0) discard;`, LineMaterial.js:321) and the WORLD_UNITS vertex path skips the cap extension entirely (`#ifndef USE_DASH`, :170-185). Expect butt ends and notched polyline corners in dashed mode. If joint quality matters, do not use dashed.
- computeLineDistances() is on the OBJECT, not the geometry, and is NOT called for you. Order matters: setPositions() FIRST (it reads instanceStart/instanceEnd), then construct the Line2, then computeLineDistances(). Re-call it after every setPositions() or dash phase goes stale. Calling it before any positions exist throws on undefined attributes.
- For LineSegments2 (disjoint pairs) computeLineDistances accumulates distance CUMULATIVELY across the whole buffer (`lineDistances[j] = (j===0) ? 0 : lineDistances[j-1]`, LineSegments2.js:298-299) rather than restarting per segment — so dash phase bleeds between unrelated segments (e.g. separate rapid moves).
- In-place buffer edits leave bounding volumes STALE. setPositions() calls computeBoundingBox/computeBoundingSphere for you (LineSegmentsGeometry.js:120-121); writing directly into `attributes.instanceStart.data.array` does not. Stale bounds break frustum culling (line pops out of view) and, worse, the boundingSphere/boundingBox early-outs in raycast() (LineSegments2.js:339-397), so clicks stop registering. Recompute both after any in-place edit.
- raycaster.params.Line2 DOES NOT EXIST by default. Raycaster's constructor creates only { Mesh, Line, LOD, Points, Sprite } (src/core/Raycaster.js:87-93), and LineSegments2.raycast reads `(raycaster.params.Line2 !== undefined) ? raycaster.params.Line2.threshold || 0 : 0`. So the hit tolerance is 0 out of the box — thin lines become near-impossible to click. Set `raycaster.params.Line2 = { threshold: N }` explicitly (N is in world units when worldUnits:true, CSS pixels when false).
- Screen-space raycasting silently misbehaves before the first render, because raycastScreenSpace reads material.resolution — which is only populated by LineSegments2.onBeforeRender on objects the renderer actually drew. A brand-new, never-rendered, frustum-culled, layer-masked, or visible:false line still has resolution (1,1) and every screen-space hit test against it is wrong. Set material.resolution manually if you must raycast before/without rendering.
- alphaToCoverage does nothing without MSAA. The define drives smoothstep-based edge alpha and WebGLState enables gl.SAMPLE_ALPHA_TO_COVERAGE (WebGLState.js:795-797), but sample-alpha-to-coverage requires a multisampled framebuffer — i.e. `new WebGLRenderer({ antialias: true })` or an MSAA render target. On a non-MSAA target it is a no-op and you keep the hard discard edges.
- transparent:true double-blends at joints and caps. Line2 polylines are drawn as independent per-segment quads with round caps that OVERLAP at every shared vertex (@types LineMaterial.d.ts:20 confirms 'always rendered with round caps and round joints'). With alpha blending on, that overlap composites twice and produces visibly darker beads at every corner — very noticeable on dense traced toolpaths. Prefer transparent:false + alphaToCoverage:true for AA; if you genuinely need translucency, expect the beading. (Reasoned from the shader geometry, not separately benchmarked.)
- Line2's DEFAULT material is a RANDOM color: `new LineMaterial({ color: Math.random() * 0xffffff })` (Line2.js:37, LineSegments2.js:259). Never rely on the default — always pass an explicit material, or your line color changes every page load and any golden-image/perceptual comparison is nondeterministic.
- setPositions/setColors validate NOTHING. They accept only `array instanceof Float32Array` or `Array.isArray(array)`; anything else (Float64Array, a regular ArrayBuffer, a Float32Array-like from a worker transfer that lost its prototype) falls through both branches leaving the local `undefined`, and the failure surfaces later as an opaque throw inside InstancedInterleavedBuffer. There is also no multiple-of-6 (or multiple-of-3) length check — a mis-sized array just silently truncates or produces garbage segments. Validate at your own boundary. Evidence: LineSegmentsGeometry.js:99-109 and :136-146.
- NaN coordinates are only caught late and only as a console.error, not a Result/throw: computeBoundingSphere logs 'THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN...' (LineSegmentsGeometry.js:280-284) and then renders nothing. Given this repo's existing history with NaN in clipper/offset output, screen NaN before it reaches the geometry.
- LineSegmentsGeometry.toJSON() is an UNIMPLEMENTED STUB — the body is literally `// todo` and it returns undefined (LineSegmentsGeometry.js:290-294). Any scene serialization path (Object3D.toJSON) that walks a Line2 will produce broken/undefined geometry JSON. Do not put Line2 in anything you serialize.
- The `worldUnits` UNIFORM (UniformsLib.line.worldUnits, LineMaterial.js:11) is dead code — neither shader reads it. Only the WORLD_UNITS #define matters. Setting the uniform directly does nothing.
- LineGeometry.setPositions allocates 2x the input every call (`new Float32Array(2 * (3N-3))`, LineGeometry.js:54-56) plus a new InstancedInterleavedBuffer and two InterleavedBufferAttributes. On a large traced toolpath called per-frame this is serious GC churn. Build once; animate with geometry.instanceCount.
- LineGeometry.fromLine() does not transfer colors — the body contains a bare `// set colors, maybe` comment (LineGeometry.js:149). Same for LineSegmentsGeometry.fromMesh and fromLineSegments. Both also assume NON-INDEXED source geometry and will produce wrong results on an indexed BufferGeometry with no warning.

### Explicitly UNVERIFIED

- PERFORMANCE THRESHOLDS — I did not benchmark, so I will not name a segment count at which it 'hurts'. What I CAN state from the source: every segment costs 24 bytes of GPU vertex data for positions (stride 6 x Float32) plus 24 bytes if you also supply colors, and expands to 8 vertices / 18 indices / 6 triangles via one instanced draw call for the whole geometry (LineSegmentsGeometry.js:43-49; WebGLRenderer.js:1250-1255). So a 1,000,000-segment path is ~24 MB of positions in ONE draw call — memory and draw-call count are NOT the bottleneck. The real cost is vertex-shader invocations (8 per segment) and, dominantly, FILL RATE: with linewidth > 1 px and many overlapping segments the same pixels are shaded repeatedly, and each fragment runs the closestLineToLine ray-vs-segment math in worldUnits mode. Where that crosses into jank depends entirely on the target GPU, linewidth, and zoom level, and must be measured on the maintainer's actual hardware at representative zoom. Anyone quoting a number without a profile is guessing.
- I have NOT rendered anything. Every claim above is read from the installed source; none of it is perceptually verified. In particular the joint-quality claims (round joins from overlapping caps; alpha double-blending beads at corners; dashed mode's notched corners) are reasoned from the shader math and the @types doc line, not confirmed against a rendered image. Per CLAUDE.md rule 2, do not treat this as proof the output looks correct — render a representative toolpath and compare before calling any of it working.
- I did not fetch any threejs.org docs or example pages. All evidence is installed-file paths and line numbers, which is the higher-quality source per the ground rules — but it means I cannot cite the official webgl_lines_fat example's recommended settings, and I have not confirmed the r180 online docs agree with the installed JSDoc (the gapSize @default discrepancy above suggests the JSDoc is not perfectly maintained).
- The GLSL varying situation is odd and I did not chase it: the fragment shader declares `varying float vLineDistance;` UNCONDITIONALLY (LineMaterial.js:257) while the vertex shader only declares and writes it under #ifdef USE_DASH (:64-71). Whether that relies on driver dead-varying elimination or on three's GLSL3 conversion is UNVERIFIED. It evidently ships and works, but I cannot assert why, and I cannot rule out a warning on unusual drivers.
- I did not examine the webgpu variants (examples/jsm/lines/webgpu/Line2.js, LineSegments2.js, Wireframe.js) beyond confirming the files exist. If the project ever moves to WebGPURenderer, that API is a separate verification job — the WebGL LineMaterial explicitly does not work there and Line2NodeMaterial is named as the replacement (LineMaterial.js:411-412).
- Whether Vite in this repo is configured to dedupe `three` (relevant to the ShaderLib-singleton pitfall) — I did not read vite.config. Worth a one-line check before shipping.
- I did not verify how these classes interact with the project's existing relief-viewer scene setup, its camera type (an orthographic camera changes the `bool perspective = (projectionMatrix[2][3] == -1.0)` branch at LineMaterial.js:125 — the trimSegment near-plane fix is skipped for ortho, which is correct but means I have not confirmed behavior at ortho + extreme zoom), or its render loop's viewport/pixelRatio handling.

## 4.2 Premium CAD look in three.js r180 (0.180.0): EffectComposer post-processing, AO passes, OutputPass/tone mapping, antialiasing strategies, RoomEnvironment+PMREM IBL, and shadow setup — verified against the installed package at C:/Users/Asus/LaserForge-2.0/node_modules/three/ (version confirmed 0.180.0 in package.json line 3). Note: @types/three installed is 0.185.0 (node_modules/@types/three/package.json:3), which is AHEAD of the runtime and has real skew — see pitfalls.

### EffectComposer

**Module.** `three/addons/postprocessing/EffectComposer.js  (equivalently 'three/examples/jsm/postprocessing/EffectComposer.js'; both resolve via package.json exports './addons/*' and './examples/jsm/*')`

**Signature.** new EffectComposer(renderer: WebGLRenderer, renderTarget?: WebGLRenderTarget)
  .addPass(pass: Pass): void
  .insertPass(pass: Pass, index: number): void
  .removePass(pass: Pass): void
  .isLastEnabledPass(passIndex: number): boolean
  .render(deltaTime?: number): void   // deltaTime in SECONDS; omit and it uses its internal Clock
  .reset(renderTarget?: WebGLRenderTarget): void
  .setSize(width: number, height: number): void   // LOGICAL px; multiplied internally by _pixelRatio
  .setPixelRatio(pixelRatio: number): void        // calls setSize() again internally
  .dispose(): void
Public fields: renderer, renderTarget1, renderTarget2, writeBuffer, readBuffer, renderToScreen (default true), passes: Pass[], copyPass: ShaderPass, clock: Clock

If no renderTarget is passed, it builds one itself as `new WebGLRenderTarget(width*pixelRatio, height*pixelRatio, { type: HalfFloatType })` (line 69) and clones it for rt2 — so samples defaults to 0 => NO MSAA. addPass() immediately calls pass.setSize(width*pixelRatio, height*pixelRatio) (line 152), so the sizing contract is: pass.setSize receives DEVICE pixels while composer.setSize receives LOGICAL pixels. On resize you must call composer.setSize(w,h) in addition to renderer.setSize(w,h); on DPR change call composer.setPixelRatio(renderer.getPixelRatio()). render() saves/restores renderer.getRenderTarget() around the chain (lines 224, 274). The last ENABLED pass is auto-forced to renderToScreen (line 234), so toggling pass.enabled is a safe quality-tier lever without reordering.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/EffectComposer.js:52 (ctor), :69 (default RT HalfFloatType), :149-154 (addPass), :214-276 (render), :315-332 (setSize), :340-346 (setPixelRatio), :129 (this.clock = new Clock())*

### RenderPass

**Module.** `three/addons/postprocessing/RenderPass.js`

**Signature.** new RenderPass(scene: Scene, camera: Camera, overrideMaterial: Material|null = null, clearColor: Color|null = null, clearAlpha: number|null = null)
Fields: scene, camera, overrideMaterial, clearColor, clearAlpha, clear (true), clearDepth (false), needsSwap = false

RenderPass renders into readBuffer and sets needsSwap=false — this is why it composes correctly as pass[0]. Crucially it calls renderer.setRenderTarget(readBuffer), NOT null, which is the mechanism by which EffectComposer bypasses the renderer's default-framebuffer MSAA (see pitfalls).

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/RenderPass.js:30 (ctor), :95 (needsSwap = false), :146 (renderer.setRenderTarget(this.renderToScreen ? null : readBuffer)), :155 (renderer.render)*

### GTAOPass (recommended AO in r180)

**Module.** `three/addons/postprocessing/GTAOPass.js`

**Signature.** new GTAOPass(scene: Scene, camera: Camera, width = 512, height = 512, parameters?: { depthTexture?, normalTexture? }, aoParameters?, pdParameters?)
  .output: number  // GTAOPass.OUTPUT.{Off:-1, Default:0, Diffuse:1, Depth:2, Normal:3, AO:4, Denoise:5}
  .blendIntensity: number = 1
  .updateGtaoMaterial({ radius?, distanceExponent?, thickness?, distanceFallOff?, scale?, samples?, screenSpaceRadius? })
  .updatePdMaterial({ lumaPhi?, depthPhi?, normalPhi?, radius?, radiusExponent?, rings?, samples? })
  .setSceneClipBox(box: Box3 | null)
  .setGBuffer(depthTexture?, normalTexture?)
  .setSize(width, height); .dispose(); get gtaoMap: Texture
Shader defaults (GTAOShader): SAMPLES=16, SCREEN_SPACE_RADIUS=0, SCREEN_SPACE_RADIUS_SCALE=100.0, SCENE_CLIP_BOX=0; uniforms radius=0.25, distanceExponent=1, thickness=1, distanceFallOff=1, scale=1.
Denoise defaults set in ctor: lumaPhi=10, depthPhi=2, normalPhi=3, radius=8; pdSamples=16, pdRings=2, pdRadiusExponent=2.

This is the modern recommended AO in r180 — its own JSDoc says 'GTAOPass provides better quality than SSAOPass but is also more expensive' (line 32), and SSAOPass's JSDoc says SAOPass and GTAOPass 'produce a more advanced AO but are also more expensive' (SSAOPass.js:33-34). It renders its own normal+depth GBuffer via MeshNormalMaterial each frame, then GTAO, then a Poisson denoise, then blends onto readBuffer with `Default` output. needsSwap stays TRUE (it does not override it), so it writes into writeBuffer — correct as a mid-chain pass. It works with an OrthographicCamera: PERSPECTIVE_CAMERA is derived from `camera.isPerspectiveCamera` (line 155). `radius` is in WORLD units and defaults to 0.25 — for a CNC scene measured in mm you MUST raise it (e.g. updateGtaoMaterial({ radius: 2..8 })) or the AO will be invisible. setSceneClipBox(box) restricts AO to a known AABB (ideal for a bed/stock bounding box) and avoids AO bleeding onto the infinite grid. width/height are the AO resolution — running it at half the composer resolution is the cheapest quality lever.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/GTAOPass.js:56 (ctor 7 params), :104-138 (output/blendIntensity/pd* fields), :155 (isPerspectiveCamera define), :175-178 (pd defaults), :351-422 (updateGtaoMaterial keys), :428-484 (updatePdMaterial keys), :352 setSceneClipBox at :352, :717-725 (GTAOPass.OUTPUT); shader defaults C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/shaders/GTAOShader.js:28-55*

### SAOPass

**Module.** `three/addons/postprocessing/SAOPass.js`

**Signature.** new SAOPass(scene: Scene, camera: Camera, resolution: Vector2 = new Vector2(256, 256))
  .params = { output: 0, saoBias: 0.5, saoIntensity: 0.18, saoScale: 1, saoKernelRadius: 100, saoMinResolution: 0, saoBlur: true, saoBlurRadius: 8, saoBlurStdDev: 4, saoBlurDepthCutoff: 0.01 }
  SAOPass.OUTPUT = { Default: 0, SAO: 1, Normal: 2 }
  needsSwap = false; clear = true

NOTE the different constructor shape from GTAO/SSAO: third arg is a Vector2 resolution, NOT (width, height) numbers. saoKernelRadius is in SCREEN-space-ish units (default 100) not world units, which makes it easier to tune than GTAO's world radius but makes AO scale-dependent on zoom. Its JSDoc claims 'better quality than SSAOPass but also more expensive' (line 28). Because needsSwap=false it composites in place onto readBuffer. In r180 it is effectively superseded by GTAOPass for new work; keep it only if you already tuned its params.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/SAOPass.js:46 (ctor), :77 (needsSwap=false), :86-97 (params defaults), :401-405 (SAOPass.OUTPUT)*

### SSAOPass

**Module.** `three/addons/postprocessing/SSAOPass.js`

**Signature.** new SSAOPass(scene: Scene, camera: Camera, width = 512, height = 512, kernelSize = 32)
  .kernelRadius: number = 8      // world units
  .minDistance: number = 0.005
  .maxDistance: number = 0.1
  .output: number  // SSAOPass.OUTPUT = { Default:0, SSAO:1, Blur:2, Depth:3, Normal:4 }
  needsSwap = false; clear = true

Cheapest of the three. kernelSize is baked into the shader as the KERNEL_SIZE define at construction — it cannot be changed later without rebuilding the pass. kernelRadius/minDistance/maxDistance are WORLD units, so for a mm-scale CNC scene the 0.005/0.1 defaults are far too small and produce no visible AO. Use this as the low-tier fallback for integrated GPUs.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/SSAOPass.js:56 (ctor), :87 (needsSwap=false), :112 (kernelRadius=8), :131 (minDistance=0.005), :140 (maxDistance=0.1), :179 (KERNEL_SIZE define), :519-525 (SSAOPass.OUTPUT)*

### OutputPass

**Module.** `three/addons/postprocessing/OutputPass.js`

**Signature.** new OutputPass()   // zero args
  Fields: uniforms (tDiffuse, toneMappingExposure), material: RawShaderMaterial

It is the pass that applies TONE MAPPING + OUTPUT COLOR SPACE conversion, which the renderer normally does automatically but SKIPS when rendering to a composer render target. Each frame it reads renderer.toneMappingExposure into its uniform, and if renderer.outputColorSpace or renderer.toneMapping changed since last frame it rebuilds material.defines (SRGB_TRANSFER, plus exactly one of LINEAR_/REINHARD_/CINEON_/ACES_FILMIC_/AGX_/NEUTRAL_/CUSTOM_TONE_MAPPING) and sets needsUpdate. So you keep configuring renderer.toneMapping / .toneMappingExposure / .outputColorSpace as usual and OutputPass mirrors them live — no separate config. WHY LAST: everything upstream of it is working in linear-sRGB HDR (the composer RTs are HalfFloatType); OutputPass is the linear->display transform. Its own JSDoc: 'this pass should be included at the end of each pass chain. If a pass requires sRGB input (e.g. like FXAA), the pass must follow OutputPass in the pass chain.' So the ONLY things after OutputPass should be sRGB-domain passes like FXAA.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/OutputPass.js:17-22 (JSDoc 'end of each pass chain' / FXAA must follow), :38 (zero-arg ctor), :80-81 (reads renderer.toneMappingExposure), :85-105 (defines rebuilt from renderer.outputColorSpace + renderer.toneMapping)*

### SMAAPass

**Module.** `three/addons/postprocessing/SMAAPass.js`

**Signature.** new SMAAPass()   // ZERO ARGS in r180 (older three took (width, height))
  .setSize(width, height) — called for you by EffectComposer.addPass/setSize

Best static-image AA quality per cost of the shader-based options, and the right default for a CAD viewer. It operates in linear-sRGB, so it must be added BEFORE OutputPass ('Unlike FXAAPass, SMAAPass operates in linear-srgb so this pass must be executed before OutputPass', line 14-15). It lazily loads two base64 lookup textures via `new Image()` with async src assignment, so the first frame or two after construction can be un-antialiased — harmless, but do not screenshot-assert on frame 1. Chain: RenderPass -> GTAOPass -> SMAAPass -> OutputPass.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/SMAAPass.js:14-15 (linear-srgb, before OutputPass), :30 (constructor( ) zero args), :50-57 + :66-73 (async Image load), :183-192 (setSize)*

### FXAAPass

**Module.** `three/addons/postprocessing/FXAAPass.js  — direct path only; it is NOT re-exported from three/addons/Addons.js in r180`

**Signature.** new FXAAPass()   // extends ShaderPass(FXAAShader); zero args
  .setSize(width, height) => sets uniforms.resolution to (1/width, 1/height)

FXAA expects sRGB (non-linear) input, so it must come AFTER OutputPass — the opposite ordering from SMAA. Cheapest AA available; blurs fine detail and thin lines, which is exactly what a CAD/toolpath viewer has a lot of, so prefer SMAA unless you are on the low quality tier. Import it by explicit module path: `import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js'` — the r180 Addons.js barrel does not list it (the 0.185 @types Addons.d.ts DOES, which is misleading).

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/FXAAPass.js:15-35 (class, zero-arg ctor, setSize); OutputPass.js:19-21 ('If a pass requires sRGB input (e.g. like FXAA), the pass must follow OutputPass'); absence from barrel: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/Addons.js:172-199 (no FXAAPass line) vs C:/Users/Asus/LaserForge-2.0/node_modules/@types/three/examples/jsm/Addons.d.ts:185 (has it)*

### SSAARenderPass

**Module.** `three/addons/postprocessing/SSAARenderPass.js`

**Signature.** new SSAARenderPass(scene: Scene, camera: Camera, clearColor: number|Color|string|null = 0x000000, clearAlpha: number|null = 0)
  .sampleLevel: number = 4   // samples = 2^n, clamped to [0,5] => max 32 samples
  .unbiased: boolean = true
  .stencilBuffer: boolean = false

REPLACES RenderPass (it is a render pass, not a filter) — do not use both. It re-renders the whole scene 2^sampleLevel times per frame with sub-pixel camera jitter via camera.setViewOffset, so cost is literally N x scene draw cost. This is the reference-quality option for a STILL frame: perfect edges, no ghosting, no blur. Practical pattern for a CAD viewer: render with a cheap path while orbiting, and swap to SSAARenderPass (or TAA accumulate) once the camera has been idle for ~200ms. sampleLevel is clamped: Math.max(0, Math.min(this.sampleLevel, 5)).

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/SSAARenderPass.js:35 (ctor), :60 (sampleLevel=4), :70 (unbiased), :78 (stencilBuffer), :172 (clamp to 5), :200-215 (setViewOffset jitter loop), :281-311 (_JitterVectors, 6 levels: 1,2,4,8,16,32 samples)*

### TAARenderPass

**Module.** `three/addons/postprocessing/TAARenderPass.js`

**Signature.** new TAARenderPass(scene: Scene, camera: Camera, clearColor?: number|Color|string, clearAlpha?: number)  // extends SSAARenderPass
  .sampleLevel = 0 (overridden)
  .accumulate: boolean = false
  .accumulateIndex: number = -1

The correct 'progressive refinement' pass for an interactive CAD viewer: set accumulate=false while the camera moves (it degrades to plain SSAARenderPass at the current sampleLevel, i.e. 1 sample = cheap), then set accumulate=true when idle and it accumulates 32 jittered samples across frames — you get SSAA quality without a 32x single-frame spike. Its own JSDoc warns it does NO reprojection, so it is not TRAA: any scene or camera motion while accumulate=true smears. You must reset accumulation yourself by flipping accumulate=false on any camera/scene change.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/TAARenderPass.js:14 ('uses no reprojection so it is no TRAA implementation'), :35 (ctor), :44 (sampleLevel=0), :53 (accumulate=false), :81-89 (accumulate===false falls through to super.render), :91 (uses _JitterVectors[5] = 32 samples)*

### WebGLRenderTarget (MSAA inside a composer)

**Module.** `three (core)`

**Signature.** new WebGLRenderTarget(width = 1, height = 1, options?: { samples?: number; type?: TextureDataType; depthBuffer?: boolean; stencilBuffer?: boolean; minFilter?; magFilter?; depthTexture?; ... })
Option defaults: { generateMipmaps: false, internalFormat: null, minFilter: LinearFilter, depthBuffer: true, stencilBuffer: false, resolveDepthBuffer: true, resolveStencilBuffer: true, depthTexture: null, samples: 0, count: 1, depth: 1, multiview: false }

THE fix for 'my composer killed antialias:true'. Build the composer's buffers yourself with samples>0:
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
EffectComposer clones it for rt2 and RenderTarget.copy() copies `samples`, so both buffers are multisampled. Cap the value with renderer.capabilities.maxSamples (gl.MAX_SAMPLES). Caveat: pass renderer.getDrawingBufferSize() (device px) here because when you supply a renderTarget the composer takes _width/_height from renderTarget.width/height directly (EffectComposer.js:74-76) and then multiplies by pixelRatio in addPass/setSize — so if you also call composer.setSize() later with logical px it will re-derive correctly, but the initial value must be device px to match.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/core/RenderTarget.js:53-66 (option defaults incl. samples: 0), :186-193 (this.samples), :363 (copy() carries samples); C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/WebGLRenderer.js:2756 (samples > 0 selects __webglMultisampledFramebuffer); C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/webgl/WebGLCapabilities.js:109,137 (maxSamples = gl.MAX_SAMPLES); EffectComposer.js:74-76*

### RoomEnvironment

**Module.** `three/addons/environments/RoomEnvironment.js`

**Signature.** new RoomEnvironment()   // zero args, extends Scene
  .dispose(): void   // disposes the internal geometries/materials

Zero-dependency studio IBL — this is the single highest-leverage change for a 'premium CAD look' because MeshStandardMaterial/MeshPhysicalMaterial metal and gloss are essentially black without an environment map. It is a Scene containing a back-side box room, a PointLight(0xffffff, 900, 28, 2) and 6 instanced boxes acting as softboxes. Feed it to PMREMGenerator.fromScene. Its own JSDoc gives the canonical snippet. Call .dispose() on the RoomEnvironment after generating (the PMREM texture is independent of it).

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/environments/RoomEnvironment.js:14-28 (JSDoc + snippet), :34 (zero-arg ctor), :44-46 (mainLight), :166+ (dispose)*

### PMREMGenerator

**Module.** `three (core, src/extras/PMREMGenerator.js)`

**Signature.** new PMREMGenerator(renderer: WebGLRenderer)
  .fromScene(scene: Scene, sigma = 0, near = 0.1, far = 100, options: { size?: number = 256; position?: Vector3 } = {}): WebGLRenderTarget
  .fromEquirectangular(tex: Texture, renderTarget: WebGLRenderTarget|null = null): WebGLRenderTarget
  .fromCubemap(tex, renderTarget = null): WebGLRenderTarget
  .compileCubemapShader(); .compileEquirectangularShader(); .dispose()

Exact r180 code to build the environment:
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();            // optional warm-up
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);       // small sigma softens it
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.9;                // global dial, r180
  room.dispose();
  pmrem.dispose();
  // on teardown: envRT.dispose()
fromScene returns a WebGLRenderTarget — you assign `.texture`, and YOU own disposing the RT. It temporarily disables renderer.xr and saves/restores the current render target, so it is safe to call mid-app. Note a DOC BUG in r180: the JSDoc says `@param {Vector3} [options.renderTarget=origin]` but the destructure is `const { size = 256, position = _origin } = options` — the real key is `position`.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/extras/PMREMGenerator.js:86 (ctor), :105-153 (fromScene JSDoc + `position` destructure at :122-125, doc/impl mismatch at :117), :163 (fromEquirectangular), :178 (fromCubemap), :219 (dispose)*

### Scene environment / background properties (r180)

**Module.** `three (core, src/scenes/Scene.js)`

**Signature.** scene.environment: Texture|null = null
scene.environmentIntensity: number = 1
scene.environmentRotation: Euler = new Euler()
scene.background: Texture|Color|CubeTexture|null
scene.backgroundBlurriness: number = 0
scene.backgroundIntensity: number = 1
scene.backgroundRotation: Euler = new Euler()

All six exist in r180 with exactly these names. environmentIntensity is the global IBL dial (do not hand-edit every material). environmentRotation lets you spin the studio highlight to catch machined edges without rebuilding the PMREM. For a CAD viewer keep `background` as a Color or a subtle gradient and DO NOT show the room — only use it as `environment`.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/scenes/Scene.js:50 (environment), :69 (backgroundBlurriness), :77 (backgroundIntensity), :86 (backgroundRotation), :95 (environmentIntensity), :104 (environmentRotation)*

### MeshStandardMaterial.envMapIntensity

**Module.** `three (core, src/materials/MeshStandardMaterial.js)`

**Signature.** material.envMapIntensity: number = 1.0

Per-material multiplier on the environment contribution, stacked on top of scene.environmentIntensity. Use it to make the stock/workpiece matte (envMapIntensity ~0.3) while the tool/spindle reads as machined metal (~1.2). Exists on MeshStandardMaterial (and therefore MeshPhysicalMaterial by inheritance); it is NOT declared separately in MeshPhysicalMaterial.js.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/materials/MeshStandardMaterial.js:306 (this.envMapIntensity = 1.0), :407 (copy); grep found no separate declaration in MeshPhysicalMaterial.js*

### Tone mapping constants + renderer output settings

**Module.** `three (core, src/constants.js + src/renderers/WebGLRenderer.js)`

**Signature.** Constants that EXIST in r180: NoToneMapping = 0, LinearToneMapping = 1, ReinhardToneMapping = 2, CineonToneMapping = 3, ACESFilmicToneMapping = 4, CustomToneMapping = 5, AgXToneMapping = 6, NeutralToneMapping = 7.
renderer.toneMapping (default NoToneMapping)
renderer.toneMappingExposure: number = 1.0
renderer.outputColorSpace (getter/setter, default SRGBColorSpace)

All three of ACESFilmicToneMapping, AgXToneMapping and NeutralToneMapping exist in r180 and are all handled by OutputPass. For a CAD/product look: NeutralToneMapping (Khronos 3D Commerce standard, per the constants JSDoc) is the best default — it preserves hue and saturation of flat CAD colors instead of crushing them, so a red layer stays red. ACESFilmic is the cinematic choice but noticeably desaturates and darkens saturated UI-derived colors. AgX is the most filmic/washed and is wrong for CAD. Note the default is NoToneMapping — you must set it explicitly. toneMappingExposure ~1.0-1.2 pairs well with the RoomEnvironment.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/constants.js:414,422,430,438,446,456,464,474 (all eight constants with JSDoc; NeutralToneMapping doc at :468-474 'Implementation based on the Khronos 3D Commerce Group standard tone mapping'); C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/WebGLRenderer.js:246 (toneMapping = NoToneMapping), :254 (toneMappingExposure = 1.0), :276/:3393-3401 (outputColorSpace, default SRGBColorSpace)*

### WebGLRenderer.shadowMap

**Module.** `three (core, src/renderers/WebGLRenderer.js -> src/renderers/webgl/WebGLShadowMap.js)`

**Signature.** renderer.shadowMap.enabled: boolean = false
renderer.shadowMap.autoUpdate: boolean = true
renderer.shadowMap.needsUpdate: boolean = false
renderer.shadowMap.type: number = PCFShadowMap
Type constants (src/constants.js): BasicShadowMap = 0, PCFShadowMap = 1, PCFSoftShadowMap = 2, VSMShadowMap = 3

Big win for a static CAD scene: set shadowMap.autoUpdate = false and only set shadowMap.needsUpdate = true when the scene/light actually changes (the shadow render is skipped entirely when both are false — WebGLShadowMap.js:75). That makes shadows nearly free during orbit. VSM vs PCFSoft: PCFSoftShadowMap is the right choice here — it is a fixed 'nice' softness, cheap, and ignores shadow.radius. VSMShadowMap gives adjustable softness (shadow.radius + shadow.blurSamples) and is the only type where you can genuinely blur a shadow, BUT it forces every shadow RECEIVER to also cast (constants.js:78) and it runs an extra two-pass blur over the shadow map — more cost and light-leak artifacts on thin plate geometry, which is exactly what a CNC stock/workpiece is. Recommendation: PCFSoftShadowMap.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/webgl/WebGLShadowMap.js:64 (enabled=false), :66 (autoUpdate=true), :67 (needsUpdate=false), :69 (type=PCFShadowMap), :74-75 (early-out), :195 (VSM blur pass); C:/Users/Asus/LaserForge-2.0/node_modules/three/src/constants.js:57,65,74,78,83 (types + 'When using VSMShadowMap all shadow receivers will also cast shadows'); WebGLRenderer.js:485 (_this.shadowMap = shadowMap)*

### DirectionalLight + DirectionalLightShadow (orthographic top light over a known AABB)

**Module.** `three (core, src/lights/DirectionalLight.js, src/lights/DirectionalLightShadow.js, src/lights/LightShadow.js)`

**Signature.** light.position: Vector3; light.target: Object3D (must be added to the scene, or its matrixWorld updated)
light.castShadow: boolean
light.shadow: DirectionalLightShadow, whose .camera is `new OrthographicCamera(-5, 5, 5, -5, 0.5, 500)`
light.shadow.camera.{left,right,top,bottom,near,far} + .updateProjectionMatrix()
light.shadow.mapSize: Vector2 = (512, 512)   // must be powers of two
light.shadow.bias: number = 0
light.shadow.normalBias: number = 0
light.shadow.radius: number = 1              // VSM only; no effect under PCFSoftShadowMap or BasicShadowMap
light.shadow.blurSamples: number = 8         // VSM only
light.shadow.intensity: number = 1
light.shadow.autoUpdate / .needsUpdate

Fit the ortho frustum to a known bounding box (verified property names only; the arithmetic is standard):
  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius;
  const cam = light.shadow.camera;                 // OrthographicCamera
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
  cam.near = 0.5; cam.far = 4 * r;
  cam.updateProjectionMatrix();                    // REQUIRED after changing l/r/t/b/near/far
  light.position.copy(sphere.center).add(new THREE.Vector3(0.4, 1, 0.3).setLength(2 * r));
  light.target.position.copy(sphere.center);
  scene.add(light.target);
  light.shadow.mapSize.set(2048, 2048);
Bias guidance, straight from the r180 JSDoc: bias is added to normalized depth, default 0, and 'very tiny adjustments here (in the order of 0.0001) may help reduce artifacts'. normalBias offsets the lookup along the surface normal, default 0, 'especially in large scenes where light shines onto geometry at a shallow angle', at the cost of distorted shadows. Practical order: fit the frustum TIGHT first (that is what actually kills acne), then reach for normalBias in world-scale units (e.g. 0.02-0.05 of a mm-scale part) BEFORE touching bias — negative bias like -0.0005 causes peter-panning on flat stock. Tight l/r/t/b also directly buys texel density, which matters more than mapSize.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/lights/DirectionalLightShadow.js:16 (super(new OrthographicCamera(-5,5,5,-5,0.5,500))); C:/Users/Asus/LaserForge-2.0/node_modules/three/src/lights/LightShadow.js:41 (intensity), :44-53 (bias JSDoc + default 0), :55-64 (normalBias JSDoc + default 0), :66-80 (radius, 'no effect when the shadow map type is PCFSoftShadowMap'), :82-88 (blurSamples=8), :90-97 (mapSize=(512,512), 'Values must be powers of two'); C:/Users/Asus/LaserForge-2.0/node_modules/three/src/lights/DirectionalLight.js:70 (this.target = new Object3D()), :77 (this.shadow); C:/Users/Asus/LaserForge-2.0/node_modules/three/src/cameras/OrthographicCamera.js:67-114 (left/right/top/bottom/near/far + updateProjectionMatrix)*

### Pass (base class contract)

**Module.** `three/addons/postprocessing/Pass.js`

**Signature.** class Pass { isPass = true; enabled = true; needsSwap = true; clear = false; renderToScreen = false; setSize(width, height); render(renderer, writeBuffer, readBuffer, deltaTime, maskActive); dispose(); }
Also exports: FullScreenQuad

`enabled` is the quality-tier lever: build the full chain once and toggle pass.enabled — EffectComposer.isLastEnabledPass() correctly re-targets the final blit to screen, so you never have to rebuild or reorder the chain when dropping tiers.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/Pass.js:16-101 (class fields and abstract methods); EffectComposer.js:192-206 + :234*

### Pitfalls (15)

- EffectComposer DOES defeat `new WebGLRenderer({ antialias: true })`. The `antialias` flag configures MSAA on the DEFAULT drawing buffer only (WebGLRenderer.js:78 destructures `antialias = false`, passed to getContext at :348). RenderPass calls `renderer.setRenderTarget(this.renderToScreen ? null : readBuffer)` (RenderPass.js:146), so once a composer exists the scene never touches the default framebuffer and MSAA is silently dead. The composer's own default RT is created with only `{ type: HalfFloatType }` (EffectComposer.js:69) and RenderTarget defaults `samples: 0` (RenderTarget.js:62). FIX: construct the composer with your own `new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 })`. Symptom if you miss it: 'my edges got jaggier after adding post-processing'.
- VERSION SKEW IS REAL AND WILL BITE: runtime three is 0.180.0 but @types/three installed is 0.185.0. Concrete mismatches found: (a) EffectComposer.d.ts declares `timer: Timer` but r180 runtime has `this.clock = new Clock()` (EffectComposer.js:129) — `composer.timer` type-checks and is `undefined` at runtime. (b) SMAAPass.d.ts declares public `edgesRT/weightsRT/areaTexture/searchTexture/materialEdges/fsQuad/getAreaTexture()` but r180 renamed them ALL to `_edgesRT/_weightsRT/_areaTexture/_searchTexture/_materialEdges/_fsQuad/_getAreaTexture()` (SMAAPass.js:35,41,58,74,86,183-190). (c) GTAOPass.d.ts declares `fsQuad/originalClearColor/renderPass()/renderOverride()/overrideVisibility()/generateNoise()` but runtime has `_fsQuad/_originalClearColor/_renderPass/_renderOverride/_overrideVisibility/_generateNoise` (GTAOPass.js:221,223,~590,~640). (d) OutputPass.d.ts and RenderPass.d.ts declare `readonly isOutputPass: true` / `isRenderPass: true` — neither exists in the r180 source (grep for isOutputPass/isRenderPass in OutputPass.js and RenderPass.js returns nothing). RULE: only use the CONSTRUCTOR + documented public methods of these passes; anything the .d.ts exposes as a public field is not trustworthy at this version pairing.
- @types/three 0.185 GTAOPass.d.ts declares only 5 constructor parameters (scene, camera, width, height, parameters) but r180 runtime accepts 7 (…, aoParameters, pdParameters — GTAOPass.js:56). Passing the 6th/7th arg is a TS error under strict. Workaround with zero `any` and no assertion: construct with 4-5 args, then call `gtaoPass.updateGtaoMaterial({ radius: 3 })` and `gtaoPass.updatePdMaterial({ ... })` — both ARE typed, with matching key names.
- GTAOPass's external-GBuffer path is BROKEN in r180. If you pass `parameters: { depthTexture, normalTexture }`, setGBuffer takes the branch that never creates `this.normalRenderTarget` (GTAOPass.js:307-318), but line 341 unconditionally executes `this.depthRenderMaterial.uniforms.tDepth.value = this.normalRenderTarget.depthTexture;` and `setSize()` at line 253 does `this.normalRenderTarget.setSize(...)`. Both throw TypeError on undefined. Only the default path (let GTAOPass render its own normal/depth GBuffer) works.
- AO radius units. GTAOPass defaults `radius: 0.25` and SSAOPass defaults `kernelRadius: 8 / minDistance: 0.005 / maxDistance: 0.1` — these are WORLD units tuned for a ~1-unit scene. A CNC scene in millimetres (bed 400x400) will show literally zero visible AO at defaults. This is the #1 reason 'I added GTAO and nothing changed'. SAOPass's `saoKernelRadius: 100` is the exception (screen-space-ish).
- Pass ordering is not free-form. SMAAPass must come BEFORE OutputPass (it works in linear-sRGB — SMAAPass.js:14). FXAAPass must come AFTER OutputPass (it needs sRGB input — OutputPass.js:19-21). Getting either backwards produces subtly-wrong edge detection that looks like 'AA isn't doing much' rather than an obvious failure.
- Forgetting OutputPass entirely is the classic 'why does my scene look washed out / too dark / wrong color' bug: renderer.outputColorSpace and renderer.toneMapping are applied by the renderer only when drawing to the default framebuffer. Inside a composer the linear->sRGB + tone map step must be done by OutputPass. And renderer.toneMapping defaults to NoToneMapping (WebGLRenderer.js:246), so you must set it explicitly regardless.
- composer.setSize() takes LOGICAL pixels and multiplies by the composer's internal _pixelRatio; but addPass/setSize forward DEVICE pixels to each pass.setSize() (EffectComposer.js:152, :320-329). If you hand-roll a resize and pass device px to composer.setSize you get DPR-squared buffers. Correct resize handler: renderer.setSize(w, h); renderer.setPixelRatio(dpr); composer.setPixelRatio(dpr); composer.setSize(w, h).
- SMAAPass loads its area/search lookup textures asynchronously via `new Image()` + base64 src (SMAAPass.js:50-57, 66-73). Frames rendered before onload fires are not antialiased. Do not assert on a screenshot taken immediately after construction.
- TAARenderPass does no reprojection (TAARenderPass.js:14). With `accumulate = true` any camera or scene change smears. You must drive `accumulate` from your own camera-idle detection and flip it back to false on the first movement.
- SSAARenderPass and TAARenderPass REPLACE RenderPass — they render the scene themselves. Adding both a RenderPass and an SSAARenderPass double-renders the scene every frame.
- PMREMGenerator.fromScene returns a WebGLRenderTarget, not a Texture. You assign `.texture` to scene.environment, and you own disposing the RT. Also its JSDoc misnames the options key: the doc says `options.renderTarget` but the code destructures `position` (PMREMGenerator.js:117 vs :122-125).
- VSMShadowMap forces every shadow RECEIVER to also cast shadows (constants.js:78). On a CNC scene that means the flat stock plate self-shadows and light-leaks. Prefer PCFSoftShadowMap. Also note shadow.radius has NO effect under PCFSoftShadowMap or BasicShadowMap (LightShadow.js:72-76) — a very common source of 'I set shadow.radius and nothing happened'.
- FXAAPass is NOT exported from three/addons/Addons.js in r180 (Addons.js:172-199), even though @types/three 0.185's Addons.d.ts:185 says it is. Import it from its explicit module path or you get a runtime undefined with a green typecheck.
- SAOPass's third constructor argument is a `Vector2` resolution, while GTAOPass and SSAOPass take separate `width, height` numbers. Easy to swap by muscle memory; `new SAOPass(scene, camera, 512, 512)` type-errors, and at runtime a bare number would break `.x/.y` access.

### Explicitly UNVERIFIED

- PERFORMANCE / QUALITY-TIER CLAIMS ARE ENGINEERING JUDGMENT, NOT MEASURED. I did not run any of this on hardware — no GPU profiling, no frame timing, no integrated-GPU test at 1000x800. The relative-cost ordering below is grounded in what the r180 source actually does per frame (draw-call counts, extra full-scene passes, extra render targets) and in three.js's own JSDoc rankings, but the absolute frame budgets are estimates.
- Relative cost, derived from reading the source (verified mechanism, unverified timing): SSAOPass < SAOPass < GTAOPass. Mechanism: all three render a full-scene normal+depth GBuffer pass; SSAO then does one AO pass + one blur; SAO does one AO pass + two depth-limited blur passes; GTAO does one AO pass + a Poisson denoise + a separate blend pass, with a denoise whose sample count (pdSamples=16, pdRings=2) is baked into the shader. three.js's own JSDoc ranks them: GTAOPass 'provides better quality than SSAOPass but is also more expensive' (GTAOPass.js:32); SAOPass 'provides better quality than SSAOPass but is also more expensive' (SAOPass.js:28); SSAOPass is described as 'a basic SSAO effect' (SSAOPass.js:31).
- Suggested quality tiers at ~1000x800 (UNVERIFIED on hardware — treat as a starting point to measure, and gate on a runtime FPS probe rather than shipping blind). HIGH (discrete GPU): RenderPass -> GTAOPass at full res (samples 16) -> SMAAPass -> OutputPass, MSAA samples: 4 on the composer RT, shadowMap PCFSoftShadowMap at 2048, NeutralToneMapping, plus TAARenderPass accumulate-on-idle swapped in for RenderPass. MEDIUM (good integrated, e.g. Iris Xe / Radeon 780M): RenderPass -> GTAOPass at HALF resolution (construct with width/2, height/2 and let the blend upsample; GTAO cost is dominated by its own resolution) -> SMAAPass -> OutputPass, MSAA samples: 4, shadows 1024, shadowMap.autoUpdate=false. LOW (weak integrated / UHD-class): RenderPass -> OutputPass only, no AO pass at all, MSAA samples: 4 on the composer RT (hardware MSAA is by far the cheapest quality-per-ms available here), shadows 1024 with autoUpdate=false, or drop shadows to a baked contact-shadow plane. The two levers that matter most on integrated GPUs are (a) the AO pass's own render-target resolution and (b) shadowMap.autoUpdate=false for a mostly-static CAD scene — both are exact source-verified mechanisms, but their measured payoff is unverified.
- Whether the GTAO half-resolution trick looks acceptable on thin toolpath geometry — I did not render it. Half-res AO on 0.1mm-wide line geometry may alias visibly; needs a perceptual check against a rendered frame before shipping.
- I did not verify how any of this interacts with the host project's existing three.js usage — I did not read a single file under C:/Users/Asus/LaserForge-2.0/src/. No claim here about whether the CNC 3D view currently uses a composer, what camera type it uses, or what scene scale it is in (the mm-scale AO-radius warning is a general consequence of the verified defaults, not an observation about this codebase).
- I did not fetch any threejs.org docs or examples pages — every claim above cites the installed source at C:/Users/Asus/LaserForge-2.0/node_modules/three/ or node_modules/@types/three/. Nothing here comes from memory or blog posts.
- I did not verify that upgrading/pinning @types/three to a 0.180-matching version is possible or clean — I only established that the currently-installed 0.185.0 typings disagree with the 0.180.0 runtime in the specific ways listed under pitfalls.

## 4.3 three.js r180 (0.180.0) CAD-viewport APIs verified against installed source: camera controls, view gizmo, grids, clipping/section capping, instancing, geometry utils, labels

### OrbitControls

**Module.** `three/addons/controls/OrbitControls.js (also resolvable as 'three/examples/jsm/controls/OrbitControls.js'; re-exported from 'three/addons' via examples/jsm/Addons.js:11)`

**Signature.** class OrbitControls extends Controls; constructor( object /* Object3D, normally a Camera */, domElement = null ). Public instance props verified in source: target: Vector3 (L108), cursor: Vector3 (L117), minDistance = 0 (L125), maxDistance = Infinity (L133), minZoom = 0 (L141), maxZoom = Infinity (L149), minTargetRadius = 0 (L157), maxTargetRadius = Infinity (L165), minPolarAngle = 0 (L173), maxPolarAngle = Math.PI (L181), minAzimuthAngle = -Infinity (L190), maxAzimuthAngle = Infinity (L199), enableDamping = false (L209), dampingFactor = 0.05 (L219), enableZoom = true (L227), zoomSpeed = 1.0 (L235), enableRotate = true (L247), rotateSpeed = 1.0 (L255), keyRotateSpeed = 1.0 (L263), enablePan = true (L271), panSpeed = 1.0 (L279), screenSpacePanning = true (L289), keyPanSpeed = 7.0 (L298), zoomToCursor = false (L306), autoRotate = false (L318), autoRotateSpeed = 2.0 (L329), keys = { LEFT:'ArrowLeft', UP:'ArrowUp', RIGHT:'ArrowRight', BOTTOM:'ArrowDown' } (L344), mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN } (L358), touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN } (L371), target0/position0/zoom0 (L378-392). Inherited from Controls: object, domElement, enabled = true, state. Public methods: connect(element) (L465), disconnect() (L482), dispose() (L501), getPolarAngle(): number (L512), getAzimuthalAngle(): number (L523), getDistance(): number (L534), listenToKeyEvents(domElement) (L546), stopListenToKeyEvents() (L556), saveState() (L570), reset() (L582), update( deltaTime = null ): boolean (L597).

EVENTS (exact): 'change', 'start', 'end' — the literal objects are `const _changeEvent = { type: 'change' }` (L20), `_startEvent = { type: 'start' }` (L28), `_endEvent = { type: 'end' }` (L36). 'change' is dispatched from reset() (L589) and from the tail of update() (L818) when zoom changed or the camera moved/rotated past _EPS = 1e-6 (L813-826); update() returns true in that case, false otherwise. 'start' fires at L1626 (pointerdown, non-touch), L1670, and L1764 (touch start). 'end' fires at L1515 (last pointer released) and L1674.

RENDER-ON-DEMAND (critical for this app): OrbitControls calls `this.update()` ITSELF from every input handler — rotate L1024, dolly L1046, pan L1060, wheel L1078, keydown L1187, touch L1782/1792/1802/1812, plus once in the constructor L461. So with enableDamping = false and autoRotate = false you need NO rAF loop: subscribe to 'change' and render there. That is the fully supported on-demand pattern.

DAMPING **DOES** REQUIRE A LOOP. In update(): when enableDamping is true only `dampingFactor` of the pending delta is applied per call (L615-625 for theta/phi, L660-668 for pan) and the residual is decayed by `*= (1 - dampingFactor)` (L699-712) instead of being zeroed (L706-712 else-branch). Since update() only runs on input events, after pointerup the residual is frozen forever: the camera never finishes the motion and each drag only ever delivers ~5% of the requested rotation per event. The class JSDoc states it outright at L204-205 and L213-214: "you must call update() in your animation loop". Same for autoRotate (L311, L324) — the auto-rotation is only applied inside update() when state === NONE (L609-613).

Recommended for an on-demand CAD viewport: enableDamping = false, and render from the 'change' handler. If you want damping, start a rAF loop on 'start' and stop it a few hundred ms after 'end' once update() returns false.

Other notes: connect() sets `domElement.style.touchAction = 'none'` (L478) and attaches a capture-phase keydown on `domElement.getRootNode()` (L476) to detect ctrl for trackpad pinch; disconnect() reverses it (L497). Keyboard panning is NOT wired by default — you must call listenToKeyEvents(window) (L546). zoomToCursor works for both PerspectiveCamera (dollies along the pointer ray, L718-729) and OrthographicCamera (adjusts .zoom then re-centers, L731-750); an unknown camera type logs a warning and force-disables it (L753-754). screenSpacePanning = true is the right default for a CAD/part viewer; false pans in the plane orthogonal to camera.up (map style).

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/controls/OrbitControls.js lines 20,28,36,88-96,108-371,378-392,455-463,465-505,512-597,609-625,660-712,813-830,1024,1046,1060,1078,1187,1515,1626,1670,1674,1764,1782-1812*

### Controls (abstract base)

**Module.** `three (src/extras/Controls.js)`

**Signature.** class Controls extends EventDispatcher; constructor( object, domElement = null ). Props: object: Object3D, domElement: ?HTMLElement, enabled = true, state = -1, keys = {}, mouseButtons = {LEFT:null,MIDDLE:null,RIGHT:null}, touches = {ONE:null,TWO:null}. Methods: connect(element), disconnect(), dispose(), update(delta).

All r180 controls now extend this and are EventDispatchers, so addEventListener('change', fn) / removeEventListener are inherited. connect(element) with element === undefined logs a deprecation warning and no-ops (removal planned r185) — always pass the element. connect() also auto-disconnects a previously connected element.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/extras/Controls.js lines 9-119 (connect L83-96, deprecation warning L87)*

### MapControls

**Module.** `three/addons/controls/MapControls.js`

**Signature.** class MapControls extends OrbitControls; constructor( object, domElement ). Only overrides: screenSpacePanning = false, mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }, touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }.

The entire file is 62 lines and is literally a preset of OrbitControls — no separate behaviour. For a CNC bed viewport where left-drag should PAN the work area and right-drag orbit, MapControls IS the preset you want; otherwise just set mouseButtons/screenSpacePanning on OrbitControls yourself and skip the extra import. Damping semantics are identical (inherited), so the rAF caveat above applies unchanged.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/controls/MapControls.js lines 17-58 (whole file is 62 lines)*

### TrackballControls

**Module.** `three/addons/controls/TrackballControls.js`

**Signature.** class TrackballControls extends Controls; constructor( object, domElement = null ). Dispatches the same 'change'/'start'/'end' events (declared L16/L24/L32).

Explicitly documented as NOT maintaining a constant camera.up — the view flips over the poles (source doc comment L47-50). That is disorienting in a CAD/machine viewport where Z-up (or Y-up) must stay fixed. It also calls this.update() internally exactly ONCE in the whole file (L268), so it is essentially designed around an app rAF loop. NOT recommended for a CNC viewport.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/controls/TrackballControls.js lines 16,24,32,47-64; internal update() call count verified: only line 268 (grep for 'this.update()')*

### ArcballControls

**Module.** `three/addons/controls/ArcballControls.js`

**Signature.** class ArcballControls extends Controls (3536 lines). Verified public props: radiusFactor = 0.67 (L147), adjustNearFar = false (L271), scaleFactor = 1.1 (L279), dampingFactor = 25 (L287), enableAnimations = true (L303), enableGrid = false (L312), cursorZoom = false (L320), enablePan = true (L352), enableRotate = true (L360), enableZoom = true (L368), enableFocus = true (L384), minDistance = 0 (L392), maxDistance = Infinity (L400). Same 'change'/'start'/'end' events.

Self-driving: it owns its own window.requestAnimationFrame loops for inertial rotate/focus animations (L859, L924, L2103, L2154) and timestamps with performance.now(). That means it renders-on-demand fine (it dispatches 'change' from inside its own rAF), but you cannot fully control the frame budget, and it pulls `window` in — a problem if the viewport is ever headless/tested. It is also 3536 lines vs OrbitControls' 1860. Its dampingFactor default of 25 is a completely different unit from OrbitControls' 0.05 — do not copy values across. Verdict for a CAD viewport: OrbitControls (or MapControls preset) is the right choice — predictable up-vector, on-demand friendly, smallest surface. ArcballControls is only worth it if you specifically want free arcball + gizmo + focus-on-double-click.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/controls/ArcballControls.js lines 62-79 (events), 147,271,279,287,303,312,320,352,360,368,384,392,400; internal rAF at 859,924,2103,2154*

### ViewHelper (view/axis gizmo)

**Module.** `three/addons/helpers/ViewHelper.js (Addons.js:61)`

**Signature.** class ViewHelper extends Object3D; constructor( camera: Camera, domElement: HTMLElement ). BOTH args required — there is no default for domElement. Instance surface (all assigned in the constructor closure): isViewHelper = true (L50), animating = false (L59), center: Vector3 (L66), render( renderer ) (L150), handleClick( event ): boolean (L189), setLabels( labelX, labelY, labelZ ) (L229), setLabelStyle( font = '24px Arial', color = '#000000', radius = 14 ) (L246), update( delta /* seconds */ ) (L262), dispose() (L287).

NO dedicated canvas/renderer — it draws into your MAIN renderer via a viewport swap. render(renderer) does: invert camera.quaternion onto itself, `renderer.clearDepth()`, `renderer.getViewport(viewport)`, `renderer.setViewport(x, y, 128, 128)`, `renderer.render(this, orthoCamera)`, then restores the viewport (L150-172). x = domElement.offsetWidth - 128; y = 0 for WebGLRenderer (GL bottom-left origin) and domElement.offsetHeight - 128 for WebGPURenderer (L160-161). setViewport takes LOGICAL/CSS pixels — it multiplies by pixelRatio internally (WebGLRenderer.js L712-730), so pass CSS px.

autoClear: render() only calls clearDepth(), NOT clear(). You MUST wrap it: `renderer.autoClear = false; renderer.render(scene, camera); viewHelper.render(renderer); renderer.autoClear = true;` — otherwise the gizmo pass clears the color buffer and erases the main scene. Confirmed by the official three.js editor r180: it sets `renderer.autoClear = false;` before and `renderer.autoClear = true;` after `viewHelper.render( renderer )`.

DOM: pass the VIEWPORT CONTAINER as domElement (the editor passes `container.dom`). For hit-testing, the editor adds a SEPARATE absolutely-positioned 128x128 overlay div at right:0/bottom:0 and calls `this.handleClick(event)` from its 'pointerup', with `event.stopPropagation()` on both pointerdown and pointerup so OrbitControls doesn't swallow the click. handleClick raycasts the six axis sprites against the gizmo's internal OrthographicCamera(-2,2,2,-2,0,4); returns false immediately if this.animating (L191), returns true if it started an animation.

ANIMATION LOOP: yes, and only while animating. update(delta) slerps camera.position/quaternion toward the picked axis at turnRate = 2π rad/s (L142, L262-281) and sets animating = false when it arrives. Editor pattern: `if ( viewHelper.animating === true ) { viewHelper.update( delta ); needsUpdate = true; }`. For an on-demand renderer: on handleClick() returning true, spin up a temporary rAF that calls update(delta) + re-render until animating flips false, then stop. Note update() writes camera.position/quaternion directly and does NOT touch OrbitControls.target, so call controls.update() (or leave target alone — it orbits about viewHelper.center, which you should keep synced to controls.target).

Labels are off by default; setLabels()/setLabelStyle() rebuild the +X/+Y/+Z sprite CanvasTextures (updateLabels L402-416) — the negative-axis sprites stay unlabeled at opacity 0.2 (L115-117). dispose() frees the shared cylinder geometry, 3 axis materials and all 6 sprite materials+maps.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/helpers/ViewHelper.js lines 39-59, 80-83, 115-117, 141-142, 150-172, 189-220, 229-254, 262-281, 287-309, 402-416; viewport-units note C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/WebGLRenderer.js lines 709-732; autoClear + animating pattern from https://raw.githubusercontent.com/mrdoob/three.js/r180/editor/js/Viewport.js (fetched); overlay-div + stopPropagation pattern from https://raw.githubusercontent.com/mrdoob/three.js/r180/editor/js/Viewport.ViewHelper.js (fetched verbatim)*

### WebGLRenderer clipping properties

**Module.** `three (src/renderers/WebGLRenderer.js)`

**Signature.** renderer.clippingPlanes: Array<Plane> = []  (L228, GLOBAL planes, world space)
renderer.localClippingEnabled: boolean = false  (L236)
WebGLRenderer parameter `stencil` defaults to **false** (L76) — `new WebGLRenderer({ antialias: true, stencil: true })` is required for any stencil work.
renderer.clear( color = true, depth = true, stencil = true ) (L875); renderer.clearDepth() (L965); renderer.autoClear = true (L175), autoClearColor (L184), autoClearDepth (L193).

Exact names confirmed: it is `localClippingEnabled` (renderer) and `clippingPlanes` on BOTH renderer and material — they are different scopes, not aliases. Global renderer.clippingPlanes are applied unconditionally and do NOT need localClippingEnabled (WebGLClipping.init L22-38 returns enabled when planes.length !== 0). material.clippingPlanes are IGNORED unless renderer.localClippingEnabled === true (WebGLClipping.setState L67). Global planes are always union-clipped and are appended after the material's local planes (L85-102).

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/WebGLRenderer.js lines 76, 175, 184, 193, 220-236, 875, 965, 1561-1562, 1687, 1831, 1917; C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/webgl/WebGLClipping.js lines 22-38, 59-104*

### Material clipping properties

**Module.** `three (src/materials/Material.js)`

**Signature.** material.clippingPlanes: ?Array<Plane> = null  (L308)
material.clipIntersection: boolean = false  (L317)
material.clipShadows: boolean = false  (L326)
All three are copied by Material.copy() (L932-950), with clippingPlanes deep-copied into a new array.

Semantics from the source doc comments: planes are in WORLD space; points whose signed distance to the plane is negative are clipped (L299-303). clipIntersection = true clips only the INTERSECTION of the planes rather than their union (L311-312) — and per WebGLClipping.js L101 it applies only to the material's own planes, never to renderer.clippingPlanes. clipShadows = true makes the shadow pass respect the same planes (L320-322, gated at WebGLClipping.js L67 `renderingShadows && ! clipShadows`). Requires renderer.localClippingEnabled = true.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/materials/Material.js lines 298-326, 932-950; C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/webgl/WebGLClipping.js lines 62-67, 101*

### Stencil capping of a clipped solid (official technique — makes a section cut look solid, not hollow)

**Module.** `no module — a pattern built from three core: Material stencil props + renderOrder. Official example: examples/webgl_clipping_stencil.html`

**Signature.** Material stencil props verified in src/materials/Material.js: stencilWrite = false (L296), stencilWriteMask = 0xff (L236), stencilFunc = AlwaysStencilFunc (L244), stencilRef = 0 (L252), stencilFuncMask = 0xff (L260), stencilFail = KeepStencilOp (L268), stencilZFail = KeepStencilOp (L277), stencilZPass = KeepStencilOp (L286); plus colorWrite = true (L350), depthWrite = true (L228), depthTest = true (L217), side = FrontSide (L85). Constants verified in src/constants.js: KeepStencilOp=7680 (L1297), ReplaceStencilOp=7681 (L1305), IncrementWrapStencilOp=34055 (L1330), DecrementWrapStencilOp=34056 (L1339), NotEqualStencilFunc=517 (L1395), AlwaysStencilFunc=519 (L1411).

YES there is an official example: three.js `examples/webgl_clipping_stencil.html` (live at https://threejs.org/examples/#webgl_clipping_stencil). Technique, per plane:
(1) Renderer: `new THREE.WebGLRenderer({ antialias: true, stencil: true })` and `renderer.localClippingEnabled = true`.
(2) Stencil group — two extra meshes of the SAME geometry, both clipped by that one plane, with a base material of depthWrite=false, depthTest=false, colorWrite=false, stencilWrite=true, stencilFunc=AlwaysStencilFunc. Back-faces copy: side=BackSide, stencilFail/stencilZFail/stencilZPass = IncrementWrapStencilOp. Front-faces copy: side=FrontSide, all three = DecrementWrapStencilOp. Both get the same renderOrder. Net stencil value is non-zero exactly where the plane cuts through solid interior.
(3) Cap quad — a PlaneGeometry sized to cover the section, material e.g. MeshStandardMaterial with clippingPlanes = the OTHER planes (`planes.filter(p => p !== plane)`), stencilWrite = true, stencilRef = 0, stencilFunc = NotEqualStencilFunc, stencilFail/ZFail/ZPass = ReplaceStencilOp. Drawn at a slightly higher renderOrder than its stencil group.
(4) The real object is drawn last (highest renderOrder) with clippingPlanes = all planes.
Each frame the cap quad must be re-oriented onto its plane (position/quaternion from plane.normal and plane.constant).
Caveat: this needs an actual stencil buffer — with stencil:false (the r180 default) it silently produces no caps.

*Evidence: Constants + material props read from C:/Users/Asus/LaserForge-2.0/node_modules/three/src/materials/Material.js lines 85,217,228,236-296,350 and C:/Users/Asus/LaserForge-2.0/node_modules/three/src/constants.js lines 1297,1305,1330,1339,1395,1411; stencil default false at C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/WebGLRenderer.js line 76; capping code fetched verbatim from https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/webgl_clipping_stencil.html*

### GridHelper

**Module.** `three (src/helpers/GridHelper.js)`

**Signature.** class GridHelper extends LineSegments; constructor( size = 10, divisions = 10, color1 = 0x444444, color2 = 0x888888 ). color1 = the two CENTER lines, color2 = all other lines. Accepts number | Color | string.

Lies in the XZ plane (vertices are pushed as (-half,0,k)-(half,0,k) and (k,0,-half)-(k,0,half), L43-44) — for a Z-up CNC scene rotate it by -PI/2 about X. Material is `new LineBasicMaterial({ vertexColors: true, toneMapped: false })` — colors are baked into a per-vertex color attribute, so to recolor after construction you must rewrite geometry.attributes.color, not material.color. Has .dispose() (frees geometry + material). Note `linewidth` on LineBasicMaterial is effectively 1px on all WebGL implementations — use Line2/LineMaterial from three/addons/lines/ if you need thick grid/axis lines (LineMaterial exposes linewidth, worldUnits, resolution, dashed uniforms).

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/helpers/GridHelper.js lines 21-60; fat-line alternative confirmed present at C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/{Line2.js,LineGeometry.js,LineMaterial.js,LineSegments2.js,LineSegmentsGeometry.js,Wireframe.js} with LineMaterial uniforms worldUnits/linewidth/resolution at LineMaterial.js lines 11-13*

### PolarGridHelper

**Module.** `three (src/helpers/PolarGridHelper.js)`

**Signature.** class PolarGridHelper extends LineSegments; constructor( radius = 10, sectors = 16, rings = 8, divisions = 64, color1 = 0x444444, color2 = 0x888888 ).

Note the parameter order — `sectors` (radial spokes) comes BEFORE `rings`, and `divisions` is the tessellation of each ring circle, not the grid subdivision. Same XZ plane and same vertexColors LineBasicMaterial approach as GridHelper.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/helpers/PolarGridHelper.js line 35*

### Box3Helper / BoxHelper / AxesHelper / PlaneHelper

**Module.** `three (src/helpers/*.js)`

**Signature.** class Box3Helper extends LineSegments; constructor( box: Box3, color = 0xffff00 )
class BoxHelper extends LineSegments; constructor( object: Object3D, color = 0xffff00 )
class AxesHelper extends LineSegments; constructor( size = 1 )
class PlaneHelper extends Line; constructor( plane: Plane, size = 1, hex = 0xffff00 )

Box3Helper takes a Box3 (world-space AABB) and follows it live — it is the right choice for stock/bed bounds. BoxHelper takes an OBJECT and needs .update() when the object moves. AxesHelper draws X red / Y green / Z blue from the origin with vertexColors. PlaneHelper visualizes a Plane and is useful next to the clipping work above. All four are LineSegments/Line and honour .dispose().

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/helpers/Box3Helper.js line 27; BoxHelper.js line 34; AxesHelper.js lines 25-29; PlaneHelper.js line 28*

### Infinite / distance-fading grid

**Module.** `NONE — not present in r180`

**Signature.** n/a

There is NO built-in infinite/fading grid in r180. Verified by listing src/helpers/ (13 files: ArrowHelper, AxesHelper, Box3Helper, BoxHelper, CameraHelper, DirectionalLightHelper, GridHelper, HemisphereLightHelper, PlaneHelper, PointLightHelper, PolarGridHelper, SkeletonHelper, SpotLightHelper) and by a case-insensitive grep for 'infinitegrid'/'infinite grid' across the whole installed three/src and three/examples/jsm — zero hits. The standard community technique (which is what the three.js forum/Blender-style grid uses) is a single large screen-facing or ground-plane quad with a custom ShaderMaterial that computes grid lines analytically in the fragment shader from world-space UVs using fwidth()/derivatives for anti-aliasing, plus a distance-based alpha falloff, rendered with transparent:true and depthWrite:false. In r180 that needs no extra dependency and no extension enable (derivatives are core in WebGL2/GLSL ES 3.00, and r180's WebGLRenderer is WebGL2-only). I have NOT verified any specific shader implementation in this tree — writing one is new code, not an API call. If you want zero custom GLSL, the pragmatic fallback is a GridHelper sized to the machine bed (which is finite anyway for a CNC viewport) with a second coarser GridHelper for the major grid.

*Evidence: Directory listing of C:/Users/Asus/LaserForge-2.0/node_modules/three/src/helpers/ (13 files, no infinite-grid module) and `grep -rli 'infinitegrid|infinite grid' examples/jsm src` under C:/Users/Asus/LaserForge-2.0/node_modules/three/ returning no matches*

### InstancedMesh

**Module.** `three (src/objects/InstancedMesh.js)`

**Signature.** class InstancedMesh extends Mesh; constructor( geometry: BufferGeometry, material: Material|Material[], count: number ). Props: instanceMatrix: InstancedBufferAttribute (Float32Array(count*16), itemSize 16) (L57), instanceColor: ?InstancedBufferAttribute = null (L67), morphTexture: ?DataTexture = null, count: number (L84), boundingBox: ?Box3 = null, boundingSphere: ?Sphere = null. Methods: setMatrixAt(index, matrix: Matrix4) (L326), getMatrixAt(index, matrix) (L~218), setColorAt(index, color: Color) (L307), getColorAt(index, color) (L206), setMorphAt(index, object) (L340), computeBoundingBox() (L~117), computeBoundingSphere() (L151), raycast(), copy(), dispose() (L380).

THIS is the right fit for "thousands of small tool-position markers": one geometry, one material, N transforms, one draw call. Contract:
- After a batch of setMatrixAt() you MUST set `mesh.instanceMatrix.needsUpdate = true` (stated in the source JSDoc L321-322). Same for colors: `mesh.instanceColor.needsUpdate = true` — but instanceColor is NULL until the first setColorAt() call, which lazily allocates it (L307-313), so guard with `if (mesh.instanceColor) …` or call setColorAt once up front.
- The constructor pre-fills all `count` slots with the identity matrix (L102-106), so unset instances render stacked at the origin. Set `mesh.count = actualUsed` to draw a subset — the draw call uses `object.count` directly (WebGLRenderer.js L1248 `renderer.renderInstances( drawStart, drawCount, object.count )`), so shrinking count is the cheap way to hide the tail.
- Frustum culling is whole-object, driven by boundingSphere; call computeBoundingSphere() after moving instances or the mesh will pop out of view (source JSDoc L149-150 says exactly this).
- For per-frame updates call `mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage )` (BufferAttribute.setUsage at src/core/BufferAttribute.js L164; DynamicDrawUsage = 35048 at src/constants.js L1493).
- raycast() loops all `count` instances (L251) — for thousands of markers, disable raycasting on this object or use your own spatial index.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/objects/InstancedMesh.js lines 28-37, 57, 67, 84, 102-106, 117, 149-151, 206, 218, 251, 260, 302-315, 321-328, 340-348, 380-386; draw path C:/Users/Asus/LaserForge-2.0/node_modules/three/src/renderers/WebGLRenderer.js line 1246-1248; C:/Users/Asus/LaserForge-2.0/node_modules/three/src/constants.js lines 1484-1502; C:/Users/Asus/LaserForge-2.0/node_modules/three/src/core/BufferAttribute.js line 164*

### BatchedMesh

**Module.** `three (src/objects/BatchedMesh.js)`

**Signature.** class BatchedMesh extends Mesh; constructor( maxInstanceCount: number, maxVertexCount: number, maxIndexCount = maxVertexCount * 2, material?: Material|Material[] ). Props: isBatchedMesh = true, perObjectFrustumCulled = true (L211), sortObjects = true (L221), boundingBox, boundingSphere. Methods: addGeometry( geometry, reservedVertexCount = -1, reservedIndexCount = -1 ): geometryId (L627), addInstance( geometryId ): instanceId (L561), setGeometryAt(geometryId, geometry) (L714), deleteGeometry(geometryId) (L826), deleteInstance(instanceId) (L861), optimize() (L880), setMatrixAt(instanceId, matrix) (L1074), getMatrixAt (L1094), setColorAt(instanceId, color) (L1108), getColorAt (L1132), setVisibleAt(instanceId, visible) (L1146), getVisibleAt (L1169), setGeometryIdAt(instanceId, geometryId) (L1184), getGeometryIdAt (L1201), getGeometryRangeAt(geometryId, target = {}) (L1221), setInstanceCount(maxInstanceCount) (L1248), setGeometrySize(maxVertexCount, maxIndexCount) (L1309), getBoundingBoxAt / getBoundingSphereAt, setCustomSort(func) (L487), computeBoundingBox/Sphere, dispose() (L1482).

IMPORTANT distinction vs InstancedMesh: BatchedMesh batches MULTIPLE DIFFERENT geometries sharing one material into one draw call. The API is two-stage — addGeometry() returns a geometryId, then addInstance(geometryId) returns an instanceId, and ALL the per-object setters (setMatrixAt/setColorAt/setVisibleAt) take the INSTANCE id, not the geometry id. addInstance throws `new Error('THREE.BatchedMesh: Maximum item count reached.')` at capacity (L568); addGeometry throws 'Reserved space request exceeds the maximum buffer size.' if the vertex/index budget is blown (L672). Note setMatrixAt() writes into a data texture, NOT a needsUpdate attribute — no manual needsUpdate flag for matrices.

For "thousands of small tool-position markers" (identical marker geometry) InstancedMesh is the correct and simpler choice: BatchedMesh's per-instance matrix texture, per-object frustum culling and sort machinery buys you nothing when there is exactly one geometry, and you pay for the fixed vertex/index budget up front. Reach for BatchedMesh only if the markers have several DIFFERENT shapes (e.g. drill vs. mill vs. probe icons) that you want in a single draw call — and note that with one geometry per marker type, N InstancedMeshes is still usually simpler.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/objects/BatchedMesh.js lines 155-192 (usage doc + constructor), 203-229, 487, 499-561, 568, 627-674, 714, 826, 861, 880, 976-1021, 1074-1248, 1309, 1366, 1482, 1502*

### BufferGeometryUtils (r180 export names)

**Module.** `three/addons/utils/BufferGeometryUtils.js (Addons.js line 261 re-exports it as a namespace: `export * as BufferGeometryUtils from './utils/BufferGeometryUtils.js'`)`

**Signature.** Exact r180 export list (verbatim from the file's export block, lines 1421-1435): computeMikkTSpaceTangents, mergeGeometries, mergeAttributes, deepCloneAttribute, deinterleaveAttribute, deinterleaveGeometry, interleaveAttributes, estimateBytesUsed, mergeVertices, toTrianglesDrawMode, computeMorphedAttributes, mergeGroups, toCreasedNormals.
Signatures: mergeGeometries( geometries: BufferGeometry[], useGroups = false ): BufferGeometry (L133); mergeVertices( geometry, tolerance = 1e-4 ): BufferGeometry (L644); toCreasedNormals( geometry, creaseAngle = Math.PI / 3 ): BufferGeometry (L1316); mergeAttributes( attributes ) (L331); mergeGroups( geometry ) (L1205); estimateBytesUsed( geometry ) (L618); computeMikkTSpaceTangents( geometry, MikkTSpace, negateSign = true ) (L38).

`mergeBufferGeometries` DOES NOT EXIST in r180 — it was renamed to `mergeGeometries` and the old alias is gone. Likewise there is no `mergeBufferAttributes` (it is `mergeAttributes`). Both `mergeVertices` and `toCreasedNormals` exist with those exact names. Import either as a namespace (`import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'`) or as named imports — both work, the module has no default export.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js lines 38,133,331,426,451,518,570,618,644,810,925,1205,1316 (function definitions) and 1421-1435 (export block); C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/Addons.js line 261*

### CSS2DRenderer / CSS2DObject

**Module.** `three/addons/renderers/CSS2DRenderer.js (Addons.js line 201) — exports { CSS2DObject, CSS2DRenderer }`

**Signature.** class CSS2DObject extends Object3D; constructor( element = document.createElement('div') ). Props: isCSS2DObject = true (L32), element: HTMLElement (L41), center = new Vector2(0.5, 0.5) (L55).
class CSS2DRenderer; constructor( parameters = {} ) where parameters.element optionally supplies the container div (L128). Props/methods: domElement (L137), getSize(): {width, height} (L144), render( scene, camera ) (L159), setSize( width, height ) (L178).

The constructor sets element.style.position='absolute', element.style.userSelect='none' and draggable=false (L43-46). The renderer's own domElement gets overflow:hidden (L130). Positioning is a CSS `transform: translate(-center%,-center%) translate(Xpx, Ypx)` per label (L226) — translation only, no rotation/scale, and it is documented as "only supports 100% browser and display zoom" (L106).
Integration: it is a SECOND DOM layer you must absolutely-position on top of the WebGL canvas, size in lockstep via setSize(), and give `pointer-events: none` (otherwise labels eat OrbitControls drags — the module does NOT set that for you). Call labelRenderer.render(scene, camera) right after renderer.render(scene, camera) — including inside your on-demand 'change' handler.
Visibility rules: a label is hidden when object.visible === false, when NDC z is outside [-1,1], or when object.layers.test(camera.layers) fails (L217) — so camera layers ARE respected. There is NO depth occlusion (labels show through solids) and CSS labels are NOT affected by material.clippingPlanes, so a label on a section-cut feature will keep showing. Distance-based z-ordering is applied via zOrder() using distanceToCameraSquared.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/renderers/CSS2DRenderer.js lines 14-55, 100-110, 117-189, 202-271, 317; C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/Addons.js line 201*

### CSS3DRenderer / CSS3DObject / CSS3DSprite

**Module.** `three/addons/renderers/CSS3DRenderer.js — exports { CSS3DObject, CSS3DSprite, CSS3DRenderer }`

**Signature.** class CSS3DObject extends Object3D; constructor( element = document.createElement('div') ). class CSS3DSprite extends CSS3DObject; constructor( element ); isCSS3DSprite = true (L110). class CSS3DRenderer; constructor( parameters = {} ); setSize(width, height) (L274); render(scene, camera).

CSS3DObject applies the FULL 3D matrix (perspective transforms), so the HTML is rendered in the 3D space and will scale/skew with the camera. CSS3DSprite keeps the element camera-facing. Both share the CSS2D limitations: separate DOM layer, no depth interaction with the WebGL canvas, no clipping-plane awareness. For CAD dimension/readout labels CSS2D (billboarded, constant screen size) is almost always what you want, not CSS3D.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/renderers/CSS3DRenderer.js lines 20-27, 90-110, 152-163, 274, 384, 453*

### Sprite + SpriteMaterial + CanvasTexture (dependency-free label alternative)

**Module.** `three (src/objects/Sprite.js, src/materials/SpriteMaterial.js, src/textures/CanvasTexture.js)`

**Signature.** class Sprite extends Object3D; constructor( material = new SpriteMaterial() ). Props: isSprite = true (L64), center = new Vector2(0.5, 0.5) (L109); implements raycast() (L128).
class SpriteMaterial extends Material; constructor( parameters ). Props: color = new Color(0xffffff) (L50), map = null (L60), rotation = 0 (L83), sizeAttenuation = true (L91), transparent = true (L100) — note transparent defaults TRUE here, unlike other materials.
class CanvasTexture extends Texture; constructor( canvas, mapping?, wrapS?, wrapT?, magFilter?, minFilter?, format?, type?, anisotropy? ); sets isCanvasTexture = true and needsUpdate = true immediately.

This is the zero-new-dependency, zero-extra-DOM-layer path for dimension/readout labels, and it is exactly what ViewHelper itself uses for its X/Y/Z axis labels — see ViewHelper.js getSpriteMaterial() L371-400: create a 64x64 canvas, draw with the 2D context, wrap in `new CanvasTexture(canvas)`, set `texture.colorSpace = SRGBColorSpace`, and build `new SpriteMaterial({ map: texture, toneMapped: false })`. Copy that recipe.
Key properties: set `sizeAttenuation = false` for constant-screen-size labels (with a PerspectiveCamera, Sprite.raycast has a special path for that case, L143). Set `texture.colorSpace = SRGBColorSpace` or the text renders washed out. Set `toneMapped: false` so tone mapping doesn't shift the label color. Use `sprite.center` to anchor (0,0 = bottom-left). Redraw = redraw the canvas then `texture.needsUpdate = true`.
Advantages over CSS2D for this app: sprites ARE depth-tested against the scene (real occlusion), they DO respect material.clippingPlanes, they cost no DOM, and they need no pointer-events plumbing. Disadvantages: text is raster (blurry when zoomed unless you re-render the canvas at a higher resolution) and you must dispose the canvas texture + material yourself.

*Evidence: C:/Users/Asus/LaserForge-2.0/node_modules/three/src/objects/Sprite.js lines 46-64, 109, 128-207; C:/Users/Asus/LaserForge-2.0/node_modules/three/src/materials/SpriteMaterial.js lines 29, 50, 60, 83, 91, 100; C:/Users/Asus/LaserForge-2.0/node_modules/three/src/textures/CanvasTexture.js (whole file, 46 lines); reference recipe C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/helpers/ViewHelper.js lines 371-400*

### Pitfalls (15)

- **@types/three is 0.185.0 but the runtime three is 0.180.0 — the OrbitControls typings LIE about r180's API.** node_modules/@types/three/package.json line 3 says "version": "0.185.0". Its examples/jsm/controls/OrbitControls.d.ts declares PUBLIC `pan(deltaX, deltaY)`, `dollyIn(dollyScale)`, `dollyOut(dollyScale)`, `rotateLeft(angle)`, `rotateUp(angle)` and a `cursorStyle` getter/setter. NONE of these exist in the installed r180 runtime — grepping OrbitControls.js finds only the PRIVATE `_rotateLeft` (L853), `_pan` (L894), `_dollyIn` (L943), and no `cursorStyle` at all. TypeScript will happily compile `controls.pan(10, 0)` and it will throw `TypeError: controls.pan is not a function` at runtime. Same class of bug in ViewHelper.d.ts, which declares `location: { top, right, bottom, left }` — r180's ViewHelper.js has no `location` property whatsoever (the corner is hard-coded to bottom-right via `domElement.offsetWidth - dim`). Fix: pin @types/three to ^0.180.0, or treat the typings as advisory and verify every method against the installed .js before calling it.
- **enableDamping silently half-breaks a render-on-demand viewport.** OrbitControls only applies `dampingFactor` (default 0.05) of the pending delta per update() call and decays the rest (OrbitControls.js L615-625, L699-712). Since the class only calls update() from input handlers, an app with no rAF loop delivers ~5% of each drag and permanently strands the residual — the view feels sticky and never lands where you released. Either keep enableDamping = false (recommended: everything else works perfectly on-demand because the class self-calls update() on every pointermove/wheel/key — L1024/1046/1060/1078/1187/1782+) or run a rAF loop gated on the 'start'/'end' events. Identical trap for autoRotate (L609-613).
- **WebGLRenderer's stencil buffer is OFF by default in r180** — `stencil = false` at src/renderers/WebGLRenderer.js L76. Any section-cut capping via the official stencil technique produces no caps at all (and no error) unless you construct with `new WebGLRenderer({ stencil: true })`. This is a change from older three versions where stencil defaulted true.
- **ViewHelper.render() will erase your scene unless you bracket it with `renderer.autoClear = false`.** Its render() only calls `renderer.clearDepth()` (ViewHelper.js L163) — the second `renderer.render()` call at L168 triggers the renderer's normal autoClear, which wipes the color buffer. The official r180 editor sets `renderer.autoClear = false` before and `= true` after (editor/js/Viewport.js).
- **ViewHelper needs a pointer-event overlay, not a canvas.** It draws into a 128x128 corner of your MAIN renderer's viewport, so a click on the gizmo also reaches OrbitControls. The official pattern (editor/js/Viewport.ViewHelper.js) is a separate absolutely-positioned 128x128 div at right:0/bottom:0 that calls `event.stopPropagation()` on BOTH pointerdown and pointerup and forwards pointerup to `handleClick(event)`. Without the pointerdown stopPropagation, OrbitControls starts a rotate on the same gesture.
- **ViewHelper's animation writes camera.position/quaternion directly and ignores OrbitControls.** update(delta) slerps the camera about `viewHelper.center` (L262-281) — it does not touch controls.target. Keep viewHelper.center synced to controls.target, and drive update(delta) from a temporary rAF that runs only while `viewHelper.animating === true`, otherwise the axis-snap animation never plays in an on-demand renderer.
- **`material.clippingPlanes` is a no-op unless `renderer.localClippingEnabled === true`** (WebGLClipping.js L67), while `renderer.clippingPlanes` (global) applies unconditionally (WebGLClipping.init L22-38). Two different scopes with the same property name — mixing them up produces a section view that silently does nothing.
- **`clipIntersection` applies ONLY to the material's own planes.** WebGLClipping.js L101-102 sets `numIntersection = clipIntersection ? this.numPlanes : 0` and THEN appends the global plane count — global planes are always union-clipped. Putting a plane on renderer.clippingPlanes and expecting clipIntersection to include it will not work.
- **`mergeBufferGeometries` does not exist in r180.** The export block at BufferGeometryUtils.js L1421-1435 has `mergeGeometries` and `mergeAttributes` only — no back-compat aliases. Any code or snippet carried over from r14x/r15x will fail at import time with an undefined named export.
- **InstancedMesh: `instanceColor` is null until the first setColorAt().** setColorAt lazily allocates the attribute (InstancedMesh.js L307-313), so `mesh.instanceColor.needsUpdate = true` throws on a fresh mesh. And forgetting `mesh.instanceMatrix.needsUpdate = true` after setMatrixAt is the single most common instancing bug — nothing moves and nothing errors.
- **InstancedMesh frustum culling uses a stale boundingSphere.** The mesh is culled as one object; if you move instances without calling computeBoundingSphere() the whole batch pops out of view when the original sphere leaves the frustum (documented at InstancedMesh.js L149-150). Also, the constructor pre-fills every slot with the identity matrix (L102-106), so unset instances pile up at the origin — set `mesh.count` to the number actually in use (the draw call reads `object.count`, WebGLRenderer.js L1248).
- **BatchedMesh's setters take instanceId, not geometryId.** addGeometry() returns a geometryId, addInstance(geometryId) returns an instanceId, and setMatrixAt/setColorAt/setVisibleAt all take the instanceId. It also throws hard rather than growing: 'THREE.BatchedMesh: Maximum item count reached.' (L568) and 'Reserved space request exceeds the maximum buffer size.' (L672) — the maxInstanceCount/maxVertexCount/maxIndexCount budgets are fixed at construction unless you explicitly call setInstanceCount()/setGeometrySize().
- **CSS2D/CSS3D labels ignore depth AND ignore clipping planes.** They are DOM, composited over the canvas — a label attached to geometry that is behind a solid, or that has been cut away by material.clippingPlanes, will still be visible. They also need `pointer-events: none` on the label layer, which the module does NOT set (it only sets position:absolute/userSelect:none on each element, CSS2DRenderer.js L43-46) — without it, labels swallow OrbitControls drags. Sprite + CanvasTexture is the correct choice when occlusion and section-cut correctness matter.
- **GridHelper/PolarGridHelper bake their colors into a vertex-color attribute** (`LineBasicMaterial({ vertexColors: true })`, GridHelper.js L60) — setting `gridHelper.material.color` after construction changes nothing. Recolor by rebuilding the helper or rewriting geometry.attributes.color. Also both lie in the XZ plane, which needs a -PI/2 X rotation for a Z-up CNC scene, and LineBasicMaterial.linewidth is capped at 1px on every WebGL implementation.
- **PolarGridHelper's argument order is (radius, sectors, rings, divisions, …)** — `sectors` (spokes) before `rings`, with `divisions` being the per-ring circle tessellation, not the grid subdivision. Easy to transpose.

### Explicitly UNVERIFIED

- I did NOT verify any concrete infinite/fading-grid shader implementation. I confirmed by directory listing and grep that r180 ships none, and I described the standard fwidth()-based approach from general knowledge — the actual GLSL is new code that would have to be written and perceptually verified, not an API to cite. Treat the technique description as UNVERIFIED.
- I did NOT run or render anything. Every claim here comes from reading installed source plus three fetched official r180 files; no OrbitControls behaviour, no ViewHelper gizmo, no stencil cap, and no instancing path was executed in a browser in this session. In particular the damping/render-on-demand conclusion is derived from reading update() and the internal update() call sites, not from observing a live viewport.
- The webgl_clipping_stencil.html capping code was fetched from raw.githubusercontent.com at tag r180 and summarized by the fetch tool rather than read line-by-line by me; the individual stencil constants and Material property names in it were independently verified against the installed src/constants.js and src/materials/Material.js, but the exact renderOrder values and the per-frame cap-plane orientation math were not.
- The editor/js/Viewport.js autoClear and animating snippets were returned by the fetch tool as extracted quotes, not as the full file — the surrounding ordering (grid pass, sceneHelpers pass) is reported second-hand. editor/js/Viewport.ViewHelper.js WAS retrieved verbatim in full.
- I did NOT check whether the host project already wraps three.js anywhere, what its current viewport/renderer setup looks like, or whether @types/three@0.185.0 vs three@0.180.0 is already causing failures in this tree. I only read node_modules. Whether upgrading/downgrading @types/three is safe for existing code is unverified.
- I did NOT verify WebGPURenderer equivalents for any of these APIs — all clipping/stencil/renderer claims are WebGLRenderer-specific (the one exception is ViewHelper.render, which branches on renderer.isWebGPURenderer at line 161).
- Line2/LineMaterial (fat lines) were only spot-checked for existence and uniform names (worldUnits/linewidth/resolution/dashed at LineMaterial.js L11-13). Their full API, the required `material.resolution.set(w, h)` on resize, and their interaction with clipping planes are UNVERIFIED.

## 4.4 three.js r180 ecosystem evaluation for a CAD/CAM viewport in LaserForge-2.0 — verdict: adopt NOTHING as a runtime dep. Grounding fact that decides most of this: three.js is touched by exactly ONE file in the repo, C:/Users/Asus/LaserForge-2.0/.claude/worktrees/cnc-3d-threejs-upgrade-9d1216/src/ui/relief-viewer/relief-three-scene.ts (113 lines), which lazy-imports three and uses exactly ONE addon (three/examples/jsm/controls/OrbitControls.js), renders on demand with no rAF loop, and draws one MeshBufferGeometry surface + a stock outline. There is no picking, no raycasting, no section plane, no postprocessing, no text, no boolean solids in the tree today. Installed: three@0.180.0, @types/three@^0.185.0 (dev), react@18.3.1. Verified present in the installed r180 addons and therefore free: OrbitControls/MapControls/Arcball/Trackball/TransformControls, EffectComposer/SMAAPass/GTAOPass/SAOPass/SSAOPass/OutlinePass/TAARenderPass, Line2/LineSegments2/LineMaterial/LineGeometry, CSS2DRenderer/CSS3DRenderer, BufferGeometryUtils, MeshSurfaceSampler. Every candidate below is measured against those, under ADR-098 §2 (no new runtime deps) — so a library must beat a shipped, already-typed addon, not beat nothing.

### camera-controls (yomotsu) vs built-in OrbitControls

**Module.** `camera-controls`

**Signature.** v3.1.2 | MIT | 376,206 B unpacked (7 files) / 44.0 kB min / 10.1 kB gzip, 0 deps | peer three >=0.126.1 (r180 OK) | ships own dist/index.d.ts (38,058 B), excellent types | last release 2025-11-17, GH pushed 2026-02-02, 95 open issues, 2419 stars

VERDICT: reject (revisit only if CAD-style view framing is actually scheduled). What it genuinely does better, verified in its d.ts: fitToBox(box3OrObject, enableTransition, {cover,paddingLeft,paddingRight,paddingTop,paddingBottom}) and fitToSphere() — real 'frame the part' commands; setLookAt(px,py,pz,tx,ty,tz,enableTransition):Promise<void> and lerpLookAt/rotateTo/dollyTo, all Promise-returning so you can await a canned view change; smoothTime (time-based inertial damping, and a separate draggingSmoothTime); dollyToCursor; infinityDolly; a fully remappable mouseButtons/touches ACTION table (ROTATE|TRUCK|SCREEN_PAN|OFFSET|DOLLY|ZOOM|NONE) which is how you'd emulate Fusion/SolidWorks middle-drag conventions; and update(delta: number): boolean which returns whether a re-render is needed — a genuinely good fit for this repo's render-on-demand scene. Built-in OrbitControls r180 (1860 lines) has enableDamping/dampingFactor/zoomToCursor/screenSpacePanning/autoRotate but grep for 'fitTo|frameObject|Box3' returns 0 hits — it has NO framing helper and no transition API at all. WHY REJECT ANYWAY: the only capability we'd actually use is fitToBox, which is ~40 lines of Box3 + camera math against the existing OrbitControls.target; 10 kB gzip plus an ADR-098 §2 exception to get it is not earned by a 113-line viewer. Also note it requires a static global mutation, CameraControls.install({ THREE: subsetOfTHREE }), which has to be sequenced after the existing dynamic await import('three').

*Evidence: https://unpkg.com/camera-controls@3.1.2/dist/index.d.ts (lines 206-210 static install, 279 infinityDolly, 294 smoothTime, 334 dollyToCursor, 647 rotateTo, 661 dollyTo, 699 truck, 746 fitToBox, 753 fitToSphere, 765 setLookAt, and 'update(delta: number): boolean'); https://registry.npmjs.org/camera-controls/latest; https://api.github.com/repos/yomotsu/camera-controls; built-in comparison read at C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/controls/OrbitControls.js lines 88, 209, 219, 271, 289, 306, 597*

### postprocessing (vanruesc/pmndrs) vs three's EffectComposer

**Module.** `postprocessing   [NOTE: '@pmndrs/postprocessing' DOES NOT EXIST on npm — the registry returns no such package. The correct specifier is the unscoped 'postprocessing'.]`

**Signature.** v6.39.3 | Zlib license (NOT on the repo's stated MIT/ISC/BSD/Apache-2.0 allowlist) | 2,768,256 B unpacked (9 files) / 318.2 kB min / 109.5 kB gzip, 0 runtime deps | peer three '>= 0.168.0 < 0.186.0' — r180 explicitly in range | full first-party types, build/types/index.d.ts is 243,448 B | last release 2026-07-18, GH pushed 2026-07-18, only 30 open issues, 2815 stars — very healthy

VERDICT: reject. The merged-effect-pass claim is REAL and verified in its own README §Performance: EffectPass 'automatically organizes and merges any given combination of effects. This minimizes the amount of render operations and makes it possible to combine many effects without the performance penalties of traditional pass chaining' — i.e. N effects compile into ONE fullscreen shader with per-effect BlendFunction, versus three's EffectComposer which ping-pongs a full render target per pass. Verified exported classes include EffectPass (constructor(camera, ...effects)), SMAAEffect, SSAOEffect, OutlineEffect, ToneMappingEffect, NormalPass, DepthDownsamplingPass, plus its own EffectComposer/RenderPass. Its SMAAEffect is materially better than three's SMAAPass. WHY REJECT: 109.5 kB gzip — roughly a fifth of three itself — plus a license-policy exception for Zlib, to solve a pass-chaining cost that a single-mesh, render-on-demand, one-pass viewer does not have. three r180 already ships SMAAPass, GTAOPass, SAOPass, SSAOPass, OutlinePass and TAARenderPass in the tree at zero install cost and zero license risk. If the viewport ever stacks 3+ effects at 60fps this becomes the right answer; today it is not.

*Evidence: https://raw.githubusercontent.com/pmndrs/postprocessing/main/README.md line 72 (merge/performance claim); https://unpkg.com/postprocessing@6.39.3/build/types/index.d.ts (EffectPass, SMAAEffect, SSAOEffect, OutlineEffect, NormalPass, DepthDownsamplingPass, ToneMappingEffect declarations); https://registry.npmjs.org/postprocessing/6.39.3 (license Zlib, peer 'three: >= 0.168.0 < 0.186.0'); https://api.github.com/repos/pmndrs/postprocessing; built-ins confirmed at C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/{SMAAPass,GTAOPass,SAOPass,SSAOPass,OutlinePass,TAARenderPass}.js*

### n8ao (standalone ambient occlusion)

**Module.** `n8ao`

**Signature.** v2.0.0 | LICENSE IS AMBIGUOUS: npm metadata says 'ISC', GitHub repo license says 'CC0-1.0' — they disagree | 804,392 B unpacked (17 files) / 181.0 kB min / 82.4 kB gzip | peer three >=0.137 AND postprocessing >=6.30.0 | NO TYPESCRIPT TYPES AT ALL: package 'types' field is undefined, dist/N8AO.d.ts returns HTTP 404, and @types/n8ao does not exist ('Not Found') | last release 2026-07-12, GH pushed 2026-07-12, 3 open issues, 488 stars

VERDICT: reject (but read-for-technique — AO is the single most visually valuable thing you could add to a carved-relief viewer). It exports two entry points, verified by grepping dist/N8AO.js: N8AOPass (drop-in for three's EffectComposer, and it REPLACES RenderPass rather than being added after it) and N8AOPostPass (for the postprocessing library). Its README's pitch is exactly our use case — 'I'd recommend using this package in any scene that looks flat or fake, or in any scene with vague depth cues' — which describes an untextured carved-wood heightfield lit by one light. WHY REJECT: no types is disqualifying under this repo's strict TS + banned 'any' (you would have to hand-author an ambient module declaration and keep it in sync by hand, which is exactly the 'invention' failure mode CLAUDE.md forbids); the ISC-vs-CC0 license disagreement fails a clean license audit; 82.4 kB gzip; and it drags postprocessing (109.5 kB gzip, Zlib) along as a peer for the N8AOPostPass path. Do the free thing first: three r180 already ships GTAOPass (ground-truth AO) with a verified GTAOPass.OUTPUT enum (Off/Diffuse/AO/Denoise/Depth/Normal/Default) and constructor(scene, camera, width, height, parameters, aoParameters, pdParameters). Only revisit n8ao if GTAOPass is measurably worse on a real relief.

*Evidence: https://registry.npmjs.org/n8ao/2.0.0 (types undefined; peer three>=0.137, postprocessing>=6.30.0); https://api.github.com/repos/N8python/n8ao (license CC0-1.0, conflicting with npm's ISC); https://unpkg.com/n8ao@2.0.0/README.md (N8AOPass usage, 'replaces RenderPass'); https://unpkg.com/n8ao@2.0.0/dist/N8AO.d.ts → HTTP 404; https://registry.npmjs.org/@types%2fn8ao/latest → 'Not Found'; built-in alternative at C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/postprocessing/GTAOPass.js lines 56, 104, 526-571, 717*

### three-mesh-bvh (raycast acceleration / spatial queries / clipping caps)

**Module.** `three-mesh-bvh`

**Signature.** v0.9.13 | MIT | 2,328,541 B unpacked (104 files) / 91.7 kB min / 28.0 kB gzip, 0 runtime deps | peer three >= 0.159.0 (r180 OK) | ships first-party src/index.d.ts | last release 2026-07-18, GH pushed 2026-07-24 — the most actively maintained library on this list — 83 open issues, 3433 stars, gkjohnson is a three.js core contributor

VERDICT: reject today, adopt-if. This is the ONE library on the list I would say yes to the moment the feature exists — it is the best-engineered, most actively maintained, and cheapest at 28 kB gzip. Verified exports: computeBoundsTree(options?): GeometryBVH, disposeBoundsTree(), acceleratedRaycast(), computeBatchedBoundsTree, class MeshBVH (raycastFirst, closestPointToPoint, shapecast with 4 overloads), MeshBVHHelper, StaticGeometryGenerator, SerializedBVH, ExtendedTriangle, OrientedBox, SAH/CENTER/AVERAGE split strategies, and GLSL interop (BVHShaderGLSL, shaderIntersectFunction, shaderDistanceFunction, MeshBVHUniformStruct) for doing BVH queries inside a shader. Standard install is prototype patching: THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree; THREE.Mesh.prototype.raycast = acceleratedRaycast; then raycaster.firstHitOnly = true. IMPORTANT CORRECTION TO THE BRIEF: 'clipping caps' is NOT a shipped API — it is the clippedEdges EXAMPLE in the repo, built by hand on MeshBVH.shapecast + ExtendedTriangle. You would port the example, not import a function. WHY REJECT NOW: the repo has zero raycasting, zero picking, zero measurement, and zero section-plane code — nothing in relief-three-scene.ts calls Raycaster at all. Adopt the moment click-to-inspect on the 3D surface, a live section/clipping view, or gouge-distance queries against a dense relief mesh get scheduled; a naive three Raycaster over a full-resolution heightmap will be unusable and this is the only credible fix.

*Evidence: https://unpkg.com/three-mesh-bvh@0.9.13/src/index.d.ts (full export list; MeshBVH line 135, raycastFirst 153, closestPointToPoint 161, shapecast 177/212/228/242/262, MeshBVHHelper 309, computeBoundsTree 313, acceleratedRaycast 321, StaticGeometryGenerator 451); https://raw.githubusercontent.com/gkjohnson/three-mesh-bvh/master/README.md lines 47 (Clipped edges = example), 100-149 (prototype patching + firstHitOnly); https://registry.npmjs.org/three-mesh-bvh/latest; https://api.github.com/repos/gkjohnson/three-mesh-bvh*

### three-bvh-csg (boolean solids / true stock subtraction)

**Module.** `three-bvh-csg`

**Signature.** v0.0.18 | MIT | 1,387,590 B unpacked (45 files) / 65.2 kB min / 18.9 kB gzip | peer three >=0.179.0 (r180 OK) AND three-mesh-bvh >=0.9.7 | ships src/index.d.ts | last release 2026-02-17, GH pushed 2026-02-17, 51 open issues, 932 stars | STILL 0.0.x AFTER ~3 YEARS (0.0.15 was Dec 2023, 0.0.16 Jan 2024, 0.0.17 Apr 2025, 0.0.18 Feb 2026) — author has never declared it stable

VERDICT: reject. Verified API: class Brush extends Mesh; class Evaluator with evaluate(a: Brush, b: Brush, operation: CSGOperation, targetBrush?: Brush): Brush and a batch overload, plus evaluateHierarchy(root: Operation); operations ADDITION, SUBTRACTION, REVERSE_SUBTRACTION, INTERSECTION, HOLLOW_SUBTRACTION, HOLLOW_INTERSECTION; class Operation/OperationGroup for nested trees; debug helpers (EdgesHelper, TriangleSetHelper, HalfEdgeHelper). Three reasons this is the wrong tool for CAM stock subtraction: (1) it is TRIANGLE-SOUP mesh booleans, not a B-rep/solid kernel — it produces visually plausible meshes, not manifold solids with exact edges, so it cannot be a source of truth for anything measured; (2) 3-axis subtractive milling is a HEIGHTFIELD problem, and this repo already models it that way — core/sim exposes RemovalGrid and downsampleRemovalGrid, consumed by Cut3DPreviewDialog.tsx, so removal is a Z-depth grid and a boolean kernel would be a strictly worse and slower model of the same thing; (3) 0.0.x with 51 open issues is not a foundation for output the operator trusts. Only becomes interesting for true 4/5-axis or undercut simulation, which is not in scope.

*Evidence: https://unpkg.com/three-bvh-csg@0.0.18/src/index.d.ts (Brush 3, ADDITION/SUBTRACTION/INTERSECTION 14-20, Evaluator 22, evaluate 29-30, evaluateHierarchy 32, Operation 36); https://registry.npmjs.org/three-bvh-csg (version timeline); https://api.github.com/repos/gkjohnson/three-bvh-csg; existing heightfield model at C:/Users/Asus/LaserForge-2.0/.claude/worktrees/cnc-3d-threejs-upgrade-9d1216/src/ui/relief-viewer/Cut3DPreviewDialog.tsx lines 9-11, 29*

### three-stdlib

**Module.** `three-stdlib`

**Signature.** v2.36.1 | MIT | 26,405,702 B unpacked across 1,399 FILES / 2,343.3 kB min / 704.9 kB gzip | SIX runtime deps: draco3d, fflate, potpack, @types/draco3d, @types/offscreencanvas, @types/webxr | peer three >=0.128.0 | ships index.d.ts | last release 2025-11-10, GH pushed 2026-06-26, 32 open issues, 853 stars

VERDICT: hard reject — the clearest no on the list. three-stdlib exists to give TypeScript-native, individually-versioned copies of three's examples/jsm to projects that need addon stability decoupled from three's release cadence. This repo needs none of that: the addons are ALREADY installed (node_modules/three/examples/jsm/** with 32 subdirectories) and ALREADY fully typed by the existing devDependency @types/three@^0.185.0, which I verified ships examples/jsm/controls/{OrbitControls,MapControls,TransformControls,ArcballControls,...}.d.ts. So adopting three-stdlib buys literally zero new capability and costs 26 MB unpacked, 705 kB gzip, and six transitive runtime deps — while creating a second, drifting source of the same addon code. It is also the one library here that would meaningfully slow the install and audit steps in release:check.

*Evidence: https://registry.npmjs.org/three-stdlib/latest (unpackedSize 26405702, fileCount 1399, deps draco3d/fflate/potpack); https://api.github.com/repos/pmndrs/three-stdlib; redundancy verified locally at C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/ (32 addon dirs) and C:/Users/Asus/LaserForge-2.0/node_modules/@types/three/examples/jsm/controls/*.d.ts*

### meshline vs built-in Line2

**Module.** `meshline`

**Signature.** v3.3.1 | MIT | 51,498 B unpacked (11 files) / 13.4 kB min / 3.6 kB gzip, 0 deps — by far the smallest candidate | peer three >=0.137 | ships dist/index.d.ts re-exporting MeshLineGeometry, MeshLineMaterial, raycast | LAST RELEASE 2024-06-03, GH pushed the same day — ~2 years with no activity | 4 open issues, 380 stars | maintained under pmndrs essentially as a drei dependency, not as a standalone product

VERDICT: reject. three r180 already ships the strictly better tool for toolpath rendering. Verified in the installed tree: lines/Line2.js (extends LineSegments2, 'arbitrary line width and changing width to be in world units'), LineSegments2.js, LineGeometry.js, and LineMaterial.js whose uniforms/props include worldUnits, linewidth, resolution (Vector2), dashed and alphaToCoverage — all typed by @types/three (LineMaterial.d.ts declares dashed?, resolution?, worldUnits?). worldUnits is the decisive one for CAM: it lets you draw a toolpath ribbon at the ACTUAL tool/kerf diameter in mm so the preview shows real material width, which is exactly the LightBurn-parity kind of fidelity this repo cares about — meshline has no equivalent guarantee. meshline's only real edge is tapered width along the line and animated dashRatio (nice for glowing/artistic ribbons), neither of which is a CAM requirement. Zero reason to add a 2-year-stale dep to get less.

*Evidence: https://unpkg.com/meshline@3.3.1/dist/index.d.ts; https://registry.npmjs.org/meshline (latest 3.3.1 @ 2024-06-03); https://api.github.com/repos/pmndrs/meshline (pushed 2024-06-03); built-in verified at C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/lines/Line2.js lines 1-20 and LineMaterial.js lines 11-13, 479-485, plus C:/Users/Asus/LaserForge-2.0/node_modules/@types/three/examples/jsm/lines/LineMaterial.d.ts lines 6-12*

### troika-three-text (SDF text) vs Sprite+CanvasTexture vs CSS2DRenderer

**Module.** `troika-three-text`

**Signature.** v0.52.5 is the 'latest' dist-tag | MIT | 842,992 B unpacked (49 files) / 121.9 kB min / 43.5 kB gzip | FOUR runtime deps: bidi-js, troika-three-utils, troika-worker-utils, webgl-sdf-generator | peer three >=0.125.0 | NO TYPESCRIPT TYPES: 'types' and 'typings' both undefined, dist/troika-three-text.d.ts returns HTTP 404, and @types/troika-three-text does not exist ('Not Found') | monorepo GH pushed 2026-07-24 (active), 93 open issues, 1962 stars | note a 0.53.0 was also published 2026-07-24 while the latest tag still points at 0.52.5

VERDICT: reject — and reject the Sprite+CanvasTexture fallback too, because r180 already ships something better than BOTH for this use case. troika is genuinely excellent tech (signed-distance-field glyphs generated in a web worker, so text stays razor-sharp at any zoom and any camera angle, with real font loading, bidi and layout), and if you needed text baked INTO the 3D scene with correct depth occlusion it would be the right answer. But CAD/CAM viewport labels — axis ticks, dimension callouts, 'X 120.4 / Y 88.0 / Z -3.0', pass counters — are HUD, not geometry. For that, CSS2DRenderer (verified shipped at three/examples/jsm/renderers/CSS2DRenderer.js, and typed by @types/three) is strictly better: labels are real DOM nodes, so they inherit the app's existing typography and theme tokens for free (relevant given ADR-047's no-raw-hex discipline), are pixel-perfect at every zoom with no SDF budget, are selectable and screen-reader accessible, and cost zero bytes. Sprite+CanvasTexture is the correct choice ONLY when a label must be depth-tested/occluded by the model or must live in world space at a fixed mm size. Cost of rejecting troika: 43.5 kB gzip, four transitive deps, and hand-written ambient .d.ts under strict TS with 'any' banned.

*Evidence: https://registry.npmjs.org/troika-three-text/0.52.5 (types undefined, typings undefined, 4 deps); https://unpkg.com/troika-three-text@0.52.5/dist/troika-three-text.d.ts → HTTP 404; https://registry.npmjs.org/@types%2ftroika-three-text/latest → 'Not Found'; https://api.github.com/repos/protectwise/troika; built-in alternative verified at C:/Users/Asus/LaserForge-2.0/node_modules/three/examples/jsm/renderers/CSS2DRenderer.js and CSS3DRenderer.js*

### lil-gui (dev tooling)

**Module.** `lil-gui`

**Signature.** v0.21.0 | MIT | 226,448 B unpacked (10 files) / 30.2 kB min / 7.9 kB gzip, ZERO deps | ships dist/lil-gui.esm.d.ts | no three peer dep (framework-agnostic) | last release 2025-10-12, GH pushed 2025-10-12, 16 open issues, 1606 stars — healthy, and it is the de-facto successor to dat.gui used by three's own examples

VERDICT: dev-only. This is the one I'd actually greenlight, because a devDependency clears a much lower bar than ADR-098 §2's runtime-dep ban and it never reaches the user's bundle. It is the fastest way to tune the things this viewer will need tuned by eye — light direction/intensity, SURFACE_COLOR, GTAOPass aoParameters, camera FOV — which matters precisely because CLAUDE.md rule 2 says green tests never prove a render looks right, so you need a knob-turning loop. Two conditions: (1) devDependencies only, imported behind an import.meta.env.DEV guard so it is tree-shaken out of production; (2) it must NEVER become product UI — LaserForge has its own panel/design system and shipping a lil-gui panel to an operator would be a regression in the app's identity.

*Evidence: https://registry.npmjs.org/lil-gui/latest (license MIT, types dist/lil-gui.esm.d.ts, no dependencies); https://api.github.com/repos/georgealways/lil-gui*

### stats.js (dev tooling)

**Module.** `stats.js`

**Signature.** v0.17.0 | MIT | 1.8 kB min / 1.0 kB gzip — smallest thing on the list | LAST NPM PUBLISH 2016-10-29 (yes, ~10 years), GH pushed 2024-10-11, 22 open issues, 9138 stars | no bundled types; @types/stats.js@0.17.4 (MIT) exists and is current

VERDICT: dev-only, with a shrug. It is frozen rather than abandoned — the API is 3 methods (showPanel, begin, end) and there is nothing left to fix — and at 1.0 kB gzip plus a real @types package it is risk-free as a devDependency. Honest caveat: for a scene that renders ON DEMAND with no rAF loop, an FPS meter is close to meaningless — it will read 0 whenever the user isn't dragging. What you'd actually want to watch here is renderer.info (built in, free: info.render.calls, info.render.triangles, info.memory.geometries/textures) surfaced in a dev overlay, plus a one-off performance.now() around the initial mesh build. If you do want the classic panel, note stats-gl is the modern successor with real GPU timer queries, but that is another dep for a problem you don't have. Take stats.js only if you add a continuous render loop.

*Evidence: https://registry.npmjs.org/stats.js (latest 0.17.0 published 2016-10-29); https://api.github.com/repos/mrdoob/stats.js (pushed 2024-10-11); https://registry.npmjs.org/@types%2fstats.js/latest (0.17.4, MIT); render-on-demand design confirmed in the header comment of C:/Users/Asus/LaserForge-2.0/.claude/worktrees/cnc-3d-threejs-upgrade-9d1216/src/ui/relief-viewer/relief-three-scene.ts lines 1-4*

### three-perf (dev tooling)

**Module.** `three-perf`

**Signature.** v1.0.11 | MIT | 177,894 B unpacked (38 files) / 288.6 kB min / 79.4 kB gzip | TWO runtime deps: troika-three-text ^0.52.0 and tweakpane ^3.1.10 | peer three >=0.170 (r180 OK) | ships dist/index.d.ts | last release 2025-06-09; before that 1.0.10 was 2023-07-20 — i.e. one release in ~2 years | GitHub repo TheoTheDev/three-perf returned no stats in my API call, so I could not read stars or open-issue count

VERDICT: reject, even at the lower dev-only bar. It reports draw calls, triangles, geometries, textures, GPU/CPU time — but three's WebGLRenderer.info already exposes render.calls, render.triangles, render.frame, memory.geometries and memory.textures for free, built in, already typed, zero bytes. Paying 79.4 kB and pulling in troika-three-text (which I separately rejected for having no types) plus tweakpane to render numbers you can already read off renderer.info in about ten lines of your own overlay is a bad trade even in devDependencies, and it is the least-maintained tool in this group. If you want GPU-side timings specifically, stats-gl is the better target than three-perf.

*Evidence: https://registry.npmjs.org/three-perf/latest (deps troika-three-text + tweakpane, peer three >=0.170); https://registry.npmjs.org/three-perf (release timeline 1.0.10 @ 2023-07-20 → 1.0.11 @ 2025-06-09); https://api.github.com/repos/TheoTheDev/three-perf returned no usable fields*

### @react-three/fiber + @react-three/drei (architecture question)

**Module.** `@react-three/fiber`

**Signature.** R3F v9.6.1 | MIT | 2,181,145 B unpacked, 10 runtime deps (zustand, its-fine, scheduler, suspend-react, @babel/runtime, react-use-measure, buffer, base64-js, use-sync-external-store, @types/webxr) | PEER react '>=19 <19.3' and react-dom '>=19 <19.3'. drei v10.7.7 | MIT | 1,748,706 B across 483 files | peer react ^19 | TWENTY-ONE runtime deps including three-mesh-bvh, camera-controls, troika-three-text, three-stdlib, meshline, stats.js, @mediapipe/tasks-vision, hls.js, detect-gpu, maath. React-18-compatible line: R3F 8.18.0 and drei 9.122.0, BOTH last published 2025-02-19 — ~17 months frozen. R3F GH pushed 2026-07-08 (31.5k stars, 18 open issues); drei GH pushed 2026-03-23 (9.7k stars, 105 open issues).

VERDICT: reject — and this one isn't close. HARD BLOCKER FIRST: this repo is on react@18.3.1 with package.json pinning '"react": "^18.3.0"'. R3F 9 requires react >=19 <19.3 and drei 10 requires react ^19, so the current majors are flatly incompatible. Adopting R3F today means adopting R3F 8.18.0 + drei 9.122.0, a major line frozen since Feb 2025, and then paying for a React 19 migration to escape it later. SECOND: drei is a dependency trojan horse — installing it silently installs three-mesh-bvh, camera-controls, troika-three-text, three-stdlib, meshline and stats.js, i.e. most of the libraries I individually rejected above, in one un-auditable bundle of 21 runtime deps, which is the exact opposite of what ADR-098 §2 exists to prevent. THIRD, and this stands even ignoring versions: R3F is a paradigm change, not a library. It replaces imperative scene construction with a React reconciler and, by default, a continuous rAF render loop — whereas the existing scene is 113 lines, deliberately imperative, lazy-loads three behind await import('three') per ADR-102 §3, and renders ON DEMAND with no rAF loop specifically to avoid burning GPU while the operator is doing CAM work. R3F would rewrite all of that to gain declarative composition for a scene with exactly two objects (a surface Mesh and a stock outline). BE HONEST ABOUT THE UPSIDE: if the 3D viewport were going to grow into a large, stateful, interactive CAD workspace with dozens of selectable entities, gizmos and per-entity React state, R3F would be the better architecture and drei's <OrbitControls>/<Bounds>/<GizmoHelper> would save real work. That is a legitimate future fork in the road — but it is a Phase-scale decision requiring its own ADR and a React 19 upgrade first, not a dependency you add to improve a relief preview.

*Evidence: https://registry.npmjs.org/@react-three%2ffiber/latest (v9.6.1, peer react '>=19 <19.3'); https://registry.npmjs.org/@react-three%2fdrei/latest (v10.7.7, peer react ^19, 21 deps, 483 files); https://registry.npmjs.org/@react-three%2ffiber (8.18.0 @ 2025-02-19, peer react '>=18 <19'); https://registry.npmjs.org/@react-three%2fdrei (9.122.0 @ 2025-02-19, peer @react-three/fiber ^8); https://api.github.com/repos/pmndrs/react-three-fiber; https://api.github.com/repos/pmndrs/drei; local react 18.3.1 via node_modules/react/package.json and package.json line 55; imperative lazy-loaded scene at src/ui/relief-viewer/relief-three-scene.ts lines 1-8, 30-31*

### gcode-preview

**Module.** `gcode-preview`

**Signature.** v2.18.0 | MIT | 128,493 B unpacked (6 files) / 569.7 kB min / 142.1 kB gzip (the largest gzip on this list, because it BUNDLES three) | CRITICAL: 'three': '^0.159.0' and 'lil-gui': '^0.19.2' are listed under dependencies, NOT peerDependencies | ships dist/gcode-preview.d.ts (written in TypeScript) | last STABLE release 2024-08-12; the only newer artifacts are 3.0.0-alpha.1 → alpha.4, in alpha since 2024-12 | GitHub API returned no stats for remcoder/gcode-preview in my call

VERDICT: read-for-technique (MIT, so porting with attribution is legitimate) — NOT adoptable as a dependency, for two independent disqualifying reasons. (1) DEPENDENCY POISONING: because three@^0.159.0 is a direct dependency rather than a peer, installing gcode-preview pulls a SECOND copy of three.js into node_modules alongside our 0.180.0. That is the classic duplicate-module failure — two distinct class identities, so instanceof checks, Object3D parenting and material sharing across the boundary all break in ways that are miserable to debug, and it roughly doubles the three payload. (2) WRONG PROCESS MODEL: its API is Parser / Layer / GCodeCommand / Thumbnail / WebGLPreview and it describes itself as 'a simple G-code parser & viewer with 3D printing in mind', featuring multi-color, tube geometry, build volume and thumbnail preview. That is ADDITIVE FDM — stacked extrusion layers with E-axis flow — not subtractive milling with depth passes, tabs, ramps, plunges, kerf and tool geometry. Its layer model would actively mislead here. WHAT IS WORTH READING: its G2/G3 arc interpolation (this repo has an active arc/trace-fidelity workstream) and its tube/extrusion-ribbon geometry builder, which is a working reference for turning a polyline plus a width into a solid-looking swept path — the same problem as rendering a toolpath at true tool diameter. Read those two, port what fits, import nothing.

*Evidence: https://registry.npmjs.org/gcode-preview (latest 2.18.0 @ 2024-08-12; dependencies {"three":"^0.159.0","lil-gui":"^0.19.2"}; peerDependencies undefined; dist-tags alpha 3.0.0-alpha.4); https://unpkg.com/gcode-preview@2.18.0/dist/gcode-preview.d.ts (declare class Thumbnail/GCodeCommand/Layer/Parser/WebGLPreview); https://unpkg.com/gcode-preview@2.18.0/README.md ('with 3D printing in mind', feature summary)*

### Pitfalls (13)

- THE PREMISE ERROR IN THE BRIEF: '@pmndrs/postprocessing' does not exist on npm — a registry lookup for @pmndrs%2fpostprocessing returns nothing (no name, no dist-tags, no versions). The package is the unscoped 'postprocessing'; it merely LIVES in the pmndrs GitHub org now. Anyone who writes `pnpm add @pmndrs/postprocessing` gets a 404, and anyone who cites that name in an ADR is citing a package that isn't real.
- VERSION SKEW ALREADY IN THE TREE, FREE TO FIX: package.json pins three@^0.180.0 but @types/three@^0.185.0 — five minor versions apart on a library whose addon signatures change nearly every release. The types are describing a newer three than the one that is installed. Today it is harmless because only OrbitControls is used, but it will silently mistype any addon added next (GTAOPass, Line2, CSS2DRenderer all changed across that window). This is a real, cheap correctness win independent of every library above.
- LICENSE POLICY TRIPWIRE: the stated allowlist is MIT/ISC/BSD/Apache-2.0. `postprocessing` is Zlib — permissive and OSI-approved, but NOT on that list, so it needs an explicit policy exception, not a silent pass. Worse, `n8ao` reports ISC in npm metadata and CC0-1.0 in its GitHub repo — the two disagree, so whatever the license CI script in release:check reads may not be what the project actually is. Neither of these will look like a problem until the audit step fails.
- NO-TYPES LIBRARIES ARE DISQUALIFYING HERE, NOT MERELY ANNOYING: n8ao and troika-three-text both ship ZERO TypeScript declarations (types field undefined, .d.ts 404s, no @types package). Under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes with `any` banned, using either means hand-authoring an ambient module declaration — which is precisely the 'assert an API you haven't verified' failure CLAUDE.md's no-invention rule targets, and it silently rots on every upgrade because nothing checks it against reality.
- gcode-preview DECLARES three AS A DIRECT DEPENDENCY (^0.159.0), NOT A PEER. Installing it puts a second three.js in the tree next to 0.180.0. Two module identities means instanceof, parenting and material sharing break across the boundary, and the bundle roughly doubles. This is invisible in package.json review and only shows up as bizarre runtime behavior.
- drei IS 21 RUNTIME DEPENDENCIES IN A TRENCHCOAT: adopting @react-three/drei silently adopts three-mesh-bvh, camera-controls, troika-three-text, three-stdlib, meshline, stats.js, @mediapipe/tasks-vision, hls.js, detect-gpu and more. A repo that gates new runtime deps individually cannot approve drei without approving all of them at once, unreviewed.
- R3F 9 / drei 10 REQUIRE REACT 19; THIS REPO IS REACT 18.3.1. The React-18-compatible line (R3F 8.18.0 / drei 9.122.0) has been frozen since 2025-02-19. Any 'let's try R3F' spike that installs the latest will either fail peer resolution or, worse, install anyway under a loose resolver and break at runtime in hooks.
- 'CLIPPING CAPS' IS AN EXAMPLE, NOT AN API. three-mesh-bvh's clippedEdges is a demo built by hand on MeshBVH.shapecast + ExtendedTriangle — there is no exported makeClippingCaps(). Anyone budgeting work off 'three-mesh-bvh gives us clipping caps' is budgeting for an import that does not exist; they are budgeting to port a demo.
- camera-controls REQUIRES A STATIC GLOBAL INSTALL: CameraControls.install({ THREE: subsetOfTHREE }) must run before construction. In this codebase three arrives via `await import('three')` inside an async factory (ADR-102 §3 lazy load), so the install call has to be sequenced inside that same async path — and it mutates library-level state, which sits awkwardly against the repo's no-module-level-mutable-state rule.
- AN FPS METER MEASURES NOTHING IN A RENDER-ON-DEMAND SCENE. relief-three-scene.ts deliberately has no rAF loop ('renders on interaction/resize only'), so stats.js/three-perf will read ~0 whenever the user isn't dragging. The meaningful numbers here are renderer.info.render.calls / .triangles and a one-shot performance.now() around mesh construction — both free and built in.
- BUNDLEPHOBIA SIZES EXCLUDE PEER DEPS. Every gzip figure above is the library ALONE, with three factored out — except gcode-preview, whose 142.1 kB gzip is inflated precisely because three is a direct dep rather than a peer. Do not compare that number against the others as if it were like-for-like.
- GITHUB open_issues_count INCLUDES OPEN PULL REQUESTS. The issue counts I reported are the raw GitHub field, so e.g. three-mesh-bvh's 83 and drei's 105 overstate true bug backlogs. Treat them as a rough activity signal, not a defect count.
- troika-three-text HAS A DIST-TAG ANOMALY: 0.53.0 was published 2026-07-24 but the `latest` tag still resolves to 0.52.5 (also 2026-07-24). `pnpm add troika-three-text` and `pnpm add troika-three-text@0.53.0` would install different code today.

### Explicitly UNVERIFIED

- I BENCHMARKED NOTHING. Every performance claim above is the library's own README/marketing claim (notably postprocessing's EffectPass merging and n8ao's temporal-stability pitch), quoted with its source — not measured in this repo, not measured at all. I did not build a scene, did not profile, did not compare frame times. Do not let any of these numbers into an ADR as if they were observed.
- I DID NOT RENDER OR VISUALLY COMPARE ANYTHING. Per CLAUDE.md rule 2 this is the honest gap: I cannot tell you whether three's built-in GTAOPass looks worse than n8ao on an actual carved relief, or whether Line2 at worldUnits looks right as a toolpath ribbon. That comparison requires rendering both and looking, which I did not do.
- I DID NOT INSTALL OR RUN A SINGLE ONE OF THESE LIBRARIES. All API claims come from published .d.ts files and READMEs fetched from unpkg/GitHub, plus the INSTALLED three@0.180.0 source. In particular I did NOT verify at runtime that n8ao@2.0.0 (published 2026-07-12, twelve days old) actually works against three r180 — its peer range says >=0.137, which is so wide it proves nothing.
- I COULD NOT CONFIRM WHETHER THREE'S OWN MANUAL RECOMMENDS THE postprocessing LIBRARY. My fetch of the 'How to use post-processing' manual page resolved to the docs index rather than the article body, and the raw r180 docs HTML returned no matching lines. So I make NO claim either way about three.js officially endorsing it.
- GITHUB API RETURNED NOTHING for remcoder/gcode-preview and TheoTheDev/three-perf — no stars, no open-issue count, no pushed_at. Their maintenance status is inferred from npm publish dates alone, which is weaker evidence than for the others.
- I DID NOT READ THE REPO'S ACTUAL LICENSE-CHECK SCRIPT, so I cannot say whether release:check would in fact reject Zlib (postprocessing) or choke on n8ao's ISC/CC0 disagreement. I am reasoning from the allowlist as stated in the task brief, not from the enforcing code.
- I DID NOT READ PROJECT.md, DECISIONS.md (including ADR-098 §2 and ADR-102 themselves), or WORKFLOW.md in this session. My understanding of the dependency gate and the three.js override comes from the task brief and from the comment header of relief-three-scene.ts. If the actual ADR text differs, the ADRs win.
- I DID NOT SURVEY WHAT THE 3D VIEWPORT IS PLANNED TO BECOME. My 'reject today, adopt-if' calls on three-mesh-bvh and camera-controls are conditioned on features (picking, section planes, CAD view framing) that I inferred as plausible — I did not confirm any of them are on a roadmap. If they are already scheduled, those two verdicts should be re-examined.
- THE THREE-MESH-BVH d.ts I READ (0.9.13) EXPOSES A RESTRUCTURED API (BVH / GeometryBVH / ObjectBVH / LineBVH / PointsBVH base classes) that is newer than the usage shown in its own README. I quoted both; I did not verify which call style is current and idiomatic for 0.9.13 specifically.

---

# Part 5 — Unfinished work

Left uncommitted in worktree `cnc-3d-threejs-upgrade-9d1216` (that branch has no commits
of its own):

- `src/ui/relief-viewer/relief-three-scene.ts` — stage-1 dispose-leak fix applied
  (+14/-13): the surface material, the stock edge material and the inline `EdgesGeometry`
  are now disposed. This is a real fix for a real leak.
- `src/ui/relief-viewer/scene-lighting.ts` (110 lines) — created, **orphaned**, nothing imports it.
- `src/ui/theme/viewer3d-theme.ts` (35 lines) — created, **orphaned**, nothing imports it.

Reference source harvested during the research (cncjs `GCodeVisualizer`, jscut heightmap
shaders, kiri:moto `render`/`layers`/`stack`, `gcode-preview` internals, OpenBuilds viewer,
CAMotics `ToolPathView.cpp`, and five three.js example pages) was read for technique only
and is not reproduced here — several of those projects are GPL and this repo has a
clean-room mandate.
