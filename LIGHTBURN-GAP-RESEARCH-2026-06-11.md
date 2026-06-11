# LightBurn 2.1 vs LaserForge 2.0 — Gap Inventory & Build Plan

**Date:** 2026-06-11 · **Status:** research synthesis, decision document — report only, nothing auto-fixed (per CLAUDE.md collaboration rule 1).

**Reference version:** LightBurn **2.1.02**, released **2026-06-01** (verified today: lightburnsoftware.com/blogs/news/lightburn-2-1-02-patch-release; 2.1.0 shipped 2026-05-19). All LightBurn claims below come from official docs (docs.lightburnsoftware.com), the official hotkey map (Hotkeys.html), release notes, and forum threads fetched 2026-06-11 by the four area researchers; per-item citations are in the matrix.

**Method and honesty notes.** Four researchers inventoried (1) drawing/canvas editing, (2) menus/commands/hotkeys, (3) panels/machine control, (4) the five operator journeys. This document merges and de-duplicates their 161 raw items into **121 unique LightBurn surfaces**, adjudicates conflicts against the actual tree, and sequences the build. Conflicts resolved by reading code in this worktree:

- **Command count is 28, not 27** — counted from the `CommandId` union in `src/ui/commands/command-registry.ts:13-41`.
- **Dither set: we have 11 algorithms** (`DITHER_ALGORITHMS`, `src/core/scene/scene-object.ts:127-139`: threshold, floyd-steinberg, jarvis, stucki, atkinson, burkes, sierra3, sierra2, sierra-lite, ordered, grayscale). Researcher 4's claim of "only 3" was stale; researcher 3 was right. No dither work is needed.
- **Image-mode extras exist:** `negativeImage`, `passThrough`, `dotWidthCorrectionMm`, grayscale `minPower` are all on `Layer` (`src/core/scene/layer.ts:51-55,22`). Researcher 4's "missing" claims for these were stale.
- **PROJECT.md:85 claims a text "weld toggle" that does not exist** — `grep -i weld` over `src/` returns zero hits (only docs/audit files match). Doc bug, flagged in Appendix A.
- **Marquee is documented but never implemented** — WORKFLOW.md F-A5:153-156 describes the flow; the only code matches are comments (`src/ui/state/store.ts:69`).
- No tool-mode concept exists (`grep toolMode|activeTool|drawMode|currentTool` in src: zero hits); `SelectedObjectProperties.tsx` contains exactly one field (Power Scale); no `sendCommand` in any laser file; `material-test-grid.ts` contains zero label/text generation.

---

## 1. The honest headline

**Yes — the suspicion is confirmed, with numbers.** LightBurn 2.1 exposes roughly **120 menu commands across 8 menus, ~90 default hotkeys, a 9-tool Creation Toolbar, and ~19 dockable windows** (docs.lightburnsoftware.com/Hotkeys.html; Reference/UI/* pages). LaserForge exposes **28 registry commands, ~24 hotkeys, 0 drawing tools, and a fixed panel layout** (`command-registry.ts`; `src/ui/app/shortcuts.ts` + `use-job-shortcuts.ts` + `use-space-pan.ts`). That is roughly a **4:1 surface ratio**.

Across the **121 unique surfaces** inventoried:

| Verdict | Count | Share |
|---|---|---|
| **have** | 18 | 15% |
| **partial** | 29 | 24% |
| **missing** | 50 | 41% |
| **deliberate skip** (recommended) | 24 | 20% |

Plus **3 surfaces we have that LightBurn lacks entirely** (panic-stop/start hotkeys, connect-time $$ auto-config, and the proposed placement ghost) — kept out of the 121.

**Where the gap matters vs where it is bloat — per area:**

| Area | Surfaces | have | partial | missing | skip |
|---|---|---|---|---|---|
| A. Creation & drawing tools | 10 | 0 | 1 | 8 | 1 |
| B. Selection & transform | 11 | 0 | 5 | 6 | 0 |
| C. Edit ops & clipboard | 7 | 2 | 2 | 3 | 0 |
| D. Arrange & layout | 14 | 0 | 1 | 8 | 5 |
| E. Geometry kernel | 7 | 0 | 0 | 3 | 4 |
| F. Layers & cut settings | 21 | 5 | 5 | 5 | 6 |
| G. Image pipeline | 6 | 3 | 2 | 1 | 0 |
| H. Machine control & operator loop | 18 | 4 | 4 | 9 | 1 |
| I. Calibration & libraries | 7 | 1 | 2 | 2 | 2 |
| J. File, shell, view, help | 20 | 3 | 7 | 5 | 5 |
| **Total** | **121** | **18** | **29** | **50** | **24** |

The shape of the gap: in **"execute the burn"** (areas F–I: 52 surfaces) we have or partially have 50% and several beat-LightBurn wins. In **"make a design / run production"** (areas A–D: 42 surfaces) we have **2**, partial 9, missing 25. We are an *execute-a-design* tool; LightBurn is also a *make-a-design* and *run-production* tool. Journey evidence (researcher 4): **J1 (draw and cut a sign from nothing) is impossible in our app today; J3 (batch 20 keychains) is practically impossible** (Ctrl+D with a fixed 10 mm stagger is the only clone op — `store.ts duplicateAction` — with no numeric position, no align, no array). Meanwhile J2/J4/J5 are possible end-to-end today, and J4 is arguably already cleaner than LightBurn's.

Of the 50 missing surfaces, **14 are P0 and ~10 are P1** — that is the real to-build list. The 24 skips (camera, rotary, cloud Nest, docking, variable text, macros, warp/deform, sub-layers…) are LightBurn surface we should *decide* not to build (section 4), which closes a fifth of the headline gap by decision rather than code.

---

## 2. Master gap matrix

Legend: status `have / partial / missing / skip`; P = priority; E = effort (S = day-scale, M = phase slice, L = real phase). "LB" cites docs.lightburnsoftware.com paths; "ours" cites files in this tree (or the grep that found nothing).

### A. Creation & drawing tools

| Surface | LightBurn | Ours | Status | P | E |
|---|---|---|---|---|---|
| Tool-mode concept / left tool palette | 9 persistent tools, Esc returns to Select (Reference/UI/CreationToolbar) | None — grep toolMode/activeTool: 0 hits; toolbar buttons are one-shot commands (`Toolbar.tsx`) | missing | P0 | M |
| Rectangle tool (+ corner radius) | Ctrl+R; Shift=square, Ctrl=center; parametric W/H/radius (2.1/Reference/PrimaryShapes) | None — `SceneObject` union has no shape variant (`scene-object.ts:195`) | missing | P0 | (in Inc 1) |
| Ellipse / circle tool | Ctrl+E; Shift=circle (PrimaryShapes) | None | missing | P0 | (in Inc 1) |
| Polygon + triangle/pentagon/octagon | Draw Shapes submenu; sides editable (PrimaryShapes) | None | missing | P0 | (in Inc 1) |
| Star / dual-radius star | Points/Bulge/Ratio params (PrimaryShapes) | None | missing | P2 | S after shape variant |
| Draw Lines / pen tool | Ctrl+L; corner+smooth nodes, close, continue, snap (Reference/DrawLines) | None — only SVG/text/trace produce polylines | missing | P0 | (in Inc 1, straight-segment v1) |
| Create/Edit Text | On-canvas typing, Text Options bar, path-text, weld (Reference/UI/CreationToolbar) | Modal `AddTextDialog.tsx` (font/size/align/spacing/lineHeight) + dbl-click re-edit (`Workspace.tsx`); no on-canvas, no path-text; **PROJECT.md:85 weld claim is false** (grep weld in src: 0) | partial | P1 | M |
| Interactive shape handles (radius/sides drag) | Ctrl+drag blue/purple handles (PrimaryShapes) | None | missing | P2 | S |
| Convert to Path | Ctrl+Shift+C drops parametric props (Reference/ConvertToPath) | None (nothing parametric to convert yet) | missing | P2 | S w/ node editor |
| Barcode / QR generator | Create Bar Code tool (Reference/UI/ToolsMenu) | None | skip (park QR as backlog S once shapes exist) | P3 | S |

### B. Selection & transform

| Surface | LightBurn | Ours | Status | P | E |
|---|---|---|---|---|---|
| Select modifiers + Tab cycle | Shift add, Ctrl toggle, Tab cycles overlapping (Reference/Selection) | Click + Shift-toggle + Ctrl+A + Esc (`drag-state.ts`, `shortcuts.ts`); no Ctrl-toggle/Tab; AABB-only hit test (`hit-test.ts`) | partial | P1 | S |
| Marquee (window vs crossing) | Drag right = window, drag left = crossing (Reference/Selection) | **Documented in WORKFLOW.md F-A5:153-156, never implemented** — `computeMouseDownDrag` returns null on empty space; grep marquee: comments only | missing | P0 | M |
| Multi-select combined-bbox transforms | Selection acts as one unit everywhere (Reference/TransformControls) | `store.ts:69` comment defers it; `setObjectTransform` maps one id; nudge/flip hit primary only | partial | P0 | M |
| Numeric X/Y/W/H/rotation entry | Numeric Edits toolbar: 9-dot anchor, %, equations, inline units (Reference/NumericEditsToolbar) | **None anywhere** — `SelectedObjectProperties.tsx` has exactly one field (Power Scale); StatusBar is read-only | missing | P0 | M (v1 = S) |
| Transform handles | Corner keeps aspect by default; Ctrl=center; Esc cancels; shear (Reference/TransformControls) | 8 handles, Shift=aspect, Alt=center, rotate 15° snap (`handles.ts`, `rotate-handle.ts`); **free-aspect default diverges (bug per rule 3)**; no Esc-cancel; no shear (skip shear) | partial | P1 | S |
| Rotate hotkeys . , (90°/45°) | . , 90°; Shift 45°; Ctrl 10°/5° (Hotkeys.html) | None — rotation only via drag handle | missing | P0 | S |
| Nudge steps | 5/1/20/0.1 mm, configurable (Reference/TransformControls) | 1/10 mm fixed (`shortcuts.ts:23-24`); primary-object-only | partial | P1 | S |
| Lock / Unlock shapes | Arrange + Shape Properties Locked (Reference/LockShapes) | None — grep locked in core/scene: 0 | missing | P2 | S |
| Measure tool | Alt+M hover stats + tape (Reference/Measure) | None; StatusBar cursor/W×H only | missing | P2 | S |
| Snapping (grid + object) | Node/mid/center/intersection + grid snap; Ctrl suspends (Reference/Snapping) | None — grep snap: only rotate quantization + fill internals | missing | P1 | M |
| Grid, rulers, guides | Configurable spacing, draggable guides, T1 layer (Reference/Snapping) | Fixed-spacing grid + mm rulers (`draw-rulers.ts`); no guides | partial | P2 | S |

### C. Edit ops & clipboard

| Surface | LightBurn | Ours | Status | P | E |
|---|---|---|---|---|---|
| Cut / Copy / Paste / Paste-in-place | Ctrl+X/C/V, Alt+V, paste at cursor (Reference/UI/EditMenu) | **None** — no clipboard commands in registry; Ctrl+X/C/V unbound | missing | P0 | S |
| Duplicate | Ctrl+D in place (EditMenu) | Have — Ctrl+D with 10 mm stagger (`store.ts duplicateAction`); divergence is friendlier (no invisible copy double-burn) — record it | have | — | — |
| Invert selection / select-by (open, in-layer, contained) | 6 Edit commands (EditMenu) | Select-in-layer button only (`SelectLayerObjectsButton.tsx`) | partial | P1 | M |
| Path repair: auto-join, close, delete duplicates, optimize | Alt+J / Alt+D etc. (EditMenu) | None in core — fixes the two classic SVG import defects (open fills, doubled burns) | missing | P1 | M |
| Image Options: refresh / replace image | Edit submenu (EditMenu) | None for `RasterImage` | missing | P2 | M |
| Convert to Bitmap | Ctrl+Shift+B (Hotkeys.html) | Command exists, no hotkey (`command-registry.ts tools.convert-to-bitmap`) | partial | P2 | S |
| Undo/Redo/Select All/Delete/Esc | Standard keys (EditMenu) | Have, keys match LightBurn exactly (`command-registry.ts:187-233`) | have | — | — |

### D. Arrange & layout

| Surface | LightBurn | Ours | Status | P | E |
|---|---|---|---|---|---|
| Group / Ungroup | Ctrl+G / Ctrl+U (Reference/Grouping) | None — no group concept in scene model | missing | P0 | M |
| Align suite (L/R/T/B/centers) | Alt+arrows, last-selected anchor (Reference/UI/ArrangeMenu) | None — arrange family is exactly 2 flips (`command-registry.ts:311-347`) | missing | P0 | M (math is S) |
| Distribute / Make Same Size | Edges/centers (Reference/Distribute) | None | missing | P1 | rides w/ align |
| Grid Array | Cols/rows, spacing modes, shift/mirror, virtual (Reference/GridArray) | None; precedent exists (`material-test-grid.ts` lays out parametric grids) | missing | P0 | M |
| Circular Array | Count, angles, rotate-copies (Reference/CircularArray) | None | missing | P2 | S–M shares dialog |
| Flip H/V (+ Mirror Across Line) | Ctrl+Shift+H/V; Ctrl+Shift+M (ArrangeMenu) | Bare H/V, primary object only (`shortcuts.ts tryFlip`); keep bare keys, add aliases | partial | P1 | S |
| Move to page position / move laser to selection | 9 destinations; P = page center (ArrangeMenu) | None; note our P = preview (collision, keep ours) | missing | P2 | S |
| Z-order (push front/back) | PgUp/PgDn (ArrangeMenu) | None — array order renders | missing | P2 | M |
| Break Apart | Alt+B (ArrangeMenu) | None — waits on path model | missing | P3 | L |
| Dock (slide to edge/object) | ArrangeMenu | None | skip — niche; align+snap cover it | P3 | — |
| Nest Selected | **Online nesting service** (ArrangeMenu) | None | **skip — violates non-negotiable #8 (no network ever); offline bin-pack later = differentiator** | — | — |
| Copy Along Path | ArrangeMenu | None | skip — arc-length plumbing serves nothing else | — | — |
| Virtual (synced) arrays | GridArray option | None | skip — synced-clone infra is L, niche | — | — |
| Mirror Across Line | Ctrl+Shift+M | None | skip until pen tool exists to draw the axis | — | — |

### E. Geometry kernel

| Surface | LightBurn | Ours | Status | P | E |
|---|---|---|---|---|---|
| Weld | Ctrl+W, n-ary union; the everyday text-prep op (Reference/BooleanTools) | **Missing**, and PROJECT.md:85's "weld toggle" claim is phantom (grep: 0). Script fonts double-burn overlaps today | missing | P2 | L (first kernel consumer) |
| Boolean union/subtract/intersect + assistant | Exactly-two-shape ops, Ctrl+B assistant (BooleanTools) | Missing; recorded out of scope (PROJECT.md:311). Recommend re-opening **weld + offset only** via ADR + clipper-style lib eval (flattened polylines make this easier than LightBurn's bezier case) | missing (recorded; narrow re-open) | P2 | L |
| Offset Shapes | Alt+O: distance, in/out/both, corner styles, live preview (Reference/OffsetShapes) | Missing; doubles as the manual kerf workaround (kerf also out of scope, PROJECT.md:323) — gap counts twice. Text+offset border is the entire name-sign market | missing | P1 | L (same kernel) |
| Cut Shapes (knife) | Alt+Shift+C split via closed shape (Reference/CutShapes) | None | skip — oversize-job splitting is rare on diode beds | — | — |
| Trim Shapes | Ctrl+K segment trim (CreationToolbar) | None | skip — needs intersection infra; revisit with node editor | — | — |
| Edit Nodes | Ctrl+`; D/I/M/S/C/B/L/T/E key ops (Reference/EditNodes) | Recorded skip (PROJECT.md:310). Upgrade the record: a **polyline-grade** editor (move/insert/delete vertex, break/join, simplify slider) needs no bezier model and fixes the #1 trace-cleanup complaint — own phase + ADR later | skip (recorded; respec later) | P2 | L |
| Add Tabs | Ctrl+Tab bridges (CreationToolbar) | Recorded skip (PROJECT.md:323); revisit trigger: thin-plywood cutting feedback | skip | — | — |

### F. Layers & cut settings

| Surface | LightBurn | Ours | Status | P | E |
|---|---|---|---|---|---|
| Layer list presentation | 7-column table + quick-edit row (Reference/CutsLayersWindow) | Labeled cards (`CutsLayersPanel.tsx`, `LayerRow.tsx`) — better at 1–4 layers; needs collapsed state for 10-layer imports | partial | P2 | M |
| Color palette strip / active draw color | 32 swatches + T1/T2 tool layers (Reference/UI/ColorPalette) | Per-card Assign + Add-with-picker (`AssignSelectionButton.tsx`, `AddLayerControls.tsx`); no strip, no never-output guide layer | partial | P2 | S–M |
| Double-click opens Cut Settings Editor | Yes (Reference/CutSettingsEditor) | Have (`LayerRow.tsx` onDoubleClick + `use-cut-settings-launcher.ts`) | have | — | — |
| Show / Output toggles | Columns, faded rows (CutsLayersWindow) | Have (header toggles + dimmed card) | have | — | — |
| Layer reorder = cut order | Up/Down or drag (CutsLayersWindow) | Have (`LayerOrderControls.tsx`) | have | — | — |
| Layer utilities (copy/paste settings, select, delete) | Hidden right-click/modifier conventions (CutsLayersWindow) | Have, as visible buttons (`LayerSettingsClipboardButtons.tsx` etc.) | have | — | — |
| Per-layer Air Assist (M7/M8/M9) | Air column + device M7-vs-M8 choice (CutsLayersWindow) | None (grep airAssist/M8: nothing) — relay-switched pumps are common on xTool/Sculpfun | missing | P2 | M |
| Layer Name field | Shared tab Name (CutSettingsEditor/SharedSettings) | None — Layer is id+color+params (`layer.ts:18-56`) | missing | P2 | S |
| Min/Max power pair | Shared tab (SharedSettings) | `minPower` exists, surfaced only for grayscale images (`layer.ts:22`); defensible for GRBL M4 — surface w/ explainer | partial | P2 | S |
| Constant Power Mode (M3/M4 per layer) | GRBL-only checkbox (SharedSettings) | None — strategy hardcodes M3 vector / M4 raster; recurring forum answer (corner charring vs darkness) | missing | P2 | M + snapshot ack |
| Sub-layers ("Multi" mode) | Up to 11 sub-settings per layer (CutSettingsEditor/SubLayers) | None | skip — passes + copy-settings cover diode cases; **record it** | — | — |
| Kerf offset | Line tab (CutSettingsEditor/LineMode) | Recorded skip (PROJECT.md:323); revisit trigger: finger-joint boxes (0.1–0.2 mm press-fit); shares the offset kernel | skip | — | — |
| Perforation mode | Line tab (LineMode) | None — **not currently recorded; add to the out-of-scope line** | skip (record) | — | — |
| Lead-in/out + overcut | Advanced Line tab (LineMode) | Recorded skip (PROJECT.md:323) — entry marks negligible on 5–10 W diodes | skip | — | — |
| Z offset / Z step per pass / Z jog | Common tabs + Move window (LineMode, MoveWindow) | Recorded skip (PROJECT.md:314); autofocus-command escape hatch exists (`AutofocusEditor.tsx`); revisit trigger: motorized-Z diodes (xTool S1/Falcon2 Pro class) | skip | — | — |
| Dot mode / ramp length | Advanced extras (LineMode, FillMode) | None | skip — DSP-centric / stamp niche; **record it** | — | — |
| Offset Fill (4th mode) | Concentric fill (CutSettingsEditor/OffsetFillMode) | None — `LayerMode = line|fill|image` (`layer.ts:10`) | missing | P2 | L (shares offset kernel) |
| Fill tab (interval/LPI, angle, bidir, cross-hatch, overscan) | Full set + overscan as %-of-speed (FillMode) | Have most: `hatchAngleDeg/hatchSpacingMm/fillOverscanMm/fillBidirectional/fillCrossHatch` (`layer.ts:33-46`); angle 0–180 not 0–360; overscan in mm (clearer — record divergence) | partial (strong) | P2 | S |
| Fill grouping (all-at-once / per-shape) | 3 modes; per-shape dramatically faster on diode (FillMode; fider #4797) | None — one FillGroup per layer; 20 spread keychains sweep dead air | missing | P1 | M |
| Image tab | 10 modes, interval/DPI, dot width, negative, pass-through (ImageMode) | Have-plus: 11 dithers, interval+DPI fields, `dotWidthCorrectionMm`, `negativeImage`, `passThrough`, grayscale minPower (`layer.ts:51-55`, `CutSettingsImageFields.tsx`). Missing: image scan angle / angle increment | have (gap named) | P2 | M (scan angle) |
| Shape Properties panel | Priority, Power Scale, Locked, shape params, image enhance (Reference/ShapeProperties) | Power Scale only (`SelectedObjectProperties.tsx`, verified single field) + separate image adjust section; auto-shown (theirs hides behind Window menu) | partial | P1 | S per field cluster |

### G. Image pipeline

| Surface | LightBurn | Ours | Status | P | E |
|---|---|---|---|---|---|
| Dither algorithm set | 10 image modes incl. stylized Newsprint/Halftone/Sketch (ImageMode) | **Have 11** (`DITHER_ALGORITHMS`, `scene-object.ts:127-139`) — Burkes + 3 Sierras they lack; we lack the 3 stylized modes (skip initially) | have | P3 | S later |
| Adjust Image (B/C/gamma + enhance) | + unsharp Enhance Radius/Amount/Denoise, presets (Reference/AdjustImage) | Brightness/contrast/gamma/invert + built-in & user presets + live preview (`AdjustImageDialog*.tsx`); **no unsharp mask** — the wood-photo "pop" step | partial | P2 | M |
| Slate / dark-material preset | Two-places-to-invert confusion (forum #174203) | Invert exists; named preset missing | partial | P2 | S |
| Image scan angle + angle increment | 0–360 + per-pass increment (ImageMode) | Missing — raster sweep is horizontal-only; no layer field | missing | P2 | M (emit change + ADR-025 perceptual check) |
| Pass-through (pre-dithered input) | ImageMode | **Have** (`layer.ts:54`) | have | — | — |
| Dot width correction | Calibrated vs checkerboard (ImageMode) | **Have** (`layer.ts:55`) | have | — | — |

### H. Machine control & operator loop

| Surface | LightBurn | Ours | Status | P | E |
|---|---|---|---|---|---|
| Start / Pause / Stop + progress | Busy status + time (Reference/LaserWindow) | Have + readiness preflight, feed-hold honesty, progress bar, estimate badge (`JobControls.tsx`, `start-job-flow.ts`); add elapsed/remaining (S) | have | — | — |
| Frame (bounding box) | Frame button (LaserWindow) | Have w/ off-bed preflight + framing feed (`useFrameAction`; `laser-store.ts frame`) | have | — | — |
| Frame: laser-on + rubber-band + continuous | Low-power visible framing; hull frame (LaserWindow) | Missing all three — visible trace is THE diode alignment trick (no red-dot pointer) | partial | P1 | S (laser-on + safety ADR), M (hull) |
| Fire button (test fire) | Move window Fire + Power % — exists for diode visibility (Reference/MoveWindow) | **Missing** — laser-store has no fire action; top-3 reason users keep LaserGRBL installed | missing | P0 | S (gated: ≤10% cap, idle-only, auto-M5, ADR for laser-off invariant) |
| Console command input | Type $$, $X, $32=1 directly (Reference/ConsoleWindow) | **Missing** — `LaserLog.tsx` is read-only; grep sendCommand: 0. Cheapest highest-leverage gap in machine control | missing | P0 | S |
| Macros window | Unlimited macro buttons (2.1/Reference/MacrosWindow) | Recorded skip (PROJECT.md:324); `autofocusCommand` is the one safe slot | skip | — | — |
| Position Laser (click canvas to move head) | Alt+L tool (CreationToolbar) | Missing — JogPad directional steps only; all plumbing exists ($J + mm/px mapping) | missing | P1 | S |
| Continuous jog + speed + free distance | Hold-to-jog via $J (MoveWindow) | Step jog 0.1/1/10/100 mm only (`JogPad.tsx`, comment defers continuous) | partial | P1 | M |
| Go to origin / go-to-XY / saved positions | Go button + saved dropdown (MoveWindow, LaserWindow) | Missing — G92 set/reset exist (`OriginRow`), no goto, no saved slots | missing | P1 | S |
| Live head crosshair on canvas | Static "last position" marker (LaserWindow) | Missing — MPos polls at 4 Hz but renders as numbers only (`StatusDisplay.tsx`); ours would be live, beating theirs | missing | P2 | S |
| In-job speed/power overrides | GRBL real-time bytes ±10% (MoveWindow) | Missing — running controls are pause/resume/stop only | missing | P2 | M |
| Cut Selected Graphics / selection origin | Checkboxes (LaserWindow) | Missing — start always compiles whole project (`prepareStartJob`); needed to re-burn 1 of 20 parts | missing | P1 | M |
| Run saved G-code file | Run GCode button (LaserWindow) | Missing — startJob takes fresh compile only; gate behind bounds + laser-off preflight parse | missing | P2 | M |
| Optimization settings | 8+ planner options (Reference/OptimizationSettings) | One option: reduce travel (`OptimizationSettingsDialog.tsx`). **Cut inner shapes first** is the scrapped-material fix; then remove-overlapping-lines; skip backlash esoterica (record) | partial | P1 | M |
| Devices manager / profiles | Find My Laser wizard, .lbdev import/export (Reference/Devices) | Single inline editable profile + WebSerial chooser + $$ banner (`DeviceSettings.tsx`); add named-profile store (localStorage); skip the wizard | partial | P2 | M |
| Center Finder | 3-point rim → center (Reference/UI/LaserToolsMenu) | Missing — circumcenter over jogged points; chain into Set Origin | missing | P2 | M |
| Home + alarm unlock | Homing cycle (LaserWindow) | Have ($H gated on device homing; unlockAlarm in laser-store) | have | — | — |
| Start From + 9-dot job origin | THE beginner trap (Reference/CoordinatesOrigin; forum #100874) | Have — 3 modes + 9-dot grid, anchor disabled under absolute, set-origin auto-switches + toast (`JobPlacementControls.tsx`) | have | — | — |

**Ours-only (no LightBurn equivalent):** job start/stop hotkeys with modal-bypassing panic stop (`use-job-shortcuts.ts`; absent from LightBurn's Hotkeys.html); connect-time $$ auto-config diff banner (`DetectedSettingsBanner.tsx`); proposed placement ghost (destination rectangle drawn live before Start — build it, Inc 4).

### I. Calibration & libraries

| Surface | LightBurn | Ours | Status | P | E |
|---|---|---|---|---|---|
| Material Test generator | Any-two-axes grid, **engraved value labels**, presets, safe order (Reference/MaterialTest) | Dialog + per-cell powerScale grid (`MaterialTestDialog.tsx`, `material-test-grid.ts`) but **zero labels** (verified grep), axes fixed speed×power, no presets — operator counts cells by eye on burned scrap | partial | P1 | S |
| Interval Test | Speed/power/steps/min-max + fill-type choice (Reference/IntervalTest) | Dialog matches recommended 0.08–0.2 band (`IntervalTestDialog.tsx`); no labels, no dithered-swatch variant | partial | P2 | S |
| Material Library | .clb files, create-from-layer, assign vs link (2.1/Reference/MaterialLibrary) | Have — panel, .lfml.json New/Load/Save, create-from-layer, assign, **auto localStorage persistence** (`MaterialLibraryPanel.tsx`, ADR-044/045) | have | — | — |
| Link (synced) presets | Read-only linked layers (MaterialLibrary) | Missing; properly recorded deferral (PROJECT.md:316); copy-on-assign is less surprising — keep | missing (recorded) | P2 | M |
| .clb one-way importer | Years of dialed-in settings live in .clb | Missing; recorded out of scope (PROJECT.md:316) — **but our declared user is a LightBurn switcher; a read-only importer is the cheapest migration magnet. Re-open via ADR** | missing (re-open) | P2 | M |
| Art Library | .lbart reusable artwork (Reference/ArtLibrary) | Missing and **unrecorded** — record the skip; "insert from another .lf2" if demand appears | skip (record) | — | — |
| Variable Text / CSV merge | Window + Grid Array auto-increment (Reference/VariableText) | Recorded skip (PROJECT.md:325); revisit trigger: after Grid Array ships, name-personalized batches become the next ask | skip | — | — |

### J. File, shell, view, help

| Surface | LightBurn | Ours | Status | P | E |
|---|---|---|---|---|---|
| Menu shell (submenus, mnemonics) | 8 menus, ~120 commands, nested submenus (Reference/UI/Menus) | 7 families, **28 commands** (`command-registry.ts:13-41`), single-level only; registry design itself is better (one command, every surface) | partial | P1 | M |
| New/Open/Save/Save As | Ctrl+N/O/S/Shift+S (FileMenu) | Have, identical keys + dirty checks | have | — | — |
| Import formats | ~20 formats, one Ctrl+I entry (FileMenu) | SVG (Ctrl+I) + PNG/JPG, two entries; unify entry (S). DXF: recorded skip (PROJECT.md:322) with revisit trigger — box-generator users are our persona | partial | P1 | S now, L for DXF |
| Recent Projects | 24-entry submenu (FileMenu) | Missing (grep recent: autosave only); web side needs IndexedDB handle persistence + re-grant | missing | P1 | M |
| Export vector (SVG) | Alt+X to .ai/.svg/.dxf (FileMenu) | Missing — `io/svg` is parse-only; SVG-only export enables the Inkscape round-trip; skip .ai/.dxf export | missing | P2 | M |
| Save G-code | Alt+Shift+L; **Ctrl+E is Draw Ellipse** (Hotkeys.html) | Have on Ctrl+E — direct muscle-memory collision; alias Alt+Shift+L now, migrate Ctrl+E→Ellipse when shapes ship (before it entrenches) | have (collision) | P1 | S |
| Settings / Preferences dialog | App settings + nudge distances + hotkey editor (EditMenu, FileMenu) | Missing — only per-feature dialogs; nudge hard-coded (`shortcuts.ts:23-24`) | missing | P1 | M |
| Hotkey remap editor | Edit Hotkeys, all bindings (Reference/EditHotkeys) | Missing | skip-defer — registry already pairs ids+shortcuts; ship **keymap presets (ours / LightBurn)** instead | P3 | M |
| Hotkey map fidelity / aliases | ~90 default bindings (Hotkeys.html) | ~24 bindings; exact matches on all file/edit keys; collisions: Ctrl+E, P; gaps: Ctrl+Shift+H/V, Alt+P, Ctrl+0/=/-, Ctrl+Shift+A, Alt+T/I/L, . , | partial | P0 | S |
| F1 help / shortcut discovery | F1 notes + hotkey PDF (HelpMenu) | `help.about` only; static `SHORTCUT_HINT` tooltip already drifts (omits Shift+F, Ctrl+D, Ctrl+Enter, Ctrl+.) | partial | P1 | S (generate from registry) |
| Right-click context menu | Primary surface for image/group verbs (TraceImage, AdjustImage docs) | Missing — right-drag is pan (`Workspace.tsx` preventDefault); show on release-without-drag, populate from registry | missing | P1 | M |
| Window menu / docking | 19 dockables + Reset Layout + F12 (Reference/UI/WindowMenu) | 2 commands (preview, fit); fixed layout **by design** — no lost-panel failure mode; skip docking, record it | partial (skip docking) | P2 | — |
| View zoom aliases | Ctrl+=/-/0, Ctrl+Shift+A frame selection (Hotkeys.html) | Bare +/-/0/F + Shift+F (`shortcuts.ts`); add LB aliases | partial | P1 | rides hotkey pass |
| Zoom / pan / fit | Wheel-at-cursor, toolbar buttons (Reference/ZoomPan) | Have — wheel/pinch at cursor, right+middle+Space pan (superset), on-canvas zoom cluster | have | — | — |
| Preview window | Modal: play, speed, shade-by-power, time breakdown, Start Here (Reference/Preview) | In-canvas overlay + scrubber + travel moves + head marker (`draw-preview.ts`, `overlays.tsx`) — better context; missing shade-by-power (blocks perceptual verification of power work), time breakdown, "start from here" resume | partial | P1 | M |
| Print / Bundles / New Window / background capture | FileMenu long tail | None | skip — DTP bloat; Show Notes → backlog S | — | — |
| Camera suite | 2.1 overhauled multi-camera + wizards (2.1/Reference/Cameras) | Recorded skip (PROJECT.md:312). Honest note: LightBurn's stickiest retention feature for the xTool crowd; our counter is the J4 manual trio. Budget the L phase only when hunting switchers outright | skip | — | — |
| Print and Cut | 2-point registration (Reference/PrintAndCut) | Missing — park as the camera-less precision answer (affine from two jogged marks) | missing | P3 | M |
| Rotary / galvo / cylinder / focus test | LaserToolsMenu cluster | Recorded skips (PROJECT.md:313-314) — correct for GRBL diode | skip | — | — |
| Beginner Mode | Exists because the full UI overwhelms (their forums/reviews) | N/A — our default IS the simple app; no mode switch to discover | skip (record as strategy) | — | — |

---

## 3. What we already beat them on

Evidence-based, current tree:

1. **Keyboard panic stop + start** — Ctrl+. stop bypasses modals and editable-target gates (`src/ui/laser/use-job-shortcuts.ts`); LightBurn ships **no** default start/stop hotkeys at all (Hotkeys.html). A genuine safety differentiator.
2. **Connect-time firmware sync** — $$ dump parsed into an old→new diff banner with one-click apply (`DetectedSettingsBanner.tsx`); LightBurn requires a manual Machine Settings round-trip, and $30/S-value mismatch is a classic forum burn.
3. **Accurate time estimates out of the box** — GRBL-planner-aware model fed by auto-detected $$ (`src/core/job/estimate-duration.ts`, `live-job-estimate.ts`); LightBurn's own troubleshooting docs admit estimates are wrong until manually calibrated.
4. **WYSIWYG raster preview by default** (ADR-028) — exact dither/power simulation with no hidden "shade according to power" checkbox.
5. **In-canvas preview** with scrubber, travel moves, and head marker that keeps bed context (`draw-preview.ts`) vs LightBurn's context-losing modal.
6. **11 error-diffusion dither algorithms vs their 10** (`scene-object.ts:127-139`) — Burkes plus three Sierras they lack; live DPI↔interval dual fields.
7. **Every disabled command explains itself** — `disabledReason` tooltips (`command-registry.ts:133-151`) vs silent graying.
8. **Preflight that refuses bad jobs by name** — off-bed framing/start refusal with the overscan named in the bounds error (commit ef5b99f) vs LightBurn grinding into rails on $20=0 machines.
9. **Material library that cannot be lost** — auto localStorage persistence/restore (F-ML1) vs .clb file juggling and lost-library forum threads.
10. **Set-origin auto-switches Start From + toast** — removes the stale-dropdown wrong-frame trap LightBurn leaves open.
11. **Tests are ordinary scene objects** — Material/Interval grids flow through normal preview/save/start (ADR-044) vs LightBurn's special-cased generator.
12. **Labeled layer cards with visible utility buttons** vs a cryptic 7-column table with hidden right-click conventions — strictly better at the diode-typical 1–4 layers.
13. **Hardened import path** — SVG sanitizer href-bypass closed with a malicious corpus (commit f741cc9) and a registry-driven single command surface that keeps menu/toolbar/hotkeys in sync by construction.

---

## 4. Deliberate skips (record each in DECISIONS.md)

Already recorded in PROJECT.md:303-326 — keep: node editing (310), boolean ops (311; narrowed — see Inc 8), camera (312), rotary (313), Z-axis (314), .clb/link presets (316; .clb re-opened below), multi-machine (320), cloud/accounts (321), DXF/AI/PDF (322; DXF gets a revisit trigger), tabs/kerf/lead-in (323), macros/scripting/command palette (324), variable text (325; revisit trigger post-Grid-Array), system fonts (326).

**New decisions to record (currently accidents, not choices):**

| Skip | One-line reason |
|---|---|
| Nest Selected | LightBurn's Nest is an **online service** — violates non-negotiable #8 (no network, ever); offline shelf-packing later would beat it for privacy/offline users |
| Docking windows + Reset Layout | Fixed shell eliminates the lost-panel failure mode that forces LightBurn to ship a reset button |
| Beginner Mode switch | Simple-by-default IS the product; advanced fields already appear contextually |
| Sub-layers ("Multi" mode) | Passes + copy-layer-settings covers score-then-cut at a fraction of the UI complexity |
| Warp / Deform / Two-Point Rotate-Scale / Tangent Circle / shear handles | Galvo-and-cylinder correction workflows and CAD trivia — not GRBL diode work (exception: QR generator → backlog S once shapes exist) |
| Copy Along Path + Virtual Arrays | Arc-length and synced-clone infrastructure serving nothing else we need |
| Cut Shapes / Trim Shapes | Rare on diode beds; revisit only after the kernel/node-editor exist |
| Perforation, dot mode, ramp length | Cardstock/DSP/stamp niches — add to the PROJECT.md out-of-scope line so the omission is a decision |
| Print, Bundles, New Window, Save Background Capture | Desktop-publishing bloat (Show Notes → backlog S: a notes field in .lf2) |
| Hotkey remap editor | Dual keymap presets (ours + LightBurn aliases) beat a one-binding-at-a-time editor; registry makes a remap layer cheap later |
| Art Library (.lbart) | OS file manager + .lf2 projects cover reuse; "insert from another .lf2" if demand appears |
| Newsprint / Halftone / Sketch dithers | Stylized niche; we already exceed on error-diffusion modes |
| Mirror Across Line | Pointless until the pen tool can draw the axis |
| Backlash/direction-order optimizer options | Belt-driven diodes rarely need them; keep the planner dialog small |
| Language menu | Until i18n exists |

---

## 5. The build plan

Sequenced for a solo maintainer in small reviewable diffs (CLAUDE.md rule 1). Each increment names the journey it unlocks (researcher 4's scorecard). Architecture note: every creation feature reduces to **one new `kind:'shape'` SceneObject variant** that carries a parametric block plus materialized `paths: ColoredPath[]` — exactly the `TextObject` precedent (`scene-object.ts:74-95`) — so compile/preview/emit are untouched and `assertNever` forces exactly one new switch arm per consumer.

### Increment 1 — Drawing Tools v1 (M) → J1: impossible → possible
The maintainer's headline ask. Contents:
- `toolMode` discriminated union in ui-store (`{kind:'select'} | {kind:'draw'; shape:'rect'|'ellipse'|'polygon'|'polyline'}`), vertical left tool strip, Esc always returns to select; Workspace mousedown dispatches on toolMode before existing drag logic.
- New pure module `src/core/shapes/` (shape→polylines, adaptive ellipse tolerance reusing `flatten-curves.ts` math).
- **Rectangle** (Shift=square, Ctrl=center, numeric `cornerRadiusMm`), **Ellipse** (Shift=circle), **Polygon** (sides 3–24 + 3/5/6/8 preset chips — one tool replaces LightBurn's four menu entries), **Pen** (straight segments: click=vertex, click-start=close, Esc/double-click=finish, Shift=45°).
- New shapes land on the **currently selected layer** with live mm dimensions in the existing DragReadout; status bar shows active tool + modifier hints (LightBurn shows neither). Simple mm grid-snap while drawing, Ctrl suspends.
- Hotkeys: Ctrl+R=rect; alias Alt+Shift+L for Save G-code now and migrate Ctrl+E→Ellipse in this increment, before the collision entrenches.

### Increment 2 — Precision Editing (M) → J1 competitive ("a 50×80 mm box"), J3 foundation
- **Numeric Edits row v1**: X/Y/W/H/Rot + aspect lock above the canvas, top-left anchor, writing through `transformedBBox`/`setObjectTransform` with the existing `use-debounced-commit` pattern; v2 adds 9-dot anchor, %, expressions, inline "2in" (display stays mm-only per non-negotiable #6).
- **Combined-bbox multi-select transforms** — pay down the `store.ts:69` deferral: a selection-transform helper fans deltas/scales to every selected id in one undo step. Prereq for everything below.
- **Marquee** (F-A5 as documented): window-select v1, then direction-based window/crossing.
- Rotate `.` / `,` hotkeys; corner handles default to keep-aspect (Shift breaks — LightBurn/Figma convention; our current default is a bug per rule 3); Ctrl center-scale alias; Esc cancels mid-drag; 0.1 mm fine nudge; nudge/flip honor the whole selection.

### Increment 3 — Production Layout (M) → J3: impossible → possible
- **In-app clipboard**: Ctrl+X/C/V paste-at-cursor (cursorMm already tracked), Alt+V paste-in-place; accept OS-clipboard PNG paste as image import.
- **Group/Ungroup** via flat `groupId` field (not nested containers — ADR records flat-vs-nested; .lf2 stays flat/additive). Also unblocks ADR-026's trace+source pairing.
- **Align (6) + Distribute (2)** — pure bbox math, last-selected anchor (LightBurn semantics), Alt+arrow bindings.
- **Grid Array** — rows/cols/spacing dialog cloning the selection (MaterialTestDialog scaffolding is the template) **plus a "Fill bed" mode** computing max cols×rows from part bounds + gap + bed — LightBurn makes you do that arithmetic. Circular Array rides along if trivial (duplicate + rotate about center).

### Increment 4 — Operator Loop (M, a bundle of S slices) → J4: better than LightBurn without a camera
- **Console input row** under the LaserLog: one line while idle/alarm, TX echoed, blocked during jobs (the cheapest highest-leverage machine-control gap; ends the keep-LaserGRBL-installed era).
- **Fire button**: default 1%, hard cap ~10%, idle-only, loud armed state, auto-M5 on any other action/disconnect; safety ADR records it as the explicit exception to the laser-off invariant.
- **Position Laser** toolMode: click canvas → bounds-checked $J move; **Go to origin** + go-to-XY + 3–5 saved positions.
- **Live head crosshair** from the existing 250 ms poll (genuinely live vs their static marker) + **placement ghost**: destination rectangle drawn before Start under current-position/user-origin — kills the #1 "burned my desk" failure visually.
- **Laser-on framing** at capped low S behind hold/confirm (safety ADR); continuous hold-to-jog + jog speed field ($J + cancel already exist).

### Increment 5 — Calibration Closes the Loop (S–M) → J5: beats LightBurn's 14-step flow
- Material Test: **engraved axis value labels** via the existing `core/text` pipeline (the difference between usable and academic), settings header, Diode Engrave/Cut presets, and **click-the-winning-cell → apply to layer / save as library preset** (cells already carry speed/power) — collapses LightBurn's read-note-retype-save steps to one click.
- Interval Test: engraved labels + dithered-image swatch variant.

### Increment 6 — Photo Engrave Polish (M) → J2: fully competitive
- Unsharp mask (radius/amount) in Adjust Image; "Slate/dark material" preset bundling invert+gamma; image scan angle (emit-path change, perceptually verified per ADR-025); surface the job estimate in status bar/preview header so disconnected planners see it. (Dither set needs nothing — already 11 algorithms.)

### Increment 7 — Switcher Magnet & Shell (M)
- **Hotkey alias pass** (S, do early if slack appears): accept LightBurn bindings wherever conflict-free (Ctrl+Shift+H/V, Alt+P, Ctrl+0/=/-, Ctrl+Shift+A, Alt+T/I/L); document the real map in WORKFLOW.md F-A15; **F1 overlay generated from the registry** so it can never drift (replaces the stale SHORTCUT_HINT).
- Right-click context menu on release-without-drag (right-drag pan survives), populated from the registry's existing enablement logic.
- Recent Projects (IndexedDB handles + re-grant flow); Settings dialog (units/grid/nudge + read-only keymap, presets "LaserForge"/"LightBurn"); unified Import entry; **one-way .clb importer** (ADR re-opening PROJECT.md:316 — the single cheapest migration magnet for our declared user).

### Increment 8 — Geometry Kernel (L, a real phase, ADR + library eval first)
Evaluate MIT-compatible polygon clipping (polygon-clipping / clipper2 ports) per ADR-017 — our flattened polylines make this easier than LightBurn's bezier case. Ship order: **Weld** (n-ary union; first consumer = text glyph overlap, finally making PROJECT.md:85 true) → **outward Offset** + a one-click "cut border around selection onto a chosen layer" preset (the entire name-sign/keychain recipe) → inward/both → Offset Fill and the kerf revisit share the same core. Defer subtract/intersect/assistant. Perceptual-harness coverage (ADR-025) is mandatory — booleans change cut contours.

### Slot-in backlog (S/M singles between increments)
Cut-inner-shapes-first + remove-overlapping-lines (optimization, M); per-shape fill grouping with **auto-pick by planner estimate** ("saved 12 min" — the thing LightBurn's users beg for in fider #4797, M); cut-selected-only (M); layer names (S); air assist (M, snapshot ack); constant-power M3/M4 (M, snapshot ack); lock objects (S); measure tool (S); path repair auto-join/dedupe (M); Center Finder (M); Run G-code file (M); in-job overrides (M); SVG export (M); preview shade-by-power + start-from-here (M); elapsed/remaining on progress (S).

---

## 6. Five journeys scorecard

| Journey | LightBurn 2.1 | LaserForge today | After the plan |
|---|---|---|---|
| **J1 — draw & cut a sign from nothing** | 11 in-app steps (docs SimpleProject.html) | **IMPOSSIBLE** — zero drawing tools; text-only signs ~6 steps | Inc 1–2: possible in ~7–8 steps with live-mm drawing + numeric sizing; Inc 8 (offset border) reaches full sign-shop parity |
| **J2 — photo engrave** | 5-step calibration guide + import/adjust/dither/preview/run | **POSSIBLE**, ~7 steps; 11 dithers + WYSIWYG preview already; missing sharpen | Inc 6: competitive-to-better — accurate estimates and no hidden shade checkbox are existing wins |
| **J3 — batch 20 keychains** | design → Grid Array → fill grouping → run | **Effectively impossible** — Ctrl+D ×20 hand-dragged, no numeric/align/array | Inc 2–3: possible (array + fill-bed + align + clipboard); fill-grouping slot-in makes it faster than LightBurn (auto-grouped by estimate) |
| **J4 — position on an object** | Camera wizards, or origin dance with chronic forum confusion (#100874) | **POSSIBLE**, ~5 steps — already our cleanest journey (jog → set origin → 9-dot → frame) | Inc 4: **better than LightBurn without a camera** — click-to-position, visible low-power frame, placement ghost, live crosshair |
| **J5 — dial in a new material** | 14 steps incl. preset + library save (FirstMaterialTest) | **POSSIBLE**, ~8 steps, but reading an unlabeled burned grid by counting cells | Inc 5: ~5 steps; labels + click-winning-cell-to-apply beat their flow outright |

Two M-sized increments (1–2) flip J1; one more (3) flips J3; the rest make all five competitive or better. The "fresh install → first cut < 10 min, no docs" metric (PROJECT.md) is winnable on J4/J5 today and on all five after Increment 5.

---

## Appendix A — doc/code divergences to fix now (docs-only, S)

1. **PROJECT.md:85** — Phase D claims a text "weld toggle"; `grep -i weld src/` = zero hits. Remove or implement (Inc 8 makes it true).
2. **WORKFLOW.md F-A5:153-156** — documents marquee selection that was never implemented (`computeMouseDownDrag` returns null on empty space). Mark unimplemented or build (Inc 2).
3. **PROJECT.md:307** — "Out of scope" still lists "Raster engrave (Fill, Image modes)" although Phase F shipped both (`layer.ts:10`). Stale line.
4. **Toolbar.tsx SHORTCUT_HINT** — hand-written hotkey hint already omits Shift+F, Ctrl+D, Ctrl+Enter, Ctrl+. — replace with registry-derived text (Inc 7).
5. Prior audit docs state **27** registry commands; the `CommandId` union holds **28**.

## Appendix B — primary sources

- lightburnsoftware.com/blogs/news/lightburn-2-1-02-patch-release (version verification, fetched 2026-06-11)
- docs.lightburnsoftware.com — Reference pages cited per row: CreationToolbar, PrimaryShapes, DrawLines, EditNodes, Selection, TransformControls, NumericEditsToolbar, ShapeProperties, Grouping, GridArray, CircularArray, BooleanTools, OffsetShapes, CutShapes, Snapping, Measure, CutsLayersWindow, CutSettingsEditor (Shared/Line/Fill/Image/OffsetFill/SubLayers), ColorPalette, LaserWindow, MoveWindow, ConsoleWindow, MacrosWindow, OptimizationSettings, Devices, MaterialTest, IntervalTest, MaterialLibrary, ArtLibrary, VariableText, Preview, CoordinatesOrigin, Cameras, PrintAndCut, UI/{File,Edit,Tools,Arrange,LaserTools,Window,Help}Menu, EditHotkeys, Hotkeys.html
- forum.lightburnsoftware.com threads: #100874 (origin confusion), #161815 (grid-array batches), #39524 + fider #4797 (fill grouping), #174203 (slate invert), InaccurateTimeEstimates troubleshooting
- This tree (branch fix/audit-2026-06-10): `src/ui/commands/command-registry.ts`, `src/core/scene/{scene-object,layer,hit-test}.ts`, `src/ui/layers/*`, `src/ui/laser/*`, `src/ui/workspace/*`, `src/ui/app/shortcuts.ts`, `src/core/job/material-test-grid.ts`, `WORKFLOW.md`, `PROJECT.md`, `LIGHTBURN-STUDY.md`
