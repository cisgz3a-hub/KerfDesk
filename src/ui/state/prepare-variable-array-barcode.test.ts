import { describe, expect, it } from 'vitest';

import { decodeQrModules } from '../../__fixtures__/barcode/qr-decoder';
import { sampleGrid } from '../../__fixtures__/barcode/sample-geometry';
import {
  createBarcodeObject,
  defaultBarcodeSpec,
  isBarcodeObject,
  type BarcodeObject,
  type BarcodeShape,
} from '../../core/barcode';
import { createLayer, createProject, DEFAULT_PROJECT_VARIABLE_DATA } from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import { materializeVariableText } from '../../io/gcode/prepare-output-snapshot';
import { applyArraySelection } from './array-actions';
import { prepareVariableArray } from './prepare-variable-array';
import type { AppState } from './store';
import { GRID, NOW, renderFixture } from './variable-array-test-fixture';

async function barcodeState(): Promise<AppState> {
  const parsed = parseVariableTemplateSource('SN-{{serial:4}}');
  if (!parsed.ok) throw new Error(parsed.message);
  const spec: BarcodeShape = {
    ...defaultBarcodeSpec('qr'),
    moduleMm: 0.5,
    data: 'SN-{{serial:4}}',
    variableTemplate: parsed.template,
  };
  const created = await createBarcodeObject({
    id: 'code',
    color: '#000000',
    spec,
    value: 'SN-0000',
    renderCaption: () => Promise.reject(new Error('QR Code has no text')),
  });
  if (!created.ok) throw new Error(created.message);
  return {
    project: {
      ...createProject(),
      variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, serialValue: 10 },
      scene: {
        objects: [{ ...created.object, operationIds: ['op'] }],
        layers: [createLayer({ id: 'op', color: '#000000', mode: 'fill' })],
      },
    },
    selectedObjectId: 'code',
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    projectDocumentEpoch: 1,
  } as unknown as AppState;
}

function decoded(barcode: BarcodeObject | undefined): unknown {
  if (barcode === undefined) return undefined;
  const size = barcode.bounds.maxX / 0.5 - 8;
  const polylines = barcode.paths.flatMap((path) => path.polylines);
  return decodeQrModules(sampleGrid(polylines, size, size, 0.5, { x: 2, y: 2 }), size);
}

describe('variable barcode arrays', () => {
  it('gives each copy its own serial, shows it, and keeps the template for output', async () => {
    const before = await barcodeState();
    const prepared = await prepareVariableArray(before, GRID, {
      render: renderFixture,
      clock: () => NOW,
    });
    if (!prepared.ok) throw new Error(prepared.message);
    let nextId = 0;
    const after = {
      ...before,
      ...applyArraySelection(before, GRID, () => `copy-${nextId++}`, prepared.materialized),
    } as AppState;
    const barcodes = after.project.scene.objects.filter(isBarcodeObject);
    expect(barcodes).toHaveLength(6);
    expect(barcodes.map((code) => code.spec.variableTemplate?.sequenceOffset ?? 0)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(barcodes.every((code) => code.spec.data === 'SN-{{serial:4}}')).toBe(true);
    expect(decoded(barcodes[3])).toMatchObject({ ok: true, text: 'SN-0013' });

    const output = await materializeVariableText(after.project, { now: NOW }, renderFixture);
    if (!output.ok) throw new Error(output.preflight.issues[0]?.message);
    expect(
      output.project.scene.objects.filter(isBarcodeObject).map((code) => code.spec.data),
    ).toEqual(['SN-0010', 'SN-0011', 'SN-0012', 'SN-0013', 'SN-0014', 'SN-0015']);
  });
});
