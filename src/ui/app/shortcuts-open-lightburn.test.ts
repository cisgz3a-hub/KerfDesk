import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectSaveRequestEpochCallbacks } from '../../__fixtures__/file-actions';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_OUTPUT_SCOPE, type Project } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { useStore, type ImportOutcome } from '../state/store';
import { handleFileShortcut, type FileCtx } from './shortcuts';

// A LightBurn project names no KerfDesk machine, so Ctrl+O opens it on the
// machine already open (ADR-388).
const TAG = `<LightBurnProject><Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1 0 0 1 20 20</XForm></Shape></LightBurnProject>`;

afterEach(() => {
  useStore.getState().replaceDeviceProfile(DEFAULT_DEVICE_PROFILE);
});

describe('Ctrl+O on a LightBurn project', () => {
  it('opens it on the machine already open', async () => {
    useStore.getState().replaceDeviceProfile({
      ...DEFAULT_DEVICE_PROFILE,
      name: 'My 300x200 diode',
      bedWidth: 300,
      bedHeight: 200,
    });
    const setProject = vi.fn((_project: Project) => ({ kind: 'loaded' as const }));
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [{ name: 'tag.lbrn2', text: async () => TAG }],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };
    const event = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, cancelable: true });

    expect(handleFileShortcut(event, fileContext(platform, setProject))).toBe(true);

    await vi.waitFor(() => expect(setProject).toHaveBeenCalled());
    expect(setProject.mock.calls[0]?.[0].device).toEqual(useStore.getState().project.device);
  });
});

function fileContext(platform: PlatformAdapter, setProject: FileCtx['setProject']): FileCtx {
  return {
    platform,
    project: createProject(),
    projectDocumentEpoch: 0,
    ...projectSaveRequestEpochCallbacks(),
    importSvgObject: vi.fn((): ImportOutcome => ({ kind: 'added' })),
    importRasterImage: vi.fn(),
    setProject,
    newProject: vi.fn(),
    savedName: null,
    jobPlacement: DEFAULT_JOB_PLACEMENT,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    machine: { statusReport: null, workOriginActive: false, wcoCache: null },
    controllerSettings: null,
    settingsCapability: 'grbl-dollar',
    lastSaveTarget: null,
    markSaved: vi.fn(),
    markLoaded: vi.fn(),
    pushToast: vi.fn(),
    confirmDiscard: vi.fn(async () => true),
  };
}
