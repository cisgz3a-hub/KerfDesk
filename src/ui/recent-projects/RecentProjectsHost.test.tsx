import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import { serializeProject } from '../../io/project';
import type { ExternalFileOpenRequest, PlatformAdapter } from '../../platform/types';
import { mockPlatform, projectWithLine } from '../../__fixtures__/file-actions';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { clearAutosave } from '../state/autosave';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useUiStore } from '../state/ui-store';
import { usePendingProjectOpenStore } from './external-project-open';
import { createMemoryRecentProjectStorage } from './recent-project-storage';
import { configureRecentProjectsForTests, useRecentProjectsStore } from './recent-projects-store';
import { RecentProjectsHost } from './RecentProjectsHost';

let host: HTMLDivElement;
let root: Root;
let emit: (request: ExternalFileOpenRequest) => void;
let unsubscribe = vi.fn<() => void>();

function platform(): PlatformAdapter {
  unsubscribe = vi.fn();
  return {
    ...mockPlatform(),
    externalFileOpens: {
      subscribe: (listener) => {
        emit = listener;
        return unsubscribe;
      },
    },
  };
}

function fileRequest(name: string): ExternalFileOpenRequest {
  const text = serializeProject({ ...projectWithLine(), notes: `opened ${name}` });
  return { kind: 'file', file: { name, text: async () => text } };
}

function startJob(): void {
  useLaserStore.setState({ streamer: { ...createStreamer('G1 X1'), status: 'streaming' } });
}

function banner(): HTMLElement | null {
  return host.querySelector('[aria-label="Project waiting to open"]');
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === label,
  );
  if (found === undefined) throw new Error(`No ${label} button`);
  return found;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  configureRecentProjectsForTests(createMemoryRecentProjectStorage());
  useLaserStore.setState(initialLaserState());
  usePendingProjectOpenStore.setState({ file: null });
  useStore.getState().newProject();
  useStore.setState({ dirty: false, projectOpenRequestEpoch: 0 });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <PlatformProvider adapter={platform()}>
        <RecentProjectsHost />
      </PlatformProvider>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearAutosave();
  configureRecentProjectsForTests(null);
  useLaserStore.setState(initialLaserState());
  usePendingProjectOpenStore.setState({ file: null });
  useUiStore.setState({ modalDepth: 0 });
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
  vi.unstubAllGlobals();
});

describe('Recent Projects host', () => {
  it('opens a file the operating system hands over while no job runs', async () => {
    await act(async () => emit(fileRequest('explorer.lf2')));
    await vi.waitFor(() => expect(useStore.getState().savedName).toBe('explorer.lf2'));
    expect(banner()).toBeNull();
  });

  it('holds a file handed over during a job until the operator opens it afterwards', async () => {
    startJob();
    const before = useStore.getState().project;
    await act(async () => emit(fileRequest('next.lf2')));

    expect(useStore.getState().project).toBe(before);
    expect(banner()?.textContent).toContain(
      "next.lf2 is waiting to open. KerfDesk won't replace the project while a job is running.",
    );
    expect(button('Open project').disabled).toBe(true);

    await act(async () => useLaserStore.setState({ streamer: null }));
    expect(banner()?.textContent).not.toContain('job is running');
    expect(button('Open project').disabled).toBe(false);

    await act(async () => button('Open project').click());
    await vi.waitFor(() => expect(useStore.getState().savedName).toBe('next.lf2'));
    expect(banner()).toBeNull();
  });

  it('keeps the project under an open dialog and offers the file once it closes', async () => {
    useUiStore.setState({ modalDepth: 1 });
    const before = useStore.getState().project;
    await act(async () => emit(fileRequest('later.lf2')));

    expect(useStore.getState().project).toBe(before);
    expect(banner()?.textContent).toContain('later.lf2 is waiting to open.');
    await act(async () => useUiStore.setState({ modalDepth: 0 }));
    await act(async () => button('Open project').click());
    await vi.waitFor(() => expect(useStore.getState().savedName).toBe('later.lf2'));
  });

  it('lets the operator dismiss a waiting file', async () => {
    startJob();
    await act(async () => emit(fileRequest('next.lf2')));
    await act(async () => button('Dismiss').click());

    expect(banner()).toBeNull();
    expect(usePendingProjectOpenStore.getState().file).toBeNull();
  });

  it('shows the Recent Projects manager when File > Recent Projects asks for it', async () => {
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => useRecentProjectsStore.getState().openDialog());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Recent Projects');
  });

  it('stops listening when it unmounts', async () => {
    await act(async () => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    root = createRoot(host);
  });
});
