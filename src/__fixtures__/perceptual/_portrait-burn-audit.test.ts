// Audit probe (opt-in, PORTRAIT_AUDIT=1): scores every photo dither on the
// astronaut's head as a viewer sees it (portrait-burn-view.ts), with ideal
// one-cell marks and with 1.6-cell spots, with and without Auto tones, and
// writes a contact sheet to perceptual-artifacts/portrait-audit/ (ADR-685).
// Columns: photo, then each dither at 1.6-cell spots without and with Auto tones.

import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { lumaHistogram, portraitAutoTones } from '../../core/raster/portrait-auto-tones';
import type { DitherAlgorithm } from '../../core/scene';
import { encodeRgbPng } from './png';
import {
  exactDotReflectance,
  gaussianBlur,
  highlightSpeckle,
  linearToSrgb,
  PORTRAIT_EDGE,
  portraitBurn,
  portraitHeadLuma,
  scorePortrait,
  srgbToLinear,
  VIEW_SIGMA_CELLS,
} from './portrait-burn-view';

const DITHERS: ReadonlyArray<DitherAlgorithm> = [
  'blue-noise',
  'floyd-steinberg',
  'stucki',
  'jarvis',
];
const OUT = 'perceptual-artifacts/portrait-audit';

describe.skipIf(process.env.PORTRAIT_AUDIT !== '1')('portrait burn audit', () => {
  it('scores the photo dithers on a face', () => {
    const luma = portraitHeadLuma();
    const edge = PORTRAIT_EDGE;
    const auto = portraitAutoTones(lumaHistogram(luma)) ?? {};
    const rows = [`auto tones ${JSON.stringify(auto)}`];
    const tiles: Float64Array[] = [Float64Array.from(luma, srgbToLinear)];
    for (const algorithm of DITHERS) {
      for (const [label, tones] of [
        ['plain', {}],
        ['auto', auto],
      ] as const) {
        const burn = portraitBurn(algorithm, tones);
        for (const dot of [1, 1.6]) {
          const reflectance = dot === 1 ? burn.map((d) => 1 - d) : exactDotReflectance(burn, dot);
          const score = scorePortrait(reflectance);
          if (dot === 1.6) tiles.push(gaussianBlur(reflectance, edge, VIEW_SIGMA_CELLS * 0.5));
          rows.push(
            `${algorithm.padEnd(16)} ${label.padEnd(5)} dot ${dot.toFixed(1)}  bias ${score.bias.toFixed(1).padStart(5)} L*  error ${score.meanAbsoluteError.toFixed(1).padStart(4)} L*  detail ${score.detail.toFixed(3)}  speckle ${(100 * highlightSpeckle(burn)).toFixed(1)}%`,
          );
        }
      }
    }
    const rgb = new Uint8Array(edge * tiles.length * edge * 3);
    tiles.forEach((tile, t) => {
      for (let y = 0; y < edge; y += 1) {
        for (let x = 0; x < edge; x += 1) {
          const v = Math.round(linearToSrgb(Math.max(0, Math.min(1, tile[y * edge + x] ?? 0))));
          const o = (y * edge * tiles.length + t * edge + x) * 3;
          rgb[o] = v;
          rgb[o + 1] = v;
          rgb[o + 2] = v;
        }
      }
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/scores.txt`, rows.join('\n'));
    writeFileSync(`${OUT}/contact-sheet.png`, encodeRgbPng(rgb, edge * tiles.length, edge));
  }, 300_000);
});
