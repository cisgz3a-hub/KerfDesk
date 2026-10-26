## ADR-649 - Blue Noise: tone-dependent error diffusion for portrait midtones (2026-10-20)

**Status:** Accepted | **Date:** 2026-10-20

### Context

ADR-581 gave portraits a Photo engraving dialog offering Jarvis, Stucki and
Floyd–Steinberg. All three quantize at a fixed threshold of 128 with one fixed
kernel (`ditherErrorDiffusion` in `src/core/raster/dither.ts`). On flat
midtones — cheeks, foreheads, plain backgrounds, the areas that decide whether a
portrait looks real — fixed-threshold diffusion draws "worm" mazes and locks
into periodic patterns. Ulichney (*Digital Halftoning*, 1987) describes the
goal as blue noise: power only at high frequencies, the same in every
direction.

Two published methods target this:

- **Ostromoukhov, "A Simple and Efficient Error-Diffusion Algorithm",
  SIGGRAPH 2001.** Serpentine scan; the error goes to three neighbours (ahead,
  behind-below, below) with weights chosen by the pixel's *input* level. The
  paper prints all 128 weight rows in its Appendix I, for levels 0..127, with
  level g above 127 using row 255 − g. The author's copy is public
  (perso.liris.cnrs.fr/victor.ostromoukhov), and the paper states the intent to
  put the algorithm in the public domain.
- **Zhou & Fang, "Improving mid-tone quality of variable-coefficient error
  diffusion using threshold modulation", ACM TOG 22(3), 2003.** The same
  scheme, with the threshold modulated by white noise of level-dependent
  strength and the midtone weights re-optimised. The paper is closed-access
  (ACM returned 403; OpenAlex lists no open copy). Its form is confirmed by
  Xiong, Fan, Feng, Liu and Zhou, "Multi-Class Error-Diffusion with Blue-Noise
  Property and Its Application" (Zhou's group, PKU): threshold
  u = 0.5 + m(p)·η(x, y), η white noise, with m(p) and the filter a(p)
  "pre-optimized so that the output … possesses blue-noise property". Neither
  source available here gives Zhou & Fang's tables.

Measured on KerfDesk's own implementation (method below), Ostromoukhov's table
alone beats Jarvis and Stucki on low-frequency texture at most levels. But
between about 100 and 155 it draws vertical stripes on ramps (anisotropy up to
5.9 at 128), and near one-third tones it locks into a period-3 pattern
(anisotropy 24.8 at 85). White-noise threshold modulation on Ostromoukhov's
weights breaks the period-3 lock but does not remove the stripes, and it spoils
the clean 50% checkerboard. That is why Zhou & Fang re-optimised the midtone
weights as well.

### Decision

1. **New dither `'blue-noise'`, shown as "Blue Noise".** It is appended to
   `DITHER_ALGORITHMS` after `'sierra-lite'`, so Cut Settings, More cut
   settings, Adjust Image and the material preset wizard offer it with the
   other modes. The Photo engraving dialog lists it first, because
   `PHOTO_DITHERS` is ordered smoothest first and this ADR measures it as
   smoothest. A layer whose stored mode is not a photo dither still opens the
   dialog on Jarvis (ADR-581); making Blue Noise that default is left to the
   maintainer.

2. **Algorithm** (`src/core/raster/dither-blue-noise.ts`):
   - Serpentine scan, mirroring the filter on odd rows. The filter writes to
     the pixel ahead, the pixel behind it on the next row, and the pixel below.
   - Weights come from the pixel's original luma g (not the luma plus incoming
     error). For g ≤ 48, and g ≥ 207 by symmetry, the threshold is fixed at
     128 and the weights are Ostromoukhov's Appendix I rows, transcribed
     verbatim in `dither-blue-noise-tables.ts`.
   - From 48 to 127, weights and modulation strength interpolate linearly
     between KerfDesk key levels: 48 (Ostromoukhov's row), 56, 64, 72, 80, 85,
     92, 100, 116, 122 and 127. They are mirrored for 128..207. The threshold
     is `128 + m(g) · n(x, y)`, with m between 0 and 16 luma units.
   - n(x, y) ∈ [−1, 1) is a 32-bit multiply-xorshift hash of the pixel
     position, never `Math.random`. The burn is therefore a pure function of
     the image on its machine grid.

   The key levels follow the procedure both papers describe, but are our own,
   because Zhou & Fang's numbers could not be checked. At each key level a grid
   search covered the three weights (steps of 0.05) and m ∈ {0, 8, 16, 24, 32,
   48}. It minimised the share of power below half the blue-noise principal
   frequency plus 0.01 × Ulichney's anisotropy, averaged over the key level and
   the levels 3 either side, on flat 288 px fields. Candidates were then
   checked on rendered ramps, and the 100–116 band was re-chosen for low
   anisotropy (an earlier choice left vertical dashes there). Searching levels
   8–48 the same way gained little over the published table (mostly lower
   anisotropy from slight modulation), so those levels keep Ostromoukhov's
   weights and an unmodulated threshold.

3. **Bit-for-bit streaming.** `diffuseBlueNoiseRow` is the only implementation.
   `dither()` runs it on row views of one full-image buffer. The streamed row
   ditherer (`dither-rows.ts`, ADR-243) runs it in a two-row window that also
   copies each row's source luma, since the weights need it. The filter reaches
   one row ahead, inside the existing limit of two. Both paths therefore share
   every Float32 add, and the existing streamed-equals-full property test now
   includes Blue Noise.

4. **Budget and output.** `raster-budget.ts` already treats every mode other
   than threshold, ordered and grayscale as error diffusion, so Blue Noise gets
   the same materialized estimate as Jarvis. Its working buffers are the same
   (Float32 image plus Float64 output), and its streamed window is smaller than
   the three-row kernel window. Output stays binary: 0 or S max, like the other
   diffusion modes. Frame, Start, power, speed and the emitter are unchanged.

5. **LightBurn.** LightBurn has no equivalent mode (its ten image modes are
   listed in `LIGHTBURN-STUDY.md`, now updated), and `.lbrn` import does not
   map image dither modes. No import mapping changes.

6. **No schema bump.** Every shipped build, from v0.1.0 on, validates stored
   dither values against its own list: on the operation, the image, artwork
   and per-operation overrides, layer defaults, material presets and Adjust
   Image presets. An older build that meets `'blue-noise'` therefore refuses
   the project or preset with an invalid-`ditherAlgorithm` reason; it cannot
   burn it with a different dither. Bumping `PROJECT_SCHEMA_VERSION` would
   also lock older builds out of every project saved by this build, including
   projects that never use Blue Noise. `project-dither-compatibility.test.ts`
   pins both halves: this build keeps the value everywhere, and it refuses a
   value it does not know.

### Verification and limits

`src/__fixtures__/perceptual/dither-texture.test.ts` measures Hann-windowed,
Bartlett-averaged power spectra of flat greys
(`dither-texture-spectrum.ts`). On the greys 16, 32, … 240, Blue Noise matches
the mean tone within 0.002 and has a lower low-frequency share than both
Jarvis and Stucki at every one, under 0.6 of the better of the two in total.
At the one-third tones 84 and 172, its spectral peak and anisotropy are under
half of Jarvis's and Stucki's.

A wider sweep of every fourth level from 0 to 252 gave these totals and means:

| Mode | Low-frequency share, total | Mean anisotropy |
|---|---|---|
| Blue Noise | 0.82 | 0.25 |
| Jarvis | 2.15 | 1.05 |
| Stucki | 1.59 | 0.77 |
| Floyd–Steinberg | 0.93 | 0.64 |

The worst mean-tone error was 0.0006. Jarvis or Stucki scored a lower
low-frequency share only where they lock into a periodic pattern (28, 84, 88,
168, 172, 228: anisotropy 2.3–8.6, peak ratio 20–141), or within 0.0001 at the
extreme levels 4 and 248.

Unit tests cover the published table and its join to the key levels, weights
summing to 1 with dark/light symmetry, thresholds inside (0, 255],
deterministic and evenly spread noise, black and white invariants, ramp tone
tracking, and streamed equals full on a 301 × 77 field of every tone.

These are spectral measures of the binary pattern on the burn grid, not burned
samples. Laser dot gain on wood or slate merges neighbouring dots and may shift
which pattern looks best. No material was engraved, no controller was operated,
and a test card burn comparing Blue Noise, Jarvis and Stucki remains the
qualifying step.
