import { describe, expect, it } from 'vitest';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { buildProgramTimeline } from '../../core/gcode-time';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { emitPreparedGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';

function longLineProject(powerMode: 'constant' | 'dynamic'): Project {
  return {
    ...createProject(),
    device: FALCON_A1_PRO_GRBLHAL_PROFILE,
    scene: {
      layers: [
        {
          ...createLayer({ id: 'line', color: '#000000' }),
          airAssist: true,
          speed: 60,
          powerMode,
        },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'long-line',
          source: 'long-line.svg',
          bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
          transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  points: [
                    { x: 0, y: 0 },
                    { x: 100, y: 0 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('real Falcon output retains long-block air-repeat limitations', () => {
  it.each(['constant', 'dynamic'] as const)(
    'does not split a 100-second %s burn or promise a repeat inside it',
    (mode) => {
      const prepared = prepareOutput(longLineProject(mode), { outputScope: DEFAULT_OUTPUT_SCOPE });
      if (!prepared.ok) throw new Error('Long-line preparation failed');
      const gcode = emitPreparedGcode(prepared).gcode;
      const lines = gcode.split('\n');
      const burns = lines.filter((line) => /^G1\b.*\bS[1-9]/.test(line));
      expect(burns).toHaveLength(1);
      expect(burns[0]).toContain('F60');
      expect(lines.filter((line) => /^M[789]$/.test(line))).toEqual(['M8', 'M9']);

      const device = FALCON_A1_PRO_GRBLHAL_PROFILE;
      const timed = buildProgramTimeline(gcode, {
        accelMmPerSec2: device.accelMmPerSec2,
        junctionDeviationMm: device.junctionDeviationMm,
        maxFeedMmPerMin: device.maxFeed,
      });
      if (timed.kind !== 'ok') throw new Error(`Timing failed: ${timed.reason}`);
      const ends = timed.timeline.rawLineEndSeconds;
      const gap = (ends[lines.indexOf('M9')] ?? 0) - (ends[lines.indexOf('M8')] ?? 0);
      // Independently, 100 mm / 1 mm/s already takes 100 s before acceleration.
      expect(gap).toBeGreaterThanOrEqual(100);
    },
  );
});
