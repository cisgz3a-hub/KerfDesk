// Shared by the kept-drawing tests of ADR-590 Amendment 3: the real Studio
// persistence hook, the Studio's Apply, the real autosave loop, the app's
// close autosave, Save and Open marks, and project round trips.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';
import type { Sketch, SketchEntity } from '../../core/design';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { useAutosave } from '../app/use-autosave';
import { useStore } from '../state';
import { startAutosaveLoop } from '../state/autosave-loop';
import { noteProjectCopyOnDisk } from '../state/design-document-copies';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { sessionSketch } from './design-session';
import { clearPersistedSession } from './design-session-storage';
import { clearKeptDesignDrawings } from './design-kept-drawings';
import { DesignKeptDrawingBar } from './DesignKeptDrawingBar';
import { useDesignStudioStore } from './design-studio-store';
import { useDesignSessionPersistence } from './use-design-session-persistence';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export function line(id: string, x: number): SketchEntity {
  return { id, kind: 'line', start: { x, y: 0 }, end: { x: x + 10, y: 10 } };
}
export const one: Sketch = { entities: [line('applied', 0)] };
export const three: Sketch = { entities: [line('n1', 20), line('n2', 40), line('n3', 60)] };
export const ids = (sketch: Sketch | undefined): string[] =>
  sketch?.entities.map((entity) => entity.id) ?? [];

function Hooks(props: { readonly autosave?: boolean }) {
  useDesignSessionPersistence();
  return props.autosave === true ? <Autosave /> : null;
}
function Autosave() {
  useAutosave();
  return null;
}

let root: ReturnType<typeof createRoot> | null = null;
export async function mount(): Promise<void> {
  root = createRoot(document.createElement('div'));
  await act(async () => root?.render(<Hooks />));
}

/** The page closing: the app's autosave hook is mounted only for it, since
 *  its interval would keep the fake clock running. */
export async function closePage(): Promise<void> {
  await act(async () => root?.render(<Hooks autosave />));
  await act(async () => {
    window.dispatchEvent(new Event('beforeunload'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await act(async () => root?.render(<Hooks />));
}

async function settle(): Promise<void> {
  await act(async () => vi.runAllTimersAsync());
}

/** The Studio's open drawing. */
export function studioSketch(): Sketch {
  const session = useDesignStudioStore.getState().session;
  if (session === null) throw new Error('The Studio is closed');
  return sessionSketch(session);
}

export async function openStudio(): Promise<Sketch> {
  await act(async () => {
    const opening = useDesignStudioStore.getState().openStudio();
    await vi.runAllTimersAsync();
    await opening;
  });
  return studioSketch();
}

/** The Studio's Apply, as its Apply button runs it (use-design-apply). */
export async function applyInStudio(sketch: Sketch): Promise<void> {
  await act(async () => {
    useDesignStudioStore.getState().setSketch(sketch);
    const session = useDesignStudioStore.getState().session;
    if (session === null) throw new Error('The Studio is closed');
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
export async function autosave(): Promise<Project> {
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
export async function save(name: string): Promise<Project> {
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

export function roundTrip(project: Project): Project {
  const reopened = deserializeProject(serializeProject(project));
  if (reopened.kind !== 'ok') throw new Error('Project round trip failed');
  return reopened.project;
}

/** A crash and restart: the Studio is gone and the page starts on `project`. */
export async function restart(project: Project = createProject(), epoch = 0): Promise<void> {
  await act(async () => {
    useDesignStudioStore.setState({ session: null, stash: null, documentEpoch: -1 });
    useStore.setState({ project, projectDocumentEpoch: epoch, savedName: null, dirty: false });
    await vi.runAllTimersAsync();
  });
}

/** Restore from the recovery offer: the autosave holds what it restores. */
export async function restoreAutosave(project: Project, epoch = 1): Promise<void> {
  await act(async () => {
    useStore.setState({ project, projectDocumentEpoch: epoch, dirty: true });
    noteProjectCopyOnDisk(useStore.getState().project);
    await vi.runAllTimersAsync();
  });
}

/** File > Open of a saved project. */
export async function open(project: Project, name: string): Promise<void> {
  await act(async () => {
    useStore.setState((state) => ({
      project,
      projectDocumentEpoch: state.projectDocumentEpoch + 1,
    }));
    useStore.getState().markLoaded(name);
    await vi.runAllTimersAsync();
  });
}

export async function fileNew(): Promise<void> {
  await act(async () => {
    useDesignStudioStore.getState().closeStudio();
    useStore.getState().newProject();
    await vi.runAllTimersAsync();
  });
}

export async function barText(): Promise<string> {
  const host = document.createElement('div');
  const bar = createRoot(host);
  await act(async () => bar.render(<DesignKeptDrawingBar />));
  const text = host.textContent ?? '';
  await act(async () => bar.unmount());
  return text;
}

/** Fake timers, and empty stores and storage, around each test. */
export function keptDrawingTestLifecycle(): void {
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
}
