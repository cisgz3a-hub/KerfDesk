# Burn Perfection for Small Text in LaserForge Fill Engraving — Final Research Report

**Date:** 2026-06-03
**Subject burn:** Image-traced raster → FILL mode, Falcon A1 Pro (blue diode, GRBL 1.1, `$32=1`), emitted from LaserForge.
**Symptom:** Large shapes clean; small text ("langebaan", a few mm tall) along the bottom is "not very straight and not smooth" — wavy/jagged vertical edges, uneven density.
**Current settings:** power ~30%, feed 1500 mm/min (= 25 mm/s), hatch interval 0.1 mm, fill overscan 5 mm, bidirectional (snake) scanline fill, constant-power M3.

> Produced by the `burn-perfection-research` multi-agent workflow (27 agents: 6 web-research angles, 3 code-grounding, 17 adversarial verifiers, 1 synthesis). 7 candidate causes confirmed, 10 rejected.

> **Codebase provenance (read this first).** The cwd `C:\Users\Asus\LaserForge` is the **disabled LaserForge 1** checkout (`DO_NOT_USE_LASERFORGE_1_DISABLED.txt` → "active development moved to C:\Users\Asus\LaserForge-2.0"). The shipping app is **LaserForge-2.0**, whose fill path is `src/core/output/grbl-strategy.ts` + `src/core/job/fill-sweeps.ts` + `fill-overscan.ts` + `fill-hatching.ts` (kebab-case). All "[VERIFIED-VS-CODE]" tags below cite **2.0** with file:line read directly. Any prior analysis that cited `PlanOptimizer.ts` / `FillGenerator.ts` / `GrblStrategy.ts` (PascalCase) verified against the **disabled LF1** tree and does not describe the burn the user actually produced.

---

## 1. Executive Summary — ranked root causes for THIS symptom

The symptom is a **compound** of two distinct defects. The headline phrase splits cleanly:

- **"uneven density" / blobby** → an **energy-per-mm** problem (power vs. speed). Owned by Cause A.
- **"not very straight / not smooth" wavy vertical edges** → a **geometry** problem (the path itself is wavy). Owned by Cause B, amplified by Cause C.

| # | Root cause | Owns | Tag | Confidence |
|---|-----------|------|-----|-----------|
| **A** | **M3 constant-power + short-scanline accel/decel** — fill emits `M3` (constant power, no velocity scaling) while short text scanlines spend a large fraction of their length below the commanded 25 mm/s; energy/mm spikes in the slow zones. The deferred M4 dynamic-power path is the canonical fix. | uneven density, blobby ends, large-vs-small contrast | **[VERIFIED-VS-CODE]** | **0.7** |
| **B** | **Image-trace-then-fill of tiny glyphs** — potrace on a few-mm word produces a coarse, faceted boundary (16-sample curve flatten + turdsize on ~8-15px-tall glyphs); scanline fill faithfully reproduces every wobble as a non-monotonic run boundary → wavy vertical edges. Fill cannot render text crisper than the vector it is handed. | wavy/jagged vertical edges, "not straight" | **[VERIFIED-VS-CODE]** (mechanism); **[THEORETICAL]** (this user's source DPI unknown) | **0.7** |
| **C** | **Uncompensated bidirectional (snake) fill + short-run overscan skip** — snake direction alternates every scanline with **zero** scan-offset compensation in the fill path, and runs <10 mm get **no** overscan runway (`OVERSCAN_MIN_BURN_RATIO=2`). A constant firing-lag offset alternates sign on each of a glyph's ~5-30 scanlines with no spatial averaging → zipper/serration that reads as waviness; the missing runway puts the accel-from-rest zone inside the glyph. | amplifies both A and B; serration on small text | **[VERIFIED-VS-CODE]** (gaps are real); **[THEORETICAL]** (lag magnitude at 25 mm/s is small) | **0.5** |

**One-line verdict:** Cause A explains the *density*; Cause B explains the *waviness*; Cause C amplifies both specifically on small features. The single highest-value code change is **wiring the deferred M4 dynamic-power path into fill** (kills A). The single highest-value *workflow* change is **engraving small text as native vector, not image-traced fill** (kills B). These are independent and both should ship.

**Why large shapes are fine and small text is not** (the discriminating fact every candidate must satisfy): every error here is **fixed in absolute mm but a large fraction of a small feature**. A 0.6 mm accel ramp, a 0.26 mm trace-pixel facet, or a 0.025-0.05 mm lag zipper is <1% of a 50 mm shape's edge but 10-30% of a ~0.4 mm-wide glyph stem spanned by only a handful of scanlines. Only causes that scale with feature size survive; A, B, C all do.

---

## 2. Per-cause detail

### Cause A — M3 constant-power energy-density error on short scanlines `[VERIFIED-VS-CODE]`

**Mechanism.** With `M3` the laser holds programmed power regardless of head speed. GRBL's own `laser_mode.md`: *"Constant laser power mode simply keeps the laser power as programmed, regardless if the machine is moving, accelerating, or stopped"* and warns you must *"add lead-in and lead-out motions … to give some space for the machine to accelerate and decelerate."* On a 3-4 mm letter, each scanline is a few mm of fill; the head accelerates from rest, and wherever it is slow it deposits **more energy/mm** → darker, blobby, irregular. The slow-zone geometry differs line-to-line → "not smooth."

The canonical GRBL remedy is **M4 dynamic power** (`$32=1`), which scales S by `actual_feed / programmed_feed` so energy/mm stays constant through accel/decel — *"ensures the amount of laser energy along a cut is consistent even though the machine may be … accelerating."* This is exactly what the user **deferred**.

**Verified in 2.0 code:**
- Fill preamble emits `M3 S0` — `grbl-strategy.ts:38`. There is **no** velocity/feed-based S scaling in the fill path: `scaleS()` (`grbl-strategy.ts:27-29`) is called **once per group** at `grbl-strategy.ts:85`; every burn G1 carries that single constant `S` (`sweepSpanLines`, `grbl-strategy.ts:143-169`).
- **Raster, by contrast, emits `M4`** — `emit-raster.ts:76-77` (`M5` then `M4 S0`), with per-pixel S. So the M4 machinery already exists and is proven in production; it is simply **not wired into fill**.
- The deferral is explicit: **DECISIONS.md ADR-020 decision #4** (lines 1295-1300): *"Keep M3 in the first increment… changing Fill from M3 to M4 also changes cut-depth behavior on short hatches… M4 Fill becomes a separate hardware experiment if edge marks remain."* That "short hatches" risk **is this symptom.**

**LightBurn reference.** LightBurn's GRBL default *is* `M4`; it surfaces this as Constant Power Mode (off = dynamic/M4). LightBurn requires Overscanning ≥5% *"to be sure the machine is not slowing down before reaching the ends"* — overscan is the M3 stopgap; M4 is the real fix.

**Parameters / the physics that bounds it.** Ramp-to-speed distance `d = v² / (2a)`. At v = 25 mm/s and the codebase's default `accelMmPerSec2: 500` (`device-profile.ts:87`): **d = 625 / 1000 = 0.625 mm per end.** On a 4 mm stem the first and last ~0.6 mm (~30% of the stroke) burn below feed at constant power → over-burn. With M4, S tracks feed and this flattens with **no** offset calibration. *(Note: 5 mm overscan, when applied, is ~8× the 0.625 mm needed — so inadequate overscan distance is *not* the issue; the issue is M3 + the short-run overscan **skip** of Cause C, plus accel-from-rest *inside* the glyph.)*

---

### Cause B — Image-trace-then-fill of tiny glyphs bakes waviness into the vector `[VERIFIED-VS-CODE]` mechanism / `[THEORETICAL]` for this user's DPI

**Mechanism.** Potrace walks the black/white **pixel boundary**, builds a polygon, smooths corners (alphamax), fits Béziers. Its fidelity is bounded by **input resolution**. A few-mm word rasterized at typical screen DPI is only ~8-15 px tall; a vertical stem is ~1-3 px wide, so the boundary polygon has almost no vertices and the curve fit yields **faceted, stair-stepped, wavy** edges with inconsistent stroke width — *baked into the path*. The FILL scanline algorithm then computes each run's X endpoints by **exact** polygon-edge intersection (`fill-hatching.ts intersectX`, line 220), so every wobble in the noisy outline becomes a non-monotonic left/right run boundary. Fill is faithfully reproducing a wavy vector; **no burn setting fixes a wavy path.**

LightBurn's own docs state outright that during tracing *"fine details — for example sharp corners and small text — may not be converted well,"* with the remedy being to feed the tracer far more pixels (upscale 4-10× before tracing, or use Threshold/raster mode).

**Verified in 2.0 code:**
- Trace curve flattening is **16 cubic samples per curve** — `potrace-trace.ts:15` `POTRACE_CUBIC_SAMPLES = 16`; the smooth→polyline step at `potrace-trace.ts:48-52`.
- Native vector **text** flattens at **12 samples per cubic/quadratic** — `text-to-polylines.ts:66` `CURVE_SAMPLES = 12` — and crucially **bypasses potrace entirely** (opentype.js straight to polylines). So *native* text feeds a far cleaner contour than *traced* text.
- Small features are dropped/filtered pre-trace via `turdsize` (`potrace-trace.ts:36`) and despeckle (audit/AGENT_HANDOFF documents noisy-trace artifacts on small features as a real shipped problem).

**Why it fits the large-vs-small contrast better than any burn-side cause.** A large shape has hundreds of boundary pixels and traces clean; the same trace noise is a negligible fraction of its edge. A burn-side defect (overscan, banding, lag) would also mar large shapes' short scanlines and cannot bend a *straight* commanded edge into a wave. Only resolution-bounded tracing is intrinsically glyph-size-dependent **and** produces wavy outlines.

**Parameters.** Stroke spanned by fill = `stroke_width / interval`. A 0.4 mm stem at 0.1 mm interval = **~4 scanlines** — far too few to average out a wavy boundary. Practical floor for clean filled text ≈ 5-6× the interval in stroke width; below that, use a single-pass vector/centerline. Source target ≈ **≥254-300 DPI at final glyph size**.

**Why [THEORETICAL] on the confidence:** mechanism is live and the regime is plausible, but **this** user's actual source-image resolution / on-screen traced nodes were not observed. A close cousin (trace threshold making 1-px stems blink in/out) looks identical and is cured by the same remedy.

---

### Cause C — Uncompensated snake fill + short-run overscan skip (the amplifier) `[VERIFIED-VS-CODE]` gaps / `[THEORETICAL]` lag magnitude

**Mechanism.** Two real, verified gaps in the fill path, both of which hit *small* features hardest:

1. **No bidirectional (scan-offset) compensation in fill, and snake is unconditional.** Fill alternates scanline direction every row (`fill-hatching.ts:233` `forward = scanIndex % 2 === 0`; `fill-sweeps.ts` preserves the snake). The fill emitter applies **zero** perpendicular/firing-lag offset correction. A constant laser-firing-lag (a *time*) converts to a *distance* = lag × feed, added in +X on L→R rows and −X on R→L rows, so a vertical edge lands at two alternating X positions — LightBurn's "Scanning Offset Adjustment," *"very visible in Ordered"* (the deterministic fill mode the user is on). On a glyph only ~5-30 scanlines tall there is **no spatial averaging** to hide the alternation.
   **Sharpened for 2.0:** unlike LaserForge 1, **there is no per-layer `biDirectional` toggle in `src/core`** (grep confirms snake is hardcoded in `pushScanlineHatches`). So "burn it unidirectional" is **not** a user-exposed option today — it requires a code change. That makes the diagnostic test and the fix the same lever.

2. **Short runs get NO overscan runway.** `OVERSCAN_MIN_BURN_RATIO = 2` (`fill-overscan.ts:41`); `effectiveOverscanMm` returns **0** when `length < 2 × overscanMm` (`fill-overscan.ts:54`). With overscan 5 mm, **every run shorter than 10 mm skips overscan entirely** — and a few-mm glyph scanline is far shorter than 10 mm. So the head rapids straight to the burn start and accelerates from rest **inside** the glyph (the ADR-033 speed/quality tradeoff, intentional). That puts Cause A's 0.625 mm accel zone directly on the marked stroke instead of on a laser-off runway.

**LightBurn reference.** "Scanning Offset Adjustment" (Device Settings) — a per-speed table that shifts alternate rows; and the bi-directional vs uni-directional fill toggle. LaserForge has the *raster* analogue wired but **not** the fill path.

**Parameters / why confidence is capped at 0.5.** Offset = lag × velocity. At 25 mm/s with a typical ~0.5 ms diode lag, per-row offset ≈ 0.0125 mm; the snake zipper (2×) ≈ **0.025 mm** — a quarter of the 0.1 mm interval. Even a pessimistic 2-3 ms lag gives 0.05-0.075 mm/line. LightBurn's guidance says scan-offset matters at **300-500 mm/s**, not 25 mm/s. So on its own the lag zipper is **small** at this feed and probably not the dominant term — but it is real, it is uncorrected, and it stacks coherently on a feature with no averaging. The **overscan-skip** half of Cause C is the more material contributor at 25 mm/s, because it forces accel-from-rest inside the glyph and thereby feeds Cause A.

---

## 3. LaserForge today vs. what it should do

| Behavior | Today (LaserForge-2.0, verified) | Should do |
|---|---|---|
| **Fill laser mode** | **M3 constant power.** `grbl-strategy.ts:38` preamble `M3 S0`; single `scaleS()` per group (`:85`); no velocity scaling. | Emit **M4** for fill on GRBL when `$32=1` (mirror `emit-raster.ts:76-77`), so firmware scales power with instantaneous feed. Resolves Cause A with no calibration. |
| **Raster laser mode** | M4 dynamic + per-pixel S (`emit-raster.ts:76-77`). | (Correct — use as the template for fill.) |
| **Short-run overscan** | **Skipped** when `length < 2×overscan` (`fill-overscan.ts:41,54`). A 5 mm overscan ⇒ runs <10 mm get **0** runway. | For runs below the runway threshold, either route through M4 (then density is firmware-compensated even with no runway), or auto-reduce feed so the achievable cruise span ≥ the marked span. Do **not** simply force full overscan on every tiny run — that re-introduces the ~2h-vs-5min burn ADR-033 fixed. |
| **Bidirectional fill compensation** | **None.** Snake is unconditional (`fill-hatching.ts:233`); no scan-offset applied; **no per-layer uni/bi toggle exists in `src/core`.** | (1) Add a **unidirectional fill option** (per-layer or auto for small features) — eliminates the zipper outright. (2) Optionally wire the existing raster scan-offset corrector into the fill path for calibrated bidirectional correction. |
| **Small-text workflow** | Only path is image-trace → scanline fill. `FillMode`/hatch defaults: interval 0.1 mm, angle 0° (`layer.ts:48-49`). No centerline/single-line/stroke-font path exists. | Offer **native vector text** and a **line/centerline (single-pass)** engrave for small lettering, bypassing trace faceting entirely. Surface a warning when a traced glyph's source height is low (e.g. <~30 px) or a filled stroke is below ~5× the interval. |
| **Trace resolution** | 16-sample curve flatten (`potrace-trace.ts:15`); no documented pre-trace upscaling; turdsize/despeckle drop sub-threshold detail. | Warn on low effective DPI at the traced glyph size; recommend upscaling the source 4-10× or switching tiny text to native vector / raster Threshold mode. |

---

## 4. Prioritized fix plan (proposed ADRs / tickets) — by impact / effort

> **Karpathy's law applies to every item:** the empirical test runs **first**, on the real burn or the emitted G-code, *before* and *after*. A green unit test is necessary but never sufficient — it must be paired with the measured G-code/hardware delta.

### Fix 1 — Wire the deferred M4 dynamic-power path into fill (resolves Cause A) — **highest impact/effort**
- **Change:** Emit `M4` for fill groups on GRBL when the device profile/`$32=1` indicates laser mode, mirroring `emit-raster.ts:76-77`. Per-segment S already exists; the missing piece is the mode flip + (optionally) per-segment S so power tracks feed. Production-path change through the Output layer. Supersedes ADR-020 decision #4.
- **Empirical test FIRST (G-code):** Compile the actual "langebaan" fill job *now* and confirm the bottom-text scanlines emit `M3` with one constant `S` (e.g. `S300`) and **zero** S-modulation along the run (predicted; matches `grbl-strategy.ts:85`). This establishes the baseline the unit test will encode.
- **Empirical test AFTER (G-code + hardware):** Re-emit; assert the fill group now opens `M4` and S is feed-scaled. Then **re-burn only the small text** at identical settings. Confirm-or-kill on hardware: density unevenness/blobbiness on short strokes should substantially flatten. (Pre-confirm the mechanism cheaply: re-burn the small text once at **feed 300 mm/min** with everything else unchanged — the 0.625 mm ramp becomes negligible vs. the marked span; if waviness/density improves markedly at low feed under M3, Cause A is confirmed dominant for the density half.)
- **Unit test (necessary, not proof):** synthetic short-scanline FillGroup → assert M4 emission + feed-scaled S.
- **Safety:** touches g-code emission → "Hardware verification needed" note until confirmed on the Falcon; review all callers of the laser-on emission for M3/M4 contract changes.

### Fix 2 — Native vector / single-pass path for small text (resolves Cause B) — high impact, medium effort
- **Change:** Route small lettering as native vector text (already cleaner: `text-to-polylines.ts` bypasses potrace) and add a **line/centerline single-pass** engrave so crispness is spot-limited, not interval-limited. Warn when a filled stroke is below ~5× the hatch interval or a traced glyph's source height is low.
- **Empirical test FIRST (hardware A/B/C):** Burn "langebaan" three ways at 30%/1500/0.1: **(A)** existing image-traced fill (baseline), **(B)** unidirectional fill of the *same* traced image, **(C)** unidirectional fill (or line) of **native vector text** at the same size. If **C is clean** while A/B are wavy, Cause B (trace faceting) is confirmed and the workflow fix is validated. If B≈C and both clean, the dominant term was Cause C, not B.
- **Empirical test AFTER (G-code):** For one vertical stem in the traced-fill version, collect the left-edge X of each successive scanline burn across the glyph's ~8-15 rows. **Stair-stepped / non-monotonic X (jitter ≳ a fraction of the ~0.26 mm trace-pixel step) = trace faceting confirmed** (the waviness is in the path, identical on forward and reverse rows). Smooth/monotonic X = look elsewhere.

### Fix 3 — Unidirectional fill option + short-run handling (resolves Cause C) — medium impact, low-medium effort
- **Change:** (a) Add a per-layer/auto **unidirectional fill** mode (today snake is hardcoded — `fill-hatching.ts:233`, no toggle in `src/core`). (b) For sub-runway runs, prefer M4 (Fix 1) over forcing overscan; optionally wire the raster scan-offset corrector into fill for calibrated bidirectional correction. Do **not** revert ADR-033's short-run skip wholesale.
- **Empirical test FIRST (G-code):** Confirm two adjacent opposite-direction scanline rows crossing the same vertical stem emit **bit-identical** burn-start/burn-end X (predicted — fill applies no offset). This proves any hardware zipper is physical, curable only by unidirectional or a calibrated offset.
- **Empirical test AFTER (hardware):** This is test (B) of Fix 2. If unidirectional collapses the alternating serration → Cause C's zipper confirmed. If waviness persists unchanged unidirectional → Cause C is *not* dominant (points back to B or to mechanics).
- **Note:** at 25 mm/s the lag zipper is ~0.025-0.075 mm — small. Expect this fix to help *small* text noticeably only if the user's lag is on the high end; the overscan/M4 interaction is the larger lever.

### Fix 4 (optional, hardware-only) — Falcon firmware accel/jerk tuning — low/uncertain, no LaserForge code change
- **Change:** none in LaserForge (it only *reads* `$120/$121/$11` from the `$$` dump for its ETA/estimator; it never writes them). User-side: try lowering `$120/$121` (e.g. 500) and review `$11` if ringing is suspected.
- **Empirical test FIRST:** Re-burn the small text at **300 mm/min** vs 1500 (Fix 1's pre-confirm). Mechanical ringing scales with the reversal impulse; if edges straighten at low feed it could be ringing *or* the M3 ramp (both improve) — so this is weakly diagnostic. Do **not** ship anything on "probably ringing" (CLAUDE.md hard rule). Treat as last resort after Fixes 1-3.

**Recommended ship order:** Fix 1 → Fix 2 → Fix 3. Fixes 1 and 2 are independent and attack the two different halves of the symptom; ship both. Fix 4 is a user-side tuning note, not a ticket.

---

## 5. "Verify on hardware" checklist

Run on the user's Falcon A1 Pro. The decisive discriminators are starred.

1. **★ G-code baseline (no burn).** Compile the actual "langebaan" job. For the bottom-text scanlines (<10 mm extent), confirm: preamble `M3 S0`; each short run is `G0 …S0` straight to burn start (no lead-in runway, per `OVERSCAN_MIN_BURN_RATIO`); each burn `G1 …F1500 S300` at one constant S; zero S-modulation; M4 count = 0. *(Confirms Causes A + C structurally before touching the machine.)*
2. **★ Feed-drop confirm (Cause A).** Re-burn **only** the small text at **300 mm/min**, everything else identical. Markedly smoother density/edges ⇒ M3 accel/decel energy-density is dominant for the density half.
3. **★ A/B/C burn (Causes B vs C).** Same word at 30%/1500/0.1: (A) traced fill, (B) unidirectional fill of same trace, (C) unidirectional fill **or line** of native vector text. C clean & A/B wavy ⇒ trace faceting (B). B≈C clean ⇒ bidirectional zipper (C). All three wavy ⇒ mechanical/firmware (Fix 4).
4. **Trace-node inspection (Cause B, screen-side).** Zoom the traced glyph and show points. Sparse, stair-stepped nodes on a stem ⇒ trace faceting; no burn setting will fix it — re-trace from ≥254 DPI source or use native vector.
5. **Per-scanline X scan (Cause B, G-code-side).** For one vertical stem, plot left-edge X across its rows. Non-monotonic / stair-stepped (≳ fraction of 0.26 mm) ⇒ waviness baked into the vector. Smooth ⇒ not trace.
6. **After Fix 1.** Re-emit; assert fill group opens `M4` with feed-scaled S. Re-burn small text; density unevenness should flatten without offset calibration.
7. **After Fix 2/3.** Confirm native-vector/line path and unidirectional option are reachable; re-run test 3 and confirm C is crisp.
8. **Belt/optics sanity (Fix 4 only if 2-5 inconclusive).** Loose-belt/backlash check via a slow square-spiral vector; lower `$120/$121` incrementally and re-burn. Hardware-side only — no LaserForge change.

---

### Sources cited inline
- **GRBL** `laser_mode.md` (constant vs dynamic power; lead-in/out requirement; M3/M4; `$32`).
- **LightBurn** docs: Constant Power Mode / dynamic power default; Overscanning ≥5%; Scanning Offset Adjustment ("very visible in Ordered"); Trace Image ("small text… may not be converted well", upscale / Threshold remedy); Fill bi- vs uni-directional.
- **LaserForge-2.0 (live tree):** `src/core/output/grbl-strategy.ts:27-29,38,84-169`; `src/core/job/fill-overscan.ts:41,47-55`; `src/core/job/fill-sweeps.ts:84,233`; `src/core/job/fill-hatching.ts:220,233`; `src/core/raster/emit-raster.ts:76-77`; `src/core/devices/device-profile.ts:87`; `src/core/scene/layer.ts:48-49`; `src/core/trace/potrace-trace.ts:15,36,48-52`; `src/core/text/text-to-polylines.ts:66`; `DECISIONS.md` ADR-020 #4 (1295-1300), ADR-033 (1472).
