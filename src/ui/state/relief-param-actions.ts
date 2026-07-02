// setReliefParams — edit a ReliefObject's carve parameters (width / depth /
// background), the editor promised when H.5 roughing landed. Width edits
// rescale the natural bounds by the mesh aspect ratio (bounds are always
// (0,0)..(width, width·aspect)); the transform — and therefore the object's
// placement — is untouched.

import type { AppState } from './store';
import { pushUndo } from './scene-mutations';

const MAX_BED_DIMENSION_MM = 1500;
const MIN_RELIEF_WIDTH_MM = 1;
const MIN_RELIEF_DEPTH_MM = 0.1;
const MAX_RELIEF_DEPTH_MM = 200;

export type ReliefParamPatch = {
  targetWidthMm?: number;
  reliefDepthMm?: number;
  emptyCells?: 'floor' | 'top';
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function reliefParamActions(set: Setter): Pick<AppState, 'setReliefParams'> {
  return {
    setReliefParams: (id, patch) =>
      set((s) => {
        let changed = false;
        const objects = s.project.scene.objects.map((obj) => {
          if (obj.id !== id || obj.kind !== 'relief') return obj;
          changed = true;
          const next = { ...obj, ...normalizeReliefPatch(patch) };
          return { ...next, bounds: boundsForWidth(obj, next.targetWidthMm) };
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

function normalizeReliefPatch(patch: ReliefParamPatch): ReliefParamPatch {
  const out: ReliefParamPatch = {};
  if (patch.targetWidthMm !== undefined) {
    out.targetWidthMm = clamp(patch.targetWidthMm, MIN_RELIEF_WIDTH_MM, MAX_BED_DIMENSION_MM);
  }
  if (patch.reliefDepthMm !== undefined) {
    out.reliefDepthMm = clamp(patch.reliefDepthMm, MIN_RELIEF_DEPTH_MM, MAX_RELIEF_DEPTH_MM);
  }
  if (patch.emptyCells !== undefined) out.emptyCells = patch.emptyCells;
  return out;
}

function boundsForWidth(
  relief: { readonly bounds: { readonly maxX: number; readonly maxY: number } },
  widthMm: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  // Natural relief bounds start at (0,0); the Y extent follows the mesh
  // aspect ratio captured at import.
  const aspect = relief.bounds.maxX > 0 ? relief.bounds.maxY / relief.bounds.maxX : 1;
  return { minX: 0, minY: 0, maxX: widthMm, maxY: widthMm * aspect };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
