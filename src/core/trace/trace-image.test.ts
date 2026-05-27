import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRACE_OPTIONS,
  thresholdToMonochrome,
  traceImageToSvgString,
} from './trace-image';

// Build a tiny synthetic raster: a black square (8×8) centered in a
// white 16×16 image. RGBA uint8 layout matches what canvas.getImageData
// returns; imagetracerjs doesn't care if the buffer came from a real
// canvas or a fixture as long as the shape matches.
function blackSquareOnWhite(): {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
} {
  const W = 16;
  const H = 16;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const inSquare = x >= 4 && x < 12 && y >= 4 && y < 12;
      const v = inSquare ? 0 : 255;
      data[i + 0] = v; // r
      data[i + 1] = v; // g
      data[i + 2] = v; // b
      data[i + 3] = 255; // a
    }
  }
  return { width: W, height: H, data };
}

describe('traceImageToSvgString', () => {
  it('returns a string starting with <svg', () => {
    const svg = traceImageToSvgString(blackSquareOnWhite());
    expect(typeof svg).toBe('string');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('produces a non-trivially-sized SVG (more than just the root tag)', () => {
    const svg = traceImageToSvgString(blackSquareOnWhite());
    // A black-on-white traced output should contain at least one
    // <path>, <polygon>, or <rect> element with coordinates.
    expect(svg.length).toBeGreaterThan(50);
    expect(svg).toMatch(/<(path|polygon|polyline|rect)/);
  });

  it('fixed-palette mode produces a 2-color output regardless of input richness', () => {
    // The "Line Art" preset uses a fixed [white, black] palette.
    // Even on a noisy 4-color fixture it must yield exactly two
    // color layers in the SVG (clean ink + background).
    const W = 16;
    const H = 16;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i += 1) {
      // Stripe the image into 4 grays so default quantization would
      // produce 4 layers.
      const v = (Math.floor(i / 4) % 4) * 80;
      data[i * 4 + 0] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    const svg = traceImageToSvgString(
      { width: W, height: H, data },
      {
        ...DEFAULT_TRACE_OPTIONS,
        fixedPalette: ['#ffffff', '#000000'],
      },
    );
    // imagetracerjs emits <g> per color; count distinct fill colors
    // in the output. With a fixed [white, black] palette, no other
    // fill values should appear.
    const fills = Array.from(svg.matchAll(/fill="rgb\(([^)]+)\)"/g)).map((m) => m[1]);
    const uniqueFills = new Set(fills);
    expect(uniqueFills.size).toBeLessThanOrEqual(2);
  });

  it('respects numberOfColors — 2 colors produces fewer/different layers than 8', () => {
    const two = traceImageToSvgString(blackSquareOnWhite(), {
      ...DEFAULT_TRACE_OPTIONS,
      numberOfColors: 2,
    });
    const eight = traceImageToSvgString(blackSquareOnWhite(), {
      ...DEFAULT_TRACE_OPTIONS,
      numberOfColors: 8,
    });
    // Different color quantization → different SVG output. We don't
    // assert one is strictly larger (small fixtures can flip), just
    // that the option changes the output meaningfully.
    expect(two).not.toBe(eight);
  });

  it('end-to-end: trace + parseSvg produces drawable ColoredPath polylines', async () => {
    // Phase E full pipeline check. The dialog runs exactly this
    // chain: ImageData → traceImageToSvgString → parseSvg → object
    // with `paths: ColoredPath[]`. If anything in that chain
    // regresses, this test catches it.
    const { parseSvg } = await import('../../io/svg/parse-svg');
    const svg = traceImageToSvgString(blackSquareOnWhite());
    const result = parseSvg({ svgText: svg, id: 'test', source: 'fixture.png' });
    expect(result.object).not.toBeNull();
    if (result.object !== null) {
      expect(result.object.paths.length).toBeGreaterThan(0);
      // At least one polyline with at least 2 points (otherwise
      // there's nothing to cut).
      const anyPolyline = result.object.paths.some((p) =>
        p.polylines.some((pl) => pl.points.length >= 2),
      );
      expect(anyPolyline).toBe(true);
    }
  });

  it('thresholdToMonochrome turns AA grays into pure black or white', () => {
    // 4×1 image with luminance values: 0 (black), 100 (dark gray),
    // 180 (light gray), 255 (white). With threshold 128, the first
    // two become black, the last two become white.
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, // black
      100, 100, 100, 255, // dark gray — below threshold
      180, 180, 180, 255, // light gray — above threshold
      255, 255, 255, 255, // white
    ]);
    const result = thresholdToMonochrome({ width: 4, height: 1, data }, 128);
    expect(Array.from(result.data)).toEqual([
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]);
  });

  it('thresholdToMonochrome is pure — does not mutate the input', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    const original = new Uint8ClampedArray(data);
    thresholdToMonochrome({ width: 1, height: 1, data }, 128);
    expect(Array.from(data)).toEqual(Array.from(original));
  });

  it('Line Art preset: traces an AA-heavy fixture without spurious dots', () => {
    // Build a 32×32 fixture: a 12×12 black square at (10,10) with
    // gradient-shaded AA borders 1 pixel wide. Without pre-threshold
    // these borders produce edge speckle in the trace; with the
    // Line Art preset they should collapse to a single solid square
    // outline (one or two contours, no dot clusters).
    const W = 32;
    const H = 32;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const dx = x - 16;
        const dy = y - 16;
        const distToCenter = Math.max(Math.abs(dx), Math.abs(dy));
        let v: number;
        if (distToCenter < 5) v = 0; // pure black square center
        else if (distToCenter > 8) v = 255; // pure white outside
        else v = 128; // AA gray on the border ring
        const i = (y * W + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const svg = traceImageToSvgString(
      { width: W, height: H, data },
      {
        ...DEFAULT_TRACE_OPTIONS,
        fixedPalette: ['#ffffff', '#000000'],
        thresholdLuma: 128,
        pathOmit: 16,
      },
    );
    // Without pre-threshold + pathOmit, that AA ring would produce
    // dozens of tiny disconnected paths. With both on, count of
    // <path> elements should be small (≤ 4: one or two solid
    // contours + maybe background).
    const pathCount = (svg.match(/<path/g) ?? []).length;
    expect(pathCount).toBeLessThanOrEqual(4);
  });

  it('handles a fully-uniform image without throwing', () => {
    // All-white 8×8 — nothing to trace. Should still produce a valid
    // SVG string (probably empty or just the root tag).
    const W = 8;
    const H = 8;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i + 0] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    expect(() => traceImageToSvgString({ width: W, height: H, data })).not.toThrow();
  });
});
