import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import { planarPathDensity, planarTravelOpacity, planarViewScale } from './planar-path-density';
import type { Viewer3dSegmentsInput } from './segment-buckets';

function segments(
  positions: readonly number[],
  kinds: readonly number[],
  visible?: readonly number[],
): Viewer3dSegmentsInput {
  return {
    segmentCount: kinds.length,
    positions: new Float32Array(positions),
    segKind: new Uint8Array(kinds),
    ...(visible === undefined ? {} : { visible: new Uint8Array(visible) }),
  };
}

// Two 10 mm travels and two cuts bound a 10 by 10 mm square at Z4.
function square(visible?: readonly number[]): Viewer3dSegmentsInput {
  return segments(
    [0, 0, 4, 10, 0, 4, 10, 0, 4, 10, 10, 4, 10, 10, 4, 0, 10, 4, 0, 10, 4, 0, 0, 4],
    [SEG_KIND.travel, SEG_KIND.cut, SEG_KIND.travel, SEG_KIND.cut],
    visible,
  );
}

describe('planar path geometry density', () => {
  it('divides every travel length by the full XY bounding area, excluding cuts', () => {
    expect(planarPathDensity(square())?.travelPerMm).toBeCloseTo(20 / 100);
  });

  it('measures diagonal XY travel by its geometric length', () => {
    const input = segments(
      [0, 0, 0, 3, 4, 0, 10, 10, 0, 10, 0, 0],
      [SEG_KIND.travel, SEG_KIND.cut],
    );
    expect(planarPathDensity(input)?.travelPerMm).toBeCloseTo(5 / 100);
  });

  it('excludes hidden travel from length while retaining the full program bounds', () => {
    const input = segments(
      [0, 0, 0, 10, 0, 0, 20, 10, 0, 20, 0, 0],
      [SEG_KIND.travel, SEG_KIND.travel],
      [1, 0],
    );
    expect(planarPathDensity(input)?.travelPerMm).toBeCloseTo(10 / 200);
    expect(planarPathDensity(square([0, 0, 0, 0]))?.travelPerMm).toBe(0);
  });

  it('is unchanged by translating the work origin on any axis', () => {
    const input = square();
    const original = [...input.positions];
    const offset = [123.25, -500.75, 12.5];
    const translated = {
      ...input,
      positions: input.positions.map((value, index) => value + (offset[index % 3] ?? 0)),
    };
    expect(planarPathDensity(translated)).toEqual(planarPathDensity(input));
    expect([...input.positions]).toEqual(original);
  });

  it('accepts small coordinate noise around a plane', () => {
    const input = square();
    input.positions[2] = 4.0005;
    expect(planarPathDensity(input)?.travelPerMm).toBeCloseTo(20 / 100);
  });

  it('rejects a path that changes depth inside a cut', () => {
    const input = square();
    input.positions[11] = 3.9;
    expect(planarPathDensity(input)).toBeNull();
  });

  it('rejects separate horizontal CNC passes at different depths', () => {
    const input = segments(
      [0, 0, -1, 10, 0, -1, 0, 10, -2, 10, 10, -2],
      [SEG_KIND.cut, SEG_KIND.cut],
    );
    expect(planarPathDensity(input)).toBeNull();
  });

  it.each([
    {
      name: 'horizontal line',
      positions: [0, 5, 0, 10, 5, 0],
      kinds: [SEG_KIND.travel],
    },
    {
      name: 'vertical line',
      positions: [5, 0, 0, 5, 10, 0],
      kinds: [SEG_KIND.travel],
    },
    {
      name: 'stationary segment',
      positions: [5, 5, 0, 5, 5, 0],
      kinds: [SEG_KIND.travel],
    },
  ])(
    'retains flat stroke ordering for a $name without dividing by zero',
    ({ positions, kinds }) => {
      const density = planarPathDensity(segments(positions, kinds));
      expect(density).toEqual({ travelPerMm: 0 });
      expect(planarTravelOpacity(density, 10, 0.35)).toBe(0.35);
    },
  );

  it('leaves an empty program unclassified', () => {
    expect(planarPathDensity(segments([], []))).toBeNull();
  });

  it.each([0.0005, 0.000999])('accepts a collinear path with a %s mm Z span', (span) => {
    expect(planarPathDensity(segments([0, 0, 0, 100, 0, span], [SEG_KIND.cut]))).toEqual({
      travelPerMm: 0,
    });
  });

  it.each([0.001001, 1])('keeps depth writes for a collinear path with a %s mm Z span', (span) => {
    expect(planarPathDensity(segments([0, 0, 0, 100, 0, span], [SEG_KIND.cut]))).toBeNull();
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'does not classify a nonfinite coordinate at index %i as flat',
    (at) => {
      for (const value of [Number.NaN, Infinity, -Infinity]) {
        const positions = [0, 0, 0, 100, 0, 0];
        positions[at] = value;
        expect(planarPathDensity(segments(positions, [SEG_KIND.cut]))).toBeNull();
      }
    },
  );

  it('keeps a diagonal line with a finite XY bounding area finite', () => {
    const density = planarPathDensity(segments([0, 0, 0, 3, 4, 0], [SEG_KIND.travel]));
    expect(density?.travelPerMm).toBeCloseTo(5 / 12);
    expect(Number.isFinite(planarTravelOpacity(density, 1, 0.35))).toBe(true);
  });
});

describe('planar travel opacity at the displayed scale', () => {
  it.each([0.35, 0.55, 0.1])(
    'weakens overlapping travel while zooming out and restores its %.2f close-view opacity',
    (opacity) => {
      const density = { travelPerMm: 20 };
      const close = planarTravelOpacity(density, 0.001, opacity);
      const middle = planarTravelOpacity(density, 0.02, opacity);
      const distant = planarTravelOpacity(density, 1, opacity);
      expect(close).toBe(opacity);
      expect(middle).toBeGreaterThan(distant);
      expect(middle).toBeLessThan(close);
      expect(distant).toBeGreaterThan(0);
      // Twenty travel strokes cover one pixel here. Their combined tint must
      // remain weaker than one ordinary close-view travel stroke.
      const accumulatedTint = 1 - (1 - distant) ** 20;
      expect(accumulatedTint).toBeLessThan(opacity);
    },
  );

  it('responds to denser geometry at the same zoom', () => {
    const sparse = planarTravelOpacity({ travelPerMm: 0.2 }, 1, 0.35);
    const dense = planarTravelOpacity({ travelPerMm: 20 }, 1, 0.35);
    expect(dense).toBeLessThan(sparse);
  });

  it('keeps normal opacity for a planar program with no visible travel', () => {
    expect(planarTravelOpacity({ travelPerMm: 0 }, 100, 0.55)).toBe(0.55);
  });

  it('keeps the normal style for paths with CNC depth changes', () => {
    const input = square();
    input.positions[2] = 5;
    expect(planarTravelOpacity(planarPathDensity(input), 100, 0.55)).toBe(0.55);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'keeps a finite normal opacity when the pixel scale is %s',
    (mmPerPixel) => {
      expect(planarTravelOpacity({ travelPerMm: 20 }, mmPerPixel, 0.35)).toBe(0.35);
    },
  );
});

describe('planar coverage in an angled view', () => {
  it('keeps the plan-view pixel scale in Top', () => {
    expect(planarViewScale(0.25, { x: 0, y: 0 })).toBe(0.25);
  });

  it('accounts for the XY area compressed by the Iso camera', () => {
    // The preset looks from (0.6, -0.6, 0.55). A unit quaternion tilting the
    // camera by that angle around an XY diagonal has these two components.
    const facing = 0.55 / Math.hypot(0.6, 0.6, 0.55);
    const halfTilt = Math.acos(facing) / 2;
    const component = Math.sin(halfTilt) / Math.SQRT2;
    const projected = planarViewScale(0.25, { x: component, y: component });
    expect(projected).toBeCloseTo(0.25 / facing);
    expect(projected / 0.25).toBeGreaterThan(1.8);
    expect(projected / 0.25).toBeLessThan(1.9);
  });

  it('treats Bottom like Top when the plane normal points away from the camera', () => {
    expect(planarViewScale(0.25, { x: 1, y: 0 })).toBe(0.25);
    expect(planarViewScale(0.25, { x: 0, y: 1 })).toBe(0.25);
  });

  it('caps finite coverage in the edge-on Front view', () => {
    const projected = planarViewScale(0.25, { x: Math.SQRT1_2, y: 0 });
    expect(projected).toBeCloseTo(25);
    expect(Number.isFinite(projected)).toBe(true);
    expect(planarTravelOpacity({ travelPerMm: 20 }, projected, 0.35)).toBeGreaterThan(0);
  });

  it('includes both quaternion tilt components in the travel coverage', () => {
    // A sixty-degree tilt around an XY diagonal halves the projected area.
    const component = Math.sin(Math.PI / 6) / Math.SQRT2;
    const projected = planarViewScale(0.25, { x: component, y: component });
    expect(projected).toBeCloseTo(0.5);
    const density = { travelPerMm: 20 };
    expect(planarTravelOpacity(density, projected, 0.35)).toBeLessThan(
      planarTravelOpacity(density, 0.25, 0.35),
    );
  });
});
