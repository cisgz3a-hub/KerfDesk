import { describe, expect, it } from 'vitest';
import type { GrblState, StatusReport } from '../../core/controllers/grbl';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { computeJobBounds, frameBoundsSignature } from '../../core/job';
import {
  DEFAULT_RASTER_LAYER_COLOR,
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
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

function rasterProjectWithScanOffset(): Project {
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'raster-1',
    source: 'scan-offset.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    color: DEFAULT_RASTER_LAYER_COLOR,
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AAAAAA==',
  };
  const device = {
    ...createProject().device,
    scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: -2 }],
  };
  return {
    ...createProject(device),
    scene: {
      ...EMPTY_SCENE,
      objects: [image],
      layers: [
        {
          ...createLayer({ id: 'image', color: DEFAULT_RASTER_LAYER_COLOR, mode: 'image' }),
          speed: 1500,
          linesPerMm: 1,
          ditherAlgorithm: 'threshold',
        },
      ],
    },
  };
}

function neotronicsFineDetailFillProject(fillStyle: 'scanline' | 'island'): Project {
  const object: SceneObject = {
    kind: 'imported-svg',
    id: 'tiny-island',
    source: 'tiny-island.svg',
    bounds: { minX: 20, minY: 20, maxX: 23, maxY: 23 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 20, y: 20 },
              { x: 23, y: 20 },
              { x: 23, y: 23 },
              { x: 20, y: 23 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  return {
    ...createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'L1', color: '#ff0000', mode: 'fill' }),
          fillStyle,
          fillOverscanMm: 5,
          hatchSpacingMm: 1,
          power: 10,
        },
      ],
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
        'Trace "logo.png" is vector Line output, not raster image engraving. It will run as M3 constant-power vector moves and can cut if power/speed are too aggressive.',
      );
    }
  });

  it('allows 4040-safe Island Fill short sweeps with a warning on the Neotronics 4040 profile', () => {
    const result = prepareStartJob(
      neotronicsFineDetailFillProject('island'),
      readyController,
      readyMachine,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContain(
        '4040-safe Island Fill is active. KerfDesk will use local clustered, unidirectional sweeps with full laser-off runway; this may run slower but is safer for sensitive motion.',
      );
    }
  });

  it('allows the same Neotronics 4040 fine-detail job with Scanline Fill', () => {
    const result = prepareStartJob(
      neotronicsFineDetailFillProject('scanline'),
      readyController,
      readyMachine,
    );

    expect(result.ok).toBe(true);
  });

  it('accepts a Verified Frame signature computed from scan-offset-aware bounds', () => {
    const project = rasterProjectWithScanOffset();
    const jobOrigin = { startFrom: 'verified-origin' as const, anchor: 'front-left' as const };
    const prepared = prepareOutput(project, { jobOrigin });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const bounds = computeJobBounds(prepared.job, project.device);
    expect(bounds).not.toBeNull();
    if (bounds === null) return;
    expect(bounds.maxX).toBe(12);

    const result = prepareStartJob(
      project,
      readyController,
      {
        ...readyMachine,
        workOriginActive: true,
        frameVerification: {
          boundsSignature: frameBoundsSignature(bounds),
          wco: null,
          workOriginActive: true,
        },
      },
      { startFrom: 'verified-origin', anchor: 'front-left' },
    );

    expect(result.ok).toBe(true);
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
