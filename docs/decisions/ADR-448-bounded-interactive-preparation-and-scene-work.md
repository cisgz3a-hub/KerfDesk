## ADR-448 - Bound interactive preparation and avoid repeated scene work (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Amends the interactive routing and allocation details of ADRs 244 and 346.
The completed Frame for the exact reviewed job remains the sole ordinary Start
policy gate. None of these changes alters executable geometry or machine settings.

### Context

The speed audit used an older checkout. Current main already shares Preview,
ETA and output preparation routing, cancels superseded tracing, bounds output
worker requests, performs Inspector timing analysis in its worker, and prepares
durable autosaves asynchronously. Those mechanisms remain in place.

The remaining hatch classifier still scanned every contour edge for every hatch
row before deciding whether work belonged in a worker. A 90,000-vertex circle
could spend seconds merely choosing the lane. The UI also allowed vector jobs
below the 100,000-segment core advisory to synchronously compile and time output.
Preview and ETA shared compilation but could each emit the complete program.
Unrelated store updates repeatedly walked paged-raster ownership throughout
history, and canvas redraws still painted entirely offscreen objects.

### Decision

1. Separate the UI execution threshold from advisory job-size thresholds. The
   shared canvas/output policy uses 20,000 vector work units, including laser
   passes and the combined primary/independent-stage CNC depth passes. Stored
   recipes that are currently inactive or belong to another cutter may
   conservatively choose a worker without changing executable pass counts.
   Amplifying operations and costly rasters keep
   their existing worker routing. Scoped output is classified after selection.
   A worker still prepares the complete requested output.
2. Bound fill estimation. Native curves use transform-aware, bounded flattening
   at the existing physical tolerance. A shared one-million edge/scan comparison
   budget applies across paths and cross-hatch directions. The result distinguishes
   counted work, work-budget exhaustion and invalid input. The legacy numeric
   wrapper returns Infinity for an unknown estimate, never an invented span count.
   Small even-odd/coincident-contour estimates retain their existing semantics.
   Compilation and preflight remain responsible for output and invalid geometry.
3. Let the ETA observer expose the exact program it already emitted. A single
   worker preparation may retain at most 524,288 UTF-16 code units for its optional
   Preview sidecar, and the existing route parity check still qualifies that
   sidecar. Row providers and current-position jobs do not retain this source.
   Larger programs keep the complete prepared-job Preview route and skip optional
   sidecar re-emission. Planner allocations finish before the full route is kept.
   No prefix, partial plan, reduced pass count or altered duration is presented
   as a complete job.
4. Derive vector culling bounds from actual immutable paths, including native
   curves, and weakly cache those local bounds. Apply the full object transform
   and viewport transform before rejecting artwork proved outside the canvas.
   The eight-pixel fringe covers current screen-space strokes of at most 1.5px
   with the default miter limit; current artwork painters have no shadows and
   text is path geometry. Selection/control overlays remain independent. Raster
   display uses its authoritative painted rectangle. Relief draws normally
   because its failure labels may extend beyond the displayed heightfield bounds.
   Invalid or unavailable bounds conservatively draw normally.
5. Mark the workspace only after a successful complete canvas draw. Startup
   reveals that painted canvas on the next animation frame; the existing error
   boundary, five-second fallback and reduced-motion handling remain available.
6. Skip paged-asset ownership scans when ownership inputs are unchanged. Cache
   asset IDs by immutable scene-object arrays using weak keys and deduplicate
   structurally shared history arrays. Scene mutation APIs replace those arrays;
   in-place mutation is outside the existing state contract. Coalesce retention
   repair into one active promise and one requested rerun, while preserving
   failed repair retry and assets introduced during a pending repair. Do not
   delete any asset because live state alone cannot establish all durable owners.

### Consequences and limits

- Quality and exact Frame/Start ownership are unchanged. Execution routing can
  become more conservative without dropping geometry or refusing a valid job.
- The viewport change avoids unnecessary painting, not all O(object-count)
  traversal. It introduces no display decimation. Dense-object sprites, packed
  geometry transfer and existing display caches remain the larger drawing tools.
- Worker queue length and optional duplicate representations are bounded. The
  exact output string, full motion manifest, timing model and saved/recovery
  artifact still scale with job size. This is not constant-memory streaming.
  A transactional paged-program design would require a separate migration of
  review, persistence, hashes, recovery and transmission ownership.
- Inspector playback is an estimate using the selected device assumptions;
  generic limits remain labelled when no device context exists. Neither it nor
  these responsiveness changes constitutes controller/material qualification.

### Verification

- Dense 90,000-vertex and many-path coincident fill classification, native-curve
  fallback, invalid-input distinction, cross-hatch, overrides and enabled sublayers.
- Laser/CNC pass amplification and selected-only scope choose the same shared lane.
- One exact emission for small Preview plus ETA; complete multi-pass route and
  duration equality above the source-retention bound; embedded, stateless-row and
  error-diffusion-row allocation-order and replay parity.
- Viewport transforms, stale stored bounds, curves entering from outside,
  stroke fringe, path-cache invalidation, conservative fallback, full-detail
  rendering, operation visibility and selection-handle regressions.
- Shared history ownership, array replacement with undo ownership, unchanged
  state, failed retention repair retry and newly owned assets during an in-flight
  repair. Existing durable autosave, output worker capacity/cancellation,
  no-main-thread-fallback, trace cancellation and Inspector worker suites.
- Startup browser coverage requires the successful paint marker and retains
  decorative-image, reduced-motion, startup-error and timeout cases.

The external audit evidence records classifier timing conditions and exact
fixture output hashes. Browser frame-rate and physical machining speed are
separate measurements; no hardware operation or deployment is implied.
