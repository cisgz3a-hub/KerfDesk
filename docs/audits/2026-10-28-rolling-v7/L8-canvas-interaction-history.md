# Rolling audit v7 — L8 Canvas interaction and history

- **When:** 2026-10-28, about 18:00–19:40 +0800.
- **Tree:** origin/main @ `548f67ecb` (#1501) at the start (`git fetch origin main`).
  - **Repros ran on the scratchpad copy `…\scratchpad\j7-main\`** (main `6e388bb56`). `git diff --stat 6e388bb56 548f67ecb` over every file imported or cited below lists only `WORKFLOW.md`, and its hunks (lines 666 and 1982 onwards) are outside F-A2, F-A14 and F-A15. The checked files are `shortcuts.ts`, `use-shortcuts.ts`, `editing-tool-shortcuts.ts`, `arrange-shortcuts.ts`, `nudge-step.ts`, `settings-shortcut.ts`, `shortcut-contexts.ts`, `use-job-shortcuts.ts`, `use-jog-shortcuts.ts`, `JogPad.tsx`, `FocusJogControls.tsx`, `arrange-shortcut-keys.ts`, `layout-commands.ts`, `editing-tools-commands.ts`, `hit-test.ts`, `hit-test-candidates.ts`, all of `src/ui/workspace/`, `store-actions.ts`, `store.ts`, `undo-stack.ts`, `ui-store.ts`, `viewport-actions.ts`, `store-save-tracking-actions.ts`, `scene-group-actions.ts`, `selection-transform-actions.ts`, `outline-measure.ts`, `core/job/layer-fill.ts` and `fill-rule.ts`, `origin-transform.ts`, `StatusBar.tsx`, `shortcut-list.ts`, `design-shortcuts.ts`, all of `src/ui/layers/` and `src/core/shapes/`, `DECISIONS.md` and ADR-410, ADR-493, ADR-499 and ADR-362. The one UI file main changed since (`selection-command-state.ts`, closed-enough contours) is not on any path exercised here.
  - **fflate alias.** As in L4, every repro used a temporary `zz-l8-vitest.config.ts`: the repo config plus an alias to `.pnpm/fflate@0.8.3/…/esm/browser.js`, with one worker.
  - **Command,** from `j7-main`, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> --config zz-l8-vitest.config.ts --silent=false --disableConsoleIntercept`.
- **Scope:**
  - **Selection and hit testing:** `core/scene/hit-test.ts`, `hit-test-candidates.ts` (Alt+click cycling), `ui/workspace/selection-marquee.ts`, group expansion (`scene-group-actions.ts`). Governing: ADR-196, WORKFLOW F-A5.
  - **View:** `view-transform.ts`, `draw-rulers.ts`, `ruler-steps.ts`, `draw-bed-chrome.ts` (grid, origin marker), `RulerCursorOverlay.tsx`, `use-canvas-bitmap-size.ts` (devicePixelRatio), `ui-store.ts` zoom and `viewport-actions.ts` (fit to selection), `StatusBar.tsx` readouts. Governing: WORKFLOW F-A2, F-A16, ADR-348, ADR-493 D1, ADR-629.
  - **Measurement:** `measure-tool.ts`, `MeasureHoverReadout.tsx`, `core/geometry/outline-measure.ts`.
  - **Keyboard shortcuts:** `ui/app/use-shortcuts.ts` and its matchers, `use-job-shortcuts.ts` (Abort), `use-jog-shortcuts.ts`, `arrange-shortcut-keys.ts`, the menu shortcut labels and `shortcut-list.ts`. Governing: WORKFLOW F-A15, ADR-051, ADR-362, ADR-410, ADR-480, ADR-493, ADR-499.
  - **History:** `store-actions.ts` (`undo`, `redo`, interactions), `undo-stack.ts` (50 steps, `HISTORY_SOURCE_BYTES`), `store-save-tracking-actions.ts` (dirty). Governing: WORKFLOW F-A14, ADR-416 Amd 2, ADR-499 D3.
  - **Accessibility basics:** the canvas element, the design tree, `use-dialog-a11y.ts`. `src/ui/a11y` holds only `button-hover-contract.test.ts`.
- **Lenses run:**
  - **L2 ground truth:** LightBurn's own shortcut tables, all fetched 2026-10-28:
    - the *LightBurn 2.0 Windows Hotkey Cheatsheet*, "Rev 2.0 - November 13 2025", at the versioned path `https://docs.lightburnsoftware.com/2.1/download/LightBurnWindowsHotkeysV2.0.pdf`, SHA-256 `b47b95bf99b1c5e62ddbefe5f797b1ac6d9ac074966a6eb29685f57a949c5333` (the `/2.0/download/` copy is byte-identical);
    - `https://docs.lightburnsoftware.com/1.7/Reference/TransformControls/` and `/2.1/Reference/TransformControls/` (rotate keys, nudge distances);
    - `https://docs.lightburnsoftware.com/1.7/Reference/UI/ArrangeMenu/` (flip, group, mirror, two-point rotate);
    - `https://docs.lightburnsoftware.com/1.7/Reference/Distribute/` (Move H / V Together);
    - `https://docs.lightburnsoftware.com/1.7/Reference/Align/` (Alt+PgUp / Alt+PgDn);
    - `https://docs.lightburnsoftware.com/1.7/Reference/UI/EditMenu/` (edit keys).
    Analytic geometry for hit tests and measurements.
  - **L3 twins:** ruler ticks against grid lines and artwork; the DOM ruler mark against the canvas ticks; the hit test against the canvas fill rule; the origin marker against WORKFLOW F-A2; the main canvas's Redo key against Design Studio's.
  - **L9 entry-point parity:** each LightBurn key pressed into KerfDesk's real window listeners (`useShortcuts`, the capture-phase Abort and the keyboard jog) against the store action the matching KerfDesk menu command runs.
  - **L7 test truth:** spot checks of the tests that pin each reported behaviour.
  - **Skipped:** canvas pixel output in a real browser, real devicePixelRatio rendering, screen-reader runs, and the per-operation Undo of booleans, shapes, text, transforms, nodes and Design Studio (L1–L6 own those; cited below).
- **Repros:** seven temporary files, listed with their purpose under "Repro files" at the end.
- **Counts:** 17 raised → 0 refuted → P1 1 / P2 4 / P3 12 (+ 7 KNOWN re-observed).
  - L8-P1-1 is the canvas-against-burn twin that the L7 refuter flagged and did not count (L7 report, L7-P1-1 Canvas note). The coordinator passed it to L8, and it was re-run here.
  - **Refuter (2026-10-28, fresh context):** all 17 CONFIRMED, none refuted. Three severities lowered, P2 → P3: L8-P2-2 (Ctrl+. is KerfDesk's decided, documented Abort), L8-P2-6 (the marker sits on the zero every readout counts from) and L8-P2-7 (a dead Shift chord; the same physical key zooms). L8-P1-1 is kept at P1 and extended: Duplicate (Ctrl+D) or Paste in Place on a Fill operation makes the part burn nothing while the canvas shows it solid.
  - **Refuter tree check:** `git diff --stat 6e388bb56 origin/main` (`353b82b09`, after #1501 and #1502) over the cited files. #1502 changed `hit-test.ts` (only `transformedBBox`, now the outline extent), `store-actions.ts` (only `applyTransformsToScene`) and `pen-tool.ts`. #1501 changed the offset files and ADR-410 Amd 3, which is about offsets only. No cited line changed. The one open PR (#1478) touches none of these files.

## Headline

**The coordinate pipeline and the history are exact.**

- **Coordinates.** Every ruler label sits on its true coordinate to within 2e-12 px. This holds at zoom 0.1, 1 and 16 (16 is `MAX_ZOOM`; 20× clamps to 16), in mm and in inches, on an integer canvas and on a 1001 × 667 canvas.
  - The pointer maps back to the displayed point to within 7e-13 mm when the CSS box is fractional, as at devicePixelRatio 1.25, 1.5 and 2. The bitmap stays at the rounded CSS size.
  - Zoom at the cursor keeps the point under the pointer to within 3e-13 mm over 80 wheel notches.
  - The only offset is a constant half pixel on the ruler ticks and ruler mark (L8-P3-1).
- **History.** Of 69 store commands swept, 49 design edits each made exactly one Undo step. Undo returned the identical `Project` object and Redo the identical post-command object.
  - The 14 selection and view commands made no step and left the project clean.
  - The 50-step cap holds.
  - Undo during a running job refuses a machine step and allows a design step, as F-A14 says.
  - A no-op operation edit still makes an empty step (L8-P3-4, class of 08-P3-6).

**One canvas twin is wrong where it matters for the burn.**

- **L8-P1-1.** Separate shapes on one Fill operation are painted one by one in the same ink, so the canvas shows a solid plate. The burn combines them even-odd and leaves the inner shape as a hole: a 40 × 30 plate with a separate Ø16 circle shows solid and burns a 999.7 mm² ring. No warning reaches the operator; Preview and Wireframe only show it if opened.
  - *Refuter extension:* Duplicate (Ctrl+D) or Paste in Place on a Fill operation leaves an exact copy. The two copies cancel, so the part burns nothing: 12,000 mm of hatch becomes 0. The canvas still paints it solid, and Job Review stays silent whenever other output remains. LightBurn's docs say such duplicates "appear unfilled" in its workspace, and that it warns before Preview or engraving.

**The other faults are in keyboard parity with LightBurn, one hit-test twin and the origin marker.** *Refuter:* P2-2, P2-6 and P2-7 are lowered to P3 (see each finding).

- **L8-P2-1.** LightBurn's Flip Vertical key, **Ctrl+Shift+V**, is KerfDesk's Paste in Place. With anything on the clipboard it stacks an invisible copy exactly on the copied artwork, so the job burns it twice. LightBurn's Flip Horizontal (Ctrl+Shift+H) and Paste in Place (Alt+V) do nothing.
- **L8-P2-2.** LightBurn's rotate keys:
  - **Ctrl+.** (15° clockwise) is KerfDesk's Abort and **aborts a running job**;
  - **Ctrl+,** (15° counter-clockwise) opens Settings;
  - Shift+. and Shift+, (45°) and Ctrl+Shift+. and Ctrl+Shift+, (1.5°) do nothing.
- **L8-P2-3.** LightBurn's draw-order keys **PgUp / PgDn jog the machine's Z axis** in KerfDesk: on every connected CNC, and on a laser with a confirmed Z. KerfDesk has the same draw-order commands, with no key.
- **L8-P2-4.** LightBurn's **Alt+Shift+H / Alt+Shift+V** (Move H / V Together) run Distribute spacing instead. KerfDesk has Move H / V Together, with no key. ADR-499 D5 says "LightBurn has none".
- **L8-P2-5.** A **Fill-mode shape with a hole** is a solid target over its hole. Artwork the canvas shows through the hole cannot be clicked, even on its own outline; only Alt+click reaches it.
- **L8-P2-6.** The canvas **origin marker** is drawn at the top-left (rear-left) corner for every machine origin. WORKFLOW F-A2 puts it at the device-profile origin (front-left by default).
- **L8-P2-7.** The advertised **`+`** zoom-in key does nothing when typed with Shift, as on a US keyboard.

## Coordinate truth

Bed 400 × 400 mm, pan (37.3, −12.9) mm. `zz-l8-coords.test.ts`.

| Canvas (bitmap px) | Zoom | Unit | px per mm | Labels checked | Worst label error | Tick drawn minus true position |
|---|---|---|---|---|---|---|
| 1200 × 800 | 0.1 | mm / in | 0.185 | 12 / 12 | 1.7e-13 px | +0.500 px = 2.70 mm |
| 1200 × 800 | 1 | mm / in | 1.85 | 12 / 12 | 1.7e-13 px | +0.500 px = 0.270 mm |
| 1200 × 800 | 16 (max) | mm / in | 29.6 | 8 / 16 | 2.0e-12 px | +0.500 px = 0.017 mm |
| 1001 × 667 | 0.1 | mm / in | 0.152 | 12 / 12 | 5.5e-14 px | +0.500 px = 3.29 mm |
| 1001 × 667 | 1 | mm / in | 1.52 | 13 / 12 | 6.9e-14 px | +0.500 px = 0.330 mm |
| 1001 × 667 | 16 (max) | mm / in | 24.3 | 8 / 8 | 5.5e-13 px | +0.500 px = 0.021 mm |

Grid lines land exactly on their multiples: the first 10 mm line is at 248.500 px, which equals offsetX + 10 × scale. `drawGrid` adds no half pixel, so the grid and the ruler ticks disagree by 0.5 px (L8-P3-1).

| Fractional CSS box (devicePixelRatio layouts) | Bitmap | Zoom | Pointer → scene error | DOM ruler mark vs canvas tick |
|---|---|---|---|---|
| 1001.3333 | 1001 | 0.1 / 1 / 16 | 3.4e-13 / 8.0e-14 / 0 mm | 0.18 / 0.27 / 0 CSS px |
| 1000.5 | 1001 | 0.1 / 1 / 16 | 6.8e-13 / 2.8e-14 / 0 mm | 0.27 / 0.40 / 0 CSS px |
| 1199.6 | 1200 | 0.1 / 1 / 16 | 4.3e-13 / 8.0e-14 / 0 mm | 0.21 / 0.32 / 0 CSS px |
| 800.25 | 800 | 0.1 / 1 / 16 | 6.5e-13 / 2.8e-14 / 0 mm | 0.13 / 0.20 / 0 CSS px |

(At zoom 16 the sampled points fall off-canvas, so there is no drift to measure.)

| Machine origin | Origin marker drawn at (scene) | Machine coordinates under the marker | Scene point of machine (0, 0) | Status bar at machine (0, 0), mm / in |
|---|---|---|---|---|
| front-left (default) | (0, 0), top-left | (0, 400) | (0, 400), bottom-left | `X 0.0, Y 400.0 mm` / `X 0.000, Y 15.748 in` |
| rear-right | (0, 0), top-left | (400, 0) | (400, 0), top-right | `X 400.0, Y 0.0 mm` / `X 15.748, Y 0.000 in` |
| rear-left | (0, 0) | (0, 0) | (0, 0) | `X 0.0, Y 0.0 mm` |
| center | (0, 0) | (−200, 200) | (200, 200) | `X 200.0, Y 200.0 mm` |

- **The readouts count in the Canvas frame for every origin.** This covers the rulers, the status-bar cursor and selection X/Y, the hover size and the Numeric Edits X/Y. That frame is decided: ADR-493 decision 1 says "**Canvas** is the scene millimetres the rulers and the X/Y boxes show". The canvas places artwork where an Absolute job burns it, so nothing is placed wrongly, and it is not raised (see Refuted).
- **User Origin** does not change any of these readouts. The From origin frame exists only in Move to position (ADR-493 D1).
- **The origin marker** is the one item a contract places elsewhere (L8-P2-6).

## Shortcut parity (LightBurn → KerfDesk)

Each key was dispatched to `document.body` with KerfDesk's real window listeners installed:

- `useShortcuts`;
- the capture-phase `installAbortShortcut`;
- `installJogShortcuts` with the Z keys enabled.

The fixture holds rectangles a, b and c, with a selected. "Consumed" means `preventDefault` was called. `zz-l8-shortcuts.test.tsx`.

LightBurn sources:

- **W:** the Windows cheatsheet Rev 2.0.
- **TC:** TransformControls, 1.7 and 2.1.
- **AM:** the 1.7 Arrange menu.
- **D:** the 1.7 Distribute page.
- **A:** the 1.7 Align page.
- **EM:** the 1.7 Edit menu.

| Key | LightBurn default | KerfDesk, observed | Verdict |
|---|---|---|---|
| Ctrl+Z, Ctrl+Shift+Z | Undo, Redo (W, EM) | same | parity |
| Ctrl+A, Ctrl+Shift+I | Select all, Invert (W, EM) | same (selection b, c) | parity |
| Ctrl+X / C / V | Cut / Copy / Paste (W, EM) | same | parity |
| Ctrl+D | Duplicate (W, EM) | copy in place, 1 step | parity |
| Delete, Backspace | Delete (W) | same, 1 step | parity |
| Ctrl+G, Ctrl+U | Group, Ungroup (W, AM) | same (Ctrl+Shift+G also ungroups) | parity |
| `.` `,` | Rotate 90° CW / CCW (TC, AM) | same (r90, r270) | parity |
| Alt+arrows | Align edges (W) | same | parity |
| Alt+PgUp, Alt+PgDn | Align vertical / horizontal centres (A) | same (a moves to x 50) | parity |
| Alt+M, Alt+T, Alt+D, Alt+C | Measure, Trace, Delete duplicates, Capture camera (W) | same | parity |
| Ctrl+R / E / L, Ctrl+Shift+B | Rectangle / Ellipse / Line, Convert to bitmap (W) | same | parity |
| Esc, F12 | Exit tool, Toggle side panels (W) | Select tool and deselect; same | parity |
| Ctrl+Shift+[ ] / Ctrl+Alt+[ ] | Jog (W) | same (ADR-493; not re-run) | parity |
| Alt+P | Preview (W) | Preview (View keys ignore Alt) | parity by accident |
| **Ctrl+Shift+V** | **Flip vertical** (W, AM) | **Paste in Place: a copy at a's exact spot, 1 step**; with an empty clipboard, consumed and nothing | **L8-P2-1** |
| **Ctrl+Shift+H** | **Flip horizontal** (W, AM) | nothing, not consumed | **L8-P2-1** |
| **Alt+V** | **Paste in place** (W) | nothing | **L8-P2-1** |
| **Ctrl+.** | **Rotate 15° CW** (TC) | job running: **Abort** (`stopJob` called); idle: nothing | **L8-P2-2** |
| **Ctrl+,** | **Rotate 15° CCW** (TC) | opens Settings | **L8-P2-2** |
| Shift+. / Shift+, | Rotate 45° (TC) | nothing | L8-P2-2 |
| Ctrl+Shift+. / , | Rotate 1.5° (2.1 TC; 5° in 1.7) | nothing | L8-P2-2 |
| **PgUp / PgDn** | **Push forward / backward in draw order** (W) | **jog Z +1 / −1 step** (`onFocusJog(1)`, `(-1)`) | **L8-P2-3** |
| Ctrl+PgUp / Ctrl+PgDn | Push to front / back (W) | nothing (a browser switches tabs) | L8-P2-3 |
| **Alt+Shift+H / V** | **Move H / V-Together** (W, D) | **Distribute spacing**: b 50 → 65, against Move Together's a 80, b 100 | **L8-P2-4** |
| `+` typed with Shift | (KerfDesk F-A15: zoom in) | nothing, not consumed; `=` and numpad `+` zoom | **L8-P2-7** |
| Arrows / Shift / Ctrl / Ctrl+Shift | 5 / 20 / 1 / 0.1 mm (TC, defaults) | 1 / 10 / 0.1 mm / nothing | L8-P3-7 |
| Ctrl+0 / Ctrl+= / Ctrl+- | Zoom to page / in / out (W) | nothing, not consumed (KerfDesk: F, 0, =, -) | L8-P3-8 |
| Ctrl+Shift+A | Frame selection (W) | nothing (KerfDesk: Shift+F) | L8-P3-8 |
| Alt+Shift+W | Wireframe (W) | nothing (KerfDesk: Alt+W) | L8-P3-8 |
| Ctrl+T, Ctrl+W, Ctrl+B | Text, Weld, Boolean assistant (W) | nothing, not consumed | L8-P3-8 |
| Alt++, Alt+-, Alt+* | Union, Subtract, Intersect (W) | nothing; **Alt+- zooms out**; nothing | L8-P3-8 |
| Ctrl+K | Trim shapes (W) | opens Find a command (ADR-604) | L8-P3-8 |
| Alt+Shift+C, Alt+B, Ctrl+\`, Ctrl+Tab, Alt+O, Ctrl+Shift+C, Alt+J, Alt+Shift+O, Alt+I | Cut shapes, Break apart, Node edit, Add tabs, Offset, Convert to path, Auto-join, Optimize, Adjust image (W) | nothing | L8-P3-8 |
| Ctrl+Shift+M, Ctrl+2, Alt+Home | Mirror across line, Two-point rotate (AM), Align centres (W) | nothing | L8-P3-8 |
| Alt+0, Alt+F | Print and Cut wizard (W); Windows File menu | fit to bed (View keys ignore Alt) | L8-P3-8 |
| Alt+X, Alt+Shift+L, Ctrl+P, Ctrl+Q | Export, Save G-code, Print, Exit (W) | nothing | L8-P3-8 |
| Alt+L, Alt+R, Ctrl+H, Alt+S | Position laser, Frame, Home, Start (W) | nothing (KerfDesk Start is Ctrl+Enter) | noted |
| Tab / Shift+Tab | Cycle objects (W) | browser focus | not raised (ADR-196 declined it) |
| Ctrl+Y | (not a LightBurn key) | nothing on the canvas; **Redo in Design Studio** | L8-P3-9 |

## History sweep

Each command was run on one fixture: rectangles a and b (overlapping), ellipse e, an open line ln and a photo. Then Undo × steps and Redo × steps were run, and the project was compared by identity and by `JSON.stringify`. `zz-l8-history.test.ts`, 4/4.

| Group | Commands | Result |
|---|---|---|
| Selection and view (expect 0 steps, clean) | selectObject, toggleSelectObject, selectAllObjects, selectObjects, invertSelection, selectOpenShapes, selectObjectsOnLayer, selectContainedShapes, selectSmallerShapes, setCursorMm, togglePreview, fitToSelection, copySelection, a click with no drag (begin/end interaction) | 14/14: 0 steps, unchanged, clean |
| Selection with Cut Selected Graphics on | selectObject | project's job setup rewritten, dirty, no step: by design (see Refuted) |
| Transforms | nudge, flip, quarter turn, rotate 30°, shear (line), align, distribute, move together, match size, move to bed, numeric transforms, applyObjectTransform, drag (begin/set/end) | 13/13: 1 step, Undo and Redo identical (identity and value) |
| Edit, clipboard, groups, lock, order | duplicate, delete, cut, paste, paste in place, group, ungroup, lock, unlock all, bring to front, rename artwork | 11/11: 1 step, exact |
| Operations and layers | assign to operation, setLayerParam power / visible, moveLayer, createManualLayer, setLayerColor, renameOperation, deleteLayerAndObjects, pasteLayerSettings, all visible (invert), show only, add operation, power scale, override | 13/13: 1 step, exact |
| No-op operation edits | setLayerParam with unchanged values (visible true, power 30), setLayerParam on an unknown id | **1 empty step each, dirty** (L8-P3-4) |
| No-op elsewhere | moveLayer on the last operation | 0 steps, clean (correct) |
| Paths, booleans, images, shapes, machine | convert to path, subtract, offset 2, close paths, reverse, delete duplicates, image adjustments, setShapeSpec, updateDeviceProfile (bed), guide pull | 10/10: 1 step, exact |
| Async | weldSelection | 0 steps synchronously; background command (L1 owns weld) |
| Dirty flag | save → repeat Move to bed centre | unchanged value, dirty, empty step (KNOWN 08-P3-6) |
| | save → Align left on one object | clean, no step (correct) |
| | save → visible = true on a visible operation | dirty, empty step (L8-P3-4) |
| | save → nudge → Undo | identical saved object, **still dirty**; Redo then Undo, still dirty (L8-P3-5) |
| Caps | 60 nudges | depth 50 (`HISTORY_DEPTH`) |
| | byte budget | ignores a photo's own `dataUrl` (L8-P3-6) |
| Running job | Undo of a bed-size step | refused, depth 2 → 2 (F-A14) |
| | Undo of a nudge | applied, a.x 15 → 10 (F-A14) |
| Design Studio entry and exit | READ | no main-store write except Apply (`use-design-apply.ts:31-57`); the Studio overlay registers a modal (`DesignStudioOverlay.tsx:52`), so main shortcuts stand down. Studio history is L5's. |

## Findings

### L8-P1-1 — Separate shapes on one Fill operation: the canvas paints a solid plate where the burn leaves the inner shape as a hole

- **Where:**
  - `src/ui/workspace/object-display.ts:149-160,209-217,228-240`: `paintObjectDisplay` fills each path of each object with its own `fill()`. Every Fill path uses the same colour, which at rest is the canvas ink (ADR-620 item 1), and its own rule (`evenodd`, or `nonzero` for text).
  - `src/ui/workspace/draw-vector-strokes.ts:28-44`: `fillClosedPolylinesBatched` fills one object's polylines in one call. Objects never share a fill.
  - **The burn:** `src/core/job/fill-rule.ts:5-13` returns `'evenodd'` for the pooled operation. Per L7, each object is resolved first (`layer-fill.ts:230-233`) and the operation's objects are then hatched together even-odd (`layer-fill.ts:248`).
- **Anchor:**
  - **Twin.** The design canvas against the compiled Fill.
  - **Contract.** ADR-486 Amendment 2: "paths are unioned within one object, then material is combined with even-odd parity across objects." ADR-410 Context (View style): "Filled draws Fill-mode shapes solid", meaning the design view is the filled picture of what burns.
  - **Ground truth.** LightBurn 1.7 Fill Mode (`https://docs.lightburnsoftware.com/1.7/Reference/CutSettingsEditor/FillMode/`) treats a shape inside another on the same layer as a hole: "the area between the two outlines will be filled". This was fetched by the L7 refuter on 2026-10-28; the auditor's own fetch timed out.
- **Scenario:** a common two-object design.
  - The operator draws a 40 × 30 plate and a separate Ø16 circle inside it and assigns the circle to the plate's Fill operation. A plate with an engraved name on the same operation works the same way.
  - The canvas shows one solid block: two same-ink fills, one on top of the other.
  - The job burns a ring, leaving the circle unburned, or knocks the letters out of the plate.
  - Nothing on the canvas, in the status bar or in Start's review names the difference. Preview shows it, and Wireframe shows both outlines, only if the operator opens them. Under METHOD §3 (2026-10-27) that is not a warning.
- **Evidence:** REPRO, `zz-l8-fill-canvas.test.ts`. The real store builds the design (`drawShape` × 2, `assignSelectionToLayer`, `setLayerParam` Fill at 0.1 mm). The burn is the compiler's `collectFillSegmentsForLayer`; the canvas is `drawScene` with a recording context:
  ```text
  FILLCANVAS layers [["operation-plate","fill"]] objects [["plate",["#000000"]],["circle",["#000000"]]]
  FILLCANVAS burn: hatch segments 459, hatched area ~ 999.7 mm2 (solid plate 1200, ring 998.9); hatch line through the circle centre: 0
  FILLCANVAS canvas fill() calls: 2 -> [{"args":["evenodd"],"style":"#1a1a1a"},{"args":["evenodd"],"style":"#1a1a1a"}]
  ```
  This is independent of the L7 refuter's `zz-l7-canvas.test.ts`, which saw the same two fills.
- **Severity:** P1. What the app shows differs from what burns, with no warning (AREAS P1, METHOD §3). The burn follows ADR-486 Amd 2 and LightBurn; the canvas is the twin that is wrong.
- **Novelty:** flagged but not raised in L7 (L7-P1-1, the refuter's Canvas note). L7-P1-1 itself is the SVG/PDF export losing the hole. No open PR touches `object-display.ts` or `draw-vector-strokes.ts` (`gh pr list`).
- **Refuter:** CONFIRMED, P1 kept, scope extended. Checked as follows:
  - **Both sides, own repro** (`zz-l8r-fill-canvas.test.ts`, real store, `emitGcode` and `drawScene`). The steps were `drawShape` plate 40 × 30 and circle Ø16, `assignSelectionToLayer(plate op)`, then `setLayerParam` Fill at 0.1 mm.
    - **Burn:** lit length 9997.2 mm, about 999.7 mm² (ring 998.9), with **0 lit lines through the circle centre**. Preflight `[]`.
    - **Canvas:** two `fill('evenodd')` calls in `artworkInk`. An even-odd point test of each recorded fill finds **ink at the circle centre**.
    - The result is the same with the circle in the plate's colour.
  - **What would make it false.**
    - A warning: none. Preflight is empty. `stackedCopyWarnings` keys only raster and traced images (`stacked-copy-warnings.ts:64-77`), and the only Fill check in Job Review is about open contours (`ShowOmittedFillArtworkButton.tsx`).
    - A decision that the design view need not pool: none. ADR-410 Context only records LightBurn's "Filled draws Fill-mode shapes solid". KerfDesk's own Convert to Bitmap renders "even-odd across objects — a shape nested inside another object's shape becomes a hole" (WORKFLOW, Convert to Bitmap, main). So the canvas is the one twin that does not pool.
    - Coverage by a merged or open fix: none. #1501 / ADR-410 Amd 3 changes offsets only, and its diff does not touch `object-display.ts` or `draw-vector-strokes.ts`. The L7-P1-1 fix direction names "paint the canvas per operation the same way", but L7 did not count this finding. Unless the "Design export keeps holes, colours and pasted tabs" card explicitly carries the canvas, this needs its own card.
  - **Lowering argument considered and rejected.**
    - *The argument:* the burn is right by ADR-486 Amd 2 and LightBurn 1.7 Fill Mode, and L5-P2-1 (canvas wrong, burn right) stayed at P2.
    - *Why it does not hold here:*
      - In L5-P2-1 the Studio shows the true shape, and a missing closing edge reads as a glitch. Here no default view shows the hole, and the solid plate looks complete.
      - LightBurn's own workspace does pool. LightBurn 2.0, *Vector Artwork Imports With Extra Lines* (`https://docs.lightburnsoftware.com/2.0/Troubleshooting/ImportedExtraLines/`, fetched 2026-10-28) says stacked duplicates "can cause closed shapes set to Fill Mode to appear unfilled". Its *Missing Shapes* page (`/2.0/Troubleshooting/PreviewWindow/MissingShapes/`) says "you will see a warning message" before Preview or engraving them.
      - The round's rule applies: the canvas is not a warning, and the burn differs from what the app shows.
    - How LightBurn draws a *non-identical* nested shape in Filled view is still undocumented (UNVERIFIED).
  - **Extension, a more everyday route.** Duplicate (Ctrl+D, "Duplicate selection in place (LightBurn parity)", F-A15) or Paste in Place on a Fill operation leaves an exact copy. The two copies cancel under the pooled even-odd fill.
    - A 40 × 30 Fill plate burns **12,000 mm of hatch, then 0 mm** after one Ctrl+D (`duplicateSelection`).
    - A Line operation elsewhere in the job still burns its 80 mm, so preflight is `[]`. The Job Review intent warnings hold only the uncalibrated-defaults notice.
    - The canvas paints two solid ink fills.
    - Only a job with nothing else to burn gets `empty-output`.
    - LightBurn: "they will negate each other, and neither will output" (Missing Shapes), and it warns first.
    - The CNC twin of this cancellation was M7-P2-2 and is fixed by ADR-359 Amd 3 (exact copies cut once). Laser Fill has no such merge and no warning.
  - **Severity:** P1 under AREAS ("silently drops ... shapes or holes, so the burn is wrong with no warning", and "differs ... from what the app shows").
- **Fix direction:**
  - Paint each Fill operation's objects as one path, built as the compiler builds it: each object resolved by its own rule (`nonzero` for text), then the operation's objects combined with one `evenodd` fill.
  - *(Refuter)* For exact stacked copies on a laser Fill operation, either warn as LightBurn does or merge them as ADR-359 Amd 3 does for CNC. Extend `stackedCopyWarnings` to vectors on laser.
  - Keep different operations in separate fills so they do not cancel each other.
  - Pin it with a `drawScene` test of a plate and an inner shape on one Fill operation.

### L8-P2-1 — LightBurn's Flip Vertical key Ctrl+Shift+V is KerfDesk's Paste in Place: it stacks a hidden copy on the copied artwork. Ctrl+Shift+H (Flip Horizontal) and Alt+V (LightBurn's Paste in Place) do nothing

- **Where:**
  - `src/ui/app/editing-tool-shortcuts.ts:52-56` maps Ctrl/Cmd+Shift+V to `pasteClipboardInPlace`.
  - `src/ui/commands/editing-tools-commands.ts:10` sets `PASTE_IN_PLACE_SHORTCUT = 'Ctrl+Shift+V'`.
  - Flips are bare `H` / `V` only. `handleTransformShortcut` returns before `tryFlip` when Ctrl/Cmd is held (`src/ui/app/shortcuts.ts:434-446`), so Ctrl+Shift+H matches nothing in any listener.
  - Nothing binds Alt+V.
- **Anchor:**
  - **Ground truth.** LightBurn 1.7 Arrange menu (`/1.7/Reference/UI/ArrangeMenu/`): Flip Horizontal "Shift + Ctrl / Cmd + H", Flip Vertical "Shift + Ctrl / Cmd + V". The Windows cheatsheet Rev 2.0 has the same rows ("Flip vertical — Ctrl Shift V") and "Paste in place — Alt V".
  - **Contract.** ADR-410 decision 4: "LightBurn lists no shortcut; this chord is the Illustrator and Figma one and was free." That is true of LightBurn's 1.7 Edit menu page, but the chord is LightBurn's Flip Vertical. Project direction is LightBurn parity (ADR-410 builds the LightBurn gap list).
- **Scenario:** A LightBurn user copies a part (Ctrl+C), selects artwork and presses Ctrl+Shift+V to flip it.
  - Nothing flips.
  - A copy appears exactly on top of the part copied, the selection moves to it, and the Undo list gains "Paste in Place".
  - The canvas looks unchanged. The status bar's Objects count rises by one, and the job cuts or engraves that part twice.
  - Ctrl+Shift+H does nothing and is not consumed. Alt+V does nothing.
- **Evidence:** REPRO, `zz-l8-shortcuts.test.tsx`:
  ```text
  KEY Ctrl+Shift+V (clipboard holds a) | LB: Flip vertical | prevented=true | objs: 3[a@10.00,10.00;…] -> 4[a@10.00,10.00;…;d981d4@10.00,10.00] | undo: 0 -> 1 | dirty: false -> true | sel: a -> d981d4
  KEY Ctrl+Shift+V | LB: Flip vertical | prevented=true | NO CHANGE
  KEY Ctrl+Shift+H | LB: Flip horizontal | prevented=false | NO CHANGE
  KEY Alt+V (clipboard holds a) | LB: Paste in place | prevented=false | NO CHANGE
  CMP flipSelection(vertical) "3[a@10.00,30.00;…]"
  ```
  - **L7:** `editing-tool-shortcuts.test.ts` pins Ctrl+Shift+V to Paste in Place.
- **Severity:** P2. A conflicting shortcut with a hidden result. The duplicate is visible only as a count and an Undo entry.
- **Novelty:** new. No audit names these keys. The 2026-09-26 LightBurn gap audit lists only jog keys and a hotkey editor (LBG-M07, LBG-F15).
- **Refuter:** CONFIRMED, P2 kept. Checked as follows:
  - **Repro** (`zz-l8r-keys.test.tsx`, real `useShortcuts` on `document.body`, three Line rectangles):
    - Ctrl+C then Ctrl+Shift+V: `prevented=true`. Objects go from 3 to 4, the copy sits at a's exact 10,10, the Undo stack goes 3 → 4 and the selection moves to the copy.
    - **Compiled lit length 240.0 → 320.0 mm**, so a's 80 mm outline burns twice.
    - Preflight `[]`. `detectJobIntentWarnings` has no stack warning, because `stackedCopyWarnings` skips vectors.
    - Ctrl+Shift+H and Alt+V are not consumed and change nothing. Bare `V` flips (a → y 30, mirrorY).
  - **On a Fill operation** the same paste makes the part burn **nothing** (12,000 → 0 mm), not twice. That consequence is counted under L8-P1-1's extension.
  - **Ground truth re-fetched.** The LightBurn 1.7 Arrange menu lists Flip Vertical as "Shift + Ctrl / Cmd + V" and Flip Horizontal as "Shift + Ctrl / Cmd + H". The 1.7 Edit menu lists no key for Paste in Place. The Windows cheatsheet Rev 2.0 (SHA-256 `b47b95bf…5333`, re-downloaded, identical) lists "Paste in place Alt V" and "Flip vertical Ctrl Shift V".
  - **KerfDesk's own documentation.** WORKFLOW F-A15 Edit: "`Cmd/Ctrl+Shift+V` — Paste in Place … (ADR-410)". ADR-410 D4 says "LightBurn lists no shortcut; this chord is the Illustrator and Figma one and was free". That rests on the Edit menu page only. The chord was not free: LightBurn's Arrange menu, at the same docs version, uses it. So the binding is documented, but its stated premise is wrong.
  - **Why not P1.** The key runs a documented KerfDesk command that LightBurn also has, with the same stacking result. The copy is named in the Undo list, counted in the status bar and listed in the Artwork panel, and the expected flip visibly does not happen. The canvas and the burn agree on two Line objects.
  - **Why not P3.** A LightBurn user's ordinary flip chord silently adds output, with no stack warning for vectors.
- **Fix direction:**
  - Bind Ctrl/Cmd+Shift+H and Ctrl/Cmd+Shift+V to Flip Horizontal / Vertical, and Alt+V to Paste in Place, as LightBurn does.
  - Or record the deliberate difference in an ADR amendment to ADR-410 and show it in the shortcut list.

### L8-P2-2 — LightBurn's rotate keys: Ctrl+. (15° clockwise) aborts a running job, Ctrl+, (15° counter-clockwise) opens Settings, and the 45° and 1.5° keys do nothing (refuter: P3)

- **Where:**
  - `src/ui/laser/use-job-shortcuts.ts:42` (`e.key !== '.'`) and `:95`: with an active job, Ctrl+. runs `stopJob()`. The listener is capture-phase and ignores every gate, as PROJECT.md non-negotiable 9 requires.
  - `src/ui/app/settings-shortcut.ts:9`: Ctrl+, opens Settings.
  - `editing-tool-shortcuts.ts` `tryRotate` reads only bare `.` and `,`. With Shift, `e.key` is `>` or `<`, so nothing matches.
- **Anchor:** **Ground truth.** LightBurn TransformControls, both versioned pages:
  - "Rotate 15° clockwise" | "Ctrl+." and "Rotate 15° counterclockwise" | "Ctrl+,";
  - "Rotate 45° clockwise" | "Shift+.";
  - "Rotate 1.5° clockwise" | "Ctrl+Shift+." (2.1; 1.7 lists 5° for this chord).
  - WORKFLOW F-A15 (lines 1868, 1910) assigns Ctrl+, to Settings and Ctrl+. to Abort. No ADR records the collision with LightBurn's rotate keys (ADR-410 discusses only bare `.` vs Abort).
- **Scenario:** During a burn, the operator lays out the next sheet and presses Ctrl+. to turn a part 15°, as in LightBurn. The running job aborts. Idle, the same key does nothing, and Ctrl+, opens Settings.
- **Evidence:** REPRO, `zz-l8-shortcuts.test.tsx`:
  ```text
  KEY Ctrl+. (job running) | LB: Rotate 15 CW | prevented=true | abort: 0 -> 1
  KEY Ctrl+. (no job) | LB: Rotate 15 CW | prevented=false | NO CHANGE
  KEY Ctrl+, | LB: Rotate 15 CCW | prevented=true | settings: false -> true
  KEY Shift+. | LB: Rotate 45 CW | prevented=false | NO CHANGE
  KEY Ctrl+Shift+. | LB: Rotate 1.5 CW | prevented=false | NO CHANGE
  ```
- **Severity:** P2. A conflicting shortcut. The abort is visible and safe, but it ends the burn.
- **Novelty:** new. 27-P2-1 was about Ctrl+. *reaching* Abort, and that is fixed.
- **Refuter:** CONFIRMED, **lowered P2 → P3**. Checked as follows:
  - **Repro** (`zz-l8r-keys.test.tsx`, real `installAbortShortcut` plus `useShortcuts`):
    - Ctrl+. with a streaming job: `prevented=true`, `stopJob` called once.
    - Idle: not consumed.
    - Ctrl+,: Settings `open: false → true`.
    - Shift+. and Ctrl+Shift+.: not consumed, rotation 0. Bare `.`: 90°.
  - **LightBurn re-fetched.** The 1.7 and 2.1 TransformControls pages give Ctrl+. and Ctrl+, as 15°, Shift+. and Shift+, as 45°, and Ctrl+Shift+. and Ctrl+Shift+, as 5° (1.7) or 1.5° (2.1).
  - **Why lower.**
    - Ctrl+. is KerfDesk's decided, documented Abort. WORKFLOW F-A15 Phase B+ says "`Cmd/Ctrl+.` — Request the controller-specific software Abort". ADR-362 item 2 makes it abort Home, Probe and Auto-focus too.
    - ADR-410 D1 chose it knowingly: it cites LightBurn's TransformControls page in its Context and says "Abort is `Ctrl/Cmd+.` and this shortcut ignores any chord with `Ctrl` or `Cmd` held". 27-P2-1 audited that Abort stays reachable (PROJECT.md non-negotiable 9).
    - The clash makes a running job stop, which is the documented and safe direction. Nothing moves or burns unexpectedly.
    - Ctrl+, for Settings is decided in ADR-499 D4. LightBurn's own 1.7 Edit menu gives macOS Settings as Cmd+,, the same chord as its Cmd+, rotate.
  - **What remains.** No ADR records the clash, and the 15°, 45° and 1.5° rotate keys are absent. That is parity polish of the same kind as L8-P3-8, so P3.
- **Fix direction:**
  - Keep Ctrl+. as Abort (non-negotiable 9). Record the conflict in an ADR, with the shortcut list and the rotate menu items naming it.
  - Bind LightBurn's free chords (Shift+. and Shift+, for 45°, Ctrl+Shift+. and Ctrl+Shift+, for 1.5°) to rotate.

### L8-P2-3 — LightBurn's draw-order keys PgUp / PgDn jog the machine's Z axis in KerfDesk; KerfDesk's own Draw order commands have no key

- **Where:**
  - `src/ui/laser/use-jog-shortcuts.ts:17-20,71-75`: bare PageUp / PageDown call `onFocusJog(±1)`.
  - Enabled when the jog pad is enabled and `focusJogReady` holds (`JogPad.tsx:231`). That is every CNC, or a laser with a confirmed Z travel (`FocusJogControls.tsx:80-86`).
  - Arrange → Draw order (`layout-commands.ts:7-12,39-62`, Bring Forward / Send Backward / to Front / to Back) has no shortcut.
- **Anchor:**
  - **Ground truth.** Windows cheatsheet Rev 2.0: "Push forward in draw order — PgUp", "Push backward in draw order — PgDn", "Push to front — Ctrl PgUp", "Push to back — Ctrl PgDn". The 1.7 Arrange menu page lists Push in Draw Order with no key, so this binding is documented for 2.x.
  - **Contract.** WORKFLOW F-A15 line 1916 and ADR-493 decision context ("PageUp and PageDown jog Z (ADR-362)") make the jog deliberate. No ADR records LightBurn's draw-order use of the keys.
- **Scenario:** A connected CNC user selects a part and presses PgDn to send it back in draw order, as in LightBurn 2.x. The spindle moves down one jog step. Ctrl+PgDn does nothing in KerfDesk; in a browser tab it switches tabs.
- **Evidence:** REPRO, `zz-l8-shortcuts.test.tsx`:
  ```text
  KEY PgUp | LB: Push forward in draw order | prevented=true | jogZ: [] -> [[1]]
  KEY PgDn | LB: Push backward in draw order | prevented=true | jogZ: [] -> [[-1]]
  KEY Ctrl+PgUp | LB: Push to front | prevented=false | NO CHANGE
  CMP moveSelectionInDrawOrder(forward) order cab
  ```
- **Severity:** P2. A conflicting shortcut whose KerfDesk action moves the machine. Raised at P2 because the jog is KerfDesk's documented binding (F-A15, the shortcut list and the jog-pad tooltip). The coordinator may weigh METHOD §3's machine-motion clause, given LightBurn 2.x muscle memory.
- **Novelty:** new.
- **Refuter:** CONFIRMED, P2 kept (the machine-motion clause was weighed). Checked as follows:
  - **Repro** (`zz-l8r-keys.test.tsx`, real `installJogShortcuts` with Z enabled):
    - PgUp and PgDn: `prevented=true`, `onFocusJog` `[1, -1]`, draw order unchanged (`abc`).
    - Ctrl+PgUp: not consumed.
  - **Gates (READ).** The keys work only while the jog pad is mounted, which means the machine rail is expanded (`JogPad.tsx:217-236`). `focusDisabled` is `pad.disabled || !focusReady`, with `pad.disabled` from `isJogPadDisabled`: not connected, controller not Idle, a motion or controller operation busy, or a job or controller block (`LaserWindow.tsx:76-81,204-208,315-322`). `focusJogReady` requires a CNC, or a laser with a confirmed Z travel. There are no repeats (`event.repeat` is ignored) and no modifiers, and keypad Page keys never jog Z (ADR-493 Amd 1).
  - **The move.** One focus step per press (0.1, 0.5, 1, 2 or 5 mm; default 1) at `min(maxFeed, 600)` mm/min (`JogPad.tsx:52,149`, `FocusJogControls.tsx:4`). There is no confirmation.
  - **Documentation.**
    - F-A15 Phase B+ says "`PageUp` / `PageDown` — Jog Z". The shortcut list says "jog Z (focus) up/down one step". The Z+ and Z− buttons are titled "(PageUp)" and "(PageDown)" (`FocusJogControls.tsx:103`). ADR-362 item 2 and ADR-493 cover it too.
    - LightBurn binds the keys to draw order (cheatsheet Rev 2.0). Its 1.7 Arrange menu lists no key for Push in Draw Order. ADR-493 Amd 1 records that LightBurn's Move window "has no Page-key Z jog".
  - **Why P2, not P1.** The precedent is C8-P2-1: NumLock-off keypad 3 sent a CNC bit down one focus step from a key the pad advertised for XY. Meta audit v1 M3 kept it at P2 as "borderline … bounded to one focus step". Here the key is KerfDesk's own documented Z key, so the move is less unexpected, and it only fires while the machine is connected, Idle and showing the jog pad.
  - **Why not P3.** It is reachable today and moves the machine for a LightBurn 2.x user who expects a draw-order change.
- **Fix direction:**
  - Decide in an ADR whether PgUp / PgDn stay Z jog.
  - If they stay, bind Draw order to Ctrl+PgUp / Ctrl+PgDn at least, and say in the shortcut list that PgUp / PgDn are not LightBurn's draw-order keys.
  - If they move, put Z jog on a chord that LightBurn leaves free.

### L8-P2-4 — Alt+Shift+H / Alt+Shift+V run Distribute spacing where LightBurn runs Move H / V Together, a command KerfDesk also has with no key

- **Where:**
  - `src/ui/commands/arrange-shortcut-keys.ts:7-8,35-44`, with the comment "LightBurn binds no distribute key, so those take Figma's Alt+Shift+H / Alt+Shift+V".
  - Arrange → Move H Together / Move V Together (`layout-commands.ts:21-24,93-101`) has no key.
- **Anchor:**
  - **Ground truth.** LightBurn 1.7 Distribute page: Move H Together "Moves all selected objects so that they are evenly distributed", with the edges abutting and the last-selected object staying put; Windows Alt+Shift+H, Alt+Shift+V for V. The Windows cheatsheet Rev 2.0 has the same rows.
  - **Contract.** ADR-499 decision 5 says "Alt+Shift+H and Alt+Shift+V distribute spacing (LightBurn has none; these follow Figma)". Its Context concedes "the LightBurn and Rayforge reference pages were not re-read for this batch".
- **Scenario:** Three parts at x 10, 50, 120, each 20 mm wide. The user presses Alt+Shift+H to push them together, as in LightBurn. KerfDesk equalises the gaps instead (b moves 50 → 65). Move H Together would place a and b against c (a 80, b 100). One Undo step either way.
- **Evidence:** REPRO, `zz-l8-shortcuts.test.tsx`:
  ```text
  KEY Alt+Shift+H (a,b,c) | LB: Move H-together | prevented=true | objs: 3[a@10.00,10.00;b@50.00,10.00;c@120.00,10.00] -> 3[a@10.00,10.00;b@65.00,10.00;c@120.00,10.00] | undo: 0 -> 1
  CMP moveSelectionTogether(horizontal) "3[a@80.00,10.00;b@100.00,10.00;c@120.00,10.00]"
  ```
  - **L7:** `arrange-shortcuts.test.ts:47` pins the distribute binding.
- **Severity:** P2. The same key does a different arrangement. The ADR's stated ground truth is wrong.
- **Novelty:** new.
- **Refuter:** CONFIRMED, P2 kept. Checked as follows:
  - **Repro:** Alt+Shift+H on a, b and c gives `prevented=true` and moves b from 50 to 65 (distribute spacing).
  - **Ground truth re-fetched.** The LightBurn 1.7 Distribute page gives Move H Together as "Alt/Option+Shift+H" and Move V Together as "Alt/Option+Shift+V". The cheatsheet Rev 2.0 has "Move H-together Alt Shift H".
  - **The ADR.** ADR-499 D5's "LightBurn has none; these follow Figma" is a decision resting on a misread source: its own Context says "the LightBurn and Rayforge reference pages were not re-read for this batch". So it does not make the clash deliberate.
- **Fix direction:**
  - Bind Alt+Shift+H / Alt+Shift+V to Move H / V Together, and give Distribute spacing other keys.
  - Correct ADR-499 D5 with an amendment that cites the 1.7 Distribute page.

### L8-P2-5 — A Fill-mode shape with a hole is a solid click target over the hole: artwork the canvas shows through the hole cannot be clicked, even on its outline

- **Where:**
  - `src/core/scene/hit-test.ts:97,132-141`. Each polyline is tested on its own, and a point inside *any* closed polyline of a Fill or Image object returns `primary` (`if (mode === 'fill' || mode === 'image') return { kind: 'primary' }`).
  - The inner ring of a hole therefore counts as filled, and the topmost-first loop stops there (`:43-57`).
  - The canvas fills with `evenodd`, or `nonzero` for text (`src/ui/workspace/object-display.ts:216`), so the hole is drawn empty.
- **Anchor:**
  - **Twin.** The canvas display and the burn (Fill leaves the hole empty) against the hit test.
  - **Contract.** ADR-196 Decision: "The rest of a hollow bounding box is not made selectable, preserving access to nested artwork."
- **Scenario:**
  - A 100 × 100 Fill plate with a 40 × 40 window, drawn after a small 10 × 10 Line square that sits in the window.
  - Clicking the small square's outline, its centre, or the empty part of the window selects the plate every time.
  - Only Alt+click reaches the square (candidates `ring>inner`).
  - With the plate's operation switched to Line, the same clicks pick the square, as ADR-196 intends.
- **Evidence:** REPRO, `zz-l8-hit.test.ts`:
  ```text
  HIT fill ring over inner (order inner,ring, layers #0000ff:line #ff0000:fill): innerEdge(45,50)=ring innerCentre(50,50)=ring emptyHole(35,50)=ring ringBody(15,50)=ring candidates@innerEdge=ring>inner
  HIT same ring in Line mode: innerEdge=inner innerCentre=inner emptyHole=ring
  ```
  - **L7:** `hit-test.test.ts:256-276` covers a filled object with no hole only.
- **Severity:** P2. A wrong selection on an ordinary design (a filled frame, sign or text counter over other art).
- **Novelty:** new. 08-P3-5 is the 2 mm tolerance. ADR-196's interior rules cover Line mode.
- **Refuter:** CONFIRMED, P2 kept. Checked as follows:
  - **Repro** (`zz-l8r-spot.test.ts`, real `hitTest`): a Fill ring 100 × 100 with a 40 × 40 window, drawn over a Line 10 × 10 square in the window. The square's edge (45,50), its centre (50,50), the empty window (35,50) and the plate body (15,50) all return `ring`. With the ring's operation set to Line, the square's edge returns `inner`.
  - **READ:** `hit-test.ts:132-141` tests each polyline alone, so a point inside the hole's ring counts as filled. The main-branch diff of `hit-test.ts` (#1502) touches only `transformedBBox`.
  - **Contract:** ADR-196 (DECISIONS.md) keeps "the existing geometry-first hit test", with Alt+click for coincident or crossing lines. Nothing in it makes a Fill hole opaque to clicks.
- **Fix direction:** For Fill and Image mode, test the point against the object's rings with the same fill rule the canvas uses (even-odd, or nonzero for text). Only a point inside the filled region is a `primary` hit.

### L8-P2-6 — The canvas origin marker is drawn at the top-left (rear-left) corner for every machine origin; WORKFLOW F-A2 puts it at the device-profile origin, front-left by default (refuter: P3)

- **Where:**
  - `src/ui/workspace/draw-bed-chrome.ts:74-86`: `drawOriginMarker(ctx, view)` takes no project and draws at `(view.offsetX, view.offsetY)`, which is scene (0, 0).
  - Called unconditionally at `draw-scene.ts:149`.
  - Unchanged since the initial commit `5d1d26344`.
- **Anchor:**
  - **Contract.** WORKFLOW F-A2 lines 119 and 122: "origin marker at front-left" and "**Origin marker**: small cross at the device-profile origin."
  - **Twin.** `toMachineCoords` (`core/devices/origin-transform.ts`) puts machine (0, 0) at scene (0, 400) on a front-left 400 × 400 bed and at (400, 0) on rear-right.
- **Scenario:** On the default front-left profile, and on Falcon / Sculpfun front-left profiles, the cross sits on the rear-left corner. That corner is machine (0, 400). The machine's real zero is bottom-left. On a rear-right machine, the cross marks machine (400, 0).
- **Evidence:** REPRO, `zz-l8-coords.test.ts`:
  ```text
  ORIGIN origin=front-left … markerScene={"x":0,"y":0} machineAtMarker={"x":0,"y":400} machineOriginAtScene={"x":0,"y":400}
  ORIGIN origin=rear-right … markerScene={"x":0,"y":0} machineAtMarker={"x":400,"y":0} machineOriginAtScene={"x":400,"y":0}
  ```
  - **L7:** no test draws the workspace origin marker.
- **Severity:** P2. A misleading marker on every machine whose origin is not rear-left. Placement is unaffected: the canvas still shows where an Absolute job burns.
- **Novelty:** new (`grep` of `docs/audits` for the origin marker finds nothing).
- **Refuter:** CONFIRMED, **lowered P2 → P3** (doc/code drift). Checked as follows:
  - **READ:** `drawOriginMarker(ctx, view)` draws at `(view.offsetX, view.offsetY)` and takes no device (`draw-bed-chrome.ts:74-86`). WORKFLOW F-A2 (main) says "origin marker at front-left" and "small cross at the device-profile origin". The marker has been this way since the initial commit `5d1d26344` (`git log -S`).
  - **Why lower.**
    - The cross sits on the zero of the Canvas frame. ADR-493 D1 makes every readout count from that zero: the rulers, the status bar, Numeric Edits and the hover X/Y. So every number on screen agrees with the cross.
    - The auditor's table confirms it: at the cross the status bar reads `X 0.0, Y 0.0` in every origin. ADR-493 D1 also declines LightBurn's machine-numbered frame.
    - No placement, Frame or output reads the marker, and nothing tells the operator that the cross is the machine's zero. The mismatch is with the WORKFLOW sentence, which METHOD §3 lists as P3 doc/code drift.
  - **If the coordinator treats F-A2 as a binding contract with a failure scenario** (an operator reading the cross as machine home), it returns to P2.
- **Fix direction:**
  - Draw the marker at `toSceneCoords({x: 0, y: 0}, device)`, as F-A2 says.
  - Or, if the marker is meant to mark the ruler zero, change F-A2 and add a separate machine-origin marker.

### L8-P2-7 — The advertised `+` zoom-in key does nothing when typed with Shift (US and similar layouts) (refuter: P3)

- **Where:** `src/ui/app/shortcuts.ts:461-485`. `handleViewShortcut` returns `false` for any Shift chord (`:465`) before the `case '+'` (`:480`). Typing `+` on a US keyboard is Shift+=, so it never matches. `=` and the numpad `+` (no Shift) work.
- **Anchor:** **Contract.**
  - WORKFLOW F-A15 line 1902: "`+` / `=` — Zoom in".
  - The shortcut list row `'+/-' → 'zoom'` (`src/ui/common/shortcut-list.ts`).
- **Scenario:** The user presses the `+` key (Shift+=) to zoom in. Nothing happens and the key is not consumed.
- **Evidence:** REPRO, `zz-l8-shortcuts.test.tsx`:
  ```text
  KEY + (Shift+= main keyboard) | prevented=false | NO CHANGE
  KEY + (numpad) | prevented=true | zoom: 2.000/pan5,5 -> 2.500/pan5,5
  KEY = | prevented=true | zoom: 2.000/pan5,5 -> 2.500/pan5,5
  ```
  - **L7:** `shortcuts.test.ts:327` tests `+` only without Shift (inside an input).
- **Severity:** P2, as a dead advertised shortcut (the brief's P2 example). Workarounds exist (`=`, the wheel, the zoom buttons).
- **Novelty:** new.
- **Refuter:** CONFIRMED, **lowered P2 → P3**. Checked as follows:
  - **Repro:** `+` with Shift (code `Equal`) is not consumed and leaves the zoom at 2.000. `=` zooms 2.000 → 2.500.
  - **READ:** `shortcuts.ts:465` returns before `case '+'`. The comment at `:481` shows that `+` was meant to work.
  - **Why lower.**
    - Nothing wrong happens; the chord is simply dead.
    - The same physical +/= key zooms when pressed without Shift, and so do numpad `+`, the wheel and the buttons. On layouts with an unshifted `+` key it works.
    - It matches the auditor's own P3 ratings for an advertised key doing nothing in a case: L8-P3-2 (Shift+F on a straight line) and L8-P3-9 (Ctrl+Y).
- **Fix direction:** Accept `e.key === '+'` whatever the Shift state, as the code comment intends.

### L8-P3-1 — Ruler ticks and the ruler cursor mark sit 0.5 px right of (and below) the true coordinate; the grid and artwork are exact

- **Where:**
  - `src/ui/workspace/draw-rulers.ts:77,100`: ticks are stroked at `px + 0.5` and `py + 0.5` with `px` unrounded.
  - `RulerCursorOverlay.tsx:40-41,62,69`: the mark is `left: x`, `width: 1`, so it is centred at `x + 0.5`.
  - `draw-bed-chrome.ts:46`: grid lines are drawn at the exact `x`.
- **Anchor:** **Twin.** The ruler against the grid and artwork drawn at the true coordinate.
- **Scenario:** At fit zoom on a 400 mm bed, every tick is 0.27 mm right of the grid line with the same number. At zoom 0.1 the bias is 2.7 mm, about a fifth of a minor division.
- **Evidence:** REPRO, `zz-l8-coords.test.ts`: `tickMinusTrue=0.500px` at every zoom and canvas size (table above). Labels themselves are exact.
- **Severity:** P3. Sub-pixel, and constant.
- **Novelty:** new.
- **Refuter:** CONFIRMED, P3 kept.
  - **READ:** `draw-rulers.ts:77,100` add `+ 0.5` to an unrounded `px`, while `drawGrid` does not.
  - **Labels are exact.** `drawRulers` was re-run with a recording context at zoom 1 (1001 × 667, 21 labels) and zoom 7 (1200 × 800, 30 labels): the worst label anchor error was 0 px.
  - **A caveat on "true".** A 1 px line at `x + 0.5` fills the pixel whose left edge is `x`, so the "true position" depends on the pixel convention. What is certain is a 0.5 px disagreement with the grid.
- **Fix direction:** Snap to the pixel grid (`Math.round(px) + 0.5`) for the ticks, the grid and the mark together. Or drop the `+ 0.5` and draw the mark centred on `x`.

### L8-P3-2 — Zoom to selection (Shift+F) does nothing for a straight horizontal or vertical line

- **Where:** `src/ui/state/ui-store.ts:457`. `computeZoomToBounds` returns `null` when the width or height is 0. `zoomToBounds` then returns silently, and `fitToSelection` (`viewport-actions.ts:43-58`) falls back only when the box itself is null.
- **Anchor:** **Contract.** WORKFLOW F-A15 line 1901: "`Shift+F` — Fit to selection (falls back to all-objects, then bed)". A line has a selection box, so this is neither a fit nor a fallback.
- **Evidence:** REPRO, `zz-l8-hit.test.ts`: `FIT horizontal line: zoom=1 pan=0,0`. The 100 × 20 control gives `zoom=2.8 pan=140,150`.
- **Severity:** P3.
- **Novelty:** new. 08-P2-2 was the Numeric W/H refusal for the same zero-extent selections; #1357 fixed that path only.
- **Refuter:** CONFIRMED (READ), P3 kept.
  - `computeZoomToBounds` returns `null` when `boundsW <= 0 || boundsH <= 0` (`ui-store.ts:457`).
  - `fitToSelection` falls back only when the box itself is `null` (`viewport-actions.ts:52-56`).
  - #1502's outline extent still gives a straight line zero height.
- **Fix direction:** Fit on the non-zero axis, with a minimum extent.

### L8-P3-3 — Measure reads circles and arcs built from elliptical arcs short: 64 chords per arc

- **Where:**
  - `src/core/geometry/outline-measure.ts:18,124`: `CURVE_SAMPLES = 64` per non-line segment, for the segment length, the perimeter and the area.
  - Design Studio circles are two 180° arcs (`core/sketch-constraints/sketch-path-geometry.ts:54-63`). DXF, LightBurn import, trace and fillet also produce `elliptical-arc` segments.
- **Anchor:** **Ground truth.** Analytic: 2πr and πr².
- **Scenario:**
  - A Ø100 Studio hole reads "Perimeter 314.13 mm", "Area 7850.83 mm²" and an arc "157.06 mm long". The truth is 314.16, 7853.98 and 157.08.
  - At R 200: perimeter −0.13 mm, area −50.5 mm².
  - The readout shows two decimals.
- **Evidence:** REPRO, `zz-l8-measure.test.ts`:
  ```text
  MEASURE two-arc circle R50: perimeter 314.1277 (true 314.1593, err -0.0315) area 7850.828 (true 7853.982, err -3.154)
  MEASURE two-arc circle R200: perimeter 1256.511 (true 1256.637) area 125613.2 (true 125663.7)
  ```
  - **Controls.** Polygons are exact under rotation and scale (plate with hole: 320 / 2800 exactly). Cubic circles measure their own geometry (314.1954). Inch areas convert correctly (12.1688 in²).
- **Severity:** P3. The accuracy is below the displayed precision, and nothing is placed by these numbers.
- **Novelty:** new.
- **Refuter:** CONFIRMED (READ plus analytic), P3 kept.
  - `CURVE_SAMPLES = 64` (`outline-measure.ts:18,124`).
  - 64 chords of a 180° arc of R 50 sum to 2·64·50·sin(π/128) = 157.06 mm, against the true 157.08. The two-arc perimeter is therefore 314.13, as reported.
- **Fix direction:** Use the exact arc length (r·Δθ for circular arcs) and the exact sector area. Or sample adaptively to a 1e-4 mm chord error.

### L8-P3-4 — An operation edit that changes nothing still makes an Undo step and marks the project unsaved (class of 08-P3-6)

- **Where:** `src/ui/state/store-actions.ts:65-75`. `setLayerParam` always pushes `pushUndo(s.project, …)` and sets `dirty: true`, whatever `projectWithLayerParam` returned. The same happens for an unknown id. UI callers pass whole patches: the Line / Fill / Image buttons via `commit({ mode })` (`SelectedLaserOperationFields.tsx:43-46`), and Cut Settings Apply (`LayerRowCutSettings.tsx:41`).
- **Anchor:** **Twin.**
  - `moveLayer` (`:77-87`) and `renameOperation` (`operation-actions.ts:69-81`) return the state unchanged on a no-op.
  - `endInteraction` skips an unchanged drag.
  - WORKFLOW F-A14: one step per action.
- **Evidence:** REPRO, `zz-l8-history.test.ts`:
  ```text
  HIST CHECK | setLayerParam same value | steps=1 changed=false dirty=true
  HIST CHECK | setLayerParam same power (30) | steps=1 changed=false dirty=true
  HIST CHECK | setLayerParam unknown id | steps=1 changed=false dirty=true
  DIRTY after saved, set visible=true on a visible layer: dirty=true undo=3
  ```
- **Severity:** P3. An empty Undo step and a needless save prompt.
- **Novelty:** class KNOWN as 08-P3-6 (no-op transforms), still open. This is a new site, on operations.
- **Refuter:** CONFIRMED, P3 kept.
  - **Repro** (`zz-l8r-spot.test.ts`): `setLayerParam(op, { visible: true })` on a visible operation makes 1 step and sets dirty. The project is a new object but equal by value.
  - **READ:** `store-actions.ts:65-75` pushes unconditionally. #1502's 3-line change to this file is elsewhere (`applyTransformsToScene`).
- **Fix direction:** Return the state unchanged when the patched project equals the old one, or the id is unknown. Fix it together with 08-P3-6.

### L8-P3-5 — Undo back to the saved state leaves the project marked unsaved

- **Where:**
  - `src/ui/state/store-actions.ts:189,214`: `undo` and `redo` always set `dirty: true`.
  - `markSaved` records only a boolean (`store-save-tracking-actions.ts:43-45`), so nothing can tell the restored object is the saved one.
- **Anchor:**
  - **Twin.** `markSaved` already compares by identity (`state.project === expectedProject`). Undo returns that exact object.
  - WORKFLOW F-A14 is silent. F-A13 prompts on dirty.
- **Scenario:** Save, nudge, Undo. The canvas equals the saved file, but the title keeps its unsaved mark and closing or New asks to save. Redo then Undo: the same.
- **Evidence:** REPRO, `zz-l8-history.test.ts`:
  ```text
  DIRTY after saved, nudge, Undo (back to saved): identical=true dirty=true
  DIRTY redo+undo again: dirty=true
  ```
- **Severity:** P3. Conservative: no work is at risk. No contract or LightBurn source requires clearing the flag.
- **Novelty:** new.
- **Refuter:** CONFIRMED, P3 kept.
  - **Repro:** with dirty set false, then nudge, then Undo, the project is the identical object, and dirty is `true`.
  - **READ:** `redo` and `undo` set `dirty: true` unconditionally (`store-actions.ts`, the `undo`/`redo` bodies).
- **Fix direction:** Keep a reference to the saved `Project` and set `dirty: project !== savedProject` after Undo and Redo.

### L8-P3-6 — The 256 MiB history budget does not count a photo's own data, so repeated crops or replacements of a large photo keep every version for 50 steps

- **Where:** `src/ui/state/undo-stack.ts:41-55`. `projectSources` counts only `raster-image.editorDocument` layers, `studioDocuments` and inactive sheets. A raster's `dataUrl` is never counted. `cropImage` and `replaceRasterImage` each install a new `dataUrl`.
- **Anchor:** **Twin.** `HISTORY_SOURCE_BYTES` (`:16`) exists to bound retained image sources, and the editor-document twin is counted. No ADR exempts plain photos. ADR-590 refers only to "the existing history budget".
- **Scenario:** Cropping or replacing a 20 MB photo 30 times keeps about 30 distinct copies (about 600 MB or more) until 50 later steps evict them. The budget never trims.
- **Evidence:** REPRO at small scale (`zz-l8-history.test.ts`): `limitProjectHistory(stack, 10_000)` over 10 steps, each holding a distinct 4,0xx-character photo `dataUrl` (at least 80,000 B charged at 2 B per character), keeps 10 of 10. The memory exhaustion itself was not run (Not verified).
- **Severity:** P3. Latent memory growth.
- **Novelty:** new.
- **Refuter:** CONFIRMED (READ), P3 kept.
  - `projectSources` (`undo-stack.ts:41-55`) charges only `editorDocument` layers, `studioDocuments` and inactive sheets.
  - `cropImage` stores a caller-built `RasterImage` with one Undo step (`image-mask-actions.ts:18`).
  - Not re-run at scale.
- **Fix direction:** Add `raster-image.dataUrl` (and other per-object payloads) to `projectSources`, counted once per distinct string.

### L8-P3-7 — Arrow-nudge defaults and Ctrl+Shift+arrow differ from LightBurn, while the code calls Ctrl+arrow "LightBurn's small-step chord"

- **Where:**
  - `src/ui/app/nudge-step.ts:4-6,19-23`: arrow 1 mm, Shift 10 mm, Ctrl 0.1 mm. Ctrl+Shift returns `null`, so nothing happens.
  - Distances come from ADR-499 decision 6.
- **Anchor:** **Ground truth.** LightBurn TransformControls (1.7 and 2.1): the "arrow keys nudge your selection by 5 mm, by default". Ctrl 1 mm, Shift 20 mm and Ctrl+Shift 0.1 mm are also documented as defaults.
- **Evidence:** REPRO, `zz-l8-shortcuts.test.tsx`: ArrowRight a 10 → 11, Shift 10 → 20, Ctrl 10 → 10.1. Ctrl+Shift is not bound (READ, `nudge-step.ts:22`).
- **Severity:** P3. The distances are adjustable in Settings → Canvas in both apps.
- **Novelty:** new.
- **Refuter:** CONFIRMED, P3 kept.
  - **Repro:** a.x goes 10 → 11 (arrow) → 21 (Shift) → 21.10 (Ctrl) → 21.10 (Ctrl+Shift, not consumed).
  - **LightBurn re-fetched:** the 1.7 and 2.1 TransformControls pages give 5, 1, 20 and 0.1 mm "by default".
  - **The ADR:** ADR-499 D6 decides 1 / 10 / 0.1 mm. Its Context says the LightBurn pages were not re-read, and `nudge-step.ts:5` still calls Ctrl+arrow "LightBurn's small-step chord".
- **Fix direction:** Adopt LightBurn's defaults, or state the difference in ADR-499. Either way, bind Ctrl+Shift+arrow (LightBurn's 0.1 mm).

### L8-P3-8 — Most of LightBurn's design keys are unbound, and the View keys ignore Alt, so Alt+- zooms out and Alt+0 / Alt+F fit the bed

- **Where:**
  - `src/ui/app/shortcuts.ts:461-485`. `handleViewShortcut` rejects Ctrl/Cmd and Shift but not Alt.
  - None of the keys in the "L8-P3-8" rows of the parity table is bound anywhere in `use-shortcuts.ts`'s listeners. KerfDesk has commands for most of them: Weld, Offset Shapes, Break Apart, Convert to Path, Mirror Across Line, Two-Point Rotate, Optimize Shapes, Wireframe, Zoom.
- **Anchor:** **Ground truth.** The Windows cheatsheet Rev 2.0 rows listed in the table.
- **Evidence:** REPRO, `zz-l8-shortcuts.test.tsx`:
  - each key in those rows gives `NO CHANGE`, except
  - `Alt+-` gives `zoom 2.000 -> 1.600`;
  - `Alt+0` and `Alt+F` give `zoom -> 1.000/pan0,0`;
  - `Ctrl+K` opens command search.
  - Ctrl+W, Ctrl+T, Ctrl+0 / = / -, Ctrl+H and Ctrl+P are not consumed. In a browser tab, the browser's own action applies, which was not run here.
- **Severity:** P3. Parity gaps, plus one stray Alt chord (Alt+- is LightBurn's Boolean subtract).
- **Novelty:** LBG-F15 (hotkey editor, open) is adjacent. The individual keys are new.
- **Refuter:** CONFIRMED, P3 kept.
  - **Repro:** Alt+- zooms out (`prevented=true`, 2.000 → 1.600 → 2.000 after the earlier `=`), and Alt+0 resets to 1.000.
  - **READ:** `handleViewShortcut` rejects Ctrl, Cmd and Shift, but not Alt (`shortcuts.ts:465`).
  - **Source:** the cheatsheet rows were re-read from the re-downloaded PDF.
- **Fix direction:**
  - Make `handleViewShortcut` refuse Alt.
  - Bind the LightBurn keys that do not collide with a browser-reserved chord.
  - Implement LBG-F15 so users can rebind the rest.

### L8-P3-9 — Ctrl+Y is Redo in Design Studio but does nothing on the main canvas

- **Where:**
  - `src/ui/design-studio/design-shortcuts.ts:58`: `key === 'y' || (key === 'z' && event.shiftKey)` runs redo.
  - The Studio tooltip says "Redo (Ctrl+Y)" (`DesignTopBar.tsx:43`).
  - The main `EDIT_BINDINGS` have only Ctrl+Shift+Z (`src/ui/app/shortcuts.ts:247`).
- **Anchor:** **Twin.** The two editors' Redo keys.
- **Evidence:** REPRO, `zz-l8-shortcuts.test.tsx`: `KEY Ctrl+Y … prevented=false | NO CHANGE` on the main canvas. The Studio binding is READ.
- **Severity:** P3.
- **Novelty:** new.
- **Refuter:** CONFIRMED, P3 kept.
  - **Repro:** after Ctrl+Z, Ctrl+Y is not consumed and the redo stack stays at 1.
  - **READ:** `design-shortcuts.ts:58` (`key === 'y' || …` redo) and `DesignTopBar.tsx:43` ("Redo (Ctrl+Y)").
  - **LightBurn:** its Edit menu lists only Ctrl/Cmd+Shift+Z for Redo, so the main canvas matches LightBurn. The Studio is the twin that differs.
- **Fix direction:** Bind Ctrl+Y to Redo on the main canvas (the Windows convention), or drop it from the Studio.

## KNOWN re-observed

- **08-P3-6 (cited in the brief):** a repeated Move to bed centre on an unchanged selection adds an empty step and sets dirty after Save. Re-run: `sameValue=true dirty=true undo=2`. L8-P3-4 is the same class on operations.
- **08-P3-5:** artwork picking still uses a fixed 2 mm band at every zoom. An open line is hit at 1.9 mm and missed at 2.1 mm (`zz-l8-hit.test.ts`), with no zoom input to `hitTest`.
- **08-P3-3 (re-rated P1 in v7 L2):**
  - The marquee, hover size, status-bar selection size and Numeric Edits use the rotated bounds rectangle (`transformedBBox`).
  - Open PR #1502 (ADR-677) changes `transformedBBox` to the outline's extent (`hit-test.ts` in its diff). That would also fix the marquee consequence.
- **08 Refuted (crossing marquee by bounding box):** re-observed. A right-to-left box at (80…95, 5…20) selects a 0,0–100,100 diagonal line it does not touch. LightBurn's cheatsheet says "Select all objects touched". 08 dropped this as ambiguous, and it is not re-raised.
- **08-P3-2 (held arrow evicts history):** fixed by ADR-499 Amendment 1 (`tryNudge` passes `heldRepeat: e.repeat`, `nudge-step.ts:61-62`). READ only.
- **27-P2-1 (Ctrl+. could not reach Abort):** fixed. The listener is capture-phase and ungated (`use-job-shortcuts.ts:40-46`). L8-P2-2 is the reverse side of that reach.
- **Per-operation Undo of other areas** is cited, not re-raised:
  - L1 (weld, booleans, offset);
  - L2 (shapes);
  - L3 (text);
  - L4 (transforms, groups and nested groups, lock);
  - L5 (Design Studio history, including L5-P1-2 recovery loss and L5-P3-1 / P3-5 Studio Undo);
  - L6 (node edits).

## Refuted

Candidates the auditor checked and dropped:

- **The rulers and readouts do not count from the machine origin, as LightBurn's do.** Decided.
  - ADR-493 decision 1: "**Canvas** is the scene millimetres the rulers and the X/Y boxes show". It also says LightBurn's absolute machine numbers are "not offered as a third frame".
  - The canvas shows where an Absolute job burns, so nothing is placed wrongly.
  - The origin marker is raised separately (L8-P2-6) because F-A2 is explicit about it.
- **devicePixelRatio breaks the pointer or ruler mapping.** Refuted. The bitmap stays at the rounded CSS size (`use-canvas-bitmap-size.ts`). Pointer error is at most 7e-13 mm, and the DOM mark drifts at most 0.40 CSS px. Only sharpness is affected, which is a documented choice.
- **A click inside a photo picks the photo even over a Line-mode shape drawn on top of it.** By design. ADR-196 puts direct hits (the photo's area) before enclosing Line interiors. The square's own outline still wins (`squareEdge=sq` with the photo at the back).
- **Selecting with Cut Selected Graphics on dirties the project without an Undo step.** By design. The job setup that is saved stores the selection (`project-job-setup.ts:35-44`), so the file would differ. Save re-derives it from the live selection.
- **Undo during a running job.** Matches WORKFLOW F-A14 and ADR-416 Amd 2: the machine step is refused, the design step applies.
- **Tab does not cycle objects (LightBurn's Tab).** Declined in ADR-196 Consequences.
- **`P` is Preview, not LightBurn's Move to page centre.** Decided in ADR-410 Alternatives.
- **Alt+PgUp / Alt+PgDn swap the axes.** Refuted. LightBurn 1.7 Align: Alt+PgUp is Align Vertical Centers, a shared X. KerfDesk aligns a to b's X.
- **No 20× zoom.** `MAX_ZOOM = 16` (`ui-store.ts:35`). No contract asks for more.

**Refuter:** none of the 17 findings is refuted. Each one reproduced, or read true at the cited lines. Three are lowered to P3, with the reasons given in the findings:
- L8-P2-2: the Abort binding is decided and documented.
- L8-P2-6: doc/code drift; every readout agrees with the marker.
- L8-P2-7: a dead Shift chord; the same physical key zooms.

## Verified clean

- **Refuter spot checks** (`zz-l8r-spot.test.ts`):
  - **Ruler labels.** `drawRulers` was recorded at zoom 1 (1001 × 667, 1.5175 px/mm, 21 labels) and zoom 7 (1200 × 800, 12.95 px/mm, 30 labels). Every label anchor sits on `offset + value × scale` (0 px error).
  - **Undo sweep, six commands.** Each made exactly 1 step: nudge, flip horizontal, group, duplicate, operation power 30 → 55 and rotate 90°. Undo returned the identical `Project` and Redo the identical post-command object.

- **Rulers:** labels exact in mm and inches at zoom 0.1, 1 and 16, on both canvas sizes (table). The 1-2-5 steps follow ADR-348.
- **Pointer, zoom and pan:** exact pointer mapping, cursor-anchored wheel zoom (3e-13 mm over 80 notches), and Shift+F on a 20 × 20 rectangle gives zoom 14 at pan 180, matching 0.7 × 400 / 20.
- **Readouts:** the status-bar cursor gives one decimal of a mm or three of an inch. Measure gives two decimals of a mm or four of an inch, and the inch area converts exactly. The drag-measure dx, dy, distance and angle are exact.
- **Hit testing:**
  - an open path within 2 mm;
  - nested Line squares (the smallest enclosing interior wins, whatever the order);
  - locked artwork skipped, and hidden operations skipped;
  - the corner of a rotated square's bounding box missed;
  - the photo's area follows draw order;
  - a nested group selected as its outermost group (a, b, c);
  - Alt+click candidates ordered direct hits first, then interiors by area.
- **History:** 49 design commands each one step, exact Undo and Redo, plus 14 selection and view commands with no step (table). Redo after Undo restores the identical object. The cap is 50.
- **Design Studio entry and exit:** no main-store write until Apply. The Studio is a registered modal (main Ctrl+Z stands down) and has its own Undo.
- **Accessibility basics (READ):**
  - The canvas has `aria-label` "KerfDesk workspace" (`WorkspaceCanvasLayers.tsx:56`).
  - Keyboard-only selection goes through the design tree buttons, with a title on each and Rename by `aria-label` (`DesignRowButtons.tsx:28-56`). Ctrl+A and Ctrl+Shift+I also select.
  - Keyboard transforms: arrows, `.` and `,`, H and V, Alt-align, Numeric Edits.
  - Dialogs trap Tab, close on Escape and restore focus (`use-dialog-a11y.ts:1-13`). The Studio overlay is `role="dialog" aria-modal="true"`.
  - Abort stays reachable from all of them.

## Not verified

- **Real browser and Electron behaviour.**
  - Browser-reserved chords (Ctrl+W, Ctrl+T, Ctrl+0 / = / -, Ctrl+H, Ctrl+P, Ctrl+PgUp / PgDn) in a tab.
  - The Electron macOS `fileMenu` role's Cmd+W (LightBurn's Mac Weld) closing the window. `electron/application-menu-policy.ts:14-19` keeps that role on macOS.
  - Real devicePixelRatio pixel output.
  - Screen-reader announcements.
- **LightBurn's application behaviour** beyond its documentation: crossing-marquee geometry, image hit areas, and draw-order keys in 1.7 (its Arrange menu page lists none).
  - *Refuter:* LightBurn's Filled view is now documented for *identical* stacked shapes on one Fill layer: they "appear unfilled", and LightBurn warns before Preview or engraving (2.0 *Vector Artwork Imports With Extra Lines* and *Missing Shapes*, fetched 2026-10-28).
  - For a *different* nested shape (plate and circle) its Filled-view drawing is still UNVERIFIED. The 1.7 *View Style* page says only that Fill-layer shapes "will appear as solid shapes", blocking shapes on other layers, and points to Preview for the finished result.
- **UI triggers of L8-P3-4:** whether Cut Settings Apply is enabled with nothing changed, and whether clicking the active Line / Fill / Image button calls `commit`.
- **L8-P3-6 at scale:** the memory exhaustion itself.
- **Not swept here:** text objects, weld (asynchronous), Design Studio Apply, arrays, the jig editor's keys (G9 covers its nudge) and trace commits. The owning areas cover them.

## Repro files

All were created under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\` and **deleted after the run**, one file at a time. No repo file other than this report was touched.

| File | What it did |
|---|---|
| `zz-l8-vitest.config.ts` | The repo Vitest config plus the `fflate` alias and one worker |
| `src\ui\state\zz-l8-list-actions.test.ts` | Listed the store's 285 actions, for the sweep's enumeration |
| `src\ui\app\zz-l8-shortcuts.test.tsx` | Pressed 80 keys (LightBurn's cheatsheet and TransformControls keys, plus KerfDesk's own) into `useShortcuts` + Abort + keyboard jog; L8-P2-1/2/3/4/7, P3-7/8/9 |
| `src\ui\workspace\zz-l8-coords.test.ts` | Rulers, grid, origin marker, status-bar readout, pointer mapping with fractional CSS boxes, zoom at cursor; L8-P2-6, P3-1 |
| `src\ui\workspace\zz-l8-hit.test.ts` | Hit tests on synthetic scenes, marquee, fit to selection; L8-P2-5, P3-2 |
| `src\ui\workspace\zz-l8-measure.test.ts` | Measure against analytic circles and a plate with a hole; L8-P3-3 |
| `src\ui\state\zz-l8-history.test.ts` | 69-row Undo/Redo sweep, dirty flag, caps, Undo during a job; L8-P3-4/5/6 |
| `src\ui\workspace\zz-l8-fill-canvas.test.ts` | Plate and separate circle on one Fill operation: compiled hatch area against `drawScene`'s fill calls; L8-P1-1 |

Run outputs (`l8-*-out.txt`) and the downloaded LightBurn PDFs (`l8-lb\`) were in the scratchpad root and were deleted too. The PDF's SHA-256 is recorded above.

**Refuter files.** These were created in the same `j7-main` tree, run one at a time with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> --config zz-l8r-vitest.config.ts`, and deleted one file at a time. The `node_modules` junction was not touched.

| File | What it did |
|---|---|
| `zz-l8r-vitest.config.ts` | The repo config plus the `fflate` alias and one worker |
| `src\ui\workspace\zz-l8r-fill-canvas.test.ts` | L8-P1-1 both sides: the burn's lit length and the lines through the circle centre, against an even-odd test of `drawScene`'s recorded ink fills. Also Paste in Place and Duplicate on a Fill operation (12,000 → 0 mm) |
| `src\ui\app\zz-l8r-keys.test.tsx` | Real `useShortcuts`, `installAbortShortcut` and `installJogShortcuts`. Ctrl+Shift+V with compiled output (240 → 320 mm), Ctrl+. and Ctrl+,, PgUp and PgDn, Alt+Shift+H, `+`, Alt+-, Alt+0, Ctrl+Y and the nudges |
| `src\ui\workspace\zz-l8r-spot.test.ts` | Ruler labels at two zooms, a six-command Undo sweep, the P3-4 and P3-5 dirty checks, and the P2-5 hit test |

The LightBurn cheatsheet was re-downloaded into a separate scratchpad folder, with SHA-256 `b47b95bf99b1c5e62ddbefe5f797b1ac6d9ac074966a6eb29685f57a949c5333`, matching the auditor's. It was read with `pdftotext` and then deleted.

```json
[
  {"id":"L8-P1-1","severity":"P1","area":"canvas-interaction-history","file":"src/ui/workspace/object-display.ts","line":155,"anchor":"Twin: design canvas (one fill per object path, same ink) against the compiled Fill (fill-rule.ts:5-13 pooled even-odd); Contract: ADR-486 Amd 2 'material is combined with even-odd parity across objects'; Ground truth: LightBurn 1.7 Fill Mode (shape inside another on one layer is a hole; fetched by the L7 refuter)","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO both sides (burn 0 lit lines through circle centre, canvas ink there, preflight empty); P1 kept; extended: Duplicate (Ctrl+D) / Paste in Place on a Fill operation cancels, 12000 -> 0 mm hatch, canvas solid, no warning (LightBurn 2.0 docs: duplicates appear unfilled and LightBurn warns)","known":"flagged, not counted: L7 refuter note under L7-P1-1","summary":"A 40x30 plate and a separate D16 circle on one Fill operation: drawScene paints two separate fill(evenodd) calls in the same ink #1a1a1a (a solid plate) while the compiled hatch covers 999.7 mm2 with no line through the circle (a ring); no warning; Preview and Wireframe show it only if opened"},
  {"id":"L8-P2-1","severity":"P2","area":"canvas-interaction-history","file":"src/ui/app/editing-tool-shortcuts.ts","line":55,"anchor":"Ground truth: LightBurn 1.7 Arrange menu (Flip Horizontal Shift+Ctrl+H, Flip Vertical Shift+Ctrl+V) and Windows hotkey cheatsheet Rev 2.0 (Paste in place Alt+V); Contract: ADR-410 D4 claims the chord 'was free'","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO real useShortcuts + emitGcode: Line output 240 -> 320 mm, no stack warning; ADR-410 D4 premise wrong (LB 1.7 Arrange menu binds Shift+Ctrl+V to Flip Vertical); P2 kept (documented command, listed in Undo/Artwork panel)","known":false,"summary":"Ctrl+Shift+V (LightBurn Flip Vertical) is Paste in Place: with a clipboard it stacks an invisible copy on the copied artwork (objects 3 -> 4, copy at a's exact x/y, 1 Undo step), so the part burns twice; Ctrl+Shift+H (Flip Horizontal) and Alt+V (LightBurn Paste in place) do nothing"},
  {"id":"L8-P2-2","severity":"P3","area":"canvas-interaction-history","file":"src/ui/laser/use-job-shortcuts.ts","line":42,"anchor":"Ground truth: LightBurn TransformControls 1.7/2.1 (Ctrl+. 15 CW, Ctrl+, 15 CCW, Shift+./, 45, Ctrl+Shift+./, 1.5 or 5); Contract: WORKFLOW F-A15 lines 1868/1910 bind Ctrl+, Settings and Ctrl+. Abort, no ADR records the collision","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO; lowered P2->P3: Ctrl+. is the decided, documented Abort (F-A15, ADR-362, ADR-410 D1, 27-P2-1), safe direction; Ctrl+, Settings decided (ADR-499 D4; LB macOS Settings is Cmd+,); remaining rotate-key gaps are parity polish","known":false,"summary":"LightBurn's 15 degree rotate Ctrl+. aborts a running KerfDesk job (stopJob called; idle: nothing); Ctrl+, opens Settings; Shift+./, (45) and Ctrl+Shift+./, (1.5) do nothing","severity_raised":"P2"},
  {"id":"L8-P2-3","severity":"P2","area":"canvas-interaction-history","file":"src/ui/laser/use-jog-shortcuts.ts","line":18,"anchor":"Ground truth: LightBurn Windows hotkey cheatsheet Rev 2.0 (PgUp/PgDn push forward/backward in draw order, Ctrl+PgUp/PgDn front/back); Contract: WORKFLOW F-A15 line 1916 / ADR-362 make PgUp/PgDn Z jog; KerfDesk Draw order commands (layout-commands.ts:7-12) have no key","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO + gates READ (connected, Idle, no job/motion, jog pad shown, CNC or confirmed Z; one 0.1-5 mm step at <=600 mm/min, no confirm); documented (F-A15, shortcut list, tooltip, ADR-362/493); P2 kept per C8-P2-1 precedent (meta v1 M3: one focus step)","known":false,"summary":"PgUp/PgDn, LightBurn's draw-order keys, jog the machine Z one step (onFocusJog(+1/-1)) on any connected CNC or Z-confirmed laser; Ctrl+PgUp/PgDn do nothing; KerfDesk's own Bring Forward/Send Backward have no key. Coordinator may weigh METHOD 3 machine-motion clause"},
  {"id":"L8-P2-4","severity":"P2","area":"canvas-interaction-history","file":"src/ui/commands/arrange-shortcut-keys.ts","line":36,"anchor":"Ground truth: LightBurn 1.7 Distribute page (Move H/V Together = Alt+Shift+H/V) and cheatsheet Rev 2.0; Contract: ADR-499 D5 'LightBurn has none' (Context: reference pages not re-read)","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO (b 50 -> 65); LB 1.7 Distribute page re-fetched: Move H Together Alt/Option+Shift+H; ADR-499 D5 rests on unread source; P2 kept","known":false,"summary":"Alt+Shift+H/V run Distribute spacing (b 50 -> 65) where LightBurn runs Move H/V Together (a 80, b 100 against c), a command KerfDesk has with no key; ADR-499 D5's ground truth is wrong"},
  {"id":"L8-P2-5","severity":"P2","area":"canvas-interaction-history","file":"src/core/scene/hit-test.ts","line":141,"anchor":"Twin: canvas fill evenodd/nonzero (object-display.ts:216) and Fill output leave holes empty; Contract: ADR-196 'preserving access to nested artwork'","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO real hitTest: square edge, centre and empty window all return the Fill ring; Line mode picks the square; P2 kept","known":false,"summary":"A Fill-mode shape with a hole is a solid click target: a 10x10 Line square seen through a filled plate's 40x40 window cannot be picked on its outline, centre or the empty window (all return the plate); only Alt+click reaches it; Line mode picks it correctly"},
  {"id":"L8-P2-6","severity":"P3","area":"canvas-interaction-history","file":"src/ui/workspace/draw-bed-chrome.ts","line":74,"anchor":"Contract: WORKFLOW F-A2 lines 119/122 (origin marker at front-left / at the device-profile origin); Twin: toMachineCoords puts machine 0,0 at scene (0,400) front-left, (400,0) rear-right","evidence":"REPRO","verdict":"CONFIRMED: READ draw-bed-chrome.ts:74-86; lowered P2->P3 as doc/code drift: the cross is the Canvas-frame zero every readout counts from (ADR-493 D1); no placement or output depends on it","known":false,"summary":"drawOriginMarker takes no device and always marks scene (0,0), the top-left (rear-left) corner: on the default front-left profile it sits on machine (0,400), on rear-right on machine (400,0); unchanged since the initial commit","severity_raised":"P2"},
  {"id":"L8-P2-7","severity":"P3","area":"canvas-interaction-history","file":"src/ui/app/shortcuts.ts","line":465,"anchor":"Contract: WORKFLOW F-A15 line 1902 ('+ / = Zoom in') and shortcut-list '+/-' row","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO; lowered P2->P3: dead Shift chord only, the same physical key unshifted, numpad + and wheel zoom; consistent with P3-2 and P3-9","known":false,"summary":"handleViewShortcut rejects every Shift chord before case '+', so '+' typed as Shift+= on US layouts does nothing and is not consumed; '=' and numpad '+' zoom","severity_raised":"P2"},
  {"id":"L8-P3-1","severity":"P3","area":"canvas-interaction-history","file":"src/ui/workspace/draw-rulers.ts","line":77,"anchor":"Twin: grid lines (draw-bed-chrome.ts:46) and artwork at the exact coordinate","evidence":"REPRO","verdict":"CONFIRMED: READ; ruler labels re-run exact at zoom 1 and 7; the 0.5 px is against the grid, pixel-convention dependent","known":false,"summary":"Ruler ticks (px+0.5) and the DOM ruler mark (left x, width 1) sit 0.5 px right/below the true coordinate at every zoom: 2.70 mm at 0.1x, 0.27 mm at 1x, 0.017 mm at 16x; labels and grid exact"},
  {"id":"L8-P3-2","severity":"P3","area":"canvas-interaction-history","file":"src/ui/state/ui-store.ts","line":457,"anchor":"Contract: WORKFLOW F-A15 line 1901 (Shift+F fit to selection, falls back)","evidence":"REPRO","verdict":"CONFIRMED: READ ui-store.ts:457, viewport-actions.ts:52-56","known":"adjacent: 08-P2-2 zero-extent selections (Numeric W/H, fixed by #1357)","summary":"computeZoomToBounds returns null for a zero-width or zero-height box, so Shift+F on a straight horizontal or vertical line does nothing (zoom 1, pan 0,0)"},
  {"id":"L8-P3-3","severity":"P3","area":"canvas-interaction-history","file":"src/core/geometry/outline-measure.ts","line":18,"anchor":"Ground truth: analytic circle perimeter 2*pi*r and area pi*r^2","evidence":"REPRO","verdict":"CONFIRMED: READ + analytic: 2*64*50*sin(pi/128) = 157.06 per half circle","known":false,"summary":"Measure samples each elliptical arc with 64 chords: a Studio/DXF two-arc circle R50 reads perimeter 314.13 (true 314.16), arc 157.06 (157.08), area 7850.83 (7853.98); R200 perimeter -0.13 mm, area -50.5 mm2; shown to 2 decimals"},
  {"id":"L8-P3-4","severity":"P3","area":"canvas-interaction-history","file":"src/ui/state/store-actions.ts","line":70,"anchor":"Twin: moveLayer/renameOperation/endInteraction skip no-ops; WORKFLOW F-A14 one step per action","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO: visible=true no-op makes 1 step, dirty","known":"class KNOWN: 08-P3-6 (no-op transforms); new site","summary":"setLayerParam always pushes an Undo step and sets dirty, even when the patch changes nothing (visible true, power 30) or the id is unknown"},
  {"id":"L8-P3-5","severity":"P3","area":"canvas-interaction-history","file":"src/ui/state/store-actions.ts","line":189,"anchor":"Twin: markSaved compares project identity (store-save-tracking-actions.ts:43-45) while undo/redo always set dirty","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO: identical saved object, dirty true","known":false,"summary":"Save, nudge, Undo restores the identical saved Project object but the project stays marked unsaved (Redo+Undo too)"},
  {"id":"L8-P3-6","severity":"P3","area":"canvas-interaction-history","file":"src/ui/state/undo-stack.ts","line":41,"anchor":"Twin: HISTORY_SOURCE_BYTES counts editorDocument/studio/sheets but not raster dataUrl","evidence":"REPRO","verdict":"CONFIRMED: READ undo-stack.ts:41-55","known":false,"summary":"The 256 MiB history budget ignores a photo's own dataUrl: limitProjectHistory with a 10,000 B budget keeps 10 of 10 steps holding distinct 4,0xx-char photo data; repeated crops/replacements of a large photo stay for 50 steps uncounted"},
  {"id":"L8-P3-7","severity":"P3","area":"canvas-interaction-history","file":"src/ui/app/nudge-step.ts","line":19,"anchor":"Ground truth: LightBurn TransformControls 1.7/2.1 nudge defaults 5/20/1/0.1 mm","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO 1/10/0.1 mm, Ctrl+Shift unbound; LB 1.7 and 2.1 TransformControls re-fetched 5/1/20/0.1","known":false,"summary":"Arrow / Shift / Ctrl nudge 1 / 10 / 0.1 mm against LightBurn's 5 / 20 / 1 mm, and Ctrl+Shift+arrow (LightBurn 0.1 mm) is unbound, while the code calls Ctrl+arrow LightBurn's small-step chord"},
  {"id":"L8-P3-8","severity":"P3","area":"canvas-interaction-history","file":"src/ui/app/shortcuts.ts","line":461,"anchor":"Ground truth: LightBurn Windows hotkey cheatsheet Rev 2.0","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO Alt+- zooms out, Alt+0 fits; cheatsheet re-read","known":"adjacent: LBG-F15 hotkey editor (open)","summary":"Most LightBurn design keys are unbound (Ctrl+0/=/-, Ctrl+Shift+A, Alt+Shift+W, Ctrl+T, Ctrl+W, Ctrl+B, Alt+B, Alt+O, Ctrl+Shift+C, Alt+J, Ctrl+Shift+M, Ctrl+2, Alt+Home, ...); View keys ignore Alt, so Alt+- zooms out (LightBurn Boolean subtract) and Alt+0 / Alt+F fit the bed"},
  {"id":"L8-P3-9","severity":"P3","area":"canvas-interaction-history","file":"src/ui/design-studio/design-shortcuts.ts","line":58,"anchor":"Twin: Design Studio Redo (Ctrl+Y or Ctrl+Shift+Z) against the main canvas (Ctrl+Shift+Z only, shortcuts.ts:247)","evidence":"REPRO","verdict":"CONFIRMED: refuter REPRO main canvas Ctrl+Y not consumed; LB Edit menu Redo is Ctrl+Shift+Z only","known":false,"summary":"Ctrl+Y redoes in Design Studio (and its tooltip says so) but does nothing on the main canvas"}
]
```
