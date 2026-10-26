import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultBarcodeSpec, isBarcodeObject, type BarcodeObject } from '../../core/barcode';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { setActiveEdition, UNRESTRICTED_EDITION } from '../licensing/edition';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { commitBarcode } from './commit-barcode';

// Rolling audit v2, 02-P3-3: a barcode edit wrote through zustand's raw setter,
// so Free changed the modules of a barcode bound to a V-carve operation.

let onAllowed: (() => void) | undefined;
const requestPro = vi.fn((_feature: string, callback?: () => void) => {
  onAllowed = callback;
  return false;
});
const FREE = { ...UNRESTRICTED_EDITION, licensed: true, pro: false, requestPro };
const qr = (data: string) => ({ ...defaultBarcodeSpec('qr'), data });

beforeEach(() => {
  resetStore();
  setActiveEdition(UNRESTRICTED_EDITION);
  onAllowed = undefined;
  requestPro.mockClear();
  useStore.getState().setMachineKind('cnc');
});
afterEach(() => {
  resetStore();
  setActiveEdition(null);
});

async function insertedBarcode(cutType?: 'v-carve'): Promise<BarcodeObject> {
  const inserted = await commitBarcode({ spec: qr('LOT-1'), value: 'LOT-1' });
  if (!inserted.ok) throw new Error(inserted.message);
  const barcode = useStore.getState().project.scene.objects.find(isBarcodeObject);
  const operationId = barcode?.operationIds?.[0];
  if (barcode === undefined || operationId === undefined) throw new Error('Missing barcode');
  if (cutType !== undefined)
    useStore.getState().setLayerParam(operationId, {
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType },
    });
  const current = useStore.getState().project.scene.objects.find(isBarcodeObject);
  if (current === undefined) throw new Error('Missing barcode');
  return current;
}

it('asks for Pro before Free changes a V-carve barcode, and never applies that edit later', async () => {
  const editing = await insertedBarcode('v-carve');
  setActiveEdition(FREE);
  const before = useStore.getState().project;

  const result = await commitBarcode({ editing, spec: qr('LOT-2'), value: 'LOT-2' });

  expect(result).toEqual({
    ok: false,
    message: 'This barcode is Pro work. Unlock KerfDesk Pro, then apply it again.',
  });
  expect(requestPro).toHaveBeenCalledExactlyOnceWith('vcarve', expect.any(Function));
  expect(useStore.getState().project).toBe(before);
  // The dialog stays open with that message, so unlocking does not apply it behind it.
  setActiveEdition(UNRESTRICTED_EDITION);
  onAllowed?.();
  expect(useStore.getState().project).toBe(before);

  const retried = await commitBarcode({ editing, spec: qr('LOT-2'), value: 'LOT-2' });
  expect(retried.ok).toBe(true);
  expect(useStore.getState().project.scene.objects.find(isBarcodeObject)?.spec).toMatchObject({
    data: 'LOT-2',
  });
});

it('keeps inserting and editing barcodes on Free operations free', async () => {
  setActiveEdition(FREE);
  const editing = await insertedBarcode();

  const result = await commitBarcode({ editing, spec: qr('LOT-2'), value: 'LOT-2' });

  expect(result.ok).toBe(true);
  expect(requestPro).not.toHaveBeenCalled();
});
