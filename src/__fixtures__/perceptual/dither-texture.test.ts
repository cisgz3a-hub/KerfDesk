// Flat-grey texture of the photo dithers (ADR-649).
//
// Portraits live or die on flat midtones: cheeks, foreheads, backgrounds. The
// 'blue-noise' mode exists because fixed-threshold Jarvis and Stucki diffusion
// draw worms and blotches there. These tests measure that on the binary
// output's power spectrum (dither-texture-spectrum.ts) rather than by eye:
// at the same mean tone, blue-noise must leave less power at the low
// frequencies where texture is visible.
//
// One caveat the second test covers: near one-third tones the fixed kernels
// lock into a periodic pattern, whose power sits in a single spike rather
// than at low frequencies, so their low-frequency share there can be very
// small. A sweep of every fourth level (ADR-649) found Jarvis or Stucki lower
// only at such levels, plus near-ties at 4 and 248 where every dither leaves
// under 0.06% of its power at low frequencies. At a locked level the pattern
// itself is the artifact, and blue-noise must break it up.

import { describe, expect, it } from 'vitest';
import { dither } from '../../core/raster/dither';
import type { DitherAlgorithm } from '../../core/scene';
import { ciBudgetMs } from '../ci-budget';
import { flatFieldTexture, type TextureMeasure } from './dither-texture-spectrum';

const BUDGET_MS = ciBudgetMs(30_000, 90_000);
const GREYS = Array.from({ length: 15 }, (_, i) => 16 * (i + 1)); // 16 … 240
const ONE_THIRD_TONES = [84, 172];

function texture(algorithm: DitherAlgorithm, gray: number): TextureMeasure {
  return flatFieldTexture(gray, (level, size) =>
    dither(
      { luma: new Uint8Array(size * size).fill(level), width: size, height: size },
      { algorithm, sMax: 1 },
    ),
  );
}

function wantedFraction(gray: number): number {
  return (255 - gray) / 255;
}

describe('dither texture on flat greys', () => {
  it(
    'blue-noise holds each grey with less low-frequency texture than Jarvis and Stucki',
    () => {
      let blueNoiseTotal = 0;
      let jarvisTotal = 0;
      let stuckiTotal = 0;
      for (const gray of GREYS) {
        const blueNoise = texture('blue-noise', gray);
        const jarvis = texture('jarvis', gray);
        const stucki = texture('stucki', gray);
        // Same ink as the image asks for: the texture comparison is fair.
        expect(Math.abs(blueNoise.burnedFraction - wantedFraction(gray))).toBeLessThan(0.002);
        expect(blueNoise.lowFrequencyShare, `grey ${gray} vs Jarvis`).toBeLessThan(
          jarvis.lowFrequencyShare,
        );
        expect(blueNoise.lowFrequencyShare, `grey ${gray} vs Stucki`).toBeLessThan(
          stucki.lowFrequencyShare,
        );
        blueNoiseTotal += blueNoise.lowFrequencyShare;
        jarvisTotal += jarvis.lowFrequencyShare;
        stuckiTotal += stucki.lowFrequencyShare;
      }
      // Not a marginal win: well under the better of the two over the range.
      expect(blueNoiseTotal).toBeLessThan(0.6 * Math.min(jarvisTotal, stuckiTotal));
    },
    BUDGET_MS,
  );

  it(
    'blue-noise breaks up the periodic pattern Jarvis and Stucki lock into near one-third tones',
    () => {
      for (const gray of ONE_THIRD_TONES) {
        const blueNoise = texture('blue-noise', gray);
        expect(Math.abs(blueNoise.burnedFraction - wantedFraction(gray))).toBeLessThan(0.002);
        for (const algorithm of ['jarvis', 'stucki'] as const) {
          const fixed = texture(algorithm, gray);
          expect(blueNoise.peakRatio, `grey ${gray} vs ${algorithm}`).toBeLessThan(
            fixed.peakRatio / 2,
          );
          expect(blueNoise.anisotropy, `grey ${gray} vs ${algorithm}`).toBeLessThan(
            fixed.anisotropy / 2,
          );
        }
      }
    },
    BUDGET_MS,
  );
});
