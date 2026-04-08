# LaserForge — Project Map
## Living index of every file in the codebase

> **Rule**: This file is updated every time a file is added, modified, or deleted.
> Last updated: UI Wiring — File Toolbar + App Shell (41 source files, 9 test files)

---

## Architecture Overview

```
Scene → Job → Plan → Output → Device
  │        │       │        │
  │  compileJob()  │  generateOutput()
  │        │  optimizePlan()  │
  │        │       │        │
  ▼        ▼       ▼        ▼
[Design]  [Intent] [Moves]  [G-code]
```

---

## File Registry

### /src/core/types.ts
- **Responsibility**: Shared primitive types used by every module in the system. Zero dependencies.
- **Exports**: `Point`, `AABB`, `Matrix3x2`, `IDENTITY_MATRIX`, `Units`, `Origin`, `Result<T>`, `generateId()`, AABB utility functions (`emptyAABB`, `expandAABB`, `mergeAABB`, `aabbContainsPoint`, `aabbIntersects`, `aabbWidth`, `aabbHeight`)
- **Depends on**: Nothing (leaf module)
- **Depended on by**: Every file in the project

---

### /src/core/scene/SceneObject.ts
- **Responsibility**: Defines all object types that can exist on the canvas. Contains geometry variant types and factory functions for creating objects. Objects are stored in a flat list, not a deep tree.
- **Exports**: `SceneObject`, `ObjectType`, `PathSegment`, `SubPath`, all geometry types (`RectGeometry`, `EllipseGeometry`, `LineGeometry`, `PolygonGeometry`, `PathGeometry`, `TextGeometry`, `ImageGeometry`, `Geometry`), factory functions (`createRect`, `createEllipse`, `createLine`, `createPolygon`, `createPath`)
- **Depends on**: `types.ts` → `Point`, `Matrix3x2`, `AABB`, `IDENTITY_MATRIX`, `generateId`
- **Depended on by**: `Scene.ts`, `JobCompiler.ts`

---

### /src/core/scene/Layer.ts
- **Responsibility**: Defines the Layer model. A Layer is NOT just visual grouping — it IS a processing rule carrying laser settings (power, speed, mode) that determine how every object on that layer gets manufactured. Contains processing order logic.
- **Exports**: `Layer`, `LaserSettings`, `LayerMode`, `FillMode`, `DitherMode`, `CutOrder`, `LAYER_COLORS`, `defaultLaserSettings()`, `createLayer()`, `sortLayersByProcessingOrder()`
- **Depends on**: `types.ts` → `generateId`
- **Depended on by**: `Scene.ts`, `JobCompiler.ts`

---

### /src/core/scene/Scene.ts
- **Responsibility**: Root document model. Contains all objects, layers, and project settings. This is the single source of truth for the design — what gets saved/loaded. Provides query helpers for accessing objects by ID, layer, selection, etc.
- **Exports**: `Scene`, `createScene()`, `getObjectById()`, `getLayerById()`, `getObjectsByLayer()`, `getSelectedObjects()`, `getActiveLayer()`, `getVisibleLayers()`, `getOutputLayers()`
- **Depends on**: `types.ts` → `Units`, `Origin`, `generateId`; `SceneObject.ts` → `SceneObject`; `Layer.ts` → `Layer`, `createLayer`
- **Depended on by**: `JobCompiler.ts`, future UI stores

---

### /src/core/scene/index.ts
- **Responsibility**: Barrel export for the Scene module.
- **Re-exports**: Everything from `SceneObject.ts`, `Layer.ts`, `Scene.ts`

---

### /src/core/job/Job.ts
- **Responsibility**: Defines the Job data model — Stage 1 of the pipeline. A Job is a machine-agnostic description of processing intent, compiled from the Scene. Once compiled, it has no reference back to the scene graph. Contains `FlatPath` (geometry as flat Float64Arrays for WASM transfer), `ProcessedBitmap` (raster data after dithering), `Operation` (one layer's work), and `ResolvedLaserSettings` (fully resolved, no defaults).
- **Exports**: `Job`, `Operation`, `OperationType`, `FlatPath`, `ProcessedBitmap`, `OperationGeometry`, `ResolvedLaserSettings`, `createEmptyJob()`, `flatPathFromPoints()`
- **Depends on**: `types.ts` → `AABB`, `Point`, `emptyAABB`, `generateId`
- **Depended on by**: `JobCompiler.ts`, `Plan.ts`, `Output.ts`

---

### /src/core/job/JobCompiler.ts
- **Responsibility**: The bridge between design and manufacturing. Compiles a Scene into a Job by: collecting objects per layer, flattening transforms to world coordinates, converting geometry to FlatPaths, resolving layer settings, and sorting by processing order (engrave before cut). Contains Bezier curve subdivision (De Casteljau) for converting curves to polylines.
- **Exports**: `compileJob(scene: Scene): Job`
- **Depends on**: `types.ts`; `Scene.ts` → `Scene`, `getOutputLayers`, `getObjectsByLayer`; `SceneObject.ts` → `SceneObject`, `Geometry`, `PathSegment`; `Layer.ts` → `Layer`, `sortLayersByProcessingOrder`; `Job.ts` → `Job`, `Operation`, `FlatPath`, `ResolvedLaserSettings`, `createEmptyJob`, `flatPathFromPoints`
- **Depended on by**: `pipeline.test.ts`, future Plan Optimizer

---

### /src/core/job/index.ts
- **Responsibility**: Barrel export for the Job module.
- **Re-exports**: Everything from `Job.ts`, `compileJob` from `JobCompiler.ts`

---

### /src/core/plan/Plan.ts
- **Responsibility**: Defines the Plan data model — Stage 2 of the pipeline. A Plan is an optimized, ordered sequence of atomic machine Moves. The `Move` discriminated union is the most important abstraction in the system — every laser job reduces to a sequence of Moves. Laser state is explicit via `laserOn`/`laserOff` moves, NOT embedded in linear moves. Contains trapezoidal velocity model for accurate time estimation. Provides iteration helpers.
- **Exports**: `Plan`, `Move`, `RapidMove`, `LinearMove`, `LaserOnMove`, `LaserOffMove`, `DwellMove`, `AirAssistMove`, `ZMove`, `PlannedOperation`, `PlanStats`, `createEmptyPlan()`, `emptyStats()`, `calculatePlanStats()`, `iterateMoves()`, `totalMoveCount()`
- **Depends on**: `types.ts` → `Point`, `AABB`, `generateId`
- **Depended on by**: `Output.ts`, `GrblStrategy.ts`, `PlanOptimizer.ts`, future simulation engine
- **Changed in Step 18**: Added `LaserOnMove` and `LaserOffMove` to Move union

---

### /src/core/plan/PlanOptimizer.ts
- **Responsibility**: Converts a Job into an optimized Plan. Dispatches by geometry type: vector operations use inside-first + nearest-neighbor, fill operations use FillGenerator, raster operations use RasterGenerator. Emits atomic Moves with explicit `laserOn`/`laserOff` bracketing. Handles multi-pass, air assist, Z offset. Now handles ALL operation types.
- **Exports**: `optimizePlan(job: Job): Plan`
- **Depends on**: `types.ts`; `Job.ts`; `Plan.ts`; `ContainmentOrder.ts`; `FillGenerator.ts`; `RasterGenerator.ts`
- **Depended on by**: `pipeline.test.ts`, future UI
- **Changed in Step 18d**: Added `planRasterOperation()` for bitmap-to-moves conversion. Removed raster skip. All operation types now handled.

---

### /src/core/plan/ContainmentOrder.ts
- **Responsibility**: Determines which closed paths are inside other closed paths and produces depth-first ordering where inner paths are always processed before outer paths. Uses ray-casting point-in-polygon test and shoelace formula for area computation. Builds a containment tree where each node's direct parent is its smallest containing path.
- **Exports**: `applyInsideFirstOrder(paths): FlatPath[]`, `buildContainmentTree(paths): ContainmentNode[]`, `flattenContainmentTree(roots): FlatPath[]`, `ContainmentNode`
- **Depends on**: `Job.ts` → `FlatPath`; `types.ts` → `AABB`, `aabbContainsPoint`, `aabbIntersects`
- **Depended on by**: `PlanOptimizer.ts`
- **Added in Step 18b**

---

### /src/core/plan/FillGenerator.ts
- **Responsibility**: Generates scanline toolpaths for fill/engrave operations. Takes closed boundary paths and produces parallel line segments that fill their interiors. Algorithm: rotate geometry by -angle, cast horizontal rays at interval spacing, find edge intersections, pair with even-odd rule, rotate back. Supports bidirectional alternation and overscanning extension. Pure geometry — no Move generation (that's PlanOptimizer's job).
- **Exports**: `generateFillScanlines(paths, settings): ScanlineSegment[]`, `estimateScanlineCount(paths, interval, angle): number`, `ScanlineSegment`, `FillSettings`
- **Depends on**: `types.ts` → `Point`; `Job.ts` → `FlatPath`
- **Depended on by**: `PlanOptimizer.ts`
- **Added in Step 18c**

---

### /src/core/plan/RasterGenerator.ts
- **Responsibility**: Converts a ProcessedBitmap into raster scanline segments for image engraving. Handles 1-bit (ON/OFF, constant power) and 8-bit (grayscale, variable power mapped from pixel intensity). Run-length encodes consecutive pixels into burn segments. Skips empty rows. Supports bidirectional alternation and overscanning. Pure data transform — no Move generation.
- **Exports**: `generateRasterScanlines(bitmap, settings): RasterScanline[]`, `RasterSegment`, `RasterScanline`, `RasterSettings`
- **Depends on**: `types.ts` → `Point`; `Job.ts` → `ProcessedBitmap`
- **Depended on by**: `PlanOptimizer.ts`
- **Added in Step 18d**

---

### /src/core/plan/Simulation.ts
- **Responsibility**: Simulates execution of a Plan by stepping through every Move and producing a timeline of SimulationFrames. Each frame is a snapshot: time, position, laser state, power, speed, operation metadata, and progress. Provides four output modes: event-based frames (compact, for path drawing), interpolated frames at fixed intervals (for smooth animation), laser path extraction (only segments where laser is ON), and binary-search frame-at-time lookup. Uses trapezoidal velocity model for time estimation.
- **Exports**: `simulatePlan(plan, config): SimulationResult`, `interpolateFrames(result, intervalMs): SimulationFrame[]`, `extractLaserPath(result): PathSegment[]`, `getFrameAtTime(result, time): SimulationFrame`, `SimulationFrame`, `SimulationConfig`, `SimulationResult`
- **Depends on**: `types.ts` → `Point`; `Plan.ts` → `Plan`, `Move`, `PlannedOperation`
- **Depended on by**: `simulation.test.ts`, future UI canvas animation, future toolpath preview
- **Added in Step 23**

---

### /src/core/plan/index.ts
- **Responsibility**: Barrel export for the Plan module.
- **Re-exports**: Everything from `Plan.ts`, `optimizePlan` from `PlanOptimizer.ts`

---

### /src/core/output/Output.ts
- **Responsibility**: Defines the Output data model — Stage 3 of the pipeline. An Output is a device-specific representation (G-code text or binary). Contains the `OutputStrategy` interface (Strategy pattern) and `BaseGCodeStrategy` abstract class that GRBL/Marlin extend. Includes a strategy registry for plugin-style format registration.
- **Exports**: `Output`, `OutputFormat`, `OutputStrategy`, `BaseGCodeStrategy`, `registerOutputStrategy()`, `getOutputStrategy()`, `listOutputFormats()`
- **Depends on**: `types.ts` → `generateId`; `Plan.ts` → `Plan`, `Move`; `Job.ts` → `Job`
- **Depended on by**: `GrblStrategy.ts`, future `MarlinStrategy.ts`, future controller layer
- **Changed in Step 18**: `encodeMove()` now handles `laserOn` and `laserOff` move types

---

### /src/core/output/GrblStrategy.ts
- **Responsibility**: GRBL-specific G-code generation. Implements `BaseGCodeStrategy` with GRBL-specific laser commands: M4 for dynamic laser mode, S0-S1000 for power scaling. Self-registers on import.
- **Exports**: `GrblOutputStrategy`
- **Depends on**: `Output.ts` → `BaseGCodeStrategy`, `OutputFormat`, `registerOutputStrategy`
- **Depended on by**: `output/index.ts` (auto-registration)

---

### /src/core/output/index.ts
- **Responsibility**: Barrel export for the Output module. Imports strategy files to trigger self-registration.
- **Re-exports**: Everything from `Output.ts`, `GrblOutputStrategy`
- **Side effect**: Importing this module registers GRBL strategy

---

### /tests/pipeline.test.ts
- **Responsibility**: End-to-end smoke test for the full pipeline: Scene → Job → Plan → Output. Creates a scene with 4 objects across 3 layers, compiles to a Job, runs `optimizePlan()` to auto-generate a Plan, generates GRBL G-code, and verifies 62 assertions. Tests laser state correctness (laserOn before linear, laserOff after each path, no rapids during laser ON), path ordering, air assist insertion, and G-code structure including M4/M5 ordering.
- **Depends on**: All core modules
- **Run command**: `npx tsx tests/pipeline.test.ts`
- **Status**: 96/96 passing
- **Changed in Step 18d**: Added 1-bit raster tests (10×10 bitmap, segment counting, empty row skipping, power verification) and 8-bit variable power test (gradient bitmap, power mapping from pixel intensity).

---

### /src/communication/SerialPort.ts
- **Responsibility**: Abstract serial port interface that decouples controller logic from hardware. Defines `SerialPortLike` (write, writeByte, onData, onError, onClose). Includes `MockSerialPort` for testing — simulates GRBL responses (welcome message, ok/error for commands, status reports for `?`). Controllable response timing via custom response generator function.
- **Exports**: `SerialPortLike` (interface), `MockSerialPort` (class)
- **Depends on**: Nothing (interface + test mock)
- **Depended on by**: `ControllerInterface.ts`, `GrblController.ts`, `controller.test.ts`
- **Added in Step 21**

---

### /src/controllers/ControllerInterface.ts
- **Responsibility**: Abstract interface that all laser controllers implement. Defines the plugin contract: connect, disconnect, sendJob, pause, resume, stop, sendCommand, requestStatusReport, plus event subscriptions for state changes, progress, errors, and raw line logging. Any new controller type (Marlin, Ruida) implements this interface — nothing else changes.
- **Exports**: `LaserController` (interface), `MachineState`, `MachineStatus`, `MachinePosition`, `JobProgress`, callback types, `Unsubscribe`
- **Depends on**: `SerialPort.ts` → `SerialPortLike`; `Output.ts` → `Output`
- **Depended on by**: `GrblController.ts`, future UI device panel
- **Added in Step 21**

---

### /src/controllers/grbl/GrblController.ts
- **Responsibility**: GRBL 1.1 controller implementation. Full lifecycle: connection with firmware detection, state machine (disconnected→connecting→idle→run→hold→alarm), character-counting buffer management (127 bytes), line-by-line G-code streaming with backpressure, status report parsing (`<State|MPos:X,Y,Z|FS:F,S>`), real-time commands (? status, ! hold, ~ resume, 0x18 reset), progress tracking with percentage and elapsed time, error handling with line attribution.
- **Exports**: `GrblController` (class implementing `LaserController`)
- **Depends on**: `ControllerInterface.ts` → all types; `SerialPort.ts` → `SerialPortLike`; `Output.ts` → `Output`
- **Depended on by**: `controller.test.ts`, future UI
- **Added in Step 22**

---

### /tests/controller.test.ts
- **Responsibility**: Tests for GRBL controller: connection lifecycle (connect → idle → disconnect), G-code streaming (9 lines, verify all sent and acknowledged, 100% progress), buffer management (character-counting, verify 3-4 lines sent before first ack, no overflow), status report parsing (position, feed rate, spindle speed, state transitions), pause/resume (hold/resume with controlled mock), error handling (error:20 attributed to correct line, job continues), raw line logging (TX/RX capture), disconnect during job (clean abort, no crash).
- **Depends on**: `GrblController.ts`, `MockSerialPort`, `ControllerInterface.ts`, `Output.ts`
- **Run command**: `npx tsx tests/controller.test.ts`
- **Status**: 40/40 passing
- **Added in Step 22**

---

### /tests/simulation.test.ts
- **Responsibility**: Tests for the simulation engine: basic frame generation from a square cut path (10 frames, 300mm cut distance, 14.14mm rapid), position tracking at all 4 corners, laser state tracking (ON during linears, OFF before/after), timing (monotonic, trapezoidal model, rapid < 1s), progress (0→1, monotonic), operation metadata propagation, frame interpolation at 100ms intervals (305 frames from 30s job), laser path extraction (4 segments with correct color/power), binary-search frame-at-time (origin/end/midpoint), multi-operation plan (engrave before cut, correct segment counts).
- **Depends on**: `Simulation.ts`, `Plan.ts`
- **Run command**: `npx tsx tests/simulation.test.ts`
- **Status**: 57/57 passing
- **Added in Step 23**

---

### /src/geometry/bounds.ts
- **Responsibility**: Pure functions for computing bounding boxes from Scene objects and SimulationResult. `computeFitBounds` implements a priority cascade: simulation bounds → scene content bounds → bed bounds. `computeObjectBounds` transforms local geometry corners to world space via the object's affine matrix. `computeSimulationBounds` scans all movement frames. Handles all 7 geometry types including bezier control points.
- **Exports**: `computeFitBounds(scene, simulation): AABB`, `computeSceneBounds(scene): AABB`, `computeObjectBounds(obj): AABB`, `computeSimulationBounds(result): AABB`
- **Depends on**: `types.ts` → `AABB`, `Point`, `emptyAABB`, `expandAABB`, `mergeAABB`; `Scene.ts`; `SceneObject.ts`; `Simulation.ts`
- **Depended on by**: `SceneRenderer.ts` (frustum culling), `CanvasViewport.tsx` (zoom-to-fit), `pipeline.test.ts`
- **Relocated from `/src/ui/bounds.ts` to `/src/geometry/bounds.ts`**

---

### /src/geometry/hit-test.ts
- **Responsibility**: Pure hit testing for object selection. AABB pre-filter then geometry-specific tests (point-in-rect, point-in-ellipse, point-near-line via projection, point-in-polygon via ray casting, path via polyline approximation). Transforms world-space click points into object local space via matrix inverse.
- **Exports**: `hitTestPoint(worldPoint, scene, tolerance): SceneObject | null`
- **Depends on**: `types.ts`; `Scene.ts`; `SceneObject.ts`; `bounds.ts` → `computeObjectBounds`
- **Depended on by**: `CanvasViewport.tsx`

---

### /src/import/svg/TransformParser.ts
- **Responsibility**: Parse SVG transform attribute strings into Matrix3x2. Handles `matrix()`, `translate()`, `scale()`, `rotate()` (with optional center), `skewX()`, `skewY()`, and compound transforms applied left-to-right.
- **Exports**: `parseTransform(attr): Matrix3x2`, `multiplyMatrix(a, b): Matrix3x2`
- **Depends on**: `types.ts` → `Matrix3x2`, `IDENTITY_MATRIX`
- **Added in SVG Import**

---

### /src/import/svg/PathParser.ts
- **Responsibility**: Parse SVG path `d` attribute into PathGeometry. Handles all standard commands: M/m, L/l, H/h, V/v, C/c, S/s (smooth cubic), Q/q, T/t (smooth quadratic), A/a (arcs → cubic approximation), Z/z. Handles relative/absolute, implicit repeated commands, compact notation, and multiple subpaths.
- **Exports**: `parsePathData(d: string): PathGeometry`
- **Depends on**: `SceneObject.ts` → `PathGeometry`, `SubPath`, `PathSegment`
- **Added in SVG Import**

---

### /src/import/svg/SvgParser.ts
- **Responsibility**: Parse SVG XML string into a flat list of typed `SvgElement` objects with accumulated transforms. Uses `@xmldom/xmldom` for XML parsing. Traverses DOM recursively, flattening groups by multiplying transforms down the tree. Extracts viewBox and dimension attributes.
- **Exports**: `parseSvg(svgString): { elements, viewBox, width, height }`, `SvgElement`
- **Depends on**: `@xmldom/xmldom`; `TransformParser.ts`; `types.ts`
- **Added in SVG Import**

---

### /src/import/svg/SvgToScene.ts
- **Responsibility**: Convert parsed SVG elements into SceneObjects and assemble a Scene. Each SVG element becomes one SceneObject with group transforms in the transform matrix and local coordinates preserved in geometry. Converts: rect, circle→ellipse, ellipse, line, polyline→polygon(open), polygon, path.
- **Exports**: `importSvgToScene(svgString, name): Scene`, `importSvgIntoScene(svgString, scene, layerId): Scene`
- **Depends on**: `types.ts`; `Scene.ts`; `SceneObject.ts`; `Layer.ts`; `SvgParser.ts`; `PathParser.ts`
- **Added in SVG Import**

---

### /src/import/svg/index.ts
- **Responsibility**: Barrel export for SVG import. Main entry point: `importSVG(svgString): Scene`.
- **Re-exports**: `importSVG`, `importSvgIntoScene`, `parsePathData`, `parseTransform`, `multiplyMatrix`, `parseSvg`, `SvgElement`

---

### /tests/svg-import.test.ts
- **Responsibility**: Tests for SVG import: transform parsing (translate, scale, rotate, matrix, compound, multiply), path data parsing (absolute, relative, H/V, cubic, quadratic, smooth curves, multiple subpaths, compact notation, implicit lineto, empty), element conversion (rect with cornerRadius, circle→ellipse, ellipse, line, polygon closed, polyline open, path with S command), nested group transforms (2-level accumulation), transform/geometry independence (groups don't bake into geometry), mixed elements (5 types in one SVG), viewBox/dimension handling, and error cases (empty, invalid XML, empty SVG element).
- **Run command**: `npx tsx tests/svg-import.test.ts`
- **Status**: 141/141 passing

---

### /src/core/scene/SceneOps.ts
- **Responsibility**: Pure immutable scene mutation functions. `moveObjects` translates selected objects' transforms. `setSelection` updates selection array. `deleteObjects` removes by ID. `duplicateObjects` clones with offset. `moveToLayer` reassigns layer. Every function returns a new Scene (never mutates), invalidates cached bounds, updates modified timestamp.
- **Exports**: `moveObjects()`, `setSelection()`, `deleteObjects()`, `duplicateObjects()`, `moveToLayer()`
- **Depends on**: `types.ts`; `Scene.ts`; `SceneObject.ts`
- **Depended on by**: `SceneCommands.ts`, `CanvasViewport.tsx`

---

### /src/ui/history/HistoryManager.ts
- **Responsibility**: Cursor-based undo/redo history for Scene snapshots. Linear history (no branching). Push adds after cursor and truncates redo entries. Undo/redo move the cursor. Max size evicts oldest entries. Stores Scene references (structural sharing, not deep copies). Provides change listener for UI updates.
- **Exports**: `HistoryManager` (class), `HistoryState`, `HistoryChangeCallback`
- **Depends on**: `Scene.ts`
- **Depended on by**: `history.test.ts`, future app shell

---

### /src/ui/history/SceneCommands.ts
- **Responsibility**: Pure command functions for all Scene mutations. Each function: `(scene, args) → newScene`. Re-exports SceneOps commands. Adds: `addObject`, `addObjects`, `updateObject`, `updateGeometry`, `updateTransform`, `addLayer`, `removeLayer`, `reorderObjects`. All use structural sharing — unchanged objects keep same reference.
- **Exports**: All SceneOps + `addObject()`, `addObjects()`, `updateObject()`, `updateGeometry()`, `updateTransform()`, `addLayer()`, `removeLayer()`, `reorderObjects()`
- **Depends on**: `Scene.ts`; `SceneObject.ts`; `SceneOps.ts`; `types.ts` → `Matrix3x2`; `Layer.ts`
- **Depended on by**: `history.test.ts`, future app shell

---

### /tests/history.test.ts
- **Responsibility**: Tests for HistoryManager (push/undo/redo, null returns at boundaries, push-after-undo truncates redo, max size eviction, reset/clear, change listeners with unsubscribe) and SceneCommands (structural sharing verified via reference equality, add/update/delete, duplicate with offset, reorder z-order, layer add/remove, full 4-step undo/redo workflow).
- **Run command**: `npx tsx tests/history.test.ts`
- **Status**: 77/77 passing

---

### /src/ui/viewport.ts
- **Responsibility**: Pure viewport coordinate math. `ViewportState` (plain data), `Transform` class (encapsulates state, provides `worldToScreen`, `screenToWorld`, `screenPx`, `applyToContext`, `getVisibleWorldBounds`), plus free functions for zoom, pan, fit-to-bounds. `fitToAABB` takes an AABB + padding percentage for content-aware zoom-to-fit.
- **Exports**: `ViewportState`, `DEFAULT_VIEWPORT`, `Transform` (class), `fitToAABB()`, free functions: `screenToWorld()`, `worldToScreen()`, `worldToScreenDist()`, `screenToWorldDist()`, `zoomAt()`, `pan()`, `fitToBounds()`, `wheelToZoomFactor()`
- **Depends on**: `types.ts` → `Point`, `AABB`
- **Depended on by**: `CanvasViewport.tsx`, `SceneRenderer.ts`, `SimulationRenderer.ts`, `viewport.test.ts`
- **Changed**: Added `Transform.getVisibleWorldBounds()` for frustum culling, `fitToAABB()` for zoom-to-fit

---

### /src/ui/renderers/SceneRenderer.ts
- **Responsibility**: Pure Canvas2D rendering for Scene content. Uses `Transform` for zoom-compensated sizes. Implements frustum culling: computes visible world bounds once via `transform.getVisibleWorldBounds()`, skips objects whose AABB (from `computeObjectBounds`) doesn't intersect the visible area.
- **Exports**: `renderScene(ctx, scene, transform, width, height)`
- **Depends on**: `Scene.ts`, `SceneObject.ts`, `Layer.ts`, `viewport.ts` → `Transform`; `types.ts` → `AABB`, `aabbIntersects`; `bounds.ts` → `computeObjectBounds`
- **Depended on by**: `CanvasViewport.tsx`
- **Changed**: Added frustum culling via visible bounds + object AABB intersection test

---

### /src/ui/renderers/SimulationRenderer.ts
- **Responsibility**: Pure Canvas2D rendering for simulation overlays. Implements segment-level frustum culling: when `visibleBounds` is provided, segments whose endpoint AABB doesn't intersect the visible area are skipped (conservative, zero false negatives). Laser head always renders (always relevant).
- **Exports**: `renderSimulationPath(ctx, result, transform, time, visibleBounds?)`, `renderLaserHead(ctx, result, transform, time)`, `renderTrail(ctx, result, transform, time, duration?, visibleBounds?)`
- **Depends on**: `Simulation.ts` → `SimulationResult`, `getFrameAtTime`; `viewport.ts` → `Transform`; `types.ts` → `AABB`
- **Depended on by**: `CanvasViewport.tsx`
- **Changed**: Added optional `visibleBounds` parameter for frustum culling, `segmentVisible()` internal helper

---

### /src/ui/components/CanvasViewport.tsx
- **Responsibility**: Orchestration-only React component. Owns no rendering logic, no coordinate math, no bounds computation. Manages: canvas ref, viewport state, mouse events, playback state. Creates `Transform.from(viewport)` once per render, computes `visibleBounds` once for culling. Zoom-to-fit uses `computeFitBounds` + `fitToAABB`. Auto-fits on initial mount.
- **Exports**: `CanvasViewport` (React component)
- **Depends on**: `Scene.ts`; `Simulation.ts`; `viewport.ts` → `Transform`, `fitToAABB`, `zoomAt`, `pan`; `geometry/bounds.ts` → `computeFitBounds`; `SceneRenderer.ts`; `SimulationRenderer.ts`
- **Depended on by**: Future app shell

---

### /tests/viewport.test.ts
- **Responsibility**: Tests for viewport coordinate math: identity transforms (zoom=1, offset=0), zoomed transforms (2x: 200px→100mm), offset transforms, full round-trip (world→screen→world preserves coordinates), zoom-at-point invariant (world point under cursor stays fixed), zoom clamping (0.05–50), pan offset arithmetic, fit-to-bounds centering and aspect ratio (horizontal and height-limited beds), wheel zoom factor symmetry, extreme values (zoom 50x, 0.1x, negative offsets).
- **Depends on**: `viewport.ts`
- **Run command**: `npx tsx tests/viewport.test.ts`
- **Status**: 50/50 passing
- **Changed in Refactor**: Added 10 Transform class tests (worldToScreen/screenToWorld match free functions, round trip, screenPx at different zoom levels)

---

## Dependency Graph

```
types.ts ◄─────────────────────────────── (everything depends on this)
  │
  ├── SceneObject.ts
  │     │
  ├── Layer.ts
  │     │
  │     ├── Scene.ts
  │     │     │
  │     │     └──► JobCompiler.ts
  │     │               │
  │     └───────────────►│
  │                      │
  ├── Job.ts ◄───────────┘
  │     │
  │     ├── FillGenerator.ts
  │     ├── RasterGenerator.ts
  │     └── ContainmentOrder.ts
  │              │
  ├── Plan.ts    │
  │     │        │
  │     ├── PlanOptimizer.ts ◄── FillGenerator + RasterGenerator + ContainmentOrder
  │     │
  │     ├── Output.ts ◄── Job.ts
  │     │     │
  │     │     └── GrblStrategy.ts
  │     │
  │     └──────────────► (future simulation engine)
  │
  └── pipeline.test.ts (imports all)
```

---

## Module Boundaries

| Module | Can import from | Cannot import from |
|--------|----------------|-------------------|
| `types.ts` | Nothing | — |
| `scene/*` | `types.ts` | `job/*`, `plan/*`, `output/*` |
| `job/*` | `types.ts`, `scene/*` | `plan/*`, `output/*` |
| `plan/*` | `types.ts`, `job/*` | `scene/*`, `output/*` |
| `output/*` | `types.ts`, `plan/*`, `job/*` | `scene/*` |
| `tests/*` | Anything | — |

**Key rule**: Dependencies flow DOWN the pipeline only. Scene never imports Job. Plan never imports Scene. Output never imports Scene. This enables independent testing of each layer.

---

## Pipeline Connections (wired vs pending)

| Connection | Function | Status |
|-----------|----------|--------|
| Scene → Job | `compileJob(scene)` in `JobCompiler.ts` | ✅ Wired + tested |
| Job → Plan | `optimizePlan(job)` in `PlanOptimizer.ts` | ✅ Wired + tested (all types) |
| Plan → Output | `strategy.generate(plan, job)` in `GrblStrategy.ts` | ✅ Wired + tested |
| Output → Device | `controller.sendJob(output)` in `GrblController.ts` | ✅ Wired + tested (mock serial) |

---

## Files Not Yet Created (Planned)

| File | Phase | Purpose |
|------|-------|---------|
| `/src/core/output/MarlinStrategy.ts` | 5 | Marlin-specific G-code |
| `/src/geometry/transform.ts` | 2 | Matrix multiply, invert, decompose |
| `/src/geometry/hit-test.ts` | 2 | Point-in-shape for selection |
| `/src/raster/ImageProcessor.ts` | 4 | Brightness/contrast/gamma adjustments |
| `/src/raster/Dithering.ts` | 4 | Floyd-Steinberg and other algorithms |
| `/src/workers/GeometryWorker.ts` | 3 | Web Worker for WASM geometry ops |
| `/src/workers/RasterWorker.ts` | 4 | Web Worker for image processing |
| `/src/ui/stores/SceneStore.ts` | 1 | Zustand store for scene state |
| `/src/ui/stores/ViewportStore.ts` | 1 | Zustand store for zoom/pan/grid |

---

## Stats

| Metric | Value |
|--------|-------|
| Source files | 41 |
| Test files | 9 |
| Total lines of code | ~12,300 |
| Test assertions | 676 (676 passing) |
| Pipeline stages | 4 of 4 ✅ COMPLETE |
| Pipeline connections | 4 of 4 ✅ COMPLETE |
| Operation types | cut ✅, score ✅, engrave/fill ✅, raster ✅ |
| Controller protocols | GRBL ✅, Marlin ⏳, Ruida ⏳ |
| Simulation | Event frames ✅, Interpolation ✅, Path extraction ✅ |
| UI | Viewport ✅, Render ✅, Selection ✅, Drag-move ✅, Toolbar ✅, App shell ✅ |
| Import | SVG ✅ (all elements + units + viewBox + placement) |
| History | Undo/Redo ✅, Structural sharing ✅, Drag batching ✅ |
| File I/O | Save ✅, Load ✅, Roundtrip verified ✅ |
| Next milestone | Electron shell → Drawing tools → Image processing |
