import { describe, expect, it } from 'vitest';

import { defaultBarcodeSpec, type BarcodeShape, type BarcodeSymbology } from '../../core/barcode';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type ShapeObject,
} from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import { detectDataMatrixScanWarnings } from './data-matrix-scan-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

// 1305 letters need 1305 codewords, one more than 132 x 132 holds.
const NEEDS_144 = 'Z'.repeat(1305);
const ADVICE =
  '144 × 144 Data Matrix codes may not scan in common readers, so test-scan one before a run.';

/** The spec and binding a prepared project holds; the detector reads no geometry. */
function code(
  id: string,
  data: string,
  options: { readonly symbology?: BarcodeSymbology; readonly spec?: Partial<BarcodeShape> } = {},
): ShapeObject {
  return {
    kind: 'shape',
    id,
    spec: { ...defaultBarcodeSpec(options.symbology ?? 'data-matrix'), data, ...options.spec },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    operationIds: ['fill'],
  };
}

function projectWith(objects: ShapeObject[], output = true): Project {
  const base = createProject();
  const fill = { ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }), output };
  return { ...base, scene: { ...base.scene, objects, layers: [fill] } };
}

describe('Data Matrix codes output builds at 144 x 144', () => {
  it('names the code, including one saved at that size by an earlier build', () => {
    expect(detectDataMatrixScanWarnings(projectWith([code('plate', NEEDS_144)]))).toEqual([
      `Barcode plate is a 144 × 144 Data Matrix. ${ADVICE}`,
    ]);
  });

  it('groups several codes into one warning', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const five = projectWith(ids.map((id) => code(id, NEEDS_144)));
    expect(detectDataMatrixScanWarnings(five)).toEqual([
      `Barcodes a, b, c, d and 1 more are 144 × 144 Data Matrix codes. ${ADVICE}`,
    ]);
    const two = projectWith(['a', 'b'].map((id) => code(id, NEEDS_144)));
    expect(detectDataMatrixScanWarnings(two)).toEqual([
      `Barcodes a and b are 144 × 144 Data Matrix codes. ${ADVICE}`,
    ]);
  });

  it('stays quiet for codes that fit 132 x 132, other types and unused operations', () => {
    expect(detectDataMatrixScanWarnings(projectWith([code('small', 'Z'.repeat(1304))]))).toEqual(
      [],
    );
    const qr = code('qr', NEEDS_144, { symbology: 'qr' });
    expect(detectDataMatrixScanWarnings(projectWith([qr]))).toEqual([]);
    expect(detectDataMatrixScanWarnings(projectWith([code('off', NEEDS_144)], false))).toEqual([]);
  });

  it('skips a code whose template output has not evaluated, as it engraves its stored code', () => {
    const parsed = parseVariableTemplateSource(`${NEEDS_144}{{serial:4}}`);
    if (!parsed.ok) throw new Error(parsed.message);
    const variable = code('serial', `${NEEDS_144}{{serial:4}}`, {
      spec: { variableTemplate: parsed.template },
    });
    expect(detectDataMatrixScanWarnings(projectWith([variable]))).toEqual([]);
  });

  it('reaches Save G-code and Job Review through the shared warning selector', () => {
    expect(detectMachineJobWarnings(projectWith([code('plate', NEEDS_144)]))).toContain(
      `Barcode plate is a 144 × 144 Data Matrix. ${ADVICE}`,
    );
  });
});
