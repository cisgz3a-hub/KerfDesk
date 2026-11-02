// L5-P1-2 (rolling audit v7): opening Design Studio on a project whose recovery
// key differed from the saved drawing's dropped the drawing and wrote over its
// only copy. It is now kept, comes back with its project, and can be restored
// (ADR-590 Amendment 1). N5-P2-2 (rolling audit v8): a drawing applied after
// the last autosave was still written over, so it is kept too (Amendment 2).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sketch, SketchEntity } from '../../core/design';
import { DEFAULT_DESIGN_LAYER_ID } from '../../core/design/layers';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { sessionSketch } from './design-session';
import { clearPersistedSession, readPersistedSession } from './design-session-storage';
import {
  clearKeptDesignDrawings,
  keepDesignDrawing,
  readKeptDesignDrawings,
  worthKeeping,
} from './design-kept-drawings';
import { restoreKeptDesignDrawing } from './design-kept-drawing-actions';
import { DesignKeptDrawingBar } from './DesignKeptDrawingBar';
import { useDesignStudioStore } from './design-studio-store';
import { useDesignSessionPersistence } from './use-design-session-persistence';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function line(id: string, x: number): SketchEntity {
  return { id, kind: 'line', start: { x, y: 0 }, end: { x: x + 10, y: 10 } };
}
const applied: Sketch = { entities: [line('applied', 0)] };
const drawing: Sketch = { entities: [line('applied', 0), line('l1', 20), line('l2', 40)] };

function Persistence() {
  useDesignSessionPersistence();
  return null;
}

let root: ReturnType<typeof createRoot> | null = null;
async function mountPersistence(): Promise<void> {
  root = createRoot(document.createElement('div'));
  await act(async () => root?.render(<Persistence />));
}

/** What a restart restores: the project file round trip the autosave makes. */
function autosaveOf(project: Project): Project {
  const reopened = deserializeProject(serializeProject(project));
  if (reopened.kind !== 'ok') throw new Error('Project round trip failed');
  return reopened.project;
}

/** Applies one line, then draws two more without applying and closes. */
async function drawUnappliedWork(): Promise<void> {
  useStore.getState().applyDesignSketch(applied, ['applied-output'], null);
  await act(async () => {
    const opening = useDesignStudioStore.getState().openStudio();
    await vi.runAllTimersAsync();
    await opening;
    useDesignStudioStore.getState().setSketch(drawing);
    useDesignStudioStore.getState().closeStudio();
    await vi.runAllTimersAsync();
  });
}

/** The Studio's Apply, as its Apply button runs it (use-design-apply). */
function applyInStudio(): void {
  const session = useDesignStudioStore.getState().session;
  if (session === null) throw new Error('The Studio is closed');
  const sketch = sessionSketch(session);
  const record = useStore.getState().applyDesignSketch(
    sketch,
    sketch.entities.map(() => crypto.randomUUID()),
    session.applied,
    { activeLayerId: session.activeLayerId, surface3d: session.surface3d },
  );
  if (record === 'refused') throw new Error('Apply refused');
  useDesignStudioStore.getState().markApplied(record);
}

/** Applies one line in the Studio and autosaves; then, inside the 30 s before
 *  the next autosave, draws two more, applies all three and closes. */
async function applyAfterTheAutosave(): Promise<Project> {
  await act(async () => {
    const opening = useDesignStudioStore.getState().openStudio();
    await vi.runAllTimersAsync();
    await opening;
    useDesignStudioStore.getState().setSketch(applied);
    applyInStudio();
    await vi.runAllTimersAsync();
  });
  const autosave = autosaveOf(useStore.getState().project);
  await act(async () => {
    useDesignStudioStore.getState().setSketch(drawing);
    applyInStudio();
    useDesignStudioStore.getState().closeStudio();
    await vi.runAllTimersAsync();
  });
  return autosave;
}

/** A project with a Studio drawing of its own that shares nothing with these. */
function anotherProject(sketch: Sketch = { entities: [line('other', 70)] }): Project {
  return {
    ...createProject(),
    designStudioDocument: {
      version: 1,
      sketch,
      activeLayerId: DEFAULT_DESIGN_LAYER_ID,
      surface3d: false,
      appliedObjectIds: [],
      appliedOperationsByLayer: [],
      appliedEntityObjectIds: [],
    },
  };
}

async function restart(project: Project, epoch: number): Promise<void> {
  await act(async () => {
    useDesignStudioStore.setState({ session: null, stash: null, documentEpoch: -1 });
    useStore.setState({ project, projectDocumentEpoch: epoch });
    await vi.runAllTimersAsync();
  });
}

async function openStudio(): Promise<Sketch> {
  await act(async () => {
    const opening = useDesignStudioStore.getState().openStudio();
    await vi.runAllTimersAsync();
    await opening;
  });
  return sessionSketch(useDesignStudioStore.getState().session!);
}

/** The project identity is hashed on timers, so they run while it restores. */
async function restoring(id: string): Promise<boolean> {
  let restored: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    restored = restoreKeptDesignDrawing(id);
    await vi.runAllTimersAsync();
  });
  return restored;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  clearPersistedSession();
  clearKeptDesignDrawings();
  useDesignStudioStore.setState({ session: null, stash: null, documentEpoch: -1 });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearPersistedSession();
  clearKeptDesignDrawings();
});

describe('a drawing the Studio did not open is kept (ADR-590 Amendment 1)', () => {
  it('survives opening the Studio on the blank start-up project first', async () => {
    await mountPersistence();
    await drawUnappliedWork();
    const autosave = autosaveOf(useStore.getState().project);

    await restart(createProject(), 0);
    expect((await openStudio()).entities).toEqual([]);
    expect(readPersistedSession()?.sketch.entities ?? []).toEqual([]);
    expect(readKeptDesignDrawings().map((kept) => kept.sketch)).toEqual([drawing]);

    // Restoring the autosave brings the project back, and its drawing with it.
    await act(async () => {
      useStore.setState({ project: autosave, projectDocumentEpoch: 1 });
      await vi.runAllTimersAsync();
    });
    expect(sessionSketch(useDesignStudioStore.getState().session!)).toEqual(drawing);
    expect(useDesignStudioStore.getState().session?.dirtySinceApply).toBe(true);
    expect(readKeptDesignDrawings()).toEqual([]);
  });

  it('is offered back after restoring an autosave older than the drawing', async () => {
    await mountPersistence();
    useStore.getState().applyDesignSketch(applied, ['applied-output'], null);
    const olderAutosave = autosaveOf(useStore.getState().project);
    await drawUnappliedWork();
    // Any workspace change after the last autosave gives the drawing a new key.
    await act(async () => {
      useStore.getState().importSvgObject(svgObj('later', ['#000000']));
      await vi.runAllTimersAsync();
    });

    await restart(olderAutosave, 1);
    expect((await openStudio()).entities.map((entity) => entity.id)).toEqual(['applied']);
    const kept = readKeptDesignDrawings();
    expect(kept.map((entry) => entry.sketch)).toEqual([drawing]);

    expect(await restoring(kept[0]!.id)).toBe(true);
    expect(sessionSketch(useDesignStudioStore.getState().session!)).toEqual(drawing);
    // The project's own drawing had nothing unapplied, so nothing else is kept.
    expect(readKeptDesignDrawings()).toEqual([]);
    expect(readPersistedSession()?.sketch).toEqual(drawing);
  });

  it('offers back a drawing applied after the autosave a restart restores', async () => {
    await mountPersistence();
    const olderAutosave = await applyAfterTheAutosave();
    expect(readPersistedSession()).toMatchObject({ sketch: drawing, dirtySinceApply: false });
    expect(useStore.getState().project.scene.objects).toHaveLength(3);

    // The crash loses the Apply from the workspace, as it loses any edit after
    // the autosave; the Studio's own copy of it is kept.
    await restart(olderAutosave, 1);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
    expect((await openStudio()).entities.map((entity) => entity.id)).toEqual(['applied']);
    const kept = readKeptDesignDrawings();
    expect(kept.map((entry) => entry.sketch)).toEqual([drawing]);

    expect(await restoring(kept[0]!.id)).toBe(true);
    expect(sessionSketch(useDesignStudioStore.getState().session!)).toEqual(drawing);
    // Applied to the lost project, not this one: Apply is on, and puts it back.
    expect(useDesignStudioStore.getState().session?.dirtySinceApply).toBe(true);
    await act(async () => {
      applyInStudio();
      await vi.runAllTimersAsync();
    });
    expect(useStore.getState().project.scene.objects).toHaveLength(3);
    expect(useStore.getState().project.designStudioDocument?.sketch).toEqual(drawing);
  });

  it('keeps that drawing when the restart opens the Studio before any restore', async () => {
    await mountPersistence();
    await applyAfterTheAutosave();
    await restart(createProject(), 0);
    expect((await openStudio()).entities).toEqual([]);
    expect(readKeptDesignDrawings().map((kept) => kept.sketch)).toEqual([drawing]);
  });

  // Amendment 2 did not keep it: the other project shares nothing with it. No
  // file or autosave holds this Apply, so Amendment 3 keeps it (R6-P1-1).
  it('keeps an Apply no copy holds for another project with its own drawing', async () => {
    await mountPersistence();
    await applyAfterTheAutosave();
    await restart(anotherProject(), 1);
    expect((await openStudio()).entities.map((entity) => entity.id)).toEqual(['other']);
    expect(readKeptDesignDrawings().map((kept) => kept.sketch)).toEqual([drawing]);
  });

  it('stops offering an applied drawing once a project that holds it opens', async () => {
    keepDesignDrawing({
      sketch: drawing,
      activeLayerId: DEFAULT_DESIGN_LAYER_ID,
      surface3d: false,
      applied: null,
      dirtySinceApply: false,
    });
    await restart(anotherProject(drawing), 1);
    expect(await openStudio()).toEqual(drawing);
    expect(readKeptDesignDrawings()).toEqual([]);
  });

  it('keeps the replaced drawing when a restore would cover unapplied work', async () => {
    useStore.setState({ project: createProject(), projectDocumentEpoch: 1 });
    keepDesignDrawing({
      sketch: drawing,
      activeLayerId: 'layer-1',
      surface3d: false,
      applied: null,
    });
    await openStudio();
    const current: Sketch = { entities: [line('current', 90)] };
    useDesignStudioStore.getState().setSketch(current);
    expect(await restoring(readKeptDesignDrawings()[0]!.id)).toBe(true);
    expect(sessionSketch(useDesignStudioStore.getState().session!)).toEqual(drawing);
    expect(readKeptDesignDrawings().map((kept) => kept.sketch)).toEqual([current]);
  });

  it('holds the saved drawing rather than write over it when it cannot be kept', async () => {
    await mountPersistence();
    await drawUnappliedWork();
    const saved = readPersistedSession();
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.includes('kept-drawings')) throw new Error('QuotaExceededError');
      setItem.call(this, key, value);
    });
    await restart(createProject(), 2);
    expect((await openStudio()).entities).toEqual([]);
    useDesignStudioStore.getState().setSketch({ entities: [line('new', 5)] });
    await act(async () => vi.runAllTimersAsync());
    expect(readPersistedSession()).toEqual(saved);
  });
});

describe('the kept drawings list', () => {
  const draft = (id: string) => ({
    sketch: { entities: [line(id, 0)] },
    activeLayerId: 'layer-1',
    surface3d: false,
    applied: null,
  });

  it('keeps the newest five, newest first, and an identical drawing once', () => {
    for (let index = 0; index < 7; index++) keepDesignDrawing(draft(`d${index}`), 1000 + index);
    keepDesignDrawing(draft('d6'), 2000);
    expect(readKeptDesignDrawings().map((kept) => kept.sketch.entities[0]?.id)).toEqual([
      'd6',
      'd5',
      'd4',
      'd3',
      'd2',
    ]);
  });

  it('keeps unapplied work, and an Apply that only the drawing holds', () => {
    const blank = createProject();
    const appliedDraft = { ...draft('a'), dirtySinceApply: false };
    expect(worthKeeping(draft('a'), anotherProject(draft('a').sketch))).toBe(true);
    expect(worthKeeping({ ...draft('a'), sketch: { entities: [] } }, blank)).toBe(false);
    // Applied: kept unless the opened project holds it, or a file or an
    // autosave does (Amendment 3).
    const onlyCopy = { ...appliedDraft, projectHoldsApply: false };
    const held = { ...appliedDraft, projectHoldsApply: true };
    expect(worthKeeping(onlyCopy, anotherProject(draft('a').sketch))).toBe(false);
    expect(worthKeeping(onlyCopy, blank)).toBe(true);
    expect(worthKeeping(onlyCopy, anotherProject())).toBe(true);
    expect(worthKeeping(held, blank)).toBe(false);
    expect(worthKeeping(held, anotherProject())).toBe(false);
    // A drawing saved before Amendment 3 does not say, so Amendment 2's guess
    // stands: kept unless another project's drawing shares nothing with it.
    expect(worthKeeping(appliedDraft, anotherProject(draft('a').sketch))).toBe(false);
    expect(worthKeeping(appliedDraft, blank)).toBe(true);
    expect(worthKeeping(appliedDraft, anotherProject())).toBe(false);
    const grown = { ...appliedDraft, sketch: { entities: [line('a', 0), line('b', 20)] } };
    expect(worthKeeping(grown, anotherProject(draft('a').sketch))).toBe(true);
  });

  it('names a kept drawing that was applied elsewhere', async () => {
    keepDesignDrawing({ ...draft('elsewhere'), dirtySinceApply: false });
    const host = document.createElement('div');
    const bar = createRoot(host);
    try {
      await act(async () => bar.render(<DesignKeptDrawingBar />));
      expect(host.textContent).toContain(
        'An applied drawing this project does not hold was kept: 1 shape',
      );
    } finally {
      await act(async () => bar.unmount());
    }
  });

  it('is offered in the Studio, and Discard asks first', async () => {
    keepDesignDrawing(draft('offered'), Date.UTC(2026, 9, 28, 6, 2));
    const host = document.createElement('div');
    const bar = createRoot(host);
    try {
      await act(async () => bar.render(<DesignKeptDrawingBar />));
      expect(host.textContent).toContain('A drawing you had not applied was kept: 1 shape');
      const button = (label: string) =>
        [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
      await act(async () => button('Discard…')?.click());
      expect(host.textContent).toContain('Discard it for good?');
      expect(readKeptDesignDrawings()).toHaveLength(1);
      await act(async () => button('Discard')?.click());
      expect(readKeptDesignDrawings()).toEqual([]);
      expect(host.textContent).toBe('');
    } finally {
      await act(async () => bar.unmount());
    }
  });
});
