# KerfDesk website: feature inventory and browser test record

Audit date: 2026-09-05 (Asia/Shanghai).

**Status: feature inventory prepared; exhaustive button testing is incomplete because Browser interaction stalled during About testing. This is not an all-buttons pass report.**

## Website and evidence boundary

- Website: https://kerfdesk.com/.
- Live page's `Build version` element: **v0.1.1962 - ccaa3064**.
- Its title: `Built 2026-09-04T05:36:27.000Z`, `Commit ccaa3064`, `Version 0.1.1962`. This is the application's build label, not an independently established deployment time.
- Matching Git object: `ccaa3064d9efe904821307f0603ce842d903b586`, subject `fix: preserve effective variable-text output settings (#721)`.
- The initial browser load used an older cached interface. The site's Update button reloaded the newer interface. The current toolbar has one **Import...** button. Earlier separate SVG/Image toolbar buttons are not counted as the current toolbar.
- Browser interactions used the requested Codex in-app Browser. Blank disposable projects were used. Text was created only in a test tab. No machine was connected or operated.
- The repository checkout remains at `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c` with inherited tracked/untracked changes. Source inspection was subsequently anchored to the matching live commit using `git show`, without switching branches or editing application source.
- The production fallback `https://laserforge-2fj.pages.dev/` was opened during Browser recovery. It also showed a cached interface and an update notification; its click attempts are not counted as verified results for the custom domain.

Evidence labels:

| Label | Meaning |
| --- | --- |
| **Verified interaction** | An action produced an observed result in Browser. Scope is the exact action described. |
| **Visible** | The live UI exposed the control or setting. Its operation has not necessarily been tested. |
| **Source inventory** | Source-confirmed at the displayed build, ccaa3064; nested behavior is not a browser pass. |
| **Conditional** | Requires a selection, mode, feature option, device or execution state. |
| **Blocked / unverified** | Attempted without a reliable result, or could not be exercised in this session. |

## Verified interactions and blockers

| ID | Action | Observed result | Status |
| --- | --- | --- | --- |
| B01 | Open kerfdesk.com | Workspace, menu bar, drawing tools and operation panels rendered. | Verified interaction |
| B02 | Apply the site's available Update | Interface changed to unified Import and the always-available Preview control; current build badge read v0.1.1962 / ccaa3064. Browser control subsequently needed a fresh tab. | Verified reload; smooth update continuity unverified |
| B03 | Expand File, Edit, Tools, Arrange, Laser, Window and Help | All seven menus exposed their command lists. Updated menus were recorded separately from the cached version. | Verified menu opening; child commands are not thereby passed |
| B04 | Text... | Add Text dialog opened with content, accent buttons, fonts, alignment, size, spacing, bend and variable text controls. | Verified interaction |
| B05 | Enter `Browser QA`, click Insert é | Text content became `Browser QAé`. | Verified interaction |
| B06 | Set text size to 15 and choose center alignment | Dialog displayed size 15 and center selected. | Verified interaction |
| B07 | Add text | Dialog closed; Objects changed from 0 to 1; one selected text object and one output operation appeared. Bounds were approximately 84.8 × 13.1 mm. | Verified interaction |
| B08 | Inspect selected-text settings | Numeric transforms became enabled; operation settings and offset controls appeared. Convert to Bitmap became enabled. | Visible state verified; transformations/conversion untested |
| B09 | Help → About KerfDesk | Repeated interaction attempts stalled Browser/CDP control. No inspectable JavaScript dialog was returned. | Blocked / unverified; cause not established |
| B10 | Preview, Box Generator and CNC after the stall | Input attempts did not yield a verified state change. Keyboard activation and fresh tabs did not restore reliable testing. | Blocked / unverified; not three proven product defects |
| B11 | Browser console before the stall | The requested warning/error log query returned no entries. | Limited observation; not full-session console clearance |
| B12 | Disconnected machine controls | Jog, work origin, framing and other motion controls showed their disconnected/disabled states and explanatory labels. | Visible only; no hardware test |

**About diagnosis:** The matching implementation routes `showAbout` through `jobAwareAlert(aboutText())`. When no job is active, `jobAwareAlert` calls `window.alert`. Safety information and connection troubleshooting use the same wrapper. This makes a native-alert interaction problem plausible, but Browser reported no detectable JavaScript dialog and the exact cause was not established. Native dialog handling, tab recovery, Escape and a fresh production-address tab did not restore dependable clicking. Do not classify all later unresponsive controls as website bugs.

Relevant pinned sources: [CommandShell](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/commands/CommandShell.tsx), [job-aware-dialogs](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/state/job-aware-dialogs.ts), [Toolbar build badge](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/common/Toolbar.tsx).

## Feature inventory

The following catalog groups features by user workflow. Top-level controls were observed live unless marked source inventory. Opening a menu is not proof that every command inside it works. Hardware functions, file round-trips and conditional dialogs remain unqualified by this run.

### 1. Projects, artwork import and output

- New blank project; open a project; save; save as.
- Unified ordered import for SVG, DXF, PNG, JPG and STL.
- Separate File-menu SVG, DXF and image import commands.
- Height-map import for a grayscale PNG relief (source inventory for format details).
- G-code export with preparation dialog and Choose destination; inspect generated G-code; open an external G-code program.
- Conditional Re-import selected source replaces source-aware artwork rather than adding another copy (source inventory).
- Drag-and-drop artwork import is advertised in the empty workspace.
- Project notes and undo-history views.

### 2. Selection, editing and object management

- Select/transform; select all; clear selection.
- Undo, redo, copy, cut, paste, duplicate and delete.
- Group, ungroup, lock selection and unlock all.
- Main-canvas move, resize and rotate handles; alternate selection of crossing objects.
- Nine transform anchors; X/Y position, width, height, aspect-ratio lock and rotation.
- Keyboard nudge, larger nudge and keyboard shortcuts for editing.

### 3. Drawing and measurement

- Rectangle, ellipse/circle, polygon, star and polyline drawing.
- Node editing and measurement tools.
- Source inventory: node-specific Smooth, Corner, Curve, Line, Start, Break and Join actions.
- Snapping, fit to bed, fit to selection, zoom in/out and pan.
- Frame/job-start marker visibility and Design/G-code 3D canvas switch.

### 4. Alignment, repetition and nesting

- Align left/right/top/bottom, horizontal center, vertical center or both centers.
- Distribute horizontally or vertically by object centers or spacing.
- Horizontal and vertical flip.
- Array (Grid, Point Rotation and Circular), Quick Nest and Break Apart.
- Availability depends on the selected artwork and its geometry.

### 5. Vector preparation

- Convert to Path; Weld; Subtract; Intersect; Exclude.
- Fill Selection.
- Close Open Fill Contours and a separate tolerance-based closure dialog.
- Offset paths outward/inward with a distance field.
- Convert to Bitmap; source inventory includes fill, outline and cut-settings rendering choices and DPI control.
- CNC-specific corner relief/dogbone workflows are conditional on geometry and mode.

### 6. Text and fonts

- Editable text with font selection and font import.
- Alignment, text size, line height, letter spacing and bend angle.
- Accent insertion buttons: é, è, ê, ë, á, à, â, ä, í, ó, ú, ñ, ç, ü and ´.
- Conditional path text.
- Variable text with CSV records, date, time, serial number, power, speed and passes fields (nested controls: source inventory).
- Variable sequences: record range, serial start/end, wrap, advance amount, previous/reset/next.
- Advancement policies: manual, after completed job or after successful export.

### 7. Artwork operations and run order

- Laser and CNC machine modes.
- Settings, Run order and Materials views where applicable.
- Rename an operation; add an operation; associate artwork with operations.
- Independent Show and Output flags; per-object power scale in Laser mode.
- Operation movement up/down, select associated artwork, copy/paste operation settings and delete operation.
- Run-order source inventory: search, jump to a run number, set exact positions and number objects by clicking the canvas, with finish/cancel/undo controls.

### 8. Laser cutting and engraving settings

- Line, Fill and Image processes.
- Power, speed, passes, contour entry and operation air assist.
- Advanced cut settings.
- Source inventory: default/dynamic/constant power mode, kerf compensation, tabs/bridges and saved defaults.
- Fill source inventory: Scanline, Follow Shape and Island fill; interval/LPI and direction.
- Image source inventory: grayscale/dithering, minimum power, dot-width correction, negative image, bidirectional scanning, interval/DPI, pass-through and expert settings.

### 9. Material recipes and saved libraries

- Materials tab.
- Source inventory: material/thickness or surface recipes, power/speed/passes and related settings.
- Material-preset creation and editing wizard.
- Saved library creation, opening, import, rename, duplication, export and deletion.
- LightBurn CLB library import.
- These workflows were not opened or modified in Browser.

### 10. Design Library

- Bundled Design Library launcher.
- Source inventory: collections, search, machine/design/use/source filters and filter reset.
- Design preview/details, source/creator/license information and insert into canvas.

### 11. Tracing and bitmap preparation

- Trace Image and Re-trace Original.
- Multi-File Trace.
- Adjust Image; apply an image mask; crop image; remove image mask; save processed bitmap.
- Source inventory: tracing presets and threshold/detail/sensitivity, minimum line, speckle, smoothing, optimization and transparency controls.
- Trace preview source fade/point display; crop/enhancement boundaries; clear boundary; retain/delete original; vector/raster output choices.
- Controls depend on raster selection, masks and retained original-image data.

### 12. Image Studio

- Image Studio launcher. Source inventory: a selected raster opens in the editor; no raster invokes image selection.
- Painting: brush, pencil, eraser, line, bucket and gradients.
- Selection: rectangle/ellipse marquee, lasso, wand, add/subtract, feather, modify, invert, fill, delete and deselect.
- Retouching: clone, heal, crop and move.
- Color controls: foreground/background colors, swap/reset, size, hardness, opacity, tolerance and contiguous selection.
- Image/canvas resize and text insertion.
- Layers: add, duplicate, reorder, merge, delete, visibility, opacity and blending.
- History, undo/redo, revert, Apply and Apply & Trace.
- Ink/time and kerf-related feedback.
- Nested tools are source inventory, not browser-tested image-editing results.

### 13. Image adjustments and filters

Source inventory:

- Brightness/Contrast; Levels; Curves; Threshold; Posterize; Invert; Desaturate.
- Gaussian Blur; Unsharp Mask; High Pass; Median/Despeckle; Halftone Dots; Line Screen.

### 14. Design Studio

- Dedicated Design Studio launcher.
- Eight implemented drawing tools: Select, Line, Polyline, Rectangle, Circle, Arc, Fillet and Chamfer.
- Fit, Undo/Redo, Snap, Ortho, Grid and 2D/3D controls.
- Shape properties and precision radius/distance fields.
- Design layers and cut settings; cutter references link to Startup Setup in the current build. V-carve has a Flat option with a conditional floor-depth field.
- Apply, Apply & Close and Close.
- Planned Studio Node, Polygon, Dimension, Trim, Extend, Offset, Mirror, Array and Boolean rail entries are **not counted as shipped Studio tools**. Some equivalents exist in the main workspace.

### 15. Box generation and fit testing

- Finger-joint Box Generator and Box Fit Test.
- Source inventory: dimensions, internal/external interpretation, style, material thickness, finger width, clearance, panel spacing and dividers.
- Sheet-layout and assembled previews; CNC corner relief where applicable.
- Generate panels and fit-test clearance ladders.
- Generation was not verified after Browser stalled.

### 16. Laser calibration and cut planning

- Material Test, Interval Test and Scan Offset Test.
- Optimization Settings / cut planning.
- Source inventory: travel, layer ordering, direction and start-point options.
- Focus Test is visibly disabled; source identifies an unqualified Z-motion generator as the reason. Do not count it as a working feature or a broken enabled button.

### 17. Registration jig and board placement

- Registration Jig panel and Place Board panel.
- Advertised jig functions: create a burn-alignment box, center artwork and choose the burn run.
- Advertised board capture: rectangle from corners or circle from four rim points, with point verification/fine adjustment.
- Machine-based capture and movement were not attempted.

### 18. Camera workflows

- Camera panel launcher.
- Advertised machine/USB camera use, lens calibration, bed alignment, workspace overlay and trace-from-camera.
- Source inventory: camera source configuration, start/stop, diagnostics, snapshot, larger monitor view and RTSP bridge support.
- Camera hardware and permissions were not requested or exercised.

### 19. Rotary, registration and Labs

- Rotary Setup is enabled in both Laser and CNC command registries; roller/chuck configuration, diameter, motion per turn, reversal, wrap preview and calibration-pattern generation are source-confirmed. Menu availability does not itself establish support for CNC rotary machining.
- Rotary configuration is no longer a Labs-only option in this build.
- Print and Cut is visible but disabled in the observed state; source provides two-target registration under the appropriate feature/device configuration.
- Current Labs source contains Low-power Fire, Print and Cut, and Camera alignment v2. These are off by default.
- No positioning beam, rotary motion or camera calibration was run.

### 20. Machine Setup

- Machine Setup wizard and Connect launcher.
- Advertised sequence: machine type, profile/controller, connection and detection, confirmation, options/calibration, review and save.
- Source inventory: machine profiles, controller/firmware configuration, bed/origin/homing and optional capability setup.
- Current CNC Startup Setup centralizes material, stock, machine, saved setup profiles, cutter library and per-operation Tool Plan authorship. Setup draft changes commit on final Save; the separately labeled profile Save/Delete actions act immediately. Older separate panel implementations must not be interpreted as additional current entry points.
- Source inventory includes profile management, probe, autofocus, rotary and calibration options where supported.

### 21. CNC machining

Source inventory; the mode-switch attempt occurred after Browser became unreliable:

- Outside, inside and on-path profile; pocket; engrave; V-carve; inlay pair; drill.
- Cut depth/through-cut, depth per pass, XY feed, plunge, spindle and stepover.
- Cutter/tool-plan references and roughing/clearing tools where applicable.
- V-carve floor clearing, adaptive pocket/finishing options and relief settings. Ordinary V-carve follows stroke width and bit angle; Flat depth enables an explicit floor-depth limit.
- Climb/conventional direction, lead/entry/helix controls and holding tabs.
- Inlay pocket depth, fit clearance and layout spacing.
- Stock dimensions/origin and material/bit setup through the current setup workflow. The stock HUD is a read-only reference with expand/collapse and Edit in Startup Setup.
- Output geometry, toolpaths, material fit and physical machining remain untested here.

### 22. CNC specialist workflows

Source inventory, subject to current routing and configuration:

- STL/grayscale relief import and relief sizing/depth settings. Height maps add polarity, gamma, input levels, mask threshold/outside meaning and geometry disclosures. A height map imported in Laser mode is stored for output in CNC mode.
- 3D cut preview/simulation, section view and image export.
- CNC tiling/registration-hole settings in setup.
- Spoilboard surfacing generation through machine controls: LaserWindow → CncUtilitiesPanel → SurfacingPanel.
- Probe and interrupted-cut recovery workflows require device/state prerequisites.

### 23. Preview and G-code inspection

- Main Preview; current source includes an empty-output explanation.
- Inspect G-code (3D), external Open G-code and the Design/G-code 3D canvas switch.
- Source inventory: toolpath playback, timeline/scrub, travel visibility, pass boundaries and time/distance statistics.
- Inspector source inventory: program/source lines, line jump, playback/restart/step/speed, viewpoints, PNG export, color modes, travel/direction display, program health and position readouts.
- CNC cut preview is a separate mode-specific view.

### 24. Positioning and origin

- Eight XY jog directions, jog step and jog speed controls.
- Move laser here canvas tool.
- Set origin here, Reset origin, Go to work zero and Advanced origin.
- Start from Absolute Coordinates, User Origin, Current Position or Verified Origin.
- Nine job-origin anchors and Selected artwork only.
- Release motors to move by hand, subject to connected machine state.
- These controls were inventoried in disconnected state; no motion was tested.

### 25. Job execution and recovery

- Set up & Frame / Start preparation, Frame job and frame-status feedback.
- Homing and autofocus setup entry points.
- Source inventory: job review with Approve settings (synchronize/rebuild reviewed values), streaming, pause/abort, execution completion/repeat, tool-change handling, overrides and recovery.
- Execution archive and Start from line entry points were visible.
- Source inventory includes CNC recovery qualification/preview flows and execution checkpoints.
- A completed Frame for the exact reviewed job is the ordinary Start prerequisite. This report does not certify controller behavior or physical output.

### 26. Air assist, console and controller tools

- Manual Air status/setup and operation-controlled air assist.
- Console disclosure and macro selection.
- Source inventory: controller communication history, advanced/Super Console and user macros. Macros support new/edit/delete/save/cancel, command templates, numeric variables, expanded-command preview and Run through the controller transport.
- Manual air, firmware writes and console commands were not executed.

### 27. Workspace layout, support and PWA

- Show/hide Layers and Machine panels; collapse individual panels; toggle side panels; reset workspace layout.
- Responsive layout changes between side-by-side panels and Cuts / Layers / Machine tabs were observed across browser sizes.
- Keyboard Shortcuts, About, Safety & liability, connection troubleshooting, Report a Bug and Discussions & Feedback.
- In-app update notification/button was exercised.
- Conditional installation/offline support is source/product inventory; offline operation and installation were not tested.

## Exact current menu inventory observed

These are the visible command labels. Conditional disabled states are covered above and must be rechecked with the appropriate test artwork.

| Menu | Commands |
| --- | --- |
| File | New; Open...; Save; Save As...; Import...; Import SVG...; Import DXF...; Import Image...; Import Height Map...; Save G-code...; Inspect G-code (3D)...; Open G-code... |
| Edit | Undo; Redo; Select All; Copy; Cut; Paste; Group; Ungroup; Lock Selection; Unlock All; Duplicate; Delete; Clear Selection |
| Tools | Measure; Text...; Registration Jig; Camera; Place Board; Rotary Setup...; Print and Cut...; Box Generator...; Material Test...; Interval Test...; Scan Offset Test...; Focus Test...; Optimization Settings...; Labs...; Adjust Image...; Apply Mask to Image; Crop Image; Remove Image Mask; Save Processed Bitmap...; Trace Image...; Re-trace Original...; Multi-File Trace...; Convert to Path; Weld; Subtract; Intersect; Exclude; Fill Selection; Close Open Fill Contours; Close Fill Contours With Tolerance...; Convert to Bitmap...; Box Fit Test...; Image Studio... |
| Arrange | Align Left; Align Center X; Align Right; Align Top; Align Center Y; Align Bottom; Align Centers; Distribute H Centers; Distribute H Spacing; Distribute V Centers; Distribute V Spacing; Array...; Quick Nest...; Break Apart; Flip Horizontal; Flip Vertical |
| Laser | Connect; Disconnect; Home |
| Window | Preview; Cuts / Layers Panel; Machine Controls Panel; Toggle Side Panels; Reset Workspace Layout; Fit View; Project Notes...; Undo History... |
| Help | About KerfDesk; Safety & liability; Can't connect? (Troubleshooting); Report a Bug; Discussions & Feedback |

## Remaining browser acceptance sweep

All rows below remain pending; none is implied to pass by the feature inventory.

| Test state | Remaining checks |
| --- | --- |
| Blank project | New; empty Preview; help/shortcut dialogs; panels/layout; notes/history; file-picker open/cancel behavior |
| One rectangle and one ellipse | Draw; numeric transforms and nine anchors; aspect lock; selection; undo/redo; offsets; bitmap conversion |
| Multiple separated and overlapping vectors | Copy/cut/paste; duplicate; grouping/locking; delete/undo; align/distribute; array/nesting; all boolean operations; break apart |
| Open paths and selected nodes | Node actions; joining/breaking; fill closure and tolerance review; pen completion/cancel; measurement |
| Text | Other accent buttons; fonts/import; multiline/spacing/bend; editing existing text; path text; variable fields and sequence advancement |
| Raster and raster-plus-mask | Import PNG/JPG; all image adjustment/mask/crop actions; tracing presets and apply/cancel; re-trace; batch trace; processed bitmap export |
| Image Studio | Paint/selection tools; color controls; layers; adjustments/filters; resize/text; undo/revert; Apply and Apply & Trace |
| Design Studio | All eight implemented tools; precision fields; snapping/view controls; layers; Apply/Apply & Close/Close |
| Generators | Box and fit-test generation; material/interval/scan-offset tests; defaults and invalid-input feedback |
| Laser operations | Mode changes; numeric edits; show/output; operation ordering/copy/delete; advanced settings; run order; material library |
| CNC mode | Current Startup Setup; stock/material/machine/Tool Plan; each operation type; 3D preview; relief; tiling and surfacing routes |
| Prepared software job | Preview playback and statistics; generated/external G-code inspection; program navigation; software export and reopen |
| Camera/registration | Panel configuration only first; capture/alignment/overlay require approved device access and suitable hardware |
| Disconnected machine | Setup navigation/cancel, disclosure panels, origin selection and explanatory states; no automatic connection or motion |
| Connected physical workflow | Separate explicitly authorized hardware qualification: connect, jog, home, origin, frame, Start, pause/abort, air/spindle/laser, probe/autofocus and recovery |

## Source coverage references

Source tree for matching build: [ccaa3064](https://github.com/cisgz3a-hub/KerfDesk/tree/ccaa3064d9efe904821307f0603ce842d903b586).

- Commands and selection: `src/ui/commands/`, `src/ui/workspace/ToolStrip.tsx`.
- Text and variable sequences: `src/ui/text/VariableTextControls.tsx`, `VariableSequenceControls.tsx`.
- Operations: `src/ui/layers/`; material library: `src/ui/material-library/`.
- Design library: `src/ui/library/`; tracing: `src/ui/trace/`.
- Image editor: `src/ui/image-editor/`; Design Studio: `src/ui/design-studio/`.
- Box generation: `src/ui/box/`.
- Setup and execution: `src/ui/laser/device-setup/`, `src/ui/laser/`, `src/ui/machine/`.
- Camera: `src/ui/camera/`; G-code Inspector: `src/ui/gcode-inspector/`.

Current-build changes were also reconciled against their live rendering routes. Deleted older CNC setup/bit/material/rest-pocket field components were excluded as separate features. The cutter catalog is still reachable through CNC Startup Setup, and surfacing, tiling, macros and variable-text controls have current callers.

## Next action

Restore responsive Browser input (including dismissing any visible About/native confirmation dialog), then resume the acceptance table using disposable test fixtures. The feature inventory is available now; exhaustive button testing remains open. No fixes, commits, merges, deployment, provider changes or hardware operation were performed.
