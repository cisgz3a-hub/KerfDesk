import {
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
  operationOverrideForObject,
} from '../../core/effective-output';
import {
  DITHER_ALGORITHMS,
  layerFromSubLayer,
  sceneObjectHasVisibleLayer,
  sceneObjectUsesOperation,
  type Layer,
  type RasterImage,
} from '../../core/scene';
import {
  DEFAULT_SHARPEN_RADIUS,
  SHARPEN_AMOUNT_MAX,
  SHARPEN_RADIUS_MAX,
  SHARPEN_RADIUS_MIN,
} from '../../core/raster/luma-sharpen';
import {
  activePhotoToneCurve,
  IDENTITY_PHOTO_TONE_CURVE,
  isPhotoToneCurve,
  photoToneCurvesEqual,
  type PhotoToneCurve,
} from '../../core/raster/photo-tone-curve';
import type { ObjectOperationSettingsOverride } from '../../core/scene/scene-object';
import type { AppState } from '../state/store';
import { pushUndo } from '../state/undo-stack';

export type PhotoEngravingOwner = {
  readonly projectDocumentEpoch: number;
  readonly image: RasterImage;
  /** The actual scene layer, before resolving this image's overrides. */
  readonly operation: Layer;
};

export type PhotoEngravingApply = {
  readonly imagePatch: {
    readonly brightness: number;
    readonly contrast: number;
    readonly gamma: number;
    /** ADR-671; omitted keeps the photo's own sharpening, 0 turns it off. */
    readonly sharpenAmount?: number;
    readonly sharpenRadius?: number;
  };
  readonly layerPatch: Pick<
    Layer,
    'ditherAlgorithm' | 'linesPerMm' | 'negativeImage' | 'passThrough' | 'photoToneCurve'
  > & {
    /** ADR-711: the burn power and speed a test card's square ran; omitted
     * keeps the operation's own. They are set together or not at all. */
    readonly power?: number;
    readonly speed?: number;
  };
};

/** A delayed preview or Apply never acquires a replacement document, image or operation. */
export function photoEngravingOwnerIsCurrent(state: AppState, owner: PhotoEngravingOwner): boolean {
  const { scene } = state.project;
  return (
    (state.project.machine?.kind ?? 'laser') === 'laser' &&
    state.projectDocumentEpoch === owner.projectDocumentEpoch &&
    state.selectedObjectId === owner.image.id &&
    state.additionalSelectedIds.size === 0 &&
    photoEngravingReferencesMatch(state, owner) &&
    owner.image.locked !== true &&
    sceneObjectHasVisibleLayer(scene, owner.image) &&
    sceneObjectUsesOperation(owner.image, owner.operation)
  );
}

function photoEngravingReferencesMatch(state: AppState, owner: PhotoEngravingOwner): boolean {
  const { scene } = state.project;
  const images = scene.objects.filter((object) => object.id === owner.image.id);
  const operations = scene.layers.filter((operation) => operation.id === owner.operation.id);
  return (
    images.length === 1 &&
    images[0] === owner.image &&
    operations.length === 1 &&
    operations[0] === owner.operation
  );
}

/** The exact non-destructive image revision used by both preview and Apply. */
export function photoEngravingImage(
  image: RasterImage,
  operation: Layer,
  patch: PhotoEngravingApply,
): RasterImage {
  if (!photoEngravingPatchIsValid(patch) || matchesCurrentSettings(image, operation, patch))
    return image;
  const byOperation: Record<string, ObjectOperationSettingsOverride | null> = {
    ...image.operationOverride?.byOperation,
  };
  // A parent override normally flows into its sub-operations. Keep each
  // existing sub-pass's settings when editing only this photo operation.
  for (const subLayer of operation.subLayers) {
    const child = layerFromSubLayer(operation, subLayer);
    if (!Object.hasOwn(byOperation, child.id))
      byOperation[child.id] = operationOverrideForObject(child, image) ?? null;
  }
  const { photoToneCurve: _previousCurve, ...override } =
    operationOverrideForObject(operation, image) ?? {};
  byOperation[operation.id] = {
    ...override,
    mode: 'image',
    ditherAlgorithm: patch.layerPatch.ditherAlgorithm,
    linesPerMm: patch.layerPatch.linesPerMm,
    negativeImage: patch.layerPatch.negativeImage,
    passThrough: patch.layerPatch.passThrough,
    ...photoToneCurveOverride(operation, patch.layerPatch.photoToneCurve),
    ...testedBurnOverride(patch.layerPatch),
  };
  return {
    ...withTestedPower(withSharpening(image, patch.imagePatch), patch.layerPatch),
    brightness: patch.imagePatch.brightness,
    contrast: patch.imagePatch.contrast,
    gamma: patch.imagePatch.gamma,
    operationOverride: { ...image.operationOverride, byOperation },
  };
}

// Sharpening off leaves no fields behind, so the photo compiles exactly as one
// that was never sharpened.
function withSharpening(image: RasterImage, patch: PhotoEngravingApply['imagePatch']): RasterImage {
  if (patch.sharpenAmount === undefined) return image;
  const { sharpenAmount: _amount, sharpenRadius: _radius, ...unsharpened } = image;
  if (patch.sharpenAmount === 0) return unsharpened;
  return {
    ...unsharpened,
    sharpenAmount: patch.sharpenAmount,
    sharpenRadius: patch.sharpenRadius ?? image.sharpenRadius ?? DEFAULT_SHARPEN_RADIUS,
  };
}

// ADR-711: the picked square's power and speed, for this photo alone.
function testedBurnOverride(
  patch: PhotoEngravingApply['layerPatch'],
): Pick<ObjectOperationSettingsOverride, 'power' | 'speed'> {
  return patch.power === undefined || patch.speed === undefined
    ? {}
    : { power: patch.power, speed: patch.speed };
}

// The square burned at exactly that power, so the photo's own power multiplier
// would burn it at another. It returns to 100%, which is no field at all.
function withTestedPower(
  image: RasterImage,
  patch: PhotoEngravingApply['layerPatch'],
): RasterImage {
  if (patch.power === undefined || patch.speed === undefined || image.powerScale === undefined)
    return image;
  const { powerScale: _powerScale, ...unscaled } = image;
  return unscaled;
}

// ADR-670: the photo's own choice. "None" over an operation that carries a
// curve needs the identity curve, because an absent override key inherits it.
function photoToneCurveOverride(
  operation: Layer,
  curve: PhotoToneCurve | undefined,
): Pick<ObjectOperationSettingsOverride, 'photoToneCurve'> {
  if (curve !== undefined) return { photoToneCurve: curve };
  return activePhotoToneCurve(operation.photoToneCurve) === undefined
    ? {}
    : { photoToneCurve: IDENTITY_PHOTO_TONE_CURVE };
}

/** Commit tone and image-mode settings as one Undo step, without editing a shared layer. */
export function buildPhotoEngravingUpdate(
  state: AppState,
  owner: PhotoEngravingOwner,
  patch: PhotoEngravingApply,
): Partial<AppState> | null {
  if (!photoEngravingOwnerIsCurrent(state, owner)) return null;
  const image = photoEngravingImage(owner.image, owner.operation, patch);
  if (image === owner.image) return null;
  return {
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) =>
          object === owner.image ? image : object,
        ),
      },
    },
    undoStack: pushUndo(state.project, state.undoStack, 'Photo Engraving'),
    redoStack: [],
    dirty: true,
  };
}

function matchesCurrentSettings(
  image: RasterImage,
  operation: Layer,
  patch: PhotoEngravingApply,
): boolean {
  const effective = effectiveOperationForObject(operation, image);
  return (
    imageToneMatches(image, patch.imagePatch) &&
    sharpeningMatches(image, patch.imagePatch) &&
    effective.mode === 'image' &&
    effective.ditherAlgorithm === patch.layerPatch.ditherAlgorithm &&
    effective.linesPerMm === patch.layerPatch.linesPerMm &&
    effective.negativeImage === patch.layerPatch.negativeImage &&
    effective.passThrough === patch.layerPatch.passThrough &&
    testedBurnMatches(image, effective, patch.layerPatch) &&
    photoToneCurvesEqual(
      activePhotoToneCurve(effective.photoToneCurve),
      activePhotoToneCurve(patch.layerPatch.photoToneCurve),
    )
  );
}

function testedBurnMatches(
  image: RasterImage,
  effective: Layer,
  patch: PhotoEngravingApply['layerPatch'],
): boolean {
  if (patch.power === undefined || patch.speed === undefined) return true;
  return (
    effectiveObjectPowerPercent(effective, image) === patch.power && effective.speed === patch.speed
  );
}

function imageToneMatches(image: RasterImage, patch: PhotoEngravingApply['imagePatch']): boolean {
  return (
    (image.brightness ?? 0) === patch.brightness &&
    (image.contrast ?? 0) === patch.contrast &&
    (image.gamma ?? 1) === patch.gamma
  );
}

function sharpeningMatches(image: RasterImage, patch: PhotoEngravingApply['imagePatch']): boolean {
  if (patch.sharpenAmount === undefined) return true;
  const amount = image.sharpenAmount ?? 0;
  if (amount !== patch.sharpenAmount) return false;
  return (
    amount === 0 ||
    patch.sharpenRadius === undefined ||
    (image.sharpenRadius ?? DEFAULT_SHARPEN_RADIUS) === patch.sharpenRadius
  );
}

export function photoEngravingPatchIsValid({
  imagePatch,
  layerPatch,
}: PhotoEngravingApply): boolean {
  return (
    inRange(imagePatch.brightness, -100, 100) &&
    inRange(imagePatch.contrast, -100, 100) &&
    inRange(imagePatch.gamma, 0.1, 5) &&
    sharpeningPatchIsValid(imagePatch) &&
    Number.isFinite(layerPatch.linesPerMm) &&
    layerPatch.linesPerMm > 0 &&
    DITHER_ALGORITHMS.includes(layerPatch.ditherAlgorithm) &&
    typeof layerPatch.negativeImage === 'boolean' &&
    typeof layerPatch.passThrough === 'boolean' &&
    (layerPatch.photoToneCurve === undefined || isPhotoToneCurve(layerPatch.photoToneCurve)) &&
    testedBurnPatchIsValid(layerPatch)
  );
}

function testedBurnPatchIsValid({ power, speed }: PhotoEngravingApply['layerPatch']): boolean {
  if (power === undefined && speed === undefined) return true;
  return (
    power !== undefined &&
    speed !== undefined &&
    Number.isFinite(power) &&
    power > 0 &&
    power <= 100 &&
    Number.isFinite(speed) &&
    speed > 0
  );
}

function sharpeningPatchIsValid(patch: PhotoEngravingApply['imagePatch']): boolean {
  return (
    (patch.sharpenAmount === undefined || inRange(patch.sharpenAmount, 0, SHARPEN_AMOUNT_MAX)) &&
    (patch.sharpenRadius === undefined ||
      inRange(patch.sharpenRadius, SHARPEN_RADIUS_MIN, SHARPEN_RADIUS_MAX))
  );
}

export const isValidPhotoEngravingPatch = photoEngravingPatchIsValid;

function inRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}
