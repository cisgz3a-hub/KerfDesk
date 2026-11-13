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

No additional runtime dependency is introduced in this priority slice. Reusable operation recipes,
personal artwork libraries/templates, broader file formats and circular variable copies are now
covered by the separately authorized ADR-357 follow-up. Live data sources remain separate feature
work. The companion workspace usability fixes are recorded in ADR-351.

### Verification

Focused software regressions cover geometry area/perimeter and curve transforms, binding and tab
ownership, undo and project round trips, emitted overlap intervals, original image luma, bitmap and
preview parity, SVG serialization and async export boundaries, variable-copy persistence and scoped
success advancement. The final combined checks and exact included commits are recorded in
`docs/audits/2026-09-23-combined-audit-remediation.md`. Local browser evidence does not establish
installed desktop, hosted-release, material or machine qualification.

### Amendment 1 - Geometry tools leave variable data and the jig alone; Weld groups bound paths by operation (2026-11-13)

**Context.** Tools audit T1 (`docs/audits/2026-11-13-tools-t1/`) found three Weld defects on
main 045670634:

- **T28-P1-1.** Weld rebuilds an object from its stored outlines. For variable text those are the
  template glyphs (`SN {{serial:4}}`), so every record burned the braces and the serial stopped
  changing. A variable barcode froze at the code stored when it was made, so each piece burned a
  valid but repeated serial. Neither showed a notice. PR #1875 had fixed only Convert to Path
  (T26-P1-1); every tool that rebuilds an object's outlines had the same exposure.
- **T28-P2-1.** Select All then Weld merged jig artwork with its copies in the other outlines. The
  jig's separately compiled runs fell from 4 to 0, and the burn order changed from piece by piece
  to operation by operation (ADR-606 locks the outlines themselves; after Unlock All they were lost
  too).
- **T28-P2-2.** Weld split its unions by path colour. Paths bound to an operation by id keep their
  colour for display only: Assign to operation keeps the old colour and an operation recolour
  leaves bound art alone. Two shapes in one operation therefore refused with a false "Nothing to
  weld", or the off-colour shape's whole outline was still cut inside the union (230 mm burned
  against a 150 mm union).

**Decision.**

1. **Variable data is not rebuilt.** Weld, Subtract / Intersect / Exclude, Offset and Dogbone
   leave variable text and variable barcodes out of their sources, process the rest of the
   selection, and show "… left as text: use Bake Variable Text first to fix its value" (barcodes:
   "… left as it is: …"), the wording PR #1875 introduced. Their menu gating counts only the
   objects they will rebuild, so a selection of only variable data leaves them disabled. Convert
   to Path keeps its rule: it skips variable text, while ADR-386 Amendment 2's acceptance that it
   converts a barcode's stored code still stands for that command alone.
2. **Tools that replace their sources leave the registration jig alone.** Weld and Subtract /
   Intersect / Exclude replace their sources with one new object, which takes jig artwork out of
   its outline. They leave out the registration outlines and every object that belongs to a jig
   piece (a source and its copies), with "The registration jig was left as it is: change its
   artwork in the jig editor." Weld does not weld within each outline instead: the result would
   need the jig identity and copy links that only the jig editor maintains. Offset adds a new
   object and Dogbone keeps the object's id, so they may still work on jig artwork.
3. **Weld groups bound paths by operation, not colour.** For a path with explicit operation ids,
   the union key is the operation, stroke width and stroke transform; the result takes the first
   source's colour. A legacy path with no ids, and an explicitly unbound path, still keep colour
   in the key, because there the colour binds or shows the path.

The rule lives in one place (`src/ui/state/geometry-tool-sources.ts`), used by the store
mutations through `selectedVectorObjects`, by the menu gating (`selectionCanWeld`,
`selectionCanCombine`) and by the Combine Shapes review's preview sources, so the preview, the
worker plan and Apply see the same objects (ADR-609).

**Not covered.** Offset Shapes (its own dialog), Duplicate Shapes, Cut Shape Sides, Copy Along
Path, Warp, the nest outline and the rubber-band outline also read stored outlines and are not
guarded yet; each is left to its own audit entry. Locked members (T28-P2-3, now P3) are unchanged.

**Verification.** `weld-skips-variable-data-and-jig.test.ts` checks the burned value against an
independent render of "SN 0042", the serial advancing after Weld, a variable Code 128, and a
two-outline jig's runs and decoded piece order with locked and unlocked outlines.
`weld-bound-colours.test.ts` uses the real Assign to operation and operation recolour, and reads
back lit length from the G-code (80 mm and 110 mm union outlines).
`vector-path-weld.test.ts` covers the batch key. All fail on main 0163a852b except the legacy
colour case, which guards the kept behaviour.
