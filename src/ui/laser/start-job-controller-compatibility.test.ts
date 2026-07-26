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
import { frameVerificationForProject } from './frame-verification-testing';
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

const readyMachine = {
  statusReport: idleStatus,
  alarmCode: null,
  hasActiveStreamer: false,
};

const readyController = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };

const sampleObject: SceneObject = {
  kind: 'imported-svg',
  id: 'controller-selection-test',
  source: 'controller-selection.svg',
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

describe('Start controller identity disclosure', () => {
  it('warns but does not refuse when detected firmware differs', () => {
    const project = projectFor('grbl-v1.1');
    const result = prepareStartJob(project, readyController, {
      ...readyMachine,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'marlin',
      frameVerification: frameVerificationForProject(project),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected advisory-only preparation');
    expect(result.warnings.join('\n')).toContain('Controller identity mismatch:');
    expect(result.warnings.join('\n')).toContain('firmware banner identifies Marlin');
  });

  it('warns but does not refuse after the user selects another profile', () => {
    const project = projectFor('marlin');
    const result = prepareStartJob(project, readyController, {
      ...readyMachine,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grbl-v1.1',
      frameVerification: frameVerificationForProject(project),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected advisory-only preparation');
    expect(result.warnings.join('\n')).toContain('Controller identity mismatch:');
    expect(result.warnings.join('\n')).toContain('Reconnect using the selected profile');
  });

  it('keeps matching profile and controller identities quiet', () => {
    const project = projectFor('grblhal');
    const result = prepareStartJob(project, readyController, {
      ...readyMachine,
      activeControllerKind: 'grblhal',
      detectedControllerKind: 'grblhal',
      frameVerification: frameVerificationForProject(project),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected preparation success');
    expect(result.warnings.join('\n')).not.toContain('Controller identity');
  });

  it('warns but does not refuse when firmware detection is still unknown', () => {
    const project = projectFor('grbl-v1.1');
    const result = prepareStartJob(project, readyController, {
      ...readyMachine,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: null,
      frameVerification: frameVerificationForProject(project),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected advisory-only preparation');
    expect(result.warnings.join('\n')).toContain('Controller identity unconfirmed:');
  });
});

function projectFor(controllerKind: NonNullable<Project['device']['controllerKind']>): Project {
  const project = createProject();
  return {
    ...project,
    device: { ...project.device, controllerKind },
    scene: {
      ...EMPTY_SCENE,
      objects: [sampleObject],
      layers: [createLayer({ id: 'controller-selection-layer', color: '#ff0000' })],
    },
  };
}
