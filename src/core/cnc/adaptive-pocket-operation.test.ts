import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { pointInPolygon } from '../geometry';
import { findPlungedTravelIssues } from '../invariants';
import type { CncGroup } from '../job';
import { cncGrblStrategy } from '../output';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncTool, type Polyline, type Vec2 } from '../scene';
import { adaptivePocketPasses, resolveAdaptivePocketOperation } from './adaptive-pocket-operation';

const TOOL: CncTool = { id: 'em4', name: '4 mm end mill', kind: 'end-mill', diameterMm: 4 };

function uPocket(): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 28, y: 40 },
      { x: 28, y: 5 },
      { x: 12, y: 5 },
      { x: 12, y: 40 },
      { x: 0, y: 40 },
    ],
  };
}

function segmentSamples(start: Vec2, end: Vec2): ReadonlyArray<Vec2> {
  const samples = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 0.1));
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
  });
}

describe('adaptivePocketPasses', () => {
  it('emits separate helical cuts for the exact U-pocket branches', () => {
    const pocket = uPocket();
    const settings = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket' as const,
      pocketStrategy: 'adaptive' as const,
      adaptiveOptimalLoadMm: 2,
    };
    const operation = resolveAdaptivePocketOperation([pocket], settings, TOOL);
    expect(operation.kind).toBe('ok');
    if (operation.kind !== 'ok') return;
    expect(operation.plan.sequences).toHaveLength(2);

    const passes = adaptivePocketPasses(operation, [-1], [pocket]);
    expect(passes).toEqual(adaptivePocketPasses(operation, [-1], [pocket]));
    const roughing = passes.filter((pass) => pass.kind === 'helical-contour');
    expect(roughing).toHaveLength(2);
    for (const pass of roughing) {
      const points = [pass.start, ...pass.polyline];
      for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        if (start === undefined || end === undefined) continue;
        expect(
          segmentSamples(start, end).every((point) => pointInPolygon(point, pocket.points)),
        ).toBe(true);
      }
    }

    const group: CncGroup = {
      kind: 'cnc',
      layerId: 'L1',
      color: '#ff0000',
      cutType: 'pocket',
      toolDiameterMm: 4,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 12_000,
      spindleSpinupSec: 0,
      safeZMm: 3.81,
      passes,
    };
    const gcode = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
    expect(gcode).toBe(cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE));
    expect(findPlungedTravelIssues(gcode, { safeZMm: group.safeZMm })).toEqual([]);
    const second = roughing[1];
    if (second?.kind !== 'helical-contour') throw new Error('expected a second helix');
    const secondStart = `G0 X${second.start.x.toFixed(3)} Y${second.start.y.toFixed(3)}`;
    expect(gcode).toContain(`G0 Z3.810\n${secondStart}`);
  });
});
