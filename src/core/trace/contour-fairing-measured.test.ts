import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vec2 } from '../scene';
import type * as FairChain from './fair-chain';
import { contourPolylinesFromMask } from './contour-trace';

const fairing = vi.hoisted(() => ({
  calls: [] as {
    points: ReadonlyArray<Vec2>;
    corners: ReadonlySet<Vec2>;
    result: Vec2[];
    shifted: Vec2[];
  }[],
}));

// Observe the real solver inside the real measured-loop pipeline, and
// independently run it from another corner on the same supplied geometry.
vi.mock('./fair-chain', async (importOriginal) => {
  const actual = await importOriginal<typeof FairChain>();
  return {
    ...actual,
    fairChainSegments: (...args: Parameters<typeof actual.fairChainSegments>) => {
      const [points, closed, corners, scale] = args;
      const result = actual.fairChainSegments(...args);
      const offset = points.findIndex((p, i) => i > 0 && corners.has(p));
      const rotated = [...points.slice(offset), ...points.slice(0, offset)];
      const shifted = actual.fairChainSegments(rotated, closed, corners, scale);
      fairing.calls.push({
        points,
        corners,
        result,
        shifted: [
          ...shifted.slice(points.length - offset),
          ...shifted.slice(0, points.length - offset),
        ],
      });
      return result;
    },
  };
});

// A measured outline large enough for the organic fairing path (>4096
// samples), with sub-pixel ink texture along its left side. The luma ramp
// is sampled analytically; no canvas or image-decoder stubs are involved.
function texturedMask() {
  const size = 1110;
  const low = 3.2;
  const high = 1107.2;
  const ripple = (u: number): number => 0.8 * Math.sin((2 * Math.PI * (u - low)) / 6);
  const lumaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= size || y >= size) return 255;
    const px = x + 0.5;
    const py = y + 0.5;
    const depth = Math.min(px - low - ripple(py), high - px, py - low, high - py);
    return 255 * (1 - Math.min(1, Math.max(0, depth + 0.5)));
  };
  const ink = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) ink[y * size + x] = lumaAt(x, y) < 128 ? 1 : 0;
  }
  return {
    mask: { width: size, height: size, ink },
    crackField: { lumaAt, thresholdAt: () => 128 },
  };
}

describe('cornered fairing in the measured contour pipeline', () => {
  beforeEach(() => {
    fairing.calls = [];
  });

  it('retains real corner objects and smooths across the array seam before fitting', () => {
    const { mask, crackField } = texturedMask();
    const output = contourPolylinesFromMask(mask, {
      minAreaPx: 0,
      epsilonPx: 0.45,
      flattenStrength: 1,
      crackField,
    });
    expect(output).toHaveLength(1);
    expect(output[0]?.closed).toBe(true);
    expect(fairing.calls.length).toBeGreaterThan(0);
    const call = fairing.calls[0]!;
    expect(call.points.length).toBeGreaterThan(4096);
    // The corner dial may smooth away the two textured apexes; the two
    // straight-side corners still delimit the closing fairing span.
    expect(call.corners.size).toBeGreaterThanOrEqual(2);
    expect(call.result).toHaveLength(call.points.length);
    for (const corner of call.corners) {
      expect(call.points).toContain(corner);
      expect(call.result[call.points.indexOf(corner)]).toBe(corner);
    }
    let worst = 0;
    call.result.forEach((p, i) => {
      const q = call.shifted[i] as Vec2;
      worst = Math.max(worst, Math.hypot(p.x - q.x, p.y - q.y));
    });
    expect(worst).toBeLessThan(1e-8);
    for (const p of output[0]!.points) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  }, 30000);
});
