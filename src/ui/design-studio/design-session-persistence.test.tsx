import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Sketch } from '../../core/design';
import { createProject } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { designRecoveryOwner } from './design-recovery-owner';
import { sessionSketch } from './design-session';
import { clearPersistedSession, readPersistedSession } from './design-session-storage';
import { useDesignStudioStore } from './design-studio-store';
import { useDesignSessionPersistence } from './use-design-session-persistence';
import { RecoveryHash } from './design-recovery-hash';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const drawing: Sketch = {
  entities: [{ id: 'line', kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }],
};
const draft: Sketch = {
  entities: [
    ...drawing.entities,
    { id: 'draft', kind: 'line', start: { x: 0, y: 0 }, end: { x: 15, y: 5 } },
  ],
};

function Persistence() {
  useDesignSessionPersistence();
  return null;
}

function createClosedDraft(): void {
  useStore.getState().applyDesignSketch(drawing, ['owned'], null);
  void useDesignStudioStore.getState().openStudio();
  useDesignStudioStore.getState().setSketch(draft);
  useDesignStudioStore.getState().closeStudio();
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  clearPersistedSession();
  useDesignStudioStore.setState({ session: null, stash: null, documentEpoch: -1 });
});

afterEach(() => {
  vi.useRealTimers();
  clearPersistedSession();
});

it.each(['added', 'deleted'] as const)(
  'recovers a closed draft after unrelated artwork is %s and the project is saved/reopened',
  async (change) => {
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Persistence />));
      await act(async () => {
        if (change === 'deleted') useStore.getState().importSvgObject(svgObj('other', ['#000000']));
        createClosedDraft();
        await vi.runAllTimersAsync();
      });
      const savedOwner = readPersistedSession()?.projectOwner;
      const stash = useDesignStudioStore.getState().stash;
      await act(async () => {
        if (change === 'added') useStore.getState().importSvgObject(svgObj('other', ['#000000']));
        else useStore.getState().removeSceneObject('other');
        await vi.runAllTimersAsync();
      });
      const project = useStore.getState().project;
      expect(useDesignStudioStore.getState().stash).toBe(stash);
      expect(await designRecoveryOwner(project)).not.toBe(savedOwner);
      expect(readPersistedSession()?.projectOwner).toBe(await designRecoveryOwner(project));
      const reopened = deserializeProject(serializeProject(project));
      if (reopened.kind !== 'ok') throw new Error('Project round trip failed');
      await act(async () => {
        useDesignStudioStore.setState({ session: null, stash: null, documentEpoch: -1 });
        useStore.setState({ project: reopened.project, projectDocumentEpoch: 1 });
        const opening = useDesignStudioStore.getState().openStudio();
        await vi.runAllTimersAsync();
        await opening;
      });
      expect(sessionSketch(useDesignStudioStore.getState().session!).entities).toEqual(
        draft.entities,
      );
      expect(useDesignStudioStore.getState().session?.dirtySinceApply).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  },
);

it('does not attach a pending owner refresh to a replacement project', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Persistence />));
    await act(async () => {
      createClosedDraft();
      await vi.runAllTimersAsync();
    });
    const saved = readPersistedSession();
    const replacement = createProject();
    await act(async () => {
      useStore.getState().importSvgObject(svgObj('other', ['#000000']));
      useStore.setState({ project: replacement, projectDocumentEpoch: 1 });
      await vi.runAllTimersAsync();
    });
    expect(readPersistedSession()).toEqual(saved);
    expect(useDesignStudioStore.getState().stash).toBeNull();
    await act(async () => useDesignStudioStore.getState().openStudio());
    expect(sessionSketch(useDesignStudioStore.getState().session!).entities).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(readPersistedSession()?.sketch.entities).toEqual([]);
  } finally {
    await act(async () => root.unmount());
  }
});

function createLargeClosedDraft(points: number): void {
  const sketch: Sketch = {
    entities: [
      {
        id: 'large',
        kind: 'path',
        construction: true,
        closed: false,
        points: Array.from({ length: points }, (_, index) => ({ x: index, y: index })),
      },
    ],
  };
  useStore.getState().applyDesignSketch(sketch, ['unused'], null);
  void useDesignStudioStore.getState().openStudio();
  useDesignStudioStore.getState().setSketch(draft);
  useDesignStudioStore.getState().closeStudio();
}

it.each(['unmount', 'pagehide'] as const)(
  'finishes only remaining owner slices and flushes synchronously at %s',
  async (teardown) => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Persistence />));
    createLargeClosedDraft(60_000);
    const pending = designRecoveryOwner(useStore.getState().project);
    expect(pending).toBeInstanceOf(Promise);
    vi.advanceTimersByTime(0); // Complete one bounded slice, leaving the owner pending.
    expect(readPersistedSession()).toBeNull();
    const finish = vi.spyOn(RecoveryHash.prototype, 'finishAtTeardown');
    await act(async () => {
      if (teardown === 'unmount') root.unmount();
      else window.dispatchEvent(new Event('pagehide'));
      // No microtask/task is available after a document unload.
      expect(readPersistedSession()?.sketch).toEqual(draft);
      expect(readPersistedSession()?.projectOwner).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(finish).toHaveBeenCalledTimes(1);
    });
    expect(readPersistedSession()?.projectOwner).toBe(await pending);
    if (teardown === 'pagehide') await act(async () => root.unmount());
    finish.mockRestore();
  },
);

it('cancels obsolete project hashes during a mutation burst and keeps normal saves yielding', async () => {
  const root = createRoot(document.createElement('div'));
  const finish = vi.spyOn(RecoveryHash.prototype, 'finishAtTeardown');
  try {
    await act(async () => root.render(<Persistence />));
    createLargeClosedDraft(60_000);
    const project = useStore.getState().project;
    for (let index = 0; index < 20; index++) {
      useStore.setState({
        project: {
          ...project,
          scene: { ...project.scene, objects: [svgObj(`other-${index}`, ['#000000'])] },
        },
      });
      // One owner task and one save debounce; obsolete walks do not accumulate.
      expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
    }
    expect(readPersistedSession()).toBeNull();
    await vi.runAllTimersAsync();
    expect(finish).not.toHaveBeenCalled();
    expect(readPersistedSession()?.projectOwner).toBe(
      await designRecoveryOwner(useStore.getState().project),
    );
    expect(readPersistedSession()?.sketch).toEqual(draft);
  } finally {
    finish.mockRestore();
    await act(async () => root.unmount());
  }
});

it('does not publish a save whose large owner is still hashing when the project is replaced', async () => {
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Persistence />));
    createLargeClosedDraft(1_000_000);
    await vi.advanceTimersByTimeAsync(400);
    expect(designRecoveryOwner(useStore.getState().project)).toBeInstanceOf(Promise);
    expect(readPersistedSession()).toBeNull();
    useStore.setState({ project: createProject(), projectDocumentEpoch: 1 });
    await vi.runAllTimersAsync();
    expect(readPersistedSession()).toBeNull();
    expect(useDesignStudioStore.getState().stash).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
}, 20_000);
