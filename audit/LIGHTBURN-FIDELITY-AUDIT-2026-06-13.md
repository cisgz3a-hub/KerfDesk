# LaserForge 2.0 vs LightBurn — Fidelity & Parity Audit

**Date:** 2026-06-13 · **Status:** report-only (CLAUDE.md collaboration rule 1 — findings only, nothing auto-fixed) · **Branch at audit time:** `main` (after the 2026-06-13 audit-fix merges)

**Reference:** LightBurn 2.1.x. LightBurn behaviors are taken from `LIGHTBURN-STUDY.md`, the 2026-06-11 gap research, and docs.lightburnsoftware.com as cited in those documents. The current tree was re-verified by a 6-domain pipeline verification on 2026-06-13.

---

## The hard caveat (read first)

LightBurn was **not** run, and **nothing was burned** on the Falcon. This is a **behavioral / semantic** parity audit — LightBurn's documented behavior vs. what the code provably does — **not a perceptual one.** Per CLAUDE.md rule 2, the test suite proves *structure and determinism*, never that the trace / fill / engrave *looks like* the source or like LightBurn's output. Every fidelity claim below ultimately needs a rendered or hardware side-by-side that has **not** been done. Each domain restates what specifically rests on that unverified comparison.

Two prior documents were used and adjudicated against the current tree:

- **`LIGHTBURN-GAP-RESEARCH-2026-06-11.md`** — current and authoritative (121 surfaces inventoried). Anchored on.
- **`audit/LIGHTBURN-PARITY-AUDIT-2026-06-03.md`** — **substantially stale**; corrected here where wrong (most notably its "3 raster dither modes" claim — there are **11**).

Several severity labels from the verification agents were **noisy and have been adjudicated** (see Appendix A) — e.g. a *correct* S-value scaling was machine-tagged "blocker", and default power/speed were tagged "blocker" though LightBurn has no canonical default. Those are not real defects and are not counted.

---

## Rating

| Lens | Rating | One-line |
|---|---|---|
| **Output fidelity** — does the burn match LightBurn *for the features we implement*? | **~7 / 10** | Raster engrave and fill are strong; two named divergences (M3 vector power, doubled-contour trace) and one real gap (no overlap-dedup) are the pulls. |
| **Feature / workflow parity** — does it *do everything* LightBurn does? | **~4 / 10, by design** | An *execute-the-design* tool, not a *make-the-design* tool. PROJECT.md:13 deliberately declines LightBurn's breadth. |
| **Safety / correctness** | **~8.5 / 10** | Laser-off invariant, e-stop reachability, off-bed preflight, inside-first ordering, panic-stop hotkey — beats LightBurn in places. |

---

## Output-fidelity scorecard

| Domain | Fidelity | Verdict |
|---|---|---|
| Raster image engrave | **8 / 10** | Strongest path. |
| Layer / cut-settings depth + defaults | **7.5 / 10** | Most 2026-06-03 gaps now closed. |
| Fill / scan (hatch) | **7 / 10** | Geometry correct; per-shape grouping + %-overscan missing. |
| Cut-order / planning | **7 / 10** | Inside-first done; overlap-dedup missing. |
| Vector line/cut emit | **5.5 / 10** | Correct & safe, but M3-not-M4 corner divergence. |
| Trace / vectorize | **4.5 / 10** | The known frontier: default mode doubles strokes. |

Fidelity composite ≈ **6.5–7 / 10**, pulled down by the two named divergences and the overlap-dedup gap.

---

## Domain detail

### 1. Raster image engrave — 8/10 (strongest)

**Current state (verified):**
- **11 dither algorithms** wired to the *engrave* path: threshold, floyd-steinberg, jarvis, stucki, atkinson, burkes, sierra3, sierra2, sierra-lite, ordered, grayscale (`scene-object.ts:127-139`, `dither.ts`, `compile-job.ts:121-124`). Default `floyd-steinberg`.
- **Grayscale ramps Min→Max** correctly: black→sMax, white→0, linear interpolation using `layer.minPower` as the floor (`dither.ts:137-148`, `compile-job.ts:99-102`). M4 dynamic preamble (`emit-raster.ts:86-88`).
- **Brightness / contrast / gamma applied on the engrave path** (`applyLumaAdjustments`, `luma-adjust.ts`, `compile-job.ts:97`) — not just trace.
- **Negative, pass-through, dot-width correction** all wired (`compile-job.ts:98,104-117,137`; `emit-raster.ts:233-320`).

**Divergences:** scan angle / per-pass increment missing (horizontal-only; preflight rejects rotation — `preflight.ts:184-200`); threshold cutoff hardcoded 128 (minor); image-mode overscan hardcoded 5 mm, not user-exposed (minor).

**Not verified:** the dither *patterns*, the grayscale S-vs-luma *curve*, and the tone-adjust curves vs LightBurn's are code-correct but unverified on hardware.

### 2. Layer / cut-settings model + defaults — 7.5/10

**Closed since 2026-06-03:** Min Power field, 11-dither set, cross-hatch field, dot-width, negative/pass-through, M4 fill (ADR-036), unidirectional fill (ADR-038), layer reorder = cut order, recolor/reassign shapes.

**Open:** default dither is `floyd-steinberg`, not LightBurn's Stucki default / Jarvis-for-photos guidance (`layer.ts:71`); Min Power is surfaced only for grayscale images, not for line/fill in the UI; **fill's M4 emission passes no `sMin` floor** (`grbl-strategy.ts:75-100`); cross-hatch field exists but the UI checkbox was not located in `LayerRow.tsx` (verify).

**Note:** default power 30% / speed 1500 mm/min are *not* fidelity defects — LightBurn has no universal canonical default (it comes from the material library / device). hatchSpacing 0.1 mm (10 lines/mm) sits inside LightBurn's 120–300 DPI photo band — a deliberate parity match.

### 3. Fill / scan (hatch) — 7/10

**Correct:** even-odd hole handling (donut/letter-O, tested `fill-hatching.test.ts:90-110`); snake/bidirectional default with unidirectional toggle (ADR-038); cross-hatch shipped (second 90° pass, `fill-hatching-cache.ts:34-41`); overscan with short-run skip (ADR-033). Hatch angle UI clamps 0–180, mathematically equivalent to 0–360.

**Divergences:** overscan expressed in **mm**, LightBurn uses **%-of-speed** (minor); **per-shape fill grouping missing** — one FillGroup per layer (all-at-once), so 20 spread parts sweep dead air (major *speed*, not fidelity); offset/concentric fill (4th mode) absent (out of scope).

### 4. Cut-order / path planning — 7/10

**Inside-first containment ordering IS implemented and ON by default** (`optimize-paths.ts:68-193`, tested `optimize-paths.test.ts:106-117`) — the 2026-06-03 "no containment analysis → frees the part early" finding is **closed**. Cross-layer order is user-controlled (layer reorder feeds `compileJob`).

**Real gap:** **no remove-overlapping-lines** — shared edges between adjacent shapes are emitted and cut twice (`compile-job.ts` appends polylines verbatim). In-scope, **major**. Also: the optimization UI exposes only "Reduce travel moves" vs LightBurn's ~8 planner toggles (partial). No per-shape cut priority (out of scope).

### 5. Vector line/cut G-code emission — 5.5/10

**Correct & safe:** `G21/G90/M3 S0` preamble, `M5` + park postamble, S = `round((power/100)·maxPowerS)` honoring device `$30` (property-tested, non-negotiable #7), laser-off-on-travel invariant. Deterministic.

**Headline divergence — M3 vs M4.** Vector cuts emit **M3 constant power**; LightBurn's GRBL default is **M4 variable power** (`LIGHTBURN-STUDY.md:697` "Constant Power Mode … Default = Disabled (M4)"). M4 scales S with head speed, auto-dropping power on decelerating corners; M3 holds constant. On an identical job your corners char more than a default LightBurn job. This is a **deliberate** choice (`grbl-strategy.ts:42`; ADR-020 Q1: "exposing it as a knob invites misconfiguration"), but it fights LightBurn's default. **Both prior audits name it the #1 cut-fidelity item, and ADR-020 is now in known conflict with that recommendation.** No per-layer Constant-Power toggle exists.

### 6. Trace / vectorize — 4.5/10 (the frontier)

**Progress:** a **Centerline** trace mode is implemented and user-selectable as a preset (`trace-image.ts:199-214`, `centerline-trace.ts`, `centerline-mask.ts`); the ADR-026 source-retention overlay works; the ADR-025 perceptual harness exists (IoU 0.97+ on line-art fixtures).

**The core remaining "faulty vs LightBurn" issue (PROJECT.md:91):** the **default** "Line Art" mode still produces **two parallel contours for a single pen stroke** because imagetracerjs is outline-only. Centerline fixes it for strokes but is not the default. Worse, the **perceptual harness explicitly cannot detect the doubling** (ADR-025 Scope: IoU is area-based; the doubled outline still covers the right pixels). So the suite is green while the headline defect is invisible to it.

**Also:** `DEFAULT_TRACE_OPTIONS` degenerates on pre-binarized input (IoU ≈ 0.25 on a solid square), side-stepped by defaulting to the Line Art preset but a footgun for direct `traceImageToSvgString()` calls. The trace control vocabulary (preset picker + numberOfColors) differs from LightBurn's single Cutoff/Threshold band; the realignment is designed in **ADR-030 but it is Proposed, not Accepted / not phased**. Brightness/contrast/gamma sit inside the Trace dialog rather than a separate Adjust-Image surface.

> **Separately fixed 2026-06-13:** "Trace Transparency" produced a solid black page on any image with no transparent pixels (`alpha > 0 ? ink : bg` marks every opaque pixel as ink). Fixed on branch `fix/trace-transparency-opaque-fallback` — opaque images now fall back to the brightness path. (Bug report, not part of this audit's scope.)

---

## Where LaserForge beats LightBurn (current tree)

Panic-stop / start hotkeys (LightBurn ships none) · connect-time `$$` firmware-diff banner with one-click apply · accurate GRBL-planner time estimates out of the box · WYSIWYG raster preview with no hidden "shade by power" toggle · in-canvas scrubber preview that keeps bed context · 11 dithers vs their 10 · every disabled command explains itself (`disabledReason` tooltips) · off-bed preflight that refuses by name · material library that auto-persists (no `.clb` juggling) · set-origin auto-switches Start-From + toast · tests are ordinary scene objects · labeled layer cards with visible utilities · hardened SVG import. **13 genuine wins.**

---

## Why feature-parity is 4/10 (and why that's fine)

The ~4:1 command-surface ratio is lopsided **by design**. The five operator journeys:

| Journey | LaserForge today |
|---|---|
| J2 — photo engrave | Competitive → better (11 dithers, WYSIWYG, accurate estimate) |
| J4 — position on an object | Better than LightBurn *without a camera* |
| J5 — dial in a material | Possible, but you read an *unlabeled* burned grid by counting cells |
| J1 — draw a sign from nothing | **Impossible** — zero drawing tools |
| J3 — batch 20 keychains | **Effectively impossible** — no array / align / clipboard |

Excellent at *import → configure → burn*; absent at *draw → lay out → batch*. A deliberate scope line, not a defect — but it's why a raw parity score is low. The 2026-06-11 gap research sequences the build-out (drawing tools → precision editing → production layout → operator loop → calibration → geometry kernel) if/when that line moves.

---

## Bottom line

For the workflow LaserForge targets — **import a design, set per-color cut/engrave, preview, stream to a GRBL machine** — output fidelity is **genuinely good (~7/10)** and the *safety* posture is **better than LightBurn's**. The distance from 8–9 is two known, named items:

1. **M3-not-M4 vector power** — a documented choice (ADR-020) that diverges from LightBurn's default and chars corners more.
2. **Doubled-contour default trace** — the acknowledged frontier; a centerline workaround exists but isn't the default and isn't caught by the metric.

Plus one real cut-quality gap: **remove-overlapping-lines**. Everything else missing vs LightBurn is **breadth you chose not to build**.

**Still unverified by anyone:** every fidelity claim here needs a LightBurn render and/or a Falcon burn to confirm.

---

## Appendix A — agent-severity adjudications

Verification-agent severity labels were corrected where they conflicted with the evidence:
- **S-value scaling** machine-tagged "blocker" — it is *correct* (matches `$30`, property-tested); **not a defect**.
- **Default power 30% / speed 1500** machine-tagged "blocker, fidelity-critical" — LightBurn has **no canonical default** (material-library / device driven); **not a fidelity defect**.
- **Inside-first ordering** machine-tagged "cosmetic" — substantively it is a *closed* fidelity/safety item (the prior audit's open finding); reframed as such.
- Domain scores `vector-emit: 3` and `trace: 4` were judged harsh (G-code is correct/safe; centerline mode exists) and softened to ~5.5 / ~4.5 in the composite.

## Appendix B — sources

`PROJECT.md`, `DECISIONS.md` (ADR-020, ADR-025, ADR-026, ADR-030, ADR-031–038), `LIGHTBURN-STUDY.md`, `LIGHTBURN-GAP-RESEARCH-2026-06-11.md`, `audit/LIGHTBURN-PARITY-AUDIT-2026-06-03.md` (corrected), and a 6-domain current-tree verification (cut-order, vector-emit, fill-scan, raster-engrave, trace-vectorize, layers-settings-defaults). LightBurn behaviors per docs.lightburnsoftware.com as cited in the gap research.
