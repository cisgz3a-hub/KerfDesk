## ADR-358 - Composed SVG images retain geometry and ownership (2026-09-24)

**Status:** Accepted for the authorised SVG round-trip follow-up to ADR-350 and ADR-357.
Software evidence does not establish browser rendering, independent-editor interchange or machine qualification.

### Decision

1. SVG parsing returns an ordered artwork fragment alongside its legacy vector aggregate. Normal
   import consumes the fragment through the shared picker/drop route. Text, streamed worker and
   unavailable-worker fallback use the same geometry extractor. Vector-only destinations reject
   embedded images explicitly instead of silently consuming only the aggregate.
2. Embedded PNG, JPEG, BMP and WebP images become real raster objects through the existing bitmap
   preparation pipeline. PNG can use its streamed/paged decoder. SVG local bounds and composed
   transforms determine physical placement; embedded bitmap DPI does not resize the artwork.
   Image translation, rotation, unequal scale and mirroring remain editable. Unrepresentable
   shear, aspect fitting, opacity and SVG filters/masks report an error. Numeric and percentage
   opacity use the same range before this check, including opacity on ancestor groups.
3. One source file receives one common translation, one batch offset and one Undo entry. Its
   authored millimetre size and relative registration survive negative coordinates. Integration
   with ADR-125 Amendment 1 fits artwork larger than the bed as one complete selection, using a
   shared uniform scale and a separate Undo entry. The first Undo restores the complete authored
   size; the next removes the atomic import. No per-object fitting or whole-document rasterisation
   is involved, and clip coordinates stay local to their image.
   Saved operation preferences cannot override authored Line/Fill/Image structure or image density.
   New Fill fragments materialise SVG's implicit subpath closure and default nonzero fill rule in
   both sampled paths and native curves. Stroke fragments retain their authored open paths. The
   legacy vector aggregate and previously saved projects keep their existing geometry and defaults.
   Bounds remain Job Review warnings under the existing Frame-first policy of ADR-228/230/232/237.
4. `RasterImage.imageClip` owns a compound even-odd clip in image-local coordinates. It is not a
   scene object or operation. The supported SVG subset is a userSpaceOnUse clip containing one
   compound even-odd path; nested ancestors intersect. Native curves survive a single clip,
   while intersections use the existing flattened scene-tolerance geometry. Empty clips hide the
   complete image. Display, preview, raster sampling and SVG export intersect the owned clip with
   any independent `imageMaskId`. Unsupported vector clipping, masks and filters reject the file.
   Existing stroke-preferred import of elements with both fill and stroke discloses omitted fills.
5. All bitmap preparation completes before an atomic document-owned store insertion. Failure,
   cancellation or a stale document discards the whole fragment and releases staged image assets.
   A failed store insertion does not advance the batch placement. Resource ownership transfers
   only after successful insertion; Undo/redo retains the committed resources through history.
6. Explicit source re-import replaces the selected component's entire owned fragment. Source
   membership and the initiating document must remain current through asynchronous preparation.
   Unambiguous unchanged source content retains component identities and path-specific operation
   settings even after source reordering. Changed or ambiguous content receives fresh settings,
   rather than borrowing the settings of the old component at the same ordinal position. Paged
   sources whose content identity cannot be proven also receive fresh settings. Existing manual
   artwork run-order positions survive; new components enter at the replaced source's position.
   Legacy single-vector re-import keeps its existing colour-based operation reconciliation.
   Copies detach source replacement ownership; moving array originals preserves it.
7. Project schema 9 protects this output-bearing clip meaning from older readers. Schema 8 and
   earlier projects migrate without geometry changes. Project templates and personal artwork
   retain their existing envelopes, whose embedded project reader rejects too-new schemas.

### Verification boundary

Regression coverage includes actual PNG bytes through the production document and PNG parsers,
source units/transforms, mixed insertion and history, masks with holes, preview pixels and emitted
raster spans, persistence/copy/library/template boundaries, cancellation and rollback. The software
transport substitutes an inline Worker and fake IndexedDB; it does not prove browser Worker delivery
or browser canvas rendering. Independent vector-editor and rendered browser acceptance remain
separate required checks. No new runtime dependency or machine policy gate is introduced.
