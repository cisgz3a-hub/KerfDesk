import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { CncGroup } from '../../core/job';
import { cncGrblStrategy } from '../../core/output';
import { parseGcodeProgram } from './parse-gcode-program';

describe('compact z-rate-capped CNC output', () => {
  it('round-trips modal coordinate-only continuations through the file parser', () => {
    const group: CncGroup = {
      kind: 'cnc',
      layerId: 'compact-path3d',
      color: '#ff0000',
      cutType: 'v-carve',
      toolDiameterMm: 3.175,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 12_000,
      spindleSpinupSec: 0,
      safeZMm: 3.81,
      passes: [
        {
          kind: 'path3d',
          points: [
            { x: 10, y: 10, z: -1 },
            { x: 20, y: 10, z: -1 },
            { x: 30, y: 10, z: -1 },
          ],
          closed: false,
          lateralFeed: 'z-rate-capped',
        },
      ],
    };
    const gcode = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);

    expect(gcode).toContain('G1X20.000Y10.000Z-1.000F1000\nX30.000Y10.000Z-1.000');
    const parsed = parseGcodeProgram(gcode);
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    const cutEndpoints = parsed.toolpath.steps
      .filter((step) => step.kind === 'cut')
      .map((step) => step.polyline.at(-1));
    expect(cutEndpoints).toEqual([
      { x: 20, y: 10 },
      { x: 30, y: 10 },
    ]);
  });
});
