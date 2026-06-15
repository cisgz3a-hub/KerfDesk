# LightBurn Feature Gap List

Date: 2026-06-15
Repo: LaserForge-2.0
Mode: read-only parity audit

## Answer

No. LaserForge has a strong GRBL diode-laser core, but it has not built every
feature documented by LightBurn. The current app covers project IO, SVG/image
import, image adjustment, trace, convert-to-bitmap, basic drawing, layers,
preview, GRBL job control, material/interval test foundations, material-library
foundations, and safety/preflight paths.

The largest remaining gaps are LightBurn workflow breadth:

- Advanced vector editing and geometry operations.
- Full Cut Settings Editor parity.
- Offset Fill and sub-layers.
- Camera, rotary, print-and-cut, galvo, split/repeat/feeder workflows.
- Console/macros/file-list/machine-settings/device-management depth.
- Full material library and calibration polish.
- Full tooltip/help/documented workflow coverage.

## Sources Used

Official LightBurn documentation:

- Tools and Features index:
  <https://docs.lightburnsoftware.com/2.1/Reference/>
- Tools menu:
  <https://docs.lightburnsoftware.com/2.1/Reference/UI/ToolsMenu/>
- Laser Tools menu:
  <https://docs.lightburnsoftware.com/2.1/Reference/UI/LaserToolsMenu/>
- Cuts / Layers window:
  <https://docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/>

Local LaserForge evidence:

- `src/ui/commands/command-types.ts`
- `src/ui/commands/command-families.ts`
- `PROJECT.md`
- `DECISIONS.md`
- `WORKFLOW.md`
- existing `audit/reports/` and `docs/superpowers/plans/` LightBurn parity notes

## Legend

- Built: usable in the app now.
- Partial: exists, but does not match LightBurn depth or workflow.
- Missing: no equivalent usable feature found.
- Not current scope: LightBurn has it, but it is likely outside a GRBL diode
  LaserForge target unless the product scope changes.

## Numbered Feature List

### Core App and File Workflow

1. New project - Built. Present in File commands.
2. Open project - Built. `.lf2` project flow exists.
3. Save project - Built.
4. Save project as - Built.
5. Import SVG - Partial. Import exists, but full LightBurn import parity is not
   proven for every SVG construct such as complex text, filters, references,
   units, and all transform edge cases.
6. Import image - Built. Image import exists and feeds raster/trace workflows.
7. Save/export G-code - Built. Export exists and shares output/preflight logic.
8. Print - Missing. LightBurn documents Print as an essential function.
9. New Window / multiple instances - Missing. LightBurn documents New Window.
10. Show Notes - Missing. No LightBurn-style project notes window was found.
11. View Style controls - Partial. LaserForge has a workspace, preview, grid,
    and visibility controls, but not the full documented LightBurn view-style
    surface.
12. Clipboard cut/copy/paste - Missing or not exposed in the current command
    registry. Duplicate exists, but clipboard workflow parity is not present.
13. Undo/Redo - Built. Core commands exist.
14. Undo history window - Missing. LightBurn 2.1 documents richer history
    workflow; LaserForge only exposes command-level undo/redo.
15. Dirty-project guard - Built/Partial. Present on destructive commands, but
    not equivalent to a full desktop app document lifecycle.

### Selection, Workspace, and Transform

16. Select tool - Built. Basic selection exists.
17. Multi-select - Partial. Shift-style selection exists; full LightBurn
    marquee/multi-selection behavior is still not fully matched.
18. Zooming and panning - Built/Partial. Workspace controls exist; full
    LightBurn navigation parity is not fully audited.
19. Transform controls - Partial. Move, scale, rotate, flip, and numeric editing
    foundations exist, but LightBurn has deeper transform workflows.
20. Numeric edits toolbar - Partial. LaserForge has numeric geometry fields, but
    not a full LightBurn toolbar clone.
21. Grouping - Missing.
22. Ungrouping - Missing.
23. Shape properties window - Partial. LaserForge exposes some object/layer
    settings, but not full LightBurn shape-property parity.
24. Lock shapes - Missing.
25. Snapping - Missing. LightBurn documents snapping as a design feature.
26. Automatic guidelines - Missing.
27. Status bar parity - Partial. LaserForge has status/readout elements, but not
    full LightBurn status-bar behavior.

### Creation Tools

28. Draw lines - Built. Polyline/pen tool exists.
29. Draw rectangle - Built.
30. Draw ellipse - Built.
31. Draw polygon - Partial. Polygon exists, but LightBurn exposes multiple shape
    presets and richer shape creation controls.
32. Triangle tool - Partial/Missing. Could be approximated by polygon; no
    dedicated LightBurn-style tool found.
33. Pentagon tool - Partial/Missing.
34. Octagon tool - Partial/Missing.
35. Star tool - Missing.
36. Dual star tool - Missing.
37. Text tool - Partial. Text exists, but full LightBurn text editing,
    formatting, variable text, path text, and text-to-path workflows are not
    complete.
38. Variable text - Missing.
39. Variable text formatting - Missing.
40. Barcode / QR creation - Missing.
41. Measure tool - Missing.
42. Art Library - Missing.
43. Add Tabs - Missing. This matters for cut workflows.

### Vector Editing and Geometry

44. Edit nodes - Missing.
45. Trim shapes - Missing.
46. Convert to path - Missing or incomplete as a user-facing workflow.
47. Auto-join selected shapes - Missing.
48. Close path - Missing or incomplete as a user-facing workflow.
49. Close selected paths with tolerance - Missing.
50. Delete duplicates - Missing.
51. Break apart - Missing.
52. Optimize selected shapes - Missing.
53. Warp and deform - Missing.
54. Two-point rotate / scale - Missing.
55. Rubber-band outline - Missing.
56. Flip horizontal - Built.
57. Flip vertical - Built.
58. Offset shapes - Missing.
59. Weld - Missing.
60. Boolean union - Missing.
61. Boolean subtract - Missing.
62. Boolean intersection - Missing.
63. Boolean assistant - Missing.
64. Cut shapes - Missing.
65. Grid array - Missing.
66. Circular array - Missing.
67. Copy along path - Missing.
68. Apply path to text - Missing.
69. Radius / fillet - Missing.
70. Make same width / height - Missing as a dedicated command.
71. Resize slots - Missing.
72. Generate tangent circle - Missing.

### Arrangement

73. Align left/right/top/bottom/centers - Built or active WIP. Current worktree
    contains align command and test files.
74. Distribute centers/spacing - Built or active WIP. Current worktree contains
    distribute command and test files.
75. Move selected objects command set - Partial. Direct transforms exist; full
    LightBurn command workflow is not complete.
76. Docking - Missing.
77. Nest selected - Missing.
78. Quick Nest - Missing.
79. Push in draw order - Missing.
80. Arrange toolbars customization - Missing.

### Image Tools

81. Adjust Image - Built/Partial. Dialog exists with raster controls, but full
    LightBurn parity still needs continued verification.
82. Apply mask to image - Missing.
83. Crop image / mask workflow - Missing.
84. Convert to Bitmap - Partial. Implemented with worker/budget safeguards and
    render-type work, but full LightBurn polish and parity need continued audit.
85. Save processed bitmap - Missing.
86. Trace Image - Partial. Current trace is much improved, but LightBurn has
    richer trace-dialog workflow and controls. Some controls exist; full parity
    is not complete.
87. Multi-File Trace Image - Missing.
88. Image Options - Partial. LaserForge has image mode/layer settings, but not
    full LightBurn Image Options parity.
89. Image pass-through - Built/Partial. Pass-through style behavior exists in
    layer settings, but full workflow parity needs more hardware validation.
90. Raster dither modes - Partial. LaserForge has multiple dithers, but
    LightBurn-level image engraving tuning still needs broader test coverage.

### Cuts, Layers, and Cut Settings

91. Cuts / Layers window - Built/Partial. LaserForge has layers and cut settings.
92. Layer colors - Partial. Layer color concepts exist, but not full LightBurn
    color-palette behavior.
93. Output toggle - Built.
94. Show/visible toggle - Built.
95. Layer ordering - Built/Partial.
96. Line mode - Built.
97. Fill mode - Built/Partial.
98. Image mode - Built/Partial.
99. Offset Fill mode - Missing. This is one of the clearest LightBurn parity
    gaps.
100. Main/shared cut settings - Partial. Speed, power, passes, min power, and
     related settings exist, but LightBurn has a much larger settings surface.
101. Advanced Cut Settings Editor - Partial. LaserForge lacks many CSE controls
     and editor organization patterns.
102. Sub-layers - Missing.
103. Default layer settings - Missing/Partial.
104. Copy layer settings - Partial/Missing. Some plans exist; full workflow not
     confirmed.
105. Kerf compensation - Missing.
106. Tabs/bridges in cut settings - Missing.
107. Perforation mode - Missing.
108. Lead-in / lead-out - Missing.
109. Air assist control - Missing.
110. Z step / focus-related layer controls - Missing/Partial.
111. Constant power / corner power style controls - Partial/Missing depending on
     controller and layer mode.
112. Frequency/Q-pulse/galvo cut settings - Not current scope for GRBL diode,
     missing if aiming for all LightBurn.

### Preview, Output, and Positioning

113. Preview - Built/Partial. Preview exists and is used for output checks.
     LightBurn parity for estimates and all mode visualization is not complete.
114. Exact preview versus emitted output invariant - Built/Partial. Stronger than
     many hobby apps, but still needs ongoing burn-file regression tests.
115. Laser window Start/Stop/Pause/Resume - Built for GRBL.
116. Frame - Built/Partial. Works for GRBL workflows, but LightBurn framing has
     more variants and hardware modes.
117. Coordinates and job origin - Built/Partial.
118. Move/Jog window - Built/Partial.
119. Set Origin / work origin - Built/Partial.
120. Optimization Settings - Partial. LaserForge has an entry point and reduce
     travel behavior, not the full LightBurn optimizer.
121. Cut selected graphics - Missing/Partial. Selection-specific output is not
     fully matched to LightBurn.
122. Use Selection Origin - Missing/Partial.
123. Position Laser tool - Missing/Partial. Jogging exists; click/position tool
     parity is not complete.
124. Set Start Point - Missing.
125. Move Laser to Selection - Missing/Partial.
126. Galvo Framing - Not current scope; missing for full LightBurn parity.

### Quality Optimization

127. Material Test - Partial. Generator/dialog exists, but full LightBurn depth,
     saved presets, and hardware-calibrated workflow are incomplete.
128. Focus Test - Missing.
129. Interval Test - Partial. Generator/dialog exists, but full LightBurn depth
     and hardware-calibrated workflow are incomplete.
130. Material Library - Partial. Native recipe/IO/panel foundations exist, but
     full LightBurn Material Library behavior is incomplete.
131. Material Library Assign - Partial.
132. Material Library Link/synced presets - Missing.
133. Material Library `.clb` compatibility - Missing.
134. Manufacturer material libraries - Missing.

### Modes and Advanced Hardware Control

135. Print and Cut - Missing.
136. Rotary mode - Not current scope; missing for full LightBurn parity.
137. Rotary mode for DSP - Not current scope.
138. Rotary mode for GCode - Missing if GRBL rotary support becomes in scope.
139. Rotary mode for Galvo - Not current scope.
140. Repeat Marking - Missing.
141. Split Marking - Missing.
142. Feeder setup - Missing.
143. Center Finder - Missing.
144. Cylinder Correction - Missing.
145. Taper Warp - Missing.
146. Galvo Lens Calibration - Not current scope.
147. Dual Laser Control - Missing/Not current scope.
148. Laser 2 offset setup - Missing/Not current scope.
149. Red-dot pointer offset setup - Missing.
150. Scanning offset adjustment - Missing/Partial. This matters for image/raster
     engraving quality and bidirectional fill calibration.

### Machine Management and Connection

151. Device Settings - Partial. LaserForge has basic device dimensions/origin,
     `$30/$31/$32`, homing, max feed, and setup helpers, but not the full
     LightBurn device settings matrix.
152. Devices manager - Partial/Missing. No full multi-device LightBurn manager
     parity.
153. Machine Settings - Partial/Missing. LaserForge detects and uses GRBL
     settings, but lacks a full LightBurn-style settings editor.
154. Get Controller Info - Missing/Partial.
155. Console Window - Missing. This is important for GRBL troubleshooting.
156. Macros Window - Missing.
157. File List Window - Missing.
158. LightBurn Bridge - Not current scope; missing for full LightBurn parity.
159. GRBL network connection setup - Missing/Partial.
160. Web Serial USB connection - Built.
161. Alarm/unlock flow - Built/Partial. Recent GRBL4040 work improved this, but
     more controller-family hardware validation is needed.
162. Controller error interpretation - Built/Partial. Error 8/9 handling exists,
     but full LightBurn console-style diagnostics are missing.

### Cameras

163. Cameras window - Missing.
164. Add camera - Missing.
165. Manage/edit cameras - Missing.
166. Camera lens calibration - Missing.
167. Camera alignment - Missing.
168. Head-mounted cameras - Missing.
169. Save background capture - Missing.
170. Network/multi-camera support - Missing.

### Settings, Preferences, Help, and Packaging

171. Beginner mode - Missing.
172. Settings/preferences - Partial. Some settings exist; full LightBurn
     preference coverage is missing.
173. Manage preferences - Missing.
174. User bundles - Missing.
175. Vendor bundles - Missing.
176. Edit hotkeys - Missing/Partial. Shortcuts exist in code, but no full user
     hotkey editor was found.
177. Reset to default layout - Missing.
178. Language menu - Missing.
179. Tooltips and topic-aware help - Partial. Some hover/title work exists; user
     requested app-wide hover explanations, which is still incomplete.
180. Help and notes - Partial/Missing.
181. Check for updates - Missing.
182. License management - Not applicable unless LaserForge adds commercial
     licensing.
183. Accessibility statement / formal accessibility workflow - Missing.
184. Automation with UDP - Not current scope.
185. CorelDRAW macro setup - Not current scope.

### Safety and Troubleshooting

186. Safety guidance - Partial. LaserForge has stronger runtime safety
     preflights than a simple sender, but docs/UI parity with LightBurn safety
     guidance is incomplete.
187. Stop / emergency workflow - Partial. Software stop paths exist, but
     hardware E-stop remains the real safety requirement.
188. USB disconnect handling - Built/Partial. Improved after audit; still needs
     broad hardware tests.
189. Bounds preflight - Built.
190. Travel laser-off checks - Built/Partial. Several invariants exist; continue
     auditing every new emitter change.
191. Low/no power troubleshooting workflow - Partial. GRBL setup assistant helps,
     but no full troubleshooting guide/UI.
192. Job quality diagnostics - Missing/Partial. LightBurn documents many quality
     issues; LaserForge has ad hoc research notes, not a complete operator
     diagnostic workflow.

## Priority Build Order

If the goal is "match LightBurn where it matters for current GRBL diode users,"
the next build order should be:

1. Console Window plus GRBL command/log tooling.
2. Machine Settings editor for safe read/write of common GRBL settings.
3. Full app-wide tooltips/help text for every visible control.
4. Complete Cut Settings Editor parity for GRBL diode work: Offset Fill, kerf,
   tabs/bridges, air assist, line/fill/image advanced settings, and clearer
   defaults.
5. Scanning offset calibration and image-quality diagnostics.
6. Focus Test.
7. Material Test / Interval Test / Material Library polish and hardware-proven
   presets.
8. Missing vector editing: node edit, offset, booleans, trim, close paths,
   delete duplicates, break apart, arrays.
9. Nesting and draw-order tools.
10. Camera alignment only after the core output/control path is stable.
11. Rotary / Print and Cut / Center Finder if they become product scope.
12. Galvo, bridge, file-list, feeder, split/repeat marking only if LaserForge
    expands beyond its current GRBL diode target.

## Current Verdict

LaserForge is not a full LightBurn replacement yet. It is closer to a focused
GRBL diode workflow with several LightBurn-inspired core features. The strongest
current areas are import, trace/bitmap foundations, layer output, preview,
preflight, GRBL connection, and safety gates. The weakest parity areas are
advanced vector editing, machine-management UI depth, camera/rotary/galvo
workflows, and full Cut Settings Editor breadth.
