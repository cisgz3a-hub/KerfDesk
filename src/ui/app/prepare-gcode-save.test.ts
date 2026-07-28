import { afterEach, describe, expect, it, vi } from 'vitest';

import { rotaryRasterSaveProject } from '../../__fixtures__/rotary-raster-save-project';
import type { PlatformAdapter } from '../../platform/types';
import { prepareGcodeSave } from './prepare-gcode-save';

const MOCK_PLATFORM: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: {
    isSupported: () => false,
    requestPort: async () => null,
  },
};

describe('prepareGcodeSave', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops a post-prepare rotary raster refusal through the existing failure surface', async () => {
    const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);

    const result = await prepareGcodeSave(
      {
        platform: MOCK_PLATFORM,
        project: rotaryRasterSaveProject(),
        savedName: null,
        pushToast: vi.fn(),
      },
      { ok: true },
    );

    expect(result).toEqual({ kind: 'failed' });
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('Rotary image engraving is experimental and disabled'),
    );
  });
});
