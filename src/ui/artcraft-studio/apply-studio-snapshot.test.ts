import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as studioValidator from '../../io/project/project-studio-document-validator';
import { studioDocument } from '../../io/project/studio-document.test-fixture';
import {
  bindStudioSession,
  disposeStudioProjectBridge,
  getStudioBinding,
} from './studio-project-bridge';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { dispatchImportFilesInOrder, type ImportDispatchActions } from '../app/import-dispatch';
import { applyStudioSnapshot, studioTarget } from './apply-studio-snapshot';
import { snapshotFile, type StudioSnapshot } from './artcraft-api';

vi.mock('../app/import-dispatch', () => ({ dispatchImportFilesInOrder: vi.fn() }));
const snapshot: StudioSnapshot = {
  id: 'session-123',
  editor: 'vector',
  revision: '1',
  filename: 'ignored.svg',
  mime: 'image/svg+xml',
  dataBase64: btoa('<svg/>'),
  nativeSaved: true,
};
let nextContent = '#000000';
let beforeCommit: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  nextContent = '#000000';
  beforeCommit = undefined;
  vi.mocked(dispatchImportFilesInOrder).mockImplementation(async (files, actions) => {
    beforeCommit?.();
    const source = files[0]!.name;
    const object = { ...svgObj(crypto.randomUUID(), [nextContent]), source };
    actions.importSvgFragment!({ source, bounds: object.bounds, objects: [object] });
  });
});
afterEach(() => {
  disposeStudioProjectBridge();
  vi.restoreAllMocks();
});

describe('desktop editor artwork handoff', () => {
  it('commits frozen native source and artwork in one notification and one Undo step', async () => {
    const native = studioDocument();
    const session = {
      id: snapshot.id,
      documentId: native.id,
      editor: snapshot.editor,
      title: 'Artwork',
      running: true,
    };
    bindStudioSession(session, 0);
    const before = useStore.getState().project;
    const observed: (typeof before)[] = [];
    const stop = useStore.subscribe((state) => {
      observed.push(state.project);
    });
    await applyStudioSnapshot({ ...snapshot, nativeDocument: native }, 0);
    stop();
    expect(observed).toHaveLength(1);
    expect(observed[0]?.studioDocuments).toEqual([native]);
    expect(observed[0]?.scene.objects).toHaveLength(1);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(getStudioBinding(native.id)).toEqual(session);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('leaves artwork, selection, dirty and history untouched when frozen source exceeds admission', async () => {
    const native = studioDocument();
    useStore.getState().upsertStudioDocument(native, 0);
    bindStudioSession(
      {
        id: snapshot.id,
        documentId: native.id,
        editor: snapshot.editor,
        title: 'Artwork',
        running: true,
      },
      0,
    );
    const before = useStore.getState();
    vi.spyOn(studioValidator, 'validateProjectStudioDocuments').mockReturnValue(
      'Project studio documents exceed the 64 MiB native-source budget',
    );
    await expect(
      applyStudioSnapshot({ ...snapshot, nativeDocument: { ...native, nativeBase64: 'ZGVm' } }, 0),
    ).rejects.toThrow('64 MiB');
    expect(useStore.getState()).toBe(before);
    expect(getStudioBinding(native.id)?.id).toBe(snapshot.id);
  });

  it('rejects a native binding changed while artwork was being decoded without partial artwork', async () => {
    const native = studioDocument();
    useStore.getState().upsertStudioDocument(native, 0);
    bindStudioSession(
      {
        id: snapshot.id,
        documentId: native.id,
        editor: snapshot.editor,
        title: 'Artwork',
        running: true,
      },
      0,
    );
    beforeCommit = () => useStore.getState().undo();
    await expect(applyStudioSnapshot({ ...snapshot, nativeDocument: native }, 0)).rejects.toThrow(
      'changed in the project',
    );
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().project.studioDocuments).toBeUndefined();
  });
  it('replaces an existing session instead of adding duplicates, with one undo entry per Apply', async () => {
    await applyStudioSnapshot(snapshot, 0);
    const first = useStore.getState().project.scene.objects[0]!;
    nextContent = '#ff0000';
    await applyStudioSnapshot({ ...snapshot, revision: '2' }, 0);
    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(1);
    expect(state.project.scene.objects[0]!.transform).toEqual(first.transform);
    expect(state.undoStack).toHaveLength(2);
    state.undo();
    expect(useStore.getState().project.scene.objects[0]).toEqual(first);
  });

  it('finds the applied source after panel reopen and restores removed artwork after undo', async () => {
    await applyStudioSnapshot(snapshot, 0);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    await applyStudioSnapshot(snapshot, 0);
    await applyStudioSnapshot(snapshot, 0);
    expect(useStore.getState().project.scene.objects).toHaveLength(1);
  });

  it('refuses stale project ownership before decode or after async decode', async () => {
    useStore.setState({ projectDocumentEpoch: 1 });
    await expect(applyStudioSnapshot(snapshot, 0)).rejects.toThrow('project changed');
    expect(dispatchImportFilesInOrder).not.toHaveBeenCalled();
    beforeCommit = () => useStore.setState({ projectDocumentEpoch: 2 });
    await expect(applyStudioSnapshot(snapshot, 1)).rejects.toThrow('project changed');
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
  });

  it('does not report parser failure as a successful Apply', async () => {
    vi.mocked(dispatchImportFilesInOrder).mockResolvedValueOnce();
    await expect(applyStudioSnapshot(snapshot, 0)).rejects.toThrow('No artwork was applied');
  });

  it('retains physical photo dimensions and replaces the earlier raster', async () => {
    vi.mocked(dispatchImportFilesInOrder).mockImplementation(
      async (files, actions: ImportDispatchActions) => {
        const raster: RasterImage = {
          kind: 'raster-image',
          id: crypto.randomUUID(),
          source: files[0]!.name,
          dataUrl: 'data:image/png;base64,AA==',
          lumaBase64: 'AA==',
          pixelWidth: 1,
          pixelHeight: 1,
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          transform: IDENTITY_TRANSFORM,
          color: '#000000',
          dither: 'floyd-steinberg',
          linesPerMm: 10,
        };
        actions.importRasterImage(raster);
      },
    );
    const photo: StudioSnapshot = {
      ...snapshot,
      editor: 'photo',
      mime: 'image/png',
      widthMm: 80,
      heightMm: 40,
    };
    await applyStudioSnapshot(photo, 0);
    await applyStudioSnapshot(photo, 0);
    const objects = useStore.getState().project.scene.objects;
    expect(objects).toHaveLength(1);
    expect(objects[0]!.bounds).toEqual({ minX: 0, minY: 0, maxX: 80, maxY: 40 });
  });

  it('rejects ambiguous copies rather than replacing unrelated artwork', () => {
    const source = 'kerfdesk-studio-session-123.svg';
    expect(() =>
      studioTarget(
        [
          { ...svgObj('a', []), source },
          { ...svgObj('b', []), source },
        ],
        source,
      ),
    ).toThrow('multiple copies');
  });

  it('uses session identity rather than externally supplied filenames and checks snapshot type', () => {
    expect(snapshotFile(snapshot).name).toBe('kerfdesk-studio-session-123.svg');
    expect(() => snapshotFile({ ...snapshot, mime: 'text/html' })).toThrow('unsupported');
    expect(() => snapshotFile({ ...snapshot, id: '../file' })).toThrow('unsupported');
    expect(() =>
      snapshotFile({ ...snapshot, nativeSaved: false } as unknown as StudioSnapshot),
    ).toThrow('native');
  });
});
