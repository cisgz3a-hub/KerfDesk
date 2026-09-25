import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultBarcodeSpec } from '../../core/barcode';
import { IDENTITY_TRANSFORM, type ShapeObject } from '../../core/scene';
import { useBarcodeDialogStore } from './barcode-dialog-store';
import { SelectedBarcodeSummary } from './SelectedBarcodeSummary';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BARCODE: ShapeObject = {
  kind: 'shape',
  id: 'B1',
  spec: { ...defaultBarcodeSpec('qr'), data: 'https://kerfdesk.example', invert: true },
  color: '#000000',
  bounds: { minX: 0, minY: 0, maxX: 20.4, maxY: 20.4 },
  transform: { ...IDENTITY_TRANSFORM, scaleX: 1.5, scaleY: 1.5 },
  paths: [],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useBarcodeDialogStore.setState({ request: null });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('SelectedBarcodeSummary', () => {
  it('summarises one selected barcode at its engraved size and opens the editor', async () => {
    await act(async () => root.render(<SelectedBarcodeSummary objects={[BARCODE]} />));
    expect(host.textContent).toContain('QR Code · 30.6 × 30.6 mm · inverted');
    expect(host.textContent).toContain('Data: https://kerfdesk.example');
    const button = host.querySelector('button');
    await act(async () => button?.click());
    expect(useBarcodeDialogStore.getState().request).toEqual({ mode: 'edit', objectId: 'B1' });
  });

  it('stays out of the way for other or multiple selections', async () => {
    await act(async () =>
      root.render(<SelectedBarcodeSummary objects={[BARCODE, { ...BARCODE, id: 'B2' }]} />),
    );
    expect(host.innerHTML).toBe('');
  });
});
