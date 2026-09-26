# LightBurn gap audit (2026-09-26)

**Status:** open program. **Owner direction (Johann, 2026-09-24, restated 2026-09-26):** build every
gap and make it better than LightBurn.

## Why this file exists

The first LightBurn gap audit ran on 2026-09-24. Its bugs were fixed in #902 (ADR-125 Amd 1, ADR-150
Amd 1, ADR-238 Amd 2) and its first feature batch landed in #904 (roller rotary ADR-373, Recent
Projects ADR-378, barcodes and QR codes ADR-386). Its list of missing features lived only on a
published page that no longer opens, so nothing recorded what was left. This file rebuilds that
list against current `main` and keeps it in the repository.

## Method

- LightBurn behaviour comes from its official documentation, fetched on 2026-09-26 from
  `https://docs.lightburnsoftware.com/latest/Reference/` (abbreviated `R/` below). A row without a
  URL was not researched and is not a finding.
- KerfDesk behaviour comes from the source on `main` at `b6bbfdf9`: a feature counts as present only
  when a user can reach it (a command, menu, panel field or tool), not when core code alone exists.
- Five areas were searched independently: Tools and Arrange menus; Cut Settings, Cuts/Layers and
  Optimization; image modes and Trace; Laser window, Move, Console, Device Settings, Laser Tools,
  Camera and Rotary; File, Edit, View, Window, Settings and text.
- Sizes are rough: **S** is a day or less with tests, **M** a few days, **L** a new subsystem.

Statuses: **MISSING** (nothing a user can reach), **PARTIAL** (present, named sub-options missing),
**DECISION** (a recorded project rule blocks it; needs the maintainer), **IN #924** (the open
tracing program owns it), **BATCH n** (scheduled below).

## Already at parity or better

Not repeated in the gap tables. Highlights where KerfDesk is ahead: offline outline nesting
(`src/core/nesting/outline-compact-nest.ts`), weld and booleans that keep each operation's settings
plus Exclude, Start From with a Verified Origin mode, the live head marker and trail, the Console,
per-speed scanning-offset calibration with LightBurn Line Shift conversion, the 4-point Center
Finder, planner-based job time that recalibrates while running, camera marker auto-align and
surface-height compensation, the numbered Run order panel, the Undo History dialog, 30 s crash
recovery, the Art Library with saved operations, and four extra dither kernels (Burkes and three
Sierra variants).

## Gaps: design and arrange tools

| ID | Gap | LightBurn | KerfDesk today | Size | Status |
|---|---|---|---|---|---|
| LBG-T01 | Move Selected Objects to the bed centre, corners and edges | `R/MoveSelectedObjects/` | Only typed positions with the anchor picker (`src/ui/commands/TransformAnchorPicker.tsx`) | S | BATCH 3 |
| LBG-T02 | Rotate 90° clockwise and counter-clockwise commands | `R/TransformControls/` | Rotate handle and numeric R field only (`src/ui/workspace/rotate-handle.ts`, `NumericEditsBar.tsx`) | S | BATCH 3 |
| LBG-T03 | Offset Shapes: Both directions, Round/Bevel/Corner joins, delete original, open paths, Tools menu entry | `R/OffsetShapes/` | Outward or inward copy of closed shapes, round joins only (`src/ui/layers/OffsetPathsRow.tsx`, `src/core/geometry/vector-path-booleans.ts`) | S | BATCH 3 |
| LBG-T04 | Trim Shapes (click a segment to delete it back to the intersections) | `R/TrimShapes/` | Planned stub in Design Studio only (`src/ui/design-studio/design-tool.ts`) | M-L | open |
| LBG-T05 | Apply Path to Text alignment (X left/middle/right, Y top/middle/bottom) | `R/ApplyPathToText/` | Guide, start offset and reverse only (`src/core/text/text-on-path.ts`) | S | open |
| LBG-T06 | Warp (4 point) and Deform (16 point) | `R/WarpDeform/` | Missing; `src/core/camera/homography.ts` exists for reuse | M | open |
| LBG-T07 | Create Rubber-Band Outline around a selection | `R/CreateRubberBandOutline/` | Missing | S | open |
| LBG-T08 | Cut Shapes (split shapes by a closed cutter) | `R/CutShapes/` | Missing | M | open |
| LBG-T09 | Copy Along Path | `R/CopyAlongPath/` | Missing; `src/core/scene/array-layout.ts` and `text-on-path.ts` path sampling can be reused | M | open |
| LBG-T10 | Resize Slots in Selection | `R/ResizeSlots/` | Missing for artwork; Box Generator only | M | open |
| LBG-T11 | Boolean Assistant preview | `R/BooleanTools/` | Missing | S-M | open |
| LBG-T12 | Measure shape readout (perimeter, area, node count, open or closed) and node snapping | `R/Measure/` | Distance and angle line (`src/ui/workspace/measure-tool.ts`) | S-M | open |
| LBG-T13 | Grid Array extras: centre-to-centre spacing, row/column shift, reverse, mirror alternate, virtual array | `R/GridArray/` | Rows, columns, edge gap, variable advance (`array-layout.ts`) | S-L | open |
| LBG-T14 | Circular Array end/step angle and last-selected-as-centre | `R/CircularArray/` | Count, centre, radius, start angle, rotate copies | S | open |
| LBG-T15 | Move Laser to Selection (centre, corners, edges) | `R/MoveLaserToSelection/` | Missing; click-to-move exists (`src/ui/workspace/position-laser-click.ts`) | S | open |
| LBG-T16 | Mirror Across Line | `R/FlipMirror/` | Missing | S | open |
| LBG-T17 | Two-Point Rotate/Scale | `R/TwoPointRotateScale/` | Missing | M | open |
| LBG-T18 | Break Apart into individual segments | `R/BreakApart/` | Splits imported SVGs and traces into subpaths only (`src/ui/state/break-apart-actions.ts`) | S | open |
| LBG-T19 | Unlock Selected (not only Unlock All) | `R/LockShapes/` | Lock Selection and Unlock All (`src/ui/commands/edit-command-family.ts`) | S | open |
| LBG-T20 | Auto-Group shapes contained in another shape | `R/Grouping/` | Missing | S | open |
| LBG-T21 | Dock, and Distribute "Move Together" | `R/Dock/`, `R/Distribute/` | Missing | S | open |
| LBG-T22 | Optimize Selected Shapes (smooth, fit to arcs and lines) | `R/UI/EditMenu/` | Arc fairing exists inside Trace only (`src/core/trace/centerline/arc-fairing.ts`) | M | open |
| LBG-T23 | Tangent Circle, display draw-order push | `R/TangentCircleGenerator/`, `R/DrawOrder/` | Missing (Run order already covers cut order) | S | open |

## Gaps: cut settings and cut planning

| ID | Gap | LightBurn | KerfDesk today | Size | Status |
|---|---|---|---|---|---|
| LBG-C01 | Perforation (cut length and skip length) on Line layers | `R/CutSettingsEditor/LineMode/` | Missing | S-M | BATCH 4 |
| LBG-C02 | Overcut past the start of closed shapes | `R/CutSettingsEditor/LineMode/` | Missing for laser (CNC dogbone only) | S | BATCH 4 |
| LBG-C03 | Image overscan you can set per operation | `R/CutSettingsEditor/ImageMode/` | Fixed 5 mm (`DEFAULT_OVERSCAN_MM`, `src/core/job/compile-job-raster.ts`) | S | BATCH 4 |
| LBG-C04 | Best start point and "choose corners" for closed shapes | `R/OptimizationSettings/` | Closed shapes start at their drawn start point (`src/core/job/segment-entry-index.ts`) | M | open |
| LBG-C05 | Tabs: click-placed laser tabs, even spacing, maximum count, tab cut power | `R/AddTabs/` | Count, size and skip-inner only (`src/core/geometry/tabs-bridges.ts`) | M | open |
| LBG-C06 | Image scan angle 0/90/180 and Angle Increment per pass | `R/CutSettingsEditor/ImageMode/` | Images always scan along X (`src/core/raster/raster-sweep-plan.ts`) | M-L | open |
| LBG-C07 | Sort Cuts Last; bulk Enable/Disable/Invert/Hide Others in the operations list | `R/CutsLayersWindow/` | Missing | S | open |
| LBG-C08 | Start and end dwell on Line layers | `R/CutSettingsEditor/LineMode/` | Missing | S | open |
| LBG-C09 | Tool layers (never output, for guides and masks) | `https://docs.lightburnsoftware.com/1.7/Reference/UI/ColorPalette/` | An operation with output off comes close | S | open |
| LBG-C10 | Ramp length (sloped edges for stamps) | `R/CutSettingsEditor/FillMode/` | Missing | M-L | open |
| LBG-C11 | Hide Backlash, Cut in Direction Order, Reduce Direction Changes | `R/OptimizationSettings/` | Missing | S-M | open |
| LBG-C12 | Flood fill travel planning | `R/CutSettingsEditor/FillMode/` | Island Fill covers part of it (`src/core/job/island-fill.ts`) | L | open |
| LBG-C13 | Remove Overlapping Lines tolerance you can set | `R/OptimizationSettings/` | Fixed tolerance (`src/core/job/remove-cut-overlaps.ts`) | S | open |
| LBG-C14 | Laser lead-in and lead-out | `R/CutSettingsEditor/LineMode/` | Laser-off contour entry on the 4040-safe profile only | M | DECISION (PROJECT.md lists laser lead-in/out out of scope) |
| LBG-C15 | Laser Z offset and Z step per pass | `R/CutSettingsEditor/LineMode/` | Missing | M | DECISION (laser Z out of scope in PROJECT.md) |

## Gaps: images and trace

| ID | Gap | LightBurn | KerfDesk today | Size | Status |
|---|---|---|---|---|---|
| LBG-I01 | Non-destructive Enhance (radius, amount, denoise) | `R/ShapeProperties/` | Destructive Image Studio filters only (`src/core/image-adjust/unsharp-mask.ts`, `median.ts`) | M | open |
| LBG-I02 | Halftone (cells per inch, angle) and Newsprint as image modes | `R/CutSettingsEditor/ImageMode/` | Destructive Image Studio filters; the Newsprint filter draws lines, not dots (`src/core/image-adjust/halftone.ts`) | M | open |
| LBG-I03 | Sketch image mode | `R/CutSettingsEditor/ImageMode/` | High-pass plus threshold in Image Studio, two destructive steps | M | open |
| LBG-I04 | Flatten Image Mask (bake, keep the mask) | `R/ApplyMaskToImage/` | Apply, Remove and Crop exist | S | open |
| LBG-I05 | `.clb` import maps the image mode and dot width | `R/MaterialLibrary/` | Hard-coded Floyd-Steinberg and 0 (`src/io/lightburn/clb-import.ts`) | S | open |
| LBG-I06 | Tracing quality against Potrace | `R/TraceImage/` | Draft #924 (ADR-401..409) and its planned batches | — | IN #924 |

## Gaps: machine, laser tools, camera and rotary

| ID | Gap | LightBurn | KerfDesk today | Size | Status |
|---|---|---|---|---|---|
| LBG-M01 | Laser on while framing (low-power visible frame), and Fire out of Labs | `R/DeviceSettings/BasicSettings/`, `R/MoveWindow/` | Hold-to-fire behind an off-by-default Labs flag (`src/ui/laser/MomentaryFireControl.tsx`) | M | open (needs an ADR: Frame is the Start gate) |
| LBG-M02 | Numeric Move-to, saved positions, laser Finish Position | `R/MoveWindow/`, `R/CoordinatesOrigin/` | Click-to-move only; laser finish is fixed (`src/core/output/job-park-target.ts`) | S | open |
| LBG-M03 | Rubber-band frame (outline that hugs the artwork) | `R/LaserWindow/` | Bounding-box frame (`src/core/job/frame-bounds.ts`) | M | open (needs an ADR) |
| LBG-M04 | Red-dot pointer offset | `R/DeviceSettings/DimensionsUnits/` | Missing | M | open |
| LBG-M05 | Material Test: choose the varied parameters (interval, passes), Line and Image modes, border | `R/MaterialTest/` | Speed by power, Fill only (`src/core/job/material-test-grid.ts`) | M | open |
| LBG-M06 | Frame continuously (does not grant Start) | `R/DeviceSettings/BasicSettings/` | Missing | S-M | open |
| LBG-M07 | Keyboard XY jog with modifier keys | `R/MoveWindow/` | Z only (`src/ui/laser/use-jog-shortcuts.ts`) | S | open |
| LBG-M08 | Rotary on an A axis for 4-axis grblHAL and FluidNC boards | `R/RotaryMode/RotaryModeGCode/` | Y substitution only (`src/core/devices/rotary.ts`) | M | open |
| LBG-M09 | Print and Cut out of Labs | `R/PrintAndCut/` | Works behind a Labs flag | S | open (needs hardware qualification) |
| LBG-M10 | Interval Test dithered-image variant | `R/IntervalTest/` | Fill swatches only | S | open |
| LBG-M11 | Auto-home on connect | `R/DeviceSettings/BasicSettings/` | Frame offers Home when alarmed (ADR-367) | S | open |
| LBG-M12 | Focus Test | `R/FocusTest/` | Disabled placeholder command | M-L | DECISION (laser Z out of scope) |
| LBG-M13 | Several cameras per device | `https://docs.lightburnsoftware.com/2.1/Reference/UI/CamerasWindow/` | One camera per device profile | L | open |

## Gaps: files, editing, view, settings and text

| ID | Gap | LightBurn | KerfDesk today | Size | Status |
|---|---|---|---|---|---|
| LBG-F01 | Paste in Place | `R/UI/EditMenu/` | Paste always offsets 10 mm (`PASTE_OFFSET_MM`, `src/ui/state/scene-clipboard-actions.ts`) | S | BATCH 3 |
| LBG-F02 | Invert Selection, Select Open Shapes on every layer | `R/UI/EditMenu/` | Missing; open contours can be selected on Fill layers only | S | BATCH 3 |
| LBG-F03 | Select Contained, Select Smaller Than | `R/UI/EditMenu/` | Missing | S | open |
| LBG-F04 | Filled or Wireframe view toggle | `R/ViewStyle/` | Fill artwork always draws filled (`src/ui/workspace/object-display.ts`) | S | BATCH 3 |
| LBG-F05 | Pasting SVG or images copied from other apps | `R/UI/EditMenu/` | In-app clipboard only | M | open |
| LBG-F06 | Snapping to nodes, midpoints, centres and intersections; settable grid and distance | `R/Snapping/` | Bounding-box edges and centres, fixed 10 mm grid and 2 mm distance (`src/ui/workspace/snapping.ts`) | M | open |
| LBG-F07 | Guidelines dragged from the rulers | `R/AutomaticGuidelines/` | Missing | M-L | open |
| LBG-F08 | Delete Duplicates in the design, Close Path on any layer, Reverse Direction | `R/UI/EditMenu/` | Output-time overlap removal and Fill-only close | S-M | open |
| LBG-F09 | Text Upper Case, vertical alignment, faux bold and italic, Max Width and Squeeze | `R/Text/`, `R/ShapeProperties/` | Missing | S-M | open |
| LBG-F10 | Variable text: custom date and time formats, more cut-setting codes, hex serial, Test and Bake | `R/VariableText/VariableTextFormatting/` | Three fixed date formats; power, speed, passes and air codes | S-M | open |
| LBG-F11 | DXF export; saving LightBurn `.lbrn2` | `R/UI/FileMenu/` | SVG export only | M | open |
| LBG-F12 | Numeric fields accept expressions, unit suffixes and percentages | `R/NumericEditsToolbar/` | Plain numbers in mm | S | open |
| LBG-F13 | Print at 1:1 | `R/Print/` | Missing | S-M | open |
| LBG-F14 | Replace or refresh a bitmap | `R/UI/EditMenu/` | Re-import works for SVG and DXF only (`src/ui/app/reimport-selected-artwork.ts`) | S | open |
| LBG-F15 | Hotkey editor | `R/EditHotkeys/` | Read-only shortcut list | M | open |
| LBG-F16 | Preview: shade vectors by power, legend, save image | `R/Preview/` | Rasters shaded only | S-M | open |
| LBG-F17 | Import: editable text and bitmaps from `.lbrn`, `.lbrn` image and Offset Fill settings, WebP and TGA images, mixed PDF pages | `R/FileManagement/` | Rect, Ellipse, Path and Group only (`src/io/lightburn/lbrn-geometry.ts`); `CutSetting_Img` skipped (`lbrn-import.ts`) | S-L | open |
| LBG-F18 | Preferences dialog (grid, snap, nudge, wheel, import options, autosave interval) | `R/SettingsPreferences/` | Scattered settings | M | open |

## Deliberate differences that need a maintainer decision

These are recorded project rules, not oversights. Each needs Johann's call before any work.

- **Start needs a completed Frame** (PROJECT.md non-negotiable 21, ADR-228). LightBurn starts at once.
- **Start and End G-code are hard-coded** (PROJECT.md "Out of scope"; LIGHTBURN-STUDY D-05).
- **Running an external G-code file** is out of scope; opened files go to the inspector.
- **Macros are one command each** (ADR-293).
- **Laser Z per layer, Focus Test** (laser Z out of scope in PROJECT.md).
- **Inch display units** (PROJECT.md: the internal model is millimetres) and **system font listing**.

## Build plan

Each batch is one pull request with its own decision record, tests and WORKFLOW.md entries.

- **Batch 3 — everyday editing:** LBG-T01, LBG-T02, LBG-T03, LBG-F01, LBG-F02, LBG-F04. No G-code
  changes.
- **Batch 4 — Line and Image cut settings:** LBG-C01, LBG-C02, LBG-C03. Changes G-code only when an
  operation turns one of them on.
- **Next candidates, in order:** LBG-T05, LBG-T07, LBG-T15, LBG-F03, LBG-F08, LBG-F12, LBG-C07,
  LBG-M02, LBG-M07, LBG-I04 (small, daily use), then LBG-C04, LBG-C05, LBG-I01, LBG-I02, LBG-C06,
  LBG-T04, LBG-T06, LBG-T08, LBG-T09, LBG-F06.
