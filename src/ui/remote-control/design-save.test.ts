import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mockPlatform, projectWithLine } from '../../__fixtures__/file-actions';
import { useStore } from '../state/store';
import { saveProjectRemotely } from './design-save';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));
afterEach(() => vi.restoreAllMocks());
const save = () => saveProjectRemotely(useStore, mockPlatform(), (action) => action());

it.each([false, true])('does not report a failed write as saved when dirty=%s', async (dirty) => {
  const write = vi.fn(async () => {
    throw new Error('Disk unavailable');
  });
  useStore.setState({ dirty, lastSaveTarget: { displayName: 'existing.lf2', write } });
  expect(await save()).toMatchObject({ saved: false });
  expect(write).toHaveBeenCalledOnce();
  expect(useStore.getState().dirty).toBe(dirty);
});

it('reports actual successful persistence and clears the captured dirty document', async () => {
  const write = vi.fn(async () => undefined);
  useStore.setState({ dirty: true, lastSaveTarget: { displayName: 'existing.lf2', write } });
  expect(await save()).toMatchObject({ saved: true, message: 'Saved on the PC.' });
  expect(write).toHaveBeenCalledOnce();
  expect(useStore.getState().dirty).toBe(false);
});

it.each(['document', 'edits', 'request'] as const)(
  'retains save ownership across newer %s',
  async (change) => {
    let finish!: () => void;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    useStore.setState({ dirty: true, lastSaveTarget: { displayName: 'old.lf2', write } });
    const pending = save();
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    if (change === 'document') useStore.getState().newProject();
    else if (change === 'request') useStore.getState().claimProjectSaveRequest();
    else useStore.getState().importSvgObject(projectWithLine().scene.objects[0]!);
    const newer = useStore.getState();
    finish();
    const result = await pending;
    expect(result.saved).toBe(change === 'edits');
    if (change === 'edits') expect(result.message).toContain('Newer edits remain unsaved');
    expect(useStore.getState().project).toBe(newer.project);
    expect(useStore.getState().dirty).toBe(newer.dirty);
    if (change === 'document') expect(useStore.getState().lastSaveTarget).toBeNull();
  },
);

it('never opens a picker for a never-saved document', async () => {
  const picker = vi.fn(async () => null);
  const result = await saveProjectRemotely(useStore, mockPlatform({ save: picker }), (action) =>
    action(),
  );
  expect(result.saved).toBe(false);
  expect(picker).not.toHaveBeenCalled();
});
