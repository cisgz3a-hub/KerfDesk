// setReliefParams — edit a ReliefObject's carve parameters (width / depth /
// source interpretation), the editor promised when H.5 roughing landed. Width edits
// rescale the natural bounds by the source aspect ratio (bounds are always
// (0,0)..(width, width·aspect)); the transform — and therefore the object's
// placement — is untouched.

import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import type { ReliefObject } from '../../core/scene';
import type {
  HeightfieldReliefObject,
  MeshReliefObject,
  ReliefHeightfieldMapping,
} from '../../core/scene/relief';

export type ReliefParamPatch = {
  targetWidthMm?: number;
  reliefDepthMm?: number;
  emptyCells?: 'floor' | 'top';
  polarity?: 'light-is-high' | 'light-is-deep';
  gamma?: number;
  outsideMask?: ReliefHeightfieldMapping['outsideMask'];
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
          if (isNoOpHeightfieldMappingPatch(obj, normalized)) return obj;
          changed = true;
          const next = applyReliefPatch(obj, normalized);
          const bounds =
            normalized.targetWidthMm === undefined
              ? obj.bounds
              : boundsForWidth(obj, next.targetWidthMm);
          return { ...next, bounds };
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
  if (positiveFinite(patch.gamma)) out.gamma = patch.gamma;
  if (isOutsideMask(patch.outsideMask)) out.outsideMask = patch.outsideMask;
  return out;
}

function hasReliefPatch(patch: ReliefParamPatch): boolean {
  return (
    patch.targetWidthMm !== undefined ||
    patch.reliefDepthMm !== undefined ||
    patch.emptyCells !== undefined ||
    patch.polarity !== undefined ||
    patch.gamma !== undefined ||
    patch.outsideMask !== undefined
  );
}

function isNoOpHeightfieldMappingPatch(relief: ReliefObject, patch: ReliefParamPatch): boolean {
  const isGammaOrOutsideOnly =
    (patch.gamma !== undefined || patch.outsideMask !== undefined) &&
    patch.targetWidthMm === undefined &&
    patch.reliefDepthMm === undefined &&
    patch.emptyCells === undefined &&
    patch.polarity === undefined;
  if (!isGammaOrOutsideOnly) return false;
  if (isMeshRelief(relief)) return true;
  const gammaUnchanged =
    patch.gamma === undefined || relief.reliefSource.mapping.curve.gamma === patch.gamma;
  const outsideMaskUnchanged =
    patch.outsideMask === undefined ||
    relief.reliefSource.mapping.outsideMask === patch.outsideMask;
  return gammaUnchanged && outsideMaskUnchanged;
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
  const canonicalChanged =
    widthPatchChangesSource(relief, patch.targetWidthMm) ||
    mappingPatchChangesSource(relief, patch);
  return {
    ...relief,
    ...common,
    reliefSource: {
      ...relief.reliefSource,
      ...physicalDimensionsForWidth(relief, patch.targetWidthMm),
      mapping: {
        ...relief.reliefSource.mapping,
        ...(patch.reliefDepthMm === undefined ? {} : { maxDepthMm: patch.reliefDepthMm }),
        ...(patch.polarity === undefined ? {} : { polarity: patch.polarity }),
        ...(patch.gamma === undefined
          ? {}
          : { curve: { ...relief.reliefSource.mapping.curve, gamma: patch.gamma } }),
        ...(patch.outsideMask === undefined ? {} : { outsideMask: patch.outsideMask }),
      },
      revision: relief.reliefSource.revision + (canonicalChanged ? 1 : 0),
    },
  };
}

function mappingPatchChangesSource(
  relief: HeightfieldReliefObject,
  patch: ReliefParamPatch,
): boolean {
  const mapping = relief.reliefSource.mapping;
  const nextDepthMm = patch.reliefDepthMm ?? relief.reliefDepthMm;
  const nextPolarity = patch.polarity ?? mapping.polarity;
  const nextGamma = patch.gamma ?? mapping.curve.gamma;
  const nextOutsideMask = patch.outsideMask ?? mapping.outsideMask;
  return (
    nextDepthMm !== mapping.maxDepthMm ||
    nextPolarity !== mapping.polarity ||
    nextGamma !== mapping.curve.gamma ||
    nextOutsideMask !== mapping.outsideMask
  );
}

function widthPatchChangesSource(
  relief: HeightfieldReliefObject,
  widthMm: number | undefined,
): boolean {
  return widthMm !== undefined && widthMm !== relief.reliefSource.physicalWidthMm;
}

function physicalDimensionsForWidth(
  relief: HeightfieldReliefObject,
  widthMm: number | undefined,
): Partial<Pick<HeightfieldReliefObject['reliefSource'], 'physicalWidthMm' | 'physicalHeightMm'>> {
  if (widthMm === undefined) return {};
  const aspect = relief.reliefSource.physicalHeightMm / relief.reliefSource.physicalWidthMm;
  return { physicalWidthMm: widthMm, physicalHeightMm: widthMm * aspect };
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

function isOutsideMask(value: unknown): value is ReliefHeightfieldMapping['outsideMask'] {
  return value === 'excluded' || value === 'stock-top' || value === 'relief-floor';
}
