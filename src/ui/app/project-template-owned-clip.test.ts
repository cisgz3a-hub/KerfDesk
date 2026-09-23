import { beforeEach, expect, it, vi } from 'vitest';
import { ownedClipImage, ownedClipProject } from '../../__fixtures__/owned-image-clip';
import { compileJob } from '../../core/job';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { openProjectTemplate, saveProjectTemplate } from './project-template-actions';

beforeEach(() => resetStore());

it('saves and reopens an owned clip through the template actions without helper artwork', async () => {
  const image = ownedClipImage(),
    original = ownedClipProject(image);
  useStore.setState({ project: original, savedName: 'clipped.lf2', dirty: true });
  let bytes = '';
  const write = vi.fn(async (data: string | Blob) => {
    if (typeof data !== 'string') throw Error('Expected a portable template string.');
    bytes = data;
  });
  const pushToast = vi.fn();
  await saveProjectTemplate({
    platform: {
      pickFileForSave: async () => ({ displayName: 'clipped.lf2template', write }),
    } as unknown as PlatformAdapter,
    project: original,
    savedName: 'clipped.lf2',
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    pushToast,
  });
  expect(write).toHaveBeenCalledOnce();
  expect(useStore.getState().project).toBe(original);
  useStore.getState().newProject();
  const beforeOpen = useStore.getState();
  await openProjectTemplate({
    platform: {
      pickFilesForOpen: async () => [{ name: 'clipped.lf2template', text: async () => bytes }],
    } as unknown as PlatformAdapter,
    setProject: beforeOpen.setProject,
    markLoaded: beforeOpen.markLoaded,
    pushToast,
    claimProjectOpenRequest: beforeOpen.claimProjectOpenRequest,
    getProjectOpenRequestEpoch: () => useStore.getState().projectOpenRequestEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    getProject: () => useStore.getState().project,
  });
  const reopened = useStore.getState().project;
  expect(reopened.scene.objects).toHaveLength(1);
  expect(reopened.scene.layers).toHaveLength(1);
  expect(reopened.scene.objects[0]).toMatchObject({
    imageClip: image.imageClip,
    dataUrl: image.dataUrl,
    lumaBase64: image.lumaBase64,
    bounds: image.bounds,
    transform: image.transform,
    svgImport: image.svgImport,
  });
  expect(compileJob(reopened.scene, reopened.device)).toEqual(
    compileJob(original.scene, original.device),
  );
  expect(useStore.getState()).toMatchObject({
    dirty: true,
    savedName: 'clipped.lf2',
    lastSaveTarget: null,
  });
  expect(pushToast.mock.calls.some((call) => call[1] === 'error')).toBe(false);
});
