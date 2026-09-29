import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform, projectWithLine, toasts } from '../../__fixtures__/file-actions';
import { serializeProject } from '../../io/project';
import { useStore } from '../state';
import { clearAutosave } from '../state/autosave';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { isProjectFileName, openDroppedProject } from './dropped-project-open';
import { usePendingProjectOpenStore, type ExternalProjectOpenDeps } from './external-project-open';
import { createMemoryRecentProjectStorage } from './recent-project-storage';
import { configureRecentProjectsForTests } from './recent-projects-store';

/** jsdom's File has no text(); a browser's does. */
function droppedProject(name: string): File {
  const text = serializeProject({ ...projectWithLine(), notes: `dropped ${name}` });
  const file = new File([text], name);
  Object.defineProperty(file, 'text', { value: async () => text });
  return file;
}

function deps(jobActive = false) {
  const toast = toasts();
  const value: ExternalProjectOpenDeps = {
    platform: mockPlatform(),
    pushToast: toast.pushToast,
    jobActive: () => jobActive,
    dialogOpen: () => false,
  };
  return { ...value, messages: toast.messages };
}

beforeEach(() => {
  configureRecentProjectsForTests(createMemoryRecentProjectStorage());
  usePendingProjectOpenStore.setState({ file: null });
  useStore.getState().newProject();
  useStore.setState({ dirty: false, projectOpenRequestEpoch: 0 });
});

afterEach(() => {
  clearAutosave();
  configureRecentProjectsForTests(null);
  usePendingProjectOpenStore.setState({ file: null });
  useConfirmSaveStore.setState({ request: null });
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
});

describe('a project file dropped on the window (ADR-378 Amendment 1)', () => {
  it('knows KerfDesk and LightBurn projects by their extension', () => {
    expect(['a.lf2', 'B.LBRN', 'c.lbrn2'].map(isProjectFileName)).toEqual([true, true, true]);
    expect(['a.svg', 'lf2', 'a.lf2.svg', 'a.lbrn3'].map(isProjectFileName)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('opens a dropped project like one double-clicked in Explorer', async () => {
    const context = deps();
    expect(openDroppedProject([droppedProject('dropped.lf2')], context)).toBe(true);

    await vi.waitFor(() => expect(useStore.getState().savedName).toBe('dropped.lf2'));
    expect(useStore.getState().project.notes).toBe('dropped dropped.lf2');
    expect(context.messages).toContainEqual({ message: 'Opened dropped.lf2', variant: 'success' });
  });

  it('asks about unsaved changes first', async () => {
    useStore.setState({ dirty: true });
    const context = deps();
    openDroppedProject([droppedProject('dropped.lf2')], context);

    await vi.waitFor(() => expect(useConfirmSaveStore.getState().request).not.toBeNull());
    expect(useConfirmSaveStore.getState().request?.action).toBe('open another project');
    useConfirmSaveStore.getState().choose('cancel');
    await vi.waitFor(() => expect(useConfirmSaveStore.getState().request).toBeNull());
    expect(useStore.getState().savedName).not.toBe('dropped.lf2');
  });

  it('opens only the first project and says the rest of the drop was not imported', async () => {
    const context = deps();
    const drop = [
      new File(['<svg/>'], 'art.svg'),
      droppedProject('first.lf2'),
      droppedProject('second.lf2'),
    ];
    openDroppedProject(drop, context);

    await vi.waitFor(() => expect(useStore.getState().savedName).toBe('first.lf2'));
    expect(context.messages).toContainEqual({
      message:
        'Opening first.lf2. Ignored 2 other dropped file(s); drop artwork again once the project opens.',
      variant: 'warning',
    });
  });

  it('waits in the banner while a job runs', async () => {
    const context = deps(true);
    openDroppedProject([droppedProject('later.lf2')], context);

    await vi.waitFor(() =>
      expect(usePendingProjectOpenStore.getState().file?.name).toBe('later.lf2'),
    );
    expect(useStore.getState().savedName).not.toBe('later.lf2');
  });

  it('leaves a drop without a project to the importer', () => {
    const context = deps();
    expect(openDroppedProject([new File(['<svg/>'], 'art.svg')], context)).toBe(false);
    expect(context.messages).toEqual([]);
  });
});
