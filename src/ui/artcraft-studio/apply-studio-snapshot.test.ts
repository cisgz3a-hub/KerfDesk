import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('desktop editor artwork handoff', () => {
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
