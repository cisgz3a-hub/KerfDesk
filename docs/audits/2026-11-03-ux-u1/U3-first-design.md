# U3 `first-design` — auditor report

- **When:** 2026-11-03
- **Tree:** `origin/main` c93fbb3bc (`git fetch origin main`; no `src` or `public` change since U1's 22dca0a20). Production web build (Browser Free) from `git archive c93fbb3bc`.
- **Scope:** a beginner with a diode laser (Machine Setup → **My machine isn't listed**, Laser only, 400 × 400, GRBL v1.1, saved; no connection) makes a first design by following only the screen: text, a rectangle and a circle (typed and dragged, aligned, grouped), an SVG logo, a phone photo (JPEG), operations (Line, Fill, Image), power and speed (material library, defaults, 100 % at 100 mm/min), Preview, Save and reopen.
- **Counts:** raised 9 (P1 0, P2 4, P3 5), plus 7 KNOWN re-observed and 4 refuted (own candidates).
- **Counts after the refuter:** raised 10 (P1 1, P2 2, P3 7): U3-P2-2 raised to P1, U3-P2-1 lowered to P3, one new P3 (U3-P3-6). 0 refuted; 7 KNOWN and the auditor's 4 refutations upheld. See [Refuter summary](#refuter-summary).

`SCRATCH` = `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u3`. Screenshots are in `SCRATCH\shots\`.

**How to rebuild what I ran.** The build tree and bundle were deleted at the end; the scripts are kept.
- Tree: `git archive c93fbb3bc src public scripts index.html vite.config.ts package.json tsconfig.json electron` into `SCRATCH\tree`, a `node_modules` junction to the repo's `node_modules`, and `zz-s3\zz-s3-vite.config.ts` copied in as `zz-u3-vite.config.ts`.
- Build: `node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --config zz-u3-vite.config.ts --outDir ../dist`.
- Host: `node zz-u3-host.mjs dist 4931` (production CSP, COOP, COEP; serves `fixtures\` at `/__zz__/<name>`).
- Driver: `node zz-u3-drive.mjs` (port 4932; headless Chrome, a clean context per `h.fresh()`), driven with `sh zz-u3-d.sh '<js body>'`. `zz-u3-init.js` stands in for the native Open/Save pickers (Open returns `fixtures\<__ZZ_PICK>` or an in-page file; Save keeps the written bytes) and makes a phone-size JPEG in the page (`__ZZ.makePhoto(name, w, h)`).
- Fixtures: `fixtures\logo.svg` (80 × 40 mm: red outline, black badge circle with a white diamond, blue score lines). G-code read back: `zz-u3-logo.nc`, `zz-u3-coaster.nc`; analysed with `node zz-u3-rows.mjs <file.nc> <y>` (lit length per layer and the lit spans on one scan row).
- **Cleanup warning:** remove `tree\node_modules` with `cmd /c rmdir` before deleting `tree`.

## Headline

Drawing a first design is easy to follow. Text has a font picker that previews the beginner's own word, and Size is explained as the em in mm. Typed X/Y/W/H are exact. Align and Group work. Line, Fill and Image each have a plain tooltip, every dither has a one-line description, and an off-bed design gets red dashed outlines plus a Preview warning. Preview is one click away and shows paths, fills, rasters and the time. Save and reopen work.

The beginner gets misled at the points where the numbers and the imported artwork come from:
- **Power and speed.** Every new laser operation starts at 30 % / 1500 mm/min with no word that these are starter values (ADR-500 Amd 1 decision 5). Worse, the only place that ever called them "guesses" is the machine card, and it disappears once the machine is set up. For a generic GRBL laser the Material Library is empty and offers no starters. (U3-P2-1)
- **An SVG logo's white parts burn.** A white diamond knocked out of a black badge becomes its own Fill operation, so the badge burns solid and the diamond twice. The import toast says only "3 objects, 4 colors". (U3-P2-2)
- **Photo engraving never previews a phone photo.** Any photo over about 5.6 MP gets "~140 MB materialized working set exceeds the 64 MB budget", whatever size it is placed at. (U3-P2-3)
- **A cut drawn first runs first.** A coaster outline set to cut, then a name engraved inside it, burns the cut before the engraving. Nothing says to cut last, and the one-click fix is in a menu. (U3-P2-4)

There is no P1. Nothing placed a design off the bed, or put a Fill on the wrong operation, without a warning.

**The single biggest help for a first design:** say on the Operation panel, under Power and Speed, that 30 % / 1500 mm/min are starter values, and link from there to the Material Test. That is the question every beginner asks next ("what numbers do I use?"), and today the screen implies it has already answered it.

## Beginner journey

1. **Empty workspace** (`shots/01-empty.png`). The card reads "Generic 400 × 400 mm machine. The bed, power and speeds are guesses until you set up your machine." I chose **Set up machine**.
2. **Machine Setup** (`02-setup.png`, `03-not-listed.png`, `04-essentials.png`, `05-review.png`). No generic diode is listed. **My machine isn't listed** opens a form: "Not sure? Most diode lasers and hobby CNC machines run GRBL." I named it "My diode laser", left 400 × 400 and GRBL v1.1, then Next, Next, **Save machine setup**. The card is gone and the toolbar reads "My diode laser · Not connected" (`06-machine-saved.png`). U2 owns this part.
3. **Text** (`07-text-click.png` … `11-text-done.png`). The **Text** tool says "Click the canvas to type". Typing "Sarah" opens a Text panel. Font is a picker that shows "Sarah" in every bundled font, labelled Sans, Script, Single-Line and so on (`09-font-picker.png`). I chose Pacifico. "Font size 10 mm"; its tooltip says "The font's em height in mm … Capital letters come out smaller: about 0.6 to 0.9 of the size". I typed 30 → the toolbar shows 80.55 × 28.44 mm. **Done** creates an operation called "Sarah": **Line**, Power 30, Speed 1500 (`11-text-done.png`). Nothing near Power or Speed says where these numbers come from (U3-P2-1).
4. **Rectangle** (`12-rect-drawn.png`, `13-rect-typed.png`). Dragged 90 × 60, then typed W 80, H 50, X 20, Y 20: the status bar reads exactly "80.0 × 50.0 mm · X 20.0, Y 20.0". It got its own operation "Rectangle". Y 20 is measured down from the top (rear) edge, while Machine Setup said the origin is front-left (KNOWN L8-P2-6).
5. **Circle** (`14-ellipse-drawn.png`). "Draw ellipse" says "Draw an ellipse or circle" but not how; a plain drag gave 40 × 50. Shift-drag gave a circle (U3-P3-4). Typed W 40, H 40.
6. **Align and group** (`15-arrange-menu.png`, `16-aligned-grouped.png`). Arrange → **Align Centers** is disabled until two objects are selected ("Select at least two objects…"). Shift-click added the rectangle, Align Centers centred the circle in it, and Ctrl+G grouped them (Group is in Edit, with its shortcut). The status bar shows "Groups: 1". The panel says "Multiple operations … Keep them independent or choose one operation to share".
7. **Dragged off the bed** (`17-dragged-off-bed.png`, `18-preview-offbed.png`). The group outline turns red and dashed at once. Preview adds "Some objects extend past the bed (red dashed outlines). This is a warning, not a block…". Undid it.
8. **Imported an SVG logo** (`19-svg-import.png`, `20-all-operations.png`, `21-logo-canvas-zoom.png`, `22c-preview-zoomed.png`). The toast says "Imported logo.svg — 3 objects, 4 colors". It made four operations: "logo" (Line), "logo 1" (Fill), "logo 2" (Fill), "logo 3" (Line). The badge shows as a solid black circle, and the logo's white diamond is gone from the canvas. Preview fills the diamond as a separate operation (U3-P2-2). The time went from 45 s to 7 min 54 s. The operation names don't say which part is which (folded into U3-P3-3).
9. **Imported a phone photo** (`23-photo-import.png`, `24-photo-preview.png`). A 4032 × 3024 JPEG via **Import image**. "Warning: IMG_2041.jpg is larger than the 400 × 400 mm bed (403.2 × 302.4 mm), so it was scaled to 89.3% to fit. Undo restores the original size." It became an **Image** operation: Floyd-Steinberg ("Fine scattered dots. The classic choice for photos."), Line interval 0.1 mm. The Laser panel shows "large job" instead of a time; Preview says "Estimated time 11h 17m 32s" and shows a jargon banner (U3-P3-5).
10. **Resized the photo** (`25-photo-w100.png`, `26-photo-100.png`). Typed W 100: the face squashed to 100 × 270 mm, because the aspect lock is off by default (U3-P3-2). Undid it, locked, W 100 → 100 × 75.
11. **Photo engraving** (`41-photo-engraving.png`, `42-photo-engraving-100mm.png`, `43-photo-engraving-3mp.png`, `44-photo-engraving-3mp-100mm.png`). The window is well written: Material recipe (Wood, Leather, Black anodized aluminium, …), "Power, speed and DPI stay yours to test", tone calibration explained. But the preview box reads "Photo preview is unavailable at this size: ~140 MB materialized working set exceeds the 64 MB budget", at 360 mm and at 100 mm alike. A 2000 × 1500 photo gets "the full scan plan exceeds the preview working-set budget" at its import size (200 mm), and previews only after it is shrunk to 100 mm (U3-P2-3).
12. **Materials** (`27-materials-tab.png`, `28-saved-libraries.png`). The **Materials** tab is easy to find, next to Properties and Run order. It reads "Create a library below, or open one from Saved Libraries." with **Saved Libraries…**, **Experiments…** and **New library**. Saved Libraries: "No saved libraries yet." No starter set exists for a generic laser (KNOWN G-S05-3). Tools → **Material Test…** exists (`38-material-test.png`), but nothing on the Operation panel or the Materials tab points to it (U3-P2-1).
13. **Text to Fill, 100 % at 100 mm/min** (`29-sarah-fill.png`, `30-power100-speed100.png`). Fill shows the text filled on the canvas. 100 % and 100 mm/min ("1.7 mm/s") are accepted without any notice. Export G-code says only "The complete export is ready" (`32-export-gcode.png`) (U3-P3-1).
14. **Run order** (`31-run-order.png`, then a fresh coaster project in `43-coaster.png` and `44-coaster-run-order.png`). The tab is clear: "Choose what runs first … Change a run number". In the coaster, the cut circle (Line, 100 %, 300 mm/min) drawn first is run 1, and the Fill text inside it is run 2; the G-code agrees (`zz-u3-coaster.nc`). Nothing advises cutting last (U3-P2-4).
15. **Save** (`33-save.png`, `34-saved.png`). **Save** → "Save project — Your project is ready. Choose a filename and folder to save it." → **Choose file…**; the suggested name is `untitled.lf2`. The toast says "Saved project to untitled.lf2", and the title becomes "untitled.lf2". The picker's type reads "Files" (KNOWN U1-P3-6).
16. **Coming back** (`35-returning.png`, `36-file-menu.png`, `37-reopened.png`). Reopened the page: the machine "My diode laser" is kept. File menu lists **Recent Projects…** and `untitled.lf2` at the bottom. Opening it brought back 7 objects, 2 groups and 8 operations. The "can't be reopened directly" toast came from my stand-in picker (see Refuted).

## Findings

### U3-P2-1 — Starter power and speed (30 % / 1500 mm/min) are never called starter values, and the only "guesses" notice disappears when the machine is set up

- **Where:**
  - The values: `src/core/scene/layer.ts:142-146` (`LAYER_DEFAULTS` `power: 30`, `speed: 1500`). No machine profile seeds laser power or speed.
  - The Operation view: `src/ui/layers/SelectedLaserOperationFields.tsx:25-102`. It has Power, Speed, Passes and More cut settings, and no starter copy.
  - The only laser copy is `src/ui/layers/CutSettingsDefaultActions.tsx:21-25` ("New and restart use app starter values … Choose power and speed from a material recipe…"). It sits inside Cut Settings, under the collapsed "Saved defaults" disclosure.
  - The card: `src/ui/app/MachineSetupBanner.tsx:46-47`, "The bed, power and speeds are guesses until you set up your machine." It is hidden once a machine is saved.
  - Materials: `src/core/material-library/starter-catalog.ts:19-24` has starters for the Neotronics 4040 Max only. `src/ui/layers/MaterialLibraryPanel.tsx` (`EmptyMaterialLibraryPanel`) offers **Starter Presets** only for that profile.
- **What a beginner sees:** before setup, the card says power and speeds are guesses "until you set up your machine". They set it up and the card goes. Every operation then reads Power 30, Speed 1500 with no qualifier (`11-text-done.png`, `12-rect-drawn.png`). The Materials tab is empty. A DOM text search after setup found 0 hits for "starter", "recipe" and "guess".
- **Why it misleads:** the card's own wording tells the beginner that setup turns the guesses into machine values. They then burn 30 % / 1500 believing the numbers fit their machine. On card that may burn through; on plywood, leather or anodised aluminium it may barely mark. Nothing points to the Material Test (Tools menu) or to the lessons that say "Enter Power, Speed and Passes from a material test" (`src/ui/tutorials/laser-tutorials.ts:26`).
- **Anchor (Contract):** ADR-500 Amendment 1, Decision 5: "UI copy identifies these as starter values and asks the operator to choose power/speed from their material recipe or machine instructions." **Twin:** CNC does it. `src/core/preflight/cnc-starter-tool-feed.ts:26` says "Choose a material recipe or verify these values for the fitted bit before cutting."; Job Review names "Machine starter values: …" (`src/ui/laser/job-review/job-review-detail-facts.ts:435-437`). The laser Job Review has no equivalent.
- **Evidence:** REPRO (`01-empty.png`, `06-machine-saved.png`, `11-text-done.png`, `27-materials-tab.png`, `28-saved-libraries.png`; DOM search) plus READ. Related but distinct: U2-P3-2 (the Review step calls the untouched starter bed and power scale "Ready", and the card retires). That is about machine values; this is about operation values.
- **Fix direction:**
  - Under Speed on the laser Operation panel, while the operation still holds `LAYER_DEFAULTS` and no material recipe: "**Starter values, not a recipe.** Choose power and speed from your material's settings or your laser's manual, or run **Material Test** (Tools) on a scrap first."
  - Change the card to "The bed is a guess until you set up your machine. Power and speed always depend on your material: test before your first burn."
  - The Materials tab's empty state for laser: "No settings for this machine yet. Burn a **Material Test** on scrap, then save what works as a preset."
  - Job Review, per laser operation: "Starter values (30 %, 1500 mm/min): not chosen for a material."

**Refuter (2026-11-03):** SEVERITY CHANGE → **P3**. The design-time gap is real, but the app warns before output, which the report missed.
- **Re-checked on main c93fbb3bc.** `LAYER_DEFAULTS` `power: 30`, `speed: 1500` (`src/core/scene/layer.ts:142-146`). The Operation panel has no starter copy (`SelectedLaserOperationFields.tsx:25-102`). The only design-time copy sits in the collapsed "Saved defaults" disclosure of the Cut Settings dialog (`CutSettingsDefaultActions.tsx:16-25`, rendered from `CutSettingsDialog.tsx:107`). The card says "guesses until you set up your machine" (`MachineSetupBanner.tsx:46-47`, also `:41-42` for the last-machine card). Starters exist for the Neotronics 4040 only (`starter-catalog.ts:19-24`).
- **ADR-500 Amendment 1, Decision 5, verbatim** (`docs/decisions/ADR-500-amendment-1-machine-persistence-and-fresh-canvas.md:36-39`): "With no explicitly selected material recipe or preset, new operations use the unchanged app starter values, plus existing machine/profile/head seeding. UI copy identifies these as starter values and asks the operator to choose power/speed from their material recipe or machine instructions. A hardware maximum is not presented as a recommended cutting feed or power." The auditor's quote is the second sentence, verbatim.
- **What the report missed: the laser starter warning exists.** `src/ui/laser/uncalibrated-job-warnings.ts:23-45` flags every emitted laser group still at 30 % / 1500 mm/min / 1 pass: "Operation "…" is still using the uncalibrated defaults (30% power, 1500 mm/min, 1 pass). Run a material test on scrap before burning final material." It reaches:
  - **Job Review before Start:** `job-intent-warnings.ts:51` → `machine-job-warnings.ts:80` → `start-job-warnings.ts:22` → `start-job-readiness.ts:365`. `JobReviewWarnings.tsx:56` lists every warning with its headline always visible. So "the laser Job Review has no equivalent" and Not verified's "laser Job Review has no starter note" are wrong.
  - **Save G-code:** `save-gcode-emission.ts:155` → `file-actions.ts:338-339`, as a warning toast. Reproduced: `zz-u3r` badge export, `shots/06b-export-toasts.png`, `06c-after-dismiss.png`. It shows "2 operations are still using the uncalibrated defaults … "badge 1", "badge 2". Run a material test on scrap…", but it is hidden by the three-toast cap (see U3-P3-6). The auditor's "Export G-code says only 'The complete export is ready'" read the dialog before Save as; the toasts come after it.
- **Why P3, not P2.** This copy meets Decision 5 in substance at Start ("uncalibrated defaults … material test"). The beginner is told before the burn, in words they can act on. What is left: nothing at design time, the card's "guesses until you set up" wording, the empty Materials tab with no link to Material Test, and Export's hidden toast. Those are wording and guidance (P3). No wrong burn reaches the machine without a warning.
- **Ways out a beginner might find:** the lesson "Enter Power, Speed and Passes from a material test" (`laser-tutorials.ts:26`). Photo engraving's "Focus the laser, then use Tools → Material Test to choose power and speed" (`PhotoEngravingDialog.tsx:209`). The Job Review warning.
- **LightBurn:** not checked for this finding. The rating rests on KerfDesk's own Job Review warning.
- **Fix direction:** keep the auditor's design-time copy, and reuse the Job Review wording ("starter values", "material test") so the two say the same thing.

### U3-P2-2 — An SVG logo's white (knock-out) shapes burn: the badge burns solid, the white diamond twice, and the import says only "3 objects, 4 colors"

- **Where:**
  - `src/io/svg/svg-import-entries.ts:34-58`: consecutive filled elements join one Fill entry, keeping each path's colour.
  - Colours then become separate operations ("logo 1" for the black circle and "logo 2" for the white diamond, both **Fill**: `20-all-operations.png`). No SVG import code treats a white fill as background (grep of `src/io/svg` for white/`#fff`: only the CSS colour table).
- **What a beginner sees:** their logo (black badge, white diamond in the middle) arrives as a solid black circle on the canvas (`21-logo-canvas-zoom.png`). The toast is "Imported logo.svg — 3 objects, 4 colors". Preview fills the diamond as its own operation (`22c-preview-zoomed.png`).
- **Why it misleads:** the burn is not the logo they imported. In the G-code (`zz-u3-logo.nc`, `node zz-u3-rows.mjs zz-u3-logo.nc 19`), the scan row through the badge centre burns the circle layer at X 7.00–31.00 with no gap, then the diamond layer again at 13.00–25.00. Lit length: circle 4,514 mm (452 mm² at 0.1 mm), diamond 960 mm (96 mm²). So the diamond area is burned twice and the knock-out is lost. Logos with white detail are the most common thing a beginner downloads. The canvas does match the burn, so this is not silent wrong output (not P1), but the change happens on import with no message.
- **Anchor:** Ground truth is the SVG painting model: a later white fill paints over the earlier black one. No ADR decides how white fills import (grep `docs/decisions`, `DECISIONS.md`). Not KNOWN: v7 L7-P1-1 and L8-P1-1 cover same-operation even-odd pooling, not white fills on their own operation.
- **Evidence:** REPRO (fresh project, logo only: `40-logo-only.png`, `zz-u3-logo.nc`).
- **Fix direction:**
  - On import, treat a white (or background-coloured) fill that lies over another fill as a hole in it. Or keep it, but switch its operation's output off and say so.
  - At least name it in the toast: "Imported logo.svg — 3 objects, 4 colours. **1 white shape** will burn like any other colour; turn its operation's output off if it should stay unburned."

**Refuter (2026-11-03):** SEVERITY CHANGE → **P1**. Reproduced with five fixtures; the G-code burns every white shape a second time; no warning reaches the beginner. The canvas hides the white shape, which leaves only a display to notice unprompted (METHOD §3 G6).
- **Re-checked on main c93fbb3bc.** `src/io/svg/svg-import-entries.ts:33-58`: consecutive filled elements append to one Fill entry and keep their own colours (`operationOverride: { mode }` at `:53`). Nothing in `src/io/svg` treats white specially; "white" appears only in the CSS colour table (`svg-css-color.ts:53`). No ADR decides how white fills import (grep `docs/decisions`, `DECISIONS.md` for "white fill", "knock-out", "knockout": only CNC cross-object knockout, `DECISIONS.md:16194`).
- **Reproduced in my own production build** (`zz-u3r`, ports 4991/4992; Import… → the file; Save G-code; `node zz-u3r-rows.mjs <file.nc>`). Each import made two Fill operations at 30 % / 1500, with the white shape's operation shown in a palette colour (blue `#2563eb` for the black shape, red `#dc2626` for the white shape), never white:

  | Fixture (`zz-u3r/fixtures/`) | How the white is written | Toast | Middle scan row (lit spans, both layers) |
  |---|---|---|---|
  | `badge.svg` | `fill="#fff"` | "1 object, 2 colors" | circle 0.00–30.00, diamond again 9.00–21.00 (lit 7,055 + 960 mm) |
  | `badge-white.svg` | `fill="white"` | "1 object, 2 colors" | the same (7,055 + 960 mm) |
  | `badge-style.svg` | `style="fill:#FFFFFF"` and a `<style>` class `.w{fill:#ffffff}` | "1 object, 2 colors" | the same, plus the classed rectangle (7,055 + 1,080 mm) |
  | `knockout-text.svg` (black 60 × 20 plate, white "FL" on top) | `fill="#FFFFFF"` | "1 object, 2 colors" | plate 0.00–60.00 solid, letters again 5.00–12.00 and 16.00–19.00 (lit 12,000 + 825 mm) |
  | `badge-evenodd.svg` (control: one compound path, `fill-rule="evenodd"`) | no white; a real hole | "1 object, 1 color" | 0.00–9.00 and 21.00–30.00: **the hole is kept** |
  | `logo.svg` (the auditor's) | `fill="#ffffff"` | "3 objects, 4 colors" | circle 7.00–31.00, diamond again 13.00–25.00: same as the auditor's |

  All three ways of writing white behave the same. Only an SVG whose author cut the hole into one compound path keeps it. Files: `zz-u3r-*.nc`, `zz-u3r-*.json`.
- **What the beginner sees.**
  - **Canvas:** a solid black badge or plate. The white diamond or letters are gone (`shots/03-badge-import.png`, `10-knockout-text-canvas.png`).
  - **Preview:** the white shape as a slightly darker overlap inside the fill (`04-badge-preview.png`, `11-knockout-text-preview.png`). Nothing says it will burn twice, or that it was white in the file.
  - **Operations:** "badge 1", "badge 2", each with a blue or red swatch.
  - **The only view that shows the white shape as its own part is the undocumented Alt peek** (`12-knockout-alt-peek.png`: red "FL" on a blue plate; U3-P3-3).
- **Why P1, not P2.** The burn is wrong physical output, compared with the file the beginner imported:
  - the knock-out is burned;
  - the white area gets a double dose (deeper or darker), which is the opposite of the design.

  The auditor kept it at P2 because "the canvas does match the burn". That is a display the operator must compare with their intent unprompted. METHOD §3 G6 rules that such a display is not a warning, and v7 L7-P1-1 applied the same reasoning to the same mechanism, rated P1: two colours on two Fill operations, "the plate burns solid and the circle a second time", and "the canvas already paints the original as a solid plate (not a warning…)". The canvas does not even show the double dose. The toast's "2 colors" is not a warning a beginner understands. To lower it, a refuter would have to show the output is not wrong, or that a clear warning arrives first; neither holds.
- **A way out a beginner could find:** none on the screen. Unticking **Include in output** on the white shape's operation works once you know which operation it is, but the names ("badge 2") and swatches (red) don't say "white". The Alt peek is undocumented.
- **LightBurn.** It also maps imported colours to layers, so white does not become background there either:
  - LightBurn's docs (legacy 1.6 Layer Colors page, `https://docs.lightburnsoftware.com/LayerColors.html`, fetched 2026-11-03): "When importing graphics, LightBurn will attempt to match the colors used to the default LightBurn color palette."
  - The docs say nothing specific about white. LightBurn forum staff report that a white fill lands on the nearest palette colour (forum search, 2026-11-03; not docs, so UNVERIFIED as a documented rule).
  - The difference that matters: LightBurn draws each layer in its colour, so the white shape shows on the canvas as a separately coloured shape. KerfDesk's plain-ink canvas (ADR-620) paints it black on black.
  - So matching LightBurn's colour-to-layer mapping does not lower the rating. The output is still wrong against the file, and KerfDesk hides the shape that LightBurn would show.
- **KNOWN check:** it is related to v7 L7-P1-1's refuter correction (different-colour fills re-imported onto two Fill operations burn twice, `docs/audits/2026-10-28-rolling-v7/L7-design-io-roundtrip.md:23`). There the trigger was KerfDesk's own SVG round trip. Here it is the first logo a beginner downloads, with white as a background colour. It is not a duplicate. The fix may share code: the import's per-colour Fill split.
- **Fix direction:** the auditor's, in this order:
  1. on import, a white fill wholly over a darker fill on the same import becomes a hole in it (or its operation's output is off), and the toast says so;
  2. until then, the import toast names the white shapes and their operation.

### U3-P2-3 — Photo engraving cannot preview a phone photo, and the reason given is "materialized working set exceeds the 64 MB budget"

- **Where:**
  - `src/ui/raster/use-photo-engraving-preview.ts:35-44`: the source check, at 12 bytes per source pixel.
  - `src/core/raster/raster-budget.ts:3` (`MAX_RASTER_WORKING_BYTES = 64 MiB`) and `:88` (the reason text).
  - `src/ui/raster/photo-engraving-preview-budget.ts:117,167`: "the full scan plan exceeds the preview working-set budget".
- **What a beginner sees:**
  - A 4032 × 3024 photo (12 MP, any phone since about 2012) shows in the Photo engraving window "Photo preview is unavailable at this size: ~140 MB materialized working set exceeds the 64 MB budget. You can still apply the settings.". This holds at the imported 360 mm and after resizing to 100 mm (`41-photo-engraving.png`, `42-photo-engraving-100mm.png`).
  - A 2000 × 1500 photo at its import size (200 × 150 mm) gets "the full scan plan exceeds the preview working-set budget" (`43-photo-engraving-3mp.png`). It previews only at 100 mm (`44-photo-engraving-3mp-100mm.png`).
- **Why it blocks:** the dots preview is the point of the window ("Turn portraits into fine laser dots…"). It is how a beginner judges brightness, contrast and the material recipe. The message is jargon a beginner cannot act on. For the common case (over about 5.6 MP) nothing in the app helps: neither resizing on the canvas nor anything else. The beginner can still Apply blind and use the main Preview. Hence P2 (AREAS: "a message whose words a beginner cannot act on").
- **Anchor:** AREAS P2 wording rule. **Twin:** the main Preview handles the same 12 MP photo (`24-photo-preview.png`) by showing a reduced display ("displayed at 2,048 × 1,536"). Not KNOWN: no audit cites this message (grep of `docs/audits`).
- **Evidence:** REPRO plus READ.
- **Fix direction:**
  - Preview from a downsampled copy of the source, as the main Preview's display already does, so a phone photo always previews.
  - Until then, say: "This photo is too large to preview here (12 megapixels). Your settings still apply; check the result in **Preview**." For the scan-plan case: "Make the photo smaller on the canvas to preview it here."

**Refuter (2026-11-03):** CONFIRMED at P2, and slightly worse than reported: **Auto tones** is also unavailable for every such photo.
- **Re-checked on main c93fbb3bc.** `src/ui/raster/use-photo-engraving-preview.ts:35-44` runs `evaluateRasterBudget(1, 1, { sourcePixelCount: w × h, sourceWorkingBytesPerPixel: 12 })` before anything else. The output grid passed is 1 × 1, so placed size cannot matter. The limit is `MAX_RASTER_WORKING_BYTES = 64 MiB` (`raster-budget.ts:3`), reason text at `:88`. 64 MiB ÷ 12 B = 5.59 MP, so every photo above about 5.6 MP is refused at any size. An 8 MP (3264 × 2448) photo is refused too, not only 12 MP. The scan-plan message is `photo-engraving-preview-budget.ts:117` (via `previewLimit`, `:166-168`).
- **The budget's ADR.** The 64 MiB is the shared raster working allowance (ADR-243 Context, `DECISIONS.md:11792`; `DECISIONS.md:1470`). The preview's own rule is ADR-581, `docs/decisions/ADR-581-portrait-photo-engraving-workflow.md`:
  - decision 6 (`:67-70`): "Budget source, masks, scan plans and display work before allocation. Check source dimensions before hydrating paged pixels… Preview-only resource limits do not prevent applying settings or change output policy."
  - decision 4 (`:58-60`): "Compile at the actual physical grid… Do not dither a thumbnail."

  So the source check is decided, but no ADR accepts that a phone photo can never preview. Decision 4 constrains the fix: resample the source to the physical output grid, which at 100 mm × 0.1 mm is 1000 × 750, and compile that. Do not dither a display thumbnail.
- **Reproduced** (own build; `__ZZ.makePhoto("IMG_2041.jpg", 4032, 3024)` → **Import image** → **Photo engraving...**). The same message at the import fit (360 mm), at 100 × 75 mm and at 30 × 22.5 mm: "Photo preview is unavailable at this size: ~140 MB materialized working set exceeds the 64 MB budget. You can still apply the settings." (`shots/21-pe-360.png`, `21-pe-100.png`, `21-pe-30.png`).
  - In the same window, **Auto tones** is disabled: "Available once the preview has read the photo." (`controls` dump). So the one-click tone helper is also lost for every phone photo.
  - **Apply photo settings** works: "Photo engraving settings applied to the selected photo.".
  - The main **Preview** then shows the job with "Estimated time 6m 19s" at 30 mm (`22-photo-main-preview.png`). So the beginner can still burn it. That is the workaround, hence P2, not P1.
- **Ways out:**
  - Resampling exists only in the image editor's **Image Size** (`src/ui/image-editor/EditorAdjustMenus.tsx:33-37`), reached through Design Studio, which is marked Pro on the toolbar. Nothing in the message points there.
  - Cropping in Image Studio could bring a photo under 5.6 MP, but nothing suggests it.
- **LightBurn:** not checked. The rating rests on the AREAS wording rule and the ADR-581 twin, not on parity.

### U3-P2-4 — A cut drawn before the engraving inside it runs first, and nothing tells a beginner to cut last

- **Where:**
  - Run order follows the order the artwork was made. The coaster's G-code has the 100 % / 300 mm/min Line circle as its first layer and the Fill text second (`zz-u3-coaster.nc` layer comments).
  - The fix exists only as an icon in the **All operations** header: "Engrave first and cut last: Line operations move after Fill and Image, weakest first…" (`src/core/sort-cuts-last.ts`, ADR-480 item 8).
  - The operations lesson (`src/ui/tutorials/layout-tutorials.ts:311-318`) says to "inspect the numbered artwork sequence" but not that cuts go last.
  - No preflight check exists (`src/core/preflight/*`), and Export says nothing.
- **What a beginner sees:** Run order: "#1 Ellipse … #2 Hi" (`44-coaster-run-order.png`). It is clear but neutral.
- **Why it misleads:** the beginner draws the coaster outline, then adds a name. The part is cut free first, and on a honeycomb bed it can drop or shift before it is engraved, so the name burns off-centre or on the bed. This is the most common first-project failure in laser forums, and the app already has the rule (Sort cuts last's power × passes ÷ speed). The workaround (renumber in Run order, or the header button) is findable once the beginner knows to look, hence P2. LightBurn also makes Sort Cuts Last an explicit command (ADR-480 Context quotes its Cuts / Layers page), so this is beginner guidance, not a parity gap.
- **Evidence:** REPRO (`43-coaster.png`, `44-coaster-run-order.png`, `zz-u3-coaster.nc`) plus READ.
- **Fix direction:** when a Line operation that the cut-strength rule ranks as a cut runs before Fill or Image artwork inside its outline, show on Run order and in Job Review: "**Cut runs before the engraving inside it.** The part may move once it is cut free. **Engrave first, cut last**". The button runs Sort cuts last.

**Refuter (2026-11-03):** CONFIRMED at P2.
- **Re-checked on main c93fbb3bc.** Run order is per artwork, in creation order, and Sort cuts last rewrites that order only when asked (`src/core/sort-cuts-last.ts:1-4`). The only control is the All operations header icon, "Engrave first and cut last: Line operations move after Fill and Image…" (`src/ui/layers/OperationListTools.tsx:61`). No preflight, Export or Job Review advisory: grep `src/core`, `src/ui` for "cut last", "cuts last", "engrave first", "before cutting", "cut free" finds only CNC and tile messages. The lesson (`layout-tutorials.ts:311-318`) says to inspect the sequence, not to cut last.
- **Reproduced** (own build, fresh profile):
  1. Ctrl+E ellipse, typed 80 × 80, Line, Power 100, Speed 300.
  2. **T**, clicked inside, "Hi", Ctrl+Enter, **Fill** at the starter 30 / 1500.
  3. Run order: "#1 Ellipse … #2 Hi" (`shots/31-coaster-run-order.png`).
  4. G-code (`zz-u3r-coaster.nc`): `; layer … color #2563eb power 100% speed 300 mm/min` first, then `; fill layer … power 30% speed 1500 mm/min`. The Export toasts say nothing about order.
- **LightBurn's default.** LightBurn also runs in list order and leaves sorting to an explicit command. Its 2.1 Cuts / Layers page (`https://docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/`, fetched 2026-11-03):
  - "By default, layer operations are performed by your laser in the order from top to bottom."
  - **Sort Cuts Last** pushes "all Line Mode layers to the end".
  - The same page tells the reader: "It's therefore best to engrave images and marking/scoring lines before any cuts through the material."

  Its 2.0 Optimization Settings page (`https://docs.lightburnsoftware.com/2.0/Reference/OptimizationSettings/`, fetched 2026-11-03) gives "Order by Layer" first by default. Its "Cut inner shapes first" option exists "to ensure engravings and inner cutouts are completed before cutting a shape out of the stock material", but that page doesn't say it is on by default, or that it works across layers.

  Neither page says where a new layer lands in the list (creation order or colour index). So "LightBurn also runs layers in creation order" is UNVERIFIED from its docs. What is documented: LightBurn does not auto-sort cuts last, but it does tell the reader to engrave before cutting. KerfDesk has the command and no such advice. That supports the auditor's "beginner guidance, not a parity gap".
- **Why not P1.** The G-code is exactly what the beginner set. The harm (a part shifting once cut free) is a likely physical consequence, not a wrong position, power or scale, and LightBurn has the same default.

### U3-P3-1 — 100 % power at 100 mm/min is accepted with no notice, and nothing explains what power and speed do

- **Where:** Power's tooltip is "Laser power percentage for this layer."; Speed's is "Feed rate in mm/min for this layer…" (operation fields; `30-power100-speed100.png`). There is no dose or fire advisory in `src/core/preflight` (grep "fire", "flame", "dose"). Export: `32-export-gcode.png`.
- **What a beginner sees:** Fill text set to 100 % / 100 mm/min, with no notice in the panel, Preview or Export. Job Review was not reachable without a connection (U4).
- **Why it matters:** a diode laser on Fill at 1.7 mm/s chars wood and can flame card or leather. The beginner chose the numbers, so this is a missing guard (P3), not a wrong burn.
- **Fix direction:**
  - Tooltips: "Power: how hard the laser fires. More power, or slower speed, burns darker and deeper." and "Speed: how fast the head moves while burning. Slower burns darker."
  - A soft notice when power ÷ speed is far beyond the material test's range: "Very high power at a very slow speed can set the material on fire. Stay with the machine and run a Material Test first."

**Refuter (2026-11-03):** CONFIRMED at P3.
- **The tooltips, read live on main's build:** "Laser power percentage for this layer." (`src/ui/layers/LayerRowFields.tsx:353`). Speed's is "Feed rate in mm/min for this layer. The slider covers this machine's usual working speeds, 60 to 6,000 mm/min…".
- **No dose or fire advisory.** None in `job-intent-warnings.ts:44-57`. `appendFillHeatWarnings` (`:165-190`) covers runway and island sweeps only.
- **Correction to the report:** Export is not silent. Warning toasts follow the "complete export is ready" dialog (see U3-P2-1, U3-P3-6), but none is about power ÷ speed.

### U3-P3-2 — The aspect lock is off by default, so typing a photo's width squashes it

- **Where:** `src/ui/commands/NumericEditsBar.tsx:118` (`useState(false)`). Twin: the jig editor defaults to locked (`src/ui/workspace/registration-jig/JigSelectionFields.tsx:17`, `RegistrationJigArtworkSizeControls.tsx:34`).
- **What a beginner sees:** W 100 on the 360 × 270 photo gives 100 × 270, a stretched face (`25-photo-w100.png`). It is visible at once and undoable.
- **Fix direction:** lock by default for images and text (or for every selection), or show "Unlocked: width and height change separately" beside the lock while it is open.

**Refuter (2026-11-03):** CONFIRMED at P3.
- **Code:** `NumericEditsBar.tsx:118` `useState(false)`. The comment at `:116-117` records it as a deliberate choice: "a default-on lock silently rescaled the other dimension on every edit".
- **Live:** "Lock aspect ratio" `aria-pressed="false"` on a fresh photo import, disabled until something is selected.
- **Visible and undoable,** so it stays P3. Any default change must keep that reason in mind; locking for images only fits it.

### U3-P3-3 — Every object is drawn in black, but the lesson says "Colours identify operations automatically"; the Alt peek is undocumented, and imported operations are named "logo 1, 2, 3"

- **Where:**
  - Plain ink on the canvas is accepted (ADR-620; `src/ui/app/use-operation-color-peek.ts:1-5`, "Hold Alt … to see every operation colour"). The peek appears in no tooltip, lesson or shortcut list (grep `src/ui` for "Hold Alt" or "colour"; `src/ui/common/shortcut-list.ts`).
  - The lesson tip: `src/ui/tutorials/layout-tutorials.ts:320`.
  - SVG operations are named after the file plus a number (`20-all-operations.png`).
- **What a beginner sees:** eight operations with coloured swatches, and black artwork (`26-photo-100.png`). They can't tell which shape is "logo 2".
- **Fix direction:**
  - The lesson tip: "Hover an operation, or hold **Alt**, to see its artwork in its colour."
  - Add the Alt peek to Keyboard Shortcuts.
  - Name imported operations by role, for example "logo · fill (black)" or "logo · line (red)".

**Refuter (2026-11-03):** CONFIRMED at P3.
- **The lesson tip,** verbatim: "Colours identify operations automatically…" (`layout-tutorials.ts:320`).
- **The peek** is documented only in code (`use-operation-color-peek.ts:1-5`). The live Keyboard Shortcuts tooltip lists "Alt+W filled or wireframe view" but no Alt peek.
- **Operation names:** imports are named "badge 1", "badge 2" and "knockout-text 1", "knockout-text 2".
- **It matters more than polish here,** because the Alt peek is the only view that shows U3-P2-2's white shapes (`shots/12-knockout-alt-peek.png`). The P1 is rated on its own; this stays P3.

### U3-P3-4 — "Draw ellipse" says "ellipse or circle" but not how to get a circle

- **Where:** `src/ui/help/help-topics.ts:109`. The lesson does say it (`src/ui/tutorials/drawing-tutorials.ts:104`, "Hold Shift to make a circle"), and so for the rectangle (`:93`).
- **Evidence:** REPRO: a plain drag gave 40 × 50, a Shift drag 53.8 × 53.8 (`14-ellipse-drawn.png`).
- **Fix direction:** "…Hold Shift for a circle. The drag snaps … hold Alt to place freely." Do the same for the rectangle ("Shift for a square").

**Refuter (2026-11-03):** CONFIRMED at P3.
- **The tooltip** (`help-topics.ts:109`): "Draw an ellipse or circle by dragging on the workspace. The drag snaps to … hold Alt to place freely." No Shift.
- **The lessons do say it:** `drawing-tutorials.ts:104` ("Hold Shift to make a circle") and `:93` ("Hold Shift while dragging to make a square").
- **Not reproduced;** typed W/H 80 × 80 is the plain way out.

### U3-P3-5 — For a photo, the Laser panel says "large job" ("Live estimate paused so large traces stay responsive"), and Preview adds a compiler banner

- **Where:**
  - `src/ui/laser/JobEstimatePresentation.tsx:29`.
  - `src/ui/workspace/RasterPreviewDisplayBanner.tsx:11`: "Raster display resolution reduced after output compilation … Emitted S-values and G-code are unchanged."
  - Also the toast "Large job: preparing the route preview in the background…" (`24-photo-preview.png`).
- **What a beginner sees:** no time next to Start for an 11 h 17 min photo, and "traces" in the reason. Preview gives the time, with a banner of compiler terms.
- **Fix direction:**
  - "Time: open Preview to calculate (large job)".
  - The banner: "Preview shows this photo at lower resolution so it stays fast. The engraving uses full resolution."

**Refuter (2026-11-03):** CONFIRMED at P3 (READ). `JobEstimatePresentation.tsx:27-31`: "large job", title "Live estimate paused so large traces stay responsive.". `RasterPreviewDisplayBanner.tsx:9-13`: "Raster display resolution reduced after output compilation…". In my run the photo at 30 mm showed a time (≈ 6 min), so "large job" depends on size.

### U3-P3-6 — Save G-code shows only the newest three toasts, so the "uncalibrated defaults … run a material test" warning and the "Saved G-code" confirmation are hidden behind jargon (refuter, new)

- **Where:**
  - `src/ui/common/Toasts.tsx:19-25` (`MAX_VISIBLE_TOASTS = 3`; older toasts "stay in the store and expire on their own timers").
  - `src/ui/app/file-actions.ts:317-340` pushes, in order: the info "Exported G-code assumes GRBL $30=…", then every machine warning.
  - `job-intent-warnings.ts:51-57`: the uncalibrated warning comes before the 4040 runway, scan-offset and power-scale warnings.
- **What a beginner sees** (own build, fresh profile, a generic "My diode laser", `badge.svg` at the starter values → Save G-code → **Save as…**; `shots/06b-export-toasts.png`, `06c-after-dismiss.png`). Visible:
  1. "Generic Scan Line feed-matched entry and exit runways are active. The Neotronics-qualified 4040 fill policy is not selected…"
  2. "Bidirectional scan output at 1500 mm/min has no saved scan-offset table…"
  3. "Output power uses saved profile S1000…"

  Only after dismissing the first does "2 operations are still using the uncalibrated defaults (30% power, 1500 mm/min, 1 pass): "badge 1", "badge 2". Run a material test on scrap before burning final material." appear. After the next: "Exported G-code assumes GRBL $30=1000…". Then "Success: Saved G-code to untitled.gcode".
- **Why it matters:** the one warning written for a beginner is hidden behind three they cannot act on (a Neotronics-specific policy, scan offsets, S-scale). This is the last notice before a beginner takes the file to another sender. It is not P2: Job Review lists every warning before a KerfDesk Start (`JobReviewWarnings.tsx:56`), and the hidden toasts can be reached by dismissing.
- **Anchor:** Twin: Job Review lists all warnings (`JobReviewWarnings.tsx:1-8,56`, its comment citing ADR-224 v3), and Export uses the same `detectMachineJobWarnings` set. `file-actions.ts:324-325` (its comment, citing ADR-591 Amendment 3) puts preflight findings last so text notices "cannot push them out". The machine warnings get no such protection.
- **Evidence:** REPRO (toast DOM after each dismiss, recorded in the command output) plus READ.
- **Fix direction:**
  - Put the uncalibrated-defaults warning last, or group Export's warnings into one toast with a count: "4 notes about this G-code — show".
  - Drop the Neotronics 4040 policy warning for a profile that is not a 4040 unless the operator asked for 4040 fill.

## KNOWN re-observed

- **No starter material library for a generic laser:** G-S05-3, `docs/audits/2026-07-12-competitive-audit/sectors/05-layers-materials.md:84,93`. Starters exist for one machine (`starter-catalog.ts:19-24`), and ADR-500 Amd 1's Context says "no numerical defaults or material recipes are invented here". Raised here only as the missing starter wording (U3-P2-1).
- **Canvas 0,0 at the top-left (rear) with the Y ruler counting toward the operator** for a front-left machine: L8-P2-6 (P3), also re-observed by U2. Typed Y 20 put the rectangle 20 mm from the rear edge (`13-rect-typed.png`).
- **Size is the em:** v7 L3-P2-1, resolved by #1507. The field's tooltip now says so plainly. Size 30 Pacifico read 80.55 × 28.44 mm.
- **Red "Relative view — physical bed position unverified" with no tooltip:** U1-P3-2.
- **The Save dialog type reads "Files":** U1-P3-6 (`types: [{description: "Files", accept: {".lf2"}}]` in `__ZZ_SAVES`).
- **The machine card retires once a starter is saved:** U2-P3-2 (machine values). It is the root of U3-P2-1's misleading wording.
- **One operation per drawn or imported artwork, and plain-ink canvas:** accepted designs (ADR-430, ADR-620). The beginner can follow them ("Multiple operations … choose one operation to share").

**Refuter (2026-11-03):** all 7 CONFIRMED as KNOWN.
- Each ID exists where cited:
  - L8-P2-6 in `docs/audits/2026-10-28-rolling-v7/L8-canvas-interaction-history.md`;
  - L3-P2-1 in `L3-text-typography.md` and the v7 LEDGER;
  - G-S05-3 at `05-layers-materials.md:84`;
  - U1-P3-2 and U1-P3-6 at `U1-install-first-launch.md:187,246`;
  - U2-P3-2 at `U2-machine-setup-connect.md:173`.
- The plain-ink canvas is an accepted design, but it is also what hides U3-P2-2's white shapes. That finding is rated on its own output, not on ADR-620.
- One addition: v7 L7-P1-1 (`L7-design-io-roundtrip.md:23`, refuter correction) is the nearest KNOWN to U3-P2-2, with the same per-colour Fill split and double burn but a different trigger. U3-P2-2 stays a new finding.

## Refuted

- **"A design dragged off the bed gets no warning."** The outline turns red and dashed as it moves (`17-dragged-off-bed.png`), and Preview says "Some objects extend past the bed (red dashed outlines)…" (`18-preview-offbed.png`; `src/ui/workspace/preview-overlays.tsx:94`).
- **"An imported photo bigger than the bed is placed off it silently."** Import scales it to fit with a warning toast naming the original size and Undo (`23-photo-import.png`; `src/ui/app/import-bed-fit-notice.ts:23`).
- **"Recent Projects can't reopen a saved project in the browser."** The toast "untitled.lf2 can't be reopened directly in this browser" came from my stand-in Save picker, whose handle cannot be stored. A real Chrome `FileSystemFileHandle` can be. Harness artifact.
- **"Group is missing."** It is in Edit (Ctrl+G), not Arrange; the shortcut and Edit menu are visible.

**Refuter (2026-11-03):** all 4 refutations UPHELD.
- **Off-bed:** the banner text is at `preview-overlays.tsx:92-95`.
- **Fit-to-bed:** reproduced. "IMG_2041.jpg is larger than the 400 × 400 mm bed (403.2 × 302.4 mm), so it was scaled to 89.3% to fit. Undo restores the original size." (`import-bed-fit-notice.ts:20-26`; `zz-u3r/shots/20-photo-import.png`).
- **Recent Projects:** `open-recent-project.ts:23-29` shows that toast only when `entry.ref === null` (no stored handle) or the platform has no recent-file store. The stand-in handle is a plain object and cannot be stored, so the harness explanation fits. The real picker is still Not verified.
- **Group:** the live Keyboard Shortcuts tooltip lists "Ctrl+G group".

## Verified clean

- **Text:** the T tool, an inline editor with "Enter for a new line · Ctrl/⌘ + Enter to finish · Esc to cancel", a font picker that previews the typed word with categories, Import and System fonts, and Size in mm explained as the em.
- **Shapes:** typed X/Y/W/H land exactly (80.0 × 50.0 at 20, 20). Align is disabled with a reason until two objects are selected. Align Centers and Ctrl+G work. Undo has a named 15-step list.
- **Line / Fill / Image** each have a one-line hover explanation. Fill shows filled on the canvas; Line shows outlines. Every dither swatch has a plain description.
- **Photo engraving window copy:** material recipes for wood, leather, tile, slate, anodised aluminium and glass; "Power, speed and DPI stay yours to test"; tone calibration explained.
- **Preview:** on the toolbar, it shows paths, hatch, raster and the estimated time, and warns about off-bed artwork, without a machine.
- **Material Test** (Tools) opens a clear grid generator with Faint → Deep and the effective feed range (`38-material-test.png`). It just isn't linked from where the beginner looks (U3-P2-1).
- **Save and reopen:** a Save project step, `.lf2`, a success toast and title, a Recent list in the File menu, and the reopened project restores 7 objects, 2 groups and 8 operations. The machine choice survives a reload (ADR-500 Amd 1 decision 1).

## Not verified

- **Job Review** for 100 % / 100 mm/min, the cut-first order and starter values: it needs a connected, framed machine (U4). From code, laser Job Review has no starter note (`job-review-detail-facts.ts:429-437` is CNC only).
- **The real Save picker:** default folder, file-type text and reopening through a stored handle. Headless Chrome can't drive the native picker; a stand-in was used.
- **LightBurn behaviour** for white SVG fills, and its default aspect-lock state. LightBurn 2.2 RC's Numeric Edits page describes locked and unlocked modes but states no default (fetched 2026-11-03).
- **Real burns** on plywood, card, leather and anodised aluminium; the desktop app; small screens.
- **Refuter corrections and additions:**
  - The first bullet's code reading is incomplete. The laser starter note exists as a job-intent warning that Job Review lists (`uncalibrated-job-warnings.ts:40-45`, `start-job-readiness.ts:365`, `JobReviewWarnings.tsx:56`). Still not seen on screen: U4 should confirm it appears in Job Review and where it sits among the other warnings.
  - LightBurn: white SVG fills are covered under U3-P2-2. The docs say colours are matched to the palette; nothing about white specifically. Where a new layer lands in the Cuts / Layers list is not stated in its docs (U3-P2-4).

## Refuter summary

**Refuter:** a fresh context, 2026-11-03.
- **Tree:** `origin/main` c93fbb3bc (re-fetched; `git diff c93fbb3bc origin/main -- src` empty).
- **Build:** my own production build (`git archive origin/main` → `zz-u3r\tree`, Vite build → `zz-u3r\dist`). Both were deleted at the end; the junction was removed with `cmd /c rmdir` first.
- **Host and driver:** `zz-u3r-host.mjs` on 4991 and `zz-u3r-drive.mjs` on 4992, headless Chrome with a fresh profile per run. The driver scripts are `zz-u3r-setup.js`, `zz-u3r-import.js`, `zz-u3r-export.js` and `zz-u3r-photo.js`.
- **G-code analysis:** `zz-u3r-rows.mjs`.
- **Files:** fixtures in `zz-u3r\fixtures\`, screenshots in `zz-u3r\shots\`, G-code in `zz-u3r\zz-u3r-*.nc`. `zz-u3r` = `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u3r`.

**Tally:** of 9 findings, 7 confirmed at their severity and 2 severity changes; 0 refuted. 1 new P3. The 7 KNOWN and the auditor's 4 refutations are upheld.

| ID | Auditor | Refuter | One line |
|---|---|---|---|
| U3-P2-2 | P2 | **P1** | Every white fill in an SVG (`#fff`, `white`, `style`, CSS class) becomes a second Fill operation: the knock-out burns, at double dose. Reproduced on a badge and a white-on-black text plate. Hidden on the plain-ink canvas, a faint overlap in Preview, no warning. G6 and the L7-P1-1 precedent apply. LightBurn also maps colours to layers, but shows the white shape in its layer colour. |
| U3-P2-1 | P2 | **P3** | The design-time panel and the "guesses" card say nothing, but Job Review lists "still using the uncalibrated defaults (30% power, 1500 mm/min, 1 pass) … Run a material test on scrap" before Start. That meets ADR-500 Amd 1 Decision 5 in substance. The report's "laser Job Review has no equivalent" was wrong. |
| U3-P2-3 | P2 | P2 | Photos over 5.59 MP never preview at any placed size (30, 100, 360 mm tried). **Auto tones** is disabled for them too. Apply and the main Preview work. ADR-581 decisions 4 and 6 allow source budgeting but don't accept "never"; a fix must resample to the physical grid, not dither a thumbnail. |
| U3-P2-4 | P2 | P2 | Cut first, engraving second, in Run order and the G-code. LightBurn also runs in list order and makes Sort Cuts Last a command, but its Cuts / Layers page tells the reader to "engrave … before any cuts". Whether LightBurn orders new layers by creation is UNVERIFIED from its docs. |
| U3-P3-1 to P3-5 | P3 | P3 | All confirmed. P3-1 corrected: Export is not silent, but nothing covers power ÷ speed. |
| U3-P3-6 (new) | — | P3 | Save G-code shows only the newest three toasts. The uncalibrated-defaults warning and the "Saved G-code" success sit behind three jargon warnings (4040 runway policy on a non-4040, scan offsets, S1000). |

**Handoffs:**
- **U4:** confirm on screen that Job Review shows the uncalibrated-defaults warning (U3-P2-1's mitigation), and how many other warnings surround it.
- **Coordinator:**
  - U3-P2-2 → P1 rests on G6 ("a display is not a warning") and the L7-P1-1 precedent. If a WYSIWYG canvas is ever accepted as disclosure, this returns to P2.
  - U3-P3-6's Neotronics 4040 warning on a generic profile may deserve its own card.

```json
{
  "area": "U3",
  "areaId": "first-design",
  "tree": "c93fbb3bc",
  "date": "2026-11-03",
  "counts": { "raised": 9, "P1": 0, "P2": 4, "P3": 5, "known": 7, "refuted": 4 },
  "refuterCounts": { "raised": 10, "P1": 1, "P2": 2, "P3": 7, "known": 7, "refuted": 4, "confirmed": 7, "severityChanges": 2, "refutedByRefuter": 0, "new": 1 },
  "refuterVerdicts": { "U3-P2-1": "P2→P3", "U3-P2-2": "P2→P1", "U3-P2-3": "CONFIRMED P2", "U3-P2-4": "CONFIRMED P2", "U3-P3-1": "CONFIRMED", "U3-P3-2": "CONFIRMED", "U3-P3-3": "CONFIRMED", "U3-P3-4": "CONFIRMED", "U3-P3-5": "CONFIRMED", "U3-P3-6": "NEW P3 (refuter): Save G-code toast cap hides the uncalibrated-defaults warning and the success toast; Toasts.tsx:19-25, file-actions.ts:317-340" },
  "refuterScratch": "C:\\Users\\stolk\\AppData\\Local\\Temp\\claude\\C--Users-stolk-OneDrive-Desktop-KerfDesk\\34485e99-fb85-4112-957b-e0432f213833\\scratchpad\\zz-u3r",
  "findings": [
    { "id": "U3-P2-1", "severity": "P2", "evidence": "REPRO+READ", "where": "src/core/scene/layer.ts:142-146; src/ui/layers/SelectedLaserOperationFields.tsx:25-102; src/ui/app/MachineSetupBanner.tsx:46-47; src/core/material-library/starter-catalog.ts:19-24", "title": "Laser starter power/speed (30 % / 1500) never labelled as starter values (ADR-500 Amd 1 D5); the 'guesses' card retires on setup; empty Materials, no link to Material Test", "anchor": "ADR-500 Amendment 1 Decision 5; twin cnc-starter-tool-feed.ts:26, job-review-detail-facts.ts:435-437" },
    { "id": "U3-P2-2", "severity": "P2", "evidence": "REPRO (G-code row spans)", "where": "src/io/svg/svg-import-entries.ts:34-58", "title": "SVG white knock-out shapes become their own Fill operation: badge burns solid, diamond twice; toast says only '3 objects, 4 colors'", "anchor": "SVG painter's model; no ADR" },
    { "id": "U3-P2-3", "severity": "P2", "evidence": "REPRO+READ", "where": "src/ui/raster/use-photo-engraving-preview.ts:35-44; src/core/raster/raster-budget.ts:3,88; src/ui/raster/photo-engraving-preview-budget.ts:117,167", "title": "Photo engraving never previews a >5.6 MP phone photo; jargon 'materialized working set exceeds the 64 MB budget'", "anchor": "AREAS P2 wording rule; twin main Preview downsamples" },
    { "id": "U3-P2-4", "severity": "P2", "evidence": "REPRO (G-code layer order)+READ", "where": "src/core/sort-cuts-last.ts; src/ui/tutorials/layout-tutorials.ts:311-318; src/core/preflight/*", "title": "A cut drawn before the engraving inside it runs first; no advice to cut last", "anchor": "ADR-480 item 8 (Sort cuts last exists as a command)" },
    { "id": "U3-P3-1", "severity": "P3", "evidence": "REPRO+READ", "where": "laser operation Power/Speed tooltips; src/core/preflight", "title": "100 % at 100 mm/min accepted with no notice; tooltips don't explain power/speed" },
    { "id": "U3-P3-2", "severity": "P3", "evidence": "REPRO+READ", "where": "src/ui/commands/NumericEditsBar.tsx:118", "title": "Aspect lock off by default; typing a photo's width squashes it (jig editor defaults locked)" },
    { "id": "U3-P3-3", "severity": "P3", "evidence": "REPRO+READ", "where": "src/ui/tutorials/layout-tutorials.ts:320; src/ui/app/use-operation-color-peek.ts:1-5", "title": "Canvas is plain ink but lesson says colours identify operations; Alt peek undocumented; imported ops named logo 1/2/3" },
    { "id": "U3-P3-4", "severity": "P3", "evidence": "REPRO+READ", "where": "src/ui/help/help-topics.ts:109", "title": "Draw ellipse tooltip doesn't say Shift for a circle" },
    { "id": "U3-P3-5", "severity": "P3", "evidence": "REPRO+READ", "where": "src/ui/laser/JobEstimatePresentation.tsx:29; src/ui/workspace/RasterPreviewDisplayBanner.tsx:11", "title": "Photo job shows 'large job' / 'traces' instead of a time; Preview banner in compiler terms" }
  ],
  "known": ["G-S05-3 starter library covers one machine", "L8-P2-6 canvas origin top-left / Y toward operator", "L3-P2-1 Size is em (now explained, #1507)", "U1-P3-2 Relative view badge", "U1-P3-6 Save dialog 'Files'", "U2-P3-2 starter card retires on save", "ADR-430/ADR-620 one operation per artwork, plain ink"],
  "refuted": ["Off-bed design unwarned (red dashed + Preview banner)", "Oversized photo placed silently (fit-to-bed toast)", "Recent can't reopen (harness: stand-in handle not storable)", "Group missing (Edit menu, Ctrl+G)"],
  "handoffs": { "U4": ["Job Review: laser starter values, 100 %/100 mm/min, cut-before-engrave order"] },
  "screenshots": "C:\\Users\\stolk\\AppData\\Local\\Temp\\claude\\C--Users-stolk-OneDrive-Desktop-KerfDesk\\34485e99-fb85-4112-957b-e0432f213833\\scratchpad\\zz-u3\\shots"
}
```
