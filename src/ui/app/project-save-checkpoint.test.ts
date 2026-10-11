import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform, toasts } from '../../__fixtures__/file-actions';
import { deserializeProject } from '../../io/project';
import { studioDocument } from '../../io/project/studio-document.test-fixture';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { handleSaveProject, type SaveProjectCtx } from './project-save-action';
import { registerProjectSaveCheckpoint } from './project-save-checkpoint';

let unregister: (() => void) | undefined;
beforeEach(resetStore);
afterEach(() => {
  unregister?.();
  unregister = undefined;
});

function request() {
  const state = useStore.getState();
  const write = vi.fn(async (_contents: string | Blob) => undefined);
  const pick = vi.fn(async () => ({ displayName: 'all-artwork.lf2', write }));
  const messages = toasts();
  const ctx: SaveProjectCtx = {
    platform: mockPlatform({ save: pick }),
    project: state.project,
    expectedProject: state.project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    claimProjectSaveRequest: state.claimProjectSaveRequest,
    getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    savedName: null,
    lastSaveTarget: null,
    markSaved: state.markSaved,
    markProjectSaveUncertain: state.markProjectSaveUncertain,
    pushToast: messages.pushToast,
  };
  return { ctx, write, pick };
}

describe('project save checkpoint', () => {
  it('captures native source before Save As serializes, and marks that exact refreshed project saved', async () => {
    const native = studioDocument();
    const save = request();
    unregister = registerProjectSaveCheckpoint(async (owner) => {
      expect(save.pick).not.toHaveBeenCalled();
      expect(owner.isCurrent()).toBe(true);
      useStore.getState().upsertStudioDocument(native, owner.projectDocumentEpoch);
      const project = useStore.getState().project;
      return { project, expectedProject: project };
    });
    expect(await handleSaveProject(save.ctx, true)).toBe('saved');
    expect(save.write).toHaveBeenCalledTimes(1);
    expect(deserializeProject(String(save.write.mock.calls[0]?.[0] ?? ''))).toMatchObject({
      kind: 'ok',
      project: { studioDocuments: [native] },
    });
    expect(useStore.getState().dirty).toBe(false);
  });

  it('does not open a picker or write partial project bytes when native capture fails', async () => {
    const save = request();
    unregister = registerProjectSaveCheckpoint(async () => {
      throw new Error('Editor is not responding');
    });
    expect(await handleSaveProject(save.ctx)).toBe('error');
    expect(save.pick).not.toHaveBeenCalled();
    expect(save.write).not.toHaveBeenCalled();
  });

  it('cannot save a replacement project after an awaited native export', async () => {
    const save = request();
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    unregister = registerProjectSaveCheckpoint(async (owner) => {
      await waiting;
      expect(owner.isCurrent()).toBe(false);
      return { project: useStore.getState().project, expectedProject: useStore.getState().project };
    });
    const pending = handleSaveProject(save.ctx);
    useStore.getState().newProject();
    release();
    expect(await pending).toBe('stale-document');
    expect(save.pick).not.toHaveBeenCalled();
  });

  it('retains Save request ordering while an older checkpoint awaits export', async () => {
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    unregister = registerProjectSaveCheckpoint(async () => {
      if (++calls === 1) await waiting;
      return undefined;
    });
    const older = request();
    const oldSave = handleSaveProject(older.ctx);
    const newer = request();
    expect(await handleSaveProject(newer.ctx)).toBe('saved');
    release();
    expect(await oldSave).toBe('stale-request');
    expect(older.write).not.toHaveBeenCalled();
  });
});
