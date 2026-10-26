import { beforeEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore, type AppState } from '../state/store';
import { resetStore } from '../state/test-helpers';
import {
  buildPhotoEngravingUpdate,
  isValidPhotoEngravingPatch,
  photoEngravingImage,
  type PhotoEngravingApply,
  type PhotoEngravingOwner,
} from './photo-engraving-apply';
import { initialPhotoEngravingDraft, photoEngravingPatch } from './photo-engraving-settings';

const TONES = { brightness: 0, contrast: 0, gamma: 1 };
const LAYER_PATCH: PhotoEngravingApply['layerPatch'] = {
  ditherAlgorithm: 'jarvis',
  linesPerMm: 1,
  negativeImage: false,
  passThrough: false,
};

function portrait(patch: Partial<RasterImage> = {}): RasterImage {
  const luma = Uint8Array.from({ length: 48 }, (_, i) => (i % 8 < 4 ? 60 : 200) + (i % 3) * 9);
  return {
    kind: 'raster-image',
    id: 'portrait',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: btoa(String.fromCharCode(...luma)),
    pixelWidth: 8,
    pixelHeight: 6,
    bounds: { minX: 0, minY: 0, maxX: 8, maxY: 6 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'jarvis',
    linesPerMm: 1,
    operationIds: ['photo'],
    ...patch,
  };
}

function fixture(imagePatch: Partial<RasterImage> = {}) {
  const operation: Layer = {
    ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'jarvis',
    linesPerMm: 1,
  };
  const image = portrait(imagePatch);
  const project = { ...createProject(), scene: { objects: [image], layers: [operation] } };
  useStore.setState({ project, selectedObjectId: image.id, projectDocumentEpoch: 3 });
  const owner: PhotoEngravingOwner = { image, operation, projectDocumentEpoch: 3 };
  return { owner, operation, state: useStore.getState() };
}

function apply(owner: PhotoEngravingOwner, patch: PhotoEngravingApply): AppState {
  useStore.setState((state) => buildPhotoEngravingUpdate(state, owner, patch) ?? state);
  return useStore.getState();
}

function burn(image: RasterImage, operation: Layer): unknown {
  const job = compileJob({ objects: [image], layers: [operation] }, createProject().device);
  return job.groups.map((group) => (group.kind === 'raster' ? Array.from(group.sValues) : group));
}

function appliedImage(state: AppState): RasterImage {
  const image = state.project.scene.objects[0];
  if (image?.kind !== 'raster-image') throw new Error('Missing portrait');
  return image;
}

beforeEach(() => {
  resetStore();
});

describe('photo engraving sharpening (ADR-671)', () => {
  it('starts from the photo, defaulting to off at a radius of one line', () => {
    const { operation } = fixture();
    expect(initialPhotoEngravingDraft(portrait(), operation)).toMatchObject({
      sharpenAmount: 0,
      sharpenRadius: 1,
    });
    expect(
      initialPhotoEngravingDraft(portrait({ sharpenAmount: 45, sharpenRadius: 0.7 }), operation),
    ).toMatchObject({ sharpenAmount: 45, sharpenRadius: 0.7 });
  });

  it('applies sharpening to the photo in one Undo step and saves it with the project', () => {
    const { owner, operation } = fixture();
    const before = burn(owner.image, operation);
    const state = apply(owner, {
      imagePatch: { ...TONES, sharpenAmount: 60, sharpenRadius: 1.2 },
      layerPatch: LAYER_PATCH,
    });

    expect(appliedImage(state)).toMatchObject({ sharpenAmount: 60, sharpenRadius: 1.2 });
    expect(state.undoStack).toHaveLength(1);
    const loaded = deserializeProject(serializeProject(state.project));
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    expect(loaded.project.scene.objects[0]).toMatchObject({
      sharpenAmount: 60,
      sharpenRadius: 1.2,
    });
    expect(burn(appliedImage(state), operation)).not.toEqual(before);
  });

  it('turns sharpening off without leaving fields behind', () => {
    const { owner, operation } = fixture({ sharpenAmount: 80, sharpenRadius: 2 });
    const state = apply(owner, {
      imagePatch: { ...TONES, sharpenAmount: 0, sharpenRadius: 2 },
      layerPatch: LAYER_PATCH,
    });
    const image = appliedImage(state);

    expect(image).not.toHaveProperty('sharpenAmount');
    expect(image).not.toHaveProperty('sharpenRadius');
    expect(burn(image, operation)).toEqual(burn(portrait(), operation));
  });

  it('keeps the photo sharpening when a patch does not mention it', () => {
    const { owner } = fixture({ sharpenAmount: 35, sharpenRadius: 0.8 });
    const image = photoEngravingImage(owner.image, owner.operation, {
      imagePatch: { brightness: 5, contrast: 0, gamma: 1 },
      layerPatch: LAYER_PATCH,
    });
    expect(image).toMatchObject({ brightness: 5, sharpenAmount: 35, sharpenRadius: 0.8 });
  });

  it('adds no history for unchanged sharpening', () => {
    const { owner, state } = fixture({ sharpenAmount: 35, sharpenRadius: 0.8 });
    const unchanged = photoEngravingPatch(initialPhotoEngravingDraft(owner.image, owner.operation));
    expect(buildPhotoEngravingUpdate(state, owner, unchanged)).toBeNull();
  });

  it('rejects sharpening outside the dialog ranges', () => {
    const { owner, state } = fixture();
    for (const sharpen of [
      { sharpenAmount: 501 },
      { sharpenAmount: -1 },
      { sharpenAmount: Number.NaN },
      { sharpenAmount: 50, sharpenRadius: 0.2 },
      { sharpenAmount: 50, sharpenRadius: 3.5 },
    ]) {
      const patch = { imagePatch: { ...TONES, ...sharpen }, layerPatch: LAYER_PATCH };
      expect(isValidPhotoEngravingPatch(patch)).toBe(false);
      expect(buildPhotoEngravingUpdate(state, owner, patch)).toBeNull();
    }
  });
});
