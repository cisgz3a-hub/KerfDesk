import type { ReliefObject } from '../../core/scene';
import type { HeightfieldReliefObject, MeshReliefObject } from '../../core/scene/relief';
import { positiveFloat64ProductQuotient } from '../positive-float64-rational';

export type ReliefMachineWidthResolution =
  | { readonly kind: 'stored-width'; readonly targetWidthMm: number }
  | { readonly kind: 'rebased'; readonly relief: ReliefObject };

/** Resolves a positive finite displayed Width without first losing it to native division. */
export function resolveReliefMachineWidth(
  relief: ReliefObject,
  machineWidthMm: number,
): ReliefMachineWidthResolution {
  const scaleX = planningScale(relief.transform.scaleX);
  const targetWidthMm = machineWidthMm / scaleX;
  if (positiveFinite(targetWidthMm)) return { kind: 'stored-width', targetWidthMm };
  return {
    kind: 'rebased',
    relief: isMeshRelief(relief)
      ? rebaseLegacyMesh(relief, machineWidthMm, scaleX)
      : rebaseHeightfield(relief, machineWidthMm, scaleX),
  };
}

function isMeshRelief(relief: ReliefObject): relief is MeshReliefObject {
  return relief.reliefSource.kind === 'legacy-mesh';
}

function rebaseHeightfield(
  relief: HeightfieldReliefObject,
  machineWidthMm: number,
  previousScaleX: number,
): HeightfieldReliefObject {
  const source = relief.reliefSource;
  const preservedHeightMm = resolvedHeight(
    machineWidthMm,
    source.physicalHeightMm,
    source.physicalWidthMm,
    previousScaleX,
  );
  const keepsAspect = source.mapping.aspect === 'preserve' && positiveFinite(preservedHeightMm);
  const physicalHeightMm = keepsAspect ? preservedHeightMm : source.physicalHeightMm;
  return {
    ...relief,
    targetWidthMm: machineWidthMm,
    bounds: { minX: 0, minY: 0, maxX: machineWidthMm, maxY: physicalHeightMm },
    transform: { ...relief.transform, scaleX: unitScaleWithSign(relief.transform.scaleX) },
    reliefSource: {
      ...source,
      physicalWidthMm: machineWidthMm,
      physicalHeightMm,
      mapping: { ...source.mapping, aspect: keepsAspect ? 'preserve' : 'stretch' },
      revision: source.revision + 1,
    },
  };
}

function rebaseLegacyMesh(
  relief: MeshReliefObject,
  machineWidthMm: number,
  previousScaleX: number,
): MeshReliefObject {
  const source = relief.reliefSource;
  const currentBoundsWidth = relief.bounds.maxX - relief.bounds.minX;
  const currentBoundsHeight = relief.bounds.maxY - relief.bounds.minY;
  const targetHeightMm = resolvedHeight(
    machineWidthMm,
    relief.targetHeightMm,
    relief.targetWidthMm,
    previousScaleX,
  );
  const boundsHeightMm = resolvedHeight(
    machineWidthMm,
    currentBoundsHeight,
    currentBoundsWidth,
    previousScaleX,
  );
  const keepsAspect =
    relief.widthAspect === 'preserve' &&
    positiveFinite(targetHeightMm) &&
    positiveFinite(boundsHeightMm);
  return {
    ...relief,
    targetWidthMm: machineWidthMm,
    targetHeightMm: keepsAspect ? targetHeightMm : relief.targetHeightMm,
    widthAspect: keepsAspect ? 'preserve' : 'stretch',
    bounds: {
      minX: 0,
      minY: 0,
      maxX: machineWidthMm,
      maxY: keepsAspect ? boundsHeightMm : currentBoundsHeight,
    },
    transform: { ...relief.transform, scaleX: unitScaleWithSign(relief.transform.scaleX) },
    reliefSource: source,
  };
}

function resolvedHeight(
  requestedMachineWidthMm: number,
  currentHeightMm: number,
  currentWidthMm: number,
  currentScaleX: number,
): number {
  return positiveFloat64ProductQuotient(
    [requestedMachineWidthMm, currentHeightMm],
    [currentWidthMm, currentScaleX],
  );
}

function planningScale(scale: number): number {
  return Number.isFinite(scale) && scale !== 0 ? Math.abs(scale) : 1;
}

function unitScaleWithSign(scale: number): number {
  return scale < 0 ? -1 : 1;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
