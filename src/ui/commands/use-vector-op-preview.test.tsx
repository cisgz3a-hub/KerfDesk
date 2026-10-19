import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VectorSceneObject } from '../../core/geometry';
import { useVectorOpPreview, type VectorOpPreview } from './use-vector-op-preview';
import type { VectorOpOutcome } from './vector-op-worker-client';
import type { VectorOpTask } from './vector-op-worker-protocol';
import { openLineObject, parityObjects } from './vector-op-worker.test-fixture';

const pending: Array<(outcome: VectorOpOutcome<unknown>) => void> = [];

vi.mock('./vector-op-worker-client', () => ({
  createVectorOpSession: () => ({
    run: () => new Promise((resolve) => pending.push(resolve)),
    release: () => undefined,
  }),
}));

const TASK: VectorOpTask = {
  kind: 'offset-shapes',
  options: { distanceMm: 1, direction: 'outward', cornerStyle: 'round', outerShapesOnly: false },
  ids: { outward: 'offset-paths', inward: 'offset-inward-paths' },
};

let host: HTMLDivElement;
let root: Root;
let seen: VectorOpPreview<VectorOpTask> | null = null;

function Probe(props: { readonly sources: ReadonlyArray<VectorSceneObject> }): null {
  seen = useVectorOpPreview(props.sources, TASK);
  return null;
}

beforeEach(() => {
  pending.length = 0;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('useVectorOpPreview (ADR-609)', () => {
  it('keeps a failure with the request that met it', async () => {
    const first = parityObjects();
    await act(async () => root.render(<Probe sources={first} />));
    await act(async () => pending[0]?.({ kind: 'failed', message: 'Out of memory.' }));
    expect(seen?.failed).toBe('Out of memory.');

    const second = [openLineObject()];
    await act(async () => root.render(<Probe sources={second} />));
    expect(seen?.failed).toBeNull();
    expect(seen?.unavailable).toBeNull();
    expect(seen?.current).toBeNull();

    await act(async () => pending[1]?.({ kind: 'unavailable', message: 'No worker.' }));
    expect(seen?.unavailable).toBe('No worker.');
    expect(seen?.failed).toBeNull();
  });

  it('drops an older result once the current request settles with a problem', async () => {
    const first = parityObjects();
    await act(async () => root.render(<Probe sources={first} />));
    await act(async () => pending[0]?.({ kind: 'done', result: { kind: 'ok', value: 'first' } }));
    expect(seen?.settled?.sources).toBe(first);

    await act(async () => root.render(<Probe sources={[openLineObject()]} />));
    await act(async () => pending[1]?.({ kind: 'unavailable', message: 'No worker.' }));
    expect(seen?.unavailable).toBe('No worker.');
    expect(seen?.settled).toBeNull();
  });

  it('reports only a result settled for the current sources as current', async () => {
    const first = parityObjects();
    await act(async () => root.render(<Probe sources={first} />));
    await act(async () => pending[0]?.({ kind: 'done', result: { kind: 'ok', value: 'first' } }));
    expect(seen?.current?.sources).toBe(first);

    await act(async () => root.render(<Probe sources={[openLineObject()]} />));
    expect(seen?.current).toBeNull();
    expect(seen?.settled?.sources).toBe(first);
  });
});
