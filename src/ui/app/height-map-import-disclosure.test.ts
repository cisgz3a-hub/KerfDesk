import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { createProject } from '../../core/scene';
import { prepareReliefHeightfieldPngOffThread } from '../import/import-worker-client';
import { useStore } from '../state/store';
import { importHeightMapFiles } from './height-map-import-action';

vi.mock('../import/import-worker-client', () => ({
  prepareReliefHeightfieldPngOffThread: vi.fn(),
}));

const INITIAL_STATE = useStore.getState();
const PREPARED = {
  kind: 'ok' as const,
  heightfield: testReliefHeightfield({
    width: 2,
    height: 1,
    physicalWidthMm: 100,
    physicalHeightMm: 50,
    maxDepthMm: 5,
    samplesU8: [0, 255],
    provenance: { sourceName: 'depth.png' },
  }),
};

beforeEach(() => {
  useStore.setState({ ...INITIAL_STATE, project: createProject() }, true);
  vi.mocked(prepareReliefHeightfieldPngOffThread).mockReset();
});

afterEach(() => useStore.setState(INITIAL_STATE, true));

describe('height-map import success disclosure', () => {
  it.each(['laser', 'cnc'] as const)(
    'discloses storage and CNC-only output in %s mode',
    async (kind) => {
      useStore.getState().setMachineKind(kind);
      vi.mocked(prepareReliefHeightfieldPngOffThread).mockResolvedValue(PREPARED);
      const pushToast = vi.fn();

      await importHeightMapFiles([new File(['png'], 'depth.png')], {
        getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
        importObject: useStore.getState().importSvgObject,
        pushToast,
      });

      expect(useStore.getState().project.scene.objects).toEqual([
        expect.objectContaining({ kind: 'relief', reliefSource: PREPARED.heightfield }),
      ]);
      expect(pushToast).toHaveBeenCalledWith(
        expect.stringContaining(
          'It is stored in either machine mode; output geometry is generated only in CNC mode.',
        ),
        'success',
      );
    },
  );

  it.each([
    ['cnc', 'laser'],
    ['laser', 'cnc'],
  ] as const)(
    'keeps the disclosure accurate after a %s-to-%s switch during decode',
    async (from, to) => {
      useStore.getState().setMachineKind(from);
      const captured = useStore.getState();
      let resolve!: (value: typeof PREPARED) => void;
      const prepared = new Promise<typeof PREPARED>((onResolve) => {
        resolve = onResolve;
      });
      vi.mocked(prepareReliefHeightfieldPngOffThread).mockReturnValue(prepared);
      const pushToast = vi.fn();
      const pending = importHeightMapFiles([new File(['png'], 'depth.png')], {
        getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
        importObject: captured.importSvgObject,
        pushToast,
      });
      expect(prepareReliefHeightfieldPngOffThread).toHaveBeenCalledOnce();

      useStore.getState().setMachineKind(to);
      expect(useStore.getState().projectDocumentEpoch).toBe(captured.projectDocumentEpoch);
      resolve(PREPARED);
      await pending;

      expect(useStore.getState().project.machine?.kind).toBe(to);
      expect(useStore.getState().project.scene.objects).toEqual([
        expect.objectContaining({ kind: 'relief', reliefSource: PREPARED.heightfield }),
      ]);
      expect(pushToast).toHaveBeenCalledWith(
        expect.stringContaining(
          'It is stored in either machine mode; output geometry is generated only in CNC mode.',
        ),
        'success',
      );
    },
  );
});
