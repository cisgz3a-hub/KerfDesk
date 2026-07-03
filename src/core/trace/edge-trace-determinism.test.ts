// The chain-assembly stages use spatial grids (Map-backed) to accelerate the
// weld/reconnect nearest-geometry searches. A grid must never change WHICH
// geometry wins — only how fast it is found — so the trace output must be
// bit-for-bit identical across repeated runs. This pins that cheaply (deep
// equality of the full ColoredPath[] over two runs), catching any accidental
// dependence on Map/Set iteration order a grid could introduce.

import { describe, expect, it } from 'vitest';
import { traceImageToEdgePaths } from './edge-trace';
import { TRACE_PRESETS } from './trace-presets';
import type { RawImageData } from './trace-image';

const EDGE_OPTIONS = TRACE_PRESETS['Edge Detection']!;

// A plus of bars: crossing strokes exercise junction pairing, bridging, weld
// foot-finding and ridge-walk arrival — every grid-accelerated search path.
function plusOfBars(): RawImageData {
  const size = 96;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const inV = x >= 40 && x < 56 && y >= 12 && y < 84;
      const inH = y >= 40 && y < 56 && x >= 12 && x < 84;
      const v = inV || inH ? 0 : 255;
      const o = (y * size + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  return { width: size, height: size, data };
}

describe('traceImageToEdgePaths determinism', () => {
  it('produces bit-identical output across repeated runs', () => {
    const image = plusOfBars();
    const first = traceImageToEdgePaths(image, EDGE_OPTIONS);
    const second = traceImageToEdgePaths(image, EDGE_OPTIONS);
    expect(second).toEqual(first);
    // Deep equality alone can pass on empty output; assert there is geometry.
    const polylineCount = first.flatMap((p) => p.polylines).length;
    expect(polylineCount).toBeGreaterThan(0);
  });
});
