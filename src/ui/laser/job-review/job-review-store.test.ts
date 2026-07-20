import { beforeEach, describe, expect, it } from 'vitest';
import type { JobReviewModel } from './job-review-model';
import { useJobReviewStore } from './job-review-store';

const model: JobReviewModel = {
  machineKind: 'laser',
  stats: [],
  warnings: [],
  resolvedOriginLabel: 'Absolute coordinates (machine space)',
  toolPlanLabels: [],
  outputQualityFacts: [],
  acknowledgement: { kind: 'laser-verified' },
};
const rebuiltModel: JobReviewModel = { ...model, warnings: ['changed'] };

beforeEach(() => {
  useJobReviewStore.getState().close();
});

describe('useJobReviewStore', () => {
  it('opens one request and fails a second open closed', () => {
    expect(useJobReviewStore.getState().open(model)).toBe(true);
    expect(useJobReviewStore.getState().open(rebuiltModel)).toBe(false);
    const state = useJobReviewStore.getState().state;
    expect(state.kind).toBe('open');
    expect(state.kind === 'open' ? state.model : null).toBe(model);
    expect(state.kind === 'open' ? state.purpose : null).toBe('start');
  });

  it('carries the frame purpose through successful and failed rebuilds', () => {
    useJobReviewStore.getState().open(model, 'frame');
    useJobReviewStore.getState().beginPrepare();
    useJobReviewStore.getState().completePrepare(rebuiltModel);

    let state = useJobReviewStore.getState().state;
    expect(state.kind === 'open' ? state.purpose : null).toBe('frame');

    useJobReviewStore.getState().beginPrepare();
    useJobReviewStore.getState().failPrepare(['cannot frame']);
    state = useJobReviewStore.getState().state;
    expect(state.kind === 'open' ? state.purpose : null).toBe('frame');
  });

  it('resolves an armed waiter exactly once; a double-click cannot double-resolve', async () => {
    useJobReviewStore.getState().open(model);
    const signal = useJobReviewStore.getState().nextSignal();
    useJobReviewStore.getState().confirm();
    useJobReviewStore.getState().confirm();
    await expect(signal).resolves.toBe('confirm');
    expect(useJobReviewStore.getState().waiter).toBeNull();
  });

  it('holds signals raised while unarmed and hands over the highest-priority one', async () => {
    useJobReviewStore.getState().open(model);
    useJobReviewStore.getState().requestRebuild();
    useJobReviewStore.getState().requestRebuild();
    expect(useJobReviewStore.getState().pendingSignal).toBe('rebuild');
    useJobReviewStore.getState().cancel();
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
    useJobReviewStore.getState().requestRebuild();
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
    await expect(useJobReviewStore.getState().nextSignal()).resolves.toBe('cancel');
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
  });

  it('ignores confirm while preparing or blocked; cancel stays available', () => {
    useJobReviewStore.getState().open(model);
    useJobReviewStore.getState().beginPrepare();
    useJobReviewStore.getState().confirm();
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    useJobReviewStore.getState().failPrepare(['blocked']);
    useJobReviewStore.getState().confirm();
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    useJobReviewStore.getState().cancel();
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
  });

  it('completePrepare swaps the model in place; failPrepare keeps the last good model', () => {
    useJobReviewStore.getState().open(model);
    useJobReviewStore.getState().beginPrepare();
    let state = useJobReviewStore.getState().state;
    expect(state.kind === 'open' ? state.isPreparing : null).toBe(true);

    useJobReviewStore.getState().completePrepare(rebuiltModel);
    state = useJobReviewStore.getState().state;
    expect(state.kind === 'open' ? state.model : null).toBe(rebuiltModel);
    expect(state.kind === 'open' ? state.isPreparing : null).toBe(false);
    expect(state.kind === 'open' ? state.blocker : 'gone').toBeNull();

    useJobReviewStore.getState().beginPrepare();
    useJobReviewStore.getState().failPrepare(['cannot prepare']);
    state = useJobReviewStore.getState().state;
    expect(state.kind === 'open' ? state.model : null).toBe(rebuiltModel);
    expect(state.kind === 'open' ? state.blocker : null).toEqual(['cannot prepare']);
    expect(state.kind === 'open' ? state.isPreparing : null).toBe(false);
  });

  it('close resets to idle and drops any held signal', () => {
    useJobReviewStore.getState().open(model);
    useJobReviewStore.getState().cancel();
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
    useJobReviewStore.getState().close();
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    expect(useJobReviewStore.getState().waiter).toBeNull();
  });
});
