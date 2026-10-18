import { describe, expect, it } from 'vitest';
import { dither } from '../../core/raster';
import { DITHER_ALGORITHMS } from '../../core/scene';
import {
  DITHER_THUMBNAIL_COLUMNS,
  DITHER_THUMBNAIL_ROWS,
  ditherThumbnail,
  thumbnailRampLuma,
} from './dither-thumbnails';

const BINARY = DITHER_ALGORITHMS.filter((algorithm) => algorithm !== 'grayscale');

// Paints the path's runs back into a pixel mask, one cell per thumbnail pixel.
function paintedPixels(path: string): ReadonlyArray<boolean> {
  const mask = Array.from(
    { length: DITHER_THUMBNAIL_COLUMNS * DITHER_THUMBNAIL_ROWS },
    () => false,
  );
  for (const run of path.matchAll(/M(\d+) (\d+)h(\d+)v1H(\d+)z/g)) {
    const [x, y, length, back] = run.slice(1).map(Number) as [number, number, number, number];
    expect(back).toBe(x);
    for (let offset = 0; offset < length; offset += 1) {
      mask[y * DITHER_THUMBNAIL_COLUMNS + x + offset] = true;
    }
  }
  return mask;
}

describe('dither picker thumbnails', () => {
  it.each(BINARY)('%s draws exactly the pixels dither() burns on the ramp', (algorithm) => {
    const thumbnail = ditherThumbnail(algorithm);
    if (thumbnail.kind !== 'dots') throw new Error(`${algorithm} should draw dots`);
    const power = dither(
      {
        luma: thumbnailRampLuma(),
        width: DITHER_THUMBNAIL_COLUMNS,
        height: DITHER_THUMBNAIL_ROWS,
      },
      { algorithm, sMax: 255 },
    );
    expect(paintedPixels(thumbnail.path)).toEqual([...power].map((value) => value > 0));
  });

  it('gives every binary mode its own look', () => {
    const paths = BINARY.map((algorithm) => {
      const thumbnail = ditherThumbnail(algorithm);
      return thumbnail.kind === 'dots' ? thumbnail.path : '';
    });
    expect(new Set(paths).size).toBe(BINARY.length);
  });

  it('keeps Grayscale a smooth ramp from full power to almost none', () => {
    const thumbnail = ditherThumbnail('grayscale');
    if (thumbnail.kind !== 'ramp') throw new Error('grayscale should be a ramp');
    const opacities = thumbnail.stops.map((stop) => stop.opacity);
    expect(opacities).toHaveLength(DITHER_THUMBNAIL_COLUMNS);
    expect(opacities[0]).toBeGreaterThan(0.95);
    expect(opacities.at(-1)).toBeLessThan(0.05);
    opacities.slice(1).forEach((opacity, index) => {
      expect(opacity).toBeLessThan(opacities[index] ?? 0);
    });
  });

  it('computes each thumbnail once', () => {
    expect(ditherThumbnail('jarvis')).toBe(ditherThumbnail('jarvis'));
    expect(thumbnailRampLuma()).toBe(thumbnailRampLuma());
  });
});
