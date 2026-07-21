# Image Studio v2 — retouch tools, laser advisories, and the trace loop

**Date:** 2026-07-22 · **Status:** Plan (maintainer-selected scope) · **Builds on:** ADR-242 (Studio), ADR-245 (layers), the PP-A..PP-F parity program (all merged).

The maintainer selected eleven features from the post-parity brainstorm. This
plan turns them into six phases (V2-A .. V2-F), ordered so foundations land
first and every phase ships as one or two individually-gated, live-verified
PRs. Architectural pieces are collected under **ADR-246** (to be appended to
DECISIONS.md with the first PR of the arc): the scoped-history model, the new
`core/image-retouch` module, laser advisories composed from existing mask
ops, and the Apply-&-Trace loop.

**Module placement constraint that shapes everything:** the three existing
Studio core barrels (`image-edit`, `image-select`, `image-adjust`) are all at
the 20-export cap. New core surface therefore goes into **new modules**:
`core/image-retouch` (gradient, clone, heal) — `core/image-layers` (10/20)
and `core/image-resample` (1/20) still have room for their own kinds of
growth. Signature/field extensions of EXISTING exports (e.g. a new field on
`HistoryEntry`, a rect parameter on `compositeLayersInPlace`) do not consume
barrel slots and are the preferred lever wherever honest.

---

## V2-A — Foundations: dirty-tile compositing + scoped history (2 PRs)

### A1. Tile-dirty compositing (perf)

Today `compositeSession` recomposites the full document on every revision
(fast-path identity for single-layer sessions). On a 20 MP photo with two
layers, every brush dab pays a full-frame composite.

- `EditorSession` gains `lastDirtyRect: PixelRect | null` (null = everything
  changed). Set by `committed()` (from the op's capture rect), by
  `commitAdjustment` (selection bounds), by strokes (strokeDirtyRect); layer
  add/remove/reorder/opacity/blend/visibility and crop/resize set null.
- `compositeLayersInPlace(target, layers, rect?)` gains an optional rect
  (existing export, no barrel cost) compositing only that window.
- `use-composite-doc.ts` keeps a persistent target buffer in a ref keyed by
  session identity + dimensions; on revision bump with a dirty rect it
  recomposites only the rect; anything else rebuilds fully. The fast-path
  identity for plain single-layer sessions stays.
- Tests: property — rect-composite equals full recomposite for random layer
  stacks and rects; cache-invalidation on layer-structure changes and crops.
- Risk: stale-cache bugs. Mitigation: the property test plus a dev-only
  assertion comparing checksums under vitest.

### A2. Undo across layer switches + Quick Mask undo (closes both v1 gaps)

- `HistoryEntry` gains `scope: string` (''= legacy). `captureTiles` /
  `captureRect` gain an optional scope argument — field + parameter on
  existing exports, so the full `image-edit` barrel is untouched.
- Session ops tag entries with the active layer id. `undoSession` /
  `redoSession` peek the top entry's scope; if it names another layer, they
  first swap the doc pointer to that layer (a new internal
  `activateLayerKeepHistory` — unlike `setActiveLayer`, it must NOT clear
  history) and then apply the tiles. `setActiveLayer` stops clearing history
  entirely — entries now carry their own scope. Crop/resize still clear
  (dimensions change; tiles are dimension-relative).
- Quick Mask: `quick-mask-store` gains its own small `EditHistory` (core
  reuse, zero new machinery): `strokeInto` captures the rubylith tiles
  before painting; Ctrl+Z while the mode is active pops it
  (`editor-shortcuts` checks QM before the session undo). Exiting the mode
  drops the QM history.
- Tests: paint on layer A, switch to B, paint, Ctrl+Z twice → both strokes
  undone in reverse order with the active layer following; QM stroke undo;
  redo across a switch; crop still clears.
- The Layers panel row tooltip ("switching clears editor undo") comes out.

## V2-B — Painting tools: bucket, gradient, clone, heal (2 PRs)

### B1. Paint bucket + gradient (tool key G cycles bucket ⇄ gradient, like M)

- **Bucket:** no new core. `bucketFillAction` = `wandSelection` on the
  **composite** (the wand lesson) at the shared tolerance/contiguous options
  → `fillMaskedInPlace` with the foreground onto the **active layer** →
  one `captureRect(maskBounds)` history entry. Tool `{kind:'bucket'}`,
  options bar reuses the wand schema rows.
- **Gradient:** new module `core/image-retouch`:
  `fillGradientInPlace(doc, {from, to, shape: 'linear' | 'radial'}, fg, bg,
  mask?)` — alpha-writing (opaque), selection-clamped, feather-aware via the
  established alpha-lerp. Drag interaction: new `EditorDrag` kind
  `'gradient'` with a from→to preview line; complete → one history entry
  over the selection bounds (or full doc).
- Tests: bucket = wand-region fill exactness + composite sampling with a
  transparent active layer; gradient endpoints, midpoint lerp, radial
  falloff, mask clamp.

### B2. Clone stamp + spot heal (both in `core/image-retouch`)

- **Clone:** tool `{kind:'clone'}`; Alt-click stores `cloneSource` (new
  small store or a field on the tool object — decided at build by store
  headroom; the tool object `{kind:'clone', source: {x,y} | null}` keeps the
  main store untouched). First stroke point fixes the offset (aligned mode).
  `cloneStrokeInPlace(doc, sourceSnapshot, offset, stroke, clip?)` stamps
  source pixels through the brush tip alpha. The snapshot is the **composite
  at stroke start** (Photoshop's "sample all layers"; avoids feedback while
  painting). UI: crosshair marker at the live source point.
- **Heal:** `healSpotInPlace(doc, centre, radius)` — masked-median, the
  patent-safe variant (PatchMatch stays off the table): each pixel inside
  the soft disc takes the median of an annulus ring outside the blemish,
  blended by tip alpha. Dab-oriented; strokes decompose into dabs.
- Tests: clone copies an offset block exactly through a hard tip; aligned
  offset holds across dabs; heal removes a salt speck inside texture while
  the annulus median preserves the surround; both selection-clamped.
- Live-verify: synthetic doc with a speckled gradient; clone a region, heal
  a speck, pixel-assert both.

## V2-C — Text onto a layer (1 PR)

- TopBar/tool "T" opens a small dialog (editor chrome, not the app's text
  artwork dialog): text, font picker fed by the SAME font list the text
  artwork feature uses, size in px, fill black/white.
- Rasterization reuses the app's opentype parsing: glyph outlines →
  `Path2D` → offscreen canvas fill → `RgbaBuffer` (transparent background) →
  stamped into a NEW transparent layer named after the text, centred; the
  user then positions with Move/Ctrl+T which already work on layers.
  (Exact reuse point in `src/ui/text/` to be read before build — the
  machinery exists; the integration seam is confirmed at build time, not
  invented here.)
- One history entry (layer addition); Apply flattens as usual (ADR-245).
- Tests: rasterized buffer non-empty and transparent-backed; layer naming;
  session invariants. Perceptual: live-verify by pixel-sampling glyph ink.

## V2-D — Layers polish: blend modes, thumbnails, drag reorder (1 PR)

- **Blend modes:** `LayerBlend` grows `'screen' | 'overlay' | 'difference'`
  (union extension, no new export); `blendLayerInPlace` switch + the panel
  select. Byte-exact tests per mode (screen 255−(255−d)(255−s)/255; overlay
  split at 128; difference |d−s|).
- **Thumbnails:** each Layers row draws a ~28 px mini canvas from
  `resampleBuffer(layer.buffer, …)` (the mipmap chain makes this cheap),
  memoized on [session, revision].
- **Drag reorder:** HTML5 drag on rows → `moveLayerTo(layers, id, index)`
  (new export, `image-layers` 10/20 → 11/20). The ↑↓ buttons stay as the
  accessible fallback.

## V2-E — Laser advisories: ink & time readout, kerf warnings (2 PRs)

### E1. Ink & time in the status footer

- Coverage: % of composite pixels darker than the ink threshold, recomputed
  debounced (~250 ms) per revision — O(n) on the composite the canvas
  already has; with A1's cache this is nearly free.
- Time: reuse the app's live estimate machinery (`src/ui/laser/
  live-job-estimate.ts` — verified present; exact API read at build). The
  session's objectId → the raster's assigned cut layer → speed / interval →
  scanline model with blank-row skipping. Displayed as
  `ink 34% · ≈ 12 min @ layer "Engrave"` and clearly labelled an estimate.
  If the object has no engraveable layer assignment, the readout says so
  instead of guessing.

### E2. Kerf/thin-stroke warnings (warnings, never blocks — rule 7 / ADR-228)

- Analysis composed ENTIRELY from existing core: ink mask from the
  composite (luma < 128) → `contractMask(kerfPx)` → `expandMask(kerfPx)` →
  pixels lost by that opening = strokes thinner than the kerf. `kerfPx`
  derives from the object's layer kerf (mm) through the session's mm↔px
  mapping.
- Surfaces: a status-footer badge ("⚠ N px of strokes thinner than the
  kerf"), a toggleable orange overlay (the Quick Mask rendering pattern),
  and a one-click **Thicken** that paints ink where
  `expandMask(thinRegions, kerfPx)` says — one undoable history entry.
  Nothing refuses anything; Job Review remains the only warning surface for
  the machine side.
- Tests: a 1 px line at kerf 3 px flags and thickens; a thick block does
  not; mm→px derivation.

## V2-F — The loop-closer: Apply & Trace (1 PR)

Verified integration seam: the whole trace flow enters through
`openImageDialog(rasterImage)` (`tool-command-context.ts`), which opens the
existing trace dialog — live preview and parameters included.

- TopBar button **"Apply & Trace"**: runs the existing `apply()` (bakes the
  composite into the scene raster as one project-undo entry), and on the
  apply promise resolving, closes the editor (session kept, as always) and
  calls `openImageDialog` with the freshly-updated scene image.
- Store plumbing: the editor store cannot import ui/commands (cycle);
  instead `ImageEditorHost` (already app-level) wires the dialog opener in,
  the same seam `use-app-commands` uses.
- Result: edit → one click → trace dialog previewing the EDITED pixels →
  vectors into the scene. The original "Photoshop for my tracer" round trip.
- Tests: action ordering (apply resolves before the dialog opens; dialog
  receives the updated image id); failure path (apply error → no dialog,
  toast stands).
- Live-verify: paint → Apply & Trace → trace dialog shows the painted
  pixels.

---

## Sequencing, sizing, protocol

| Phase | PRs | Depends on | Size |
|---|---|---|---|
| V2-A1 dirty-tile composite | 1 | — | M |
| V2-A2 scoped history + QM undo | 1 | — | M |
| V2-B1 bucket + gradient | 1 | — (better after A2) | M |
| V2-B2 clone + heal | 1 | B1 (module) | M |
| V2-C text layer | 1 | — | M |
| V2-D blend/thumbs/reorder | 1 | — | S |
| V2-E1 ink & time | 1 | A1 helpful | S–M |
| V2-E2 kerf warnings | 1 | E1 (mm↔px plumbing) | M |
| V2-F apply & trace | 1 | — | S |

Recommended order: **A1 → A2 → D → B1 → B2 → E1 → E2 → C → F** (foundations,
then the cheap wins, then tools, then the laser payoff, then text, then the
loop-closer as the arc's finale). Every PR follows the shipped protocol:
failing-test-first for behavior, all local gates, live-verify in the running
app on a throwaway session (dev-server restart before store-driven
verification — the `?t=` rule), merge only on the two real CI gates.

ADR-246 lands with the first PR. The parity plan's Top-20 scorecard retires;
this doc's phase table is the new acceptance list.

**Out of scope (unchanged rulings):** ML background removal (weight
licensing), PatchMatch healing (patent), non-destructive adjustment layers
(future ADR of its own), Dither Lab / Material Preview (the "laser trio" —
parked as the arc after this one unless re-prioritized).
