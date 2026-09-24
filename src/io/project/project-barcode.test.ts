import { describe, expect, it } from 'vitest';

import {
  createBarcodeObject,
  defaultBarcodeSpec,
  type BarcodeShape,
  type BarcodeSymbology,
} from '../../core/barcode';
import { addObject, createProject, type Project } from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const SYMBOLOGIES: readonly BarcodeSymbology[] = [
  'qr',
  'data-matrix',
  'code128',
  'code39',
  'ean13',
  'upca',
  'ean8',
];

async function projectWith(spec: BarcodeShape): Promise<Project> {
  const created = await createBarcodeObject({
    id: 'B1',
    color: '#000000',
    spec,
    value: spec.data,
    renderCaption: async ({ text }) => ({
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: text.length, y: 0 },
            { x: text.length, y: 2 },
            { x: 0, y: 0 },
          ],
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: text.length, maxY: 2 },
    }),
  });
  if (!created.ok) throw new Error(created.message);
  const base = createProject();
  return { ...base, scene: addObject(base.scene, created.object) };
}

function withSpecField(project: Project, field: string, value: unknown): string {
  const raw = JSON.parse(serializeProject(project)) as {
    scene: { objects: Array<{ spec: Record<string, unknown> }> };
  };
  const object = raw.scene.objects[0];
  if (object === undefined) throw new Error('barcode missing');
  object.spec[field] = value;
  return JSON.stringify(raw);
}

describe('barcode project IO', () => {
  it.each(SYMBOLOGIES)('round-trips a %s barcode with its spec and outlines', async (symbology) => {
    const original = await projectWith({ ...defaultBarcodeSpec(symbology), invert: true });
    const result = deserializeProject(serializeProject(original));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(serializeProject(result.project)).toBe(serializeProject(original));
    }
  });

  it('round-trips variable data as its template', async () => {
    const parsed = parseVariableTemplateSource('SN-{{serial:6}}');
    if (!parsed.ok) throw new Error(parsed.message);
    const spec: BarcodeShape = {
      ...defaultBarcodeSpec('qr'),
      data: 'SN-{{serial:6}}',
      variableTemplate: { ...parsed.template, sequenceOffset: 3 },
    };
    const original = await projectWith(spec);
    const result = deserializeProject(serializeProject(original));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.scene.objects[0]).toMatchObject({ spec });
    }
  });

  it.each([
    ['symbology', 'pdf417'],
    ['data', 'x'.repeat(8_001)],
    ['errorCorrection', 'X'],
    ['sizeMode', 'height'],
    ['moduleMm', 0],
    ['widthMm', Number.POSITIVE_INFINITY],
    ['barHeightMm', -1],
    ['quietZoneModules', 2.5],
    ['invert', 'yes'],
    ['showText', undefined],
    ['variableTemplate', { tokens: [{ kind: 'unknown' }] }],
  ])('rejects a barcode with an invalid %s', async (field, value) => {
    const text = withSpecField(await projectWith(defaultBarcodeSpec('qr')), field, value);
    const result = deserializeProject(text);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain(`scene.objects[0].spec.${field}`);
    }
  });
});
