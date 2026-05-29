# LIGHTBURN-STUDY.md — How LightBurn Works (function & workflow audit)

> **Purpose.** Study LightBurn's actual architecture, workflows, and functions so
> LaserForge is designed against a proven reference instead of guesswork. The
> trigger for this study was a concrete LaserForge design smell: our **Trace
> Image** and **Engrave Image** toolbar buttons appear to do the same job. This
> doc checks how LightBurn organises the same work, to decide whether our split
> is right.
>
> **Method (Karpathy tight-leash).** Built section by section. Each section is
> reviewed before the next is written. Every factual claim cites the official
> LightBurn documentation page it came from (`docs.lightburnsoftware.com`).
> Functional descriptions are paraphrased in our own words; only short UI labels
> are quoted verbatim. **No LightBurn source code or assets are copied** — this is
> a workflow/UX study, consistent with the "LightBurn (UX reference)" row in
> `RESEARCH_LOG.md` and ADR-001.
>
> **Honesty rule.** Where a claim has not been checked against a primary doc page,
> it is marked **UNVERIFIED** and listed in the section's "Not yet verified" list.
> Nothing here is invented.

---

## Status / coverage

- [x] **Section 1 — Image pipeline** (entry point, four layer modes, Trace tool, Image mode + dithering)
- [x] **Section 2 — End-to-end image-engrave workflow** (LightBurn's recommended 5-step path + Adjust Image)
- [x] **Section 3 — Menus & Toolbars** (File/Edit/Tools/Arrange/Laser Tools/Window/Help; Main/Arrange/Creation toolbars)
- [x] **Section 4 — Cuts/Layers Window & Cut Settings Editor** (color-as-layer, all four modes, common/advanced tabs, sub-layers)
- [x] **Section 5 — Laser Window & Job Control** (Laser/Move/Console/Devices windows, Start From modes, optimization settings, GRBL config)
- [x] **Section 6 — Editing, Arrange, Transform & Node Tools** (selection, transform handles, align/distribute/array, boolean, offset, node editing, Shape Properties)
- [x] **Section 7 — Image Sub-Tools & Material Library** (Interval/Material Test, Dot Width, Images-vs-Vectors, Convert to Bitmap, Apply Mask, Adjust Image, Material Library)

**Scope status:** the whole-app *LightBurn reference* is now drafted (§3–§7 added
2026-05-29 via five parallel doc-research passes, every claim cited to an official
`docs.lightburnsoftware.com` page). What remains:

- [x] **LaserForge mapping pass** — **§8 added 2026-05-29.** Area-by-area HAVE /
  GAP / DIVERGE ledger against §3–§7, each line citing a `src/` path; DIVERGE lines
  carry a redesign-to-match action. Recorded as binding in **ADR-027** (LightBurn is
  the source of truth). Six anchor files read directly; the rest are marked ◦ for
  re-confirmation (§8.7). Documentation only — no code changed.
- [ ] **Live-UI label re-confirmation** — all §3–§7 facts are from docs, not the
  running app. A handful of shortcut/label conflicts the agents hit are preserved
  verbatim in each section's "Not yet verified" list. The §8 ◦ items (`src/` files
  not re-read this pass) also await direct re-confirmation before any redesign PR.

---

## Section 1 — The image pipeline

### 1.1 The key structural finding: one import, then a downstream choice

In LightBurn an image is **imported once** as a raster (bitmap). After that, the
raster is the single source object, and the user chooses **independently** what to
do with it. There are **two distinct operations**, and they are *different kinds
of thing*:

1. **Trace Image** — a **tool** (under the Tools menu) that *converts* the raster
   into vector paths. It is an operation you run on an already-present image; it
   does not re-import.
   <cite>docs.lightburnsoftware.com/latest/Reference/TraceImage/</cite>
2. **Image mode** — a **layer mode** (one of four cut modes a layer can be in).
   Leaving the raster on an Image-mode layer engraves it directly as a photo,
   with dithering/grayscale processing. No conversion happens.
   <cite>docs.lightburnsoftware.com/latest/Explainers/LayerModes/</cite>

LightBurn's own overview frames these as the two paths for an image: vectorize it
with the trace tool, **or** engrave it directly in Image mode.
<cite>docs.lightburnsoftware.com/2.0/Collections/WorkingWithImages/</cite>

**So LightBurn has no "Trace Image button" vs "Engrave Image button" split at
import time.** Import is one action. "Trace" is a *tool you apply*; "engrave" is
just *the layer mode the raster already sits on*. The trace-vs-engrave decision is
**downstream of import**, not a fork in how you bring the file in.

This is the crux for LaserForge — see 1.5.

### 1.2 Layer modes — the four cut behaviours (context for where "Image" fits)

A LightBurn layer is in exactly one of **four modes**. Mode is a property of the
*layer* (the color), set in the Cuts/Layers window or Cut Settings editor — not a
property chosen at import.
<cite>docs.lightburnsoftware.com/latest/Explainers/LayerModes/</cite>

| Mode | Operates on | What the laser does | Typical use |
|---|---|---|---|
| **Line** | vectors | traces the contour/outline of the shapes | scoring, marking, or cutting (etch vs cut is just power/speed) |
| **Fill** | closed vectors | sweeps parallel lines inside the shape boundary (scanline) | filling/engraving an area; spacing set by **Line Interval** |
| **Offset Fill** | closed vectors | concentric lines that follow the shape outline inward | shapes with large hollow areas, to cut travel time; expensive, poor on complex shapes |
| **Image** | raster bitmap | engraves the photo with intensity variation + dithering | photo / grayscale engraving |

Notes worth carrying forward:

- **Mode is switched after the fact**, via the Color Palette (assign color/layer)
  + the Cuts/Layers window or Cut Settings editor (set the mode). It is not a
  decision made during import.
  <cite>docs.lightburnsoftware.com/latest/Explainers/LayerModes/</cite>
- **Fill mode + nesting:** when nested/overlapping closed shapes are on the **same**
  Fill layer, the region *between* outlines is filled (donut/annulus). The same
  shapes on **different** layers engrave the overlap twice. (LaserForge's
  `fillHatching` already does even-odd hole handling, which matches the
  same-layer donut behaviour.)
  <cite>docs.lightburnsoftware.com/latest/Explainers/LayerModes/</cite>
- **Offset Fill** is explicitly called out as computationally expensive and prone
  to performance issues on complex designs — relevant given LaserForge just fixed
  an O(scanlines×edges) freeze in `fill-hatching.ts`. We do not implement Offset
  Fill today; if we ever do, expect the same performance care.
  <cite>docs.lightburnsoftware.com/latest/Explainers/LayerModes/</cite>

### 1.3 Trace Image — the vectorize tool

**What it is:** a tool that converts a raster into vector graphics, producing a
**Group** of vector shapes (the user ungroups to edit individual paths). The
source image is *not* consumed unless you opt in (see "Delete Image After trace").
<cite>docs.lightburnsoftware.com/latest/Reference/TraceImage/</cite>

**How it's invoked (three ways):**

- **Tools → Trace Image**
- **Right-click the image → Trace Image**
- **Alt/Option + T**

<cite>docs.lightburnsoftware.com/latest/Reference/TraceImage/</cite>

**Dialog — preview controls:**

- **Fade Image** — dims the source so the traced vectors are easier to see.
- **Boundary** — click-drag to restrict tracing to a sub-region; **Clear Boundary** resets it.
- **Show Points** — toggles node markers in the preview.

**Dialog — trace options:**

| Control | Function | Default (per docs) |
|---|---|---|
| **Cutoff** | lower brightness bound of what gets outlined | 0 |
| **Threshold** | upper brightness bound | 128 |
| **Ignore Less Than** | drops traced regions below a pixel-count (noise/speckle removal) | not stated |
| **Optimize** | reduces node count of the output vectors | 0.2 |
| **Smoothness** | line-segments → curves (0.0 = straight lines only; 1.33 = curves only) | not stated |
| **Trace Transparency** | trace by the alpha channel instead of brightness | off |
| **Sketch Trace** | edge detection via local contrast; tuned for handwriting/documents | off |
| **Delete Image After trace** | auto-remove the source image when done | off |

<cite>docs.lightburnsoftware.com/latest/Reference/TraceImage/</cite>

**Workflow:** select the image → invoke (menu / right-click / Alt+T) → adjust
options with live preview → **OK** to emit the vector group → ungroup to edit.
<cite>docs.lightburnsoftware.com/latest/Reference/TraceImage/</cite>

**LaserForge mapping (verified against our code earlier this session):** our Trace
dialog exposes `numberofcolors` + preprocessing presets (Otsu / median /
despeckle, per RESEARCH_LOG Phase E.2) rather than LightBurn's Cutoff/Threshold/
Smoothness/Optimize vocabulary. Same goal (raster→vector), different knobs.
LightBurn's **Ignore Less Than** ≈ our despeckle; **Smoothness** ≈ our curve
fitting; **Delete Image After trace** is the inverse of our deliberate
"keep source raster" behaviour (ADR-026).

### 1.4 Image mode — direct raster engraving

When the layer is in **Image** mode, the raster is engraved directly. It behaves
like Fill (parallel scan lines) plus an **image processing mode** that decides how
each pixel maps to laser on/off or power.
<cite>docs.lightburnsoftware.com/2.0/Collections/WorkingWithImages/</cite>

**Image processing (dither) modes — LightBurn offers ten:**

| Mode | What it does (paraphrased) | Best for |
|---|---|---|
| **Threshold** | on/off per pixel by brightness | already-black/white art |
| **Ordered** | regular grid of on/off dots to fake shading | solid-fill areas |
| **Atkinson** | balanced error diffusion; preserves detail | solid color or smooth shading |
| **Dither** | error-diffusion dithering (this is LightBurn's name for the Floyd-Steinberg family) | smoothly shaded photos |
| **Stucki** | high-quality diffusion, a bit faster than Jarvis | smooth/photo |
| **Jarvis** | high-quality diffusion, usually the best photo choice | smooth/photo |
| **Newsprint** | newspaper-halftone look; good shading, visibly patterned | stylised |
| **Halftone** | halftone with variable cell size + pattern angle | high-DPI shading |
| **Sketch** | hard-edge detection | line drawings / handwriting |
| **Grayscale** | varies power between Min and Max by pixel brightness | depth (CO2) / shading (diode) |

<cite>docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Image.html</cite>

**Parameters in the Image-mode panel (as named in the docs):** Line Interval, DPI,
Scan Angle (default 0), Z Offset, Number of Passes, Ramp Length, Cells per inch
(Halftone only), Halftone angle (Halftone only), plus toggles **Bi-directional
Fill**, **Negative Image**, **Overscanning**, **Pass-Through**. (Speed/power
min-max are not listed on this specific page — they live in the shared cut-settings
header; **UNVERIFIED** here, to confirm from the Cut Settings editor page.)
<cite>docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Image.html</cite>

**Grayscale specifics:** maps lightest shades → Min power and darkest → Max power,
giving variable-depth engraving on CO2 and shading on diode lasers. For preview,
the **"Shade according to power"** checkbox must be enabled or the preview shows
solid black.
<cite>docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Image.html</cite>

**LaserForge mapping (verified earlier this session):** our raster path hard-codes
`dither: 'floyd-steinberg'` and `linesPerMm: 10` at both import buttons. LightBurn
exposes the dither mode as a **per-layer Image-mode setting** with ten choices, and
spacing as **Line Interval / DPI** on that same panel — i.e. a property of the
engrave layer, chosen/edited after import, not frozen at import time.

### 1.5 What this means for LaserForge (the trace-vs-engrave redundancy)

**Your observation is essentially correct, and the docs explain why it feels
redundant.** Recap of what we verified in our own code earlier this session:

- **Trace Image** button → creates vector `traced-image` paths **and** deposits a
  source raster (Floyd-Steinberg, 10 lines/mm) on an Image-mode `#808080` layer.
- **Engrave Image** button → deposits *the same* raster (Floyd-Steinberg, 10
  lines/mm) on an Image-mode `#808080` layer, with no vectors.

So Engrave Image ⊂ Trace Image's raster half. The photo-engrave deposit is
duplicated across both entry points.

**LightBurn's model, by contrast:**

- **One import.** The file comes in as a raster, full stop.
- **Engrave** is not a button — it's just "the raster is on an Image-mode layer,"
  which is the natural resting state of an imported image.
- **Trace** is a *tool* you optionally run to *add* vectors. Whether to also keep
  the raster is a checkbox (**Delete Image After trace**), not a second import
  flow.

**Hypothesis / recommendation (for your decision — not yet implemented):** collapse
the two buttons into **one "Import Image"** that brings the raster in on an
Image-mode layer (ready to engrave by default), and make **Trace** a *tool* that
operates on the selected image to add vectors. That removes the duplicated raster
deposit and matches the proven LightBurn workflow. This is a design change with
ADR + WORKFLOW implications, so per tight-leash I'm flagging it for review, not
acting on it. (Counter-consideration: our two buttons may be a deliberate
beginner-friendly affordance; worth weighing before changing.)

### 1.6 Sources (official LightBurn docs)

| # | Page | URL | Confidence |
|---|---|---|---|
| 1 | Working With Images (collection) | docs.lightburnsoftware.com/2.0/Collections/WorkingWithImages/ | high |
| 2 | Trace Image (reference) | docs.lightburnsoftware.com/latest/Reference/TraceImage/ | high |
| 3 | Image mode cut settings | docs.lightburnsoftware.com/UI/CutSettings/CutSettings-Image.html | high |
| 4 | Layer Modes (explainer) | docs.lightburnsoftware.com/latest/Explainers/LayerModes/ | high |

Confidence is "high" for facts directly quoted as UI labels/defaults on these
pages. All four were fetched 2026-05-29. Content was read via web fetch (HTML→text);
exact slider ranges/screenshots were not pixel-verified.

### 1.7 Not yet verified (read these before relying on the gaps)

- Speed / Min-Max power fields for Image mode (they live on the shared Cut Settings
  header, not the Image page). → confirm from the **Cut Settings editor** page.
- **How an image is physically imported** (File → Import vs drag-drop vs paste) —
  the Working-With-Images page didn't state the mechanism. → confirm from the
  **Import** / File-menu doc.
- Sub-pages in the collection I have *not* yet read but that matter to the image
  pipeline: **Images vs Vectors**, **Five Steps to Perfect Image Engraving**,
  **Line Interval**, **Dot Width Correction**, **Adjust Image**, **Apply Mask to
  Image**, **Convert to Bitmap**.
- Whether **Optimize / Smoothness** defaults I listed are the same across LightBurn
  1.7 and 2.0 (versions may differ).

---

---

## Section 2 — The end-to-end image-engrave workflow (the path we copy)

Section 1 covered *what the operations are*. This section covers *the order a user
does them in* — LightBurn's own recommended sequence for getting a clean photo
engrave. This is the workflow LaserForge should mirror. It resolves several of the
§1.7 gaps (Adjust Image, the recommended Line Interval band, the photo dither
choice).

### 2.1 LightBurn's recommended 5-step image-engrave sequence

Source: the official "Five Steps to Perfect Image Engraving" guide.
<cite>docs.lightburnsoftware.com/Tutorials/PerfectImageEngraveSettings/index.html</cite>

| # | Step | Tool used | What it produces / decides |
|---|---|---|---|
| 1 | **Focus** | Laser Tools → **Focus Test** | correct focal height (motorised-Z machines) |
| 2 | **Speed & Power** | Laser Tools → **Material Test** | a speed/power pair that burns dark without cutting too deep; saved into the Cut Settings editor |
| 3 | **Line Interval / DPI** | Laser Tools → **Interval Test** | the scan-line spacing where adjacent lines *just touch* — no overlap, no gap |
| 4 | **Dot Width Correction** | calibrate in **Ordered** mode | compensates for real beam-dot width; calibrated to a 50/50 checkerboard, then switch the layer back to the photo dither |
| 5 | **Adjust Image** | **Adjust Image** tool | brightness / contrast / gamma / enhance tweaks if the result still looks off |

Key numbers and choices stated by the guide:

- **Line Interval / DPI band:** roughly **120–300 DPI (≈ 0.08–0.2 mm)** for photo
  engraving. Pick it with the Interval Test (lines just touching), or by engraving
  a gradient and varying the interval by eye.
  <cite>docs.lightburnsoftware.com/Tutorials/PerfectImageEngraveSettings/index.html</cite>
- **Dither for final photos: Jarvis.** Ordered is used *only* during the dot-width
  calibration (step 4) because its regular grid yields a measurable 50/50
  checkerboard; once calibrated you switch the layer back to Jarvis for production.
  <cite>docs.lightburnsoftware.com/Tutorials/PerfectImageEngraveSettings/index.html</cite>
- **Speed/power:** the guide gives a *principle* (dark but not cut-through; CO2
  often wants slow speed + low power) but **no specific numbers or pass counts** —
  those come from the Material Test on your own machine/material.
  <cite>docs.lightburnsoftware.com/Tutorials/PerfectImageEngraveSettings/index.html</cite>

> Note: steps 1–4 lean on on-machine **"Laser Tools"** calibration utilities that
> run real test burns on the hardware. They are device-side, so for LaserForge they
> belong with GRBL job-control (Phase B+), not the pure core. Captured here so the
> full workflow isn't lost.

### 2.2 The Adjust Image tool (step 5)

Source: Adjust Image reference.
<cite>docs.lightburnsoftware.com/Tools/AdjustImage.html</cite>

- **Invoke:** select one image → **right-click → Adjust Image** (no toolbar button
  or shortcut documented).
- **Controls:** **Brightness**, **Contrast**, **Gamma** (sliders or numeric entry),
  plus an **Invert Display** toggle that previews the engrave as white-on-black to
  simulate a dark surface.
- **Non-destructive:** shows a live source-vs-processed side-by-side preview;
  settings apply to the image's **layer settings on OK** (Cancel discards).
  **Invert Display affects the preview only**, never the actual output.
- **Workflow:** select image → right-click → Adjust Image → compare source vs
  preview → adjust Brightness/Contrast/Gamma → optionally toggle Invert Display →
  OK to apply.

(The Adjust Image page does **not** mention sharpening "Enhance Radius/Amount"
controls, nor how the adjustments interact with the dither mode — both **UNVERIFIED**
and carried to §2.5.)

### 2.3 What this means for LaserForge

Grounded in what we verified in our own code earlier this session (the two import
buttons both hard-code `dither: 'floyd-steinberg'`, `linesPerMm: 10`):

- **Line spacing should be a calibrated, per-layer value — not frozen at import.**
  LightBurn treats it as a per-material number found by test. Our hard-coded
  **10 lines/mm = 0.1 mm interval = 254 DPI** happens to sit *inside* LightBurn's
  120–300 DPI band (their band ≈ 4.7–11.8 lines/mm), so the default is reasonable —
  but it should be **user-editable per Image layer**, like LightBurn's Line
  Interval/DPI field, not locked.
- **Dither should be a per-layer choice with Jarvis as the photo default.** We
  hard-code Floyd-Steinberg (LightBurn's "Dither" mode). That's a fine *option*,
  but LightBurn's guidance is Jarvis for photos; exposing the mode per layer (as in
  §1.4's ten modes) is the parity move.
- **We have no Adjust Image tool.** Brightness/Contrast/Gamma pre-processing is a
  real gap for photo-engrave quality. Roadmap candidate (not implementing now).
- **Calibration utilities (Focus/Material/Interval Test) are device-side** — they
  fit GRBL job-control, not the pure core. Note for Phase B+.

All of the above are **findings for your decision**, consistent with "we copy
LightBurn's workflow" — but they're ADR/WORKFLOW-level changes, so per tight-leash
they're flagged, not built.

### 2.4 Sources (official LightBurn docs)

| # | Page | URL | Confidence |
|---|---|---|---|
| 5 | Five Steps to Perfect Image Engraving | docs.lightburnsoftware.com/Tutorials/PerfectImageEngraveSettings/index.html | high |
| 6 | Adjust Image (reference) | docs.lightburnsoftware.com/Tools/AdjustImage.html | high |

Canonical sub-page URLs discovered from the Working-With-Images collection (for the
next sections, not yet read): Image Mode `…/Reference/CutSettingsEditor/ImageMode/`;
Images vs Vectors `…/Explainers/ImagesVsVectors/`; Interval Test
`…/Reference/IntervalTest/`; Dot Width Correction
`…/Reference/CutSettingsEditor/ImageMode/#dot-width-correction`; Apply Mask
`…/Reference/ApplyMaskToImage/`; Convert to Bitmap `…/Reference/ConvertToBitmap/`.
Fetched 2026-05-29.

### 2.5 Not yet verified (next)

- **Interval Test** internals — how the test pattern is generated/read (`…/Reference/IntervalTest/`).
- **Dot Width Correction** — what the setting actually does to the pixel→dot mapping (`…/Reference/CutSettingsEditor/ImageMode/#dot-width-correction`).
- **Images vs Vectors** — LightBurn's conceptual framing (`…/Explainers/ImagesVsVectors/`).
- **Convert to Bitmap** — vector→raster, the inverse of Trace (`…/Reference/ConvertToBitmap/`).
- **Apply Mask to Image** — selective hide/crop (`…/Reference/ApplyMaskToImage/`).
- **Adjust Image**: sharpening "Enhance" controls and dither-interaction (not on the page I read).
- Concrete speed/power/pass numbers (the guide deliberately gives none — they're machine/material specific).

---

*End of Section 2.*

---

> **Sections 3–7 below are the whole-app LightBurn reference** (added 2026-05-29).
> They were compiled by five parallel documentation-research passes over the
> official `docs.lightburnsoftware.com` pages. Every factual claim cites the page
> it came from; nothing was read from the running app, and unverifiable items are
> marked **UNVERIFIED** in each section's "Not yet verified" list. **No LaserForge
> mapping is woven in yet** — that is a separate reviewed pass (see Status above).

---

## Section 3 — Menus & Toolbars

> Compiled from the official `docs.lightburnsoftware.com` `/latest/` UI reference.
> Behaviours and shortcuts are paraphrased; short UI labels quoted verbatim.
> Shortcuts written "Ctrl/Cmd+X" = `Ctrl` on Windows, `Cmd` on macOS.

### 3.1 The menu bar — top-level menus

LightBurn's menu bar contains these top-level menus (left to right): **File, Edit,
Tools, Arrange, Laser Tools, Window, Language, Help.** ("Language" is a simple
interface-language picker; not detailed below.) [S1, S2]

### 3.2 File menu

| Control | Function | Shortcut |
|---|---|---|
| New | Clears the current project and starts a new blank project | Ctrl/Cmd+N |
| New Window | Opens a separate LightBurn instance to edit multiple projects at once | — |
| Recent Projects | Lists recently opened projects (up to 24) for quick reopening | — |
| Open | Opens a saved LightBurn project (`.lbrn` / `.lbrn2`) | Ctrl/Cmd+O |
| Import | Adds artwork/objects from many file formats into the open project | Ctrl/Cmd+I |
| Show Notes | Stores/views project-specific notes | Ctrl/Cmd+Alt/Option+N |
| Save | Saves the project under its existing filename | Ctrl/Cmd+S |
| Save As | Saves the project under a new filename | Ctrl/Cmd+Shift+S |
| Save Machine Files | Exports machine-specific output (GCode, RD, OUT, UD5) | Alt/Option+Shift+L |
| Export | Exports selected graphics as `.ai`, `.svg`, or `.dxf` | Alt/Option+X |
| Preferences (submenu) | Import Prefs, Export Prefs, Open Prefs Folder, Load Prefs Backup, Edit Hotkeys | — |
| Bundles (submenu) | Import Bundles, Export Bundle | — |
| Print (black only) | Prints / exports to PDF in black & white | Ctrl/Cmd+P |
| Print (keep colors) | Prints / exports preserving layer color assignments | Ctrl/Cmd+Shift+P |
| Save Processed Bitmap | Exports a copy of an adjusted bitmap | — |
| Save Background Capture | Saves the camera overlay image from the workspace | — |
| Exit | Closes LightBurn | Ctrl/Cmd+Q |

Source: [S3]

### 3.3 Edit menu

| Control | Function | Shortcut |
|---|---|---|
| Undo | Reverses previous actions, most recent first | Ctrl/Cmd+Z |
| Redo | Reapplies undone actions | Ctrl/Cmd+Shift+Z |
| Select All | Selects all objects in the workspace | Ctrl/Cmd+A |
| Invert Selection | Selects what was unselected and vice-versa | Ctrl/Cmd+Shift+I |
| Cut | Removes selected objects to the clipboard | Ctrl/Cmd+X |
| Copy | Copies selected objects to the clipboard | Ctrl/Cmd+C |
| Duplicate | Creates duplicates directly on top of originals | Ctrl/Cmd+D |
| Paste | Pastes clipboard objects centered at the cursor | Ctrl/Cmd+V |
| Paste in Place | Pastes at the original project coordinates | — |
| Delete | Deletes selected objects | Del |
| Convert to Path | Converts shapes/text to editable node paths | Ctrl/Cmd+Shift+C |
| Convert to Bitmap | Converts selected vectors into a bitmap image | *(see note)* |
| Close Path | Joins start/end nodes of an open shape with a line | — |
| Close Selected Paths With Tolerance | Closes paths within a set distance, with move/join options | — |
| Auto-Join Selected Shapes | Joins nearby segments within 0.05 mm tolerance | Alt/Option+J |
| Optimize Selected Shapes | Smooths/fits shapes to arcs or lines within a tolerance | Alt/Option+Shift+O |
| Delete Duplicates | Removes identical overlapping objects | Alt/Option+D |
| Reverse Shape Direction | Reverses the laser's travel direction along a line | — |
| Select Open Shapes | Selects all unclosed paths | — |
| Select Open Shapes Set to Fill | Selects unclosed paths assigned to Fill / Offset Fill | — |
| Select All Shapes in Current Layer | Selects every shape on the active layer | — |
| Select Contained Shapes | Selects shapes inside the current selection | — |
| Select Shapes Smaller Than Selected | Selects all shapes smaller than the current selection | — |
| Image Options → Refresh Image | Reloads an updated source image file | — |
| Image Options → Replace Image | Substitutes a different image file | — |
| Image Options → Replace Image to Fit | Replaces the image and resizes it to original dimensions | — |
| Settings | Opens device-independent global LightBurn settings | — |

Source: [S4]. *Note:* the fetched page reported the same shortcut (Ctrl/Cmd+Shift+C)
for both Convert to Path and Convert to Bitmap — a likely extraction collision; the
true Convert-to-Bitmap shortcut is **UNVERIFIED** (but §7.4 reports Ctrl/Cmd+Shift+B
from the Convert-to-Bitmap reference page).

### 3.4 Tools menu

| Control | Function | Shortcut |
|---|---|---|
| Select | Primary tool for selecting/deselecting objects | Esc |
| Draw Lines | Creates custom paths by placing points (lines or curves) | Ctrl/Cmd+L |
| Draw Shape → Rectangle | Creates rectangles/squares | Ctrl/Cmd+R |
| Draw Shape → Ellipse | Creates ovals/circles | Ctrl/Cmd+E |
| Draw Shape → Triangle / Pentagon / Polygon / Octagon / Star / Dual Star | Primary-shape variants (Polygon defaults to hexagon, adjustable sides) | — |
| Edit Nodes | Adds/deletes/moves the points of vector paths | Ctrl/Cmd+` |
| Trim Shapes | Trims lines back to their next intersection | Ctrl/Cmd+K |
| Add Tabs | Inserts small skipped (uncut) sections in cuts | Ctrl/Cmd+Tab |
| Edit Text | Activates the Create/Edit Text tool | Ctrl/Cmd+T |
| Position Laser | Jogs the laser to a clicked location in the work area | Alt/Option+L |
| Measure | Hover a shape to read its info / measure distances | Alt/Option+M |
| Create Bar Code | Generates a Bar Code / QR Code from stored data | — |
| Offset Shapes | Outlines shapes at a specified distance | Alt/Option+O |
| Weld Shapes | Merges overlapping vectors into one shape | Ctrl/Cmd+W |
| Boolean Union / Subtract / Intersection | Combine / subtract / intersect two overlapping vectors | Alt/Option++ / Alt/Option+- / Alt/Option+* |
| Boolean Assistant | Dialog previewing each boolean operation | Ctrl/Cmd+B |
| Cut Shapes | Splits vectors using a closed shape as a cutter | Alt/Option+Shift+C |
| Adjust Image | Opens image-adjustment (Contrast, Brightness, Gamma, etc.) | Alt/Option+I |
| Trace Image | Traces a bitmap's outlines into vector graphics | Alt/Option+T |
| Multi-File Trace Image (Labs) | Batch image-trace automation | — |
| Apply Path to Text | Bends text to follow a vector object's contour | — |
| Apply Mask to Image | Masks a bitmap with a closed vector | — |
| Crop Image | Masks an image and immediately flattens it | — |
| Resize Slots in Selection | Adjusts slot/tab dimensions in selected objects | — |
| Warp Selection (4 Points) | Warps text/shapes/images via 4 corner handles | — |
| Deform Selection (16 Points) | Deforms via a 4×4 grid of 16 handles | — |
| Generate Tangent Circle | Creates a circle tangent to three existing circles | — |

Source: [S5]. *Note:* the Tools-menu extraction reported Ctrl/Cmd+L / Ctrl/Cmd+M for
Position Laser / Measure, conflicting with Draw Lines; the Creation-Toolbar page's
Alt/Option+L and Alt/Option+M are treated as authoritative.

### 3.5 Arrange menu

| Control | Function | Shortcut |
|---|---|---|
| Group / Ungroup | Combine objects so they move/resize as one (and reverse) | Ctrl/Cmd+G / Ctrl/Cmd+U |
| Auto-Group | Groups objects within a closed shape with the outer shape | — |
| Flip Horizontal / Vertical | Mirrors across the X / Y axis | Shift+Ctrl/Cmd+H / Shift+Ctrl/Cmd+V |
| Mirror Across Line | Flips objects along a selected line | Shift+Ctrl/Cmd+M |
| Rotate 90° CW / CCW | Rotates right / left by 90° | `.` / `,` |
| Two-Point Rotate / Scale | Rotates & resizes around custom pivot points | Ctrl/Cmd+2 |
| Align | Aligns objects by edges or centers | — |
| Distribute (+ Move Together) | Evenly spaces objects; Move Together abuts edges | — |
| Nest Selected | Packs objects to reduce waste (online service) | — |
| Dock | Moves objects to the workspace edge or another object | — |
| Move Selected Objects | Moves objects to a corner/midpoint/center of the workspace | — |
| Move Laser to Selection (+ Jog Laser) | Moves/jogs the laser to a position on the selection | — |
| Grid Array | Copies an object into spaced rows and columns | — |
| Circular Array | Copies an object radially around a point/object | — |
| Copy Along Path | Duplicates an object along a path's contour | — |
| Create Rubber-Band Outline from Selection | Makes a new shape outlining the selection | — |
| Break Apart | Separates a path into its component lines/curves | Alt/Option+B |
| Push in Draw Order | Changes an object's position in the draw order | — |
| Lock / Unlock Selected Shapes | Prevents / re-enables editing of selected objects | — |

Source: [S6]

### 3.6 Laser Tools menu

Tools, tests, and wizards for advanced laser operations and hardware setup. Items
shown depend on the connected laser type. [S7]

| Control | Function |
|---|---|
| Print and Cut | Aligns the project to targets in a previously output design |
| Manage Cameras | Opens the Device Cameras window to add/edit/remove cameras |
| Rotary Setup (Ctrl/Cmd+Shift+R) | Configures rotary equipment for cylindrical objects |
| Cylinder Correction Setup | Warps output to correct for cylindrical-surface expansion |
| Repeat Marking | Drives rotating/linear axis tables on Galvo lasers for repeats |
| Focus Test | Test pattern to find optimal focal height (needs Z control) |
| Interval Test | Test pattern to find optimal Line Interval for a speed/power (see §7.1) |
| Material Test | Grid testing combinations of two variables (see §7.8) |
| Center Finder | Finds a circular object's center via three points |
| Taper Warp | Compensates for top/bottom diameter differences (rotary/cylinder) |
| Calibrate Galvo Lens | Marks/measures a pattern to correct Galvo-lens distortion |
| Manage Devices | Opens the Devices window to create/edit laser profiles |
| Device Settings | Edits device-specific settings for the active device |
| Machine Settings | Edits controller/device parameters on supported lasers |

Source: [S7]

### 3.7 Window menu

Controls the workspace layout — enabling/disabling windows and toolbars and
resetting the layout. Notable items: **Reset to Default Layout**; **Preview**
(Alt/Option+P); **Zoom** submenu; **View Style**; **Toggle Side Panels** (F12);
and toggles for each dockable window/toolbar — Art Library, Arrange, Modifiers,
Camera Control, Console, **Cuts / Layers**, Color Palette, Docking, File List,
**Laser**, **Material Library**, Main (toolbar), Modes, **Move**, Numeric Edits,
**Shape Properties**, Text Options, **Tools** (creation toolbar), Variable Text.
Source: [S8]

### 3.8 Help menu

Items include About LightBurn, EULA, Support Forum, Submit Feature Request, **Quick
Help and Notes** (F1), Online Documentation, PDF Documentation Link, Online Video
Tutorials, CorelDRAW Macro Setup Help, Generate Support Data, Camera Selection Help,
Check for Updates, **License Management**, Enable Debug Log, plus internal debug
tools (Debug Drawing, Convert to Cut (Debug), Real-Time Statistics). Source: [S9]
— *page slug unconfirmed; see Not yet verified.*

### 3.9 Top toolbar — Main Toolbar

By default at the left of the top toolbar row. File/clipboard/view quick-access:
New, Open, Save, Import, Undo/Redo, Copy, Cut, Paste, Delete, Pan/Drag View, Zoom
to Page, Zoom In/Out, Zoom to Frame Selection, Update Background From Camera,
Preview, Settings, Device Settings. Source: [S10]

### 3.10 Top toolbar — Arrange Toolbar

To the right of the Main Toolbar: Group/Ungroup, Flip or Mirror, Align, Make Same
Width or Height, Distribute, Move Selected Objects / Move Laser to Selection
(dropdown). Source: [S11]

### 3.11 Left toolbar — Creation Toolbar

Upper toolbar on the left edge; re-enable via **Window → Creation Tools**.

| Control | Function | Shortcut |
|---|---|---|
| Select | Select/deselect objects | Esc |
| Draw Lines | Vector paths from straight & curved lines | Ctrl/Cmd+L |
| Draw Shapes | Primary-shapes submenu (Rect Ctrl/Cmd+R, Ellipse Ctrl/Cmd+E, Triangle, Pentagon, Polygon, Octagon, Star, Dual Star) | — |
| Edit Nodes | Edit nodes/points of ungrouped vector paths | Ctrl/Cmd+` |
| Trim Shapes | Remove vector sections between intersections | Ctrl/Cmd+K |
| Add Tabs | Add small deliberately uncut sections | Ctrl/Cmd+Tab |
| Create / Edit Text | Create or edit text objects | Ctrl/Cmd+T |
| Position Laser | Move laser to clicked workspace location | Alt/Option+L |
| Measure | Hover for measurements, or drag to measure | Alt/Option+M |

Source: [S12]

### 3.12 Selection & navigation modifier keys

While clicking or box-dragging: **Shift** adds; **Ctrl/Cmd** toggles; **Ctrl/Cmd+Shift**
removes. **Esc** clears; **Tab** cycles through objects. (Drag right = enclosing/window
select; drag left = crossing select — see §6.1.) Source: [S13]

### 3.13 Sources (Section 3)

| # | Page | URL | Confidence |
|---|---|---|---|
| S1 | Menus (overview) | docs.lightburnsoftware.com/UI/Menus.html | med |
| S2 | Tools and Features (Reference index) | docs.lightburnsoftware.com/latest/Reference/ | med |
| S3 | File Menu | docs.lightburnsoftware.com/latest/Reference/UI/FileMenu/ | high |
| S4 | Edit Menu | docs.lightburnsoftware.com/latest/Reference/UI/EditMenu/ | high |
| S5 | Tools Menu | docs.lightburnsoftware.com/latest/Reference/UI/ToolsMenu/ | high |
| S6 | Arrange Menu | docs.lightburnsoftware.com/latest/Reference/UI/ArrangeMenu/ | high |
| S7 | Laser Tools Menu | docs.lightburnsoftware.com/latest/Reference/UI/LaserToolsMenu/ | high |
| S8 | Window Menu | docs.lightburnsoftware.com/latest/Reference/UI/WindowMenu/ | high |
| S9 | Help Menu / Help & Notes | docs.lightburnsoftware.com/latest/Reference/UI/HelpAndNotes/ | med |
| S10 | Main Toolbar | docs.lightburnsoftware.com/latest/Reference/UI/MainToolbar/ | high |
| S11 | Arrange Toolbar | docs.lightburnsoftware.com/latest/Reference/UI/ArrangeToolbar/ | high |
| S12 | Creation Toolbar | docs.lightburnsoftware.com/latest/Reference/UI/CreationToolbar/ | high |
| S13 | Hotkeys / Selection | docs.lightburnsoftware.com/Hotkeys.html ; …/latest/Reference/Selection/ | med |

All fetched 2026-05-29 via web fetch (HTML→text); not pixel-verified against the app.

### 3.14 Not yet verified (Section 3)

- **Help-menu page slug** — the obvious `/latest/Reference/UI/HelpMenu/` URL 404'd; content was obtained via a resolved fetch but the canonical slug is **UNVERIFIED**.
- **Convert to Bitmap shortcut** in the Edit menu (collided with Convert to Path); §7.4 gives Ctrl/Cmd+Shift+B from the dedicated page.
- **Position Laser / Measure shortcuts** — Tools-menu page said Ctrl/Cmd+L/M (collision); Alt/Option+L/M used from the Creation-Toolbar page.
- **Boolean shortcut glyphs** (`Alt/Option++/-/*`) — verbatim from the Tools-menu page; behaviour on non-US keyboards **UNVERIFIED**.
- **Menu / Modes / Modifiers toolbars** and the **Language menu** — existence confirmed, button-level contents **not fetched**.
- **"Laser Tools" as a true top-level menu vs nested under Tools** — the overview page was ambiguous; treated as top-level here.

---

## Section 4 — Cuts/Layers Window & Cut Settings Editor

> Quoted strings are exact UI labels / short doc quotes; everything else paraphrase.

### 4.1 Color palette & the layer concept

In LightBurn, **colors are layers**. The Color Palette sits at the bottom of the
Main Window; clicking a swatch assigns that color/layer to the selection, or — with
nothing selected — sets the color for subsequently created shapes. "Different colors
indicate different layers… These colors don't represent the final product's colors
but instead differentiate each operation."

- **Palette size:** 30 numbered layers (00–29) + 2 tool layers (T1, T2) = 32 entries.
- **Tool layers (T1, T2):** have "no cut parameters and will never be output to the
  laser" — used for boundaries, alignment guides, masks. Draggable Guidelines live on **T1**.
- **Mode applies per layer:** a layer's mode applies to all objects on it.
- **Layer split:** "if you add an image to a vector layer (or vice versa), then the
  layers will split to show two entries in the Cuts / Layers Window."

Source: [4-9, 4-10]

### 4.2 Cuts / Layers window — columns

Upper-right by default; layers normally execute top-to-bottom (re-orderable).

| Column | Function |
|---|---|
| **#** / Layer | Layer identifier + color swatch matching the Color Palette |
| **Mode** | Dropdown: Line / Fill / Offset Fill for vectors; Image (read-only) for images; "Multi" if sub-layers |
| **Spd / Pwr** | Shows Speed and Power Max; editable below the list |
| **Output** | Include/exclude the layer from Preview/Start/Send/export; disabled layers faded |
| **Show** | Visibility in the workspace |
| **Air** | Air Assist toggle per layer (gantry/DSP & GCode) |

Quick-edit fields below the list: **Pass Count, Speed, Power Max, Power Min,
Interval, Frequency (Galvo), Q-Pulse (MOPA/UV)**. Buttons/actions: Up/Down or drag
to reorder; **Copy/Paste** settings between layers; Delete (Shift+click skips
confirm); Shift+left-click a layer or right-click → "Select all shapes in current
layer". Header right-click: enable/disable/show/hide all, invert, air-assist all,
**Sort Cuts Last** (orders by cutting strength). Source: [4-1]

### 4.3 Cut Settings Editor — overview

Opened by **double-clicking** a Cuts/Layers entry or a Material Library entry. The
essentials — **Speed, Power, Mode** — show at top for every laser/mode; below them
options split into **Common** and **Advanced** tabs (set varies by laser type and
mode). Layer modes: **Line** (trace outlines), **Fill** (parallel scan lines inside
closed shapes), **Offset Fill** (concentric contour-following lines), **Image**
(like Fill, applies image/pixel settings). Source: [4-2]

### 4.4 Common / shared settings

| Control | Function | Default |
|---|---|---|
| Name | Renames the layer | — |
| Output | Include/exclude from preview/start/send/save | — |
| Speed | Max velocity; units (mm/s vs mm/min) set in Device Settings | — |
| Max Power | Max power; on GRBL ramps proportionally with speed | — |
| Min Power | Power during low-speed motion (corners, ends); DSP & grayscale image; "Corner Power" on some DSP | — |
| Constant Power Mode | GRBL only — constant power (M3) instead of variable (M4) | Disabled (M4) |
| Air Assist | Toggle (GCode uses M7/M8 set in Device Settings) | — |
| Mode | Line / Fill / Offset Fill (images → Image) | — |
| Default Speed/Power Switch | Ruida — use controller preset speed/power | — |

Source: [4-3]

### 4.5 Line mode

**Common:** Number of Passes, Z Offset, Z Step per Pass, Kerf Offset (positive =
outside, negative = inside closed shapes), Perforation Mode (Cut/Skip distances),
Tabs/Bridges. **Advanced:** Start/End Pause Time (ms), Overcut (final pass on closed
shapes), Override PWM Frequency (RF tubes), Enable PPI (pulses per inch), Lead-In/
Lead-Out (Angle/Length/Style: Line or Arc), Dot Mode Time/Spacing, U Offset (Ruida).
Source: [4-4]

### 4.6 Fill mode

**Common:** Line Interval (ideal = lines "just touch, without overlapping"), Lines
Per Inch (inverse), Scan Angle (0° = horizontal bottom-to-top; 90° vertical; range
0–360°; DSP prefers multiples of 90°), Bi-directional Fill, Cross-Hatch ("a second
engraving pass 90 degrees rotated"), Overscanning (% of Speed; not DSP/Galvo),
Number of Passes, Z Offset, Z Step per Pass, Fill Grouping ("Fill All Shapes at
Once" / "Fill Groups Together" / "Fill Shapes Individually"). **Advanced:** Ramp
Length (slope sides by varying power, e.g. stamps), Ramp Outer Edge, Flood Fill
(reduces blank-space travel; "very sensitive to machine tuning and backlash"),
Override PWM Frequency, Enable PPI, U Offset. Source: [4-5]

### 4.7 Offset Fill mode

Concentric lines following the outer contour; **closed shapes only**; best for
designs with substantial empty space, poor on complex shapes. Controls: Line
Interval, Lines Per Inch, Number of Passes, Z Offset, Z Step per Pass, Fill
Grouping; Advanced adds Override PWM Frequency / Enable PPI / U Offset.
**Documented caveat:** "Offset Fill is very computationally expensive, and the more
complex the design, or the smaller the [Line Interval]… the more potential there is
for the computation to cause LightBurn to hang." Source: [4-6]

### 4.8 Image mode

Works like Fill but resamples the bitmap. Relationship **DPI = 25.4 / Line Interval**.
Core/Common: Line Interval/DPI, Scan Angle (0–360°), **Angle Increment** (rotation
between passes; non-zero enables multi-directional/crosshatch), Bi-directional
Scanning, Overscanning, **Dot Width Correction** (shortens scan lines to offset beam
thickness; ideal ≈ half beam width; range 0 → Line Interval), Negative Image,
Number of Passes, Z Offset, **Pass-Through** (engrave as-is, no resample), Fill
Grouping.

**Image processing (dither) modes:** Threshold, Ordered, Atkinson, Dither (error
diffusion), Stucki, **Jarvis** ("generally the best choice" for photos), Newsprint,
Halftone, Sketch, Grayscale (varies power Min↔Max; "Not compatible with UV lasers").
Mode-specific: Ramp Length (Threshold only), Cells per Inch + Halftone Angle
(Halftone only). Source: [4-7] (see also §1.4)

### 4.9 Sub-layers (Multi)

Assign multiple cut settings to the same layer/geometry (e.g. etch + cleanup). Up to
**11 sub-layers**, shown as tabs, each fully independent, output left-to-right; a
layer with sub-layers shows mode **"Multi"**. Add via plus icon (inherits parent
settings); per-sub-layer Output toggle. Source: [4-8]

### 4.10 Sources (Section 4)

| # | Page | URL | Confidence |
|---|---|---|---|
| 4-1 | Cuts / Layers Window | …/latest/Reference/CutsLayersWindow/ | high |
| 4-2 | Cut Settings Editor (overview) | …/latest/Reference/CutSettingsEditor/ | high |
| 4-3 | Main / Shared Settings | …/latest/Reference/CutSettingsEditor/SharedSettings/ | high |
| 4-4 | Line Mode | …/latest/Reference/CutSettingsEditor/LineMode/ | high |
| 4-5 | Fill Mode | …/latest/Reference/CutSettingsEditor/FillMode/ | high |
| 4-6 | Offset Fill Mode | …/latest/Reference/CutSettingsEditor/OffsetFillMode/ | high |
| 4-7 | Image Mode | …/latest/Reference/CutSettingsEditor/ImageMode/ | high |
| 4-8 | Sub-Layers | …/latest/Reference/CutSettingsEditor/SubLayers/ | high |
| 4-9 | Colors and Layers (Get Started) | …/latest/GetStarted/ColorsAndLayers/ | high |
| 4-10 | Color Palette | …/latest/Reference/UI/ColorPalette/ | high |

### 4.11 Not yet verified (Section 4)

- **Numeric defaults/ranges** for most parameters — docs describe function, rarely state a default; all "—" cells are undocumented.
- **Bi-directional / Cross-Hatch / Overscanning default states** in Fill — **UNVERIFIED**.
- **Galvo-specific settings** (Frequency, Q-Pulse, MOPA/UV) — not fetched in full.
- **Whether "Sort Cuts Last" / cut-order** live in Cuts/Layers vs the separate Optimization Settings dialog (§5) — not cross-confirmed.

---

## Section 5 — Laser Window & Job Control

### 5.1 Laser window

Main job-control panel for running, framing, saving, and positioning a job.

| Control | Function | Notes |
|---|---|---|
| Device / Serial port dropdowns | Select active laser + port; right-click **Devices** to refresh | — |
| **Start** | Begins running the project immediately | Galvo shows Framing window first unless disabled |
| **Pause** / **Stop** | Halt-resume / abort a running job | — |
| **Send** | Transfers the job to the laser as a named file (DSP only) | Shift+Click runs immediately after transfer |
| **Frame** (Bounding-Box) | Traces the smallest rectangle containing all graphics | — |
| **Frame** (Rubber-Band) | Traces a minimal "rubber band" path for irregular shapes | — |
| Frame Continuously | Repeats framing until stopped | enabled in Device Settings |
| Laser on When Framing | Fires laser during framing at Move-window power | Shift+Frame enables temporarily |
| **Home** | GCode: homing cycle to limit switches; DSP: head to machine origin | needs homing switches |
| **Go to Origin** | Jogs to the position set as **User Origin** | — |
| **Save GCode** / Save RD/OUT/UD5 | Exports machine-specific format (label varies by controller) | — |
| **Run GCode** / Run Machine Files | Loads & executes a previously saved file | needs a connection |
| **Start From** dropdown | Job-placement reference: Absolute / Current Position / User Origin | see §5.5 |
| Job Origin 9-dot selector | Which bounding-box point is the origin | grayed out under Absolute |
| **Cut Selected Graphics** | Sends only the selected portion | — |
| **Use Selection Origin** | Origin relative to selected graphics only | with Cut Selected on |
| Show Last Position | Crosshair at head's last reported location (non-live) | — |
| **Optimization Settings** | Opens cut-order/pathing window | see §5.6 |
| Enable Rotary / Cylinder Correction / Red Light | Mode toggles (rotary; Galvo cylinder; Galvo red dot) | — |

Status indicators: **Disconnected, Ready, Busy** (progress/time), **Framing**
(Galvo). Source: [5-1]

### 5.2 Move window

Jogging, positioning, homing, origin management. Directional arrow buttons jog by
the **Distance** value at the **Speed** rate (incl. Z dashed arrows and A-axis
rotation). **Continuous Jog** holds to move until released (GCode w/ GRBL 1.1f+ may
need "$J Jogging" enabled — $J doesn't affect parser state, ignores out-of-bounds
under soft limits, and is cancelable). **Get Position** queries X/Y/Z/U; **Move to
Position / Go** moves to entered X,Y; Saved Positions dropdown + Manage. **Set
Origin** / **Clear Origin** create/reset the User Origin (GCode); **Set Finish
Position**; Focus Z; **Fire** + Power (never on CO2 per docs); Adjust Speed/Power
modifiers appear while a GCode job streams. Ruida hides Set/Clear Origin & Set
Finish (controller-handled); Galvo hides the Move window by default. Source: [5-3]

### 5.3 Console window

Displays controller messages and lets you type commands directly — **GCode lasers
only** (not Ruida/TopWisdom/Trocen/EZCAD/BSL). Upper-right, docked behind Cuts/
Layers by default. Show All toggles whether jog/fire comms appear. Macro buttons
store frequent commands (managed via the Macros window, LightBurn 2.0+). Documented
GRBL commands: `$I` (firmware), `$$` (settings), `$#` (offsets), `?` (status+pos),
`$X` (unlock alarm), `$[n]=[v]` (e.g. `$110=6000`), `RST=#/$/*` (reset). Source: [5-4]

### 5.4 Devices window

Open via the **Devices** button. **Find My Laser** runs the discovery wizard (USB
auto-detect); **Create Manually** runs the New Device Wizard (with a **No Machine**
option); **Import/Export** profiles (`.lbzip`/`.lbdev`/`.lbvendor`); right-click
**Duplicate**. Job-control setup params: work-area width/height, origin/home corner,
driver selection (GRBL vs GRBL-M3). Source: [5-5]

### 5.5 Start From modes (job placement)

| Mode | Behaviour | Notes |
|---|---|---|
| **Absolute Coords** | Output goes to the design's workspace position relative to the machine's fixed origin | needs homing; 9-dot grayed out |
| **Current Position** | Placed relative to where the head sits at Start, adjusted by Job Origin | — |
| **User Origin** | Like Current Position but uses a pre-set point (jog + Set Origin, or Ruida Origin button) | — |

The **9-dot Job Origin** selector sets which bounding-box point is the origin (active
only for Current Position / User Origin). **Machine Origin** = fixed 0,0; **Job
Origin** (green) = where output begins. Galvo always uses Absolute Coords.

**GRBL job-control settings** (GRBL Configuration guide): machine origin usually
front-left or rear-right (identify via homing then `G0 X0 Y0`); set work-area to per-
axis travel; enable **CNC Machine** for negative-coordinate workspaces; LightBurn
works best with **G54 offset at 0,0,0** (`G10 L2 P1 X0 Y0`). Driver: GRBL 1.1f+ →
"GRBL" (M4 variable power); 1.1e or earlier → "GRBL-M3" (M3). Cited `$` settings:
`$30` (S-value max; match LightBurn's S-Value Max, default 1000), `$32=1` (laser
mode), `$13=0` (mm reporting), `$10=0` (for G92 manual homing/workspace offsets).
Source: [5-2, 5-6]

### 5.6 Optimization Settings (cut planner)

Controls cut order and pathing. Options: **Order by Layer / Group / Priority**
(Priority from Shape Properties, 0 first), Remove (drop an "Order by" rule), **Cut
inner shapes first** (outer must be closed), **Cut in direction order**, **Reduce
travel moves**, **Reduce direction changes**, **Hide backlash**, **Choose best
starting point**, **Choose corners if possible**, **Choose best direction**,
**Remove Overlapping Lines** (distance-thresholded). Source: [5-7]. *Defaults and a
"Flood Fill" optimization option appeared in search summaries but were not confirmed
on a direct page read — see Not yet verified.*

### 5.7 Sources (Section 5)

| # | Page | URL | Confidence |
|---|---|---|---|
| 5-1 | Laser Window | …/latest/Reference/LaserWindow/ | high |
| 5-2 | Coordinates and Job Origin | …/latest/Reference/CoordinatesOrigin/ | high |
| 5-3 | Move Window | …/latest/Reference/MoveWindow/ | high |
| 5-4 | Console Window | …/latest/Reference/ConsoleWindow/ | high |
| 5-5 | Devices | …/latest/Reference/Devices/ | high |
| 5-6 | GRBL Configuration (Guide) | …/latest/Guides/GRBLConfiguration/ | high |
| 5-7 | Optimization Settings | …/latest/Reference/OptimizationSettings/ | high |
| 5-8 | Macros Window | …/2.1/Reference/MacrosWindow/ | med (version-pinned) |

### 5.8 Not yet verified (Section 5)

- **Flood Fill as an Optimization Setting** — in search summaries but not on a direct OptimizationSettings fetch; location/version **UNVERIFIED**.
- **Optimization defaults** (Order by Layer→Priority; Cut inner first; Reduce travel) — from a search summary, not a clean page read.
- **Distinct "rotary frame" framing mode** in the Laser window — **UNVERIFIED** (separate from the Enable Rotary toggle).
- **Exact label** "Optimization Settings" vs colloquial "Optimize Settings" — function confirmed, exact string not pinned.
- **Macros window** full control list — only macro-button existence confirmed; details from a version-pinned URL.

---

## Section 6 — Editing, Arrange, Transform & Node Tools

> Notation "Win | Mac" for shortcuts; "—" where the docs state no default.

### 6.1 Selection

Select tool (Esc); click empty area clears. **Drag right** → red **enclosing**
(window) box, selects only fully-contained objects; **drag left** → green
**crossing** box, selects contained *or* crossed objects. `Shift` adds, `Ctrl/Cmd`
toggles, `Ctrl/Cmd+Shift` removes; `Tab`/`Tab+Shift` cycle overlapping objects.
Select All (Ctrl/Cmd+A); Invert (Ctrl/Cmd+Shift+I). Edit-menu selectors: Open Shapes,
Open Shapes Set to Fill, Contained Shapes, Shapes Smaller Than Selected, Circles (by
size/range). Ungrouped selection shows animated dash; grouped shows dot-dot-dash.
Source: [6-2]

### 6.2 Transform controls (handles)

| Control | Function | Shortcut/Note |
|---|---|---|
| Move (center square) | Drag to reposition; Esc cancels mid-drag | Shift = 90/45° lock; Alt = guides; Ctrl/Cmd = no snap |
| Move via arrow keys | Nudge: 5 mm default; 1 mm (Ctrl/Cmd); 20 mm (Shift); 0.1 mm (Ctrl/Cmd+Shift) | set in Settings → Units and Grids |
| Size — corner handle | Rescale both dims, **keeping** aspect | — |
| Size — midpoint handle | Rescale one dimension | — |
| Size — Shift+corner | Rescale both, **not** keeping aspect | Shift |
| Size — Ctrl+handle | Rescale symmetrically from center | Ctrl |
| Rotate handle | Drag to rotate around center | Shift = 15°; Ctrl/Cmd = 5° |
| Rotate hotkeys | 90° `.`/`,`; 45° Shift+.; 15° Ctrl+.; 1.5° Ctrl+Shift+. | — |
| Shear (skew) handles | Squares beside corners; drag to skew | — |
| Two-Point Rotate / Scale | Rotate/scale from a custom pivot | — |

**Transform Control Toggles** (bottom-left): Move, Size, Rotate, Shear — all on by
default, off in Beginner Mode. Source: [6-1]

### 6.3 Numeric Edits toolbar

X/Y position (relative to a 9-dot anchor), Width/Height (accept % for relative
resize), aspect-ratio lock, Rotate field (accepts negatives), mm/in switch, and
**equation + inline unit** support (e.g. enter `5in` in mm mode). Flip/mirror are
**not** here — they live on the Arrangement toolbar. Source: [6-3] *(legacy doc path
— see Not yet verified)*

### 6.4 Flip / mirror

Flip Horizontal (Ctrl/Cmd+Shift+H), Flip Vertical (Ctrl/Cmd+Shift+V), Mirror Across
Line (Ctrl/Cmd+Shift+M). Source: [6-10, 6-16]

### 6.5 Alignment

Aligns selected shapes relative to the **last-selected** item (select two+ first):
Align Left/Right/Top/Bottom (Alt/Option+arrows), Align Centers Vertically/
Horizontally (Alt+PgUp/PgDn), Align Centers, Make Same Width/Height, Move Selection
to Corners/Center (page-relative), Move Selection to Laser Position. Source: [6-10, 6-16]

### 6.6 Distribute / Move Together

Distribute V/H by edges (Spaced) or centers (Centered); **Move H/V Together**
(Alt/Option+Shift+H / +V) distributes with edges abutting, anchored to the
last-selected object. Distribute ensures even distances, not necessarily positive
gaps (overlapping input stays overlapping). Source: [6-9]

### 6.7 Grid Array

X Columns / Y Rows (or Total Width/Height → computed counts); spacing mode "Center
to Center" or "Padding Between Edges"; X/Y Spacing; X Column / Y Row Shift; Shift by
Half; Reverse Direction; Mirror Alternate Columns/Rows; Random Orientation (+seed);
Auto-Increment Variable Text; **Create Virtual Array** (synced clones, dashed
outline, not individually selectable); Group/Select Results; Total Size & Count
read-out. Source: [6-8]

### 6.8 Circular Array

Copies; Center X/Y (or use last-selected object's position); Start/End (partial
arc); Step (angle between copies); Rotate Object Copies (face center vs keep
orientation); Auto-Increment Variable Text; Group/Select Results. Source: [6-7]

### 6.9 Boolean / path operations

| Tool | Function | Shortcut |
|---|---|---|
| Boolean Union | Merge two shapes into one | Alt/Option++ |
| Boolean Subtract | Subtract second-selected from first (second deleted) | Alt/Option+- |
| Boolean Intersection | New shape from overlap only | Alt/Option+* |
| Weld | Like Union but any number of inputs; outline of all selected | Ctrl/Cmd+W |
| Boolean Assistant | Preview dialog; default in Beginner Mode | Ctrl/Cmd+B |

Booleans require **closed vectors** and **exactly two inputs**; images disable them.
Weld accepts any number. Group (Ctrl/Cmd+G) / Ungroup (Ctrl/Cmd+U); Auto-Group
(contained shapes); Auto Join (touching lines → continuous path); Close Path; Close
Selected Paths With Tolerance (slider + "Move Ends Together" / "Join with Line",
reports found/closed/remaining). Edit Nodes / Trim / Convert to Path don't work on
groups. Source: [6-5, 6-11, 6-13]

### 6.10 Offset Shapes

Offset Distance; Direction Outward / Inward (closed only) / Both; Corner Style
Round/Bevel/Corner; Outer shapes only; Select resulting objects; Delete original;
Optimize/Simplify results; Ctrl/Cmd-click the Offset button to repeat with last
settings. Live preview. Source: [6-6]

### 6.11 Node editing (Edit Nodes)

Enable via Creation Toolbar or Ctrl/Cmd+` ; ungrouped vector paths only (convert
text/shapes/barcodes to paths first). Documented actions: Delete node, Insert node,
Insert at midpoint, Smooth↔corner, Break shape, Delete line, Curve↔line, Trim line,
Extend line, Align selected. Mouse: drag nodes/handles/curves; drag a straight line
to auto-convert to curve; drag disconnected nodes together to auto-join; Shift+click
multi-selects; Shift+drag constrains to 90/45°. Source: [6-4] *(per-key shortcut
bindings ambiguous in the fetched table — see Not yet verified)*

### 6.12 Convert to Path

Turns Primary Shapes, Text, and Bar Codes into editable node paths (Ctrl/Cmd+Shift+C;
also Edit menu / right-click). Grouped objects can't be converted (ungroup first).
Permanent; loses W/H editability, corner radius, polygon side count, text
formatting/variable text, barcode content. No "Convert to Cut" is documented.
Source: [6-12]

### 6.13 Shape Properties window

Enable via **Window → Shape Properties** (off by default; docks behind Cuts/Layers).

| Property | Applies to | Function |
|---|---|---|
| Cut Order Priority | all | lower cuts first |
| Power Scale | all | scales output as % between min/max power |
| Locked | all | prevents modification |
| Gamma / Contrast / Brightness | images | tone adjustments |
| Enhance / Radius / Amount / Denoise | images | edge sharpening + noise reduction |
| Width / Height | ellipses, polygons, rectangles | dimensions |
| Sides | polygons | number of sides |
| Corner Radius | rectangles | positive = curved; negative = bite; survives resize |
| Max Width / Squeeze / Ignore Empty Vars | text | scaling/compression/empty-var handling |

An interactive corner-radius handle (Ctrl/Cmd + drag a blue control on a selected
Rectangle) is reported from a search excerpt but not on the fetched page — see Not
yet verified. Source: [6-14]

### 6.14 Sources (Section 6)

| # | Page | URL | Confidence |
|---|---|---|---|
| 6-1 | Transform Controls | …/latest/Reference/TransformControls/ | high |
| 6-2 | Selection Tools | …/latest/Reference/Selection/ | high |
| 6-3 | Numeric Edits | …/legacy/UI/NumericEdits | med (legacy) |
| 6-4 | Edit Nodes | …/latest/Reference/EditNodes/ | high (per-key med) |
| 6-5 | Boolean Tools | …/latest/Reference/BooleanTools/ | high |
| 6-6 | Offset Shapes | …/latest/Reference/OffsetShapes/ | high |
| 6-7 | Circular Array | …/latest/Reference/CircularArray/ | high |
| 6-8 | Grid Array | …/latest/Reference/GridArray/ | high |
| 6-9 | Distribute and Move Together | …/latest/Reference/Distribute/ | high |
| 6-10 | Arrangement Toolbar | …/UI/ArrangementToolbar.html | high |
| 6-11 | Grouping and Ungrouping | …/latest/Reference/Grouping/ | high |
| 6-12 | Convert to Path | …/latest/Reference/ConvertToPath/ | high |
| 6-13 | Close Selected Paths With Tolerance | …/latest/Reference/CloseSelectedPathsWithTolerance/ | high |
| 6-14 | Shape Properties Window | …/latest/Reference/ShapeProperties/ | high |
| 6-15 | Radius/Fillet | …/latest/Reference/RadiusFillet/ | med (search excerpt) |
| 6-16 | Hotkeys | …/Hotkeys.html | high |

### 6.15 Not yet verified (Section 6)

- **Numeric Edits** from the **legacy** doc path; current-version equivalent unconfirmed.
- **Edit Nodes per-key shortcuts** — fetched table showed duplicate single keys; bindings **UNVERIFIED**.
- **Shape Properties interactive corner-radius handle** — from a search excerpt, not the fetched page.
- **Grid/Circular Array shortcuts & defaults** — none stated (menu/toolbar only).
- **"Convert to Cut"** — not found; treat as non-existent unless found elsewhere.
- **Auto-arrange / Nest** — not located in the pages reviewed.

---

## Section 7 — Image Sub-Tools & Material Library

### 7.1 Interval Test

Finds the optimal **Line Interval** for a machine+material+focus combo. Generates a
row of sample squares, each at a different interval (value labeled); read them and
pick where "the scan lines touch without overlapping," then enter that as the Line
Interval. Open via **Laser Tools → Interval Test**. Controls: Speed, Power (tune via
Material Test first), Steps (sample count), Min Interval (suggested start 0.08 mm),
Max Interval (suggested start 0.16 mm), Size (per square), Fill type (Simple Fill or
Dithered Image). Source: [7-1]

### 7.2 Dot Width Correction

A Cut-Settings-Editor (Image mode) setting that **compensates for beam thickness by
shortening scan-line length**, refining the pixel→dot mapping so beam overlap doesn't
over-darken. Ideal ≈ **half the beam thickness** (material-dependent); valid range
**0 → Line Interval** ("should always be smaller than your interval setting").
Source: [7-2]. *A calibration recipe (Ordered mode, Bi-dir off, etc.) appeared in
search but was not on the direct page — see Not yet verified.*

### 7.3 Images vs Vectors

**Images** = pixels (`.png/.jpg/.bmp/.gif/.tif`); engraving only; scan side-to-side
varying power/dot; pixelate when enlarged but support gradients + multiple image
modes. **Vectors** = mathematical lines (`.svg/.ai/.dxf/.pdf/.plt`); cut/score/mark/
engrave; trace paths; scale infinitely but flat color only; processed via Line/Fill/
Offset Fill. Guidance: conversions "are often not required, and may reduce quality";
use Trace mainly when scaling small images; use Convert to Bitmap only to repair poor
vectors. Source: [7-3]

### 7.4 Convert to Bitmap

Vector→raster (inverse of Trace). **Edit → Convert to Bitmap**, **Ctrl/Cmd+Shift+B**,
or right-click. Original vector is **deleted** (duplicate first); result lands on the
last selected layer in Image mode. Controls: Render Type (Outlines / Fill All / Use
Cut Settings), DPI (numeric or slider), Default Brightness (pixels start 50% gray,
adjustable via Adjust Image). Source: [7-4]

### 7.5 Apply Mask to Image

Hides parts of an image **without deleting data** (default: hidden parts aren't
output). Needs one raster + one closed vector on a **Tool or Line layer**; select
both → **Tools → Apply Mask to Image** or right-click. Restore: select vector +
Delete, or right-click → "Remove Mask from Image". **Flatten Image Mask** permanently
removes hidden areas + deletes the vector; **Tools → Crop Image** flattens in one
step. Source: [7-5]

### 7.6 Adjust Image

Tune Contrast/Brightness/Gamma/Enhance + Layer Settings with live preview (source
top-left, processed top-right). Invoke: double-click the image, right-click → Adjust
Image, or **Alt/Option+I**. Layer Settings "correspond to those found in the Cut
Settings Editor." Two built-in presets (Basic; Black Paint on White) + saveable User
Presets.

| Control | Function | Default |
|---|---|---|
| Brightness | Raises/lowers overall brightness | — |
| Contrast | Higher = lights lighter, darks darker | — |
| Gamma | Adjusts mid-tones (lower lightens, higher darkens) | 1.0 |
| Enhance | Edge contrast (unsharp / high-pass) | — |
| Enhance Radius | How far the effect spreads from edges | — |
| Enhance Amount | Intensity of edge contrast | — |
| Enhance Denoise | Reduces noise in smooth areas | — |

Source: [7-6, 7-7]. *Interaction with the dither/image mode not documented — see Not yet verified.*

### 7.7 Material Library window

Stores/reuses preset cut settings per material. Open via the **Library** tab or
**Window → Library**. Create from a configured layer → "Create new from layer" →
metadata (Material Name folder, Thickness or "No Thickness" + Title, Description).
Device-associated; stored as **`.clb`** files. Manage Library submenu: Load / Save /
Save As / Create New / Merge; Select Library dropdown; Rename / Unload. **Assign**
copies settings to the active layer (stays **independent**); **Link** syncs the layer
to the entry (Cut Settings Editor becomes **read-only**, library updates auto-apply).
Edit Cut / Update / Edit Description / Duplicate / Delete per preset. Source: [7-8]

### 7.8 Material Test generator

Parametric speed/power grid. **Laser Tools → Material Test**; default **10×10** grid
varying **Power (cols) × Speed (rows)**; rows/cols labeled, header shows shared
settings (Interval/Passes/Frequency). Execution ascends by burn risk (highest speed,
lowest power/interval/passes first). Four built-in presets (Diode/CO2); custom
presets saveable. Controls: Count per axis (10×10), Param per axis (Power/Speed/
Interval/Passes; +Frequency/Q-Pulse if supported), Min/Max per axis, Height/Width,
X/Y Center (Absolute Coords), Edit Material/Text/Border Setting, Enable Text, Enable
Border (1.5+). Source: [7-9]

### 7.9 Sources (Section 7)

| # | Page | URL | Confidence |
|---|---|---|---|
| 7-1 | Interval Test | …/latest/Reference/IntervalTest/ | high |
| 7-2 | Image Mode / Dot Width Correction | …/latest/Reference/CutSettingsEditor/ImageMode/ | high |
| 7-3 | Images vs Vectors | …/latest/Explainers/ImagesVsVectors/ | high |
| 7-4 | Convert to Bitmap | …/latest/Reference/ConvertToBitmap/ | high |
| 7-5 | Apply Mask to Image | …/latest/Reference/ApplyMaskToImage/ | high |
| 7-6 | Adjust Image | …/latest/Reference/AdjustImage/ | high |
| 7-7 | Shape Properties — Image controls | …/latest/Reference/ShapeProperties/ | high |
| 7-8 | Material Library | …/2.1/Reference/MaterialLibrary/ | high (version-pinned) |
| 7-9 | Material Test | …/latest/Reference/MaterialTest/ | high |

### 7.10 Not yet verified (Section 7)

- **Dot Width Correction calibration procedure** — in a search summary, not on the direct ImageMode page.
- **Adjust Image value ranges/defaults** (only Gamma 1.0 stated) and its **interaction with dither mode** — **UNVERIFIED**.
- **Interval Test** defaults (Speed/Power/Steps/Size) and **Convert to Bitmap** default Render Type/DPI — **UNVERIFIED**.
- **Material Test** per-axis Min/Max defaults, box H/W, Enable Text/Border default states — **UNVERIFIED**.
- **Material Library** confirmed from the `2.1` path (not `latest`).

---

## Section 8 — LaserForge ↔ LightBurn mapping (gap / divergence ledger)

> **Rule (ADR-027).** LightBurn (§§1–7 above) is the source of truth.
> - **HAVE** = matches LightBurn closely enough to need no action.
> - **GAP** = LightBurn has it, we haven't built it. Governed by `PROJECT.md` scope/phase — *not necessarily a defect*.
> - **DIVERGE** = we built it but it behaves differently from LightBurn → a **defect to redesign toward LightBurn**, unless an ADR records it as a deliberate exception (ADR-027 §4).
>
> **Verification legend.** ✓ = source file read directly this session (claim checked against the current tree). ◦ = reported by the inventory sweep, **not** re-read this pass — re-confirm by direct read before opening a redesign PR (CLAUDE.md "no invention").
>
> **This is a documentation pass only — no code changed here.** Each DIVERGE redesign is its own tight-leash PR (ADR-027 §5, CLAUDE.md rule #1).

### 8.1 Application shell — menus & toolbars (vs §3)

- **HAVE** ✓ A single flat top toolbar: File actions + Text / Import Image / Trace Image / Save G-code, a build badge, and a shortcut-hint chip (`src/ui/common/Toolbar.tsx`). Keyboard shortcuts exist (`src/ui/app/shortcuts.ts`, mirrored in `Toolbar.tsx` `SHORTCUT_HINT`). ◦ cursor-anchored zoom + middle/right-drag pan (commit `46580392`).
- **GAP** No menu bar — none of LightBurn's File / Edit / Tools / Arrange / Laser Tools / Window / Help menus (§3.1). No Main / Arrange / Creation toolbars (§3.9–3.11). No right-click context menu. No creation/tool palette. No dockable windows.
- **DIVERGE** ✓ Top-level actions are a flat row of toolbar buttons rather than LightBurn's menu-bar + grouped-toolbar structure (`Toolbar.tsx`). → **redesign:** introduce a LightBurn-style menu bar (File/Edit/Tools/Arrange/Laser Tools/Window/Help) and grouped toolbars; relocate Import Image / Trace under Tools / Laser Tools to match §3.1–3.11.

### 8.2 Cuts / Layers window & Cut Settings Editor (vs §4)

- **HAVE** ✓ Color-keyed layers (`src/core/scene/layer.ts`; `scene-object.ts` `ColoredPath.color`); per-layer power / speed / passes / visible / output; Line / Fill / Image modes; fill hatch angle + spacing; image dither + lines-per-mm (`src/ui/layers/LayerRow.tsx`). Matches LightBurn's color-as-layer core (§4.1).
- **GAP** No Offset Fill mode (§4.7). No sub-layers / Multi (§4.9). No tool layers (T1/T2). No Min Power (§4.4). No Z offset/step, kerf, lead-in/out, overcut, perforation, tabs, bi-directional, cross-hatch, scan-angle, dot-width — the whole Cut Settings Editor Advanced surface (§4.3–4.8).
- **DIVERGE**
  - ✓ **3 layer modes, not 4** — `LayerMode = 'line'|'fill'|'image'` (`layer.ts`); LightBurn adds Offset Fill (§4.7). → **redesign:** add `'offset-fill'`.
  - ✓ **Single `power`, not Min+Max** — `layer.ts` `power: number`; `grbl-strategy.ts scaleS` uses the one value. LightBurn has Min Power + Max Power (§4.4). → **redesign:** add `minPower`; M4 dynamic mode ramps min→max.
  - ✓ **Inline card editor, not a Cut Settings Editor** — `LayerRow.tsx` renders each layer as a vertical card with fields inline; LightBurn double-clicks a layer to open a modal editor with **Common / Advanced** tabs (§4.3). → **redesign:** double-click opens a Cut Settings Editor dialog with the two tabs.
  - ✓ **Hatch angle clamped 0–180**; LightBurn fill angle is 0–360 (`LayerRow.tsx HatchAngleInput`, §4.6). → **redesign:** widen to 0–360.
  - ✓ **3 dither modes** (`threshold` / `floyd-steinberg` / `grayscale`, `layer.ts`) vs LightBurn's **ten** (Threshold, Ordered, Atkinson, Dither, Stucki, Jarvis, Newsprint, Halftone, Sketch, Grayscale — §1.4, §4.8). → **redesign:** add the missing modes; default photos to **Jarvis** per LightBurn guidance (§1.4).

### 8.3 Laser window & job control (vs §5)

- **HAVE** ◦ Laser window with job controls + jog pad (`src/ui/laser/LaserWindow.tsx`, `JobControls.tsx`, `JogPad.tsx`); GRBL controller with homing / unlock / status-poll / framing (`src/core/controllers/grbl/`). ✓ M3 constant-power for cuts (`grbl-strategy.ts` preamble `M3 S0`); M4 dynamic for raster (delegated to `emit-raster.ts`). ◦ transient G92 set-origin (`src/ui/state/origin-actions.ts`; ADR-021).
- **GAP** No separate **Move** and **Console** windows (§5.2, §5.3). No Console command input. No **Devices** manager — one device per project, no add/edit/remove modal (§5.4). No GRBL vs GRBL-M3 device-type choice (M3/M4 is hardcoded by group kind).
- **DIVERGE**
  - ◦/✓ **Origin is transient G92 only**, vs LightBurn's persistent **Start From** modes (Absolute / Current Position / User Origin) + **9-dot Job Origin** (`origin-actions.ts`; §5.5). → **redesign:** add Start From + 9-dot origin. (ADR-021 began set-origin; ADR-022 is reserved for origin-aware preflight — sequence the redesign there.)
  - ✓ **Path optimization is nearest-neighbor within a layer only** (`optimize-paths.ts`) — no "cut inner first", no cross-layer reorder, no 2-opt; LightBurn exposes Optimization Settings (order inner-first / by layer / by group, reduce travel, etc.; §5.6). → **redesign:** add an Optimization Settings surface + cut-inner-first ordering.

### 8.4 Editing, arrange, transform, nodes (vs §6)

- **HAVE** ◦ Select (single / multi / shift), move / scale / rotate, flip H & V via keyboard (`src/ui/workspace/`); ✓ per-object `Transform` (x, y, scaleX, scaleY, rotationDeg, mirrorX, mirrorY) on every SceneObject (`scene-object.ts`).
- **GAP** No numeric transform entry / Numeric Edits toolbar (§6.3). No align (§6.5) or distribute (§6.6). No Grid (§6.7) or Circular (§6.8) **Array**. No **boolean / weld** (§6.9). No **offset** path (§6.10). No group / ungroup. No **node editing** (§6.11). No Convert to Path (§6.12). No shape-drawing/creation tools (only SVG import + Text). No **Shape Properties** window (§6.13).
- **DIVERGE** ◦ Selection is click-only; LightBurn distinguishes **window** (fully enclosed) vs **crossing** (touched) drag-select (§6.1). → **redesign:** implement window-vs-crossing drag selection. *(The rest of this area is GAP, not DIVERGE — redesign priority follows whatever `PROJECT.md` schedules; behavior must then match §6.)*

### 8.5 Image sub-tools, trace & Material Library (vs §7)

- **HAVE** ◦ imagetracerjs trace with pre-trace dither + Adjust Image (brightness / contrast / gamma / invert) and presets (`src/core/trace/`, `src/ui/trace/`). ✓ raster engrave with dither + lines-per-mm via per-pixel S modulation (`emit-raster.ts`, reached through `grbl-strategy.ts`). ✓ trace-keeps-source overlay (ADR-026).
- **GAP** No Interval Test (§7.1) or **Material Test** generator (§7.8). No **Dot Width Correction** (§7.2). No **Convert to Bitmap** (§7.4 — designed in ADR-029; parked in PROJECT.md Future feature notes). No **Apply Mask to Image** (§7.5). No **Material Library** / `.clb` (§7.7). No per-object Shape-Properties image controls (§7.6).
- **DIVERGE** (the headline structural one)
  - ✓ **Two image *object kinds* (the import split is now resolved).** `Toolbar.tsx` has a single **Import Image** (`ImportImageButton` → `RasterImage`) action; **Trace** (`TraceImageButton`) runs as a tool on the *already-selected* bitmap and overlays a `TracedImage` on it — the LightBurn model (one import; trace is a downstream operation), per ADR-027's image-flow unification. **Still divergent:** the scene union carries **two** image variants, `RasterImage` *and* `TracedImage` (`scene-object.ts` `SceneObject`), where LightBurn has one image object (trace output is plain vectors). → **redesign (remaining):** eliminate the `TracedImage` kind so trace output is an ordinary vector object, with a `.lf2` 1→2 schema migration (bump `PROJECT_SCHEMA_VERSION`). (§7.3; smell first flagged §1.5.)
  - ✓ **Grey default raster-layer color** `DEFAULT_RASTER_LAYER_COLOR = '#808080'` (`scene-object.ts:167`); the code comment itself notes "LightBurn uses black, but black collides with line-art SVG imports." → **redesign or ADR-justify:** match LightBurn (black) or record the deliberate divergence per ADR-027 §4. Currently undocumented → defect.
  - **Trace control vocabulary.** Our dialog uses imagetracerjs `numberOfColors` + Otsu/median/despeckle presets and in-dialog brightness/contrast/gamma/invert, vs LightBurn's Cutoff/Threshold brightness band + Ignore Less Than / Smoothness / Optimize / Sketch Trace / Trace Transparency (image adjustment is a *separate* Adjust Image dialog). → **redesign:** adopt LightBurn's control model — designed in **ADR-030**; separable from #1 (the output-kind merge). (§1.3 mapping note.)

### 8.6 Divergence backlog (redesign-to-match; sequence in PROJECT.md phase order)

1. Eliminate the second image object kind — trace output becomes a plain vector object, not a `TracedImage` (§8.5); needs a `.lf2` 1→2 schema migration. (The two *import paths* are already unified into one Import Image action; this kind merge is the remaining structural half.)
2. Cut Settings Editor modal with Common / Advanced tabs, replacing the inline card (§8.2).
3. Min Power + Max Power on layers (§8.2) — needed for honest M4 dynamic-power parity.
4. Fourth layer mode: Offset Fill (§8.2).
5. Full dither set with Jarvis default (§8.2).
6. Start From modes + 9-dot Job Origin (§8.3) — pairs with ADR-022.
7. Optimization Settings + cut-inner-first (§8.3).
8. Menu bar + grouped toolbars (§8.1).
9. Window-vs-crossing selection (§8.4).
10. Resolve the grey raster-layer-color divergence (§8.5) — fix or ADR-justify.
11. Trace control realignment to LightBurn's Cutoff/Threshold band + Ignore Less Than / Smoothness / Optimize / Sketch Trace / Trace Transparency, replacing presets/`numberOfColors` (§8.5; ADR-030). Distinct from #1 (output kind).

*(Order is rough structural impact, not a schedule. Actual sequencing is governed by `PROJECT.md` phases; behavior parity with LightBurn is governed by ADR-027.)*

### 8.7 To re-confirm before any redesign PR (◦ items not re-read this pass)

`origin-actions.ts`, `LaserWindow.tsx` / `JobControls.tsx` / `JogPad.tsx`, the `src/core/controllers/grbl/` surface, the `src/ui/workspace/` selection model, the absence of align/distribute/array/boolean/weld/offset/node-editing, and the `src/core/trace/` + `src/ui/trace/` preset specifics were reported by the inventory sweep but **not** read directly this session. Re-read each before acting on its line (CLAUDE.md "no invention"). **Directly verified this pass:** `layer.ts`, `scene-object.ts`, `Toolbar.tsx`, `LayerRow.tsx`, `grbl-strategy.ts`, `optimize-paths.ts`.

---

*End of Section 8. This closes the LaserForge-mapping pass: LightBurn reference (§§1–7) + LaserForge gap/divergence ledger (§8), with ADR-027 recording LightBurn as the binding source of truth. Next step is the maintainer's call on which §8.6 backlog item to redesign first — each as its own tight-leash PR.*
