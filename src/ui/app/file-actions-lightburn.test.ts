import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { handleOpenProject } from './file-actions';

const RECT_PROJECT = `<LightBurnProject><Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1 0 0 1 20 20</XForm></Shape></LightBurnProject>`;

afterEach(() => {
  useStore.getState().newProject();
});

describe('LightBurn project open migration', () => {
  it('loads read-only source into an lf2 target and reports migration evidence', async () => {
    const setProject = vi.fn(() => ({ kind: 'loaded' as const }));
    const markLoaded = vi.fn();
    const pushToast = vi.fn();
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async (request) => {
        expect(request.accept).toEqual(['.lf2', '.lbrn', '.lbrn2']);
        return [{ name: 'sign.lbrn2', text: async () => RECT_PROJECT }];
      },
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };

    await handleOpenProject({ platform, setProject, markLoaded, pushToast });

    expect(setProject).toHaveBeenCalledWith(
      expect.objectContaining({
        scene: expect.objectContaining({
          objects: [expect.anything()],
          layers: [expect.anything()],
        }),
      }),
    );
    expect(markLoaded).toHaveBeenCalledWith('sign.lf2', { dirty: true });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('Save as .lf2'), 'success');
  });

  it('keeps the converted project dirty and clears any prior native save target', async () => {
    useStore.setState({
      dirty: false,
      savedName: 'previous.lf2',
      lastSaveTarget: {
        displayName: 'previous.lf2',
        write: vi.fn(async () => undefined),
      },
    });
    const state = useStore.getState();
    const platform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [{ name: 'converted.lbrn', text: async () => RECT_PROJECT }],
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };

    await handleOpenProject({
      platform,
      setProject: state.setProject,
      markLoaded: state.markLoaded,
      pushToast: vi.fn(),
    });

    expect(useStore.getState()).toMatchObject({
      dirty: true,
      savedName: 'converted.lf2',
      lastSaveTarget: null,
    });
  });
});
