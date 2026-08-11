// setReliefParams — edit a ReliefObject's carve parameters (width / depth /
// source interpretation), the editor promised when H.5 roughing landed. Width edits
// rescale the natural bounds by the source aspect ratio (bounds are always
// (0,0)..(width, width·aspect)); the transform — and therefore the object's
// placement — is untouched.

import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import type { ReliefObject } from '../../core/scene';
import type { HeightfieldReliefObject, MeshReliefObject } from '../../core/scene/relief';

export type ReliefParamPatch = {
  targetWidthMm?: number;
  reliefDepthMm?: number;
  emptyCells?: 'floor' | 'top';
  polarity?: 'light-is-high' | 'light-is-deep';
};

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
          changed = true;
          const next = applyReliefPatch(obj, normalized);
          return { ...next, bounds: boundsForWidth(obj, next.targetWidthMm) };
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

function normalizeReliefPatch(patch: ReliefParamPatch): ReliefParamPatch {
  const out: ReliefParamPatch = {};
  if (positiveFinite(patch.targetWidthMm)) {
    out.targetWidthMm = patch.targetWidthMm;
  }
  if (positiveFinite(patch.reliefDepthMm)) {
    out.reliefDepthMm = patch.reliefDepthMm;
  }
  if (patch.emptyCells !== undefined) out.emptyCells = patch.emptyCells;
  if (patch.polarity !== undefined) out.polarity = patch.polarity;
  return out;
}

function hasReliefPatch(patch: ReliefParamPatch): boolean {
  return (
    patch.targetWidthMm !== undefined ||
    patch.reliefDepthMm !== undefined ||
    patch.emptyCells !== undefined ||
    patch.polarity !== undefined
  );
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
  return {
    ...relief,
    ...common,
    reliefSource: {
      ...relief.reliefSource,
      ...(patch.emptyCells === undefined ? {} : { emptyCells: patch.emptyCells }),
    },
  };
}

function applyHeightfieldReliefPatch(
  relief: HeightfieldReliefObject,
  common: Partial<Pick<ReliefObject, 'targetWidthMm' | 'reliefDepthMm'>>,
  patch: ReliefParamPatch,
): HeightfieldReliefObject {
  const nextWidthMm = patch.targetWidthMm ?? relief.targetWidthMm;
  const aspect = relief.reliefSource.physicalHeightMm / relief.reliefSource.physicalWidthMm;
  const nextDepthMm = patch.reliefDepthMm ?? relief.reliefDepthMm;
  const nextPolarity = patch.polarity ?? relief.reliefSource.mapping.polarity;
  const canonicalChanged =
    nextWidthMm !== relief.reliefSource.physicalWidthMm ||
    nextDepthMm !== relief.reliefSource.mapping.maxDepthMm ||
    nextPolarity !== relief.reliefSource.mapping.polarity;
  return {
    ...relief,
    ...common,
    reliefSource: {
      ...relief.reliefSource,
      physicalWidthMm: nextWidthMm,
      physicalHeightMm: nextWidthMm * aspect,
      mapping: {
        ...relief.reliefSource.mapping,
        ...(patch.reliefDepthMm === undefined ? {} : { maxDepthMm: patch.reliefDepthMm }),
        ...(patch.polarity === undefined ? {} : { polarity: patch.polarity }),
      },
      revision: relief.reliefSource.revision + (canonicalChanged ? 1 : 0),
    },
  };
}

function boundsForWidth(
  relief: { readonly bounds: { readonly maxX: number; readonly maxY: number } },
  widthMm: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  // Natural relief bounds start at (0,0); the Y extent follows the source
  // aspect ratio captured at import.
  const aspect = relief.bounds.maxX > 0 ? relief.bounds.maxY / relief.bounds.maxX : 1;
  return { minX: 0, minY: 0, maxX: widthMm, maxY: widthMm * aspect };
}

function positiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
