// Palette, background and dispatch behaviour of the colour-layer trace
// (ADR-430); the geometry tests live in colour-layer-trace.test.ts.
import { describe, expect, it } from 'vitest';
import type { RawImageData } from './trace-image';
import { isColourLayerTrace } from './colour-layer-trace';
import { TRACE_PRESETS } from './trace-presets';
import { colourLayerSettings } from './colour-layer-power';
import {
  canvas,
  coverageStats,
  fillDisc,
  fillRect,
  OPTIONS,
  render,
  rgbImage,
  trace,
  type Rgb,
} from './colour-layer-trace.test-support';

// Deterministic ±amplitude noise per channel (a small LCG), like scanner or
// JPEG grain on flat colour.
function withNoise(image: RawImageData, amplitude: number): RawImageData {
  const data = new Uint8ClampedArray(image.data);
  let state = 12345;
  for (let i = 0; i < data.length; i += 1) {
    if (i % 4 === 3) continue;
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (data[i] as number) + ((state % (2 * amplitude + 1)) - amplitude);
  }
  return { ...image, data };
}

const RGB_AA = (x: number, y: number): Rgb => {
  if (x < 10.25 || x >= 50.75 || y < 8.25 || y >= 32.25) return [255, 255, 255];
  if (y >= 20.5) return [30, 50, 200];
  return x < 30.5 ? [220, 30, 30] : [30, 160, 40];
};

describe('colour-layer dispatch', () => {
  it('routes only the Colour layers preset to the colour backend', () => {
    for (const [name, preset] of Object.entries(TRACE_PRESETS)) {
      expect(isColourLayerTrace(preset)).toBe(name === 'Colour layers');
    }
    // Centerline, Edge and Photo shading keep their own backends.
    expect(isColourLayerTrace({ ...OPTIONS, traceMode: 'centerline' })).toBe(false);
    expect(isColourLayerTrace({ ...OPTIONS, traceMode: 'edge' })).toBe(false);
    expect(isColourLayerTrace({ ...OPTIONS, photoDetail: 50 })).toBe(false);
  });
});

describe('colour-layer palette', () => {
  it('finds three ink colours automatically through anti-aliasing and grain', () => {
    const paths = trace(withNoise(render(60, 40, RGB_AA), 6));
    expect(paths).toHaveLength(3);
    for (const path of paths) expect(path.polylines).toHaveLength(1);
  });

  it('fills the artwork without a gap: union equals the anti-aliased art', () => {
    const image = render(60, 40, RGB_AA);
    const { counts } = coverageStats(trace(image), image.width, image.height);
    let gap = 0;
    let spill = 0;
    let s = 0;
    for (let sy = 0; sy < image.height * 4; sy += 1) {
      for (let sx = 0; sx < image.width * 4; sx += 1) {
        const x = (sx + 0.5) / 4;
        const y = (sy + 0.5) / 4;
        // Samples within 0.3 px of the outer outline are judged by the area test.
        const edge = Math.min(
          Math.abs(x - 10.25),
          Math.abs(x - 50.75),
          Math.abs(y - 8.25),
          Math.abs(y - 32.25),
        );
        const inArt = x >= 10.25 && x < 50.75 && y >= 8.25 && y < 32.25;
        const c = counts[s] as number;
        if (edge >= 0.3 && inArt && c === 0) gap += 1;
        if (edge >= 0.3 && !inArt && c > 0) spill += 1;
        s += 1;
      }
    }
    expect(gap).toBe(0);
    expect(spill).toBe(0);
  });

  it('honours a requested colour count that includes the paper', () => {
    // Two colours = paper + one ink: the three inks become one layer.
    const two = trace(rgbImage(), { ...OPTIONS, colourLayers: { colours: 2 } });
    expect(two).toHaveLength(1);
    expect(two[0]?.polylines).toHaveLength(1);
    const four = trace(rgbImage(), { ...OPTIONS, colourLayers: { colours: 4 } });
    expect(four).toHaveLength(3);
  });

  it('excludes the paper by default and traces it on request', () => {
    const kept = trace(rgbImage(), { ...OPTIONS, colourLayers: { keepBackground: true } });
    expect(kept).toHaveLength(4);
    // Lightest first: the paper is the bottom layer and has the art as a hole.
    expect(kept[0]?.color).toMatch(/^#f[0-9a-f]f[0-9a-f]f[0-9a-f]$/);
    expect(kept[0]?.polylines).toHaveLength(2);
  });

  it('treats transparent pixels as untraced, with no paper colour', () => {
    const image = rgbImage();
    const data = new Uint8ClampedArray(image.data);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) data[i + 3] = 0;
    }
    const paths = trace({ ...image, data });
    expect(paths).toHaveLength(3);
  });

  it('returns nothing for a blank page', () => {
    const blank = render(20, 20, () => [255, 255, 255]);
    expect(trace(blank)).toEqual([]);
  });
});

describe('colour-layer paper detection', () => {
  const colours = (paths: ReadonlyArray<{ readonly color: string }>): string[] =>
    paths.map((path) => path.color).sort();

  it('never takes a dark full-bleed field for paper (light-on-dark art)', () => {
    const image = canvas(100, 100, [0, 0, 0]);
    fillDisc(image, 50, 50, 25, [255, 255, 255]);
    const paths = trace(image);
    // Both colours are traced, so nothing is silently left out...
    expect(colours(paths)).toEqual(['#000000', '#ffffff']);
    // ...and only the black field burns: the white disc starts with output off.
    const settings = colourLayerSettings(colours(paths), 100, { output: 'cut-out' });
    expect(settings.get('#000000')).toEqual({ power: 100, output: true });
    expect(settings.get('#ffffff')).toEqual({ power: 0, output: false });
  });

  it('traces both colours of a full-bleed two-colour flag, whichever holds the border', () => {
    for (const redRows of [30, 31, 29]) {
      const image = canvas(100, 60, [20, 40, 160]);
      fillRect(image, 0, 0, 100, redRows, [200, 20, 20]);
      expect(trace(image)).toHaveLength(2);
    }
  });

  it('still leaves light paper untraced, including a kraft tone', () => {
    for (const paper of [
      [255, 255, 255],
      [200, 160, 110],
    ] as const) {
      const image = canvas(80, 60, paper);
      fillRect(image, 10, 10, 40, 40, [30, 20, 10]);
      fillRect(image, 45, 10, 70, 40, [150, 30, 30]);
      expect(trace(image)).toHaveLength(2);
    }
  });
});
