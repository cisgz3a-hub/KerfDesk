import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACE_OPTIONS, traceImageToSvgString } from './trace-image';

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
