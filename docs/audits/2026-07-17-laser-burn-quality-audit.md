# Laser burn-quality audit (combined) — 2026-07-17

**Scope:** the physical burn. From the moment an operator sets a layer's cut
settings (mode Line/Fill/Image, power %, speed, passes, interval/DPI, air, …)
and presses Start, does the emitted G-code deliver the energy and geometry
those settings promise, and will the result look like the artwork on wood?

**This document merges two independent audits and re-verifies both:**

1. **The six-agent audit** (this session): parallel static passes over power,
   speed/motion, geometry, fill, image/raster, and settings/presets. IDs like
   `FIL-1`, `IMG-1`, `SET-1`.
2. **The Codex audit** (supplied by the maintainer): an independent pass with
   strong coverage of the UI/preview/readiness/material-library layer. IDs
   `Codex #n`. **Codex audited a different checkout** (`continuous-audit-source`),
   so its line numbers do not always map to this worktree — every Codex claim
   below was re-checked against **this** tree and its file:line re-anchored here.

Each merged finding carries its **source** (Mine / Codex / Both) and my
**verification verdict** from re-reading the code in this worktree.

**Method / limits:** read-only, report-only (CLAUDE.md #1 — findings are for the
maintainer to triage; no fixes applied, no new guards proposed per ADR-206).
`node_modules` is absent, so **nothing was run, rendered, or hardware-tested** —
every "physical symptom" is a predicted consequence of the code, not an observed
burn. Green tests are not fidelity proof, and some tests here *pin* the
undesirable behaviour (e.g. the blank fill overlap), so a passing suite does not
invalidate these findings (CLAUDE.md #2). `PROJECT.md:107` itself records that
physical raster burning is still pending — there is no hardware-evidence bundle
proving tone/focus/char/kerf/air/cut-through.

---

## Headline

**The core energy path is correct and well-tested; both audits agree on this.**
Speed is mm/min end to end and the `F` word is `round(speed)` with **zero unit
conversions** — the 60× mm/s↔mm/min error class does not exist here. Power maps
deterministically as `round(power% × configured $30)`, clamped 0–100%, never
exceeding S-max, property-tested across `$30 ∈ {100,255,1000}`. Rapids emit `S0`;
fill/raster default to M4 dynamic; every abort/Stop/Fire forces `M5`. A live
`$30` mismatch or `$32=0` blocks Start.

The defects are in **secondary quality features** — air-assist wiring, photo
resampling, fill-overlap topology, the raster preview's faithfulness, pass-through
semantics, cross-object kerf, and LightBurn-import fidelity. The two audits are
**complementary**: Codex is strongest on the UI/preview/material-library/readiness
surface; the six-agent audit is strongest on the fill-rule/units/kerf/scan-offset
internals and the verified-good baseline. An **adversarial re-audit then re-ranked
both** (see "Re-audit" below): it downgraded my own #1 (air assist — the flagship
machine has built-in hardware air), refuted two findings (pass-through processing;
"laser overrides not surfaced"), and left the two genuinely unmitigated
burn-fidelity defects as **photo nearest-neighbour resampling (BQ-3)** and
**cross-object kerf containment (BQ-12)**. The lesson cuts both ways: Codex
over-stated some UI findings, and two of my own auditors over-stated the preview
and pass-through calls.

---

## Merged findings, ranked by physical impact

Verdict legend: **CONFIRMED** (re-verified in this tree) · **CONFIRMED-refined**
(true, but I tightened the scope/severity) · **SUSPECTED** (needs hardware/render)
· **FLAGGED** (I dispute Codex's framing/severity — see Corrections) · **PENDING**
(re-verification agent running at time of writing).

### Tier 1 — real defects that degrade or wreck a burn

**[BQ-1] Fill overlap flips between UNBURNED and DOUBLE-BURNED depending on object power — P1/High — Both (my FIL-1 + Codex #1) — CONFIRMED**
Two overlapping same-colour filled shapes on one layer: at **equal** power they
share one fill group and hatch under global even-odd, so the overlap is toggled
off and **burns white**; at **different** object powers they split into separate
groups (`compile-job.ts:118-122`) that each hatch independently
(`vectorGroupsForLayer` collects only its own objects, `:158-173`), so the overlap
is covered twice and **burns at double energy**. The canvas preview looks solid
either way. My audit found the unburned half; Codex added the power-triggered
double-burn half. Non-text fill always uses even-odd (`fill-rule.ts:5`);
`fill-hatching-nonzero.test.ts:11` pins the union behaviour the even-odd path
lacks. **Adversarial-pass carve-out:** only the **equal-power unburned overlap** is
a genuine defect (it diverges from SVG's own default `nonzero`, and the repo
already ships the `nonzero` fix — just gated to text layers). The
**differing-power double-burn is expected and unavoidable** — you cannot burn one
region at two powers in a single pass, and LightBurn also fills
independently-powered shapes independently. *Symptom:* white seams in overlapping
same-power filled artwork (the fixable half). *Fix:* union / `nonzero` for non-text
equal-power fills — a compilation change, not a guard.

**[BQ-2] Per-layer air-assist checkbox emits no G-code air command on any profile — Medium (was ranked #1; DOWNGRADED by adversarial pass) — Both (my SET-1/PWR-3 + Codex #11) — OVERSTATED**
`groupCoolantMode` returns `off` when `device.airAssistCommand === 'none'`
(`grbl-strategy.ts:335-338`), every profile inherits `'none'`
(`device-profile.ts:308,338`), and the Neotronics cut presets ship
`airAssist: true` (`neotronics-4040-presets.ts:64,73,81,90`) — all true. **But the
adversarial re-audit corrected the physical conclusion:** the Neotronics laser is
`airAssist: 'built-in'` (`device-profile.ts:371`) — hardware/always-on air, **not**
M7/M8-driven — so emitting no air command is *likely correct for the flagship wood
machine* (its air fires from hardware; line 373 even flags "confirm air-assist
wiring during setup"). A production path also exists to set `airAssistCommand:'M7'`
(`air-assist-default-actions.ts:78`, JogPad Manual Air + a Device Settings
dropdown), and Job Review shows an "Air assist command: Not configured" fact
(`job-review-live-rows.ts:98-101`). *Residual real gap (Medium→Low):* that Job
Review fact is **neutral tone, not a warning**, and is **not cross-checked against
a layer's air-assist intent**, so a hypothetical machine with software-controlled
air left at `'none'` gives a silent no-op with only a neutral mention. *Fix (not a
guard):* upgrade the fact to `warning` tone when a layer requests air but the
device command is `'none'` and air isn't `'built-in'`. My original "pump never
fires → charring on plywood" framing was wrong for the shipped machine.

**[BQ-3] Photo engraving resamples nearest-neighbour — aliased, less faithful than LightBurn — P2/High — Both (my IMG-1 + Codex #2) — CONFIRMED**
`resampleLumaNearest` (`luma-resample.ts:27-46`) picks a single source pixel per
output cell with no area averaging, and it is the only resample between stored
source luma and the dithered burn grid. Codex's repro: an alternating black/white
strip downscaled by half reproduced entirely white. Import-time downscale uses
`resizeQuality:'high'`, so the pipeline is high-quality at import but nearest at
compile. *Symptom:* missing hairlines/texture, moiré, banding, alignment-dependent
tone on any photo scaled down or engraved below source resolution.

**[BQ-4] Raster preview is not output-faithful — P2 (Codex: High) — Codex #3 — CONFIRMED-refined (corrects my IMG-3/E)**
Three separate issues, all verified here: (a) the main canvas preview normalizes
by the layer's power-scaled max — `sMax = powerToSMax(layer.power, …)` then
`rasterPreviewRgba(sValues, sMax, …)` (`processed-bitmap.ts:81,87`) — so a 10%-power
and a 100%-power engrave render **identically dark**; (b) the Adjust Image dialog
**hardcodes `sMax = 1000`** (`AdjustImageDialog.preview.ts:65`), so you tune
brightness/gamma/min-power against a preview that assumes full power; (c) the
preview reads `layer.power`/`layer.minPower`, **ignoring per-object overrides**.
My image auditor verified the dither *pattern* and adjustment *order* match
between preview and compile (true) and over-stated that as tonal parity — Codex
correctly found that **absolute power is normalized out**. *Symptom:* an operator
can approve faint/over-tuned engraves, and especially can't judge grayscale power
or minimum-power floor from the preview. *My calibration:* for dithered modes the
dot pattern is still faithful (power doesn't change the pattern), so this is
Medium overall; the real bite is grayscale + min-power tuning + the hardcoded 1000.
(I dispute Codex's "approve inverted artwork" sub-point — inversion *is* shown in
the preview via `maybeInvertLuma`.)

**[BQ-5] SVG `fill-rule` is discarded; the hatch rule flips for the whole layer if any text shares it — P2 — Mine (FIL-2) — CONFIRMED (not in Codex)**
`fillRuleForLayer` returns `nonzero` iff any text object is on the layer, else
`evenodd`, layer-wide (`fill-rule.ts:5-7`); the SVG parser has **zero** fill-rule
parsing (confirmed — `src/io/svg` has no `fill-rule`/`nonzero`/`evenodd`). So a
same-wound donut's hole fills solid the moment a text label shares its layer.
*Symptom:* a shape's holes depend on unrelated siblings. (Standard opposite-wound
holes are safe.)

**[BQ-6] `.lbrn` import drops every cut setting except speed/power/passes/mode — P2 — Mine (SET-2) — CONFIRMED**
`lbrn-import.ts:103-114` reads only speed (×60), maxPower, passes, and type;
interval, min-power, air, scan angle, overscan, bidirectional, cross-hatch, kerf,
fill-style, dither all fall back to app defaults. *Symptom:* an imported LightBurn
wood engrave re-burns at 0.1 mm interval with air off.

**[BQ-7] `.clb` material import drops machine provenance → masquerades as a vetted starter — P2 — Codex #4 — CONFIRMED** (+ my SET-4: forces dither→floyd, drops fillStyle/kerf/tabs).
The preset schema HAS provenance fields (`confidence`, `laserModel`,
`machineFamily`, `opticalPowerW`, `wavelengthNm`, `warning`;
`material-library-io.ts:31-40`), but `clb-import.ts:89-98` omits every one, so
`recipeConfidence` defaults the entry to `'starter'` (`material-matching.ts:63-65`)
and it displays as `"starter / generic"` — the **same trust tier as the vetted
Neotronics starters** — with no mismatch/scrap-test warning ever able to fire.
*Symptom:* a recipe possibly authored for a 40 W CO₂ at 10600 nm applies to a 5 W
455 nm diode looking exactly as trustworthy as the machine's researched presets.
*Caveat:* `.clb` files genuinely don't carry wattage/wavelength/machine identity,
so those can't be filled from the file — but `confidence:'imported'` is within the
importer's control and still isn't set; a weak textual trail exists (description
says "imported from X").

**[BQ-8] Material "Link" bypasses the mismatch confirmation that "Apply" uses — P2 — Codex #5 — CONFIRMED**
Apply runs `jobAwareConfirm` on the preset's warnings
(`MaterialLibraryRecipeControls.tsx:36-41`); Link (`:50-52`) calls `onLink()` →
`applyLinkedPreset` which writes the same power/speed onto the layer
(`material-library-actions.ts:112-121`) with **no** confirmation, and binds it so
future refreshes re-apply. A cross-device preset carries
`'Preset is not compatible with the active device profile.'` with
`isAssignable:true` (`material-library-preset-options.ts:42-53`) — Apply forces
"…Apply it anyway?"; Link lands it silently. *Nuance:* the warning text is still
passively shown in `PresetMatchSummary` either way — only the **forced
acknowledgment** is missing. *Fix must not add a blocking guard (ADR-206).*

**[BQ-9] Smoothieware raster/image power collapses to ~0.1% — P2 — Mine (PWR-2) — CONFIRMED (Smoothie-only)**
Raster S-values are dithered at compile against the real `maxPowerS=1` before the
strategy's virtual-1000 rescale (`smoothieware-strategy.ts:19` vs
`compile-job-raster.ts:53`), so a black pixel `S1` becomes `S0.001`. Vectors are
fine. Smoothie profile is simulator-verified-only, so no user has hit it yet.

### Tier 2 — conditional / narrower, confirmed

**[BQ-10] Raster overscan is a hardcoded 5 mm (not speed-scaled, not adjustable); short fill sweeps can lose overscan — P3 — Both (my SPD-3/IMG-4 + Codex #8) — CONFIRMED**
`compile-job-raster.ts:111` fixes 5 mm regardless of feed; required runway =
v²/2a (~0.6 mm at 1500 mm/min but ~40 mm at 12000). Short fill sweeps skip
overscan (`fill-overscan.ts`, a documented ADR-033 speed trade). *Symptom:* darker
row/edge bands at high feed; fine at the 1500 mm/min default.

**[BQ-11] Pass-through still applies brightness/gamma/inversion/mask/dither — P2 — Codex #9 — CONFIRMED (corrects my E)**
`compile-job-raster.ts:49-50` runs `applyLumaAdjustments` + `maybeInvertLuma`
**unconditionally**, before the `passThrough` check at `:56`; pass-through only
skips the resample (keeps native pixel dims), not the tone processing or dither.
My image auditor's "pass-through skips processing" was wrong. *Symptom:* an
externally-prepared/pre-dithered engraving image is transformed again.

**[BQ-12] Kerf containment is per-path — nested contours in separate objects grow instead of shrink — P2 — Codex #10 — CONFIRMED (refines my C)**
`closedForKerf` is scoped inside the per-path loop (`compile-job.ts:422`), so
inner/outer orientation is computed only among one path's polylines. A donut in a
single path works (what my geometry auditor tested), but a 10 mm hole that is a
separate object inside a 30 mm ring is treated as its own outer contour: +1 mm
compensation makes it 32/**12** mm instead of 32/**8** mm. *Symptom:* wrong hole
sizes, fit, and finished dimensions on multi-object nested art.

**[BQ-13] Interval clamp diverges — presets/imports can carry 0.001 mm and compile honours it — P3 — Mine (SET-3) — CONFIRMED**
UI floor 0.05 mm (`cut-settings-draft.ts:115`) vs recipe floor 0.001 mm
(`material-library.ts:59`) vs no floor at compile (`compile-job.ts:271`).
*Symptom:* an imported/preset interval below 0.05 mm burns at extreme density →
over-burn/char and a huge job, with no UI clamp until re-opened.

**[BQ-14] Stacked image adjustments band/clip (8-bit clamp between stages) — P3 — Mine (IMG-2) — CONFIRMED**
Brightness, contrast, and gamma each round/clamp to `Uint8` before the next
(`luma-adjust.ts:15-26`). *Symptom:* stacked adjustments blow highlights to bare
wood and stair-step gradients; single adjustments fine.

**[BQ-15] Thin features between scanlines receive zero sweeps and vanish — P3 — Mine (FIL-3) — CONFIRMED**
`fill-hatching.ts:101-106` snaps the first scanline to a global grid;
sub-interval regions between grid lines get `scanCount = 0`. *Symptom:* thin
serifs/rules/detail perpendicular to the scan disappear (~50% of the time at
0.1 mm for a 0.05 mm feature).

**[BQ-16] Laser Start does not surface an active feed/power override — P3 (Codex: High) — Codex #6 — CONFIRMED**
`cncOverrideStartIssue`/`Warning` (`cnc-accessory-readiness.ts:66,84`) return null
for non-CNC machines, so a live GRBL feed or spindle(=laser-power) override is
neither blocked nor shown at laser Start. *Symptom:* a job can start with reduced
feed or increased power (more energy per distance, especially under M3). *My
framing:* the ADR-206-compatible fix is a **non-blocking warning**, not a Start
block — I dispute Codex's "does not gate" phrasing implying a new block.

**[BQ-17] Shipped five-line GRBL autofocus preset is guaranteed to fail — P3 — Codex #12 — CONFIRMED**
`AutofocusEditor.tsx:28` ships a five-line probe macro (`G91 G21 / G38.2 Z-30 F100
/ G92 Z0 / G90 / G1 Z3 F600`) stored verbatim; `autofocus-action.ts:74-79` rejects
any command containing `\r`/`\n` ("Autofocus command must be a single line"),
pinned by `autofocus-action.test.ts:74-79`. So the "GRBL probe (Z-axis machines)"
preset can never run. *Not silent* — a warning toast fires — but the machines that
most need probe-down focus have no working one-click autofocus. *Symptom if the
operator assumes focus happened:* defocused beam → wider kerf, reduced energy
density (may not cut through), fuzzy engraving, scorching. Cleanest single-file fix
of the set (send the macro line-by-line, or ship a single-line preset).

**[BQ-18] Grayscale white → S0 ignores configured min power — P3 — Codex #14 — CONFIRMED as divergence, FLAGGED as not-clearly-a-bug**
`dither.ts:194` maps pure white (`strength <= 0 ? 0`) to S0 regardless of `sMin`,
diverging from LightBurn's "Min Power for the lightest shades." **My flag:**
white→0 (beam off) is *correct and desirable* for photo engraving — burning blank
wood at min power stains it — and only diverges for **relief/depth-floor** work
where a minimum everywhere is wanted. There is a minor discontinuity (luma 254
burns ~`sMin`, luma 255 burns 0). Treat as *confirm intent*, not a defect; my
image auditor's "white beam-off verified good" is right for the photo use-case.

**[BQ-19] Vector line output defaults to M3 constant power — INFO (Codex: Medium) — Both (my PWR-6 + Codex #13) — CONFIRMED, FLAGGED severity**
`gcode-dialects.ts:76` `cutPowerMode:'constant'`. **My flag:** this is a
**documented ADR-036 decision** (a slow corner must still cut fully through), not
a defect; fill/raster default to M4, and `$32=1` forces the beam dark on travels,
so the M3 stopped-head hazard is mitigated. Only decorative line-*engraving* is
affected, and M4 is a per-layer override (ADR-190). I downgrade Codex's Medium to
INFO/parity-note.

**[BQ-20] viewBox-only SVG assumes 1 unit = 1 mm — 3.78× oversize risk — Mine (GEO-1) — CONFIRMED but ADR-046-documented**
`svg-units.ts:38-41` collapses to scale 1 with a viewBox but no width/height,
while the no-viewBox branch uses 96 DPI. **Documented, accepted** (ADR-046 keeps
"viewBox only → 1 mm" and defers a per-format import-DPI *setting* to future work).
Reframing: this surfaces the concrete cost of that deferral, not a bug.

### Tier 3 — SUSPECTED (need a hardware/rendered check)

- **[BQ-21] Scan-offset reverse-shift sign may be inverted → doubles the zipper — P2-if-real — Mine (SPD-2) — SUSPECTED (not in Codex).** `scan-offset.ts:75-91`
  shifts reverse rows *along* travel for a positive offset; first-principles says
  cancelling firing lag needs the shift *against* travel, so entering the measured
  separation could double the serration. Opt-in (default off). The single item
  that could turn a fidelity feature into a regression on a heavy gantry.
- **[BQ-22] FluidNC `$32=1` is not full proof of laser mode — INFO — Codex #7 — CONFIRMED-caveat.** `controller-readiness.ts:192` treats the `$32` bit as
  sufficient; on FluidNC `$32` is a compatibility alias and real laser behaviour
  depends on the configured spindle. **My flag:** real but firmware-narrow and not
  fully fixable in software (would need FluidNC config introspection); the existing
  `$32=0` block is correct — this is a trust caveat, not a clear defect.
- **[BQ-23] Offset-fill medial-axis/corner coverage (my FIL-4); fill G0-runway vs raster G1-runway on Marlin/Smoothie (my SPD-4) — P3 — SUSPECTED.**

### Tier 4 — INFO / feature gaps / corrections

- **Correction — [BQ-24] vector Min Power (my PWR-1 → INFO):** my power auditor
  called dropped vector Min Power a P2; it is wrong. Min Power is exposed **only**
  for grayscale images (`cut-settings-draft.ts:36-39`; `layer.ts:23` "grayscale
  image floor") — Line/Fill never show the control, and vectors correctly delegate
  the M4 floor to GRBL `$31`. No dead knob.
- Per-pass Z step absent for laser (SPD-7); no combined Fill+Line mode (FIL-5);
  nearest-neighbour path order concentrates heat, matches LightBurn (SPD-6); raster
  ignores a dead `bidirectionalScanOffsetMm` preview-only field (SPD-5); duplicate
  stacked geometry burns twice, no dedup tooling (GEO-2); closed-contour start seam
  not optimised (GEO-3); element-level SVG unit suffixes dropped (GEO-4); low-power
  rounding to S0 harmless (PWR-4); offline export trusts profile `$30` (PWR-5).

---

## Corrections and flags (my verdict on Codex, and on my own auditors)

**Codex found things my six-agent audit missed** — credited and merged:
BQ-1 double-burn half (#1), BQ-4 preview power-normalization + hardcoded 1000 (#3),
BQ-7 `.clb` provenance (#4), BQ-8 Link-vs-Apply (#5), BQ-11 pass-through
processing (#9), BQ-12 cross-object kerf (#10), BQ-16 laser override (#6), BQ-17
autofocus (#12), BQ-18/BQ-22 grayscale + FluidNC semantics (#14/#7).

**My audit corrected two of my own auditors' over-claims, thanks to Codex:**
BQ-4 (image auditor's "preview parity verified good" → power is normalized out)
and BQ-11 (image auditor's "pass-through skips processing" → it still adjusts and
dithers).

**Where I dispute or calibrate Codex:**
1. **Codex #13 M3 default (Medium → INFO):** documented ADR-036; `$32=1` mitigates.
2. **Codex #14 grayscale white→S0 (defect → confirm-intent):** correct for photos;
   diverges only for relief/depth work.
3. **Codex #3 severity (High → Medium-High):** dithered pattern is still faithful;
   and its "approve inverted artwork" sub-point is wrong (inversion *is* previewed).
4. **Codex #6 override (block → warning):** extending the gate to laser as a
   *block* would be a new guard (ADR-206); a non-blocking warning is the correct fix.
5. **Codex #7 FluidNC:** valid but narrow and not fully software-fixable; INFO.

**My findings Codex did not raise** (coverage gaps, not disagreements): BQ-5
(SVG fill-rule discarded), BQ-6 (`.lbrn` field loss), BQ-13 (interval clamp),
BQ-20 (viewBox scale), BQ-21 (scan-offset sign — important hardware item), BQ-14
(adjustment banding), BQ-9 (Smoothie raster).

---

## Verified good (both audits agree)

- **Power:** `round(power% × configured $30)`, single-sourced from the device
  profile, clamped 0–100%, never exceeds S-max; property-tested for
  `$30 ∈ {100,255,1000}` (`grbl-strategy.ts:38`).
- **Speed:** mm/min end to end; `F = round(speed)`, **zero conversions** (no 60×
  bug); capped to `device.maxFeed`; controller-limit mismatch surfaced.
- **Beam-off:** every travel `G0 … S0`; job end `M5` + park; beam parked between
  passes/layers; every abort/Stop/Fire forces `M5`; property-tested zero
  laser-on-travel across GRBL/Marlin/Smoothie. Manual Fire uses the same
  percent→S seam and is capped at 5%.
- **Readiness:** live `$30` mismatch and `$32=0` block Start; `$31>0` warns;
  Marlin/Smoothie (no `$$`) downgrade to an explicit unverified warning.
- **Geometry:** px↔mm composes to 1.0 for standard SVG (real width/height) and
  DXF; single Y-flip across all three modes; closure preserved; curve tolerance
  0.025 mm fixed; NaN caught by preflight before emit; kerf correct *within a
  path*; inner-before-outer cut order.
- **Fill:** interval → emitted spacing exact; opposite-wound donut keeps its hole
  with beam-off across it; overscan beam-off runway; analytic intersections;
  correct vertex-tangent handling; bidirectional snake default.
- **Image:** tonality sign correct (dark → more power); Rec.601 luma; negative
  opt-in/off by default; white rows beam-off; both pixel axes from one lines/mm;
  single orientation flip; dither kernels match published constants and serpentine.
- **Settings:** output-vs-visibility LightBurn-correct (hidden + output=on burns);
  units survive preset→layer and `.clb` ×60; fresh-layer defaults engrave-safe
  (30% / 1500 mm/min); per-object overrides honoured at compile; `.lf2` round-trips
  cut settings; calibration grids vary the axis their labels claim; Neotronics wood
  preset explicitly labelled a starting point, not a certified recipe
  (`neotronics-4040-presets.ts:43`).

---

## Re-audit (verification pass) — complete

Two verification agents re-checked everything against this tree.

**Pass 1 — the three PENDING Codex items: all CONFIRMED** (evidence folded into
BQ-7, BQ-8, BQ-17 above). `.clb` provenance loss, Link-vs-Apply asymmetry, and the
guaranteed-fail five-line autofocus preset are all real in this worktree.

**Pass 2 — adversarial refutation of the eight top findings.** This pass tried to
*break* each finding and materially re-ranked the audit — catching over-claims
from Codex **and** from my own six-agent auditors. Verdicts (hand-verified where
they reversed a conclusion):

| Finding | Adversarial verdict | Net effect |
|---|---|---|
| BQ-3 photo nearest-neighbour resample | **UPHELD** | Strongest defect; only resampler, import resize caps above the burn grid; prior audit TRC-03 logged it, still unfixed |
| BQ-12 cross-object kerf containment | **UPHELD (narrow)** | Real for separate-object holes + kerf on; single-import donuts bucket into one path and work (test-pinned) |
| BQ-1 fill overlap | **UPHELD (half)** | Equal-power *unburned* overlap is the real defect; differing-power *double-burn* is expected/unavoidable |
| BQ-2 air assist | **OVERSTATED** | Neotronics air is `'built-in'` hardware; residual is only a missing warning for software-air machines. **Was ranked #1 — dropped to Medium** |
| BQ-4 preview not output-faithful | **OVERSTATED** | Preview-only (G-code unaffected); correct for dithered modes; only grayscale loses absolute level → Low |
| BQ-11 pass-through still processes | **REFUTED** | Resolution-only by design; dither is idempotent on pre-dithered 0/255 input, default adjustments are no-ops → not a defect (INFO) |
| BQ-18 grayscale white→S0 | **OVERSTATED** | Min power honoured for every shade except exact white (1-level discontinuity); defensible clean-highlights choice → not a bug |
| BQ-16 laser override not surfaced | **REFUTED** | Job Review's Controller section shows overrides in `warning` tone for any machine (`job-review-live-rows.ts:60-64`); only the CNC *block* is laser-absent, correctly (INFO) |

Net: the two genuinely unmitigated burn-fidelity defects are **BQ-3 (photo
resample)** and **BQ-12 (cross-object kerf)**; **BQ-1** shrinks to its
equal-power half; **BQ-2 drops from the top spot**; and **BQ-11 / BQ-16** are
effectively not defects. This supersedes the initial ranking above where they
conflict.

---

## What a genuinely calibrated workflow still needs (from Codex, endorsed)

The physical chain is: material recipe → layer/object settings →
vector/fill/raster compilation → controller G-code → readiness → streaming → live
overrides → wood. No amount of static analysis certifies a recipe. Before calling
any power/speed a certified wood-art recipe, run and record on the actual machine:
exact machine/laser wattage/lens/firmware and live `$30/$31/$32`; material
species/thickness/coating/moisture; and a focus ramp, power×speed matrix,
interval/DPI test, scan-offset pattern, dot-width/overscan coupons, grayscale
ramp, air-on/off comparison, kerf ring, and repeated cut-through — with photos and
measurements stored as machine/material-specific recipes. This mirrors LightBurn's
Material Test / Interval Test guidance.

---

## Recommended action

Order revised after the adversarial re-audit. Fix: **(1) BQ-3 photo
nearest-neighbour resample** — the clearest unmitigated burn-fidelity defect
(pure-core swap to area/bilinear; already logged as TRC-03 and unfixed); **(2)
BQ-12 cross-object kerf** (compute containment across all a layer's closed
contours, not per-path — wrong hole sizes today when a hole is a separate object);
**(3) BQ-1 equal-power fill overlap** (union / `nonzero` for non-text fills — fix
the unburned-overlap half only; the differing-power double-burn is inherent).
Then the import/integrity items: **BQ-7** (`.clb` tag imports as `confidence:
'imported'`, not a masquerading starter), **BQ-8** (force-acknowledge a
cross-device Link, without a new block — ADR-206), **BQ-17** (send the autofocus
macro line-by-line or ship a single-line preset), **BQ-6** (`.lbrn` field loss),
**BQ-5** (parse SVG `fill-rule`), **BQ-9** (Smoothie raster scale), **BQ-13**
(unify the interval floor), **BQ-14** (compose image adjustments once). Run the
**BQ-21 scan-offset sign** check on hardware before trusting bidirectional
compensation. Downgraded to warnings/parity-notes, not blocks: **BQ-2** (a warning
when a layer wants air the device can't actuate), **BQ-16**/**BQ-18**/**BQ-19**/
**BQ-22**. Then run the controlled burn matrix on the real machine before
certifying any recipe. All report-only — no code changed, no guards proposed
(ADR-206).
