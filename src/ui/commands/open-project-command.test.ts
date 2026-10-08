import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { SceneObject } from '../../core/scene';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { projectAutosaveService } from '../state/autosave-durable';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { resetStore } from '../state/test-helpers';
import { openProjectCommand } from './open-project-command';

describe('openProjectCommand', () => {
  beforeEach(() => {
    resetStore();
    vi.spyOn(projectAutosaveService, 'clearCurrent').mockResolvedValue({ kind: 'ok' });
  });
  afterEach(() => {
    useConfirmSaveStore.getState().choose('cancel');
    useStore.getState().replaceDeviceProfile(DEFAULT_DEVICE_PROFILE);
    vi.restoreAllMocks();
  });

  it('opens against the live document epoch and retains its success feedback', async () => {
    const opened = { ...projectWithLine(), notes: 'wrapper-owned document' };
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [
        { name: 'wrapper.lf2', text: async () => serializeProject(opened) },
      ],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };
    const pushToast = vi.fn();

    await openProjectCommand(platform, pushToast);

    expect(useStore.getState().project.notes).toBe('wrapper-owned document');
    expect(useStore.getState().savedName).toBe('wrapper.lf2');
    expect(useStore.getState().projectOpenRequestEpoch).toBe(1);
    expect(pushToast).toHaveBeenCalledWith('Opened wrapper.lf2', 'success');
  });

  it('opens a LightBurn project on the machine already open, with no machine banner', async () => {
    useStore.getState().replaceDeviceProfile({
      ...DEFAULT_DEVICE_PROFILE,
      profileId: 'my-diode',
      name: 'My 300x200 diode',
      bedWidth: 300,
      bedHeight: 200,
    });
    useStore.setState({ dirty: false });
    const machine = useStore.getState().project.device;
    // A 10 mm circle 50 mm right of and 50 mm in from a front-left origin.
    const coaster = `<LightBurnProject><Shape Type="Ellipse" CutIndex="0" Rx="5" Ry="5"><XForm>1 0 0 1 50 50</XForm></Shape></LightBurnProject>`;
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [{ name: 'coaster.lbrn2', text: async () => coaster }],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };

    await openProjectCommand(platform, vi.fn());

    const state = useStore.getState();
    expect(state.project.device).toEqual(machine);
    expect(state.project.workspace).toMatchObject({ width: 300, height: 200 });
    expect(state.projectBedReconciliation).toBeNull();
    expect(state.savedName).toBe('coaster.lf2');
    // Placed on this machine's 200 mm deep bed.
    expect(centreY(state.project.scene.objects[0])).toBeCloseTo(150, 6);
  });

  it('reserves Open before a slow Save so a newer Open keeps its invocation order', async () => {
    const saved = heldSave();
    const read = deferred<string>();
    const olderRead = vi.fn(async () => serializeProject(projectWithLine()));
    const newerRead = vi.fn(() => read.promise);
    const platform = mockOpenPlatform();
    const older = openProjectCommand(platform, vi.fn(), {
      file: { name: 'older.lf2', text: olderRead },
    });
    useConfirmSaveStore.getState().choose('save');
    await vi.waitFor(() => expect(saved.write).toHaveBeenCalledOnce());
    const newer = openProjectCommand(platform, vi.fn(), {
      file: { name: 'newer.lf2', text: newerRead },
    });
    useConfirmSaveStore.getState().choose('discard');
    try {
      await vi.waitFor(() => expect(newerRead).toHaveBeenCalledOnce());
      expect(useStore.getState().projectOpenRequestEpoch).toBe(2);
      saved.finish();
      await older;
      expect(olderRead).not.toHaveBeenCalled();
      expect(useStore.getState().projectOpenRequestEpoch).toBe(2);
      read.resolve(serializeProject({ ...projectWithLine(), notes: 'Newest Open remains owned' }));
      await newer;
      expect(useStore.getState().project.notes).toBe('Newest Open remains owned');
      expect(useStore.getState().savedName).toBe('newer.lf2');
    } finally {
      saved.finish();
      read.resolve(serializeProject(projectWithLine()));
      await Promise.all([older, newer]);
    }
  });

  it('a newer cancelled Open retires an older Open still waiting for Save', async () => {
    const saved = heldSave();
    const platform = mockOpenPlatform();
    const olderRead = vi.fn(async () => serializeProject(projectWithLine()));
    const older = openProjectCommand(platform, vi.fn(), {
      file: { name: 'older.lf2', text: olderRead },
    });
    useConfirmSaveStore.getState().choose('save');
    try {
      await vi.waitFor(() => expect(saved.write).toHaveBeenCalledOnce());
      const newer = openProjectCommand(platform, vi.fn(), {
        file: {
          name: 'cancelled.lf2',
          text: vi.fn(async () => serializeProject(projectWithLine())),
        },
      });
      useConfirmSaveStore.getState().choose('cancel');
      await newer;
      saved.finish();
      await older;
      expect(olderRead).not.toHaveBeenCalled();
      expect(useStore.getState().projectOpenRequestEpoch).toBe(2);
      expect(useStore.getState().project.notes).toBe('Current job');
      expect(useStore.getState().savedName).toBe('current.lf2');
    } finally {
      saved.finish();
      await older;
    }
  });

  it('New retires an Open whose clean-project guard has not resumed yet', async () => {
    const platform = mockOpenPlatform();
    const pending = openProjectCommand(platform, vi.fn());
    useStore.getState().newProject();
    const replacement = useStore.getState().project;
    await pending;
    expect(platform.pickFilesForOpen).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(replacement);
  });
});

function centreY(object: SceneObject | undefined): number {
  if (object?.kind !== 'imported-svg') throw new Error('circle missing');
  return (object.bounds.minY + object.bounds.maxY) / 2;
}

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

function mockOpenPlatform(): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async () => []),
    pickFileForSave: async () => null,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}
