import type { ReliefObject } from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import {
  applyHeightfieldReliefPatch,
  hasReliefPatch,
  type ReliefParamPatch,
} from './relief-heightfield-param-patch';
import { factorReliefHeightfieldWidth } from './relief-heightfield-width-factorization';
import { factorReliefLegacyWidth } from './relief-legacy-width-factorization';
import { resolveReliefMachineWidth } from './relief-machine-width-resolution';
import { reliefWidthBounds } from './relief-width-bounds';

/** Applies one normalized parameter patch to a relief without store/history side effects. */
export function applyReliefParamPatch(relief: ReliefObject, patch: ReliefParamPatch): ReliefObject {
  const machineWidth = patch.machineWidthMm;
  const resolution =
    machineWidth === undefined ? undefined : resolveReliefMachineWidth(relief, machineWidth);
  if (resolution?.kind === 'rebased') {
    return factorResolvedWidth(applyNonWidthPatch(resolution.relief, patch));
  }
  const targetWidthMm =
    resolution?.kind === 'stored-width' ? resolution.targetWidthMm : patch.targetWidthMm;
  const next = applyStoredPatch(relief, withStoredWidth(patch, targetWidthMm));
  if (targetWidthMm === undefined) return next;
  return factorResolvedWidth({ ...next, bounds: reliefWidthBounds(relief, next) });
}

function withStoredWidth(
  patch: ReliefParamPatch,
  targetWidthMm: number | undefined,
): ReliefParamPatch {
  const { machineWidthMm: _machineWidthMm, ...withoutMachineWidth } = patch;
  return {
    ...withoutMachineWidth,
    ...(targetWidthMm === undefined ? {} : { targetWidthMm }),
  };
}

function applyNonWidthPatch(relief: ReliefObject, patch: ReliefParamPatch): ReliefObject {
  const { machineWidthMm: _machineWidthMm, targetWidthMm: _targetWidthMm, ...other } = patch;
  return hasReliefPatch(other) ? applyStoredPatch(relief, other) : relief;
}

function applyStoredPatch(relief: ReliefObject, patch: ReliefParamPatch): ReliefObject {
  const common: Partial<Pick<ReliefObject, 'targetWidthMm' | 'reliefDepthMm'>> = {
    ...(patch.targetWidthMm === undefined ? {} : { targetWidthMm: patch.targetWidthMm }),
    ...(patch.reliefDepthMm === undefined ? {} : { reliefDepthMm: patch.reliefDepthMm }),
  };
  return isMeshRelief(relief)
    ? applyMeshPatch(relief, common, patch)
    : applyHeightfieldReliefPatch(relief, common, patch);
}

function applyMeshPatch(
  relief: MeshReliefObject,
  common: Partial<Pick<ReliefObject, 'targetWidthMm' | 'reliefDepthMm'>>,
  patch: ReliefParamPatch,
): MeshReliefObject {
  const emptyCells = patch.emptyCells;
  const targetHeight = resolvedLegacyTargetHeight(relief, patch.targetWidthMm);
  const sourceChanged = emptyCells !== undefined && emptyCells !== relief.reliefSource.emptyCells;
  return {
    ...relief,
    ...common,
    ...(targetHeight === undefined
      ? {}
      : { targetHeightMm: targetHeight.heightMm, widthAspect: targetHeight.aspect }),
    ...(sourceChanged
      ? { reliefSource: { ...relief.reliefSource, emptyCells } }
      : { reliefSource: relief.reliefSource }),
  };
}

function resolvedLegacyTargetHeight(
  relief: MeshReliefObject,
  targetWidthMm: number | undefined,
): { readonly heightMm: number; readonly aspect: 'preserve' | 'stretch' } | undefined {
  if (targetWidthMm === undefined) return undefined;
  const source = relief.reliefSource;
  if (relief.widthAspect === 'stretch' || source.intrinsicBounds.kind !== 'finite-float32-v1') {
    return { heightMm: relief.targetHeightMm, aspect: 'stretch' };
  }
  const bounds = source.intrinsicBounds;
  const xExtent = bounds.maxX - bounds.minX;
  const yExtent = bounds.maxY - bounds.minY;
  const heightMm = (yExtent / xExtent) * targetWidthMm;
  return positiveFinite(heightMm)
    ? { heightMm, aspect: 'preserve' }
    : { heightMm: relief.targetHeightMm, aspect: 'stretch' };
}

function factorResolvedWidth(relief: ReliefObject): ReliefObject {
  return isMeshRelief(relief)
    ? factorReliefLegacyWidth(relief).relief
    : factorReliefHeightfieldWidth(relief).relief;
}

function isMeshRelief(relief: ReliefObject): relief is MeshReliefObject {
  return relief.reliefSource.kind === 'legacy-mesh';
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
