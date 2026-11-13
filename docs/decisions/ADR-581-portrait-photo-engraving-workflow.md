## ADR-581 - A dedicated photo engraving workflow uses the existing raster output

Date: 2026-10-11
Status: Accepted

### Context and research

The maintainer requested realistic human portrait engraving after seeing examples
made with LightBurn. The example itself was not supplied. The likely technique is
photographic raster engraving, where the density of small laser marks represents
skin, hair, highlights and shadows.

LightBurn documents these as separate workflows:

- [Image Mode](https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/)
  offers Jarvis and Stucki dithering for photographic shades. Grayscale instead
  modulates power, requiring a suitable machine and material response.
- [Adjust Image](https://docs.lightburnsoftware.com/latest/Reference/AdjustImage/)
  compares the original and processed image, with tone and output controls.
- [Trace Image](https://docs.lightburnsoftware.com/latest/Reference/TraceImage/)
  converts pixels to vector outlines; clear edges are its natural input.
- [Shape Properties](https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/)
  documents gamma, brightness, contrast and unsharp enhancement. Numeric gamma
  conventions differ: KerfDesk's existing raster implementation uses `1/gamma`,
  so increasing gamma lightens midtones. LightBurn recipes must not be copied
  numerically into this different convention.
- [Perfect Image Engraving](https://docs.lightburnsoftware.com/latest/Guides/PerfectImageEngraving/)
  starts with focus, material testing and interval testing. Higher DPI can
  overlap marks and lose tonal detail. Power, speed and DPI are not universal
  portrait recipes.

KerfDesk already has Jarvis, Stucki and other error-diffusion algorithms, shared
image tone processing, burn-grid resampling and raster compilation. Photo shading
trace (ADR-349/390) intentionally produces variable-width filled ribbons. It stays
available as an artistic line treatment.

The older Adjust Image thumbnail dithers after resizing to its display size and
does not show the chosen physical engraving grid. Its Apply path edits a shared
operation. Neither behaviour is suitable for the new selected-photo workflow.

### Decision

1. Add **Photo engraving...** to the selected-image toolbar, Tools → Image and
   workspace More. It opens for one unlocked ordinary raster in laser mode.
   Original trace backing images remain non-output sources. The new dialog is
   loaded on demand.
2. Offer Jarvis, Stucki and Floyd–Steinberg, brightness, contrast, gamma and DPI.
   Use the existing image's tones and effective density on open. Unsupported
   photo modes start with Jarvis. *Amended by ADR-670 Amendment 2: a Grayscale
   photo keeps Grayscale, which the window then also offers.* Keep these continuous controls valid at
   fractional values; HTML step validation must not reject saved or edited
   values within their ranges. No invented speed or power recipe is supplied.
3. Material marking is explicit: dark marks on a light surface or light marks on
   a dark surface. Light marks enable negative output and invert only the
   simulated material display back to light-on-dark. The original photo remains
   unmodified. This photo workflow turns off Pass-through so the selected
   processing actually runs.
4. Preview in a cancellable worker using `compileRasterGroupsForLayer` and
   `compiledRasterPreview`. Compile at the actual physical grid, then average
   compiled dots to a maximum 1000-pixel display. Do not dither a thumbnail.
   Restore machine/scan coordinates to the scene orientation for display.
5. The preview is a **relative mark simulation**: normalize to the photo's
   effective maximum power, including object scaling and controller rounding.
   It represents the first scan's dot distribution, not calibrated material
   colour, beam footprint, dot-width correction, heat, overscan or cumulative
   passes. The normal job Preview remains available for the full job.
6. Budget source, masks, scan plans and display work before allocation. Check
   source dimensions before hydrating paged pixels. New edits cancel the old
   worker. A stale result is never displayed as the current draft. Preview-only
   resource limits do not prevent applying settings or change output policy.
   Bound the raw pass plan for rotary too: the current compiler constructs the
   angled plan before replacing it with the rotary scan direction.
   *Amended by Amendment 1: the source is one read under its own pixel
   ceiling; the working-set budget is the burn grid, masks and display.*
7. Apply as one Undo step: preserve source pixels and placement, and write the
   selected photo's tone fields and scoped operation override. *Amended by
   ADR-711: the override also takes a power and speed picked from a burned
   Photo Test Card, when the operator chooses one.* Preserve sibling
   images, shared operation settings, existing unrelated overrides and
   sub-operations. Bind the dialog to the exact document epoch, source, operation,
   device and external mask. Cancel changes nothing.
   Choose the first bound operation with output enabled and name it in the
   dialog. When all bound operations have output off, prepare the first one and
   disclose its disabled output. Do not change output or visibility flags.
8. Reuse Image Studio for cropping, background cleanup, Levels, Curves and
   Unsharp Mask. No new image algorithm, dependency, project schema or licence
   rule is introduced. Raster image processing retains its existing availability;
   Photo shading tracing retains its existing Pro rule.

### Verification and limits

Regression checks cover actual output-grid dimensions, independent compiled-dot
averages, masks, object overrides, pass-through, streamed grids, resource limits,
worker cancellation, single-step Undo/Redo and project persistence. The existing
public-domain NASA portrait fixture exercises real facial tones through the
browser's import, preview and Apply workflow.

Physical qualification is separate. No material was engraved and no controller
was operated. Frame, Start, power, speed, licences and the output compiler/emitter
are unchanged. This is a local implementation until separately published.

### Amendment 1 — The preview budget is the burn grid, not the phone photo (2026-11-03)

New-user audit U3-P2-3 imported a 12 MP phone JPEG and opened Photo
engraving. Every placed size (360, 100 and 30 mm) showed "~140 MB
materialized working set exceeds the 64 MB budget", and Auto tones stayed
disabled. Apply and the main Preview still worked. Decision 6 charged the
source at 12 bytes a pixel inside the same 64 MB as the scan grids. So any
photo over about 5.6 MP failed, whatever would actually burn. Decision 4
already compiles at the physical grid. Only the budget ignored it.

Measured, the source read was dominated by `decodeRasterLuma`. It built a
cleaned copy of the base64 text one character at a time: about 500 MB of
string rope nodes for a 12 MP photo, in output and the preview alike.

1. `decodeRasterLuma` validates and decodes the base64 text in place,
   through a character table, with no cleaned copy. Its accepted and
   rejected inputs are unchanged. A seeded comparison against the old decoder
   covered 36,000 cases, including malformed ones, and photo raster G-code
   command hashes recorded on main still match
   (`photo-raster-gcode-identity.test.ts`).
2. The source is one read, as the burn reads it: the base64 text, the decoded
   luma and one tone pass, about 5 bytes a pixel. It is bounded on its own by
   `MAX_RASTER_SOURCE_READ_PIXELS` (50 MP, which takes a 48 MP phone photo),
   checked from the dimensions before paged pixels are hydrated. A 12 MP
   preview at 100 mm grew this process's peak memory by about 50 MB.
3. The 64 MB budget covers what is built for the burn: each scan grid at the
   placed size and lines per mm, its dither and orientation buffers, masks
   and the display. A plan whose materialized grids would not fit compiles
   with every grid streamed (`streamedPixelThreshold: 0`, a preview-only
   compile option; output keeps its 4 MP threshold). Streamed rows are
   bit-identical to the materialized grid (ADR-243, ADR-359), so the preview
   still shows the burn's own dots. Photos that fitted before keep their
   existing compile.
4. No thumbnail is dithered. The preview's pixels are the burned raster's:
   at 100 mm each display pixel is one compiled dot, and a streamed 200 mm
   preview equals block averages of the materialized burn.
5. Where even the burn grid is too big, the window says so in plain words:
   "This photo is too big to preview at this size and resolution. Lower the
   resolution or make the photo smaller. You can still apply the settings."
   The worker still reads the photo, so Auto tones keeps its histogram (the
   source photo's, per ADR-685, unchanged). A source over the read ceiling
   asks for a crop or a smaller copy. A preview that hits the 30 s worker
   limit gives the same resolution-or-size advice.
6. Save processed bitmap follows the same rule: the source read under the
   ceiling, the 64 MB budget for the bitmap at the output grid, and plain
   words instead of the MB text. The other users of the 64 MB budget were
   checked and left alone. Convert to bitmap and its packed photo points
   (`bitmap-conversion-resources`, `packed-photo-bitmap`) budget vector
   geometry and the bitmap they make. Stamp preparation first caps its own
   grid at 2 MP. Recovery caps a stored artifact at half the budget. None
   charges a source photo as burn work.

Output, Frame, Start, power and the G-code emitter are unchanged. No
material was engraved and no controller was operated.
