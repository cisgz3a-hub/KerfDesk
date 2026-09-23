## ADR-350 - Artwork interchange, vector repair and variable-copy output (2026-09-23)

**Status:** Accepted. Local software implementation; deployment and hardware qualification are separate.

### Context

The LightBurn feature audit confirmed an image Pass-through defect and four priority workflow gaps:
explicit silhouette union, cross-artwork path repair, duplicate laser-line removal, general SVG
export and distinct variable values in a grid. Existing Weld intentionally preserves operation
ownership, so changing its meaning would silently change output settings. ADR-279 described
transient sheet imposition; an editable, saveable Grid array needs a small persistent identity
for each variable copy.

### Decision

1. **Pass-through keeps the original pixel grid and luma.** A shared image preparation helper
   bypasses brightness, contrast, gamma, negative, dithering and density resampling. Placement,
   masks, minimum/maximum power mapping and dot-width correction remain output controls.
   Materialized and streamed output, processed bitmap export and Adjust Image use the same
   contract. Adjust Image also receives the actual maximum power for grey-level preview.
2. **Union silhouette is explicit.** The operator chooses one selected operation for the result.
   The dialog explains that its base settings, including sublayers, replace source artwork
   overrides. Each source's filled region is normalized before union. Existing operation-aware
   Weld retains its partitions. Both laser and CNC artwork can use the geometry tool.
3. **Join paths repairs compatible open contours.** The default maximum gap is 0.05 mm.
   Operation identities, source colour, override intent, fill interpretation and transformed
   stroke metadata must agree. Only mutual, unique endpoint matches join. A gap is bridged
   without moving its endpoints. Ambiguous branches and manually tabbed contours remain
   unchanged; unaffected tab indices are retained. Canonical curves survive transformation,
   and the complete edit is one undo transaction.
4. **Remove overlapping lines is opt-in and defaults off.** Cut Planner removes coincident,
   partially coincident and reversed powered spans at emitted coordinate precision, after
   placement and ordering, within one compiled laser Line settings group. It preserves gaps,
   already-materialized kerf/tabs, deliberate retracing within one contour, separate operations
   and pass counts. Fill, Image and CNC paths are unchanged. Changing the option participates
   in the existing exact-job identity and Frame invalidation.
5. **File exports artwork as standard SVG.** A selection exports selected artwork; no selection
   exports the scene, including output-disabled artwork. Physical millimetre sizing, canonical
   lines/cubics/arcs, transforms, outlined text, source bitmap pixels and image masks are retained.
   Native SVG transforms preserve arcs without lossy baking. Curve-control bounds may leave
   conservative whitespace. Missing pixels, unsupported reliefs or malformed geometry produce
   an error instead of a partial success. SVG carries no machining settings and never consumes
   production serials. Existing KerfDesk SVG import still ignores embedded raster images; vector
   interchange and external SVG rendering are separate from mixed-image re-import support.
6. **Grid can advance variables per copy.** Copies render against one captured clock and use the
   largest rendered envelope for their initial layout. A persisted nonnegative sequence offset
   keeps each copy distinct through text edits, project save/reopen and output materialization.
   This amends ADR-279's transient-only first delivery: the offset is persistent, while the array
   generator and layout parameters remain transient. Objects remain ordinarily editable; later
   variable changes preserve manual positions rather than silently reflowing the layout.
   Project schema 8 prevents older readers from silently repeating the first value.
7. **Only successful production output advances the cursor.** The emitted output scope,
   enabled operation membership and greatest emitted sequence offset determine the next state.
   Successful G-code or experimental Ruida writes, all successful tile writes, or the existing
   completed-stream event apply advancement only under the matching configured policy and
   unchanged source identity. Cancelled, partial, failed or stale work consumes nothing.
   Existing record/serial wrap and stride rules still apply. This is software completion evidence,
   not a new claim of physical controller completion.

### Boundaries and consequences

No new machine policy gate is introduced. A completed Frame for the exact reviewed job remains the
sole ordinary Start policy gate. No hardware operation, provider-state change, deployment or main
merge is part of this decision's local implementation.

No additional runtime dependency is introduced. Reusable operation recipes, personal artwork
libraries, broader file formats, circular variable imposition and live data sources remain separate
feature work. The companion workspace usability fixes are recorded in ADR-349.

### Verification

Focused software regressions cover geometry area/perimeter and curve transforms, binding and tab
ownership, undo and project round trips, emitted overlap intervals, original image luma, bitmap and
preview parity, SVG serialization and async export boundaries, variable-copy persistence and scoped
success advancement. The final combined checks and exact included commits are recorded in
`docs/audits/2026-09-23-combined-audit-remediation.md`. Local browser evidence does not establish
installed desktop, hosted-release, material or machine qualification.
