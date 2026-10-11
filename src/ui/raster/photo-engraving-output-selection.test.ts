import { beforeEach, expect, it } from 'vitest';
import { effectiveOperationForObject } from '../../core/effective-output';
import { compileJob } from '../../core/job';
import { createLayer, createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { buildPhotoEngravingUpdate, photoEngravingImage } from './photo-engraving-apply';
import { computePhotoEngravingPreview } from './photo-engraving-preview';
import { initialPhotoEngravingDraft, photoEngravingPatch } from './photo-engraving-settings';
import { openPhotoEngraving, usePhotoEngravingStore } from './photo-engraving-store';

beforeEach(() => {
  resetStore();
  usePhotoEngravingStore.setState({ session: null });
});

it('applies the previewed grid to the enabled output and survives save, Undo and Redo', () => {
  const { project, disabled, active, photo, sibling } = fixture();
  useStore.setState({ project, selectedObjectId: photo.id });
  const before = compileJob(project.scene, project.device);
  openPhotoEngraving();
  const session = usePhotoEngravingStore.getState().session;
  if (session === null) throw new Error('Expected a photo session');
  expect(session.operation).toBe(active);
  const patch = photoEngravingPatch({
    ...initialPhotoEngravingDraft(photo, session.operation),
    linesPerMm: 3,
  });
  const staged = photoEngravingImage(photo, session.operation, patch);
  const preview = computePhotoEngravingPreview({
    image: staged,
    layer: session.operation,
    device: project.device,
    sceneObjects: project.scene.objects,
  });
  expect(preview).toMatchObject({ kind: 'ok', sourceWidth: 9, sourceHeight: 3 });

  useStore.setState((state) => buildPhotoEngravingUpdate(state, session, patch) ?? state);
  const applied = useStore.getState();
  expect(applied.project.scene.layers).toBe(project.scene.layers);
  expect(applied.project.scene.objects[1]).toBe(sibling);
  expect(disabled).toMatchObject({ output: false, visible: false });
  const loaded = deserializeProject(serializeProject(applied.project));
  if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
  const updated = loaded.project.scene.objects[0];
  if (updated?.kind !== 'raster-image') throw new Error('Expected the saved photo');
  expect(effectiveOperationForObject(active, updated)).toMatchObject({
    ditherAlgorithm: 'jarvis',
    linesPerMm: 3,
  });
  expect(effectiveOperationForObject(disabled, updated)).toEqual(disabled);
  const job = compileJob(loaded.project.scene, loaded.project.device);
  expect(job.groups).toHaveLength(2);
  expect(job.groups.find((group) => group.sourceObjectId === photo.id)).toMatchObject({
    kind: 'raster',
    layerId: active.id,
    pixelWidth: 9,
    pixelHeight: 3,
    operationSettings: { ditherAlgorithm: 'jarvis', linesPerMm: 3 },
  });
  expect(job.groups.find((group) => group.sourceObjectId === sibling.id)).toEqual(
    before.groups.find((group) => group.sourceObjectId === sibling.id),
  );
  expect(applied.undoStack).toEqual([project]);
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(project);
  useStore.getState().redo();
  expect(useStore.getState().project).toBe(applied.project);
});

function fixture() {
  const disabled = {
    ...createLayer({ id: 'disabled', color: '#808080', mode: 'image' }),
    visible: false,
    output: false,
    ditherAlgorithm: 'threshold' as const,
    linesPerMm: 1,
  };
  const active = {
    ...createLayer({ id: 'active', color: '#ff0000', mode: 'image' }),
    ditherAlgorithm: 'threshold' as const,
    linesPerMm: 1,
  };
  const photo: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: 'AID/',
    pixelWidth: 3,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    operationIds: ['disabled', 'active'],
  };
  const sibling = { ...photo, id: 'sibling' };
  const project = {
    ...createProject(),
    scene: { objects: [photo, sibling], layers: [disabled, active] },
  };
  return { project, disabled, active, photo, sibling };
}
