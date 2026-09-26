import { describe, expect, it } from 'vitest';

import { createBarcodeObject, defaultBarcodeSpec, type BarcodeShape } from '../../core/barcode';
import { createProject, type Project, type ShapeObject } from '../../core/scene';
import { applyInsertBarcode, applyReplaceBarcode } from './barcode-insert-mutation';
import { DEFAULT_LAYER_DEFAULTS_STATE } from './layer-default-actions';

async function barcode(
  spec: BarcodeShape = defaultBarcodeSpec('qr'),
  id = 'B1',
): Promise<ShapeObject> {
  const created = await createBarcodeObject({
    id,
    color: '#000000',
    spec,
    value: spec.data,
    renderCaption: () => Promise.reject(new Error('no text expected')),
  });
  if (!created.ok) throw new Error(created.message);
  return created.object;
}

function state(project: Project = createProject()) {
  return {
    project,
    undoStack: [],
    layerDefaults: DEFAULT_LAYER_DEFAULTS_STATE,
    cncLiveCaps: null,
  };
}

describe('applyInsertBarcode', () => {
  it('centres the code unscaled on its own Fill operation as one undo step', async () => {
    const before = state();
    const object = await barcode();
    const result = applyInsertBarcode(before, object);
    const inserted = result.project.scene.objects[0];
    const operation = result.project.scene.layers[0];
    const { bedWidth, bedHeight } = before.project.device;
    expect(operation).toMatchObject({ mode: 'fill', name: 'Barcode' });
    expect(inserted?.operationIds).toEqual([operation?.id]);
    expect(inserted?.transform).toMatchObject({ scaleX: 1, scaleY: 1 });
    expect((inserted?.transform.x ?? 0) + object.bounds.maxX / 2).toBeCloseTo(bedWidth / 2, 9);
    expect((inserted?.transform.y ?? 0) + object.bounds.maxY / 2).toBeCloseTo(bedHeight / 2, 9);
    expect(result).toMatchObject({ selectedObjectId: 'B1', redoStack: [], dirty: true });
    expect(result.undoStack).toEqual([before.project]);
  });

  it('never seeds the Fill from a saved line default', async () => {
    const plain = applyInsertBarcode(state(), await barcode()).project.scene.layers[0];
    const before = {
      ...state(),
      layerDefaults: {
        byColor: { '#000000': { mode: 'line' as const, power: 100, speed: 480, passes: 3 } },
        allColors: { mode: 'line' as const, power: 42 },
      },
    };
    const result = applyInsertBarcode(before, await barcode());
    expect(result.project.scene.layers[0]).toMatchObject({
      mode: 'fill',
      power: plain?.power,
      speed: plain?.speed,
      passes: plain?.passes,
    });
  });

  it('seeds the Fill from a saved Fill default, colour before all colours', async () => {
    const before = {
      ...state(),
      layerDefaults: {
        byColor: { '#000000': { mode: 'fill' as const, power: 55, speed: 3000 } },
        allColors: { mode: 'fill' as const, power: 20 },
      },
    };
    const result = applyInsertBarcode(before, await barcode());
    expect(result.project.scene.layers[0]).toMatchObject({ mode: 'fill', power: 55, speed: 3000 });
  });

  it('skips a line default for black and falls through to a Fill default for all', async () => {
    const before = {
      ...state(),
      layerDefaults: {
        byColor: { '#000000': { mode: 'line' as const, power: 100, passes: 3 } },
        allColors: { mode: 'fill' as const, power: 20 },
      },
    };
    const result = applyInsertBarcode(before, await barcode());
    expect(result.project.scene.layers[0]).toMatchObject({ mode: 'fill', power: 20, passes: 1 });
  });
});

describe('applyReplaceBarcode', () => {
  it('re-encodes in place and keeps placement, binding and per-object settings', async () => {
    const inserted = applyInsertBarcode(state(), await barcode());
    const placed = inserted.project.scene.objects[0] as ShapeObject;
    const project = {
      ...inserted.project,
      scene: {
        ...inserted.project.scene,
        objects: [
          { ...placed, powerScale: 60, transform: { ...placed.transform, rotationDeg: 90 } },
        ],
      },
    };
    const next = await barcode({ ...defaultBarcodeSpec('qr'), data: 'LONGER DATA 0123456789' });
    const result = applyReplaceBarcode({ project, undoStack: [] }, next);
    const replaced = result?.project.scene.objects[0];
    expect(replaced).toMatchObject({
      spec: next.spec,
      bounds: next.bounds,
      powerScale: 60,
      operationIds: placed.operationIds,
      transform: { ...placed.transform, rotationDeg: 90 },
    });
    expect(result?.undoStack).toEqual([project]);
  });

  it('refuses a barcode that was deleted or locked meanwhile', async () => {
    const object = await barcode();
    const empty = createProject();
    expect(applyReplaceBarcode({ project: empty, undoStack: [] }, object)).toBeNull();
    const locked = { ...empty, scene: { ...empty.scene, objects: [{ ...object, locked: true }] } };
    expect(applyReplaceBarcode({ project: locked, undoStack: [] }, object)).toBeNull();
  });
});
