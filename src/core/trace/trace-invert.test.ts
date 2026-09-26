// Invert for the line lanes (Line Art, Smooth, Sharp, Centerline, Edge
// Detection). Invert decides which polarity is artwork, so a light-on-dark
// source traced with Invert must follow exactly the route, working grid and
// sub-pixel boundary field of its dark-on-light twin, not merely a similar one.

import { describe, expect, it } from 'vitest';
import {
  inkDisc,
  inkStroke,
  paper,
  toRawImage,
} from '../../__fixtures__/perceptual/procedural-ink';
import type { ColoredPath } from '../scene';
import { traceImageToEdgePaths } from './edge-trace';
import { adjustGamma, invertImage } from './raster-prep';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const CX = 64.3;
const CY = 63.7;
const R = 30.35;
const FILLED_LANES = ['Line Art', 'Smooth', 'Sharp', 'Edge Detection'] as const;

function preset(name: string): TraceOptions {
  const options = TRACE_PRESETS[name];
  if (options === undefined) throw new Error(`missing preset ${name}`);
  return options;
}

function negative(image: RawImageData): RawImageData {
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - (data[i] ?? 0);
    data[i + 1] = 255 - (data[i + 1] ?? 0);
    data[i + 2] = 255 - (data[i + 2] ?? 0);
  }
  return { width: image.width, height: image.height, data };
}

/** Anti-aliased dark disc on paper: its 50% iso-line is the circle of radius R. */
function darkDisc(): RawImageData {
  const luma = paper(128, 128);
  inkDisc(luma, CX, CY, R, 1);
  return toRawImage(luma);
}

/** Thin, small strokes: the input class the small-source upscale policy reads. */
function darkThinStrokes(): RawImageData {
  const luma = paper(96, 48);
  inkStroke(luma, { x: 8, y: 12.3 }, { x: 88, y: 14.1 }, 1.1);
  inkStroke(luma, { x: 10, y: 36.2 }, { x: 60, y: 24.7 }, 0.9);
  return toRawImage(luma);
}

function polylineCount(paths: ReadonlyArray<ColoredPath>): number {
  return paths.reduce((sum, path) => sum + path.polylines.length, 0);
}

/** RMS distance of the drawn outline (segments sampled) from the true circle. */
function radialRmsPx(paths: ReadonlyArray<ColoredPath>): number {
  let sum = 0;
  let samples = 0;
  for (const path of paths) {
    for (const polyline of path.polylines) {
      const points = polyline.points;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        for (let t = 0; t < 1; t += 0.25) {
          const error = Math.hypot(a.x + (b.x - a.x) * t - CX, a.y + (b.y - a.y) * t - CY) - R;
          sum += error * error;
          samples += 1;
        }
      }
    }
  }
  return Math.sqrt(sum / Math.max(1, samples));
}

describe('Invert on the line trace lanes', () => {
  it.each(FILLED_LANES)(
    '%s traces a light-on-dark anti-aliased disc exactly like its dark twin',
    async (name) => {
      const options = preset(name);
      const dark = await traceImageToColoredPaths(darkDisc(), options);
      const light = await traceImageToColoredPaths(negative(darkDisc()), {
        ...options,
        invert: true,
      });

      expect(polylineCount(light)).toBe(1);
      expect(radialRmsPx(light)).toBeLessThan(0.107);
      expect(light).toEqual(dark);
    },
  );

  it.each(FILLED_LANES)(
    '%s without Invert traces the dark ground around a light disc',
    async (name) => {
      const light = await traceImageToColoredPaths(negative(darkDisc()), preset(name));
      // The ground is the artwork: an outer frame plus the disc as its hole.
      expect(polylineCount(light)).toBe(2);
    },
  );

  it.each(['Line Art', 'Sharp', 'Centerline', 'Edge Detection'])(
    '%s gives light thin strokes the same scale route as dark ones',
    async (name) => {
      const options = preset(name);
      const dark = await traceImageToColoredPaths(darkThinStrokes(), options);
      const light = await traceImageToColoredPaths(negative(darkThinStrokes()), {
        ...options,
        invert: true,
      });
      expect(polylineCount(dark)).toBeGreaterThan(0);
      expect(light).toEqual(dark);
    },
  );

  it('the Edge Detection lane honours Invert when called directly', () => {
    const options = preset('Edge Detection');
    const dark = traceImageToEdgePaths(darkDisc(), options);
    const light = traceImageToEdgePaths(negative(darkDisc()), { ...options, invert: true });
    expect(polylineCount(light)).toBe(1);
    expect(light).toEqual(dark);
  });

  it('keeps the transparent surround of a decoded light logo as paper', async () => {
    // A white disc on a transparent PNG, as the image loader hands it over:
    // RGB composited onto white, alpha kept. Byte inversion would make the
    // whole transparent surround ink.
    const decoded = discOnTransparency(255);

    for (const name of FILLED_LANES) {
      const traced = await traceImageToColoredPaths(decoded, { ...preset(name), invert: true });
      expect(polylineCount(traced), name).toBe(1);
      expect(radialRmsPx(traced), name).toBeLessThan(0.107);
    }
  });

  it.each([...FILLED_LANES, 'Centerline'])(
    '%s gives a decoded dark logo on transparency the negative it has on white',
    async (name) => {
      // A black disc on a transparent PNG, composited by the loader: its bytes
      // equal the opaque dark disc, so Invert must give the same negative
      // (the frame with the disc as its hole), never an empty trace.
      const options = { ...preset(name), invert: true };
      const onTransparency = await traceImageToColoredPaths(discOnTransparency(0), options);
      const onWhite = await traceImageToColoredPaths(darkDisc(), options);

      expect(polylineCount(onTransparency)).toBeGreaterThan(0);
      if (name !== 'Centerline') expect(polylineCount(onTransparency)).toBe(2);
      expect(onTransparency).toEqual(onWhite);
    },
  );

  it('applies gamma before Invert, the documented adjustment order', async () => {
    // A soft-edged disc: gamma moves its 50% iso-line, and gamma-then-invert
    // moves it the opposite way from invert-then-gamma.
    const luma = paper(128, 128);
    inkDisc(luma, CX, CY, R, 12);
    const soft = toRawImage(luma);
    const options = preset('Line Art');

    const traced = await traceImageToColoredPaths(soft, { ...options, gamma: 2, invert: true });
    const toneFirst = await traceImageToColoredPaths(invertImage(adjustGamma(soft, 2)), options);
    const invertFirst = await traceImageToColoredPaths(adjustGamma(invertImage(soft), 2), options);

    expect(traced).toEqual(toneFirst);
    expect(traced).not.toEqual(invertFirst);
  });
});

/** A disc of straight grey `ink` on transparency, as the loader decodes it:
 * alpha is the disc's anti-aliased coverage, RGB is composited onto white. */
function discOnTransparency(ink: number): RawImageData {
  const coverage = negative(darkDisc());
  const data = new Uint8ClampedArray(coverage.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = coverage.data[i] ?? 0;
    data.fill(Math.round(255 - (alpha / 255) * (255 - ink)), i, i + 3);
    data[i + 3] = alpha;
  }
  return { width: 128, height: 128, data, rgbCompositedOnWhite: true };
}
