// Rolling audit v9 R6-P1-1, R6-P1-2 and R6-P2-1: whether to keep a Studio
// drawing was guessed from what the opened project shared with it. An Apply
// on a new layer, or after an empty Apply, shared nothing with the older
// autosave a crash restored, and was written over. A drawing its saved file
// held took one of the five kept places from unapplied work, and New offered
// the previous project's saved drawing. The saved drawing now records whether
// a saved file or an autosave holds its Apply, and the project it came from
// (ADR-590 Amendment 3).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sketch, SketchEntity } from '../../core/design';
import { createDesignLayer } from '../../core/design/layers/design-layer';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { useAutosave } from '../app/use-autosave';
import { useStore } from '../state';
import { readAutosave } from '../state/autosave';
import { startAutosaveLoop } from '../state/autosave-loop';
import { noteProjectCopyOnDisk } from '../state/design-document-copies';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { sessionSketch } from './design-session';
import { clearPersistedSession, readPersistedSession } from './design-session-storage';
import {
  clearKeptDesignDrawings,
  discardKeptDesignDrawing,
  keepDesignDrawing,
  readKeptDesignDrawings,
} from './design-kept-drawings';
import { DesignKeptDrawingBar } from './DesignKeptDrawingBar';
import { useDesignStudioStore } from './design-studio-store';
import { useDesignSessionPersistence } from './use-design-session-persistence';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function line(id: string, x: number, layerId?: string): SketchEntity {
  return {
    id,
    kind: 'line',
    start: { x, y: 0 },
    end: { x: x + 10, y: 10 },
    ...(layerId === undefined ? {} : { layerId }),
  };
}
const one: Sketch = { entities: [line('applied', 0)] };
const three: Sketch = { entities: [line('n1', 20), line('n2', 40), line('n3', 60)] };
const ids = (sketch: Sketch | undefined) => sketch?.entities.map((entity) => entity.id) ?? [];

function Hooks(props: { readonly autosave?: boolean }) {
  useDesignSessionPersistence();
  return props.autosave === true ? <Autosave /> : null;
}
function Autosave() {
  useAutosave();
  return null;
}

let root: ReturnType<typeof createRoot> | null = null;
async function mount(): Promise<void> {
  root = createRoot(document.createElement('div'));
  await act(async () => root?.render(<Hooks />));
}

async function settle(): Promise<void> {
  await act(async () => vi.runAllTimersAsync());
}

async function openStudio(): Promise<Sketch> {
  await act(async () => {
    const opening = useDesignStudioStore.getState().openStudio();
    await vi.runAllTimersAsync();
    await opening;
  });
  return sessionSketch(useDesignStudioStore.getState().session!);
}

/** The Studio's Apply, as its Apply button runs it (use-design-apply). */
async function applyInStudio(sketch: Sketch): Promise<void> {
  await act(async () => {
    useDesignStudioStore.getState().setSketch(sketch);
    const session = useDesignStudioStore.getState().session!;
    const record = useStore.getState().applyDesignSketch(
      sketch,
      sketch.entities.map(() => crypto.randomUUID()),
      session.applied,
      { activeLayerId: session.activeLayerId, surface3d: session.surface3d },
    );
    if (record === 'refused') throw new Error('Apply refused');
    useDesignStudioStore.getState().markApplied(record);
    await vi.runAllTimersAsync();
  });
}

/** One tick of the real autosave loop; returns what a restart restores. */
async function autosave(): Promise<Project> {
  const project = useStore.getState().project;
  const stop = startAutosaveLoop(() => ({ project, dirty: true, isStreaming: false }), 1000);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    await vi.runAllTimersAsync();
  });
  return roundTrip(project);
}

/** File > Save, as the save completion marks it. */
async function save(name: string): Promise<Project> {
  const state = useStore.getState();
  const request = state.claimProjectSaveRequest();
  const project = useStore.getState().project;
  state.markSaved(
    { displayName: name, write: async () => undefined },
    project,
    state.projectDocumentEpoch,
    request,
  );
  await settle();
  return roundTrip(project);
}

function roundTrip(project: Project): Project {
  const reopened = deserializeProject(serializeProject(project));
  if (reopened.kind !== 'ok') throw new Error('Project round trip failed');
  return reopened.project;
}

/** A crash and restart: the Studio is gone and the page starts on `project`. */
async function restart(project: Project = createProject(), epoch = 0): Promise<void> {
  await act(async () => {
    useDesignStudioStore.setState({ session: null, stash: null, documentEpoch: -1 });
    useStore.setState({ project, projectDocumentEpoch: epoch, savedName: null, dirty: false });
    await vi.runAllTimersAsync();
  });
}

/** Restore from the recovery offer: the autosave holds what it restores. */
async function restoreAutosave(project: Project, epoch = 1): Promise<void> {
  await act(async () => {
    useStore.setState({ project, projectDocumentEpoch: epoch, dirty: true });
    noteProjectCopyOnDisk(useStore.getState().project);
    await vi.runAllTimersAsync();
  });
}

/** File > Open of a saved project. */
async function open(project: Project, name: string): Promise<void> {
  await act(async () => {
    useStore.setState((state) => ({ project, projectDocumentEpoch: state.projectDocumentEpoch + 1 }));
    useStore.getState().markLoaded(name);
    await vi.runAllTimersAsync();
  });
}

async function fileNew(): Promise<void> {
  await act(async () => {
    useDesignStudioStore.getState().closeStudio();
    useStore.getState().newProject();
    await vi.runAllTimersAsync();
  });
}

async function barText(): Promise<string> {
  const host = document.createElement('div');
  const bar = createRoot(host);
  await act(async () => bar.render(<DesignKeptDrawingBar />));
  const text = host.textContent ?? '';
  await act(async () => bar.unmount());
  return text;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  localStorage.clear();
  clearPersistedSession();
  clearKeptDesignDrawings();
  useDesignStudioStore.setState({ session: null, stash: null, documentEpoch: -1 });
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  clearPersistedSession();
  clearKeptDesignDrawings();
});

describe('an Apply only the Studio holds is kept after a crash (R6-P1-1)', () => {
  it('keeps three lines applied on a new layer after the autosave', async () => {
    await mount();
    await openStudio();
    await applyInStudio(one);
    const older = await autosave();
    expect(readPersistedSession()).toMatchObject({ projectHoldsApply: true, projectName: null });
    const layered: Sketch = {
      layers: [createDesignLayer('layer-2', 1)],
      entities: three.entities.map((entity) => ({ ...entity, layerId: 'layer-2' })),
    };
    await applyInStudio(layered);
    expect(readPersistedSession()).toMatchObject({ projectHoldsApply: false });

    await restart();
    await restoreAutosave(older);
    expect(ids(await openStudio())).toEqual(['applied']);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([
      ['n1', 'n2', 'n3'],
    ]);
    expect(await barText()).toContain(
      'A drawing applied to an untitled project that no saved file or autosave holds was kept: 3 shapes',
    );
  });

  it('keeps three lines applied after an empty Apply', async () => {
    await mount();
    await openStudio();
    await applyInStudio(one);
    const older = await autosave();
    await applyInStudio({ entities: [] });
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    await applyInStudio(three);

    await restart();
    await restoreAutosave(older);
    expect(ids(await openStudio())).toEqual(['applied']);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([
      ['n1', 'n2', 'n3'],
    ]);
  });

  it('keeps it when another project with its own drawing opens first', async () => {
    await mount();
    await openStudio();
    await applyInStudio(one);
    await autosave();
    await applyInStudio(three);
    const other = roundTrip(createProject());
    await restart();
    await open(
      {
        ...other,
        designStudioDocument: {
          version: 1,
          sketch: { entities: [line('other', 90)] },
          activeLayerId: 'design-layer-1',
          surface3d: false,
          appliedObjectIds: [],
          appliedOperationsByLayer: [],
          appliedEntityObjectIds: [],
        },
      },
      'Other.lf2',
    );
    expect(ids(await openStudio())).toEqual(['other']);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([
      ['n1', 'n2', 'n3'],
    ]);
  });

  it('does not keep an Apply its saved file holds when another project opens', async () => {
    await mount();
    await openStudio();
    await applyInStudio(three);
    await save('Bracket.lf2');
    expect(readPersistedSession()).toMatchObject({
      projectHoldsApply: true,
      projectName: 'Bracket.lf2',
    });
    await restart();
    await open(roundTrip(createProject()), 'Other.lf2');
    expect(await openStudio()).toEqual({ entities: [] });
    expect(readKeptDesignDrawings()).toEqual([]);
  });
});

describe('the web and desktop close paths', () => {
  it('web: the close autosave holds the Apply, so a restart offers nothing and Restore gives it back', async () => {
    await mount();
    useStore.setState({ dirty: true });
    await openStudio();
    await applyInStudio(three);
    // The app's autosave hook, mounted for the close: its interval would keep
    // the fake clock running.
    await act(async () => root?.render(<Hooks autosave />));
    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await act(async () => root?.render(<Hooks />));
    expect(readPersistedSession()).toMatchObject({ projectHoldsApply: true });
    const closed = readAutosave();
    if (closed === null) throw new Error('The close wrote no autosave');

    await restart();
    expect(await openStudio()).toEqual({ entities: [] });
    expect(readKeptDesignDrawings()).toEqual([]);
    await restoreAutosave(closed.project);
    expect(ids(sessionSketch(useDesignStudioStore.getState().session!))).toEqual([
      'n1',
      'n2',
      'n3',
    ]);
  });

  it('desktop: Save at the close question holds the Apply, and the file gives it back', async () => {
    await mount();
    await openStudio();
    await applyInStudio(three);
    const file = await save('Bracket.lf2');
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(readPersistedSession()).toMatchObject({ projectHoldsApply: true });

    await restart();
    expect(await openStudio()).toEqual({ entities: [] });
    expect(readKeptDesignDrawings()).toEqual([]);
    await open(file, 'Bracket.lf2');
    expect(ids(sessionSketch(useDesignStudioStore.getState().session!))).toEqual([
      'n1',
      'n2',
      'n3',
    ]);
  });
});

describe('File > New (R6-P1-2, R6-P2-1)', () => {
  /** A drawing never applied, set aside by File > New. */
  async function keepUnappliedWork(): Promise<void> {
    await act(async () => {
      useStore.getState().importSvgObject(svgObj('svg-a', ['#000000']));
      await vi.runAllTimersAsync();
    });
    await save('Unapplied.lf2');
    await openStudio();
    await act(async () => {
      useDesignStudioStore.getState().setSketch({ entities: [line('u1', 100)] });
      await vi.runAllTimersAsync();
    });
    await fileNew();
    await openStudio();
  }

  it('keeps unapplied work through five saved Studio projects', async () => {
    await mount();
    await keepUnappliedWork();
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([['u1']]);
    for (let index = 1; index <= 5; index++) {
      await applyInStudio({ entities: [line(`p${index}`, index * 10)] });
      await save(`P${index}.lf2`);
      await fileNew();
      await openStudio();
    }
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([['u1']]);
    expect(await barText()).toContain(
      'A drawing you had not applied, from "Unapplied.lf2", was kept: 1 shape',
    );
  });

  it('offers nothing after New when the Studio drew and saved, or was not used', async () => {
    await mount();
    await openStudio();
    await applyInStudio(three);
    await save('Bracket.lf2');
    await fileNew();
    expect(await openStudio()).toEqual({ entities: [] });
    expect(readKeptDesignDrawings()).toEqual([]);
    expect(await barText()).toBe('');

    await fileNew();
    expect(await openStudio()).toEqual({ entities: [] });
    expect(readKeptDesignDrawings()).toEqual([]);
  });

  it('offers an Apply no copy holds after New, naming its project', async () => {
    await mount();
    await openStudio();
    await applyInStudio(one);
    await save('Bracket.lf2');
    await applyInStudio({ entities: [...one.entities, ...three.entities] });
    await fileNew();
    await openStudio();
    expect(await barText()).toContain(
      'A drawing applied to "Bracket.lf2" that no saved file or autosave holds was kept: 4 shapes',
    );
  });

  it('keeps a discard after its file opens in the Studio and is left again', async () => {
    await mount();
    await openStudio();
    await applyInStudio(one);
    const file = await save('Bracket.lf2');
    await applyInStudio({ entities: [...one.entities, ...three.entities] });
    await fileNew();
    await openStudio();
    const kept = readKeptDesignDrawings();
    expect(kept).toHaveLength(1);
    // The bar's Discard, once confirmed.
    await act(async () => discardKeptDesignDrawing(kept[0]!.id));
    expect(readKeptDesignDrawings()).toEqual([]);

    await open(file, 'Bracket.lf2');
    expect(ids(await openStudio())).toEqual(['applied']);
    await fileNew();
    await openStudio();
    expect(readKeptDesignDrawings()).toEqual([]);
    expect(await barText()).toBe('');
  });
});

describe('the five kept places (R6-P1-2)', () => {
  const draft = (id: string, extra: object = {}) => ({
    sketch: { entities: [line(id, 0)] },
    activeLayerId: 'layer-1',
    surface3d: false,
    applied: null,
    projectName: `${id}.lf2`,
    ...extra,
  });

  it('drops an applied drawing a copy may hold before unapplied work, and says so', () => {
    keepDesignDrawing(draft('old-applied', { dirtySinceApply: false }), 1000);
    for (let index = 0; index < 4; index++) keepDesignDrawing(draft(`u${index}`), 2000 + index);
    keepDesignDrawing(draft('newest'), 3000);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch)[0])).toEqual([
      'newest',
      'u3',
      'u2',
      'u1',
      'u0',
    ]);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      expect.stringContaining(
        'Design Studio keeps 5 drawings, so one was dropped to keep this one: 1 shape from "old-applied.lf2", kept',
      ),
    ]);
  });

  it('drops the oldest unapplied drawing past five, and says so', () => {
    for (let index = 0; index < 6; index++) keepDesignDrawing(draft(`u${index}`), 1000 + index);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch)[0])).toEqual([
      'u5',
      'u4',
      'u3',
      'u2',
      'u1',
    ]);
    expect(useToastStore.getState().toasts[0]?.message).toContain('from "u0.lf2"');
  });
});

// Saved by the real 1.0.28 code (src/__fixtures__/returning-user/README.md):
// its saved drawing and kept drawing record neither a source nor a copy.
describe('a Studio session and kept drawing saved by 1.0.28', () => {
  const FOLDER = 'src/__fixtures__/returning-user';
  const storage = JSON.parse(readFileSync(resolve(FOLDER, '1.0.28-studio-storage.json'), 'utf8'));
  const project = (name: string): Project => {
    const opened = deserializeProject(readFileSync(resolve(FOLDER, name), 'utf8'));
    if (opened.kind !== 'ok') throw new Error(`${name} did not open`);
    return opened.project;
  };
  function load1028(): void {
    localStorage.setItem('laserforge.design-studio-session.v1', JSON.stringify(storage.session));
    localStorage.setItem('laserforge.design-studio-kept-drawings.v1', JSON.stringify(storage.kept));
  }

  it('opens the newer file on its drawing and keeps only the unapplied one', async () => {
    load1028();
    await mount();
    await open(project('1.0.28-studio-newer.lf2'), 'Studio.lf2');
    expect(ids(await openStudio())).toEqual(['applied', 'l1', 'l2']);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([['u1', 'u2']]);
    expect(await barText()).toContain('A drawing you had not applied was kept: 2 shapes');
  });

  it('offers the applied drawing on the older autosave, as 1.0.28 did not', async () => {
    load1028();
    await mount();
    await restoreAutosave(project('1.0.28-studio-older.lf2'));
    expect(ids(await openStudio())).toEqual(['applied']);
    expect(readKeptDesignDrawings().map((kept) => ids(kept.sketch))).toEqual([
      ['applied', 'l1', 'l2'],
      ['u1', 'u2'],
    ]);
    expect(await barText()).toContain(
      'An applied drawing this project does not hold was kept: 3 shapes',
    );
  });
});
