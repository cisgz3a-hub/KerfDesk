import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedSvg, SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { handleReimportSelectedArtwork } from './reimport-selected-artwork';

const parserMocks = vi.hoisted(() => ({
  importSvgFiles: vi.fn(),
  importDxfFiles: vi.fn(),
}));

vi.mock('./svg-import-action', () => ({ importSvgFiles: parserMocks.importSvgFiles }));
vi.mock('./dxf-import-action', () => ({ importDxfFiles: parserMocks.importDxfFiles }));

function target(source: string): ImportedSvg {
  return { ...svgObj('selected-source', ['#ff0000']), source };
}

function platformWith(file: { readonly name: string }): PlatformAdapter {
  return {
    pickFilesForOpen: vi.fn(async () => [{ ...file, text: async () => '<svg />' }]),
  } as unknown as PlatformAdapter;
}

function owner(targetObject: ImportedSvg) {
  return {
    getProjectDocumentEpoch: () => 0,
    getTargetObject: () => targetObject,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe('handleReimportSelectedArtwork', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the selected SVG identity rather than filename equality', async () => {
    const replacement = svgObj('incoming', ['#00ff00']);
    const reimportObject = vi.fn(() => ({
      kind: 'replaced' as const,
      source: 'renamed-revision.svg',
      kept: 0,
      added: 1,
      removed: 1,
    }));
    parserMocks.importSvgFiles.mockImplementationOnce(async (_files, importObject) => {
      importObject(replacement as SceneObject);
    });
    const platform = platformWith({ name: 'renamed-revision.svg' });

    const selected = target('original.svg');
    await handleReimportSelectedArtwork({
      platform,
      target: selected,
      ...owner(selected),
      reimportObject,
      pushToast: vi.fn(),
    });

    expect(platform.pickFilesForOpen).toHaveBeenCalledWith({ accept: ['.svg'], multiple: false });
    expect(reimportObject).toHaveBeenCalledWith('selected-source', replacement);
  });

  it('routes a selected DXF source through the DXF parser', async () => {
    parserMocks.importDxfFiles.mockResolvedValueOnce(undefined);
    const platform = platformWith({ name: 'revision.dxf' });

    const selected = target('original.dxf');
    await handleReimportSelectedArtwork({
      platform,
      target: selected,
      ...owner(selected),
      reimportObject: vi.fn(),
      pushToast: vi.fn(),
    });

    expect(platform.pickFilesForOpen).toHaveBeenCalledWith({ accept: ['.dxf'], multiple: false });
    expect(parserMocks.importDxfFiles).toHaveBeenCalledOnce();
  });

  it('silently discards a deferred picker after the document epoch changes', async () => {
    const picked = deferred<Awaited<ReturnType<PlatformAdapter['pickFilesForOpen']>>>();
    const platform = {
      ...platformWith({ name: 'unused.svg' }),
      pickFilesForOpen: vi.fn(() => picked.promise),
    };
    const selected = target('original.svg');
    const current: SceneObject | undefined = selected;
    let epoch = 3;
    const pushToast = vi.fn();
    const pending = handleReimportSelectedArtwork({
      platform,
      target: selected,
      getProjectDocumentEpoch: () => epoch,
      getTargetObject: () => current,
      reimportObject: vi.fn(),
      pushToast,
    });
    await vi.waitFor(() => expect(platform.pickFilesForOpen).toHaveBeenCalledOnce());

    epoch += 1;
    picked.resolve([{ name: 'revision.svg', text: async () => '<svg />' }]);
    await pending;

    expect(parserMocks.importSvgFiles).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('silently discards deferred parsing after the exact target identity changes', async () => {
    const parsed = deferred<undefined>();
    const replacement = svgObj('incoming', ['#00ff00']);
    parserMocks.importSvgFiles.mockImplementationOnce(async (_files, importObject, pushToast) => {
      await parsed.promise;
      try {
        importObject(replacement);
      } catch {
        pushToast('stale parser completion', 'error');
      }
    });
    const selected = target('original.svg');
    let current: SceneObject | undefined = selected;
    const epoch = 8;
    const reimportObject = vi.fn();
    const pushToast = vi.fn();
    const pending = handleReimportSelectedArtwork({
      platform: platformWith({ name: 'revision.svg' }),
      target: selected,
      getProjectDocumentEpoch: () => epoch,
      getTargetObject: () => current,
      reimportObject,
      pushToast,
    });
    await vi.waitFor(() => expect(parserMocks.importSvgFiles).toHaveBeenCalledOnce());

    current = target('replacement.svg');
    parsed.resolve(undefined);
    await pending;

    expect(reimportObject).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });
});

describe('explicit re-import store history', () => {
  beforeEach(resetStore);

  it('does not mutate for an absent target and remains undoable for an exact target', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const beforeMissing = useStore.getState().project;
    expect(
      useStore.getState().reimportSvgObject('missing', svgObj('revision', ['#00ff00'])),
    ).toBeNull();
    expect(useStore.getState().project).toBe(beforeMissing);

    useStore.getState().reimportSvgObject('O1', svgObj('revision', ['#00ff00']));
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({
      id: 'O1',
      paths: [{ color: '#00ff00' }],
    });
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({
      id: 'O1',
      paths: [{ color: '#ff0000' }],
    });
  });
});
