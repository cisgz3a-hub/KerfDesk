import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, EMPTY_SCENE } from '../../../core/scene';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import type { JobReviewModel } from './job-review-model';
import { useJobReviewStore } from './job-review-store';
import { useJobReviewRebuildTrigger } from './use-job-review-rebuild';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const model: JobReviewModel = {
  machineKind: 'laser',
  stats: [],
  warnings: [],
  resolvedOriginLabel: 'Absolute coordinates',
  toolPlanLabels: [],
  outputQualityFacts: [],
  effectiveOperations: [],
  acknowledgement: { kind: 'laser-verified' },
};

let host: HTMLDivElement;
let root: Root | null = null;

const REBUILD_SETTLE_MS = 300;
const PROPERTY_RUNS = 50;
const MAX_PROPERTY_ACTIONS = 20;
const MAX_POWER_PERCENT = 100;

type RebuildAction = 'edit' | 'rebuild' | 'advance' | 'consume';

const rebuildActionsArbitrary = fc.array<RebuildAction>(
  fc.constantFrom('edit', 'rebuild', 'advance', 'consume'),
  { minLength: 1, maxLength: MAX_PROPERTY_ACTIONS },
);

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        objects: [],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
  });
  useJobReviewStore.getState().close();
  useJobReviewStore.getState().open(model);
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  useJobReviewStore.getState().close();
  resetStore();
  vi.useRealTimers();
});

function RebuildHarness(): JSX.Element {
  const rebuildNow = useJobReviewRebuildTrigger();
  return <button onClick={rebuildNow}>Rebuild now</button>;
}

describe('useJobReviewRebuildTrigger', () => {
  it('flushes a pending debounce without scheduling a duplicate rebuild', async () => {
    root = createRoot(host);
    await act(async () => root?.render(<RebuildHarness />));
    const firstSignal = useJobReviewStore.getState().nextSignal();

    await act(async () => useStore.getState().setLayerParam('red', { power: 55 }));
    await act(async () => {
      host.querySelector('button')?.click();
    });

    await expect(firstSignal).resolves.toBe('rebuild');
    await act(async () => vi.advanceTimersByTime(REBUILD_SETTLE_MS));
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
  });

  it('preserves rebuild signal invariants across generated action sequences', async () => {
    root = createRoot(host);
    await act(async () => root?.render(<RebuildHarness />));

    await fc.assert(
      fc.asyncProperty(rebuildActionsArbitrary, async (actions) => {
        vi.clearAllTimers();
        useJobReviewStore.setState({ waiter: null, pendingSignal: null });
        let timerPending = false;
        let signalPending = false;
        let editRevision = useStore.getState().project.scene.layers[0]?.power ?? 0;

        for (const action of actions) {
          if (action === 'edit') {
            editRevision = (editRevision + 1) % (MAX_POWER_PERCENT + 1);
            await act(async () =>
              useStore.getState().setLayerParam('red', { power: editRevision }),
            );
            timerPending = true;
          } else if (action === 'rebuild') {
            await act(async () => host.querySelector('button')?.click());
            timerPending = false;
            signalPending = true;
          } else if (action === 'advance') {
            await act(async () => vi.advanceTimersByTime(REBUILD_SETTLE_MS));
            if (timerPending) signalPending = true;
            timerPending = false;
          } else if (signalPending) {
            await expect(useJobReviewStore.getState().nextSignal()).resolves.toBe('rebuild');
            signalPending = false;
          }

          expect(useJobReviewStore.getState().pendingSignal).toBe(signalPending ? 'rebuild' : null);
        }
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
