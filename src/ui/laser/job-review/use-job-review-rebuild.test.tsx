import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
    await act(async () => vi.advanceTimersByTime(300));
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
  });
});
