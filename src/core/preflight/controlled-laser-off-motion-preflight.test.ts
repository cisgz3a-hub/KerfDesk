import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { compileJob } from '../job';
import { grblStrategy } from '../output';
import {
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../scene';
import { runPreflight } from './preflight';

const sampleObject: SceneObject = {
  kind: 'imported-svg',
  id: 'O1',
  source: 'controlled-travel.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

const overrideFillObject: SceneObject = {
  kind: 'imported-svg',
  id: 'override-fill',
  source: 'override-fill.svg',
  bounds: { minX: 20, minY: 20, maxX: 30, maxY: 30 },
  transform: IDENTITY_TRANSFORM,
  operationOverride: { fillOverscanMm: 10 },
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 20, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 30 },
            { x: 20, y: 30 },
          ],
          closed: true,
        },
      ],
    },
  ],
};

function projectWith(layer: ReturnType<typeof createLayer>): Project {
  return {
    ...createProject(),
    scene: { ...EMPTY_SCENE, objects: [sampleObject], layers: [layer] },
  };
}

function emit(project: Project): string {
  return grblStrategy.emit(compileJob(project.scene, project.device), project.device);
}

describe('controlled laser-off motion preflight', () => {
  it('accepts generated marked controlled seeks only when F matches the active profile', () => {
    const project: Project = {
      ...createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
      scene: {
        ...EMPTY_SCENE,
        objects: [sampleObject],
        layers: [createLayer({ id: 'L1', color: '#ff0000' })],
      },
    };
    expect(runPreflight(project, emit(project)).issues.map((issue) => issue.code)).not.toContain(
      'long-blank-feed',
    );

    const forgedGeneric = [
      'G21',
      'G90',
      'M3 S0',
      'G1 X1 Y1 F1500 S300',
      'G1 X21 Y1 F800 S0 ; kerfdesk:laser-off-motion',
      'M5',
    ].join('\n');
    const genericProject = projectWith(createLayer({ id: 'L1', color: '#ff0000' }));
    expect(runPreflight(genericProject, forgedGeneric).issues.map((issue) => issue.code)).toContain(
      'long-blank-feed',
    );
  });

  it('recognizes the emitter-clamped F1 form of a positive sub-1 controlled feed', () => {
    const project: Project = {
      ...projectWith(createLayer({ id: 'L1', color: '#ff0000' })),
      device: {
        ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        controlledLaserOffTravelFeedMmPerMin: 0.4,
      },
    };
    const generated = emit(project);

    expect(generated).toContain('F1 S0 ; kerfdesk:laser-off-motion');
    expect(
      runPreflight(project, generated).issues.filter((issue) => issue.code === 'long-blank-feed'),
    ).toEqual([]);
    expect(runPreflight(project, generated).issues).toContainEqual(
      expect.objectContaining({
        code: 'speed-out-of-range',
        message: expect.stringContaining('0.4'),
      }),
    );
  });

  it('reports finite feed and scan-offset policy limits after emission', () => {
    const base = projectWith({
      ...createLayer({ id: 'L1', color: '#ff0000', mode: 'fill' }),
      bidirectionalScanOffsetMm: 4.01,
    });
    const project: Project = {
      ...base,
      device: {
        ...base.device,
        maxFeed: 1000,
        controlledLaserOffTravelFeedMmPerMin: 1001,
      },
    };
    const gcode = ['G21', 'G90', 'M3 S0', 'G0 X1 Y1 S0', 'G1 X9 Y9 F100 S50', 'M5'].join('\n');

    expect(runPreflight(project, gcode).issues).toEqual(
      expect.arrayContaining([
        {
          code: 'speed-out-of-range',
          message: 'Controlled laser-off seek feed 1001 is outside 1..1000 mm/min.',
        },
        {
          code: 'scan-offset-out-of-range',
          message: 'Layer L1 bidirectional scan offset 4.01 mm exceeds the device limit of ±4 mm.',
        },
      ]),
    );
  });

  it('accepts a marked feed-matched runway only within configured overscan distance', () => {
    const project = projectWith({
      ...createLayer({ id: 'L1', color: '#ff0000', mode: 'fill' }),
      fillOverscanMm: 10,
    });
    const gcode = [
      'G21',
      'G90',
      'M4 S0',
      'G1 X10 Y10 F1500 S300',
      'G1 X18 Y10 F1500 S0 ; kerfdesk:laser-off-motion',
      'G1 X30 Y10 F1500 S0 ; kerfdesk:laser-off-motion',
      'M5',
    ].join('\n');
    const issues = runPreflight(project, gcode).issues.filter(
      (issue) => issue.code === 'long-blank-feed',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('12.000 mm');
  });

  it('allows only the distance error introduced by three-decimal coordinate rounding', () => {
    const project = projectWith({
      ...createLayer({ id: 'L1', color: '#ff0000', mode: 'fill' }),
      fillOverscanMm: 5,
    });
    const roundedGenerated = [
      'G21',
      'G90',
      'M4 S0',
      'G0 X6.464 Y6.464 S0',
      'G1 X10.000 Y10.000 F1500 S0 ; kerfdesk:laser-off-motion',
      'M5',
    ].join('\n');
    const materiallyOverlong = [
      'G21',
      'G90',
      'M4 S0',
      'G0 X6.463 Y6.463 S0',
      'G1 X10.000 Y10.000 F1500 S0 ; kerfdesk:laser-off-motion',
      'M5',
    ].join('\n');

    expect(
      runPreflight(project, roundedGenerated).issues.filter(
        (issue) => issue.code === 'long-blank-feed',
      ),
    ).toEqual([]);
    expect(
      runPreflight(project, materiallyOverlong).issues.filter(
        (issue) => issue.code === 'long-blank-feed',
      ),
    ).toHaveLength(1);
  });

  it('accepts generated object-override runways but rejects a marked move beyond the override', () => {
    const project: Project = {
      ...createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
      scene: {
        ...EMPTY_SCENE,
        objects: [overrideFillObject],
        layers: [
          {
            ...createLayer({ id: 'fill', color: '#ff0000', mode: 'fill' }),
            speed: 1500,
            hatchSpacingMm: 2,
            fillOverscanMm: 0,
          },
        ],
      },
    };
    const generated = emit(project);

    expect(generated).toContain('S0 ; kerfdesk:laser-off-motion');
    expect(
      runPreflight(project, generated).issues.filter((issue) => issue.code === 'long-blank-feed'),
    ).toEqual([]);

    const forged = [
      'G21',
      'G90',
      'M4 S0',
      'G1 X20 Y20 F1500 S300',
      'G1 X30 Y20 F1500 S0 ; kerfdesk:laser-off-motion',
      'G1 X41 Y20 F1500 S0 ; kerfdesk:laser-off-motion',
      'M5',
    ].join('\n');
    const issues = runPreflight(project, forged).issues.filter(
      (issue) => issue.code === 'long-blank-feed',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('11.000 mm');
  });
});
