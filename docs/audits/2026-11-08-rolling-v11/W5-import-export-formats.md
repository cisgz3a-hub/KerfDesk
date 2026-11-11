# Rolling audit v11 — Import and export formats (W5 `import-export-formats`)

- **When:** 2026-11-08 to 2026-11-09   **Tree:** main @ `a3965a77d` (repro tree: scratchpad `j11-main`, an export of that SHA). The audit started on `5f09e1110` (scratchpad `j10-main`) and was interrupted. It was then re-run and re-pinned on `a3965a77d`. Between the two SHAs only #1617 (white ink), #1611 (worker-only libraries leave the boot bundle), #1601 and #1618 touch this area. Their diffs in `src/io/**` are the white-ink field, `minOf`/`maxOf` in place of spread `Math.min/max`, and import-path changes. None of them changes a finding below.
- **Scope:**
  - **Importers:** SVG (`src/io/svg/**`, `src/io/xml/**`), DXF (`src/io/dxf/**`), PDF/AI (`src/io/pdf/**`, `src/ui/import/pdf-artwork-source.ts`), raster and TIFF (`src/ui/trace/image-loader.ts`, `src/io/tiff/**`, `src/io/raster-decode/**`, `src/ui/commands/batch-raster-decode.ts`), LightBurn `.lbrn/.lbrn2`, `.clb`, `.lbdev` (`src/io/lightburn/**`), and routing (`src/ui/app/import-dispatch.ts`, `src/ui/import/document-import-source.ts`).
  - **Project files:** `.lf2` serialise, deserialise, validate and migrate (`src/io/project/**`), and the insertion guard (`src/ui/state/project-insertion-budget.ts`).
  - **Exports:** SVG (`src/io/svg/export-*.ts`), DXF (`src/io/dxf/dxf-writer.ts`, `export-dxf.ts`), PDF/AI/EPS (`src/io/vector-formats/**`), Print (`src/ui/app/print-artwork.ts`), and the G-code Save path (`src/ui/app/save-gcode-emission.ts`, read only).
  - **Governing ADRs:** ADR-046 (SVG units), ADR-268 and Amds 1–2 (XML/SVG bounds, linear-time readers), ADR-269 and Amd 2 (DXF expansion), ADR-357 Amd 1 (TIFF), ADR-388 (LightBurn import), ADR-404 (orientation), ADR-431/452 (vector export, DXF), ADR-468, ADR-681 Amd 1 (export colours), ADR-307 Amd 2 (loader limits at import), ADR-628 Amd 1 (fonts), ADR-686 Amd 1 (white ink).
  - **L8:** PRs merged in these paths since 2026-10-28:
    - #1505 (L7 round trips);
    - #1507 (text em);
    - #1523, #1538 (frame-line migrations);
    - #1537 (Fill pools in export);
    - #1544;
    - #1557 (photo import worker);
    - #1580 (file messages);
    - #1587;
    - #1611, #1617.
- **Lenses run:**
  - **L3 (twins):** DXF units, blocks and INSERT transforms; SVG units, viewBox and preserveAspectRatio; PDF page boxes and UserUnit; the LightBurn frame and cut-setting mapping; and export → re-import for SVG, DXF and `.lf2`.
  - **L4/L5 (adversarial and trust boundary):** entity expansion and XXE, script and event-handler content, external `href`s, NaN, Infinity and extreme coordinates, ReDoS re-checks, truncated and out-of-range `.lf2`, and the print iframe.
  - **L6 (failure paths):** truthful refusal, no half-imported state, and Save/autosave after an import.
  - **L8:** as listed in Scope.
  - L1 and L2 were folded into the passes above. No new outside source was fetched; ground-truth claims reuse earlier reports' pinned sources. L7 was not run as a pass.
- **Repros:** Node 25 with the real TypeScript modules through an esbuild transform hook. The streamed SVG/XML route uses the real `linkedom` and `saxes` reader.
  - Run from scratchpad `zz-w5/`: `node --import ./register.mjs <script>.mts`.
  - Scripts: `rt.mts`, `span.mts` (→ `span.out.txt`), `spansvg.mts`, `k5save.mts`, `adv-svg.mts`, `arc.mts`, `p3s.mts`, `p31.mts`, `lb.mts`, `lbreal.mts`, `redos.mts`, `bomb.mts` and `deep.mts`.
  - Vitest and the browser were not run: available memory was 0.8–1.6 GB, under the gates once the audit resumed.
  - The one bomb test (`bomb.mts`) was bounded to a 16 KB input under `--max-old-space-size=512`.
- **Counts:** 2 raised → 0 refuted (auditor; refuter PENDING) → P1 0 / P2 1 / P3 1. KNOWN: 30 earlier findings still open or partly open, listed in the status table. No security finding was raised, so no security details file exists.

## Headline

The format core holds up. Every route tested kept its geometry and scale:

- **Round trips:** an inch DXF with a rotated, scaled INSERT imported at the right size (508 × 1270 mm, worked by hand). Its SVG export, DXF export and `.lf2` save each re-imported at the same size.
- **PDF, AI and EPS:** they share one 72 pt = 25.4 mm rule with PDF.js's UserUnit.
- **LightBurn:** the frame maps a real 2.0.05 project corner-for-corner, and speed (mm/s × 60), power and passes come across.

The SVG entity bound, XXE refusal, script stripping and the J6 ReDoS fixes all held under test.

The new defect is a twin gap in the DXF importer.

- **W5-P2-1.** The DXF gate checks each entity's raw coordinates against ±1,000,000 mm, but not where the geometry ends up. The importer then moves the drawing's corner to 0, and the loader caps every coordinate at 1,000,000 mm. So two parts 1.8 km apart, or a part plus a stray entity far from the origin, import with no note. After that, Save and autosave both refuse the whole project with "missing or invalid `scene.objects[0].bounds.maxX`".
- **Twin difference:** the same geometry from SVG imports and saves, and the SVG and LightBurn importers check where the geometry lands.
- **Smaller:** a crafted SVG arc radius past about 1e154 silently loses its segment (P3).

Many earlier P3s are still open. Five are re-confirmed by repro on this SHA and listed below:
- Illustrator SVG at 75%;
- CSS `translateX` ignored;
- `<ellipse>` with no `ry`;
- the LightBurn XForm identity fallback;
- DXF layer true colour.

## Findings

### W5-P2-1 — A DXF whose parts span more than 1,000,000 mm imports with no note, and then Save and autosave refuse the whole project

- **Severity: P2.**
  - Why not P3: an ordinary DXF reaches it, and the result misleads. A CAD drawing with one stray entity far from the part is a common real-world fault, and so is a site or survey drawing in mm. Either imports and looks normal, but from then on the project cannot be saved or autosaved. Work after the import is unprotected, and the message names an internal field, not the cause.
  - Why not P1: nothing burns wrong, and Save says it failed.
  - Precedent: 13-P2-1 (a LightBurn project that opens but can never be saved) was P2, and was fixed by refusing at import (ADR-307 Amd 2).
- **Where (pinned at `a3965a77d`):**
  - `src/io/dxf/dxf-entities.ts:323,328`: `DXF_COORDINATE_MAGNITUDE_MM = 1_000_000`. `hasUnreadableGeometry` checks each entity's own tags only.
  - `src/io/dxf/dxf-result.ts:61-74`: `normalizeAndGroup` shifts every point by `-minX` and flips Y about `maxY`, so the stored coordinates are as large as the drawing's whole extent.
  - `src/io/dxf/dxf-expand.ts:263,290-299`: INSERT placement (insertion point, 41/42 scale, MINSERT spacing) is never range-checked. This half is the known July DXF P3-2 / v2 K-5.
  - `src/io/dxf/dxf-entities.ts:174` and v2 14-P3-7: a SPLINE with weights ≤ 0 has the same outcome.
  - The loader cap is at `src/io/project/project-shape-primitives.ts:2`, `MAX_PROJECT_COORDINATE_MAGNITUDE_MM = 1_000_000`.
  - Save calls it at `src/io/project/prepare-project-persistence.ts:29`, and autosave at `src/io/project/prepare-project-autosave.ts:31,41`.
  - The insertion guard (`src/ui/state/project-insertion-budget.ts:19`) checks only count budgets.
- **Anchor:**
  - **Twin.** The SVG importer refuses at import on final points (`src/io/svg/svg-import-budget.ts:14,58`). The LightBurn importer skips a shape whose transformed curve is out of range (`src/io/lightburn/lbrn-geometry.ts:168,195`). Both use the loader's limit, so neither can produce an object the loader refuses.
  - **Contract.** ADR-307 Amd 2 is cited at `lbrn-import.ts:176-179`: "Save and autosave refuse a project past them, so it would hold work that can never be kept". This is a code comment, so it is cited as code, not as ADR text.
- **Scenario and evidence:** REPRO (`span.mts`, `spansvg.mts`, `k5save.mts`; output in `zz-w5/span.out.txt`).
  1. A mm DXF with two 10 mm LINEs, one at X −900,000 and one at X +900,000. Each passes the per-entity gate.
     - Import: `ok`, bounds `{0,0,1800010,0}`, notes `[]`.
     - `prepareProjectForPersistence`: `invalid missing or invalid scene.objects[0].bounds.maxX`.
     - `prepareProjectForAutosave`: the same `invalid`.
  2. The same geometry as an SVG (viewBox `-900000 -5 1800010 10`) imports with bounds `{-900000,…,900010,…}`, and Save gives `ok`.
  3. An INSERT of a 10 mm LINE placed at X = 2,000,000 next to a LINE at 0: import `ok`, bounds `maxX 2000010`, notes `[]`, Save `invalid …bounds.maxX`. At X = 900,000 Save is `ok`, so the cap is the boundary.
  4. A SPLINE with weights `1,-2,1` (14-P3-7): Save `invalid …bounds.maxX`.
- **User-visible effect:**
  - The import succeeds, with at most the bed-fit notice.
  - Save then fails with a validator path the operator cannot act on, and autosave stops protecting the project.
  - The UI wording around the refusal was not seen in a browser (see Not verified).
- **Novelty:**
  - Partly KNOWN: the INSERT bypass is July DXF P3-2 / v2 K-5, and the weights case is v2 14-P3-7. Both were rated P3 as "bypasses the gate", and the July report said the bed preflight backstops them.
  - New: plain entities inside the gate also trigger it, through the shift to the drawing's corner. Neither earlier report recorded that the import leaves the project unsaveable and un-autosaveable.
  - No open PR touches `src/io/dxf/**` (`gh pr list`, 2026-11-09).
- **Fix direction:** check the normalised extent (and the placed INSERT and SPLINE output) against the loader's limit at import, and refuse or skip with a note, as the SVG and LightBurn importers do. A DXF whose only out-of-range content is one stray entity could name it.
- **Refuter:** PENDING.

### W5-P3-1 — An SVG arc with a radius above about 1e154 silently loses its segment

- **Severity: P3.** Only a crafted or corrupt file reaches it, and the loss is a missing segment, not a misplaced burn.
- **Where:** `arcToCubics` in `src/io/svg/flatten-curves.ts:109-145` squares the radii in the spec's steps 2–3 (`rx * rx` at :129 and :137). For |r| ≳ 1.34e154 the square overflows to Infinity, the centre comes out NaN, and the segment is dropped. The canonical curve gets no segments at all.
- **Anchor:** Ground truth, SVG 2 implementation notes on out-of-range arc radii: a browser scales the radii and draws the arc, which here is a 10 mm near-straight line.
  - Twin: `A1e20 1e20 0 0 1 10 0` imports as the expected 10 mm segment.
- **Scenario and evidence:** REPRO (`arc.mts`).
  - `M0 0 A1e300 1e300 0 0 1 10 0` imports polyline `[[0,0]]` with curve segments `[]` and notes `[]`.
  - `A1e12`, `A1e16` and `A1e20` each give `[[0,0],[10,0]]`.
- **User-visible effect:** one line of the drawing is missing, with no note.
- **Novelty:** new. The v5 J6 adversarial pass covered regexes and decompression, not arc radii.
- **Fix direction:** compute the radius check in a scaled form, or treat a non-finite `lambda` as a straight segment, as the spec does for a zero radius.
- **Refuter:** PENDING.

## Earlier findings: status on `a3965a77d`

Status words: FIXED, STILL OPEN, PARTLY FIXED, CHANGED, NOT RE-VERIFIED. Unless noted, "REPRO" means a script in `zz-w5/` ran on this SHA.

### v2 13 (project I/O)

| ID | Status | Evidence |
|---|---|---|
| 13-P1-1 autofocus command sent verbatim | FIXED | READ: `project-controller-normalization.ts:24` (`normalizeAutofocusCommand`), `project-load-metadata.ts:55-64` (`autofocusCommandRemoved`) |
| 13-P2-1 LightBurn > 10,000 shapes unsaveable | FIXED | READ: `lbrn-import.ts:179` (`projectLimitRefusal` refuses before replacing the document) |
| 13-P2-2 font copies never pruned | FIXED | READ: `object-insert-actions.ts:293` (same bytes reuse one key; unreferenced fonts leave; ADR-628 Amd 1) |
| 13-P3-1 numeric edits past loader limits | NOT RE-VERIFIED | outside this area's code |
| 13-P3-2 guides past 200 dropped on Save | STILL OPEN | READ: `core/scene/guides.ts:14,22` caps only on save; `guide-actions.ts:35` adds without a cap |
| 13-P3-3 legacy v1/v2 ≥ 256 overrides | NOT RE-VERIFIED | |
| 13-P3-4 autosave parses both snapshots | CHANGED | autosave moved to `autosave-durable*.ts`; `autosave-indexeddb-mutations.ts` no longer parses JSON; not re-measured |
| 13-P3-5 deep nesting throws | STILL OPEN | READ: `deserialize-project.ts:104` calls `validateProjectShape` outside the `try` at `:108` |

### v2 14 (vector importers)

| ID | Status | Evidence |
|---|---|---|
| 14-P2-1 Illustrator SVG 75% / viewBox-only 283% | STILL OPEN | REPRO `p3s.mts`: viewBox-only `0 0 72 72` → 72 mm; `72px` → 19.05 mm; no note (`svg-units.ts:8,40,102`) |
| 14-P3-1 CSS transforms on artwork ignored | STILL OPEN | REPRO `p31.mts`: `style="transform: translateX(20px)"` → x 0..10 (expected 20..30), notes `[]`; `translate(20px, 0)` is honoured (`svg-presentation.ts:113`). This is a silent position error in a file a browser draws correctly. It was rated P3 on 2026-10-21, before the 2026-10-23 clarification; the coordinator should re-rate it |
| 14-P3-2 `<svg:svg>` TypeError on the worker route | STILL OPEN | REPRO: `TypeError: Cannot read properties of null (reading 'tagName')` (`parse-svg-worker.ts:67`) |
| 14-P3-3 nested entity refused on the streamed route only | STILL OPEN (streamed half) | REPRO: `undefined entity`; the fallback routes were not re-run |
| 14-P3-4 unitless DXF assumed mm, no note | STILL OPEN | REPRO: `$INSUNITS 0` → notes `[]` (`dxf-document-stream.ts:28-29`) |
| 14-P3-5 DXF LAYER true colour ignored | STILL OPEN | REPRO: layers with 420 magenta and green both import as `#ff0000` |
| 14-P3-6 fit-point SPLINE dropped | STILL OPEN | REPRO: "spline needs 4 control points, has 0" |
| 14-P3-7 SPLINE weight ≤ 0 | STILL OPEN | REPRO: 9.1e12 mm; now also unsaveable (part of W5-P2-1) |
| 14-P3-8 `<ellipse>` without `ry` | STILL OPEN | REPRO: only the companion rect imports; no note (`shape-to-polylines.ts:163-164`) |
| 14 K-1 depth > 256 dropped | NOT RE-VERIFIED | |
| 14 K-2 DXF LINE/ARC ends not joined | NOT RE-VERIFIED | `dxf-join-touching.ts` now exists |
| 14 K-3 dogbone DXF holes | NOT RE-VERIFIED | |
| 14 K-4 no aggregate INSERT budget | FIXED | READ: `dxf-expansion-budget.ts:22,36` (ADR-269 Amd 2) |
| 14 K-5 INSERT NaN/huge insertion point | STILL OPEN | REPRO: `10=nan` → block silently at 0; `10=1e300` → bounds `maxX 1e300`; the unsaveable consequence is in W5-P2-1 |
| 14 K-6 `$INSUNITS` gaps | STILL OPEN (noted) | REPRO: 7 → "Unrecognized $INSUNITS 7 — assuming millimeters." |
| 14 K-7 `transformCurve` arc branch | NOT RE-VERIFIED | unreachable |

### v2 21 (LightBurn and material importers)

| ID | Status | Evidence |
|---|---|---|
| 21-P1-1 Starter Presets overwrite | FIXED | READ: `open-starter-library.ts:10` (imports beside the existing library, ADR-093 Amd 1) |
| 21-P2-1 sub-layer fields leak into main | FIXED | READ: `lbrn-fields.ts:15` (own children only) |
| 21-P2-2 switched-off main tab burned | FIXED | READ: `lbrn-layers.ts:139-160` (`suboutput` per tab, named in the report) |
| 21-P2-3 `.clb` Scan+Cut → Fill only | FIXED | READ: `clb-import.ts:298` (`scan+cut` → Fill+Line; unknown types named) |
| 21-P3-1 GRBL-M3 `.lbdev` mapped as M4 | PARTLY FIXED | READ: `lbdev-import.ts:218` review now names the driver as another firmware build; the profile is still stock GRBL |
| 21-P3-2 `.lbdev` keys dropped unmentioned | NOT RE-VERIFIED | |
| 21-P3-3 `.clb` report shows a count only | STILL OPEN | READ: `material-library-file-actions.ts:114` |
| 21-P3-4 interval below 0.05 mm, no note | STILL OPEN | READ: `lbrn-layers.ts:279` |
| 21-P3-5 speed 0 → 1 mm/min; `.clb` interval 0 → 0.001 | STILL OPEN | READ: `lbrn-layers.ts:262`, `clb-import.ts:186` |
| 21-P3-6 `.lbdev` `1e3` / `4,000` | STILL OPEN | READ: `lbdev-device.ts:32` |
| 21-P3-7 `.lbdev` lazy-regex quadratic | STILL OPEN | READ: `lbdev-import.ts:279` (not covered by ADR-268 Amd 2's fix) |
| 21-P3-8 `.clb` Scan with no overscan → 0 mm | STILL OPEN | READ: `clb-import.ts:14`; `.lbrn` keeps the layer default |
| 21 K-1 > 10,000 shapes | FIXED | as 13-P2-1 |
| 21 K-2 fractional mm/min | NOT RE-VERIFIED | `lbrn-layers.ts:262` still multiplies without rounding; #1582's decimal step may cover the dialog side |
| 21 K-3 `.lfmachine` autofocus | FIXED | READ: `machine-profile-autofocus.ts:22` |
| 21 K-4, K-6, K-7 | NOT RE-VERIFIED | |
| 21 K-5 bitmaps, outline-less text, image settings | STILL OPEN (named in report) | READ: `lbrn-geometry.ts` left-out warnings |

### v5 J6 (parsers, adversarial)

| ID | Status | Evidence |
|---|---|---|
| J6-P1-1 PNG eXIf orientation | FIXED | READ: `image-loader.ts:342` (`readHeaderImageInfo` orients PNG eXIf and JPEG Exif) |
| J6-P2-1 (security) quadratic regexes | FIXED | REPRO `redos.mts`: an SVG with 20k- and 80k-digit stroke-width and artwork-origin values parses in 29.8 / 29.3 ms; the LightBurn VertList takes 0.2 ms (`svg-presentation.ts:174-175`, #1483) |
| J6-P2-2 (security) TIFF decompression bomb | FIXED | READ: `tiff-decompressed-length.ts:15` counts each block against its row size (#1483) |
| J6-P2-3 Multi-File Trace TIFF on the UI thread | FIXED | READ: `batch-raster-decode.ts:6-11` (import worker) |
| J6-P3-1 raw DataView message | FIXED | READ: `tiff-pixel-layout.ts:49` |
| J6-P3-2 root width in Q | FIXED | REPRO: `200Q` → 50 mm |
| J6-P3-3 unreadable LightBurn XForm → identity | STILL OPEN | REPRO `lb.mts`: a Rect at XForm `1 0 0 1 100 50` lands at x 95..105; with 5 values, `NaN` or commas it lands at x −5..5, y 395..405, warnings `[]` (`lbrn-frame.ts:48`) |

### v7 L7 (design I/O round trip)

| ID | Status | Evidence |
|---|---|---|
| L7-P1-1 Fill holes lost in SVG round trip | FIXED (#1505) | READ: `export-dxf.ts:43` and `export-fill-compounds.ts` pool colours; the full two-shape case was not re-run |
| L7-P1-2 placed tabs dropped on cross-project paste | FIXED (#1505) | READ only |
| L7-P2-1 export writes path colour, not operation colour | FIXED (#1505) | READ: `export-dxf.ts:43-52` (`ofPathBurns`) |
| L7-P3-1 to L7-P3-3 | NOT RE-VERIFIED | |

## KNOWN (from the brief, not raised again)

- The v10 white knock-out findings (V2-P2-1, V7-P2-1, V7-P2-2). The fix, PR #1617, merged into `a3965a77d`. Its import path (`svg-white-ink.ts`, `parse-svg.ts:314`) was read only for regressions in this area, and none was found.
- W4-P2-2 (camera, redacted).

## Refuted

None raised and then dropped by the auditor. These candidates were checked and not raised:

- **SVG `transform="scale(0)"` imports a zero-size outline.** It is 5 coincident points at the origin, a degenerate artefact with no burn length. Not raised.
- **The LightBurn import lands off the bed for a MirrorX project from a wider machine.** The acwright plate lands at x −75..275 on the default 400 mm bed. The mapping is correct (distance from LightBurn's right-hand origin), and the canvas shows the artwork off the bed, so the operator sees it. Not raised.
- **`.lf2` with `1e400`.** It is refused: "missing or invalid `scene.objects[0].bounds.maxX`".

## Verified clean

- **DXF units and blocks (L3).**
  - REPRO `rt.mts`: `$INSUNITS 1` with an INSERT (base point 1,1; scale 2; rotation 90°) places the block at x 10..20 in, y 30..50 in. The combined bounds of 508 × 1270 mm match a hand calculation.
  - The writer emits `$INSUNITS 4` and `$MEASUREMENT 1` (`dxf-writer.ts:218-221`). DXF export → import keeps 508 × 1270 mm.
- **SVG round trip and units.**
  - SVG export carries `width/height` in mm, a matching viewBox and `data-kerfdesk-artwork-origin`. Re-import gives the same 508 × 1270 mm.
  - The root viewport honours `preserveAspectRatio` (`svg-root-viewport.ts`).
- **`.lf2` round trip and corruption.**
  - REPRO: save → open keeps bounds exactly.
  - Truncation mid-file gives a truthful "not valid JSON … at position N". Losing only the trailing newline still opens.
  - Non-finite numbers are refused.
- **PDF/AI.**
  - The vector page and the rendered-image route both size the page as `viewport × 25.4/72`, and `PageViewport` multiplies in `/UserUnit` (`pdf-artwork-source.ts`, `pdf-vector-page.ts`).
  - The exporter writes `/UserUnit` for large pages, which the importer honours.
  - PDF.js 6.x is past CVE-2024-4367; `getDocument` uses `stopAtErrors` and an owned worker, and rejects passwords.
- **XML trust boundary (L5).** REPRO `bomb.mts`, bounded:
  - 4,000 references to a 4,000-character entity in a 16 KB SVG are refused at the 8,388,608-character bound, on both the streamed and the fallback routes, in 51 ms and +5 MB RSS.
  - A `SYSTEM` entity is "undefined entity", so nothing is fetched.
  - LightBurn and `.clb` documents refuse any DOCTYPE or ENTITY (`document-import-source.ts`).
  - The 100× ratio for large inputs is ADR-268 Amd 1's expat-equivalent bound and was not raised.
- **Script content.**
  - REPRO `adv-svg.mts`: `<script>`, `onload` and `file:///` `<image href>` run nothing and fetch nothing, and the image is reported as "no embedded bitmap data".
  - The main-thread fallback runs DOMPurify (`sanitize.ts`).
  - No imported SVG node reaches the live DOM: no `innerHTML`, `importNode` or `adoptNode` sinks were found under `src/`.
- **Print iframe.** `print-artwork.ts:95` writes the exported SVG into an unsandboxed `srcdoc`. Every non-numeric value in the exported SVG goes through `xmlText` (`export-svg-paths.ts:11`), and image `href`s must match a base64 `data:image/(png|jpeg|bmp|webp)` pattern. Nothing user-controlled reaches markup unescaped today. A `sandbox` attribute would be cheap hardening.
- **Numeric edge cases.** REPRO `adv-svg.mts`:
  - `1e400` in path data, a 1e308 rect, `scale(1e300)` and a 1e200 polyline are all refused with a message.
  - `x="NaN"`, `cx="Infinity"` and `matrix(… NaN …)` fall back as a browser does (invalid → initial value).
  - A self-referencing `<use>` is skipped and noted.
- **ReDoS.** Re-check of J6-P2-1: linear (see the status table).
- **LightBurn mapping.**
  - REPRO `lbreal.mts`, the real acwright 2.0.05 file: 25 shapes, `speed 15` mm/s → 900 mm/min, `maxPower 50` → 50 %, 1 pass, warnings `[]`.
  - REPRO `lb.mts`: MirrorY places y 45..55 against 345..355 without it.
- **L8.**
  - #1611's import-path changes and #1617's `minOf`/`maxOf` swap change no import or export result in the repros above.
  - #1557 and #1580 were read for half-import and message regressions; none was found.

## Not verified

- **No browser or Vitest run.** Available memory was 0.8–1.6 GB, under both gates, so these were not checked:
  - the Save/autosave refusal wording the UI shows for W5-P2-1;
  - giant-dimension PNG, JPEG and GIF headers on the element route;
  - the paged PNG route;
  - PSD;
  - the main-thread SVG fallback beyond the entity expansion;
  - image export (`save-original-image.ts`, `save-preview-image.ts`).
- **PDF import was not executed.** PDF.js was not run in Node. The `j11-main` junction holds `pdfjs-dist` 6.3.289 while `package.json` locks 6.4.299, so a Node run would not have tested the shipped version. `pdf-vector-page.ts`'s comment names the 6.3 `constructPath` shape; CI on main is the evidence it still matches 6.4.
- **LightBurn Text `BackupPath` transform.** The importer applies the parent's matrix and the BackupPath's own `XForm`, but not the Text shape's `XForm` (`lbrn-geometry.ts`, the `visitShape` text branch). No real LightBurn file with Text was available offline, so whether LightBurn writes the BackupPath `XForm` as absolute is unconfirmed.
- **Fill scan-angle sign.** LightBurn's Y-up scan angle against KerfDesk's Y-down `hatchAngleDeg` (`lbrn-layers.ts`, the `importedScanLayerFields` function; `fill-hatching.ts:113`) is unconfirmed: no primary source was fetched (no downloads). If the conventions differ, the line direction is mirrored. The burned area does not change.
- **DXF block insertion units.** BLOCK_RECORD group 70 is not read. Blocks defined in other units would need it; no fixture has one.
- **G-code export.** Save G-code shares `emitSavePreparedOutput` with the Start preparation path. Output twins are other areas' scope and were not re-run.
- **Status table rows marked NOT RE-VERIFIED.**

```json
[
  {"id":"W5-P2-1","severity":"P2","area":"import-export-formats","file":"src/io/dxf/dxf-result.ts","line":61,"anchor":"Twin: svg-import-budget.ts:14,58 and lbrn-geometry.ts:168,195 refuse geometry past the loader limit at import; project-shape-primitives.ts:2 loader cap; Contract: ADR-307 Amd 2 (cited via lbrn-import.ts:176-179 comment)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"DXF gate checks each entity's raw coordinates (dxf-entities.ts:328) but the import then shifts to the drawing corner (dxf-result.ts:61-74) and INSERT/SPLINE output is never range-checked; LINEs at X -900000 and +900000 import with notes [] as an 1,800,010 mm object, and Save and autosave both refuse the project ('missing or invalid scene.objects[0].bounds.maxX'); the same geometry from SVG imports and saves. Partly KNOWN (July DXF P3-2 / v2 K-5, 14-P3-7)"},
  {"id":"W5-P3-1","severity":"P3","area":"import-export-formats","file":"src/io/svg/flatten-curves.ts","line":109,"anchor":"Ground truth: SVG 2 out-of-range arc radii are scaled, the arc drawn; Twin: radius 1e20 imports correctly","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"An SVG arc with radius about 1e154 or more overflows the radius correction and the segment is silently dropped (M0 0 A1e300 1e300 0 0 1 10 0 imports a single point, notes [])"},
  {"id":"14-P2-1","severity":"P2","area":"vector-importers","file":"src/io/svg/svg-units.ts","line":40,"anchor":"see v2 14-P2-1","evidence":"REPRO","verdict":"KNOWN","known":true,"summary":"Still open: viewBox-only 72 units -> 72 mm, 72px -> 19.05 mm, no note"},
  {"id":"14-P3-1","severity":"P3","area":"vector-importers","file":"src/io/svg/svg-presentation.ts","line":113,"anchor":"see v2 14-P3-1","evidence":"REPRO","verdict":"KNOWN","known":true,"summary":"Still open: CSS translateX(20px) ignored silently (x 0..10 instead of 20..30); coordinator to re-rate under the 2026-10-23 P1 clarification"},
  {"id":"J6-P3-3","severity":"P3","area":"parsers-adversarial","file":"src/io/lightburn/lbrn-frame.ts","line":48,"anchor":"see v5 J6-P3-3","evidence":"REPRO","verdict":"KNOWN","known":true,"summary":"Still open: unreadable LightBurn XForm becomes identity; shape at x 95..105 lands at -5..5 with warnings []"},
  {"id":"14-K-5","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-expand.ts","line":299,"anchor":"see July DXF P3-2","evidence":"REPRO","verdict":"KNOWN","known":true,"summary":"Still open: INSERT 10=nan places the block at 0 silently; 10=1e300 accepted (consequence now part of W5-P2-1)"},
  {"id":"14-P3-7","severity":"P3","area":"vector-importers","file":"src/io/dxf/dxf-entities.ts","line":174,"anchor":"see v2 14-P3-7","evidence":"REPRO","verdict":"KNOWN","known":true,"summary":"Still open: SPLINE weights 1,-2,1 give 9.1e12 mm; project then unsaveable (W5-P2-1)"}
]
```

## Refuter (2026-11-09)

Fresh context. Tree: main `a3965a77d` (scratchpad `j11-main`, read only). Every line cited below was read at that SHA.

**How the repros ran.**
- Node 25 with the real modules, from scratchpad `zz-w5r/`: `node --import ./register.mjs <script>.mts`. The loader is the auditor's, plus a stub for font and asset imports so the real zustand store (`ui/state/store.ts`) loads.
- Scripts and their saved output (`*.out.txt`): `store.mts` (W5-P2-1 through the real store), `twins.mts` (HPGL and the bed fit), `arc.mts` and `bulge.mts` (arc radii and DXF bulges), `bulgeburn.mts` (real store import → `compileJob`) and `ai.mts` (Illustrator headers and CSS transforms).
- **Ground truth from a real browser.** `browser.cjs` drives the cached Chrome for Testing headless shell (build 1248, `HeadlessChrome/156.0.8078.4`) through `playwright-core` 1.61.1 from the junction, with every network request aborted. Memory was 2,589 MB and 2,731 MB at the gate. Nothing was downloaded.
- Vitest was not needed: every claim below ran on the real modules.

### Verdicts

**W5-P2-1 — CONFIRMED, P2 kept (not P1).**
- **What would make it false:**
  - an import-time guard downstream of `parseDxf`;
  - the bed fit rewriting the local bounds;
  - the production worker route parsing differently;
  - Save or autosave tolerating the object;
  - the work being lost silently.
- **None holds.**
- **Real store import** (`importSvgObject`, which `file-actions.ts:88` wires as the DXF `importObject`), with a 50 mm square imported first as earlier work:

  | DXF | Bounds | Toasts | Save / autosave |
  |---|---|---|---|
  | LINEs at X −900,000 and +900,000 mm | `maxX 1800010` | only "Imported 2 paths from site.dxf." | both ``invalid … scene.objects[1].bounds.maxX`` |
  | A part at 0..100 plus a stray LINE at X 999,000 (each entity inside the gate) | 1,004,001 × 100 | a bed-fit warning only | the same refusal |
  | `$INSUNITS 6` site plan: 0 m and 999 m plus a stray at −10 m | 1,009,500 mm | none | the same refusal |
- The worker route `parseDxfBlob` (`ui/import/parse-dxf-blob.ts`) gives identical bounds and `notes []`.
- **Loss of work, checked against P1:**
  - **Earlier work is kept.** An invalid autosave returns before any commit: `autosave-durable.ts:261-267` (`if (prepared.kind !== 'ok') return prepared;` comes before `repository.commit`), and the same holds in `autosave-local-storage.ts:63-64`. So the last good slot, from before the import, survives, and so does any saved `.lf2`.
  - **Work after the import is unprotected.** `autosave-loop.ts:66-79` keeps retrying each tick, and every retry fails.
  - **Deleting the imported object restores Save** (repro: `after deleting the import, Save: ok`), and Undo removes the import.
  - **The user is told.** The autosave failure raises one toast per session (`use-autosave.ts:41-42,58-71`): "Autosave could not preserve the newest project. Save the .lf2 file manually; image-heavy projects can exceed browser storage." It names the wrong cause, and its advice fails too. Save shows ``Could not save project: missing or invalid `scene.objects[1].bounds.maxX` `` (`project-save-completion.ts:55`), then the salvage confirm (`project-save-action.ts:139-166`).
  - **The salvage copy cannot be reopened.** Serialising it and reading it back gives the same `invalid … bounds.maxX`, so it holds the work as text but needs hand repair. The 13-P2-1 salvage copy had the same flaw.
- **Why P2:** nothing is lost silently. The refusal is loud, the pre-import recovery slot survives, and deleting the import restores Save. This is the 13-P2-1 shape, which meta-v1 M2 confirmed at P2: a project that opens but cannot be saved or autosaved, with a wrong-cause autosave toast and a salvage copy that will not reopen.
- **Corrections to the report:**
  - When the drawing is degenerate in one axis (cases 1 and 3, all horizontal), there is no bed-fit notice at all. The 1.8 km object stays at file size, because of W5-P3-2 below.
  - The import-time twin claim needs one exception: HPGL does not check where geometry lands either (W5-P2-2).
- Citations re-read and accurate: `dxf-entities.ts:323,328-336`, `dxf-result.ts:61-74`, `dxf-expand.ts:289-300`, `svg-import-budget.ts:58-68`, `lbrn-geometry.ts:168,195`, `lbrn-import.ts:176-179`, `project-insertion-budget.ts:15-24`.

**W5-P3-1 — REFUTED as raised. A different arc defect replaces it (W5-P1-1).**
- **The anchor is false.** The ground truth was "a browser scales the radii and draws the arc, a 10 mm near-straight line". In Chromium 156, the engine Electron ships, `M0 0 A1e300 1e300 0 0 1 10 0` has `getBBox` 0 × 0. So do 1e76, 1e78, 1e100, 1e153, 1e155 and 3.5e38 (`browser.out.txt`). A radius past the float range is a path-data error there, and nothing after the `M` is drawn.
- **So the dropped segment matches what the browser shows.** In fact KerfDesk keeps the segments after the arc, while Chromium stops.
- **The threshold is also misstated.** The segment drops from about 1.2e77, where `rxSq * rySq` overflows at `flatten-curves.ts:142`, not from 1.34e154. Radii from 1e38 to 1e76 refuse the whole file with "SVG import contains unsupported non-finite or extreme coordinates" (`arc.out.txt`).
- **The twin is wrong.** The report gives "`A1e20 1e20 0 0 1 10 0` imports correctly" as its twin. That holds only for an axis-aligned chord. `A1e20 1e20 0 0 1 10 10` imports with polyline points up to y 6,145 mm, and its canonical cubic reaches 8,192 mm. Chromium draws that path 10 × 10. This is part of W5-P1-1.

### Re-rated KNOWN items

**14-P2-1 (Illustrator SVG at 75 %, viewBox-only at 283 %) — still open, P2 kept. Not re-rated, not counted as raised.**
- **Repro** (`ai.mts`): files built from Illustrator's export shapes, with no download. All four import with `notes []`:

  | File shape | Imports at |
  |---|---|
  | CS6 Save As: Generator 16.0.0, the `ns_*` DOCTYPE entities, `<switch>`/`foreignObject`/`i:pgfRef`, an `i:pgf` CDATA block, `width="72px"`, 1-inch artboard | 19.05 mm |
  | CC 27.0.0 Save As: viewBox only, internal `<style>` class | 72 mm |
  | Export As with mm units | 25.40 mm (true size) |
  | Export As unitless, Responsive off | 19.05 mm |
- **Canvas against burn:** there is no hidden difference. The canvas, the W/H fields, the bed-fit check and the compiled job all use the same imported geometry. The wrong size is shown faithfully.
- **Why not P1:**
  - **The `px` half (75 %).** The output is not wrong against the file's declared units. `svg-units.ts:17,30` applies CSS's 96 px/in, as the SVG spec does and as Inkscape and LightBurn's default import do. Illustrator's 72-per-inch intent is not stated in the file.
  - **The viewBox-only half (283 %).** The file declares no physical size. KerfDesk applies its documented assumption (`svg-units.ts:8`, "1 user unit = 1 mm", ADR-574). That assumption is a policy question already with the maintainer (BQ-20).
  - **The twin rating.** The same kind of assumption in DXF, a unitless file read as mm with no note, is 14-P3-4 at P3.
  - **Contrast with J6-P1-1.** That P1 rested on the importer contradicting the browser's reading of an explicit field. Here, either no ground truth disagrees, or none exists.
- **What it lacks:** a note naming the assumed unit, or a 72/96 choice. That is a misleading result an ordinary user hits: P2.
- **For the coordinator:** if Illustrator's own unit is taken as ground truth, both halves become P1, because no warning names the assumption.

**14-P3-1 (CSS transforms ignored) — still open, RE-RATED P3 → P1. Counted under raised.**
- **Repro** (`ai.mts`), each with `notes []`:

  | Input | KerfDesk | Chromium |
  |---|---|---|
  | `style="transform: translateX(20px)"` | x 0..10 | x 20..30 |
  | `style="translate: 20px 0"` | 0..10 | 20..30 |
  | `<style>.m{transform:translateY(20px)}</style>` | y 0..10 | y 20..30 |
  | `rotate(90)` with `transform-origin="5 5"` | x −10..0 | in place |
  | `rotate(0.25turn)` | 0.25° | 90° |
  | Control: `translate(20px, 0)` | 20..30 | 20..30 |
- The Chromium column is from `browser.cjs` with `getBoundingClientRect`. The causes are at `svg-transform-attribute.ts:44` (units dropped) and `:60` (an unknown function becomes the identity), fed from `svg-presentation.ts:113`.
- **Canvas against burn:** there is no hidden difference. The canvas shows KerfDesk's misreading, and the burn follows it.
- **Why P1:**
  - The file states the position unambiguously, and the browser, the SVG 2 / CSS Transforms ground truth, draws the element 20 mm away. KerfDesk silently burns it in the wrong place.
  - No warning names the mismatch.
  - The importer knows these constructs: the clip reader refuses them (`svg-clip-presentation.ts`).
  - This is the J6-P1-1 shape: an importer disagrees with the browser on an explicit field, the canvas shows the importer's result, and that was P1 because "a visible result is not a warning" (METHOD §3, 2026-10-27).
  - Reach is narrow (hand-written or web-exported SVG), and §3 has no reach clause.
- The v2 P3 rating (2026-10-21) predates both clarifications. The meta audit reviewed P2s, not this P3.

### New findings (found by refuter)

**W5-P1-1 (found by refuter) — A DXF polyline bulge near zero (|bulge| ≲ 1e-16) becomes a canonical cubic that loops far off the edge. A 40 mm plate burns 70–141 mm wide, or the whole drawing is shrunk to fit under a false "larger than the bed" notice. SVG arcs with very large radii do the same.**
- **Where:** `src/io/dxf/dxf-native-curves.ts:28-47`, `bulgeCurveSegment`, called from `dxf-entities.ts:218`.
  - For bulge `b`, the sweep is `4·atan(b)`. The centre sits `chord / (2·tan(sweep/2))` away: about 1e17–1e19 mm at `b` = 1e-17 to 1e-19 (`:36-40`).
  - `start = atan2(…)` (`:41`) and the cubic control points come from that far centre (`:43`).
  - At that magnitude, double rounding moves the control points by `radius × 2⁻⁵²`: tens of mm to metres. Only the final `to` is snapped (`:45-46`).
  - The object bounds come from these curves (`dxf-result.ts:51`).
- **Where it reaches output:** compile flattens the canonical curves (`core/job/compilation-polylines.ts:20-33`), and the canvas draws them too (`ui/workspace/display-polylines.ts:93-113`).
- **Anchor:**
  - **Twin.** The polyline sampler for the same segment, `dxf-curve-sampling.ts:24-41`, is correct: a tiny sweep is one step, snapped to `p2`. So the stored polyline is the straight 10 × 10 edge, while the canonical curve beside it bulges out.
  - **Ground truth.** A bulge of 1e-17 on a 40 mm chord has a sagitta of about 2e-16 mm: a straight edge.
  - **Same class in SVG.** `arcToCubics` (`io/svg/flatten-curves.ts:109-150`, also used by `svg-curve-transform.ts:46`) does the same for an SVG arc whose radius is at least about 1e16 times its chord. Chromium 156 draws `M0 0 A1e17 1e17 0 0 1 10 10` through `A1e20…` as a 10 × 10 line (`browser-hi.out.txt`).
- **Scenario and evidence:** REPRO (`bulge.mts`, `bulgeburn.mts`). A real store import, then `compileJob(project.scene, project.device)`, with the default 400 × 400 mm bed.
  - **A 40 × 30 mm closed LWPOLYLINE plate** with a bulge only on its bottom edge:

    | Bulge | Bounds | Compiled job X | Toasts |
    |---|---|---|---|
    | `0`, `1.2246467991473532e-16` or `±6.123233995736766e-17` | 40 × 30 | 180..220 | |
    | `2.4492935982947064e-17` | 70.4 × 30 | 164.8..235.2 | "Imported 1 path from p.dxf." only |
    | `1e-17` | 141.08 × 30 | 129.46..270.54 | "Imported 1 path from p.dxf." only |
    | `1e-18` | 1,226 mm wide | | the design is scaled to 29.4 %, under "p.dxf is larger than the 400 × 400 mm bed (1226.1 × 30 mm)" |
    | `1e-19` | 4,612 mm wide | | the design is scaled to 7.8 % |
  - **A diagonal edge (0,0)→(30,20)→(60,0):**
    - bulge `6.123233995736766e-17`, the float value of cos(π/2), bows the edge out by about 1.8 mm (61.79 × 21.10);
    - bulge `1e-18` is 770 mm tall and is scaled to 46.7 %.
  - **The raw cubic at bulge 1e-17** on a 10 mm diagonal: controls `(32,10)`, `(32,10)`, midpoint `(25.25, 8.75)`. The edge runs from `(0,10)` to `(10,0)`.
- **Severity: P1.** It silently produces the wrong physical output (shape and scale).
  - In the plain cases the only toast is "Imported 1 path"; no note names the change.
  - The canvas shows the wrong outline, but under METHOD §3 (2026-10-27, J6-P1-1) a visible result is not a warning.
  - In the bed-fit cases, the only notice blames the file's size for a scale the file does not have.
  - **Reach:** a non-zero bulge at or below about 1e-16, a floating-point-noise value that a writer emitting `tan(sweep/4)` of a near-zero sweep can produce. KerfDesk's own writer is safe: `dxf-writer.ts:389-390` writes `toFixed(15)`, so such a bulge round-trips as `0`. How common these files are in the wild was not measured, but §3 has no reach clause and the input is a valid DXF.
- **Novelty:** new. v2 14 and J6 checked bulges at ordinary values. No audit or open PR touches `dxf-native-curves.ts` or `flatten-curves.ts` (`gh pr list`, 5 open PRs, 2026-11-09).
- **Fix direction:**
  - Treat a bulge segment whose sagitta (`|b|·chord/2`) is below the curve tolerance as a line; the SVG arc twin likewise.
  - Or build the cubic in chord-relative coordinates: start and end exact, handles `4/3·tan(sweep/4)·r` along the end tangents, with no far centre.
  - Add a regression test for bulges of 1e-16 to 1e-20 and SVG radii of 1e16 to 1e20.

**W5-P2-2 (found by refuter) — HPGL import has no coordinate-magnitude check at all. A plot whose extent passes 1,000,000 mm imports, and Save and autosave then refuse the project.**
- **Where:**
  - `src/io/hpgl/hpgl-result.ts:18-31` moves the drawing's corner to 0 at 40 plotter units per mm and refuses only non-finite bounds (`:26`).
  - `hpgl-types.ts:134` checks only `Number.isFinite` per point.
  - The import goes through the same `importSvgObject` path (`hpgl-import-action.ts:13`).
  - The auditor's scope did not list `src/io/hpgl/**`.
- **Anchor:** the same as W5-P2-1.
  - **Twin.** SVG refuses at import (`svg-import-budget.ts:58-68`); LightBurn skips out-of-range shapes (`lbrn-geometry.ts:168,195`).
  - **Loader cap:** `project-shape-primitives.ts:2`.
- **Scenario and evidence:** REPRO (`twins.mts`, real store).

  | Plot | Import | Save / autosave |
  |---|---|---|
  | `IN;SP1;PU0,0;PD400,0;PU41000000,400;PD41000400,400;` (two 10 mm strokes 1,025 m apart) | `notes []`, local bounds `maxX 1025010`, bed fit to 0.0351 % | Save ``invalid … scene.objects[0].bounds.maxX``, autosave `invalid` |
  | A single value of `1000000000000` (a corrupt coordinate) | bounds 25,000,000,010 mm, with no refusal | refused the same way |
  | 300 mm control | | Save `ok` |
- **Severity: P2,** by the W5-P2-1 and 13-P2-1 precedent: a loud refusal, the earlier slot kept, and deleting the import restores Save.
  - A damaged plot file reaches it: the 2026-10-11 stress audit rated the LightBurn corrupt-coordinate twin "High" before it was fixed.
  - Unlike DXF, there is no per-coordinate gate at all.
- **Fix direction:** apply the loader's ±1,000,000 mm limit to the normalised extent in `hpgl-result.ts`, and refuse with a note. Better, use one shared import-time check for DXF, HPGL and any later vector importer.

**W5-P3-2 (found by refuter) — An oversize import that is degenerate in one axis is never fitted to the bed. A 600 mm straight line lands off a 400 mm bed at file size, with no notice.**
- **Where:** `src/core/scene/fit-to-bed.ts:59-62`. `measureBoundsBedFit` treats `widthMm <= 0 || heightMm <= 0` as "fits", whatever the other axis is.
- **Anchor — Contract:** `docs/decisions/ADR-125-amendment-1-imports-keep-file-size.md`, Decision item 2: "Only a footprint larger than the bed in either axis, rotation and scale included, is scaled down uniformly about its centre into 90% of the bed." Item 3 promises the warning. `min(bedW/w, bedH/0)` would be finite here.
- **Scenario and evidence:** REPRO (`twins.mts`, real store, 400 × 400 bed).
  - A DXF 600 mm horizontal LINE: scale 1, no fit notice.
  - A 900 mm vertical LINE: the same.
  - A 600 × 1 mm box: fitted to 60 %, with the notice.
  - W5-P2-1 cases 1 and 3 above are this too: a 1.8 km line stays at file size.
- **Severity: P3.** The canvas draws its out-of-bounds outline (`draw-out-of-bounds-outlines.ts`), and preflight's bounds check (`preflight.ts`, `appendBoundsIssues`) reports the overrun before output. So it is a contract gap with a visible, warned result, not a silent burn.
- **Fix direction:** fit on the non-degenerate axis (treat `bed / 0` as Infinity). Keep the 1e-6 tolerance.

### Challenges

- **The auditor's L3 twin list missed HPGL** (W5-P2-2), and its own arc twin (radius 1e20) was right only for axis-aligned chords (W5-P1-1).
- **14-P3-1** was left for the coordinator to re-rate. Under the 2026-10-27 rule and the J6-P1-1 precedent it is P1, so it should not stay in the KNOWN P3 table.
- **"The import succeeds, with at most the bed-fit notice" (W5-P2-1)** is accurate. But the autosave toast that follows names image size as the cause and tells the user to Save manually, which also fails. The fix should reword both, as 13-P2-1's fix did for the salvage prompt.

### Not verified

- **No in-app browser session** (only the headless ground-truth page). The Save and autosave toast and confirm wording for W5-P2-1 and W5-P2-2 were READ, not seen.
- **The main-thread DOMPurify SVG route** (PDF pages, library, remote) was not re-run for 14-P3-1 or for the arc twin of W5-P1-1. v2 found the CSS gap on all three routes.
- **G-code text for W5-P1-1.** The compiled job's coordinates were checked, not the emitted G-code. Compile is the emitter's only geometry source.
- **How often real DXF writers emit noise bulges below 1e-16** was not surveyed (no downloads).
- **PDF/AI vector import against the loader cap** (the W5-P2-1 class): not run, because pdf.js is not runnable here.

```json
[
  {"id":"W5-P2-1","severity":"P2","verdict":"CONFIRMED","refuter":"Own REPRO through the real store (importSvgObject) and parseDxfBlob: ±900,000 LINEs, a part plus a stray at 999,000, and a metres site plan all import with notes [] and make Save and autosave invalid (scene.objects[1].bounds.maxX). The pre-import autosave slot survives (autosave-durable.ts:261-267); deleting the import restores Save; the salvage copy does not reopen. P2 by the 13-P2-1 precedent; not P1 because nothing is lost silently"},
  {"id":"W5-P3-1","severity":"P3","verdict":"REFUTED","refuter":"Ground truth false: Chromium 156 (headless, cached) draws nothing for arc radii >= ~3.4e38 (bbox 0x0 for 1e76-1e300), so the dropped segment matches the browser. The threshold is ~1.2e77, not 1.34e154. The 'A1e20 is correct' twin fails for non-axis chords: see W5-P1-1"},
  {"id":"14-P2-1","severity":"P2","verdict":"KNOWN","refuter":"Re-checked with Illustrator-shaped CS6, CC 27 and Export As files: 19.05 / 72 / 25.4 / 19.05 mm, notes []. The canvas faithfully shows the size. Kept P2: the px half follows the CSS 96 px/in spec; the viewBox-only half follows ADR-574's documented assumption (BQ-20); twin 14-P3-4 is P3"},
  {"id":"14-P3-1","severity":"P1","verdict":"CONFIRMED","refuter":"RE-RATED P3 -> P1. Chromium 156 draws translateX(20px), the translate property and a style-rule translateY at 20..30; KerfDesk imports at 0..10 with notes [] (svg-transform-attribute.ts:44,60; svg-presentation.ts:113). A silent position error against the browser; the canvas shows the misreading, which is not a warning (J6-P1-1, METHOD §3 2026-10-27)"},
  {"id":"W5-P1-1","severity":"P1","area":"import-export-formats","file":"src/io/dxf/dxf-native-curves.ts","line":36,"anchor":"Twin: dxf-curve-sampling.ts:24-41 polyline for the same bulge is straight; Ground truth: sagitta |b|*chord/2 ~ 2e-16 mm; Chromium 156 draws A1e17..A1e20 arcs as their chord","evidence":"REPRO","verdict":"CONFIRMED","known":false,"found_by":"refuter","summary":"A near-zero LWPOLYLINE bulge (<= ~1e-16) puts the arc centre 1e17+ mm away and the canonical cubic's controls tens of mm to metres off; compile and canvas use that cubic. A 40x30 plate with bulge 2.449e-17 / 1e-17 on one edge compiles X 164.8..235.2 / 129.5..270.5 (70.4 / 141.1 mm wide) with only 'Imported 1 path'; 1e-18 / 1e-19 make the design 1226 / 4612 mm wide and bed-fit it to 29.4% / 7.8%. The SVG arcToCubics twin (radius >= ~1e16 x chord) gives the same"},
  {"id":"W5-P2-2","severity":"P2","area":"import-export-formats","file":"src/io/hpgl/hpgl-result.ts","line":26,"anchor":"Twin: svg-import-budget.ts:58-68, lbrn-geometry.ts:168,195; project-shape-primitives.ts:2 loader cap","evidence":"REPRO","verdict":"CONFIRMED","known":false,"found_by":"refuter","summary":"HPGL import checks only finiteness: strokes 1,025 m apart (or one 1e12 coordinate, 25,000 km) import with notes [] and then Save and autosave refuse the project (bounds.maxX); twin of W5-P2-1"},
  {"id":"W5-P3-2","severity":"P3","area":"import-export-formats","file":"src/core/scene/fit-to-bed.ts","line":59,"anchor":"Contract: ADR-125 Amendment 1 Decision 2-3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"found_by":"refuter","summary":"measureBoundsBedFit treats a zero width or height as 'fits', so a 600 mm straight line (or a 1.8 km DXF of horizontal lines) is never scaled to the bed and gets no notice; the canvas out-of-bounds outline and preflight bounds check still report it"}
]
```

Refuter counts: raised 6, refuted 1, P1 2, P2 2, P3 1, known 29. "Raised" counts the auditor's 2, this refuter's 3 new findings, and 14-P3-1, counted because this refuter re-rated it to P1. "Known" is the auditor's 30 less 14-P3-1; 14-P2-1 stays KNOWN at P2.
