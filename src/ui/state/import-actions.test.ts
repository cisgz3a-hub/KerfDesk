import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { imageImportActions } from './import-actions';
import type { MutationResult, StateSlice } from './scene-mutations';

function raster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'r1',
    source: 'test.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

// Drive imageImportActions with a capturing `set` so we can read the imported
// object's placement without a real store; `get` returns an empty scene so the
// fitAllObjects auto-zoom is a no-op (combinedBBox of [] is null).
function importAt(batchIdx: number | undefined): SceneObject {
  let captured: MutationResult | null = null;
  const set = (fn: (s: StateSlice) => MutationResult): void => {
    captured = fn({ project: createProject(), undoStack: [] });
  };
  const get = () => ({
    project: { device: { bedWidth: 400, bedHeight: 400 }, scene: { objects: [] } },
    selectedObjectId: null,
    additionalSelectedIds: new Set<string>(),
  });
  imageImportActions(set, get).importRasterImage(raster(), batchIdx);
  const objects = captured!.project.scene.objects;
  return objects[objects.length - 1]!;
}

describe('imageImportActions.importRasterImage stagger (M26 multi-image drop)', () => {
  it('staggers each image drop by 10 mm per batch index instead of stacking at center', () => {
    const first = importAt(0);
    const second = importAt(1);
    // F-A3: the Nth image is offset 10 mm × N right + down from the first.
    expect(second.transform.x - first.transform.x).toBeCloseTo(10, 6);
    expect(second.transform.y - first.transform.y).toBeCloseTo(10, 6);
  });

  it('treats a missing batch index as 0 (single import / toolbar picker)', () => {
    expect(importAt(undefined).transform).toEqual(importAt(0).transform);
  });
});
