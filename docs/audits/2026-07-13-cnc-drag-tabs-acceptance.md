# CNC Drag-Placeable Tabs Acceptance

Date: 2026-07-13

## Accepted contract

KerfDesk now lets a user convert automatically distributed CNC profile tabs into persisted, directly draggable contour handles.

- `Edit positions` seeds the selected object's current automatic tab count as normalized contour anchors.
- The workspace fits the selected part in view and renders separate yellow tab handles.
- A handle can be dragged along the selected object's eligible closed contours.
- Positions are stored on the object by layer, path, polyline, and normalized arc length.
- Anchors remain attached when the object moves, rotates, mirrors, scales, duplicates, saves, or reloads.
- The compiler projects source anchors onto the compensated profile toolpath, so preview and output use the displayed positions.
- Objects without manual anchors continue to receive automatic tabs, including objects sharing a layer with an edited part.
- `Reset automatic` removes manual anchors and restores even distribution.
- A tab drag is one undoable interaction; Escape restores the pre-drag project.

## Verification

- TypeScript typecheck: passed.
- ESLint: passed.
- Focused suite: 42 tests passed across anchor geometry, manual bridge splitting, profile compilation, mixed automatic/manual layers, project validation, undoable state actions, hit testing, React controls, and workspace dragging.
- Full `corepack pnpm release:check`: passed in 498.4 seconds, including repository identity, formatting, licenses, dependency audit, full Vitest, Playwright, web and Electron builds, and size policies.

## Browser acceptance

Tested at `http://127.0.0.1:5181/` with a 50 x 50 mm outside profile and a 3.175 mm end mill:

1. Enabled four holding tabs with 2 mm height and 6 mm width.
2. Entered `Edit positions`; the workspace automatically zoomed from 100% to 560%.
3. Confirmed four separate yellow handles on the contour.
4. Dragged the top-center handle toward the top-right portion of the edge and confirmed its new position visually.
5. Opened Preview; compilation succeeded with cut, travel, plunge, total-distance, and time statistics.
6. Browser console inspection returned no warnings or errors.

## Reference basis

- [Easel: How To Use Tabs](https://support.easel.com/hc/en-us/articles/360012453214-How-To-Use-Tabs) documents automatic tabs, adjustable width and height, and direct click-drag repositioning away from poor finishing locations.
- [Autodesk Fusion: Tabs reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-REF-2D-CONTOUR-TABS.htm) documents automatic and manual positions, contour clicking, and click-drag adjustment.
- [Vectric: Toolpath Tabs](https://docs.vectric.com/docs/V12.5/VCarveDesktop/ENU/Help/form/Toolpath%20Tabs/) documents automatic placement plus interactive add, delete, and move behavior.

## Remaining boundary

This ticket closes the audited drag-placeable-tab gap for existing rectangular profile tabs. It does not yet add individual click-to-add/delete commands, triangular 3D tabs, or manual positions for the generated inlay insert. Those are refinements rather than prerequisites for the Easel-style drag workflow accepted here.
