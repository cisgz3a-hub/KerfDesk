import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTransform, createLayer, type RasterImage } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import {
  installSvgImageTestEnvironment,
  resetSvgImageTestEnvironment,
  documentWorkerRequests,
  pngWorkerRequests,
} from '../import/svg-image-hydration.test-support';
import * as hydration from '../import/svg-image-hydration';
import { parseSvg } from '../../io/svg';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { dispatchImportFilesInOrder } from './import-dispatch';
import { importSvgFiles } from './svg-import-action';
import { roundTripFile, roundTripSource } from './svg-roundtrip.test-support';

function actions() {
  return {
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    importSvgObject: vi.fn(useStore.getState().importSvgObject),
    importSvgFragment: vi.fn(useStore.getState().importSvgFragment),
    importRasterImage: vi.fn(useStore.getState().importRasterImage),
    pushToast: vi.fn(),
  };
}

describe('composed SVG through real parsing, PNG hydration and the store', () => {
  beforeEach(() => {
    resetStore();
    installSvgImageTestEnvironment();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetSvgImageTestEnvironment();
  });

  it('inserts ordered vectors and a real bitmap at shared physical scale in one undo step', async () => {
    const source = roundTripSource();
    const before = useStore.getState().project;
    const calls = actions();
    await dispatchImportFilesInOrder([roundTripFile(source)], calls);
    expect(documentWorkerRequests).toHaveLength(1);
    expect(pngWorkerRequests).toHaveLength(1);
    expect(calls.importSvgFragment).toHaveBeenCalledOnce();
    expect(calls.importSvgObject).not.toHaveBeenCalled();
    expect(calls.importRasterImage).not.toHaveBeenCalled();
    const after = useStore.getState();
    expect(after.project.scene.objects.map((object) => object.kind)).toEqual([
      'imported-svg',
      'raster-image',
      'imported-svg',
    ]);
    expect(after.project.scene.layers.map((layer) => layer.mode)).toEqual([
      'fill',
      'image',
      'line',
    ]);
    expect(after.undoStack).toEqual([before]);
    expect(after.additionalSelectedIds.size).toBe(2);
    const back = after.project.scene.objects[0];
    const imported = after.project.scene.objects[1];
    const original = source.scene.objects[1];
    expect(back?.transform.scaleX).toBe(1); // 1100 mm artwork exceeds the bed, deliberately unshrunk.
    if (
      imported?.kind !== 'raster-image' ||
      original?.kind !== 'raster-image' ||
      back === undefined
    )
      throw new Error('Missing raster');
    expect(imported.dataUrl).toBe(original.dataUrl);
    expect(imported.pixelWidth).toBe(8192);
    const luma = Buffer.from(imported.lumaBase64 ?? '', 'base64');
    expect(luma.length).toBe(8192);
    expect(luma[0]).toBe(0);
    expect(luma.at(-1)).toBe(255);
    for (const point of [
      { x: -2, y: 4 },
      { x: 18, y: 4 },
      { x: 18, y: 14 },
      { x: -2, y: 14 },
    ]) {
      const sourcePoint = applyTransform(point, original.transform);
      const importedPoint = applyTransform(point, imported.transform);
      expect(importedPoint.x - sourcePoint.x).toBeCloseTo(back.transform.x, 9);
      expect(importedPoint.y - sourcePoint.y).toBeCloseTo(back.transform.y, 9);
    }
    const serialized = serializeProject(after.project);
    expect(deserializeProject(serialized).kind).toBe('ok');
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(after.project);
  });

  it('uses one batch offset for the complete file, including all its images', async () => {
    const calls = actions();
    await dispatchImportFilesInOrder([roundTripFile(), roundTripFile()], calls);
    const objects = useStore.getState().project.scene.objects;
    expect(objects).toHaveLength(6);
    for (let index = 0; index < 3; index += 1) {
      expect(
        (objects[index + 3]?.transform.x ?? NaN) - (objects[index]?.transform.x ?? NaN),
      ).toBeCloseTo(10);
      expect(
        (objects[index + 3]?.transform.y ?? NaN) - (objects[index]?.transform.y ?? NaN),
      ).toBeCloseTo(10);
    }
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it('hydrates multiple overlapping images while preserving their interleaved vector order', async () => {
    const source = roundTripSource();
    const original = source.scene.objects[1];
    if (original?.kind !== 'raster-image') throw Error('Missing source image');
    const second = {
      ...original,
      id: 'second',
      transform: { ...original.transform, x: original.transform.x + 5 },
    };
    await dispatchImportFilesInOrder(
      [
        roundTripFile({
          ...source,
          scene: { ...source.scene, objects: [...source.scene.objects, second] },
        }),
      ],
      actions(),
    );
    const objects = useStore.getState().project.scene.objects;
    expect(objects.map((object) => object.kind)).toEqual([
      'imported-svg',
      'raster-image',
      'imported-svg',
      'raster-image',
    ]);
    expect(pngWorkerRequests).toHaveLength(2);
    expect((objects[3]?.transform.x ?? NaN) - (objects[1]?.transform.x ?? NaN)).toBeCloseTo(5);
    expect(objects[3]?.transform.y).toBeCloseTo(objects[1]?.transform.y ?? NaN);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('does not consume placement or history when actual store insertion exceeds its layer capacity', async () => {
    const initial = useStore.getState().project;
    useStore.setState({
      project: {
        ...initial,
        scene: {
          ...initial.scene,
          layers: Array.from({ length: 254 }, (_, index) =>
            createLayer({
              id: 'existing-' + index,
              color: '#' + index.toString(16).padStart(6, '0'),
            }),
          ),
        },
      },
    });
    const source = roundTripSource();
    const raster = source.scene.objects[1];
    if (raster === undefined) throw Error('Missing fixture');
    const imageOnly = { ...source, scene: { ...source.scene, objects: [raster] } };
    const calls = actions();
    await dispatchImportFilesInOrder([roundTripFile(source), roundTripFile(imageOnly)], calls);
    expect(calls.importSvgFragment.mock.calls.map(([, index]) => index)).toEqual([0, 0]);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(calls.pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/count 257 exceeds 256/),
      'error',
    );
  });

  it('does not insert any vectors or images if a later bitmap fails real decoding', async () => {
    const source = roundTripSource();
    const original = source.scene.objects[1];
    if (original?.kind !== 'raster-image') throw new Error('Missing fixture');
    const corrupt: RasterImage = {
      ...original,
      id: 'corrupt',
      dataUrl: original.dataUrl?.replace(/.$/, 'A') ?? '',
    };
    // A truncated, dimension-qualified PNG starts decoding but cannot complete.
    const bytes = Buffer.from((original.dataUrl ?? '').split(',')[1] ?? '', 'base64');
    const broken = {
      ...corrupt,
      dataUrl: 'data:image/png;base64,' + bytes.subarray(0, bytes.length - 16).toString('base64'),
    };
    const calls = actions();
    await dispatchImportFilesInOrder(
      [
        roundTripFile({
          ...source,
          scene: { ...source.scene, objects: [...source.scene.objects, broken] },
        }),
      ],
      calls,
    );
    expect(calls.importSvgFragment).not.toHaveBeenCalled();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(calls.pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/could not import/i),
      'error',
    );
  });

  it.each(['document replacement', 'cancellation'] as const)(
    'rolls back a prepared composition after %s',
    async (event) => {
      const original = hydration.prepareSvgFragment;
      const rollback = vi.fn<() => Promise<void>>();
      vi.spyOn(hydration, 'prepareSvgFragment').mockImplementation(async (...args) => {
        const prepared = await original(...args);
        rollback.mockImplementation(prepared.rollback);
        if (event === 'document replacement') useStore.getState().newProject();
        else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return { ...prepared, rollback };
      });
      const calls = actions();
      await dispatchImportFilesInOrder([roundTripFile()], calls);
      expect(rollback).toHaveBeenCalledOnce();
      expect(calls.importSvgFragment).not.toHaveBeenCalled();
      expect(useStore.getState().project.scene.objects).toHaveLength(0);
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(calls.pushToast.mock.calls.some(([, variant]) => variant === 'success')).toBe(false);
    },
  );

  it('uses the same hydrated fragment on the text fallback and refuses singular sinks', async () => {
    const file = roundTripFile();
    const text = await file.text();
    const calls = actions();
    await importSvgFiles(
      [{ name: file.name, text: async () => text }],
      calls.importSvgObject,
      calls.pushToast,
      { importFragment: calls.importSvgFragment },
    );
    expect(calls.importSvgFragment).toHaveBeenCalledOnce();
    const count = useStore.getState().project.scene.objects.length;
    await importSvgFiles(
      [{ name: file.name, text: async () => text }],
      calls.importSvgObject,
      calls.pushToast,
    );
    expect(calls.importSvgObject).not.toHaveBeenCalled();
    expect(useStore.getState().project.scene.objects).toHaveLength(count);
    expect(calls.pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/cannot accept composed SVG/i),
      'error',
    );
  });

  it('replaces every owned component together and preserves placement and undo', async () => {
    await dispatchImportFilesInOrder([roundTripFile()], actions());
    const previous = useStore.getState().project;
    const target = previous.scene.objects[1];
    if (target === undefined) throw new Error('Missing target');
    const parsed = parseSvg({
      svgText: await roundTripFile().text(),
      id: 'replacement',
      source: 'composed.svg',
    });
    if (parsed.fragment === undefined) throw new Error('Missing fragment');
    const prepared = await hydration.prepareSvgFragment(parsed.fragment);
    const outcome = useStore
      .getState()
      .reimportSvgFragment(target.id, { ...parsed.fragment, objects: prepared.objects });
    prepared.commit();
    expect(outcome?.kind).toBe('replaced');
    const after = useStore.getState().project;
    expect(after.scene.objects).toHaveLength(3);
    expect(after.scene.objects.map((object) => object.id)).toEqual(
      previous.scene.objects.map((object) => object.id),
    );
    after.scene.objects.forEach((object, index) => {
      expect(object.transform.x).toBeCloseTo(previous.scene.objects[index]?.transform.x ?? NaN, 9);
      expect(object.transform.y).toBeCloseTo(previous.scene.objects[index]?.transform.y ?? NaN, 9);
    });
    expect(after.scene.layers).toEqual(previous.scene.layers);
    expect(deserializeProject(serializeProject(after)).kind).toBe('ok');
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(previous);
  });
});
