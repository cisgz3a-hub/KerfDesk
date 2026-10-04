import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import {
  ProjectSaveTestWorker,
  currentProjectSaveWorker,
} from '../../__fixtures__/project-save-worker';
import { useStore } from '../state';
import { useProjectSaveDialogStore } from '../state/project-save-dialog-store';
import { handleSaveProject, type SaveProjectCtx } from './project-save-action';
import { prepareProjectSaveMessage } from './project-save-preparation';
import { confirmDiscardAsync } from './confirm-discard';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { readAutosave, writeAutosave } from '../state/autosave';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { prepareProjectRecoveryMessage } from './project-save-preparation';
import { projectSaveNeedsWorker } from './project-save-size';

vi.mock('../state/job-aware-dialogs', () => ({ jobAwareConfirm: vi.fn(() => false) }));

function project(): Project {
  return { ...createProject(), notes: 'captured '.repeat(62_500) };
}
function context(
  pickFileForSave: PlatformAdapter['pickFileForSave'],
  target: SaveTarget | null = null,
): SaveProjectCtx {
  const state = useStore.getState();
  return {
    platform: {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave,
      serial: { isSupported: () => false, requestPort: async () => null },
    },
    project: state.project,
    expectedProject: state.project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    claimProjectSaveRequest: state.claimProjectSaveRequest,
    getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    markSaved: state.markSaved,
    markProjectSaveUncertain: state.markProjectSaveUncertain,
    savedName: null,
    lastSaveTarget: target,
    pushToast: vi.fn(),
  };
}
async function ready(): Promise<void> {
  await vi.waitFor(() => expect(useProjectSaveDialogStore.getState().request?.phase).toBe('ready'));
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useStore.getState().newProject();
  useStore.setState({ project: project(), dirty: true });
  ProjectSaveTestWorker.instances = [];
  vi.stubGlobal('Worker', ProjectSaveTestWorker);
  vi.mocked(jobAwareConfirm).mockClear().mockReturnValue(false);
});
afterEach(() => {
  useConfirmSaveStore.getState().choose('cancel');
  useProjectSaveDialogStore.getState().request?.cancel();
  useStore.getState().newProject();
  vi.unstubAllGlobals();
});

describe('large captured project saves', () => {
  it('waits for full validation, then invokes the picker synchronously inside a fresh Choose file gesture', async () => {
    let insideClick = false;
    const write = vi.fn(async () => undefined);
    const pick = vi.fn(async () => {
      expect(insideClick).toBe(true);
      return { displayName: 'large.lf2', write };
    });
    const ctx = context(pick);
    const saving = handleSaveProject(ctx);
    expect(useProjectSaveDialogStore.getState().request?.phase).toBe('preparing');
    expect(pick).not.toHaveBeenCalled();
    currentProjectSaveWorker().respond(prepareProjectSaveMessage(ctx.project));
    await ready();
    expect(pick).not.toHaveBeenCalled();
    insideClick = true;
    useProjectSaveDialogStore.getState().request!.choose();
    expect(pick).toHaveBeenCalledOnce();
    insideClick = false;
    await expect(saving).resolves.toBe('saved');
    expect(write).toHaveBeenCalledOnce();
    expect(useProjectSaveDialogStore.getState().request).toBeNull();
    expect(useStore.getState().dirty).toBe(false);
  });

  it('writes the captured version when edits arrive during validation and leaves newer edits dirty', async () => {
    const written: string[] = [];
    const pick = vi.fn(async () => ({
      displayName: 'captured.lf2',
      write: async (value: string | Blob) => {
        written.push(JSON.parse(String(value)).notes as string);
      },
    }));
    const ctx = context(pick);
    const saving = handleSaveProject(ctx);
    const newer = { ...ctx.project, notes: 'newer edit' };
    useStore.setState({ project: newer, dirty: true });
    currentProjectSaveWorker().respond(prepareProjectSaveMessage(ctx.project));
    await ready();
    useProjectSaveDialogStore.getState().request!.choose();
    await expect(saving).resolves.toBe('saved-with-newer-edits');
    expect(written).toEqual([ctx.project.notes]);
    expect(useStore.getState().project).toBe(newer);
    expect(useStore.getState().dirty).toBe(true);
  });

  it.each(['preparing', 'ready'] as const)(
    'cancels at %s without selecting or writing a file or clearing dirty state',
    async (phase) => {
      const pick = vi.fn(async () => null);
      const ctx = context(pick);
      expect(writeAutosave(ctx.project, 123).kind).toBe('ok');
      const recovery = readAutosave();
      const saving = handleSaveProject(ctx);
      const worker = currentProjectSaveWorker();
      if (phase === 'ready') {
        worker.respond(prepareProjectSaveMessage(ctx.project));
        await ready();
      }
      useProjectSaveDialogStore.getState().request!.cancel();
      await expect(saving).resolves.toBe('cancelled');
      expect(pick).not.toHaveBeenCalled();
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(useStore.getState().dirty).toBe(true);
      expect(readAutosave()).toEqual(recovery);
    },
  );

  it('refuses normalization drift before the destination can be selected', async () => {
    const bad = { ...project(), workspace: { ...createProject().workspace, width: Number.NaN } };
    useStore.setState({ project: bad });
    const pick = vi.fn(async () => null);
    const ctx = context(pick);
    const saving = handleSaveProject(ctx);
    currentProjectSaveWorker().respond(prepareProjectSaveMessage(ctx.project));
    await expect(saving).resolves.toBe('error');
    expect(pick).not.toHaveBeenCalled();
    expect(useProjectSaveDialogStore.getState().request).toBeNull();
    expect(useStore.getState().dirty).toBe(true);
  });

  it.each([
    ['document', 'preparing'],
    ['request', 'preparing'],
    ['document', 'ready'],
    ['request', 'ready'],
  ] as const)(
    'cancels an unselected owner replaced by a newer %s at %s',
    async (replacement, phase) => {
      const pick = vi.fn(async () => null);
      const ctx = context(pick);
      const saving = handleSaveProject(ctx);
      if (phase === 'ready') {
        currentProjectSaveWorker().respond(prepareProjectSaveMessage(ctx.project));
        await ready();
      }
      if (replacement === 'document') useStore.getState().newProject();
      else useStore.getState().claimProjectSaveRequest();
      await expect(saving).resolves.toBe(`stale-${replacement}`);
      expect(pick).not.toHaveBeenCalled();
      expect(useProjectSaveDialogStore.getState().request).toBeNull();
    },
  );

  it('preserves a retained target write after a replacement document arrives during preparation', async () => {
    const write = vi.fn(async () => undefined);
    const pick = vi.fn(async () => null);
    const ctx = context(pick, { displayName: 'retained.lf2', write });
    const saving = handleSaveProject(ctx);
    const worker = currentProjectSaveWorker();
    expect(useProjectSaveDialogStore.getState().request).toBeNull();
    useStore.getState().newProject();
    worker.respond(prepareProjectSaveMessage(ctx.project));
    await expect(saving).resolves.toBe('stale-document');
    expect(pick).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(ctx.project.notes));
    expect(useStore.getState().savedName).toBeNull();
  });

  it('allows a later selected destination to save while an older large native picker is unresolved', async () => {
    let resolveOld = (_value: SaveTarget): void => undefined;
    const oldPicker = new Promise<SaveTarget>((resolve) => {
      resolveOld = resolve;
    });
    const oldWrite = vi.fn(async () => undefined);
    const newWrite = vi.fn(async () => undefined);
    const oldCtx = context(async () => oldPicker);
    const first = handleSaveProject(oldCtx);
    currentProjectSaveWorker().respond(prepareProjectSaveMessage(oldCtx.project));
    await ready();
    useProjectSaveDialogStore.getState().request!.choose();
    useStore.setState({
      project: { ...oldCtx.project, notes: 'newer selected destination' },
      dirty: true,
    });
    await expect(
      handleSaveProject(context(async () => ({ displayName: 'new.lf2', write: newWrite }))),
    ).resolves.toBe('saved');
    expect(newWrite).toHaveBeenCalledOnce();
    expect(oldWrite).not.toHaveBeenCalled();
    resolveOld({ displayName: 'old.lf2', write: oldWrite });
    await expect(first).resolves.toBe('stale-request');
    expect(oldWrite).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(oldCtx.project.notes));
    expect(useStore.getState().savedName).toBe('new.lf2');
  });

  it('keeps a pending New stopped when newer edits arrive during its large Save preparation', async () => {
    const ctx = context(async () => ({
      displayName: 'before-new.lf2',
      write: async () => undefined,
    }));
    const pendingNew = confirmDiscardAsync(ctx.platform, 'start a new project');
    useConfirmSaveStore.getState().choose('save');
    await vi.waitFor(() => expect(ProjectSaveTestWorker.instances).toHaveLength(1));
    const newer = { ...ctx.project, notes: 'keep these newer edits' };
    useStore.setState({ project: newer, dirty: true });
    currentProjectSaveWorker().respond(prepareProjectSaveMessage(ctx.project));
    await ready();
    useProjectSaveDialogStore.getState().request!.choose();
    await expect(pendingNew).resolves.toBe(false);
    expect(useStore.getState().project).toBe(newer);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('prepares raw large recovery separately and selects its new file only inside a fresh recovery gesture', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(true);
    const bad = { ...project(), workspace: { ...createProject().workspace, width: Number.NaN } };
    useStore.setState({ project: bad });
    const canonicalWrite = vi.fn(async () => undefined);
    const recoveryWrite = vi.fn(async () => undefined);
    let insideClick = false;
    const pick = vi.fn(async () => {
      expect(insideClick).toBe(true);
      return { displayName: 'untitled-recovery.lf2', write: recoveryWrite };
    });
    const ctx = context(pick, { displayName: 'canonical.lf2', write: canonicalWrite });
    const saving = handleSaveProject(ctx);
    currentProjectSaveWorker().respond(prepareProjectSaveMessage(bad));
    await vi.waitFor(() => expect(ProjectSaveTestWorker.instances).toHaveLength(2));
    expect(jobAwareConfirm).toHaveBeenCalledOnce();
    expect(pick).not.toHaveBeenCalled();
    expect(useProjectSaveDialogStore.getState().request?.purpose).toBe('recovery');
    expect(currentProjectSaveWorker().postMessage).toHaveBeenCalledExactlyOnceWith({
      project: bad,
      mode: 'recovery',
      representation: 'original',
    });
    const raw = prepareProjectRecoveryMessage(bad);
    currentProjectSaveWorker().respond(raw);
    await ready();
    insideClick = true;
    useProjectSaveDialogStore.getState().request!.choose();
    expect(pick).toHaveBeenCalledExactlyOnceWith({
      suggestedName: 'untitled-recovery.lf2',
      extensions: ['.lf2'],
    });
    insideClick = false;
    await expect(saving).resolves.toBe('error');
    expect(raw.kind).toBe('ok');
    if (raw.kind === 'ok') expect(recoveryWrite).toHaveBeenCalledExactlyOnceWith(raw.json);
    expect(canonicalWrite).not.toHaveBeenCalled();
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().savedName).toBeNull();
  });

  it('preserves canonical validation and a raw recovery offer for malformed scheduling fields', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(true);
    const bad = { ...createProject(), notes: null, embeddedFonts: [null] } as unknown as Project;
    useStore.setState({ project: bad });
    expect(() => projectSaveNeedsWorker(bad)).not.toThrow();
    expect(projectSaveNeedsWorker(bad)).toBe(false);
    const write = vi.fn(async () => undefined);
    const pick = vi.fn(async () => ({ displayName: 'untitled-recovery.lf2', write }));
    await expect(handleSaveProject(context(pick))).resolves.toBe('error');
    expect(jobAwareConfirm).toHaveBeenCalledOnce();
    expect(pick).toHaveBeenCalledExactlyOnceWith({
      suggestedName: 'untitled-recovery.lf2',
      extensions: ['.lf2'],
    });
    expect(write).toHaveBeenCalledOnce();
    expect(ProjectSaveTestWorker.instances).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(true);
  });
});
