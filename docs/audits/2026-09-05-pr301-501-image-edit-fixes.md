# Image Studio corrections from the PR301-501 audit

Base: `7709bc9952cb807c8b1385c6c86b668916014e68`, including the image persistence and Apply repairs in PR729.

The accepted findings are F01-F06 from the PR301-350 ledger, F351-01 (Paint Bucket selection), F353-01 (Clone Stamp source), and F354-01 (rough ETA scale).

| Finding | Corrected behavior | Acceptance |
| --- | --- | --- |
| F01 | Paint, selected Fill, Gradient and Clone use straight-alpha source-over. Eraser removes upper-layer alpha and keeps PR729's selected Background color behavior. A sole transparent layer still composites over white. | Transparent and partial-alpha pixels, feathered masks, upper Eraser, Background color, scoped undo/redo, single-layer composite/cache. |
| F02 | Merge Down preserves normal-layer RGBA without depending on lower artwork. Layer opacity is baked once. Non-normal blend effects are baked against the current backdrop into a normal merged layer with union alpha. Lower identity remains. | Transparent lower layer, non-unit opacity, hidden layers, all supported blend modes, multiple backdrops and a rare quantization fixture. |
| F03 | A rectangle marquee wholly outside the document yields an empty mask. | Off-image rectangles on all four edges cannot select unrelated pixels. Existing pixel-center selection tests pass. |
| F04 | Crop computes the document intersection before copying pixels. A wholly off-image crop is a no-op. | Partial-left source pixels and physical bounds, no-overlap identity/history, all current crop tests. |
| F05 | Physical pixel scale stays independent of rounded Revert-base dimensions. Resized crops retain their position and extent. Apply explicitly sends original bounds after Revert. | Repeated nonintegral and anisotropic resize, Canvas Size then Crop, actual scene Apply, transformed source, Apply-Revert-Apply, project undo. |
| F06 | Each shrinking axis uses full-domain area coverage; enlarging axes use pixel-center interpolation. Filtering stays premultiplied until final RGBA8 output. Temporary pixel storage uses two reusable rows. | Odd trailing row/column, one-axis shrink, transparent edges, existing resampling tests. |
| F351-01 | Bucket intersects its flood region with the active selection before history capture and paint. | Feathered clip, excluded region no-op, exact dirty bounds and undo. |
| F353-01 | Clone snapshots the composite only when it shares the destination storage, so overlapping dabs cannot sample their own output. | Overlapping single-layer clone, existing multilayer/aligned-offset tests, selected/partial-alpha paint and undo. |
| F354-01 | Rough engrave time uses continuous physical pixel scale and absolute object X/Y scale. | Full-black 10x10 mm at 60 mm/min and 1 line/mm: 100 s at unit scale, 600 s at 2x3 scale; reflected scale and resized crop preserve the estimate. |

Normal merging collapses two independently rounded layer operations into one RGBA8 pixel. In a deterministic 2,000,000-case sample the observed maximum display difference was two channel bytes for normal merges, and one for non-normal baked merges. This is an observed sample result, not a proven universal error bound. The former large darkening is eliminated; one rare two-byte case is retained as a regression.

Local Node measurements on this machine found the opaque-layer scan averaged about 3 ms at 4 MP and 18 ms at 20 MP. The canvas hook test confirms unchanged session/revision renders reuse the memo rather than scanning again. Resize to 1000x800 measured approximately 101 ms from 4 MP and 329 ms from 20 MP, versus 67/198 ms for the previous incomplete sampler. No browser or machine qualification is inferred from these timings.

Verification evidence is kept outside the source checkout in the task audit directory: reproduction logs, targeted and current image-suite results, independent merge differential data and performance measurements. No hardware was operated and no manual deployment was performed.
