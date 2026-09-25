import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBarcodeSpec, isBarcodeObject } from '../../core/barcode';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { useBarcodeDialogStore } from './barcode-dialog-store';
import { BarcodeDialogHost } from './BarcodeDialogHost';
import { commitBarcode } from './commit-barcode';

const caption = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../text/render-variable-text', () => ({ renderVariableText: caption.render }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const rendered: Awaited<ReturnType<VariableTextRenderer>> = {
  bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
  paths: [],
};
const originalSpec = { ...defaultBarcodeSpec('code128'), data: 'ORIGINAL' };
let host: HTMLDivElement;
let root: Root;
let release: (value: typeof rendered) => void;

beforeEach(() => {
  resetStore();
  useUiStore.setState({ modalDepth: 0 });
  useToastStore.setState({ toasts: [] });
  useBarcodeDialogStore.setState({ request: null, lastInserted: originalSpec });
  caption.render.mockReset();
  caption.render.mockReturnValue(new Promise<typeof rendered>((resolve) => (release = resolve)));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function protectedState() {
  const state = useStore.getState();
  return {
    project: state.project,
    undo: state.undoStack,
    redo: state.redoStack,
    selected: state.selectedObjectId,
    additional: state.additionalSelectedIds,
    dirty: state.dirty,
  };
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((node) => node.textContent === label);
  if (found === undefined) throw new Error(`${label} button missing`);
  return found;
}

async function startInsert(): Promise<void> {
  useBarcodeDialogStore.getState().open({ mode: 'insert' });
  await act(async () => root.render(<BarcodeDialogHost />));
  await act(async () => button('Insert').click());
  expect(caption.render).toHaveBeenCalledTimes(1);
  expect(button('Insert').disabled).toBe(true);
}

async function finishCaption(): Promise<void> {
  await act(async () => {
    release(rendered);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function expectUnchanged(before: ReturnType<typeof protectedState>): void {
  expect(protectedState()).toEqual(before);
  expect(useToastStore.getState().toasts).toEqual([]);
  expect(useBarcodeDialogStore.getState().lastInserted).toEqual(originalSpec);
}

describe('barcode commit request ownership', () => {
  it.each([false, true])(
    'does not insert after actual Cancel, even if the document is replaced (%s)',
    async (replaceDocument) => {
      await startInsert();
      await act(async () => button('Cancel').click());
      if (replaceDocument) await act(async () => useStore.getState().newProject());
      const before = protectedState();
      await finishCaption();
      expectUnchanged(before);
      expect(host.innerHTML).toBe('');
      expect(useBarcodeDialogStore.getState().request).toBeNull();
    },
  );

  it('rejects a pending insert after actual New Project without relying on Cancel', async () => {
    await startInsert();
    const epoch = useStore.getState().projectDocumentEpoch;
    await act(async () => useStore.getState().newProject());
    expect(useStore.getState().projectDocumentEpoch).toBe(epoch + 1);
    const before = protectedState();
    await finishCaption();
    expectUnchanged(before);
    expect(host.innerHTML).toBe('');
  });

  it.each([false, true])(
    'keeps a newer insert dialog usable after stale completion (cancel first: %s)',
    async (cancelFirst) => {
      await startInsert();
      const oldRequest = useBarcodeDialogStore.getState().request;
      if (oldRequest === null) throw new Error('Insert request missing');
      const newerSpec = { ...originalSpec, data: 'NEXT REQUEST' };
      await act(async () => {
        if (cancelFirst) button('Cancel').click();
        useBarcodeDialogStore.getState().rememberInserted(newerSpec);
        // Reopening the same input object is still a new dialog lifetime.
        useBarcodeDialogStore.getState().open(oldRequest);
      });
      const before = protectedState();
      await finishCaption();
      expect(protectedState()).toEqual(before);
      expect(useToastStore.getState().toasts).toEqual([]);
      expect(useBarcodeDialogStore.getState()).toMatchObject({
        request: { mode: 'insert' },
        lastInserted: newerSpec,
      });
      expect(button('Insert').disabled).toBe(false);
      expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('NEXT REQUEST');
    },
  );

  it('does not commit after its dialog host unmounts', async () => {
    await startInsert();
    await act(async () => root.render(null));
    const before = protectedState();
    await finishCaption();
    expectUnchanged(before);
  });

  it('does not overwrite a replacement edit target with the same object ID', async () => {
    await commitBarcode({
      spec: originalSpec,
      value: originalSpec.data,
      renderer: async () => rendered,
    });
    const original = useStore.getState().project.scene.objects[0];
    if (!isBarcodeObject(original)) throw new Error('Barcode fixture missing');
    useToastStore.setState({ toasts: [] });
    useBarcodeDialogStore.getState().open({ mode: 'edit', objectId: original.id });
    await act(async () => root.render(<BarcodeDialogHost />));
    const input = host.querySelector<HTMLTextAreaElement>('textarea');
    if (input === null) throw new Error('Barcode data missing');
    input.value = 'STALE EDIT';
    await act(async () => Simulate.change(input));
    await act(async () => button('Apply').click());
    expect(caption.render).toHaveBeenCalledTimes(1);
    const replacement = { ...original, transform: { ...original.transform, x: 42 } };
    await act(async () => {
      useStore.setState((state) => ({
        project: { ...state.project, scene: { ...state.project.scene, objects: [replacement] } },
      }));
    });
    const before = protectedState();
    await finishCaption();
    expectUnchanged(before);
    expect(useStore.getState().project.scene.objects[0]).toBe(replacement);
  });

  it('still commits a live delayed insert once and remembers its settings', async () => {
    await startInsert();
    await finishCaption();
    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(1);
    expect(state.project.scene.objects[0]).toMatchObject({ spec: originalSpec });
    expect(state.project.scene.layers).toHaveLength(1);
    expect(state.project.scene.layers[0]?.mode).toBe('fill');
    expect(state.undoStack).toHaveLength(1);
    expect(state.selectedObjectId).toBe(state.project.scene.objects[0]?.id);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useBarcodeDialogStore.getState()).toMatchObject({
      request: null,
      lastInserted: originalSpec,
    });
    expect(host.innerHTML).toBe('');
  });

  it('still commits a live delayed edit once with its existing placement and operation', async () => {
    await commitBarcode({
      spec: originalSpec,
      value: originalSpec.data,
      renderer: async () => rendered,
    });
    const original = useStore.getState().project.scene.objects[0];
    if (!isBarcodeObject(original)) throw new Error('Barcode fixture missing');
    const layers = useStore.getState().project.scene.layers;
    useBarcodeDialogStore.getState().open({ mode: 'edit', objectId: original.id });
    await act(async () => root.render(<BarcodeDialogHost />));
    const input = host.querySelector<HTMLTextAreaElement>('textarea');
    if (input === null) throw new Error('Barcode data missing');
    input.value = 'LIVE EDIT';
    await act(async () => Simulate.change(input));
    await act(async () => button('Apply').click());
    expect(caption.render).toHaveBeenCalledTimes(1);
    await finishCaption();
    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(1);
    expect(state.project.scene.objects[0]).toMatchObject({
      id: original.id,
      operationIds: original.operationIds,
      transform: original.transform,
      spec: { ...originalSpec, data: 'LIVE EDIT' },
    });
    expect(state.project.scene.layers).toEqual(layers);
    expect(state.undoStack).toHaveLength(2);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Updated Code 128.',
    ]);
    expect(useBarcodeDialogStore.getState().lastInserted).toEqual(originalSpec);
    expect(host.innerHTML).toBe('');
  });

  it('also fences document replacement in the commit API without a dialog guard', async () => {
    const pending = commitBarcode({
      spec: originalSpec,
      value: originalSpec.data,
      renderer: caption.render,
    });
    expect(caption.render).toHaveBeenCalledTimes(1);
    useStore.getState().newProject();
    const before = protectedState();
    release(rendered);
    expect((await pending).ok).toBe(false);
    expectUnchanged(before);
  });
});
