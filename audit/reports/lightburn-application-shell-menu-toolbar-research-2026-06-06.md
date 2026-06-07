# LightBurn Application Shell / Menus / Toolbars Research

Date: 2026-06-06
Repo: `C:\Users\Asus\LaserForge-2.0`
Scope: audit and roadmap only. No production code was changed for this report.

## Executive Summary

LaserForge still uses a compact flat toolbar, while LightBurn organizes operator work through a menu bar, grouped toolbars, dockable windows, and context-sensitive command surfaces. This is not just visual polish. In LightBurn, the application shell is the operator's map: File owns project and machine-file I/O, Edit owns selection/clipboard/conversion actions, Tools owns creation/image/vector tools, Arrange owns positioning and duplication, Laser Tools owns device/calibration workflows, and Window owns panels.

The safest LaserForge path is not to copy every LightBurn command at once. The right first move is a **command registry**: one typed source of truth for command ID, label, group, shortcut, enabled state, handler, safety gating, and optional LightBurn source. The existing toolbar and shortcut code already share some file handlers, but the app does not yet have a central command model that can feed menus, buttons, right-click context menus, keyboard shortcuts, and a future Electron native menu.

Recommended build order:

1. Add a command registry for existing shipped commands only.
2. Render a LightBurn-style menu bar from that registry.
3. Rebuild the current toolbar as grouped Main / Creation / Arrange / Laser surfaces.
4. Add Window menu panel toggles for current panels.
5. Add a safe right-click context menu.
6. Add an Electron native-menu bridge after the web menu works.

Do not start by adding every missing LightBurn command. Many commands represent separate feature work: Boolean tools, arrays, node editing, material tests, devices manager, console, rotary, cameras, and material library. The shell should expose shipped commands first, then disabled or hidden future commands only where they help orientation without implying support.

## Official LightBurn Baseline

### Top-Level Menus

LightBurn's top-level UI reference exposes these command families:

- File
- Edit
- Tools
- Arrange
- Laser Tools
- Window
- Language
- Help

LaserForge does not need the Language menu yet because it has no localization workflow, and it does not need license/update items in Help because the app has no commercial license manager. But File/Edit/Tools/Arrange/Laser Tools/Window/Help are the workflow spine under ADR-027's LightBurn-as-source-of-truth rule.

Sources:

- https://docs.lightburnsoftware.com/latest/Reference/UI/FileMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/EditMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/ToolsMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/ArrangeMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/LaserToolsMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/WindowMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/HelpMenu/

### File Menu

LightBurn's File menu owns new/open/recent/import/save/save-as, machine-file export, graphics export, preferences/bundles, print, processed bitmap export, camera/background capture, and exit. The critical LaserForge parity point is command grouping: `Save Project`, `Save Project As`, and `Save G-code` are not the same operator action and should not live as an undifferentiated toolbar row forever.

Official source: https://docs.lightburnsoftware.com/latest/Reference/UI/FileMenu/

### Edit Menu

LightBurn's Edit menu owns undo/redo, select, clipboard, duplicate, paste-in-place, delete, Convert to Path, Convert to Bitmap, path closing/joining/optimization, duplicate deletion, shape direction, layer-based selection, image refresh/replace, and settings.

LaserForge already has some of these actions in shortcuts and toolbar code: undo/redo, select all, duplicate, delete, and Convert to Bitmap. It does not expose them through a menu model.

Official source: https://docs.lightburnsoftware.com/latest/Reference/UI/EditMenu/

### Tools Menu

LightBurn's Tools menu owns tool selection, drawing tools, node editing, trim/tabs/text, laser positioning, measure, vector modification, Adjust Image, Trace Image, Apply Mask, Crop Image, and warp/deform tools.

LaserForge already has text, image import, trace, and convert-to-bitmap workflows, but their current location is a flat top toolbar. The LightBurn-correct shell would put image tools under Tools, with toolbar buttons as shortcuts rather than the primary structure.

Official source: https://docs.lightburnsoftware.com/latest/Reference/UI/ToolsMenu/

### Arrange Menu And Arrange Toolbar

LightBurn's Arrange menu and toolbar group transformations and duplication workflows: group/ungroup, flip/mirror, rotate, align, distribute, move selected objects, move laser to selection, grid/circular array, copy along path, rubber-band outline, break apart, draw order, and lock/unlock.

LaserForge already has basic transform, flip, nudge, and selection behavior. It lacks most Arrange workflows, but the shell should still place shipped transform commands into an Arrange group once commands are centralized.

Sources:

- https://docs.lightburnsoftware.com/latest/Reference/UI/ArrangeMenu/
- https://docs.lightburnsoftware.com/latest/Reference/UI/ArrangeToolbar/

### Laser Tools Menu

LightBurn's Laser Tools menu groups hardware and calibration workflows: Print and Cut, cameras, rotary, focus/interval/material tests, device settings, machine settings, manage devices, and related laser setup. This maps directly to LaserForge's future calibration/device roadmap.

LaserForge should not add camera, rotary, or galvo commands yet. But current shipped laser actions should move under this command family: Connect/Disconnect, Home, Frame, Start/Pause/Stop, Device Settings, detected controller settings, and future Material/Interval Test.

Official source: https://docs.lightburnsoftware.com/latest/Reference/UI/LaserToolsMenu/

### Window Menu And Dockable Windows

LightBurn's Window menu toggles Preview, zoom/view options, side panels, and dockable windows/toolbars such as Console, Cuts / Layers, Laser, Material Library, Move, Shape Properties, Text Options, and Toolbars.

LaserForge currently has fixed side panels. A Window menu can start smaller: toggle Cuts/Layers, Laser controls, Preview, and reset layout. Docking/drag-rearrange can be deferred.

Official source: https://docs.lightburnsoftware.com/latest/Reference/UI/WindowMenu/

### Main, Creation, Arrange, Modes, And Modifier Toolbars

LightBurn's Main Toolbar exposes quick access for File, clipboard, view, Preview, Settings, and Device Settings. Creation Toolbar exposes tools like Select, Draw Lines, Draw Shapes, Edit Nodes, Trim, Add Tabs, Text, Position Laser, and Measure. Arrange Toolbar exposes group, flip/mirror, align, make same width/height, distribute, move selected objects, and move laser to selection.

Sources:

- https://docs.lightburnsoftware.com/latest/Reference/UI/MainToolbar/
- https://docs.lightburnsoftware.com/latest/Reference/UI/CreationToolbar/
- https://docs.lightburnsoftware.com/latest/Reference/UI/ArrangeToolbar/
- https://docs.lightburnsoftware.com/latest/Reference/UI/MenuToolbar/
- https://docs.lightburnsoftware.com/latest/Reference/UI/ModesToolbar/
- https://docs.lightburnsoftware.com/latest/Reference/UI/ModifiersToolbar/

## Current LaserForge Evidence

### App Shell

Evidence inspected:

- `src/ui/app/App.tsx`
- `src/ui/common/Toolbar.tsx`
- `src/ui/layers/CutsLayersPanel.tsx`
- `src/ui/laser/LaserWindow.tsx`
- `src/ui/workspace/Workspace.tsx`
- `src/ui/state/ui-store.ts`

Current shell structure:

- Top: one `Toolbar`.
- Center: `Workspace`.
- Right rail: fixed `CutsLayersPanel` and `LaserWindow`.
- Bottom: `StatusBar`.
- Modals: `AddTextDialog`, `ImportImageDialog`, `ConvertToBitmapDialog`.

There is no menu bar, dock/window model, panel visibility model, or command palette. This is acceptable for a small MVP shell, but it is a LightBurn workflow gap.

### Flat Toolbar

Evidence inspected:

- `src/ui/common/Toolbar.tsx`

The current toolbar includes:

- New
- Open
- Save
- Save As
- Import SVG
- Text
- Import Image
- Trace Image
- Convert to Bitmap
- Save G-code
- Build badge
- Shortcut hint

This is functionally useful but structurally different from LightBurn. File, image, vector, text, and machine-output commands are all siblings. The result is that adding future LightBurn parity commands would bloat `Toolbar.tsx` and force the operator to scan one long row instead of a grouped workflow.

Current positive: `Toolbar.tsx` delegates several file commands into `src/ui/app/file-actions.ts`, which is exactly the kind of shared handler surface a command registry should reuse.

### Keyboard Shortcuts

Evidence inspected:

- `src/ui/app/shortcuts.ts`
- `src/ui/app/use-shortcuts.ts`
- `src/ui/app/shortcuts.test.ts`

LaserForge has explicit shortcut handling for:

- File: New, Open, Save, Save As, Import SVG, Save G-code.
- Edit: Undo, Redo, Select All, Duplicate, Delete, Deselect.
- Transform: arrow nudge, Shift+nudge, H/V flip.
- View: Preview toggle, fit/reset, zoom in/out, fit selection.

This is a good foundation, but it is still separate from toolbar rendering. There is no typed command object that can answer: label, shortcut, enabled state, disabled reason, handler, menu group, toolbar group, and safety-gating status.

### Electron Native Menu

Evidence inspected:

- `electron/main.ts`

The Electron window sets `autoHideMenuBar: true` and does not install an application menu. That means desktop users do not get a Windows-native File/Edit/Laser menu, even though the app has a Windows target and LightBurn-style users expect a menu bar.

This should be fixed after the web-side command registry exists. Building native menus first would duplicate command wiring and create platform drift.

### Context Menu

Evidence inspected:

- `src/ui/workspace/Workspace.tsx`

Workspace suppresses the OS context menu because right-click is rebound to panning. There is no LaserForge context menu for selection actions such as Delete, Duplicate, Convert to Bitmap, Trace selected image, Adjust Image, Cut Settings, or object properties.

This is a real LightBurn workflow gap, but it should not be built before the command registry. A context menu without shared enable/disable rules is how safety and selection bugs creep in.

### Dockable Windows / Panel Visibility

Evidence inspected:

- `src/ui/app/App.tsx`
- `src/ui/state/ui-store.ts`

Current panels are fixed. `ui-store.ts` has dialog, zoom/pan, drag overlay, preview scrubber, and import/trace dialog state, but no docked-window visibility state. A full LightBurn docking system is too much for the current phase. A first useful step is simple Window menu toggles for current panels.

## Retired Or Stale Notes

- "Toolbar code must be split before any shell work" is not currently the main blocker. `Toolbar.tsx` is still broad, but current code has already split several image/layer concerns into sibling files (`LayerImageFields.tsx`, `LayerOrderControls.tsx`, `SelectedImageAdjustments.tsx`, `ConvertToBitmapDialog.tsx`, `vector-to-bitmap.ts`). Shell work should focus on command architecture first.
- "LaserForge has no keyboard shortcuts" is false. Current shortcut coverage is meaningful, but it is not centralized in a command registry.
- "Electron can just use a native menu" is incomplete. Native menus need renderer command dispatch and shared command state; otherwise desktop and web diverge.

## Remaining Gaps And Findings

### ASM-1: No Command Registry

Severity: P1 architecture/workflow risk
Confidence: high
Trigger path: adding menu bar, context menu, Electron menu, or more toolbar commands without one shared command definition.

Current toolbar and shortcut paths share file handlers, but there is no command registry. As LightBurn parity expands, commands will need consistent labels, shortcuts, enabled state, disabled reasons, safety gating, and handlers across menu bar, toolbar, right-click context menu, and Electron.

Concrete fix:

- Create a typed `CommandId` union and `CommandDefinition` type.
- Centralize labels, menu group, toolbar group, shortcut text, and enablement.
- Keep handlers injected from React/store/platform context; do not make command definitions import Zustand directly.
- Add tests proving toolbar and shortcuts reference the same command IDs.

### ASM-2: No LightBurn-Style Menu Bar

Severity: P2 workflow gap
Confidence: high
Trigger path: operator expects File/Edit/Tools/Arrange/Laser Tools/Window/Help grouping.

LaserForge's flat toolbar makes core commands available, but it does not teach the LightBurn workflow. It also has no natural home for future calibration and window-management commands.

Concrete fix:

- Add a web-rendered menu bar first.
- Start with shipped commands only:
  - File: New, Open, Save, Save As, Import SVG, Import Image, Save G-code.
  - Edit: Undo, Redo, Select All, Duplicate, Delete, Convert to Bitmap.
  - Tools: Text, Trace Image, Convert to Bitmap, future Adjust Image placeholder if not shipped.
  - Arrange: Flip H/V, nudge/transform commands where meaningful.
  - Laser Tools: Connect, Home, Frame, Start, Stop, Device Settings, future Material/Interval Test placeholders.
  - Window: Preview, Cuts/Layers, Laser Controls, Reset View/Layout.
  - Help: About/build info, docs links if intentionally supported.
- Disabled commands must explain why they are unavailable.

### ASM-3: Flat Toolbar Will Not Scale

Severity: P2 workflow gap
Confidence: high
Trigger path: adding Material Test, Interval Test, Devices Manager, Move, Console, Adjust Image, and vector tools into the current top row.

The current toolbar is already mixing project, content, image, trace, bitmap-conversion, and output commands. Future commands would turn it into a catch-all strip.

Concrete fix:

- Keep a compact Main Toolbar for highest-frequency commands.
- Add a Creation Toolbar for Select/Text/Image/Trace tools that exist.
- Add an Arrange Toolbar only as shipped Arrange commands exist.
- Keep future unimplemented commands out of primary toolbar buttons.

### ASM-4: No Window / Panel Toggle Model

Severity: P2 workflow gap
Confidence: high
Trigger path: operator needs more canvas space or wants to switch between Cuts/Layers, Laser, Move, Console, Material Library.

LightBurn uses the Window menu to manage visible panels. LaserForge currently fixes Cuts/Layers and Laser controls in the right rail.

Concrete fix:

- Add `ui-store` state for visible panels: cuts/layers, laser controls, future move, future console.
- Add Window menu checkboxes.
- Add Reset Layout.
- Defer drag-docking until after panels are separate components with stable visibility state.

### ASM-5: No Context Menu

Severity: P2 workflow gap
Confidence: high
Trigger path: operator right-clicks selected artwork expecting object-specific actions.

Right-click currently suppresses the browser menu to support panning. That is reasonable, but no LaserForge context menu replaces it.

Concrete fix:

- Add context menu only after command registry exists.
- Selection context should include shipped actions: Duplicate, Delete, Convert to Bitmap if vector, Trace Image if raster, maybe Save/Export selection later.
- Canvas empty context can include Paste if clipboard exists later, Zoom/Fit, and Import.
- Keep right-drag pan behavior by distinguishing click/context from drag.

### ASM-6: Electron Desktop Has No Native Menu

Severity: P2 desktop workflow gap
Confidence: high
Trigger path: Windows desktop user expects File/Edit menu and Alt-key menu navigation.

`electron/main.ts` sets `autoHideMenuBar: true` and does not install a native menu. This is a LightBurn desktop parity gap.

Concrete fix:

- Build web command registry first.
- Add IPC command bridge for native menu items to dispatch renderer command IDs.
- Keep native menu labels/shortcuts generated from the same command definitions where possible.
- Do not duplicate command logic in `electron/main.ts`.

### ASM-7: Missing Commands Are Feature Gaps, Not Shell Work

Severity: P2 roadmap clarity
Confidence: high
Trigger path: implementation tries to satisfy LightBurn menu parity by adding empty buttons for everything.

Many LightBurn menu items are not shell tasks. They require separate feature plans: Boolean tools, Grid/Circular Array, node editing, Apply Mask, Adjust Image, Material Test, Interval Test, Devices Manager, Move, Console, Material Library, Print and Cut, cameras, and rotary.

Concrete fix:

- Command registry may include known future IDs only if disabled with clear "Not built yet" copy.
- Do not add handlers for fake features.
- Roadmap each command to its owning research report.

## Recommended Build Order

### Phase ASM-0: Command Registry Design

Goal: one source of truth for commands before menus/toolbars multiply.

Likely files:

- New `src/ui/commands/command-types.ts`
- New `src/ui/commands/command-registry.ts`
- New `src/ui/commands/use-command-handlers.ts`
- New `src/ui/commands/command-registry.test.ts`

Rules:

- Definitions are data, not direct store mutations.
- Handlers are injected from React hooks/platform/store.
- Enabled state and disabled reason are computed in one place.
- Safety-sensitive commands must expose their gating reason.

### Phase ASM-1: Web Menu Bar

Goal: LightBurn-style grouping for existing commands.

Likely files:

- New `src/ui/shell/MenuBar.tsx`
- New `src/ui/shell/Menu.tsx`
- Modify `src/ui/app/App.tsx`
- Tests for menu rendering and command enablement.

Start with real shipped commands. Avoid a giant "coming soon" menu wall.

### Phase ASM-2: Toolbar Regrouping

Goal: turn the flat toolbar into grouped quick-access surfaces.

Likely files:

- Split `src/ui/common/Toolbar.tsx` into shell/toolbar components, or move to `src/ui/shell/`.
- Add Main Toolbar from command registry.
- Add Creation Toolbar only for shipped tools.
- Keep BuildBadge and shortcut help, but move them out of command-heavy toolbar logic.

### Phase ASM-3: Window Menu And Panel Visibility

Goal: make current fixed panels toggleable before designing full docking.

Likely files:

- `src/ui/state/ui-store.ts`
- `src/ui/app/App.tsx`
- `src/ui/shell/MenuBar.tsx`
- Tests for panel toggle state.

Minimum:

- Toggle Cuts/Layers.
- Toggle Laser Controls.
- Toggle Preview.
- Reset View/Layout.

### Phase ASM-4: Context Menu

Goal: selection-specific right-click commands using the same command registry.

Likely files:

- New `src/ui/shell/ContextMenu.tsx`
- `src/ui/workspace/Workspace.tsx`
- Command tests for raster/vector/empty selection contexts.

Must preserve right-drag pan. Trigger context menu on right-click release without movement, not on active drag.

### Phase ASM-5: Electron Native Menu

Goal: desktop parity without duplicating command logic.

Likely files:

- `electron/main.ts`
- New `electron/menu.ts`
- `src/platform/types.ts` if a command IPC bridge is needed.
- Tests for menu template generation.

Use native menu as a wrapper around renderer command IDs. Do not put business logic in Electron.

## Verification Plan

Unit/UI tests:

- Every visible menu item maps to a known `CommandId`.
- Toolbar buttons and shortcut bindings use the same command IDs.
- Disabled commands render disabled reasons.
- Context menu contains only commands valid for the current selection kind.
- Window menu toggles panels without mutating project state.
- File commands still call the existing `file-actions.ts` handlers.
- No modal allows global Delete/shortcut side effects behind it.

Manual browser verification:

1. Open app locally.
2. New/Open/Save/Save As/Import SVG/Import Image/Save G-code work from menu and toolbar.
3. Ctrl/Cmd shortcuts still work.
4. Disabled command explanations make sense for empty scene, vector selection, raster selection, and active job.
5. Preview toggle works from Window menu and shortcut.
6. Panel toggles preserve project state.

Desktop verification:

1. Run Electron dev build.
2. Confirm native menu exists.
3. Confirm menu commands dispatch to renderer.
4. Confirm no command is available in native menu when the web menu would disable it.
5. Confirm serial/laser safety buttons remain reachable; no modal menu action can hide Stop during active job.

## Roadmap Placement

This should come after the immediate image/output correctness tickets and before adding many new LightBurn tools. The command registry reduces future blast radius for:

- Devices Manager.
- Move Window.
- Console.
- Material Test.
- Interval Test.
- Material Library.
- Adjust Image.
- Vector Editing.
- Optimization Settings.

The shell itself should be a foundation, not a feature dump.

## Sources

- LightBurn File Menu: https://docs.lightburnsoftware.com/latest/Reference/UI/FileMenu/
- LightBurn Edit Menu: https://docs.lightburnsoftware.com/latest/Reference/UI/EditMenu/
- LightBurn Tools Menu: https://docs.lightburnsoftware.com/latest/Reference/UI/ToolsMenu/
- LightBurn Arrange Menu: https://docs.lightburnsoftware.com/latest/Reference/UI/ArrangeMenu/
- LightBurn Laser Tools Menu: https://docs.lightburnsoftware.com/latest/Reference/UI/LaserToolsMenu/
- LightBurn Window Menu: https://docs.lightburnsoftware.com/latest/Reference/UI/WindowMenu/
- LightBurn Help Menu: https://docs.lightburnsoftware.com/latest/Reference/UI/HelpMenu/
- LightBurn Main Toolbar: https://docs.lightburnsoftware.com/latest/Reference/UI/MainToolbar/
- LightBurn Creation Toolbar: https://docs.lightburnsoftware.com/latest/Reference/UI/CreationToolbar/
- LightBurn Arrange Toolbar: https://docs.lightburnsoftware.com/latest/Reference/UI/ArrangeToolbar/
- LightBurn Menu Toolbar: https://docs.lightburnsoftware.com/latest/Reference/UI/MenuToolbar/
- LightBurn Modes Toolbar: https://docs.lightburnsoftware.com/latest/Reference/UI/ModesToolbar/
- LightBurn Modifiers Toolbar: https://docs.lightburnsoftware.com/latest/Reference/UI/ModifiersToolbar/
- In-repo baseline: `LIGHTBURN-STUDY.md` Section 3 and Section 8.1.
