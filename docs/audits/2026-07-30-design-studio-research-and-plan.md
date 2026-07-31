# Design Studio — research findings and staged build plan

> Companion to `2026-07-30-design-studio-brief.md` (the governing brief).
> Research fetched 2026-07-30 across 215 primary sources by a 12-agent fan-out;
> codebase claims are from the current tree at branch `claude/zealous-tharp-ec6791`,
> HEAD `a5a65f64`, and cite `file:line`.
>
> **Baseline before any change:** `pnpm test` → 1348 files / 8122 tests passed,
> 14 files / 22 tests skipped, exit 0 (24 min).

---

## Part 1 — What the reference apps actually do

### 1.1 The single most important finding: a constraint solver cannot be bought

Every browser-capable 2D geometric constraint solver was screened for license.

| Candidate | License (verified) | Verdict |
|---|---|---|
| `@salusoft89/planegcs` (npm 1.2.0) | npm manifest says `LGPL-2.0-or-later`; repo LICENSE file is verbatim LGPL-2.1 | **REJECT** — GPL-family, and the metadata disagrees with the text |
| planegcs (FreeCAD C++ source) | `SPDX-License-Identifier: LGPL-2.1-or-later` in `GCS.cpp` | **REJECT** |
| SolveSpace / libslvs + WASM ports | `GPL-3.0-or-later` (COPYING.txt) | **REJECT** — strong copyleft |
| JSketcher | Custom Autodrop3d license requiring **irrevocable copyright assignment** of modifications | **REJECT** — not OSI, not permissive |
| CADmium | Elastic License 2.0 — "except offer it as a service to third parties" | **REJECT** — KerfDesk is a hosted PWA |
| kiwi.js | BSD-3-Clause ✅ | **Not a substitute** — Cassowary is a *linear* solver; tangency, distance, angle, radius and concentricity are nonlinear |

An npm registry search across three query variants returned **exactly one** published
2D geometric constraint solver, and it is LGPL. Our gate is mechanical:
`scripts/check-licenses.mjs:22` allows MIT / MIT-0 / BSD-2 / BSD-3 / BSL-1.0 /
Apache-2.0 / MPL-2.0 / ISC / Unlicense / 0BSD / BlueOak-1.0.0 / Python-2.0 and
nothing else. `LGPL-2.0-or-later` fails `pnpm license-check`, which runs in
`release:check`.

**Consequence:** brief §5 decision 1 is no longer a three-way choice. It is
in-house or not at all.

### 1.2 What is free — verified, zero new dependencies

- **three.js 0.180.0 already in the tree** exposes `Shape`, `Path`, `ExtrudeGeometry`,
  `LatheGeometry`, `ShapeGeometry`, `ShapePath`, `CurvePath`, and every curve class.
  I loaded the installed module and checked each symbol. The entire 2.5D view (D6)
  needs **no new dependency**.
- **clipper2-ts 2.0.1-17 already ships capabilities this tree never imports**
  (verified in `node_modules/clipper2-ts/dist/*.d.ts`): `simplifyPathD` /
  `simplifyPathsD`, `ramerDouglasPeuckerD`, `trimCollinearD`, `minkowskiSumD` /
  `minkowskiDiffD`, `rectClip` / `rectClipLines`, `booleanOpDWithPolyTree`
  (**PolyTreeD gives real outer/hole nesting**), `triangulate` / `Delaunay`,
  `areaD`, `reversePathD`, `ellipseD`, `pointInPolygonD`, `getBoundsD`.
  Also `JoinType.{Miter,Square,Bevel,Round}` and
  `EndType.{Polygon,Joined,Butt,Square,Round}` — the tree uses only `Miter`/`Round`
  and only `EndType.Polygon`.
  **This means open-path offset (stroke-to-path), path simplification, and
  hole-aware booleans are all reachable with zero new dependencies.**
- Mesh CSG, if ever wanted: `manifold-3d` Apache-2.0, `three-bvh-csg` MIT
  (both registry-verified). Not needed for 2.5D.

### 1.3 UX patterns worth copying — attributed

**LightBurn** (our stated reference, CLAUDE.md rule 3):
- **Two vertical left rails**: a *Creation* toolbar on top for making geometry and a
  *Modifiers* toolbar below it for combining/altering/arraying. This is the layout
  we adopt.
- Flyout submenus on a toolbar slot (click the lower-right arrow or click-and-hold).
- **Hover-then-press-a-letter node editing** — the target is whatever is under the
  pointer, so there is never a node sub-tool to select or exit.
- **Parametric on-canvas handles in distinct colours**, Ctrl-dragged: blue = rectangle
  corner radius, purple = polygon sides — and the same values are typeable in Shape
  Properties. Dual entry, one model.
- Context-sensitive **top toolbars that swap with the selection** rather than one
  crowded static bar.
- **Destructive-preview feedback**: in Trim the cursor becomes scissors and the doomed
  segment turns red *before* the click; in Measure the hovered shape highlights green.
- Modifier-as-variant instead of extra buttons (Ctrl+click in Trim = don't auto-join).
- Heavy parametric ops are modal dialogs (Offset, Grid Array, Circular Array) sharing
  three trailing options: Delete originals / Group results / Select results.
- Arrays accept **either count or extent** as entry into the same result.
- **Guidelines are ordinary objects on a non-output Tool layer (T1)**, not a separate
  concept. We already have `Layer.output` — this costs us nothing.

**Figma:**
- **Modifier-held measurement overlay** — spacing HUD appears only while Alt is down,
  so the canvas stays clean. Exactly right for kerf/offset distances.
- Inverse modifier semantics on resize: the same key means constrain *or* unconstrain
  depending on current lock state, so the modifier is never wasted.
- Vector edit mode gets its **own secondary toolbar** rather than overloading the main one.
- Smart selection: gap handles between items retune spacing across a whole run.

**tldraw** (the performance model — this is how "smooth" is achieved):
- **Tools are states, not flags**: each tool is a state node owning `Idle` / `Pointing` /
  `Dragging` children. This is the published answer to "modifier keys mean different
  things per tool without a pile of booleans."
- **Culling**: off-screen shapes stay in the store but are not rendered — "a canvas with
  10,000 shapes might only render 50."
- **Geometry caching** for bounds and hit-testing, invalidated only when props change.
- **Level of detail**: drop shadows, pattern fills and text outlines at low zoom.
- Moving shape indicators from SVG to 2D canvas was reported **up to 25× faster**.
- Alignment letters `alt+A/H/D/W/S` are copied verbatim from Figma — strong evidence
  that this is *the* familiar convention.

**Cuttle.xyz** (closest competitor — parametric design aimed at laser/CNC):
- Every shape is a component; instances are live and editing the component updates all.
- Modifiers are pure functions: `Modifier({params}, inputGeometry)` never mutates input.
- "Customize Each Repetition" exposes a `rep` index to everything upstream of a repeat.
- Cut/score/engrave conveyed purely by **colour convention** — same as our layer model.

**Fusion / Onshape** (the constraint vocabulary):
- **One unified Dimension tool that infers type from selection** — two points → linear,
  non-parallel lines → angular, circle → diameter, arc → radius. One key (`D` in Fusion,
  `d` in Onshape), not eight buttons. This is the design we adopt for D4.
- **Driving vs driven (reference) dimensions** — right-click to toggle. A driven
  dimension measures without constraining, which is how you annotate without
  over-constraining.
- Construction / centerline are **line-type modes applied to any entity**, not separate tools.
- Onshape's **Constraint Manager** — a filterable list of every constraint by Type /
  Mode / Status. Both apps' documented weakness is having **no numeric
  degrees-of-freedom readout**; FreeCAD's "Under constrained: n DoF(s)" is better.

---

## Part 2 — What our canvas is today

### 2.1 Rendering and interaction

- Two stacked DOM canvases (`WorkspaceCanvasLayers`), one **synchronous
  immediate-mode redraw per React effect**, all mm↔px math funnelled through
  `view-transform.ts`. On-demand render; no rAF loop.
- Tool dispatch is an if-chain in `beginToolDrag` ([use-workspace-drag.ts:222](src/ui/workspace/use-workspace-drag.ts:222)).
- **No `assertNever` over `ToolMode` exists anywhere.** Adding a variant produces a
  compile error at exactly one site (`ToolStrip.tsx:153`) and silently takes the else
  branch at `Workspace.tsx:72`, `workspace-drag-updates.ts:76`,
  `selection-move-cursor.ts:48`, `finish-draw-tool.ts:8`, `use-app-commands.ts:78`.

### 2.2 The hard mechanical blockers

| Blocker | Measured | Consequence |
|---|---|---|
| `use-workspace-drag.ts` | **398 of 400** counted lines | No new tool branch can land in this file |
| `beginToolDrag` | complexity **11 of 12** | One more `if` hits the cap |
| `computeMouseDownDrag` | complexity **12 of 12** | At the cap already |
| `useDragMove`, ui-store factory | **78 of 80** function lines each | ~2 lines each |
| `core/scene/index.ts` | **208 exports, baseline 208** | Ratcheted — may only shrink |
| `core/geometry/index.ts` | **20 = HARD CAP** | Export #21 fails `release:check` |

**This is why the Design Studio is a new module, not an extension of the workspace.**
The architecture is forced by CI, and it happens to be the right architecture anyway.

### 2.3 Verified-absent geometry (grep, not assumption)

Convex hull; Minkowski; simplification as a design op; triangulation; trim / extend /
split-at-intersection; **fillet / chamfer on design geometry** (`filletClosedCorners`
exists only at `core/cnc/adaptive-corner-fillet.ts` for toolpaths); stroke-to-path;
per-corner rectangle radius; arc **recognition** (only `io/svg/parse-path-d.ts:390` ever
creates an `elliptical-arc` — nothing in core does, so imported arcs degrade permanently
once edited); path length / area measurement for a selection; reverse-direction as a
design command.

Also absent: **any geometric snap**. `snapping.ts:168` snaps AABB min/mid/max plus a
grid. No endpoint, midpoint, centre, quadrant, intersection, tangent, perpendicular,
or angle snapping exists, and none of it is in `core/`.

### 2.4 Structural facts that shape the design

- **Booleans are closed-contour only** and **every boolean destroys canonical curves**
  (`materializeVectorObject` rebuilds `ColoredPath` without `curves`). Root cause:
  `transformCurveSubpathUniform` supports uniform scale + translate only — no rotate,
  no mirror, no non-uniform scale.
- **No general affine.** `Transform` is `{x,y,scaleX,scaleY,rotationDeg,mirrorX,mirrorY}` —
  no shear, no matrix.
- **Selection math is AABB, not OBB** — a rotated object's box is widened, and align,
  distribute, snap, array and resize all consume that widened box.
- **Groups are not geometry** — `SceneGroup` is `{id,name,objectIds}` with no transform,
  which is why rotate is single-object only.
- **Compile ignores `curves`** — nothing in `core/job/` or `core/output/` reads them.
- **Depth is per-layer** (`CncLayerSettings.depthMm`, [machine.ts:132](src/core/scene/machine.ts:132)).
  `ObjectOperationOverride` has no depth field.

### 2.5 The overlay template — Image Studio, exactly

`App.tsx:77` always renders `<ImageEditorHost />`; it returns `null` with no session, so
cold start pays nothing. The overlay chunk is `lazy(() => import(...))`. Shell is
`position:fixed; inset:0; zIndex:1010` — deliberately above `--lf-z-dialog` (1000) and
below toasts (1100) — with `role="dialog" aria-modal="true"` and a rAF-deferred
`root.focus()` to win the initial-focus race.

Session state is a **completely standalone zustand store**; nothing about tools, view,
selection or history ever enters the project store. Closing **stashes** the session and
**never prompts** (rule 7). Undo is editor-local copy-on-write **tile snapshots** with a
256 MB budget that evicts oldest and reports "N older history steps trimmed" — informs,
never blocks. **Apply is the one and only write into the project store**, producing
exactly one project undo entry.

Shortcut isolation is two independent halves: `useRegisterModal()` bumps
`ui-store.modalDepth` so **all** app shortcuts are suppressed wholesale, and the editor
binds its own keymap to the overlay root div (no window listener). Esc is a **ladder**,
not a close: cancel transform → discard crop → return to Brush → close.

**This is the template. The Design Studio copies it wholesale.**

Three.js is never statically imported: modules take `three: ThreeModule` as a parameter
and there are exactly two `await import('three')` sites. The chunk is ~704 KB and falls
out as its own dynamic chunk. Pure core produces **plain typed arrays**; three consumes
them at the UI boundary. ADR-102 §2 permits three imports only beneath
`src/ui/relief-viewer/`, `src/ui/cnc-viewer3d/`, and `src/ui/viewer3d/`.

---

## Part 3 — Architecture

### 3.1 Module layout

```
src/core/design/                  NEW pure module — fresh barrel, cap 20
  sketch.ts                       SketchEntity union + Sketch type
  sketch-bounds.ts                pure extents
  entity-geometry.ts              entity → polyline materialization
  index.ts
  snap/                           NEW sub-barrel — the object-snap engine
    snap-targets.ts               endpoint/midpoint/centre/quadrant/…
    snap-resolve.ts               nearest-target resolution with priority
    ortho.ts                      ortho + polar tracking
    index.ts
  ops/                            NEW sub-barrel — modify operations
    trim.ts  extend.ts  fillet.ts  chamfer.ts
    intersections.ts
    index.ts
src/ui/design-studio/             NEW lazy-loaded overlay, many small files
  DesignStudioHost.tsx            mounted always; returns null with no session
  DesignStudioOverlay.tsx         the shell
  DesignStudioCanvas.tsx          two stacked canvases
  CreateRail.tsx  ModifyRail.tsx  OptionsBar.tsx  Inspector.tsx  StatusBar.tsx
  design-studio-store.ts          standalone zustand — session isolation
  design-history.ts               session-local undo
  tools/…                         one file per tool, state-machine shaped
```

`src/core/design/` is a **new** barrel, so it gets the full 20-export budget and
sidesteps the frozen `core/scene` and full `core/geometry` barrels entirely.

### 3.2 Data model

Stage 1 commits ordinary `ShapeObject` with the existing `kind:'polyline'` spec —
already serialized, already compiled, already previewed. **Nothing downstream changes**,
which is the pattern that made ADR-051 and ADR-242 succeed.

Stage 3 adds a `SketchShape` arm to `ShapeSpec`
([scene-object.ts:340](src/core/scene/scene-object.ts:340)) so a sketch persists
*parametrically* through the existing serializer with **no new `SceneObject` variant and
no new barrel export** — `ShapeSpec` is already exported, and adding a union arm adds no
symbol. It costs three coordinated arms: `sanitizeParametricShapeSpec`,
`createFromSpec` ([rematerialize-shape.ts:14,81](src/core/shapes/rematerialize-shape.ts:14)),
and `validateShapeSpec` ([project-shape-validator.ts:316](src/io/project/project-shape-validator.ts:316)).
`scene-object.ts` has ~157 counted lines of headroom.

### 3.3 The window layout

Copying LightBurn's two-rail model, Figma's contextual inspector, and our own kit tokens.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Design Studio · <name>   [↶][↷]  [Snap ▾][Grid ▾][Ortho]                │
│                                          [Revert]  [Apply]  [Apply & ✕] │
├─────────────────────────────────────────────────────────────────────────┤
│ OPTIONS BAR — swaps with the active tool / selection (LightBurn model)  │
├──────┬───────────────────────────────────────────────────┬──────────────┤
│ ┌──┐ │                                                   │ INSPECTOR    │
│ │C │ │                                                   │  Position    │
│ │R │ │            CANVAS                                 │  Size        │
│ │E │ │            static layer + dynamic overlay         │  Shape       │
│ │A │ │                                                   │  Depth (2.5D)│
│ │T │ │                                                   │  Layer       │
│ │E │ │                                                   ├──────────────┤
│ ├──┤ │                                                   │  3D VIEW     │
│ │M │ │                                                   │  (lazy three)│
│ │O │ │                                                   │              │
│ │D │ │                                                   │              │
│ └──┘ │                                                   │              │
├──────┴───────────────────────────────────────────────────┴──────────────┤
│ X 124.50  Y 88.20 │ ⊙ endpoint │ 3 entities │ Shift = ortho, Alt = copy │
└─────────────────────────────────────────────────────────────────────────┘
```

**Create rail:** Select · Node · Line · Polyline · Rectangle · Circle · Arc ▸ · Polygon ·
Text · Dimension
**Modify rail:** Trim · Extend · Fillet · Chamfer · Offset · Mirror · Array ▸ · Boolean ▸

`▸` = LightBurn-style flyout (Arc: 3-point / start-end-radius / centre-start-end;
Array: grid / circular; Boolean: union / subtract / intersect / exclude).

### 3.4 How "smooth" is achieved — concretely

1. **Two canvases, two cadences.** The static layer redraws only when committed geometry
   changes. The dynamic overlay (cursor crosshair, rubber band, snap marker, live
   dimension) redraws on pointer move. This is already the `WorkspaceCanvasLayers`
   shape — we reuse the idea, not the code.
2. **rAF coalescing.** Pointer moves set state and request one frame; never more than
   one redraw per frame regardless of event rate.
3. **Tools as state machines** (tldraw's model): each tool is
   `Idle → Pointing → Dragging`, so no boolean soup and no `beginToolDrag` complexity
   cliff.
4. **Cached geometry.** Entity → polyline materialization is memoized per entity
   revision; bounds and hit geometry cached and invalidated on prop change.
5. **Snap index.** Snap targets are rebuilt only when geometry changes, and queried
   against a bucketed spatial grid — not an O(n) scan per pointer move.
6. **Culling + LOD** on the static layer once entity count crosses a threshold.

### 3.5 Rule-7 compliance

The Studio adds **no guard**. Ops that cannot produce geometry return
`Result<T, DesignOpError>` and surface a toast; nothing gates Frame, Start, preview,
save, export, or emission. Closing never prompts (Image Studio's precedent). History
eviction *informs* ("N older steps trimmed"), exactly as Image Studio does.

---

## Part 4 — Staged build order

Each stage is an individually reviewable, CI-green, shippable diff (CLAUDE.md rule 1).

| Stage | Delivers | Gate |
|---|---|---|
| **DS-0** | Governance: ADR-271, PROJECT.md phase + scope amendments, WORKFLOW.md `F-DS` flows | `check:adr-numbers` green |
| **DS-1** | `src/core/design/` sketch model + entity geometry + bounds, fully unit-tested. No UI. | tests green |
| **DS-2** | Overlay shell: Host + lazy overlay + standalone store + session-local undo + Esc ladder + modal registration. Opens, closes, stashes. Empty canvas. | renders; chunk measured |
| **DS-3** | Canvas + view transform + two-layer render + rAF coalescing + Select/Line/Rectangle/Circle tools. Typed numeric entry. | **perceptual: rendered and compared** |
| **DS-4** | Object-snap engine (`core/design/snap/`) + ortho/polar + snap markers + status readout | perceptual |
| **DS-5** | Apply → commits `ShapeObject` polylines into the scene as one undo entry. **End-to-end slice closes here** — draw, apply, cut. | sign test |
| **DS-6** | Modify ops: trim, extend, fillet, chamfer (`core/design/ops/`) | bracket test |
| **DS-7** | Dimensions: unified infer-from-selection tool, driving vs driven, dimension-driven edit | dimension-drive test |
| **DS-8** | 2.5D depth per entity + three.js extrude view in the inspector dock | 2.5D test |
| **DS-9** | `SketchShape` spec arm — parametric round-trip through `.lf2` | round-trip test |

**"End to end" is reached at DS-5.** DS-6 onward is breadth on a surface that already
works.

### 4.1 Open decisions, updated

1. **Constraint solver** — *settled by evidence*: no permissive solver exists.
   Recommendation: **skip the general solver**; ship dimension-driven editing (DS-7),
   which covers the laser/CNC cases without a nonlinear solver.
2. **Command line** — `PROJECT.md:566` lists "command palette" as out of scope.
   Recommendation: **defer**; typed numeric entry on canvas (DS-3) delivers most of the
   AutoCAD feel without the scope amendment.
3. **Separate window** — recommendation: **full-window overlay**, Image Studio parity.
   A real OS window cannot share the store and breaks the PWA target.
4. **Where depth lives** — recommendation: **per design entity**, materialized to a
   per-object override at Apply. Requires extending `ObjectOperationOverride`; ADR-271
   records it.

### 4.2 Pre-existing defects found during recon (not introduced by this work)

- A `draw` drag calls `beginInteraction` ([use-workspace-drag.ts:101](src/ui/workspace/use-workspace-drag.ts:101))
  but the draw branch returns at :352 **without `endInteraction`**, leaving `pendingUndo`
  set until the next `beginInteraction` overwrites it.
- `'draw'` is absent from `ESC_CANCELABLE_DRAG_KINDS` ([use-esc-cancels-drag.ts:14](src/ui/workspace/use-esc-cancels-drag.ts:14)),
  so Esc mid-draw clears the draft but the pointer-up path recomputes and commits the shape anyway.
- `resetToolMode` clears `toolMode`/`draftShape`/`penDraft`/`measureDraft` but **not**
  `selectionMarquee` or `snapGuides`.
- `DECISIONS.md:4590` mis-cites ADR-254 for the cnc-viewer3d amendment that is actually ADR-261.
- `PROJECT.md:535` still lists "Boolean ops" as out of scope, contradicting shipped ADR-103 G1.

Both canvas defects are **reported, not fixed** (CLAUDE.md rule 1: auditing reports,
the maintainer chooses).

---

## Part 5 — What is NOT verified

- Nothing has been rendered. No perceptual check of anything in this document.
- The Inkscape / Affinity / Illustrator research agent had not returned when this plan
  was written; its tool inventory is the most conventional of the seven and is expected
  to add breadth, not change architecture. **Flagged as a gap, not filled.**
- No hardware. No E2E. `pnpm lint`, `pnpm typecheck`, `pnpm format:check` not yet run
  against any Design Studio code, because none exists yet.
