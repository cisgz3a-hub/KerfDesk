import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type NoGoZone } from '../devices';
import { createLayer, createProject, EMPTY_SCENE, type Project } from '../scene';
import { runPreflight } from './preflight';
import { firstZoneCrossedBySegment } from './no-go-zones';

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

  it('checks modal relative motion before reporting no-go zone collisions', () => {
    const project = {
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        noGoZones: [
          {
            id: 'rear-clamp',
            name: 'Rear clamp',
            enabled: true,
            x: 120,
            y: 90,
            width: 20,
            height: 20,
          },
        ],
      }),
      scene: { ...EMPTY_SCENE, layers: [createLayer({ id: 'L1', color: '#ff0000' })] },
    };
    const gcode = [
      'G21',
      'G90',
      'M3 S0',
      'G1 X100 Y100 F1000 S500',
      'G91',
      'G1 X30 Y0 S500',
      'M5',
    ].join('\n');

    const result = runPreflight(project, gcode);

    expect(result.issues).toContainEqual({
      code: 'no-go-zone-collision',
      message: 'Line 6: motion crosses no-go zone "Rear clamp".',
    });
  });

  it('parses lowercase relative motion and external numeric word forms', () => {
    const project = {
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        noGoZones: [
          {
            id: 'rear-clamp',
            name: 'Rear clamp',
            enabled: true,
            x: 120,
            y: 90,
            width: 20,
            height: 20,
          },
        ],
      }),
      scene: { ...EMPTY_SCENE, layers: [createLayer({ id: 'L1', color: '#ff0000' })] },
    };
    const gcode = ['g21', 'g90', 'm3 s0', 'g1 x1e2 y100 s500', 'g91', 'g1 x+3e1 y.0 s500'].join(
      '\n',
    );

    const result = runPreflight(project, gcode);

    expect(result.issues).toContainEqual({
      code: 'no-go-zone-collision',
      message: 'Line 6: motion crosses no-go zone "Rear clamp".',
    });
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

describe('firstZoneCrossedBySegment (jog/click guard — DEV-04)', () => {
  const zone: NoGoZone = {
    id: 'clamp',
    name: 'Left clamp',
    enabled: true,
    x: 20,
    y: 20,
    width: 20,
    height: 20,
  };

  it('returns the zone a straight move passes through', () => {
    expect(firstZoneCrossedBySegment({ x: 0, y: 0 }, { x: 50, y: 50 }, [zone])).toBe(zone);
  });

  it('returns the zone when the target lands inside it', () => {
    expect(firstZoneCrossedBySegment({ x: 0, y: 30 }, { x: 30, y: 30 }, [zone])).toBe(zone);
  });

  it('returns null for a move that stays clear', () => {
    expect(firstZoneCrossedBySegment({ x: 0, y: 0 }, { x: 10, y: 5 }, [zone])).toBeNull();
  });

  it('ignores disabled zones', () => {
    expect(
      firstZoneCrossedBySegment({ x: 0, y: 0 }, { x: 50, y: 50 }, [{ ...zone, enabled: false }]),
    ).toBeNull();
  });
});
