import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultBarcodeSpec, isBarcodeObject } from '../../core/barcode';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { openEditorForSelectedObject } from '../workspace/open-selected-object-editor';
import { useBarcodeDialogStore } from './barcode-dialog-store';
import { BarcodeDialogHost } from './BarcodeDialogHost';
import { commitBarcode } from './commit-barcode';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  useUiStore.setState({ modalDepth: 0 });
  useToastStore.setState({ toasts: [] });
  useBarcodeDialogStore.setState({ request: null, lastInserted: null });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function renderHost(): Promise<void> {
  await act(async () => root.render(<BarcodeDialogHost />));
}

async function submit(): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button === null) throw new Error('submit button missing');
  await act(async () => button.click());
  // The commit awaits caption rendering before it touches the store.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('BarcodeDialogHost', () => {
  it('inserts the previewed code as one undoable step and remembers its settings', async () => {
    useBarcodeDialogStore.getState().open({ mode: 'insert' });
    await renderHost();
    await submit();
    const state = useStore.getState();
    const [object] = state.project.scene.objects;
    expect(isBarcodeObject(object) && object.spec).toEqual(defaultBarcodeSpec('qr'));
    expect(state.project.scene.layers[0]).toMatchObject({ mode: 'fill' });
    expect(state.selectedObjectId).toBe(object?.id);
    expect(state.undoStack).toHaveLength(1);
    expect(useBarcodeDialogStore.getState()).toMatchObject({
      request: null,
      lastInserted: defaultBarcodeSpec('qr'),
    });
    expect(useToastStore.getState().toasts[0]?.message).toBe(
      'Inserted QR Code on a new Fill operation.',
    );
    expect(host.innerHTML).toBe('');
  });

  it('edits a double-clicked barcode in place', async () => {
    useBarcodeDialogStore.getState().open({ mode: 'insert' });
    await renderHost();
    await submit();
    const inserted = useStore.getState().project.scene.objects[0];
    openEditorForSelectedObject();
    expect(useBarcodeDialogStore.getState().request).toEqual({
      mode: 'edit',
      objectId: inserted?.id,
    });
    await renderHost();
    expect(host.textContent).toContain('Edit Barcode');
    const data = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Barcode data"]');
    if (data === null) throw new Error('data field missing');
    data.value = 'EDITED';
    await act(async () => Simulate.change(data));
    await submit();
    const edited = useStore.getState().project.scene.objects;
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({
      id: inserted?.id,
      transform: inserted?.transform,
      spec: { data: 'EDITED' },
    });
  });

  it('closes an edit whose barcode no longer exists', async () => {
    useBarcodeDialogStore.getState().open({ mode: 'edit', objectId: 'gone' });
    await renderHost();
    expect(host.innerHTML).toBe('');
    expect(useBarcodeDialogStore.getState().request).toBeNull();
  });
});

describe('commitBarcode', () => {
  it('outlines 1D text through the text renderer with the barcode color', async () => {
    const calls: string[] = [];
    const renderer: VariableTextRenderer = async ({ text, content }) => {
      calls.push(`${content}:${text.color}`);
      return {
        bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
        paths: [
          {
            color: text.color,
            polylines: [
              {
                closed: true,
                points: [
                  { x: 0, y: 0 },
                  { x: 4, y: 0 },
                  { x: 4, y: 2 },
                  { x: 0, y: 0 },
                ],
              },
            ],
          },
        ],
      };
    };
    const spec = { ...defaultBarcodeSpec('code128'), data: 'LOT-7' };
    const result = await commitBarcode({ spec, value: 'LOT-7', renderer });
    expect(result).toEqual({ ok: true, message: 'Inserted Code 128 on a new Fill operation.' });
    expect(calls).toEqual(['LOT-7:#000000']);
  });
});
