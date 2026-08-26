import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { currentReplayExecutionSignature } from '../laser/start-job-execution-tracking';
import { useStore } from './store';
import { resetStore } from './test-helpers';

describe('machine setup history', () => {
  beforeEach(resetStore);

  it('restores setup, cached CNC, placement, selection/probe state, and output signature atomically', () => {
    const before = useStore.getState();
    const beforeSignature = currentReplayExecutionSignature(before);

    useStore
      .getState()
      .replaceMachineSetup(before.project.device, DEFAULT_CNC_MACHINE_CONFIG, undefined);
    const applied = useStore.getState();
    const appliedSignature = currentReplayExecutionSignature(applied);
    expect(applied.project.machine?.kind).toBe('cnc');
    expect(applied.cachedCncMachine?.kind).toBe('cnc');
    expect(appliedSignature).not.toBe(beforeSignature);

    useStore.getState().undo();
    const undone = useStore.getState();
    expect(undone.project).toBe(before.project);
    expect(undone.cachedCncMachine).toBe(before.cachedCncMachine);
    expect(undone.jobPlacement).toEqual(before.jobPlacement);
    expect(undone.selectedObjectId).toBe(before.selectedObjectId);
    expect(undone.additionalSelectedIds).toEqual(before.additionalSelectedIds);
    expect(undone.probeSetupEpoch).toBe(before.probeSetupEpoch);
    expect(currentReplayExecutionSignature(undone)).toBe(beforeSignature);

    useStore.getState().redo();
    const redone = useStore.getState();
    expect(redone.project).toBe(applied.project);
    expect(redone.cachedCncMachine).toEqual(applied.cachedCncMachine);
    expect(redone.jobPlacement).toEqual(applied.jobPlacement);
    expect(redone.probeSetupEpoch).toBe(applied.probeSetupEpoch);
    expect(currentReplayExecutionSignature(redone)).toBe(appliedSignature);
  });
});
