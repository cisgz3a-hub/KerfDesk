import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { directionArrows } from './direction-arrows';

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

// A 100 mm cut along +X at depth, with rapids either side.
const STRAIGHT = ['G21 G90', 'M3 S600', 'G0 X0 Y0', 'G1 Z-1 F200', 'G1 X100 F800', 'G0 Z5'].join(
  '\n',
);

const REVERSED = ['G21 G90', 'M3 S600', 'G0 X100 Y0', 'G1 Z-1 F200', 'G1 X0 F800', 'G0 Z5'].join(
  '\n',
);

function firstLateralX(arrows: ReturnType<typeof directionArrows>): number {
  return arrows.filter((arrow) => Math.abs(arrow.direction.x) > 0.5)[0]?.direction.x ?? 0;
}

describe('directionArrows', () => {
  it('points along the direction of travel', () => {
    const arrows = directionArrows(model(STRAIGHT));
    expect(arrows.length).toBeGreaterThan(0);
    const along = arrows.filter((arrow) => Math.abs(arrow.direction.x - 1) < 1e-6);
    expect(along.length).toBeGreaterThan(0);
    for (const arrow of along) {
      expect(arrow.direction.y).toBeCloseTo(0, 6);
      expect(arrow.position.z).toBeCloseTo(-1, 6);
    }
  });

  it('reverses when the cut reverses — the whole point of the overlay', () => {
    expect(firstLateralX(directionArrows(model(STRAIGHT)))).toBeCloseTo(1, 6);
    expect(firstLateralX(directionArrows(model(REVERSED)))).toBeCloseTo(-1, 6);
  });

  it('emits unit directions', () => {
    for (const arrow of directionArrows(model(STRAIGHT))) {
      const length = Math.hypot(arrow.direction.x, arrow.direction.y, arrow.direction.z);
      expect(length).toBeCloseTo(1, 6);
    }
  });

  it('never marks rapids', () => {
    // Nothing cuts here, so the long rapids must stay bare.
    const arrows = directionArrows(model(['G21 G90', 'M3 S1', 'G0 X200', 'G0 X0'].join('\n')));
    expect(arrows).toEqual([]);
  });

  it('spreads by distance, so a dense curve does not hog every arrow', () => {
    const dense = ['G21 G90', 'M3 S1', 'G1 Z-1 F200'];
    for (let step = 1; step <= 100; step += 1) dense.push(`G1 X${step} F800`);
    const arrows = directionArrows(model(dense.join('\n')));
    // Bounded either way — never one per segment.
    expect(arrows.length).toBeLessThan(80);
    expect(arrows.length).toBeGreaterThan(10);
  });

  it('is empty when the program never cuts', () => {
    expect(directionArrows(model(['G21 G90', 'M3 S0', 'M5'].join('\n')))).toEqual([]);
  });
});
