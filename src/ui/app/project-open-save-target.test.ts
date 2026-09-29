import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectOpenRequestEpochCallbacks } from '../../__fixtures__/file-actions';
import { createProject } from '../../core/scene';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter, RecentFileRef, SaveTarget } from '../../platform/types';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { saveProjectNow } from './confirm-discard';
import { handleOpenProject } from './file-actions';

const LIGHTBURN_PROJECT = `<LightBurnProject><Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1 0 0 1 20 20</XForm></Shape></LightBurnProject>`;

function pathRef(name: string): RecentFileRef {
  return { kind: 'desktop-path', path: `D:\\Jobs\\${name}`, token: 'a'.repeat(43) };
}

function openedFrom(
  name: string,
  text: string,
  saveTarget: (ref: RecentFileRef) => SaveTarget | null,
) {
  const recentRef = pathRef(name);
  const pickFileForSave = vi.fn(async () => null);
  const openedProjectSaveTarget = vi.fn(saveTarget);
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [{ name, text: async () => text, recentRef }],
    pickFileForSave,
    serial: { isSupported: () => false, requestPort: async () => null },
    openedProjectSaveTarget,
  };
  return { platform, recentRef, pickFileForSave, openedProjectSaveTarget };
}

function target(name = 'Sign.lf2'): SaveTarget & { readonly write: ReturnType<typeof vi.fn> } {
  return { displayName: name, write: vi.fn(async (_data: string | Blob) => undefined) };
}

async function open(platform: PlatformAdapter): Promise<void> {
  const state = useStore.getState();
  await handleOpenProject({
    platform,
    setProject: state.setProject,
    markLoaded: state.markLoaded,
    pushToast: vi.fn(),
    ...projectOpenRequestEpochCallbacks(),
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
  });
}

afterEach(() => {
  resetStore();
});

describe('Save writes over the project you opened (ADR-550)', () => {
  it('saves a KerfDesk project back to the file it came from, without asking where', async () => {
    const opened = target();
    const { platform, recentRef, pickFileForSave } = openedFrom(
      'Sign.lf2',
      serializeProject(createProject()),
      () => opened,
    );

    await open(platform);
    expect(useStore.getState()).toMatchObject({ savedName: 'Sign.lf2', lastSaveTarget: opened });
    useStore.setState({ dirty: true });

    await expect(saveProjectNow(platform)).resolves.toBe('saved');
    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(opened.write).toHaveBeenCalledOnce();
    expect(String(opened.write.mock.calls[0]?.[0])).toContain('"schemaVersion"');
    expect(useStore.getState().dirty).toBe(false);
    expect(platform.openedProjectSaveTarget).toHaveBeenCalledWith(recentRef);
  });

  it('never writes over a LightBurn file, which opens as an import', async () => {
    const { platform, openedProjectSaveTarget } = openedFrom('Sign.lbrn2', LIGHTBURN_PROJECT, () =>
      target(),
    );

    await open(platform);

    expect(openedProjectSaveTarget).not.toHaveBeenCalled();
    expect(useStore.getState()).toMatchObject({ savedName: 'Sign.lf2', lastSaveTarget: null });
  });

  it('asks where to save when the platform cannot write the file back', async () => {
    const { platform } = openedFrom('Sign.lf2', serializeProject(createProject()), () => null);
    useStore.setState({ lastSaveTarget: target('previous.lf2') });

    await open(platform);

    expect(useStore.getState()).toMatchObject({ savedName: 'Sign.lf2', lastSaveTarget: null });
  });
});
