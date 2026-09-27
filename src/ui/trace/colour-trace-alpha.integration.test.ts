import { describe, expect, it } from 'vitest';
import { traceImageToColoredPaths } from '../../core/trace';
import { canvas, covers, OPTIONS } from '../../core/trace/colour-layer-trace.test-support';
import { compositeRgbOverWhitePreservingAlpha } from './image-loader';

describe('colour trace after the real decoder appearance step', () => {
  it.each([127, 128])(
    'retains translucent ink on both sides of the old alpha cutoff: %s',
    async (alpha) => {
      const raw = canvas(64, 48, [255, 255, 255]);
      const flat = canvas(64, 48, [255, 255, 255]);
      for (let y = 12; y < 36; y += 1) {
        for (let x = 12; x < 52; x += 1) {
          const offset = (y * raw.width + x) * 4;
          raw.data.set([0, 0, 0, alpha], offset);
          // Independent expected opaque PNG bytes for black over white.
          flat.data.set([255 - alpha, 255 - alpha, 255 - alpha, 255], offset);
        }
      }
      const decoded = compositeRgbOverWhitePreservingAlpha(raw);
      expect(decoded.rgbCompositedOnWhite).toBe(true);
      const options = { ...OPTIONS, colourLayers: { colours: 2 } };
      const traced = await traceImageToColoredPaths(decoded, options);
      expect(traced).toEqual(await traceImageToColoredPaths(flat, options));
      expect(traced).toEqual(await traceImageToColoredPaths(raw, options));
      expect(traced).toHaveLength(1);
      const ink = traced[0];
      expect(ink?.color).toBe(alpha === 127 ? '#808080' : '#7f7f7f');
      if (ink === undefined) return;
      expect(covers(ink, { x: 20.5, y: 20.5 })).toBe(true);
      expect(covers(ink, { x: 2.5, y: 2.5 })).toBe(false);
    },
  );
});
