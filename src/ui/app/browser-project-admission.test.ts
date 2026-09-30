import { beforeEach, expect, it, vi } from 'vitest';
import { createProject, type Project, type TracedImage } from '../../core/scene';
import { serializeProjectTemplate } from '../../io/project/project-template';
import type { FileHandle } from '../../platform/types';
import { artworkProject } from '../library/personal-artwork-test-fixtures';
import { usePendingProProjectStore } from '../state/pending-pro-project';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { shapeObject } from '../state/testing/scene-clipboard-fixtures';
import { clearAutosaveAfterFileHandoff } from './autosave-file-cleanup';
import { completeLightBurnProjectOpen, completeNativeProjectOpen } from './project-open-completion';
import { openTemplateFile } from './project-template-actions';
import { proProject, reliefProject } from './pro-project-test-fixtures';
import { runAutosaveRecovery } from './use-autosave';

const build = vi.hoisted(() => ({ browser: true }));
vi.mock('../../platform/build-capabilities', () => ({
  get BROWSER_FREE_BUILD() {
    return build.browser;
  },
}));
vi.mock('./autosave-file-cleanup', () => ({ clearAutosaveAfterFileHandoff: vi.fn() }));

beforeEach(() => {
  build.browser = true;
  resetStore();
  usePendingProProjectStore.setState({ pending: null });
  vi.clearAllMocks();
});

function context() {
  return {
    setProject: useStore.getState().setProject,
    markLoaded: vi.fn(useStore.getState().markLoaded),
    pushToast: vi.fn(),
  };
}

it.each([
  ['vcarve', () => proProject()],
  ['adaptive-clearing', () => proProject({ cutType: 'pocket', pocketStrategy: 'adaptive' })],
  ['relief', () => proProject({ cutType: 'relief-finish' })],
  ['relief', reliefProject],
] as const)(
  'preserves an entire %s project without changing the current document',
  (feature, make) => {
    const target = { displayName: 'current.lf2', write: vi.fn() };
    useStore.setState({ dirty: true, savedName: 'current.lf2', lastSaveTarget: target });
    const current = useStore.getState();
    const incoming = make();
    expect(current.setProject(incoming)).toEqual({ kind: 'desktop-required', features: [feature] });
    expect(useStore.getState()).toBe(current);
    expect(usePendingProProjectStore.getState().pending?.project).toBe(incoming);
    expect(target.write).not.toHaveBeenCalled();
  },
);

it('loads ordinary artwork and trace vectors in browser Free', () => {
  const original = artworkProject();
  const shape = shapeObject();
  const trace: TracedImage = {
    kind: 'traced-image',
    id: 'trace-vectors',
    source: 'already-traced.png',
    traceMode: 'centerline',
    bounds: shape.bounds,
    transform: shape.transform,
    paths: shape.paths,
  };
  const incoming = {
    ...original,
    scene: { ...original.scene, objects: [...original.scene.objects, trace] },
  };
  const before = useStore.getState().projectDocumentEpoch;
  expect(useStore.getState().setProject(incoming).kind).toBe('loaded');
  expect(useStore.getState().project.scene).toEqual(incoming.scene);
  expect(useStore.getState().projectDocumentEpoch).toBe(before + 1);
  expect(usePendingProProjectStore.getState().pending).toBeNull();
});

it('keeps existing desktop Pro project admission unchanged', () => {
  build.browser = false;
  const incoming = proProject();
  expect(useStore.getState().setProject(incoming).kind).toBe('loaded');
  expect(useStore.getState().project.scene).toEqual(incoming.scene);
  expect(usePendingProProjectStore.getState().pending).toBeNull();
});

it('native and LightBurn completion never marks a refused project loaded or clears recovery', () => {
  const ctx = context();
  const current = useStore.getState();
  const incoming = proProject();
  expect(completeNativeProjectOpen(ctx, 'pro.lf2', { kind: 'ok', project: incoming })).toBe(false);
  expect(
    completeLightBurnProjectOpen(ctx, 'pro.lbrn2', {
      ok: true,
      project: incoming,
      report: {
        sourceName: 'pro.lbrn2',
        importedObjects: 3,
        importedLayers: 5,
        warnings: [],
        unsupportedShapeTypes: [],
      },
    }),
  ).toBe(false);
  expect(ctx.markLoaded).not.toHaveBeenCalled();
  expect(ctx.pushToast).not.toHaveBeenCalled();
  expect(clearAutosaveAfterFileHandoff).not.toHaveBeenCalled();
  expect(useStore.getState()).toBe(current);
  expect(usePendingProProjectStore.getState().pending?.name).toBe('pro.lbrn2');
});

it('Free native completion still adopts a file and clears previous recovery', () => {
  const ctx = context();
  expect(completeNativeProjectOpen(ctx, 'free.lf2', { kind: 'ok', project: createProject() })).toBe(
    true,
  );
  expect(ctx.markLoaded).toHaveBeenCalledWith('free.lf2');
  expect(clearAutosaveAfterFileHandoff).toHaveBeenCalledOnce();
});

it('a Pro template is preserved without marking the current workspace loaded', async () => {
  const ctx = context();
  const current = useStore.getState();
  const file: FileHandle = {
    name: 'pro.lf2template',
    text: async () => serializeProjectTemplate(proProject()),
  };
  await openTemplateFile(ctx, file, () => true);
  expect(ctx.markLoaded).not.toHaveBeenCalled();
  expect(ctx.pushToast).not.toHaveBeenCalled();
  expect(useStore.getState()).toBe(current);
  expect(usePendingProProjectStore.getState().pending?.name).toBe(file.name);
});

it('a Pro autosave is held without restore/discard, rewrite, cleanup or current-workspace mutation', async () => {
  const original = proProject();
  const current = useStore.getState();
  const snapshot = {
    project: original,
    savedAt: 100,
    storageKey: 'lf2:autosave:v1:previous',
    sessionId: 'previous',
    backend: 'local' as const,
    ownership: 'abandoned' as const,
  };
  const write = vi.fn(async (_project: Project) => ({ kind: 'superseded' as const }));
  const clearRecovered = vi.fn(async () => ({ kind: 'ok' as const }));
  const chooseRestore = vi.fn(() => false);
  const retainRecovered = vi.fn(async () => undefined);
  await runAutosaveRecovery(chooseRestore, {
    readLatest: async () => ({ snapshot, warnings: [], unreadable: [] }),
    write,
    clearRecovered,
    retainRecovered,
  });
  expect(retainRecovered).toHaveBeenCalledExactlyOnceWith(snapshot);
  expect(chooseRestore).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(clearRecovered).not.toHaveBeenCalled();
  expect(snapshot.project).toBe(original);
  expect(useStore.getState()).toBe(current);
  expect(usePendingProProjectStore.getState().pending).toMatchObject({
    project: original,
    source: 'autosave',
  });
});
