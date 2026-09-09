# Laser burn-quality — complete findings register & fix plan (2026-07-17, rev 2)

**What this is:** every finding from the combined burn-quality audit — the
six-agent audit, the Codex audit, an adversarial refute-pass, and Codex's
round-2 rebuttal — each stated once with its **final verdict** and a clear
**disposition**. Backing evidence: [2026-07-17-laser-burn-quality-audit.md](2026-07-17-laser-burn-quality-audit.md).

**Status:** report-only per CLAUDE.md #1 — no source changed. "Will fix" is the
recommended plan; I implement on your go-ahead, smallest reviewable diff first.
No new blocking guards proposed (ADR-206).

**Rev 2 changes (from Codex round 2, verified in this worktree):**
- **F3 REMOVED — false positive.** Same-layer fill overlap cancelling is
  deliberate (ADR-019 "even-odd rule"), test-pinned as *intent*
  (`compile-job-fill.test.ts:120` — "without double engraving the overlap"), and
  LightBurn-parity. My proposed union/nonzero fix would have **broken parity and
  violated an ADR**. Root error: my adversarial pass argued from SVG's default
  `nonzero`, but **LightBurn is the reference, not the SVG spec** (CLAUDE.md #3).
- **F4 fix rewritten** — must isolate text vs vector winding, *not* honour
  arbitrary SVG fill-rule (that would break the even-odd parity F3 just confirmed).
- **F10 rewritten** — fill spacing is already clamped (`fill-hatching.ts:45`
  `MIN_HATCH_SPACING_MM = 0.05`); the real gap is imported **image** density.
- **N2 reopened → F21** — the UI promises pixels "as-is"
  (`CutSettingsImageFields.tsx:80`) but only resampling is skipped.
- **N4 → F14 upgraded, N3 → F15 refined** (object overrides / override staleness).
- **5 new findings adopted from Codex round 2**: F16 (scaled-Bézier tolerance —
  High), F17, F18, F19, F20.
- **H3 reclassified** — viewBox import scale is a deterministic policy/UX decision,
  not a hardware question.

**Headline:** the **core energy path remains verified correct** — power scaling,
`mm/min` speed with no 60× bug, beam-off integrity. The highest-impact defects are
**photo resampling (F1)** and **scaled-curve tolerance (F16)**.

---

## At a glance

**Will fix — 18 findings**

| ID | What's wrong | Severity |
|---|---|---|
| F1 | Photo engrave resamples nearest-neighbour → aliasing/lost tone | High |
| F16 | Scaled Bézier curves exceed the promised 0.025 mm tolerance | High |
| F2 | Kerf containment is per-path → separate-object holes grow instead of shrink | Med-High |
| F17 | Job Review omits effective per-object settings | Med-High |
| F4 | One text object flips the whole layer's fill winding | Medium |
| F5 | `.lbrn` import drops all cut settings but speed/power/passes/mode | Medium |
| F6 | `.clb` import drops provenance → masquerades as a vetted starter | Medium |
| F18 | `.clb` import silently loses kerf compensation | Medium |
| F7 | Material "Link" skips the mismatch confirmation "Apply" enforces | Medium |
| F8 | Shipped 5-line autofocus preset is rejected by the single-line runtime | Medium |
| F9 | Smoothieware raster power collapses (30% → no burn; 80% → ~S0.001) | Medium (Smoothie-only) |
| F21 | "Pass-through" still applies brightness/gamma/invert/mask/dither | Medium |
| F14 | Preview uses the raw layer; compile applies object overrides | Medium |
| F15 | Unknown override cache reads as baseline; overrides absent from freshness check | Medium |
| F20 | Error-diffusion preview dithers before orientation; emit orients first | Low-Med |
| F10 | Imported **image** settings can reach extreme density (~1000 lines/mm) | Low-Med |
| F11 | Stacked image adjustments band (8-bit clamp between stages) | Low-Med |
| F12 | Thin features between scanlines vanish | Low-Med |
| F13 | Air-assist intent not warned when the device can't actuate it | Low |

**Won't fix — not a defect / by-design / documented (6)**

| ID | Claim | Why it stays |
|---|---|---|
| N1 | Differing-power fill overlap "double-burns" | Expected — can't burn one region at two powers in a pass |
| **N9** | **Same-power fill overlap cancels (ex-F3)** | **Deliberate: ADR-019 even-odd, LightBurn parity, test-pinned as intent** |
| N5 | Grayscale white→S0 "ignores min power" | Min power honoured except exact white; clean-highlights choice |
| N6 | Vector line defaults to M3 | Documented ADR-036; `$32=1` forces beam dark on travels |
| N7 | Vector Min Power dropped | Correct scope — LightBurn limits Min Power to DSP controllers or grayscale images (**not** the `$31` rationale rev 1 gave) |
| N8 | viewBox-only SVG = 1 unit/mm | Documented ADR-046 decision (see P1 to reconsider) |

**Needs calibrated hardware (2)** — H1 scan-offset sign, H2 high-feed overscan.
**Policy decision, no hardware needed (1)** — P1 viewBox-only import scale (ex-H3).

---

## Section A — Will fix

### F1 — Photo engraving resamples nearest-neighbour — High
**Wrong:** `resampleLumaNearest` ([luma-resample.ts:27](src/core/raster/luma-resample.ts:27))
single-samples with no area averaging and is the only resampler between the stored
image and the burn grid → aliasing, moiré, lost hairlines, wrong local tone into
the ditherer. Logged as TRC-03 in a prior audit; never implemented.
**Scope (Codex):** affects the **materialized *and* streamed** raster paths **and**
the previews — all three call the same helper.
**Fix:** area-averaging (box) for downscale, bilinear for upscale, applied once into
the burn grid before dithering; update all three call sites. Verify by rendering.

### F16 — Scaled Bézier curves exceed the promised 0.025 mm tolerance — High *(new, Codex round 2)*
**Wrong:** curves are flattened in **object space** at `DEFAULT_MACHINE_CURVE_TOLERANCE_MM`
(0.025 mm) by `compilationPolylines` ([compile-job.ts:443](src/core/job/compile-job.ts:443)),
and the object transform is applied **afterwards**
([compile-job.ts:424](src/core/job/compile-job.ts:424)). So chord error scales with
the object: a 20× scaled object measured **0.1465 mm** machine-space deviation
against a nominal 0.025 mm (Codex's measurement). The constant is *named* for
machine space but is not enforced there. Existing coverage is identity-transform
only (`compile-job-curves.test.ts`). Also affects CNC and preparation-complexity
estimates.
**Symptom:** visible faceting on scaled-up curves — the exact fidelity promise the
tolerance exists to make.
**Fix:** flatten with a transform-aware tolerance (divide by the transform's max
scale factor) or flatten after transforming to machine space. Add scaled-transform
test cases. *(Note: SVG `<circle>`/`<ellipse>` already facet scale-aware via
`arcPolygon(..., scale)` — this is Bézier paths specifically.)*

### F2 — Kerf containment is per-path → separate-object holes grow — Med-High
**Wrong:** `closedForKerf` is scoped inside the per-path loop
([compile-job.ts:422](src/core/job/compile-job.ts:422)), so inner/outer orientation
is decided per path. A 10 mm hole that is a **separate object** inside a 30 mm ring
reads as its own outer contour: +1 mm kerf gives 32/**12** mm instead of 32/**8** mm.
An imported single-path donut works (`parse-svg.ts` buckets same-colour geometry
into one ColoredPath).
**Fix:** gather all of a layer's closed contours, then orient by containment across
the whole set. Test two separate nested objects + kerf.

### F17 — Job Review omits effective per-object settings — Med-High *(new, Codex round 2)*
**Wrong:** objects can override mode, power, speed, passes, air assist, fill and
raster settings ([scene-object.ts:85](src/core/scene/scene-object.ts:85)) and
compilation honours them, but the review table renders only layer/sub-layer values
([JobReviewLayersTable.tsx:89](src/ui/laser/job-review/JobReviewLayersTable.tsx:89)).
The operator can approve safe-looking defaults while an object emits materially
different settings.
**Fix:** render the **effective compiled groups** (post-override) in Job Review, or
flag rows whose objects carry overrides.

### F4 — One text object flips the whole layer's fill winding — Medium *(fix rewritten)*
**Wrong:** `fillRuleForLayer` returns `nonzero` iff **any** text object is on the
layer, else `evenodd` — layer-wide ([fill-rule.ts:5](src/core/job/fill-rule.ts:5)).
Adding a text label to a layer therefore changes how the layer's *vector* geometry
fills. The SVG `fill-rule` attribute is also never parsed.
**Fix (corrected):** isolate winding **per geometry kind** — nonzero for text
glyphs (they need it), even-odd for vector geometry (ADR-019 / LightBurn parity per
N9). **Do not** "honour every SVG fill-rule" — that was rev 1's fix and it would
break the parity N9 confirms.

### F5 — `.lbrn` import drops every cut setting but speed/power/passes/mode — Medium
**Wrong:** `lbrn-import.ts:103-114` reads only speed (×60), maxPower, passes, type;
interval, min-power, air, scan angle, overscan, bidirectional, cross-hatch, kerf,
fill-style, dither silently fall back to app defaults.
**Fix:** map the remaining fields; record genuinely-unmappable ones as documented
lossy notes rather than silent defaults.

### F6 — `.clb` import drops provenance → masquerades as a vetted starter — Medium
**Wrong:** `clb-import.ts:89-98` omits `confidence`, `laserModel`, `opticalPowerW`,
`wavelengthNm`, `warning`, so `recipeConfidence` defaults to `'starter'` — the same
trust tier as researched presets, with no mismatch/scrap-test warning possible.
**Fix:** set `confidence: 'imported'`, carry what's available, surface an
"imported, unverified — run a scrap test" note. (`.clb` genuinely lacks
wattage/wavelength; the `'imported'` tag is fully in our control.)

### F18 — `.clb` import silently loses kerf compensation — Medium *(new, Codex round 2)*
**Wrong:** `MaterialRecipe` supports kerf, but [clb-import.ts:101](src/io/lightburn/clb-import.ts:101)
never maps LightBurn's `kerf` field; a real corpus fixture carries nonzero kerf, and
the test explicitly accepts the field as unsupported (`clb-external-corpus.test.ts`).
Imported cutting recipes lose dimensional compensation.
**Fix:** map `kerf` → `kerfOffsetMm` on import; update the corpus test.

### F7 — Material "Link" skips the mismatch confirmation "Apply" enforces — Medium
**Wrong:** Apply runs the warning confirmation
([MaterialLibraryRecipeControls.tsx:36](src/ui/layers/MaterialLibraryRecipeControls.tsx:36));
Link ([:50](src/ui/layers/MaterialLibraryRecipeControls.tsx:50)) writes the same
power/speed and binds it with no acknowledgement.
**Fix:** run the same `jobAwareConfirm(warnings…)` on Link. An **acknowledgement**,
not a block — ADR-206-safe.

### F8 — Shipped 5-line autofocus preset is rejected by the single-line runtime — Medium
**Wrong:** `AutofocusEditor.tsx:28` ships a five-line probe macro; the runtime
rejects any newline ([autofocus-action.ts:74](src/ui/state/autofocus-action.ts:74)),
so the "GRBL probe (Z-axis machines)" preset can never run.
**Fix — needs design (Codex is right that rev 1 under-specified this):** naive
line-by-line execution is unsafe — a partial failure after `G91` leaves the
controller in **relative mode**, corrupting every later move. Any fix must either
restore modal state on failure (`G90` in a finally-path), validate/execute the macro
atomically, or ship a single-line preset. Decide the approach before coding.

### F9 — Smoothieware raster power collapses — Medium (Smoothie-only)
**Wrong:** raster S is dithered at compile against the real `maxPowerS = 1`
([compile-job-raster.ts:53](src/core/job/compile-job-raster.ts:53)) before the
strategy's virtual-1000 rescale ([smoothieware-strategy.ts:19](src/core/output/smoothieware-strategy.ts:19)).
Severity detail (Codex): a **30% raster quantizes to no burn at all**; 80% emits
~`S0.001`. Vectors are unaffected. Profile is simulator-verified-only.
**Fix:** compile raster against the virtual scale (or compute raster S in-strategy).

### F21 — "Pass-through" still applies brightness/gamma/invert/mask/dither — Medium *(reopened N2)*
**Wrong:** the UI promises *"Use the image pixels **as-is** and skip KerfDesk image
processing"* ([CutSettingsImageFields.tsx:80](src/ui/layers/CutSettingsImageFields.tsx:80)),
but `compile-job-raster.ts:49-50` runs `applyLumaAdjustments` + `maybeInvertLuma`
unconditionally before the pass-through check at `:56`, and dithering still runs —
only **resampling** is skipped. Rev 1 dismissed this on the *internal* contract
(`pre-emit.ts` says resolution-only); the **user-facing promise** is the one that's
broken.
**Fix:** either honour the promise (skip tone/dither when pass-through is on) or
correct the UI text to "skip resampling — use native pixel resolution". A product
call; the two must agree.

### F14 — Preview uses the raw layer; compile applies object overrides — Medium *(upgraded N4)*
**Wrong:** the preview builds from the raw layer
([draw-raster-preview.ts](src/ui/workspace/draw-raster-preview.ts) →
`processed-bitmap.ts:81` reads `layer.power`/`layer.minPower`/`layer.ditherAlgorithm`),
while compilation applies per-object overrides
([compile-job-raster.ts](src/core/job/compile-job-raster.ts)). Mode, power, dither
and other effective settings can therefore preview differently — **or not preview at
all**. (The absolute-power normalization noted in rev 1 is the *minor* part; this is
the real divergence.)
**Fix:** build the preview from the same effective (post-override) settings compile
uses.

### F15 — Unknown override cache reads as baseline; overrides absent from freshness check — Medium *(refined N3)*
**Wrong:** rev 1 correctly refuted "overrides aren't surfaced" — *known* overrides
**are** shown in warning tone ([job-review-live-rows.ts:60](src/ui/laser/job-review/job-review-live-rows.ts:60)).
But: `ovCache === null` is treated as **baseline** rather than unknown
([job-review-format.ts:83](src/ui/laser/job-review/job-review-format.ts:83)), and
override state is **missing from the final review-freshness comparison**
([start-job-authorization.ts:79](src/ui/laser/start-job-authorization.ts:79)), so an
override that changes after review isn't re-flagged.
**Fix:** render unknown as "unknown", and include override state in the freshness
comparison. Surfacing/warning only — not a new block.

### F20 — Error-diffusion preview dithers before orientation; emit orients first — Low-Med *(= my IMG-3; Codex ranks Medium)*
**Wrong:** compile orients pixels **then** dithers
([compile-job-raster.ts:148](src/core/job/compile-job-raster.ts:148)); the preview
dithers **then** orients via the canvas ([processed-bitmap.ts:62](src/ui/raster/processed-bitmap.ts:62)).
Floyd–Steinberg is not flip-invariant, so the dot layout differs.
**My calibration:** tone and density match — only exact dot placement differs, so I
hold this at **Low-Med** rather than Codex's Medium. Still a real preview/burn
divergence worth aligning.
**Fix:** orient before dithering in the preview path too.

### F10 — Imported **image** settings can reach extreme density — Low-Med *(rewritten)*
**Wrong:** rev 1 claimed "no floor at compile" — **incorrect**: fill hatching
already clamps (`fill-hatching.ts:45`, `MIN_HATCH_SPACING_MM = 0.05`, "clamp at the
algorithm boundary"). The real remaining gap is **imported image** settings reaching
extreme `linesPerMm` (≈1000 lines/mm) with only UI-side bounds.
**Fix:** apply the raster lines/mm bounds at import/normalize, not just in the
dialog. (The raster budget may reject the job as too-large first — confirm which
fires.)

### F11 — Stacked image adjustments band — Low-Med
**Wrong:** brightness, contrast and gamma each round/clamp to `Uint8` before the
next ([luma-adjust.ts:15](src/core/raster/luma-adjust.ts:15)); stacked adjustments
blow highlights and stair-step gradients.
**Fix:** compose into one curve applied once at continuous precision.

### F12 — Thin features between scanlines vanish — Low-Med
**Wrong:** the first scanline snaps to a global grid
([fill-hatching.ts:101](src/core/job/fill-hatching.ts:101)); a sub-interval region
between grid lines gets `scanCount = 0` and disappears.
**Fix:** guarantee ≥1 scanline through any closed region with real area.

### F13 — Air-assist intent not warned when the device can't actuate it — Low
**Wrong:** a layer/preset with `airAssist: true` on a device whose command is
`'none'` (and whose air isn't `'built-in'`) emits nothing and shows only a neutral
Job Review fact. *(Non-issue for the shipped Neotronics — its air is `'built-in'`
hardware.)*
**Fix:** warning tone when a layer requests air the device can't actuate. Per Codex,
inspect **effective compiled groups** (including sub-layers and object overrides),
not just layer values.

---

## Section B — Won't fix (not a defect)

- **N9 (ex-F3) — Same-power fill overlap cancels.** Deliberate: ADR-019 decided
  "scanline polygon fill, **even-odd rule**"; `compile-job-fill.test.ts:120` pins it
  with explicit intent ("without double engraving the overlap"); it matches
  LightBurn's Fill Mode. Changing it to union/nonzero would **break parity and
  violate an ADR**. *Rev 1 had this as a will-fix — that was my error.*
- **N1 — Differing-power fill overlap double-burns.** You cannot burn one region at
  two powers in a pass; LightBurn fills independently-powered shapes independently.
- **N5 — Grayscale white→S0.** Min power applies to every shade except exactly luma
  255; white→beam-off keeps highlights clean. Defensible; diverges only for
  relief/depth work.
- **N6 — Vector line defaults to M3.** ADR-036; `$32=1` forces beam-dark on travels.
- **N7 — Vector Min Power not exposed.** Correct scope — **LightBurn limits Min
  Power to DSP controllers or grayscale images**. *(Rev 1's "$31 floor" rationale
  was misleading; the conclusion stands, the reasoning didn't.)*
- **N8 — viewBox-only SVG = 1 unit/mm.** ADR-046. See P1.
- Also not defects: duplicate stacked geometry (LightBurn parity), nearest-neighbour
  path order (LightBurn parity), no per-pass Z / no Fill+Line (feature gaps), dead
  `bidirectionalScanOffsetMm` preview field (harmless; delete in cleanup).

---

## Section C — Needs calibrated hardware

- **H1 — Scan-offset reverse-shift sign may be inverted.**
  [scan-offset.ts:75](src/core/job/scan-offset.ts:75) shifts reverse rows *along*
  travel for a positive offset; first-principles says cancelling firing lag needs the
  shift *against* travel, so entering the measured separation could **double** the
  zipper. Opt-in, off by default. Burn the calibration pattern before any fix.
- **H2 — High-feed overscan sufficiency.** Raster overscan is fixed at 5 mm
  ([compile-job-raster.ts:111](src/core/job/compile-job-raster.ts:111)); needed
  runway grows with feed (~40 mm at 12000 mm/min). Burn at high feed and inspect the
  leading edge. Fine at the 1500 mm/min default.

## Section D — Policy decision (no hardware needed)

- **P1 (ex-H3) — viewBox-only import scale.** ADR-046 keeps "viewBox only → 1 mm"
  and defers a LightBurn-style import-DPI control; a px-authored viewBox-only file
  therefore burns 3.78× oversized. Codex is right that this is a **deterministic
  import-policy/UX decision, testable without a machine** — not a hardware question.
  Your call whether to add the control now.

---

## Section E — Verified correct (with qualifications)

Both audits confirm the load-bearing energy path: percent→S is
`round(power% × $30)`, clamped 0–100%, never exceeding S-max, property-tested across
`$30 ∈ {100,255,1000}`; **speed is `mm/min` end-to-end with zero conversions — the
60× error class does not exist**; every travel is `S0`, every abort/Stop/Fire forces
`M5`; `$30` mismatch and `$32=0` block Start; single Y-flip; tonality sign correct;
dither kernels match published constants; hidden+output=on still burns.

**Qualifications (Codex round 2, accepted):**
- "Live controller state" means **same-session cached observations**, not continuous
  polling.
- Neotronics absolute jobs emit `M5` but **do not always park**.
- Non-realtime Marlin Stop **queues** `M5` — it cannot guarantee an immediate
  physical stop.
- Manual Fire and job emission use **equivalent but duplicated** power math, not a
  single source — a drift risk worth consolidating.

---

## Fix sequencing (proposed)

Each row is a separate small PR with a test. Nothing starts until you approve.

1. **F1** photo resample (all three call sites: materialized, streamed, preview)
2. **F16** scaled-Bézier tolerance (transform-aware flattening + scaled tests)
3. **F2** cross-object kerf containment
4. **F17** Job Review effective per-object settings
5. **F21 / F14** pass-through contract + preview-vs-compile overrides (decide the
   product contract first)
6. **F6 / F18 / F7** `.clb` provenance + kerf + Link acknowledgement
7. **F5** `.lbrn` field mapping · **F4** text/vector winding isolation
8. **F8** autofocus (design the modal-safe approach first) · **F9** Smoothie raster
9. **F15 F20 F10 F11 F12 F13** remaining
10. **H1/H2** after calibrated hardware burns; **P1** on your policy call

Then run the controlled burn matrix before certifying any recipe.

**Note:** both audit documents are currently **untracked** in this worktree — say
the word and I'll commit them.
