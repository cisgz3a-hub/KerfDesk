import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform, projectWithTwoLines } from '../../__fixtures__/file-actions';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../core/scene';
import { serializeProject } from '../../io/project';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { handleOpenProject } from './file-actions';
import { importStlFiles } from './stl-import-action';
import { bindImportActionsToDocument, captureImportDocumentOwner } from './import-dispatch';

const STL_TEXT = [
  'solid part',
  'facet normal 0 0 1',
  'outer loop',
  'vertex 0 0 0',
  'vertex 10 0 0',
  'vertex 0 10 1',
  'endloop',
  'endfacet',
  'endsolid part',
].join('\n');

function cncProject(): Project {
  const project = createProject();
  return {
    ...project,
    device: { ...project.device, capabilities: ['cnc-output'] },
    machine: DEFAULT_CNC_MACHINE_CONFIG,
  };
}

beforeEach(() => {
  resetStore();
  useStore.getState().setProject(cncProject());
  vi.stubGlobal('Worker', function WorkerUnavailable(): never {
    throw new Error('Workers are unavailable in this fallback test.');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pending STL relief import document ownership', () => {
  it.each(['new', 'open'] as const)(
    'preserves the next artwork when an old STL read finishes after %s',
    async (replacement) => {
      let finishRead!: (value: ArrayBuffer) => void;
      const bytes = new TextEncoder().encode(STL_TEXT).buffer as ArrayBuffer;
      const read = new Promise<ArrayBuffer>((resolve) => {
        finishRead = resolve;
      });
      const arrayBuffer = vi.fn(() => read);
      const file = new File([STL_TEXT], 'old-relief.stl', { type: 'model/stl' });
      Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });
      const state = useStore.getState();
      expect(state.project.machine?.kind).toBe('cnc');
      const publish = vi.fn(state.importSvgObject);
      const pushToast = vi.fn();
      const getEpoch = () => useStore.getState().projectDocumentEpoch;
      const actions = bindImportActionsToDocument(
        {
          getProjectDocumentEpoch: getEpoch,
          importSvgObject: publish,
          importRasterImage: state.importRasterImage,
          pushToast,
        },
        captureImportDocumentOwner(getEpoch),
      );
      const pending = importStlFiles([file], {
        importObject: actions.importSvgObject,
        pushToast: actions.pushToast,
      });
      try {
        await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
        if (replacement === 'new') useStore.getState().newProject();
        else {
          await handleOpenProject({
            platform: mockPlatform({
              open: async () => [
                { name: 'next-job.lf2', text: async () => serializeProject(cncProject()) },
              ],
            }),
            claimProjectOpenRequest: state.claimProjectOpenRequest,
            getProjectOpenRequestEpoch: () => useStore.getState().projectOpenRequestEpoch,
            getProjectDocumentEpoch: getEpoch,
            getProject: () => useStore.getState().project,
            setProject: useStore.getState().setProject,
            markLoaded: useStore.getState().markLoaded,
            pushToast: vi.fn(),
          });
          expect(useStore.getState().savedName).toBe('next-job.lf2');
        }
        useStore.getState().importSvgObject(projectWithTwoLines().scene.objects[0]!);
        const next = useStore.getState();
        expect(next.projectDocumentEpoch).toBe(state.projectDocumentEpoch + 1);
        finishRead(bytes);
        await pending;

        expect(publish).not.toHaveBeenCalled();
        expect(useStore.getState().project).toBe(next.project);
        expect(useStore.getState().projectDocumentEpoch).toBe(next.projectDocumentEpoch);
        expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['A']);
        expect(useStore.getState().dirty).toBe(true);
        expect(useStore.getState().undoStack).toBe(next.undoStack);
        expect(pushToast).not.toHaveBeenCalledWith(expect.anything(), 'success');
      } finally {
        finishRead(bytes);
        await pending;
      }
    },
  );
});
