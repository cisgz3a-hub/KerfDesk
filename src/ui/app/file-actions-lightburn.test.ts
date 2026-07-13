import { describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { handleOpenProject } from './file-actions';

const RECT_PROJECT = `<LightBurnProject><Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1 0 0 1 20 20</XForm></Shape></LightBurnProject>`;

describe('LightBurn project open migration', () => {
  it('loads read-only source into an lf2 target and reports migration evidence', async () => {
    const setProject = vi.fn();
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
    expect(markLoaded).toHaveBeenCalledWith('sign.lf2');
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('Save as .lf2'), 'success');
  });
});
