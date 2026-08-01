import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { applyJobOriginOffset, type CncGroup } from '../job';
import { cncGrblStrategy } from '../output';
import type { Polyline } from '../scene';
import { planVCarveRampEntry } from './vcarve-entry';

function square(sizeMm: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: sizeMm, y: 0 },
      { x: sizeMm, y: sizeMm },
      { x: 0, y: sizeMm },
    ],
  };
}

function diamond(radiusMm: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: radiusMm },
      { x: radiusMm, y: 0 },
      { x: 0, y: -radiusMm },
      { x: -radiusMm, y: 0 },
    ],
  };
}

describe('planVCarveRampEntry', () => {
  it('uses enough contour laps to respect depth per pass, then adds a level cleanup lap', () => {
    const plan = planVCarveRampEntry(square(10), 2, 0.5, 5);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.revolutions).toBe(4);
    expect(plan.passes).toHaveLength(2);
    const [ramp, cleanup] = plan.passes;
    expect(ramp).toMatchObject({ kind: 'path3d', lateralFeed: 'plunge', closed: false });
    expect(cleanup).toMatchObject({ kind: 'contour', zMm: -2, closed: true });
    if (ramp?.kind !== 'path3d' || cleanup?.kind !== 'contour') return;
    expect(ramp.points[0]?.z).toBe(0);
    expect(ramp.points.at(-1)?.z).toBeCloseTo(-2, 9);
    expect(cleanup.polyline[0]).toEqual(
      expect.objectContaining({ x: ramp.points.at(-1)?.x, y: ramp.points.at(-1)?.y }),
    );
  });

  it('adds many laps for a tiny contour instead of ending with a vertical plunge', () => {
    // Perimeter 0.171 mm, 0.5 mm descent, 2 degree maximum: about 84 laps.
    const plan = planVCarveRampEntry(square(0.04275), 0.5, 0.5, 2);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.revolutions).toBeGreaterThanOrEqual(80);
    const ramp = plan.passes[0];
    if (ramp?.kind !== 'path3d') throw new Error('expected ramp path');
    for (let index = 1; index < ramp.points.length; index += 1) {
      const previous = ramp.points[index - 1];
      const point = ramp.points[index];
      if (previous === undefined || point === undefined || point.z === previous.z) continue;
      expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeGreaterThan(0);
    }
  });

  it('keeps every descending segment at or below the configured maximum angle', () => {
    const angleDeg = 3;
    const plan = planVCarveRampEntry(square(0.25), 0.5, 0.5, angleDeg);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const ramp = plan.passes[0];
    if (ramp?.kind !== 'path3d') throw new Error('expected ramp path');
    const maxSlope = Math.tan((angleDeg * Math.PI) / 180);
    for (let index = 1; index < ramp.points.length; index += 1) {
      const previous = ramp.points[index - 1];
      const point = ramp.points[index];
      if (previous === undefined || point === undefined) continue;
      const run = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (run === 0) continue;
      expect(Math.abs(point.z - previous.z) / run).toBeLessThanOrEqual(maxSlope + 1e-9);
    }
  });

  it('keeps the maximum angle after the emitter rounds every axis to 0.001 mm', () => {
    const angleDeg = 3;
    const plan = planVCarveRampEntry(square(1), 0.102, 0.102, angleDeg);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const group: CncGroup = {
      kind: 'cnc',
      layerId: 'v-carve-rounding',
      color: '#ff0000',
      cutType: 'v-carve',
      toolDiameterMm: 3.175,
      rampEntryDeg: angleDeg,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 12000,
      spindleSpinupSec: 0,
      safeZMm: 3,
      passes: plan.passes,
    };
    const gcode = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
    const slopes = emittedXyzSlopes(gcode);
    expect(slopes.length).toBeGreaterThan(0);
    expect(Math.max(...slopes)).toBeLessThanOrEqual(Math.tan((angleDeg * Math.PI) / 180) + 1e-12);
  });

  it('keeps the maximum angle after a half-quantum job-origin translation', () => {
    const angleDeg = 3;
    const plan = planVCarveRampEntry(square(0.039), 0.007, 0.007, angleDeg);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const group: CncGroup = {
      kind: 'cnc',
      layerId: 'v-carve-origin-rounding',
      color: '#ff0000',
      cutType: 'v-carve',
      toolDiameterMm: 3.175,
      rampEntryDeg: angleDeg,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 12000,
      spindleSpinupSec: 0,
      safeZMm: 3,
      passes: plan.passes,
    };
    const placed = applyJobOriginOffset({ groups: [group] }, { x: -0.4995, y: 0 });
    const gcode = cncGrblStrategy.emit(placed, DEFAULT_DEVICE_PROFILE);
    const slopes = emittedXyzSlopes(gcode);
    expect(slopes.length).toBeGreaterThan(0);
    expect(Math.max(...slopes)).toBeLessThanOrEqual(Math.tan((angleDeg * Math.PI) / 180) + 1e-12);
  });

  it('keeps a diagonal ramp below the maximum after dual-axis half-quantum placement', () => {
    const angleDeg = 3;
    const plan = planVCarveRampEntry(diamond(0.039), 0.007, 0.007, angleDeg);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const group: CncGroup = {
      kind: 'cnc',
      layerId: 'v-carve-diagonal-origin-rounding',
      color: '#ff0000',
      cutType: 'v-carve',
      toolDiameterMm: 3.175,
      rampEntryDeg: angleDeg,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 12000,
      spindleSpinupSec: 0,
      safeZMm: 3,
      passes: plan.passes,
    };
    const placed = applyJobOriginOffset({ groups: [group] }, { x: 0.4995, y: -0.4995 });
    const slopes = emittedXyzSlopes(cncGrblStrategy.emit(placed, DEFAULT_DEVICE_PROFILE));
    expect(slopes.length).toBeGreaterThan(0);
    expect(Math.max(...slopes)).toBeLessThanOrEqual(Math.tan((angleDeg * Math.PI) / 180) + 1e-12);
  });

  it('honors a sub-half-degree maximum instead of silently steepening it', () => {
    const angleDeg = 0.1;
    const plan = planVCarveRampEntry(square(1), 0.1, 1, angleDeg);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.revolutions).toBeGreaterThan(1);
    const ramp = plan.passes[0];
    if (ramp?.kind !== 'path3d') throw new Error('expected ramp path');
    const maxSlope = Math.tan((angleDeg * Math.PI) / 180);
    for (let index = 1; index < ramp.points.length; index += 1) {
      const previous = ramp.points[index - 1];
      const point = ramp.points[index];
      if (previous === undefined || point === undefined) continue;
      const run = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (run === 0) continue;
      expect(Math.abs(point.z - previous.z) / run).toBeLessThanOrEqual(maxSlope + 1e-9);
    }
  });

  it('chooses the same longest-segment entry after a cyclic source-point shift', () => {
    const original = square(10);
    const shifted: Polyline = {
      ...original,
      points: [...original.points.slice(2), ...original.points.slice(0, 2)],
    };
    const a = planVCarveRampEntry(original, 1, 1, 3);
    const b = planVCarveRampEntry(shifted, 1, 1, 3);
    expect(a.ok && a.passes[0]?.kind === 'path3d' ? a.passes[0].points[0] : null).toEqual(
      b.ok && b.passes[0]?.kind === 'path3d' ? b.passes[0].points[0] : null,
    );
  });

  it('rejects a contour that collapses at emitted coordinate precision', () => {
    const plan = planVCarveRampEntry(square(0.00001), 1, 1, 3);
    expect(plan).toMatchObject({ ok: false, reason: expect.stringContaining('non-degenerate') });
  });

  it('does not substitute the generic 45-degree ceiling for a persisted exact value', () => {
    const plan = planVCarveRampEntry(square(10), 1, 1, 60);
    expect(plan.ok).toBe(true);
  });

  it('reports a numerically unrepresentable motion count without allocating it', () => {
    const plan = planVCarveRampEntry(square(10), Number.MAX_VALUE, 1, 3);
    expect(plan).toMatchObject({ ok: false, reason: expect.stringContaining('safe JavaScript') });
  });
});

function emittedXyzSlopes(gcode: string): ReadonlyArray<number> {
  let position = { x: 0, y: 0, z: 0 };
  const slopes: number[] = [];
  for (const line of gcode.split('\n')) {
    if (!line.startsWith('G0') && !line.startsWith('G1')) continue;
    const next = {
      x: axisValue(line, 'X') ?? position.x,
      y: axisValue(line, 'Y') ?? position.y,
      z: axisValue(line, 'Z') ?? position.z,
    };
    if (line.startsWith('G1') && /\bX/.test(line) && /\bY/.test(line) && /\bZ/.test(line)) {
      const run = Math.hypot(next.x - position.x, next.y - position.y);
      slopes.push(Math.abs(next.z - position.z) / run);
    }
    position = next;
  }
  return slopes;
}

function axisValue(line: string, axis: 'X' | 'Y' | 'Z'): number | null {
  const match = new RegExp(`${axis}(-?\\d+(?:\\.\\d+)?)`).exec(line);
  return match?.[1] === undefined ? null : Number(match[1]);
}
