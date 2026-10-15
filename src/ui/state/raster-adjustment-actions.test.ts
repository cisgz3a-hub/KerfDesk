import { beforeEach, describe, expect, it } from 'vitest';
import { effectiveOperationForObject } from '../../core/effective-output';
import {
  createLayer,
  createLayerSubLayer,
  createProject,
  IDENTITY_TRANSFORM,
  layerFromSubLayer,
  type RasterImage,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

describe('Adjust Image operation ownership', () => {
  beforeEach(resetStore);

  it.each(['scoped', 'legacy'] as const)(
    'updates %s image settings without changing shared artwork or inherited sub-passes',
    (scope) => {
      const base = createLayer({ id: 'photo', color: '#808080', mode: 'image' });
      const operation = {
        ...base,
        subLayers: [createLayerSubLayer(base, { id: 'second', label: 'Second pass' })],
      };
      const previous = { ditherAlgorithm: 'jarvis' as const, linesPerMm: 5, speed: 900 };
      const otherOperation = createLayer({ id: 'other', color: '#000000', mode: 'line' });
      const otherSettings = { speed: 300, power: 15 };
      const image: RasterImage = {
        kind: 'raster-image',
        id: 'image',
        source: 'image.png',
        dataUrl: '',
        pixelWidth: 1,
        pixelHeight: 1,
        lumaBase64: 'gA==',
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        transform: IDENTITY_TRANSFORM,
        color: '#808080',
        dither: 'threshold',
        linesPerMm: 10,
        operationIds: [operation.id, otherOperation.id],
        operationOverride:
          scope === 'scoped'
            ? { byOperation: { photo: previous, other: otherSettings } }
            : previous,
      };
      const sibling = { ...image, id: 'sibling' };
      const project = {
        ...createProject(),
        scene: { objects: [image, sibling], layers: [operation, otherOperation] },
      };
      useStore.setState({ project, selectedObjectId: image.id });
      const child = layerFromSubLayer(operation, operation.subLayers[0]!);
      const childBefore = effectiveOperationForObject(child, image);
      useStore.getState().setRasterImageAdjustments(
        image.id,
        { brightness: 17 },
        {
          id: operation.id,
          patch: {
            ditherAlgorithm: 'stucki',
            linesPerMm: 12,
            minPower: 7,
            dotWidthCorrectionMm: 0.02,
            negativeImage: true,
            passThrough: false,
          },
        },
      );
      const applied = useStore.getState().project.scene;
      const updated = applied.objects[0]!;
      expect(effectiveOperationForObject(operation, updated)).toMatchObject({
        ditherAlgorithm: 'stucki',
        linesPerMm: 12,
        minPower: 7,
        speed: 900,
      });
      expect(effectiveOperationForObject(child, updated)).toEqual(childBefore);
      expect(effectiveOperationForObject(otherOperation, updated)).toEqual(
        effectiveOperationForObject(otherOperation, image),
      );
      expect(applied.layers).toBe(project.scene.layers);
      expect(applied.objects[1]).toBe(sibling);
      expect(updated).toMatchObject({ brightness: 17 });
      expect(useStore.getState().undoStack).toEqual([project]);
      useStore.getState().undo();
      expect(useStore.getState().project.scene).toEqual(project.scene);
      useStore.getState().redo();
      expect(useStore.getState().project.scene).toEqual(applied);
    },
  );
});
