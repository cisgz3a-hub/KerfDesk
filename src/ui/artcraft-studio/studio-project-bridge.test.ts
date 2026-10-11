import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { studioDocument } from '../../io/project/studio-document.test-fixture';
import { getProjectSaveCheckpoint } from '../app/project-save-checkpoint';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { captureStudioDocument } from './artcraft-api';
import {
  bindStudioSession,
  checkpointStudioSessions,
  disposeStudioProjectBridge,
  getStudioBinding,
  unbindStudioSession,
  serializeStudioOperation,
  acceptStudioDocument,
} from './studio-project-bridge';

vi.mock('./artcraft-api', () => ({ captureStudioDocument: vi.fn() }));
const session = {
  id: 'live-a',
  documentId: '11111111-1111-4111-8111-111111111111',
  editor: 'vector' as const,
  title: 'Artwork',
  running: true,
};
beforeEach(() => {
  resetStore();
  vi.mocked(captureStudioDocument).mockReset();
});
afterEach(() => {
  disposeStudioProjectBridge();
  vi.useRealTimers();
  useToastStore.setState({ toasts: [] });
});

describe('project studio session bridge', () => {
  it('serializes Apply with recovery capture and accepts its frozen native bytes into the binding', async () => {
    bindStudioSession(session);
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = studioDocument();
    const applying = serializeStudioOperation(async () => {
      await waiting;
      return acceptStudioDocument(session.id, native, 0);
    });
    vi.mocked(captureStudioDocument).mockResolvedValue(native);
    const capture = checkpointStudioSessions();
    await Promise.resolve();
    expect(captureStudioDocument).not.toHaveBeenCalled();
    release();
    expect(await applying).toBe(true);
    await capture;
    expect(getStudioBinding(native.id)).toEqual(session);
    expect(useStore.getState().project.studioDocuments).toEqual([native]);
    expect(acceptStudioDocument(session.id, native, 99)).toBe(false);
    expect(() => acceptStudioDocument('foreign-session', native, 0)).toThrow('no longer belongs');
  });
  it('owns a session outside the panel lifecycle and checkpoints its native source for Save', async () => {
    const native = studioDocument();
    vi.mocked(captureStudioDocument).mockResolvedValue(native);
    expect(bindStudioSession(session, 0)).toBe(true);
    expect(getStudioBinding(native.id)).toEqual(session);
    const project = useStore.getState().project;
    const checkpoint = getProjectSaveCheckpoint();
    expect(checkpoint).not.toBeNull();
    if (checkpoint === null) throw new Error('Missing save checkpoint');
    const saved = await checkpoint({
      project,
      expectedProject: project,
      projectDocumentEpoch: 0,
      isCurrent: () => true,
    });
    expect(saved?.project.studioDocuments).toEqual([native]);
    expect(saved?.expectedProject).toBe(useStore.getState().project);
  });

  it('serializes overlapping captures instead of racing revisions', async () => {
    let release: (value: ReturnType<typeof studioDocument>) => void = () => undefined;
    vi.mocked(captureStudioDocument)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(
        studioDocument({ revision: 'revision-two', title: 'Updated artwork' }),
      );
    bindStudioSession(session);
    const first = checkpointStudioSessions();
    const second = checkpointStudioSessions();
    await vi.waitFor(() => expect(captureStudioDocument).toHaveBeenCalledTimes(1));
    release(studioDocument());
    await Promise.all([first, second]);
    expect(captureStudioDocument).toHaveBeenCalledTimes(2);
    expect(useStore.getState().project.studioDocuments?.[0]?.revision).toBe('revision-two');
  });

  it('clears bindings on New and discards in-flight native bytes for the previous owner', async () => {
    let release: (value: ReturnType<typeof studioDocument>) => void = () => undefined;
    vi.mocked(captureStudioDocument).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    bindStudioSession(session);
    const saving = checkpointStudioSessions();
    await vi.waitFor(() => expect(captureStudioDocument).toHaveBeenCalledOnce());
    useStore.getState().newProject();
    release(studioDocument());
    await saving;
    expect(getStudioBinding('11111111-1111-4111-8111-111111111111')).toBeUndefined();
    expect(useStore.getState().project.studioDocuments).toBeUndefined();
    expect(bindStudioSession(session, 0)).toBe(false);
  });

  it('surfaces capture failures and rejects another document identity', async () => {
    bindStudioSession(session);
    vi.mocked(captureStudioDocument).mockRejectedValueOnce(new Error('Native save failed'));
    await expect(checkpointStudioSessions()).rejects.toThrow('Native save failed');
    vi.mocked(captureStudioDocument).mockResolvedValueOnce(studioDocument({ id: 'foreign' }));
    await expect(checkpointStudioSessions()).rejects.toThrow('another studio session');
    expect(useStore.getState().project.studioDocuments).toBeUndefined();
  });

  it('does not publish a completed checkpoint if the bound session changed during export', async () => {
    let release: (value: ReturnType<typeof studioDocument>) => void = () => undefined;
    vi.mocked(captureStudioDocument).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    bindStudioSession(session);
    const saving = checkpointStudioSessions();
    await vi.waitFor(() => expect(captureStudioDocument).toHaveBeenCalledOnce());
    bindStudioSession({ ...session, id: 'replacement-session' });
    const rejected = expect(saving).rejects.toThrow('sessions changed');
    release(studioDocument());
    await rejected;
    expect(useStore.getState().project.studioDocuments).toBeUndefined();
  });

  it('does not overwrite a project Undo with a newer live native revision', async () => {
    bindStudioSession(session);
    vi.mocked(captureStudioDocument).mockResolvedValue(studioDocument());
    await checkpointStudioSessions();
    useStore.getState().undo();
    expect(getStudioBinding('11111111-1111-4111-8111-111111111111')).toBeUndefined();
    await expect(checkpointStudioSessions()).rejects.toThrow('Reopen it');
    expect(captureStudioDocument).toHaveBeenCalledTimes(1);
    unbindStudioSession('11111111-1111-4111-8111-111111111111');
    await checkpointStudioSessions();
    expect(captureStudioDocument).toHaveBeenCalledTimes(1);
  });

  it('periodically checkpoints native work and keeps failed captures visibly unsaved', async () => {
    vi.useFakeTimers();
    bindStudioSession(session);
    vi.mocked(captureStudioDocument).mockResolvedValue(studioDocument());
    await vi.advanceTimersByTimeAsync(5000);
    expect(useStore.getState().project.studioDocuments).toHaveLength(1);
    useStore.setState({ dirty: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(useStore.getState().dirty).toBe(false);
    vi.mocked(captureStudioDocument).mockRejectedValue(new Error('Capture failed'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(useStore.getState().dirty).toBe(true);
    expect(
      useToastStore.getState().toasts.filter((toast) => toast.message.includes('Capture failed')),
    ).toHaveLength(1);
    await expect(checkpointStudioSessions()).rejects.toThrow('Capture failed');
  });
});

it('captures the binding selected by a queued tab switch without a false recovery warning', async () => {
  bindStudioSession(session);
  const native = studioDocument();
  vi.mocked(captureStudioDocument).mockResolvedValue(native);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const switching = serializeStudioOperation(async () => {
    await gate;
    bindStudioSession({ ...session, id: 'restored-session' });
  });
  const checkpoint = checkpointStudioSessions();
  release();
  await switching;
  await checkpoint;
  expect(captureStudioDocument).toHaveBeenCalledWith('restored-session');
  expect(useStore.getState().project.studioDocuments).toEqual([native]);
});
