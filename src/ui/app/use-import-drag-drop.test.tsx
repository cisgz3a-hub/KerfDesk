import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useImportDragDrop } from './use-import-drag-drop';

const imageMocks = vi.hoisted(() => ({
  importImageFile: vi.fn(async () => undefined),
}));

vi.mock('../commands/import-image-action', () => ({
  importImageFile: imageMocks.importImageFile,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Harness(): null {
  useImportDragDrop();
  return null;
}

async function renderHarness(): Promise<() => Promise<void>> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<Harness />);
  });
  return async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
}

async function dropFiles(files: ReadonlyArray<File>): Promise<void> {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types: ['Files'] },
  });
  await act(async () => {
    window.dispatchEvent(event);
    await Promise.resolve();
  });
}

function toastMessages(): ReadonlyArray<string> {
  return useToastStore.getState().toasts.map((t) => t.message);
}

afterEach(() => {
  imageMocks.importImageFile.mockClear();
  useStore.getState().newProject();
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

// M26 (AUDIT-2026-06-10): the window drop handler was SVG-extension-only —
// image drops toasted "no SVG files", mixed drops silently discarded the
// non-SVG files. Drag-and-drop is F-F2's primary raster entry point.
describe('useImportDragDrop image routing (M26)', () => {
  it('routes a dropped PNG through the image import pipeline', async () => {
    const unmount = await renderHarness();

    await dropFiles([new File(['x'], 'photo.png', { type: 'image/png' })]);

    expect(imageMocks.importImageFile).toHaveBeenCalledTimes(1);
    expect(toastMessages().some((m) => m.includes('Drop ignored'))).toBe(false);

    await unmount();
  });

  it('routes a dropped JPG by extension when the MIME type is missing', async () => {
    const unmount = await renderHarness();

    await dropFiles([new File(['x'], 'photo.JPG', { type: '' })]);

    expect(imageMocks.importImageFile).toHaveBeenCalledTimes(1);

    await unmount();
  });

  it('names ignored files in a mixed drop instead of discarding them silently', async () => {
    const unmount = await renderHarness();

    await dropFiles([
      new File(['x'], 'photo.png', { type: 'image/png' }),
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
    ]);

    expect(imageMocks.importImageFile).toHaveBeenCalledTimes(1);
    expect(toastMessages().some((m) => m.includes('Ignored 1 file(s)'))).toBe(true);

    await unmount();
  });

  it('still rejects drops with no importable files', async () => {
    const unmount = await renderHarness();

    await dropFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);

    expect(imageMocks.importImageFile).not.toHaveBeenCalled();
    expect(toastMessages().some((m) => m.includes('Drop ignored'))).toBe(true);

    await unmount();
  });
});
