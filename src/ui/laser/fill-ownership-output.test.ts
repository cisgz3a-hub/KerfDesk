import * as clipper from 'clipper2-ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFillReviewState,
  prepareReview,
  resetFillReviewState,
  reviewModel,
} from '../../__fixtures__/fill-omission-review';
import {
  topologyArtwork,
  topologyProject,
  topologyRectangle,
  topologyDevice,
} from '../../__fixtures__/topology-archive';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { createRegistrationLayer } from '../../core/scene/registration-layer';
import { createRegistrationBox } from '../../core/shapes';
import { registrationJigCopyId } from '../../core/scene/registration-jig-artwork';
import { compileJob } from '../../core/job/compile-job';
import { prepareOutput } from '../../io/gcode';
import { compileDiagnosticWarnings } from './compile-diagnostic-warnings';
import { prepareOutputRequest } from './output-preparation';

type ClipperModule = typeof clipper;

vi.mock('clipper2-ts', async (importOriginal) => {
  const actual = await importOriginal<ClipperModule>();
  return { ...actual, booleanOpDWithPolyTree: vi.fn(actual.booleanOpDWithPolyTree) };
});
const actualClipper = await vi.importActual<ClipperModule>('clipper2-ts');
beforeEach(() => {
  vi.mocked(clipper.booleanOpDWithPolyTree)
    .mockReset()
    .mockImplementation(actualClipper.booleanOpDWithPolyTree);
  resetFillReviewState();
});
afterEach(() => {
  vi.restoreAllMocks();
  clearFillReviewState();
});
function failEngine(): void {
  vi.mocked(clipper.booleanOpDWithPolyTree).mockImplementation(() => {
    throw new Error('Injected checked Clipper failure');
  });
}
function fillObject(id: string, x: number, size = 10): ImportedSvg {
  return topologyArtwork(id, x, size);
}
function failureProject(): Project {
  const layer = {
    ...createLayer({ id: 'cut', name: 'Engrave', color: '#000000', mode: 'fill' }),
    hatchSpacingMm: 2,
    power: 80,
  };
  const a = fillObject('a', 10),
    b = { ...fillObject('b', 30), powerScale: 50 };
  const open = {
    ...fillObject('open-only', 60),
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 60, y: 10 },
              { x: 70, y: 10 },
            ],
          },
        ],
      },
    ],
  };
  const line = {
    ...fillObject('line-control', 100),
    operationOverride: { byOperation: { cut: { mode: 'line' as const, power: 10 } } },
  };
  const other = {
    ...fillObject('other-fill', 130),
    operationIds: ['other'],
    paths: [{ color: '#ff0000', polylines: [topologyRectangle(130, 10, 10)] }],
  };
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'image-control',
    source: 'tiny.png',
    color: '#111111',
    operationIds: ['image'],
    dataUrl: 'data:image/png;base64,source',
    lumaBase64: 'AP//AA==',
    pixelWidth: 2,
    pixelHeight: 2,
    dither: 'threshold',
    linesPerMm: 1,
    bounds: { minX: 160, minY: 10, maxX: 162, maxY: 12 },
    transform: IDENTITY_TRANSFORM,
  };
  const project = topologyProject(
    [a, b, open, line, other],
    [
      layer,
      createLayer({ id: 'other', color: '#ff0000', mode: 'fill' }),
      {
        ...createLayer({ id: 'image', color: '#111111', mode: 'image' }),
        linesPerMm: 1,
        fillOverscanMm: 0,
      },
    ],
  );
  return { ...project, scene: { ...project.scene, objects: [...project.scene.objects, image] } };
}
function jigScene(firstEmpty = false) {
  const layer = {
    ...createLayer({ id: 'cut', name: 'Repeated engrave', color: '#000000', mode: 'fill' }),
    hatchSpacingMm: 2,
    power: 80,
  };
  const a = fillObject('a', 10, 30),
    b = { ...fillObject('b', firstEmpty ? 10 : 20, firstEmpty ? 30 : 10), powerScale: 50 };
  const copies = [a, b].map((o) => ({
    ...o,
    id: registrationJigCopyId(o.id, 'box-b'),
    transform: { ...o.transform, x: 80 },
    ...(o.id === 'b'
      ? { paths: [{ color: '#000000', polylines: [topologyRectangle(20, 10, 10)] }] }
      : {}),
  }));
  return {
    layers: [{ ...createRegistrationLayer(), output: false }, layer],
    objects: [
      createRegistrationBox({ id: 'box-a', widthMm: 60, heightMm: 60 }),
      createRegistrationBox({ id: 'box-b', widthMm: 60, heightMm: 60, x: 80 }),
      a,
      b,
      ...copies,
    ],
  };
}

describe('checked Fill ownership omissions stay factual and advisory', () => {
  it('discloses closed contributors while preserving independent Line, image and operation output', () => {
    failEngine();
    const project = failureProject(),
      job = compileJob(project.scene, project.device);
    expect(job.diagnostics).toEqual([
      expect.objectContaining({
        kind: 'fill-ownership-failed',
        layerId: 'cut',
        layerName: 'Engrave',
        objectIds: ['a', 'b'],
        count: 2,
      }),
    ]);
    expect(job.groups.filter((g) => g.kind === 'fill' && g.layerId === 'cut')).toEqual([]);
    expect(job.groups.some((g) => g.kind === 'cut' && g.layerId === 'cut' && g.power === 10)).toBe(
      true,
    );
    expect(
      job.groups.some((g) => g.kind === 'raster' && g.sourceObjectId === 'image-control'),
    ).toBe(true);
    expect(job.groups.some((g) => g.kind === 'fill' && g.layerId === 'other')).toBe(true);
    const warnings = compileDiagnosticWarnings(job);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/2 artwork objects.*Engrave/);
    expect(warnings[0]).toMatch(/missing.*Fill|Fill.*missing/);
    expect(warnings[0]).toMatch(/preview/);
    expect(warnings[0]).not.toMatch(/vector:|open-only|line-control|\[a, b\]/);
  });
  it('fresh preparation, framed review and Save retain the same omission without a new refusal', async () => {
    failEngine();
    const project = failureProject(),
      prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('Partial valid output did not prepare');
    expect(prepared.job.diagnostics?.[0]?.kind).toBe('fill-ownership-failed');
    const bundle = await prepareReview(project),
      model = reviewModel(bundle);
    expect(model.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/2 artwork objects.*Engrave/)]),
    );
    expect(bundle.prepared.gcode).toMatch(/^G1 /m);
    const saved = await prepareOutputRequest({ kind: 'save', project, options: {} });
    expect(saved.kind).toBe('save');
    if (saved.kind !== 'save' || saved.result.kind !== 'emitted')
      throw new Error('Advisory omission refused Save');
    expect(saved.result.gcode).toMatch(/^G1 /m);
    expect(saved.result.machineWarnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/2 artwork objects.*Engrave/)]),
    );
  });
  it('a checked failure in one jig cannot pool its identity or artwork with the later valid run', () => {
    vi.mocked(clipper.booleanOpDWithPolyTree).mockImplementationOnce(() => {
      throw new Error('First jig only');
    });
    const job = compileJob(jigScene(), topologyDevice),
      failure = job.diagnostics?.find((d) => d.kind === 'fill-ownership-failed');
    expect(failure?.kind).toBe('fill-ownership-failed');
    if (failure?.kind !== 'fill-ownership-failed') throw new Error('Missing first jig failure');
    expect(failure.objectIds).toEqual(['a', 'b']);
    const later = job.groups.filter((g) => g.kind === 'fill');
    expect(later.length).toBeGreaterThan(0);
    expect(
      later.every(
        (g) =>
          g.kind === 'fill' &&
          g.topologyScope !== failure.runScope &&
          g.sourceObjectId === registrationJigCopyId('a', 'box-b'),
      ),
    ).toBe(true);
  });
  it('a successful empty XOR jig is distinct from a checked engine failure and leaves the next jig material', () => {
    const spy = vi.mocked(clipper.booleanOpDWithPolyTree);
    const job = compileJob(jigScene(true), topologyDevice);
    expect(spy).toHaveBeenCalled();
    expect(job.diagnostics).toBeUndefined();
    const groups = job.groups.filter((g) => g.kind === 'fill');
    expect(groups.length).toBeGreaterThan(0);
    expect(
      groups.every(
        (g) =>
          g.kind === 'fill' &&
          g.topologyScope === 'vector:1:cut' &&
          g.sourceObjectId === registrationJigCopyId('a', 'box-b'),
      ),
    ).toBe(true);
  });
});
