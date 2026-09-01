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

  it('prepares non-empty rotary raster bytes without workstation-local permission', async () => {
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

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Rotary raster did not prepare.');
    expect(result.gcode).not.toBe('');
    expect(result.advisories).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });
});
