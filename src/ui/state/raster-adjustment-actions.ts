import type { AppState } from './store';
import { pushUndo } from './scene-mutations';

export type RasterImageAdjustmentPatch = {
  brightness?: number;
  contrast?: number;
  gamma?: number;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function rasterAdjustmentActions(set: Setter): Pick<AppState, 'setRasterImageAdjustments'> {
  return {
    setRasterImageAdjustments: (id, patch) =>
      set((s) => {
        let changed = false;
        const normalized = normalizeAdjustmentPatch(patch);
        const objects = s.project.scene.objects.map((obj) => {
          if (obj.id !== id || obj.kind !== 'raster-image') return obj;
          changed = true;
          return { ...obj, ...normalized };
        });
        if (!changed) return s;
        return {
          project: { ...s.project, scene: { ...s.project.scene, objects } },
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
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
