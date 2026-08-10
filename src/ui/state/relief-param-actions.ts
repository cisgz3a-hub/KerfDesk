// setReliefParams — edit a ReliefObject's carve parameters (width / depth /
// source interpretation), the editor promised when H.5 roughing landed. Width edits
// keep canonical heightfield bounds synchronized with their resolved physical
// dimensions; legacy meshes retain stored natural-bounds aspect and intrinsic
// mesh CAM. When an exact common factor exists, either representation re-expresses
// local dimensions and scale together while keeping every transformed corner unchanged.

import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import type { ReliefObject } from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import {
  applyHeightfieldReliefPatch,
  hasReliefPatch,
  isNoOpHeightfieldMappingPatch,
  normalizeReliefPatch,
  type ReliefParamPatch,
} from './relief-heightfield-param-patch';
import { factorReliefHeightfieldWidth } from './relief-heightfield-width-factorization';
import { factorReliefLegacyWidth } from './relief-legacy-width-factorization';
import { reliefWidthBounds } from './relief-width-bounds';

export type { ReliefParamPatch } from './relief-heightfield-param-patch';

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function reliefParamActions(set: Setter): Pick<AppState, 'setReliefParams'> {
  return {
    setReliefParams: (id, patch) => {
      const normalized = normalizeReliefPatch(patch);
      if (!hasReliefPatch(normalized)) return;
      set((s) => {
        let changed = false;
        const objects = s.project.scene.objects.map((obj) => {
          if (obj.id !== id || obj.kind !== 'relief') return obj;
          if (isNoOpHeightfieldMappingPatch(obj, normalized)) return obj;
          changed = true;
          const next = applyReliefPatch(obj, normalized);
          if (normalized.targetWidthMm === undefined) return next;
          const resized = { ...next, bounds: reliefWidthBounds(obj, next) };
          return isMeshRelief(resized)
            ? factorReliefLegacyWidth(resized).relief
            : factorReliefHeightfieldWidth(resized).relief;
        });
        if (!changed) return s;
        return {
          project: { ...s.project, scene: { ...s.project.scene, objects } },
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      });
    },
  };
}

function applyReliefPatch(relief: ReliefObject, patch: ReliefParamPatch): ReliefObject {
  const common: Partial<Pick<ReliefObject, 'targetWidthMm' | 'reliefDepthMm'>> = {
    ...(patch.targetWidthMm === undefined ? {} : { targetWidthMm: patch.targetWidthMm }),
    ...(patch.reliefDepthMm === undefined ? {} : { reliefDepthMm: patch.reliefDepthMm }),
  };
  if (isMeshRelief(relief)) {
    return applyMeshReliefPatch(relief, common, patch);
  }
  return applyHeightfieldReliefPatch(relief, common, patch);
}

function isMeshRelief(relief: ReliefObject): relief is MeshReliefObject {
  return relief.reliefSource.kind === 'legacy-mesh';
}

function applyMeshReliefPatch(
  relief: MeshReliefObject,
  common: Partial<Pick<ReliefObject, 'targetWidthMm' | 'reliefDepthMm'>>,
  patch: ReliefParamPatch,
): MeshReliefObject {
  const emptyCells = patch.emptyCells;
  return {
    ...relief,
    ...common,
    ...(emptyCells === undefined || emptyCells === relief.reliefSource.emptyCells
      ? {}
      : { reliefSource: { ...relief.reliefSource, emptyCells } }),
  };
}
