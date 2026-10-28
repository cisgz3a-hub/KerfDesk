# Rolling audit v7 — L3 Text and typography

- **When:** 2026-10-28, afternoon +0800   **Tree:** origin/main @ `6e388bb56` (fetched at start).
  - **Repros ran on the scratchpad copy `…\scratchpad\j7-main\` (main `f1d919fbf`).** Every tracked file under `src/core/text`, `src/ui/text`, `src/io/text`, `src/core/variables`, `src/core/geometry`, `src/core/compile`, `src/ui/remote-control` and `src/io/gcode` hash-matches `6e388bb56`, except `src/io/gcode/gcode-metadata.ts` and its test (K3's G-code header metadata, no geometry). No repo file was touched apart from this report.
- **Scope:** `src/core/text/*` (embedded fonts, font registry, layout, text box layout and render, bidi, bend, path text, glyph coverage, outline and stroke fonts, weld, styles), `src/ui/text` (dialog, canvas editor and draft, worker, missing-character hint, variable rows preview, `buildTextObject`, `renderVariableText`), convert to paths, `.lf2` save and load, variable output (`prepare-output-snapshot.ts`, `variable-text-anchor.ts`), remote/MCP text (`src/ui/remote-control/text.ts`, `text-edit.ts`, `design-batch.ts`, `electron/mcp/authoring-schemas.ts`) and the registration-jig text editor (`jig-text-object.ts`).
  - Governing documents: ADR-012 (text and fonts, Verification), ADR-194 (superseded by ADR-213), ADR-226 (the four bundled stroke fonts), ADR-286, ADR-320 (owned drafts, one commit), ADR-321 (glyph weld), ADR-591 (shaping; "unsupported font glyphs remain visible warnings"), ADR-628 (embedded fonts). No ADR decides what **Size** means or how a text box or variable record is anchored.
- **Lenses run:** L2 ground truth (font tables read by an independent TrueType reader; LightBurn 2.1 Text docs; EMS/Relief SVG font sources at their pinned commits), L3 twins (canvas, Inspector, converted paths, `.lf2`, emitted G-code; desktop dialog, canvas editor, jig editor, remote/MCP), L4 adversarial (17 hostile inputs), L7 test truth (which tests pin each behaviour).
  - Not run: L5 trust boundary (rolling v5 J3 owns remote input), L6 beyond the swallowed missing-glyph signal.
- **Repros:** eight temporary files in `j7-main` (listed under "Repro files"), each run alone with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> --silent=false --disableConsoleIntercept`. Two existing tests were also run on the same tree: `src/ui/text/variable-text-style-anchor.test.ts` 5/5 and `src/core/text/text-weld.test.ts` 15/15.
- **Counts:** 13 raised → 0 refuted → P1 4 / P2 5 / P3 4 (+ 5 KNOWN re-observed).
  - **Refuter (2026-10-28, fresh context):** all 13 findings CONFIRMED; none refuted, none PLAUSIBLE.
    - 12 were reproduced by the refuter's own tests on `j7-main`. L3-P3-4 (test gaps) was confirmed by reading the named tests.
    - **Tree check.** `origin/main` moved to `47ff19d8d` (#1500, stall beam). Every file under `src/core/text`, `src/ui/text`, `src/io`, `src/ui/remote-control`, `src/core/variables`, `src/core/geometry`, `src/core/compile`, `src/core/scene`, `src/ui/workspace/registration-jig` and `electron/mcp` in `j7-main` hash-matches `47ff19d8d`. The only differences are #1500's laser/streaming files, which contain no text code.
    - **Independent ground truth.**
      - Font metrics came from HarfBuzz (`harfbuzzjs`, a separate engine from opentype.js) plus a raw `head`/`OS/2` read.
      - The pinned EMS and Relief SVG sources were re-fetched. Their SHA-256 hashes match the generator's pins.
      - LightBurn 2.1 Text reference: https://docs.lightburnsoftware.com/2.1/Reference/Text/, fetched 2026-10-28.
    - **Severity changes:** none. L3-P2-1 stays P2 (reasoning under that finding).
    - **Corrections to numbers:**
      - L3-P1-1: the line overlap (4.2 mm above line 1's baseline; Casual Hand only).
      - L3-P1-3: a text made only of missing glyphs is refused.
      - L3-P3-1: the ink coordinates.
    - **KNOWN items:** 15-P2-1 and 15-P3-1 were re-observed by the refuter's repro with the same numbers. The other three KNOWN items were not re-run.

## Headline

**The outline-font engine is exact.** Glyph positions, kerning, alignment and line pitch match the font files to floating-point rounding at 5, 10 and 37.5 mm. Roboto applies its GPOS kerning exactly (AV −87, To −99, Wa −33 of 2048). For one text, the canvas geometry, the Inspector W/H, the converted paths, the reloaded `.lf2` and the G-code burn agree to 0.003 mm in all 12 configurations tried (plain, two lines, Bold, Italic, Max width, both bends, a text box, a stroke font, Weld).

**"Size" is where the typed number and the burn part ways.**
- For outline fonts, Size is the em. A Size 10 Roboto capital burns 7.11 mm, where LightBurn's Height is "the height of a capital letter X".
- For the Relief stroke font, Size is the capital height: a Size 10 H is exactly 10.00 mm.
- The three EMS stroke fonts are scaled by a cap-height attribute that the source files leave at a placeholder of 500, while their capitals reach 658–875 units of a 1000-unit em. **A Size 10 H burns 13.2, 13.6 and 17.5 mm (L3-P1-1).**

**Entry points other than the desktop editor lose what the editor guarantees:**
- **L3-P1-2:** Bent variable text has no alignment anchor, so a centred name on an arc burns 17–23 mm off the template's centre. The unbent control lands within 0.35 mm.
- **L3-P1-3, L3-P1-4:** A missing glyph is reported only by the open text editor's hint. Remote `add_text`, `update_text` and `apply_edits` drop the glyph without a word (Pacifico) or burn the font's box (Roboto), and so do variable records from a CSV the hint never saw. ADR-591 promises a visible warning.
- **L3-P2-4:** The jig text editor re-renders text without its Max width, Bold, Upper case, Weld or text box, yet keeps those settings on the object.
- **L3-P2-2, L3-P2-3:** A remote `update_text` unwraps a text box (38.9 × 21.1 becomes one 87.6 mm line). A desktop wording edit of remote-made text silently clamps 500 mm to 300 mm.

## Metrics ground truth

The font-file column comes from an independent reader (`zz-l3-ttf.ts`). It reads `head`, `hhea`, `OS/2`, `hmtx`, `cmap` 4/12, the `glyf` headers, GPOS PairPos format 1/2 (including Extension lookups) and legacy `kern`. KerfDesk's column is the core render (`textToPolylines`), measured per glyph through `glyphContours`.

| String / font / size | Metric | Font file | KerfDesk | Verdict |
|---|---|---|---|---|
| `AVToWa` / Roboto / 5, 10, 37.5 mm | Each glyph's ink left and ink top, against the pen (hmtx + GPOS kern) plus the glyf bbox | upm 2048; AV −87, VT 0, To −99, oW 0, Wa −33; advance sum + kern 7741 units | max error 0.0 mm (left and top) at all three sizes; ink width 37.1143 mm at 10 mm, file 37.1143 | match |
| `AVToWa` / Tinos / 5, 10, 37.5 | same | 3 GPOS kern lookups; AV −264, To −143, Wa −164 | max error 0.0 mm; width 36.4063 = file | match |
| `AVToWa` / Poppins / 5, 10, 37.5 | same | no kern feature | max error 1.8e-15 mm | match |
| `H` / Roboto / Size 10 | Capital height | OS/2 sCapHeight 1456/2048 → 7.109 mm at a 10 mm em | 7.109 mm (G-code `Y 342.891..350.000`) | Size = em. LightBurn: Height ≈ capital X (**L3-P2-1**) |
| `H` / Poppins, Tinos, Inconsolata, Anton, Stardos Stencil, Pacifico / 10 | Capital height | glyf H yMax − yMin | 6.970, 6.548, 6.230, 8.594, 6.938, 8.840 mm | match em; 0.62–0.88 of the typed Size |
| `X` / Great Vibes / 10 | Capital height | glyf X 1059/1000 | 10.590 mm | match em |
| `H` / Relief SingleLine / 10 | Capital height | SVG `cap-height` 680 = the H's height | 10.000 mm | Size = capital height |
| `H` / EMS Nixish, Decorous Script, Casual Hand / 10 | Capital height | `units-per-em="1000"`, `cap-height="500"`; the H reaches about 658, 678 and 875 units (Casual Hand's H path goes to y 910) | **13.170, 13.555, 17.508 mm** (Casual Hand G-code `Y 332.492..350.000`) | **L3-P1-1** |
| `AVToWa⏎To` / Roboto / 10, left, centre, right | Line-2 pen offset | (w1 − w2)/2 = 13.3057 mm; w1 − w2 = 26.6113 mm | 0.0000, 13.3057, 26.6113 mm | match |
| same | Baseline step | hhea (2146 + 555 + 0)/2048 × 10 = 13.188 mm | 14.000 mm = Line height 1.4 × Size | by design: a multiplier of Size (LightBurn's VSpace is relative to the font height) |
| `A日A` / 8 bundled fonts | The `.notdef` drawn for a missing glyph | Roboto, Poppins, Tinos and Anton have a box; Inconsolata, Pacifico, Great Vibes and Stardos Stencil have an empty `.notdef` | 5 / 5 / 2 / 5 contours; **0** for the empty four; `missingCharacters: ["日"]` in every render result | engine reports it; the callers in L3-P1-3/P1-4 drop the report |

**Refuter spot-check (HarfBuzz, independent of opentype.js and of `zz-l3-ttf.ts`):**
- **Roboto kerning:** AV −87, VT 0, To −99, oW 0, Wa −33 (kerned minus `kern`-off advance), and an `AVToWa` advance sum of 7741, all of 2048. Tinos: AV −264, To −143, Wa −164.
- **Capital heights at Size 10:**
  - `H` extents: Roboto 1456/2048 = **7.109 mm**, the same as the raw `OS/2` sCapHeight of 1456.
  - Tinos 6.548, Poppins 6.970, Inconsolata 6.230, Anton 8.594 and Pacifico 8.840 mm.
  - KerfDesk's G-code for Roboto `H`, `X`, `I` and `E` is `Y 342.891..350.000`.
- **Line-2 offsets for `AVToWa⏎To`:** HarfBuzz gives (7741 − 2291)/2048 × 10 / 2 = **13.3057** mm centred and **26.6113** mm right. KerfDesk's line-2 ink moves by 13.3057 and 26.6113 mm.
- **Not in the table.** Anton and Pacifico have kern pairs too (Anton AV −44, To −45; Pacifico To −90, Wa −40). Their application was not measured.

**What "Size" means.** For outline fonts it is the em square in millimetres: the `fontSize` handed to opentype.js (`text-glyph-geometry.ts:21`, `text-to-polylines.ts:371`). The canvas editor does the same as CSS (`canvas-text-layout.ts:56`). For stroke fonts it is the font's declared cap height (`stroke-font-text.ts:60`). The field's tooltip says "Text height in millimeters." (`TextDialogNumericFields.tsx:80`). LightBurn 2.1's Text reference defines Height as "generally the height of a capital letter X in the font" and adds that it "is not exact".

## Findings

### L3-P1-1 — The three EMS single-line fonts are scaled by a placeholder `cap-height` of 500, so a Size 10 capital burns 13.2–17.5 mm and lines collide at the default line height

- **Where:**
  - `src/core/text/stroke-font-text.ts:60` (`const scale = actual.sizeMm / font.capHeight;`) and `:53` (the text box measure uses the same scale).
  - `scripts/generate-cnc-stroke-fonts.mjs:147` takes `capHeight` from the SVG `<font-face cap-height>` attribute without checking it against the glyphs.
  - `src/core/text/cnc-stroke-font-data.ts:7`: `"capHeight":500` for `ems-nixish`, `ems-decorous-script` and `ems-casual-hand`, and 680 for Relief.
- **Anchor:**
  - **Ground truth.** The pinned EMS sources (`gitlab.com/oskay/svg-fonts/-/raw/8c71f2d9e1a5292047bb88e5595a766241b82cc6/fonts/EMS/EMSCasualHand.svg`, fetched 2026-10-28) declare `units-per-em="1000" ascent="800" descent="-200" cap-height="500" x-height="300"`, and EMSNixish.svg and EMSDecorousScript.svg declare the same. The H glyph's path goes to y 910 (`M 120 47.2 L 88.2 750 … M 324 910`). The attribute does not describe the glyphs.
  - **Twin.** KerfDesk's own definition for stroke fonts is the capital height: Relief's H is 10.000 mm at Size 10, and `stroke-font-text.test.ts:6` says "one unit is 1 mm at Size 10" for a cap height of 10.
  - **Contract.** ADR-012 Verification: "typing each bundled font produces G-code that cuts at correct dimensions."
- **Scenario:**
  1. CNC or laser single-line text in EMS Casual Hand at Size 10, which the tooltip calls "Text height in millimeters".
  2. The capital H burns 17.508 mm tall, 1.75 × the typed height. EMS Nixish burns 13.170 mm and EMS Decorous Script 13.555 mm.
  3. No reading of Size gives this. As an em, the H would be about 8.75 mm; as KerfDesk's capital height, 10.00 mm. The scale effectively makes the em 20 mm.
  4. At the default line height of 1.4, two lines of Casual Hand overlap: `H⏎H` is 31.508 mm tall, so line 2's capitals rise 3.5 mm above line 1's baseline.
  5. Switching Relief to EMS Casual Hand at the same Size makes the letters 75 % bigger. Nothing warns.
- **Evidence:** REPRO.
  - `zz-l3-metrics.test.ts` printed: `relief-single-line: Size 10 -> H ink height 10.000 mm (Roboto H 7.109 mm)`, `ems-nixish … 13.170 mm`, `ems-decorous-script … 13.555 mm`, `ems-casual-hand … 17.508 mm; two-line H ink height 31.508`.
  - `zz-l3-output.test.ts`, through `buildTextObject` → `prepareOutputSnapshot` → `emitPreparedGcode`, printed: `ems casual hand H: inspector W 6.170 H 17.508 … | burn W 6.170 H 17.508 X 100.000..106.170 Y 332.492..350.000 | converted … H 17.508 | reload paths equal true`.
- **Severity:** P1. The burn is a different size from what was typed, under every definition the app or LightBurn uses, and no warning names it (METHOD §3; AREAS P1, "differs in size … from what the user typed"). The canvas shows the large letters, but that is not a warning about the mismatch (the L2-P2-1 precedent).
- **Novelty:** new. No audit names the EMS cap height (grep `docs/audits` for EMS / stroke font / cap height). The four-font test only checks `capHeight > 0` (`cnc-stroke-font.test.ts:61`).
- **Fix direction:** In the generator, derive each face's scale from its glyphs (the H or X height), not from `cap-height`, or refuse a `cap-height` the glyphs contradict. Regenerate the data. Add one test per stroke font that a Size 10 H measures what Size means. Existing saved geometry keeps its size until it is re-edited.
- **Refuter: CONFIRMED, P1 kept.**
  - **What would refute it, and what was found:**
    - **The source attribute is not a placeholder, or the glyphs fit it.**
      - The refuter re-fetched the pinned SVGs to stdout. Their SHA-256 matches the generator's pins for all four.
      - Each EMS file reads `units-per-em="1000" … cap-height="500" x-height="300"`.
      - An independent path parser measured the capitals:
        - Nixish: H 658.5, X 655.4, I 661.5 units;
        - Decorous Script: H 680.0, X 714.6, I 671.0;
        - Casual Hand: H 875.4 (y 34.6..910), X 639.1, I 636.5, E 799.9.
      - Relief declares 680, and its H, X and I are exactly 680.
    - **An ADR decides the stroke-font scale.** None does. ADR-226 pins the sources and says the maintainer approved the four *styles*. ADR-012's Verification ("cuts at correct dimensions") stands.
    - **"Size" is documented differently.**
      - The tooltip says "Text height in millimeters." (`TextDialogNumericFields.tsx:80`); the jig says "Text height in millimetres" (`JigTextControls.tsx:161`).
      - The only definition specific to stroke fonts is the test comment that a cap height of 10 is "1 mm at Size 10" (`stroke-font-text.test.ts:6`), i.e. the capital height.
      - The EMS scale matches neither convention. It is not the em, which is 20 mm at Size 10, and it is not the capital height.
    - **A warning.** The single-line hint names only operations and the `?` fallback (`FontUsageHint.tsx:28-31`). The Inspector shows the true height, but it says nothing about the mismatch (METHOD §3 G6; the L2-P2-1 rule).
  - **Own repro:** `zz-l3r-output.test.ts`, `buildTextObject` → `prepareOutputSnapshot` → `emitPreparedGcode`, Size 10, G1 heights.
    - **Relief:** H, X and I are 10.000 mm.
    - **Nixish:** H 13.170, X 13.192, I 13.230 mm.
    - **Decorous Script:** H 13.533, X 14.292, I 13.304 mm.
    - **Casual Hand:**
      - H **17.508** (`Y 332.492..350.000`), X 12.782, I 12.731, E 15.998 mm;
      - `H⏎H` is 31.508 mm.
    - **Roboto:** H 7.109 mm.
  - **Corrections to the scenario:**
    - The EMS capitals burn **12.7–17.5 mm**. Casual Hand's H, at 17.5 mm, is its tallest capital: its X and I are 12.8 mm.
    - **Line collision.** At line height 1.4, line 2's H rises **4.2 mm** above line 1's baseline (18.2 − 14). It is 3.5 mm above the foot of line 1's H, which sits 0.69 mm up. Only Casual Hand's tallest capitals (H, E) collide. Nixish and Decorous capitals stay below the 14 mm pitch above the baseline.
  - **Why P1:** the typed Size burns 1.27–1.75 × the size that every reading of Size (em, capital height, Relief) gives. The field still shows 10, and no message names the difference.

### L3-P1-2 — Bent variable text has no alignment anchor, so a centred name on an arc burns 17–23 mm off the template's centre

- **Where:**
  - `src/core/text/text-bend.ts:98-109` (`normalizeBentPaths`) and `src/core/text/text-style.ts:175-178` (`bendTextUndistorted`) return no `anchor`.
  - `src/ui/text/render-variable-text.ts:44` renders each record through `styledBentRender`.
  - `src/io/gcode/variable-text-anchor.ts:48`: `if (record.anchor === undefined) return text.transform;`. Each record then hangs from the template's ink top-left.
- **Anchor:**
  - **Twin.** Unbent variable text keeps each record on the template's alignment anchor (#1359; re-measured below within −0.31 to +0.35 mm).
  - **Contract (code).** `variable-text-anchor.ts:1-6`: without an anchor, "a centred name drifts with its width". `TextRenderResult.anchor` (`text-to-polylines.ts:93-101`) says variable output uses the anchor "to keep a changing value where the operator placed it".
  - **Ground truth.** LightBurn's Align X "determines the horizontal anchor position of the text" (docs.lightburnsoftware.com/2.1/Reference/Text/).
- **Scenario:**
  1. A name for a round badge or tumbler: Roboto 10 mm, `{{csv:name}}`, **centred**, Bend 60°, placed at X 100.
  2. On the canvas the template is centred at X 127.19.
  3. Output burns `Al` centred at 103.84 (**−23.34 mm**), `anna` at −16.64 and `Anna` at −16.98. `Maximilian Alexander` burns at **+19.21 mm**.
  4. Every record starts at X 100.000 and hangs from the template's ink top-left. "Don't distort when bent" gives the same result (−22.63 / +19.17).
  5. Only Preview and Frame show the shift, and Frame is not a warning (METHOD §3, 2026-10-27).
- **Evidence:** REPRO, `zz-l3-output.test.ts` ("L3 variable text placement"), measured on the emitted G1 moves:
  - `centre bend60 template burn X 100.005..154.366 centre 127.186`;
  - `Al: X 100.000..107.689 centre 103.844 (centre off -23.341)`;
  - `Maximilian Alexander: … (centre off 19.209)`;
  - control `centre plain`: `Al … (centre off -0.305)`, `Maximilian Alexander … (centre off 0.347)`.
- **Severity:** P1. The burned position differs from the designed one, with no warning. This is the same harm as 15-P2-1, which G9 re-rated P1 by effect.
- **Novelty:** new. G9 dropped a different claim ("Max width or italic with a bend leaves a stale variable anchor", `G9-canvas-scene.md:388-390`) on the grounds that bends return no anchor and output "keeps the placed transform". This finding is that fallback itself. `variable-text-anchor.test.ts` and `variable-text-style-anchor.test.ts` have no bend case (`bendDeg: 0`, `:97`).
- **Fix direction:** Carry the first-baseline anchor through the bend map (`bendPointMapper` applied to the pre-bend anchor, then the same re-normalising shift), or anchor bent records on their arc centre or end per alignment. Add centre and right bend cases to `variable-text-style-anchor.test.ts`.
- **Refuter: CONFIRMED, P1 kept.**
  - **What would refute it, and what was found:**
    - **A deliberate decision.**
      - The `TextRenderResult.anchor` doc comment says the anchor is absent "when bending or path placement reshaped it and no single anchor survives" (`text-to-polylines.ts:93-99`). That is a code comment, not an ADR (METHOD §4). No ADR in `DECISIONS.md` or `docs/decisions` decides variable-text anchors or bends.
      - Its premise is also wrong for a bend. `bendPointMapper` maps the pre-bend baseline anchor to one definite point.
      - G9 accepted the fallback ("keeps the placed transform") without measuring it. This finding measures it.
    - **The canvas shows records.** It does not: the placed object renders the template string `{{csv:name}}`. Only output, export, Bake and Array materialise records.
    - **A warning.** None. Preview and Frame only show the result (METHOD §3 G6).
  - **Own repro:** `zz-l3r-output.test.ts`, Roboto 10 mm `{{csv:name}}` at X 100, centre of the G1 X extent.
    - **Bend 60, centred:**
      - the template burns at `X 100.005..154.366`, centre 127.186;
      - `Al` −23.341, `anna` −16.642, `Anna` −16.982, `Maximilian Alexander` +19.209 mm.
    - **Rigid bend:** −22.626 / +19.172.
    - **Unbent control:** −0.305 / +0.347.
    - **Also measured:**
      - **Right alignment is worse:** −46.677 for `Al`, +38.424 for `Maximilian Alexander`.
      - **Left alignment is unaffected** (±0.007), because the fallback is the ink's left edge.
      - **Bend −60:** −21.465 / +19.059.
  - **Ground truth.** The LightBurn 2.1 Text reference, re-fetched, defines Align X as the text's horizontal anchor (Left, Middle or Right).
  - **Why P1:** a typed alignment that burns at a different position, with no warning. This is the same harm as 15-P2-1, which G9 rated P1.

### L3-P1-3 — Remote `add_text`, `apply_edits` and `update_text` drop a glyph the font lacks (or burn its box) and return a plain success

- **Where:**
  - `src/ui/remote-control/text.ts:24-33` renders with `renderTextGeometry` and ignores `geometry.missingCharacters`. The object is built at `:38-59`.
  - `src/ui/remote-control/design-batch.ts:71` (`apply_edits`) uses the same `prepareRemoteText`.
  - `src/ui/remote-control/text-edit.ts:48-57` does the same for `update_text`.
  - The only consumer of a missing-character report is the desktop editor's hint (`FontUsageHint.tsx:13-22`, via `use-missing-characters.ts`; grep `missingCharacters` over `src` and `electron`).
- **Anchor:**
  - **Contract.** ADR-591 Decision, first bullet (`docs/decisions/ADR-591-research-backed-design-import-and-nesting.md:19-20`): "unsupported font glyphs remain visible warnings rather than a guessed font substitution".
  - **Twin.** The desktop editor lists the missing characters for the same text and font.
- **Scenario:**
  1. A phone user or an MCP client sends `add_text` with "Café 李" in Pacifico.
  2. The receipt is `{"ok":true,…,"data":{"changedArtworkIds":["…"]}}`.
  3. The object has 8 contours, the same count as "Café" alone, so 李 is gone. A later `get_text` returns the content with 李, so the client believes it is there.
  4. In Roboto the font's `.notdef` box burns in its place (12 contours).
  5. Inconsolata, Pacifico, Great Vibes and Stardos Stencil have an empty `.notdef`, so they drop the glyph without trace.
- **Evidence:** REPRO, `zz-l3-remote.test.ts` through the real adapter (`testAdapter`, `adapter.execute`):
  - `pacifico-regular: code ok receipt {"ok":true,"revision":"…:1","data":{"changedArtworkIds":["…"]}}; contours 8`;
  - `pacifico 'Café' control: ok contours 8`;
  - `roboto-regular: code ok … contours 12`.
  - The `.notdef` shapes come from `zz-l3-metrics.test.ts` (table above).
- **Severity:** P1. Glyphs are dropped or replaced in the burn with no warning (the area's P1 rule; METHOD §3).
- **Novelty:** new. The remote text audits (G7, H8, J3) list only the `update_text` receipt (G7-K-2 = 02-P3-4). Area 15 checked that the renderer reports missing glyphs, not that callers pass the report on.
- **Fix direction:** Return the render's `missingCharacters` in the `add_text`, `apply_edits` and `update_text` results, and refuse or flag the write, as the desktop hint does. Add a remote test with a CJK character in Pacifico.
- **Refuter: CONFIRMED, P1 kept.**
  - **What would refute it, and what was found:**
    - **Some path warns.**
      - On `main`, `missingCharacters` is read only by `FontUsageHint`/`use-missing-characters` (the text dialog), the text worker and tests (`git grep`).
      - The `add_text` and `update_text` cases of `writes.ts:77-111` return `{changedArtworkIds}` or `{changedArtworkIds, changedFields}` and push no toast.
      - The tool texts (`electron/mcp/tool-info.ts`) tell clients to relay import `notices`, but `add_text` and `update_text` have no notice channel.
      - Job Review and output have no glyph check (`git grep` of `src/ui/laser/job-review`, `src/io/gcode`).
    - **ADR-591 promises something else.** Its Decision bullet 1 is about the HarfBuzz/bidi route and ends with "unsupported font glyphs remain visible warnings rather than a guessed font substitution". A CJK character switches the text to that route (15-P3-1), so the bullet applies directly.
    - **Unreachable.** `add_text`, `update_text` and `apply_edits` are shipped MCP/remote tools. The adapter path (`testAdapter` → `adapter.execute`) is the production one.
  - **Own repro:** `zz-l3r-remote.test.ts`, through the real adapter.
    - **Pacifico:** `Café` → ok, 8 contours, W 19.55. `Café 李` → `{"ok":true,…,"data":{"changedArtworkIds":[…]}}`, **8 contours**, W 18.84.
    - **Roboto:** 7 → **12 contours** (the box).
    - **Inconsolata:** 7 → 7.
    - **`update_text`** (Pacifico `Café` → `Café 李`): ok, `changedFields ["text"]`, 8 → 8 contours. The stored content is `Café 李`.
    - **`apply_edits` `add_text "李"`:** Roboto is ok (a 5-contour box).
  - **Correction.** Text made **only** of missing glyphs, in a font with an empty `.notdef` (Pacifico, Inconsolata), is refused with the generic `unsupported_operation`, because its ink width is 0 (`text.ts:35-36`). The silent loss needs at least one covered character, as in the scenario.

### L3-P1-4 — Variable records with a character the font lacks burn nothing (or a box) at output; the only check is the open editor's hint against the CSV loaded at that moment

- **Where:**
  - `src/ui/text/render-variable-text.ts:8-19` renders each record and returns no missing-character report. `prepare-output-snapshot.ts:161-163` keeps only the geometry, and the prepared job's `advisories` stay empty.
  - The editor's hint checks the project CSV only while that text's editor is open (`FontUsageHint.tsx:13-22`, `use-missing-characters.ts:42-46`).
  - The CSV is project-wide. It can be replaced from any variable panel, including a barcode's (`VariableTextFields.tsx:19-20,51`, used by `BarcodeFields.tsx:104`; `variable-data-actions.ts:54`), and no check runs for the other texts.
  - The rows preview prints each evaluated value as HTML in a fallback browser font (`VariableRowsPreview.tsx:89`) and labels the layout "Natural text size", so it shows 李 where the burn has nothing.
- **Anchor:**
  - **Contract.** ADR-591 (as in L3-P1-3).
  - **Twin.** The editor hint does check CSV columns, but only in that one session (`csvColumnCharacters`).
- **Scenario:**
  1. A Pacifico name tag `{{csv:name}}` is set up with a Latin CSV. The hint is silent.
  2. Later the operator imports the real guest list from a barcode's or another text's Variable panel. It contains `Zoë 李` and `李`.
  3. Output burns `Zoë ` and drops 李: 222 burn moves against 190 for `Zoe`. The record `李` burns **nothing** (0 moves).
  4. The prepared job's `advisories` is `[]`.
  5. In Roboto, a box burns in place of 李 (16 moves).
  6. The rows preview shows "李" in its table.
- **Evidence:** REPRO.
  - `zz-l3-output.test.ts` ("L3 missing glyphs at output"): `pacifico-regular record "李": burn moves 0`; `record "Zoë 李": burn moves 222, X 99.625..116.345`; `roboto-regular record "李": burn moves 16, X 100.176..103.633`.
  - `zz-l3-extra.test.ts`: `prepared ok true; advisories []`; `materialised content "Zoë 李明", contours 7`.
- **Severity:** P1. A glyph is silently dropped from the burn, and the app's own preview displays it.
- **Novelty:** new. Area 15 verified only that the renderer reports missing glyphs; no audit covers output-time variable records.
- **Fix direction:**
  - Collect `missingCharacters` from every variable record while output is prepared, and surface them as a Job Review/Start advisory naming the record and the characters.
  - Show the same flag in the rows preview's Layout column.
  - Re-check every variable text when the project CSV changes.
- **Refuter: CONFIRMED, P1 kept.**
  - **What would refute it, and what was found:**
    - **Replacing the CSV from another panel is not a real path.** It is real.
      - The Barcode dialog's "Variable data" section renders `VariableTextFields` (`BarcodeFields.tsx:104-109`). That binds `setCsv` to the project store's `setVariableCsv` (`VariableTextFields.tsx:20`) and shows `VariableCsvImport` (`VariableTextControls.tsx:59`).
      - The import (`VariableCsvImport.tsx:68-91`) only parses the file and toasts the row count and encoding.
      - `setVariableCsv` (`variable-data-actions.ts:54-70`) replaces the dataset and resets the sequence, with no per-text check.
      - Another text's dialog reaches the same action through `TextFormattingFields.tsx:152`.
    - **A warning before output.**
      - `FontUsageHint` is rendered only inside `TextFormattingFields`, i.e. while that text's dialog or canvas panel is open. When the CSV is imported in the same text's editor, the operator *is* warned ("This font has no 李 (in this text or the CSV values it uses) …").
      - The finding stands for the other path and at output. `materializeVariableObject` (`prepare-output-snapshot.ts:149-188`) keeps only geometry, and the prepared job's `advisories` is `[]`.
      - Reach cannot lower a reachable P1 (METHOD §3).
  - **Own repro:** `zz-l3r-output.test.ts`, real `renderVariableText` → `prepareOutputSnapshot` → `emitPreparedGcode`, CSV `Zoe` / `Zoë 李` / `李`.
    - **Pacifico:** 190 / **222** / **0** burn moves.
    - **Inconsolata:** 106 / 138 / **0**. `Zoë 李` has the same X extent as `Zoe` (99.970..113.920).
    - **Roboto:** 108 / 156 / 16. The box is at `X 100.176..103.633`.
    - `advisories` is `[]` in every case.

### L3-P2-1 — "Size" is the em for outline fonts, but LightBurn's Height is the capital height and KerfDesk's single-line fonts use the capital height: the same Size 10 gives capitals of 6.2 to 10.0 mm

- **Where:** the outline em at `text-glyph-geometry.ts:21` and `text-to-polylines.ts:371`; the stroke capital height at `stroke-font-text.ts:60`; the tooltip "Text height in millimeters." at `TextDialogNumericFields.tsx:80`.
- **Anchor:**
  - **Ground truth.** LightBurn 2.1 Text reference (docs.lightburnsoftware.com/2.1/Reference/Text/, versioned path, fetched 2026-10-28): Height "is generally the height of a capital letter X in the font"; "Height varies based on your selected font, and is not exact".
  - **Twin.** Relief SingleLine honours Size as the capital height (10.000 mm). Outline fonts do not.
- **Scenario:** typing Size 10, "Text height in millimeters":
  - capitals burn 7.109 mm in Roboto, the default font, 6.548 in Tinos, 6.230 in Inconsolata, 8.594 in Anton and 10.000 in Relief SingleLine;
  - an all-caps 10 mm sign made the LightBurn way comes out 29 % short in Roboto;
  - switching between Roboto and Relief at the same Size changes the letter height by 41 %.
- **Evidence:** REPRO, `zz-l3-metrics.test.ts` ("what Size means") and the table above. Roboto's G-code `H` is `Y 342.891..350.000` (`zz-l3-output.test.ts`). LightBurn: SOURCE (quoted above).
- **Severity:** P2, a misleading readout (AREAS P2 example). The em is a legitimate font-size definition that the outline route applies exactly, the canvas shows the result, and no ADR chooses either meaning. If the coordinator applies the L2-P2-1 rule (a field value that burns differently) literally, this becomes P1.
- **Novelty:** new. Area 15 did not ask what Size means.
- **Fix direction:** Decide the meaning in an ADR. Following the maintainer's "copy LightBurn" rule, Size would be the capital height (scale by `OS/2 sCapHeight`, or the X glyph when that is absent). Otherwise, label the field as the font's em size. Either way, make outline and single-line fonts agree.
- **Refuter: CONFIRMED, P2 kept (not P1 under the L2-P2-1 rule).**
  - **Facts confirmed:**
    - HarfBuzz extents and the raw `OS/2` read give Roboto 7.109, Tinos 6.548, Inconsolata 6.230 and Anton 8.594 mm at Size 10. The G-code `H` is `Y 342.891..350.000`.
    - Relief burns 10.000 mm.
    - The field is labelled "Size", with the unit "mm" and the tooltip "Text height in millimeters." (`TextDialogNumericFields.tsx:71-83`). Neither the field nor any help text defines which height.
    - No ADR decides the meaning. The only statement in the code is a test comment accepting the em: "Roboto "H" cap height ≈ 0.7 × em" (`text-to-polylines.test.ts:123-129`). That test is titled "height roughly equal to size" and accepts 50–110 mm for Size 100.
  - **LightBurn 2.1 re-fetched.** The page says Height is approximate and varies by font, and that "every font has an internal size that is scaled by this Height". It also says the resulting dimensions are not guaranteed. Capital X is LightBurn's *usual* outcome, not a promise.
  - **Why P2, not P1:**
    - **The field is applied exactly.** Size is the em square, the standard font-size convention (CSS `font-size`, and the point size of ordinary design tools). Every outline font scales by it exactly.
    - **The ground truth is itself approximate.** No typed value has one exact meaning that the burn contradicts. That differs from L2-P2-1, where "Corner radius" has a single geometric meaning, and from L3-P1-1, whose EMS scale matches no convention.
    - **What remains is a misleading label and an inconsistency between font kinds.** "Text height" is not 10 mm for any glyph of an outline font, and Relief honours Size as the capital height. That is the AREAS P2 example of a misleading readout.
    - **If the maintainer adopts capital height by ADR,** an outline font that then burned the em would be P1 under the L2-P2-1 rule.

### L3-P2-2 — Remote `update_text` re-renders a text box without its frame: wrapped text becomes one long line, while `textBox` stays on the object

- **Where:** `src/ui/remote-control/text-edit.ts:48-57` builds the render input without `textBox` and then bends it (`:60`), keeping `...object` (`:66-79`). `editableText` refuses path and variable text but not text boxes (`:13-21`). Compare `render-variable-text.ts:18,35-43`, which passes the frame.
- **Anchor:** **Twin.** The desktop editor and variable output both render the frame. The object's own `textBox` (`fixed`, 40 mm, wrap) contradicts its geometry.
- **Scenario:**
  1. A 40 × 40 mm wrapped text box holds "Happy birthday to you dear friend" (38.92 × 21.12 mm of ink).
  2. From the phone or MCP: `update_text {alignment: 'center'}`.
  3. The text becomes one 87.55 × 5.84 mm line, more than twice the frame width, and is burned that way.
  4. The desktop renders the same fields as 38.79 × 21.12. The next desktop edit re-wraps it.
- **Evidence:** REPRO, `zz-l3-remote.test.ts`: `text box 40x40 wrap: before W 38.92 H 21.12; update_text(alignment center) ok -> W 87.55 H 5.84 textBox kept {"mode":"fixed","widthMm":40,…}; desktop same fields W 38.79 H 21.12`.
- **Severity:** P2. The result is visible on the canvas and the phone preview, but a remote user who asked only for centring gets text that overflows its frame.
- **Novelty:** new. The `authoring-text.test.ts` refusal list covers path, variable, locked and hidden text, not text boxes.
- **Fix direction:** Pass `textBox` into the remote render and use `styleTextRender` for boxes (as `renderVariableText` does), or refuse text-box text remotely like path text.
- **Refuter: CONFIRMED, P2 kept.**
  - **Read:** `prepareTextEdit` (`text-edit.ts:48-57`) passes no `textBox`, and `editableText` (`:13-21`) refuses only path and variable text.
  - **Own repro:** `zz-l3r-remote.test.ts`.
    - Setup: a 40 × 40 wrapped box, Roboto 10, "Happy birthday to you dear friend", built by `buildTextObject` and added to the store.
    - Before: W 36.08 × H 63.21.
    - Remote `update_text {alignment:'center'}` is ok, and the text becomes one line, **W 145.92 × H 9.74**. `textBox` is kept.
    - The desktop builds the same fields as 35.44 × 63.21.
  - **Why P2:** the canvas draws no text-box frame (no `textBox` use under `src/ui/workspace` or `src/ui/layers`), so what shows is the burned line. The stored box appears only in the editor, which re-wraps the text on open and repairs it on commit.

### L3-P2-3 — A desktop edit silently clamps typography that the remote/MCP accepted: 500 mm becomes 300, line height 10 becomes 5, spacing 5 becomes 2, and 0.5 mm becomes 1

- **Where:**
  - The remote accepts `fontSizeMm` up to 1000, `lineHeight` 0.1–20 and `letterSpacing` −1–20 (`electron/mcp/authoring-schemas.ts:33-35`, `src/ui/remote-control/validation.ts:211`, `design-validation.ts:118`).
  - The desktop clamps to 1–300, 0.5–5 and −0.5–2, both when the dialog opens (`use-text-dialog-fields.ts:187-198`) and when it builds (`build-text-object.ts:40` → `TextDialogNumericFields.tsx:51-59`).
  - The canvas editor builds through the same function (`use-canvas-text-draft.ts:73`), and so does the jig editor (`JigTextControls.tsx:113`, 1–300).
- **Anchor:**
  - **Twin.** Remote and desktop text limits.
  - **Contract (test).** `authoring-text.test.ts` "does not silently clamp typography to local dialog limits" pins the remote side only.
- **Scenario:**
  1. MCP makes a 500 mm sign (`add_text … fontSizeMm 500`), then sets `lineHeight 10, letterSpacing 5`.
  2. On the PC the operator fixes one word in the canvas editor.
  3. The commit writes Size 300, Line height 5 and Spacing 2. The ink shrinks from 19,458 × 365 mm to 6,167 × 219 mm.
  4. Remote 0.5 mm micro-text doubles to 1 mm on the same kind of edit.
  5. No toast appears. The fields show the clamped values as though they had always been there.
- **Evidence:** REPRO, `zz-l3-remote.test.ts`:
  - `remote object size 500 lineHeight 10 letterSpacing 5 W 19458.0 H 365.2 -> desktop wording edit: size 300 lineHeight 5 letterSpacing 2 W 6166.7 H 219.1`;
  - `remote size 0.5 lh 0.1 ls -1 -> desktop edit size 1 lh 0.5 ls -0.5`.
- **Severity:** P2. The size change is visible on the canvas, but it is an unasked-for design change made by an unrelated edit.
- **Novelty:** new.
- **Fix direction:** Use one set of limits for every entry point, or let the desktop keep an unchanged out-of-range value and validate only the fields the user edits.
- **Refuter: CONFIRMED, P2 kept.**
  - **Read:** `buildTextObject` runs `sanitizeTextDialogNumericValues` (`build-text-object.ts:40`), which clamps to 1–300, 0.5–5 and −0.5–2 (`TextDialogNumericFields.tsx:11-16,51-59`). It shows no toast or notice.
  - **Own repro:** `zz-l3r-remote.test.ts`.
    - The remote makes `add_text` "Sign" at 500 mm, then `update_text {lineHeight:10, letterSpacing:5}`: ok, W 8420.90 × H 464.36.
    - A desktop `buildTextObject` of the same text, with one character added, gives **size 300, line height 5, spacing 2**, W 3028.42 × H 278.61.
  - **Why P2:** the change is large and visible on the canvas, and Undo restores it. Nothing burns differently from what the fields then show.

### L3-P2-4 — The jig text editor re-renders styled text without its style: Max width, Bold, Upper case, Weld overlaps and the text box are dropped from the geometry but kept as settings

- **Where:** `src/ui/workspace/registration-jig/jig-text-object.ts:29-65`:
  - `renderJigText` calls `renderTextGeometry` with raw content and no `textBox` (`:49-52`). It applies neither `styledTextContent`, `styleTextRender` nor weld.
  - It spreads `...existing` (`:55`), so `textStyle`, `weldOverlaps` and `textBox` survive.
  - `isAdvancedJigText` (`:18-27`) sends path, variable, bent and tabbed text to the main editor, but not styled, welded or boxed text.
- **Anchor:**
  - **Twin.** `buildTextObject` (desktop, canvas) and `renderVariableText` apply all of these.
  - **Contract.** ADR-321 Decision 1–3: Weld overlaps "commits" and resolves the overlaps; Decision 4 says the welded result is what downstream consumers see.
- **Scenario:** an existing text is edited in the jig editor with the same content, font and size:
  - **Max width 30:** 30.00 → 40.45 mm wide, past the width the operator set.
  - **Bold:** 41.05 × 9.24 → 40.45 × 8.64 mm.
  - **Upper case** "name tag": NAME TAG becomes lower case "name tag".
  - **Pacifico Hello with Weld overlaps:** 7 → 10 contours. The crossing joins come back, so a Line layer cuts through the letters.
  - **Text box 30 mm, wrap:** 24.61 × 21.46 becomes one 40.45 mm line.
  - Afterwards the main editor still shows every setting on: Max width 30, Bold, Upper case, Weld, Text box.
- **Evidence:** REPRO, `zz-l3-jig-text.test.ts`:
  - `max width 30: advanced? false; main editor W 30.00 … -> jig re-render … W 40.45 …; kept fields textStyle={"maxWidthMm":30}`;
  - `upper case: … W 47.70 H 7.30 contours 9 -> … W 40.45 H 8.64 contours 11; kept fields textStyle={"uppercase":true}`;
  - `pacifico weld: … contours 7 -> … contours 10; … weld=true`;
  - `text box 30 wrap: … W 24.61 H 21.46 -> … W 40.45 H 8.64 …; textBox=kept`.
- **Severity:** P2. The jig canvas redraws the changed text in the view where the edit is made. The settings that contradict the geometry are in the main editor, which is out of view. (Under the L2-P2-1 rule, a setting that still shows while the burn ignores it, the coordinator may raise this.)
- **Novelty:** new. G9's jig findings cover nudge, Escape and size fields, not text styles.
- **Fix direction:** Build jig text through `buildTextObject`'s pipeline, or extend `isAdvancedJigText` to styled, welded and boxed text.
- **Refuter: CONFIRMED, P2 kept.**
  - **Read:** `renderJigText` renders raw `content` with no `textBox`, style or weld, then spreads `...existing`. `isAdvancedJigText` checks only path, variable, bend, tabs and split operations. `JigTextControls.tsx:71` calls it on submit.
  - **Own repro:** `zz-l3r-remote.test.ts`, real `buildTextObject` and then `renderJigText` with the same content, font and size. `isAdvancedJigText` returned false for every case.

    | Case | Main editor | After the jig edit | Settings kept |
    |---|---|---|---|
    | Max width 30, "Hello world" | W 30.00 | **48.58** | `textStyle {"maxWidthMm":30}` |
    | Bold | 49.18 × 8.20 | 48.58 × 7.60 | `{"bold":true}` |
    | Upper case | 47.70 × 7.30, 9 contours | 40.45 × 8.64, **11** contours | `{"uppercase":true}` |
    | Pacifico Hello, Weld | **7** contours | **10** contours | weld true |
    | Text box 30 wrap | 23.74 × 21.60 | 48.58 × 7.60 | box kept |

  - **Why P2:**
    - The jig canvas redraws the changed text where the edit is made.
    - The contradicting settings appear only in the main editor (`TextStyleFields` is rendered only by `TextFormattingFields`). Its preview re-applies them, so no surface shows a setting next to geometry that ignores it.
    - The coordinator may still weigh the Weld case: on a Line layer it cuts through the letters.

### L3-P2-5 — Variable records in a text box or on a path are placed by their ink, not their baseline, so baselines jump 0.3–2.4 mm between records

- **Where:**
  - Text box: `src/core/text/text-box-render.ts:30-49` puts the ink top at the frame top (`y: point.y * scale`, `bounds.minY: 0`) and sets `anchor: { x: 0, y: 0 }`. `render-variable-text.ts:35-43` returns `transform: text.transform`, so no anchor correction runs.
  - Path text: `text-on-path.ts:34,69-73` lays the ink bottom (`bounds.maxY`) on the guide for "above", so descenders, not the baseline, sit on the path.
- **Anchor:**
  - **Twin.** Plain variable text keeps one baseline for every record (the anchor puts it on the template's first baseline, `variable-text-anchor.ts:1-6`: without it "the baseline jumps with its capitals and accents").
  - The same records in a box or on a path do not.
- **Scenario:**
  - **Text box:** a fixed 80 × 20 mm box, centred, Roboto 10 mm, `{{csv:name}}`.
    - X centring holds (0.000 off).
    - Ink bottoms differ: `Al` 342.500, `Anna` 342.793, `anna` **344.521**, against 342.104 for the plain control. A batch of tags therefore burns names at baselines 1.7 mm apart.
  - **Path text:** on a straight guide, `Peggy`'s baseline sits 2.04 mm higher than `Anna`'s (top 9.243 against 7.207 mm above the guide).
  - **Ordinary edits:** in a text box, changing "anna" to "Anna" moves the line down by the same amount.
- **Evidence:** REPRO.
  - `zz-l3-output.test.ts`: `textbox centre … anna: … Y 344.521..350.000`, `Anna: … Y 342.793..350.000`, against `centre plain … anna … Y 342.104..347.583`, `Anna … Y 342.104..349.312`.
  - `zz-l3-extra.test.ts`: `path text record "Anna": … top above guide 7.207 mm`, `"Peggy": … 9.243 mm`.
- **Severity:** P2. The vertical error is small and consistent within the frame rule. It is visible across a batch, and the canvas shows only the template.
- **Novelty:** new. No audit covers text-box or path-text variable placement.
- **Fix direction:** Give text-box and path-text renders a baseline anchor. Put the first baseline a fixed ascender below the frame top, and put the baseline (not the ink bottom) on the guide. Add record cases to the anchor tests.
- **Refuter: CONFIRMED, P2 kept.**
  - **Text box:** reproduced (`zz-l3r-output.test.ts`, fixed 80 × 20, centred, Roboto 10).
    - Every record's ink top is at Y 350.000.
    - Ink bottoms: `Al` 342.500, `Anna` 342.793, `anna` **344.521**.
    - Plain control: `Al` 342.202, `Anna` and `anna` 342.104.
  - **Path text:** confirmed by reading, not re-measured. `acrossReferenceY` returns `bounds.maxY`, the ink bottom, for "above" (`text-on-path.ts:69-73`), as its comment says. A descender record therefore lifts its baseline by the descender depth, about 2 mm at 10 mm Roboto.
  - **Why P2:** each record keeps the frame's own rule (ink top at the frame top), so nothing differs from what the frame promises. The defect is a visible inconsistency across a batch.

### L3-P3-1 — In a text box, Max width squeezes about the ink's left edge, so centred text lands far left of the frame centre

- **Where:** `src/core/text/text-style.ts:56-58` (`e: result.bounds.minX * (1 - k)`). This is applied after `finishTextBoxRender` has centred the ink (`text-box-render.ts:30`).
- **Anchor:** Twin. The frame's own centring (`text-box-render.ts:30`) is undone by the squeeze. This is area 15's "Not verified" item, now measured.
- **Scenario:** a 60 mm fixed box, centred, "Wide line of text", Max width 20. The ink spans −5.33 to 14.68 mm, centred at 4.68, where the frame centre is 30.00. Variable records squeeze about their own left edges too (READ).
- **Evidence:** REPRO, `zz-l3-extra.test.ts`: `box 60 centre max width 20: ink X -5.325..14.675 (frame centre 30.000, ink centre 4.675)`.
- **Severity:** P3. Visible on the canvas, and needs both features at once.
- **Fix direction:** For boxed text, squeeze about the alignment point inside the frame.
- **Refuter: CONFIRMED, P3 kept; numbers corrected.**
  - **Read:** the squeeze keeps the ink's left edge fixed (`text-style.ts:58`, `e: bounds.minX * (1 - k)`).
  - **Own repro** (`zz-l3r-extra.test.ts`): `buildTextObject`, 60 mm fixed box, centred, "Wide line of text", Roboto 10.
    - Without Max width the ink spans X 4.126..55.874, centred at 30.000.
    - With Max width 20 it spans **4.126..24.126**, centred at **14.126**: 15.9 mm left of the frame centre.
  - The report's −5.325..14.675 (centre 4.675) was not reproduced on this path. The mechanism and the direction hold.

### L3-P3-2 — Editing text in place keeps its ink top-left, so centred text drifts and the baseline drops when the first line gains a capital

- **Where:** `src/ui/text/use-canvas-text-draft.ts:89-92` keeps `original.transform`, and every render re-roots at its ink top-left (`text-to-polylines.ts:207-211`). The jig editor keeps the centre instead (`jig-text-object.ts:77-93`).
- **Anchor:**
  - **Ground truth.** LightBurn's Align X/Y is the text's "anchor position" (2.1 Text reference).
  - **Twin.** Variable output and the jig editor keep an anchor; the main editor does not.
  - ADR-320 item 4 ("Ordinary edits preserve the existing transform") is met literally.
- **Scenario:** centred "ace" at X 100:
  - typing "Ace" lowers the baseline 1.73 mm;
  - typing "ace and more" moves the centre 22.35 mm right.
- **Evidence:** REPRO, `zz-l3-extra.test.ts`: `centre 'ace' -> 'Ace': … (shift 1.729); centre X … (shift 0.740)`; `'ace and more': … centre X 107.539 -> 129.888 (shift 22.349)`.
- **Severity:** P3. Visible while editing; the behaviour is ADR-320's.
- **Fix direction:** Keep the render's alignment anchor fixed across edits (re-place by `anchor`, as output does), in an ADR-320 amendment.
- **Refuter: CONFIRMED, P3 kept.**
  - **Read:** `buildCanvasTextObject` keeps `original.transform` (`use-canvas-text-draft.ts:89-92`).
  - **Own repro** (`zz-l3r-extra.test.ts`): centred Roboto 10, under one kept transform at X 100.
    - `ace` centre 107.539, first-line ink bottom 55.479.
    - `Ace`: 108.279 / **57.207**, so the baseline drops 1.728 mm.
    - `ace and more`: centre **129.888**, a shift of 22.349 mm.

### L3-P3-3 — Remote `add_text` creates text with Weld overlaps off; the desktop creates it on

- **Where:** `src/ui/remote-control/text.ts:48` (`weldOverlaps: false`); desktop default `use-text-dialog-fields.ts:203` (`true` for new text).
- **Anchor:** Contract. ADR-321 Decision 1: "New editor sessions enable it". Twin with the desktop's new text.
- **Scenario:** MCP `add_text` "Hello" in Pacifico on a Line layer keeps the crossing joins (desktop: 7 welded contours; the same text unwelded has 10, as the jig repro shows). Cutting it out cuts through the letters. The remote has no weld field.
- **Evidence:** REPRO (`zz-l3-remote.test.ts` prints `weldOverlaps false`) plus READ.
- **Severity:** P3. The ADR scopes the default to editor sessions, and the joins are visible on the canvas.
- **Fix direction:** Default remote text to `weldOverlaps: true` for outline fonts, or add the field to `add_text`.
- **Refuter: CONFIRMED, P3 kept.**
  - **Repro:** every remote `add_text` object in `zz-l3r-remote.test.ts` has `weldOverlaps false` (`text.ts:48`).
  - **ADR:** ADR-321 Decision 1 says "New editor sessions enable it" (`DECISIONS.md:20344`). A remote write is not an editor session.

### L3-P3-4 — Test truth: no test pins Size against a real font's glyphs, bent or boxed variable placement, missing glyphs at output or over the remote, or the jig editor's styles

- **Where:**
  - `cnc-stroke-font.test.ts:61` (`capHeight > 0` only).
  - `stroke-font-text.test.ts:6-8` uses a synthetic font.
  - `variable-text-style-anchor.test.ts:97` (`bendDeg: 0`).
  - No test runs remote `add_text` with a missing glyph or `update_text` on a text box.
  - No jig test covers a styled text.
- **Anchor:** L7.
- **Evidence:** READ (grep of the named tests). Each of L3-P1-1…P2-5 passed every existing test that was run.
- **Fix direction:** Add the regressions named in each finding's fix direction.
- **Refuter: CONFIRMED, P3 kept** (READ).
  - `cnc-stroke-font.test.ts:61` asserts only `capHeight > 0`.
  - `variable-text-anchor.test.ts` and `variable-text-style-anchor.test.ts` have no non-zero `bendDeg` (`git grep`).
  - No remote-control or registration-jig test uses `textBox`.

## KNOWN re-observed

- **15-P2-1 / 15-P3-3** (styled variable anchor), fixed by #1359. Holds: plain centred records land within −0.305 to +0.347 mm of the template centre (`zz-l3-output.test.ts`), and `variable-text-style-anchor.test.ts` passes 5/5. The fix does not reach bent records (L3-P1-2) or text boxes (L3-P2-5).
  - **Refuter:** re-observed by its own repro. Plain centred records land at −0.305 / 0.000 / −0.198 / +0.347 mm.
- **15-P3-1** (opentype.js route against HarfBuzz route). Re-observed through remote: Pacifico "Café 李" lays out the visible "Café" 18.840 mm wide on the HarfBuzz route, against 19.550 mm for "Café" alone (`zz-l3-remote.test.ts`). The CJK character switches the route.
  - **Refuter:** re-observed (W 18.84 against 19.55 in `zz-l3r-remote.test.ts`).
- **15-P3-4** (bend and path text chords). Not re-measured. The rigid bend's Inspector width and burn width differ by 0.003 mm (36.069 against 36.066), which is within flattening.
- **15-P3-2** (Bold normalises even-odd). Not re-run.
- **02-P3-4 / G7-K-2** (`update_text` receipt not checked against the store). Re-observed by reading: the receipt carries only `changedArtworkIds`. It is the same receipt that carries no missing-glyph signal in L3-P1-3.

## Refuted

The refuter refuted none of the 13 raised findings.

The auditor dropped these candidates:

- **The Inspector W/H differs from the burn for styled or bent text.** Equal to 0.003 mm in 12 configurations (`zz-l3-output.test.ts`).
- **Bold text changes on save and reload.** Every one of 1298 points is identical. `deserializeProject` only adds a `curves` field next to the same polylines.
- **Weld loses counters or adds ink.** An independent non-zero winding sampler (0.13 mm grid, curves flattened to 0.002 mm) found 5–12 boundary samples out of 11,579–32,970 differing. Contours merge (Pacifico 16→11, Dancing 13→9, Great Vibes 9→4, Pacifico bent 120° 16→11) and bounds are unchanged. L1 found the same (−0.005 mm²).
- **Kerning is wrong or half applied.** Roboto and Tinos GPOS pairs match exactly. Poppins has no kern feature.
- **Path text that overflows its guide is truncated silently.** It is refused: "Text is longer than the available guide path." (`text-on-path.ts:31-33`).
- **A tab or CR burns as a missing glyph.** A tab lays out as one space, and CRLF equals LF (identical paths).
- **A stroke font drops unsupported characters.** It draws `?` and reports the character, as ADR-226 requires (`stroke 李: … missing ["李"]`).
- **Text box overflow is hidden or clipped.** It is shown in the dialog preview ("Overflow."), and output keeps the text (`TextBoxFields.tsx:39,135,148`).
- **Remote text has its own geometry engine.** It does not: it uses `renderTextGeometry` (`text.ts:24`, `text-edit.ts:48`). Its defects are what it leaves out.
- **Design Studio has a text tool twin.** It does not: no `TextObject`, font or `renderTextGeometry` use under `src/ui/design-studio`.

## Verified clean

- **Glyph metrics.**
  - Per-glyph positions and tops match `hmtx` + GPOS + `glyf` at 5, 10 and 37.5 mm in Roboto, Tinos and Poppins.
  - Alignment offsets match (w1 − w2)/2 and w1 − w2 to 1e-4 mm.
  - The line pitch is exactly Line height × Size.
  - Ink widths match the file to 1e-4 mm.
- **Displayed = Inspector = converted = saved = burned** for plain, two-line centred, Bold, Italic, Max width, Bend 90 (distorting and rigid), a fixed wrapped text box, Relief, EMS Casual Hand, Roboto `H`, and Pacifico with Weld. Checked through the real `buildTextObject` → `prepareOutputSnapshot` → `emitPreparedGcode`, `convertVectorObjectToPath` and `serializeProject`/`deserializeProject`.
- **Weld (ADR-321).** Counters are kept, joins merge, bent text welds, and bounds are preserved (sampler above). `text-weld.test.ts` passes 15/15.
- **Adversarial input (17 cases, core).** Empty, spaces-only, tab-only, CRLF, ZWSP-only, emoji, combining marks, Arabic in Roboto, sizes 1000 / 0.001 / 0 / −10 / NaN, letter spacing −1, a 5000-character line (2.8 s, 6250 contours) and a stroke font with CJK. None throws, every point is finite, and missing characters are reported each time. The desktop refuses empty or blank text ("Type some text first."). The remote refuses blank text and limits it to 4096 characters.
- **Text box wrapping.** Lines break at whitespace; a long word breaks at characters; centring of wrapped lines uses the advance of the trimmed lines.
- **Path text spacing.** The arc length along the guide equals the unbent x (`samplePath` on `start + point.x − minX`); orientation follows the segment normal; the guide transform is applied. Read only.

## Not verified

- **LightBurn itself was not run.** Its Height and Align behaviour come from the 2.1 docs. How LightBurn places bent variable text was not checked.
- **Browser rendering** of the canvas and of the editor's textarea overlay (`canvas-text-layout.ts`) was not run in a browser. The canvas draws the same `paths` (`object-display.ts`) that were measured here.
- **`get_text` after a remote width-shrink.** `add_text` with a narrow `widthMm` stores `sizeMm` unchanged and scales the transform (`text.ts:37-58`), so `get_text` reports the unscaled size. Read only; not raised.
- **The jig editor's reach.** Whether a styled text is commonly placed in the jig was not traced beyond `JigEditorSidebar.tsx:129` passing the selected text.
- **15-P3-4 chord error and 15-P3-2 Bold** were not re-measured.
- **Hardware:** none was used.

## Repro files

All files were in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\`, apart from the last row, which was in the scratchpad root. All were deleted after the runs. The `j7-main` folder and its `node_modules` junction were not touched otherwise.

| File | Purpose |
|---|---|
| `src\core\text\zz-l3-ttf.ts` | Independent TrueType table reader (head, hhea, OS/2, hmtx, cmap 4/12, glyf headers, GPOS PairPos 1/2 + Extension, legacy kern) |
| `src\core\text\zz-l3-metrics.test.ts` | Metrics table: kerning pairs at three sizes, capital height per font, alignment and line pitch, single-line sizes, `.notdef` per font |
| `src\core\text\zz-l3-weld.test.ts` | Independent non-zero sampler for weld (Pacifico, Dancing Script, Great Vibes, bent Pacifico) |
| `src\core\text\zz-l3-adversarial.test.ts` | 17 hostile inputs through the core renderer |
| `src\ui\text\zz-l3-output.test.ts` | Displayed = Inspector = converted = saved = burned (12 configurations); variable placement (plain, bent, rigid bent, text box, left); missing glyphs at output (L3-P1-1, P1-2, P1-4, P2-5) |
| `src\ui\text\zz-l3-extra.test.ts` | Bold reload, text box + Max width, in-place edit drift, output advisories, path-text records (L3-P1-4, P2-5, P3-1, P3-2) |
| `src\ui\remote-control\zz-l3-remote.test.ts` | Remote `add_text` with missing glyphs, desktop clamp of remote values, `update_text` on a text box (L3-P1-3, P2-2, P2-3, P3-3) |
| `src\ui\workspace\registration-jig\zz-l3-jig-text.test.ts` | Jig re-render of styled, welded and boxed text (L3-P2-4) |
| `…\scratchpad\zz-l3-decisions.md` | Copy of `DECISIONS.md` at `origin/main`, for ADR reading |
| `zz-l3r-vitest.config.ts` (refuter) | `fflate` alias, one worker, only `zz-l3r-*` tests |
| `zz-l3r-hb.mjs`, `zz-l3r-hb2.mjs` (refuter) | HarfBuzz metrics: kern pairs (`kern` on − off), `H` extents, raw `head`/`OS/2` sCapHeight, line widths for the alignment offsets |
| `src\ui\text\zz-l3r-output.test.ts` (refuter) | G-code capital heights for all four stroke fonts and Roboto (`H`, `X`, `I`, `E`, `H⏎H`); bent variable records (centre, rigid, right, left, −60, plain control); missing glyphs in records with `advisories`; text-box record baselines (L3-P1-1, P1-2, P1-4, P2-1, P2-5) |
| `src\ui\text\zz-l3r-extra.test.ts` (refuter) | Line-2 alignment offsets; text box + Max width; in-place edit drift (spot-check, L3-P3-1, P3-2) |
| `src\ui\remote-control\zz-l3r-remote.test.ts` (refuter) | Real adapter: `add_text`, `update_text` and `apply_edits` with missing glyphs; `update_text` on a text box; desktop clamp of remote values; `weldOverlaps`; jig re-render of styled, welded and boxed text (L3-P1-3, P2-2, P2-3, P2-4, P3-3) |
| `…\scratchpad\zz-l3r-svgfont.mjs` (refuter) | Reads a pinned SVG font from stdin (fetched with `curl`, never saved): SHA-256, `<font-face>` attributes, glyph y extents |

The refuter ran each test file alone with `node <repo>/node_modules/vitest/vitest.mjs run <file> --config zz-l3r-vitest.config.ts`. It deleted its files one at a time afterwards. Nothing under the `node_modules` junction was deleted or edited.

```json
[
  {"id":"L3-P1-1","severity":"P1","area":"text-typography","file":"src/core/text/stroke-font-text.ts","line":60,"anchor":"Ground truth: EMS SVG fonts @8c71f2d9 declare units-per-em 1000 cap-height 500 but the H reaches ~658-875 units (Casual Hand H path to y 910); Twin: Relief honours Size as capital height (10.000 mm); Contract: ADR-012 Verification 'cuts at correct dimensions'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro (buildTextObject->prepareOutputSnapshot->emitPreparedGcode): Size 10 G-code H/X/I Relief 10.000; Nixish 13.170/13.192/13.230; Decorous 13.533/14.292/13.304; Casual Hand 17.508/12.782/12.731 (E 15.998), H-newline-H 31.508. Pinned SVGs re-fetched, SHA-256 match, cap-height 500 vs capitals 636-875 units. No ADR sets the scale (ADR-226 approves styles). Correction: capitals 12.7-17.5 mm; only Casual Hand H/E collide, line 2 H top 4.2 mm above line 1 baseline. P1 kept: matches no Size convention, field still shows 10, no warning","known":false,"summary":"EMS Nixish, Decorous Script and Casual Hand are scaled by Size / cap-height 500 (generator takes the SVG attribute unchecked, generate-cnc-stroke-fonts.mjs:147); a Size 10 H burns 13.170, 13.555 and 17.508 mm (G-code Y 332.492..350.000), against Relief 10.000 and Roboto 7.109; default line height makes Casual Hand lines overlap by 3.5 mm"},
  {"id":"L3-P1-2","severity":"P1","area":"text-typography","file":"src/io/gcode/variable-text-anchor.ts","line":48,"anchor":"Twin: unbent variable records keep the template anchor (#1359, within 0.35 mm); Contract (code): variable-text-anchor.ts:1-6, TextRenderResult.anchor; Ground truth: LightBurn 2.1 Align X is the anchor position","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro (G1 X extents): centre bend 60 Al -23.341, Maximilian Alexander +19.209 (rigid -22.626/+19.172, bend -60 -21.465/+19.059, right -46.677/+38.424, left +-0.007); plain control -0.305/+0.347. No-anchor-for-bends is a code comment (text-to-polylines.ts:93-99), not an ADR; canvas shows the template string; no warning. P1 kept","known":"adjacent: G9 dropped 'stale anchor with bend' (G9-canvas-scene.md:388-390) on the fallback this finding measures","summary":"Bent text returns no anchor (text-bend.ts:98-109, text-style.ts:175-178), so each variable record hangs from the template's ink top-left: centred Roboto 10 mm {{csv:name}} bent 60 deg burns Al 23.34 mm left and 'Maximilian Alexander' 19.21 mm right of the template centre (rigid bend -22.63/+19.17); unbent control -0.31/+0.35"},
  {"id":"L3-P1-3","severity":"P1","area":"text-typography","file":"src/ui/remote-control/text.ts","line":24,"anchor":"Contract: ADR-591 Decision bullet 1 'unsupported font glyphs remain visible warnings'; Twin: desktop FontUsageHint lists them","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro via real adapter: Pacifico Cafe-li ok, 8 contours (= Cafe), receipt {changedArtworkIds} only; Roboto 7->12 (box); Inconsolata 7->7; update_text Cafe->Cafe-li ok 8->8, stored content keeps li. missingCharacters read only by the dialog hint/worker; writes.ts pushes no toast. Correction: text made only of missing glyphs in an empty-.notdef font is refused (unsupported_operation, width 0, text.ts:35-36). P1 kept","known":false,"summary":"Remote add_text (and apply_edits via design-batch.ts:71, update_text via text-edit.ts:48) ignores the render's missingCharacters: 'Café 李' in Pacifico creates 8 contours (same as 'Café') with receipt {changedArtworkIds} only; Roboto burns its .notdef box; Inconsolata, Pacifico, Great Vibes and Stardos have an empty .notdef and drop the glyph without trace"},
  {"id":"L3-P1-4","severity":"P1","area":"text-typography","file":"src/ui/text/render-variable-text.ts","line":8,"anchor":"Contract: ADR-591 Decision bullet 1; Twin: the editor hint checks CSV columns only while that text's editor is open (use-missing-characters.ts:42-46); VariableRowsPreview.tsx:89 displays the character","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: Pacifico records Zoe/Zoe-umlaut-li/li burn 190/222/0 moves, Inconsolata 106/138/0, Roboto 108/156/16 (box); advisories [] each time. Replacing the CSV from another panel is real: BarcodeFields.tsx:104 renders VariableTextFields bound to setVariableCsv with VariableCsvImport; import toasts only row count/encoding. Dialog hint warns only in the same text editor. P1 kept (reachable path, METHOD 3)","known":false,"summary":"Variable records are rendered at output with no missing-glyph check and advisories []; a project CSV replaced from another panel (e.g. a barcode's, VariableTextFields.tsx:51) burns Pacifico record '李' as nothing (0 moves) and 'Zoë 李' without 李, Roboto as a box, while the rows preview shows 李"},
  {"id":"L3-P2-1","severity":"P2","area":"text-typography","file":"src/core/text/text-glyph-geometry.ts","line":21,"anchor":"Ground truth: LightBurn 2.1 Text reference, Height 'generally the height of a capital letter X'; Twin: Relief single-line uses capital height (stroke-font-text.ts:60); tooltip 'Text height in millimeters.' (TextDialogNumericFields.tsx:80)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Facts confirmed by HarfBuzz + raw OS/2 (Roboto 7.109, Tinos 6.548, Inconsolata 6.230, Anton 8.594) and G-code; Relief 10.000; tooltip undefined. LightBurn 2.1 re-fetched: Height approximate, font-dependent, scales each font internal size. Kept P2, not P1 under L2-P2-1: em is the standard font-size convention applied exactly and the ground truth is itself approximate, so no single-meaning typed value is contradicted (unlike Corner radius or the EMS scale); the defect is a misleading label and an outline vs single-line inconsistency","known":false,"summary":"Outline Size is the em: at Size 10 capitals burn Roboto 7.109, Tinos 6.548, Inconsolata 6.230, Anton 8.594 mm, while Relief burns 10.000; LightBurn's Height is the capital height; may be P1 under the L2-P2-1 rule"},
  {"id":"L3-P2-2","severity":"P2","area":"text-typography","file":"src/ui/remote-control/text-edit.ts","line":48,"anchor":"Twin: desktop buildTextObject and renderVariableText pass textBox; the object's own textBox contradicts its geometry","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro via real adapter: 40x40 wrapped box, Roboto 10, 36.08 x 63.21 -> update_text {alignment:center} ok -> 145.92 x 9.74 one line, textBox kept; desktop same fields 35.44 x 63.21. Canvas draws no text-box frame, editor re-wraps on open. P2 kept","known":false,"summary":"Remote update_text renders without textBox and keeps the field: a 40x40 wrapped box (38.92 x 21.12) becomes one 87.55 x 5.84 mm line after update_text {alignment:center}; desktop renders the same fields 38.79 x 21.12; editableText refuses path/variable text but not boxes"},
  {"id":"L3-P2-3","severity":"P2","area":"text-typography","file":"src/ui/text/build-text-object.ts","line":40,"anchor":"Twin: remote limits (authoring-schemas.ts:33-35, size<=1000, lineHeight 0.1-20, spacing -1-20) vs desktop clamps (TextDialogNumericFields.tsx:11-16,51-59); authoring-text.test.ts pins only the remote side","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: remote add_text 500 mm then update_text lineHeight 10 letterSpacing 5 ok; desktop buildTextObject of the same text -> 300 / 5 / 2 (8420.90 x 464.36 -> 3028.42 x 278.61), no notice (sanitizeTextDialogNumericValues at build-text-object.ts:40). P2 kept: visible, undoable","known":false,"summary":"A desktop wording edit of remote-made text silently clamps size 500->300, line height 10->5, spacing 5->2 (19458x365 -> 6167x219 mm) and 0.5->1 mm, 0.1->0.5, -1->-0.5; no toast"},
  {"id":"L3-P2-4","severity":"P2","area":"text-typography","file":"src/ui/workspace/registration-jig/jig-text-object.ts","line":49,"anchor":"Twin: buildTextObject/renderVariableText apply styledTextContent, styleTextRender, textBox and weld; Contract: ADR-321 Decision 1-4","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro (real buildTextObject then renderJigText, isAdvancedJigText false each time): Max width 30 -> 48.58; Bold 49.18x8.20 -> 48.58x7.60; Upper case 9 -> 11 contours; Pacifico weld 7 -> 10 contours; 30 mm box 23.74x21.60 -> 48.58x7.60; settings kept. P2 kept: settings show only in the editor, whose preview re-applies them; coordinator may weigh the Weld case","known":false,"summary":"renderJigText renders raw content without style, box or weld but keeps textStyle/weldOverlaps/textBox (...existing); isAdvancedJigText does not catch them: Max width 30 -> 40.45 mm, Bold lost, Upper case NAME TAG -> name tag, Pacifico weld 7 -> 10 contours, 30 mm box unwrapped to 40.45"},
  {"id":"L3-P2-5","severity":"P2","area":"text-typography","file":"src/core/text/text-box-render.ts","line":49,"anchor":"Twin: plain variable text keeps one baseline via the anchor (variable-text-anchor.ts:1-6 'the baseline jumps'); text box (render-variable-text.ts:42) and path text (text-on-path.ts:69-73) place by ink","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro, text box: ink tops all Y 350.000, bottoms Al 342.500, Anna 342.793, anna 344.521 vs plain 342.202/342.104/342.104. Path text confirmed by READ (acrossReferenceY returns ink bottom for above, text-on-path.ts:69-73), not re-measured. P2 kept","known":false,"summary":"In a text box records hang from the frame top by their ink: anna bottom 344.521 vs Anna 342.793 vs plain control 342.104 (1.7-2.4 mm baseline jumps); on a path the ink bottom sits on the guide, so Peggy's baseline is 2.04 mm above Anna's"},
  {"id":"L3-P3-1","severity":"P3","area":"text-typography","file":"src/core/text/text-style.ts","line":58,"anchor":"Twin: text-box centring (text-box-render.ts:30) undone by the Max width squeeze pivot","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro (buildTextObject, 60 mm box, centre, Max width 20): ink X 4.126..24.126, centre 14.126 vs frame 30 (unsqueezed 4.126..55.874 centre 30.000). Mechanism confirmed (text-style.ts:58); the report figures -5.325..14.675 were not reproduced. P3 kept","known":"area 15 Not verified item, now measured","summary":"Centred text in a 60 mm box with Max width 20 lands at ink X -5.33..14.68 (centre 4.68) instead of centred on 30"},
  {"id":"L3-P3-2","severity":"P3","area":"text-typography","file":"src/ui/text/use-canvas-text-draft.ts","line":92,"anchor":"Ground truth: LightBurn Align X/Y anchor; Twin: output and jig keep an anchor; ADR-320 item 4 met literally","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: centred Roboto 10 under one kept transform: ace centre 107.539 bottom 55.479; Ace 108.279 / 57.207 (baseline drop 1.728); ace and more centre 129.888 (+22.349). use-canvas-text-draft.ts:92 keeps original.transform. P3 kept","known":false,"summary":"In-place edits keep the ink top-left: centred 'ace' -> 'Ace' drops the baseline 1.73 mm; 'ace and more' moves the centre 22.35 mm right"},
  {"id":"L3-P3-3","severity":"P3","area":"text-typography","file":"src/ui/remote-control/text.ts","line":48,"anchor":"Contract: ADR-321 Decision 1 ('New editor sessions enable it'); Twin: desktop default true (use-text-dialog-fields.ts:203)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: every remote add_text object weldOverlaps false (text.ts:48); ADR-321 Decision 1 scopes the default to editor sessions (DECISIONS.md:20344). P3 kept","known":false,"summary":"Remote add_text creates weldOverlaps:false, so Pacifico/Dancing text keeps crossing joins on Line layers where desktop text welds"},
  {"id":"L3-P3-4","severity":"P3","area":"text-typography","file":"src/core/text/cnc-stroke-font.test.ts","line":61,"anchor":"L7 test truth","evidence":"READ","verdict":"CONFIRMED","refuter":"READ: cnc-stroke-font.test.ts:61 capHeight > 0 only; no non-zero bendDeg in either anchor test; no remote-control or jig test uses textBox. P3 kept","known":false,"summary":"No test pins Size against real stroke-font glyphs, bent/boxed/path variable placement, missing glyphs at output or remote, remote update of a text box, or jig re-render of styled text"}
]
```
