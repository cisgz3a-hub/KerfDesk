import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OutputScope } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useOutputScope } from './use-output-scope';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null;
let probe: { current: OutputScope | null };

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  probe = { current: null };
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host.remove();
});

function Harness(): null {
  probe.current = useOutputScope();
  return null;
}

async function render(): Promise<void> {
  await act(async () => root?.render(<Harness />));
}

describe('useOutputScope', () => {
  it('returns a === stable reference across a store update that does not change selection', async () => {
    await render();
    const first = probe.current;

    // A hover updates cursorMm — unrelated to output scope. currentOutputScope(s)
    // as a selector returned a fresh object here (re-render + recompute); the
    // memoized hook keeps the reference stable (PRF-01).
    await act(async () => useStore.getState().setCursorMm({ x: 10, y: 20 }));

    expect(probe.current).toBe(first);
  });

  it('returns a new reference when the selection changes', async () => {
    await render();
    const first = probe.current;

    await act(async () =>
      useStore.setState({ selectedObjectId: 'O1', additionalSelectedIds: new Set() }),
    );

    expect(probe.current).not.toBe(first);
    expect(probe.current?.selectedObjectIds).toEqual(['O1']);
  });
});
