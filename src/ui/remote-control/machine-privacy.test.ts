import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../core/scene';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import type { JobReviewModel } from '../laser/job-review/job-review-model';
import { machineReviewPresenter } from './machine-review-presenter';
import { machineOperationProjection } from './machine-projections';
import { reliefMaterializationFailure } from '../../io/gcode/relief-materialization-failure';
import type { OwnedMachineOperation } from './machine-operation-state';
import { testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter, RemoteCommandResult } from './types';

const execution = vi.hoisted(() => vi.fn());
vi.mock('./machine-execution', () => ({ executeMachineOperation: execution }));
let sharing = true;
let adapter: RemoteControlAdapter;
let disposePresentation: () => void = () => undefined;
let heldOperation: OwnedMachineOperation;
const privateLabel = 'Private family engraving';
const acknowledgement = {
  kind: 'laser-unverified' as const,
  prompt: 'Controller settings cannot be fully verified.\n\nStart this laser job anyway?',
};
beforeEach(() => {
  sharing = true;
  useStore.setState(useStore.getInitialState(), true);
  useLaserStore.setState(initialLaserState());
  useJobReviewStore.getState().close();
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        layers: [createLayer({ id: 'private', color: '#000000', name: privateLabel })],
      },
    },
  }));
  const controller = new AbortController();
  const caller = { clientId: 'client', sessionId: 'session' };
  const authority = {
    ...caller,
    signal: controller.signal,
    assertCurrent: () => controller.signal.throwIfAborted(),
  };
  adapter = testAdapter({
    canWrite: () => false,
    canShareArtwork: () => sharing,
    getRemoteCaller: () => caller,
    captureMachineAuthority: () => authority,
  });
  execution.mockReset().mockImplementation(async (_input, operation: OwnedMachineOperation) => {
    heldOperation = operation;
    const model: JobReviewModel = {
      machineKind: 'laser',
      stats: [
        {
          label: privateLabel,
          value: '1.00 mm',
          detail: `Operation "${privateLabel}" contains detail`,
        },
      ],
      warnings: [`Operation "${privateLabel}" has a 0.20 mm feature`, 'Laser power is 40%'],
      effectiveOperations: [{ layerId: 'private', summaries: [`${privateLabel}: 40% power`] }],
      acknowledgement,
      resolvedOriginLabel: 'Work origin',
      toolPlanLabels: [],
      outputQualityFacts: [],
    };
    const presentation = machineReviewPresenter(operation, () => adapter.getRevision(), {
      store: useStore,
      canWrite: () => false,
      canShareArtwork: () => sharing,
      getAppStatus: () => ({
        app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
        edition: { mode: 'free' },
        updates: { available: false },
      }),
    })(model, 'start')!;
    disposePresentation = presentation.dispose;
  });
});
afterEach(() => {
  adapter.dispose();
  disposePresentation();
  useJobReviewStore.getState().close();
  useLaserStore.setState(initialLaserState());
});

describe('machine operation final delivery privacy', () => {
  it('retained canonical preparation failure stays private after deleting the old source', async () => {
    const args = writeArgs(adapter);
    await adapter.execute('review_machine_job', args);
    const raw = reliefMaterializationFailure({
      kind: 'relief-materialization-failed',
      source: privateLabel,
      reason: 'Stored source samples are missing.',
    }).issues[0]!.message;
    useJobReviewStore.getState().failPrepare([raw]);
    expect(heldOperation.privateMessage).toBe(true);
    expect(heldOperation.message).toContain(privateLabel);
    useStore.setState((state) => ({
      project: { ...state.project, scene: { ...state.project.scene, objects: [], layers: [] } },
    }));
    sharing = false;
    const result = await adapter.execute('get_control_operation', { operationId: args.requestId });
    expect(JSON.stringify(result)).not.toContain(privateLabel);
    expect(result.ok && result.data['operation']).toMatchObject({
      message: 'Review this preparation problem in KerfDesk on the PC.',
    });
  });

  it('a model captured with sharing on remains redactable after source deletion and opt-out', async () => {
    const args = writeArgs(adapter);
    await adapter.execute('review_machine_job', args);
    const oldReview = heldOperation.review!;
    expect(oldReview.projectPrivateMessage).toBeDefined();
    useStore.setState((state) => ({
      project: { ...state.project, scene: { ...state.project.scene, objects: [], layers: [] } },
    }));
    // The live obsolete token is removed; independently challenge the retained exact model.
    expect(heldOperation.review).toBeUndefined();
    const snapshot = machineOperationProjection(
      args.requestId,
      { ...heldOperation, review: oldReview },
      adapter.getRevision(),
      {
        store: useStore,
        canWrite: () => false,
        canShareArtwork: () => false,
        getAppStatus: () => ({
          app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
          edition: { mode: 'free' },
          updates: { available: false },
        }),
      },
    );
    expect(JSON.stringify(snapshot)).not.toContain(privateLabel);
    expect(JSON.stringify(snapshot)).toContain('0.20 mm');
    expect(snapshot.review?.acknowledgement).toEqual(acknowledgement);
  });
  it.each(['get_machine_status', 'get_control_operation'] as const)(
    '%s reprojects private review wording after opt-out at the promise boundary',
    async (command) => {
      const args = writeArgs(adapter);
      await adapter.execute('review_machine_job', args);
      const result = await adapter.execute(
        command,
        command === 'get_control_operation' ? { operationId: args.requestId } : {},
      );
      expect(JSON.stringify(result)).toContain(privateLabel);
      sharing = false;
      const delivered: RemoteCommandResult = adapter.machineDelivery!(command, result);
      expect(JSON.stringify(delivered)).not.toContain(privateLabel);
      expect(JSON.stringify(delivered)).toContain('0.20 mm');
      expect(JSON.stringify(delivered)).toContain('Laser power is 40%');
      if (!delivered.ok) throw new Error('projection failed');
      expect(
        (delivered.data['operation'] as { review: { acknowledgement: unknown } }).review
          .acknowledgement,
      ).toEqual(acknowledgement);
    },
  );
});
