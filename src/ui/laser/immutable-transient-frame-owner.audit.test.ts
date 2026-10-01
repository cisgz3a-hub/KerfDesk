import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { frameOnceRepository, installFrameOnceProject } from './frame-once.test-support';
import { completeFramedRunCandidateForTest } from './framed-run-testing';
import { rebindReviewedFramedRun } from './framed-start-preparation';
import { frameLaserSecondPass } from './second-pass-execution';
import { createSecondPassExecutionFixture } from './second-pass-execution-testing';

const originalFrame = useLaserStore.getState().frame;
const originalStart = useLaserStore.getState().startJob;

beforeEach(() => {
  localStorage.clear();
  installFrameOnceProject();
  useLaserStore.setState({
    activeWcs: 'G54',
    startJob: vi.fn(async () => undefined),
    frame: vi.fn(async (_bounds, _feed, candidate) => {
      if (candidate === undefined) throw new Error('Expected immutable Frame candidate.');
      completeFramedRunCandidateForTest(candidate);
    }),
  });
});

afterEach(() => {
  useLaserStore.setState({ ...initialLaserState(), frame: originalFrame, startJob: originalStart });
  resetStore();
  vi.restoreAllMocks();
});

describe('immutable transient Frame ownership', () => {
  it.each([false, true])(
    'refuses a replacement prepared object at the same placement, changed bytes=%s',
    async (changedBytes) => {
      const repository = frameOnceRepository();
      const fixture = await createSecondPassExecutionFixture(repository);
      const permit = await frameLaserSecondPass(
        fixture.source,
        fixture.prepared,
        fixture.selection,
      );
      if (permit === null) throw new Error('Expected permit.');
      const laser = useLaserStore.getState();
      const candidate = permit.candidate;
      const rebound = rebindReviewedFramedRun(permit, {
        app: useStore.getState(),
        project: candidate.project,
        laser,
        prepared: {
          ...candidate.preparedStart,
          ...(changedBytes ? { gcode: `${candidate.preparedStart.gcode}M3 S999\n` } : {}),
        },
        outputScope: candidate.outputScope,
        laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
      });

      expect(rebound).toBeNull();
      expect(useLaserStore.getState().framedRun).toBe(permit);
      expect(useLaserStore.getState().startJob).not.toHaveBeenCalled();
      expect(repository.getSnapshot().lastCompletedReceipt?.runId).toBe(fixture.source.runId);
    },
  );
});
