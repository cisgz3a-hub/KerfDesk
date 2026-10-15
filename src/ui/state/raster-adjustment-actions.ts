import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import { layerFromSubLayer, updateLayer, type Layer, type RasterImage } from '../../core/scene';
import { operationOverrideForObject } from '../../core/effective-output';
import type { ObjectOperationSettingsOverride } from '../../core/scene/scene-object';

export type RasterImageAdjustmentPatch = {
  brightness?: number;
  contrast?: number;
  gamma?: number;
};

export type RasterImageAdjustmentOperation = {
  readonly id: string;
  readonly patch: Pick<
    Layer,
    | 'ditherAlgorithm'
    | 'minPower'
    | 'linesPerMm'
    | 'dotWidthCorrectionMm'
    | 'negativeImage'
    | 'passThrough'
  >;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function rasterAdjustmentActions(
  set: Setter,
  operationSet: Setter = set,
): Pick<AppState, 'setRasterImageAdjustments'> {
  return {
    setRasterImageAdjustments: (id, patch, operation) =>
      (operation === undefined ? set : operationSet)((s) => {
        const layer = s.project.scene.layers.find((candidate) => candidate.id === operation?.id);
        if (operation !== undefined && layer === undefined) return s;
        let changed = false;
        let imageOwnsOperation = false;
        const normalized = normalizeAdjustmentPatch(patch);
        const objects = s.project.scene.objects.map((obj) => {
          if (obj.id !== id || obj.kind !== 'raster-image') return obj;
          changed = true;
          const image = { ...obj, ...normalized };
          imageOwnsOperation =
            layer !== undefined && operationOverrideForObject(layer, obj) !== undefined;
          return imageOwnsOperation && layer !== undefined && operation !== undefined
            ? withImageOperation(image, layer, operation.patch)
            : image;
        });
        if (!changed) return s;
        const scene = { ...s.project.scene, objects };
        return {
          project: {
            ...s.project,
            scene:
              operation === undefined || imageOwnsOperation
                ? scene
                : updateLayer(scene, operation.id, operation.patch),
          },
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}

function withImageOperation(
  image: RasterImage,
  layer: Layer,
  patch: RasterImageAdjustmentOperation['patch'],
): RasterImage {
  const byOperation: Record<string, ObjectOperationSettingsOverride | null> = {
    ...image.operationOverride?.byOperation,
  };
  // Editing a photo's primary operation must not change inherited sub-passes.
  for (const subLayer of layer.subLayers) {
    const child = layerFromSubLayer(layer, subLayer);
    if (!Object.hasOwn(byOperation, child.id))
      byOperation[child.id] = operationOverrideForObject(child, image) ?? null;
  }
  byOperation[layer.id] = { ...operationOverrideForObject(layer, image), ...patch };
  return { ...image, operationOverride: { ...image.operationOverride, byOperation } };
}

function normalizeAdjustmentPatch(patch: RasterImageAdjustmentPatch): RasterImageAdjustmentPatch {
  const out: RasterImageAdjustmentPatch = {};
  if (patch.brightness !== undefined) out.brightness = clamp(patch.brightness, -100, 100);
  if (patch.contrast !== undefined) out.contrast = clamp(patch.contrast, -100, 100);
  if (patch.gamma !== undefined) out.gamma = clamp(patch.gamma, 0.1, 5);
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
