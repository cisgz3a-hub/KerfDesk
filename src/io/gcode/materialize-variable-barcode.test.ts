import { describe, expect, it, vi } from 'vitest';

import { readCode128 } from '../../__fixtures__/barcode/linear-decoders';
import { decodeQrModules } from '../../__fixtures__/barcode/qr-decoder';
import { sampleGrid, sampleScanLine } from '../../__fixtures__/barcode/sample-geometry';
import {
  BARCODE_CAPTION_FONT_KEY,
  createBarcodeObject,
  defaultBarcodeSpec,
  type BarcodeShape,
} from '../../core/barcode';
import {
  addLayer,
  addObject,
  createArtworkOperation,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import { exportSceneSvg } from '../svg/export-scene-svg';
import {
  materializeVariableText,
  prepareOutputSnapshot,
  type VariableTextRenderer,
} from './prepare-output-snapshot';

const NOW = new Date('2026-09-24T08:00:00.000Z');

// Boxes stand in for glyphs; only the barcode's own geometry is decoded.
const renderer: VariableTextRenderer = async ({ text, content }) => ({
  bounds: { minX: 0, minY: 0, maxX: content.length, maxY: 1 },
  paths: [
    {
      color: text.color,
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: content.length, y: 0 },
            { x: content.length, y: 1 },
            { x: 0, y: 1 },
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
});

function variableSpec(base: BarcodeShape, source: string, sequenceOffset?: number): BarcodeShape {
  const parsed = parseVariableTemplateSource(source);
  if (!parsed.ok) throw new Error(parsed.message);
  const template =
    sequenceOffset === undefined ? parsed.template : { ...parsed.template, sequenceOffset };
  return { ...base, data: source, variableTemplate: template };
}

async function barcodeProject(spec: BarcodeShape, preview = 'PREVIEW'): Promise<Project> {
  const created = await createBarcodeObject({
    id: 'B1',
    color: '#000000',
    spec,
    value: spec.variableTemplate === undefined ? spec.data : preview,
    renderCaption: async () => ({
      polylines: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    }),
    transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 },
  });
  if (!created.ok) throw new Error(created.message);
  const project = createProject();
  const bound = createArtworkOperation(project.scene, created.object, { mode: 'fill' });
  return {
    ...project,
    variables: { ...DEFAULT_PROJECT_VARIABLE_DATA, serialValue: 41 },
    scene: addLayer(addObject(project.scene, bound.object), bound.operation),
  };
}

async function materialized(project: Project): Promise<SceneObject> {
  const result = await materializeVariableText(project, { now: NOW, serialValue: 41 }, renderer);
  if (!result.ok) throw new Error(result.preflight.issues[0]?.message);
  const object = result.project.scene.objects[0];
  if (object === undefined) throw new Error('barcode missing');
  return object;
}

function polylinesOf(object: SceneObject): readonly Polyline[] {
  return 'paths' in object ? object.paths.flatMap((path) => path.polylines) : [];
}

describe('variable barcodes at output', () => {
  it('re-encodes the copy value and keeps placement and operation binding', async () => {
    const qr = { ...defaultBarcodeSpec('qr'), moduleMm: 0.5 };
    const project = await barcodeProject(variableSpec(qr, 'SN-{{serial:6}}'));
    const source = project.scene.objects[0];
    const object = await materialized(project);
    expect(object.kind === 'shape' && object.spec).toMatchObject({
      kind: 'barcode',
      data: 'SN-000041',
    });
    expect(
      object.kind === 'shape' && object.spec.kind === 'barcode' && object.spec.variableTemplate,
    ).toBe(undefined);
    expect(object.transform).toEqual(source?.transform);
    expect(object.operationIds).toEqual(source?.operationIds);
    const size = object.bounds.maxX / 0.5 - 8;
    const grid = sampleGrid(polylinesOf(object), size, size, 0.5, { x: 2, y: 2 });
    expect(decodeQrModules(grid, size)).toMatchObject({ ok: true, text: 'SN-000041' });
  });

  it('advances array copies by their sequence offset', async () => {
    const qr = { ...defaultBarcodeSpec('qr'), moduleMm: 0.5 };
    const object = await materialized(await barcodeProject(variableSpec(qr, 'SN-{{serial:6}}', 2)));
    expect(object.kind === 'shape' && object.spec.kind === 'barcode' && object.spec.data).toBe(
      'SN-000043',
    );
  });

  it('draws 1D text with the bundled font through the text renderer', async () => {
    const render = vi.fn(renderer);
    const code128 = { ...defaultBarcodeSpec('code128'), moduleMm: 0.25 };
    const project = await barcodeProject(variableSpec(code128, 'LOT-{{serial:3}}'));
    const result = await materializeVariableText(project, { now: NOW, serialValue: 41 }, render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0]).toMatchObject({
      content: 'LOT-041',
      text: { fontKey: BARCODE_CAPTION_FONT_KEY, alignment: 'center' },
    });
    const object = result.ok ? result.project.scene.objects[0] : undefined;
    if (object === undefined) throw new Error('barcode missing');
    const modules = Math.round(object.bounds.maxX / 0.25) - 20;
    const line = sampleScanLine(
      polylinesOf(object),
      modules,
      0.25,
      2.5,
      0.5 + code128.barHeightMm / 2,
    );
    expect(readCode128(line)).toBe('LOT-041');
  });

  it('fails the output instead of engraving a code for the wrong value', async () => {
    const project = await barcodeProject(
      variableSpec(defaultBarcodeSpec('ean13'), '{{serial:3}}'),
      '5901234123457',
    );
    const result = await prepareOutputSnapshot(project, {
      clock: () => NOW,
      renderVariableText: renderer,
    });
    expect(result).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'variable-evaluation-failed' }] },
    });
    const message = result.ok ? '' : (result.preflight.issues[0]?.message ?? '');
    expect(message).toContain('Barcode B1 cannot encode "041"');
  });

  it('prepares a job from a variable barcode on a fill operation', async () => {
    const project = await barcodeProject(variableSpec(defaultBarcodeSpec('qr'), '{{serial:4}}'));
    const result = await prepareOutputSnapshot(project, {
      clock: () => NOW,
      renderVariableText: renderer,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.job.groups).not.toHaveLength(0);
  });

  it('passes fixed barcodes through untouched and exports them as even-odd SVG', async () => {
    const project = await barcodeProject(defaultBarcodeSpec('data-matrix'));
    const object = await materialized(project);
    expect(object).toBe(project.scene.objects[0]);
    const svg = exportSceneSvg(project);
    expect(svg).toMatchObject({ kind: 'ok' });
    if (svg.kind === 'ok') {
      expect(svg.value.svg).toContain('<title>barcode</title>');
      expect(svg.value.svg).toContain('fill-rule="evenodd"');
    }
  });
});
