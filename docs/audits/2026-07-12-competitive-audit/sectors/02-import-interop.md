# S02 · Import, export & interop

Products rated: KerfDesk, LightBurn 2.1.03, MillMage 0.8.02, LaserGRBL 7.14.1, XCS (= xTool Studio desktop V1.7.x, XCS's successor), Easel (web SaaS, Free/Starter/Pro); N/R: none — every roster Tier-1 product imports/exports files. Tier-2 products (Carbide Create, VCarve, gSender) are not rostered in S2.
Pinned evidence: KerfDesk @ 3e453074 (evidence pack `data/S02-evidence.json`, incl. a green `vitest run src/io` 50 files / 365 tests this session); competitor versions per `data/phase0.json`.

Scale: anchored 0–10 integers per design §5.1. `U` = unknown (excluded from roll-ups). No hardware (`*`) or fidelity-capped categories exist in this sector. `[INF]`-tagged cells are flagged and support no win/lose bullet.

| # | Category | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel |
|---|----------|----------|-----------|----------|-----------|-----|-------|
| 2.1 | Vector import breadth | 6 [CODE]¹ | 10 [OFF]⁸ | 9 [OFF]⁹ | 3 [OFF]¹⁰ | 5 [OFF]¹¹ | 5 [OFF]¹² |
| 2.2 | Raster import breadth | 4 [CODE]² | 8 [OFF]⁸ | 8 [OFF]⁹ | 7 [OFF]¹³ | 10 [OFF]¹⁴ | 3 [OFF]¹⁵ |
| 2.3 | Foreign project interop | 3 [CODE]³ | 9 [OFF]¹⁶ | 8 [OFF]⁹ | 5 [OFF]¹⁷ | 0 [OFF]¹⁸ | 4 [OFF]¹⁹ |
| 2.4 | Import fidelity & robustness | 6 [PERC]⁴ | 7 [COMM]²⁰ | U [INF]²¹ | 3 [OFF]²² | 5 [OFF]²³ | 4 [OFF]²⁴ |
| 2.5 | Import UX | 5 [CODE]⁵ | 10 [OFF]²⁵ | 8 [OFF]⁹ | U [INF]²⁶ | 4 [OFF]²⁷ | 5 [OFF]²⁸ |
| 2.6 | Export breadth | 5 [CODE]⁶ | 10 [OFF]⁸ | 9 [OFF]²⁹ | 3 [COMM]³⁰ | 6 [OFF]³¹ | 3 [OFF]³² |
| 2.7 | Re-import & linked sources | 7 [CODE]⁷ | 0 [INF]³³ | 0 [INF]³⁴ | 0 [INF]³⁵ | U [INF]³⁶ | 0 [INF]³⁷ |

**KerfDesk citations (file:line at 3e453074, from S02-evidence.json)**
¹ `src/ui/commands/command-families.ts:34-42` (SVG/DXF/Image are the only import commands); `src/io/dxf/parse-dxf.ts:1-52` + `src/io/dxf/dxf-expand.ts:52,95,138-150` (clean-room ASCII DXF: LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE/ELLIPSE/SPLINE, recursive INSERT depth 8, $INSUNITS); `src/io/stl/parse-stl.ts` + `src/ui/app/use-import-drag-drop.ts:65,88-92` (STL drag-drop only); grep: no .ai/.pdf/.eps/.cdr/.plt handling.
² `src/ui/commands/platform-image-files.ts:3` (`IMAGE_FILE_EXTENSIONS = ['.png','.jpg','.jpeg']`); `src/ui/app/use-import-drag-drop.ts:118-124`; `src/ui/common/image-density.ts:1-28` (pHYs/JFIF DPI, clamp 10–10000); `DECISIONS.md:2508` ADR-048 (254 DPI default, LightBurn parity).
³ grep at 3e453074: zero .lbrn/.crv/.easel import matches; `src/io/lightburn/lbdev-import.ts:97` (.lbdev import, guessed schema, GRBL-gated); `src/io/gcode/parse-gcode-program.ts:1-24` (GRBL-dialect G-code parser incl. G2/G3, preview-only); `src/ui/commands/command-families.ts:51-58` ("Open G-code (Preview)" — CNC mode only); `src/io/gcode/gcode-reimport-parity.test.ts:1-5` (green this session).
⁴ `src/io/svg/svg-units.ts:1-23` (ADR-046 unit resolution); `src/io/svg/flatten-curves.ts:12` + `src/io/svg/transform-scale.ts:1-14` (0.25 mm adaptive flattening, scale-compensated — audit C2 fix); `src/io/svg/import-perceptual.test.ts:33-53` (IoU ≥ 0.95 vs analytic disc, re-run green this session — the PERC anchor); `src/io/svg/malicious-corpus.test.ts`; `src/io/dxf/dxf-entities.ts:190-215` (unreadable-geometry skip, 1e6 mm cap); `src/core/preflight/preflight.ts:410` + `src/core/invariants/non-finite-coords.ts:21-23`; defect: `src/io/svg/parse-svg.ts:448-451` (SVG text + embedded images silently dropped, stale "Phase D/E" toasts).
⁵ `src/ui/app/use-import-drag-drop.ts:58-92` (universal drag-drop, batch, ignored-file toasts); `src/ui/app/file-actions.ts:76-81` (size-before-read oversize confirm); `src/ui/commands/command-families.ts:34-42` (menu import split three ways, Ctrl+I = SVG-only picker, S1-F4 unfixed); grep: no Open Recent (S1-F9), no OS-clipboard import; `src/io/svg/parse-svg.ts:414-438` (synchronous main-thread parse).
⁶ `src/ui/app/file-actions.ts:120-179` (G-code save: preflight, $30/$32 readiness confirm, provenance header); `src/io/gcode/gcode-metadata.ts:1-32`; `src/ui/app/save-tiled-gcode.ts:56-58` (tiled export readiness-gated, M-04 fixed); `src/ui/app/file-actions.rd-routing.test.ts:77-78` + `src/ui/app/save-rd-action.test.ts` (Ruida binary .rd, ADR-097); `src/ui/laser/MachineSetupImportExport.tsx:84-86` + `src/ui/app/material-library-file-actions.ts:46,77` (profile/.lfml.json round-trip); `src/ui/commands/multi-file-trace-action.ts:38-41` (batch trace → SVG files); grep: no general scene SVG/DXF/image export.
⁷ `src/ui/state/scene-mutations.ts:82-90,454-486` (same-filename re-import replaces in place, keeps id/transform/layer settings, kept/added/removed diff); `src/ui/state/object-insert-actions.ts:55-69` (replace is unconditional — S1-F5, un-ADR'd divergence from LightBurn add-a-copy); `src/ui/app/file-actions.ts:87-94` (diff toast); rasters always add fresh; grep: no file-watch/linked-source machinery.

**Competitor citations (from S02-market.json)**
⁸ https://docs.lightburnsoftware.com/latest/Reference/FileManagement/ (import .ai/.svg/.dxf/.pdf/.plt-.hpgl; raster PNG/JPG/BMP/GIF/TIFF; export .ai/.svg/.dxf + .png/.jpg/.bmp; .lbrn/.lbrn2); also https://docs.lightburnsoftware.com/2.1/GetStarted/CreatingAndImportingArtwork/.
⁹ https://docs.millmagesoftware.com/latest/Reference/FileManagement/ (format lists identical to LightBurn; opens .mage/.lbrn/.lbrn2; drag-drop + Recent Projects/Templates; clipboard paste not documented).
¹⁰ https://lasergrbl.com/faq/ (SVG import "in an early state of development", Inkscape-tuned, no text/fills); https://github.com/arkypita/LaserGRBL/issues/408 (DXF long-open request).
¹¹ https://support.xtool.com/article/2520 + https://support.xtool.com/article/2805 (xTool Studio imports SVG and DXF only; PDF/AI must be converted first).
¹² https://support.easel.com/hc/en-us/articles/35388639766163-File-Import-Guide (SVG, DXF < 5 MB, STL, custom fonts; no AI/PDF/EPS).
¹³ https://lasergrbl.com/usage/raster-image-import/ (BMP/JPG/PNG/GIF; raster→G-code is the app's core design).
¹⁴ https://support.xtool.com/article/544 + /article/2805 (JPG/JPEG/GIF/PNG/BMP/WEBP — only roster product with documented WebP).
¹⁵ https://support.easel.com/hc/en-us/articles/360012593313-Image-Trace + File Import Guide (JPG/PNG only, and only via Image Trace or Pro raster toolpaths).
¹⁶ FileManagement (⁸) + https://lightburnsoftware.com/blogs/news/millmage-is-here (native .lbrn/.lbrn2, opens MillMage .mage; G-code import extracts geometry only).
¹⁷ https://lasergrbl.com/usage/load-and-send/ (G-code load/preview/stream is the core function; no foreign project formats).
¹⁸ https://support.xtool.com/article/2805 (exhaustive import list: only .xcs projects; no G-code/.lbrn — existence "no", scored 0 per roster rule).
¹⁹ https://support.easel.com/hc/en-us/articles/42822994372243-Importing-G-Code-to-Easel (G-code import with visualization, but must pass a post-processor to match the Easel spec).
²⁰ https://docs.lightburnsoftware.com/latest/Reference/SettingsPreferences/ (SVG-DPI preference, v1.5 spline importer) tempered by community fidelity reports: forum.lightburnsoftware.com/t/148027 (DXF 25.4× mis-scale), /t/46146 (spline artifacts), /t/50888 (72-vs-96-DPI paste drift).
²¹ MillMage import fidelity: docs mirror LightBurn's engine (⁹) but "too young for community fidelity consensus — quality unknown"; shared-code inference is [INF] → U, logged as research debt.
²² https://lasergrbl.com/faq/ (SVG "as is": no text, borders only, Inkscape-tuned, "expect some problems" elsewhere); https://github.com/arkypita/LaserGRBL/issues/451.
²³ https://support.xtool.com/article/2520 + /2805 (per-import DPI setting, auto DXF unit detection, Best/High/Medium parse quality, import-failure FAQ; no community quality consensus — [OFF] proves controls exist, not quality).
²⁴ https://support.easel.com/hc/en-us/articles/35388639766163 + /42822881692435 (DXF < 5 MB, SVG text unsupported, strict G-code spec).
²⁵ FileManagement (⁸) + forum.lightburnsoftware.com/t/31505 (universal import dialog, drag-drop, clipboard paste of images/text, Recent Projects/Templates — fullest import UX of roster).
²⁶ https://lasergrbl.com/usage/load-and-send/ — drag-drop/clipboard/recent-files behavior not documented anywhere found → U.
²⁷ https://support.xtool.com/article/2520 (picker with per-import parse options; drag-drop/paste unevidenced).
²⁸ Import tab groups SVG/DXF/Image-Trace/G-code entry points; cloud project dashboard; no drag-drop/paste documented (¹² + ¹⁵ URLs).
²⁹ https://docs.millmagesoftware.com/latest/Reference/FileManagement/ (.ai/.svg/.dxf export with R12/R2007 DXF dialects; .mage; per-controller G-code/machine file).
³⁰ https://github.com/arkypita/LaserGRBL/discussions/2163 + youtube.com/watch?v=4vPG4QJXu4o + facebook.com/groups/lasergrbl/posts/2132466337247351/ (G-code save exists; no vector export — DXF export an unfulfilled request).
³¹ https://support.xtool.com/article/2546 (PNG/JPG export at 50–1000 DPI, SVG export, legacy .xcs export; no G-code or DXF export documented).
³² https://support.easel.com/hc/en-us/articles/4406926040979-Exporting-Gcode-from-Easel + easel.inventables.com (G-code export tier-gated: Free 1/week, Starter 20/week, Pro unlimited; no SVG/DXF design export); forum.easel.com/t/25216.
³³ [INF] https://docs.lightburnsoftware.com/latest/Reference/FileManagement/ documents open/import/export only; no linked-source or update-from-file workflow appears (nearest: Cuttle.xyz integration, one-way).
³⁴ [INF] MillMage FileManagement page reviewed; no re-import/linked-source workflow documented.
³⁵ [INF] lasergrbl.com/usage/ docs set reviewed; no project or linked-file concept — each load is a one-shot conversion.
³⁶ [INF] xTool Studio articles 2520/2546 cover import/export only; absence not confirmed exhaustively (docs scattered per-machine) → U.
³⁷ [INF] Easel File-Importing-and-Exporting section reviewed; no re-import/linked-source article exists.

### State of play

This sector splits cleanly into breadth, which KerfDesk loses, and depth-plus-robustness engineering, where it is competitive with everything except LightBurn. LightBurn 2.1.03 and MillMage 0.8.02 share one file engine and own the breadth crown on every axis: five vector formats in (.ai, .svg, .dxf, .pdf, .plt/.hpgl), five raster formats, vector *and* image export out, and native cross-reading of each other's project files. KerfDesk imports exactly two vector formats (SVG, DXF — plus STL by drag-drop for CNC relief) and two raster formats (PNG, JPG). That puts its import breadth at rough parity with xTool Studio and Easel, well above LaserGRBL, and roughly four points behind the LightBurn-family ceiling.

What the format list hides is that KerfDesk's two vector importers are unusually deep for a free tool. The clean-room DXF pipeline handles LINE/CIRCLE/ARC/LWPOLYLINE/classic POLYLINE/ELLIPSE/SPLINE, recursive INSERT/MINSERT blocks to depth 8, $INSUNITS unit resolution, and ACI layer colors, and it skips unreadable geometry with counted, user-visible notes instead of failing. The SVG side has ADR-046 unit resolution, 0.25 mm adaptive curve flattening with transform-scale compensation, DOMPurify sanitization, resource budgets, a hostile-input corpus, and — uniquely in this evidence set — an instrumented perceptual import test (imported circle vs analytic disc, IoU ≥ 0.95, re-run green this session). Meanwhile LightBurn, for all its breadth, carries recurring community reports of DXF 25.4× unit mis-sizing, spline artifacts, and clipboard 72-vs-96-DPI drift; its 7 in 2.4 reflects breadth of handled content (it imports text, given locally installed fonts) minus those field bugs. KerfDesk's 2.4 stops at 6 because of one loud defect: SVG `<text>` and embedded `<image>` elements are silently dropped with stale "Phase D/E" toasts, even though those phases shipped — a real-world file with a caption imports visibly wrong.

Interop is the structural loss of the sector. KerfDesk's users, per PROJECT.md, come from LightBurn — and KerfDesk cannot open a .lbrn/.lbrn2 file, an absence no ADR records (full-sweep S1-F10, re-checked at 3e453074), so per design §5.6 it feeds the register at bumped severity. The only LightBurn bridge is .lbdev device-profile import, built against a guessed schema and gated to GRBL. G-code comes in only as a CNC-mode preview ("Open G-code (Preview)"), never as editable or runnable geometry in laser mode — LaserGRBL, whose entire product is G-code load-preview-stream, scores above KerfDesk here despite reading no project format at all. On the export side, KerfDesk's machine-facing story is genuinely strong (G-code with preflight/readiness-gates/provenance headers, Ruida binary .rd, readiness-gated tiled multi-file export, profile and material-library JSON round-trips), but there is no way to get artwork out: no scene SVG, DXF, or image export except the batch-trace path. LightBurn exports .ai/.svg/.dxf plus images; even xTool Studio exports SVG and DPI-selectable PNG/JPG. Easel is the only product KerfDesk clearly beats on export posture — its free tier meters G-code export to one per week.

Import UX is mid-pack: KerfDesk's window-level drag-drop (all five accepted types, overlay, batch stagger, named ignored-file toasts, size-before-read oversize confirm) is competitive with anything documented in this roster, but the menu path is still three format-specific commands with Ctrl+I hard-bound to an SVG-only picker (S1-F4), there is no OS-clipboard paste import, no Open Recent (S1-F9), and SVG parsing runs synchronously on the main thread. LightBurn's documented universal dialog + paste + Recent Projects/Templates set is the roster's fullest and takes the 10.

Category 2.7 is the sector's one KerfDesk-leads cell: same-filename SVG/DXF re-import replaces the placed object in place, preserving object id, transform, and per-color layer settings, and toasts a kept/new/removed color diff. No competitor documents any equivalent — but every competitor cell in 2.7 is [INF] (absence inferred from doc review), so per §7.2 this cannot be claimed as a win headline; it stands as a flagged observation pending Phase-3 verification. The rating also isn't higher than 7 because the replace is unconditional (no "import as copy" choice — S1-F5, itself an un-ADR'd divergence from LightBurn's add-a-copy default), rasters are excluded, and there is no linked-file watching. Two U cells (MillMage 2.4 fidelity, LaserGRBL 2.5 UX, XCS 2.7) are logged as research debt rather than guessed.

### Where we win / where we lose

Wins (competitor cell anchored [OFF]/[COMM], never [INF]; all pending Phase-3 refuter per §5.5):

- WIN 2.1 (+3 vs LaserGRBL) — Full DXF import (splines, blocks, units) plus SVG and STL, against LaserGRBL's single officially-"early" Inkscape-tuned SVG importer. [verified: refuter pending]
- WIN 2.3 (+3 vs XCS) — KerfDesk at least visualizes G-code (CNC preview, G2/G3, reimport-parity-tested); xTool Studio's documented import list opens nothing foreign at all. [verified: refuter pending]
- WIN 2.4 (+3 vs LaserGRBL) — Unit/DPI resolution, sanitization, budgets, malformed-file skip-and-report, and a perceptual import test, versus SVG handled "as is" with no text/fill and Inkscape-only tuning. [verified: refuter pending]
- WIN 2.6 (+2 vs Easel) — Unmetered G-code/.rd/tiled export against Easel's tier-gated one-export-per-week free tier. [verified: refuter pending]
- (Flagged, not claimable: 2.7 — KerfDesk is the only product with an evidenced replace-on-reimport workflow, but all competitor absences are [INF].)

Losses:

- LOSE 2.1 (−4 vs LightBurn/−3 vs MillMage) — No AI, PDF, EPS, CDR, or PLT import; no binary DXF. → G-S02-1
- LOSE 2.2 (−6 vs XCS, −4 vs LightBurn/MillMage) — PNG/JPG only; no BMP, GIF, TIFF, or WebP. → G-S02-2
- LOSE 2.3 (−6 vs LightBurn, −5 vs MillMage) — No .lbrn/.lbrn2 reader for the exact users we court, and the absence is un-ADR'd (§5.6 severity bump); G-code opens as CNC-only preview, never geometry. → G-S02-3
- LOSE 2.5 (−5 vs LightBurn) — No clipboard-paste import, no Open Recent, import menu split three ways with an SVG-only Ctrl+I. → G-S02-5
- LOSE 2.6 (−5 vs LightBurn, −4 vs MillMage) — No artwork export whatsoever (SVG/DXF/image out); designs enter KerfDesk but never leave as vectors. → G-S02-6
- (2.4 −1 vs LightBurn is inside the ±1 noise band, but the silent SVG text/image drop is a concrete un-ADR'd behavior gap → G-S02-4.)

### Gaps feeding the register

- G-S02-1 · 2.1 Vector import breadth · vs LightBurn/MillMage · Δ−4 · no AI/PDF/EPS/CDR/PLT, no binary DXF · ADR-recorded: partially (PROJECT.md lists AI/PDF out of scope per S1-F10 evidence) · effort L · P2.
- G-S02-2 · 2.2 Raster import breadth · vs XCS Δ−6, LightBurn Δ−4 · PNG/JPG only; browser-decodable BMP/GIF/WebP are low-effort adds · un-ADR'd · effort S · P2.
- G-S02-3 · 2.3 Foreign project interop · vs LightBurn Δ−6 · no .lbrn/.lbrn2 import despite LightBurn-switcher persona; absence un-ADR'd (S1-F10) → severity bump per §5.6 · effort L · P1.
- G-S02-4 · 2.4 Import fidelity · vs LightBurn Δ−1 · SVG text and embedded images silently dropped with stale "Phase D/E" toasts (parse-svg.ts:448-451); un-ADR'd divergence — LightBurn imports text with local fonts · effort M · P1.
- G-S02-5 · 2.5 Import UX · vs LightBurn Δ−5 · no clipboard paste, no Open Recent (S1-F9), split import menu + SVG-only Ctrl+I (S1-F4), sync main-thread parse (S1-F6) · un-ADR'd · effort M · P2.
- G-S02-6 · 2.6 Export breadth · vs LightBurn Δ−5 · no scene SVG/DXF/image export; blocks round-tripping artwork to other tools (P3 production-shop persona weighs S2 at 8/100) · un-ADR'd · effort M · P1.
- G-S02-7 · 2.7 Re-import semantics · vs LightBurn · Δ n/a (we lead the category) · unconditional replace-on-reimport with no add-as-copy option is an un-ADR'd divergence from LightBurn's add-a-copy (S1-F5) → bug classification per §5.6 · effort S · P2.

### Not verified

- No fidelity-capped or hardware (`*`) categories exist in S2; no hardware claims are made.
- KerfDesk import behavior on a real-world Illustrator/AutoCAD/Inkscape file corpus — repo tests are synthetic fixtures; the only perceptual instrument is the single circle fixture (import-perceptual.test.ts).
- Binary DXF handling (parser header states ASCII-only; never exercised).
- Decode path for renamed/mislabeled raster bytes (whether a renamed BMP/GIF/WebP passes the extension filter and decodes) — not tested.
- .lbdev import fidelity against files genuinely produced by LightBurn's Export Devices — no authentic sample exists in the repo (consolidated-audit A.4.5); schema is guessed.
- Ruida .rd byte-stream correctness against a real controller or a LightBurn-exported golden file — verification is circular through the repo's own decoder (A.3.4).
- Live-app behavior of drag-drop overlay, toasts, pickers, and the re-import diff — verified from code and the 2026-07-10 audits only; no dev-server interaction this session (CLAUDE.md rule 4).
- DXF re-import end-to-end (shares the imported-svg pipeline but not separately exercised).
- Whether interactive post-import user scaling re-flattens curves (full-sweep S5-F2 residual) — not re-checked this session.
- U cells (research debt): MillMage 2.4 import fidelity (docs mirror LightBurn but no community consensus); LaserGRBL 2.5 import UX (undocumented); XCS 2.7 re-import (absence not exhaustively confirmed).
