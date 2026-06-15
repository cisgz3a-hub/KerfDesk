import { describe, expect, it } from 'vitest';
import type { GrblState, StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
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

const sampleObject: SceneObject = {
  kind: 'imported-svg',
  id: 'O1',
  source: 'a.svg',
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

const tracedObject: SceneObject = {
  kind: 'traced-image',
  id: 'trace-1',
  source: 'logo.png',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: sampleObject.paths,
};

function runnableProject(object: SceneObject = sampleObject): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [createLayer({ id: 'L1', color: '#ff0000' })],
    },
  };
}

function calibratedProject(): Project {
  const project = runnableProject();
  const layer = project.scene.layers[0];
  if (layer === undefined) return project;
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: [{ ...layer, power: 10 }],
    },
  };
}

describe('prepareStartJob', () => {
  it('blocks Start when connected controller $30 differs from project max S', () => {
    const result = prepareStartJob(
      calibratedProject(),
      {
        maxPowerS: 255,
        minPowerS: 0,
        laserModeEnabled: true,
      },
      readyMachine,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages).toContain(
        'Controller $30 is 255 but this project is set to max S 1000. Apply the detected setting before starting.',
      );
    }
  });

  it('returns G-code when project preflight and controller readiness both pass', () => {
    const result = prepareStartJob(calibratedProject(), readyController, readyMachine);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gcode).toContain('M3 S0');
      expect(result.warnings).toEqual([]);
    }
  });

  it('keeps existing project preflight failures as Start blockers', () => {
    const project = {
      ...runnableProject(),
      scene: { ...runnableProject().scene, layers: [] },
    };

    const result = prepareStartJob(project, readyController, readyMachine);

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.messages).toContain('No output layers. Enable Output on at least one layer.');
  });

  it('allows Start with a nonzero $31 warning after critical readiness passes', () => {
    const result = prepareStartJob(
      runnableProject(),
      {
        maxPowerS: 1000,
        minPowerS: 10,
        laserModeEnabled: true,
      },
      readyMachine,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContain(
        'Controller $31 minimum S is 10. Low nonzero power values may burn hotter than expected.',
      );
    }
  });

  it('includes trace/vector intent warnings in the Start warning list', () => {
    const result = prepareStartJob(runnableProject(tracedObject), readyController, readyMachine);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContain(
        'Trace "logo.png" is vector Line output, not raster image engraving. It will run with M3 constant-power moves and can cut if power/speed are too aggressive.',
      );
    }
  });

  it('blocks Start until a controller status frame has been received', () => {
    const result = prepareStartJob(calibratedProject(), readyController, {
      ...readyMachine,
      statusReport: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages).toContain(
        'Controller status is not known yet. Wait for an Idle status report before starting.',
      );
    }
  });

  it('blocks Start while the controller is running another operation', () => {
    const result = prepareStartJob(calibratedProject(), readyController, {
      ...readyMachine,
      statusReport: { ...idleStatus, state: 'Run' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages).toContain('Machine must be Idle before starting (currently Run).');
    }
  });

  it.each(['Hold', 'Jog', 'Home'] satisfies GrblState[])(
    'blocks Start while the controller reports %s',
    (state) => {
      const result = prepareStartJob(calibratedProject(), readyController, {
        ...readyMachine,
        statusReport: { ...idleStatus, state },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.messages).toContain(
          `Machine must be Idle before starting (currently ${state}).`,
        );
      }
    },
  );

  it('blocks Start while an alarm is active', () => {
    const result = prepareStartJob(calibratedProject(), readyController, {
      ...readyMachine,
      alarmCode: 1,
      statusReport: { ...idleStatus, state: 'Alarm' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages).toContain(
        'Controller is in alarm state. Clear the alarm before starting.',
      );
    }
  });

  it('blocks Start with alarm recovery copy when status reports Alarm without ALARM:N', () => {
    const result = prepareStartJob(calibratedProject(), readyController, {
      ...readyMachine,
      alarmCode: null,
      statusReport: { ...idleStatus, state: 'Alarm' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages).toContain(
        'Controller reports Alarm. Home ($H) if the machine has homing switches, or Unlock ($X) only after confirming the head is safe.',
      );
    }
  });

  it('blocks Start while a local streamer is already active', () => {
    const result = prepareStartJob(calibratedProject(), readyController, {
      ...readyMachine,
      hasActiveStreamer: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages).toContain(
        'A job is already active. Stop or finish it before starting another.',
      );
    }
  });

  it('blocks Start while autofocus is active', () => {
    const result = prepareStartJob(calibratedProject(), readyController, {
      ...readyMachine,
      autofocusBusy: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages).toContain(
        'Auto-focus is running. Wait for it to finish before starting a job.',
      );
    }
  });
});
