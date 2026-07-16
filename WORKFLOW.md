# WORKFLOW.md — KerfDesk user flows

> Per developer-brain §6, every flow specifies four states: **success**, **error**, **empty**, **edge**. This file is the source of truth for what the UI does at each step. UI changes that contradict this file require a `WORKFLOW.md` update first.
>
> This document has **Phase A, Phase B, Phase F (F.1-F.5), CNC/router (F-CNC1..F-CNC35), Phase I multi-controller, and Phase K box generator flows written**. Phase C / D / E sections are still stubs and will be filled retroactively from ADR-016. Code is shipped through Phase K (well beyond the older through-F.3 framing) — the gap is documentation density, not implementation.

---

## Phase A flows

### F-A1. App launch

#### Success — first run (no prior project)
1. App opens to **empty workspace** state (see F-A2).
2. Status bar shows: `Ready · No device configured · Empty workspace`.
3. **No** welcome modal, **no** onboarding tour, **no** "what's new" dialog. Just the workspace.
4. Default device profile is auto-loaded:
   - Name: `Default 400×400`
   - Bed: 400 × 400 mm
   - Max feed: 6000 mm/min
   - Max power S: 1000
   - Origin: front-left
   - Homing: disabled
5. The user can override this in Settings → Device Profile (Phase C; in Phase A it lives in a `device-profile.json` file the user can edit directly, with a doc in `README`).

#### Success — returning run (had a project last session)
1. App opens to empty workspace.
2. **Phase A does not auto-reopen the last project.** Autosave + recovery is a Phase C feature.
3. User opens via `File → Open Recent` (Phase C) or `File → Open` (Phase A).

#### Empty — no display capability (web only)
1. If `<canvas>` is unsupported, show full-page error: "KerfDesk requires a modern browser. Try Chrome, Edge, or Brave."

#### Error — WebSerial not supported (web only, blocking only for Phase B+)
1. In Phase A, no error. Phase A doesn't use WebSerial.
2. In Phase B+, attempting to connect shows: "Your browser doesn't support WebSerial. Use Chrome, Edge, Brave (may require enabling under Brave Shields/flags), or Arc, or install the Windows desktop app."

---

### F-A2. Empty workspace state

#### Visible elements
- **Machine bed**: filled rectangle at device dimensions (default 400×400 mm), origin marker at front-left.
- **Rulers**: top and left, mm units, increments every 10mm with labels every 50mm.
- **Grid**: light dotted, 10mm spacing, behind bed.
- **Origin marker**: small cross at the device-profile origin.
- **Drop hint**: centered ghost text "Drag an SVG here, or use File → Import" — visible only when scene is empty, fades out on hover.
- **Status bar**: bottom — current cursor mm coords, zoom level, device name, scene object count.
- **Top command toolbar**: one non-wrapping row. Familiar file, import, export, Preview, and Shortcuts actions use icon-only buttons with accessible names and hover help. Specialist tools keep icon-plus-label at wide widths and become icon-only at 1280 px and below. Below 700 px the redundant brand wordmark hides; if the window is still narrower than the command set, the command group scrolls horizontally instead of creating a second row.
- **Artwork / Operations panel**: docked right with **Settings**, **Run order**, and **Materials** views in Laser mode; CNC keeps Settings and Run order. Settings is the default. Run order widens the same docked rail while the canvas remains on the left; it is not a modal or a third sidebar. Materials owns reusable preset and saved-library management without displacing the active job workflow. A header chevron collapses the rail to a narrow named strip; the same strip expands it.
- **Machine controls panel**: docked at the far right with the same collapse/expand pattern. It may be collapsed during a job because active run controls live independently in the top Live Motion bar.
- **Live Motion bar**: hidden while idle. During a job, frame, jog, probe, home, or other owned controller operation it appears directly below the command shell and above the workspace. It shows state/progress plus the only visible Pause, Resume, Continue, and software Abort actions. Targets are at least 48 px high; Abort is labelled **ABORT JOB** or **ABORT MOTION** and remains above dialogs without covering workspace content.
- **Laptop workspace**: at 1100 px wide or below, the machine rail starts collapsed while Cuts/Layers remains visible, preserving editing space without hiding the layer workflow.
- **Compact workspace**: at 700 px wide or below, both right rails start collapsed so the canvas remains usable. Either named strip can be expanded, and entering either responsive range again reapplies only its collapsed default.
- **Left tool strip (ADR-051)**: Select, Node, Measure, the drawing tools (Rectangle, Ellipse, Polygon, Star, Pen), and Position-laser, plus a Library ("Lib") button. Preview lives in the top toolbar and the Window menu, not here.
- **Window menu**: checked `Cuts / Layers Panel` and `Machine Controls Panel` commands mirror the two panel states. `Toggle Side Panels` (`F12`) hides or restores both, and `Reset Workspace Layout` restores both panels. Panel visibility does not affect the Live Motion bar.

#### Disabled controls
- `File → Save Project`
- `File → Save Project As`
- `File → Save G-code`
- Preview toggle
- All transform controls
- Cuts/Layers row controls

#### Enabled controls
- `File → New` (no-op when already empty)
- `File → Open Project`
- `File → Import SVG`
- Pan, Zoom, Zoom-fit
- Help, About

---

### F-A3. Import SVG — drag and drop

#### Success — single valid SVG
1. User drags an SVG file from desktop / Finder / Explorer into the app window.
2. On `dragenter`, viewport shows a dashed-blue overlay with text "Drop to import" centered.
3. On `drop`:
   1. Overlay disappears.
   2. SVG is sanitized-and-parsed via DOMPurify (`USE_PROFILES: { svg: true, svgFilters: true }` plus a custom hook that strips `<script>`, `<foreignObject>`, external `xlink:href`, and non-image data URIs). DOMPurify returns a clean DOM; we do not re-parse the source string after sanitization.
   3. Geometry walked out of the sanitized DOM into internal Scene objects.
   4. Object is placed centered on the bed by default, at its natural mm size from the SVG `viewBox`.
   5. Object is auto-selected (selection handles visible).
   6. Artwork Operations auto-populates with one named operation for the imported artwork. Its
      presentation color is assigned from the automatic high-contrast palette; source SVG colors
      are preserved inside the artwork.
   7. Toast: `Imported design.svg — 1 artwork`.

#### Success — multiple files at once
1. User drops 3 SVG files simultaneously.
2. Each is imported in drop order.
3. Each is offset 10mm right + 10mm down from the previous to avoid full overlap.
4. After import, all imported objects are multi-selected.
5. Toast: `Imported 3 designs · 3 artwork operations`.

#### Success — SVG with embedded raster image
1. Phase A ignores embedded raster (`<image>` elements).
2. Sanitized count appears in toast: `Imported design.svg · 1 embedded image ignored (Phase E will support these)`.

#### Error — file is not an SVG
1. On drop, file type is checked by MIME and by content sniff (first 200 bytes).
2. If not SVG: toast (error variant, red): `Not a valid SVG: <filename>`. No state change.

#### Error — SVG fails to parse
1. SVG is structurally invalid (malformed XML, missing root, etc.).
2. Toast (error): `Could not parse <filename>: <one-line reason>`. No state change.

#### Error — SVG file too large
1. Threshold: 25 MB raw file size.
2. Modal: `<filename> is larger than 25 MB (actual: 31 MB). Importing it may slow the app. Import anyway?` with buttons `Cancel` / `Import anyway`.
3. If user proceeds and the parse takes > 5 s, viewport shows a non-blocking spinner with "Parsing large SVG…"

#### Error — SVG contains malicious content
1. `<script>` tags stripped silently; count surfaced in toast: `Imported · sanitized 2 script tags`.
2. External `xlink:href` resources stripped silently; count in toast.
3. `<foreignObject>` elements stripped silently; count in toast.

#### Empty — SVG has no drawable geometry
1. SVG parses but contains no paths, shapes, or text.
2. Toast (warning): `<filename> has no drawable content`. No state change.

#### Edge — SVG is larger than the machine bed
1. After import, the object's bounding box is checked against bed dimensions.
2. If any part is outside bed: warning toast `Design extends beyond bed. Resize or reposition before generating G-code.`
3. Out-of-bounds geometry shows a red dashed outline overlay on the viewport.
4. Save G-code button is *not* disabled at this stage; preflight check at G-code generation is where it blocks (F-A8).

#### Edge — SVG uses unit-less coordinates
1. SVG without explicit units (no `mm`, `cm`, `in`, `px`): treated as mm per laser-community convention.
2. Toast (info): `<filename> has no units — assuming millimeters`.

#### Edge — SVG `<text>` elements
1. Phase A ignores `<text>` elements (text → paths conversion is Phase D).
2. Toast (info): `<filename> · 4 text elements ignored. Convert text to paths in your design tool, or wait for Phase D.`

---

### F-A4. Import SVG — via File menu

Identical to F-A3 except:
- Triggered by `File → Import SVG` (`Cmd/Ctrl+I`).
- OS-native file picker (Electron) or browser file picker (web).
- Multi-select supported in the picker.

---

### F-A5. Selection

#### Single object — click
1. Click on an object's visible geometry.
2. Object highlights with blue outline; 8 resize handles + 1 rotation handle appear.
3. Status bar updates: `1 selected · 120 × 80 mm · X 50.0, Y 50.0`.

#### Multi — shift+click
1. Shift+click on additional object.
2. Both objects are now selected; selection box wraps their combined bounding box.
3. Resize handles operate on the combined box.

#### Overlapping objects — Alt+click
1. Alt+click where two or more selectable objects cross or overlap.
2. The topmost candidate is selected first; repeated Alt+clicks at the same point cycle downward
   through the local draw-order stack and wrap to the top.
3. Shift+Alt+click toggles the cycled candidate in the current multi-selection.
4. Hidden-layer and locked objects are excluded. Ordinary click selection remains geometry-based.

#### Multi — marquee
1. Click+drag in empty workspace area.
2. Dashed-blue marquee box follows cursor.
3. On release, selection is directional (LightBurn-style), keyed on the drag's horizontal direction: dragging left→right is an **enclosing** select (only objects whose bounding box is fully inside the marquee); dragging right→left is a **crossing** select (objects inside or merely touched).
4. Locked objects inside the marquee are skipped.

#### All — Cmd/Ctrl+A
1. Selects every object in the scene.

#### Deselect — Escape or click in empty space
1. Selection cleared. Status bar updates: `Nothing selected`.
2. Exception — single-artwork scene (ADR-222): when the scene's only artwork is selectable
   (unlocked, on a visible layer; the registration jig / board outline is not artwork), deselect
   immediately re-marks it. The lone artwork is selected by default everywhere: import, Open,
   New, undo/redo, and deleting down to one artwork all land with it selected.

#### Edge — locked object
1. Edit menu `Lock Selection` locks selected artwork and clears selection.
2. Normal click, marquee, Select All, and transform tools skip locked objects.
3. Edit menu `Unlock All` unlocks every locked object in the project.

---

### F-A6. Transform — move, scale, rotate, mirror

#### Move — drag
1. Drag visible selected geometry, or drag the four-arrow handle at the center of the single or
   combined selection box. The center handle has a fixed screen-size target at every zoom.
2. The center handle takes precedence over artwork below it and the cursor changes to a move cursor.
   Blank space elsewhere inside a hollow object's bounds remains transparent to ordinary selection,
   so large outlines do not become invisible slabs over nested artwork.
3. Object follows cursor in real time.
4. Status bar shows live coords.
5. On release, change is committed to history.

#### Move — keyboard
- Arrow key: 1 mm nudge in that direction.
- Shift+Arrow: 10 mm nudge.
- No other modifiers in Phase A.

#### Scale — drag handles
- Corner handles: locked aspect ratio by default.
- Edge handles: scale along one axis.
- Shift+drag corner: unlock aspect ratio / stretch.
- Ctrl/Cmd+drag: scale from center instead of opposite edge.
- Live mm dimensions shown next to handle while dragging.

#### Rotate — handle above selection
- Handle appears above the selection box at a fixed offset.
- Drag rotates around selection center.
- Shift+drag: snap to 15° increments.
- Live angle shown next to handle.

#### Mirror — menu / shortcut
- `Arrange → Flip Horizontal` (`H`)
- `Arrange → Flip Vertical` (`V`)
- Operates around selection's center.

#### Edge — transform pushes object out of bed
- Permitted (user may be temporarily repositioning).
- Out-of-bounds geometry gains the red dashed overlay (F-A3 edge).
- Save G-code preflight will block at generation time.

#### Edge — non-uniform scale with rotation
- Math handles this correctly. Confirmed by snapshot tests on rotated-then-scaled fixture.

---

### F-A7. Artwork Operations panel

#### Layout
- The top selection inspector is the canonical settings surface. Clicking one artwork shows that
  artwork's named operation and its laser or CNC fields. The inspector never duplicates the same
  detailed settings in a second card below it.
- A compact ordered operation list follows the inspector. Each row shows automatic colour, name,
  process summary, visibility, output, and order controls. Operation row order decides the processes
  inside an artwork; artwork run priority is the top-level machine sequence.
- The sibling **Run order** view is the canonical top-level sequence manager. It uses direct
  one-based numbers rather than First/Earlier/Later/Last controls and supports search,
  jump-to-number, and a virtualized list for large jobs. This order is independent of canvas
  stacking.
- Each run row shows its automatic operation colour, artwork name/type, combined dimensions,
  operations, core laser/CNC settings, output state, and effective machine step(s). **Edit settings**
  returns to Settings with that run selected.
- When one selected artwork uses an operation shared by others, the inspector says `Affects N
  artworks` and offers **Make unique**. This clones the operation and rebinds only the selection.
- When selected artworks use different operations, the inspector says `Multiple operations` and
  offers **Use one operation**. Choosing an operation rebinds the whole selection without grouping
  or changing geometry.
- **Add operation** binds a second ordinary operation to the selected artwork. It appears in the
  same ordered list and can be renamed, reordered, shown/hidden, or output-enabled like any other.
- Artwork intentionally sharing one operation compiles as one machining unit so fill holes,
  overlaps, Island Fill clustering, pockets, and inlays retain compound-geometry semantics. Use
  **Make unique** before ordering one member independently.

#### Default values for a new Layer
- Power: 30 %
- Power mode: Auto (uses the active controller profile's vector default)
- Speed: 1500 mm/min
- Passes: 1
- Visible: on
- Output: on

#### Success - choose vector power mode
1. Open Cut Settings for a Line or Fill layer.
2. Choose **Auto**, **Constant (M3)**, or **Dynamic (M4)**.
3. Auto preserves the active controller profile's cut/fill mode. Constant and Dynamic override that
   mode for this layer only.
4. The output state machine changes mode before the layer's first burn move and avoids redundant
   mode words between adjacent layers with the same selection.
5. Image mode does not show this control because raster emission owns its power mode and laser-off
   travel transitions independently.

#### Success — edit power value
1. Click input, type new value (or use stepper).
2. Input is debounced — change is committed after 300 ms of inactivity, **not** on every keystroke (the LF1 audit found this missing; do not repeat).
3. On commit, the change is applied to the layer and the field reflects the committed value. (There is no separate status-bar confirmation — the earlier spec's `Layer · power set to 50%` message was never implemented.)

#### Success — toggle output off
1. Click Output checkbox.
2. Layer's paths immediately hidden from preview render.
3. Layer's paths *excluded* from generated G-code.
4. Cuts/Layers row appears dimmed.

#### Success - reorder a layer
1. Click a layer's up or down order control.
2. The row moves one position in the Cuts/Layers list.
3. Generated output processes operations in that order inside each artwork run.
4. Undo restores the previous layer order.

#### Success - choose which artwork runs first
1. Open **Run order** in the docked Artwork / Operations rail.
2. Enter a one-based **Run** number on any row. The complete run unit moves to that position and all
   other rows renumber automatically.
3. For large jobs, search by artwork/operation/settings or enter **Jump to run**; the windowed list
   scrolls directly to that row without rendering the whole project at once.
4. The displayed position updates without changing canvas stacking, geometry, operation settings,
   visibility, output flags, or automatic colours.
5. Laser output follows the numbered run-unit order exactly. Each row reports its output step(s).
6. CNC preserves clearing-before-profile safety and contiguous tool sections. Each row shows both
   its requested run number and the exact effective CNC step(s), so any necessary difference is
   visible before output.
7. Undo restores the previous machine priority.

#### Success - number a large job from the canvas
1. Open **Run order** and click **Number on canvas**.
2. The canvas prompt says `Click artwork for run #1`. Click the desired first artwork, then the
   desired second, and continue. The clicked run receives a number badge with a short, open colour
   callout; other artwork is dimmed while the bed, grid, stock, no-go zones, camera, rulers, and
   motion markers stay fully visible. The callout never encloses the artwork, so it cannot resemble
   geometry that will be cut, carved, or burned.
3. **Undo last** removes only the most recent assignment. **Done** commits the whole numbering
   session as one undoable project action. **Cancel** restores the order from before the session.
4. Numbering ends automatically after every run unit has been assigned.

#### Success - inspect a job from either surface
1. Click a run row: its complete run unit is selected on the canvas, highlighted with its operation
   colour in an open callout beside its `#N` badge, and all other artwork is visually de-emphasized.
2. With Run order open, click artwork on the canvas: the matching row becomes active and scrolls
   into view.
3. Focus/dimming is UI-only. It is not persisted, is not undoable, and cannot affect preview,
   compiled jobs, or emitted G-code.

#### Success — toggle visibility off
1. Click eye icon.
2. Layer's paths hidden from viewport.
3. Layer's paths *still included* in G-code (visibility ≠ output).
4. Row's color swatch shows a slash.

#### Empty — no layers
- Hint text: `Import a design to populate layers.`
- All controls disabled.

#### Error — power input out of range
- Values outside 0–100 are constrained to the valid range. (The earlier spec's `Power must be 0–100` status-bar message was never implemented.)

#### Error — speed input out of range
- < 1: snaps to 1.
- > device.maxFeed: snaps to maxFeed, status bar warns: `Capped to device max feed 6000 mm/min`.

#### Error — passes < 1
- Snaps to 1.

#### Edge — Layer has zero objects left (all deleted)
- Layer row is *removed* from the panel.
- If the row was the only output-enabled row, Save G-code button is disabled.

#### Edge — every layer has output: false
- Save G-code button is disabled.
- Tooltip on the disabled button: `Enable Output on at least one layer.`

#### Edge — two SVGs share a color
- Each imported artwork keeps its own operation by default. Matching source colors do not couple
  settings. The operator may select both and choose **Use one operation** to share deliberately.

#### Edge - shared and partially shared artwork
- Artwork with the same complete operation set appears as one run unit with one number, highlight,
  and settings context.
- Partial operation sharing stays as separate numbered units. **Make unique** separates a member of
  a shared operation before independent ordering.
- `Scene.artworkOrder` keeps flattened object IDs for schema compatibility; run-unit grouping is a
  deterministic derivation and introduces no project-size cap beyond the existing scene budget.

---

### F-A8. Preview

#### Success — toggle on
1. User clicks Preview toggle (toolbar button or `P`).
2. Viewport switches modes:
   - Original geometry rendered at 30% opacity in muted color.
   - Cut paths rendered in their Layer color at full opacity.
   - Image-mode layers render their raster engrave simulation (dithered/grayscale; darker pixel = more power = deeper burn), beneath the vector cut paths.
   - Travel moves rendered as light-gray dashed lines.
   - Origin marker remains visible.
3. Play scrubber appears at bottom of viewport: a slider 0 to total path length.
4. Dragging scrubber animates the toolpath progress — shows a position marker traveling along the path.

#### Success — toggle off
1. Click toggle again (or `P`).
2. Viewport returns to design view.
3. Scrubber disappears.

#### Live updates
- Changes to any Layer's power/speed/passes/visible/output or object transform schedule a preview rebuild outside render. Stale scheduled or asynchronous builds are cancelled; the previous route stays painted until its replacement is ready.

#### Empty — preview with no output layers
- Preview shows empty workspace (no paths visible).
- Hint text: `No layers have Output enabled. Toggle a layer to see preview.`

#### Edge — preview of out-of-bounds geometry
- Out-of-bounds path segments rendered in red.
- Preflight summary at top of viewport: `Preview: 1 layer extends 12 mm beyond bed`.

#### Edge — preview of very large scene
- > 120,000 path segments: warning shown above viewport: `Large scene - display simplified for performance`; the canvas renders a bounded display sample instead of walking every source point on each redraw.
- Generated G-code and saved project geometry are unaffected — simplification is visual only.

#### Raster engrave preview (image-mode layers) — ADR-028
- **Success:** each `raster-image` on an output-enabled image-mode layer renders a burn simulation at the image's placement, registered with the bitmap including rotation/mirror. Threshold/Floyd-Steinberg render as crisp black/white dots; grayscale as a smooth ramp. The simulation uses the exact dither + power scaling the G-code will emit (WYSIWYG, like the Fill hatch preview).
- **Live updates:** changing the layer's power or dither algorithm schedules the same cancellable preview rebuild; over-budget raster work is refused before allocation.
- **Empty:** an image-mode layer with Output off shows no simulation — same rule as any non-output layer (preview shows what *burns*, not what's merely visible on the design canvas).
- **Edge — missing luma:** a legacy `.lf2` raster with no embedded luma buffer renders white / laser-off, not full-burn. If that leaves the job with no G1 burn moves, preflight reports empty output.
- **Edge — scrubber:** the route scrubber follows raster output row-by-row through the same toolpath as emitted G-code. The burn simulation may still render as the full image backdrop, but the animated route/head reveal raster rows, passes, and bidirectional travel in order.

---

### F-A9. Save G-code

#### Success — desktop
1. User clicks `File → Save G-code` (`Cmd/Ctrl+Shift+E`).
2. Pre-flight runs (F-A10).
3. If pre-flight passes, OS native Save dialog opens.
4. Default filename: `<project-name>.gcode` if project saved, else `untitled.gcode`.
5. Default location: last G-code save location, or OS Documents on first save.
6. On confirm, file is written.
7. Toast: `Saved to <path>`.

#### Success — web
1. Same flow. The web app requires the File System Access API (Chromium-only, per PROJECT.md "Delivery targets") — there is **no browser-download fallback**. If the API is unavailable the save fails with the error toast `Could not save G-code: File System Access API is required to save files in the web app.`
2. Toast same.

#### Error — pre-flight failure
- See F-A10.

#### Error — file system error (disk full, permissions, etc.)
- Modal: `Could not save G-code: <one-line reason>`. Project is unaffected.

#### Edge — save when no output-enabled layers exist
- Save G-code button is disabled (see F-A7 edge).

---

### F-A10. Pre-flight check (before G-code save)

Runs whenever Save G-code (or Start) is invoked. Cannot be skipped. Any failing
check surfaces the pre-flight modal listing every issue and cancels the
save/start until they clear.

The authoritative list is the `PreflightCode` set in
`src/core/preflight/preflight.ts` (laser + CNC shared codes) and
`src/core/preflight/cnc-preflight.ts` (CNC-only). As of this writing it covers,
grouped by what each validates:

**Structural**
1. **At least one output layer exists.** Else modal `No output layers. Enable Output on at least one layer.`
2. **Generated G-code is non-empty.** Pipeline sanity; also a property-test invariant.
3. **A "Cut selected graphics" selection is not empty** when that scope is active.
4. **The reserved registration box is not set to Output** (it is a camera/jig guide, never burned).

**Geometry and bounds**
5. **All output geometry fits inside the bed** `[0, bedWidth] × [0, bedHeight]` (machine coordinates, after origin transform). Violations list the layers/amounts with a `Show violations` action.
6. **No output motion crosses an enabled no-go / keep-out zone.**
7. **No non-finite coordinate** (NaN / ±Infinity) reaches the emitted G-code.

**Per-layer values** (defense in depth over F-A7)
8. **Power within range** for every output layer.
9. **Speed within `device.maxFeed`** for every output layer.
10. **Passes ≥ 1** for every output layer.

**Mode / geometry consistency**
11. **Layer mode matches its geometry** — a fill/offset needs closed contours.
12. **Raster transform is emittable** — a rotation/shear the raster path cannot engrave is refused.
13. **Raster output stays within the pixel budget.**
14. **Island-fill short-sweep risk** on the active machine profile is surfaced.
15. **Relief objects appear only in CNC mode.**

**Laser safety**
16. **Laser off on every travel move** — the core invariant, re-scanned on the emitted text.
17. **No excessively long blank (laser-off) feed move.**

**CNC mode adds**
18. **CNC layer settings are valid and the layer produces toolpaths.**
19. **Configured cut depths are finite and positive.** Their relationship to stock thickness is
    operator-selected; stock thickness does not impose a universal depth cap.
20. **No single pass cuts deeper than the configured maximum.**
21. **No rapid (G0) travel before a safe-Z retract is established** (plunged-travel guard).

If all applicable checks pass, the save/start proceeds.

---

### F-A11. Save Project (.lf2)

#### Success — first save
1. `File → Save` (`Cmd/Ctrl+S`).
2. OS Save dialog opens.
3. Default name: `untitled.lf2`, default location: Documents.
4. On confirm, project serialized to JSON, written to disk.
5. Window title updates: `KerfDesk — <project-name>`.
6. Dirty indicator (`*`) cleared from title.

#### Success — subsequent save
1. `File → Save` or `Cmd/Ctrl+S`.
2. **No dialog.** File written to known path.
3. Toast briefly: `Saved`.

#### Success — Save As
1. `File → Save As` (`Cmd/Ctrl+Shift+S`).
2. Always shows dialog. Default name: current project name.

#### Error — save failure
- Modal: `Could not save project: <reason>`. Project remains dirty, user can retry.

#### Edge — save in web context
- Requires the File System Access API (Chromium-only, per PROJECT.md "Delivery targets"). There is **no browser-download fallback and no IndexedDB fallback** — an unsupported browser fails clearly rather than creating a second persistence path outside the project/file contract (`web-adapter.ts`).
- If the API is missing, the save fails with the error toast `Could not save project: File System Access API is required to save files in the web app.` There is **no** `Save needs file-system access. Re-prompt?` modal — that was never built.

---

### F-A12. Open Project (.lf2)

#### Success — schema version matches
1. `File → Open` (`Cmd/Ctrl+O`).
2. OS Open dialog.
3. On confirm, file is read and parsed.
4. Schema version checked against current.
5. If equal: project loaded. Window title updates.

#### Success — schema older
1. Migration runs to current version.
2. Toast (info) identifies the migration, for example: `Project migrated from v1 to v2.`
3. Project saved-as does not auto-trigger; user can save to persist migration.

> **Current note:** project schema v3 stores canonical curve subpaths plus explicit artwork-to-operation bindings. The registered v1→v2 migrator promotes legacy polylines to line-segment curves; v2→v3 promotes color membership, object overrides, and sub-layers to named operations (ADR-159, ADR-211).

#### Error — schema newer than supported
- Modal: `This project was saved with a newer version of KerfDesk. Update the app to open it.` No load.

#### Error — file is not a valid .lf2
- Modal: `Could not open <filename>: not a valid KerfDesk project.` No load.

#### Edge — file is a valid .lf2 but references a device profile not on this machine
- Project loads with the embedded device profile, adopted wholesale (`deserializeProject`).
- _Not yet implemented:_ a status-bar warning that the embedded profile is unknown to this machine (`Project's device profile … is not configured locally`). It needs an app-level device-profile registry to compare against, which does not exist yet (see the machine-profile lifecycle / app-level device-list work). Until then the embedded profile is simply used with no such warning.

---

### F-A13. New Project

#### Success — current project is clean
1. `File → New` (`Cmd/Ctrl+N`).
2. Workspace returns to empty state (F-A2).
3. Window title resets.

#### Edge — current project has unsaved changes
1. Modal: `Save changes to <project-name>?` with `Save`, `Don't Save`, `Cancel`.
2. `Save` → save flow F-A11, then new. `Don't Save` → discard, then new. `Cancel` → no action.

---

### F-A14. Undo / Redo

#### Success
- `Cmd/Ctrl+Z` undoes last action.
- `Cmd/Ctrl+Shift+Z` redoes.
- History depth: 50 actions in Phase A. Beyond 50, oldest are dropped.

#### Covered actions (Phase A)
- Import (undo removes imported objects).
- Delete (selected objects). When the last object on a Layer is deleted, the auto-removed Layer row is restored on undo.
- Move, scale, rotate, mirror.
- Layer parameter changes (power, speed, passes, visible, output).

> Phase A does not expose a manual "delete Layer" action — Layers auto-appear and auto-disappear with the objects of that color.

#### Not covered (intentional)
- Selection changes.
- Zoom, pan.
- Preview toggle.

#### Edge — undo after save
- Undo continues to work. Save does not clear history.

#### Edge — undo across project load
- History clears on Open / New / Close.

---

### F-A15. Keyboard shortcuts (full list)

Mac uses `Cmd`, Windows/Linux web uses `Ctrl`.

#### File
- `Cmd/Ctrl+N` — New project
- `Cmd/Ctrl+O` — Open project
- `Cmd/Ctrl+S` — Save project
- `Cmd/Ctrl+Shift+S` — Save Project As
- `Cmd/Ctrl+I` — Import SVG
- `Cmd/Ctrl+Shift+E` — Save G-code (Export)

#### Edit
- `Cmd/Ctrl+Z` — Undo
- `Cmd/Ctrl+Shift+Z` — Redo
- `Cmd/Ctrl+X` — Cut selected objects to the scene clipboard
- `Cmd/Ctrl+C` — Copy selected objects to the scene clipboard
- `Cmd/Ctrl+V` — Paste the scene clipboard (offset from the source)
- `Cmd/Ctrl+D` — Duplicate selection in place (LightBurn parity)
- `Cmd/Ctrl+A` — Select all
- `Delete` / `Backspace` — Delete selected
- `Escape` — Deselect / cancel current operation

#### Transform
- Arrow keys — Nudge 1 mm
- Shift+Arrow — Nudge 10 mm
- `H` — Flip horizontal
- `V` — Flip vertical

#### Tools
- `Cmd/Ctrl+R` - Rectangle
- `Cmd/Ctrl+E` - Ellipse
- `Cmd/Ctrl+L` - Line/pen
- `Alt+M` - Measure
- `Cmd/Ctrl+Shift+B` - Convert to Bitmap (LightBurn's binding; no-op unless a
  single convertible vector is selected)

#### View
- `P` — Toggle preview
- `F` — Fit to bed
- `Shift+F` — Fit to selection (falls back to all-objects, then bed)
- `+` / `=` — Zoom in
- `-` — Zoom out
- `0` — Reset zoom (same as F)
- `Ctrl+Wheel` — Zoom at cursor
- `Space + drag` — Pan

#### Phase B+ shortcuts
- `Cmd/Ctrl+Return` — Start job (Phase B)
- `Cmd/Ctrl+.` — Request the controller-specific software Abort (Phase B)

---

### F-A16. Status bar — content reference

Left to right:

- **Cursor position** — `X 124.3, Y 87.0 mm`
- **Selection summary** — `1 selected · 50.0 × 30.0 mm` (or `Nothing selected`)
- **Object count** — `Objects: 3`
- **Layer count** — `Layers: 2 (1 output)`
- **Device** — `Default 400×400`
- **Zoom** — `100%`
- **Job estimate** — Phase C feature; not in Phase A.

Status bar messages (toasts that appear in the bar for 3 s) for non-blocking events.

---

## Phase B flows

### F-B1. Connect to laser

#### Success
1. User clicks **Connect…** in the Laser panel.
2. Browser shows the WebSerial port-picker (`navigator.serial.requestPort`).
3. User picks the laser's USB-CDC port.
4. App opens at 115200 baud, registers line + close handlers, starts the 250 ms status poll.
5. Connection dot turns green; the status display shows the GRBL state from the first `?` reply.

#### Error — WebSerial not supported
1. Connection button is disabled, with a red hint above: "Your browser doesn't support WebSerial. Use Chrome, Edge, Brave (may require enabling under Brave Shields/flags), or Arc, or install the Windows desktop app."

#### Error — user cancels picker
1. App returns to disconnected state, no error surfaced.

#### Error — port open failure
1. App stays in `failed` state with the error message displayed inline ("Failed: …").
2. User can re-click Connect to retry.

#### Edge — Brave with WebSerial behind a flag
1. Same as "not supported"; Brave issue #24404 is noted in `PROJECT.md` delivery targets.

### F-B2. Disconnect

#### Success
1. User clicks **Disconnect**.
2. For a live GRBL-family controller, the app synchronously cancels host refill, sends Ctrl-X, and
   waits for the reboot banner (500 ms bounded fallback).
3. App sends best-effort `M5` and `M9`, then stops the poll, closes the port, and clears stale status.

#### Edge — disconnect mid-job
1. See F-B12.

### F-B3. Home

#### Success
1. User clicks **Home**. App sends `$H\n`.
2. Status polling shows the controller entering `Home` then returning to `Idle`.

#### Error — homing not enabled
1. Controller replies `error:10`. UI surfaces the message from `describeError(10)`.

### F-B4. Frame

#### Success
1. User clicks **Frame** while connected and the controller is Idle.
2. App resolves the job placement (start-from mode, anchor, cached WCO), compiles through the shared `prepareOutput` pipeline, and computes the job's motion bounds (including overscan).
3. Frame preflight checks the motion bounds against the bed (with any placement offset) and no-go zones. On failure an error toast explains the violation and no bytes are sent.
4. App builds five absolute `$J=G90 G21 X<x> Y<y> F<feed>` jogs tracing the perimeter (start corner, four edges back to the start) at `min(framingFeedMmPerMin, maxFeed)`.
5. The first jog is written immediately; each remaining line is dispatched as the previous jog completes. Status polling shows `Jog`, then `Idle` when the box closes.
6. When framing from a verified origin, a successful pass records frame verification for the Start-job preflight.

#### Canvas start markers
1. The canvas shows `FRAME START` and `JOB START` markers by default. Label text renders at 50%
   opacity over a 20%-opaque white backdrop so artwork remains visible underneath. Marker dots and
   the frame-direction arrow stay fully opaque for clear start-point positioning.
2. The eye toggle immediately after **Snap** in the bottom-right canvas controls hides or restores
   those two static markers. The preference survives reloads.
3. The toggle never hides the approach route, live controller head, completed-route trail, or motion
   status badge.

#### CNC — safe-Z retract and restore
1. For a CNC project with a current work-Z zero, the XY perimeter is wrapped with Z motion (ADR-192): a safe-Z retract (`$J=G90 G21 Z<safeZ>`) is written first so the bit clears the stock, and after the box closes a final jog restores the bit to its pre-frame work Z. The bit ends where it started — at Z0 when it was touching the stock — never parked at the clearance height.
2. Without a current work-Z zero the work-frame retract would target an arbitrary physical height, so framing falls back to the XY-only perimeter (as in laser mode). The restore jog is also omitted when the pre-frame Z is unknown or already equals safe Z.

#### Error — origin cannot be resolved
1. Placement resolution fails (e.g. selection origin requested with nothing usable); error toast, no bytes sent.

#### Edge — raster job exceeds the raster budget
1. If preflight fails only with `raster-too-large`, the app still frames the outline using the frame bounds (framing must stay available for exactly these jobs).

#### Edge — cancel mid-frame
1. **Cancel** writes the real-time jog-cancel byte (`0x85`); pending frame lines are dropped and the motion operation clears.

### F-B5. Jog

#### Success
1. User selects a step size (0.1 / 0.5 / 1 / 2 / 5 / 10 / 25 / 50 / 100 mm) and clicks a direction arrow.
2. App sends a `$J=G91 G21 X<dx> Y<dy> F<feed>` command.
3. Status polling shows the controller in `Jog` then back to `Idle`.

#### Edge — jog target exceeds travel
1. Controller replies `error:15`. UI logs the rejected line.

### F-B6. Start job

#### Success
1. User clicks **Start job** while connected and idle.
2. App runs the F-A10 preflight on the current project. If issues, surfaces the modal (same as Save G-code path).
3. A laser controller that reports `$32=0` is refused. If `$32` cannot be verified, one focused
   prompt explains the cable-loss/latched-output risk and requires **Start anyway** or Cancel.
4. App compiles the project to G-code via `emitGcode`, builds a streamer, and writes the first batch (as much as the RX window allows — default 120 bytes, per-profile `rxBufferBytes`).
5. Every `ok` advances the streamer by one line and writes more.
6. Progress bar reflects `completed / total` lines.
7. While the job is active the app holds a screen wake lock so OS
   display-sleep can't suspend the stream (ADR-117; re-acquired on tab
   visibility changes, released when the job ends). If the platform
   refuses the lock, one LaserLog line warns the operator to disable
   system sleep before long burns — the job itself always proceeds.
8. During a CNC job the canvas motion overlay's head label and status badge
   add the running depth pass and the passes remaining (`Pass k of N •
   m remaining`), derived from the ADR-215 pass spans of the exact started
   program and advancing only with route-reconciled motion (ADR-216). When
   the mapping cannot be derived (e.g. a supervised recovery stream), the
   counter is omitted rather than estimated.
9. While any job is running, the status badge also shows the live
   controller-reported feed rate (`N mm/min`, inch reports normalized),
   taken from each status frame's `FS:` field (ADR-217). It appears only
   while running and only when the controller reports feed; a held machine
   or a controller that omits `FS:` shows no rate.
10. For a running CNC job the badge additionally shows the live spindle
    speed (`N rpm`) from the same `FS:` field (ADR-220). It is CNC-only —
    a laser's `FS:` spindle slot is a power value, not RPM — and, like the
    feed rate, appears only while running and only when reported.
11. The badge also shows wall-clock elapsed time since Start (`5m 12s`,
    same format as the pre-job ETA), counting through holds and tool
    changes and freezing at the run's first terminal state — finished,
    stopped, errored, or disconnected — so the final duration stays
    readable (ADR-221). Runs without a recorded start show no timer.

#### Error — preflight fails
1. Modal lists the violations. No bytes sent.

#### Error — controller in Alarm
1. Send fails fast; user must `$X` first (F-B9).

### F-B7. Pause / resume

Pause, Resume, and tool-change Continue appear only in the top Live Motion bar. The bar remains in a
stable position above the workspace and wraps its status and action groups instead of shrinking the
controls below their minimum target size.

#### Success — pause (GRBL-family laser)
1. User clicks **Pause**. The app freezes host refill before writing any controller byte.
2. App writes resumable real-time Safety Door (`0x84`), which decelerates motion and disables the
   laser output. The Live Motion bar shows **JOB PAUSED** and keeps **ABORT JOB** available.
3. Pause becomes confirmed only after a fresh same-session report shows a settled `Door` state and
   explicit controller-commanded spindle/laser-off evidence. Until then no further G-code is sent.
4. If every G-code line has already been acknowledged but the controller still reports physical
   `Run`, **Pause** remains available. Resuming this exhausted tail sends `~` but no duplicate G-code.

#### Error — active-job transport write fails
1. This applies to the initial Start chunk, an acknowledgement-triggered refill, and tool-change
   Continue. The app synchronously freezes and cancels remaining host ownership.
2. The app joins the one bounded controller transaction: soft reset, reset-boundary wait, `M5`/`M9`,
   quarantine, and port close. A simultaneous operator Disconnect joins the same transaction.
3. If the operating system reported the port closed first, that disconnected state wins; a late
   rejected write cannot restore an active/errored stream.
4. Reset and cleanup are best-effort while the transport exists. If the cable is already absent,
   only a verified controller watchdog or hardware interlock can guarantee physical beam shutdown.

#### Blocked — fallback feed hold with laser mode unproven
1. Safety Door Pause does not depend on `$32` proof. If a different controller exposes only ordinary
   feed hold and can report settings, that fallback is refused unless laser mode is confirmed
   (`$32=1`), because feed hold alone can leave laser output asserted.
2. Software Abort requests the controller-specific reset/de-energize path but cannot guarantee delivery or physical beam-off. Use the machine's physical E-stop or power isolation when unsafe.

#### Exempt — CNC / router jobs
1. A CNC (router) job pauses with `!` without the `$32` proof: feed hold with a spinning spindle is standard sender behavior, and a router runs `$32=0`. Demanding the laser proof would block CNC pause outright.
2. The pause warning states that generic CNC continuation is not available; Pause is a controlled hold that routes to software Abort and supervised manual recovery.

#### Degraded — controller with no realtime hold (e.g. Marlin)
1. When the driver has no feed-hold byte, Pause is stream-side only: outbound sending stops but buffered motion finishes. The Console directs the operator to request **ABORT**, or use the physical E-stop when unsafe.

#### Success — laser / non-CNC resume
1. User clicks **Resume**. App writes real-time `~` while the host streamer remains frozen.
2. The Live Motion bar remains **JOB PAUSED** until a fresh same-session post-write report proves
   `Run` or a completed `Idle` transition. `Hold` and Door restore substates do not release the sender.
3. Only after that proof does the streamer resume and send more G-code.

#### Blocked — generic CNC resume
1. The CNC **Resume** button remains visible but disabled, while **ABORT JOB** remains available.
2. The store independently refuses CNC Resume before writing `~` or refilling the stream because a GRBL status snapshot cannot prove that the physical spindle stayed turning while the cutter may be engaged.
3. The operator must request ABORT, inspect and clear the cutter using a machine-specific procedure, and start a newly reviewed recovery job.

### F-B8. Software Abort / Controller Reset

#### Success
1. User clicks the single **ABORT JOB** or **ABORT MOTION** action in the Live Motion bar. The control explicitly says it is a controller reset request, not a safety-rated E-stop, and directs the operator to the machine's physical E-stop or power isolation for danger.
2. The app sends the active driver's controller-specific abort/reset path: GRBL-family drivers may use realtime `\x18`; drivers without realtime reset use their queued best-effort de-energize commands.
3. The UI marks the streamer cancelled. This software action does not prove that the command arrived or that physical energy stopped.
4. A GRBL controller enters `Alarm` after reset; the user clears with `$X` (F-B9).

### F-B9. Alarm

#### Success — surface
1. When `ALARM:N` arrives, the Laser panel shows a red banner with code, title, detail, and recovery action (from `core/controllers/grbl/alarm-codes.ts`).

#### Success — unlock
1. User clicks **$X — Unlock**. App writes `$X\n`. Alarm cleared from UI.

### F-B10. Status polling

App writes real-time `?` every 250 ms while active — a streaming job, a motion or controller operation, probing, or auto-focus — and about once a second (every 4th tick) when the machine is idle. Replies are parsed by `parseStatusReport`. The latest report drives the Status panel and the bottom status bar.

While a GRBL-family job is streaming or acknowledged-but-still-finishing, eight missed active status
reports (2 seconds) trigger a connected-link fault: host refill is cancelled synchronously, Ctrl-X is
requested, and post-reset `M5`/`M9` cleanup is attempted. This contains a degraded-but-still-writable
link; it does not claim that bytes can cross a cable that is already physically absent.

### F-B11. Job progress UI

The Live Motion bar shows `completed / total` lines and a percentage beside the active-job state, and the Machine rail may retain its detailed progress bar. Both update whenever the streamer advances. A pre-job time estimate is shown before the run starts; a mid-job estimated-time-remaining label is not yet implemented.

### F-B12. Disconnect during job (cable yank)

#### Error — physical transport lost
1. The OS fires `port.disconnect`. Adapter's `onClose` handlers fire.
2. Laser store freezes the sender, preserves the interrupted-job record, transitions to
   `disconnected`, and clears stale controller observations.
3. No application command can cross a physically absent transport. Motion and beam shutdown on a
   cable yank must therefore be owned by a proven controller heartbeat timeout or fail-safe hardware
   interlock; without that independent path the operator uses the physical E-stop or power isolation.

#### Edge — re-connect after yank
1. User plugs the cable back in and clicks **Connect…** again. Picker shows the same port. App treats it as a fresh connection — the user must `$H` to re-establish position before resuming work.

### F-B13. GRBL Console

#### Success — inspect controller traffic
1. The Laser panel shows a docked **Console** with controller replies and app-sent commands.
2. Startup banners, `ok`, `error:N`, `ALARM:N`, settings lines, and GRBL messages are visible with lightweight labels.
3. Periodic status poll replies and high-volume job stream writes are hidden by default but can be shown with toggles.
4. **Copy visible** copies the filtered transcript. **Clear** clears the local transcript only; it sends no command to the controller.

#### Success — send diagnostic query
1. User clicks `$I`, `$$`, `$#`, `$G`, or `?`.
2. App sends the command through the same guarded serial write path as all other controller writes.
3. `$$` starts the existing settings collector so detected controller settings refresh when the dump completes.
4. Read-only queries preserve the current work-origin, Z-zero, homing,
   position, and frame-verification evidence.

#### Success — unlock alarm
1. When the controller is in `Alarm`, user can send `$X` from the console or the alarm banner after confirming the head is safe.
2. App sends `$X\n` only when no job, jog, frame, or autofocus operation is active.

#### Error — disconnected
1. Console input and quick actions are disabled.
2. Tooltip / disabled text says to connect to the laser first.

#### Error — active job or motion
1. Console commands are blocked while a job, jog, frame, or autofocus operation is active.
2. `?` status query remains available because it is a GRBL realtime status request and does not enter the streamed buffer.
3. Blocked commands are recorded as local diagnostics and no bytes are sent.

#### Error — unsafe persistent command
1. `$RST=*`, `$RST=$`, `$RST=#`, `$N=...`, and `$I=...` are blocked in Lane 2.
2. `$number=value` settings writes require connected, idle controller state and explicit confirmation.

#### Edge — arbitrary G-code
1. Single-line G-code commands are allowed only when connected, no operation is active, and GRBL reports `Idle`.
2. Multiline input is rejected; persistent macros are deferred to a later lane.
3. Every accepted command carries a controller-specific state-effect tag.
   Ordinary motion/modal commands clear cached Idle/position and frame
   evidence until a fresh status report arrives. XY-only coordinate commands
   clear XY authority but preserve established work Z; Z/tool commands clear
   work-Z evidence but preserve XY authority; full WCS, homing/reset, and
   configuration commands clear the complete setup evidence they can affect.
   Preserved work-Z evidence remains bound to its own reference epoch, so
   ordinary motion does not discard a valid stock-top datum while Z/tool,
   reset, homing, reconnect, and configuration changes make old evidence stale.
4. A successful serial write is the invalidation boundary. It is not treated
   as physical completion or controller acknowledgement. If the write fails,
   the existing write-failure safety notice applies and no mutation is assumed.

### F-B14. Machine Settings read-only backup

#### Success — read connected controller settings
1. The Laser panel shows **Machine Settings** collapsed by default.
2. User opens the panel and clicks **Read ($$)**.
3. App sends `$$\n` through the guarded serial write path; it does not use a separate serial shortcut.
4. The existing settings collector parses the response into visible rows.
5. Known settings show their code, value, unit, and KerfDesk-authored meaning.
6. Unknown settings remain visible as unknown rows instead of being dropped.

#### Success — export backup
1. After at least one setting row has been read, **Export backup** is enabled.
2. User chooses a save target.
3. App writes `.lfgrbl-settings.json` containing every visible row, including unknown settings.
4. Exporting a backup sends no command to the controller.

#### Error — disconnected
1. **Read ($$)** is disabled.
2. Tooltip says to connect to the laser first.
3. **Export backup** remains disabled until settings have been read in the current connection context.

#### Error — active job or motion
1. **Read ($$)** is blocked while a job, jog, frame, or autofocus operation is active.
2. No bytes are sent when blocked.
3. The operator-facing message explains which operation must finish first.

#### Edge — alarm state
1. Reading settings is allowed when connected and no job or motion operation is active.
2. Alarm recovery remains separate: `$X` and `$H` stay in the alarm banner / Console workflow.

#### Explicit non-goals for this lane
1. No firmware setting edit inputs.
2. No Write button.
3. No Load-from-backup button.
4. No `$RST`, startup block, manufacturer, or axis calibration workflow.

### F-B15. Selected artwork output and anchor

#### Success - output only selected artwork
1. The Laser panel shows **Selected artwork only** near Start From / Job Origin.
2. User selects one or more objects and enables **Selected artwork only**.
3. Preview, live estimate, Frame, Start job, and Save G-code all compile the same selected-only output scope.
4. Source scene geometry is not moved or deleted.
5. If selected-only output is enabled with no current selection, output generation returns a clear blocker instead of silently burning the full design.

#### Success - Anchor from selected artwork
1. **Anchor from selected artwork** is shown only when **Selected artwork only** is on and Start From is not Absolute Coordinates.
2. When enabled, job-origin math uses the selected artwork bounds.
3. When disabled, job-origin math uses the full output design bounds, while still emitting only the selected artwork.
4. This matches LightBurn's separation between cutting selected graphics and using the selected graphics as the origin reference.

#### Error - Absolute Coordinates
1. **Anchor from selected artwork** is hidden in Absolute Coordinates because absolute output does not use relative anchor placement.

#### Explicit non-goals for this lane
1. No Position Laser physical move.
2. No Move Laser to Selection physical move.
3. No Set Start Point or node-level start ordering.

### F-B16. Interrupted-job checkpoint and resume (ADR-118)

While a job streams, the app owns an immutable exact execution artifact in
IndexedDB plus a small `activeRun` slot keyed by a unique run ID. Progress is
updated every 25 acknowledgements and at state transitions. Interruption moves
that run into the single newest recovery capsule; clean settled Idle creates a
separate exact replay receipt.

#### Success — resume after a crash
1. App/tab/PC died mid-job. Operator relaunches. Recovery loads independently
   of the open/autosaved project (F-C3).
2. Job controls show a collapsed, non-red **Interrupted job saved** card with
   Review and Discard. Its acknowledgement count is transport evidence only.
3. If a red machine-safety notice is present, a lost/failed transport offers
   **Reconnect controller…**, never Ctrl-X. The operator physically makes the
   machine safe, reconnects, then uses **I made the machine safe** to acknowledge
   the incident. Reconnect/acknowledge do not clear or resume the capsule.
4. Review is a read-only sandbox until its final Start action. Opening, closing,
   or cancelling it cannot change the canvas, project/profile, controller
   settings, origins, Work Z, G-code, or recovery ownership.
5. Laser Review uses the capsule's exact archived G-code. A migrated legacy
   fingerprint-only record alone may use the explicitly named current-project
   fingerprint fallback.
   The archived program remains the source of truth, while the generated
   re-entry hard-offs with `M5`/`S0`, repositions without power, and restores
   positive power only on actual burn motion. The live session's `$32` evidence
   is confirmed again before the capsule can be claimed.
6. For router jobs, the acknowledged count remains diagnostic only. The exact
   capsule opens **Review supervised recovery**, where the operator—not
   the count—selects the first uncertain native contour segment. Execution is
   available only after the cutter is clear, the spindle is stopped, position/
   WCS/Z zero and tool/workholding are requalified, all earlier machining and
   the displayed tangent runway are confirmed, and a machine-specific air-cut
   or scrap-test qualification record is entered.
7. The router flow uses the archived prepared semantic job and manifest,
   generates a new recovery job, and SHA-256 binds source/recovery bytes, segment,
   runway profile, and review proofs, then repeats the ordinary CNC Start and
   setup-attestation gates before streaming. It never streams the old program
   from an acknowledged line.
8. The capsule records the terminal safety reason when one is available
   (disconnect, controller error/rejected line, reboot, write failure, or
   cancellation) and shows it after reload/reconnect.
9. Only final **Start supervised recovery** claims the current run/revision.
   The attempt is durably armed before the controller Start boundary, then the
   controller session, settings observation, status/position, WCO/origin, and
   Work Z evidence are compared again immediately before streamer creation.
   Failure before controller acceptance cancels the durable handoff and releases
   the claim for retry. Once transmission may have begun, an interrupted attempt
   becomes the newest capsule.
   A rejected recovery write remains fail-dark and Abort-visible while the
   transport is reset and quarantined.
10. A CNC capsule with zero acknowledgements still shows diagnostic review; it never implies
   that no physical motion occurred.

#### Start, recovery, replay, and discard are separate intents
1. Ordinary **Start job** and Ctrl+Return ignore archived recovery records and
   validate and compile the current project from line 1. Merely showing, opening,
   or closing recovery cannot import archived G-code, settings, origins, or
   controller observations into the live session.
2. **Review** is the only route from a capsule to executable recovery. It validates
   the live controller and setup against the archived artifact without importing
   archived controller values into the current profile or firmware.
3. A failed ordinary Start leaves the old capsule untouched. Once a fresh current
   job is accepted by the transport, its staged artifact becomes `activeRun` and
   supersedes the old capsule because machine state has changed. Before the wire
   boundary a schema-v2 `pendingStart` record names the candidate without granting
   it recovery authority or removing the older capsule.
4. **Discard** deletes only the capsule. It does not stop, reset, reconnect, move,
   or modify the current job.
5. Recovery storage/quota/schema failure shows a nonblocking warning. Current Start
   and the PWA update/reload prompt remain available.

#### Error — project changed since the run
1. Exact capsules do not depend on the current project and therefore cannot fail
   merely because the open canvas changed. Artifact integrity or archived
   semantic-manifest mismatch refuses before any controller command.
2. A migrated legacy fingerprint-only capsule may refuse when the current project,
   scope, or resolved placement no longer compiles to the archived fingerprint.

#### Edge — controller lost power too
1. Acknowledged lines may include a buffer's worth GRBL never executed; the
   card says so. CNC recovery never converts that transport-level count into a
   cut position or automatic machine motion.

#### Edge — recovery job is itself interrupted
1. The recovery attempt receives a new run ID. If interrupted after transmission
   may have begun, that attempt becomes the newest capsule and the source is no
   longer offered. The operator must inspect and requalify before another review.
2. If the app restarts while `pendingStart` is unresolved, the candidate becomes
   the newest capsule with zero diagnostic acknowledgements and an explicit
   acceptance-unknown reason. It may be a conservative false positive when the
   app died before the first program byte, but the older source is never offered
   after a newer Start may have changed machine state. A short owner lease lets a
   still-live tab commit or cancel without another tab misclassifying it as a crash.

#### Edge — deliberate software Abort
1. Abort keeps the run as the newest capsule (an aborted job still requires
   recovery review); **Discard** on the card is the explicit deletion.

#### Clean completion and Run Again
1. Completion requires all stream acknowledgements, the controller-specific
   settle marker, and fresh stable Idle. Then `activeRun` is removed and an exact
   `lastCompletedReceipt` is retained.
2. **Run same job again from start** appears only while canvas, machine profile,
   output scope, placement, and execution signature still match. Clicking performs
   fresh compilation/qualification and starts line 1 with a new run ID and zero
   recovery progress.
3. Any relevant edit hides the offer. The receipt remains diagnostic history
   until another accepted run replaces it; **Forget Controller** clears it.
   Ordinary **Start current job** remains available.

#### Controller qualification and Forget Controller
1. Connection, reset/Abort cleanup, wake, probe recovery, reboot banner, and
   controller-setting writes start one epoch-bound qualification flow. GRBL-family
   controllers own one `$$` read after fresh Idle; unsupported dumps are
   `not-required`, and late prior-epoch replies are ignored.
2. Start is inline-disabled with **Reading controller settings…** while qualifying.
   Failure shows **Retry reading controller settings** and Reconnect. Real `$30`,
   `$32`, Alarm/non-Idle, current-tool, and Work-Z mismatches still refuse Start.
3. **Forget Controller** safely stops active motion when possible, closes/revokes
   transport permission, advances epochs, and clears controller/live-run/recovery/
   replay/evidence/error/log state. It preserves the canvas, layers, profile,
   libraries, and preferences. It does not send `$RST=*` or factory-reset EEPROM.
4. An ordinary Idle Forget has no error dialog. If transport failure leaves motion
   uncertain, the physical-safety warning remains instead of claiming a clean stop.

---

## Phase C flows — STUB

- F-C1. Settings → Device Profile editor
- F-C2. Settings → Preferences
- F-C3. Autosave + recovery
- F-C4. Re-import changed SVG with diff
- F-C5. Copy / paste / duplicate
- F-C6. Crash reporter
- F-C7. Unified Machine Setup — specified below (ADR-205; supersedes the split ADR-092 surface)

### F-C7. Unified Machine Setup

The single beginner-facing machine configuration surface. The Laser/CNC rail exposes one **Machine
Setup** button; old `MachineSetupDialog` callers resolve to the same flow rather than a competing
live-edit tab dialog. Every edit remains in one `DeviceProfile` + `MachineConfig` draft until **Save
machine setup**, which commits the complete configuration as one undoable project change.

Machine capability is an enforced physical-output contract (ADR-210), not descriptive metadata:

- **Laser only** keeps Laser active and makes CNC unavailable. **CNC only** keeps CNC active and
  makes Laser unavailable. **Laser + CNC** allows either active mode.
- The unavailable Laser/CNC segment stays visible and keyboard-focusable, but is visibly muted and
  carries `aria-disabled="true"`. Activating it shows the capability-specific explanation and the
  **Machine Setup** recovery path; it does not change the project, history, or dirty state.
- **New Project** starts in the sole supported mode for a single-output profile. A hybrid or legacy
  profile keeps the operator's active mode while resetting job-specific configuration.
- Opening or restoring a contradictory project switches it to the sole supported mode before any
  mode-specific UI or output path can use it. Displaced CNC setup is retained for recovery, the
  project remains dirty until explicitly saved, and a warning explains the repair.
- Profiles with neither output capability are legacy-compatible and continue to allow both modes
  until their next Machine Setup save records an explicit choice.
- The final atomic setup action independently refuses a profile/machine mismatch, so another caller
  cannot persist a single-output capability beside the opposite active mode.

The seven steps are always visible and always ordered:

1. **Machine & controller** — choose Laser/CNC, controller family, baud, output dialect, streaming,
   optional catalog profile, and import/export. Controller selection precedes serial connection.
2. **Connect & read** — connect with the reviewed driver/baud and run that controller family's
   read-only identity/settings commands. Ruida correctly presents file-only behavior.
3. **Work area & coordinates** — name, usable bed, max/frame feed, origin, and homing policy.
4. **Machine output** — laser S range/air/Fire or CNC safe Z/spindle/dwell/coolant/park. Stock,
   material, and bit remain job-specific and stay in Material & Bit.
5. **Safety & calibration** — no-go zones, Z/probe metadata, planner/ETA calibration, and the
   relevant laser-only scan/autofocus/rotary/camera status.
6. **Firmware review** — controller-specific configuration location and write policy. GRBL/grblHAL
   can queue common per-setting writes only after read + backup acknowledgement; FluidNC, Marlin,
   Smoothieware, and Ruida never receive numeric GRBL setup writes. Queuing is draft-only: Cancel
   sends nothing.
7. **Review & hardware handoff** — summarize every software consumer and list the separate physical
   commissioning checklist. The flow says software is internally consistent, never "ready to cut."

#### Success — connected controller answers its read commands

1. Detected identity remains a separate observation. It never silently replaces the operator's
   selected profile/controller contract; a mismatch is explicit and must be resolved deliberately.
2. Supported numeric readback values can be copied into the draft with **Use detected values**; in
   CNC mode `$30` routes to the spindle ceiling rather than laser-power fields. The live project
   remains unchanged.
3. On the last step, **Save machine setup** commits device, workspace, machine config, job placement,
   CNC cache, and any spindle-ceiling clamp through one store action and one undo entry. Only after
   that commit does it execute and exactly re-read any explicitly queued common firmware writes.

#### Error — read times out or the controller has no mapped settings

1. The flow reports that nothing was imported and continues in manual-entry mode.
2. The controller's actual command/configuration surface remains visible so the operator knows
   whether to use `$$`, FluidNC YAML/WebUI, Marlin configuration/EEPROM tools, a Smoothieware config
   file, or Ruida vendor tooling.

#### Edge — controller mismatch

1. A connected active/detected controller that differs from the selected draft blocks reads/writes
   and offers an explicit reconnect action using the reviewed selected contract. Changing to the
   detected controller is a separate, deliberate profile edit.

#### Edge — opened while disconnected

1. Manual configuration and final save remain available. Firmware comparison/writes stay optional.

#### Edge — firmware write blocked

1. No read/backup, non-Idle state, active operation/job, autofocus, or controller mismatch keeps a
   write from being queued or executed. Every supported write has its own value confirmation and
   exact re-read check.
2. Machine-critical travel settings are review-only. There is no fixed-value setup batch.
3. When the active project is a laser, both Machine Setup and the confirmed Console setting lane
   reject `$32=0` before serial transmission. Laser `$32=1` and CNC/router `$32=0` remain available.

---

## Phase D flows

- F-D1. Add text object
- F-D2. Edit text content
- F-D3. Choose font
- F-D4. Adjust character spacing / line height
- F-D5. Convert text to paths (one-way conversion for further editing as imported geometry)

## Phase E flows

### F-E1. Import and trace a raster image

**Success**:
1. Choose a raster image and open the trace dialog. The image is decoded at the
   preview budget and the selected preset starts tracing in a worker.
2. Adjust a preset, threshold, or boundary control. Changes are debounced; the
   newest request supersedes and cancels any older trace still running.
3. The preview displays only the newest completed result. A late response from
   a retired worker is ignored and cannot replace the current preview.
4. Click **Trace** after the preview is ready. When the file, options, and
   boundary still match, the ready preview geometry is reused instead of traced
   a second time. The result is imported as a Scene object.

**Error — worker stalls or crashes**:
- A worker request has a bounded execution timeout. The failed worker is
  retired, the current request reports a recoverable error, and the next trace
  starts with a fresh worker. Small images may use the bounded inline fallback.

**Edge — rapid preset changes**:
- At most one trace job is live. Starting the newest job rejects the older job
  as superseded; supersession is not shown as a user-facing error.

**Edge — source changes before commit**:
- Reuse is allowed only when file identity, options, boundary, and boundary mode
  match the ready preview. Otherwise commit decodes and traces the current
  source normally. Existing source-revalidation checks still apply.

---

## Phase F flows

### F-F1. Engrave a filled shape (F.1 Fill mode)

**Entry**: a SceneObject already exists in the scene (SVG, text glyph,
or traced image) with at least one closed polyline.

**Success**:
1. Select the artwork and find its named operation in Artwork Operations.
2. Click the **Mode** dropdown → choose **Fill**.
3. The row expands: a sub-row appears underneath showing Fill-specific
   inputs: **° angle**, **mm spacing**, and **Overscan**. Defaults are
   0° (horizontal hatching), 0.1 mm (10 lines/mm), and 5 mm overscan.
4. (Optional) Adjust the inputs. All three commit on the 300 ms F-A7 debounce.
5. Compile + emit G-code as usual (Save G-code, or Start job in the
   Laser panel). The FillGroup for that color now contains hatch lines
   with laser-off overscan runway instead of the outline.
6. If **Cross-Hatch** is enabled, the same fill region emits a second hatch
   set at `hatchAngleDeg + 90`. The scan-direction preview shows both passes.
7. If **Offset Fill** is selected, closed regions emit inward contour-following
   fill paths spaced by the line interval. Offset Fill uses the Fill layer's
   dynamic-power output path but does not use scanline overscan runways.
8. Use **Add operation** to bind a second operation to the same artwork. Operations emit in list
   order using their own mode, power, speed, passes, fill, image, kerf, tab, and air settings. This
   supports fill-then-line workflows without duplicating artwork or opening a nested Sub-layers box.

**Error**:
- *No closed polylines on this color* — the layer's mode is Fill, but
  every matching polyline is open (e.g., a single line, not a region).
  The compile step silently emits nothing for that layer (no error
  toast; the empty result is itself the diagnostic). Switch back to
  Line mode to engrave the outline instead.
- *Offset Fill on open contours* - Start / Save G-code preflight blocks with
  a specific Offset Fill message. Close the shapes or switch the layer back to
  Scanline Fill.
- *Additional operation disabled* - the operation stays saved on the project but does not compile
  into Preview, Frame, Save G-code, or Start output.

**Empty**:
- *No SceneObjects yet* — the Mode dropdown still works, but no
  geometry exists to fill. The Cuts/Layers panel shows its "Import a
  design to populate layers" hint.

**Edge cases**:
- *Polygons with holes* (e.g., letter "O"): the even-odd fill rule
  handles them automatically. Hatch lines stop at the inner contour and
  resume on the other side — the hole stays unburned. No special UI;
  no per-shape configuration.
- *Self-intersecting polygons* (some script-font glyphs): even-odd rule
  keeps the fill visually correct even when the underlying path crosses
  itself. Result may differ from a non-zero fill convention but matches
  what the SVG renderer in any browser would show.
- *Tiny shapes* (cap height < ~2× hatchSpacing): produce only 1–2 hatch
  lines, which engraves as a near-line. Acceptable; no minimum-size
  guard. The user can lower `hatchSpacingMm` or switch to Line mode.
- *Very small spacing* (≤ 0.05 mm): clamped to 0.05 mm at the algorithm
  boundary so an accidental 0 doesn't generate millions of lines.
- *Overscan near a bed edge*: Fill Overscan adds laser-off runway before
  and after each hatch line. The framed burn area does not grow, but
  preflight checks the emitted G-code and can reject a job whose runway
  would move outside the bed. Move the artwork inward or lower Overscan.

### F-F2. Image-engrave a raster (Phase F.2 — code shipped through F.2.e; hardware burn pending)

ADR-020 shipped through F.2.e (dither + per-pixel S-modulation raster
emit); only the F.2.f on-hardware burn verification is pending. This
section documents the flow.

**Goal:** the operator drops a PNG / JPG on the canvas, sees it
positioned at its intrinsic size, sets a Layer to mode = Image with a
dither + lines-per-mm choice, previews where it will burn, and gets
correct M4-mode raster G-code from Compile.

**Success path (the only path that ends in working G-code):**

1. Operator drags a `.png` (or `.jpg`) onto the canvas, OR clicks
   "Add Image" in the Toolbar.
2. App decodes the image, computes intrinsic mm-bounds from the
   image's DPI metadata (defaulting to LightBurn's 254 DPI when none —
   ADR-048), inserts a `RasterImage` SceneObject at the canvas centre.
3. The image renders on the workspace via Canvas2D `drawImage` —
   real bitmap, scaled into mm-bounds. (Distinct from the Phase E
   "trace this image" flow, which converts to vectors immediately.)
4. The image's color is unimportant for layer assignment; raster
   images bypass color-based layer creation and land on a default
   "Image" layer that the auto-create pass tags `mode = 'image'`.
5. Operator selects the Image layer, sees the new fields appear:
   - **Dither**: dropdown of `threshold` / `floyd-steinberg` /
     `grayscale`. Default `floyd-steinberg`.
   - **Lines/mm**: number input, 5..25, default 10.
6. Workspace shows the image where it will burn; no separate "preview
   the dither" overlay in v1 — the image itself is the preview.
7. **Compile** → emit-gcode walks the scene. The Image layer's group
   dispatches to `emitRaster` (M4 mode, per-pixel X sweep with S
   modulating per dither output). Active rows alternate
   left-to-right / right-to-left, and overscan extends the entry and
   exit side of each row by ~5 mm with S0.
8. G-code file lands in the chosen output target (download, Save As,
   or the connected serial).

**Error / edge states:**

- **No image data**: user typed Compile with an empty Image layer →
  G-code emits nothing for that layer, toast warns: "Image layer has
  no raster object; nothing to engrave."
- **Multiple images on one layer**: warn at compile time. v1 supports
  exactly one RasterImage per image-mode layer. Extras skip.
- **Non-RasterImage on an Image layer**: e.g. user dropped a vector,
  then flipped its layer to Image mode. Compile skips with toast,
  same shape as F-F1 Fill open-polyline warning.
- **Lines/mm > 20**: warn but allow — at ≥ 25 the bandwidth to the
  Falcon over USB starts to bottleneck; >20 lines/mm produces ~6 MB
  G-code for a 100×100 mm image which is on the edge.
- **Stream gigabytes**: protected by the streaming-emit path (per
  ADR-020 Q3), so the renderer doesn't OOM.

**Acceptance for F.2.f hardware verification (concrete checklist):**

Pre-flight (no laser):
1. Build a fresh project. Verify `Import Image…` button exists in
   the toolbar between `Text…` and `Trace Image…`.
2. Click `Import Image…`, pick a 50×50 mm test PNG (e.g. a
   400×400 px black-and-white logo).
3. The image lands centered on the bed, fills its natural 96-DPI
   mm-bounds, and appears as a bitmap (not vectorized).
4. A new layer auto-creates at color `#808080` with `mode = image`,
   `dither = floyd-steinberg`, `lines/mm = 10`.
5. Click Save G-code. The output should contain:
   - `M5` then `M4 S0` before any image-group G1
   - `; image layer ... color #808080 power ...%` comment
   - `; 400 × 400 px, 50.000 × 50.000 mm`
   - Many `G1 Xn.nnn Sn` lines with `S` values changing per dither output
   - Trailing `M5` before the post-amble's `G0 X0 Y0 S0`

Hardware burn on the Falcon (must be confirmed by user):
1. **50×50 mm test patch, threshold mode at 5 lines/mm**, 30% power,
   3000 mm/min feed. Outcome: visible burned shape, even tone, no
   over-burn at corners (M4 dynamic mode confirmed working).
2. **50×50 mm grayscale photo, floyd-steinberg at 10 lines/mm**, 60%
   power, 4500 mm/min. Outcome: photographic tonality, dithered
   pixel pattern visible at close range.
3. **5×5 cut + 30×30 image in the same job**: layer order matters
   — confirm that mode flips between M3 (cut) and M4 (image) at the
   right group boundaries (`M5` between groups; no laser-on travel
   between groups).
4. **Frame works on an image layer**: clicking Frame on a scene
   with only a RasterImage traces the 4 corners of the image's
   mm-bounds (not the overscan-extended rectangle).
5. **No "burn-line on travel" artefacts**: between rows, the head
   moves at S=0 — verify by looking at the row-end overscan zone
   for any unintended burn marks.
6. **Bidirectional row speed**: on a two-row black/white test patch,
   the second active row should return right-to-left instead of
   rapiding back to the left edge first. If the burn shows ghosted or
   staggered vertical edges, lower speed for the job and treat scanning
   offset calibration as the next hardware task.

When this checklist passes, mark F.2.f complete in the hardware
verification inventory and tag the build as the first Phase F.2 release.

### F-F3. Set work origin to the current head position (Phase F.3)

**ADR:** [ADR-021](DECISIONS.md#adr-021--phase-f3-set-work-origin-via-g92-kickoff).

**Operator intent.** Place the workpiece anywhere on the bed, jog the
head to one of its corners, and run the next job relative to that
physical point — without moving the workpiece to the machine origin.
Matches LightBurn's "Set Job Origin to Current Position" UX.

**Where in the UI.** New `OriginRow` in the Laser panel, between the
existing SetupRow (Home / Auto-focus / Frame / Start) and the
streaming controls. Two buttons:

- **Set origin here** — sends `G92 X0 Y0`. Declares the current head
  position as work-coord (0, 0). Toast confirms the controller's `ok`
  acknowledgement (not merely USB write completion); the status
  bar's `Origin:` row flips from "machine 0,0" (muted) to
  "X… Y… (custom)" (accent-red, bold) within ~0.25–7.5 s as GRBL's
  next WCO-bearing status frame arrives. Frame and Start switch to
  user-origin placement only after that `ok`; they do not wait for the
  later WCO-bearing status frame.
- **Reset origin** — sends `G92.1`. Clears the offset, status returns
  to "machine 0,0". Disabled when no custom origin is active.

**Status readout.** `StatusDisplay` shows MPos + `Origin:` row. The
`Origin:` row reads from `wcoCache` (cached last-seen WCO across
status frames). It must never read the raw `statusReport.wco` — GRBL
only emits WCO every Nth frame, so the raw field is null on ~29
frames out of 30 and would flicker the readout.

Every origin command requires a connected controller with known Idle
status and no outstanding acknowledgement. It exclusively owns the
controller command arbiter until `ok`/`error`/`ALARM`, so Start,
Console, settings, and other motion cannot steal its response. The two
commands in a persistent-origin update are acknowledged one at a time;
local origin truth changes atomically only after both succeed.

The readout and Reset action treat any nonzero WCO axis as meaningful,
but job placement is axis-specific: only a nonzero X or Y offset proves
an XY custom origin. A Z-only touch-off remains visible and may establish
work-Z evidence, but it cannot enable User Origin or Verified Origin.

**The five states.**

1. **Success.** Connected, idle, head jogged to a workpiece corner.
   Click Set origin here → toast "Origin set to current head position
   (G92)." → status row updates to "Origin: X… Y… (custom)". Click
   Frame → head traces the job's front-left anchored bounding box
   around the workpiece corner. Click Start → job runs at the
   workpiece corner.
2. **No connection.** Both buttons disabled (`busy = props.disabled
   || streaming`; `disabled` set by `LaserWindow` when connection
   isn't `connected`). User must connect first.
3. **Rejected / interrupted update.** If a command is rejected, times
   out, disconnects, or a multi-command persistent update fails after
   its first `ok`, the cached WCO and frame proof are cleared and the
   origin source becomes `unknown`. Start remains unable to resolve a
   custom placement until the operator re-establishes or resets it.
4. **Alarm clears origin mid-session.** Operator sets origin, then a
   limit switch triggers (or `\x18` is sent). GRBL clears G92
   internally; the alarm branch in `laser-line-handler.ts` clears
   `wcoCache`; the status row reverts to "Origin: machine 0,0". User
   re-jogs and re-sets if they want the offset back.
5. **Off-bed risk.** Operator sets origin near the bed edge, then
   runs a job whose scene-mm bounds *fit the bed* but extend off the
   *machine* once the offset is applied. When WCO is known, Frame and
   Start preflight check the physical bounds (`job bounds + WCO`) and
   block with an out-of-bed message before motion. If no controller
   position/WCO has been observed yet, Frame/Start can still place the
   job relative to the custom origin but cannot prove the physical
   extents; wait for an Idle status/WCO readout before relying on the
   safety check.

**Hardware verification checklist (Falcon A1 Pro — user-driven).**

1. Connect → `StatusDisplay` shows `Origin: machine 0,0` (muted).
2. Jog (or motors-off hand-drag) the head to a workpiece corner.
   MPos updates accordingly.
3. Click **Set origin here**. Within ~5 s the readout flips to
   `Origin: X… Y… (custom)` (red/bold), values matching the previous
   MPos. Toast confirms.
4. Click **Frame**. Head sweeps the job's front-left anchored bounding
   box *around the workpiece corner*, not around machine origin or the
   image's auto-centered canvas placement.
5. Run a 5 mm × 5 mm test square (S=0 or low power on scrap). It
   should burn at the workpiece corner.
6. Click **Reset origin**. Toast confirms; readout returns to
   `Origin: machine 0,0`.
7. **Alarm-clear path.** Set origin again, then deliberately trigger
   an alarm (e.g. hit a soft limit). The readout returns to
   `Origin: machine 0,0` on alarm receipt. Click Unlock; the readout
   stays at machine zero (GRBL keeps G92 cleared after `$X`).
8. **Abort-clear path.** Set origin, start a job, press **ABORT**
   (the GRBL path requests Ctrl-X plus accessory-off cleanup). The readout returns
   to machine zero after the controller reports the reset state.
9. **Reconnect-clear path.** Set origin, disconnect, reconnect. The
   readout shows `Origin: machine 0,0` (cache cleared on
   `teardown`).
10. **$10 unusual config.** Set `$10=1` (WPos-only) and repeat steps
    2–3. The cache should still update — WCO is reported on a
    separate bit from MPos/WPos.

When this checklist passes on the Falcon, promote Phase F.3's
"Future feature notes" entry in `PROJECT.md` to "Phase F.3 —
Shipped" and update the hardware verification inventory.

#### No-homing positioning guide (ADR-193)

For a device profile with Homing disabled, a newly created or opened project
starts in **User Origin** (2026-07-16 maintainer amendment; previously Current
Position): Start refuses until an origin exists, so the default flow is
position the head, **Set origin here**, then Start. The machine
panel shows **Position job** with two paths:

1. **Jog with controls.** The operator clicks **Choose jog positioning** to
   select Current Position; the guide then shows this mode as **Selected** and
   does not present a capture-style action. The operator jogs to the chosen
   9-dot job anchor, may click Frame to inspect the perimeter, then clicks
   Start. Frame remains available but is not required. Set origin is not
   required while Current Position is active.
2. **Move head by hand.** The operator selects **Release motors to move by hand**,
   confirms Release motors, and physically moves the head. The guide then exposes
   **Use this position**, which sends Wake and waits for controller recovery.
   If GRBL reports Alarm, the guide names the state and requires the operator
   to press **Unlock and continue** after confirming the head is safe. Only
   after fresh Idle does the app send Set origin, select Verified Origin, and
   report that the hand position is ready. Frame is mandatory before Start.

Errors remain recoverable in place. A rejected Release, Wake, Unlock, or Set
origin displays its controller-derived reason and does not advance the guide.
Disconnect cancels the local guide state. An alarm, reset, disconnect, origin
change, or job change invalidates a Verified Origin Frame proof. Current Position
and User Origin do not create or require a Frame proof.
The raw placement dropdown and advanced origin controls remain available for
fixtures and deliberately manually-homed Absolute Coordinates workflows.

---

### F-BC1. Capture a placed board's corners (ADR-124)

**ADR:** [ADR-124](DECISIONS.md#adr-124--capture-board-corners-build-the-registration-box-from-jogged-machine-coordinates-2026-07-08).

**Operator intent.** Place a board anywhere on the bed, jog the head to
each corner and press Capture, and have the app draw the board's outline
on the canvas at its exact size, set the work origin at the bottom-left
corner, and let artwork be centered (or corner-snapped) onto it. Solves
"burn on a board I just placed, centered" without a camera.

**Where in the UI.** A **Place Board** toolbar button (Tools group, next to
Registration Jig) toggles a NON-modal floating panel pinned to the top-left
of the canvas — the same pattern as the registration jig, so canvas mouse
handling and the Laser panel's jog controls keep working while it is open
(the operator jogs on the right, captures in the panel). It guides the
operator (bottom-left first — that corner becomes the origin — then the
other corners in any order), shows the live head position, and offers
Capture / Undo last / Start over. After four corners it shows the measured
board and **Create board outline**; once created it shows **Place artwork**
(Center + four corners) and **Jog head to** (Center + four corners) plus
**Capture a new board**.

**Manual size (know your dimensions?).** After capturing the bottom-left
corner (which sets the origin), the panel also shows a **type the board size**
form: enter width × height and **Draw board at this size** instead of jogging
to the other three corners. The outline draws from the captured corner at that
size — the same result as a four-corner capture, faster for material you've
already measured. Blocked below 3 mm like the measured path.

**Why button-jog only.** GRBL is open-loop — pushing the head by hand does
not update the reported position, so a hand-jog capture would record the
last *commanded* point, not where the head is. Capture is always via the
jog controls.

**The four states.**

1. **Success.** Connected, Idle, board on the bed. Jog to the bottom-left
   corner → Capture (sends `G92 X0 Y0`; the `Origin:` row flips to
   custom). Jog to the remaining three corners — **in any order/direction** —
   → Capture each (width/height come from the bounding box, so the outline's
   size and orientation don't depend on which way you go around). Create board
   outline → a dashed rectangle appears centered on the canvas at the
   measured size, labeled `W × H mm` (check it against a ruler); placement
   switches to User Origin. Add artwork, select
   it, **Center** → it snaps to the board's middle; Start burns it centered
   on the physical board.
2. **No connection / not Idle.** The Capture button is disabled (same gate
   as the JogPad: connected + Idle + no job/motion) and a "Connect the
   machine to capture a board" hint shows. No position is recorded.
3. **No live position.** Capture is disabled until a status report with a
   machine position arrives; "Jog head to" reports "needs a live machine
   position" rather than sending an axis-less jog.
4. **Off-square / rotated / too-small board.** The outline is drawn
   axis-aligned, so if the four corners don't form a clean rectangle square
   to the bed — the board is rotated, or a corner was mis-captured — an
   "aren't a clean rectangle square to the bed (off by N mm)" warning shows;
   the operator can straighten the board and recapture, or continue if it
   looks right. If the captured extent is under 3 mm in either dimension it's
   treated as a mis-capture: the warning says it's too small and **Create
   board outline** is disabled until Start over.

**Accidental input.** A double-click on Capture is deduped — a second press
at the same (stationary-head) position is ignored, so a corner can't be
recorded twice and silently corrupt the rectangle. If the work-origin write
fails, the panel shows an inline error instead of leaving the operator on
"Corner 1" with no feedback.

**Hardware verification checklist (user-driven — hardware CLAIMED).**

1. Connect → Idle. Click the **Place Board** toolbar button to open the panel.
2. Jog to the board's bottom-left corner; Capture. The `Origin:` row flips
   to `X… Y… (custom)` within a few seconds; the step advances to corner 2.
3. Capture the other three corners in any order. The measured size should
   match the board (both dimensions and orientation) within eyeball
   tolerance (±~1 mm).
4. Create board outline → a dashed rectangle of that size appears centered
   on the canvas.
5. Add artwork, select it, **Center** → it lands in the middle of the
   outline. Run a low-power/S=0 test: it should trace centered on the
   physical board.
6. Try **Jog head to → Center**: the head should move to the middle of the
   board. Try a corner: the head returns to that corner.
7. **Remove board** deletes the outline; **Capture a new board** resets the panel; re-capturing replaces the
   outline (only one board at a time).

---

### F-BC2. Fill the placed board — auto-fit + array (ADR-125)

**ADR:** [ADR-125](DECISIONS.md#adr-125--fill-the-board-auto-fit--array-artwork-onto-the-placed-board-2026-07-08).

**Operator intent.** After placing a board (F-BC1), *fill* it: scale one design
to fill the outline, or tile copies across it — turning one coaster/keychain into
a whole production sheet.

**Where in the UI.** The **Place Board** panel's post-capture controls (below
"Place artwork"): a **Fill board → Fit to board** button, and an array form
(**Fit as many as fit**, or **rows × cols**, with an mm spacing gap) → **Array on
board**. Both are enabled only with a placed board and **exactly one** design
selected.

**The happy path.**
1. Place a board (F-BC1); add and select one design.
2. **Fit to board** → the design scales to fill the outline with a ~10% margin,
   centered (rotation-safe: a rotated design still centers).
3. Or set the array: leave **Fit as many as fit** checked to auto-count how many
   fit, or uncheck it and type **rows × cols**; set the **mm spacing**.
4. **Array on board** → copies tile the board, the block centered, as one undo
   step. Copies inherit the design's layer/settings.
5. Undo restores the single design. After arraying, the whole grid is selected, so Array/Fit disable until you undo (or reselect one design) - this stops a re-click from silently stacking a doubled burn.

**Edge / empty / error.** No board, or zero/several designs selected → both
controls are disabled ("Select exactly one design…"). A design larger than the
board tiles as a single centered copy. A runaway count (huge rows, or a tiny
design under "fit as many as fit") is capped per axis.

---

### F-BC3. Place a round (circle) board (ADR-126)

**ADR:** [ADR-126](DECISIONS.md#adr-126---generalize-place-board-to-a-board-shape-union-circle-boards-2026-07-08).

**Operator intent.** Capture a round blank (coaster, medallion) the same way as a rectangle, but a circle has no corners - so capture its CENTRE and give a diameter.

**Where in the UI.** The Place Board panel's Rectangle / Circle toggle (top of the capture phase). Circle mode replaces the four-corner steps with a centre capture + a diameter.

**The happy path.**
1. Open Place Board; click Circle.
2. Jog to the CENTRE of the board; Capture centre. This sets the work origin at the centre.
3. Type the hand-measured diameter, OR jog to any point on the rim and Capture edge to measure it (diameter = twice the centre-to-rim distance; it pre-fills the field).
4. Create board outline -> a locked circle draws around the origin, anchored at its centre.
5. Place / Fit / Array artwork exactly as for a rectangle (the circle is found by the same machinery). "Jog head to: Center" returns the head to the captured centre.

**Edge / empty / error.** A diameter below the minimum is blocked. A rim point on the centre (double-click) is ignored. Switching shape clears the in-progress capture. Fit/Array fill the circle's inscribed square, so a design stays inside the arc.

---

### F-F4. Convert a selected vector to a bitmap (Phase F.4)

**ADR:** [ADR-029](DECISIONS.md#adr-029--convert-to-bitmap-vector--raster-engrave-source).

**Operator intent.** Turn a vector object (imported SVG, text, or a
traced image) into a raster engrave source — the inverse of Trace —
so it burns as a dithered/grayscale image rather than outlines or
hatch fill. Matches LightBurn's **Convert to Bitmap** (Edit menu /
`Ctrl+Shift+B` / right-click).

**Where in the UI.** Toolbar **Convert to Bitmap…** button (next to
Trace Image), Tools menu, the workspace right-click context bar, or
`Cmd/Ctrl+Shift+B` (LightBurn's binding; LightBurn houses the menu
item under Edit — ours lives under Tools with the other conversions,
a deliberate divergence recorded in the ADR-029 amendment). Enabled
when **every selected object is a convertible vector** (one or
many); disabled (greyed, "Select a vector first.") otherwise —
including mixed selections with a raster among the vectors,
mirroring LightBurn's greyed menu item. A multi-selection merges
into **one** bitmap spanning the selection's combined bounds
(LightBurn-faithful, ADR-029 amendment ii): Fill All renders
even-odd across the whole selection — a shape nested inside another
object's shape becomes a hole, exactly like our Fill layer mode —
every source vector is deleted, and the whole swap is one undo
entry. The result is labeled `N objects (bitmap)`.

**The dialog** (A3/A4 + A5 brightness): **Render Type** (Fill All /
Outlines / Use Cut Settings), **DPI** (numeric field + slider,
127–635; the range derives from the app-wide 5–25 lines/mm raster
density limits because the conversion DPI becomes the new image
layer's interval — narrower than LightBurn's 10–2000 by design, see
ADR-029 amendment), and **Default Brightness** (percent, default
50% per LightBurn §7.4; 50% maps to luma 127, deliberately one step
below the Threshold cutoff so converted ink always burns — M7). The
dialog shows the estimated bitmap pixel size for the current DPI —
computed from the selection's full transform including rotation —
and disables Convert when it exceeds the raster budget.

**What it does.** Rasterizes the selected vector into a
`RasterImage` at the chosen DPI (default 254 = 10 lines/mm, a
KerfDesk choice — LightBurn documents no default), every inked
pixel at the chosen brightness on white. The source's transform
(scale/mirror/rotation) is **baked into the pixels**: the result
carries the transformed axis-aligned bounds with an IDENTITY
transform, so it lands exactly where the vector was and stays safe
for the raster output path (which does not rotate bitmaps).
**The source vector is deleted** (LightBurn discards the original);
the swap is one undo entry, so Ctrl+Z restores the vector — replacing
LightBurn's manual "duplicate first" guidance.

**The four states.**

1. **Success.** A closed-shape SVG / text / trace is selected. Click
   Convert to Bitmap → the dialog opens (Render Type / DPI /
   Default Brightness + size estimate) → Convert → the vector is
   replaced in place by a grayscale bitmap on the image-mode layer
   (`DEFAULT_RASTER_LAYER_COLOR`, or the next free color if that one
   is taken at a different density), the new bitmap becomes the
   selection, and a toast confirms "Converted to bitmap: `<name>`
   (bitmap)". It then engraves through the existing F.2 image path.
2. **Empty / nothing convertible.** No selection, or the selection is
   already a `RasterImage` (a bitmap can't be re-converted). Button
   disabled; tooltip prompts selecting a vector.
3. **Open / unfillable geometry.** A vector with only open contours
   (no closed shape) rasterizes to an all-white bitmap — Fill All
   fills closed shapes only, LightBurn's same closed-shape rule. The
   convert still succeeds; the operator sees a blank engrave source
   and can undo. (Outlines mode in A3 will render open paths.)
4. **Encode failure (edge).** If the browser cannot create a 2D
   canvas context (`toDataURL` unavailable), the build throws and is
   caught → error toast "Could not convert to bitmap: `<message>`";
   the scene is left unchanged (the swap never dispatched).

**Verification status.** Fill + PNG-encode + luma fidelity verified
in a real browser, side-effect-free (CLAUDE.md #4): the pure builder
rasterizes a square-with-hole to a real PNG that round-trips to
200×200 px at 254 DPI, ink at 50% gray, the even-odd hole preserved
white, and the base64 luma byte-matches the PNG. 2026-07-07 audit
re-verification (isolated, no live scene): the production rasterizer
matches the perceptual-harness reference pixel-for-pixel (IoU 1.0000
on a star + annulus), and rendered PNGs of Fill All / Outlines / a
rotated + scaled bake were eyeballed correct, bounds matching the
transform math exactly. **Not yet verified:** the live in-app
render/placement of the swapped bitmap on the workspace canvas, and
a side-by-side pixel comparison against LightBurn's own Convert
output — both deferred (need a live import or a LightBurn session).

### F-F5. Enhance a region of a trace (region-enhance re-trace)

**ADR:** [ADR-113](DECISIONS.md#adr-113--region-enhance-re-trace-dialog-boundary-mode-trace-fidelity-2026-07-05).

**Operator intent.** A small feature inside a large raster (a tiny
letter counter in a full logo) dropped out of the trace because it
sits at the tracer's detection floor at native size. Recover it by
boxing just that feature and re-tracing it supersampled, patched back
into the full trace — without re-tracing (or upscaling) the whole
image. This has no LightBurn equivalent (LightBurn's answer is manual
node-editing); the divergence is maintainer-sanctioned.

**Where in the UI.** Inside the Trace Image dialog (open it via
**Re-trace Original** on a committed traced image, or a fresh Trace).
Drag a box on the preview to set a region; a **Boundary** dropdown
appears under the preview with **Crop region** (default) and **Enhance
region**. The dropdown is hidden until a region exists, and **Clear
Boundary** removes the region and resets the mode to Crop.

**Success.** Box the feature → choose **Enhance region**. The preview
re-runs: the full image is traced, the boxed source region is re-traced
at 2× and downscaled, and its geometry is patched into the full trace
(polylines fully inside the region's shrunk interior are replaced;
everything crossing the box border or in the margin ring survives). The
preview shows the full trace with the boxed feature recovered. Commit
(**Trace**) writes the patched paths as the traced image, reusing the
same overlay registration as any trace.

**Error.** If the re-trace fails (worker error with an image too large
for the inline fallback, or a decode failure), the preview shows
"Preview failed: `<message>`" and commit surfaces a "Could not trace"
error toast; the scene is left unchanged. If the enhanced region
produces no paths and none survive the merge, commit warns "produced no
paths — try a higher contrast image" (shared with the plain trace path).

**Empty — no boundary.** With no region boxed, the Boundary dropdown is
absent and Enhance is unreachable; the dialog traces the whole image
(the ordinary Trace flow). Enhance is meaningless without a region, so
there is nothing to show.

**Edge — degenerate / tiny boundary.** A box that normalizes to zero
area (a click without a drag, or a region fully outside the image) is
rejected by `normalizeTraceBoundary`; enhance returns the full trace
unchanged. A box so small that its 2× supersample would still exceed
the upscale pixel budget traces the crop at 1× (native) instead of 2× —
no crash, just no supersample gain. A box whose shrunk interior is
empty (width or height ≤ 2× the edge margin) replaces nothing and the
full trace passes through untouched.

**Verification status.** Unit + jsdom green (crop delegates unchanged;
enhance patches the region; the toggle appears only with a boundary).
**NOT verified perceptually this session** — whether the real logo
counter is actually recovered in the rendered output is the
maintainer's perceptual pass (CLAUDE.md §2); green tests are not
fidelity proof.

### F-ML1. Material library — save, load, and session persistence

**Superseded (ADR-093, 2026-06-26).** The manual Save... / Load... /
Unload rail controls and the single-library `localStorage` slot
described below have been **removed**, replaced by in-app multi-library
auto-save (F-ML3) and the create/edit wizard (F-ML2). The file Save/Load
paths now live in the Saved Libraries page as Export... / Import...
This section is retained as the V1 history.

**Code:** `src/ui/layers/MaterialLibraryPanel.tsx`,
`src/ui/app/material-library-file-actions.ts`,
`src/ui/state/material-library-persistence.ts`. The library is
app-level state (like LightBurn's `.clb`), deliberately NOT stored in
the `.lf2` project file.

**Operator intent.** Keep per-material cut presets across sessions and
share them as files.

**Flows.**

1. **Save.** Panel **Save...** opens a save picker suggesting
   `<library name>.lfml.json`; success toasts "Saved material library
   to <name>" and clears the dirty `*`. Failure (picker error, write
   error) toasts the reason; the in-memory library is untouched.
2. **Load.** **Load...** (shown in both the empty and loaded panel)
   opens a picker filtered to `.lfml.json`. A valid file replaces the
   current library and toasts "Loaded material library: <name>". A
   file from a newer KerfDesk raises the schema-too-new alert; any
   other invalid file toasts the validation reason and keeps the
   current library.
3. **Session persistence (automatic).** Whenever the library or its
   dirty marker changes, the serialized library is written to
   `localStorage` (`laserforge.material-library.v1`). On launch, if no
   library is loaded, the persisted one is restored — including the
   dirty `*`. **Unload clears the persisted copy** (edge: unload means
   forget, not stash). A corrupt persisted slot is discarded silently
   rather than failing every boot.
4. **Persistence failure (edge).** If the localStorage write fails
   (quota), a single warning toast points the operator at **Save...**;
   editing continues unaffected.

### F-ML2. Create / edit a material preset (guided wizard) [Planned — ADR-093]

**Operator intent.** Make a reusable material preset by typing its
details directly — name, thickness, then cut settings — without first
editing a layer.

**Entry.** Cuts / Layers rail → **Materials** → **New material...** (or **Edit** on a
preset row) opens a multi-step `Dialog` wizard. The draft commits only
on the final Save, so Cancel/Escape at any step discards it.

**Steps.**

1. **Identity.** Material name (required); a **Thickness** vs **Surface
   (no thickness)** choice that reveals either a thickness-mm field or a
   title field; description (required); optional operation (Cut /
   Engrave).
2. **Cut settings.** Mode (Line / Fill / Image), power, min power,
   speed, passes, air assist.
3. **Mode details.** Only the chosen mode's fields — Line (kerf,
   tabs/bridges), Fill (interval/LPI, angle, overscan, cross-hatch,
   direction, style), or Image (dither, DPI/interval, dot width,
   negative, pass-through).
4. **Review & Save.** A summary, the device-hint compatibility note,
   and a plain "test on scrap; these are starting points" reminder.
   Save adds (or replaces, when editing) the preset and the library
   auto-saves (F-ML3).

**Flows.**

- **Success.** Save returns to the rail with the new/updated preset
  selected; a toast confirms "Saved <material>".
- **Error (invalid input).** Next/Save stays disabled until the current
  step validates (missing name or description, non-positive thickness,
  min power > power); the reason shows inline and nothing is committed.
- **Empty (no library yet).** New material... first prompts to create
  or open a library (F-ML3); the wizard then targets that library.
- **Edge (prefill from layer).** An optional **New from current
  layer** entry pre-fills steps 2–3 from the selected layer's recipe
  (the old "Create from Layer" shortcut), still fully editable before
  Save.

### F-ML3. Saved Libraries — in-app, auto-saved, browsable [Planned — ADR-093]

**Operator intent.** Keep several material libraries, switch between
them, and never lose presets — without managing files by hand.

**Storage.** Libraries live in `localStorage`
(`laserforge.material-libraries.v1`) as a keyed collection; each
payload is the byte-identical `.lfml.json` serialization. Any mutation
of the active library auto-saves. The legacy single-library slot
(`laserforge.material-library.v1`, F-ML1) is migrated in once, then
removed.

**Entry.** Cuts / Layers rail → **Materials** → **Saved Libraries...** opens a
`Dialog` listing every saved library: name, device hint, preset count,
last updated.

**Flows.**

- **Success.** **Open** sets a library active and closes the page;
  **New library**, **Rename**, and **Duplicate** update the list in
  place and auto-save.
- **Delete.** A job-aware confirm guards removal; deleting the active
  library leaves no active library (the rail shows the empty state).
- **Export / Import.** **Export...** writes the selected library to a
  `.lfml.json` file (the F-ML1 save path); **Import...** reads one and
  adds it to the list. A file from a newer schema raises the
  schema-too-new alert; any other invalid file toasts the reason and
  the list is unchanged.
- **Empty.** With no libraries, the page offers **New library** and
  **Import...** only.
- **Edge (quota / corrupt slot).** A failed auto-save warns once and
  points at Export...; a corrupt collection slot is discarded silently
  rather than failing every boot.

## Phase H flows (CNC router mode — ADR-098)

F-CNC1–3 document the surface that shipped in commit `032d476`. F-CNC4–19
are reserved for sub-phases H.1–H.10 and are fleshed out at each sub-phase
kickoff: F-CNC4 simulate, F-CNC5 stock setup, F-CNC6 v-carve, F-CNC7 STL
import, F-CNC8 relief roughing, F-CNC9 DXF import, F-CNC10 .nc import,
F-CNC11 tool library, F-CNC12 feeds/speeds apply, F-CNC13 CNC machine
profile, F-CNC14 tool-change job, F-CNC15 Z zeroing, F-CNC16 drill,
F-CNC17 relief finishing, F-CNC18 cut options (ramp/direction/leads),
F-CNC19 tiling.

### F-CNC1. Switch to CNC mode and configure the machine

#### Success
1. User clicks **CNC** on the machine-mode toggle atop the Cuts/Layers panel.
2. The CNC setup panel appears: bit selector (8 starter tools), stock
   thickness, safe Z, spindle max RPM, spin-up delay. The Material Library
   hides (laser power/speed recipes have no CNC meaning).
3. Layer rows swap laser fields for CNC fields. The change is undoable and
   marks the project dirty; `.lf2` save round-trips the machine config.
4. Toggling back to **Laser** restores laser fields; the CNC config is
   cached in the session and restored if the user toggles again.

#### Error — invalid setup value
1. Out-of-range input (stock ≤ 0, safe Z ≤ 0, RPM ≤ 0) snaps back to the
   committed value on blur; nothing invalid persists to the store.

#### Empty
1. A new project defaults to laser mode; CNC mode with no objects shows the
   normal empty-workspace state with CNC fields on the default layer.

#### Edge — project saved in CNC mode opened on another machine
1. `.lf2` deserialization normalizes the machine config field-by-field;
   unknown tools are dropped, a missing active tool falls back to the first
   tool, and malformed values revert to defaults (never a crash).

### F-CNC2. Set per-artwork CNC operation settings

#### Success
1. User selects artwork, then picks a CNC operation: Outside / Inside / On path, Pocket,
   or Engrave. Each artwork starts with its own operation; a multi-selection can intentionally share.
2. Depth, depth-per-pass, feed, plunge, and spindle RPM accept typed values;
   Pocket additionally shows stepover %, profile cut types show the tabs
   group (enabled, height, width, count). Outline and Engrave operations show
   a **Line art** selector (inner / outer / both, default inner): a traced
   double-line ring — a nested closed pair tighter than the bit diameter —
   machines only the chosen edge, while wider nesting and lone contours
   always cut (ADR-218).
3. Preview and time estimate update to the compiled CNC job (pockets and
   engraves first, then profiles inner-before-outer).
4. Artwork run controls set priority inside each safe phase. The compiler never moves a profile
   ahead of remaining clearing work or splits a contiguous tool section merely to satisfy priority.

#### Error — depth exceeds stock
1. Preflight (F-CNC3) reports depth > stock thickness + 1 mm; the save/start
   path is blocked until fixed.

#### Empty
1. An operation with no bound geometry compiles to no passes and is skipped; no G-code group is
   emitted for it.

#### Edge — open paths on a profile-outside layer
1. Open polylines cannot be offset; they are cut on-path (documented
   fallback), closed shapes on the same layer still offset normally.

### F-CNC3. CNC preflight and save G-code

#### Success
1. User clicks **Save G-code** in CNC mode.
2. CNC preflight runs: settings validity, depth ≤ stock + 1 mm, machine
   bounds, no-go zones, plunged-travel scan (no XY rapid below safe Z, no
   rapid plunge), non-empty output.
3. The file emits through `cncGrblStrategy`: G21/G90/G94 preamble, M3 +
   spin-up dwell, safe-Z discipline, per-layer comment headers, M5 + park
   postamble.

#### Error — preflight violation
1. The modal lists each issue with its code and message; no file is written
   (no-partial-output invariant).

#### Empty
1. No output-enabled CNC layers with geometry → "empty output" preflight
   issue; no file written.

#### Edge — feed or RPM above machine limits
1. Values are capped at compile time (device max feed, spindle max RPM);
   the emitted file never exceeds machine limits even if the layer fields do.

### F-CNC4. Simulate a CNC job (material-removal preview) — Phase H.2

#### Success
1. In CNC mode with output layers, the user toggles Preview. The stock
   footprint shows as a dashed wood-toned rectangle; the compiled job's
   material removal renders as a depth-shaded overlay (light = shallow,
   dark = deep) under the route lines.
2. The scrubber (drag / Play) reveals removal progressively; the shading
   at any scrub position shows exactly the material cut so far. Plunges
   and retracts advance the scrubber by their Z distance.
3. ⏮ Pass / Pass ⏭ buttons jump the scrubber between CNC pass starts
   (each downward plunge). The stats panel shows Cut / Travel / Plunge /
   Total distances and the time estimate.
4. The simulation is provably faithful: a property test locks the
   simulator's step sequence to the emitted G-code's motion (H.2.3).

#### Error — job invalid
1. Preflight-failing jobs show the same preview-blocked state as laser
   (the preview reflects the compiled job only when one exists).

#### Empty
1. No output-enabled CNC layers → the standard "Nothing to preview" hint;
   no removal overlay, stock rectangle still visible.

#### Edge — single shallow engrave / huge stock
1. A zero-depth pass removes nothing: overlay stays empty (transparent).
2. A stock larger than ~1M grid cells coarsens the simulation grid
   automatically; shading gets blockier, never freezes the app.

### F-CNC8. Rough a relief — Phase H.5

#### Success
1. A relief object on an output-enabled layer compiles to waterline
   roughing: the heightmap is dilated by the active bit's footprint plus a
   0.5 mm finishing allowance (gouge-free by construction), sliced into Z
   levels by the layer's depth-per-pass, and each level's region fills
   with concentric rings at the layer's stepover.
2. Passes run depth-major (whole level before stepping down) as a
   clearing group — before any profile cuts. The preview's removal
   shading shows the terraced relief forming.
3. Emitted G-code passes the plunged-travel invariant; the object transform
   (move/scale/rotate) is honored.

#### Error — bit too big for the detail
1. Regions narrower than the bit's dilated footprint produce no rings
   there — fine detail is left for the H.8 finishing pass (and the
   preview shows it uncut). Nothing gouges.

#### Empty
1. A flat mesh or a zero-depth relief compiles to no passes; the layer
   is skipped.

#### Edge — allowance ≥ relief depth / huge mesh
1. If the 0.5 mm allowance meets or exceeds the relief depth, only the
   shallowest levels produce regions (possibly none) — correct: there is
   nothing to rough without cutting into finishing stock.
2. Roughing samples the heightmap at bit-diameter/8 cells (0.2 mm floor),
   so compile stays fast even for large meshes.

### F-CNC7. Import an STL relief — Phase H.4

#### Success
1. In CNC mode, the user drags an `.stl` file onto the workspace. Both
   binary and ASCII STLs parse (a binary file whose header starts with
   "solid" is detected by its length signature).
2. The mesh lands as a relief object at 100 mm wide (height by aspect),
   5 mm relief depth, background carved away ('floor'), on a wood-brown
   layer created automatically. Toast reports the triangle count.
3. The canvas shows the relief as a grayscale depth map — light = stock
   top, dark = floor. It selects, moves, and saves/loads like any object;
   `.lf2` embeds the mesh so projects stay self-contained.
4. Roughing toolpaths compile from it starting with H.5.

#### Error — wrong mode / malformed / oversized
1. Dropping an STL in laser mode toasts "STL relief import needs CNC
   mode" and imports nothing.
2. Truncated binaries, partial ASCII facets, and non-numeric vertices are
   rejected with the specific reason; meshes over 200k triangles ask for
   decimation.

#### Empty
1. An STL with zero facets is rejected ("contains no vertices").

#### Edge — flat mesh / rotation
1. A mesh flat in X or Y is rejected — nothing to carve.
2. Rotated reliefs render axis-aligned in v1 (the depth map draws in the
   transformed bounding box); toolpaths (H.5) will honor the transform.

### F-CNC6. V-carve a layer — Phase H.3

#### Success
1. With a v-bit active in Material & Bit, the user sets a layer's cut type
   to **V-carve (angled bit)**. Cut depth becomes the MAX depth (wide
   regions clamp to it and cut a flat floor); a **Detail** field controls
   ring spacing (0 = auto, bit diameter ÷ 8).
2. Compile produces an inward offset ladder: rings at inset d cut at
   z = −min(d / tan(θ/2), depth). Sharp corners reach their full depth via
   the vanishing offset (medial axis); holes are respected.
3. The preview's removal shading shows the V-groove deepening toward shape
   centers; the emitted G-code passes both motion and depth invariants.
4. V-carve groups run BEFORE profile cuts (they never free the part).

#### Error — active bit is not a v-bit
1. The layer panel shows an inline warning; preflight blocks Save/Start
   with "V-carve requires a v-bit" until one is selected.

#### Empty
1. Open paths and layers with no closed shapes compile to no passes; the
   layer is skipped.

#### Edge — region narrower than the ring spacing / depth clamp
1. Regions too narrow for even one ring at δ produce no rings there —
   the groove simply ends (no gouge, no error).
2. depthMm larger than the shape supports: the ladder stops where offsets
   vanish; depth per pass still caps every plunge.

### F-CNC5. Stock setup (footprint on the bed) — Phase H.2

#### Success
1. In CNC mode, the Material & Bit panel offers stock width, height, and
   origin X/Y alongside thickness. Defaults: 400 × 400 mm at the machine
   origin (the 4040 bed).
2. Committing a value is undoable and marks the project dirty; `.lf2` save
   round-trips the footprint.
3. On Save G-code / Start job, toolpaths that leave the stock footprint
   raise a non-blocking advisory toast ("bit will cut air or clamps").
   Bed bounds remain the blocking preflight error.

#### Error — invalid dimension
1. Width/height clamp to [1, 1500] mm; origin clamps to [-1500, 1500] mm;
   non-numeric input snaps back to the committed value.

#### Empty
1. No geometry → no advisory (nothing to compare against the footprint).

#### Edge — pre-H.2 project file
1. A `.lf2` saved before stock footprints existed loads with the default
   400 × 400 footprint at the origin; thickness is preserved.

### F-CNC9. Import a DXF drawing — Phase H.6

#### Success
1. The user picks a `.dxf` in File → Import DXF (or drops one on the
   workspace). Import works in BOTH machine modes — DXF vectors are
   machine-agnostic geometry sources (ADR-101 §1).
2. The clean-room parser (no libraries — ADR-098 §2) reads ASCII DXF
   ENTITIES: LINE, CIRCLE, ARC, LWPOLYLINE (including bulge arcs), classic
   POLYLINE/VERTEX/SEQEND, ELLIPSE, SPLINE (clean-room de Boor sampling),
   and INSERT block references (translate/scale/rotate, recursive with a
   depth cap). `$INSUNITS` scales to mm — unitless files assume mm; DXF's
   Y-up frame flips to the canvas frame, and the drawing normalizes so its
   bounding box lands at the workspace origin.
3. Entity colors map through the AutoCAD Color Index: explicit per-entity
   colors win, BYLAYER resolves through the LAYER table, and every distinct
   resolved color becomes/joins a LaserForge layer — exactly like SVG
   stroke colors.
4. The result lands as one imported vector object (the same SceneObject
   variant SVG uses, `source` = the .dxf filename), so Cut/CNC settings,
   preview, save, and both compilers apply immediately. The toast reports
   how many entities imported and what was skipped.

#### Error — malformed / binary
1. Binary DXF (the "AutoCAD Binary DXF" sentinel) is rejected with
   "Binary DXF is not supported — re-export as ASCII DXF."
2. A truncated tag stream or a non-numeric group code is rejected with the
   offending line number; nothing partial imports.

#### Empty
1. A DXF whose ENTITIES section holds no supported geometry imports
   nothing; the toast lists the skipped entity types so the user knows why
   (e.g. "skipped 12 TEXT, 3 HATCH").

#### Edge — unsupported entities / degenerate curves / nested blocks
1. TEXT, MTEXT, DIMENSION, HATCH, 3DFACE, and other unsupported entities
   are counted and skipped — never a crash, never partial geometry from
   inside them.
2. SPLINE sampling is bounded per span, so degenerate knot vectors cannot
   hang the import; zero-radius arcs and zero-length lines are dropped.
3. INSERT recursion caps at depth 8; deeper nesting (or a block cycle)
   skips that reference with a note.
4. Z coordinates are ignored (2.5D import): 3D polylines project onto XY.

### F-CNC10. Open a G-code program in the simulator — Phase H.6

#### Success
1. In CNC mode, the user picks a `.nc` / `.gcode` / `.tap` file via
   File → Open G-code (Preview). The command is CNC-only (ADR-101
   gate-and-hide, first CNC-only command).
2. The clean-room modal parser (ADR-098 §2) reads GRBL-dialect G-code:
   G0/G1 (including ramped XY+Z and pure-Z moves), G2/G3 arcs (I/J center
   and R radius form, helical Z), G90/G91, G20/G21 units, F/S words,
   `(...)` and `;` comments, `%` markers, and N line numbers. Unsupported
   words are counted, never fatal.
3. The program becomes a simulator toolpath directly — travel / cut /
   plunge steps with Z spans. Preview turns on: route lines, the
   material-removal grid, the scrubber, and distance stats all work.
   Re-importing KerfDesk's own CNC export produces the same material
   removal as the native compile (re-import parity, pinned by test).
4. A toast names the file, its cut/travel totals, and anything skipped.
   Exiting Preview drops the external program and returns to the
   project's own compiled toolpath.

#### Error — not G-code / bad arc
1. Files with no recognizable G-code words are rejected ("does not look
   like G-code") naming the first offending line.
2. A G2/G3 without I/J or R (or with an inconsistent radius) is rejected
   with its line number; nothing partial loads.

#### Empty
1. A program with no motion (comments/setup only) toasts "no motion
   found" and leaves the current preview untouched.

#### Edge — relative arcs / early end / huge files / other planes
1. G91 relative coordinates apply to XY, Z, and arc targets alike.
2. M2 / M30 ends the program mid-file; later lines are ignored.
3. Programs beyond 500k lines are rejected with a note (guard against
   runaway files, not a real-world limit).
4. G18/G19 plane arcs are not supported: rejected with the line number
   (XY-plane G17 is the GRBL default and the only plane GRBL arcs use
   here).

### F-CNC11. Manage the bit library — Phase H.7

#### Success
1. Material & Bit → Manage bits lists every bit (starters + custom).
   The add form takes name, kind (end mill / ball nose / v-bit /
   engraving), diameter, and tip angle (v/engraving only).
2. An added bit is selectable immediately (machine bit list and every
   per-layer Bit select) and persists app-level in localStorage — it
   merges into the tool list of every future CNC session, across
   projects.
3. Deleting a custom bit removes it from the library and the open
   machine (undoable). Starters have no Delete button.

#### Error — invalid fields
1. Empty names and non-positive/oversized diameters are ignored — the
   Add button does nothing until the fields are sane.

#### Empty
1. No custom bits: the list shows only starters; nothing is deletable.

#### Edge — layers referencing a deleted bit
1. Layers keep the stale toolId; compile falls back to the machine's
   active bit (layerCncTool), so output never references a missing bit.

### F-CNC12. Save and apply feeds/speeds presets — Phase H.7

#### Success
1. Every CNC layer card has a "Feeds preset" row: name the current
   feed / plunge / spindle / depth-per-pass / stepover and Save.
2. Choosing a preset from the select applies those five values to the
   layer as one undoable patch. Cut type, depth, and tabs stay put.
3. Presets are app-level (localStorage) — available in every project.

#### Error — storage full
1. A failed persist warns once per session; the in-memory library keeps
   working.

#### Empty
1. No presets: the select offers only "Apply…".

#### Edge — preset saved for a different bit
1. Presets carry raw numbers; applying one to a layer whose bit differs
   is allowed (feeds are material/bit judgment — the operator's call).

### F-CNC13. Save and apply CNC machine profiles — Phase H.7

#### Success
1. Material & Bit → Machine profiles: Save snapshots the whole CNC
   setup (stock, bit list, active bit, safe Z, spindle, park, tiling)
   under a name; Apply replaces the current setup (undoable); Delete
   removes the profile.
2. Profiles are app-level (localStorage), usable across projects.

#### Error — non-CNC project
1. Save/Apply are no-ops in laser mode (the panel is CNC-only anyway).

#### Empty
1. No profiles: the select shows only "Choose profile…"; Apply and
   Delete stay disabled.

#### Edge — profile with bits the library no longer has
1. The snapshot carries its own tool list, so applying restores those
   bits for the project even if the library changed since.

### F-CNC14. Run a multi-bit job (M0 tool change) — Phase H.7

#### Success
1. Layers may each pick their own bit (Bit select). Compile orders the
   job into contiguous per-bit sections — one change per bit — with
   profile-carrying sections last, so a freed part is never
   re-machined.
2. Between sections the G-code retracts, stops the spindle (M5), parks,
   and pauses on M0 with comments naming the next bit. GRBL holds until
   cycle start; the streaming UI's Resume continues the job.
3. Geometry offsets use each layer's OWN bit diameter.

#### Error — v-carve layer with a flat bit
1. Preflight blocks with the layer's bit named (not just the machine
   bit).

#### Empty
1. All layers on one bit → no M0 blocks; output is byte-identical to a
   single-tool job.

#### Edge — unknown per-layer bit id
1. Falls back to the machine's active bit at compile time.

### F-CNC15. Re-zero Z at a tool change — Phase H.7

#### Start gate — establish stock-top Z0
1. CNC Start is blocked until manual Zero Z or a settled probe records
   work-Z evidence for the current reference epoch. The gate cannot be
   overridden because KerfDesk's CNC emitter defines Z0 as the stock top.
2. The evidence also records the Active bit selected when Zero Z/probing begins.
   Start compares it with the first bit in the exact compiled tool-section plan;
   missing or mismatched identity blocks until the planned bit is loaded,
   selected, and referenced again.
3. Probe-derived evidence starts with touch-plate removal unconfirmed. Start
   remains blocked until the operator removes both plate and probe lead and
   clicks **Confirm plate removed** in the probe panel.
4. Set Origin establishes XY only and does not satisfy this gate. Laser Start
   is unaffected.

#### Success
1. Every M0 change block carries "; re-zero Z on the stock top, then
   cycle-start to resume". The operator swaps the bit, selects that exact bit
   as Active, jogs Z to touch the stock top, zeros Z (or probes), and resumes.
2. **Continue remains disabled** until the pre-change retract/park has drained
   to a fresh controller Idle and the new tool's Z zero has been established
   with the stable tool ID expected by the compiled section plan. A probe also
   requires explicit plate-removal confirmation.
3. Continue first emits `G0 Z<safe>` with the spindle off. Only after that
   clearance move does it emit M3 + spin-up dwell and resume cutting.

#### Error — resumed without re-zeroing
1. Continue remains blocked with "establish its Z zero" until Zero Z or a
   successful probe records fresh work-Z evidence for the replacement bit.
   That evidence records whether it came from manual Zero Z or a settled probe
   and must match the current work-Z reference epoch.
2. KerfDesk proves agreement between the selected Active-bit ID, the Z evidence,
   and the compiled plan, and records an explicit plate-removal acknowledgement.
   It cannot sense the physical cutter or plate; truthful tool selection,
   removal confirmation, clamping, and actual spindle-at-speed remain
   operator/machine responsibilities.

#### Empty
1. Single-bit jobs never pause.

#### Edge — manual feed-hold mid-section
1. The operator's own feed-hold is unrelated to M0 blocks; Resume works
   the same way.

### F-CNC16. Drill holes (peck cycle) — Phase H.7

#### Success
1. Cut type "Drill (peck at centers)" drills one hole at the
   bounding-box center of every closed shape on the layer.
2. Each hole pecks: plunge one depth-per-pass step, feed back to the
   stock top to clear chips, re-enter, repeat to full depth. The whole
   cycle runs at the plunge feed (GRBL has no G81/G83 — the cycle is
   explicit motion).

#### Error — invalid depth
1. A non-finite or non-positive drill depth fails the standard CNC settings
   validation. Finite positive depths are not capped by stock thickness.

#### Empty
1. Open paths are ignored; a layer with no closed shapes drills nothing
   and the layer is skipped.

#### Edge — very shallow holes
1. depth ≤ depth-per-pass produces a single plunge with no clear moves.

### F-CNC17. Finish a relief (ball-nose skim) — Phase H.8

#### Success
1. A relief layer's "Finish with" select names the finishing bit; the
   scallop field sets the ridge-height target. Compile then emits the
   roughing group AND a finishing group cut with that bit (an M0 change
   separates them when the bits differ).
2. Finishing rides the max-plus tip surface — the bit tip can never cut
   below the target anywhere under its footprint — in serpentine rows
   spaced 2·sqrt(c·(2r−c)) for a ball nose (flat bits step 40% of
   diameter).
3. Roughing still leaves its fixed 0.5 mm allowance (it exists FOR this
   pass); finishing consumes it down to the true surface.

#### Error — unknown finishing bit id
1. The finishing group is skipped (roughing-only), never a crash.

#### Empty
1. "Roughing only" (the default) emits no finishing group.

#### Edge — flat reliefs / tiny scallop
1. A flat surface skims at exactly its depth; scallop clamps to
   [0.001 mm, bit radius] and row spacing floors at 0.05 mm.

### F-CNC18. Cut options: ramp entry, direction, entry points — Phase H.9

#### Success
1. The layer card's "Entry" row (profile/pocket/engrave) offers
   Climb / Conventional / Default direction and a ramp angle.
2. Direction enforcement re-orients closed toolpaths (M3 spindle: climb
   keeps material LEFT of travel — outside profiles run CCW,
   inside/pocket run CW) and rotates entry points to the midpoint of
   the longest segment so witness marks land on a flat span.
3. A ramp angle > 0 turns plunges into descents ALONG the toolpath at
   that angle; closed loops re-cut the ramped span level afterwards.
4. Offset pockets can instead enable **Helical entry**. Each ring retracts,
   relocates, and descends through a native tangent helix that ends at the
   contour start. Raster pockets, islands, disconnected pockets, and a minimum
   diameter that cannot fit are blocked before output.
   Depth ladders ramp each step from the previous level.

#### Error — none (both options are clamped)
1. Ramp angle clamps to [0.5°, 45°]; direction only applies where a
   material side exists (engraves/open paths are left alone).

#### Empty
1. Defaults (no direction, 0 ramp) keep output byte-identical to
   pre-H.9.

#### Edge — path shorter than the ramp
1. The descent finishes at the path end (the ramp consumed the whole
   path); the remainder cuts level on the next lap.

### F-CNC19. Tile a job larger than the bed — Phase H.10

#### Success
1. Material & Bit → Tiling: enable, set tile size, overlap, and
   registration holes. Save G-code then exports ONE FILE PER TILE
   (sequential save dialogs, names carry the index: job_tile-r1-c2.nc).
2. Each tile's file contains only the motion inside its rectangle
   (clipped at boundaries, Z interpolated), translated so the tile's
   corner is the machine origin: cut tile 1, slide the stock, re-zero
   XY on the next tile frame, cut tile 2, and so on.
3. With registration holes on, adjacent tiles drill 3 mm dowel holes at
   IDENTICAL stock positions inside the overlap strip — pins re-index
   the stock physically between tiles.

#### Error — a tile fails preflight
1. Every tile preflights BEFORE any file is written; a failure names
   the tile and writes nothing (no-partial-output over the whole set).

#### Empty
1. An empty compile toasts "Nothing to tile"; a job smaller than one
   tile exports a single (untiled-equivalent) file.

#### Edge — cancelling mid-sequence
1. Cancelling a save dialog stops the remaining tiles; the toast
   reports how many of the set were saved.

### F-CNC20. Probe work zero with a touch plate — Phase H.11 (ADR-103 G2)

#### Success
1. Router controls → "Probe (touch plate)": pick Z-only (stock top) or
   XYZ corner (plus which corner). Plate thickness, max travel, and (for
   XYZ) bit diameter are editable; bit diameter prefills from the
   machine's active bit. Run is enabled only when connected and Idle.
2. Z cycle: fast G38.2 seek down, 2 mm back-off, slow re-touch, then
   `G10 L20 P0 Z<thickness>` — work Z0 lands on the STOCK TOP (plate
   underside) — and a retract. Every line owns the controller response
   arbiter exclusively; after the retract, the active driver's planner
   fence plus two fresh Idle reports complete before the toast confirms
   "work zero is set and motion is settled".
3. XYZ corner cycle: Z first over the plate center, then each side face
   (two-stage, flank contact below the plate top). The cycle keeps all
   positioning relative and leaves the previous WCS untouched until all
   six contacts succeed. One acknowledged `G10 L20 P0 X... Y... Z...`
   then commits the complete corner frame before the bit parks just
   outside it. Corner choice mirrors all directions and signs.
4. When current Work-Z evidence is missing, a connected, Idle controller
   that supports owned modal/WCS reads exposes **Advanced: Reuse existing
   controller setup** → **Use existing controller Z zero**. After explicit
   stock-top/tool confirmation, it reads `$G` → `$#` → `$G` and records the
   verified offset; it never probes, moves, writes a zero, imports G-code, or
   starts interrupted-job recovery. Success replaces the action with compact
   verified status.

#### Error — probe never fires / fires early
1. ALARM:5 (no contact within travel): named toast — check the clip
   lead, start closer, `$X` to unlock, retry.
2. ALARM:4 (already triggered): named toast — check for a short /
   already-touching bit, `$X`, retry.
3. Any error:N stops the sequence immediately; nothing further is sent.
   In XYZ mode, an error before the combined G10 leaves the previous WCS
   unchanged. A timeout or disconnect while that one commit is awaiting
   acknowledgement makes the coordinate state unknown, so setup evidence
   remains invalid until the operator re-establishes the work frame.
4. No `ok` within 45 s, or failure to settle at fresh Idle: timeout toast
   names the pending boundary, invalidates work-Z/status evidence, and
   warns that motion state is unknown (physical stop if unsafe).

#### Empty
1. The panel does not render in laser mode (auto-focus owns that flow).

#### Edge — busy machine / mid-job
1. Probing refuses while a job streams, a jog/frame is in flight,
   auto-focus runs, another probe is running, or another controller
   acknowledgement/Idle wait is outstanding (preflight toast, no bytes
   written). Start, Console, settings, origin, and other motion remain
   blocked until the probe fence and fresh Idle complete.
2. The status poll keeps running during the cycle; an Alarm status seen
   mid-cycle aborts with the unlock hint even if the ALARM line raced.
3. Disconnect/port loss during probing is treated as unsafe active motion;
   commanded Disconnect uses the controller stop/reset cleanup, and an
   unexpected close raises the physical-stop safety notice.

### F-CNC21. Adjust feed/spindle/rapids during a job — Phase H.11 (ADR-103 G3)

#### Success
1. While a job streams (or is paused), the job controls grow an
   "overrides" box: Feed and Spindle each show the live percentage with
   −10 / +10 / 100% buttons; Rapids offers 25 / 50 / 100.
2. Each press sends the single GRBL real-time byte — applied instantly
   mid-motion, no queueing, no stream disturbance (the bytes bypass the
   character-counted buffer by design).
3. The percentages read back from the controller's `Ov:` status field
   (cached across frames like WCO, so the display never flickers).

#### Error — none from the app's side
1. GRBL itself clamps feed/spindle overrides to 10–200%; presses beyond
   the clamp are no-ops on the controller. A failed serial write surfaces
   the standard write-failure notice.

#### Empty
1. Before the first `Ov:` frame arrives the readouts show "—" (the
   buttons still work).

#### Edge — alarm / disconnect mid-job
1. Alarm, Sleep, and port-close clear the cached percentages (the next
   session re-learns them); overrides reset to 100% on GRBL's own reset.

### F-CNC22. Boolean shapes and offset paths — Phase H.11 (ADR-103 G1)

#### Success
1. Tools → Subtract / Intersect / Exclude (next to Weld) combine two or
   more selected closed vector shapes: the BOTTOM-MOST selected object
   is the subject, the rest are cutters. Subtract cuts the upper shapes
   out of it; Intersect keeps only the shared area; Exclude keeps
   everything but the overlap. The result replaces the selection as one
   path object (subject's color), selected, in one undo step.
2. With closed shapes selected, the layers panel shows an "Offset" row:
   distance + Outward / Inward adds a NEW offset path object (round
   joins) and leaves the sources in place — kerf compensation on a
   laser, clearing outlines and inlay gaps on a router.
3. Both work in laser AND CNC modes (geometry is machine-agnostic).

#### Error — invalid input
1. Booleans are disabled with a reason when fewer than two closed
   vector objects are selected — the menu never runs the op, so there
   is nothing to surface.
2. Open contours are rejected — the scene is unchanged and a warning
   toast names the reason (same rule as Weld).
3. An inward offset large enough to collapse the shape changes nothing
   and warns why. Open contours and a collapsing offset are reachable
   cases the menu gating cannot pre-detect, so the op runs, no-ops the
   scene, and surfaces a warning toast rather than dead-ending silently
   (the failure modes are typed per ADR-131; the toast is CNV-04).

#### Empty
1. An Intersect of non-overlapping shapes produces nothing, leaves the
   scene untouched (empty results never replace the sources), and shows
   a warning toast explaining the result was empty.

#### Edge — transforms and z-order
1. Object transforms are baked to world space before combining, so a
   moved/scaled/rotated shape combines where it VISIBLY sits.
2. Changing which shape is bottom-most (Arrange z-order) changes what
   Subtract keeps — by design; the flow documents the convention.

### F-CNC23. View the simulated cut in 3D — Phase H.11 (ADR-103 G4)

#### Success
1. In a CNC Preview, the route controls grow a "3D" button. It opens a
   dialog rendering the material-removal grid as a shaded heightfield
   over the stock outline — the VCarve-style solid cut preview, for ANY
   job (profiles, pockets, v-carves, drills), not just reliefs.
2. The 3D surface reflects the scrubber position: scrub to 40%, open 3D,
   and only the material removed so far is missing. Drag orbits, scroll
   zooms; depth is true to scale.
3. The display grid downsamples to ~360 cells across, keeping the
   deepest value per block so narrow slots stay visible.

#### Error — no WebGL
1. The dialog opens with "3D view unavailable: <reason>" instead of
   crashing (same fallback contract as the relief viewer).

#### Empty
1. The button only appears when a removal grid exists — CNC previews
   with a compiled toolpath. Laser previews never show it.

#### Edge — huge stock
1. The underlying grid already coarsens beyond 4M cells; the display
   pass reduces further, so a full-bed job cannot freeze the dialog.

### F-CNC24. Calculate feeds & speeds from chipload — Phase H.11 (ADR-103 G5)

#### Success
1. Every CNC layer card has a "Feeds calculator": pick the material
   family and flute count; the bit diameter comes from the layer's own
   bit and RPM from the layer's spindle setting. The row shows the live
   result — feed = RPM × flutes × chipload, plunge as a material
   percentage, depth-per-pass as a fraction of bit diameter.
2. "Apply to layer" writes feed / plunge / depth-per-pass / spindle in
   one undoable patch. Cut type, depth, and tabs stay put. The values
   compose with H.7 presets (calculate once, save as a preset).
3. The chart values are labeled STARTING POINTS ("listen to the cut") —
   PROVISIONAL industry-typical mid-range chiploads per diameter band.

#### Error — none (inputs are bounded)
1. Material and flutes are selects; tiny results floor at 50 mm/min feed
   / 0.1 mm per pass rather than emitting zeros.

#### Empty
1. The row renders only in CNC mode (laser layers have no feeds).

#### Edge — v-bits and unusual bits
1. The calculator uses the bit's DIAMETER regardless of kind; for
   v-carving the chipload model is a rough guide only — the flow says
   so rather than pretending precision.

### F-CNC25. Surface the spoilboard — Phase H.11 (ADR-103 G8)

#### Success
1. Material & Bit → "Surface spoilboard": width/height (prefilled from
   the stock), stepover % of the active bit, total depth. Save writes a
   provenance-stamped standalone .nc: serpentine rows per 0.5 mm depth
   step, spindle-off safe-Z lift before M3/spin-up, park at the origin
   after M5. Fixed feeds are capped to the device-profile maximum.
2. The toast repeats the operator contract: zero X/Y at the area's
   front-left corner and Z on the surface to be faced before running.
3. Before the picker opens, emitted-text preflight checks the work-origin
   bed envelope, enabled no-go-zone uncertainty, feed/RPM ceilings,
   finite coordinates, safe travel/depth, and spindle-start clearance.
   Connected-controller $30/$32 mismatches use the normal export confirm.

#### Error — save fails
1. A preflight failure or failed dialog/write toasts the reason; nothing
   is written.

#### Empty
1. Cancelling the save dialog writes nothing.

#### Edge — non-dividing dimensions
1. The last row lands exactly on the far edge, so the whole area is
   faced even when height doesn't divide by the stepover.

### F-CNC26. Relieve corners for slot-fit joinery (dogbone) — Phase H.11 (ADR-103 G6)

#### Success
1. With closed shapes selected in CNC mode, the "Dogbone" row (bit
   diameter prefilled from the active bit) relieves every corner
   sharper than 135° with a bit-radius overcut circle — square parts
   then seat fully into routed slots. One undo step; objects are
   replaced in place.
2. Style is the corner overcut (circle centered on the vertex),
   documented as the PROVISIONAL v1; directional dogbone/T-bone are
   future refinements.

#### Error — nothing qualifies
1. Obtuse-only shapes (or open contours) leave the scene untouched.

#### Empty
1. The row renders only in CNC mode with an eligible selection.

#### Edge — reflex corners and islands
1. Reflex (inside-L) corners and hole rings (islands of remaining
   material) are never relieved.

### F-CNC27. Supervised CNC interruption recovery — Phase H.11 (ADR-200)

> Demoted by ADR-215: the default CNC recovery review is the pass-boundary
> wizard (F-CNC45); this runway review remains reachable via its
> **Advanced: mid-pass runway…** action.

#### Success
1. CNC Job controls show the neutral collapsed **Interrupted job saved** card
   instead of a raw G-code line input. Generic checkpoint resume and arbitrary
   start-from-line remain blocked in both UI and core.
2. After an interrupted CNC job, the newest exact capsule offers **Review
   supervised recovery**. Controller
   acknowledgements are displayed as diagnostics and never select geometry.
3. The wizard requires an explicit first-uncertain native contour segment; no
   segment is preselected. It previews the uncertainty segment, remaining path,
   and same-direction tangent runway. The first segment, a cornered lead-in, or
   insufficient cleared distance is refused.
4. The executable v1 runway profile uses at least 5 mm, the lower of configured
   acceleration and 100 mm/s², plus a 2 mm margin. Invalid acceleration fails
   closed. The operator must identify the machine-specific air-cut or scrap-test
   record that qualified this profile.
5. Physical review separately confirms: cutter clear; spindle stopped; position
   re-homed/requalified with G54 XY/WCS and Z zero verified; installed tool intact;
   stock/workholding unchanged; all machining before the selected segment known
   complete; and the entire displayed runway physically clear.
6. Start uses the sealed prepared semantic job, recovery manifest, original scope,
   resolved origin, and exact G-code from the capsule; the open canvas is not a
   recovery input. A SHA-256 package binds source and generated recovery G-code,
   semantic plan, runway profile, review, cleared-runway proof, and prefix proof.
7. The new job keeps the uncertainty remainder, every later pass in that
   operation, and every later operation. Its machine order is safe-Z retract →
   spindle start and dwell → rapid to the confirmed-clear runway start → feed
   plunge → tangent re-entry and remaining work.
8. Immediately before streaming, the ordinary Idle/alarm/controller/profile/
   work-zero/override/accessory/bounds/no-go gates and exact-program CNC setup
   attestation run again. The operator must supervise re-entry with the physical
   E-stop reachable.
9. Laser jobs retain Start from line: modal state is reconstructed and the head
   positions with the beam off before arming.

#### Error — impossible resumes
1. Every CNC call into the core resume builder is refused before parsing or
   emitting motion, even if a hidden/stale UI or future caller bypasses the
   visible control. The supervised path is a newly compiled Job, not a relaxation
   of that refusal. Laser recovery still refuses out-of-range lines, programs
   using G91 before the resume point, and empty tails.
2. Recovery refuses artifact/manifest integrity mismatch, non-CNC or mixed output,
   multi-tool job, imported/3D/arc/helical pass, missing qualification or physical
   confirmation, invalid motion/profile, missing straight runway, failed
   preflight, stale/claimed capsule revision, or any ordinary Start blocker.
3. If the cutter may still be embedded, spindle state is not physically known,
   or position/tool/workholding cannot be requalified, the wizard cannot command
   an escape. Use the machine manufacturer's manual procedure and physical E-stop
   or power isolation where required.

#### Empty
1. Without a retained CNC capsule, no recovery card is shown.
   Laser Start from line is disabled while disconnected or any job/motion is active.

#### Edge — laser jobs
1. Programs with no Z words never receive Z commands in the preamble —
   a laser resume re-fires at the recorded XY without touching Z.

#### Edge — interrupted recovery attempt
1. A pre-acceptance failure releases the attempt claim, so the same capsule remains
   retryable. If transmission may have begun and the run fails or the app crashes,
   the attempt becomes the newest capsule; the source no longer represents current work.
2. Recovery performs a final synchronous comparison after its controller queue and
   live-state awaits. Drift in controller session/qualification, `$30`/`$32`
   evidence, WCO/origin, position, tool, or Work Z refuses before recovery G-code.

### F-CNC28. Watch the live 3D result while designing — ADR-105 G9

#### Success
1. In CNC mode a docked "3D result" pane sits between the canvas and the
   layers panel, continuously simulating the CURRENT job: edit a shape,
   change a depth, swap a bit — the heightfield re-renders (deferred so
   typing stays smooth). Drag orbits, scroll zooms; depth is true to
   scale. The collapse button shrinks it to a sliver.

#### Error — no WebGL
1. The pane shows "3D view unavailable in this browser" instead of
   crashing.

#### Empty
1. With no output-enabled CNC content it shows a hint; a job whose cut
   type cannot produce toolpaths (e.g. pocketing open line art) empties
   the pane the same way — honest feedback, not an error.

#### Edge — laser mode
1. The pane never renders in laser mode.

### F-CNC29. Choose the pocket fill method — ADR-105 G10

#### Success
1. Pocket layers gain a "Fill method" select: Offset rings (default) or
   Raster X / Raster Y sweeps. Raster insets the region by the bit
   radius, serpentine-sweeps it at the layer stepover, and runs the
   finishing wall pass last.

#### Empty
1. Layers that never set the field keep offset rings — output is
   byte-identical to pre-ADR-105.

#### Edge — regions the bit cannot enter
1. Features narrower than the bit produce no sweeps there (same rule as
   rings); nothing gouges past the inset wall.

### F-CNC30. Insert art from the design library — ADR-105 G11 (machine-agnostic)

#### Success
1. The tool strip's "Lib" button opens the bundled Design library:
   categorized line-art (Animals / Nature / Symbols / Home & Food /
   Hobby & Travel, lucide ISC). Clicking a design inserts it through the
   normal SVG import pipeline as an engrave-ready vector object.

#### Error — unparseable entry
1. A failed parse toasts the name; nothing lands on the canvas.

#### Empty
1. The dialog always has the bundled set; the footer points at Import
   SVG + CC0 sources (openclipart) for filled/larger artwork.

#### Edge — pocketing library art
1. Bundled icons are open stroke line art: engrave/on-path cut types
   apply directly; pocketing requires closed shapes (draw or import
   filled artwork instead).

### F-CNC31. Auto-fill feeds from a material — ADR-111 #1

#### Success
1. Every CNC layer card has a "Material" select at the top (Custom +
   Softwood / Hardwood / Plywood-MDF / Acrylic / Aluminium). Picking one
   fills feed, plunge, and depth-per-pass in a single undoable patch from
   the chipload engine, using the layer's own bit and a 2-flute
   assumption. Cut type, depth, bit, and tabs stay put.
2. The choice is remembered on the layer (materialKey) and round-trips in
   the .lf2 file; it is display-only and does not change compiled output.

#### Error — none (bounded)
1. Material is a select; the engine floors tiny results (feed / per-pass)
   rather than emitting zeros, same as the advanced Feeds calculator.

#### Empty
1. The row renders only in CNC mode. "Custom" clears materialKey and
   leaves the current feeds untouched for hand-tuning.

#### Edge — full flute/RPM control
1. The one-click fill assumes 2 flutes; operators who need a different
   flute count or RPM use the advanced Feeds calculator, which composes
   with H.7 presets.

### F-CNC32. Switch a layer card between Basic and Advanced — ADR-111 #4

#### Success
1. CNC layer cards default to **Basic** and lead with Material, followed by
   Cut type, Bit, Cut depth, Depth per pass, Feed, Plunge, Spindle, and Tabs.
   The core machining values stay visible for review. The Cuts/Layers panel's
   "Advanced cut settings" checkbox reveals helpers and specialist controls
   (presets, calculator, stepover, pocket fill, and cut-type tails) on every
   card; the choice persists across sessions.
2. Cut depth carries a one-click "Set to stock thickness (N mm)" button. It
   sets the exact measured thickness without silently adding spoilboard
   overcut; any verified overcut remains an explicit operator edit.

#### Error — none (view toggle only)
1. Toggling never changes cut settings; it only shows/hides fields.

#### Empty
1. The toggle and its fields appear only in CNC mode.

#### Edge — a hidden advanced value still applies
1. Specialist fields hidden by Basic keep their values and still drive output
   (e.g. a pocket's stepover); Basic hides complexity, it does not reset it.

### F-CNC33. Fill machine settings from the connected controller — ADR-111 #3a

#### Success
1. When a controller is connected and its `$$` snapshot differs from the
   current setup, a "Machine reports …" banner appears atop Material &
   Bit. "Apply" writes the reported spindle max (GRBL $30) to the machine
   and the reported travel ($130/$131) to the bed, then the banner clears.

#### Error — none (opt-in)
1. Nothing changes until Apply is clicked; ignoring the banner is safe.

#### Empty
1. No connection, or reported values that already match, means no banner.

#### Edge — bed vs stock
1. Travel fills the machine BED (work envelope), never the stock — the
   workpiece footprint stays whatever the operator set. Spindle max is the
   RPM ceiling; per-layer running speed is unchanged.

### F-CNC34. See stock/feed advisories against machine limits — ADR-111 #3b

#### Success
1. At Save G-code and Start, with a controller connected, KerfDesk warns
   when the job overruns the reported limits: stock larger than the
   reported travel, or a layer feed above the reported max rate (the
   controller would clamp it). Advisory only — the export/stream proceeds.

#### Error — none (advisory, not a gate)
1. These never block Save/Start; bed-bounds violations remain the separate
   hard preflight error.

#### Empty
1. No connection (no reported limits) means no limit advisories — only the
   existing stock-footprint and raster advisories show.

#### Edge — which layers count
1. The feed check considers only layers set to output; a hidden/off layer
   with an aggressive feed does not raise the advisory.

### F-CNC35. Set the project material once (Easel-style) — ADR-112

#### Success
1. The Material & Bit panel shows a "Material" dropdown (above Bit) the
   moment you switch to CNC — no design needed. Pick your stock material and
   every layer's feed / plunge / depth-per-pass fills from it (each layer's
   own bit + spindle), in one undoable step.
2. New layers inherit it: add a layer or import an SVG after choosing the
   material and the fresh layers come in with those feeds (not the generic
   1000 / 1.5 default). Set material first, then import — the Easel order.

#### Error — none (bounded select)
1. Material is a dropdown; feeds floor at safe minimums via the calculator.

#### Empty
1. The dropdown shows in CNC mode only. "Custom" clears the project material
   and leaves current feeds untouched for hand-tuning.

#### Edge — per-layer override and other object types
1. A layer's own Material picker (F-CNC31) overrides the project material for
   that layer. Text and drawn shapes don't auto-seed (like laser defaults);
   set their material on the layer card, or re-pick the project material to
   apply to all.

### F-CNC38. Keep origin and work-Z evidence axis-honest — Phase H.11

#### Success
1. Set Origin changes X/Y only. If KerfDesk already knows the prior Z offset,
   it preserves that Z; otherwise it waits for a fresh WCO-bearing status
   instead of copying machine Z into the work-offset cache.
2. Reset Origin and persistent-origin flows that send `G92.1` invalidate
   work-Z evidence because GRBL clears every transient G92 axis.

#### Error — acknowledgement or readback failure
1. Existing origin transaction rules remain fail-closed: a rejected, alarmed,
   timed-out, or disconnected mutation leaves origin truth unknown and Z
   evidence unavailable.

#### Edge — persistent probe-derived Z
1. The current store records work-Z as a boolean, not its controller offset
   source. After `G92.1`, KerfDesk conservatively requires a new touch-off even
   when a persistent G54 Z may still exist; later `$#` readback may prove and
   preserve that distinction.

### F-CNC38. Retract and wait before every CNC cutting start — Phase H.11

#### Success
1. A native CNC job, a post-tool-change restart, and a standalone surfacing
   program all retract to configured safe Z before `M3`.
2. Each spindle start uses the machine-configured spin-up delay exactly. A
   positive value emits `G4`; zero deliberately emits no dwell.

#### Error — invalid spin-up time
1. Negative and non-finite spindle spin-up durations fail CNC preflight. Zero
   and finite positive values are accepted without a universal minimum.
2. Standalone surfacing generation follows the same rule and omits `G4` when
   the configured duration is zero.

#### Edge — physical at-speed feedback
1. The delay is a time-based operator setting, not sensor proof. GRBL `FS`
   feedback must not be used as proof of measured physical RPM; each machine
   must be configured with the delay its spindle actually requires.

### F-CNC39. Start from the compiled controller-override baseline — Phase H.11

#### Success
1. When the live GRBL `Ov:` cache is known, CNC Start accepts the exact
   100/100/100 baseline immediately.
2. Positive feed, rapid, or spindle reductions from 1-100% may also Start after
   the operator sees and acknowledges all three exact percentages.
3. Once streaming begins, the operator may still adjust overrides deliberately
   through the existing in-job controls.

#### Error — stale override changes the physical plan
1. CNC Start blocks an increase above 100%, zero/invalid values, or a changed
   value after acknowledgement. The compiled G-code, fingerprint, and setup
   attestation do not substitute for this live controller state.

#### Edge — unknown or externally changed state
1. A missing `Ov:` cache is not presented as observed 100% state. Firmware that
   omits the field has no live guarantee yet; external senders changing it
   between reports remain outside the single-sender contract.
2. Laser Start is unchanged by this CNC-only gate.

### F-CNC40. Neutralize live spindle and coolant state before CNC Start - Phase H.11

#### Success
1. GRBL accessory reports decode clockwise spindle (`A:S`), counter-clockwise
   spindle (`A:C`), flood (`A:F`), and mist (`A:M`) into a cache that survives
   status frames where the intermittent field is absent.
2. An `Ov:` report without `A:` is the protocol-backed all-off observation.
   CNC Start proceeds past this gate only when that fresh cache contains no
   active accessory; generic CNC Resume is disabled by F-CNC41.
3. When a CNC controller is otherwise idle but reports an active accessory,
   the job panel names every active channel and offers **Stop spindle & coolant**.
   After the operator confirms the cutter is clear of material and stopping is
   safe, the action sends one guarded `M5 M9` block and waits for fresh status
   before Start can become eligible.

#### Error - Idle controller still has an accessory active
1. CNC Start blocks even though motion state is `Idle`, names the live spindle
   direction and/or coolant channels, and requires `M5`/`M9` plus a fresh
   all-off status report.
2. A sparse status frame with neither `A:` nor `Ov:` does not erase a previously
   active observation.
3. Arming any job stream invalidates the previous observation, so a partial
   initial/refill write failure cannot reuse stale all-off state on retry.
4. After the CNC setup confirmation closes, Start discards the older cache and
   first reserves the app's controller write path, drains earlier app acks, and
   waits for the ack from a queued dwell marker. It then requests a fresh
   `Ov:`/`A:` observation and rechecks connection, Alarm, Idle, override,
   accessory, setup-epoch, reservation, and zero-pending-ack state immediately
   before arming the stream.
5. A controller reboot during that window cancels Start and invalidates volatile
   origin, work-Z, position, override, and accessory evidence.
6. A transport write is reserved before the port promise yields. Start waits for
   both transport and ack ledgers; reset/reconnect epochs reject late old-session
   completions, and the queued fence must end in positive `ok` rather than
   `error`, `ALARM`, timeout, or reboot.

#### Edge - reported state is not physical sensor proof
1. `A:` is GRBL's controller-commanded accessory state. It does not prove
   measured RPM, coolant flow, relay position, or external VFD state.
2. Before either `A:` or `Ov:` has been observed, or after an app command that
   can mutate accessories, the cache is unknown and CNC Start fails closed
   until a fresh report arrives. Firmware that omits those reports cannot run
   CNC jobs with this gate. Laser Start remains unchanged.
3. grblHAL `SP1:`/`SPn:` secondary-spindle telemetry hard-blocks CNC Start and
   suppresses the generic `M5 M9` action. Multi-spindle selection and recovery
   require a dedicated machine-specific model.
4. grblHAL `A:E` spindle-encoder faults and `A:T` pending firmware tool changes
   hard-block Start and stay latched across ordinary Ov-only frames until an
   explicit A report or reset proves the exceptional state changed.
5. KerfDesk must be the controller's only command owner during Start and the
   job. GRBL cannot atomically bind a status observation to the next program
   bytes, so pendant, WebUI, PLC, macro, or second-sender mutations after the
   observation require an external interlock or machine-specific protocol.

### F-CNC41. Refuse generic same-session CNC Resume - Phase H.11

#### Success - controlled pause
1. **Pause** still sends realtime feed hold and immediately stops refilling the
   controller stream. It remains useful as the first controlled response when
   continuing motion would be unsafe.
2. The paused UI keeps **ABORT** available and explains that this CNC job cannot
   be resumed automatically.

#### Error - cutter may be engaged and spindle continuity is unproven
1. **Resume** is disabled for a CNC job. A direct/stale caller is also rejected
   by the store before the realtime cycle-start byte or any queued job bytes are
   written.
2. The job remains paused so the operator can request ABORT and follow a machine-specific
   manual recovery procedure. KerfDesk never attempts `M3`, spindle orientation,
   or a generic Z retract while cutter engagement is unknown.

#### Edge - future machine-specific continuation
1. `A:` and `FS:` prove controller-commanded state at one instant, not physical
   RPM, uninterrupted rotation, VFD health, coolant flow, or exclusive command
   ownership. Legacy GRBL therefore cannot satisfy the generic proof.
2. A future opt-in requires a machine-profile policy, exclusive control of all
   mutating paths, controller-visible safety/VFD faults, and an ack-neutral
   realtime-status arbiter that proves stable `Hold:0` continuity before `~`.
   This flow does not silently opt any current profile into that contract.

### F-CNC42. Attest exclusive controller access at CNC Start - Phase H.11

#### Success - one fresh Start confirmation
1. After compile/readiness succeeds, the CNC confirmation names physical
   workholding/clearance and every common competing command path: pendant/MPG,
   WebUI/network, another sender app, PLC motion or spindle commands, controller
   macros, and SD/file jobs.
2. The operator confirms KerfDesk is the sole command owner while emergency-
   stop, safety-door, and feed-hold circuits remain enabled.
3. The resulting evidence is bound to the exact program fingerprint plus the
   current trusted-position and work-Z-reference epochs.

#### Error - missing, incomplete, or stale evidence
1. The store rejects direct or stale callers before the queue fence, realtime
   query, or job bytes are written.
2. A reconnect, controller banner/reset, alarm/sleep, homing, origin/probe
   change, tool change, or other setup-trust invalidation requires a new
   confirmation.

#### Edge - declaration is not protocol ownership
1. GRBL cannot identify a sender or grant an exclusive lease. The confirmation
   is an operational contract, not proof that another path is inactive.
2. Machines with multiple intentional senders require a sole gateway/firmware
   lease and machine-level selector/interlock design before CNC Start can claim
   enforced ownership.

### F-CNC43. Refuse CNC Start while grblHAL MPG owns input - Phase H.11

#### Success - explicit MPG release or no MPG telemetry
1. `MPG:0` records that grblHAL released manual-pulse-generator ownership for
   the current controller session. CNC Start continues through all other gates.
2. Controllers that do not implement the field remain unknown and use the
   operator exclusive-access contract in F-CNC42.

#### Error - known competing owner
1. A latched `MPG:1` blocks CNC Start before the queue fence, status query, or
   job bytes and tells the operator to return control to KerfDesk.
2. If `MPG:1` arrives during the fresh live-state phase, the final Start gate
   refuses before any job byte is armed.

#### Edge - intermittent reports and reset
1. A status frame without `MPG:` does not clear prior evidence. Only explicit
   `MPG:0` or a new controller/transport session clears the active latch.
2. First `MPG:1` invalidates trusted-position, work-Z, Verified Frame, and the
   prior epoch-bound setup confirmation. `MPG:0` removes the owner blocker but
   does not restore that evidence.
3. `MPG:0` covers the grblHAL MPG stream only; WebUI, network, second serial,
   PLC, macro, and physical inputs remain under F-CNC42 and external interlocks.

### F-CNC44. Detect unowned GRBL terminal responses - Phase H.12

#### Success - every response has one KerfDesk owner
1. Stream terminal replies consume an in-flight stream line; app command
   replies consume a synchronously reserved non-stream ack and, where needed,
   the shared semantic command request.
2. Autofocus remains busy until its owned terminal `ok` and qualified Idle
   completion arrive through the main line pump. Status still updates the live
   store, including when both lines arrive in one serial read.

#### Error - orphan `ok` or `error`
1. On GRBL, grblHAL, or FluidNC, a terminal response with no stream line,
   reserved app ack, transport write, or shared command owner is intercepted.
2. It cannot advance the stream or trigger ordinary stream-error handling. The
   first orphan is retained as session evidence, and trusted-position, work-Z,
   Verified Frame, and prior CNC setup confirmation become stale exactly once.
3. CNC Start refuses before its queue fence and names the recovery: stop every
   competing sender, disconnect/reconnect, then repeat setup.

#### Edge - persistence and protocol limits
1. Dismissing the safety notice does not clear the orphan record. Alarm, Sleep,
   and welcome/reset banners also do not restore ownership confidence.
2. A disconnect or new connection clears the session record. A failed write
   releases only the ack reservation it created; a late response after command
   timeout remains attributable to that reservation.
3. Marlin, Smoothieware, and Ruida are excluded until their terminal/queue
   semantics receive a separate audit. Even on monitored families, this guard
   detects anomalies but cannot prove which external sender produced a reply.

### F-CNC45. Pass-boundary CNC recovery review - Phase H.13 (ADR-215)

#### Success
1. For CNC capsules, the **Interrupted job saved** card's Review opens the
   pass-boundary recovery wizard. The runway review (F-CNC27) remains reachable
   via **Advanced: mid-pass runway…**.
2. The wizard opens with extraction coaching for the recorded interruption
   cause: after a transport loss it warns the latched spindle may still be
   spinning and coaches jogging Z up while it spins; a stopped-embedded cutter
   gets collet / hand-rotation guidance and an explicit instruction never to
   power the spindle to free it. The app itself never commands extraction motion.
3. A pass map drawn from the sealed prepared job colors every pass by transport
   evidence — provably complete, uncertain, or not reached — and marks the
   selected boundary pass's start point.
4. The boundary picker preselects the computed default: the pass containing the
   first line NOT provably executed (acked count minus a per-controller planner
   reserve). Pass spans are re-derived by replaying the artifact's emitter
   lineage and trusted only when the re-emission reproduces the sealed bytes.
5. The operator confirms four physical facts — cutter clear, spindle stopped,
   workholding unchanged, tool installed/intact/Z-zeroed — and chooses position
   evidence: **retained** (enabled only with session-continuity evidence: the
   interruption was not a controller reboot AND the live work offset matches
   the offset archived with the run) or **re-zeroed**.
6. Start generates a NEW ordinary job — safe-Z retract → spindle start with its
   full spin-up dwell → rapid to the boundary pass start → plunge at plunge
   feed into already-cut kerf → recut that pass → every later pass and
   operation in source order — then runs the ordinary CNC Start gates and setup
   attestation again and streams through the sealed-capsule claim/stage/arm
   path (F-B16 semantics).

#### Error
1. An incomplete physical checklist, a retained-position choice without its
   evidence, a boundary pass that does not exist in the sealed job, or a failed
   preflight refuses with the specific reason; no controller command is sent.
2. Legacy fingerprint-only capsules cannot use pass recovery and are directed
   to the legacy review path.

#### Empty
1. Without a retained CNC capsule no recovery card is shown (unchanged).
2. When spans cannot be derived (the sealed bytes are not reproduced), no
   default boundary is computed: the wizard says so and requires manual pass
   selection — recovery is never refused for a missing sidecar.

#### Edge - later-than-default boundary
1. Picking a pass after the computed default shows an inline warning, and Start
   asks for one explicit confirmation that all earlier work is physically
   complete. The choice is warned, never blocked.

#### Edge - recut
1. The boundary pass is recut from its start, so already-cleared kerf may be
   lightly re-engaged where the wood relaxed; recut cost is bounded by one pass
   per operation. Multi-tool jobs resume with the boundary group's tool loaded
   and Z-zeroed (confirmed via the tool checklist item); later groups keep
   their ordinary M0 tool-change blocks.

## Phase I flows — multi-controller (ADR-094..097)

(Integrated as Phase I — ADR-104. Flow IDs keep their original F-H prefix.)

### F-H1. Select a controller family

#### Success
1. User picks a catalog profile (Machine Setup or Device Setup wizard) whose
   `controllerKind` is `grbl-v1.1`, `grblhal`, `fluidnc`, `marlin`,
   `smoothieware`, or `ruida`.
2. Connect selects the matching ControllerDriver and opens the port at the
   profile's `baudRate` (driver default when unset: GRBL family 115200,
   Marlin 250000). The capabilities snapshot re-gates every machine control.
3. The welcome banner runs through detection; `detectedControllerKind` is
   recorded.

#### Edge — banner disagrees with the profile
1. Log line: "Controller banner looks like X, but the profile selected Y.
   Check the device profile's controller setting." Nothing switches silently.

### F-H2. Run a job on Marlin (no realtime bytes)

#### Success
1. Status = queued `M114`, polled only while nothing is streaming and no
   controller command is pending; the DRO shows the parsed position.
2. Jog sends `G91` / `G0 …` / `G90`; Home sends `G28 X Y`; framing runs
   absolute `G0` legs; jobs stream ping-pong (one line per `ok`;
   `echo:busy` is not an ack).
3. **Pause** stops sending — buffered moves finish (the button title and
   safety copy say so). **Resume** continues the stream. **ABORT** requests the
   controller-specific reset/de-energize path; it is not a physical E-stop. The
   host stops sending and requests `M5` + `M107` cleanup.
4. Start shows the power-scale-unverified warning (no $30/$32 proof exists).

#### Error — firmware answers `Error:` or `Resend:`
1. Terminal for the stream (no replay); beam-off lines are written; with no
   alarm state the errored stream auto-releases at the next Idle report.

### F-H3. Smoothieware halt and recovery

#### Success
1. Realtime `?` / `!` / `~` work as on GRBL; pause is allowed WITHOUT the $32
   proof (Smoothie cannot report $-settings; its laser module ties beam to
   motion). Power words are fractional (S0.500 = 50% at the 0–1.0 scale).
2. Abort sends the controller-specific reset/de-energize sequence (Ctrl-X +
   `M5`/`M9` for GRBL); a halted controller answers `!!` to normal
   lines; the alarm banner's unlock sends `M999` and the machine returns Idle.

### F-H4. Export a Ruida job (.rd, EXPERIMENTAL)

#### Success
1. With a Ruida profile the Laser panel shows the file-only hint and Connect
   is disabled; preview/estimate work normally.
2. **Save G-code…** writes a `.rd` file instead (binary, swizzled) and toasts
   the EXPERIMENTAL warning every time: the encoding follows public research
   and has NOT been verified on a real controller — preview on the machine
   panel and test on scrap first.

#### Error — raster layers present
1. The export refuses with "Layer … uses Fill/Image raster output, which the
   experimental .rd encoder does not support yet."

## Phase K flows (box generator — ADR-106)

### F-K1. Generate a finger-joint box

#### Success
1. User opens **Tools → Box Generator…**. The dialog shows dimensions
   (W × D × H, inner/outer toggle — inner default), material thickness,
   target finger width, style (closed / open top), part spacing, and —
   prefilled from the active machine — the fit group: clearance
   (0 laser, 0.15 mm CNC) plus, in CNC mode only, the relief tool
   diameter (prefilled from the active tool).
2. A live preview pane shows the panel sheet re-laid-out on every valid
   edit; an invalid draft keeps the last valid preview and disables
   **Generate**.
3. **Generate** inserts one vector object per panel (6 closed / 5 open
   top) in the fixed order Bottom/Top/Front/Back/Left/Right, each named
   via its source field ("Box panel: Front", ADR-116) and carrying its
   outline plus any interior cutout rings (holes under even-odd fill),
   laid out in a flat grid with the requested spacing, all on one
   auto-created layer color, all selected, as ONE undo step. A toast
   reports "N panels inserted". The dialog closes; the user assigns cut
   settings on that layer as usual.
4. Laser fit contract: with the layer's kerf compensation set (Line
   mode cut settings, ADR-052), mating edges assemble line-to-line
   (press fit) at clearance 0; positive clearance loosens the joint by
   exactly that amount, uniformly.

#### Error — generation failure
1. If polygon assembly fails internally (degenerate spec that slipped
   past validation), the dialog shows the error inline; nothing is
   inserted, the scene is untouched (no-partial-output).

#### Empty
1. Empty or whitespace dimension fields disable **Generate** with the
   field-level message "Enter a value"; no toast, no insertion.

#### Edge — box larger than the bed
1. Panels insert normally even when the sheet exceeds the workspace
   (LightBurn parity: generation is not bounds-gated); the existing
   bounds preflight blocks save/start until the user re-nests panels
   across jobs.

### F-K2. Validation rejects an impossible spec

#### Success
1. Each field edit re-runs `validateBoxSpec`; issues render as a list
   under the fields, each naming the offending field.
2. Rules: dimensions and thickness > 0; derived inner dimensions must
   stay positive (outer entry mode); finger width clamps to
   [max(2 mm, T), span/3]; CNC: finger cell must exceed the relief tool
   diameter (error) and warns below 2× diameter; |clearance| <
   min(finger, T)/2.

#### Error — CNC finger cell smaller than the bit
1. "Finger width 2 mm is smaller than the 3.175 mm relief tool — tabs
   cannot be relieved. Increase finger width or use a smaller bit."
   **Generate** stays disabled.

#### Empty
1. A zero-dimension draft shows "must be greater than 0" on that field
   only; other fields keep their state.

#### Edge — thickness ≥ half the smallest dimension
1. Derived inner dimension goes non-positive; the error names both the
   dimension and the thickness so the user knows which to change.

### F-K3. CNC mode — clearance and corner relief

#### Success
1. With the machine in CNC mode, the dialog defaults clearance to
   0.15 mm and shows the relief tool diameter prefilled from the active
   tool; stock thickness prefills the material thickness field.
2. Generated panels carry corner-overcut reliefs (F-CNC26 style: circle
   of one bit radius centered on the vertex) at exactly the
   seat-critical reflex corners — notch bottoms where a mating tab must
   seat. Tabs narrow and recesses widen by clearance/4 per flank, so
   each joint's notch − tab play equals the clearance exactly.
3. The panels then flow through the normal CNC pipeline: the layer's
   profile-outside cutter compensation applies at compile, unchanged.

#### Error — relief tool larger than a finger cell
1. Validation error per F-K2; generation disabled until resolved.

#### Empty
1. Switching the machine to CNC with the dialog open re-runs defaults
   only for untouched fields; user-edited drafts are preserved.

#### Edge — laser mode
1. Laser mode never emits reliefs and defaults clearance to 0; the
   relief tool field is hidden (gate-and-hide, ADR-101).

### F-K4. Open-top box

#### Success
1. Style "Open top" drops the Top panel (5 panels) and flattens the
   walls' top edges at the outer face line — no orphan fingers pointing
   at a missing lid.
2. Corner cells that the Top would have claimed fall to the
   next-priority panel (Z > Y > X among present panels); the assembled
   rim is flush.

#### Error
1. (None specific — validation is style-independent.)

#### Empty
1. (Not applicable — style always yields ≥ 5 panels.)

#### Edge — height smaller than one finger cell
1. Wall corner columns degenerate to a single cell; the referee
   invariants still hold (edge pattern clamps to one full-span cell).

### F-K5. Undo, empty scene, and re-generation

#### Success
1. **Undo** after Generate removes all inserted panels and any
   auto-created layer in one step; **Redo** restores them still
   selected.
2. Generating into an empty scene creates the layer and panels exactly
   as into a populated scene; existing objects and selection are
   otherwise untouched.

#### Error
1. (Covered by F-K1 error state.)

#### Empty
1. Cancelling the dialog inserts nothing and leaves the draft persisted
   for the session (calibration-dialog convention), so reopening
   restores the last-entered values.

#### Edge — repeated Generate
1. Each Generate inserts a fresh, independent panel set offset onto the
   same layer color; no id collisions (fresh UUIDs), each set is its own
   undo step.

### F-K6. Divider grid (ADR-116)

#### Success

1. The dialog gains **Dividers across width** and **Dividers across
   depth** count fields (default 0). Any positive count adds evenly
   spaced divider panels to the sheet, named in the preview
   ("Divider X1", "Divider Y1", ...).
2. Dividers stand on the bottom panel at full inner height, carry tabs
   into through-slots cut in the two walls they meet (one shared
   alternating sequence per junction — complementary by construction),
   and cross intersecting dividers with egg-crate half-laps (X notched
   from the top, Y from the bottom).
3. Wall slots and cross-laps widen with the clearance pass exactly like
   edge recesses; in CNC mode every slot corner a tab must seat against
   carries the corner-overcut relief at full bit radius.

#### Error — compartments too small

1. A divider count that drives the compartment pitch under 2× thickness
   (or, CNC, drives slot cells under the relief tool) reports the count
   field with the limiting dimension; **Generate** stays disabled.

#### Empty

1. Both counts 0 produce byte-identical v1 output — no slots, no extra
   panels.

#### Edge — dividers with open-top style

1. Dividers compose with any style; on open-top the divider top edges
   finish flush with the wall rim line.

### F-K7. Slide lid (ADR-116)

#### Success

1. Style **Slide lid** produces six panels: bottom, back, slotted left
   and right walls, a front wall shortened to the slot floor, and a
   loose lid with a half-round thumb notch on its leading edge.
2. The side-wall channels run from the front edge to one thickness
   inside the wall body; the assembled lid slides over the shortened
   front and stops against the in-wall post (the captive top strip stays
   fingered into the back wall).
3. The lid and its slots are sized with the mandatory play so the lid
   physically slides; laser default clearance rises to 0.2 mm for this
   style (CNC keeps 0.15 mm).

#### Error — zero clearance

1. Clearance 0 with the slide-lid style reports "A slide lid needs
   clearance to slide — use 0.2 mm or more."; **Generate** stays
   disabled.

#### Empty

1. (Not applicable — the style always yields its six panels.)

#### Edge — shallow box

1. When the box is too shallow for the slot band to clear the top edge
   finger cells, validation names the height and thickness in conflict
   rather than emitting overlapping geometry.

### F-K8. Box fit test coupon (ADR-119)

#### Success

1. **Tools → Box Fit Test…** opens a small dialog: material thickness,
   finger width, ladder start/step/count (defaults 0.05/0.05/6), and in
   CNC mode the relief tool. Machine-aware defaults follow F-K3.
2. **Generate** inserts two strips — a tab comb and a slot strip — as
   one undo step. Rung i carries i+1 index nicks; its joint play is
   exactly start + i·step, split across tab and notch like production
   panels.
3. The operator cuts both strips, presses each rung, and types the
   winning rung's clearance into the Box Generator.

#### Error — ladder exceeds the joint limit

1. A ladder whose top rung reaches half the finger width (or half the
   thickness) reports the count/step fields; **Generate** stays
   disabled.

#### Empty

1. Empty numeric fields report "Enter a value" per F-K1.

#### Edge — CNC relief

1. CNC mode carves corner-overcuts in every notch at full bit radius;
   validation rejects a tool wider than the finger (F-K2 rule).

### F-K9. Assembled 3D preview (ADR-119)

#### Success

1. The Box Generator preview gains **Flat / Assembled** buttons. The
   assembled view draws every panel extruded at its true 3D placement in
   an isometric projection — dividers inside, the slide lid in its
   channel — and re-renders on every valid edit.

#### Error

1. (None — the toggle only offers views of an already-valid sheet.)

#### Empty

1. While the draft is invalid the assembled view keeps the last valid
   assembly, exactly like the flat preview (F-K1).

#### Edge — canvas unavailable

1. Without a 2D context (headless/jsdom) the preview renders an empty
   canvas without crashing, matching BoxPreview's guard.

## Camera Mode flows

### F-CAM1. Camera overlay + 4-point alignment (v1 — ADR-107)

- **Success / aligned.** The operator opens Camera Mode, picks a camera, and sees the live
  feed. On a machine (network) camera the manual path is to click the four bed corners in the
  live preview — the view prompts for each corner in turn ("Click the … bed corner (N / 4)").
  On the fourth click the homography solves and the feed warps to sit on the bed; the operator
  presses "Save & show on canvas" (F-CAM3) to persist the calibration to the device profile,
  then places artwork over the real material and adjusts overlay opacity. USB/RTSP cameras have
  no click-corners path — align them with the "Align to bed…" marker wizard (F-CAM4).
- **Error / permission denied.** If the browser or OS denies camera access (or the page is not
  served over https), a one-line message explains how to grant permission. No overlay is shown
  and the rest of the app is unaffected.
- **Empty / no camera.** With no camera detected, Camera Mode shows an empty state ("No camera
  found — connect a USB camera") and the camera picker is disabled.
- **Edge / degenerate corners.** If the four chosen points are collinear or coincident (no
  valid homography), the solve is rejected with "Move the alignment points apart — they can't
  form a rectangle"; the previous calibration, if any, is retained.

### F-CAM2. Camera lens calibration wizard (v2 — ADR-108)

- **Success / calibrated.** With the camera live, the operator opens "Calibrate
  lens…" from the Camera panel, describes their printed checkerboard (inner
  corners across/down + measured square size), and holds the board in front of
  the camera. Detected corners light up on the live view; each genuinely NEW
  pose held steady is captured automatically (a manual Capture button exists).
  After five or more poses, Solve runs the focal-sweep calibration and the
  review step shows the reprojection error plus an Original / Corrected A/B of
  the last capture. If the corrected view's straight edges LOOK straight, the
  operator applies; the calibration persists on the device profile (undoable)
  and survives reload.
- **Error / solve rejected.** A failed solve (too few views, degenerate
  geometry) shows the typed reason with "Back to capture"; nothing persists.
  A suspect solve (implausible coefficients, high RMS, uneven coverage, too-
  similar poses) still shows the A/B but with plain-language warnings telling
  the operator what to recapture.
- **Empty / no feed.** Opening the wizard without a live camera shows a
  one-line pointer back to the Camera panel's Start control; the Calibrate
  button itself is disabled until the feed runs.
- **Edge / mid-session changes.** Captures with no full board in view are
  rejected with a hint (not silently dropped); a camera-resolution change
  mid-session refuses to mix pixel bases and offers Reset; changing the board
  description discards captures taken against the old board.

### F-CAM3. Workspace camera overlay (ADR-107 v1 wiring)

- **Success / overlay on canvas.** After aligning (F-CAM1), the operator presses
  "Save & show on canvas": the alignment persists on the device profile
  (undoable, survives reload) and the camera image appears on the workspace
  under the artwork, tracking zoom and pan. The Camera panel's overlay row
  offers show/hide, a Fade slider, "Update still" (freeze the current frame —
  LightBurn's Update Overlay model), and "Live" (continuous video, USB only).
- **Error / basis mismatch prevented.** The persisted alignment records the
  pixel basis it was clicked in (raw vs de-fisheyed); frames of the other basis
  are never warped with it, so a later lens calibration cannot silently
  mis-register the overlay.
- **Empty / nothing to show.** With no saved alignment the overlay row is
  absent and the canvas is untouched; with an alignment but no camera source
  (no still, feed stopped) nothing renders.
- **Edge / reload.** A corrupt persisted alignment is dropped on load (never
  trusted); the overlay simply stays off until re-aligned.

### F-CAM4. Automatic marker alignment (v3 — ADR-109)

- **Success / one-click align.** The operator opens the "Align to bed…" wizard from the
  Camera panel. Its steps add the five-patch marker target to the project (the scene is
  replaced by the pattern, like the other calibration generators) and burn it on scrap
  covering the bed corners — or reuse an already-burned target — then, with the bed cleared of
  everything else and the camera live, Detect. The five X-corners are detected, the origin
  pair resolves the camera's rotation, the homography solves, and the alignment persists
  (undoable) — the workspace overlay is immediately registered. With a lens calibration
  present the capture is de-fisheyed first and the toast says "lens-corrected".
- **Error / markers not found.** A cluttered bed, missing patches, or poor
  lighting produce a typed toast telling the operator what to fix; nothing
  persists. A degenerate solve (markers nearly collinear) is refused the same
  way.
- **Empty / no live feed.** Auto-align is disabled until an active camera
  source can produce pixel-readable frames. Machine cameras become eligible
  when the local bridge frame proxy is available (F-CAM6).
- **Edge / rotated camera.** A camera mounted 180° (or at an angle) still
  labels the corners correctly — the origin pair, not the operator, carries
  the orientation.

### F-CAM5. Trace from camera (v4 — ADR-110)

- **Success / trace in place.** With the camera aligned and live, the operator
  places an object on the bed and presses "Trace from camera": the frame is
  captured (de-fisheyed if the alignment is lens-corrected), flattened
  top-down into bed coordinates, and opened in the normal Trace dialog. The
  traced vectors land exactly where the object physically sits — no manual
  positioning.
- **Error / basis mismatch.** If the saved alignment expects lens-corrected
  frames but the calibration was removed, the capture is refused with a toast
  (never silently mis-registered).
- **Empty / no feed or alignment.** The button is disabled without a live
  feed; without an alignment the overlay row (and the button) is absent.
- **Edge / encoder failure.** A platform without 2D canvas support fails
  typed ('could not build the bed image') instead of half-completing.

### F-CAM6. Machine camera via the local bridge (ADR-121)

- **Success / first-class machine camera.** The operator opens the Camera
  panel, the local bridge is healthy, and **Discover machine camera** finds a
  private-network JPEG or RTSP camera. **Use this camera** makes it the active
  camera source; calibration, auto-align, overlay updates, trace-from-camera,
  and snapshots use the same pixel-readable capture path as USB cameras.
- **Error / bridge unavailable.** If the bridge is not running, discovery and
  machine-camera capture show an actionable message. Local-development users
  are pointed to the bridge command; the desktop app starts it automatically.
  Hosted web builds cannot call the loopback network-camera bridge and support
  USB cameras only (ADR-136).
- **Empty / no camera found.** Discovery completes with no candidate camera;
  the panel stays usable for USB cameras and manual RTSP entry.
- **Edge / slow or single-threaded camera.** Frame fetches for the same camera
  host are serialized and shared while in flight so preview polling and capture
  do not overload embedded camera servers.

### F-CAM7. Click-to-position the laser head (ADR-122)

- **Success / head under the click.** The operator selects **Move laser here**
  and clicks a point on the workspace. The click maps through the same origin
  transform used by emitted G-code, clamps inside the machine bed, and sends
  one absolute beam-off jog through the normal jog safety gates.
- **Error / machine not ready.** If the machine is disconnected, busy, alarmed,
  or otherwise blocked for jogging, no command is sent and the operator sees
  the same block reason as the Jog Pad.
- **Empty / no camera overlay.** The tool still moves to workspace
  coordinates; the camera overlay simply makes the target visually meaningful.
- **Edge / zero coordinates.** Absolute destinations at X0, Y0, or Z0 keep the
  zero-valued axis word; only relative zero deltas are omitted.

### F-CAM8. Camera snapshot and monitoring view (ADR-122)

- **Success / snapshot saved.** With any active camera source, **Save
  snapshot...** captures one pixel-readable frame, encodes it as PNG, and sends
  it through the platform save dialog.
- **Error / capture or encode failed.** Capture/PNG failures show typed toasts;
  user-cancelled save dialogs stay quiet.
- **Empty / no active source.** Snapshot actions are disabled until a camera
  source is active.
- **Edge / watching a job.** The camera panel can toggle between compact and
  wide monitoring widths, with the preference kept locally.

### F-CAM9. Bed-alignment wizard with burn-the-target (ADR-122)

- **Success / one wizard, aligned bed.** **Align to bed...** opens a guided
  wizard: choose marker burn power/speed, burn the five-marker target through
  the normal Start flow, wait for the stream to finish, clear the bed, capture
  a frame, detect markers, solve the homography, and persist the alignment.
- **Error / burn not started or failed.** If readiness, preflight,
  confirmation, streaming, cancellation, or disconnect stops the burn, the
  wizard returns to setup with the typed reason and does not persist anything.
- **Empty / markers already burned.** The operator can skip the burn step and
  go straight to detection when the target is already on the bed.
- **Edge / minimized wizard.** The wizard can minimize into a small non-modal
  panel so the operator can watch the live camera and reach the machine while
  the capture or burn flow continues.

---

## Desktop app (Windows installer) flows

The desktop app is the same web build wrapped in Electron (ADR-003, ADR-024):
the `dist/web` bundle runs in Electron's Chromium renderer, so every laser/CNC
flow above behaves identically. These flows cover only what is *new* on the
desktop target — getting it, updating it, and proving it works.

### F-DESK1. Download and install (Windows 10/11, 64-bit)

1. In the web app, the operator clicks **Download for Windows** (Toolbar) or
   opens `https://kerfdesk.com/download`.
2. The download page links the installer on the Cloudflare R2 feed
   (`https://dl.kerfdesk.com/desktop/kerfdesk-latest-x64-setup.exe`).
3. Running the installer (NSIS, per-user, `oneClick:false`) lets the operator
   choose an install directory, then installs and creates a "LaserForge 2.0"
   shortcut.
4. First launch opens the app over the `app://` scheme at bed dimensions — the
   same as the web app's F-A1.

#### Error — unsigned-build SmartScreen warning (v1, expected)
1. Until code signing lands (ADR-024 §5), Windows Defender SmartScreen shows
   "Windows protected your PC" on first run.
2. The `/download` page documents the bypass: **More info → Run anyway.**
3. Once signed, the warning disappears with no app change.

#### Empty — no desktop build on macOS / Linux
1. The download page states the installer is Windows-only and links macOS/Linux
   users to the web app (ADR-007).

#### Edge — inside the desktop app the download/install affordances vanish
1. When running under Electron (`adapter.id === 'electron'`), the Toolbar hides
   both **Download for Windows** and the PWA **Install app** button — you don't
   download or PWA-install the app from within itself.

### F-DESK2. Desktop updates (trust-gated, burn-safe)

1. An unsigned build performs no automatic update check, download, or install
   (ADR-135). The operator downloads a newer installer from the pinned KerfDesk
   download page and runs it after ending the current session.
2. Once production signing is enabled and verified, each packaged launch checks
   the R2 feed's `latest.yml` (`electron/auto-update.ts`).
3. A newer signed version downloads in the background; the OS shows a native
   "update ready" notification. The current session is never interrupted.
4. The signed update installs on the **next quit** (`autoInstallOnAppQuit`), and
   the app relaunches on the new version.

#### Error — offline or feed unreachable
1. For a signed build, the check fails silently (logged via `onError`, never
   fatal). The app runs normally on the installed version.

#### Edge — a job is streaming
1. Updates NEVER install mid-burn: the app never calls `quitAndInstall`, and a
   quit can't happen during a running job without the operator stopping it
   (`use-unload-stop.ts` soft-resets the machine on unload). Non-negotiable #9
   holds.

### F-DESK3. Release + manual verification checklist (load-bearing)

Cutting a release is `git tag vX.Y.Z && git push --tags`, which runs
`release-desktop.yml` (build → R2 publish). **Green CI does not prove the
installer runs** (CLAUDE.md). Before a desktop release is called done, a human
runs this on real Windows:

- [ ] `pnpm build:desktop` locally (or download the CI artifact) produces
      `release/<version>/LaserForge-2.0-<version>-x64-setup.exe`.
- [ ] Installs cleanly on **Windows 10** and **Windows 11**; the shortcut
      launches the app over `app://app/index.html`.
- [ ] **Serial (hardware):** a GRBL laser/CNC plugged in appears in the
      `select-serial-port` picker; connect → jog → frame → stream a small job.
- [ ] **Files:** a `.lf2` round-trips via the File System Access pickers; G-code
      export saves.
- [ ] **Camera (optional):** a USB webcam previews (getUserMedia); an RTSP/IP
      camera previews only if `ffmpeg` is on PATH (documented optional dep).
- [ ] **Unsigned update gate:** an unsigned packaged build performs no update
      network request, download, or install.
- [ ] **Signed auto-update (after signing lands):** publish a higher `vX.Y.Z`;
      a running older signed install downloads it, notifies, and on quit installs
      + relaunches on the new version. Confirm **no install occurs while a job
      streams** and a wrong-publisher update is refused.
- [ ] **Download surface:** `/download` serves the installer on the web; inside
      the desktop app the Download/Install affordances are hidden.

Until every box is checked on real hardware, the desktop installer stays
**CLAIMED** in the hardware verification inventory.

### F-CNC-PROBE. Owned and settlement-qualified probe cycle

1. Before an XYZ request reaches the controller, the operator enters the
   measured plate-center X/Y offsets, side-contact drop, and side clearance.
   KerfDesk accepts only a cylindrical end mill and rejects a cutter that cannot
   remain over the plate, clear the side before descending, contact below the
   plate top, or park clear of the stock. Rejection writes zero serial bytes.
2. The operator chooses a Z or corner probe and enters positive, finite plate,
   feed, travel, retract, and geometry values. The UI sends typed probe geometry,
   not caller-authored G-code.
3. Start is allowed only while connected at a current Idle report with spindle
   speed proven zero and no job, motion, controller command, or probe active.
4. KerfDesk reserves one exclusive transaction, invalidates affected setup
   evidence, sends `M5` and `M9`, expands the audited GRBL probe builder, and
   owns every terminal response before awaiting transport completion.
5. A corner request leaves the previous WCS unchanged through all six contacts,
   then commits X, Y, and Z together in one `G10 L20 P0` block before parking.
6. Success requires the complete sequence, a FIFO dwell marker, two fresh Idle
   reports, and unchanged connection/transaction identity. The resulting work-Z
   evidence remains blocked for Start until the operator confirms plate removal.

#### Error — alarm or partial probe failure

1. A probe alarm enters global GRBL alarm handling and clears affected setup
   evidence. It never establishes work zero from a partial response sequence;
   a corner failure before the combined commit leaves the prior WCS unchanged.
2. Any uncertain non-alarm failure sends soft reset and keeps the controller
   operation locked until a reboot banner and two subsequent Idle reports are
   observed. Missing proof remains locked until disconnect.
3. Missing, over-precision, oversized, non-cylindrical, or unsafe XYZ
   plate/cutter geometry refuses the cycle before even the spindle/coolant-off
   commands are written and names the failed clearance.

#### Edge — coordinate scope

1. A Z-only request preserves existing XY-origin, WCO, and Verified Frame
   identity while invalidating work-Z evidence.
2. A corner request may mutate XY and therefore invalidates XY-origin, WCO, and
   Verified Frame evidence at reservation time.

This software qualification does not prove physical plate geometry, probe
wiring, spindle coast-down, or real-machine reset behavior. First hardware
validation must be supervised without cutting load.

#### Edge — controller-session coordinate truth

1. Home settlement, status, and settings observations are stamped to the live
   controller session and invalidated on reset, reconnect, alarm, or other
   position-trust loss. A stale Idle or old serial callback is not Home proof.
2. These stamps do not yet establish a safe probe envelope. Production XYZ
   probing still requires an owned complete build/settings exchange and a fresh
   direct MPos in the same session before any probe motion is permitted.
