import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { DesktopEditorsPanel } from './DesktopEditorsPanel';
import { applyStudioSnapshot } from './apply-studio-snapshot';
import {
  getStudioSnapshot,
  getStudioStatus,
  openStudioEditor,
  resumeStudioEditor,
  type StudioSnapshot,
  type StudioStatus,
} from './artcraft-api';
vi.mock('./artcraft-api', () => ({
  getStudioStatus: vi.fn(),
  getStudioSnapshot: vi.fn(),
  openStudioEditor: vi.fn(),
  resumeStudioEditor: vi.fn(),
}));
vi.mock('./apply-studio-snapshot', () => ({ applyStudioSnapshot: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
const close = vi.fn();
const status: StudioStatus = {
  available: true,
  editors: { vector: { installed: true, version: '1' }, photo: { installed: true, version: '1' } },
  sessions: [{ id: 'session-1', editor: 'vector', title: 'Drawing', running: true }],
};
beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  vi.mocked(getStudioStatus).mockResolvedValue(status);
  useUiStore.setState({ modalDepth: 0 });
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
});
async function render(): Promise<void> {
  await act(async () => {
    root = createRoot(host);
    root.render(<DesktopEditorsPanel onClose={close} />);
  });
}
function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find(
    (node) => node.textContent === label,
  );
  if (!result) throw new Error(`Button ${label} not found`);
  return result;
}
it('registers a modal, traps workspace shortcuts and closes with Escape', async () => {
  await render();
  expect(useUiStore.getState().modalDepth).toBe(1);
  const key = vi.fn();
  window.addEventListener('keydown', key);
  await act(async () =>
    button('Close').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    ),
  );
  expect(key).not.toHaveBeenCalled();
  await act(async () =>
    button('Close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(close).toHaveBeenCalledOnce();
  window.removeEventListener('keydown', key);
  await act(async () => root?.unmount());
  root = undefined;
  expect(useUiStore.getState().modalDepth).toBe(0);
});
it('opens the full vector editor with explicit physical dimensions', async () => {
  await render();
  await act(async () => button('Open VectorCraft').click());
  expect(openStudioEditor).toHaveBeenCalledWith('vector', null, { widthMm: 100, heightMm: 100 });
});
it('reopens closed sessions and cannot Apply a stale closed editor', async () => {
  vi.mocked(getStudioStatus).mockResolvedValue({
    ...status,
    sessions: [{ ...status.sessions[0]!, running: false }],
  });
  await render();
  expect(button('Apply to KerfDesk').disabled).toBe(true);
  await act(async () => button('Reopen editor').click());
  expect(resumeStudioEditor).toHaveBeenCalledWith('session-1');
});
it('does not apply an asynchronously returned snapshot after closing', async () => {
  let resolve: (value: StudioSnapshot) => void = () => undefined;
  vi.mocked(getStudioSnapshot).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await act(async () => button('Apply to KerfDesk').click());
  await act(async () => root?.unmount());
  root = undefined;
  await act(async () => resolve({ id: 'session-1' } as StudioSnapshot));
  expect(applyStudioSnapshot).not.toHaveBeenCalled();
});
it('captures project ownership before requesting a snapshot', async () => {
  const snapshot = { id: 'session-1' } as StudioSnapshot;
  vi.mocked(getStudioSnapshot).mockImplementation(async () => {
    useStore.setState({ projectDocumentEpoch: 2 });
    return snapshot;
  });
  await render();
  await act(async () => button('Apply to KerfDesk').click());
  expect(applyStudioSnapshot).toHaveBeenCalledWith(snapshot, 0, expect.any(Function));
});
