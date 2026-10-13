import { beforeEach, describe, expect, it } from 'vitest';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { framedRunReadinessIssue } from './framed-run-readiness';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { currentFrameSpatialSignature } from './frame-spatial-identity';
import { installFrameOnceProject } from './frame-once.test-support';

beforeEach(installFrameOnceProject);

describe('Frame permit with chosen start points', () => {
  it('requires another Frame after changing either start and accepts the unchanged project', () => {
    const app = useStore.getState();
    const laser = useLaserStore.getState();
    const candidate = {
      project: app.project,
      executionSignature: currentReplayExecutionSignature(app),
      spatialSignature: currentFrameSpatialSignature(app),
    } as FramedRunCandidate;
    const permit = createFramedRunPermit(candidate, laser);
    expect(framedRunReadinessIssue(permit, app, laser)).toBeNull();
    for (const startPoints of [
      { frame: { edge: 2 as const, fraction: 0.25 } },
      { job: { x: 20, y: 10 } },
    ]) {
      expect(
        framedRunReadinessIssue(
          permit,
          {
            ...app,
            project: { ...app.project, startPoints },
          },
          laser,
        ),
      ).toContain('Frame the updated job again');
    }
  });

  it('retains Frame after power and speed edits with chosen start points', () => {
    const source = useStore.getState();
    const app = {
      ...source,
      project: {
        ...source.project,
        startPoints: { frame: { edge: 1 as const, fraction: 0.25 }, job: { x: 20, y: 10 } },
      },
    };
    const laser = useLaserStore.getState();
    const candidate = {
      project: app.project,
      executionSignature: currentReplayExecutionSignature(app),
      spatialSignature: currentFrameSpatialSignature(app),
    } as FramedRunCandidate;
    const permit = createFramedRunPermit(candidate, laser);
    const edited = {
      ...app,
      project: {
        ...app.project,
        scene: {
          ...app.project.scene,
          layers: app.project.scene.layers.map((layer) => ({ ...layer, power: 71, speed: 2300 })),
        },
      },
    };
    expect(currentReplayExecutionSignature(edited)).not.toBe(candidate.executionSignature);
    expect(currentFrameSpatialSignature(edited)).toBe(candidate.spatialSignature);
    expect(framedRunReadinessIssue(permit, edited, laser)).toBeNull();
  });
});
