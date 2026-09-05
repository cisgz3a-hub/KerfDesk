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

  it('does not mark rapid downward Z motion as cutting', () => {
    expect(directionArrows(model('G0 Z-2'))).toEqual([]);
  });

  it('ignores geometry that overflows render storage without losing valid arrows', () => {
    const extreme = '1000000000000000000000000000000000000000';
    const built = model(`G1 X${extreme} F800\nG1 X0\nG1 X100`);
    expect(built.positions.some((value) => !Number.isFinite(value))).toBe(true);
    expect(directionArrows(built)).toEqual(directionArrows(model('G1 X100 F800')));
    expect(directionArrows(model(`G1 X${extreme} F800`))).toEqual([]);
  });

  it('places the same arrows on a long cut regardless of its segment sampling', () => {
    const single = model('G1 X100 F800');
    const sampled = model(
      Array.from({ length: 1000 }, (_, index) => `G1 X${(index + 1) / 10} F800`).join('\n'),
    );
    const positions = (built: GcodeRenderModel) =>
      directionArrows(built).map((arrow) => Number(arrow.position.x.toFixed(4)));
    expect(positions(sampled)).toHaveLength(60);
    expect(positions(sampled)).toEqual(positions(single));
  });

  it('keeps direction visible on a finely sampled circle', () => {
    const lines = ['G0 X10 Y0'];
    for (let index = 1; index <= 200; index += 1) {
      const angle = (index / 200) * Math.PI * 2;
      lines.push(
        `G1 X${(10 * Math.cos(angle)).toFixed(6)} Y${(10 * Math.sin(angle)).toFixed(6)} F800`,
      );
    }
    const arrows = directionArrows(model(lines.join('\n')));
    expect(arrows).toHaveLength(60);
    for (const arrow of arrows) {
      const cross = arrow.position.x * arrow.direction.y - arrow.position.y * arrow.direction.x;
      expect(cross).toBeGreaterThan(9.9);
    }
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
