// Public-entry regressions for the 2026-09-27 colour detail/alpha correction
// (ADR-461 Amendment 2): speck area is measured the way outlines are traced
// (4-connected, plus coherent diagonal hairlines only), and anti-aliased art
// on transparency keeps its ~50 % coverage edge while translucent ink stays.
import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../scene';
import type { TraceOptions } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';
import { fillRect, lightness, OPTIONS } from './colour-layer-trace.test-support';
import {
  checkerboardPatch,
  type Coverage,
  disc,
  ditheredGradient,
  inkOnTransparency,
  ring,
  sampledArea,
  subpaths,
} from './colour-layer-regressions.test-support';

describe('colour-layer speck removal matches traced connectivity', () => {
  it('clears a 1-px checkerboard patch at the default speck area', async () => {
    const paths = await traceImageToColoredPaths(checkerboardPatch(), OPTIONS);
    expect(subpaths(paths)).toBeLessThanOrEqual(4);
  });

  it('does not trace every dither dot of a halftoned ramp as its own outline', async () => {
    const paths = await traceImageToColoredPaths(ditheredGradient(), OPTIONS);
    expect(subpaths(paths)).toBeLessThanOrEqual(40);
  });
});

describe('colour-layer anti-aliased art on transparency', () => {
  const cases: ReadonlyArray<readonly [string, Coverage, number, number]> = [
    ['disc r=20', disc(20), Math.PI * 400, 0.02],
    ['4 px ring', ring(20, 16), Math.PI * (400 - 256), 0.05],
  ];
  for (const [name, shape, trueArea, tolerance] of cases) {
    for (const tagged of [false, true]) {
      for (const colours of [undefined, 2, 3] as const) {
        it(`keeps the ${name} edge at half coverage (tagged=${tagged}, colours=${colours ?? 'auto'})`, async () => {
          const options: TraceOptions =
            colours === undefined ? OPTIONS : { ...OPTIONS, colourLayers: { ...OPTIONS.colourLayers, colours } };
          const paths = await traceImageToColoredPaths(inkOnTransparency(64, shape, tagged), options);
          // One ink layer (no grey fringe layer); its mean may round off pure black.
          expect(paths).toHaveLength(1);
          expect(lightness((paths[0] as ColoredPath).color)).toBeLessThan(40);
          const area = sampledArea(paths[0] as ColoredPath, 64, 64);
          expect(Math.abs(area - trueArea) / trueArea).toBeLessThan(tolerance);
        });
      }
    }
  }

  it('still traces translucent ink below alpha 128 at its own half-coverage edge', async () => {
    const trueArea = Math.PI * 400;
    for (const tagged of [false, true]) {
      const paths = await traceImageToColoredPaths(
        inkOnTransparency(64, disc(20), tagged, 0.25),
        OPTIONS,
      );
      expect(paths).toHaveLength(1);
      const area = sampledArea(paths[0] as ColoredPath, 64, 64);
      expect(Math.abs(area - trueArea) / trueArea).toBeLessThan(0.02);
    }
  });

  it('brings a soft drop shadow in as one to three extra grey layers (intended)', async () => {
    const size = 120;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // Shadow of the square offset by 8 px, alpha falling linearly over 12 px.
        const dx = Math.max(38 - x, 0, x - 89);
        const dy = Math.max(38 - y, 0, y - 89);
        const fall = Math.max(0, 1 - Math.hypot(dx, dy) / 12);
        data.set([0, 0, 0, Math.round(120 * fall)], (y * size + x) * 4);
      }
    }
    fillRect({ width: size, height: size, data }, 30, 30, 82, 82, [200, 20, 20]);
    for (let y = 30; y < 82; y += 1) {
      for (let x = 30; x < 82; x += 1) data[(y * size + x) * 4 + 3] = 255;
    }
    const paths = await traceImageToColoredPaths({ width: size, height: size, data }, OPTIONS);
    const colours = paths.map((path) => path.color);
    expect(colours).toContain('#c81414');
    const shadows = colours.filter((colour) => colour !== '#c81414');
    expect(shadows.length).toBeGreaterThanOrEqual(1);
    expect(shadows.length).toBeLessThanOrEqual(3);
    for (const colour of shadows) {
      expect(colour.slice(1, 3)).toBe(colour.slice(3, 5));
      expect(colour.slice(3, 5)).toBe(colour.slice(5, 7));
    }
  });
});
