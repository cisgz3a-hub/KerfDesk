import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { pagedProject } from '../library/personal-artwork-test-fixtures';
import { useStore } from '../state';
import { useProjectSaveDialogStore } from '../state/project-save-dialog-store';
import { resetStore } from '../state/test-helpers';
import { prepareLargeProjectSave } from './large-project-save';
import { handleSaveProject } from './project-save-action';
import {
  prepareProjectRecoveryMessage,
  prepareProjectSaveMessage,
} from './project-save-preparation';
import { prepareProjectSaveOffThread } from './project-save-preparation-client';

vi.mock('./project-save-preparation-client', () => ({ prepareProjectSaveOffThread: vi.fn() }));
vi.mock('../import/paged-asset-indexeddb', async () => {
  const fixture = await import('../library/personal-artwork-test-fixtures');
  return {
    IndexedDbPagedAssetRepository: vi.fn(function createReader() {
      return fixture.assetReader();
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  useProjectSaveDialogStore.setState({ request: null });
  vi.mocked(prepareProjectSaveOffThread).mockImplementation(async (project, _signal, mode) =>
    mode === 'recovery'
      ? prepareProjectRecoveryMessage(project)
      : prepareProjectSaveMessage(project),
  );
});

function project(): Project {
  return {
    ...createProject(),
    sheetBook: {
      activeId: 'blank',
      activeName: 'Blank',
      inactive: [{ id: 'art', name: 'Logo sheet', projectJson: serializeProject(pagedProject()) }],
    },
  };
}
function context(artwork: Project) {
  const state = useStore.getState();
  const write = vi.fn(async (_data: string | Blob) => undefined);
  const target = { displayName: 'book.lf2', write };
  const pick = vi.fn(async () => target);
  return {
    write,
    pick,
    target,
    ctx: {
      project: artwork,
      platform: { ...mockPlatform(), pickFileForSave: pick },
      expectedProject: state.project,
      projectDocumentEpoch: state.projectDocumentEpoch,
      getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
      getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
      claimProjectSaveRequest: state.claimProjectSaveRequest,
      projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
      savedName: null,
      lastSaveTarget: null,
      markSaved: state.markSaved,
      markProjectSaveUncertain: state.markProjectSaveUncertain,
      pushToast: vi.fn(),
    },
  };
}

describe('ordinary portable project sheet Save', () => {
  it('embeds active page-backed images when reusing an owned Save destination', async () => {
    const source = pagedProject();
    useStore.setState({ project: source, dirty: true });
    const { ctx, pick, target, write } = context(source);
    expect(await handleSaveProject({ ...ctx, lastSaveTarget: target })).toBe('saved');
    expect(pick).not.toHaveBeenCalled();
    const opened = deserializeProject(write.mock.calls[0]![0] as string);
    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') throw new Error('active image did not reopen');
    expect(
      opened.project.scene.objects.find((object) => object.kind === 'raster-image'),
    ).toMatchObject({
      dataUrl: 'data:image/png;base64,AQIDBA==',
      lumaBase64: 'AECA/w==',
    });
    expect(useStore.getState().project).toBe(source);
  });

  it('embeds inactive original/luma/font data before a fresh Choose file click', async () => {
    const source = project();
    useStore.setState({ project: source, dirty: true });
    const { ctx, pick, write } = context(source);
    const pending = handleSaveProject(ctx);
    await vi.waitFor(() =>
      expect(useProjectSaveDialogStore.getState().request?.phase).toBe('ready'),
    );
    expect(pick).not.toHaveBeenCalled();
    useProjectSaveDialogStore.getState().request!.choose();
    expect(await pending).toBe('saved');
    const opened = deserializeProject(write.mock.calls[0]![0] as string);
    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') throw new Error('saved book did not reopen');
    const archive = deserializeProject(opened.project.sheetBook!.inactive[0]!.projectJson);
    expect(archive.kind).toBe('ok');
    if (archive.kind !== 'ok') throw new Error('saved archive did not reopen');
    expect(
      archive.project.scene.objects.find((object) => object.kind === 'raster-image'),
    ).toMatchObject({
      dataUrl: 'data:image/png;base64,AQIDBA==',
      lumaBase64: 'AECA/w==',
    });
    expect(archive.project.embeddedFonts).toEqual(pagedProject().embeddedFonts);
    expect(useStore.getState().project).toBe(source);
    expect(pick).toHaveBeenCalledOnce();
  });

  it('does not replace raw recovery with a materialized project or alter archived bytes', async () => {
    const source = project();
    const { ctx, target } = context(source);
    const owner = {
      ...ctx,
      projectSaveRequestEpoch: useStore.getState().claimProjectSaveRequest(),
    };
    const result = await prepareLargeProjectSave(
      ctx,
      owner,
      true,
      async () => ({ kind: 'selected', target }),
      'recovery',
    );
    expect(result.kind).toBe('prepared');
    if (result.kind !== 'prepared') throw new Error('raw recovery did not prepare');
    expect(result.json).toBe(serializeProject(source));
    expect(vi.mocked(prepareProjectSaveOffThread).mock.calls[0]![0]).toBe(source);
    expect(vi.mocked(prepareProjectSaveOffThread).mock.calls[0]![2]).toBe('recovery');
  });
});
