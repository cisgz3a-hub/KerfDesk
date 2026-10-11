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
  useDesignStudioStore.getState().openStudio();
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
        await vi.advanceTimersByTimeAsync(400);
      });
      const savedOwner = readPersistedSession()?.projectOwner;
      const stash = useDesignStudioStore.getState().stash;
      await act(async () => {
        if (change === 'added') useStore.getState().importSvgObject(svgObj('other', ['#000000']));
        else useStore.getState().removeSceneObject('other');
        await vi.advanceTimersByTimeAsync(400);
      });
      const project = useStore.getState().project;
      expect(useDesignStudioStore.getState().stash).toBe(stash);
      expect(designRecoveryOwner(project)).not.toBe(savedOwner);
      expect(readPersistedSession()?.projectOwner).toBe(designRecoveryOwner(project));
      const reopened = deserializeProject(serializeProject(project));
      if (reopened.kind !== 'ok') throw new Error('Project round trip failed');
      await act(async () => {
        useDesignStudioStore.setState({ session: null, stash: null, documentEpoch: -1 });
        useStore.setState({ project: reopened.project, projectDocumentEpoch: 1 });
        useDesignStudioStore.getState().openStudio();
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
      await vi.advanceTimersByTimeAsync(400);
    });
    const saved = readPersistedSession();
    const replacement = createProject();
    await act(async () => {
      useStore.getState().importSvgObject(svgObj('other', ['#000000']));
      useStore.setState({ project: replacement, projectDocumentEpoch: 1 });
      await vi.advanceTimersByTimeAsync(400);
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
