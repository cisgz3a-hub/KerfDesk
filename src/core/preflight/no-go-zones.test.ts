import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, createProject, EMPTY_SCENE, type Project } from '../scene';
import { runPreflight } from './preflight';

function projectWithNoGoZone(enabled = true): Project {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      noGoZones: [
        {
          id: 'clamp-left',
          name: 'Left clamp',
          enabled,
          x: 20,
          y: 20,
          width: 20,
          height: 20,
        },
      ],
    }),
    scene: { ...EMPTY_SCENE, layers: [createLayer({ id: 'L1', color: '#ff0000' })] },
  };
}

describe('preflight no-go zones', () => {
  it('blocks burn moves crossing an enabled no-go zone', () => {
    const gcode = ['G21', 'G90', 'M3 S0', 'G1 X10 Y30 F1000 S500', 'G1 X50 Y30 S500', 'M5'].join(
      '\n',
    );

    const result = runPreflight(projectWithNoGoZone(), gcode);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      code: 'no-go-zone-collision',
      message: 'Line 5: motion crosses no-go zone "Left clamp".',
    });
  });

  it('blocks travel moves that would frame or rapid through a no-go zone', () => {
    const gcode = ['G21', 'G90', 'M5', 'G0 X10 Y30 S0', 'G0 X50 Y30 S0'].join('\n');

    const result = runPreflight(projectWithNoGoZone(), gcode);

    expect(result.issues.map((issue) => issue.code)).toContain('no-go-zone-collision');
  });

  it('ignores disabled zones and zones outside the bed', () => {
    const gcode = ['G21', 'G90', 'M3 S0', 'G1 X10 Y30 F1000 S500', 'G1 X50 Y30 S500', 'M5'].join(
      '\n',
    );
    const disabled = runPreflight(projectWithNoGoZone(false), gcode);
    const outsideBed = runPreflight(
      {
        ...projectWithNoGoZone(),
        device: {
          ...DEFAULT_DEVICE_PROFILE,
          noGoZones: [
            {
              id: 'outside',
              name: 'Outside',
              enabled: true,
              x: 500,
              y: 500,
              width: 10,
              height: 10,
            },
          ],
        },
      },
      gcode,
    );

    expect(disabled.issues.every((issue) => issue.code !== 'no-go-zone-collision')).toBe(true);
    expect(outsideBed.issues.every((issue) => issue.code !== 'no-go-zone-collision')).toBe(true);
  });
});
