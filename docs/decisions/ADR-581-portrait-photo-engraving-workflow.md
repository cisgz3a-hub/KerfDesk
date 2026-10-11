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
   photo modes start with Jarvis. Keep these continuous controls valid at
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
7. Apply as one Undo step: preserve source pixels and placement, and write the
   selected photo's tone fields and scoped operation override. Preserve sibling
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
