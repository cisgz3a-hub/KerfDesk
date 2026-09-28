import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { TRIM_SHAPES_HINT, TrimShapesHint } from './TrimShapesHint';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(async () => {
  useUiStore.getState().resetToolMode();
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<TrimShapesHint />);
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  useUiStore.getState().resetToolMode();
});

describe('TrimShapesHint', () => {
  it('shows only while the Trim Shapes tool is on', async () => {
    expect(host.textContent).toBe('');
    await act(async () => useUiStore.getState().setToolMode({ kind: 'trim-shapes' }));
    expect(host.querySelector('[role="status"]')?.textContent).toContain(TRIM_SHAPES_HINT);
  });

  it('returns to the Select tool from its Done button', async () => {
    await act(async () => useUiStore.getState().setToolMode({ kind: 'trim-shapes' }));
    const done = host.querySelector('button');
    expect(done?.title).toContain('Esc');
    await act(async () => done?.click());
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
    expect(host.textContent).toBe('');
  });
});
