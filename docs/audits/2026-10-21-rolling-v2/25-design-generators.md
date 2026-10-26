# Rolling audit v2 — Design generators (box, barcode, Design Studio, design carve)

- **When:** 2026-10-22 00:30–02:00 +0800   **Tree:** origin/main @ `902f1d0c0` (worktree HEAD
  `cc955ee4d`; `git diff --stat origin/main HEAD -- src/` is empty, and `git fetch` at the end still
  showed `902f1d0c0`).
- **Scope:**
  - Box generator: `src/core/box/**`, `src/ui/box/**`, and the insertion path
    `src/ui/state/box-insert-mutation.ts` → `object-insert-actions.ts` (`insertBoxPanelsAction`,
    `applyLayerDefaultsToFreshLayers`) → `cnc-auto-seeding.ts`.
  - Barcodes: `src/core/barcode/**`, `src/ui/barcode/**`, `src/ui/state/barcode-insert-mutation.ts`.
  - Design Studio: `src/core/design/**`, `src/ui/design-studio/**` (core ops, entity geometry, Apply
    mutation `src/ui/state/design-apply-mutation.ts`); design carve `src/core/design-carve/**`.
  - Variables: only what report 15 left (`parse-csv.ts`, `evaluate-template.ts`, `date-pattern.ts`).
  - `src/ui/artcraft-studio/**` (UI only, light pass; area 28 owns the AI/native side).
  - Governing: ADR-106 (+ Amd 1, Amd 2), ADR-116, ADR-119, WORKFLOW F-K1..F-K9; ADR-386 (+ Amd 1,
    Amd 2); ADR-272 (+ Amd 1 clause 2 and 4, Amd 4); ADR-486 (kerf sides). Prior audits:
    `docs/audits/2026-07-31-box-generator-audit-and-redesign-ledger.md` (BG-001..BG-018),
    `2026-10-15-tools-create-calibrate.md`, `2026-10-16-tools-quality-register.md` rows 12, 13, 60.
- **Lenses run:** L2 (primary sources fetched: thonky.com QR tables, Wikipedia Code 128 wikitext,
  ZXing `MaskUtil.java`, boxes.py docs, LightBurn Bar Code docs), L3, L4, L1, L7 as separate
  passes. L5 only for `.lf2` barcode fields (validator read) and CSV import; L6 light (generator
  failure values, barcode commit staleness).
- **Method:** independent decoders written for this audit (QR from the ISO 18004 rules plus the
  fetched block and alignment tables; Code 128 from the fetched Wikipedia width table), an
  independent 3D occupancy check of generated boxes, and store-level repros. Repro files were
  temporary `zz-25-*` files, run one at a time with `--maxWorkers=1`; they are archived in this
  session's scratchpad (`…/scratchpad/a25/repros-25/`) and deleted from the repo.
- **Counts:** 4 raised → refuter: confirmed 4, plausible 0, refuted 0 (no severity changes) → P1 0 / P2 1 / P3 3 (+ 7 KNOWN re-observed).

## Headline

The encoders and the joint geometry are right. An independent QR decoder read back 420 generated
symbols across all 40 versions and four levels (numeric, alphanumeric, byte and UTF-8 emoji data)
with every Reed–Solomon syndrome zero and correct padding. The block table matches thonky.com for
all 160 version–level rows, and the alignment centres match for versions 2–40. All 107 Code 128
width patterns match the published table, and 3,011 random ASCII 0–127 strings decoded back
exactly. Sampling the drawn outlines at module centres, normal and inverted, gives the same codes.
Generated boxes (closed, open top, odd outer sizes, single-cell edges, 6.35 mm stock, clearance,
1–3 dividers) assemble in a 3D occupancy check with no overlap and no gap. Laser kerf
compensation runs in the right direction at compile.

The one P2 is at the CNC insertion seam. On the Neotronics 4040 profile with no stock material,
new operations are seeded with the starter's 1/8" bit. The Box Generator and Box Fit Test size
their dogbones (and validate fingers) for the machine's active bit instead. With a 1/16" active
bit, the panels go to an operation that cuts with 1/8", and the bit reaches no seat corner on any
panel, so the tabs cannot seat. Design Studio Apply already strips the seeded bit for exactly this
reason.

## Findings

### P2-1 — CNC box dogbones are sized for the active bit, but the inserted operation is seeded with the 4040 starter bit; tabs cannot seat

- **Where:**
  - Relief and finger validation use the active bit: `src/ui/box/BoxGeneratorHost.tsx:22` and
    `src/ui/box/BoxFitTestHost.tsx:20` (`toolDiameterMm: activeCncTool(machine).diameterMm`).
  - The operation is created with no `toolId` (`src/ui/state/box-insert-mutation.ts:116-120,
    144-148`). Then `insertBoxPanelsAction` (`src/ui/state/object-insert-actions.ts:208-222`) runs
    `applyLayerDefaultsToFreshLayers` → `seedFreshCncLayer` (`src/ui/state/cnc-auto-seeding.ts:35-44`).
  - With no stock material, `resolveCncAutoLayerSettings` takes the starter path
    (`src/core/cnc/machine-starters/resolve-cnc-auto-settings.ts:65-66`), which writes
    `toolId: starter.tool.toolId` (`:83`, `em-3175` for the 4040 starter).
- **Anchor:**
  - Contract: ADR-106 Amd 1 decision 3, "After profile-outside compensation with the relief tool,
    the bit centre passes within one radius of every seat corner".
  - Contract: WORKFLOW F-K1/F-K3, relief tool "prefilled from the active tool".
  - Twin: `src/ui/state/design-apply-mutation.ts:227-228` strips the seeded `toolId` /
    `vClearToolId`, so a Design Studio operation with no bit cuts with the active bit that its
    preview showed. Box insertion has no such step.
- **Scenario:**
  1. On the 4040 profile in CNC mode, with no project stock material (the default after choosing
     the machine), select a 1/16" (1.5875 mm) end mill as the active bit.
  2. Open Box Generator. Relief tool diameter prefills 1.5875 and validation accepts the fingers.
  3. Generate. The "Box panels" operation is profile-outside at full depth, but with
     `toolId: em-3175`, so it cuts with 3.175 mm.
  4. The dogbones were drawn for r = 0.79 mm. The 1/8" bit cannot enter them, so every seat
     corner keeps a ~1.6 mm fillet and square tabs do not seat. Box Fit Test strips take the same
     path.
  - The reverse case (active bit larger than 1/8") only oversizes the dogbones.
  - The operation row does show the 1/8" bit. Nothing ties it to the relief size the dialog
    showed.
- **Evidence:** REPRO.
  1. Store-level Vitest (`zz-25-box-tool.test.ts`): `replaceDeviceProfile(4040)` →
     `setMachineKind('cnc')` → active tool `em-1588` (1.5875) → `generateBox` with relief 1.5875 →
     `insertBoxPanels`. Output:
     `{"name":"Box panels","cutType":"profile-outside","depth":6,"toolId":"em-3175","cutsWith":3.175,"feedSource":"machine-starter"}`.
  2. The same box with relief sized for 1.5875, checked with the repo's own
     `bitReachesSeatCorners` helper: `reach1588: true` and `reach3175: false` for all six panels.
  - Novelty: BG-013 (July) noted that "all Box unit tests bypass the real store seeding step".
    This finding is a different consequence of that untested seam. Not in `docs/audits/`; no open
    PR touches the path (#1351/#1352 change other parts of `object-insert-actions.ts`).
- **Refuter:** CONFIRMED (REPRO), P2 kept. I rendered the real `BoxGeneratorHost` and
  `BoxFitTestHost` (4040 → CNC → active `em-1588`, no material), and both prefill relief 1.588. Both
  insert "Box panels" with `toolId: em-3175`, so `layerCncTool` = 3.175, the compiler's bit. The
  repo's `bitReachesSeatCorners` gives r1588 true and r3175 false on all six panels. With stock
  material `plywood-mdf` there is no `toolId`, so it cuts with 1.588 and has no mismatch. That
  confirms the starter path is the only trigger.
  - Mitigation the auditor missed: Job Review does warn. `detectMinFeatureWarnings` on the
    inserted project returns `Layer "Box panels": 40 gaps … narrower than the 3.17 mm bit (3.175 mm
    (1/8") end mill) — the bit cannot fit into them, so they stay uncut` (24 for the fit strips). It
    returns nothing when the relief matches the bit.
  - So the output is not silent, which rules out P1. It is still a broken ADR-106 Amd 1 contract
    with a misleading dialog prefill. The warning names gaps, not the bit swap.
  - Reach: today only the 4040 profile (the only starter-catalog entry, not the default device),
    the default no-material stock and a non-1/8" active bit.
- **Fix direction:**
  - Box insertion should pin its operations to the bit the relief was sized for: write `toolId`
    (or strip the seeded one, as design Apply does). Or the dialog should take the bit a fresh
    operation will actually get.
  - Add a store-level insert → compile test with an active bit other than the starter bit.

### P3-1 — Box panels take a saved Fill default whole, so a box can come out engraved as six filled plates

- **Where:** `src/ui/state/object-insert-actions.ts:208-222` passes `state.layerDefaults`
  unfiltered. `applyLayerDefaultSettings` (`src/ui/layers/layer-default-settings.ts:42-62`) copies
  every field except id, colour and cnc, so `mode` is copied too. Panels are black (`#000000`)
  artwork, so the black or all-colours default applies.
- **Anchor:**
  - Contract: WORKFLOW F-K1 step 4, the laser fit contract is stated for "Line mode cut settings".
  - Twin: barcode insertion keeps only Fill defaults for the same reason, the other way round
    (`barcode-insert-mutation.ts:70`, ADR-386 Amd 1). SVG import strips `mode` from defaults
    (`svgStructuralDefaults`, `object-insert-actions.ts:369`).
- **Scenario:** an operator who engraves black artwork saves Make Default with Fill for black, then
  generates a box. The "Box panels" operation is Fill, and Start raster-fills every panel instead
  of cutting it. Preview and Job Review do show Fill.
- **Evidence:** REPRO. Store Vitest: `setLayerDefaults({byColor:{'#000000':{mode:'fill',…}}})` →
  `insertBoxPanels` → `{"mode":"fill","kerf":0}`.
- **Refuter:** CONFIRMED (REPRO), P3 kept. Through the real `BoxGeneratorHost` (laser), I set a black
  layer to Fill, ran `makeLayerDefault` (which turns `applyToNewOperations` on) and clicked Generate.
  The panel operation came out `mode: "fill"`, and its name was replaced too: it became "Operation"
  (the captured default's name) instead of "Box panels". It only applies after Make Default in the
  session, or with the auto-apply preference on.
- **Fix direction:** filter box defaults to Line ones (mirror `fillDefaultsOnly`) or force
  `mode: 'line'` after defaults. **Maintainer decision:** whether a colour default should ever
  override a generator that only makes sense as a cut.

### P3-2 — A barcode scaled on the canvas burns modules the size checks never see

- **Where:**
  - `src/core/barcode/barcode-layout.ts:73-79` (refuses modules under 0.05 mm) and `:99-111` (warns
    under 0.2 mm and for short quiet zones) read only `spec.moduleMm` / `spec.widthMm`.
  - `applyReplaceBarcode` keeps the object's transform (`barcode-insert-mutation.ts`), and the
    edit dialog shows the unscaled spec.
  - No output-side barcode check exists apart from the 144 × 144 Data Matrix warning
    (`src/ui/laser/data-matrix-scan-warnings.ts`).
- **Anchor:** Contract: ADR-386 item 2 ("Modules under 0.05 mm are refused. Modules under 0.2 mm
  … draw with a warning"). ADR-386 Consequences says canvas scaling scales the modules, but
  nothing re-checks them.
- **Scenario:**
  1. Insert a QR at 0.6 mm modules (no warning) and scale it to 25 % on the canvas to fit a tag.
     It burns 0.15 mm modules.
  2. No warning appears in the dialog (Edit still shows 0.6 mm), in Job Review or at Start.
  3. At 8 %, it burns modules below the 0.05 mm refusal floor.
  - The artwork panel summary does show the scaled overall size
    (`SelectedBarcodeSummary.tsx:18-19`).
- **Evidence:** READ.
- **Refuter:** CONFIRMED (two lines), P3 kept.
  - `layoutWarnings` and the 0.05 mm refusal read only `spec`.
  - `BarcodeDialogHost` edits `editing.spec`, and `applyReplaceBarcode` keeps `...existing`, so
    the transform survives.
  - The only output-side check, `min-feature/operation-targets.ts`, skips Fill operations, and
    `data-matrix-scan-warnings.ts` checks only the 144 × 144 size. No barcode scale lock exists.
  - ADR-386 Consequences does document that canvas scale scales the modules, so this is a missing
    re-check, not a hidden behaviour.
- **Fix direction:** evaluate the module-size warnings on the effective (transformed) module, in
  the dialog's edit mode and in Job Review warnings.

### P3-3 — (L7) No test pins the Code 128 width table to a published source

- **Where:**
  - `src/core/barcode/linear-codes.test.ts:25-34` checks only structure: 106 distinct patterns,
    11 modules each, even bar sums, and the stop pattern.
  - The reference decoder imports the encoder's own `CODE128_WIDTHS`
    (`src/__fixtures__/barcode/linear-decoders.ts:6`). Every round trip therefore shares the table.
  - The one hand-written module string (`:46-64`) is compared only by length and decoded with the
    same table.
- **Anchor:** Contract: ADR-386 Verification already admits the Code 128 decoder "shares the
  encoder's width table, so those round trips alone do not independently validate that table".
  Ground truth: the Code 128 table (Wikipedia, from ISO/IEC 15417 Table 1).
- **Scenario:** a transposed pattern that keeps the structural invariants (for example two values'
  patterns swapped) keeps every test green and engraves codes that scan as different data.
- **Evidence:** READ, plus this audit's check. The current table matches all 106 patterns and the
  stop pattern of the fetched Wikipedia wikitext (`mismatch []`), so nothing is wrong today.
- **Refuter:** CONFIRMED (two lines), P3 kept, with one correction. `readCode128(expected)`
  decodes the hand-written string through the shared table. Its patterns therefore are pinned:
  values 103, 64, 33, 34, 100, 65, 66, 101, 80 and 22, plus the stop.
  - A swap involving any of those would fail. The other ~96 patterns are unpinned.
  - No other test holds a Code 128 module string or snapshot (grep of `src/**/*.test.*`).
  - ADR-386 line 145 admits the shared table.
- **Fix direction:** pin the 107 patterns to the published table, or the module string of a
  reference symbol from an independent encoder, as is already done for EAN, UPC and Code 39.

## KNOWN re-observed (still open on `902f1d0c0`)

- **K-1 (02-P3-3):** Edit barcode on Pro-bound artwork commits with a raw
  `useStore.setState(replaced)` (`src/ui/barcode/commit-barcode.ts:67`). Open PR #1346 targets it.
- **K-2 (BG-006 / BG-007, July box ledger):** `BoxAssembledPreview.tsx:116-137` draws one face per
  part at `w = T`, while its header says "extruded plates". Min-side panels show their inner face.
- **K-3 (BG-017):** `parseBoxDraft` leaves the divider fields out of the required list, so a
  blank field becomes `Number('') === 0` (`src/ui/box/box-draft.ts:130-142, 161-162`).
- **K-4 (BG-018 / BG-014):** F-K5 says a repeated Generate lands "offset onto the same layer
  colour". Each Generate creates a new operation (`Box panels 2`), and the sheet always starts at
  (0, 0) with an identity transform (`layout.ts:24-36`), so a second set lands on the first.
- **K-5 (BG-010):** part spacing is measured between nominal fitted bounding boxes, before layer
  kerf or bit offset (`layout.ts`).
- **K-6 (BG-011):** inserted panels keep no `BoxSpec`; a box cannot be reopened parametrically.
- **K-7 (ADR-386 Amd 2):** output still builds 144 × 144 Data Matrix in the standard's block order,
  which common readers may not scan; Job Review warns. This is a documented, decided limitation.

## Refuted

- **QR penalty rule 3 ignores the area outside the symbol (should count the quiet zone as
  light).** Refuted. ZXing's `MaskUtil.isWhiteHorizontal` / `isWhiteVertical` return `false` when
  the four-module run leaves the symbol, exactly as `qr-mask.ts:109-115` does. Both ZXing
  reference symbols (with their mask choice) are reproduced by the existing test.
- **Box CNC panels cut on-path (BG-013).** Fixed since July. `withCncCut` sets profile-outside at
  full thickness (ADR-106 Amd 2), and the repro shows `cutType: profile-outside, depth: 6`.
- **Box CNC relief default off (BG-003).** Fixed. `defaultBoxDraft` sets `relief: 'on'` for CNC.
- **Design Studio carve preview pocket floors ignore bit radius.** Not a finding. ADR-272 Amd 1
  clause 4 labels the instant tier as the target surface, and the Simulate tier compiles the real
  toolpaths.
- **Design Studio Apply is two Undo steps (defaults pass, then carve patch).** Refuted. Both run
  inside one `set` in `applyDesignSketchAction`, with one `pushUndo` in `applyDesignSketch`.
- **Box Generator inserts a stale preview.** Refuted. Generate inserts
  `generation.currentSnapshot` (`BoxGeneratorDialog.tsx:56`), and stale snapshots never enable
  Generate.

## Verified clean

- **QR encoder (L2 + independent decode).**
  - `qrBlockLayout` equals thonky.com's table for all 160 rows (data codewords, EC per block,
    blocks).
  - `qrAlignmentCentres` equals thonky's table for versions 2–40.
  - `qrFormatBits(L, 4)` = `110011000101111`, thonky's worked example. The version word for v7
    is `000111110010010100`. The dark module is at (8, 4V+9).
  - Masks 0–7 match ISO 18004 Table 10 (i = row, j = column).
  - Version-info placement matches thonky's fill order.
  - The independent decoder read back 420 symbols across v1–v40 and L/M/Q/H, with all syndromes
    zero, correct terminator and 0xEC/0x11 padding, and the level and mask as encoded.
- **Code 128.**
  - Widths 0–105 and the 13-module stop match the Wikipedia/ISO 15417 table.
  - Code-set switch values match: A = 101, B = 100, C = 99; Shift = 98 in A/B only.
  - Start values 103/104/105. Checksum weights start and first data symbol at 1, modulo 103.
  - Quiet zone 10X (Wikipedia: "minimum width … is 10x").
  - 3,011 random strings, including control characters, DEL, GS and odd digit runs, decoded back
    exactly.
- **Layout twin.** The drawn outlines, sampled at module centres with an even-odd point test
  (normal and inverted, quiet zone 0 and 4), decode to the same QR and Code 128 data, and inverted
  quiet zones are engraved. `widthMm = (size + 2·quiet)·module` exactly.
  - Barcode paths are one `fillRule: 'evenodd'` path (`materialize-barcode.ts:88`), so winding
    does not matter.
  - The QR quiet-zone default of 4X matches ISO 18004 as paraphrased by 2dtg; the primary was not
    reachable.
- **Other linear codes (read against published tables).**
  - Codabar's 20 patterns, ITF's digit patterns and start/stop, Code 93's C/K weights (20/15,
    mod 47) and Full ASCII map, UPC-E's parity table for number systems 0 and 1 with its
    expansion rules, and the ISBN-10 mod-11 check all hold.
- **Barcode beam compensation.** LightBurn's Bar Code tool offers no bar-width or beam
  compensation either (docs.lightburnsoftware.com/Tools/BarCode.html), so engrave-time spread is
  left to scan tests in both apps. Code 128 decodes by edge-to-similar-edge, which tolerates
  uniform bar growth.
- **Box joint geometry (independent 3D occupancy check).** Each part was placed into the box by
  its face slab; dividers by their pitch; samples on a 0.29 mm grid with irrational offsets, 1.5–8
  million per case.
  - Cases: closed; open top; outer mode 73.3 × 41.7 × 27.9 at T = 3.2; 5 mm inner height
    (single-cell edges); 6.35 mm stock; clearance 0.2; dividers 1 × 1, 2 × 0 open top, and 1 × 2
    with clearance.
  - Results: 0 overlapping samples, 0 shell gaps at c = 0, nothing outside the box, nothing in the
    cavity except dividers.
  - Odd cell counts put the primary panel next to every corner cube, and corner cubes go Z > Y > X.
  - boxes.py's model is equivalent (fingers/spaces with play; "burn" baked into the drawing, "bigger
    values for tighter fit"). KerfDesk puts burn in layer kerf, as ADR-106 decides.
- **Kerf direction at compile.** A front panel with one divider slot, compiled through a line layer
  at kerf 0.1: outline 66 × 36 → 66.2 × 36.2 and slot 3 × 10 → 2.8 × 9.8. The beam ends on the
  drawn edge both ways (ADR-486).
- **Clearance law.** δ = c/4 inward gives notch − tab = c. The fit coupon bakes f ∓ c/2 (ADR-119).
  The referee is skipped only for deliberate negative clearance.
- **Design Studio core.**
  - Quarter-turn and flip transforms of arcs map start angle and sweep correctly.
  - Ellipse quarter turns swap radii.
  - Stretch is exact by kind (circle → ellipse, arc baked).
  - Fillet uses t = r/tan(θ/2) with the centre on the bisector at r/sin(θ/2).
  - Chamfer is exact.
  - Numeric edits rebuild through `sanitizeEntity` (non-finite and below 0.01 mm ignored).
  - Rect, circle and ellipse insert as exact shape specs; line, arc and path as baked polylines
    with identity transform.
  - Apply is one Undo step.
  - Design carve and Apply agree on the bit: both strip the seeded bit and fall back to the active
    one.
- **Variables beyond report 15.**
  - The CSV parser handles BOM, CRLF, a CR inside quotes (→ LF), doubled quotes, blank lines
    (skipped and counted), uneven rows, duplicate and blank headers, and 10 MB / 100k-row /
    1k-column caps.
  - The delimiter is detected from the header only.
  - Date codes come from local time, with %j leap handling. Serial width 1–20 and offsets are
    bounded.
- **ArtCraft studio UI (light).** The Apply re-import target is keyed by a unique
  `kerfdesk-studio-<id>` file name. Epoch and owner guards run before and after every await.
  Exactly one Undo entry is written.

## Not verified

- **Physical output.** No box was cut and no code was engraved or scanned. Module growth from
  beam spot, stock thickness variation and real press fit remain hardware questions (BG-012).
- **Data Matrix.** It was not independently decoded. Its tests rely on ZXing vectors and the repo's
  own reader.
- **EAN/UPC/Code 39/Code 93 patterns.** Read, not independently decoded.
- **Slide-lid geometry.** It was not placed in the independent 3D check; the existing slide-lid
  referee was not re-derived.
- **QR byte mode without ECI.** It carries UTF-8 with no ECI (ADR-386 scope). Reader behaviour for
  non-ASCII on strict ISO-8859-1 readers was not tested.
- **Design Studio UI.** Pointer gestures, snapping, the 3D viewport, session recovery and the
  Simulate tier were read only in part; no browser run.
- **ArtCraft native editors and AI.** Area 28.
- **P2-1 beyond the 4040 profile.** Whether other starter catalogs will pin bits the same way:
  today the catalog has one entry.

```json
[
  {"id":"P2-1","severity":"P2","area":"design-generators","file":"src/ui/box/BoxGeneratorHost.tsx","line":22,"anchor":"Contract: ADR-106 Amd 1 decision 3 (bit reaches every seat corner with the relief tool); WORKFLOW F-K1/F-K3 relief prefilled from active tool; Twin: design-apply-mutation.ts:227-228 strips seeded toolId","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"On the 4040 profile with no stock material, box and fit-coupon dogbones are sized for the active bit but the inserted operation is seeded with the starter 1/8\" bit; with a 1/16\" active bit no seat corner is reachable and tabs cannot seat (refuter: Job Review min-feature check does warn that gaps narrower than the 1/8\" bit stay uncut)"},
  {"id":"P3-1","severity":"P3","area":"design-generators","file":"src/ui/state/object-insert-actions.ts","line":208,"anchor":"Contract: WORKFLOW F-K1 step 4 (Line mode cut settings); Twin: barcode-insert-mutation.ts:70 fillDefaultsOnly, object-insert-actions.ts:369 svgStructuralDefaults","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Box panels take a saved black/all-colours Fill default including mode, so the box operation becomes Fill and panels are engraved instead of cut"},
  {"id":"P3-2","severity":"P3","area":"design-generators","file":"src/core/barcode/barcode-layout.ts","line":99,"anchor":"Contract: ADR-386 item 2 (refuse < 0.05 mm, warn < 0.2 mm) vs ADR-386 Consequences (canvas scale scales modules)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"A barcode scaled on the canvas burns modules smaller than the refusal/warning limits with no warning in Edit, Job Review or Start"},
  {"id":"P3-3","severity":"P3","area":"design-generators","file":"src/core/barcode/linear-codes.test.ts","line":25,"anchor":"Contract: ADR-386 Verification (decoder shares the width table); Ground truth: Code 128 table (Wikipedia / ISO/IEC 15417)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No test pins the 107 Code 128 width patterns to a published table; the reference decoder imports the encoder's table (table itself verified correct by this audit)"},
  {"id":"K-1","severity":"P3","area":"design-generators","file":"src/ui/barcode/commit-barcode.ts","line":67,"anchor":"Contract: ADR-592 decision 5","evidence":"READ","verdict":"PENDING","known":"02-P3-3 (open PR #1346)","summary":"Barcode edit on Pro-bound artwork commits via raw setState"},
  {"id":"K-2","severity":"P3","area":"design-generators","file":"src/ui/box/BoxAssembledPreview.tsx","line":116,"anchor":"Contract: ADR-119 / F-K9 extruded plates","evidence":"READ","verdict":"PENDING","known":"BG-006 / BG-007 (2026-07-31 box ledger)","summary":"Assembled preview draws one face per part at w=T, not extruded plates"},
  {"id":"K-3","severity":"P3","area":"design-generators","file":"src/ui/box/box-draft.ts","line":130,"anchor":"Contract: F-K1 empty state","evidence":"READ","verdict":"PENDING","known":"BG-017","summary":"Blank divider fields parse as 0 instead of reporting Enter a value"},
  {"id":"K-4","severity":"P3","area":"design-generators","file":"src/core/box/layout.ts","line":24,"anchor":"Contract: WORKFLOW F-K5 edge (repeated Generate)","evidence":"READ","verdict":"PENDING","known":"BG-018 / BG-014","summary":"Repeated Generate creates a new operation and lands on the previous sheet at (0,0), unlike F-K5's wording"},
  {"id":"K-5","severity":"P3","area":"design-generators","file":"src/core/box/layout.ts","line":31,"anchor":"Twin: kerf/bit offset at compile","evidence":"READ","verdict":"PENDING","known":"BG-010","summary":"Part spacing is nominal, before kerf or bit offset"},
  {"id":"K-6","severity":"P3","area":"design-generators","file":"src/ui/state/box-insert-mutation.ts","line":172,"anchor":"Product proposal","evidence":"READ","verdict":"PENDING","known":"BG-011","summary":"Inserted panels keep no BoxSpec; the box cannot be reopened parametrically"},
  {"id":"K-7","severity":"P3","area":"design-generators","file":"src/core/barcode/data-matrix-encode.ts","line":1,"anchor":"ADR-386 Amendment 2 decision 2","evidence":"READ","verdict":"PENDING","known":"ADR-386 Amd 2 (decided limitation)","summary":"Output builds 144x144 Data Matrix in standard block order that common readers may not scan; Job Review warns"}
]
```
