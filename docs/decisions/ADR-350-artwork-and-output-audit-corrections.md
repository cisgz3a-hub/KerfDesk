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
(Amended by Amendment 2: Union Silhouette, Join Paths, Offset Shapes, Cut Shapes, Trim Shapes,
Warp / Deform and the rubber-band outline are now guarded.)

**Verification.** `weld-skips-variable-data-and-jig.test.ts` checks the burned value against an
independent render of "SN 0042", the serial advancing after Weld, a variable Code 128, and a
two-outline jig's runs and decoded piece order with locked and unlocked outlines.
`weld-bound-colours.test.ts` uses the real Assign to operation and operation recolour, and reads
back lit length from the G-code (80 mm and 110 mm union outlines).
`vector-path-weld.test.ts` covers the batch key. All fail on main 0163a852b except the legacy
colour case, which guards the kept behaviour.

### Amendment 2 - Union Silhouette, Join Paths and the other outline tools take the guard; replaced sources repair their dependents (2026-11-14)

**Context.** Tools audit T1 (`docs/audits/2026-11-13-tools-t1/`) confirmed on main f8c17f8c4 that
Amendment 1's guard missed two tools in `vector-repair-actions.ts`, and that the tools which
replace their sources leave dependents pointing at deleted ids:

- **T29-P1-1 and T30-P1-1 (P1).** Union Silhouette and Join Paths rebuild variable text from its
  template glyphs. After Union, serial 7 and serial 8 gave identical G-code burning the braces. Join
  did the same in all four bundled single-line fonts, because it closes loops inside the template
  glyphs: "SN {{serial:4}}" burned 142.238 mm, 51.592 mm wide, where the value burns 84.703 mm,
  30.472 mm wide. Weld refused both selections with a reason.
- **T29-P2-1.** Union of box A's jig pieces made one silhouette in box A while box B still burned
  both outlines (162 mm against 216 mm). After Unlock All the outlines were absorbed too.
- **T29-P1-2 (re-graded P2), T29R-P2-1, T29-P3-3.** Union, Weld and Subtract / Intersect / Exclude
  removed their sources without dependency repair. An image masked by a source kept a dangling
  `imageMaskId`, and the job burned the whole photo unmasked (3200 mm, 2656 mm of it outside the
  mask), with no preflight issue and no notice. Text set on a source as its path kept a dangling
  guide in the same way. Join and Delete already repaired these; Join gave no notice (T30-P3-4).
- **T29-P2-2.** Union dropped placed tabs without ADR-494 Amendment 3's notice.

**Decision.**

1. **Union Silhouette and Join Paths use the `replace` guard.** Both replace their sources with new
   objects built from stored outlines. They leave out variable text, variable barcodes, the
   registration outlines and every jig piece's artwork. They edit the rest of the selection and
   show Amendment 1's notice; a selection of only those refuses with the notice. One function,
   `vectorRepairSources` (`src/ui/state/vector-repair-sources.ts`), feeds the menu gating
   (`unionSilhouetteOperations`, `selectionCanJoinPaths`), both dialogs (which show the notice
   before Apply), the material library's join preview and the store actions. Guard-skipped
   objects never make a selection ineligible, so Select All still works. Anything else that is not
   an unlocked plain vector object still refuses the whole selection, as before. Join's gating now
   reads the same objects as its action, so a compound result no longer enables a Join that then
   refuses (T30-P3-2); Union's gating likewise (T29-P3-1). The jig guard on Join also covers
   T30-P2-1.
2. **A tool that replaces its sources repairs their dependents and says so.** Weld, Subtract /
   Intersect / Exclude, Union Silhouette and Join Paths run Delete's dependency repair on the
   result (`repairReplacedSources`, `src/ui/state/replaced-sources-repair.ts`; Weld and the Booleans
   reach it through `combineSelectionNotingTabs`). An image mask or text-on-path guide that
   pointed at a removed source is cleared, and the warning says the artwork "was merged into a
   new shape". The image then burns unmasked, which the canvas shows; the text keeps its stored
   geometry. The dependents are not pointed at the result: the result of a Subtract or Exclude
   is not the mask the user drew, and a guide's new outline would move the text. Keep originals
   removes nothing and repairs nothing.
3. **Union names dropped placed tabs** with ADR-494 Amendment 3's notice ("Placed tabs on the
   unioned shapes were removed. Undo restores them."). Join already refuses paths with placed
   tabs.
4. **The other outline tools take the guard:**
   - Offset Shapes (its dialog and action): `variable`, or `replace` when Delete original objects
     is on. The dialog shows the notice.
   - Cut Shapes (action and background plan, `cutShapesSources`): `replace`, because it replaces
     its sources with pieces.
   - Trim Shapes: `variable`. A click on variable data refuses with the notice. The object keeps
     its id, so jig artwork may still be trimmed, as Dogbone may relieve it.
   - Rubber-Band Outline: `variable`. The outline goes round the rest of the selection.
   - Warp / Deform: variable text only. Bending converts text to paths from its template glyphs. A
     variable barcode is bent at the value the canvas shows, which
     `warp-deform-variable-barcode.test.ts` already guards, in line with ADR-386 Amendment 2's
     acceptance for Convert to Path. The finished notice and the start notice name skipped text.
   - Close Path and Close Paths with Tolerance are not changed: they edit only imported, traced
     and drawn-polyline artwork (`isPathEditable`), never text or barcodes, and keep the id.

**Not covered.** Duplicate Shapes, Cut Shape Sides, Copy Along Path and the nest outline stay as
Amendment 1 listed them. The Offset outlines row still sends variable data to its background
worker and then recomputes in the thread, because the store leaves it out; the result is right
and only the reuse is lost. Join's zero-area loop (T30-P1-2) has its own fix.

**Verification.** `union-join-skip-variable-data-and-jig.test.ts` checks Union's burned value
against an independent render of "SN 0042" and the serial advancing. It checks Join in each of
the four single-line fonts against `renderVariableText`'s own render of the value. It also checks
the gating and refusals, and a two-outline jig: box A's pieces refused, both boxes burning the same
lit length, and Select All with locked and unlocked outlines keeping the runs while the free pair
unions to 50 mm. `replaced-sources-dependencies.test.ts` covers mask and guide repair with its
warning and Undo for Union, Weld, Subtract, Intersect and Exclude, Weld with Keep originals, Join's
guide notice, and Union's tab notice. It also checks that Offset Shapes, Cut Shapes, Trim, the
rubber-band outline and Warp / Deform leave variable text. 27 of the 30 tests fail on main
951f94712; the other three are controls for kept behaviour.
