# Rolling audit v7 — L7 Design file round trips

- **When:** 2026-10-28, evening +0800   **Tree:** origin/main @ `47ff19d8d` (fetched at the start).
  - **Repros ran on main's tree, not the worktree.** They ran in the scratchpad copy `…\scratchpad\j7-main\`, whose source is main `6e388bb56`. `git diff --stat 6e388bb56 47ff19d8d` touches no file in `src/io`, `src/core/scene`, `src/core/job` (other than the new `core/gcode/stopped-head-power.ts`, not on any path used here), `src/ui/state` design actions, `src/ui/workspace` or `src/ui/text`. The 37 source files cited below hash-match between `origin/main` and `j7-main`; 36 also match the worktree (only `deserialize-project.ts` differs there, and no line of it is cited).
  - Command, one file at a time, from `j7-main`: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> --config zz-l7-vitest.config.ts --silent=false --disableConsoleIntercept`. The config only adds the `fflate` alias and one worker.
- **Scope:**
  - **Export:** File → Export selected artwork / artwork as SVG, DXF, PDF, AI, EPS, GeoJSON (`file-command-family.ts:74-118`): `export-artwork-svg.ts`, `export-artwork-dxf.ts`, `io/svg/export-scene-svg.ts`, `export-svg-vector.ts`, `io/dxf/export-dxf.ts`, `dxf-writer.ts`, `io/vector-formats/vector-artwork.ts` (PDF/EPS/GeoJSON, read), `core/vector-export/*`. Print artwork also uses `exportSceneSvg` (`print-artwork.ts:63`).
  - **Re-import:** `parseSvg` → fragment entries (`svg-import-entries.ts`) → `applySvgFragmentImport` (the store's `importSvgFragment`, also used by remote `import` in `remote-control/design-imports.ts:62`); `parseDxf` → `applyFreshImport`.
  - **`.lf2`:** `serializeProject`, `prepareProjectForPersistence` (with its semantic-drift check), `deserializeProject`.
  - **Copy/paste:** `scene-clipboard-actions.ts` (Copy, Cut, Paste, Paste in Place), `scene-object-copy-dependencies.ts`, `clone-selection-groups.ts`, Duplicate (`scene-mutations.ts:146`), Saved Artwork insert (`personal-artwork-model.ts:113`, read).
  - **Governing ADRs:** ADR-350 D5, ADR-358 D1/D3, ADR-431, ADR-452, ADR-468 D1, ADR-574, ADR-410 D4, ADR-494 item 4 and Amd 1, ADR-620, ADR-286.
- **Lenses run:** L3 twins (canvas paint, exported file, re-imported burn, compiled G-code, `.lf2`), L2 ground truth (analytic areas, LightBurn 1.7 Fill Mode and Clipboard docs, SVG 2 painting order, Autodesk DXF reference via ADR-431), L4 adversarial (nested and overlapping fills, script-font overlaps, cross-project paste with a different bed, colour-keyed versus bound artwork, nested groups). An L7 test-truth note is in each finding.
  - **Not run:** opening the files in LightBurn, Inkscape or AutoCAD (no app here); a real browser clipboard.
- **Counts:** 6 raised → 0 refuted → P1 2 / P2 1 / P3 3 (+ 1 KNOWN re-observed, fixed). Refuter: 6 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED; no severity change.
- **Refuter (2026-10-28, fresh context).** `origin/main` @ `548f67ecb`: `git diff --stat 6e388bb56 origin/main` over every cited file (`src/io/svg`, `src/io/dxf`, `src/io/vector-formats`, `src/io/lightburn`, `scene-clipboard-actions.ts`, `laser-tab-anchors.ts`, `cnc-tab-anchors.ts`, `layer-fill.ts`, `fill-rule.ts`, `personal-artwork-model.ts`, `object-display.ts`, `import-toasts.ts`, `export-artwork-svg.ts`, `export-artwork-dxf.ts`) is empty. The refuter's own repros ran on `j7-main` with the same command and their own `zz-l7r-vitest.config.ts`, through the real File → Export commands (`handleExportArtworkSvg` / `handleExportArtworkDxf` with a capturing save target), the real import dispatch (`dispatchImportFilesInOrder` into the store's `importSvgFragment` after `newProject()`), the real `.lbrn` importer, and the store's `copySelection` / `pasteClipboardInPlace` / `capturePersonalArtwork` + `insertPersonalArtwork`. No open PR touches a cited file (`gh pr list`: #1502, #1478 only); no earlier audit raises these.

## Headline

**The geometry of a round trip is exact.** Six mixed objects (a rotated rounded rectangle, a mirrored and stretched ellipse, a star, a bulged hexagon, a sheared path with a cubic and an elliptical arc, and Roboto text) go out as SVG or DXF and come back through KerfDesk's own importers the same size (95.1172 × 101.7082 mm before, 95.1172 × 101.7080 SVG and 95.117 × 101.708 DXF after), in the same place when the artwork sits on the bed centre, with the same 15 contours (14 closed, 1 open). The burned paths differ by 0.035 mm at most, which is compile flattening. `.lf2` save and load keeps every scene field, nested groups and the design-tree order, and the G-code is byte-identical (604 lines). Paste remaps masks and text-on-path guides, and Paste in Place into another project keeps scene positions.

**What is wrong is around the geometry:**

- **L7-P1-1. Separate shapes on one Fill operation lose their holes through SVG.** The burn treats them as LightBurn does: a shape inside another on the same layer is a hole. A 40 × 30 plate with a separately drawn Ø16 circle burns a ring (999.7 mm²; analytic 998.9). A 60 × 20 plate with "KERF" on the same operation burns the letters as unburned knock-outs (1116.3 mm²). The exported SVG paints each object as its own filled `<path>`, and KerfDesk's SVG import merges them into one object and fills the union. After the round trip, both burn 1200 mm²: the hole is filled and the text is gone, with no message. The design canvas already paints these as one solid plate (two separate ink fills), so it never showed the hole either. The DXF round trip keeps both burns (999.8 and 1116.3) only when the shapes share one path colour, as in a LightBurn import. *Refuter correction:* in the everyday route (draw a plate and a circle, Assign the circle to the plate's operation, set Fill) the two paths have different colours (L7-P2-1), so SVG **and** DXF both re-import onto two Fill operations: the plate burns solid and the circle a second time (1400.3 / 1400.2 mm² against 999.7).
- **L7-P1-2. Paste into another project drops hand-placed tabs.** It happens when the artwork's path colour equals its operation colour, as for every LightBurn `.lbrn` import. The paste rewrites each tab anchor to the new operation's colour, but tabs are matched by path colour (ADR-494 item 4). One placed tab (gap X185–187 on the top edge) becomes four automatic tabs on all four edges, with no warning. Same-project paste keeps it.
- **L7-P2-1. Exported colours are not the operations' colours.** Every export writes each path's stored colour, not the colour of the operation it burns on. Three shapes drawn on three operations (blue, red and green in the operations list) export as `#000000`, `#2563eb`, `#2563eb`, so re-import merges two of them into one operation. **Assign selection to operation** never changes the exported colour.

## Round-trip table

| Object | Path | Before | After | Verdict |
|---|---|---|---|---|
| Rounded rect r 4 at 30°, ellipse ×1.5 mirrored, star, bulged hexagon, cubic + elliptical-arc path (17°, 1.3 × 0.8), Roboto "Hg&8" 12 mm; Line | SVG → `parseSvg` → fragment import | 95.1172 × 101.7082 mm at (152.4414, 149.1459); 15 contours, 14 closed | 95.1172 × 101.7080 at (152.4414, 149.1456); 15, 14 closed; Hausdorff 0.0348 mm | exact (flattening noise) |
| Same | DXF → `parseDxf` → import | as above | 95.117 × 101.708 at (152.4415, 149.1458); 15, 14 closed; Hausdorff 0.0345 mm | exact |
| Plate 40 × 30 + separate Ø16 circle, one Fill operation | SVG | burns 999.7 mm² (ring) | 1 object, 1200 mm² (solid) | **P1 (L7-P1-1)** |
| Same | DXF, then the operator sets Fill | 999.7 mm² | 999.8 mm² | kept (same path colour only) |
| Same, drawn and Assigned to one Fill operation (paths `#000000` and `#2563eb`) — refuter | SVG; DXF then Fill | 999.7 mm² | 1 object on 2 Fill operations, 1400.3 (SVG) / 1400.2 (DXF) mm² | **P1 (L7-P1-1)**, via L7-P2-1 |
| Plate 60 × 20 + Roboto "KERF" 12 mm, one Fill operation | SVG | 1116.3 mm² (text 83.7 knocked out) | 1200 mm² | **P1 (L7-P1-1)** |
| Same | DXF, then Fill | 1116.3 mm² | 1116.3 mm² | kept |
| Pacifico "Hello" 20 mm, Weld off, Fill | SVG | 400.04 mm² | 400.02 mm² | exact |
| Same on a Line operation | SVG, then Fill | 400.04 mm² (as Fill) | 391.72 mm² (`fillRule` unset → even-odd) | P3 (L7-P3-1) |
| Same | DXF, then Fill | 400.04 mm² | 391.98 mm² | P3 (L7-P3-1) |
| Three drawn shapes on three operations (`#2563eb`, `#dc2626`, `#16a34a`) | SVG and DXF colours | 3 operations | file `#000000`, `#2563eb`, `#2563eb`; re-import 2 operations | **P2 (L7-P2-1)** |
| Shape 3 assigned to shape 1's operation | SVG and DXF colours | 2 operations | file still `#2563eb` (now shape 2's colour, not shape 1's) | **P2 (L7-P2-1)** |
| Six objects of the first row | SVG | 6 objects | 1 object, 0 groups | P3 (L7-P3-3) |
| Masked photo, mask, path guide, text on path, tabbed part, two nested groups, design-tree order, locked/named mask, per-object override with `byOperation`, power scale, output-off operation | `.lf2` (`prepareProjectForPersistence` → `deserializeProject`) | — | every `scene` key identical; G-code byte-identical (604 lines) | exact |
| Masked photo (copy photo only) | Paste, same project | burns 1070 cells | copy gets the pasted mask; 1070 and 1070 | exact |
| Text on path (copy text only) | Paste, same project | — | guide pasted with it; `guideObjectId` remapped and present | exact |
| Masked photo + tabbed part | Paste in Place into another project (300 × 300 bed) | photo at (100, 100), part at (150, 250) | same scene positions; mask remapped; photo 1070 cells | exact |
| Hand-tabbed 40 × 20 part, path colour = operation colour | Paste in Place, another project | 1 placed tab, gap X185–187 on the top edge | 0 placed; automatic gaps X174–176 (bottom), Y144–146 (right), X164–166 (top), Y134–136 (left) | **P1 (L7-P1-2)** |
| Same, path colour ≠ operation colour (a drawn shape) | Paste in Place, another project | 1 placed | 1 placed, same gap | kept |
| Same, either colour | Paste in Place, same project | 1 placed | 1 placed, same gap | kept |

## Findings

### L7-P1-1 — Separate shapes on one Fill operation burn as LightBurn does (an inner shape is a hole), but the canvas, the exported SVG/PDF/EPS and KerfDesk's own SVG re-import treat them as a union: after an SVG round trip, a plate's hole is filled and knocked-out text disappears

- **Where:**
  - **Burn:** `src/core/job/fill-rule.ts:5-13` returns `'evenodd'` for the pooled layer: "The pooled layer must remain even-odd so one text object cannot alter unrelated SVG/shape donut topology". Each object is first resolved by itself (`layer-fill.ts:230-233`), then its batches are joined non-zero (`layer-fill.ts:248`), and the layer's objects are hatched together even-odd.
  - **Export:** `src/io/svg/export-svg-vector.ts:65-67,233-252` writes each object path as its own `<path … fill-rule="evenodd">` (non-zero for text) inside the object's own `<g>` (`export-scene-svg.ts:148-157`). `vector-artwork.ts:5-7,347` does the same for PDF, EPS and GeoJSON: "Items stay separate so two overlapping objects of the same colour never cancel under one even-odd fill".
  - **Re-import:** `src/io/svg/svg-import-entries.ts:34-45` appends every consecutive same-mode element to one entry ("consecutive vector elements of the same operation mode share one entry"). That entry is one object, so `layer-fill.ts:248` unions its paths non-zero.
  - **Canvas:** `object-display.ts:210-217` and `draw-vector-strokes.ts:28-44` fill each object path separately, in the same ink.
- **Anchor:**
  - **Ground truth (LightBurn 1.7, Fill Mode,** https://docs.lightburnsoftware.com/1.7/Reference/CutSettingsEditor/FillMode/ **, versioned path, fetched 2026-10-28):** "If you have two shapes set to the same layer, and one is inside of the other, … the area between the two outlines will be filled." ADR-286 (Context) records that "LightBurn's raw same-layer fill does behave even-odd". The burn matches this.
  - **Twin:** the burn of the design, the exported file, the burn after KerfDesk re-imports that file, and the canvas should agree (AREAS.md L3 lens).
    - The exported SVG paints in document order (SVG 2 CR 2018-10-04 §3.4.1, https://www.w3.org/TR/2018/CR-SVG2-20181004/render.html: "Elements in a stacking context must be stacked according to document order."). So the circle is painted over the plate and the file shows a solid plate.
    - ADR-468 D1 chose this for PDF/EPS on purpose ("Items are never merged, so two overlapping objects of one colour do not cancel under one even-odd fill"). That contradicts the compiler's pooled even-odd. No ADR reconciles the two.
- **Scenario:**
  1. Two separate shapes share one Fill operation. Typical routes: a LightBurn `.lbrn` sign opened in KerfDesk (every shape on a LightBurn layer is one operation, `lbrn-import.ts:88-93`), **Assign selection to operation**, or artwork from older colour-keyed projects. Example: a 40 × 30 plate and a Ø16 circle drawn inside it, or a plate with text for the LightBurn "knock-out" sign.
  2. KerfDesk burns a ring (or the plate with the letters unburned), as LightBurn does.
  3. **File → Export artwork as SVG**, then import that SVG (into this or another project).
  4. The re-imported artwork is one object, and it burns a solid plate. The hole and the text are gone from the output. No import note, toast, preflight issue or Job Review line mentions it.
  - The design canvas paints the original as a solid plate too (two ink fills, one on top of the other), so the operator never saw the hole on the canvas. Print artwork (`print-artwork.ts:63`) prints the same union.
- **Evidence:** REPRO.
  - **`zz-l7-roundtrip.test.ts`, "fill layer: separate inner shape and text over a plate"**, real `compileJob` hatch length × 0.1 mm spacing:
    - Ring: `{"areaBefore":999.724,"areaAfter":1200,"analyticRing":998.9381,"objectsAfter":1,"layersAfter":["#2563eb:fill"],"fillRules":["evenodd","evenodd"]}`.
    - Knock-out: `{"areaBefore":1116.3031,"areaAfter":1200,"plateArea":1200,"textArea":83.6969,"objectsAfter":1}`.
    - DXF control (operator switches the re-imported operation to Fill): `{"ringAreaFill":999.8063,"knockAreaFill":1116.3259}`.
    - The exported SVG: `<g id="artwork-0"><title>rect</title><path d="M0 0h40v30h-40z" … fill="#000000" fill-rule="evenodd" stroke="none"/></g><g id="artwork-1"><title>ellipse</title><path d="M16 8c…z" … fill="#000000" fill-rule="evenodd" stroke="none"/></g>`.
  - **`zz-l7-canvas.test.ts`:** `drawScene` with a recording context, plate + circle bound to one Fill operation: `["fill(evenodd) style=#1a1a1a subpaths=1","fill(evenodd) style=#1a1a1a subpaths=1"]`. That is two separate solid fills in the same ink, not one even-odd fill.
- **Severity:** P1. A round trip silently drops a hole and the knocked-out text, so the burn is wrong with no warning (AREAS.md severity). The canvas does not warn either: it shows the union before and after.
  - A refuter may argue that the canvas and the SVG show what the user expects and that the compiler is the odd one out. That is still a P1 twin: either way the burn differs from what one of its twins shows. The LightBurn reference and ADR-286 say the burn is the intended meaning. The coordinator may want to split the canvas half off to L8.
- **Test truth:** `svg-fill-import.integration.test.ts` and `export-scene-svg-precision.test.ts` round-trip a single object only. No test exports two objects on one Fill operation and compares the burn after re-import.
- **Refuter: CONFIRMED, P1 kept.**
  - **What would make it false, and what was found.**
    - *A deliberate decision that the burn is a union:* no. The burn's cross-object even-odd is decided, not accidental: ADR-486 Amendment 2 ("Fill material and ownership"): paths "are unioned within one object, then material is combined with even-odd parity across objects"; ADR-286 item 2 keeps cross-object knockout as "a usable design technique"; ADR-410 Amendment 3 Context (merged today, #1501): "Fill uses one fill rule for the whole layer, so a separate inner shape is a hole there too." ADR-468 item 1 ("Items are never merged, so two overlapping objects of one colour do not cancel under one even-odd fill") decides how PDF/EPS paint, predates ADR-486 Amd 2 (2026-09-26 against 2026-10-07) and states the opposite of the burn; no ADR accepts that a round trip changes the burn.
    - *A warning:* none. The import toast reads "Imported rt.svg — 1 object, 2 colors" for a one-colour file (it counts paths, `import-toasts.ts:28`) and says nothing of the merge; there is no import note, preflight or Job Review line.
    - *Unreachable:* no. `.lbrn` open (path colour = layer colour, `lbrn-import.ts:88-93`) and draw + Assign selection + Fill both reach it; remote `import` shares `importSvgFragment`.
    - *A misread of SVG 2 or LightBurn:* no. SVG 2 CR 2018-10-04 §3.4.1, fetched: "Elements in a stacking context must be stacked according to document order." §3.3: each painting operation is "possibly obscuring paint that has previously been layed down"; `fill-rule` acts inside one element, so the exported file paints a solid plate. LightBurn 1.7 Fill Mode (versioned URL above, fetched 2026-10-28), verbatim: "If you have two shapes set to the same layer, and one is inside of the other, the area between the two outlines will be filled."
  - **Repro** (`zz-l7r-fill.test.ts`, real export commands and import dispatch, `compileJob` hatch length × spacing):
    - `.lbrn` plate 40 × 30 + Ø16 circle on one Scan layer (`#000000`): before `999.7` (analytic 998.9); SVG → `1 object, ops ["#2563eb:fill"], 1200`; DXF, then Fill → `999.8`.
    - Plate 60 × 20 + Roboto "KERF" 12 mm on one Fill operation (path = operation colour): before `1116.3` (text alone 83.7); SVG → `1200`; DXF, then Fill → `1116.3`.
    - Drawn plate + circle, circle Assigned to the plate's operation, Fill (paths `#000000`, `#2563eb`): before `999.7`; SVG → `1 object, ops ["#2563eb:fill","#dc2626:fill"], 1400.3`; DXF, then Fill → `1400.2`. Here DXF loses the hole too, and the circle burns twice.
  - **Which side breaks it.** Both, by route.
    - With one path colour, the **import** changes the burn. KerfDesk's SVG importer reads the file as SVG paints it: consecutive fill elements become paths of one object (`svg-import-entries.ts:38`), and paths of one object are unioned non-zero (`layer-fill.ts:248`, ADR-486 Amd 2). The DXF exporter buckets by colour (`export-dxf.ts:42-50`), so DXF re-imports both contours as one even-odd path and keeps the ring. LightBurn, which imports each element as its own shape on the colour's layer, would also keep it.
    - With different path colours, the **export** has already split one operation into two colours (L7-P2-1), so neither format can carry the hole.
    - Read strictly against SVG 2, the exported SVG already describes a solid plate. The file disagrees with the burn before any importer runs.
  - **Canvas.** Read and confirmed. The workspace paints each path of each object with its own `fill()` (`object-display.ts:149-160`, `draw-vector-strokes.ts:28-44`), in ink (ADR-620 item 1). It shows a solid plate before the round trip, where the burn is a ring, and after it, where the burn is solid. Under §3 that is not a warning: it tells the operator nothing about the change. The canvas-against-burn mismatch on the original design is a separate, unraised twin. It is a candidate for L8 and is not counted here.
  - **Severity.** The output after the round trip differs from the output before it (a hole filled, letters burned, or the circle burned twice), with no warning. P1 under AREAS ("silently drops or merges shapes or holes").
- **Fix direction:** decide one meaning, then make the twins follow it. If it is LightBurn's (the burn today):
  - export each Fill operation's objects as one compound path with `fill-rule="evenodd"`, or as the resolved region, in SVG, PDF, EPS and Print artwork (this amends ADR-468 D1);
  - paint the canvas per operation the same way.
  - Otherwise, the re-import should keep KerfDesk's own objects apart (the `data-kerfdesk-artwork-origin` root marks its files).

### L7-P1-2 — Paste into another project (and Saved Artwork insert) rewrites hand-placed tab anchors to the new operation's colour, but anchors count only while they match their path's colour; when the two colours were equal (every LightBurn import), the pasted part is cut with automatic tabs elsewhere

- **Where:**
  - `src/ui/state/scene-clipboard-actions.ts:380-405` (`remapClipboardTabAnchors`). The map is built from **operation** colours, `colorMap.set(source.color.toLowerCase(), target.color)` (`:393`), and each `laserTabAnchors` and `cncTabAnchors` `layerColor` found in it is replaced (`:395-404`).
  - Anchors are matched against the **path** colour:
    - `laser-tab-anchors.ts:121`: `if (anchor.layerColor !== pathColor) return [];` ("An anchor counts only while its colour is its path's").
    - `laser-tab-anchors.ts:101`: the placed count.
    - `cnc-tab-anchors.ts:70,85`.
    - The tab tool places them with the path colour (`LineTabFields.tsx:218-221`).
  - The paste leaves `path.color` unchanged.
  - Same-project paste reuses the operation (`:221-229`), so its map is the identity. Saved Artwork insert calls the same function with `reuseExistingOperations = false` (`personal-artwork-model.ts:113-121`).
- **Anchor:**
  - **Contract: ADR-494 item 4:** "`SceneObject.laserTabAnchors` holds tabs placed on the artwork, with the CNC anchor's shape: `layerColor` (the path colour), …". It also says "Move, rotate, scale, copy and paste, … carry them as they carry `cncTabAnchors`."
  - **Contract: ADR-494 Amendment 1, Context:** any command that changes "which object carries it must keep each tab at the same physical place, or deliberately handle it".
- **Scenario:**
  1. Open a LightBurn `.lbrn` part. Its operation colour is the LightBurn layer colour, and so is the path colour (`lbrn-layers.ts:99`, `lbrn-import.ts:88-93`). Older colour-keyed artwork behaves the same.
  2. Place one tab by hand with Cut Settings → Tabs → Place tabs, at a spot chosen for finishing.
  3. Copy the part, open or create another project, and Paste (or Paste in Place).
  4. The copy's operation gets a new palette colour. The anchor is rewritten to that colour and no longer matches the path, so the placed tab is ignored and the operation's automatic tabs are cut (four on a 40 × 20 part).
  5. Nothing says so. Tabs are drawn only inside the tab tool (L6-P1-1), and the Cut Settings count reads 0 only if the operator opens it.
  - **Second route (READ):** a drawn shape whose path colour happens to equal another copied operation's colour. Drawn shapes take the first operation's colour (`draw-tool.ts:85-91`), and that operation is often copied along. Its anchor is remapped to that operation's new colour when the destination already uses the old one.
- **Evidence:** REPRO, `zz-l7-tabs.test.ts`, real store `copySelection` / `setProject` / `pasteClipboardInPlace`, and `emitGcode` of the part alone. The bed is the same (default) in all three runs, so machine coordinates compare directly.
  - **Path colour = operation colour `#ff0000`:**
    - before: `{"placed":1,"gaps":["start G0 X185.000 Y150.000 S0","end G1 X187.000 Y150.000"]}`;
    - same project: identical;
    - another project: `{"pathColour":"#ff0000","opColour":"#16a34a","tabsOn":true,"anchors":[{"layerColor":"#16a34a",…,"pathT":0.3}],"placed":0,"gaps":["start G0 X150.000 Y134.000 S0","G1 X174.000 Y130.000 -> G0 X176.000 Y130.000","G1 X190.000 Y144.000 -> G0 X190.000 Y146.000","G1 X166.000 Y150.000 -> G0 X164.000 Y150.000","end G1 X150.000 Y136.000"]}`.
  - **Control, path `#000000` ≠ operation `#2563eb`:** another project gives `"placed":1` and the same single gap.
  - **Test truth:** the only paste test (`laser-tab-actions.test.ts:156-163`) pastes into the same project, so it cannot see this.
- **Severity:** P1. Hand-placed tabs move to other places on the part (here one tab becomes four, none where it was placed), with no warning. This is the same class and rating as L6-P1-1.
- **Refuter: CONFIRMED, P1 kept, and wider than raised.**
  - **What would make it false:**
    - *a decision that pasted anchors follow the operation colour:* the comment at `scene-clipboard-actions.ts:402` says so, but ADR-494 item 4 defines `layerColor` as the path colour, and paste never changes `path.color`;
    - *a warning:* a grep for any unresolved, stale or orphaned tab-anchor notice in `src` finds none;
    - *the route being unreachable:* it is reachable.
  - **Repro** (`zz-l7r-tabs.test.ts`): a real `.lbrn` 40 × 20 Rect on LightBurn layer 01, Cut. Path and operation are both `#0000ff`. Tabs were turned on (2 mm), and one tab was placed with `addSelectedLaserTabAnchor(pathColour, …)`. CNC anchors were seeded with `seedSelectedCncTabAnchors(pathColour, 2)`. Gaps come from `emitGcode`.
    - **Before:** `placed 1`, 2 CNC anchors resolve. Gap `start G0 X149.000 Y140.000` / `end G1 X151.000 Y140.000`, one gap on the Y140 edge.
    - **Same-project Paste in Place:** identical.
    - **`newProject()` then Paste in Place:** operation `#2563eb`, anchors rewritten to `#2563eb`, `placed 0`, CNC resolved `0`. Four automatic gaps, one per edge, none at X149–151: X144–146 at Y140, Y154–156 at X130, X154–156 at Y160, Y146–144 at X170.
    - **Paste into a project that already holds a drawn shape:** the same four gaps.
  - **Saved Artwork insert drops the tab even into the source project.** `insertPersonalArtwork` always creates new operations (`reuseExistingOperations = false`, `personal-artwork-model.ts:113-121`). After `capturePersonalArtwork` + insert into the same project, and into a new one: `placed 0`, the same four gaps.
  - **Second route, now REPRO.** Draw rectangles A and B: A's path is `#000000` on operation `#2563eb`, B's path is `#2563eb` on operation `#dc2626`. Place a tab on B, copy A and B, and paste into a project that already has one drawn shape. B's anchor `#2563eb` becomes `#dc2626` (A's new colour), giving `placed 0` and three interior automatic gaps. Into an empty project the palette repeats, the map is the identity, and the tab is kept.
  - **CNC.** REPRO at the anchor level only: `cncTabAnchorPosition` resolves 2 → 0 after the paste. CNC output collects manual tab points only for anchors equal to `path.color` (`collect-cnc-contours.ts:104,128-137`), so it falls back to automatic tabs (READ; no CNC job compiled).
  - **Severity.** Tabs are physical output. One placed tab becomes four automatic ones elsewhere, with no warning; the Cut Settings count of 0 shows only if the operator opens it. P1, the same class as coordinator-confirmed L6-P1-1.
- **Fix direction:** remap anchors by the copied **path** colour. Equivalently, leave `layerColor` alone, since paste never changes path colours. Add a cross-project paste and Saved Artwork test with path colour equal to operation colour, laser and CNC.

### L7-P2-1 — Every artwork export writes the path's stored colour, not the colour of the operation it burns on, so objects on different operations can share a colour in the file (and re-import merges them), and Assign selection to operation never reaches the file

- **Where:**
  - The export writers take `path.color`:
    - `export-svg-vector.ts:70` (`color: xmlText(path.color)`);
    - `export-dxf.ts:45` (DXF layer per `path.color`);
    - `vector-artwork.ts:347` (PDF, AI, EPS, GeoJSON).
  - Operations have their own colours: each new artwork gets its own operation with the next palette colour (`artwork-operation.ts:45-73`, ADR-620 Context).
    - A drawn shape's path colour is the active or first operation's colour (`draw-tool.ts:85-91`, `draw-shape-mutation.ts:14`).
    - Assign selection binds `operationIds` and leaves `path.color` as it was (`layer-actions.ts:109-123`, `operation-binding.ts:68-79`).
    - `recolorLayer` skips bound objects (`scene.ts:130-132`).
  - The operations list, the hover pulse and the Alt peek show the operation colour (ADR-620 D1–D2, `object-display.ts:210`).
- **Anchor:**
  - **Twin:** the operation an object burns on (and its colour in the operations list) against the colour in the exported file. AREAS.md L7 asks that "colours to layers" be preserved.
  - **Ground truth:** LightBurn and other colour-keyed CAM programs map colour to layer, so equal colours in the file mean one layer.
- **Scenario:**
  1. On a new project, draw a rectangle, an ellipse and another rectangle. Each gets its own operation (blue, red, green).
  2. Export SVG or DXF. The file holds `#000000`, `#2563eb`, `#2563eb`.
  3. Re-import into KerfDesk, or open the file in LightBurn: the ellipse and the second rectangle share one colour and so one operation, although they had different operations and settings.
  4. Assigning the second rectangle to the first rectangle's operation still exports it as `#2563eb`, the ellipse's colour in the file. It is grouped with the ellipse, not with the rectangle it now burns with.
- **Evidence:** REPRO, `zz-l7-store.test.ts` "drawn shapes", real `drawShape` with `currentDrawingColor`:
  - `rows`: path `#000000`/op `#2563eb`, path `#2563eb`/op `#dc2626`, path `#2563eb`/op `#16a34a`;
  - `svgStrokes ["#000000","#2563eb","#2563eb"]`, `dxfLayers ["RGB_000000","RGB_2563EB"]`, `operationsBefore 3`, `operationsAfterSvgReimport 2`;
  - after the assign: path still `#2563eb`, operation `#2563eb` "Rectangle", file unchanged.
  - `zz-l7-roundtrip.test.ts` "colour after Assign": compiled groups `#000000`/`#ff0000`, but SVG strokes `["#000000","#000000"]` and DXF `["RGB_000000","RGB_000000"]`. Re-import gives one operation.
- **Severity:** P2. SVG and DXF carry no settings by design (ADR-350 D5), so the operator assigns settings per colour after any import, and the merge is visible then. The file is still wrong against what KerfDesk shows. A refuter may weigh P1 for a LightBurn recipient who sets one colour to Cut.
- **Refuter: CONFIRMED, P2 kept.**
  - **What would make it false:**
    - *a decision that exports write path colours:* none. ADR-620's Consequences say only that export is "unchanged" by the ink display; ADR-350 item 5, ADR-431 and ADR-468 decide geometry, layers per colour and painting, not which colour a bound path takes.
    - *A misread of LightBurn:* no. LightBurn 1.7 Color Palette (https://docs.lightburnsoftware.com/1.7/Reference/UI/ColorPalette/, fetched 2026-10-28), verbatim: "In LightBurn, different colors indicate different layers." There, a shape's colour is its layer by construction. No LightBurn page on File → Export colours was found, so LightBurn's export behaviour itself is UNVERIFIED; the colour-means-layer model is verified.
  - **Repro** (`zz-l7r-fill.test.ts` "colours", real `drawShape` + `currentDrawingColor`, real export commands):
    - **Rows:** `#000000/op #2563eb`, `#2563eb/op #dc2626`, `#2563eb/op #16a34a`.
    - **SVG:** `["#000000","#2563eb","#2563eb"]`. **DXF:** `["RGB_000000","RGB_2563EB"]`.
    - **After assigning shape 3 to shape 1's operation:** row `#2563eb/op #2563eb`; both files are unchanged.
    - Every drawn shape after the first carries the first operation's colour, so an ordinary drawn project exports nearly everything as `#2563eb`.
    - This is also the export-side mechanism of L7-P1-1's drawn route: one Fill operation leaves as two colours, and DXF loses the hole.
    - PDF/EPS/GeoJSON take `path.color` too (`vector-artwork.ts:347`, read).
  - **Severity.** P1 was weighed. SVG and DXF carry no settings (ADR-350 item 5), so nothing burns until the operator assigns settings per imported colour, and the merged operation count is visible then. The P1 consequence on Fill holes is already counted in L7-P1-1.
- **Fix direction:** write each path in its operation's colour (the first bound operation, as the fill decision already does at `export-svg-vector.ts:65`), so distinct operations stay distinct. Pin it with an export test after Assign.

### L7-P3-1 — Text whose glyphs overlap keeps its non-zero meaning only through a Fill SVG; through DXF, or SVG from a Line operation, the letter joins burn as holes once the operator sets Fill

- **Where:** DXF has no fill rule (`dxf-writer.ts`), and DXF import leaves `fillRule` unset, which means even-odd (`layer-fill.ts:231`). Stroke-mode SVG paths carry no `fill-rule` (`export-svg-vector.ts:276-290`), and stroke entries are not given SVG's non-zero default (`svg-import-entries.ts:75-87`). The compiler resolves text non-zero (`layer-fill.ts:231`).
- **Anchor:** Twin, text burned in KerfDesk against the same outlines after re-import. The laser fill resolves a text object's own contours non-zero (`layer-fill.ts:231`). ADR-286 (title) makes the same rule for V-carve: "A text object's own glyphs resolve non-zero before a V-carve layer pools". Its Context records that the laser fill already did so.
- **Evidence:** REPRO, `zz-l7-text.test.ts`, Pacifico "Hello" 20 mm with Weld off (10 contours): original Fill 400.04 mm²; SVG Fill round trip 400.02; SVG from a Line operation, then Fill, 391.72 (`fillRule` `unset`); DXF, then Fill, 391.98.
- **Refuter: CONFIRMED, P3 kept.**
  - **REPRO** (`zz-l7r-spot.test.ts`), Pacifico "Hello" 20 mm, 10 contours:
    - Fill `400.04`;
    - Fill SVG round trip `400.02`;
    - Line SVG, then Fill, `391.72`;
    - DXF, then Fill, `391.98`.
  - **Partly by decision.** ADR-358 item 3 materialises SVG's non-zero default only in "New Fill fragments"; "Stroke fragments retain their authored open paths". So the Line-SVG half follows a recorded choice.
  - **Why P3.** The operator has to change the mode after import before anything differs.
- **Fix direction:** weld (union) text outlines on export to DXF and to stroke SVG, or tell the operator. LightBurn's DXF import is even-odd as well.

### L7-P3-2 — Paste lands 10 mm from the source and only KerfDesk's own clipboard is used; LightBurn's Paste centres at the cursor and uses the system clipboard

- **Where:** `scene-clipboard-actions.ts:29,70-73` (`PASTE_OFFSET_MM = 10`). The clipboard is store state that survives Open (`project-actions.ts:300`). No `paste` or `clipboardData` handler exists for artwork (grep: only the board-capture photo dialog reads the clipboard).
- **Anchor:** Ground truth, LightBurn 1.7 Clipboard Tools (https://docs.lightburnsoftware.com/1.7/Reference/Clipboard, versioned path, fetched 2026-10-28): "Pasted objects are centered at the location of your cursor at the time of pasting." The page also says "By default, LightBurn uses your system's clipboard", for pasting from other programs and between LightBurn windows. WORKFLOW.md:1854 documents KerfDesk's offset, so this is parity, not a broken contract. ADR-410 D4 adopted only Paste in Place.
- **Evidence:** SOURCE + READ. The offset was confirmed in the repro (pasted copies at +10 mm).
- **Refuter: CONFIRMED, P3 kept.**
  - **Source:** `const PASTE_OFFSET_MM = 10;` (`scene-clipboard-actions.ts:29`). WORKFLOW.md reads "Paste the scene clipboard (offset from the source)": line 1860 on `548f67ecb`, line 1854 at `6e388bb56`.
  - **LightBurn 1.7 Clipboard Tools** (https://docs.lightburnsoftware.com/1.7/Reference/Clipboard/, fetched 2026-10-28), verbatim: "Pasted objects are centered at the location of your cursor at the time of pasting." and "By default, LightBurn uses your system's clipboard."
  - **Why P3.** The offset is documented parity drift, not a broken contract.
- **Fix direction:** consider Paste at the cursor, and reading SVG text from the system clipboard. The maintainer's standing preference is "research what LightBurn does and copy".

### L7-P3-3 — An SVG round trip returns one object: every consecutive same-mode object is merged into a single imported object and its groups are dropped

- **Where:** `svg-import-entries.ts:34-45`. `appendFragment` groups only when there is more than one entry (`svg-fragment-mutation.ts:160-167`). The exporter writes one `<g id="artwork-N">` per object (`export-scene-svg.ts:148-157`), but the importer does not use it.
- **Anchor:** Twin, scene structure before export against after re-import. AREAS.md L7 lists "groups" among what a round trip should keep. LightBurn imports each SVG element as its own shape.
- **Evidence:** REPRO, `zz-l7-roundtrip.test.ts` line design: `before=6 after=1 groups=0`. The merge is also the mechanism of L7-P1-1 on Fill operations.
- **Refuter: CONFIRMED, P3 kept.**
  - **REPRO** (`zz-l7r-spot.test.ts`): the six-object design re-imports as `svgObjects 1`. `appendFragment` adds a group only for more than one entry (`svg-fragment-mutation.ts:160-167`, read).
  - **Why P3.** By itself it changes structure, not output on Line. On Fill it is the import-side mechanism of L7-P1-1, which is counted there.
- **Fix direction:** keep each top-level `<g>` of a KerfDesk artwork file as its own object, or offer Break Apart in the import message. Re-create `scene.groups` if the exporter writes them.

## KNOWN re-observed

- **19-P2-1 (rolling v2, fixed by #1372 / #1375).** The SVG and DXF exports run every fallible step (variable materialisation, image embedding, `exportSceneSvg` / `exportSceneDxf`) before `pickPreparedSaveTarget` (`export-artwork-svg.ts:39-64`, `export-artwork-dxf.ts:39-55`). Read only; not re-raised.

## Refuted

(Candidates the auditor dropped before raising.)

- **The round trip loses the absolute position.** By design: an import centres the whole file on the bed (ADR-358 D3, `svg-fragment-mutation.ts:62-66`; DXF `fitObjectToBed(… 'center-only')`). `data-kerfdesk-artwork-origin` (ADR-574) keeps the registration between the file's objects only. With the artwork centred, it came back within 0.0003 mm.
- **DXF bulge snapping bends arcs.** No. Hausdorff was 0.0345 mm through compile flattening, and the box was the same to 0.0002 mm.
- **Paste repeats the J9 mask defect (a copy keeps the original's mask).** No. Same project and another project both give the copy its own pasted mask, and both burn 1070 cells.
- **Paste into a project with another bed moves the artwork.** No. Scene positions are kept (100, 100 and 150, 250). The machine coordinates follow the new bed, as for any artwork.
- **`.lf2` loses nested groups or the design-tree order** (the drift check excludes groups, `persistence-semantic-integrity.ts:4-6`). No: both survive, and every scene key matches.
- **Output-off artwork (masks, path guides, LightBurn tool layers) exports as ordinary strokes, then re-imports onto an output-on operation.** This is by design: ADR-350 D5 exports "the scene, including output-disabled artwork", and SVG "carries no machining settings". Not raised.

## Verified clean

- **SVG structure** (`exportSceneSvg`): the root is `width="…mm" height="…mm" viewBox="minX minY w h"`, so one user unit is 1 mm, and the page is the exact curve extent rounded outward on the 0.001 mm grid (ADR-431 D2). It also carries `data-kerfdesk-artwork-origin="v1 x y"` (ADR-574) and `overflow="visible"`. There is one `<g id="artwork-N"><title>` per object, with object transforms as `matrix(…)` (arcs kept exact).
  - Stroked paths are 0.1 mm with `vector-effect="non-scaling-stroke"`. Fill paths carry `fill-rule` (even-odd, or non-zero for text). Text is outlined, and the toast says so.
  - Inkscape and LightBurn both size an SVG from a unit-bearing `width`/`height` plus `viewBox`. That is a spec-level reading only; neither app was run.
- **DXF structure** (`writeDxfDocument`): `$ACADVER AC1018`, `$INSUNITS 4` (mm), `$MEASUREMENT 1`, `$EXTMIN/$EXTMAX`, and `$HANDSEED` above the last handle. The tables, blocks and objects section are the ones ADR-431 D4 lists.
  - The only entity is `LWPOLYLINE` (15 in the repro), with group 42 bulges for arcs and lines plus fitted bulges for cubics within 0.01 mm (ADR-452). Group 70 is 1 for closed contours, and an open contour stays open.
  - Each layer is named `RGB_RRGGBB` with ACI (62) and true colour (420). The importer reads the entity's 420 (`dxf-expand.ts:368`).
- **Geometry fidelity:** both formats keep size, shape, contour count and open/closed state (round-trip table, rows 1–2). Curves come back as curves (SVG) or within 0.01 mm (DXF).
- **`.lf2` completeness:** the kitchen-sink project holds:
  - a masked photo with a locked, named mask on an output-off operation;
  - a rotated, mirrored rounded rectangle with power scale, a placed laser tab, and a per-object override including `byOperation`;
  - two nested groups with `parentId`;
  - `designTreeOrder`.
  - It goes through `prepareProjectForPersistence` → `deserializeProject` with every `scene` key identical, and `emitGcode` gives byte-identical output (604 lines).
  - L2, L3, L4 and L5 of this round already verified shapes, text modes (box, bend, Weld, stroke fonts), negative scale and Design Studio entities through `.lf2`.
- **Paste and Duplicate dependencies:** the mask travels with a copied photo and is remapped, in the same project and in another project. A copied path text brings its guide (`sceneObjectCopyClosure`), and `guideObjectId` points at the pasted guide. `svgImport` ownership is detached on copies (ADR-358 D6).
  - Same-project paste reuses the source operation (no stacked second emission). Cross-project paste creates operations with unique colours and keeps the settings, without the Focus Test intent.
  - Nested groups are cloned with `parentId` remapped within the copy (`clone-selection-groups.ts`, read).
- **Remote twin:** remote `import` uses the same `importSvgFragment` / `importSvgObject` (`remote-control/design-imports.ts:62,79,272`), so it behaves the same, including L7-P1-1. There is no remote export or paste; remote `duplicate` calls the desktop `duplicateSelection` (`arrange.ts:82`). The trace CLI writes only traced-page DXF (`run-trace-cli.ts:95`).

## Not verified

- Opening the exported SVG, DXF or PDF in LightBurn, Inkscape or AutoCAD. ADR-431 still lists that as an acceptance step.
- PDF / AI / EPS / GeoJSON re-import into KerfDesk. They were read only; they share L7-P1-1's union paint by ADR-468 D1, and L7-P2-1's colour source.
- SVG round trip of raster images with owned clips and masks (ADR-358 covers it in its own tests; not re-run).
- Laser → CNC cross-project paste. Paste does not apply the destination's layer defaults (`applyLayerDefaultsToFreshLayers` is not called), so a pasted operation in a CNC project would compile with `DEFAULT_CNC_LAYER_SETTINGS`. Read only, outside this area's machine scope.
- CNC tab anchors through cross-project paste. *Refuter:* reproduced at the anchor level (2 resolve before, 0 after). Compiled CNC output was not run (read: `collect-cnc-contours.ts:104,128-137`).
- Saved Artwork insert of tabbed parts. *Refuter:* reproduced. The tab is dropped even when inserted into the source project (see L7-P1-2).
- How LightBurn's Filled view draws two shapes on one layer (whether it shows the hole), for the canvas half of L7-P1-1. *Refuter:* still not verified, and LightBurn's own File → Export colour behaviour has no docs page found (L7-P2-1).

## Repro files

All files sat in `…\scratchpad\j7-main\` and were deleted after the runs. Copies are kept as `.txt` in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\l7-repros\`.

| File | What it did |
|---|---|
| `zz-l7-vitest.config.ts` | The repo's Vitest config plus the `fflate` alias and one worker |
| `src\ui\app\zz-l7-roundtrip.test.ts` | Six-object Line design through SVG and DXF re-import (size, position, Hausdorff, contours, file headers); Fill ring and knock-out through SVG and DXF; colours after binding one object to another operation |
| `src\ui\app\zz-l7-text.test.ts` | Pacifico "Hello" through SVG (Fill and Line) and DXF, burned area after switching to Fill |
| `src\ui\state\zz-l7-store.test.ts` | Real `drawShape` colours against operation colours and re-import operation count; Paste of a masked photo, text on path and a tabbed part (same and another project); `.lf2` kitchen sink with G-code byte compare |
| `src\ui\state\zz-l7-tabs.test.ts` | Hand-placed tab through Paste in Place, same project and another project, with path colour equal to and different from the operation colour; tab gaps from `emitGcode` |
| `src\ui\workspace\zz-l7-canvas.test.ts` | `drawScene` with a recording context: how the design canvas fills a plate and an inner circle on one Fill operation |

**Refuter files.** All were in `j7-main` and deleted after the runs; none was kept.

| File | What it did |
|---|---|
| `zz-l7r-vitest.config.ts` | The repo's Vitest config plus the `fflate` alias and one worker |
| `src\ui\app\zz-l7r-fill.test.ts` | Separate Fill shapes and drawn colours through the real export commands (capturing save target) and `dispatchImportFilesInOrder`. Cases: the `.lbrn` ring, the drawn + Assign ring, the Roboto "KERF" knock-out, and three drawn shapes then Assign |
| `src\ui\state\zz-l7r-tabs.test.ts` | A `.lbrn` part and a drawn part with one placed tab, through same-project paste, `newProject()` paste, paste into a busy project, and Saved Artwork insert (same and new project). It records placed counts, CNC anchor resolution and `emitGcode` gaps |
| `src\ui\app\zz-l7r-spot.test.ts` | Headline spot-check: the six-object size through SVG and DXF, Pacifico through Line SVG and DXF, and `.lf2` G-code identity |

**Headline spot-check (refuter).**
- **Round trip:** before `95.1172 × 101.7082`, 15 contours (14 closed). SVG gives `95.1172 × 101.7080` and DXF `95.117 × 101.708`, both 15/14, centred on the bed. The headline holds.
- **`.lf2`:** the refuter ran its own smaller project, with a rotated and mirrored rounded rectangle carrying a placed tab, power scale and a `byOperation` override, a Fill ellipse, and a group. It went through `prepareProjectForPersistence` → `deserializeProject` and `emitGcode` gave byte-identical output (443 lines). The auditor's 604-line kitchen sink was not re-run.

```json
[
  {"id":"L7-P1-1","severity":"P1","area":"design-io-roundtrip","file":"src/io/svg/svg-import-entries.ts","line":38,"anchor":"Ground truth: LightBurn 1.7 Fill Mode (an inner shape on the same layer is a hole; ADR-286 Context); Twin: compiled burn (fill-rule.ts:5-13 pooled even-odd) vs exported SVG/PDF/EPS (separate filled paths, ADR-468 D1) vs KerfDesk SVG re-import (one merged object, non-zero union, layer-fill.ts:248) vs canvas (separate ink fills, object-display.ts:210-217)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Two separate shapes on one Fill operation burn as LightBurn does (plate + inner circle 999.7 mm2 ring; plate + 'KERF' 1116.3 mm2 knock-out), but SVG export paints each as its own filled path and KerfDesk's SVG import merges consecutive elements into one object whose paths are unioned non-zero, so after the round trip both burn 1200 mm2: the hole is filled and the text gone, with no message; DXF keeps 999.8 / 1116.3 only when the shapes share one path colour (LightBurn imports); drawn + Assigned shapes have different path colours (L7-P2-1), so SVG and DXF both re-import onto two Fill operations, 1400.3 / 1400.2 mm2 (plate solid, circle burned twice); the canvas already paints the original as a solid plate (not a warning; canvas-vs-burn twin is a separate L8 candidate). Refuter REPRO through the real export commands and import dispatch"},
  {"id":"L7-P1-2","severity":"P1","area":"design-io-roundtrip","file":"src/ui/state/scene-clipboard-actions.ts","line":393,"anchor":"Contract: ADR-494 item 4 (layerColor is the path colour; copy and paste carry tabs) and Amd 1 Context (keep each tab at the same physical place); Twin: same-project paste keeps them","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Paste into another project (and Saved Artwork insert) rewrites laser/CNC tab anchors from source operation colour to the new operation colour, but anchors count only while equal to their path colour (laser-tab-anchors.ts:101,121; cnc-tab-anchors.ts:70,85); for artwork whose path colour equals its operation colour (every LightBurn .lbrn import) the placed tab is dropped: 1 placed gap X185-187 on the top edge becomes 4 automatic gaps on all four edges, placed count 1 -> 0, no warning. Refuter REPRO on a real .lbrn part (X149-151 -> four automatic gaps); Saved Artwork insert drops it even into the source project; drawn-shape route (path colour = another copied operation's colour, pasted into a project with artwork) reproduced; CNC anchors resolve 2 -> 0"},
  {"id":"L7-P2-1","severity":"P2","area":"design-io-roundtrip","file":"src/io/svg/export-svg-vector.ts","line":70,"anchor":"Twin: operation an object burns on (and its list colour, ADR-620) vs exported colour; AREAS L7 'colours to layers'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"SVG, DXF, PDF, AI, EPS and GeoJSON export write path.color, not the operation colour; three shapes drawn on three operations (#2563eb/#dc2626/#16a34a) export as #000000/#2563eb/#2563eb and re-import as 2 operations; Assign selection to operation never changes the exported colour"},
  {"id":"L7-P3-1","severity":"P3","area":"design-io-roundtrip","file":"src/io/dxf/dxf-writer.ts","line":314,"anchor":"Twin: KerfDesk text burns non-zero (layer-fill.ts:231; ADR-286 for V-carve) vs re-imported outlines (even-odd)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Pacifico 'Hello' 400.04 mm2 as Fill; after DXF (391.98) or a Line-operation SVG (391.72, fillRule unset) and switching to Fill, letter joins burn as holes; a Fill SVG keeps 400.02"},
  {"id":"L7-P3-2","severity":"P3","area":"design-io-roundtrip","file":"src/ui/state/scene-clipboard-actions.ts","line":29,"anchor":"Ground truth: LightBurn 1.7 Clipboard Tools (Paste centres at the cursor; system clipboard)","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Paste offsets 10 mm from the source and uses only KerfDesk's in-store clipboard (no SVG from other programs, no window-to-window); LightBurn pastes at the cursor through the system clipboard; documented in WORKFLOW.md:1854"},
  {"id":"L7-P3-3","severity":"P3","area":"design-io-roundtrip","file":"src/io/svg/svg-import-entries.ts","line":38,"anchor":"Twin: scene structure before export vs after re-import; AREAS L7 groups","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"An SVG round trip merges every consecutive same-mode object into one imported object and drops scene groups (6 objects -> 1, 0 groups); the exporter's per-object <g> is not used"}
]
```
