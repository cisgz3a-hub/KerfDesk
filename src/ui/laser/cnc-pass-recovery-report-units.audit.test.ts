import { describe, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { RecoveryCapsule } from '../state/recovery';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing';
import { retainedPositionIssue } from './cnc-pass-recovery-review';

async function interruptedInchesRun(): Promise<RecoveryCapsule> {
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'cnc-inch-report-reconnect',
    project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
    controllerSettings: { reportInches: true, laserModeEnabled: false },
    controllerObservation: { wco: { x: 1, y: 2, z: 0.5 } },
  });
  return {
    runId: artifact.runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: 1,
    sendableLines: artifact.sendableLines,
    interruption: { kind: 'disconnect', message: 'The connection was lost.' },
    updatedAtIso: artifact.createdAtIso,
    artifact,
  };
}

describe('CNC retained work origin after report-unit changes on reconnect', () => {
  it('recognizes the same physical offset reported in millimetres after an inches run', async () => {
    const capsule = await interruptedInchesRun();

    expect(retainedPositionIssue(capsule, { x: 25.4, y: 50.8, z: 12.7 }, false)).toBeNull();
  });

  it('does not call equal raw numbers the same offset when their units changed', async () => {
    const capsule = await interruptedInchesRun();

    expect(retainedPositionIssue(capsule, { x: 1, y: 2, z: 0.5 }, false)).toContain('differs');
  });

  it('applies the same millimetre tolerance when both observations use inches', async () => {
    const capsule = await interruptedInchesRun();

    expect(retainedPositionIssue(capsule, { x: 1.0001, y: 2, z: 0.5 }, true)).toBeNull();
    expect(retainedPositionIssue(capsule, { x: 1, y: 2.004, z: 0.5 }, true)).toContain('differs');
    expect(retainedPositionIssue(capsule, { x: 1, y: 2, z: 0.504 }, true)).toContain('differs');
  });

  it('does not interpret unconfirmed live report units as millimetres', async () => {
    const capsule = await interruptedInchesRun();

    expect(retainedPositionIssue(capsule, { x: 25.4, y: 50.8, z: 12.7 })).toContain('unconfirmed');
  });

  it('does not infer archived units that were never recorded', async () => {
    const capsule = await interruptedInchesRun();
    if (capsule.artifact.kind !== 'exact-execution') throw new Error('Expected exact artifact.');
    const withoutUnits: RecoveryCapsule = {
      ...capsule,
      artifact: {
        ...capsule.artifact,
        archivedControllerObservation: {
          ...capsule.artifact.archivedControllerObservation,
          settings: { laserModeEnabled: false },
        },
      },
    };

    expect(retainedPositionIssue(withoutUnits, { x: 1, y: 2, z: 0.5 }, false)).toContain(
      'unconfirmed',
    );
  });
});
