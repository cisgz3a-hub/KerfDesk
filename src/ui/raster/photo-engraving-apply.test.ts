import { beforeEach, describe, expect, it } from 'vitest';
import { effectiveOperationForObject } from '../../core/effective-output';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createLayerSubLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  layerFromSubLayer,
  type Layer,
  type RasterImage,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore, type AppState } from '../state/store';
import { resetStore } from '../state/test-helpers';
import {
  buildPhotoEngravingUpdate,
  photoEngravingImage,
  photoEngravingOwnerIsCurrent,
  isValidPhotoEngravingPatch,
  type PhotoEngravingApply,
  type PhotoEngravingOwner,
} from './photo-engraving-apply';

const PATCH: PhotoEngravingApply = {
  imagePatch: { brightness: 12, contrast: 16, gamma: 1.2 },
  layerPatch: { ditherAlgorithm: 'jarvis', linesPerMm: 2, negativeImage: true, passThrough: false },
};

function raster(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: btoa(String.fromCharCode(0, 96, 255, 255, 96, 0)),
    pixelWidth: 3,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    operationIds: ['photo'],
  };
}

function fixture(imagePatch: Partial<RasterImage> = {}, operationPatch: Partial<Layer> = {}) {
  const operation: Layer = {
    ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'threshold',
    linesPerMm: 1,
    power: 30,
    speed: 1800,
    imageBidirectional: false,
    ...operationPatch,
  };
  const otherOperation = createLayer({ id: 'other', color: '#000000', mode: 'line' });
  const image: RasterImage = { ...raster('portrait'), ...imagePatch };
  const sibling = raster('sibling');
  const project = {
    ...createProject(),
    scene: { objects: [image, sibling], layers: [operation, otherOperation] },
  };
  useStore.setState({ project, selectedObjectId: image.id, projectDocumentEpoch: 7 });
  const owner: PhotoEngravingOwner = { image, operation, projectDocumentEpoch: 7 };
  return { owner, state: useStore.getState(), project, sibling, otherOperation };
}

function apply(owner: PhotoEngravingOwner, patch = PATCH): AppState {
  useStore.setState((state) => buildPhotoEngravingUpdate(state, owner, patch) ?? state);
  return useStore.getState();
}

function portrait(state: AppState): RasterImage {
  const image = state.project.scene.objects.find((object) => object.id === 'portrait');
  if (image?.kind !== 'raster-image') throw new Error('Missing portrait fixture');
  return image;
}

describe('photo engraving Apply', () => {
  beforeEach(resetStore);

  it('changes only the selected photo in one Undo step and preserves original pixels and placement', () => {
    const { owner, project, sibling } = fixture();
    useStore.setState({ redoStack: [createProject()] });
    const state = apply(owner);
    const image = portrait(state);

    expect(image).toEqual(photoEngravingImage(owner.image, owner.operation, PATCH));
    expect(image).toMatchObject(PATCH.imagePatch);
    expect(image.dataUrl).toBe(owner.image.dataUrl);
    expect(image.lumaBase64).toBe(owner.image.lumaBase64);
    expect(image.pixelWidth).toBe(3);
    expect(image.pixelHeight).toBe(2);
    expect(image.bounds).toBe(owner.image.bounds);
    expect(image.transform).toBe(owner.image.transform);
    expect(state.project.scene.objects[1]).toBe(sibling);
    expect(state.project.scene.layers).toBe(project.scene.layers);
    expect(effectiveOperationForObject(owner.operation, image)).toMatchObject({
      ...PATCH.layerPatch,
      mode: 'image',
      power: 30,
      speed: 1800,
      imageBidirectional: false,
    });
    expect(state.undoStack).toEqual([project]);
    expect(state.redoStack).toEqual([]);
    expect(state.dirty).toBe(true);

    useStore.getState().undo();
    expect(portrait(useStore.getState())).toBe(owner.image);
    useStore.getState().redo();
    expect(portrait(useStore.getState())).toBe(image);
  });

  it('preserves legacy settings, independent operations and the shared layer while changing image mode', () => {
    const { owner, otherOperation } = fixture(
      {
        operationIds: ['photo', 'other'],
        operationOverride: {
          mode: 'fill',
          power: 17,
          speed: 900,
          imageOverscanMm: 3,
          byOperation: { other: { mode: 'line', speed: 450, powerMode: 'constant' } },
        },
      },
      { mode: 'line' },
    );
    const otherBefore = effectiveOperationForObject(otherOperation, owner.image);
    const image = portrait(apply(owner));
    expect(image.operationOverride?.mode).toBe('fill');
    expect(image.operationOverride?.byOperation?.other).toBe(
      owner.image.operationOverride?.byOperation?.other,
    );
    expect(effectiveOperationForObject(otherOperation, image)).toEqual(otherBefore);
    expect(effectiveOperationForObject(owner.operation, image)).toMatchObject({
      mode: 'image',
      power: 17,
      speed: 900,
      imageOverscanMm: 3,
      ...PATCH.layerPatch,
    });
    expect(owner.operation.mode).toBe('line');
  });

  it('keeps existing parent-specific settings and does not resurrect explicitly cleared legacy settings', () => {
    for (const scoped of [{ speed: 700, power: 19 }, null]) {
      const { owner } = fixture({
        operationOverride: { speed: 800, power: 20, byOperation: { photo: scoped } },
      });
      const before = effectiveOperationForObject(owner.operation, owner.image);
      const image = portrait(apply(owner));
      expect(effectiveOperationForObject(owner.operation, image)).toMatchObject({
        speed: before.speed,
        power: before.power,
        ...PATCH.layerPatch,
      });
    }
  });

  it('retains sub-operation settings that previously inherited a parent override', () => {
    const base = createLayer({ id: 'photo', color: '#808080', mode: 'image' });
    const inherited = createLayerSubLayer(base, { id: 'inherited', label: 'Second pass' });
    const owned = createLayerSubLayer(base, { id: 'owned', label: 'Own pass' });
    const { owner } = fixture(
      {
        operationOverride: {
          byOperation: {
            photo: { speed: 600, ditherAlgorithm: 'stucki' },
            'photo:owned': { speed: 500, passThrough: true },
          },
        },
      },
      { subLayers: [inherited, owned] },
    );
    const childBefore = owner.operation.subLayers.map((sub) =>
      effectiveOperationForObject(layerFromSubLayer(owner.operation, sub), owner.image),
    );
    const image = portrait(apply(owner));
    expect(
      owner.operation.subLayers.map((sub) =>
        effectiveOperationForObject(layerFromSubLayer(owner.operation, sub), image),
      ),
    ).toEqual(childBefore);
    expect(image.operationOverride?.byOperation?.['photo:owned']).toBe(
      owner.image.operationOverride?.byOperation?.['photo:owned'],
    );
  });

  it('round-trips the photo override and compiles its requested grid without changing the sibling burn', () => {
    const { owner, project, sibling } = fixture();
    const before = compileJob(project.scene, project.device);
    const state = apply(owner);
    const loaded = deserializeProject(serializeProject(state.project));
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    const image = loaded.project.scene.objects.find((object) => object.id === owner.image.id);
    expect(image).toMatchObject({ ...PATCH.imagePatch, lumaBase64: owner.image.lumaBase64 });
    const job = compileJob(loaded.project.scene, loaded.project.device);
    const selectedGroup = job.groups.find(
      (group) => group.kind === 'raster' && group.sourceObjectId === owner.image.id,
    );
    expect(selectedGroup).toMatchObject({
      kind: 'raster',
      pixelWidth: 6,
      pixelHeight: 4,
      power: 30,
      speed: 1800,
      operationSettings: { ...PATCH.layerPatch, mode: 'image' },
    });
    expect(
      job.groups.find((group) => group.kind === 'raster' && group.sourceObjectId === sibling.id),
    ).toEqual(
      before.groups.find((group) => group.kind === 'raster' && group.sourceObjectId === sibling.id),
    );
    expect(job.groups).toHaveLength(2);
  });

  it('does not add history or overrides for unchanged effective settings', () => {
    const { owner, state } = fixture();
    const unchanged: PhotoEngravingApply = {
      imagePatch: { brightness: 0, contrast: 0, gamma: 1 },
      layerPatch: {
        ditherAlgorithm: 'threshold',
        linesPerMm: 1,
        negativeImage: false,
        passThrough: false,
      },
    };
    expect(photoEngravingImage(owner.image, owner.operation, unchanged)).toBe(owner.image);
    expect(buildPhotoEngravingUpdate(state, owner, unchanged)).toBeNull();
    expect(state.undoStack).toEqual([]);
  });

  it('refuses a session after switching to CNC without changing the photo', () => {
    const { owner, state } = fixture();
    const cncState = {
      ...state,
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    };
    expect(photoEngravingOwnerIsCurrent(cncState, owner)).toBe(false);
    expect(buildPhotoEngravingUpdate(cncState, owner, PATCH)).toBeNull();
  });

  it('rejects invalid tone values without treating them as an unchanged successful patch', () => {
    const { owner, state } = fixture();
    for (const imagePatch of [
      { brightness: Number.NaN, contrast: 0, gamma: 1 },
      { brightness: 0, contrast: 101, gamma: 1 },
      { brightness: 0, contrast: 0, gamma: 0 },
    ]) {
      const patch = { ...PATCH, imagePatch };
      expect(isValidPhotoEngravingPatch(patch)).toBe(false);
      expect(buildPhotoEngravingUpdate(state, owner, patch)).toBeNull();
    }
    expect(isValidPhotoEngravingPatch(PATCH)).toBe(true);
  });

  it.each(['document', 'image', 'operation', 'deselected', 'multiple', 'removed'] as const)(
    'refuses a stale %s owner even when ids remain reusable',
    (reason) => {
      const { owner, state } = fixture();
      let next: AppState = state;
      if (reason === 'document') next = { ...state, projectDocumentEpoch: 8 };
      if (reason === 'deselected') next = { ...state, selectedObjectId: 'sibling' };
      if (reason === 'multiple') next = { ...state, additionalSelectedIds: new Set(['sibling']) };
      if (reason === 'image' || reason === 'removed')
        next = {
          ...state,
          project: {
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: reason === 'removed' ? [] : [{ ...owner.image }],
            },
          },
        };
      if (reason === 'operation')
        next = {
          ...state,
          project: {
            ...state.project,
            scene: { ...state.project.scene, layers: [{ ...owner.operation }] },
          },
        };
      expect(photoEngravingOwnerIsCurrent(next, owner)).toBe(false);
      expect(buildPhotoEngravingUpdate(next, owner, PATCH)).toBeNull();
      expect(next.undoStack).toBe(state.undoStack);
    },
  );

  it.each([{ locked: true }, { role: 'trace-source' as const }, { operationIds: ['other'] }])(
    'refuses an unavailable photo %j',
    (imagePatch) => {
      const { owner, state } = fixture(imagePatch);
      expect(buildPhotoEngravingUpdate(state, owner, PATCH)).toBeNull();
    },
  );

  it('refuses hidden operations and effective-layer copies but accepts legacy colour binding', () => {
    const hidden = fixture({}, { visible: false });
    expect(buildPhotoEngravingUpdate(hidden.state, hidden.owner, PATCH)).toBeNull();
    const legacy = fixture({ operationOverride: { power: 20 } });
    const { operationIds: _operationIds, ...legacyImage } = legacy.owner.image;
    const legacyOwner = { ...legacy.owner, image: legacyImage };
    const legacyState = {
      ...legacy.state,
      project: {
        ...legacy.project,
        scene: { ...legacy.project.scene, objects: [legacyImage] },
      },
    };
    expect(photoEngravingOwnerIsCurrent(legacyState, legacyOwner)).toBe(true);
    const effectiveOwner = {
      ...legacyOwner,
      operation: effectiveOperationForObject(legacyOwner.operation, legacyImage),
    };
    expect(buildPhotoEngravingUpdate(legacyState, effectiveOwner, PATCH)).toBeNull();
  });

  it.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid density %s without changing pixels or history',
    (linesPerMm) => {
      const { owner, state } = fixture();
      const patch = { ...PATCH, layerPatch: { ...PATCH.layerPatch, linesPerMm } };
      expect(photoEngravingImage(owner.image, owner.operation, patch)).toBe(owner.image);
      expect(buildPhotoEngravingUpdate(state, owner, patch)).toBeNull();
    },
  );
});
