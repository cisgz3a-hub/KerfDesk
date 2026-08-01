import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useImportDragDrop } from './use-import-drag-drop';
import type { GcodeInspectionSource } from '../gcode-inspector';

const imageMocks = vi.hoisted(() => ({
  importImageFile: vi.fn(async () => undefined),
}));

vi.mock('../commands/import-image-action', () => ({
  importImageFile: imageMocks.importImageFile,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type OpenGcodeInspector = (name: string, source: GcodeInspectionSource) => void;

function Harness(props: { readonly openGcodeInspector: OpenGcodeInspector }): null {
  useImportDragDrop(props.openGcodeInspector);
  return null;
}

async function renderHarness(openGcodeInspector: OpenGcodeInspector = vi.fn()): Promise<{
  readonly openGcodeInspector: OpenGcodeInspector;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<Harness openGcodeInspector={openGcodeInspector} />);
  });
  return {
    openGcodeInspector,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
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

function gcodeFile(name: string, text = 'G21\nG1 X10'): File {
  const file = new File([text], name);
  Object.defineProperty(file, 'text', {
    configurable: true,
    value: vi.fn(async () => text),
  });
  return file;
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
    const { unmount } = await renderHarness();

    await dropFiles([new File(['x'], 'photo.png', { type: 'image/png' })]);

    expect(imageMocks.importImageFile).toHaveBeenCalledTimes(1);
    expect(toastMessages().some((m) => m.includes('Drop ignored'))).toBe(false);

    await unmount();
  });

  it('routes a dropped JPG by extension when the MIME type is missing', async () => {
    const { unmount } = await renderHarness();

    await dropFiles([new File(['x'], 'photo.JPG', { type: '' })]);

    expect(imageMocks.importImageFile).toHaveBeenCalledTimes(1);

    await unmount();
  });

  it('names ignored files in a mixed drop instead of discarding them silently', async () => {
    const { unmount } = await renderHarness();

    await dropFiles([
      new File(['x'], 'photo.png', { type: 'image/png' }),
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
    ]);

    expect(imageMocks.importImageFile).toHaveBeenCalledTimes(1);
    expect(toastMessages().some((m) => m.includes('Ignored 1 file(s)'))).toBe(true);

    await unmount();
  });

  it('still rejects drops with no importable files', async () => {
    const { unmount } = await renderHarness();

    await dropFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);

    expect(imageMocks.importImageFile).not.toHaveBeenCalled();
    expect(toastMessages().some((m) => m.includes('Drop ignored'))).toBe(true);

    await unmount();
  });
});

describe('useImportDragDrop G-code Inspector routing (LF-CANVAS-GCODE-DROP-001)', () => {
  it.each(['part.nc', 'PART.GCODE', 'cycle.TaP'])(
    'opens a dropped %s program in the existing Inspector slot',
    async (name) => {
      const openGcodeInspector = vi.fn<OpenGcodeInspector>();
      const { unmount } = await renderHarness(openGcodeInspector);
      const file = gcodeFile(name);

      await dropFiles([file]);

      await vi.waitFor(() => {
        expect(openGcodeInspector).toHaveBeenCalledWith(name, { kind: 'blob', blob: file });
      });
      expect(file.text).not.toHaveBeenCalled();
      expect(toastMessages().some((message) => message.includes('Drop ignored'))).toBe(false);
      expect(useStore.getState().project.scene.objects).toHaveLength(0);

      await unmount();
    },
  );

  it('routes G-code and artwork from one drop without counting either as ignored', async () => {
    const openGcodeInspector = vi.fn<OpenGcodeInspector>();
    const { unmount } = await renderHarness(openGcodeInspector);

    const gcode = gcodeFile('part.gcode');
    await dropFiles([gcode, new File(['pixels'], 'photo.png', { type: 'image/png' })]);

    await vi.waitFor(() => {
      expect(openGcodeInspector).toHaveBeenCalledWith('part.gcode', {
        kind: 'blob',
        blob: gcode,
      });
    });
    expect(imageMocks.importImageFile).toHaveBeenCalledTimes(1);
    expect(toastMessages().some((message) => message.startsWith('Ignored '))).toBe(false);

    await unmount();
  });

  it('passes the Blob without calling its main-thread text reader', async () => {
    const openGcodeInspector = vi.fn<OpenGcodeInspector>();
    const file = gcodeFile('broken.nc');
    Object.defineProperty(file, 'text', {
      value: vi.fn(async () => {
        throw new Error('read failed');
      }),
    });
    const { unmount } = await renderHarness(openGcodeInspector);

    await dropFiles([file]);

    expect(openGcodeInspector).toHaveBeenCalledWith('broken.nc', { kind: 'blob', blob: file });
    expect(file.text).not.toHaveBeenCalled();

    await unmount();
  });

  // Rule 7 / ADR-228: the dropped-file size ceiling became an advisory. A very
  // large program is opened in the Inspector; the operator is only warned first.
  it('advises on a very large dropped G-code file, then opens it', async () => {
    const openGcodeInspector = vi.fn<OpenGcodeInspector>();
    const file = gcodeFile('huge.tap');
    Object.defineProperty(file, 'size', { value: 64 * 1024 * 1024 + 1 });
    const read = file.text as ReturnType<typeof vi.fn>;
    const { unmount } = await renderHarness(openGcodeInspector);

    await dropFiles([file]);

    expect(toastMessages().some((m) => /may take a while/i.test(m))).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(openGcodeInspector).toHaveBeenCalled();

    await unmount();
  });

  it('opens the first G-code file and names additional programs in one warning', async () => {
    const openGcodeInspector = vi.fn<OpenGcodeInspector>();
    const { unmount } = await renderHarness(openGcodeInspector);

    const first = gcodeFile('first.nc', 'G21\nG1 X1');
    await dropFiles([
      first,
      gcodeFile('second.gcode', 'G21\nG1 X2'),
      gcodeFile('third.tap', 'G21\nG1 X3'),
    ]);

    await vi.waitFor(() => {
      expect(openGcodeInspector).toHaveBeenCalledWith('first.nc', {
        kind: 'blob',
        blob: first,
      });
    });
    expect(openGcodeInspector).toHaveBeenCalledTimes(1);
    expect(toastMessages()).toContain('Ignored 2 additional G-code files: second.gcode, third.tap');

    await unmount();
  });
});
