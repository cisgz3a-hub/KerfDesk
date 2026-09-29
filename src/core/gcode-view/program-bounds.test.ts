// ADR-255 amendment 2 (weakness audit G-8): the Inspector's Size measured the
// program from the 0,0,0 the viewer assumes it starts at, so a scan at X 90 to
// 160 was reported 160 mm wide. programBounds keeps only what the program sets.

import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel } from './gcode-render-model';
import type { AxisBounds, BuildRenderModelOptions, GcodeRenderModel } from './render-model-types';

function model(
  lines: ReadonlyArray<string>,
  options: BuildRenderModelOptions = {},
): GcodeRenderModel {
  const result = buildGcodeRenderModel(lines.join('\n'), options);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

function expectBounds(actual: AxisBounds | null, expected: AxisBounds): void {
  if (actual === null) throw new Error('expected bounds');
  for (const key of Object.keys(expected) as Array<keyof AxisBounds>) {
    expect(actual[key], key).toBeCloseTo(expected[key], 4);
  }
}

// LightBurn's GRBL scan style: overscan in at S0, burn, overscan out.
function scanRows(): string[] {
  const lines = ['G00 G17 G40 G21 G54', 'G90', 'M4', 'G0 X90Y100'];
  for (let row = 0; row < 50; row += 1) {
    const y = (100 + row * 0.1).toFixed(3);
    const [start, burnEnd, overscanEnd] = row % 2 === 0 ? [100, 150, 160] : [150, 100, 90];
    lines.push(`G1 X${start}Y${y}F6000S0`, `G1 X${burnEnd}S200`, `G1 X${overscanEnd}S0`);
  }
  lines.push('M5', 'M2');
  return lines;
}

describe('programBounds', () => {
  it('leaves the assumed start out of a laser scan', () => {
    const scan = model(scanRows());

    expectBounds(scan.stats.programBounds, {
      minX: 90,
      maxX: 160,
      minY: 100,
      maxY: 104.9,
      minZ: 0,
      maxZ: 0,
    });
    // The drawing, and so the view fit, still includes the travel in.
    expect(scan.stats.motionBounds?.minX).toBe(0);
    expect(scan.stats.motionBounds?.minY).toBe(0);
  });

  it('leaves out the start and a G28 but keeps every programmed height', () => {
    const job = model(['G21 G90', 'G0 Z5', 'G0 X10 Y20', 'G1 Z-2 F300', 'G1 X40', 'G0 Z5', 'G28']);

    expectBounds(job.stats.programBounds, {
      minX: 10,
      maxX: 40,
      minY: 20,
      maxY: 20,
      minZ: -2,
      maxZ: 5,
    });
    expect(job.stats.motionBounds?.minX).toBe(0);
  });

  it('keeps the start of a program that only moves relative to it', () => {
    const relative = model(['G91', 'G1 X10 F600', 'G1 Y5', 'G1 X-3']);

    expect(relative.stats.programBounds).toEqual(relative.stats.motionBounds);
    expectBounds(relative.stats.programBounds, {
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 5,
      minZ: 0,
      maxZ: 0,
    });
  });

  it('counts relative moves once the program has set the axis', () => {
    const job = model(['G90', 'G0 X50 Y50', 'G91', 'G1 X10 F600', 'G1 Y-5']);

    expectBounds(job.stats.programBounds, {
      minX: 50,
      maxX: 60,
      minY: 45,
      maxY: 50,
      minZ: 0,
      maxZ: 0,
    });
  });

  it('includes where an arc bulges past its ends', () => {
    // Clockwise half circle about 0,0 from X 10 to X -10, through Y -10.
    const arc = model(['G90', 'G0 X10 Y0', 'G2 X-10 Y0 I-10 J0 F600']);

    expectBounds(arc.stats.programBounds, {
      minX: -10,
      maxX: 10,
      minY: -10,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
    });
  });

  it('keeps a known starting position', () => {
    const job = model(['G90', 'G0 X10 Y20'], { initialPositionMm: { x: -5, y: 0, z: 3 } });

    expect(job.stats.programBounds).toEqual({
      minX: -5,
      maxX: 10,
      minY: 0,
      maxY: 20,
      minZ: 3,
      maxZ: 3,
    });
  });

  it('measures a drilling cycle by its hole, R plane and depth', () => {
    const first = model(['G90 G81 X20 Y30 Z-3 R2 F100', 'G80']);
    const after = model(['G90', 'G0 Z10', 'G0 X5 Y5', 'G81 X20 Y30 Z-3 R2 F100', 'G80']);

    expectBounds(first.stats.programBounds, {
      minX: 20,
      maxX: 20,
      minY: 30,
      maxY: 30,
      minZ: -3,
      maxZ: 2,
    });
    expectBounds(after.stats.programBounds, {
      minX: 5,
      maxX: 20,
      minY: 5,
      maxY: 30,
      minZ: -3,
      maxZ: 10,
    });
  });
});
