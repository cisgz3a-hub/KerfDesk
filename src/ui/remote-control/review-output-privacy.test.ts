import { beforeEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { createBarcodeObject, defaultBarcodeSpec, isBarcodeObject } from '../../core/barcode';
import { materializeVariableBarcode } from '../../io/gcode/materialize-variable-barcode';
import { compileDiagnosticWarnings } from '../laser/compile-diagnostic-warnings';
import { buildEffectiveOperationReview } from '../laser/job-review/job-review-effective-operations';
import { useStore } from '../state/store';
import { reviewMessageProjector } from './review-message-sharing';
import { reviewProjection } from './status-projections';
import type { RemoteControlOptions } from './types';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));
const options: RemoteControlOptions = {
  store: useStore,
  canWrite: () => false,
  canShareArtwork: () => false,
  getAppStatus: () => ({
    app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
    edition: { mode: 'free' },
    updates: { available: false },
  }),
};
const fallback = 'Review this artwork-specific warning in KerfDesk on the PC.';
function putScene(objects: readonly SceneObject[], name: string) {
  const project = createProject();
  const scene = {
    ...project.scene,
    objects,
    layers: [createLayer({ id: 'operation', color: '#000000', name })],
  };
  useStore.setState({ project: { ...project, scene } });
  return scene;
}

describe('actual output wording with artwork sharing disabled', () => {
  it('redacts every Image/source and Layer occurrence in the canonical rotary diagnostic', () => {
    const source = 'Private family portrait.png';
    const image: RasterImage = {
      kind: 'raster-image',
      id: 'image',
      source,
      pixelWidth: 1,
      pixelHeight: 1,
      color: '#000000',
      dither: 'floyd-steinberg',
      linesPerMm: 5,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
    };
    const scene = putScene([image], source);
    const job = compileJob(scene, useStore.getState().project.device);
    const warning = compileDiagnosticWarnings({
      ...job,
      diagnostics: [{ kind: 'image-scan-angle-rotary', source, layerName: source }],
    })[0]!;
    const projected = reviewMessageProjector(options)(warning, fallback);
    expect(projected).toBe(warning.replaceAll(`"${source}"`, '"artwork"'));
    expect(projected).not.toContain(source);
    const repeated = `${warning} Previously called ${source}.`;
    expect(reviewMessageProjector(options)(repeated, fallback)).toBe(fallback);
  });

  it('redacts a generated file stem even after the operation was renamed', () => {
    const rectangle = createRectangle({
      id: 'art',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 0 },
    });
    const source = 'PRIVATE FAMILY PORTRAIT.svg';
    const object: ImportedSvg = {
      kind: 'imported-svg',
      id: rectangle.id,
      source,
      bounds: rectangle.bounds,
      transform: rectangle.transform,
      paths: rectangle.paths,
    };
    const scene = putScene([object], 'Custom operation');
    const job = compileJob(scene, useStore.getState().project.device);
    const summaries = buildEffectiveOperationReview(job, scene).flatMap((item) => item.summaries);
    expect(summaries).not.toHaveLength(0);
    expect(summaries.join(' ')).toContain('PRIVATE FAMILY PORTRAIT');
    for (const summary of summaries)
      expect(reviewMessageProjector(options)(summary, fallback)).toBe(fallback);
  });

  it('keeps real evaluated CSV barcode failures PC-only without inspecting the dataset', async () => {
    const privateValue = 'PRIVATE FAMILY SECRET é';
    const spec = {
      ...defaultBarcodeSpec('code39'),
      data: '{{csv:recipient}}',
      showText: false,
      variableTemplate: { tokens: [{ kind: 'csv' as const, column: 'recipient' }] },
    };
    const created = await createBarcodeObject({
      id: 'barcode-1',
      color: '#000000',
      spec,
      value: 'PREVIEW',
      renderCaption: async () => {
        throw new Error('No caption is requested');
      },
    });
    if (!created.ok) throw new Error(created.message);
    if (!isBarcodeObject(created.object))
      throw new Error('Expected the actual barcode constructor');
    const project = {
      ...createProject(),
      variables: {
        ...DEFAULT_PROJECT_VARIABLE_DATA,
        csv: { sourceName: 'private.csv', headers: ['recipient'], records: [[privateValue]] },
      },
    };
    useStore.setState({
      project: { ...project, scene: { ...project.scene, objects: [created.object] } },
    });
    const result = await materializeVariableBarcode(
      created.object,
      project,
      { now: new Date('2026-10-04T00:00:00Z') },
      async () => {
        throw new Error('Encoding fails before captions');
      },
    );
    if (result.ok) throw new Error('Code39 should reject the unsupported character');
    expect(result.message).toContain(privateValue);
    const getReview: RemoteControlOptions['getReview'] = () => ({
      revision: 'r1',
      mode: 'laser',
      status: 'unavailable',
      warnings: [{ code: 'preparation-1', message: result.message }],
      frame: { required: true, complete: false },
    });
    const projected = await reviewProjection({ ...options, getReview }, 'r1', 'laser');
    expect(projected['warnings']).toEqual([{ code: 'preparation-1', message: fallback }]);
    const optedIn = await reviewProjection(
      { ...options, getReview, canShareArtwork: () => true },
      'r1',
      'laser',
    );
    expect(JSON.stringify(optedIn)).toContain(privateValue);
  });
});
