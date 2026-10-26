import { beforeEach, describe, expect, it } from 'vitest';
import { effectiveOperationForObject } from '../../core/effective-output';
import {
  fitPhotoToneCurve,
  IDENTITY_PHOTO_TONE_CURVE,
  type PhotoToneCurve,
} from '../../core/raster/photo-tone-curve';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
} from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import {
  buildPhotoEngravingUpdate,
  isValidPhotoEngravingPatch,
  photoEngravingImage,
  type PhotoEngravingOwner,
} from './photo-engraving-apply';
import {
  initialPhotoEngravingDraft,
  photoEngravingPatch,
  type PhotoEngravingDraft,
} from './photo-engraving-settings';

const BIRCH = fitPhotoToneCurve([{ commandedPercent: 50, observedPercent: 80 }], 'Birch');
const SLATE = fitPhotoToneCurve([{ commandedPercent: 40, observedPercent: 55 }], 'Slate');

function setup(operationPatch: Partial<Layer> = {}): PhotoEngravingOwner {
  const operation: Layer = {
    ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'jarvis',
    ...operationPatch,
  };
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'portrait',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: btoa(String.fromCharCode(0, 96, 255, 255, 96, 0)),
    pixelWidth: 3,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'jarvis',
    linesPerMm: 10,
    operationIds: ['photo'],
  };
  const project = { ...createProject(), scene: { objects: [image], layers: [operation] } };
  useStore.setState({ project, selectedObjectId: image.id, projectDocumentEpoch: 3 });
  return { image, operation, projectDocumentEpoch: 3 };
}

function draftWith(
  owner: PhotoEngravingOwner,
  curve: PhotoToneCurve | undefined,
): PhotoEngravingDraft {
  return { ...initialPhotoEngravingDraft(owner.image, owner.operation), photoToneCurve: curve };
}

function applied(owner: PhotoEngravingOwner, draft: PhotoEngravingDraft): RasterImage {
  useStore.setState(
    (state) => buildPhotoEngravingUpdate(state, owner, photoEngravingPatch(draft)) ?? state,
  );
  const image = useStore.getState().project.scene.objects[0];
  if (image?.kind !== 'raster-image') throw new Error('Missing photo');
  return image;
}

describe('ADR-670 tone calibration in Photo engraving', () => {
  beforeEach(resetStore);

  it('starts without a calibration and writes the chosen one into the photo override only', () => {
    const owner = setup();
    expect(initialPhotoEngravingDraft(owner.image, owner.operation).photoToneCurve).toBeUndefined();
    const image = applied(owner, draftWith(owner, BIRCH));
    expect(image.operationOverride?.byOperation?.['photo']?.photoToneCurve).toEqual(BIRCH);
    expect(useStore.getState().project.scene.layers[0]).not.toHaveProperty('photoToneCurve');
    expect(effectiveOperationForObject(owner.operation, image).photoToneCurve).toEqual(BIRCH);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('opens with the curve the photo already burns with, and replaces it', () => {
    const owner = setup();
    const withBirch = photoEngravingImage(
      owner.image,
      owner.operation,
      photoEngravingPatch(draftWith(owner, BIRCH)),
    );
    expect(initialPhotoEngravingDraft(withBirch, owner.operation).photoToneCurve).toEqual(BIRCH);
    const withSlate = photoEngravingImage(withBirch, owner.operation, {
      ...photoEngravingPatch(draftWith(owner, SLATE)),
    });
    expect(effectiveOperationForObject(owner.operation, withSlate).photoToneCurve).toEqual(SLATE);
  });

  it('removes the photo curve on None, and overrides an operation curve with the identity', () => {
    const plain = setup();
    const calibrated = photoEngravingImage(
      plain.image,
      plain.operation,
      photoEngravingPatch(draftWith(plain, BIRCH)),
    );
    const cleared = photoEngravingImage(
      calibrated,
      plain.operation,
      photoEngravingPatch(draftWith(plain, undefined)),
    );
    expect(cleared.operationOverride?.byOperation?.['photo']).not.toHaveProperty('photoToneCurve');

    const shared = setup({ photoToneCurve: BIRCH });
    expect(initialPhotoEngravingDraft(shared.image, shared.operation).photoToneCurve).toEqual(
      BIRCH,
    );
    const off = photoEngravingImage(
      shared.image,
      shared.operation,
      photoEngravingPatch(draftWith(shared, undefined)),
    );
    expect(off.operationOverride?.byOperation?.['photo']?.photoToneCurve).toEqual(
      IDENTITY_PHOTO_TONE_CURVE,
    );
    expect(initialPhotoEngravingDraft(off, shared.operation).photoToneCurve).toBeUndefined();
  });

  it('treats an unchanged curve as no change and refuses an invalid one', () => {
    const owner = setup({ photoToneCurve: BIRCH });
    const same = photoEngravingPatch(draftWith(owner, structuredClone(BIRCH)));
    expect(photoEngravingImage(owner.image, owner.operation, same)).toBe(owner.image);
    const broken = {
      ...BIRCH,
      points: [
        { input: 0, output: 0 },
        { input: 255, output: 200 },
      ],
    };
    expect(isValidPhotoEngravingPatch(photoEngravingPatch(draftWith(owner, broken)))).toBe(false);
  });
});
