import { describe, expect, it } from 'vitest';

import { decodeQrModules } from '../../__fixtures__/barcode/qr-decoder';
import { sampleGrid } from '../../__fixtures__/barcode/sample-geometry';
import {
  createBarcodeObject,
  defaultBarcodeSpec,
  isBarcodeObject,
  type BarcodeObject,
  type BarcodeShape,
  type BarcodeSymbology,
} from '../../core/barcode';
import {
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import type { VariableTextRenderer } from '../../io/gcode/prepare-output-snapshot';
import { deriveVariableBarcodeDisplay, encodeWaiting } from './variable-barcode-display';

const NO_TEXT: VariableTextRenderer = async () => ({
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  paths: [],
});

async function projectWith(
  symbology: BarcodeSymbology,
  source: string,
  serialValue: number,
  extra: Partial<BarcodeObject> = {},
): Promise<Project> {
  const parsed = parseVariableTemplateSource(source);
  if (!parsed.ok) throw new Error(parsed.message);
  const spec: BarcodeShape = {
    ...defaultBarcodeSpec(symbology),
    data: source,
    variableTemplate: parsed.template,
  };
  const created = await createBarcodeObject({
    id: 'code',
    color: '#000000',
    spec,
    value: defaultBarcodeSpec(symbology).data,
    renderCaption: async () => ({ polylines: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }),
    transform: { ...IDENTITY_TRANSFORM, x: 40, y: 30, rotationDeg: 90 },
  });
  if (!created.ok) throw new Error(created.message);
  const base = createProject();
  return withSerial(
    {
      ...base,
      scene: { ...base.scene, objects: [{ ...created.object, ...extra } as SceneObject] },
    },
    serialValue,
  );
}

function withSerial(project: Project, serialValue: number): Project {
  const variables = { ...(project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA), serialValue };
  return { ...project, variables };
}

/** Derives, lets every waiting value encode, and derives again. */
async function settled(project: Project): Promise<Project> {
  const first = deriveVariableBarcodeDisplay(project);
  await encodeWaiting(first.waiting, project, NO_TEXT);
  const second = deriveVariableBarcodeDisplay(project);
  expect(second.waiting).toEqual([]);
  return second.project;
}

function scanQr(project: Project): string | null {
  const object = project.scene.objects.find(isBarcodeObject);
  if (object === undefined) return null;
  const { moduleMm, quietZoneModules } = object.spec;
  const size = Math.round(object.bounds.maxX / moduleMm) - 2 * quietZoneModules;
  const polylines = object.paths.flatMap((path) => path.polylines);
  const quiet = quietZoneModules * moduleMm;
  const decoded = decodeQrModules(
    sampleGrid(polylines, size, size, moduleMm, { x: quiet, y: quiet }),
    size,
  );
  return decoded.ok ? decoded.text : null;
}

describe('variable barcodes on the canvas', () => {
  it('passes a project without variable barcodes through untouched', async () => {
    const plain = await projectWith('qr', 'LOT-{{serial:3}}', 1);
    const object = plain.scene.objects[0] as BarcodeObject;
    const { variableTemplate: _template, ...fixedSpec } = object.spec;
    const fixed = {
      ...plain,
      scene: { ...plain.scene, objects: [{ ...object, spec: fixedSpec }] },
    };
    const display = deriveVariableBarcodeDisplay(fixed);
    expect(display.project).toBe(fixed);
    expect(display.waiting).toEqual([]);
  });

  it('draws the current value in place, keeping placement and bindings', async () => {
    const project = await projectWith('qr', 'LOT-{{serial:3}}', 7, { operationIds: ['fill-1'] });
    const shown = await settled(project);
    expect(scanQr(project)).toBe('https://example.com');
    expect(scanQr(shown)).toBe('LOT-007');
    const [before] = project.scene.objects;
    const [after] = shown.scene.objects;
    expect(after).toMatchObject({
      id: 'code',
      transform: before?.transform,
      operationIds: ['fill-1'],
    });
    // Nothing changed, so the canvas gets the same object and redraws nothing new.
    expect(deriveVariableBarcodeDisplay(project).project.scene.objects[0]).toBe(after);
  });

  it('carries path bindings onto the new code as output does', async () => {
    const project = await projectWith('qr', 'LOT-{{serial:3}}', 7);
    const object = project.scene.objects[0] as BarcodeObject;
    const bound = {
      ...project,
      scene: {
        ...project.scene,
        objects: [
          { ...object, paths: object.paths.map((path) => ({ ...path, operationIds: ['op'] })) },
        ],
      },
    };
    const shown = await settled(bound);
    const paths = (shown.scene.objects[0] as BarcodeObject).paths;
    expect(paths.every((path) => path.operationIds?.[0] === 'op')).toBe(true);
    expect(scanQr(shown)).toBe('LOT-007');
  });

  it('keeps the last value on screen while the next one encodes', async () => {
    const project = await projectWith('qr', 'LOT-{{serial:3}}', 7);
    await settled(project);
    const next = withSerial(project, 8);
    const pending = deriveVariableBarcodeDisplay(next);
    expect(pending.waiting).toHaveLength(1);
    expect(scanQr(pending.project)).toBe('LOT-007');
    expect(scanQr(await settled(next))).toBe('LOT-008');
  });

  it('keeps the stored code when the value cannot be encoded or evaluated', async () => {
    const ean = await projectWith('ean8', '{{serial:7}}', 1);
    expect((await settled(ean)).scene.objects[0]).not.toBe(ean.scene.objects[0]);
    // Nine digits do not fit EAN-8; output stops on this value with the reason.
    const tooLong = withSerial(ean, 123_456_789);
    expect((await settled(tooLong)).scene.objects[0]).toBe(tooLong.scene.objects[0]);

    const csv = await projectWith('qr', '{{csv:Name}}', 1);
    const display = deriveVariableBarcodeDisplay(csv);
    expect(display.project).toBe(csv);
    expect(display.waiting).toEqual([]);
  });
});
