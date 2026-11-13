import { beforeEach, describe, expect, it } from 'vitest';
import {
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
} from '../../core/effective-output';
import {
  captureLayerOperationSettings,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  layerFromSubLayer,
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
  type TestedBurn,
} from './photo-engraving-settings';

function setup(imagePatch: Partial<RasterImage> = {}): PhotoEngravingOwner {
  const operation: Layer = {
    ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'jarvis',
    power: 30,
    speed: 3000,
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
    ...imagePatch,
  };
  const sibling: RasterImage = { ...image, id: 'sibling', source: 'other.png' };
  const project = { ...createProject(), scene: { objects: [image, sibling], layers: [operation] } };
  useStore.setState({ project, selectedObjectId: image.id, projectDocumentEpoch: 3 });
  return { image, operation, projectDocumentEpoch: 3 };
}

function draftWith(
  owner: PhotoEngravingOwner,
  testedBurn: TestedBurn | undefined,
): PhotoEngravingDraft {
  return { ...initialPhotoEngravingDraft(owner.image, owner.operation), testedBurn };
}

function applied(owner: PhotoEngravingOwner, draft: PhotoEngravingDraft): RasterImage {
  useStore.setState(
    (state) => buildPhotoEngravingUpdate(state, owner, photoEngravingPatch(draft)) ?? state,
  );
  const image = useStore.getState().project.scene.objects[0];
  if (image?.kind !== 'raster-image') throw new Error('Missing photo');
  return image;
}

describe('ADR-711 tested power and speed in Photo engraving', () => {
  beforeEach(resetStore);

  it('opens with nothing chosen and then writes no power or speed', () => {
    const owner = setup();
    const draft = initialPhotoEngravingDraft(owner.image, owner.operation);
    expect(draft.testedBurn).toBeUndefined();
    const { layerPatch } = photoEngravingPatch(draft);
    expect(layerPatch).not.toHaveProperty('power');
    expect(layerPatch).not.toHaveProperty('speed');
    const image = applied(owner, { ...draft, ditherAlgorithm: 'stucki' });
    const override = image.operationOverride?.byOperation?.['photo'];
    expect(override).not.toHaveProperty('power');
    expect(override).not.toHaveProperty('speed');
    expect(effectiveOperationForObject(owner.operation, image)).toMatchObject({
      power: 30,
      speed: 3000,
    });
  });

  it('burns this photo alone at the tested power and speed, in one Undo step', () => {
    const owner = setup();
    const image = applied(owner, draftWith(owner, { power: 62.5, speed: 1800 }));
    const effective = effectiveOperationForObject(owner.operation, image);
    expect(effective).toMatchObject({ mode: 'image', power: 62.5, speed: 1800 });
    expect(effectiveObjectPowerPercent(effective, image)).toBe(62.5);
    const state = useStore.getState();
    // The shared operation and the other photo on it are untouched.
    expect(state.project.scene.layers[0]).toBe(owner.operation);
    const sibling = state.project.scene.objects[1];
    if (sibling?.kind !== 'raster-image') throw new Error('Missing sibling');
    expect(effectiveOperationForObject(owner.operation, sibling)).toMatchObject({
      power: 30,
      speed: 3000,
    });
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it('drops the photo power multiplier so it burns at exactly the tested power', () => {
    const owner = setup({ powerScale: 25 });
    expect(effectiveObjectPowerPercent(owner.operation, owner.image)).toBe(7.5);
    const image = applied(owner, draftWith(owner, { power: 60, speed: 2000 }));
    expect(image).not.toHaveProperty('powerScale');
    const effective = effectiveOperationForObject(owner.operation, image);
    expect(effectiveObjectPowerPercent(effective, image)).toBe(60);
  });

  it('keeps the multiplier when nothing tested is chosen', () => {
    const owner = setup({ powerScale: 25 });
    const draft = { ...draftWith(owner, undefined), ditherAlgorithm: 'stucki' as const };
    expect(applied(owner, draft).powerScale).toBe(25);
  });

  it('keeps an earlier tested power and speed when later edits choose none', () => {
    const owner = setup();
    const first = applied(owner, draftWith(owner, { power: 60, speed: 2000 }));
    const again: PhotoEngravingOwner = { ...owner, image: first };
    const second = applied(again, {
      ...initialPhotoEngravingDraft(first, owner.operation),
      contrast: 20,
    });
    expect(effectiveOperationForObject(owner.operation, second)).toMatchObject({
      power: 60,
      speed: 2000,
    });
  });

  it('changes nothing when the photo already burns at the tested power and speed', () => {
    const owner = setup();
    const patch = photoEngravingPatch(draftWith(owner, { power: 30, speed: 3000 }));
    expect(photoEngravingImage(owner.image, owner.operation, patch)).toBe(owner.image);
    expect(buildPhotoEngravingUpdate(useStore.getState(), owner, patch)).toBeNull();
  });

  it("keeps a sub-pass's own settings when the photo takes the tested ones", () => {
    const owner = setup();
    const subLayer = {
      id: 'second-pass',
      label: 'Second pass',
      enabled: true,
      settings: { ...captureLayerOperationSettings(owner.operation), power: 12, speed: 900 },
    };
    const operation: Layer = { ...owner.operation, subLayers: [subLayer] };
    const patch = photoEngravingPatch(draftWith(owner, { power: 60, speed: 2000 }));
    const image = photoEngravingImage(owner.image, operation, patch);
    expect(effectiveOperationForObject(operation, image)).toMatchObject({
      power: 60,
      speed: 2000,
    });
    // Without its own entry, the photo's override would flow into the sub-pass.
    expect(
      effectiveOperationForObject(layerFromSubLayer(operation, subLayer), image),
    ).toMatchObject({ power: 12, speed: 900 });
  });

  it('refuses a power or speed that cannot burn, or one without the other', () => {
    const owner = setup();
    const patch = photoEngravingPatch(draftWith(owner, { power: 60, speed: 2000 }));
    expect(isValidPhotoEngravingPatch(patch)).toBe(true);
    const bad = (layerPatch: Record<string, unknown>): boolean =>
      isValidPhotoEngravingPatch({
        ...patch,
        layerPatch: { ...patch.layerPatch, ...layerPatch } as typeof patch.layerPatch,
      });
    expect(bad({ power: 0 })).toBe(false);
    expect(bad({ power: 101 })).toBe(false);
    expect(bad({ power: Number.NaN })).toBe(false);
    expect(bad({ speed: 0 })).toBe(false);
    expect(bad({ speed: Number.POSITIVE_INFINITY })).toBe(false);
    expect(bad({ speed: undefined })).toBe(false);
    expect(bad({ power: undefined })).toBe(false);
    expect(
      photoEngravingImage(owner.image, owner.operation, {
        ...patch,
        layerPatch: { ...patch.layerPatch, power: 140 },
      }),
    ).toBe(owner.image);
  });
});
