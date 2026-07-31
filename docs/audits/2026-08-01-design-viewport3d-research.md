# Design Studio 3D viewport — research and design (DS-8b)

**Date:** 2026-08-01 · **Status:** governing research for ADR-272 Amendment 2
**Prompted by:** the maintainer rejecting the docked 3D *preview pane* shipped in
PR #542 — "I wanted an AutoCAD/Blender look where your canvas is the design
space in 3D."

## 1. What the rejection means

PR #542 kept the 2D canvas as the design surface and added a right-rail 3D
*result viewer*. The requested model is the opposite: **one viewport, and it is
three-dimensional** — the stock sits on a grid in 3D, drawing happens directly
in that space, the camera orbits freely, and the carve deepens live under the
cursor. The reference loop is Fusion 360's sketch environment, which is the
CAD-industry synthesis of the AutoCAD and Blender conventions.

## 2. Interaction spec (external research)

From Autodesk's Fusion documentation and community guidance
(autodesk.com/products/fusion-360/blog/fusion-360-sketch-environment,
help.autodesk.com GUID-88CC0E51, forums.autodesk.com td-p/9151593,
productdesignonline.com "Why Doesn't Fusion 360 Look Directly at the Sketch"):

- Starting a sketch **auto-orients the camera to look straight at the sketch
  plane** (plan view) — precise drawing wants orthogonal aim. A preference
  ("Auto Look At Sketch") controls it.
- **Orbit stays available while sketching** (Shift+Middle in Fusion); leaving
  plan view never cancels the sketch. Drawing from a three-quarter view is
  legal — the pointer still lands on the sketch plane.
- Middle-drag pans; the wheel zooms at the cursor (AutoCAD's signature feel).
- Dedicated view commands snap back to Top / Iso.

Mapped onto this Studio (left button must stay free for tools):

| Input | Action |
|---|---|
| Left drag / click | The armed tool (draw, select, move) — never the camera |
| Middle drag | Pan |
| Shift + middle drag | Orbit (OrbitControls' built-in modifier on a PAN-mapped button) |
| Right drag | Orbit |
| Wheel | Zoom to cursor |
| Top / Iso buttons | Camera presets; Studio opens in Top (Fusion's auto-look-at) |

## 3. Verified platform facts (installed three@0.180.0 tree, not memory)

- `OrbitControls.mouseButtons.LEFT` set to `-1` falls through the mouse-action
  switch to `state = NONE` (OrbitControls.js:1543-1620) — the left button is
  cleanly free for tools. Mapping MIDDLE to `MOUSE.PAN` gives pan, and the PAN
  arm's own `ctrl/meta/shiftKey` branch (OrbitControls.js:1598-1604) gives
  Shift+Middle orbit — the Fusion mapping falls out of stock OrbitControls.
- `zoomToCursor = true` is a stock property (OrbitControls.js:306, 678, 715).
- `Raycaster.setFromCamera` (Raycaster.js:118) + `Ray.intersectPlane`
  (Ray.js:397) give the pointer→sketch-plane mapping.
- Fat lines: `LineSegments2` auto-updates `LineMaterial.resolution` in
  `onBeforeRender` in r180 — do NOT set it manually (stale advice), per the
  committed r180 research (docs/audits/2026-07-25-cnc-3d-threejs-research…,
  "verify:lines" findings). `worldUnits:false` = constant CSS-pixel width.
- `Line2.raycast` is unreliable for picking (same doc) — this design never
  raycasts lines: picking projects the pointer to the plane and reuses the
  existing **mm-space** hit-test (`design-hit-test.ts`), exactly the math the
  2D canvas uses today.

## 4. Reuse map — what already exists

| Need | Existing, verified home |
|---|---|
| Camera presets Top/Front/Right/Iso (pure math) | `src/ui/viewer3d/camera-presets.ts` (`CAMERA_PRESETS`, `cameraPlacement`) |
| Grid + axis triad furniture | `src/ui/cnc-viewer3d/viewer3d-stage.ts` (`buildStageFurniture`) |
| Carved-solid drawable (update-in-place, one disposer) | `src/ui/cnc-viewer3d/viewer3d-content.ts` (`buildViewerContent`) |
| IBL lighting rig | `src/ui/relief-viewer/scene-lighting.ts` (`applySceneLighting`) |
| One-frame mapping scene↔local (ADR-261 §2) | `src/ui/cnc-viewer3d/viewer3d-picking.ts` (`pointerNdc`, `localFromScene`, `sceneFromLocal`) |
| Target surface from layers | `src/core/design-carve` (`designCarveHeightmap`) + `steppedSurfaceMesh` |
| Gesture state machine, snapping, hit-test, fields | `use-design-pointer`, `core/design/snap`, `design-hit-test` — all mm-space, view-agnostic |

The load-bearing observation: **every Studio subsystem below the view layer is
pure mm-space math.** The only 2D-specific pieces are `pxToMm`/`mmToPx`
(`design-view.ts`) and the canvas painters. Swapping the surface means swapping
the pointer→mm mapping and the renderer — nothing else.

## 5. Design

1. **Surface adapter.** `use-design-pointer` stops reading `session.view`
   directly and takes a `DesignSurface { toMm(event): Vec2 | null;
   pxPerMm(): number }`. The 2D canvas passes a wrapper over `pxToMm`; the 3D
   viewport passes plane-raycast + a projected pixels-per-mm at the camera
   target (so snap radii and hit tolerances keep their on-screen size in 3D).
2. **`src/ui/design-studio/viewport3d/`** (three.js permitted here by ADR-272
   Amendment 2): a long-lived scene — renderer, Z-up perspective camera,
   OrbitControls with the table above, lighting, stage furniture, the carved
   solid via `buildViewerContent`, render-on-demand. The sketch draws as fat
   lines floated just above the stock top, bucketed by style: per-layer color,
   selection, dashed construction, live draft, snap marker. Overlay-geometry
   building is a pure module (entities → Float32Array positions) so it tests
   without WebGL.
3. **The viewport replaces the canvas** as the Studio's centre when
   `session.surface3d` (default **true**). The 2D canvas remains behind a
   top-bar 2D/3D toggle — it is the guaranteed-precision fallback and keeps
   the dimension call-out annotations, which stay 2D-only in this stage.
4. The right rail keeps ONLY the carve-layers card. The docked preview pane is
   deleted; its Design/Bits tier chips and Simulate button move into the
   viewport's toolbar; the simulate hook is reused unchanged.
5. Camera opens in **Top** (Fusion's auto-look-at). Top/Iso buttons; drawing
   from any orbit angle works because the pointer maps to the z=0 stock plane
   regardless of camera.

Out of scope for this stage, stated honestly: dimension call-outs rendered in
3D; marquee rectangle in 3D (selection click/shift-click works; marquee stays
a 2D-canvas feature this stage); orthographic camera toggle; a view gizmo cube.

## 6. Sources

- https://www.autodesk.com/products/fusion-360/blog/fusion-360-sketch-environment/
- https://help.autodesk.com/view/fusion360/ENU/?guid=GUID-88CC0E51-AD05-4028-BF59-FACA5EC0FA2B
- https://forums.autodesk.com/t5/fusion-360-design-validate/how-to-orbit-in-sketch-mode-like-it-s-orbiting-when-out-of/td-p/9151593
- https://productdesignonline.com/tips-and-tricks/why-doesnt-fusion-360-look-directly-at-the-sketch/
- Installed sources read: `node_modules/three/examples/jsm/controls/OrbitControls.js`,
  `node_modules/three/src/math/Ray.js`, `node_modules/three/src/core/Raycaster.js`
- Committed: `docs/audits/2026-07-25-cnc-3d-threejs-research-and-roadmap.md`
