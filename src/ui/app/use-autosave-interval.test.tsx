import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addLayer, addObject, createLayer } from '../../core/scene';
import { useStore } from '../state';
import { AUTOSAVE_INTERVAL_MS, clearAutosave } from '../state/autosave';
import * as autosave from '../state/autosave';
import { projectAutosaveService, type AutosaveDurableWriteResult } from '../state/autosave-durable';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { resetStore, svgObj } from '../state/test-helpers';
import { useAutosave } from './use-autosave';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const WRITTEN = {
  kind: 'ok',
  savedAt: 1,
  storageKey: 'autosave-hook-test',
  backend: 'indexeddb',
} as const;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function HookProbe(): null {
  useAutosave();
  return null;
}

async function mountHook(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<HookProbe />));
}

async function tick(count = 1): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS * count));
}

function mockWriter() {
  return vi.spyOn(projectAutosaveService, 'write').mockResolvedValue(WRITTEN);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  const project = projectWithCurrentJobSetup(useStore.getState());
  const scene = ['A', 'B', 'C'].reduce(
    (current, id) => addObject(current, svgObj(id, ['#000000'])),
    addLayer(project.scene, createLayer({ id: '#000000', color: '#000000' })),
  );
  useStore.setState({ project: { ...project, scene }, dirty: true });
  vi.spyOn(projectAutosaveService, 'session').mockResolvedValue({
    sessionId: 'autosave-hook-test',
    ownership: 'owned',
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  resetStore();
});

describe('useAutosave interval snapshots', () => {
  it('saves an unchanged dirty scene once across repeated ticks and pointer updates', async () => {
    const write = mockWriter();
    const source = useStore.getState().project;
    await mountHook();
    await tick();
    for (let x = 0; x < 4; x++) {
      useStore.getState().setCursorMm({ x, y: 1 });
      await tick();
    }

    expect(useStore.getState().project).toBe(source);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toEqual(projectWithCurrentJobSetup(useStore.getState()));
  });

  it('saves current placement, selected-only scope, and ordered selection changes', async () => {
    const write = mockWriter();
    await mountHook();
    await tick();
    useStore.getState().setJobPlacement({ startFrom: 'user-origin', anchor: 'center' });
    await tick();
    useStore.getState().setOutputScopeSettings({
      cutSelectedGraphics: true,
      useSelectionOrigin: true,
    });
    useStore.getState().selectObjects(['A', 'B', 'C']);
    await tick();
    expect(write.mock.calls[2]?.[0].jobSetup).toEqual({
      placement: { startFrom: 'user-origin', anchor: 'center' },
      outputScope: {
        cutSelectedGraphics: true,
        useSelectionOrigin: true,
        selectedObjectIds: ['A', 'B', 'C'],
      },
    });
    useStore.getState().selectObjects(['C', 'A']);
    await tick(3);

    expect(write).toHaveBeenCalledTimes(4);
    expect(write.mock.calls[3]?.[0]).toEqual(projectWithCurrentJobSetup(useStore.getState()));
  });

  it('preserves saved selection even outside selected-only output without rewriting equal sets', async () => {
    const write = mockWriter();
    const source = useStore.getState().project;
    useStore.getState().selectObjects(['A', 'B', 'C']);
    await mountHook();
    await tick();
    useStore.getState().selectObjects(['A', 'B', 'C']);
    useStore.setState((state) => ({
      jobPlacement: { ...state.jobPlacement },
      outputScopeSettings: { ...state.outputScopeSettings },
    }));
    await tick(2);
    expect(write).toHaveBeenCalledTimes(1);

    useStore.setState({ additionalSelectedIds: new Set(['C', 'B']) });
    await tick(2);
    expect(useStore.getState().project).toBe(source);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0].jobSetup.outputScope).toEqual({
      cutSelectedGraphics: false,
      useSelectionOrigin: false,
      selectedObjectIds: ['A', 'C', 'B'],
    });
  });

  it('writes an edited scene and re-arms an unchanged snapshot after the slot is cleared', async () => {
    const write = mockWriter();
    await mountHook();
    await tick();
    useStore.setState((state) => ({ project: { ...state.project, notes: 'new artwork notes' } }));
    await tick(2);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0].notes).toBe('new artwork notes');
    clearAutosave();
    await tick(3);
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls[2]?.[0]).toBe(write.mock.calls[1]?.[0]);
  });

  it('does not let an older in-flight save memo suppress a reopened document', async () => {
    let finishFirst: (result: AutosaveDurableWriteResult) => void = () => undefined;
    const firstWrite = new Promise<AutosaveDurableWriteResult>((resolve) => {
      finishFirst = resolve;
    });
    const write = mockWriter().mockImplementationOnce(() => firstWrite);
    const source = useStore.getState().project;
    const originalEpoch = useStore.getState().projectDocumentEpoch;
    await mountHook();
    await tick();
    useStore.getState().setProject(source);
    expect(useStore.getState().project).toBe(source);
    expect(useStore.getState().projectDocumentEpoch).toBe(originalEpoch + 1);
    await tick();
    expect(useStore.getState().dirty).toBe(false);
    useStore.setState({ dirty: true });
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => finishFirst(WRITTEN));
    await tick(3);

    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]?.[0]).not.toBe(write.mock.calls[0]?.[0]);
    expect(write.mock.calls[1]?.[0]).toEqual(write.mock.calls[0]?.[0]);
    expect(useStore.getState().project).toBe(source);
    expect(projectAutosaveService.session).toHaveBeenCalledTimes(1);
  });

  it('keeps before-unload writes current even after a successful interval save', async () => {
    const write = mockWriter();
    const writeOnUnload = vi.spyOn(autosave, 'writeAutosave').mockReturnValue({
      kind: 'ok',
      savedAt: 1,
      storageKey: 'autosave-hook-test',
    });
    await mountHook();
    await tick(2);
    useStore.getState().setJobPlacement({ anchor: 'back-right' });
    window.dispatchEvent(new Event('beforeunload'));

    expect(write).toHaveBeenCalledTimes(1);
    expect(writeOnUnload).toHaveBeenCalledTimes(1);
    expect(writeOnUnload.mock.calls[0]?.[0]).toEqual(
      projectWithCurrentJobSetup(useStore.getState()),
    );
  });
});
