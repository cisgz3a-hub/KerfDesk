import { beforeEach, expect, it } from 'vitest';
import { ownedClipImage, ownedClipProject } from '../../__fixtures__/owned-image-clip';
import { compileJob } from '../../core/job';
import { createProject } from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import {
  parsePersonalArtworkLibrary,
  serializePersonalArtworkLibrary,
} from './personal-artwork-format';
import {
  capturePersonalArtwork,
  insertPersonalArtwork,
  personalArtworkProject,
} from './personal-artwork-model';

beforeEach(() => resetStore());

it('carries the owned clip through artwork capture, portable library bytes and insertion', async () => {
  const image = ownedClipImage(),
    original = ownedClipProject(image);
  useStore.setState({ project: original, selectedObjectId: image.id });
  const captured = await capturePersonalArtwork(useStore.getState(), 'Clipped logo', 'SVG');
  const entries = parsePersonalArtworkLibrary(serializePersonalArtworkLibrary([captured]));
  expect(entries).toHaveLength(1);
  const restored = personalArtworkProject(entries[0]!);
  expect(restored.scene.objects).toHaveLength(1);
  expect(restored.scene.layers).toHaveLength(1);
  expect(restored.scene.objects[0]).toMatchObject({
    imageClip: image.imageClip,
    dataUrl: image.dataUrl,
    lumaBase64: image.lumaBase64,
  });
  const destination = createProject();
  useStore.setState({ project: destination, undoStack: [], redoStack: [] });
  useStore.setState((state) => insertPersonalArtwork(state, entries[0]!));
  const inserted = useStore.getState().project;
  expect(inserted.scene.objects).toHaveLength(1);
  expect(inserted.scene.layers).toHaveLength(1);
  const result = inserted.scene.objects[0];
  if (result?.kind !== 'raster-image') throw Error('Expected inserted image.');
  expect(result.imageMaskId).toBeUndefined();
  expect(result.imageClip).toEqual(image.imageClip);
  expect(result.imageClip).not.toBe(image.imageClip);
  expect(result.svgImport).toBeUndefined();
  const output = compileJob(inserted.scene, original.device);
  expect(output.groups).toHaveLength(1);
  const group = output.groups[0];
  expect(group?.kind === 'raster' ? Array.from(group.sValues) : []).toEqual([
    300, 300, 300, 0, 300, 0, 300, 0, 300, 300, 300, 0, 300, 300, 300, 0,
  ]);
  expect(useStore.getState().undoStack).toHaveLength(1);
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(destination);
  useStore.getState().redo();
  expect(useStore.getState().project).toBe(inserted);
});
