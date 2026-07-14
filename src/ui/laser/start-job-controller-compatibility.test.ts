import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { createProject, type Project } from '../../core/scene';
import { CONTROLLER_PROFILE_MISMATCH_MESSAGE, prepareStartJob } from './start-job-readiness';

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

describe('Start controller compatibility gate', () => {
  it('blocks when configured, active, and detected controller identities disagree', () => {
    const result = prepareStartJob(projectFor('grbl-v1.1'), null, {
      ...readyMachine,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'marlin',
    });

    expect(result).toEqual({ ok: false, messages: [CONTROLLER_PROFILE_MISMATCH_MESSAGE] });
  });

  it('blocks after the profile changes until the active connection is reopened', () => {
    const result = prepareStartJob(projectFor('marlin'), null, {
      ...readyMachine,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grbl-v1.1',
    });

    expect(result).toEqual({ ok: false, messages: [CONTROLLER_PROFILE_MISMATCH_MESSAGE] });
  });
});

function projectFor(controllerKind: NonNullable<Project['device']['controllerKind']>): Project {
  const project = createProject();
  return { ...project, device: { ...project.device, controllerKind } };
}
