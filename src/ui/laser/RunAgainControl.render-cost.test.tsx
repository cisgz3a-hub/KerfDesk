// The Run-again offer is mounted for the whole session. It used to subscribe to
// the WHOLE app store, so every setCursorMm at mousemove cadence re-derived the
// execution signature. Counting signature derivations is the cheapest honest
// proxy for "did this component re-render".

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { RecoveryRepository } from '../state/recovery';
import {
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { RunAgainControl } from './RunAgainControl';
import type * as ExecutionTracking from './start-job-execution-tracking';

const counter = vi.hoisted(() => ({ signatures: 0 }));

vi.mock('./start-job-execution-tracking', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionTracking>();
  return {
    ...actual,
    currentReplayExecutionSignature: (
      ...args: Parameters<typeof actual.currentReplayExecutionSignature>
    ): string => {
      counter.signatures += 1;
      return actual.currentReplayExecutionSignature(...args);
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  usePrintCutSessionStore.getState().clear();
  counter.signatures = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  usePrintCutSessionStore.getState().clear();
});

describe('RunAgainControl store subscription', () => {
  it('does not re-derive the replay signature on cursor motion', async () => {
    await render();
    const before = counter.signatures;

    act(() => useStore.getState().setCursorMm({ x: 5, y: 6 }));

    expect(counter.signatures).toBe(before);
  });

  it('re-derives the replay signature when placement changes', async () => {
    await render();
    const before = counter.signatures;

    act(() => useStore.getState().setJobPlacement({ anchor: 'center' }));

    expect(counter.signatures).toBeGreaterThan(before);
  });
});

async function render(): Promise<void> {
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<RunAgainControl disabled={false} busy={false} repository={repository} />);
  });
}
