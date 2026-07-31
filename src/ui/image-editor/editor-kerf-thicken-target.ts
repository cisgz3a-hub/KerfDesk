import type { SelectionMask } from '../../core/image-select';
import type { DeviceProfile } from '../../core/devices';
import type { Layer, RasterImage } from '../../core/scene';
import { editorHorizontalMaskRepair } from './editor-horizontal-mask-repair';
import type { RasterKerfGroupFacts } from './editor-kerf-output-parity';
import { editorRasterOutputMask, editorRasterSourceMask } from './editor-raster-source-mask';
import type { EditorSession } from './editor-session';
import type { RasterOutputLoss } from './raster-output-run-loss';

const FULL_TURN_DEG = 360;
const MAX_KERF_REPAIR_RADIUS_PX = 500;

/** Final active-layer selection for one reversible Thicken action. */
export type KerfThickenTarget = {
  readonly mask: SelectionMask;
};

/** Inputs required to derive one reversible editor-side Thicken target. */
export type EditorKerfThickenTargetInput = {
  readonly session: EditorSession;
  readonly object: RasterImage;
  readonly layer: Layer;
  readonly group: RasterKerfGroupFacts;
  readonly device: DeviceProfile;
  readonly removed: RasterOutputLoss;
};

/**
 * Map exact output loss to the active editor layer only when the mapping is
 * reversible and local. Complex composites and stateful dithers remain
 * warning-only instead of painting an unproven source target.
 */
export function editorKerfThickenTarget(
  input: EditorKerfThickenTargetInput,
): KerfThickenTarget | null {
  const { session, object, layer, group, device, removed } = input;
  if (!canMapEditorKerfThickenTarget(session, object, layer, group) || removed.mask === null) {
    return null;
  }

  const activeIndex = session.layers.findIndex(
    (candidate) => candidate.id === session.activeLayerId,
  );
  const alpha = editorRasterSourceMask({
    session,
    object,
    device,
    removed: removed.mask,
    activeIndex,
  });
  const mappedCount = alpha.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0);
  if (removed.pixels === 0 || mappedCount !== removed.pixels) return null;

  const pixelWidthMm = rasterPixelWidthMm(group);
  const radiusPx = thickenRadiusPx(group, pixelWidthMm);
  if (pixelWidthMm === null || radiusPx === null) return null;
  const repaired = editorHorizontalMaskRepair({
    seed: { width: session.doc.width, height: session.doc.height, alpha },
    radiusPx,
    minXWorldMm: group.bounds.minX,
    pixelWidthMm,
    dotWidthCorrectionMm: group.dotWidthCorrectionMm,
    sourceSValues: group.sValues,
    filledS: group.blackS,
    outputMaskFor: (sourceMask) => editorRasterOutputMask(sourceMask, object, device),
  });
  return repaired === null ? null : { mask: repaired };
}

/** True when output samples can map one-to-one onto the active editor grid. */
export function canMapEditorKerfThickenTarget(
  session: EditorSession,
  object: RasterImage,
  layer: Layer,
  group: RasterKerfGroupFacts,
): boolean {
  const activeIndex = session.layers.findIndex(
    (candidate) => candidate.id === session.activeLayerId,
  );
  return (
    isActiveLayerDirect(session, activeIndex) &&
    isTopmostVisibleLayer(session, activeIndex) &&
    isCompiledGridDirect(session, object, group) &&
    isOperationLocallyMappable(layer, object) &&
    hasIdentityLumaAdjustments(object)
  );
}

function isActiveLayerDirect(session: EditorSession, activeIndex: number): boolean {
  const active = session.layers[activeIndex];
  return (
    active !== undefined &&
    active.isVisible &&
    active.opacity === 1 &&
    active.blend === 'normal' &&
    active.buffer.width === session.doc.width &&
    active.buffer.height === session.doc.height
  );
}

function isTopmostVisibleLayer(session: EditorSession, activeIndex: number): boolean {
  return session.layers
    .slice(activeIndex + 1)
    .every((layer) => !layer.isVisible || layer.opacity <= 0);
}

function isCompiledGridDirect(
  session: EditorSession,
  object: RasterImage,
  group: RasterKerfGroupFacts,
): boolean {
  return (
    group.pixelWidth === session.doc.width &&
    group.pixelHeight === session.doc.height &&
    normalizedRotation(object.transform.rotationDeg) === 0 &&
    object.imageMaskId === undefined
  );
}

function isOperationLocallyMappable(layer: Layer, object: RasterImage): boolean {
  const effective = { ...layer, ...object.operationOverride };
  return !effective.negativeImage && isDeterministicBlackDither(effective.ditherAlgorithm);
}

function rasterPixelWidthMm(group: RasterKerfGroupFacts): number | null {
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  return Number.isFinite(pixelWidthMm) && pixelWidthMm > 0 ? pixelWidthMm : null;
}

function thickenRadiusPx(group: RasterKerfGroupFacts, pixelWidthMm: number | null): number | null {
  if (pixelWidthMm === null) return null;
  const radiusPx = Math.max(1, Math.floor((2 * group.dotWidthCorrectionMm) / pixelWidthMm));
  return radiusPx <= MAX_KERF_REPAIR_RADIUS_PX ? radiusPx : null;
}

function normalizedRotation(rotationDeg: number): number {
  return ((rotationDeg % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
}

function isDeterministicBlackDither(algorithm: Layer['ditherAlgorithm']): boolean {
  return algorithm === 'threshold' || algorithm === 'grayscale';
}

function hasIdentityLumaAdjustments(object: RasterImage): boolean {
  return (
    (object.brightness ?? 0) === 0 && (object.contrast ?? 0) === 0 && (object.gamma ?? 1) === 1
  );
}
