import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { JobPlacementSettings } from '../job-placement';
import { prepareStartJob } from './start-job-readiness';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const readyController = {
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
};

const readyMachine = {
  statusReport: idleStatus,
  alarmCode: null,
  hasActiveStreamer: false,
};

const currentPositionCenter: JobPlacementSettings = {
  startFrom: 'current-position',
  anchor: 'center',
};

const userOriginFrontLeft: JobPlacementSettings = {
  startFrom: 'user-origin',
  anchor: 'front-left',
};

const centeredTraceObject: SceneObject = {
  kind: 'traced-image',
  id: 'centered-trace',
  source: 'centered-logo.png',
  bounds: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
  transform: { ...IDENTITY_TRANSFORM, x: 175, y: 185 },
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 30 },
            { x: 0, y: 30 },
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
};

function fillOverscanProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [
        {
          kind: 'imported-svg',
          id: 'fill-near-origin',
          source: 'fill.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                    { x: 0, y: 10 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layers: [
        {
          ...createLayer({ id: 'L-fill', color: '#ff0000', mode: 'fill' }),
          fillOverscanMm: 5,
          hatchSpacingMm: 2,
          power: 10,
        },
      ],
    },
  };
}

describe('prepareStartJob job placement', () => {
  it('places the selected anchor at the current machine position for Current Position jobs', () => {
    const result = prepareStartJob(
      calibratedProjectWith(centeredTraceObject),
      readyController,
      {
        ...readyMachine,
        statusReport: {
          ...idleStatus,
          mPos: { x: 120, y: 80, z: 0 },
          wPos: null,
        },
      },
      currentPositionCenter,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gcode).toContain('X95.000 Y95.000');
      expect(result.gcode).toContain('X145.000 Y95.000');
    }
  });

  it('blocks User Origin when the operator has not set a custom origin', () => {
    const result = prepareStartJob(
      calibratedProjectWith(centeredTraceObject),
      readyController,
      readyMachine,
      userOriginFrontLeft,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages.join('\n')).toMatch(/set origin/i);
    }
  });

  it('anchors a centered traced image to the custom work origin before emitting G-code', () => {
    const result = prepareStartJob(
      calibratedProjectWith(centeredTraceObject),
      readyController,
      {
        ...readyMachine,
        workOriginActive: true,
        wcoCache: { x: 120, y: 80, z: 0 },
      },
      userOriginFrontLeft,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gcode).not.toContain('X175.000');
      expect(result.gcode).not.toContain('Y185.000');
      expect(result.gcode).toContain('X0.000 Y30.000');
      expect(result.gcode).toContain('X50.000 Y30.000');
    }
  });

  it('does not treat negative WCO as a physical overhang when homing is disabled', () => {
    const result = prepareStartJob(
      calibratedProjectWith(centeredTraceObject),
      readyController,
      {
        ...readyMachine,
        workOriginActive: true,
        wcoCache: { x: 0, y: -90, z: 0 },
      },
      userOriginFrontLeft,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gcode).toContain('X0.000 Y30.000');
      expect(result.gcode).toContain('X50.000 Y30.000');
    }
  });

  it('does not treat unhomed custom-origin overscan runway as absolute machine overhang', () => {
    const result = prepareStartJob(
      fillOverscanProject(),
      readyController,
      {
        ...readyMachine,
        workOriginActive: true,
        wcoCache: { x: 0, y: -90, z: 0 },
      },
      userOriginFrontLeft,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gcode).toContain('X-5.000');
    }
  });

  it('blocks Start when a homed custom work origin would push the adjusted job off the physical bed', () => {
    const result = prepareStartJob(
      homedProjectWith(centeredTraceObject),
      readyController,
      {
        ...readyMachine,
        workOriginActive: true,
        wcoCache: { x: 380, y: 390, z: 0 },
      },
      userOriginFrontLeft,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages.join('\n')).toMatch(/selected job origin/i);
      expect(result.messages.join('\n')).toMatch(/machine bed/i);
    }
  });

  it('allows homed custom-origin fill overscan when WCO keeps the runway physically on the bed', () => {
    const result = prepareStartJob(
      withHoming(fillOverscanProject()),
      readyController,
      {
        ...readyMachine,
        workOriginActive: true,
        wcoCache: { x: 100, y: 100, z: 0 },
      },
      userOriginFrontLeft,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gcode).toContain('X-5.000');
    }
  });

  it('blocks homed custom-origin fill overscan when WCO puts the runway physically off the bed', () => {
    const result = prepareStartJob(
      withHoming(fillOverscanProject()),
      readyController,
      {
        ...readyMachine,
        workOriginActive: true,
        wcoCache: { x: 2, y: 100, z: 0 },
      },
      userOriginFrontLeft,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages.join('\n')).toMatch(/X out of bed: -3/);
    }
  });

  it('blocks custom-origin Start when the physical origin location is not known', () => {
    const result = prepareStartJob(
      calibratedProjectWith(centeredTraceObject),
      readyController,
      {
        ...readyMachine,
        workOriginActive: true,
        wcoCache: null,
      },
      userOriginFrontLeft,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages.join('\n')).toMatch(/custom origin/i);
      expect(result.messages.join('\n')).toMatch(/not known/i);
    }
  });

  it('names fill overscan when an absolute fill job is too close to the bed edge', () => {
    const result = prepareStartJob(fillOverscanProject(), readyController, readyMachine);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages.join('\n')).toMatch(/overscan/i);
      expect(result.messages.join('\n')).toMatch(/5 mm/);
    }
  });
});

function calibratedProjectWith(object: SceneObject): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
    },
  };
}

function homedProjectWith(object: SceneObject): Project {
  return withHoming(calibratedProjectWith(object));
}

function withHoming(project: Project): Project {
  return {
    ...project,
    device: {
      ...project.device,
      homing: { ...project.device.homing, enabled: true },
    },
  };
}
