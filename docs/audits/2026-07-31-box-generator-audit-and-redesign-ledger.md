# CurveDesk Box Generator audit and redesign ledger

**Date:** 2026-07-31

**Baseline:** `origin/main` at `e3ace9928163fcd696d074c9f0a54024f8215948`

**Audit branch:** `codex/box-generator-audit`

**Status:** audit and visualization contract complete; three narrow repairs implemented and locally verified; review PR pending

**Scope:** Box Generator math, fabrication semantics, preview, insertion, persistence, and
downstream project/output handoff only

This is the single ledger for this program. It records source evidence, test
evidence, repair status, the visual contract, and the physical checks that
software cannot replace.

## 1. Evidence boundary

The labels in this document are deliberately strict:

- **Source-confirmed** means the current baseline contains the cited behavior.
- **Test-confirmed** means a command run against the baseline reproduced or
  pinned the behavior.
- **External-source-confirmed** means a primary vendor or project source
  supports the fabrication or dependency statement.
- **Physical-unverified** means no real material was cut or assembled. Software
  geometry, a screenshot, and green tests do not promote a claim across this
  boundary.
- **Decision-blocked** means current authorities or intentional code history
  conflict, so changing output would require a maintainer decision first.

No machine was connected or moved. This program does not change hardware,
machine settings, controllers, Start, Frame, or any related policy.

## 2. Executive verdict

The claim-model generator has unusually strong nominal geometry evidence:
shared edge sequences, corner ownership, clearance math, divider and slide-lid
referees, deterministic layout, closed-ring structure, and perceptual masks are
all covered. The focused baseline completed **18 files / 126 tests**, including
**1,114 / 1,114 benchmark assertions**. The canonical laser mask scored IoU
1.0000; the CNC mask scored IoU 0.9693 with precision 1.0000 and recall 0.9693.

The repaired final state completed **21 focused files / 134 tests** and the full
repository completed **1,359 files / 8,190 tests** with 14 files / 22 tests
skipped. Typecheck, formatting, both linters, release-integrity, licence,
policy/size ratchets, web build, and Electron-main build also passed.

That evidence is not a physical-fit certificate. Current product status remains
**hardware fit CLAIMED**.

The highest-risk source-confirmed issues and their current disposition are:

1. **repaired:** finite inputs could overflow derived/layout dimensions and let
   non-finite panel coordinates escape;
2. generation work is unbudgeted and synchronous, so extreme but otherwise
   valid dimensions or divider counts can freeze the dialog;
3. fresh CNC Box operations now inherit the global **On path** cut default,
   while the Box contract relies on **Outside** compensation to preserve the
   drawn dimensions;
4. the CNC relief default is intentionally off in code while the living
   workflow still promises relief-bearing CNC panels by default;
5. **repaired:** opt-in CNC relief also scalloped the slide lid's decorative
   thumb notch;
6. the current assembled preview is not an extrusion, lacks the promised
   component tests, and can silently show stale geometry for invalid input.

The correct visualization dependency is the already-installed, MIT-licensed
Three.js package. No new graphics dependency is justified. Visualization must
not begin until the pure preview model and the ADR-119 supersession described
below are accepted.

## 3. Current pipeline, as proved from source

```text
string draft
  -> parseBoxDraft
  -> validateBoxSpec
  -> deriveBoxDims / shared edge claims
  -> nominal closed rings
  -> clearance offset
  -> optional CNC corner relief
  -> fixed three-column sheet layout
  -> one imported-svg object per part
  -> ordinary project scene and cut operation
  -> laser kerf or CNC profile compensation at compile
  -> ordinary G-code emitter
```

Relevant seams:

| Stage | Current source | Proven contract |
|---|---|---|
| Draft and defaults | `src/ui/box/box-draft.ts` | String drafts; machine-aware initial values; tool diameter is not persisted. |
| Validation and units | `src/core/box/box-spec.ts` | Every numeric value is interpreted in millimetres; positive dimensions/thickness/finger target; signed clearance; non-negative spacing; divider feasibility. |
| Shared joinery | `src/core/box/edge-pattern.ts`, `panel-claims.ts` | One odd alternating cell sequence per box edge; complementary ownership; Z > Y > X corner claimant. |
| Cut rings | `src/core/box/panel-outline.ts`, `divider-panels.ts`, `slide-lid-panels.ts` | Closed outline plus zero or more closed cutouts. Nominal panel outlines have positive signed area in the property suite. |
| Fit | `src/core/box/panel-fit.ts` | Uniform `-clearance / 4` material offset, then full-radius optional corner overcuts. Kerf and cutter radius are not baked here. |
| Layout | `src/core/box/layout.ts` | Stable fixed grid, three columns, exact fitted bounding-box spacing; not nesting and not bed-aware. |
| Insertion | `src/ui/state/box-insert-mutation.ts` | One named `imported-svg` per panel, outline and cutouts in one colored path, one operation, one undo step, all parts selected. |
| Laser compile | `src/core/job/compile-job.ts` | Closed Line-mode contours receive the layer kerf offset at compile time. |
| CNC compile | `src/core/cnc/collect-cnc-contours.ts`, `profile-paths.ts` | Object transforms and machine coordinates are applied, then profile compensation is derived from the active layer/tool. |
| Persistence | `src/io/project/` | Inserted rings, operations, and closed flags use ordinary project serialization. The originating `BoxSpec` is not retained. |

## 4. Parameter and fabrication contract

| Input | Unit / domain | Current behavior | Audit result |
|---|---|---|---|
| Width, depth, height | mm, finite and `> 0` | Interpreted as inner or outer dimensions. | Correct for ordinary finite ranges. This branch now rejects derived overflow; see BG-001. |
| Dimension mode | `inner` / `outer` | Inner mode adds `2T`; slide-lid height adds `3T`. Outer mode subtracts the same amounts. | Unit tests pin both modes. |
| Material thickness `T` | mm, finite and `> 0` | Controls outer/inner conversion, minimum cell size, slots, plate frames, and layout defaults. | Source-consistent; physical stock variation remains unmeasured. |
| Target finger width | mm, finite and `> 0` | Clamped per axis to `[max(2 mm, T), span / 3]`, then the largest odd cell count is used. | Property tests pin oddness, symmetry, and claim area. The UI label should say “target,” not imply exact output. |
| Clearance `c` | signed mm | `+` is looser, `-` is tighter; a uniform `-c/4` contour offset yields nominal notch-minus-tab play `c`. | Analytic and property/referee evidence is strong. Physical fit is unverified. |
| Relief | none or corner-overcut | After clearance, subtract a circle of full tool radius at seat-critical reflex corners. | Geometry tests pin radius and ordering. CNC default/documentation conflict is BG-003. |
| Tool diameter | mm, CNC only | Sourced from the active machine on open; used only when relief is enabled; never persisted. | Avoids a stale persisted bit size, but machine changes while open are not reconciled; BG-004. |
| Part spacing | mm, finite and `>= 0` | Exact gap between fitted bounding boxes in a fixed grid. | Not an output-envelope guarantee. Kerf/tool compensation can expand paths later; BG-010. |
| Divider counts | whole number `>= 0` | Evenly partitions cavity; rejects compartments under `2T`; adds wall slots and half-laps. | Referee property tests cover small practical counts. Work amplification is unbounded; BG-002. |
| Style | closed / open-top / slide-lid | Five or six shell parts; slide lid adds a channel, short front, loose lid, and mandatory positive clearance. | Dedicated negative controls and referee tests exist. |

### Fit and compensation separation

The generator owns:

- nominal interlocking geometry;
- signed designed clearance;
- optional CNC corner reach relief.

The output pipeline owns:

- laser kerf compensation from the destination Line layer;
- CNC profile inside/outside/on-path compensation from the destination layer and
  active tool.

Therefore a Box preview must never portray kerf or CNC profile compensation as
already applied unless a future contract supplies the exact destination
operation. LightBurn likewise treats kerf offset as an output setting on closed
Line-mode shapes rather than modifying the artwork:
[LightBurn kerf offset guide](https://docs.lightburnsoftware.com/latest/Guides/Test-KerfOffset/).

Corner relief is fabrication-relevant for round CNC cutters: Vectric describes
dog-bone fillets as an internal-corner overcut that gives clearance for a
square-cornered mating part:
[Vectric fillet documentation](https://docs.vectric.com/docs/V12.5/Cut2DPro/ENU/Help/form/Create%20Fillets/index.html).
That supports the need for relief when square tabs must fully seat; it does not
decide CurveDesk's default policy.

boxes.py independently documents both material thickness and burn correction as
fit-critical inputs:
[boxes.py user manual](https://florianfesti.github.io/boxes/html/usermanual.html),
[burn correction API](https://florianfesti.github.io/boxes/html/api_burn.html).
No boxes.py code was copied.

## 5. Ranked finding ledger

| ID | Priority | Status | Finding and evidence | Required disposition |
|---|---:|---|---|---|
| BG-001 | P1 | **Repaired; adversarial review green** | Current main accepted direct derived/spacing overflow. The first repair review then found two low-cell-count survivors: cumulative horizontal layout and finite-offset-plus-local-point translation could still overflow. Both returned `generated` with non-finite coordinates. | Direct derived/spacing overflow now fails validation. A centralized post-layout guard rejects any non-finite offset or outline/cutout point before `kind: generated` can escape. Both survivor tests and a non-vacuous valid-spec property failed first; 3 focused files / 25 tests pass, and an independent style/mode/divider/fit matrix found no remaining generated non-finite result. |
| BG-002 | P1 | Confirmed; design required | `cellCount` and divider arrays scale with user numbers, and `generateBox` runs synchronously during React render. A large finite dimension with a small finger target or a large feasible divider count can allocate/loop until the UI stalls. No compute budget, cancellation, worker, or degraded preview exists. | Do not add a blocking numeric cap under the no-new-guards rule. Move generation out of render, make work cancellable/yielding, add an informational complexity estimate, and let the preview fall back without disabling Generate. |
| BG-003 | P1 | Decision-blocked | `defaultBoxDraft(CNC).relief === 'off'` and tests explicitly call dogbones opt-in. Commit `6013a5c5` records a maintainer request for this behavior. `WORKFLOW.md` F-K3 and ADR-106 still say generated CNC panels carry reliefs and describe a prefilled relief tool. | Maintainer chooses the product contract. Recommended: keep the intentional opt-in code and amend the living workflow/ADR wording to say square CNC corners require relief before claiming seatability. Do not silently change output. |
| BG-004 | P2 | Confirmed | F-K3 says switching machine mode while the dialog is open updates only untouched defaults. The dialog initializes state once, tracks touches only for finger width/spacing, and has no effect for later `machine` prop changes. A shared persisted draft can also override a new CNC machine's stock-derived values. | Specify per-field touched state and a machine-context transition contract before changing persistence/default behavior. Tool diameter remains live machine truth. |
| BG-005 | P2 | **Repaired; focused tests green** | F-K5 says Cancel persists the current draft. The dialog persisted only inside submit; the Cancel button and Escape called `onCancel` directly. | Both close paths now use one persist-then-close hook. Cancel and Escape tests failed first, then 3 focused files / 23 tests passed. |
| BG-006 | P2 | Confirmed; visualization contract | ADR-119/F-K9 say “extruded plates.” `BoxAssembledPreview` maps only one face ring per part at local depth `T`; it builds no side faces. Average-depth painter sorting cannot provide reliable hidden-surface ordering for intersecting plates. | Correct the fallback's truth claim and implement real extrusion only after the pure preview contract is accepted. |
| BG-007 | P2 | Confirmed | The assembled fallback always samples `w = T`. For frames whose origin is on a minimum box face, that draws the inner face, while maximum-side panels draw the outer face. The displayed envelope is therefore inset by `T` on bottom/front/left even before considering the missing sidewalls. | Pin face selection in preview-model tests. A real slab uses both `w = 0` and `w = T`; a static single-face fallback must choose the documented outward face by panel normal. |
| BG-008 | P2 | Confirmed | Invalid form values retain the last valid preview without a visible or announced stale-state marker. `summaryLine` independently calls `deriveBoxDims` for a parsed numeric spec, so an invalid extreme draft can show `NaN`/`Infinity` dimensions alongside cached geometry. | After BG-001, show “Showing last valid preview; current values are invalid” in visible text and an `aria-live` region. Render the summary from a valid preview model only. |
| BG-009 | P2 | Coverage gap | ADR-119 promised Flat/Assembled toggle and jsdom-safe component tests. No `BoxPreview`/`BoxAssembledPreview` component test or toggle test exists. There is also no Box-specific project round-trip plus laser/CNC G-code golden covering outline + cutout preservation. | Add contract tests before visual replacement and one ordinary downstream golden in a later isolated PR. Do not churn global G-code snapshots for the audit-only slice. |
| BG-010 | P2 | Confirmed limitation | Layout is a fixed three-column grid, not nesting, and spacing is measured before downstream kerf/tool compensation. `0` is accepted. Close panels can therefore have overlapping output envelopes even though the flat generator preview shows distinct nominal rings. | Label spacing as nominal edge gap. Add an optional downstream compensation envelope indicator once exact layer/tool context is supplied; keep bed fit and nesting advisory. |
| BG-011 | P3 | Confirmed limitation | After insertion, the project retains baked rings and panel names but no `BoxSpec`, part key, or generator revision. Reopening a project preserves cut geometry but cannot reopen the box parametrically or prove which settings produced it. | Treat editable parametric provenance as a separate product proposal with migration/versioning; it is not required for output preservation. |
| BG-012 | P3 | Physical-unverified | The source and tests prove software geometry over bounded corpora, not kerf calibration, stock thickness tolerance, humidity, tool runout/deflection, glue strategy, assembly force, or collision-free assembly order. | Run the physical matrix in section 10. Keep the public status CLAIMED until artifacts are attached. |
| BG-013 | P1 | Decision-blocked | Fresh Box insertion creates a new operation, and current CNC seeding inherits ADR-256's global `profile-on-path` default. On-path does not offset by the cutter radius. PROJECT/F-K3 still say Box panels flow through `profile-outside`, which is the only current mode that preserves the drawn outside boundary. All Box unit tests bypass the real store seeding step. | Do not change settings in this program. Resolve the authority conflict first: either define a Box-specific Outside operation in a reviewed ADR, or keep the global On-path default and withdraw/replace the automatic “cut-ready dimensions” claim with explicit operator guidance. Add insert-to-CNC-compile goldens for the chosen contract. |
| BG-014 | P2 | Confirmed limitation | The fitted sheet is pinned to `(0,0)` with identity object transforms. Positive laser kerf or CNC Outside compensation expands an otherwise fitting sheet past at least one origin-side usable boundary. Existing downstream bounds/stock review can report it, but the operator must reposition the sheet. | Keep generation and Start unguarded. Once exact compensation context exists, preview the output envelope and offer a reversible translate-to-margin action; never scale the box silently. |
| BG-015 | P2 | **Repaired; focused tests green** | Every slide-lid part was sent through the same inferred-reflex-corner relief pass. The loose lid's 12-segment thumb notch is decorative and mates with nothing, yet every arc vertex was treated as seat-critical. A direct current-main probe changed the lid from 18 to 172 outline points when a 1 mm relief tool was enabled. | The loose lid now receives clearance but no corner-overcut; a new golden-style geometry test pins the lid unchanged and a real joint panel changed. The test failed first, then 4 files / 30 tests passed. |
| BG-016 | P3 | Confirmed contract drift | F-K7 promises a field-level height/thickness error when a shallow slide-lid channel conflicts with top-edge fingers. A `0.01 mm` inner-height probe passes validation and only later returns generation `error`. The message also says “use 0.2 mm or more” although the rule accepts any positive clearance. ADR-116 itself specifies only `clearance > 0`. | Resolve the workflow/ADR wording, then add an exact pre-generation feasibility predicate if the physical geometry defines one. Keep no-partial-output behavior meanwhile. |
| BG-017 | P3 | Confirmed | Blank divider fields are omitted from the dialog's required-field list and become `Number('') === 0`, unlike other blank numeric fields. Errors and warnings share one assertive alert and are not associated to their inputs; the reused numeric-field tooltip calls the box a “test pattern.” | Include divider fields in empty validation; add field-linked descriptions/`aria-invalid`; announce warnings non-assertively; make the shared tooltip caller-neutral. |
| BG-018 | P3 | Confirmed docs drift | Repeated Generate deliberately creates a fresh operation (`Box panels 2`, etc.) while F-K5 says it uses the same layer color. | Correct the workflow unless the maintainer explicitly wants operation reuse. No geometry change is needed. |

## 6. What the current tests prove

| Test family | Present evidence | Important boundary |
|---|---|---|
| Unit | Dimension conversion, cell count, exact outlines, clearance, relief, layout, slide lid, dividers, insertion, draft parsing. | Examples do not cover the entire finite-number domain. |
| Property | Simple rectilinear rings, claim area, complementary shared edges, corner ownership, clearance play, dividers, determinism, and valid finite extreme specs never returning generated non-finite sheet geometry. | Most fabrication fuzz ranges remain practical and bounded; resource exhaustion is still outside this proof. |
| Metamorphic | Inner/outer placement behavior is partially implied by referee cases; zero dividers pin legacy output; clearance zero pins identity. | No explicit preview-model spacing invariance or equivalent inner/outer preview property exists yet. |
| Benchmark | 54 specs across structural, assembly, fit, relief, layout, divider, slide-lid, fit-coupon, and determinism categories; 1,114 / 1,114 passed in this audit baseline. | It is a software benchmark, not a manufacturing sample. |
| Perceptual | Canonical laser and CNC sheet masks passed their analytic thresholds. | A raster mask is not a real cut and the assembled preview was not visually qualified. |
| Integration | One-object-per-panel insertion, selection, one undo step, and ring order are tested. Generic project and compiler tests cover these object types. | No Box-specific project/G-code golden proves the whole handoff in one fixture. |

Required new automated contracts:

1. **Property:** every `valid` `BoxSpec` has six finite derived dimensions;
   every `generated` point and offset is finite.
2. **Metamorphic:** equivalent inner/outer specifications produce identical
   assembled preview geometry; changing only part spacing changes only flat
   offsets; preview interaction leaves `generateBox(spec)` byte-identical.
3. **Golden:** closed, open-top, slide-lid, divider/cutout, positive/negative
   clearance, and opt-in CNC relief preview models.
4. **Downstream golden:** insert a representative multi-ring box, round-trip the
   project, compile one laser Line job and one CNC profile job, and pin contour
   count, closure, hole ordering, compensation semantics, and finite G-code.
5. **CNC slide-lid golden:** enabling relief leaves the thumb-notch lid
   relief-free while still relieving actual seating corners.
6. **Hostile numeric table:** `MAX_VALUE`, near-overflow sums/products, very
   large spacing/counts, subnormals, and unsafe integers never reach generated
   non-finite geometry.

## 7. Exact visual and interaction contract

### 7.1 One pure source of visual truth

Add a pure `BoxPreviewModel` built from the already-generated `BoxPanel[]` and
generation metadata returned by the same core pass. UI code must never
recalculate finger ownership, clearance, relief, layout, or per-axis patterns.
The metadata contract includes derived inner/outer dimensions and the actual
X/Y/Z `EdgePattern` values (count, cell width, and span), including the
slide-lid surrogate height and divider-junction pattern where applicable.

Each part has:

- stable key: `bottom`, `top`, `front`, `back`, `left`, `right`, `lid`, or
  `divider:<axis>:<index>`;
- exact fitted outline and cutouts from the generated panel;
- exact flat `offsetMm`;
- exact `partFrame` assembled transform and thickness;
- deterministic presentation-only explode offset function;
- display name and fit metadata.

Renderer invariants:

- Every generated part occurs exactly once and no preview-only part exists.
- Flat draws the exact sheet-space rings unchanged.
- 3D subtracts only `offsetMm`; removes one duplicated closure point; normalizes
  the outer ring counter-clockwise and holes clockwise; rejects rings with
  fewer than three distinct points; and uses `ExtrudeGeometry` with
  `depth = thicknessMm`, `steps = 1`, and `bevelEnabled = false`. The existing
  vertices are not resampled. Outer and cutout sidewalls are retained.
- The frame is baked into the buffer geometry. If the
  `[uDir, vDir, normalDir]` determinant is negative (front, back, and Y
  dividers today), triangle winding is reversed before normals are computed;
  negative-scale scene objects are forbidden.
- Any triangulation, frame, or winding failure degrades the whole 3D viewport
  to the exact flat/static fallback; it never silently omits a part.
- Explosion translates a complete part and never changes its rings.
- Explosion fraction zero equals the assembled transform exactly.
- `partSpacingMm` affects flat placement only.
- Dimension and finger text comes only from generation metadata.
- Kerf/profile compensation is labeled "downstream - not shown."
- Exploded view is labeled “not assembly instructions.”
- Generate and downstream output do not depend on preview availability.

For explosion fraction `f` in `[0, 1]`, define
`D = clamp(0.35 * max(outerWidth, outerDepth, outerHeight), 20, 100) mm`.
`explodeOffset(part, f)` is `f * D` along: front/lid `-Y`, back `+Y`, left
`-X`, right `+X`, bottom `-Z`, and top `+Z`. A divider moves `+Z` by `f * D`
and is staggered in its slab-normal axis by
`f * (index - (axisCount - 1) / 2) * min(thicknessMm, D / 10)`. These
transforms are presentation data, not a collision-checked assembly sequence.

Consistency tests must prove stable ring/vertex correspondence, every generated
part exactly once, every cutout preserved, assembled slab bounds, zero-explode
identity, spacing invariance, and correct front faces for the mirrored frames.

### 7.2 Practical layout

Use a responsive large dialog:

- desktop: parameters/validation on the left, preview workspace on the right,
  fit facts and part navigator below the preview;
- narrow screens: one stacked column with no horizontal scrolling;
- primary views: **Flat pattern** and **3D assembly**;
- 3D modes: **Assembled**, **Exploded**, and a 0–100% explosion slider;
- presets: **Iso**, **Top**, **Front**, **Right**, **Reset/Fit**;
- pointer: left-drag orbit, wheel/pinch zoom, right-drag/two-finger pan;
- no automatic spin.

Flat is the initial view. On first entry to 3D, the camera looks from
`(+X, -Y, +Z)` at the current model centre and fits the current assembled or
exploded bounds with 10% padding. **Fit** always frames the current bounds;
**Reset** restores that isometric direction and fits without changing
selection, assembly mode, or explosion fraction. Valid geometry edits preserve
azimuth/elevation but recenter and refit the new current bounds. Camera polar
angle is clamped to 5–175 degrees; distance to 0.5–8 times the current bounding
sphere radius; and pan target to two radii from the model centre.

The focusable viewport and visible control strip both provide the same
operations: arrows/orbit buttons rotate 10 degrees; Shift+arrows/pan buttons
move 5% of the visible span; `+`/`-` and zoom buttons change distance 10%;
`Home`/Fit frames current bounds; `0`/Reset restores isometric fit. Pointer
orbit, zoom, and pan remain available. Tab always leaves the viewport and no
control uses `role="application"`.

### 7.3 Selected-panel correspondence

Flat view, 3D view, and the semantic part list share one selected stable key.
Selection persists across valid edits while that key exists. The selected part
uses both a high-contrast outline and a distinct fill, never color alone. The
details region reports its name, fitted 2D extent, thickness, cutout count, and
assembled face. “Isolate selected” is optional and display-only.

Initial selection is the first generated part (`bottom` for current styles).
An empty click clears it and the details region says "No panel selected." If a
regeneration removes the selected key, selection moves to the first part.
Hits on caps, outer sidewalls, or cutout sidewalls select their owning key;
overlap chooses the nearest visible surface. Occluded parts remain selectable
through the part list and, when available, explode/isolate controls.

### 7.4 Dimension and fit facts

Always provide adjacent DOM text for:

- outer and inner width/depth/height;
- material thickness;
- actual per-axis finger count and cell width, not only the requested target;
- designed clearance, explicitly “baked into joints”;
- laser kerf or CNC profile compensation, explicitly “applied later — not
  shown”;
- opt-in CNC relief state and tool diameter;
- physical status before the preview verification suite passes: “Software
  preview only. Physical fit unverified. Use Box Fit Test on the actual
  material.” After that suite passes, the first sentence may become “Preview
  matches the generated software geometry.”

Dimension arrows may supplement the text. Thickness must not be exaggerated;
use edge contrast instead.

Invalid, incomplete, pending, or failed current input never mixes facts from
two specs. The workspace may retain the complete last-valid model, selection,
and camera, but overlays visible text: "Showing last valid preview; current
values are not generated." Its dimensions and fit facts remain explicitly
labeled "last valid"; current issues stay beside the fields; and Generate is
disabled until a fresh result succeeds. With no last-valid model, show the
empty explanation instead of a canvas. A successful worker result swaps the
model and facts atomically.

### 7.5 Accessibility and reduced motion

- Keep controls and the part navigator in semantic DOM.
- The viewport is a named region whose description points to dimensions, fit
  facts, assembly state, and selected-part details.
- Announce selection, stale-preview, and fallback changes with
  `aria-live="polite"`.
- Every pointer action has a visible button, slider, or part-list equivalent.
- The viewport keyboard contract in 7.2 is mandatory; focus has a visible
  indicator, instructions are referenced with `aria-describedby`, and Escape
  returns focus to the 3D-view button.
- Use no auto-rotation. Preset-camera and explosion transitions are at most
  160 ms with ease-out when motion is allowed; direct orbit/pan/zoom is
  immediate. `prefers-reduced-motion: reduce` makes every camera, mode, and
  explosion transition snap with zero animation.
- Preserve contrast in light/dark themes and never encode selection, fit, or
  validity by color alone.

References:
[HTML canvas accessibility](https://html.spec.whatwg.org/multipage/canvas.html),
[WCAG 2.2 keyboard](https://www.w3.org/TR/WCAG22/),
[reduced-motion guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion).

### 7.6 Fallback and performance

The fallback is an improved static Canvas2D/SVG isometric plus the complete DOM
part list, dimensions, and fit facts. It activates for lazy-import failure,
WebGL creation failure, context loss, or preview-only complexity pressure. It
must not blank the viewport or disable Generate.

Acceptance budgets:

- zero new runtime dependencies;
- no eager Three import when the dialog opens;
- current Three vendor chunk remains under the documented 750 KB minified
  ceiling and within 2% of its baseline;
- Box-specific lazy code target: at most 50 KB minified / 15 KB gzip;
- device pixel ratio capped at 2;
- one WebGL context per open dialog;
- render on demand, with no idle animation loop;
- reference model: inner 60 x 40 x 30 mm, closed, T=3, finger=9,
  clearance=0.15, spacing=8, no relief/dividers;
- stress model: inner 600 x 600 x 300 mm, closed, T=3, finger=2,
  clearance=0.15, spacing=8, 20 X and 20 Y dividers, no relief;
- after the lazy chunk is loaded, run three warm-ups and 20 measured builds in
  production Chromium on a recorded four-core/8-GB integrated-GPU reference
  laptop: p95 model-plus-mesh build at most 100 ms for reference and 250 ms
  for stress; record browser/build/hardware and cold-import time separately;
- pointer interaction targets 60 fps; p95 frame time at most 16.7 ms and no
  repeated frame over 50 ms during a scripted 10-second orbit/zoom/explode run;
- keep the scene and camera alive across valid edits; update/dispose meshes
  deterministically;
- repeated open/close testing must show no monotonic resource or listener growth.

Preview complexity is computed from the completed model: use 3D only at
`partCount <= 200`, `ringVertexCount <= 50,000`, and predicted
`triangleCount <= 200,000`. Above any threshold, use Canvas2D/SVG static
preview; above 100,000 ring vertices, use the DOM-only part list/dimensions/fit
facts so the fallback cannot freeze on its own. These are display thresholds,
not generator or downstream-output guards.

On `webglcontextlost`, call `preventDefault()`, announce and enter static mode,
and permit one reconstruction attempt for that loss cycle after
`webglcontextrestored`. Restore camera, selection, explosion fraction, assembly
mode, and theme. A failed attempt stays static until the dialog is reopened:
[WebGL context-loss event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event).

This does not solve BG-002: generation runs before any preview exists. Worker
cancellation and exact work estimation are a pre-visualization program stage.

## 8. Dependency decision

| Option | License | Decision |
|---|---|---|
| Existing Three.js | MIT | **Use.** Already in `package.json`, already noticed in `THIRD_PARTY_NOTICES.md`, lazy-loaded, and provides extrusion, depth buffering, ray picking, and OrbitControls. Reuse CurveDesk's existing camera-preset infrastructure. |
| Canvas2D / SVG | Platform | Keep for the flat view and static fallback. Do not hand-build an orbiting depth-buffered renderer. |
| OGL | Unlicense | Compatible and small, but deliberately lower-level; it would add a second WebGL stack and custom controls/shaders with no product advantage. |
| Babylon.js | Apache-2.0 | Compatible but duplicates the installed scene engine and is broader/heavier than this dialog needs. |
| regl / TWGL | MIT / MIT | Compatible lower-level wrappers; they move scene graph, camera, picking, triangulation, and lifecycle work back into CurveDesk. |
| React Three Fiber + drei | MIT / MIT | Do not add. They add another abstraction/lifecycle layer when CurveDesk already has direct Three infrastructure; the repository's React 18 baseline also needs separate compatibility review. |

Primary sources:
[Three.js repository and MIT license](https://github.com/mrdoob/three.js/),
[OrbitControls documentation](https://threejs.org/docs/pages/OrbitControls.html),
[OGL repository](https://github.com/oframe/ogl),
[Babylon.js repository](https://github.com/BabylonJS/Babylon.js/),
[regl repository and MIT license](https://github.com/regl-project/regl),
[TWGL repository and MIT license](https://github.com/greggman/twgl.js),
[React Three Fiber repository and MIT license](https://github.com/pmndrs/react-three-fiber),
[drei repository and MIT license](https://github.com/pmndrs/drei).

Three imports stay under the ADR-sanctioned `src/ui/viewer3d/` home and remain
lazy. Pure preview data stays in core and contains no Three types. ADR-119
explicitly chose Canvas2D because the old preview needed no camera; the new
orbit/zoom requirement invalidates that premise. Accept a narrow ADR-119
supersession before implementation.

Resolve the current `three@0.180.0` / `@types/three@0.185.0` runtime-type skew
before the 3D PR: either pin types to r180 or upgrade runtime in a separately
verified dependency change. Box code must not rely on an r185-only API while
r180 is shipped.

## 9. Staged repair and review-PR program

Each stage is independently reviewable. No stage merges `main`.

1. **Numeric integrity repair — implemented:** BG-001 was reproduced with
   failing examples and a property test. Direct derived/spacing overflow fails
   validation; combined layout/translation overflow fails closed before a
   `generated` result can escape. Every returned panel coordinate and offset is
   finite.
2. **Slide-lid relief repair — implemented:** BG-015 was reproduced with a
   failing geometry comparison; the decorative lid remains relief-free while
   real joint panels retain relief.
3. **Draft cancellation repair — implemented:** BG-005 was reproduced for
   Cancel and Escape; both now use one persist-and-close handler.
4. **Generation responsiveness PR:** resolve BG-002 before visualization.
   Add a pure work estimate (predicted parts, rings, vertices, and edge/divider
   cells), run generation in a dedicated worker with monotonically increasing
   request IDs, terminate/supersede stale work, show a pending state after
   50 ms, and make dialog Cancel terminate the worker. The estimate informs UI
   and preview mode only; it does not impose an arbitrary output cap.
5. **Contract PR:** resolve BG-003 and BG-013, supersede ADR-119's no-camera
   premise, define `BoxPreviewModel`, stale behavior, compensation language,
   accessibility, and performance budgets. No Three implementation.
6. **Pure preview-model PR:** stable part keys, generation metadata, exact slab
   surfaces, explode
   transforms, and property/metamorphic/golden tests. Correct the static
   fallback's face geometry and overclaim.
7. **Accessible flat foundation PR:** responsive layout, part navigator,
   selected-part synchronization, HiDPI flat renderer, dimensions, fit facts,
   and stale state. No WebGL.
8. **Interactive 3D PR:** lazy Three scene under `src/ui/viewer3d/`, real slab
   extrusion, depth buffering, orbit/zoom/presets, assembled/exploded poses,
   picking, disposal, and static fallback.
9. **Qualification PR:** context-loss recovery, keyboard/screen-reader tests,
   reduced motion, responsive/DPR browser goldens, bundle/performance budgets,
   lifecycle stress, and a documented human visual review.
10. **Output-evidence PR:** Box-specific project round-trip and representative
   laser/CNC G-code goldens. Any G-code snapshot change needs the repository's
   explicit snapshot acknowledgment.

## 10. Physical qualification matrix

No row below was performed in this audit.

| Artifact | Required samples | Measure | Pass evidence |
|---|---|---|---|
| Laser fit coupon | Actual material/batch, intended focus and cut settings; several clearances around expected fit | Kerf, insertion force, visible gap, repeatability across grain/orientation | Photos, caliper readings, winning clearance, material/settings record |
| Laser closed box | Canonical 60 × 40 × 30 mm inner, `T = 3 mm` plus one larger box | Outer/inner dimensions, corner closure, panel interchangeability, scorch/double-cut at layout spacing | Exported project/G-code, photos before/after assembly, measurements |
| CNC fit coupon | Actual stock and intended bit, relief off and on | Tab seating, slot width, corner residue, runout/deflection effects | Tool/stock record, photos, measurements, chosen clearance/relief |
| CNC closed box | Canonical box with profile-outside compensation | Finished dimensions, seating, breakout, relief appearance, assembly force | Project/G-code, toolpath screenshots, cut photos, measurements |
| Dividers | 1×1 and asymmetric multi-divider box | Slot registration, half-lap depth, wall bulge, divider squareness | Measurements and assembly photos |
| Slide lid | Laser and CNC where available | Channel clearance, stop position, repeatable travel, front clearance | Video or sequential photos plus measured play |
| Extremes | Thin stock/small valid box and large practical box | Degenerate fingers, handling, layout/output envelope | Artifacts and operator notes |

Physical proof must name machine, material, measured thickness, tool/kerf,
clearance, relief choice, layer settings, exported artifact hash, and result.

## 11. Ledger history

| Date | Entry | Evidence / result |
|---|---|---|
| 2026-07-31 | Baseline fixed to current `origin/main`; isolated audit branch created. | `e3ace9928163fcd696d074c9f0a54024f8215948`; parent checkout left untouched. |
| 2026-07-31 | Focused source/test baseline completed. | 18 files, 126 tests passed; benchmark 1,114 / 1,114; laser IoU 1.0000; CNC IoU 0.9693. |
| 2026-07-31 | Math, fabrication, integration, persistence, output, preview, dependency, accessibility, and physical-proof boundaries reviewed. | Findings BG-001 through BG-018 above. |
| 2026-07-31 | Visualization dependency selected. | Existing `three@^0.180.0`, MIT, no new dependency; static Canvas2D/SVG fallback retained. |
| 2026-07-31 | Hostile-number and slide-relief probes run through the current TypeScript modules. | Derived overflow and maximum spacing both returned `valid` + non-finite `generated`; shallow slide lid returned `valid` then `error`; CNC relief changed the decorative lid from 18 to 172 points. |
| 2026-07-31 | Real store seeding and downstream compensation path audited. | Fresh CNC operations inherit global On path, contradicting the older Box Outside contract; findings expanded through BG-018. |
| 2026-07-31 | BG-001 initial validation repair completed test-first, then reopened by adversarial review. | The first three tests failed on baseline and passed after derived/spacing checks, but two constant-size survivors still overflowed cumulative layout/translation. |
| 2026-07-31 | BG-001 final returned-output contract repaired. | Both survivor examples plus the rewritten valid-spec property failed first. The centralized output check then passed 3 files / 25 tests; independent branch/mode/fit review found no generated non-finite result. |
| 2026-07-31 | BG-015 repaired test-first. | New lid comparison failed on baseline; after excluding the decorative lid from relief, slide/generator/fit suites passed 30 / 30. |
| 2026-07-31 | BG-005 repaired test-first. | Cancel and Escape persistence both failed on baseline; after the shared close hook, dialog/draft suites passed 23 / 23. |
| 2026-07-31 | Repaired Box bundle verified. | 21 files / 134 tests; benchmark 1,114 / 1,114; laser IoU 1.0000; CNC IoU 0.9693. |
| 2026-07-31 | Final repository and release-gate components passed. | 1,359 test files / 8,190 tests passed (14 files / 22 tests skipped); typecheck, format, both linters, ADR/licence/integrity/size/export checks, web build, and Electron-main build passed. Three chunk 704.87 KB minified; the unrelated 1,006.57 KB UI-workbench build warning remains. |
