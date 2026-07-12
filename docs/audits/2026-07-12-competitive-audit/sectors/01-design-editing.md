# S01 · Design & vector editing

Products rated: KerfDesk, LightBurn 2.1.03, MillMage 0.8.02, XCS (= xTool Studio desktop V1.7.x, per Phase-0 pin — XCS itself discontinued 2025), Easel (web SaaS), Carbide Create, VCarve 12.5.
N/R: LaserGRBL 7.14.1 — no design canvas at all; it is a G-code sender/raster importer and its own docs plus community norm route all design work to external tools (Inkscape).¹⁸
Pinned evidence: KerfDesk @ 96db8cc2 (worktree HEAD, 2026-07-12); competitor versions per `../data/phase0.json`. Inputs: `../data/S01-evidence.json` (KerfDesk), `../data/S01-market.json` (market).

Rating scale: anchored 0–10 per methodology §5.1. No S1 category is tagged **[fidelity]** or **[⚠HW]**, so the §5.3 cap and §5.4 star rules do not bind any cell here — but note that **no KerfDesk S1 cell has PERC or LIVE evidence either**; everything KerfDesk-side is CODE/TEST.

| # | Category | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel | Carbide Create | VCarve |
|---|----------|----------|-----------|----------|-----------|-----|-------|----------------|--------|
| 1.1 | Shape primitives | 4 [CODE]¹ | 9 [OFF]⁹ | 8 [OFF]¹⁷ | N/R¹⁸ | 7 [OFF]¹⁹ | 4 [OFF]²² | 4 [OFF]²⁹ | 9 [OFF]³⁷ |
| 1.2 | Pen & node editing | 3 [CODE]² | 9 [OFF]¹⁰ | 8 [OFF]¹⁷ | N/R¹⁸ | 8 [OFF]²⁰ | 5 [OFF]²³ | 6 [OFF]³⁰ | 8 [OFF]³⁸ |
| 1.3 | Boolean & modify ops | 6 [CODE]³ | 9 [OFF]¹¹ | 8 [OFF]¹⁷ | N/R¹⁸ | 7 [OFF]²¹ | 3 [OFF]²⁴ | 7 [OFF]³¹ | 9 [OFF]³⁷ |
| 1.4 | Text tools | 3 [CODE]⁴ | 10 [OFF]¹² | 8 [OFF]¹⁷ | N/R¹⁸ | 7 [OFF]¹⁹ | 5 [OFF]²⁵ | 5 [OFF]³² | 8 [OFF]³⁹ |
| 1.5 | Precision transforms | 6 [CODE]⁵ | 9 [OFF]¹³ | 8 [OFF]¹⁷ | N/R¹⁸ | 6 [OFF]¹⁹ | 6 [OFF]²⁶ | 5 [OFF]³³ | 9 [OFF]³⁷ |
| 1.6 | Align, distribute & measure | 7 [CODE]⁶ | 8 [OFF]¹⁴ | 8 [OFF]¹⁷ | N/R¹⁸ | 6 [OFF]¹⁹ | 7 [OFF]²⁷ | 5 [COMM]³⁴ | 7 [OFF]³⁷ |
| 1.7 | Snapping & guides | 4 [CODE]⁷ | 9 [OFF]¹⁵ | 8 [OFF]¹⁷ | N/R¹⁸ | 6 [OFF]¹⁹ | 6 [OFF]²⁸ | 5 [COMM]³⁵ | 7 [OFF]³⁷ |
| 1.8 | Duplication & arrays (design-time) | 4 [CODE]⁸ | 9 [OFF]¹⁶ | 8 [OFF]¹⁷ | N/R¹⁸ | 7 [OFF]¹⁹ | 4 [OFF]³⁶ᵃ | 5 [OFF]³⁶ᵇ | 9 [OFF]³⁷ |
| | **Sector mean** | **4.6** | **8.9** | **8.0** | — | **6.8** | **5.0** | **5.3** | **8.3** |

**Footnotes — KerfDesk (file:line at pinned commit):**
¹ `src/core/shapes/shape-from-drag.ts:12-27,39-58` (four kinds, `DEFAULT_POLYGON_SIDES=6`, `DEFAULT_STAR_POINTS=5`, `cornerRadiusMm:0`, `MIN_DRAW_SIZE_MM=0.5`, Shift/Ctrl modifiers); `src/ui/workspace/ToolStrip.tsx:17-27`; grep `cornerRadius|polygonSides|starPoints` in `src/ui` → test fixtures only (no shape-property editor; confirms `2026-07-10-full-sweep-audit.md:271-279` S2-F4); `src/ui/workspace/draw-tool.test.ts` green 2026-07-12.
² `src/ui/workspace/draw-pen-preview.ts:1-26` (pen = straight-segment polyline); `src/ui/state/ui-store.ts:72-76`; `src/ui/state/path-node-edit-actions.ts:27-35` (select/nudge/delete/drag only; grep `insertNode|addNode|smoothNode|breakPath` → no matches); `src/ui/workspace/path-node-hit-test.ts:76-80` (only imported-svg / traced-image / polyline editable).
³ `src/ui/state/vector-path-actions.ts:126-204` (weld/boolean/offset; failure → warning toast); `DECISIONS.md:6311-6337` (ADR-131 canonical Result); `src/ui/commands/AppMenuBar.tsx:156` (Tools menu lacks offset); `src/ui/layers/OffsetPathsRow.tsx:16-27` (panel-only); `src/ui/state/vector-path-actions.test.ts:182-215` green.
⁴ `src/core/text/font-registry.ts:25-53` (exactly four fonts, single Regular weight; ADR-012 bans system fonts); `src/ui/text/AddTextDialog.tsx:87-170,211`; grep `textOnPath|arcText|curvedText|bold|italic` in `src/core/text` → no matches (ADR-103 lists text-on-path as roadmap).
⁵ `src/ui/commands/NumericEditsBar.tsx:18,94-168,281-289` (9-point anchor grid, X/Y/W/H/R, AR lock, error toasts); `src/ui/commands/arrange-command-family.ts:51-89` (flips); grep `-i skew` in `src` → import/camera code only; `src/ui/workspace/drag-state.ts:331-365` (Shift 45° constrain).
⁶ `src/core/scene/selection-align.ts:5-12` (7 align kinds); `src/core/scene/selection-distribute.ts:5-9` (4 distribute kinds); `src/ui/state/selection-transform-actions.ts:28-61` (incl. align/fit to registration board, ADR-124/125); `src/ui/help/help-topics.ts:85-88` (Measure: distance/delta/angle, Shift snap).
⁷ `src/ui/workspace/snapping.ts:12-28,42-48` (defaults 2 mm/10 mm); `src/ui/workspace/drag-snap.ts:35-48` (non-move drags return `guides:[]`; Ctrl bypass); `src/ui/workspace/overlays.tsx:39-54` (unlabeled `#` toggle is the only snap UI); `src/ui/workspace/draw-scene.ts:226-241` (hard-coded 10 mm grid; no user guides/rulers). Audit S2-F10 unchanged.
⁸ `src/ui/state/scene-mutations.ts:213-238` (duplicate in place — S2-F3 stagger removed, test-asserted `src/ui/state/duplicate.test.ts:10-27`); `src/core/scene/tile-into-region.ts:10-29` (grid/fill array, caps 100/axis, 500 total); `src/ui/laser/board-capture/BoardArrayForm.tsx:1-32` (array UI lives in board-capture panel only, ADR-125 A2); grep `circular` in `src/ui` → no circular array.

**Footnotes — competitors (URLs from S01-market.json):**
⁹ https://docs.lightburnsoftware.com/latest/Reference/PrimaryShapes/
¹⁰ https://docs.lightburnsoftware.com/latest/Reference/EditNodes/ ; https://forum.lightburnsoftware.com/t/modifying-paths-with-the-edit-node-tool/123750 ; https://craftgineer.com/blog/inkscape-vs-illustrator-laser-cnc
¹¹ https://docs.lightburnsoftware.com/latest/Reference/BooleanTools/ ; https://docs.lightburnsoftware.com/latest/Reference/OffsetShapes/
¹² https://docs.lightburnsoftware.com/latest/Reference/Text/
¹³ https://docs.lightburnsoftware.com/latest/Reference/NumericEditsToolbar/ ; https://docs.lightburnsoftware.com/latest/Reference/TwoPointRotateScale/
¹⁴ https://docs.lightburnsoftware.com/latest/Reference/Align/ ; https://docs.lightburnsoftware.com/latest/Reference/Distribute/
¹⁵ https://docs.lightburnsoftware.com/latest/Reference/Snapping/ ; https://docs.lightburnsoftware.com/latest/Reference/AutomaticGuidelines/
¹⁶ https://docs.lightburnsoftware.com/latest/Reference/GridArray/ ; …/CircularArray/ ; …/CopyAlongPath/
¹⁷ https://docs.millmagesoftware.com/latest/ — nav lists Reference/PrimaryShapes, DrawLines, TangentCircleGenerator, EditNodes, ConvertToPath, TrimShapes, BooleanTools, CutShapes, OffsetShapes, Text, VariableText, ApplyPathToText, NumericEditsToolbar, TransformControls, TwoPointRotateScale, FlipMirror, Align, Distribute, Snapping, AutomaticGuidelines, GridArray, CircularArray. Depth unverified (nav existence only).
¹⁸ https://lasergrbl.com/usage/ (no design tooling anywhere in official usage docs); https://medium.com/@urban.pistek/a-complete-workflow-for-laser-cutting-using-inkscape-lasergrbl-open-source-free-6f014803fce4 (community norm: design in Inkscape).
¹⁹ https://support.xtool.com/article/2442 (xTool Studio overview: primitives + corner radius, text, numeric transforms, align/distribute, snapping/grid, arrays).
²⁰ https://support.xtool.com/article/2442 ; https://support.xtool.com/article/1305 (four node types, per-node coordinates, simplify, split).
²¹ https://support.xtool.com/article/2442 ; https://support.xtool.com/article/3376 (Unite/Subtract + at-overlap variants, live preview, offset-at-distance).
²² https://support.easel.com/hc/en-us/articles/360012847633 ; https://support.easel.com/hc/en-us/sections/40879645194003
²³ https://support.easel.com/hc/en-us/articles/5860985338131-Edit-Points ; https://inventables.zendesk.com/hc/en-us/articles/360012593333-Walkthrough-Tutorial-Pen-Tool
²⁴ https://support.easel.com/hc/en-us/articles/360012724974-Aligning-and-combining-shapes (Combine only)
²⁵ https://support.easel.com/hc/en-us/articles/4415815546003-How-to-Curve-Text ; https://forum.easel.com/t/curving-multi-word-text-has-to-be-a-better-way/117118 ; https://discuss.inventables.com/t/curve-text-app-issues/72594
²⁶ https://support.easel.com/hc/en-us/articles/360012725054-Shape-position-and-size
²⁷ https://support.easel.com/hc/en-us/articles/45810283261587-Alignment-Tools ; article 360012724974
²⁸ https://easel.com/features/snap-alignment ; https://forum.easel.com/t/snap-alignment/163188 ; https://forum.easel.com/t/snapping-to-grid/88553
²⁹ https://carbide3d.com/hub/courses/create/shapes/ (existence only; breadth/re-edit unverified — conservative floor)
³⁰ https://carbide3d.com/blog/carbide-create-node-editing/ ; https://community.carbide3d.com/t/how-to-draw-curved-lines/86105
³¹ https://carbide3d.com/hub/courses/create/boolean/ ; https://carbide3d.com/hub/courses/create/Offsets/
³² https://my.carbide3d.com/pdf/carbide-create-v5.pdf ; https://community.carbide3d.com/t/can-carbide-create-curve-words/102018 ; …/t/how-can-i-put-text-on-arc-or-circle-in-carbide-create/32808
³³ https://carbide3d.com/hub/courses/create/object-manipulation/ ; https://my.carbide3d.com/pdf/carbide-create-v5.pdf (richness unverified)
³⁴ https://community.carbide3d.com/t/align-space-tool-in-cc-764/71019 ; https://www.circuitist.com/carbide-create-tutorial/ (COMM only)
³⁵ https://community.carbide3d.com/t/carbide-create-snap-to-grid/17017 ; …/t/snap-to-grid-bypass/13150 (COMM only)
³⁶ᵃ https://github.com/inventables/easel-replicator ; https://forum.easel.com/t/new-replicator-app/13052 ; …/t/rectangular-arrays/105558  ³⁶ᵇ https://carbide3d.com/hub/courses/create/arrays/ (breadth unverified)
³⁷ https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/page/user-guide/index.html (form dialogs: shapes incl. arc/freehand; Weld/Subtract/Overlap/Join/Offset/Extend/Fillets; Move/Rotate/Mirror/Set Size/Distort/Transform Mode; Alignment Tools; Snapping Options; Array Copy/Circular Copy/Copy Along Vectors)
³⁸ footnote ³⁷ plus https://forum.vectric.com/viewtopic.php?t=10136 ; https://forum.onefinitycnc.com/t/vcarve-and-designing-with-cad/6838
³⁹ footnote ³⁷ plus https://www.vectric.com/products/vcarve/

### State of play

Design & vector editing is KerfDesk's weakest surface in this sector's roster, and the numbers say so plainly: a 4.6 sector mean against 8.9 for LightBurn, 8.3 for VCarve, and 8.0 for MillMage (which reuses LightBurn's editor family). KerfDesk clears the "token" bar comfortably — the boolean/offset suite (1.3) and the numeric transform bar (1.5) are genuinely daily-drivable, and the align/distribute/measure set (1.6) is the one category where KerfDesk sits within a point of the leader — but four of eight categories rate 3–4, which the anchored scale defines as "real users hit walls immediately."

The walls are specific and code-confirmed. Shapes (1.1) are drag-drawn parametric objects whose parameters can never be edited again: polygon sides are frozen at 6, star points at 5, corner radius hard-coded to 0, with no shape-property editor anywhere in `src/ui` — while LightBurn's Shape Properties panel re-edits sides, points, radius and bulge after creation and through resize. The pen (1.2) draws straight segments only; there is no bezier drawing anywhere in the tree, and the node editor supports exactly select/drag/nudge/delete — no insert-node, no smooth/corner toggle, no curve conversion, no break/join — against LightBurn's full Edit Nodes suite, xTool Studio's four node types with per-node coordinate entry, and VCarve's node mode with arc/bezier refit. Text (1.4) is the single largest gap in the sector: four bundled fonts in one weight each (ADR-012 deliberately bans system fonts), a modal dialog rather than on-canvas editing, and no bold/italic, no text-on-path (ADR-103 roadmap), no variable text — against a LightBurn text engine with a Font Manager, auto-weld, Bend Text and Variable Text that earns the roster's only 10.

Where KerfDesk has invested, it shows. The clipper2-backed modify suite covers weld/subtract/intersect/exclude, convert-to-path, break apart, and two-direction design-time offset; the 2026-07-10 audit's silent-failure finding is fixed (ADR-131 canonical Result, failures surface as toasts, test-asserted). The align/distribute set (7 align kinds, 4 distribute kinds) plus a dedicated measure tool and the board-align/fit extras is competitive on paper with everything except LightBurn's reference implementation — this is the only category where the deltas are within noise (±1). Duplicate-in-place also now matches LightBurn parity by explicit code comment and test.

Snapping and arrays are half-built. Snap exists only for move drags — drawing, scaling, pen and node drags get no snap at all — the 2 mm snap distance and 10 mm grid have no settings UI and don't persist, the only toggle is an unlabeled `#` button, and there are no user-placed guides or rulers; LightBurn documents both Snapping and Automatic Guidelines, and even Easel ships material-edge snap guides. Arrays exist only as the ADR-125 board-capture step-and-repeat — there is no board-independent grid array, no circular array, no offset-duplicate, no copy-along-path, against a documented full trio (grid/circular/along-path) in both LightBurn and VCarve.

Roster context: MillMage's 8s are all nav-existence evidence — the docs list the same LightBurn-family pages, but depth was not independently verified, so its column should be read as "family parity, unproven." Carbide Create's mid-5s carry the weakest evidence in the table (two cells COMM-only, three conservative floors on course-lesson existence). xTool Studio is a real mid-pack design surface (notably strong node editing), which matters because it is free with the hardware it drives. LaserGRBL is N/R here by its own positioning. Nothing KerfDesk-side was perceptually verified — every KerfDesk cell is CODE/TEST, structure not fidelity, per the explicit list below.

### Where we win / where we lose

- WIN 1.3 (+3 vs Easel) — KerfDesk ships a full weld/subtract/intersect/exclude + two-way offset suite where Easel documents only a union-style Combine. [candidate — pending §5.5 refuter]
- WIN 1.6 (+2 vs Carbide Create) — seven align and four distribute kinds plus a dedicated measure tool, vs CC's align tool with distribute only community-evidenced from build 764. [candidate — pending §5.5 refuter; CC cell is COMM]
- LOSE 1.1 (−5 vs LightBurn) — no parametric re-edit after creation; polygon sides / star points / corner radius are frozen at hard-coded defaults. → G-S01-1
- LOSE 1.2 (−6 vs LightBurn) — straight-segment pen only, no bezier drawing, node editor lacks insert/smooth/convert/break-join. → G-S01-2
- LOSE 1.3 (−3 vs LightBurn, VCarve) — no trim/fillet/auto-join; offset hidden in a selection-gated panel row, absent from the Tools menu. → G-S01-3
- LOSE 1.4 (−7 vs LightBurn) — four fonts / one weight, modal-only editing, no bold/italic, no text-on-path, no variable text; largest single gap in the sector. → G-S01-4
- LOSE 1.5 (−3 vs LightBurn, VCarve) — no two-point rotate/scale, no skew, no fillet; rotated selections block unlocked resize. → G-S01-5
- LOSE 1.7 (−5 vs LightBurn) — snapping on move drags only, no user guides/rulers, no snap-settings UI, fixed 10 mm grid. → G-S01-6
- LOSE 1.8 (−5 vs LightBurn, VCarve) — no design-time grid/circular array or copy-along-path; the only array tool is gated behind board capture. → G-S01-7

(1.6's −1 vs LightBurn is within the ±1 noise band and is not claimed either way.)

### Gaps feeding the register

- G-S01-1 · 1.1 Shape primitives · vs LightBurn · Δ−5 · P1 · ADR-recorded: partially (ADR-051 P2 deferral covers corner radius; frozen sides/points un-ADR'd) · Effort M — add a shape-properties editor for parametric re-edit.
- G-S01-2 · 1.2 Pen & node editing · vs LightBurn · Δ−6 · P1 · ADR-recorded: no (S2-F5 grep found none) → severity bump per §5.6 · Effort L — bezier pen + node insert/smooth/convert/break-join.
- G-S01-3 · 1.3 Boolean & modify · vs LightBurn/VCarve · Δ−3 · P2 · ADR-recorded: no (offset placement is un-ADR'd, S2-F8) · Effort S — surface offset in Tools menu; consider trim/fillet later.
- G-S01-4 · 1.4 Text tools · vs LightBurn · Δ−7 · P1 · ADR-recorded: partially (ADR-012 font ban is deliberate; text-on-path is ADR-103 roadmap; no bold/italic un-ADR'd) · Effort L — font breadth strategy + text-on-path.
- G-S01-5 · 1.5 Precision transforms · vs LightBurn/VCarve · Δ−3 · P2 · ADR-recorded: no · Effort M — two-point rotate/scale; unblock rotated resize.
- G-S01-6 · 1.7 Snapping & guides · vs LightBurn · Δ−5 · P1 · ADR-recorded: no (S2-F10) → severity bump · Effort M — snap in all drag modes, settings UI + persistence, user guides.
- G-S01-7 · 1.8 Duplication & arrays · vs LightBurn/VCarve · Δ−5 · P1 · ADR-recorded: partially (ADR-125 deliberately scoped array to the board; absence of design-time/circular array un-ADR'd) · Effort M — board-independent grid + circular array.

### Not verified

- **No PERC/LIVE evidence for any KerfDesk S1 cell.** All KerfDesk ratings rest on traced code and green structural tests; nothing in this sector was rendered and compared (S1 has no [fidelity]-tagged categories, but the same caveat applies: green tests prove structure, not appearance).
- Geometric correctness of boolean/offset results (holes, shared edges, near-tangent cases) — never rendered.
- Glyph rendering, kerning quality, and an actual rendered glyph-weld case — weld-on-text verified only at type-eligibility level.
- Align/measure behavior on rotated objects (AABB-based bounds) — flagged statically untestable in the prior audit; not exercised.
- Rotated-selection W/H resize block vs LightBurn's actual behavior — no hands-on comparison.
- Snap-settings non-persistence — inferred from absent persist wiring, not exercised in a live session.
- Board-capture array flow reachability without hardware — not live-run.
- On-screen geometry of drawn stars/polygons/pen previews; node-drag feel; guide-line rendering; array placement — not visually verified.
- Competitor side: **zero HANDS evidence anywhere in S1** — all cells are OFF/COMM. Specifically weak: Carbide Create 1.1/1.5/1.8 (existence-only, conservative floors), CC 1.6/1.7 (COMM-only), all MillMage cells (docs-nav existence, depth unproven), LightBurn measure tooling (unverified this pass), XCS draggable ruler guides (unevidenced).
- U cells: none. Starred (⚠HW) cells: none.
