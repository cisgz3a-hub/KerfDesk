import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import {
  DEFAULT_OUTPUT_SCOPE,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { frameVerificationForProject } from './frame-verification-testing';
import { startControllerPolicy } from './start-job-controller-policy';
import { prepareStartJob, prepareStartJobSnapshot } from './start-job-readiness';

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

const stockBuildWithoutM7: GrblBuildInfo = {
  protocolVersion: '1.1h',
  buildRevision: '20190830',
  userInfo: '',
  optionCodes: ['V'],
  plannerBufferBlocks: 15,
  rxBufferBytes: 128,
};

const sampleObject: SceneObject = {
  kind: 'imported-svg',
  id: 'O1',
  source: 'controller-guard.svg',
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

function calibratedProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [sampleObject],
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
    },
  };
}

function readyMachine(project: Project) {
  return {
    statusReport: idleStatus,
    alarmCode: null,
    hasActiveStreamer: false,
    frameVerification: frameVerificationForProject(project),
  };
}

function m7Project(): Project {
  const base = calibratedProject();
  return {
    ...base,
    device: { ...base.device, airAssistCommand: 'M7' },
    scene: {
      ...base.scene,
      layers: base.scene.layers.map((layer) => ({ ...layer, airAssist: true })),
    },
  };
}

describe('laser controller Start guards', () => {
  it('keeps a reported $32=0 review-grade under the physical-Frame policy', () => {
    const project = calibratedProject();
    const result = prepareStartJob(
      project,
      { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: false },
      readyMachine(project),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.some((warning) => warning.includes('$32=0'))).toBe(true);
  });

  it('keeps a reported $30 mismatch review-grade in snapshot preparation', async () => {
    const project = calibratedProject();
    const result = await prepareStartJobSnapshot(
      project,
      { maxPowerS: 255, minPowerS: 0, laserModeEnabled: true },
      readyMachine(project),
      DEFAULT_JOB_PLACEMENT,
      DEFAULT_OUTPUT_SCOPE,
      false,
      {
        clock: () => new Date('2026-07-19T00:00:00.000Z'),
        renderVariableText: async () => {
          throw new Error('No variable text is present in this fixture.');
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((warning) => warning.includes('Controller $30 is 255'))).toBe(
        true,
      );
    }
  });

  it('keeps unknown $30/$32 evidence review-grade for laser Start', () => {
    const project = calibratedProject();
    const result = prepareStartJob(project, {}, readyMachine(project));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((warning) => warning.includes('$30'))).toBe(true);
      expect(result.warnings.some((warning) => warning.includes('$32'))).toBe(true);
    }
  });

  it('blocks exact M7 output when current stock build info proves no M option', () => {
    const project = m7Project();
    const result = prepareStartJob(project, readyController, {
      ...readyMachine(project),
      controllerSessionEpoch: 7,
      controllerBuildInfo: stockBuildWithoutM7,
      controllerBuildInfoObservation: { sessionEpoch: 7, observedAt: 1 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messages[0]).toContain('[OPT] does not include M');
  });

  it('applies proven exact M7 incompatibility to the machine-neutral controller policy', () => {
    const policy = startControllerPolicy(
      { ok: true, errors: [], warnings: [] },
      'G21\nM7\nG1 X1\n',
      {
        controllerSessionEpoch: 7,
        controllerBuildInfo: stockBuildWithoutM7,
        controllerBuildInfoObservation: { sessionEpoch: 7, observedAt: 1 },
      },
    );

    expect(policy.blocking).toHaveLength(1);
    expect(policy.blocking[0]).toContain('[OPT] does not include M');
  });

  it('allows option M proof and warns explicitly when M7 support is unknown', () => {
    const project = m7Project();
    const supported = prepareStartJob(project, readyController, {
      ...readyMachine(project),
      controllerSessionEpoch: 7,
      controllerBuildInfo: { ...stockBuildWithoutM7, optionCodes: ['V', 'M'] },
      controllerBuildInfoObservation: { sessionEpoch: 7, observedAt: 1 },
    });
    expect(supported.ok).toBe(true);
    if (supported.ok) {
      expect(supported.gcode).toContain('\nM7\n');
      expect(supported.warnings.some((warning) => warning.includes('verify M7 support'))).toBe(
        false,
      );
    }

    const unknown = prepareStartJob(project, readyController, readyMachine(project));
    expect(unknown.ok).toBe(true);
    if (unknown.ok) {
      expect(unknown.warnings.some((warning) => warning.includes('verify M7 support'))).toBe(true);
    }
  });
});
