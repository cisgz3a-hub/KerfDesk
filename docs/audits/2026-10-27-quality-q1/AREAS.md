# Quality audit Q1: burn quality and tracers

**Requested:** the user, on 2026-10-27: "a loop audit on quality burn work. tracers real images etc. I want my program to burn exact image quality and my tracers to be better than potrace."

**How this differs from the rolling rounds:** this round measures quality, not only defects. Each area produces:
1. a **scorecard** of objective metrics against a reference;
2. findings, with the usual severity.

Finding IDs are `Q<area>-P<n>-<k>`.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies, including §3 (as clarified on 2026-10-23 and 2026-10-27) and §4 (pinned citations). Each area gets an auditor, then a fresh refuter. The coordinator re-verifies every P1/P2.

### Severity for quality
- **P1:** the burn differs in tone, position or scale from what the app shows or promises, with no warning. For example, a 50% grey that burns as 80%, or pixels landing off the grid.
- **P2:** a visible quality defect against the reference, of the kind an ordinary user will notice. For example, worse edge fidelity than Potrace on the same input, dither artifacts, or wobble on straight edges.
- **P3:** a measurable improvement opportunity or a test gap.

### References (ground truth)
- **Tracing:** Peter Selinger, *Potrace: a polygon-based tracing algorithm* (2003). Cite it pinned or archived. Also Potrace's documented parameters: `turdsize`, `turnpolicy`, `alphamax`, `opttolerance`.
- **Dithering:** the original definitions (Floyd–Steinberg 1976; Jarvis–Judice–Ninke 1976; Stucki 1981; Atkinson; Sierra; Burkes; Bayer ordered dither; blue noise per ADR-649), plus Ulichney, *Digital Halftoning*, where it is reachable.
- **Laser:**
  - GRBL laser mode (`$32`, M3 vs M4 dynamic power), at a pinned gnea/grbl SHA;
  - LightBurn's documented image modes and settings, at a versioned docs URL;
  - controller sources for overscan and acceleration.
- **Measurement:** synthetic inputs with known geometry and tone (circles, squares, polygons, rendered letters, step wedges, gradients), plus the repo's real images in `src/__fixtures__/perceptual/assets`. The perceptual benchmark is in `src/__fixtures__/perceptual/` and `scripts/trace-bench.mjs`.
- **Simulated burn:** run the emitted G-code through an independent simulator into a bitmap, at the profile's spot size and line interval. Compare it with the source image (tone curve, SSIM after a spot blur, edge position).

### Licence rule
Potrace and mkbitmap are GPL. Nothing may be derived from their code (see the ADR-402 note). Comparing against the published method, or against Potrace's outputs as a test-only reference, is fine. Do not copy code.

## Areas (order = run order)

| # | Area id | Scope | Reference | Lenses |
|---|---|---|---|---|
| Q1 | `raster-tone` | Brightness → S mapping: gamma, min/max power, `$30` scaling, negative, tone curves (ADR-670), sharpen (ADR-671). Does a step wedge burn at the intended tones? Check M3 vs M4 dynamic power through acceleration and deceleration, overscan length against acceleration, and power at turnarounds | GRBL source, LightBurn docs, simulated burn | L2, L3, L1 |
| Q2 | `raster-geometry` | Pixel placement: line interval against DPI and spot size, bidirectional scan offset, half-pixel alignment, registration with vector layers, resampling filter quality, rotation and skew, overscan geometry, image edges | Independent G-code simulator against the source grid | L3, L4 |
| Q3 | `dither-algorithms` | Every dither mode against its original definition: kernel weights, serpentine scan, error clamping, gamma-correct diffusion. Check tone accuracy per grey level and artifacts (worms, patterning, edge bleed). Compare a simulated burn with the original, weighted for the eye | The original papers | L2, L3 |
| Q4 | `trace-vs-potrace` | Outline tracing (Line Art, Sharp and the other presets) against Potrace's method: decomposition, optimal polygon, vertex adjustment, corner detection (`alphamax`), curve optimisation (`opttolerance`), speckle (`turdsize`), turn policy (ADR-403). Scorecard on ground-truth shapes at several resolutions: mean and max boundary error, area error, corner angle kept, node count, smoothness, topology (holes, touching shapes), speed | Selinger (2003); a head-to-head with the Potrace binary only if the user approves the test-only download | L2, L3, L7 |
| Q5 | `trace-real-images` | Real images: photos (astronaut), scans, JPEG-damaged logos, low-res upscaling, uneven lighting, anti-aliased edges, noise. Covers preprocessing (threshold, adaptive, despeckle, median, background flatten), centerline (ADR-405), colour or multi-level, camera and jig trace, and photo shading ribbons. Fidelity of the traced result, re-rendered against the source | The repo's real images and reference traces (arch-house) | L4, L7 |
| Q6 | `vector-burn-quality` | How traced or vector art burns: segment density against GRBL planner and serial throughput (stutter), arc fitting, minimum segment length, corner power (M4), path start/end overburn, and fill (hatch) quality: interval, angle, crosshatch, bidirectional offset | GRBL source, simulated motion | L2, L6 |

## Batching

- Two audit subagents run at a time, shared with rolling v5.
- The user asked for this round last, so Q areas take the next free slot ahead of v5's remaining J7–J10. Refuters still go first.
