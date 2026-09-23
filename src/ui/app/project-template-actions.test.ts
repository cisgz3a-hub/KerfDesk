import { beforeEach, expect, it, vi } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { parseProjectTemplate, serializeProjectTemplate } from '../../io/project/project-template';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import {
  artworkProject,
  assetReader,
  pagedProject,
} from '../library/personal-artwork-test-fixtures';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { handleSaveProject } from './project-save-action';
import { openProjectTemplate, saveProjectTemplate } from './project-template-actions';

beforeEach(() => resetStore());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function context(
  pickFilesForOpen = vi.fn(async () => [
    { name: 'Logo.lf2template', text: async () => serializeProjectTemplate(artworkProject()) },
  ]),
) {
  const state = useStore.getState();
  return {
    platform: { pickFilesForOpen } as unknown as PlatformAdapter,
    setProject: state.setProject,
    markLoaded: state.markLoaded,
    pushToast: vi.fn(),
    claimProjectOpenRequest: state.claimProjectOpenRequest,
    getProjectOpenRequestEpoch: () => useStore.getState().projectOpenRequestEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    getProject: () => useStore.getState().project,
  };
}

it('round trips full artwork, notes, fonts, settings and unused operations in a protected envelope', () => {
  const project = artworkProject();
  const result = parseProjectTemplate(serializeProjectTemplate(project));
  expect(result.scene.layers.map((layer) => layer.id)).toEqual([
    'cut',
    'engrave',
    'image-op',
    'unused',
  ]);
  expect(result).toMatchObject({
    notes: project.notes,
    jobSetup: project.jobSetup,
    device: project.device,
    optimization: project.optimization,
    embeddedFonts: project.embeddedFonts,
  });
  expect(result.scene.objects.find((object) => object.kind === 'text')).toMatchObject({
    content: 'Editable logo',
  });
  expect(() => parseProjectTemplate(JSON.stringify(project))).toThrow('supported');
  expect(() =>
    parseProjectTemplate(
      serializeProjectTemplate(project).replace('"version": 1', '"version": 99'),
    ),
  ).toThrow('supported');
});

it('opens as a dirty new document and first Save asks for a new .lf2 destination', async () => {
  const oldTarget = { displayName: 'old.lf2', write: vi.fn() };
  useStore.setState({ savedName: oldTarget.displayName, lastSaveTarget: oldTarget, dirty: false });
  const epoch = useStore.getState().projectDocumentEpoch;
  const ctx = context();
  await openProjectTemplate(ctx);
  const state = useStore.getState();
  expect(state.projectDocumentEpoch).toBe(epoch + 1);
  expect(state).toMatchObject({ dirty: true, savedName: 'Logo.lf2', lastSaveTarget: null });
  const write = vi.fn(async () => undefined);
  const pick = vi.fn(async () => ({ displayName: 'new-job.lf2', write }));
  const result = await handleSaveProject({
    platform: { pickFileForSave: pick } as unknown as PlatformAdapter,
    project: state.project,
    expectedProject: state.project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    getProjectDocumentEpoch: ctx.getProjectDocumentEpoch,
    claimProjectSaveRequest: state.claimProjectSaveRequest,
    getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    savedName: state.savedName,
    lastSaveTarget: state.lastSaveTarget,
    markSaved: state.markSaved,
    markProjectSaveUncertain: state.markProjectSaveUncertain,
    pushToast: ctx.pushToast,
  });
  expect(result).toBe('saved');
  expect(pick).toHaveBeenCalledWith({ suggestedName: 'Logo.lf2', extensions: ['.lf2'] });
  expect(oldTarget.write).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledOnce();
});

it('cancelled or failed template open preserves the exact project and remembered destination', async () => {
  const before = useStore.getState();
  const cancelled = context(vi.fn(async () => []));
  await openProjectTemplate(cancelled);
  expect(useStore.getState().project).toBe(before.project);
  expect(cancelled.pushToast).not.toHaveBeenCalled();
  const failed = context(
    vi.fn(async () => [{ name: 'broken.lf2template', text: async () => '{' }]),
  );
  await openProjectTemplate(failed);
  expect(useStore.getState().project).toBe(before.project);
  expect(useStore.getState().lastSaveTarget).toBe(before.lastSaveTarget);
  expect(failed.pushToast).toHaveBeenCalledWith(
    expect.stringContaining('Could not open template'),
    'error',
  );
});

it('ignores a pending read after document replacement and after a newer open request', async () => {
  const read = deferred<string>();
  const ctx = context(vi.fn(async () => [{ name: 'slow.lf2template', text: () => read.promise }]));
  const pending = openProjectTemplate(ctx);
  await Promise.resolve();
  useStore.getState().newProject();
  const current = useStore.getState().project;
  read.resolve(serializeProjectTemplate(artworkProject()));
  await pending;
  expect(useStore.getState().project).toBe(current);
  expect(ctx.pushToast).not.toHaveBeenCalled();

  const otherRead = deferred<string>();
  const other = context(
    vi.fn(async () => [{ name: 'older.lf2template', text: () => otherRead.promise }]),
  );
  const older = openProjectTemplate(other);
  await Promise.resolve();
  useStore.getState().claimProjectOpenRequest();
  otherRead.resolve(serializeProjectTemplate(artworkProject()));
  await older;
  expect(useStore.getState().project).toBe(current);
});

it('preserves newer edits made while template bytes are being read', async () => {
  const read = deferred<string>();
  const ctx = context(vi.fn(async () => [{ name: 'slow.lf2template', text: () => read.promise }]));
  const pending = openProjectTemplate(ctx);
  await Promise.resolve();
  const changed = { ...useStore.getState().project, notes: 'New edits' };
  useStore.setState({ project: changed, dirty: true });
  read.resolve(serializeProjectTemplate(artworkProject()));
  await pending;
  expect(useStore.getState().project).toBe(changed);
  expect(ctx.pushToast).toHaveBeenCalledWith(expect.stringContaining('project changed'), 'warning');
});

it('saving a template snapshots dependencies and leaves ordinary Save ownership and dirty state intact', async () => {
  const project = pagedProject();
  const originalTarget = { displayName: 'work.lf2', write: vi.fn() };
  useStore.setState({
    project,
    savedName: originalTarget.displayName,
    lastSaveTarget: originalTarget,
    dirty: true,
  });
  const target = deferred<SaveTarget | null>();
  const write = vi.fn(async (_data: string | Blob) => undefined);
  const pick = vi.fn(() => target.promise);
  const pushToast = vi.fn();
  const savedEpoch = useStore.getState().projectSaveRequestEpoch;
  const pending = saveProjectTemplate({
    platform: { pickFileForSave: pick } as unknown as PlatformAdapter,
    project,
    savedName: 'work.lf2',
    assetReader: assetReader(),
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    pushToast,
  });
  await vi.waitFor(() => expect(pick).toHaveBeenCalledOnce());
  useStore.setState({ project: { ...project, notes: 'New edits' } });
  target.resolve({ displayName: 'master.lf2template', write });
  await pending;
  const written = parseProjectTemplate(write.mock.calls[0]![0] as string);
  expect(written.notes).toBe('Template setup notes');
  expect(written.scene.objects.find((object) => object.kind === 'raster-image')).toMatchObject({
    dataUrl: 'data:image/png;base64,AQIDBA==',
    lumaBase64: 'AECA/w==',
  });
  expect(useStore.getState()).toMatchObject({
    lastSaveTarget: originalTarget,
    dirty: true,
    savedName: 'work.lf2',
    projectSaveRequestEpoch: savedEpoch,
  });
});

it('cancel/failure and late completion never publish a template as the ordinary save target', async () => {
  const pushToast = vi.fn();
  const getProjectDocumentEpoch = () => useStore.getState().projectDocumentEpoch;
  const project: Project = createProject();
  const base = { project, savedName: null, getProjectDocumentEpoch, pushToast };
  await saveProjectTemplate({
    ...base,
    platform: { pickFileForSave: async () => null } as unknown as PlatformAdapter,
  });
  expect(pushToast).not.toHaveBeenCalled();
  await saveProjectTemplate({
    ...base,
    platform: {
      pickFileForSave: async () => ({
        displayName: 'bad',
        write: async () => {
          throw new Error('disk full');
        },
      }),
    } as unknown as PlatformAdapter,
  });
  expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('disk full'), 'error');
  pushToast.mockClear();
  const writing = deferred<undefined>();
  const write = vi.fn(() => writing.promise);
  const pending = saveProjectTemplate({
    ...base,
    platform: {
      pickFileForSave: async () => ({ displayName: 'late', write }),
    } as unknown as PlatformAdapter,
  });
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  useStore.getState().newProject();
  writing.resolve(undefined);
  await pending;
  expect(pushToast).not.toHaveBeenCalled();
  expect(useStore.getState().lastSaveTarget).toBeNull();
});
