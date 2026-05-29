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
- [x] **Section 2 — End-to-end image-engrave workflow** (LightBurn's recommended 5-step path + Adjust Image) — *this review*
- [ ] Section 3 — (next candidates: Interval Test internals, Dot Width Correction, Images-vs-Vectors, Convert to Bitmap, Apply Mask)

Planned-but-unscoped later sections (full app audit the user requested): main
menus, toolbars (top/left/creation), Cuts/Layers window, Cut Settings editor,
Laser window + job control, Move/Console/Shape-properties windows, alignment &
array tools, node editing, library/material settings. These are **not** written
yet and are listed only so the scope isn't lost.

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

*End of Section 2. Awaiting review before Section 3.*
