import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { smoothiewareStrategy } from '../output/smoothieware-strategy';
import { marlinStrategy } from '../output/marlin-strategy';
import { createProject } from '../scene';
import type { CutGroup, FillGroup, Job } from './job';
import { computeJobStartBounds } from './job-start-bounds';
import {
  applyJobStartPoint,
  jobStartEditingJob,
  jobStartPointOptions,
  resolveJobStartPoint,
} from './job-start-point';
import { hasJobStartPower } from './job-start-power';
import { buildMotionManifest } from './motion-manifest';

function cut(x: number, power: number): CutGroup {
  return {
    kind: 'cut',
    layerId: String(x),
    color: '#000',
    power,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments: [
      {
        closed: false,
        polyline: [
          { x, y: 10 },
          { x: x + 10, y: 10 },
        ],
      },
    ],
  };
}

describe('controller-represented start power', () => {
  it.each(['cut', 'fill', 'offset'] as const)(
    'skips a %s whose positive percentage emits S0',
    (kind) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 255 };
      const first = cut(0, 0.1);
      const empty: CutGroup | FillGroup =
        kind === 'cut'
          ? first
          : {
              ...first,
              kind: 'fill',
              overscanMm: 2,
              ...(kind === 'offset' ? { fillStyle: 'offset' as const } : {}),
              segments: first.segments.map((segment) => ({ ...segment, reverse: false })),
            };
      const real = cut(30, 50);
      const input: Job = { groups: [empty, real] };
      const options = jobStartPointOptions(createProject().optimization, [], device);
      expect(resolveJobStartPoint(input, { x: 40, y: 10 }, options)).toEqual({
        point: { x: 40, y: 10 },
        supported: true,
      });
      expect(jobStartEditingJob(input, options)).toEqual({ groups: [real] });
      const selected = applyJobStartPoint(input, { x: 40, y: 10 }, options);
      expect(
        buildMotionManifest(grblStrategy.emit(selected, device), { machineKind: 'laser' })
          .firstProcessPoint,
      ).toEqual({ x: 40, y: 10, z: 0 });
      expect(computeJobStartBounds(selected, device)).toEqual({
        minX: 30,
        maxX: 40,
        minY: 10,
        maxY: 10,
      });
      expect(computeJobStartBounds({ groups: [empty] }, device)).toBeNull();
    },
  );

  it.each([
    { kind: 'grbl-v1.1' as const, maxPowerS: 0.5, power: 0.01, expected: false },
    { kind: 'grbl-v1.1' as const, maxPowerS: 0.5, power: 0.1, expected: true },
    { kind: 'smoothieware' as const, maxPowerS: 1, power: 0.1, expected: true },
    { kind: 'marlin' as const, maxPowerS: 1000, power: 0.1, expected: false },
    { kind: 'marlin' as const, maxPowerS: 1, power: 1, expected: true },
  ])(
    'uses $kind output scale at max $maxPowerS and $power percent',
    ({ kind, maxPowerS, power, expected }) => {
      const device: DeviceProfile = {
        ...DEFAULT_DEVICE_PROFILE,
        controllerKind: kind,
        maxPowerS,
        ...(kind === 'marlin' ? { gcodeDialect: { dialectId: 'marlin-fan' as const } } : {}),
      };
      const group = cut(10, power);
      const strategy =
        kind === 'smoothieware'
          ? smoothiewareStrategy
          : kind === 'marlin'
            ? marlinStrategy
            : grblStrategy;
      const gcode = strategy.emit({ groups: [group] }, device);
      const powered = gcode
        .split('\n')
        .some(
          (line) => /^(G1|M106)\b/.test(line) && Number(line.match(/\bS([\d.]+)/)?.[1] ?? 0) > 0,
        );
      expect(powered).toBe(expected);
      expect(hasJobStartPower(group, device)).toBe(powered);
    },
  );
});
