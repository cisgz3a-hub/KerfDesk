import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { isolatePlanes, moveFilterMask, NO_ISOLATE, zStops } from './isolate';

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

// Three passes of a square at Z -1, -2 and -3, with rapids at Z 5.
function pocket(): GcodeRenderModel {
  const lines = ['G21 G90', 'G0 Z5'];
  for (const depth of [-1, -2, -3]) {
    lines.push('G0 X0 Y0', `G1 Z${depth} F300`, 'G1 X40 F900', 'G1 Y40', 'G1 X0', 'G1 Y0', 'G0 Z5');
  }
  return model(lines.join('\n'));
}

// Whether a point stays drawn: on the kept side of every plane.
function kept(planes: ReturnType<typeof isolatePlanes>, point: [number, number, number]): boolean {
  return planes.every(
    (plane) =>
      plane.normal[0] * point[0] +
        plane.normal[1] * point[1] +
        plane.normal[2] * point[2] +
        plane.constant >=
      0,
  );
}

describe('isolatePlanes', () => {
  it('clips nothing when nothing is isolated', () => {
    expect(isolatePlanes(NO_ISOLATE)).toEqual([]);
  });

  it('keeps a Z range including moves exactly on its limits', () => {
    const planes = isolatePlanes({ zRange: { low: -2, high: -2 }, section: null });
    expect(kept(planes, [10, 10, -2])).toBe(true);
    expect(kept(planes, [10, 10, -1])).toBe(false);
    expect(kept(planes, [10, 10, -3])).toBe(false);
  });

  it('keeps the near side of a section, or the far side when flipped', () => {
    const near = isolatePlanes({ zRange: null, section: { axis: 'x', at: 20, flip: false } });
    expect(kept(near, [10, 0, 0])).toBe(true);
    expect(kept(near, [30, 0, 0])).toBe(false);
    const far = isolatePlanes({ zRange: null, section: { axis: 'y', at: 20, flip: true } });
    expect(kept(far, [0, 30, 0])).toBe(true);
    expect(kept(far, [0, 10, 0])).toBe(false);
  });
});

describe('zStops', () => {
  it('stops at the bottom, every cutting level and the top, lowest first', () => {
    expect(zStops(pocket())).toEqual([-3, -2, -1, 5]);
  });

  it('steps evenly when a finishing pass has too many levels to list', () => {
    const lines = ['G21 G90', 'G0 Z1'];
    for (let row = 1; row <= 300; row += 1) {
      lines.push(`G1 Z${-row / 100} F500`, `G1 X${row % 2 ? 10 : 0}`);
    }
    const stops = zStops(model(lines.join('\n'))) ?? [];
    expect(stops).toHaveLength(201);
    expect(stops[0]).toBeCloseTo(-3, 6);
    expect(stops.at(-1)).toBe(1);
  });

  it('has no stops for a program that never moves', () => {
    expect(zStops(model('G21 G90\nM3 S0'))).toBeNull();
  });
});

describe('moveFilterMask', () => {
  it('draws everything when no entry is switched off', () => {
    expect(moveFilterMask(4, () => 0, new Set())).toBeNull();
  });

  it('leaves out the moves of each switched-off entry', () => {
    const entryOf = (index: number): number => index % 3;
    expect([...(moveFilterMask(6, entryOf, new Set([1])) ?? [])]).toEqual([1, 0, 1, 1, 0, 1]);
  });
});
