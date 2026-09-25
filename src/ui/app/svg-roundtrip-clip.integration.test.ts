import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageMaskPixelTest } from '../../core/raster/image-mask';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type RasterImage,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { exportSceneSvg } from '../../io/svg/export-scene-svg';
import { parseSvg } from '../../io/svg/parse-svg';
import { readSvgDocumentFromBlob } from '../../io/svg/parse-svg-blob';
import { parseSvgInWorker, parseSvgWorkerDocument } from '../../io/svg/parse-svg-worker';
import {
  documentWorkerRequests,
  installSvgImageTestEnvironment,
  pngWorkerRequests,
  resetSvgImageTestEnvironment,
} from '../import/svg-image-hydration.test-support';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { dispatchImportFilesInOrder } from './import-dispatch';
import { roundTripSource } from './svg-roundtrip.test-support';

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function clippedSource() {
  const source = roundTripSource();
  const original = source.scene.objects[1];
  if (original?.kind !== 'raster-image') throw new Error('Missing source raster');
  const mask: ImportedSvg = {
    kind: 'imported-svg',
    id: 'external-mask',
    source: 'external-mask.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: {
      ...IDENTITY_TRANSFORM,
      x: -80,
      y: 30,
      scaleX: 1.5,
      scaleY: 1.5,
      rotationDeg: -90,
      mirrorY: true,
    },
    paths: [{ color: '#000000', polylines: [rectangle(0, 0, 20, 20)] }],
  };
  const image: RasterImage = {
    ...original,
    imageMaskId: mask.id,
    imageClip: [
      {
        color: '#000000',
        fillRule: 'evenodd',
        polylines: [rectangle(-1, 5, 18, 8), rectangle(5, 7, 4, 4)],
      },
    ],
  };
  return {
    image,
    project: {
      ...source,
      scene: {
        ...source.scene,
        objects: [source.scene.objects[0]!, image, source.scene.objects[2]!, mask],
      },
    },
  };
}

// Independent oracle: local sample centres are (column - 1.5, row + 4.5).
// Intersect the owned [-1,17] x [5,13] rectangle minus its [5,9] x [7,11]
// hole with the external mask's world [-110,-80] x [0,30] rectangle.
// Source image world coordinates are:
// X = -80 - 2*cos(31deg)*x + .75*sin(31deg)*y
// Y =  35 - 2*sin(31deg)*x - .75*cos(31deg)*y.
const expectedRows = [
  '00000000000000000000',
  '00011111111111111110',
  '00011111111111111110',
  '00001110000111111110',
  '00001110000111111110',
  '00001110000111111110',
  '00001110000111111110',
  '00000111111111111110',
  '00000111111111111110',
  '00000000000000000000',
];

function expectLocalClip(image: RasterImage): void {
  expect(image.imageMaskId).toBeUndefined();
  expect(image.imageClip?.length).toBeGreaterThan(0);
  const contains = createImageMaskPixelTest(image, null, 20, 10);
  if (contains === null) throw new Error('Missing owned clip');
  const actualRows = Array.from({ length: 10 }, (_, row) =>
    Array.from({ length: 20 }, (_, column) => (contains(column, row) ? '1' : '0')).join(''),
  );
  expect(actualRows).toEqual(expectedRows);
}

function expectDecodedPixels(image: RasterImage, dataUrl: string | undefined): void {
  expect(image.dataUrl).toBe(dataUrl);
  expect(image.pixelWidth).toBe(8192);
  expect(image.pixelHeight).toBe(1);
  const luma = Buffer.from(image.lumaBase64 ?? '', 'base64');
  expect(luma).toHaveLength(8192);
  expect(luma.subarray(0, 4000).every((value) => value === 0)).toBe(true);
  expect(luma.subarray(-4000).every((value) => value === 255)).toBe(true);
}

describe('selected SVG raster round trip with owned and external clips', () => {
  beforeEach(() => {
    resetStore();
    installSvgImageTestEnvironment();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetSvgImageTestEnvironment();
  });

  it('imports one real raster with the independently expected clip and persists its pixels', async () => {
    const { image, project } = clippedSource();
    const exported = exportSceneSvg(project, [image.id]);
    if (exported.kind === 'error') throw new Error(exported.error);
    expect(exported.value.objectCount).toBe(1);
    const file = new File([exported.value.svg], 'clipped.svg', { type: 'image/svg+xml' });
    const before = useStore.getState().project;
    const calls = {
      getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
      importSvgObject: vi.fn(useStore.getState().importSvgObject),
      importSvgFragment: vi.fn(useStore.getState().importSvgFragment),
      importRasterImage: vi.fn(useStore.getState().importRasterImage),
      pushToast: vi.fn(),
    };
    await dispatchImportFilesInOrder([file], calls);
    expect(documentWorkerRequests).toHaveLength(1);
    expect(pngWorkerRequests).toHaveLength(1);
    expect(calls.importSvgFragment).toHaveBeenCalledOnce();
    expect(calls.importSvgObject).not.toHaveBeenCalled();
    expect(calls.importRasterImage).not.toHaveBeenCalled();
    expect(calls.pushToast.mock.calls.some(([, variant]) => variant === 'error')).toBe(false);
    const importedProject = useStore.getState().project;
    expect(importedProject.scene.objects).toHaveLength(1);
    expect(importedProject.scene.layers.map((layer) => layer.mode)).toEqual(['image']);
    expect(useStore.getState().undoStack).toEqual([before]);
    const imported = importedProject.scene.objects[0];
    if (imported?.kind !== 'raster-image') throw new Error('Missing imported raster');
    expect(imported.bounds).toEqual(image.bounds);
    expectDecodedPixels(imported, image.dataUrl);
    expectLocalClip(imported);

    // Browser text, worker text and worker stream retain the same local clip frame.
    const request = documentWorkerRequests[0];
    if (request?.kind !== 'svg') throw new Error('Missing SVG worker request');
    const identity = { id: request.objectId, source: request.source };
    const text = parseSvg({ svgText: exported.value.svg, ...identity });
    const workerText = parseSvgInWorker({ svgText: exported.value.svg, ...identity });
    const stream = parseSvgWorkerDocument(await readSvgDocumentFromBlob(file), identity);
    expect(text.fragment).toEqual(workerText.fragment);
    expect(text.fragment).toEqual(stream.fragment);
    expect(stream.fragment?.entries).toHaveLength(1);
    expect(stream.fragment?.entries[0]).toMatchObject({
      kind: 'svg-image',
      imageClip: imported.imageClip,
    });

    const restored = deserializeProject(serializeProject(importedProject));
    if (restored.kind !== 'ok') throw new Error('Could not restore clipped project');
    expect(restored.project.scene.objects).toHaveLength(1);
    expect(restored.project.scene.layers.map((layer) => layer.mode)).toEqual(['image']);
    const savedImage = restored.project.scene.objects[0];
    if (savedImage?.kind !== 'raster-image') throw new Error('Missing restored raster');
    expect(savedImage.imageClip).toEqual(imported.imageClip);
    expect(savedImage.lumaBase64).toBe(imported.lumaBase64);
    expectDecodedPixels(savedImage, image.dataUrl);
    expectLocalClip(savedImage);
  });
});
