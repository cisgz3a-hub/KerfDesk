import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualBoxGenerationWorker as FakeWorker } from '../../__fixtures__/box/manual-box-generation-worker';
import { generateBox, type BoxPanel, type BoxSpec } from '../../core/box';
import type { BoxGenerationWorkerRequest } from './box-generation-worker-protocol';
import { runBoxGenerationRequest } from './box-generation-worker-runtime';
import { useBoxGeneration, type BoxGenerationState } from './use-box-generation';

const FIRST_SPEC: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
  dividersXCount: 0,
  dividersYCount: 0,
};

// A different box, so panels generated for the closed dialog's spec can never
// be mistaken for panels generated for the reopened dialog's spec.
const REOPENED_SPEC: BoxSpec = { ...FIRST_SPEC, widthMm: 120, dividersXCount: 1 };

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type MountedHarness = {
  readonly root: Root;
  readonly states: ReadonlyArray<BoxGenerationState>;
};

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  // The client keeps one worker warm in module scope, so it outlives every
  // React tree. Retire it through its own fatal path or the next test inherits
  // it — and with it, the request ids it has already handed out.
  for (const worker of FakeWorker.instances) worker.onerror?.();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('useBoxGeneration across dialog remounts', () => {
  it('ignores a closed dialog generation instead of answering the reopened request', async () => {
    const closed = await mountHarness(FIRST_SPEC);
    const worker = currentWorker();
    const closedRequest = requestAt(worker, 0);
    // Closing the dialog unmounts the hook while its generation is in flight.
    await unmountHarness(closed);

    const reopened = await mountHarness(REOPENED_SPEC);
    try {
      expect(FakeWorker.instances).toHaveLength(1);
      expect(worker.posted).toHaveLength(2);

      // The generator runs synchronously inside the worker and cannot be
      // interrupted, so the closed dialog's generation still lands. It must
      // never satisfy the reopened dialog's pending request.
      await act(async () => worker.respond(runBoxGenerationRequest(closedRequest)));
      expect(latestState(reopened).kind).toBe('pending');

      await act(async () => worker.respond(runBoxGenerationRequest(requestAt(worker, 1))));
      const settled = latestState(reopened);
      if (settled.kind !== 'ready') throw new Error(`expected ready, got ${settled.kind}`);
      expect(settled.snapshot.spec.widthMm).toBe(REOPENED_SPEC.widthMm);
      expect(settled.snapshot.panels).toEqual(panelsFor(REOPENED_SPEC));
    } finally {
      await unmountHarness(reopened);
    }
  });

  it('mints a fresh worker request id for every mount', async () => {
    const closed = await mountHarness(FIRST_SPEC);
    const worker = currentWorker();
    await unmountHarness(closed);
    const reopened = await mountHarness(REOPENED_SPEC);
    try {
      expect(requestAt(worker, 1).id).toBeGreaterThan(requestAt(worker, 0).id);
    } finally {
      await unmountHarness(reopened);
    }
  });
});

function GenerationHarness(props: {
  readonly spec: BoxSpec;
  readonly onState: (state: BoxGenerationState) => void;
}): null {
  const { onState } = props;
  const { state } = useBoxGeneration(props.spec);
  useEffect(() => {
    onState(state);
  }, [onState, state]);
  return null;
}

async function mountHarness(spec: BoxSpec): Promise<MountedHarness> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const states: BoxGenerationState[] = [];
  const record = (state: BoxGenerationState): void => {
    states.push(state);
  };
  await act(async () => {
    root.render(<GenerationHarness onState={record} spec={spec} />);
  });
  return { root, states };
}

async function unmountHarness(harness: MountedHarness): Promise<void> {
  await act(async () => harness.root.unmount());
}

function latestState(harness: MountedHarness): BoxGenerationState {
  const state = harness.states.at(-1);
  if (state === undefined) throw new Error('no generation state recorded');
  return state;
}

function panelsFor(spec: BoxSpec): ReadonlyArray<BoxPanel> {
  const result = generateBox(spec);
  if (result.kind !== 'generated') throw new Error('fixture spec must generate');
  return result.panels;
}

function requestAt(worker: FakeWorker, index: number): BoxGenerationWorkerRequest {
  const request = worker.posted.at(index);
  if (request === undefined) throw new Error('request missing');
  return request;
}

function currentWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('worker missing');
  return worker;
}
