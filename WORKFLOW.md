# WORKFLOW.md — LaserForge 2.0 user flows

> Per developer-brain §6, every flow specifies four states: **success**, **error**, **empty**, **edge**. This file is the source of truth for what the UI does at each step. UI changes that contradict this file require a `WORKFLOW.md` update first.
>
> This document has **Phase A, Phase B, and Phase F (F.1 Fill, F.2 Image engrave, F.3 Set work origin) flows fleshed out**. Phase C / D / E sections are still stubs and will be filled retroactively from ADR-016. Code for all phases through F.3 is shipped — the gap is documentation density, not implementation.

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
1. If `<canvas>` is unsupported, show full-page error: "LaserForge requires a modern browser. Try Chrome, Edge, or Brave."

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
- **Cuts/Layers panel**: docked right, empty with hint text "Import a design to populate layers."
- **Toolbar**: left — Select, Pan, Zoom-fit, Preview-toggle (last is disabled when scene is empty).

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
   6. Cuts/Layers panel auto-populates: one row per unique stroke color found in the SVG.
   7. Toast: `Imported design.svg — 1 object, 3 colors`.

#### Success — multiple files at once
1. User drops 3 SVG files simultaneously.
2. Each is imported in drop order.
3. Each is offset 10mm right + 10mm down from the previous to avoid full overlap.
4. After import, all imported objects are multi-selected.
5. Toast: `Imported 3 designs · 7 colors total`.

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

#### Multi — marquee — **NOT YET IMPLEMENTED**
> This flow is specified but not built: `computeMouseDownDrag` returns null on
> empty space, so click+drag in empty workspace does nothing today. Tracked for
> the drawing-tools work (LIGHTBURN-GAP Increment 2). The spec below is the
> intended behavior, not current behavior.
1. Click+drag in empty workspace area.
2. Dashed-blue marquee box follows cursor.
3. On release, every object whose bounding box is fully or partially inside the marquee is selected.

#### All — Cmd/Ctrl+A
1. Selects every object in the scene.

#### Deselect — Escape or click in empty space
1. Selection cleared. Status bar updates: `Nothing selected`.

#### Edge — click on locked layer object
1. Phase A has no layer locking. (Phase C feature, not designed yet.)

---

### F-A6. Transform — move, scale, rotate, mirror

#### Move — drag
1. Click and drag inside selection.
2. Cursor changes to move cursor.
3. Object follows cursor in real time.
4. Status bar shows live coords.
5. On release, change is committed to history.

#### Move — keyboard
- Arrow key: 1 mm nudge in that direction.
- Shift+Arrow: 10 mm nudge.
- No other modifiers in Phase A.

#### Scale — drag handles
- Corner handles: free aspect ratio.
- Edge handles: scale along one axis.
- Shift+drag corner: lock aspect ratio.
- Alt/Opt+drag: scale from center instead of opposite edge.
- Live mm dimensions shown next to handle while dragging.

#### Rotate — handle above selection
- Handle appears above the selection box at a fixed offset.
- Drag rotates around selection center.
- Shift+drag: snap to 15° increments.
- Live angle shown next to handle.

#### Mirror — menu / shortcut
- `Edit → Flip Horizontal` (`H`)
- `Edit → Flip Vertical` (`V`)
- Operates around selection's center.

#### Edge — transform pushes object out of bed
- Permitted (user may be temporarily repositioning).
- Out-of-bounds geometry gains the red dashed overlay (F-A3 edge).
- Save G-code preflight will block at generation time.

#### Edge — non-uniform scale with rotation
- Math handles this correctly. Confirmed by snapshot tests on rotated-then-scaled fixture.

---

### F-A7. Cuts/Layers panel

#### Layout
- Vertical list. Each row is one Layer (one unique stroke color).
- Row contents, left to right:
  1. Color swatch (12×12 px square, the SVG stroke color).
  2. Mode dropdown — value: `Line` (only enabled option in Phase A; `Fill` and `Image` disabled with tooltip).
  3. Power input — number, 0–100, suffix `%`.
  4. Speed input — number, suffix `mm/min`.
  5. Passes input — integer, ≥ 1.
  6. Visible toggle — eye icon.
  7. Output toggle — checkbox labeled "Output".
- Row hover: light highlight + delete button (for the *Layer*, not the objects — see edge below).

- Each row includes order controls. The visible Cuts/Layers list order is the generated output order.

#### Default values for a new Layer
- Power: 30 %
- Speed: 1500 mm/min
- Passes: 1
- Visible: on
- Output: on

#### Success — edit power value
1. Click input, type new value (or use stepper).
2. Input is debounced — change is committed after 300 ms of inactivity, **not** on every keystroke (the LF1 audit found this missing; do not repeat).
3. On commit, status bar shows brief confirmation: `Layer · power set to 50%`.

#### Success — toggle output off
1. Click Output checkbox.
2. Layer's paths immediately hidden from preview render.
3. Layer's paths *excluded* from generated G-code.
4. Cuts/Layers row appears dimmed.

#### Success - reorder a layer
1. Click a layer's up or down order control.
2. The row moves one position in the Cuts/Layers list.
3. Generated output processes layers in that new list order.
4. Undo restores the previous layer order.

#### Success — toggle visibility off
1. Click eye icon.
2. Layer's paths hidden from viewport.
3. Layer's paths *still included* in G-code (visibility ≠ output).
4. Row's color swatch shows a slash.

#### Empty — no layers
- Hint text: `Import a design to populate layers.`
- All controls disabled.

#### Error — power input out of range
- < 0 or > 100: input snaps to nearest valid value, briefly flashes red, status bar shows: `Power must be 0–100`.

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
- One Layer row covers both. Setting parameters affects both SVGs' geometry of that color.

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
- Changes to any Layer's power/speed/passes/visible/output cause preview to re-render within 100 ms.
- Changes to transform also re-render.

#### Empty — preview with no output layers
- Preview shows empty workspace (no paths visible).
- Hint text: `No layers have Output enabled. Toggle a layer to see preview.`

#### Edge — preview of out-of-bounds geometry
- Out-of-bounds path segments rendered in red.
- Preflight summary at top of viewport: `Preview: 1 layer extends 12 mm beyond bed`.

#### Edge — preview of very large scene
- > 10,000 path segments: warning shown above viewport: `Large scene - display simplified for performance`; the canvas renders a bounded display sample instead of walking every source point on each redraw.
- Generated G-code and saved project geometry are unaffected — simplification is visual only.

#### Raster engrave preview (image-mode layers) — ADR-028
- **Success:** each `raster-image` on an output-enabled image-mode layer renders a burn simulation at the image's placement, registered with the bitmap including rotation/mirror. Threshold/Floyd-Steinberg render as crisp black/white dots; grayscale as a smooth ramp. The simulation uses the exact dither + power scaling the G-code will emit (WYSIWYG, like the Fill hatch preview).
- **Live updates:** changing the layer's power or dither algorithm re-renders the simulation within the same 100 ms budget.
- **Empty:** an image-mode layer with Output off shows no simulation — same rule as any non-output layer (preview shows what *burns*, not what's merely visible on the design canvas).
- **Edge — missing luma:** a legacy `.lf2` raster with no embedded luma buffer renders white / laser-off, not full-burn. If that leaves the job with no G1 burn moves, preflight reports empty output.
- **Edge — scrubber:** the scrubber animates vector toolpaths only; the raster simulation always renders complete regardless of scrubber position. Row-by-row raster scrubbing is deferred to a later increment.

---

### F-A9. Save G-code

#### Success — desktop
1. User clicks `File → Save G-code` (`Cmd/Ctrl+E`).
2. Pre-flight runs (F-A10).
3. If pre-flight passes, OS native Save dialog opens.
4. Default filename: `<project-name>.gcode` if project saved, else `untitled.gcode`.
5. Default location: last G-code save location, or OS Documents on first save.
6. On confirm, file is written.
7. Toast: `Saved to <path>`.

#### Success — web
1. Same flow, but step 3 uses File System Access API where available, else browser download.
2. Toast same.

#### Error — pre-flight failure
- See F-A10.

#### Error — file system error (disk full, permissions, etc.)
- Modal: `Could not save G-code: <one-line reason>`. Project is unaffected.

#### Edge — save when no output-enabled layers exist
- Save G-code button is disabled (see F-A7 edge).

---

### F-A10. Pre-flight check (before G-code save)

Runs whenever Save G-code is invoked. Cannot be skipped.

Checks, in order:

1. **At least one output layer exists.** If not: modal `No output layers. Enable Output on at least one layer.` Cancel save.
2. **All output geometry fits inside the bed.** Iterate every path point. If any falls outside `[0, bedWidth] × [0, bedHeight]` (in machine coordinates, after origin transform), build a list of violations. If any exist: modal `Design extends beyond machine bed.` listing layers and amounts. Buttons: `Cancel`, `Show violations` (highlights them in viewport).
3. **Power values within range.** 0 ≤ power ≤ 100 for every output layer. Should be enforced upstream by F-A7, but defense in depth.
4. **Speed values within device max.** 0 < speed ≤ device.maxFeed for every output layer.
5. **Passes ≥ 1** for every output layer.
6. **Generated G-code is non-empty.** Sanity check — if the pipeline produced no G-code lines, something is wrong; modal `Internal error: G-code generation produced empty output. Please report this.` (This is also a property-test invariant.)

If all checks pass, save proceeds.

---

### F-A11. Save Project (.lf2)

#### Success — first save
1. `File → Save` (`Cmd/Ctrl+S`).
2. OS Save dialog opens.
3. Default name: `untitled.lf2`, default location: Documents.
4. On confirm, project serialized to JSON, written to disk.
5. Window title updates: `LaserForge — <project-name>`.
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
- Uses File System Access API where available; falls back to browser download.
- If the user denies file-access permission, show modal: `Save needs file-system access. Re-prompt?` with `Retry` / `Cancel`. **No IndexedDB fallback in Phase A** — would introduce a second persistence path not covered by any ADR. Browser-storage save is a candidate for a Phase C ADR.

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
2. Toast (info): `Project migrated from v0 to v1.`
3. Project saved-as does not auto-trigger; user can save to persist migration.

> **Phase A note:** only `schemaVersion: 1` exists; this branch is forward-looking infrastructure (registered migrator function + dispatch table) and cannot trigger in Phase A. Test by feeding a `schemaVersion: 0` synthetic fixture through the migrator unit test.

#### Error — schema newer than supported
- Modal: `This project was saved with a newer version of LaserForge. Update the app to open it.` No load.

#### Error — file is not a valid .lf2
- Modal: `Could not open <filename>: not a valid LaserForge project.` No load.

#### Edge — file is a valid .lf2 but references a device profile not on this machine
- Project loads with the embedded device profile.
- Status bar warns: `Project's device profile (xTool S1) is not configured locally. Add it in Settings.`

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
- `Cmd/Ctrl+E` — Save G-code (Export)

#### Edit
- `Cmd/Ctrl+Z` — Undo
- `Cmd/Ctrl+Shift+Z` — Redo
- `Cmd/Ctrl+X` — Cut (not implemented)
- `Cmd/Ctrl+C` — Copy (browser default in inputs; no scene-object clipboard yet)
- `Cmd/Ctrl+V` — Paste (browser default in inputs)
- `Cmd/Ctrl+D` — Duplicate selection with 10mm offset (shipped)
- `Cmd/Ctrl+A` — Select all
- `Delete` / `Backspace` — Delete selected
- `Escape` — Deselect / cancel current operation

#### Transform
- Arrow keys — Nudge 1 mm
- Shift+Arrow — Nudge 10 mm
- `H` — Flip horizontal
- `V` — Flip vertical

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
- `Cmd/Ctrl+.` — Stop job (Phase B)

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
1. Connection button is disabled, with a red hint above: "Your browser doesn't support WebSerial. Use Chrome, Edge, Brave, or Arc, or install the Windows desktop app."

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
2. App stops the poll, closes the port, clears the status display.

#### Edge — disconnect mid-job
1. See F-B12.

### F-B3. Home

#### Success
1. User clicks **Home**. App sends `$H\n`.
2. Status polling shows the controller entering `Home` then returning to `Idle`.

#### Error — homing not enabled
1. Controller replies `error:10`. UI surfaces the message from `describeError(10)`.

### F-B4. Frame

Phase B initial cut: not implemented. Phase B polish will compute the AABB of all output-enabled paths and dispatch four `$J=` jogs around the perimeter at a non-cut feed.

### F-B5. Jog

#### Success
1. User selects a step size (0.1 / 1 / 10 / 100 mm) and clicks a direction arrow.
2. App sends a `$J=G91 G21 X<dx> Y<dy> F<feed>` command.
3. Status polling shows the controller in `Jog` then back to `Idle`.

#### Edge — jog target exceeds travel
1. Controller replies `error:15`. UI logs the rejected line.

### F-B6. Start job

#### Success
1. User clicks **Start job** while connected and idle.
2. App runs the F-A10 preflight on the current project. If issues, surfaces the modal (same as Save G-code path).
3. App compiles the project to G-code via `emitGcode`, builds a streamer, and writes the first batch (as much as the 127-byte RX buffer can hold).
4. Every `ok` advances the streamer by one line and writes more.
5. Progress bar reflects `completed / total` lines.

#### Error — preflight fails
1. Modal lists the violations. No bytes sent.

#### Error — controller in Alarm
1. Send fails fast; user must `$X` first (F-B9).

### F-B7. Pause / resume

#### Success — pause
1. User clicks **Pause**. App writes real-time `!` (0x21).
2. Streamer enters `paused`; no further bytes sent until resume.
3. Status report transitions to `Hold:0` or `Hold:1`.

#### Success — resume
1. User clicks **Resume**. App writes real-time `~`.
2. Streamer resumes; more bytes flow.

### F-B8. Stop

#### Success
1. User clicks **Stop**.
2. App writes real-time `\x18` (Ctrl-X — soft reset).
3. GRBL drops the planner, replies with the welcome banner; UI marks the streamer `cancelled`.
4. Controller enters `Alarm` after reset; user clears with `$X` (F-B9).

### F-B9. Alarm

#### Success — surface
1. When `ALARM:N` arrives, the Laser panel shows a red banner with code, title, detail, and recovery action (from `core/controllers/grbl/alarm-codes.ts`).

#### Success — unlock
1. User clicks **$X — Unlock**. App writes `$X\n`. Alarm cleared from UI.

### F-B10. Status polling

App writes real-time `?` every 250 ms while connected. Replies are parsed by `parseStatusReport`. The latest report drives the Status panel and the bottom status bar.

### F-B11. Job progress UI

Progress bar shows `completed / total` lines as a percentage with the count overlaid. Updates whenever the streamer advances. Phase C will add an estimated-time-remaining label.

### F-B12. Disconnect during job (cable yank)

#### Success — graceful close
1. The OS fires `port.disconnect`. Adapter's `onClose` handlers fire.
2. Laser store transitions to `disconnected`; status display clears.
3. Streamer is left in its last state (in-flight lines never ack'd) so the UI shows progress at the moment of disconnect.

#### Edge — re-connect after yank
1. User plugs the cable back in and clicks **Connect…** again. Picker shows the same port. App treats it as a fresh connection — the user must `$H` to re-establish position before resuming work.

---

## Phase C flows — STUB

- F-C1. Settings → Device Profile editor
- F-C2. Settings → Preferences
- F-C3. Autosave + recovery
- F-C4. Re-import changed SVG with diff
- F-C5. Copy / paste / duplicate
- F-C6. Crash reporter

---

## Phase D flows — STUB

- F-D1. Add text object
- F-D2. Edit text content
- F-D3. Choose font
- F-D4. Adjust character spacing / line height
- F-D5. Convert text to paths (one-way conversion for further editing as imported geometry)

---

## Phase E flows — STUB

- F-E1. Import raster image
- F-E2. Open trace dialog
- F-E3. Adjust trace parameters with live preview
- F-E4. Apply trace → produces Scene object

---

## Phase F flows

### F-F1. Engrave a filled shape (F.1 Fill mode)

**Entry**: a SceneObject already exists in the scene (SVG, text glyph,
or traced image) with at least one closed polyline.

**Success**:
1. In the Cuts/Layers panel, find the row for the color you want to
   engrave as fill.
2. Click the **Mode** dropdown → choose **Fill**.
3. The row expands: a sub-row appears underneath showing Fill-specific
   inputs: **° angle**, **mm spacing**, and **Overscan**. Defaults are
   0° (horizontal hatching), 0.2 mm (≈ 5 lines/mm), and 5 mm overscan.
4. (Optional) Adjust the inputs. All three commit on the 300 ms F-A7 debounce.
5. Compile + emit G-code as usual (Save G-code, or Start job in the
   Laser panel). The FillGroup for that color now contains hatch lines
   with laser-off overscan runway instead of the outline.

**Error**:
- *No closed polylines on this color* — the layer's mode is Fill, but
  every matching polyline is open (e.g., a single line, not a region).
  The compile step silently emits nothing for that layer (no error
  toast; the empty result is itself the diagnostic). Switch back to
  Line mode to engrave the outline instead.

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

When this checklist passes, mark F.2.f complete in AUDIT.md A8
inventory and tag the build as the first Phase F.2 release.

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
  position as work-coord (0, 0). Toast confirms the write; the status
  bar's `Origin:` row flips from "machine 0,0" (muted) to
  "X… Y… (custom)" (accent-red, bold) within ~0.25–7.5 s as GRBL's
  next WCO-bearing status frame arrives. Frame and Start switch to
  user-origin placement immediately after the write succeeds; they do
  not wait for that later status frame.
- **Reset origin** — sends `G92.1`. Clears the offset, status returns
  to "machine 0,0". Disabled when no custom origin is active.

**Status readout.** `StatusDisplay` shows MPos + `Origin:` row. The
`Origin:` row reads from `wcoCache` (cached last-seen WCO across
status frames). It must never read the raw `statusReport.wco` — GRBL
only emits WCO every Nth frame, so the raw field is null on ~29
frames out of 30 and would flicker the readout.

**The four states.**

1. **Success.** Connected, idle, head jogged to a workpiece corner.
   Click Set origin here → toast "Origin set to current head position
   (G92)." → status row updates to "Origin: X… Y… (custom)". Click
   Frame → head traces the job's front-left anchored bounding box
   around the workpiece corner. Click Start → job runs at the
   workpiece corner.
2. **No connection.** Both buttons disabled (`busy = props.disabled
   || streaming`; `disabled` set by `LaserWindow` when connection
   isn't `connected`). User must connect first.
3. **Alarm clears origin mid-session.** Operator sets origin, then a
   limit switch triggers (or `\x18` is sent). GRBL clears G92
   internally; the alarm branch in `laser-line-handler.ts` clears
   `wcoCache`; the status row reverts to "Origin: machine 0,0". User
   re-jogs and re-sets if they want the offset back.
4. **Off-bed risk.** Operator sets origin near the bed edge, then
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
8. **Stop-clear path.** Set origin, start a job, press **Stop**
   (sends `\x18`). The readout returns to machine zero.
9. **Reconnect-clear path.** Set origin, disconnect, reconnect. The
   readout shows `Origin: machine 0,0` (cache cleared on
   `teardown`).
10. **$10 unusual config.** Set `$10=1` (WPos-only) and repeat steps
    2–3. The cache should still update — WCO is reported on a
    separate bit from MPos/WPos.

When this checklist passes on the Falcon, promote Phase F.3's
"Future feature notes" entry in `PROJECT.md` to "Phase F.3 —
Shipped" and update AUDIT.md's A8 hardware inventory.

---

### F-F4. Convert a selected vector to a bitmap (Phase F.4)

**ADR:** [ADR-029](DECISIONS.md#adr-029--convert-to-bitmap-vector--raster-engrave-source).

**Operator intent.** Turn a vector object (imported SVG, text, or a
traced image) into a raster engrave source — the inverse of Trace —
so it burns as a dithered/grayscale image rather than outlines or
hatch fill. Matches LightBurn's **Convert to Bitmap** (Edit menu /
`Ctrl+Shift+B` / right-click).

**Where in the UI.** Toolbar **Convert to Bitmap** button, next to
Trace Image. Enabled only when a single convertible vector is
selected; disabled (greyed, with a "select a vector first" tooltip)
otherwise — mirroring LightBurn's greyed menu item. No dialog: A2
ships **Fill All** only, so the conversion is immediate (hence no
"…" on the label). The Render Type picker (Outlines / Use Cut
Settings) and a DPI control arrive with A3/A4.

**What it does.** Rasterizes the selected vector's closed contours
into a `RasterImage` at the LaserForge default 254 DPI (= 10
lines/mm; a LaserForge choice — LightBurn documents no default),
every inked pixel at 50% gray on white, carrying the source's own
bounds + transform so the bitmap lands exactly where the vector was.
**The source vector is deleted** (LightBurn discards the original);
the swap is one undo entry, so Ctrl+Z restores the vector — replacing
LightBurn's manual "duplicate first" guidance.

**The four states.**

1. **Success.** A closed-shape SVG / text / trace is selected. Click
   Convert to Bitmap → the vector is replaced in place by a grayscale
   bitmap on the image-mode layer (`DEFAULT_RASTER_LAYER_COLOR`), the
   new bitmap becomes the selection, and a toast confirms "Converted
   to bitmap: `<name>` (bitmap)". It then engraves through the
   existing F.2 image path.
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
white, and the base64 luma byte-matches the PNG. **Not yet verified:**
the live in-app render/placement of the swapped bitmap on the
workspace canvas, and a side-by-side pixel comparison against
LightBurn's own Convert output — both deferred (need a live import or
a LightBurn session).

### F-ML1. Material library — save, load, and session persistence

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
   file from a newer LaserForge raises the schema-too-new alert; any
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
