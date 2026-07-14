import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { createProject, type Project } from '../../core/scene';
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

describe('Start controller selection policy', () => {
  it('allows the user-selected profile when detected firmware differs', () => {
    const result = prepareStartJob(projectFor('grbl-v1.1'), null, {
      ...readyMachine,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'marlin',
    });

    expectControllerSelectionNotBlocked(result);
  });

  it('does not require reconnecting after the user selects another profile', () => {
    const result = prepareStartJob(projectFor('marlin'), null, {
      ...readyMachine,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grbl-v1.1',
    });

    expectControllerSelectionNotBlocked(result);
  });

  it('also allows matching profile and controller identities', () => {
    const result = prepareStartJob(projectFor('grblhal'), null, {
      ...readyMachine,
      activeControllerKind: 'grblhal',
      detectedControllerKind: 'grblhal',
    });

    expectControllerSelectionNotBlocked(result);
  });
});

function projectFor(controllerKind: NonNullable<Project['device']['controllerKind']>): Project {
  const project = createProject();
  return { ...project, device: { ...project.device, controllerKind } };
}

function expectControllerSelectionNotBlocked(result: ReturnType<typeof prepareStartJob>): void {
  const messages = result.ok ? [] : result.messages;
  expect(messages.some((message) => /controller.*match.*profile/i.test(message))).toBe(false);
}
