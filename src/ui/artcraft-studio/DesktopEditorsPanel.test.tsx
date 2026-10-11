import { disposeStudioProjectBridge } from './studio-project-bridge';
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
  restoreStudioDocument,
  captureStudioDocument,
  type StudioSnapshot,
  type StudioStatus,
} from './artcraft-api';
vi.mock('./artcraft-api', () => ({
  getStudioStatus: vi.fn(),
  getStudioSnapshot: vi.fn(),
  openStudioEditor: vi.fn(),
  resumeStudioEditor: vi.fn(),
  restoreStudioDocument: vi.fn(),
  captureStudioDocument: vi.fn(),
  hostStudioEditor: vi.fn(async () => ({})),
  hideStudioEditor: vi.fn(async () => ({})),
}));
vi.mock('./apply-studio-snapshot', () => ({ applyStudioSnapshot: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
const close = vi.fn();
const documentId = '11111111-1111-4111-8111-111111111111';
const nativeDocument = {
  id: documentId,
  editor: 'vector' as const,
  title: 'Drawing',
  editorVersion: '0.9.0',
  nativeFormat: 'vectorcraft' as const,
  nativeBase64: 'YQ==',
  nativeSha256: 'a'.repeat(64),
  revision: 'saved',
};
const status: StudioStatus = {
  available: true,
  editors: { vector: { installed: true, version: '1' }, photo: { installed: true, version: '1' } },
  sessions: [{ id: 'session-1', editor: 'vector', title: 'Drawing', running: true }],
};
beforeEach(() => {
  disposeStudioProjectBridge();
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* no layout in jsdom */
      }
      disconnect() {
        /* no layout in jsdom */
      }
    },
  );
  vi.mocked(openStudioEditor).mockResolvedValue({
    id: documentId,
    documentId,
    editor: 'vector',
    title: 'Drawing',
    running: true,
  });
  vi.mocked(captureStudioDocument).mockResolvedValue(nativeDocument);
  vi.mocked(restoreStudioDocument).mockResolvedValue({
    id: 'new-session',
    documentId,
    editor: 'vector',
    title: 'Drawing',
    running: true,
  });
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
  disposeStudioProjectBridge();
  vi.unstubAllGlobals();
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
it('registers a modal, traps workspace shortcuts and checkpoints before returning to Design Studio', async () => {
  await render();
  expect(useUiStore.getState().modalDepth).toBe(1);
  const key = vi.fn();
  window.addEventListener('keydown', key);
  await act(async () =>
    button('Back to Design Studio').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    ),
  );
  expect(key).not.toHaveBeenCalled();
  await act(async () =>
    button('Back to Design Studio').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(close).not.toHaveBeenCalled();
  await act(async () => button('Back to Design Studio').click());
  expect(close).toHaveBeenCalledOnce();
  window.removeEventListener('keydown', key);
  await act(async () => root?.unmount());
  root = undefined;
  expect(useUiStore.getState().modalDepth).toBe(0);
});
it('offers only recovery of saved legacy sources without new-document controls', async () => {
  useStore.setState({
    project: { ...useStore.getState().project, studioDocuments: [nativeDocument] },
  });
  await render();
  expect(document.querySelector('[aria-label="Create studio document"]')).toBeNull();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(document.body.textContent).not.toContain('New document');
  expect(document.body.textContent).not.toContain('Create a vector or photo document');
  expect(openStudioEditor).not.toHaveBeenCalled();
});
it('restores editable source from this project instead of showing another project sessions', async () => {
  useStore.setState({
    project: { ...useStore.getState().project, studioDocuments: [nativeDocument] },
  });
  await render();
  expect(button('Apply to KerfDesk').disabled).toBe(true);
  const documentButton = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === 'DrawingVectorCraft',
  )!;
  await act(async () => documentButton.click());
  expect(restoreStudioDocument).toHaveBeenCalledWith(nativeDocument);
  expect(button('Apply to KerfDesk').disabled).toBe(false);
});
it('does not apply an asynchronously returned snapshot after closing', async () => {
  useStore.setState({
    project: { ...useStore.getState().project, studioDocuments: [nativeDocument] },
  });
  let resolve: (value: StudioSnapshot) => void = () => undefined;
  vi.mocked(getStudioSnapshot).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await act(async () => button('DrawingVectorCraft').click());
  await act(async () => button('Apply to KerfDesk').click());
  await act(async () => root?.unmount());
  root = undefined;
  await act(async () => resolve({ id: documentId } as StudioSnapshot));
  expect(applyStudioSnapshot).not.toHaveBeenCalled();
});
it('captures project ownership before requesting a snapshot', async () => {
  useStore.setState({
    project: { ...useStore.getState().project, studioDocuments: [nativeDocument] },
  });
  const snapshot = { id: documentId } as StudioSnapshot;
  vi.mocked(getStudioSnapshot).mockImplementation(async () => {
    useStore.setState({ projectDocumentEpoch: 2 });
    return snapshot;
  });
  await render();
  await act(async () => button('DrawingVectorCraft').click());
  await act(async () => button('Apply to KerfDesk').click());
  expect(applyStudioSnapshot).not.toHaveBeenCalled();
});
