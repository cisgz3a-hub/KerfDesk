import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectSaveRequestEpochCallbacks, projectWithLine } from '../../__fixtures__/file-actions';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_OUTPUT_SCOPE, type Project } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { serializeProject } from '../../io/project';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { useStore, type ImportOutcome } from '../state/store';
import { projectAutosaveService } from '../state/autosave-durable';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { resetStore } from '../state/test-helpers';
import { confirmDiscardAsync } from './confirm-discard';
import { handleFileShortcut, type FileCtx } from './shortcuts';

// A LightBurn project names no KerfDesk machine, so Ctrl+O opens it on the
// machine already open (ADR-388).
const TAG = `<LightBurnProject><Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1 0 0 1 20 20</XForm></Shape></LightBurnProject>`;

beforeEach(() => {
  resetStore();
  vi.spyOn(projectAutosaveService, 'clearCurrent').mockResolvedValue({ kind: 'ok' });
});

afterEach(() => {
  useConfirmSaveStore.getState().choose('cancel');
  useStore.getState().replaceDeviceProfile(DEFAULT_DEVICE_PROFILE);
  vi.restoreAllMocks();
});

describe('Ctrl+O on a LightBurn project', () => {
  it('opens it on the machine already open', async () => {
    useStore.getState().replaceDeviceProfile({
      ...DEFAULT_DEVICE_PROFILE,
      name: 'My 300x200 diode',
      bedWidth: 300,
      bedHeight: 200,
    });
    const setProject = vi.fn((_project: Project) => ({ kind: 'loaded' as const }));
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [{ name: 'tag.lbrn2', text: async () => TAG }],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };
    const event = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, cancelable: true });

    expect(handleFileShortcut(event, fileContext(platform, setProject))).toBe(true);

    await vi.waitFor(() => expect(setProject).toHaveBeenCalled());
    expect(useStore.getState().projectOpenRequestEpoch).toBe(1);
    expect(setProject.mock.calls[0]?.[0].device).toEqual(useStore.getState().project.device);
  });
});

function fileContext(platform: PlatformAdapter, setProject: FileCtx['setProject']): FileCtx {
  return {
    platform,
    project: createProject(),
    projectDocumentEpoch: 0,
    ...projectSaveRequestEpochCallbacks(),
    importSvgObject: vi.fn((): ImportOutcome => ({ kind: 'added' })),
    importRasterImage: vi.fn(),
    setProject,
    newProject: vi.fn(),
    savedName: null,
    jobPlacement: DEFAULT_JOB_PLACEMENT,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    machine: { statusReport: null, workOriginActive: false, wcoCache: null },
    controllerSettings: null,
    settingsCapability: 'grbl-dollar',
    lastSaveTarget: null,
    markSaved: vi.fn(),
    markLoaded: vi.fn(),
    pushToast: vi.fn(),
    confirmDiscard: vi.fn(async () => true),
  };
}

describe('Ctrl+O reserves its invocation before a save/discard question', () => {
  it('keeps a newer picker/read owned while an older Open waits for Save', async () => {
    const saved = heldSave();
    const read = deferred<string>();
    const olderPick = vi.fn(async () => [
      { name: 'older.lf2', text: async () => serializeProject(projectWithLine()) },
    ]);
    const newerRead = vi.fn(() => read.promise);
    const olderPlatform = openPlatform(olderPick);
    const newerPlatform = openPlatform(async () => [{ name: 'newer.lf2', text: newerRead }]);
    const olderConfirm = vi.fn((action: string) => confirmDiscardAsync(olderPlatform, action));
    const olderContext = { ...liveContext(olderPlatform), confirmDiscard: olderConfirm };
    handleFileShortcut(openEvent(), olderContext);
    useConfirmSaveStore.getState().choose('save');
    await vi.waitFor(() => expect(saved.write).toHaveBeenCalledOnce());
    handleFileShortcut(openEvent(), liveContext(newerPlatform));
    useConfirmSaveStore.getState().choose('discard');
    try {
      await vi.waitFor(() => expect(newerRead).toHaveBeenCalledOnce());
      saved.finish();
      const confirmation = olderConfirm.mock.results[0];
      if (confirmation?.type !== 'return') throw new Error('older confirmation missing');
      await confirmation.value;
      await Promise.resolve();
      expect(olderPick).not.toHaveBeenCalled();
      expect(useStore.getState().projectOpenRequestEpoch).toBe(2);
      read.resolve(serializeProject({ ...projectWithLine(), notes: 'Newest shortcut Open' }));
      await vi.waitFor(() => expect(useStore.getState().savedName).toBe('newer.lf2'));
      expect(useStore.getState().project.notes).toBe('Newest shortcut Open');
    } finally {
      saved.finish();
      read.resolve(serializeProject(projectWithLine()));
      await Promise.resolve();
    }
  });

  it('keeps an older delayed Open retired after the latest guard is cancelled', async () => {
    const olderGuard = deferred<boolean>();
    const pick = vi.fn(async () => []);
    const platform = openPlatform(pick);
    handleFileShortcut(openEvent(), {
      ...liveContext(platform),
      confirmDiscard: () => olderGuard.promise,
    });
    handleFileShortcut(openEvent(), {
      ...liveContext(platform),
      confirmDiscard: async () => false,
    });
    await Promise.resolve();
    olderGuard.resolve(true);
    await olderGuard.promise;
    await Promise.resolve();
    expect(pick).not.toHaveBeenCalled();
    expect(useStore.getState().projectOpenRequestEpoch).toBe(2);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function heldSave() {
  useStore.getState().setProject({ ...projectWithLine(), notes: 'Current job' });
  const gate = deferred<undefined>();
  const write = vi.fn((_contents: string | Blob) => gate.promise);
  useStore.setState({
    dirty: true,
    savedName: 'current.lf2',
    lastSaveTarget: { displayName: 'current.lf2', write },
  });
  return { write, finish: () => gate.resolve(undefined) };
}

function openPlatform(pickFilesForOpen: PlatformAdapter['pickFilesForOpen']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen,
    pickFileForSave: async () => null,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

function openEvent(): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, cancelable: true });
}

function liveContext(platform: PlatformAdapter): FileCtx {
  const state = useStore.getState();
  return {
    ...fileContext(platform, state.setProject),
    project: state.project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    markLoaded: state.markLoaded,
    confirmDiscard: (action) => confirmDiscardAsync(platform, action),
  };
}
