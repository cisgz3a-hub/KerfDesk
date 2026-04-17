# LaserForge

![CI](https://github.com/stolkjohannjohann-sudo/LaserForge/actions/workflows/ci.yml/badge.svg)

Professional laser engraving/cutting CAM software. LightBurn competitor built with TypeScript.

## Quick Start

```bash
npm install
npm test
```

## Architecture

```
Scene → Job → Plan → Output → Device
```

**Scene** — Design document: objects, layers, transforms.  
**Job** — Machine-agnostic operations compiled from Scene.  
**Plan** — Ordered move sequences with laser on/off, power, speed.  
**Output** — G-code (GRBL) generated from Plan.  
**Device** — Serial streaming with buffer management.

## Stack

- **Core engine**: Pure TypeScript, zero dependencies
- **SVG import**: `@xmldom/xmldom` for parsing
- **UI**: React + Canvas2D
- **Desktop**: Electron (planned)
- **Geometry**: Rust/WASM (planned)

## Project Structure

```
src/
  core/
    types.ts          — Point, AABB, Matrix3x2
    scene/            — SceneObject, Layer, Scene, SceneOps
    job/              — Job, JobCompiler (Scene → flat paths)
    plan/             — PlanOptimizer, FillGenerator, RasterGenerator,
                        ContainmentOrder, Simulation
    output/           — GrblStrategy (G-code generation)
  geometry/
    bounds.ts         — AABB computation with transforms
    hit-test.ts       — Click-to-select (7 geometry types)
  import/svg/
    PathParser.ts     — SVG path d → PathGeometry (all commands + arcs)
    TransformParser.ts — SVG transform attr → Matrix3x2
    SvgParser.ts      — XML → flat element list (units, viewBox)
    SvgToScene.ts     — Elements → SceneObjects → Scene
  io/
    SceneSerializer.ts — Scene ↔ JSON (versioned file format)
    FileIO.ts          — Browser save/load (Blob + file input)
    SvgImportPlacement.ts — Fit/fill/center placement math
  controllers/
    grbl/GrblController.ts — GRBL 1.1 state machine + serial streaming
  communication/
    SerialPort.ts     — Serial abstraction + mock for testing
  ui/
    viewport.ts       — Transform class, zoom/pan/fit math
    renderers/
      SceneRenderer.ts      — Canvas2D: bed, grid, objects, selection
      SimulationRenderer.ts — Laser path, head, trail
    components/
      CanvasViewport.tsx — Canvas orchestration, mouse interaction
      FileToolbar.tsx    — New / Import SVG / Save buttons
      App.tsx            — Root: state, history, keyboard shortcuts
    history/
      HistoryManager.ts  — Cursor-based undo/redo (100 snapshots)
      SceneCommands.ts   — Pure scene mutation functions
tests/
  pipeline.test.ts          — 96 assertions
  controller.test.ts        — 40 assertions
  simulation.test.ts        — 57 assertions
  viewport.test.ts          — 70 assertions
  svg-import.test.ts        — 141 assertions
  svg-import-placement.test.ts — 58 assertions
  placement.test.ts         — machine placement / G-code golden extents
  history.test.ts           — 101 assertions
  scene-io.test.ts          — 75 assertions
  ui-integration.test.ts    — 38 assertions
  autosave-serialization.test.ts — autosave stripping + compile-equivalence + recovery guardrails
```

## Tests

777 assertions across 15 test suites, all passing.

```bash
npm test
```

## Key Design Decisions

- **Layers ARE processing rules** — power, speed, mode (not just visual grouping)
- **Flat scene graph** with parent refs (like Figma)
- **Move discriminated union** — explicit laserOn/laserOff moves
- **Four-stage pipeline** with pure functions at each boundary
- **Inside-first ordering** via containment tree + nearest-neighbor
- **Character-counting buffer** for GRBL (127 bytes)
- **Structural sharing** — unchanged objects keep same JS reference across snapshots
- **Selection is UI state** — stripped from history and saved files
- **Unitless SVG = mm** (laser convention, not SVG spec px default)

## File Format

`.laserforge.json` — versioned envelope:

```json
{
  "format": "laserforge",
  "version": "1.0",
  "appVersion": "0.1.0",
  "scene": { ... }
}
```

## License

ISC
